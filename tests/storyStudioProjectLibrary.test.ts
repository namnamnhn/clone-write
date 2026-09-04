import { describe, expect, it } from 'vitest';
import type { GeminiStoryEngineGenerationRuntime } from '../src/services/storyEngine';
import { createGeminiStoryEngineAdapters } from '../src/services/storyEngine';
import {
    createMakeCanonConfirmation,
    createProductionCanonIdentity,
    createProductionStoryRuntime,
    makeCanon,
    recordCanonicalChapterMemory,
} from '../src/storyEngine';
import type { StoryBlueprintDocument } from '../src/storyEngine';
import { StoryStudioProjectController } from '../src/storyStudio/production/storyStudioProjectController';
import {
    createEmptyStoryStudioProjectLibraryIndex,
    deriveStoryStudioProjectLibraryEntry,
    InMemoryStoryStudioStorageAdapter,
    parseStoryStudioProjectId,
    parseStoryStudioProjectLibraryIndex,
    StoryStudioProjectRepository,
    storyStudioProjectStorageKey,
} from '../src/storyStudio/production/storyStudioProjectPersistence';
import {
    STORY_STUDIO_PROJECT_LIBRARY_KEY,
    STORY_STUDIO_STORAGE_KEY,
} from '../src/storyStudio/production/storyStudioProjectTypes';
import type {
    CanonicalChapterMetadata,
    StoryStudioRuntimeProject,
} from '../src/storyStudio/production/storyStudioProjectTypes';
import {
    buildStoryStudioProjectDocument,
    createCanonicalChapterMetadataIdentity,
    createStoryStudioProject,
    rebuildRuntimeProject,
    withoutRuntimeControl,
} from '../src/storyStudio/production/storyStudioProjectRuntime';

const SECRET = 'WORK15A_AUTHOR_SECRET_MUST_NOT_ENTER_INDEX';
const FIXED_TIME = '2026-09-04T00:00:00.000Z';

const blueprint = (id: string, plannedChapterCount = 4): StoryBlueprintDocument => ({
    kind: 'story-blueprint-document', formatVersion: 1,
    blueprint: {
        id,
        engine: { plannedChapterCount },
        characters: [{ id: 'hero', name: 'Hero', availableFromChapter: 1 }],
        arcs: [{ id: 'arc', title: 'Arc', startChapter: 1, endChapter: plannedChapterCount }],
        gates: { pov: [{ id: 'hero-pov', characterId: 'hero', allowedFromChapter: 1 }] },
        authorOnlySecrets: [{ id: 'private', value: SECRET }],
        canonRules: [{ id: 'rule', text: 'Choices remain durable.', availableFromChapter: 1, scope: 'world' }],
    },
});

const chapterFrom = (contents: string): number => {
    const match = contents.match(/"targetChapter":(\d+)/) ?? contents.match(/"chapterNumber":(\d+)/);
    if (!match) throw new Error('missing chapter');
    return Number(match[1]);
};

