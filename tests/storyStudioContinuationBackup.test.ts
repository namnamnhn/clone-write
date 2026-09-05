import { describe, expect, it } from 'vitest';
import type { GeminiStoryEngineGenerationRuntime } from '../src/services/storyEngine';
import { createGeminiStoryEngineAdapters } from '../src/services/storyEngine';
import {
    createProductionStoryRuntime,
} from '../src/storyEngine';
import type { StoryBlueprintDocument } from '../src/storyEngine';
import {
    canRestoreStoryStudioContinuationBackup,
    getStoryStudioSafeMessage,
} from '../src/hooks/pages/useStoryStudio';
import {
    assertStoryStudioContinuationBackupFileSize,
    createStoryStudioContinuationBackup,
    parseStoryStudioContinuationBackup,
    parseStoryStudioContinuationBackupJson,
    sanitizeStoryStudioContinuationBackupFilename,
    serializeStoryStudioContinuationBackup,
    STORY_STUDIO_CONTINUATION_BACKUP_MAX_BYTES,
    StoryStudioContinuationBackupError,
} from '../src/storyStudio/production/storyStudioContinuationBackup';
import { StoryStudioProjectController } from '../src/storyStudio/production/storyStudioProjectController';
import {
    InMemoryStoryStudioStorageAdapter,
    parseStoryStudioProjectId,
    StoryStudioProjectRepository,
    storyStudioProjectStorageKey,
} from '../src/storyStudio/production/storyStudioProjectPersistence';
import { STORY_STUDIO_PROJECT_LIBRARY_KEY } from '../src/storyStudio/production/storyStudioProjectTypes';
import type {
    StoryStudioProjectDocumentV1,
    StoryStudioRuntimeProject,
} from '../src/storyStudio/production/storyStudioProjectTypes';
import { withoutRuntimeControl } from '../src/storyStudio/production/storyStudioProjectRuntime';

const SECRET = 'WORK15C_PRIVATE_AUTHOR_SECRET_SENTINEL';
const START = '2026-09-05T00:00:00.000Z';

const blueprint = (id = 'portable-story'): StoryBlueprintDocument => ({
    kind: 'story-blueprint-document',
    formatVersion: 1,
    blueprint: {
        id,
        engine: { plannedChapterCount: 4 },
        characters: [{ id: 'hero', name: 'Hero', availableFromChapter: 1 }],
        arcs: [{ id: 'arc', title: 'Portable Arc', startChapter: 1, endChapter: 4 }],
        gates: { pov: [{ id: 'hero-pov', characterId: 'hero', allowedFromChapter: 1 }] },
        authorOnlySecrets: [{ id: 'secret', value: SECRET }],
        canonRules: [{ id: 'rule', text: 'Continuity remains exact.', availableFromChapter: 1, scope: 'world' }],
    },
});

const chapterFrom = (contents: string): number => {
    const match = contents.match(/"targetChapter":(\d+)/) ?? contents.match(/"chapterNumber":(\d+)/);
    if (!match) throw new Error('missing chapter');
    return Number(match[1]);
};

const productionRuntime = (reject = false) => {
    const generation: GeminiStoryEngineGenerationRuntime = {
        async run(request) {
            const chapter = chapterFrom(request.contents);
            if (request.role === 'planner') return {
                value: {
                    kind: 'internal-chapter-plan', chapterNumber: chapter, arcId: 'arc',
                    primaryGoal: `Continue chapter ${chapter}.`, povCharacterId: 'hero', participantIds: ['hero'],
                    scenes: [{
                        id: `scene-${chapter}`, order: 1, goal: 'Preserve the route.', location: 'Archive',
                        povCharacterId: 'hero', participantIds: ['hero'], conflictOrObstacle: 'A sealed door.',
                        uncertainty: 'The key may fail.', expectedConsequence: `Chapter ${chapter} advances safely.`,
                        purposeTags: ['plot'], conflictImportance: 'minor',
                    }],
                    activeConstraintIds: ['rule'], allowedRevealIds: [], plannedRevealIds: [],
                    relationshipEventIds: [], storyEventIds: [], cluesPlantedIds: [], cluesPaidOffIds: [],
                    expectedResourceDeltas: [], expectedRelationshipDeltas: [], expectedContinuityConsequences: [],
                    strategicActions: [], relationshipActions: [], endStateIntent: 'The checkpoint is durable.',
                },
                selectedModelId: 'test-model',
            };
            if (request.role === 'writer') return {
                value: {
                    kind: 'writer-chapter-draft', chapterNumber: chapter,
                    title: `Chapter ${chapter}`, prose: `Durable chapter ${chapter} prose.`,
                },
                selectedModelId: 'test-model',
            };
            if (request.role === 'semanticValidator') return {
                value: {
                    kind: 'semantic-validation-result', chapterNumber: chapter,
                    issues: reject ? [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }] : [],
                },
                selectedModelId: 'test-model',
            };
            if (request.role === 'repair') throw new Error('repair is not expected');
            return {
                value: {
                    kind: 'story-state-delta', schemaVersion: 2, chapterNumber: chapter,
                    expectedRevision: chapter - 1,
                    factChanges: [{
                        id: `fact-${chapter}`, text: `Canonical fact ${chapter}.`, establishedChapter: chapter,
                        visibility: 'writer', status: 'active',
                        provenance: { sourceChapter: chapter, sourceType: 'chapter' },
                    }],
                    epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [],
                    relationshipChanges: [], resourceChanges: [], continuityChanges: [], revealChanges: [],
                    foreshadowChanges: [], payoffChanges: [],
                },
                selectedModelId: 'test-model',
            };
        },
    };
    return createProductionStoryRuntime({
        models: createGeminiStoryEngineAdapters(generation),
        runtimePolicy: { maxRepairAttempts: reject ? 0 : 2 },
    });
};