const productionRuntime = () => {
    const generation: GeminiStoryEngineGenerationRuntime = {
        async run(request) {
            const chapter = chapterFrom(request.contents);
            if (request.role === 'planner') return {
                value: {
                    kind: 'internal-chapter-plan', chapterNumber: chapter, arcId: 'arc',
                    primaryGoal: `Chapter ${chapter}.`, povCharacterId: 'hero', participantIds: ['hero'],
                    scenes: [{
                        id: `scene-${chapter}`, order: 1, goal: 'Advance safely.', location: 'Archive',
                        povCharacterId: 'hero', participantIds: ['hero'], conflictOrObstacle: 'A sealed door.',
                        uncertainty: 'The key may fail.', expectedConsequence: `Chapter ${chapter} completes.`,
                        purposeTags: ['plot'], conflictImportance: 'minor',
                    }],
                    activeConstraintIds: ['rule'], allowedRevealIds: [], plannedRevealIds: [],
                    relationshipEventIds: [], storyEventIds: [], cluesPlantedIds: [], cluesPaidOffIds: [],
                    expectedResourceDeltas: [], expectedRelationshipDeltas: [], expectedContinuityConsequences: [],
                    strategicActions: [], relationshipActions: [], endStateIntent: 'The choice is durable.',
                },
                selectedModelId: 'offline-test',
            };
            if (request.role === 'writer') return {
                value: { kind: 'writer-chapter-draft', chapterNumber: chapter, title: `Chapter ${chapter}`, prose: `Canonical prose ${chapter}.` },
                selectedModelId: 'offline-test',
            };
            if (request.role === 'semanticValidator') return {
                value: { kind: 'semantic-validation-result', chapterNumber: chapter, issues: [] },
                selectedModelId: 'offline-test',
            };
            if (request.role === 'repair') throw new Error('repair is not expected');
            return {
                value: {
                    kind: 'story-state-delta', schemaVersion: 2, chapterNumber: chapter, expectedRevision: chapter - 1,
                    factChanges: [{
                        id: `fact-${chapter}`, text: `Canonical fact ${chapter}.`, establishedChapter: chapter,
                        visibility: 'writer', status: 'active', provenance: { sourceChapter: chapter, sourceType: 'chapter' },
                    }],
                    epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [],
                    relationshipChanges: [], resourceChanges: [], continuityChanges: [], revealChanges: [],
                    foreshadowChanges: [], payoffChanges: [],
                },
                selectedModelId: 'offline-test',
            };
        },
    };
    return createProductionStoryRuntime({ models: createGeminiStoryEngineAdapters(generation) });
};

const ids = (...values: string[]) => {
    const queue = [...values];
    return () => parseStoryStudioProjectId(queue.shift() ?? `generated-${queue.length}`);
};

const environment = (projectIds = ['project-a', 'project-b', 'project-c'], now = () => FIXED_TIME) => {
    const adapter = new InMemoryStoryStudioStorageAdapter();
    const repository = new StoryStudioProjectRepository(adapter, now, ids(...projectIds));
    const controller = new StoryStudioProjectController(repository, now);
    return { adapter, repository, controller };
};

const advanceToStage = async (
    controller: StoryStudioProjectController,
    target: StoryStudioRuntimeProject['workflow']['stage'],
) => {
    const runtime = productionRuntime();
    while (controller.currentProject?.workflow.stage !== target) await controller.runNextStage(runtime);
};

const makeCanonicalProject = async (chapters: number, planned = Math.max(chapters + 1, 4)) => {
    let project = createStoryStudioProject(
        blueprint(`canonical-${chapters}`, planned), `Canonical ${chapters}`, FIXED_TIME,
    );
    const runtime = productionRuntime();
    for (let chapter = 1; chapter <= chapters; chapter += 1) {
        const request = { control: project.control, state: project.state, memoryState: project.memory };
        const plan = await runtime.planProductionChapter(request);
        const draft = await runtime.writeProductionChapter({ ...request, plan });
        const validation = await runtime.validateProductionChapter({ ...request, plan, draft });
        if (validation.result.status !== 'approved-not-canon') throw new Error('fixture validation failed');
        const extraction = await runtime.extractProductionChapter({ ...request, plan, draft, validation });
        const proposal = runtime.prepareProductionCanonReview({ ...request, plan, draft, validation, extraction });
        const afterState = makeCanon({
            control: project.control, state: project.state, approved: validation.result,
            proposal, confirmation: createMakeCanonConfirmation(proposal),
        });
        const afterMemory = recordCanonicalChapterMemory({
            control: project.control, memoryState: project.memory, beforeState: project.state,
            afterState, approved: validation.result, proposal,
        });
        const record = afterMemory.records.at(-1)!;
        const metadataBody: Omit<CanonicalChapterMetadata, 'metadataIdentity'> = {
            kind: 'canonical-chapter-metadata', chapterNumber: chapter, title: `Chapter ${chapter}`,
            canonicalizationSourceIdentity: record.canonicalizationSourceIdentity,
            proposalIdentity: record.proposalIdentity, beforeCanonIdentity: record.beforeCanonIdentity,
            afterCanonIdentity: record.afterCanonIdentity,
        };
        project = {
            ...project,
            state: afterState,
            memory: afterMemory,
            chapterMetadata: [...project.chapterMetadata, {
                ...metadataBody, metadataIdentity: createCanonicalChapterMetadataIdentity(metadataBody),
            }],
        };
    }
    const document = buildStoryStudioProjectDocument({
        displayName: project.displayName, setupDocument: project.setupDocument,
        storyControlIdentity: project.storyControlIdentity, state: project.state, memory: project.memory,
        chapterMetadata: project.chapterMetadata, workflow: project.workflow, batchQueue: project.batchQueue,
        createdAt: project.createdAt, updatedAt: project.updatedAt,
    });
    return { ...document, control: project.control };
};