const environment = (idValues = ['project-a', 'project-b', 'project-c', 'project-d']) => {
    const values = [...idValues];
    let tick = 0;
    const now = () => `2026-09-05T00:00:${String(tick++).padStart(2, '0')}.000Z`;
    const adapter = new InMemoryStoryStudioStorageAdapter();
    const repository = new StoryStudioProjectRepository(
        adapter,
        now,
        () => parseStoryStudioProjectId(values.shift() ?? `project-${tick}`),
    );
    const controller = new StoryStudioProjectController(repository, now);
    return { adapter, repository, controller };
};

const createProjectAtStage = async (
    stage: StoryStudioRuntimeProject['workflow']['stage'],
): Promise<{ controller: StoryStudioProjectController; adapter: InMemoryStoryStudioStorageAdapter }> => {
    const { controller, adapter } = environment();
    await controller.load();
    await controller.createProject(blueprint(`stage-${stage}`), `Stage ${stage}`);
    if (stage === 'idle') return { controller, adapter };
    await controller.startBatch(2);
    const runtime = productionRuntime(stage === 'rejected');
    while (controller.currentProject?.workflow.stage !== stage) {
        await controller.runNextStage(runtime);
    }
    return { controller, adapter };
};

const exportFrom = (controller: StoryStudioProjectController) => {
    const backup = controller.createContinuationBackup();
    return { backup, source: serializeStoryStudioContinuationBackup(backup) };
};

describe('WORK15C continuation backup format', () => {
    it('strictly parses a valid deterministic V1 envelope', async () => {
        const { controller } = await createProjectAtStage('idle');
        const { backup, source } = exportFrom(controller);
        expect(serializeStoryStudioContinuationBackup(backup)).toBe(source);
        expect(parseStoryStudioContinuationBackupJson(source).backup).toEqual(backup);
        expect(backup.kind).toBe('story-studio-continuation-backup');
        expect(backup.formatVersion).toBe(1);
        expect(backup.project.formatVersion).toBe(1);
    });

    it.each([
        ['wrong kind', { kind: 'story-setup-document' }, 'CONTINUATION_BACKUP_WRONG_KIND'],
        ['unsupported version', { formatVersion: 2 }, 'CONTINUATION_BACKUP_UNSUPPORTED_VERSION'],
        ['missing field', { catalogDisplayName: undefined }, 'CONTINUATION_BACKUP_INVALID'],
        ['extra field', { localProjectId: 'must-not-travel' }, 'CONTINUATION_BACKUP_INVALID'],
    ])('rejects %s', async (_label, patch, expectedCode) => {
        const { controller } = await createProjectAtStage('idle');
        const { backup } = exportFrom(controller);
        const changes: Record<string, unknown> = patch;
        const value: Record<string, unknown> = { ...backup, ...changes };
        if ('catalogDisplayName' in changes && changes.catalogDisplayName === undefined) delete value.catalogDisplayName;
        expect(() => parseStoryStudioContinuationBackup(value)).toThrowError(expectedCode);
    });

    it('rejects malformed, empty, and oversized input before project mutation', () => {
        expect(() => parseStoryStudioContinuationBackupJson('{')).toThrowError(/CONTINUATION_BACKUP_MALFORMED_JSON/);
        expect(() => assertStoryStudioContinuationBackupFileSize(0)).toThrowError(/CONTINUATION_BACKUP_EMPTY/);
        expect(() => assertStoryStudioContinuationBackupFileSize(STORY_STUDIO_CONTINUATION_BACKUP_MAX_BYTES)).not.toThrow();
        expect(() => assertStoryStudioContinuationBackupFileSize(STORY_STUDIO_CONTINUATION_BACKUP_MAX_BYTES + 1))
            .toThrowError(/CONTINUATION_BACKUP_TOO_LARGE/);
    });

    it('rejects StoryControl, core, and Narrative Memory identity mismatches', async () => {
        const { controller } = await createProjectAtStage('idle');
        const backup = controller.createContinuationBackup();
        const invalidProjects: readonly StoryStudioProjectDocumentV1[] = [
            { ...backup.project, storyControlIdentity: 'wrong-control' },
            { ...backup.project, coreIdentity: 'wrong-core' },
            { ...backup.project, memory: { ...backup.project.memory, storyControlIdentity: 'wrong-memory' } },
        ];
        invalidProjects.forEach(project => {
            expect(() => parseStoryStudioContinuationBackup({ ...backup, project }))
                .toThrowError(/CONTINUATION_BACKUP_INVALID/);
        });
    });

    it('uses a safe portable filename and carries no browser-local project identity', async () => {
        const { controller } = await createProjectAtStage('idle');
        const { source } = exportFrom(controller);
        expect(sanitizeStoryStudioContinuationBackupFilename(' Truyện: Một/Bản? '))
            .toBe('Truyện- Một-Bản--continuation-backup-v1.json');
        expect(source).not.toContain('project-a');
        expect(source).not.toContain('story_studio_v4_project_v1:');
    });
});

describe('WORK15C exact workflow checkpoints', () => {
    it.each([
        'idle', 'planned', 'drafted', 'validated', 'rejected', 'extracted', 'ready-for-canon-review',
    ] as const)('round-trips the valid %s checkpoint without recovery', async (stage) => {
        const { controller } = await createProjectAtStage(stage);
        const before = withoutRuntimeControl(controller.currentProject!);
        const parsed = parseStoryStudioContinuationBackupJson(exportFrom(controller).source);
        expect(parsed.project.workflow.stage).toBe(stage);
        expect(withoutRuntimeControl(parsed.project)).toEqual(before);
    });

    it('rejects a stale workflow that ordinary local loading would recover to idle', async () => {
        const { controller } = await createProjectAtStage('planned');
        const backup = controller.createContinuationBackup();
        const staleProject = { ...backup.project, workflowIdentity: 'stale-workflow-identity' };
        expect(() => parseStoryStudioContinuationBackup({ ...backup, project: staleProject }))
            .toThrowError(/CONTINUATION_BACKUP_WORKFLOW_NOT_EXACT/);
    });

    it('does not export a runtime produced by local workflow recovery as an exact backup', async () => {
        const { controller, adapter } = await createProjectAtStage('planned');
        const projectId = controller.activeProjectId!;
        const stored = adapter.values.get(storyStudioProjectStorageKey(projectId)) as StoryStudioProjectDocumentV1;
        adapter.values.set(storyStudioProjectStorageKey(projectId), { ...stored, workflowIdentity: 'stale' });

        const loadingRepository = new StoryStudioProjectRepository(
            adapter,
            () => START,
            () => parseStoryStudioProjectId('unused'),
        );
        const recoveredController = new StoryStudioProjectController(loadingRepository, () => START);
        expect(await recoveredController.load()).toMatchObject({ status: 'workflow-recovered' });
        expect(() => recoveredController.createContinuationBackup())
            .toThrowError(/CONTINUATION_BACKUP_WORKFLOW_NOT_EXACT/);

        await recoveredController.replanCurrentChapter();
        expect(() => recoveredController.createContinuationBackup()).not.toThrow();
    });
});