describe('WORK15A project library contract', () => {
    it('strictly parses a valid index and rejects unknown fields', () => {
        const projectId = parseStoryStudioProjectId('project-a');
        const project = createStoryStudioProject(blueprint('strict'), 'Strict', FIXED_TIME);
        const index = {
            ...createEmptyStoryStudioProjectLibraryIndex(FIXED_TIME),
            activeProjectId: projectId,
            entries: [deriveStoryStudioProjectLibraryEntry(projectId, project)],
        };
        expect(parseStoryStudioProjectLibraryIndex(index)).toEqual(index);
        expect(() => parseStoryStudioProjectLibraryIndex({ ...index, rawSetup: SECRET })).toThrowError(/INVALID_LIBRARY/);
    });

    it('rejects duplicate IDs, missing metadata, and an active ID outside entries', () => {
        const projectId = parseStoryStudioProjectId('duplicate');
        const project = createStoryStudioProject(blueprint('duplicates'), 'Duplicate', FIXED_TIME);
        const entry = deriveStoryStudioProjectLibraryEntry(projectId, project);
        const base = { kind: 'story-studio-project-library-index', formatVersion: 1, updatedAt: FIXED_TIME } as const;
        expect(() => parseStoryStudioProjectLibraryIndex({ ...base, entries: [entry, entry] })).toThrowError(/INVALID_LIBRARY/);
        const missingName: Record<string, unknown> = { ...entry };
        delete missingName.displayName;
        expect(() => parseStoryStudioProjectLibraryIndex({ ...base, entries: [missingName] })).toThrowError(/INVALID_LIBRARY/);
        expect(() => parseStoryStudioProjectLibraryIndex({ ...base, activeProjectId: 'other', entries: [entry] })).toThrowError(/INVALID_LIBRARY/);
    });

    it('uses the exact isolated project-key namespace', () => {
        const id = parseStoryStudioProjectId('safe-id_1.2');
        expect(storyStudioProjectStorageKey(id)).toBe('story_studio_v4_project_v1:safe-id_1.2');
        expect(() => parseStoryStudioProjectId('../unsafe')).toThrowError(/INVALID_LIBRARY/);
    });

    it('keeps raw Author Secret and full setup data out of catalog metadata', async () => {
        const { adapter, controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('secret-safe'), 'Secret safe');
        await controller.updateDisplayName(`Leaked ${SECRET}`);
        const serialized = JSON.stringify(adapter.values.get(STORY_STUDIO_PROJECT_LIBRARY_KEY));
        expect(serialized).not.toContain(SECRET);
        expect(serialized).not.toContain('authorOnlySecrets');
        expect(serialized).not.toContain('setupDocument');
    });
});

describe('WORK15A lossless legacy migration', () => {
    it('creates an empty library from empty legacy storage', async () => {
        const { adapter, controller } = environment(['legacy']);
        const result = await controller.load();
        expect(result).toMatchObject({ status: 'empty', library: { index: { entries: [] }, entries: [] } });
        expect(adapter.values.has(STORY_STUDIO_PROJECT_LIBRARY_KEY)).toBe(true);
        expect(adapter.values.has(STORY_STUDIO_STORAGE_KEY)).toBe(false);
    });

    it('migrates valid C0 byte-equivalent semantic content and preserves every project identity', async () => {
        const { adapter, controller } = environment(['legacy-c0']);
        const legacy = withoutRuntimeControl(createStoryStudioProject(blueprint('legacy-c0'), 'Legacy C0', FIXED_TIME));
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, structuredClone(legacy));
        const result = await controller.load();
        expect(result.status).toBe('loaded');
        if (result.status !== 'loaded') throw new Error('expected migrated project');
        expect(withoutRuntimeControl(result.project)).toEqual(legacy);
        expect(result.project).toMatchObject({
            storyControlIdentity: legacy.storyControlIdentity,
            coreIdentity: legacy.coreIdentity,
            workflowIdentity: legacy.workflowIdentity,
            createdAt: legacy.createdAt,
            updatedAt: legacy.updatedAt,
        });
        expect(adapter.values.has(STORY_STUDIO_STORAGE_KEY)).toBe(false);
    });

    it('migrates a valid C238-style project with exact Canon, history, metadata, and memory lineage', async () => {
        const project = await makeCanonicalProject(238, 240);
        const legacy = withoutRuntimeControl(project);
        const { adapter, controller } = environment(['legacy-c238']);
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, structuredClone(legacy));
        const result = await controller.load();
        expect(result.status).toBe('loaded');
        if (result.status !== 'loaded') throw new Error('expected C238 migration');
        expect(result.project.state).toMatchObject({ currentChapter: 238, revision: 238 });
        expect(result.project.memory.records).toHaveLength(238);
        expect(result.project.chapterMetadata).toHaveLength(238);
        expect(withoutRuntimeControl(result.project)).toEqual(legacy);
    }, 120_000);

    it('preserves approved-not-canon workflow without making Canon', async () => {
        const source = environment(['source']);
        await source.controller.load();
        await source.controller.createProject(blueprint('approved'), 'Approved');
        await source.controller.startBatch(1);
        await advanceToStage(source.controller, 'validated');
        const legacy = withoutRuntimeControl(source.controller.currentProject!);
        expect(legacy.workflow.stage).toBe('validated');
        const migrated = environment(['legacy-approved']);
        migrated.adapter.values.set(STORY_STUDIO_STORAGE_KEY, legacy);
        const result = await migrated.controller.load();
        expect(result.status).toBe('loaded');
        expect(migrated.controller.currentProject?.workflow.stage).toBe('validated');
        expect(migrated.controller.currentProject?.state).toMatchObject({ currentChapter: 0, revision: 0 });
        expect(migrated.controller.currentProject?.memory.records).toEqual([]);
    });

    it.each(['planned', 'drafted'] as const)('preserves paused %s checkpoint exactly', async stage => {
        const source = environment(['source']);
        await source.controller.load();
        await source.controller.createProject(blueprint(`paused-${stage}`), `Paused ${stage}`);
        await source.controller.startBatch(2);
        await advanceToStage(source.controller, stage);
        await source.controller.pauseBatch();
        const legacy = withoutRuntimeControl(source.controller.currentProject!);
        const migrated = environment([`legacy-${stage}`]);
        migrated.adapter.values.set(STORY_STUDIO_STORAGE_KEY, legacy);
        await migrated.controller.load();
        expect(withoutRuntimeControl(migrated.controller.currentProject!)).toEqual(legacy);
        expect(migrated.controller.currentProject?.batchQueue.paused).toBe(true);
    });

    it('preserves canonical chapter metadata, narrative records, and all lineage identities', async () => {
        const project = await makeCanonicalProject(2);
        const legacy = withoutRuntimeControl(project);
        const migrated = environment(['legacy-history']);
        migrated.adapter.values.set(STORY_STUDIO_STORAGE_KEY, legacy);
        await migrated.controller.load();
        const current = migrated.controller.currentProject!;
        expect(current.state).toEqual(project.state);
        expect(current.memory).toEqual(project.memory);
        expect(current.chapterMetadata).toEqual(project.chapterMetadata);
        expect(current.storyControlIdentity).toBe(project.storyControlIdentity);
        expect(current.coreIdentity).toBe(project.coreIdentity);
        expect(current.workflowIdentity).toBe(project.workflowIdentity);
        expect(current.memory.records.map(record => record.recordIdentity))
            .toEqual(project.memory.records.map(record => record.recordIdentity));
    });

    it('keeps the legacy key when the first project-record write fails', async () => {
        const { adapter, controller } = environment(['legacy-first-write']);
        const legacy = withoutRuntimeControl(createStoryStudioProject(blueprint('failure-one'), 'Failure one', FIXED_TIME));
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, legacy);
        adapter.failNextSave = true;
        expect(await controller.load()).toMatchObject({ status: 'core-corrupt', error: { code: 'MIGRATION_FAILED' } });
        expect(adapter.values.get(STORY_STUDIO_STORAGE_KEY)).toEqual(legacy);
        expect(adapter.values.has(STORY_STUDIO_PROJECT_LIBRARY_KEY)).toBe(false);
    });

    it('keeps the legacy key when the index write fails and remains retryable', async () => {
        const { adapter, controller } = environment(['legacy-index', 'legacy-retry']);
        const legacy = withoutRuntimeControl(createStoryStudioProject(blueprint('failure-index'), 'Failure index', FIXED_TIME));
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, legacy);
        adapter.failSaveKeys.add(STORY_STUDIO_PROJECT_LIBRARY_KEY);
        expect(await controller.load()).toMatchObject({ status: 'core-corrupt', error: { code: 'MIGRATION_FAILED' } });
        expect(adapter.values.get(STORY_STUDIO_STORAGE_KEY)).toEqual(legacy);
        const retry = await new StoryStudioProjectController(
            new StoryStudioProjectRepository(adapter, () => FIXED_TIME, ids('legacy-retry')),
            () => FIXED_TIME,
        ).load();
        expect(retry.status).toBe('loaded');
        expect(retry.library?.index.entries).toHaveLength(1);
    });

    it('handles legacy cleanup failure deterministically without losing the completed migration', async () => {
        const { adapter, controller } = environment(['legacy-cleanup']);
        const legacy = withoutRuntimeControl(createStoryStudioProject(blueprint('cleanup'), 'Cleanup', FIXED_TIME));
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, legacy);
        adapter.failNextClear = true;
        expect(await controller.load()).toMatchObject({ status: 'core-corrupt', error: { code: 'LEGACY_CLEANUP_FAILED' } });
        expect(adapter.values.get(STORY_STUDIO_STORAGE_KEY)).toEqual(legacy);
        expect(adapter.values.has(STORY_STUDIO_PROJECT_LIBRARY_KEY)).toBe(true);
        const reload = new StoryStudioProjectController(new StoryStudioProjectRepository(adapter));
        const result = await reload.load();
        expect(result.status).toBe('loaded');
        expect(result.library?.index.entries).toHaveLength(1);
        expect(reload.currentProject?.coreIdentity).toBe(legacy.coreIdentity);
    });

    it('preserves corrupt legacy core and never creates an index over it', async () => {
        const { adapter, controller } = environment(['corrupt']);
        const corrupt = { ...withoutRuntimeControl(createStoryStudioProject(blueprint('corrupt'), 'Corrupt', FIXED_TIME)), coreIdentity: 'tampered' };
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, corrupt);
        expect(await controller.load()).toMatchObject({ status: 'core-corrupt', error: { code: 'CORE_IDENTITY_MISMATCH' } });
        expect(adapter.values.get(STORY_STUDIO_STORAGE_KEY)).toEqual(corrupt);
        expect(adapter.values.has(STORY_STUDIO_PROJECT_LIBRARY_KEY)).toBe(false);
    });

    it('is idempotent once the new library index exists', async () => {
        const { adapter, controller } = environment(['legacy-once', 'must-not-run']);
        const legacy = withoutRuntimeControl(createStoryStudioProject(blueprint('once'), 'Once', FIXED_TIME));
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, legacy);
        const first = await controller.load();
        const firstIndex = structuredClone(adapter.values.get(STORY_STUDIO_PROJECT_LIBRARY_KEY));
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, legacy);
        const second = await new StoryStudioProjectController(new StoryStudioProjectRepository(adapter)).load();
        expect(first.status).toBe('loaded');
        expect(second.status).toBe('loaded');
        expect(adapter.values.get(STORY_STUDIO_PROJECT_LIBRARY_KEY)).toEqual(firstIndex);
        expect(second.library?.index.entries).toHaveLength(1);
    });
});