describe('WORK15C restore and isolation', () => {
    it('preserves exact durable semantics but creates and activates a fresh local project ID', async () => {
        const { controller, adapter } = environment();
        await controller.load();
        await controller.createProject(blueprint('semantic-roundtrip'), 'Original');
        await controller.updateDisplayName('Renamed catalog label');
        const originalId = controller.activeProjectId!;
        await controller.startBatch(2);
        for (let step = 0; step < 5; step += 1) await controller.runNextStage(productionRuntime());
        const before = withoutRuntimeControl(controller.currentProject!);
        const parsed = parseStoryStudioContinuationBackupJson(exportFrom(controller).source);
        const restored = await controller.restoreContinuationBackup(parsed);
        const restoredId = controller.activeProjectId!;

        expect(restoredId).not.toBe(originalId);
        expect(withoutRuntimeControl(restored)).toEqual(before);
        expect(controller.projectLibrary.find(entry => entry.projectId === restoredId)?.displayName)
            .toBe('Renamed catalog label');
        expect(controller.projectLibrary).toHaveLength(2);
        expect(adapter.values.get(storyStudioProjectStorageKey(originalId))).toEqual(before);
    });

    it('preserves Canon, Narrative Memory, metadata, ready review, and requires one explicit Make Canon', async () => {
        const { controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('canon-roundtrip'), 'Canon roundtrip');
        await controller.startBatch(2);
        for (let step = 0; step < 5; step += 1) await controller.runNextStage(productionRuntime());
        await controller.makeCanonDurably(controller.createConfirmation());
        for (let step = 0; step < 5; step += 1) await controller.runNextStage(productionRuntime());
        const sourceProject = withoutRuntimeControl(controller.currentProject!);
        expect(sourceProject.workflow.stage).toBe('ready-for-canon-review');
        expect(sourceProject.state.currentChapter).toBe(1);

        await controller.restoreContinuationBackup(parseStoryStudioContinuationBackupJson(exportFrom(controller).source));
        expect(controller.currentProject?.state).toEqual(sourceProject.state);
        expect(controller.currentProject?.memory).toEqual(sourceProject.memory);
        expect(controller.currentProject?.chapterMetadata).toEqual(sourceProject.chapterMetadata);
        expect(controller.currentProject?.batchQueue).toEqual(sourceProject.batchQueue);
        expect(controller.currentProject?.workflow).toEqual(sourceProject.workflow);
        expect(controller.currentProject?.state.currentChapter).toBe(1);

        await controller.makeCanonDurably(controller.createConfirmation());
        expect(controller.currentProject?.state.currentChapter).toBe(2);
        expect(controller.currentProject?.state.revision).toBe(2);
        expect(controller.currentProject?.memory.records).toHaveLength(2);
        expect(controller.currentProject?.chapterMetadata).toHaveLength(2);
    });

    it('restores the same backup twice as independent projects and reloads/switches/deletes safely', async () => {
        const { controller, repository } = environment();
        await controller.load();
        await controller.createProject(blueprint('duplicate'), 'A');
        const originalId = controller.activeProjectId!;
        const prepared = parseStoryStudioContinuationBackupJson(exportFrom(controller).source);

        await controller.restoreContinuationBackup(prepared);
        const firstRestoreId = controller.activeProjectId!;
        await controller.restoreContinuationBackup(prepared);
        const secondRestoreId = controller.activeProjectId!;
        expect(new Set([originalId, firstRestoreId, secondRestoreId]).size).toBe(3);
        expect(controller.projectLibrary).toHaveLength(3);

        await controller.switchProject(originalId);
        await controller.switchProject(firstRestoreId);
        await controller.deleteProject(secondRestoreId);
        expect(controller.projectLibrary.map(entry => entry.projectId)).toEqual([originalId, firstRestoreId]);
        const reloaded = await repository.load();
        expect(reloaded.status).toBe('loaded');
        expect(reloaded.library?.entries).toHaveLength(2);
    });

    it('atomically preserves the existing project and index when restore storage commit fails', async () => {
        const { controller, adapter } = environment();
        await controller.load();
        await controller.createProject(blueprint('failure'), 'Existing');
        const beforeValues = structuredClone([...adapter.values.entries()]);
        const beforeProject = controller.currentProject;
        const beforeId = controller.activeProjectId;
        const prepared = parseStoryStudioContinuationBackupJson(exportFrom(controller).source);
        adapter.failNextCommit = true;

        await expect(controller.restoreContinuationBackup(prepared)).rejects.toThrowError(/SAVE_FAILED/);
        expect([...adapter.values.entries()]).toEqual(beforeValues);
        expect(controller.currentProject).toBe(beforeProject);
        expect(controller.activeProjectId).toBe(beforeId);
        expect(controller.projectLibrary).toHaveLength(1);
    });

    it('fails closed on an invalid library before registering any restored project', async () => {
        const sourceEnvironment = environment();
        await sourceEnvironment.controller.load();
        await sourceEnvironment.controller.createProject(blueprint('source'), 'Source');
        const prepared = parseStoryStudioContinuationBackupJson(exportFrom(sourceEnvironment.controller).source);

        const target = environment(['restored']);
        target.adapter.values.set(STORY_STUDIO_PROJECT_LIBRARY_KEY, { kind: 'corrupt-index' });
        const before = structuredClone([...target.adapter.values.entries()]);
        await expect(target.controller.restoreContinuationBackup(prepared)).rejects.toThrowError(/INVALID_LIBRARY/);
        expect([...target.adapter.values.entries()]).toEqual(before);
    });

    it('accepts a new restore beside a corrupt active record only when the library index is verified', async () => {
        const source = environment(['source']);
        await source.controller.load();
        await source.controller.createProject(blueprint('trusted-source'), 'Portable source');
        const prepared = parseStoryStudioContinuationBackupJson(exportFrom(source.controller).source);

        const target = environment(['target-a', 'target-b', 'target-restored']);
        await target.controller.load();
        await target.controller.createProject(blueprint('target-a'), 'Target A');
        const validId = target.controller.activeProjectId!;
        await target.controller.createProject(blueprint('target-b'), 'Target B');
        const corruptId = target.controller.activeProjectId!;
        target.adapter.values.set(storyStudioProjectStorageKey(corruptId), { corrupt: true });
        const corruptedSource = structuredClone(target.adapter.values.get(storyStudioProjectStorageKey(corruptId)));
        const recoveringController = new StoryStudioProjectController(target.repository, () => START);
        const load = await recoveringController.load();
        expect(load).toMatchObject({
            status: 'core-corrupt',
            recoveryTarget: { kind: 'active-library-project', projectId: corruptId },
        });

        await recoveringController.restoreContinuationBackup(prepared);
        expect(recoveringController.activeProjectId).not.toBe(validId);
        expect(recoveringController.activeProjectId).not.toBe(corruptId);
        expect(recoveringController.projectLibrary).toHaveLength(3);
        expect(target.adapter.values.get(storyStudioProjectStorageKey(corruptId))).toEqual(corruptedSource);
        expect(target.adapter.values.has(storyStudioProjectStorageKey(validId))).toBe(true);
    });

    it('blocks a second restore while the first durability transition is active', async () => {
        const { controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('serialized-restore'), 'Serialized restore');
        const prepared = parseStoryStudioContinuationBackupJson(exportFrom(controller).source);
        const first = controller.restoreContinuationBackup(prepared);
        await expect(controller.restoreContinuationBackup(prepared)).rejects.toThrowError(/PROJECT_OPERATION_BLOCKED/);
        await first;
        expect(controller.projectLibrary).toHaveLength(2);
    });
});

describe('WORK15C privacy and UI trust boundary', () => {
    it('retains required Author Secrets only in the explicit artifact and emits secret-safe diagnostics', async () => {
        const { controller } = await createProjectAtStage('idle');
        const source = exportFrom(controller).source;
        expect(source).toContain(SECRET);
        const error = new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_INVALID');
        expect(error.message).not.toContain(SECRET);
        expect(getStoryStudioSafeMessage(error)).not.toContain(SECRET);
        expect(getStoryStudioSafeMessage(error)).not.toContain('{');
    });

    it('permits restore only with a verified library authority', () => {
        expect(canRestoreStoryStudioContinuationBackup('empty', true)).toBe(true);
        expect(canRestoreStoryStudioContinuationBackup('connected', true)).toBe(true);
        expect(canRestoreStoryStudioContinuationBackup('core-corrupt', true)).toBe(true);
        expect(canRestoreStoryStudioContinuationBackup('core-corrupt', false)).toBe(false);
        expect(canRestoreStoryStudioContinuationBackup('loading', true)).toBe(false);
    });

    it('does not alter the project while exporting', async () => {
        const { controller } = await createProjectAtStage('drafted');
        const before = structuredClone(withoutRuntimeControl(controller.currentProject!));
        createStoryStudioContinuationBackup(controller.currentProject!, 'Catalog', START);
        expect(withoutRuntimeControl(controller.currentProject!)).toEqual(before);
    });

    it('keeps the durable project document at formatVersion 1', async () => {
        const { controller } = await createProjectAtStage('idle');
        const project: StoryStudioProjectDocumentV1 = controller.createContinuationBackup().project;
        expect(project.formatVersion).toBe(1);
        expect(project.state.schemaVersion).toBe(4);
    });
});