describe('WORK15A multi-project durability and isolation', () => {
    it('creates A then B, keeps A, and makes B active', async () => {
        const { controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        const a = controller.activeProjectId;
        await controller.createProject(blueprint('b'), 'B');
        expect(controller.projectLibrary.map(entry => entry.displayName)).toEqual(['A', 'B']);
        expect(controller.activeProjectId).not.toBe(a);
        expect(controller.currentProject?.displayName).toBe('B');
    });

    it('switches B to A to B with distinct Canon, memory, and workflow checkpoints', async () => {
        const { controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        const a = controller.activeProjectId!;
        await controller.startBatch(1);
        await advanceToStage(controller, 'planned');
        await controller.createProject(blueprint('b'), 'B');
        const b = controller.activeProjectId!;
        await controller.startBatch(1);
        await advanceToStage(controller, 'ready-for-canon-review');
        await controller.makeCanonDurably(controller.createConfirmation());
        await controller.switchProject(a);
        expect(controller.currentProject).toMatchObject({ displayName: 'A', state: { currentChapter: 0 }, workflow: { stage: 'planned' } });
        expect(controller.currentProject?.memory.records).toEqual([]);
        await controller.switchProject(b);
        expect(controller.currentProject).toMatchObject({ displayName: 'B', state: { currentChapter: 1 }, workflow: { stage: 'idle' } });
        expect(controller.currentProject?.memory.records).toHaveLength(1);
    });

    it('restores the selected active project after an F5-style reload', async () => {
        const { repository, controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        const a = controller.activeProjectId!;
        await controller.createProject(blueprint('b'), 'B');
        await controller.switchProject(a);
        const reloaded = new StoryStudioProjectController(repository);
        expect((await reloaded.load()).status).toBe('loaded');
        expect(reloaded.activeProjectId).toBe(a);
        expect(reloaded.currentProject?.displayName).toBe('A');
    });

    it('renames display/catalog data without changing StoryControl, Canon, memory, or workflow identities', async () => {
        const { controller, repository } = environment();
        await controller.load();
        await controller.createProject(blueprint('rename'), 'Before');
        const before = controller.currentProject!;
        const beforeCanon = createProductionCanonIdentity(before.state);
        await controller.updateDisplayName('After');
        const after = controller.currentProject!;
        expect(after.displayName).toBe('Before');
        expect(controller.projectLibrary[0].displayName).toBe('After');
        expect(after.coreIdentity).toBe(before.coreIdentity);
        expect(after.storyControlIdentity).toBe(before.storyControlIdentity);
        expect(createProductionCanonIdentity(after.state)).toBe(beforeCanon);
        expect(after.memory).toEqual(before.memory);
        expect(after.workflowIdentity).toBe(before.workflowIdentity);
        await controller.startBatch(1);
        expect(controller.projectLibrary[0].displayName).toBe('After');
        const reloaded = new StoryStudioProjectController(repository);
        await reloaded.load();
        expect(reloaded.projectLibrary[0].displayName).toBe('After');
        expect(reloaded.currentProject?.coreIdentity).toBe(before.coreIdentity);
    });

    it('deletes a non-active project without touching the active project', async () => {
        const { controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        const a = controller.activeProjectId!;
        await controller.createProject(blueprint('b'), 'B');
        const activeBefore = controller.currentProject;
        await controller.deleteProject(a);
        expect(controller.currentProject).toEqual(activeBefore);
        expect(controller.projectLibrary.map(entry => entry.displayName)).toEqual(['B']);
    });

    it('deleting active chooses newest valid project, breaking updatedAt ties by project ID', async () => {
        const { controller } = environment(['project-c', 'project-b', 'project-a']);
        await controller.load();
        await controller.createProject(blueprint('c'), 'C');
        await controller.createProject(blueprint('b'), 'B');
        const expected = controller.activeProjectId;
        await controller.createProject(blueprint('a'), 'A');
        await controller.deleteProject();
        expect(controller.activeProjectId).toBe(expected);
        expect(controller.currentProject?.displayName).toBe('B');
    });

    it('deleting the last project leaves an empty library', async () => {
        const { controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('only'), 'Only');
        const result = await controller.deleteProject();
        expect(result.status).toBe('empty');
        expect(controller.currentProject).toBeUndefined();
        expect(controller.projectLibrary).toEqual([]);
    });

    it('blocks switching while a model stage is active', async () => {
        const { controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        const a = controller.activeProjectId!;
        await controller.createProject(blueprint('b'), 'B');
        await controller.startBatch(1);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const base = productionRuntime();
        const blocked = new Proxy(base, {
            get(target, property, receiver) {
                if (property === 'planProductionChapter') return async (...args: Parameters<typeof base.planProductionChapter>) => {
                    await gate;
                    return base.planProductionChapter(...args);
                };
                return Reflect.get(target, property, receiver);
            },
        });
        const running = controller.runNextStage(blocked);
        await Promise.resolve();
        await expect(controller.switchProject(a)).rejects.toMatchObject({ code: 'PROJECT_OPERATION_BLOCKED' });
        release();
        await running;
    });

    it('blocks create, switch, and delete while a durability transition is active', async () => {
        class DeferredCommitAdapter extends InMemoryStoryStudioStorageAdapter {
            defer = false;
            started: (() => void) | undefined;
            release: (() => void) | undefined;
            override async commit(writes: readonly { readonly key: string; readonly value: unknown }[], clears: readonly string[] = []) {
                if (this.defer) {
                    await new Promise<void>(resolve => {
                        this.release = resolve;
                        this.started?.();
                    });
                }
                return super.commit(writes, clears);
            }
        }
        const adapter = new DeferredCommitAdapter();
        const repository = new StoryStudioProjectRepository(adapter, () => FIXED_TIME, ids('project-a', 'project-b', 'project-c'));
        const controller = new StoryStudioProjectController(repository, () => FIXED_TIME);
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        const a = controller.activeProjectId!;
        await controller.createProject(blueprint('b'), 'B');
        adapter.defer = true;
        const started = new Promise<void>(resolve => { adapter.started = resolve; });
        const saving = controller.startBatch(1);
        await started;
        await expect(controller.switchProject(a)).rejects.toMatchObject({ code: 'PROJECT_OPERATION_BLOCKED' });
        await expect(controller.createProject(blueprint('c'), 'C')).rejects.toMatchObject({ code: 'PROJECT_OPERATION_BLOCKED' });
        await expect(controller.deleteProject()).rejects.toMatchObject({ code: 'PROJECT_OPERATION_BLOCKED' });
        adapter.release?.();
        await saving;
    });

    it('failed switch leaves the prior active project selected and usable', async () => {
        const { adapter, controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        const a = controller.activeProjectId!;
        await controller.createProject(blueprint('b'), 'B');
        const b = controller.activeProjectId!;
        adapter.values.set(storyStudioProjectStorageKey(a), { corrupt: true });
        await expect(controller.switchProject(a)).rejects.toMatchObject({ code: 'PROJECT_UNAVAILABLE' });
        expect(controller.activeProjectId).toBe(b);
        expect(controller.currentProject?.displayName).toBe('B');
        await controller.startBatch(1);
        expect(controller.currentProject?.batchQueue.remaining).toBe(1);
    });

    it('failed atomic save publishes neither new in-memory Canon nor new durable Canon', async () => {
        const { adapter, repository, controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('atomic'), 'Atomic');
        await controller.startBatch(1);
        await advanceToStage(controller, 'ready-for-canon-review');
        adapter.failNextCommit = true;
        await expect(controller.makeCanonDurably(controller.createConfirmation())).rejects.toMatchObject({ code: 'SAVE_FAILED' });
        expect(controller.currentProject?.state.currentChapter).toBe(0);
        const reloaded = new StoryStudioProjectController(repository);
        await reloaded.load();
        expect(reloaded.currentProject?.state.currentChapter).toBe(0);
        expect(reloaded.currentProject?.workflow.stage).toBe('ready-for-canon-review');
    });

    it('serializes concurrent saves so a later requested snapshot cannot be overtaken', async () => {
        const { repository, controller } = environment();
        await controller.load();
        const first = await controller.createProject(blueprint('ordered'), 'First');
        const projectId = controller.activeProjectId!;
        const second = rebuildRuntimeProject(first, { displayName: 'Second', updatedAt: '2026-09-04T00:00:01.000Z' });
        const third = rebuildRuntimeProject(first, { displayName: 'Third', updatedAt: '2026-09-04T00:00:02.000Z' });
        await Promise.all([repository.saveProject(projectId, second), repository.saveProject(projectId, third)]);
        const loaded = await repository.switchActiveProject(projectId);
        expect(loaded.project.displayName).toBe('Third');
    });

    it('marks one corrupt non-active project unavailable without destroying the valid active project', async () => {
        const { adapter, repository, controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        const a = controller.activeProjectId!;
        await controller.createProject(blueprint('b'), 'B');
        adapter.values.set(storyStudioProjectStorageKey(a), { corrupt: true });
        const reloaded = new StoryStudioProjectController(repository);
        const result = await reloaded.load();
        expect(result.status).toBe('loaded');
        expect(reloaded.currentProject?.displayName).toBe('B');
        expect(reloaded.projectLibrary.find(entry => entry.projectId === a)?.availability).toBe('corrupt');
    });

    it('fails closed for a missing active record and does not silently select another Canon', async () => {
        const { adapter, repository, controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        await controller.createProject(blueprint('b'), 'B');
        const active = controller.activeProjectId!;
        adapter.values.delete(storyStudioProjectStorageKey(active));
        const reloaded = new StoryStudioProjectController(repository);
        const result = await reloaded.load();
        expect(result).toMatchObject({ status: 'core-corrupt', error: { code: 'PROJECT_UNAVAILABLE' } });
        expect(reloaded.currentProject).toBeUndefined();
        expect(reloaded.activeProjectId).toBe(active);
    });

    it('keeps StoryState revision equal to chapter and prevents project A consuming project B memory/checkpoint', async () => {
        const { controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('a'), 'A');
        const a = controller.activeProjectId!;
        await controller.startBatch(1);
        await advanceToStage(controller, 'drafted');
        const aWorkflowIdentity = controller.currentProject?.workflowIdentity;
        await controller.createProject(blueprint('b'), 'B');
        await controller.startBatch(1);
        await advanceToStage(controller, 'ready-for-canon-review');
        await controller.makeCanonDurably(controller.createConfirmation());
        expect(controller.currentProject?.state.revision).toBe(controller.currentProject?.state.currentChapter);
        const bRecord = controller.currentProject?.memory.records[0].recordIdentity;
        await controller.switchProject(a);
        expect(controller.currentProject?.workflow.stage).toBe('drafted');
        expect(controller.currentProject?.workflowIdentity).toBe(aWorkflowIdentity);
        expect(controller.currentProject?.memory.records).toEqual([]);
        expect(JSON.stringify(controller.currentProject)).not.toContain(bRecord);
    });
});
