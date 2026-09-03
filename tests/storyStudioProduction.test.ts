import type { GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';
import {
    createProductionStoryRuntime,
    createV4ProjectSeed,
} from '../src/storyEngine';
import type { StoryBlueprintDocument } from '../src/storyEngine';
import { createGeminiStoryEngineAdapters } from '../src/services/storyEngine';
import type { GeminiStoryEngineGenerationRuntime } from '../src/services/storyEngine';
import { buildStoryStudioViewModel } from '../src/storyStudio/storyStudioPresenter';
import { StoryStudioProjectController } from '../src/storyStudio/production/storyStudioProjectController';
import type { StoryStudioBatchSize } from '../src/storyStudio/production/storyStudioWorkflowTypes';
import {
    InMemoryStoryStudioStorageAdapter,
    StoryStudioProjectRepository,
} from '../src/storyStudio/production/storyStudioProjectPersistence';
import { STORY_STUDIO_STORAGE_KEY } from '../src/storyStudio/production/storyStudioProjectTypes';
import {
    createStoryStudioProject,
    parseStoryStudioProjectDocument,
    rebuildRuntimeProject,
    withoutRuntimeControl,
} from '../src/storyStudio/production/storyStudioProjectRuntime';
import { buildConnectedStoryStudioSession, getCanonicalChapterHistoryEntry } from '../src/storyStudio/production/storyStudioSession';
import {
    auditAuthorSetupSource,
    prepareAuthorTextStorySetupImport,
    prepareJsonStorySetupImport,
} from '../src/storyStudio/production/storySetupImport';
import {
    buildStorySetupCompilerPrompt,
    compileStorySetupWithGemini,
} from '../src/services/storyEngine/geminiStorySetupCompiler';
import authorSetupFixture from './fixtures/storyStudioAuthorSetupFixture.txt?raw';

const RAW_SECRET = 'SENTINEL_STORY_STUDIO_SECRET_7EC4';

const document = (id = 'studio-production'): StoryBlueprintDocument => ({
    kind: 'story-blueprint-document', formatVersion: 1,
    blueprint: {
        id, engine: { plannedChapterCount: 3 },
        characters: [
            { id: 'hero', name: 'Hero', availableFromChapter: 1 },
            { id: 'guide', name: 'Guide', availableFromChapter: 3 },
        ],
        arcs: [
            { id: 'arc-1', title: 'First Arc', startChapter: 1, endChapter: 2 },
            { id: 'arc-2', title: 'Last Arc', startChapter: 3, endChapter: 3 },
        ],
        reveals: [{ id: 'truth', writerText: 'The route can now be named.' }],
        gates: {
            pov: [{ id: 'hero-pov', characterId: 'hero', allowedFromChapter: 1 }],
            reveals: [{ id: 'truth-gate', revealId: 'truth', allowedFromChapter: 3 }],
        },
        authorOnlySecrets: [{ id: 'truth-secret', value: RAW_SECRET, revealId: 'truth' }],
        canonRules: [{ id: 'world-rule', text: 'The archive records durable choices.', availableFromChapter: 1, scope: 'world' }],
    },
});

const chapterFrom = (contents: string): number => {
    const match = contents.match(/"targetChapter":(\d+)/) ?? contents.match(/"chapterNumber":(\d+)/) ?? contents.match(/chapter (\d+)/i);
    if (!match) throw new Error('missing chapter');
    return Number(match[1]);
};

const internalPlan = (chapter: number) => ({
    kind: 'internal-chapter-plan', chapterNumber: chapter, arcId: chapter <= 2 ? 'arc-1' : 'arc-2',
    primaryGoal: `Complete chapter ${chapter}.`, povCharacterId: 'hero', participantIds: ['hero'],
    scenes: [{
        id: `scene-${chapter}`, order: 1, goal: 'Choose a safe route.', location: 'Archive',
        povCharacterId: 'hero', participantIds: ['hero'], conflictOrObstacle: 'The door is sealed.',
        uncertainty: 'The key may fail.', expectedConsequence: `Chapter ${chapter} has a durable result.`,
        purposeTags: ['plot'], conflictImportance: 'minor',
    }],
    activeConstraintIds: ['world-rule'], allowedRevealIds: chapter >= 3 ? ['truth'] : [], plannedRevealIds: [],
    relationshipEventIds: [], storyEventIds: [], cluesPlantedIds: [], cluesPaidOffIds: [],
    expectedResourceDeltas: [], expectedRelationshipDeltas: [], expectedContinuityConsequences: [],
    strategicActions: [], relationshipActions: [], endStateIntent: 'The bounded choice is complete.',
});

const delta = (chapter: number) => ({
    kind: 'story-state-delta', schemaVersion: 2, chapterNumber: chapter, expectedRevision: chapter - 1,
    factChanges: [{
        id: `fact-${chapter}`, text: `Canonical result ${chapter}.`, establishedChapter: chapter,
        visibility: 'writer', status: 'active', provenance: { sourceChapter: chapter, sourceType: 'chapter' },
    }],
    epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [], relationshipChanges: [],
    resourceChanges: [], continuityChanges: [], revealChanges: [], foreshadowChanges: [], payoffChanges: [],
});

const runtime = (calls: string[] = [], reject = false) => {
    const generation: GeminiStoryEngineGenerationRuntime = {
        async run(request) {
            calls.push(request.role);
            const chapter = chapterFrom(request.contents);
            if (request.role === 'planner') return { value: internalPlan(chapter), selectedModelId: 'gemini-test' };
            if (request.role === 'writer') return { value: { kind: 'writer-chapter-draft', chapterNumber: chapter, title: `Chapter ${chapter}`, prose: `Hero completes the safe chapter ${chapter} choice.` }, selectedModelId: 'gemini-test' };
            if (request.role === 'semanticValidator') return {
                value: {
                    kind: 'semantic-validation-result', chapterNumber: chapter,
                    issues: reject ? [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }] : [],
                }, selectedModelId: 'gemini-test',
            };
            if (request.role === 'repair') return { value: { kind: 'writer-chapter-draft', chapterNumber: chapter, prose: `Repaired ${chapter}.` }, selectedModelId: 'gemini-test' };
            return { value: delta(chapter), selectedModelId: 'gemini-test' };
        },
    };
    return createProductionStoryRuntime({ models: createGeminiStoryEngineAdapters(generation), runtimePolicy: { maxRepairAttempts: reject ? 0 : 2 } });
};

const setup = () => {
    const adapter = new InMemoryStoryStudioStorageAdapter();
    const repository = new StoryStudioProjectRepository(adapter);
    let tick = 0;
    const controller = new StoryStudioProjectController(repository, () => `2026-09-03T00:00:${String(tick++).padStart(2, '0')}.000Z`);
    return { adapter, repository, controller };
};

const advanceToReview = async (controller: StoryStudioProjectController, productionRuntime = runtime()) => {
    while (controller.currentProject?.workflow.stage !== 'ready-for-canon-review'
        && controller.currentProject?.workflow.stage !== 'rejected') {
        await controller.runNextStage(productionRuntime);
    }
};

describe('WORK 13 Story Studio production persistence', () => {
    it('loads empty storage without writing a default project', async () => {
        const { adapter, controller } = setup();
        expect(await controller.load()).toEqual({ status: 'empty' });
        expect(adapter.values.size).toBe(0);
    });

    it('creates C0/rev0 with empty memory and reloads exact core', async () => {
        const { controller, repository } = setup();
        await controller.load();
        const created = await controller.createProject(document(), 'Studio Test');
        expect(created.state).toMatchObject({ currentChapter: 0, revision: 0 });
        expect(created.memory.records).toEqual([]);
        const reloaded = new StoryStudioProjectController(repository);
        const result = await reloaded.load();
        expect(result.status).toBe('loaded');
        if (result.status === 'loaded') expect(result.project.storyControlIdentity).toBe(created.storyControlIdentity);
    });

    it('strict root parser rejects unknown fields and does not overwrite corruption', async () => {
        const project = withoutRuntimeControl(createStoryStudioProject(document(), 'Strict'));
        expect(() => parseStoryStudioProjectDocument({ ...project, surprise: true })).toThrow();
        const { adapter, controller } = setup();
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, { ...project, coreIdentity: 'tampered' });
        expect((await controller.load()).status).toBe('core-corrupt');
        expect(adapter.values.get(STORY_STUDIO_STORAGE_KEY)?.coreIdentity).toBe('tampered');
    });

    it('rejects malformed setup, control identity, state, and memory ownership before publishing', () => {
        const persisted = withoutRuntimeControl(createStoryStudioProject(document(), 'Strict core'));
        expect(() => createStoryStudioProject({ kind: 'wrong' }, 'Bad setup')).toThrow();
        expect(() => parseStoryStudioProjectDocument({ ...persisted, storyControlIdentity: 'wrong-control' })).toThrow();
        expect(() => parseStoryStudioProjectDocument({ ...persisted, state: { ...persisted.state, currentChapter: -1 } })).toThrow();
        expect(() => parseStoryStudioProjectDocument({
            ...persisted,
            memory: { ...persisted.memory, storyControlId: 'another-story' },
        })).toThrow();
    });

    it('workflow identity tamper discards only workflow and preserves Canon core', async () => {
        const project = createStoryStudioProject(document(), 'Recover');
        const value = { ...withoutRuntimeControl(project), workflowIdentity: 'bad' };
        const parsed = parseStoryStudioProjectDocument(value);
        expect(parsed.workflowRecovered).toBe(true);
        expect(parsed.project.state).toEqual(project.state);
        expect(parsed.project.memory).toEqual(project.memory);
        expect(parsed.project.workflow.stage).toBe('idle');
        expect(parsed.project.batchQueue.paused).toBe(true);
    });

    it('requires explicit confirmation before replacing the active slot', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document('a'), 'A');
        await expect(controller.createProject(document('b'), 'B')).rejects.toMatchObject({ code: 'PROJECT_REPLACEMENT_CONFIRMATION_REQUIRED' });
        expect(controller.currentProject?.displayName).toBe('A');
        await controller.createProject(document('b'), 'B', true);
        expect(controller.currentProject?.displayName).toBe('B');
    });

    it('persists each production stage and resumes from planned without rerunning Planner', async () => {
        const { controller, repository } = setup();
        await controller.load();
        await controller.createProject(document(), 'Resume');
        await controller.startBatch(1);
        const calls: string[] = [];
        await controller.runNextStage(runtime(calls));
        expect(controller.currentProject?.workflow.stage).toBe('planned');
        const reloaded = new StoryStudioProjectController(repository);
        await reloaded.load();
        await reloaded.runNextStage(runtime(calls));
        expect(reloaded.currentProject?.workflow.stage).toBe('drafted');
        expect(calls).toEqual(['planner', 'writer']);
    });

    it('reloads drafted to Validator, validated to Extractor, extracted to same ready proposal', async () => {
        const { controller, repository } = setup();
        await controller.load();
        await controller.createProject(document(), 'Stages');
        await controller.startBatch(1);
        const productionRuntime = runtime();
        await controller.runNextStage(productionRuntime);
        await controller.runNextStage(productionRuntime);
        expect(controller.currentProject?.workflow.stage).toBe('drafted');
        const second = new StoryStudioProjectController(repository);
        await second.load();
        await second.runNextStage(productionRuntime);
        expect(second.currentProject?.workflow.stage).toBe('validated');
        const third = new StoryStudioProjectController(repository);
        await third.load();
        await third.runNextStage(productionRuntime);
        expect(third.currentProject?.workflow.stage).toBe('extracted');
        await third.runNextStage(productionRuntime);
        const identity = third.currentProject?.workflow.stage === 'ready-for-canon-review' ? third.currentProject.workflow.proposal.proposalIdentity : '';
        const fourth = new StoryStudioProjectController(repository);
        const loaded = await fourth.load();
        expect(loaded.status).toBe('loaded');
        expect(fourth.currentProject?.workflow.stage).toBe('ready-for-canon-review');
        if (fourth.currentProject?.workflow.stage === 'ready-for-canon-review') expect(fourth.currentProject.workflow.proposal.proposalIdentity).toBe(identity);
    });

    it('persists Validator rejection distinctly and supports rewrite from the exact plan', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Reject');
        await controller.startBatch(1);
        await controller.runNextStage(runtime([], true));
        await controller.runNextStage(runtime([], true));
        await controller.runNextStage(runtime([], true));
        expect(controller.currentProject?.workflow.stage).toBe('rejected');
        const planIdentity = controller.currentProject?.workflow.stage === 'rejected' ? controller.currentProject.workflow.plan.artifactIdentity : '';
        await controller.rewriteFromSamePlan();
        expect(controller.currentProject?.workflow.stage).toBe('planned');
        if (controller.currentProject?.workflow.stage === 'planned') expect(controller.currentProject.workflow.plan.artifactIdentity).toBe(planIdentity);
    });

    it('Make Canon saves state, memory, metadata, and workflow in one snapshot', async () => {
        const { controller, repository } = setup();
        await controller.load();
        await controller.createProject(document(), 'Commit');
        await controller.startBatch(1);
        await advanceToReview(controller);
        const result = await controller.makeCanonDurably(controller.createConfirmation());
        expect(result.project.state).toMatchObject({ currentChapter: 1, revision: 1 });
        expect(result.project.memory.records).toHaveLength(1);
        expect(result.project.chapterMetadata).toHaveLength(1);
        expect(result.project.workflow).toEqual({ stage: 'idle' });
        const reloaded = new StoryStudioProjectController(repository);
        expect((await reloaded.load()).status).toBe('loaded');
        expect(reloaded.currentProject?.state.currentChapter).toBe(1);
    });

    it('rejects missing C1 memory, mismatched memory head, and metadata tampering on reload', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Tamper');
        await controller.startBatch(1);
        await advanceToReview(controller);
        await controller.makeCanonDurably(controller.createConfirmation());
        const persisted = withoutRuntimeControl(controller.currentProject!);
        expect(() => parseStoryStudioProjectDocument({
            ...persisted,
            memory: { ...persisted.memory, records: [] },
        })).toThrow();
        const record = persisted.memory.records[0];
        expect(() => parseStoryStudioProjectDocument({
            ...persisted,
            memory: { ...persisted.memory, records: [{ ...record, afterCanonIdentity: 'wrong-head' }] },
        })).toThrow();
        expect(() => parseStoryStudioProjectDocument({
            ...persisted,
            chapterMetadata: [{ ...persisted.chapterMetadata[0], metadataIdentity: 'wrong-metadata' }],
        })).toThrow();
    });

    it('save failure during Make Canon leaves visible/durable C0 ready proposal and retry commits once', async () => {
        const { adapter, controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Atomic');
        await controller.startBatch(1);
        await advanceToReview(controller);
        const confirmation = controller.createConfirmation();
        adapter.failNextSave = true;
        await expect(controller.makeCanonDurably(confirmation)).rejects.toMatchObject({ code: 'SAVE_FAILED' });
        expect(controller.currentProject?.state.currentChapter).toBe(0);
        expect(controller.currentProject?.memory.records).toHaveLength(0);
        expect(controller.currentProject?.workflow.stage).toBe('ready-for-canon-review');
        await controller.makeCanonDurably(confirmation);
        expect(controller.currentProject?.state.currentChapter).toBe(1);
        expect(controller.currentProject?.memory.records).toHaveLength(1);
    });

    it('blocks a second Make Canon with the stale confirmation after the durable commit', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Double commit');
        await controller.startBatch(1);
        await advanceToReview(controller);
        const confirmation = controller.createConfirmation();
        await controller.makeCanonDurably(confirmation);
        await expect(controller.makeCanonDurably(confirmation)).rejects.toMatchObject({ code: 'WORKFLOW_INVALID' });
        expect(controller.currentProject?.state.currentChapter).toBe(1);
        expect(controller.currentProject?.memory.records).toHaveLength(1);
    });

    it('batch 2 cannot plan C2 before durable C1 Make Canon and resumes with exact new Canon', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Batch');
        await controller.startBatch(2);
        await advanceToReview(controller);
        expect(controller.currentProject?.state.currentChapter).toBe(0);
        expect(controller.currentProject?.batchQueue.remaining).toBe(2);
        const commit = await controller.makeCanonDurably(controller.createConfirmation());
        expect(commit.shouldContinueBatch).toBe(true);
        expect(commit.project.state.currentChapter).toBe(1);
        expect(commit.project.batchQueue.remaining).toBe(1);
        await controller.runNextStage(runtime());
        expect(controller.currentProject?.workflow.stage).toBe('planned');
        if (controller.currentProject?.workflow.stage === 'planned') expect(controller.currentProject.workflow.plan.baseChapter).toBe(1);
    });

    it.each([1, 2, 3] as const)('accepts the closed batch size %i and rejects values above the hard maximum', async (size) => {
        const { controller } = setup();
        await controller.load();
        const project = await controller.createProject(document(), `Batch ${size}`);
        expect(project.batchQueue.requestedSize).toBe(2);
        await controller.startBatch(size);
        expect(controller.currentProject?.batchQueue).toMatchObject({ requestedSize: size, remaining: size });
        if (size === 1) {
            const second = setup().controller;
            await second.load();
            await second.createProject(document(), 'Invalid batch');
            await expect(second.startBatch(4 as StoryStudioBatchSize)).rejects.toMatchObject({ code: 'INVALID_PROJECT' });
        }
    });

    it('runs the deterministic offline fixture from import through durable C1 and C2 reload', async () => {
        const prepared = await prepareAuthorTextStorySetupImport(authorSetupFixture, 'storyStudioAuthorSetupFixture.txt', {
            compiler: async () => ({ value: document('offline-e2e'), selectedModelId: 'gemini-test' }),
        });
        expect(prepared.review.criticalIssues).toEqual([]);

        const { controller, repository } = setup();
        await controller.load();
        await controller.createProject(prepared.setupDocument, prepared.review.displayName);

        const afterImportReload = new StoryStudioProjectController(repository);
        expect((await afterImportReload.load()).status).toBe('loaded');
        expect(afterImportReload.currentProject?.state).toMatchObject({ currentChapter: 0, revision: 0 });
        await afterImportReload.startBatch(2);

        const productionRuntime = runtime();
        await advanceToReview(afterImportReload, productionRuntime);
        const first = await afterImportReload.makeCanonDurably(afterImportReload.createConfirmation());
        expect(first.project.state).toMatchObject({ currentChapter: 1, revision: 1 });
        expect(first.shouldContinueBatch).toBe(true);

        await advanceToReview(afterImportReload, productionRuntime);
        const second = await afterImportReload.makeCanonDurably(afterImportReload.createConfirmation());
        expect(second.project.state).toMatchObject({ currentChapter: 2, revision: 2 });
        expect(second.project.batchQueue).toMatchObject({ remaining: 0, paused: false });
        expect(second.shouldContinueBatch).toBe(false);

        const finalReload = new StoryStudioProjectController(repository);
        expect((await finalReload.load()).status).toBe('loaded');
        expect(finalReload.currentProject?.state).toMatchObject({ currentChapter: 2, revision: 2 });
        expect(finalReload.currentProject?.memory.records.map(record => record.chapterNumber)).toEqual([1, 2]);
        expect(finalReload.currentProject?.chapterMetadata.map(metadata => metadata.chapterNumber)).toEqual([1, 2]);
        expect(finalReload.currentProject!.state.currentChapter + 1).toBe(3);
    });

    it('Stop/pause keeps Canon and memory intact', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Pause');
        await controller.startBatch(3);
        await controller.runNextStage(runtime());
        const before = controller.currentProject;
        await controller.pauseBatch();
        expect(controller.currentProject?.state).toEqual(before?.state);
        expect(controller.currentProject?.memory).toEqual(before?.memory);
        expect(controller.currentProject?.batchQueue).toMatchObject({ remaining: 3, paused: true });
    });

    it('replan clears only the resumable workflow and preserves Canon, memory, and batch queue', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Replan');
        await controller.startBatch(2);
        await controller.runNextStage(runtime());
        const before = controller.currentProject!;
        await controller.replanCurrentChapter();
        expect(controller.currentProject?.workflow).toEqual({ stage: 'idle' });
        expect(controller.currentProject?.state).toEqual(before.state);
        expect(controller.currentProject?.memory).toEqual(before.memory);
        expect(controller.currentProject?.batchQueue).toEqual(before.batchQueue);
    });

    it('keeps the validated checkpoint and C0 when extraction fails before save', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Blocked extraction');
        await controller.startBatch(1);
        const productionRuntime = runtime();
        await controller.runNextStage(productionRuntime);
        await controller.runNextStage(productionRuntime);
        await controller.runNextStage(productionRuntime);
        expect(controller.currentProject?.workflow.stage).toBe('validated');
        const blockedRuntime = new Proxy(productionRuntime, {
            get(target, property, receiver) {
                if (property === 'extractProductionChapter') return async () => { throw new Error('blocked'); };
                return Reflect.get(target, property, receiver);
            },
        });
        await expect(controller.runNextStage(blockedRuntime)).rejects.toThrow('blocked');
        expect(controller.currentProject?.workflow.stage).toBe('validated');
        expect(controller.currentProject?.state).toMatchObject({ currentChapter: 0, revision: 0 });
        expect(controller.currentProject?.memory.records).toEqual([]);
    });

    it('canonical history uses memory raw prose only after commit', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'History');
        await controller.startBatch(1);
        await advanceToReview(controller);
        expect(getCanonicalChapterHistoryEntry(controller.currentProject!, 1)).toBeUndefined();
        await controller.makeCanonDurably(controller.createConfirmation());
        expect(getCanonicalChapterHistoryEntry(controller.currentProject!, 1)).toEqual({ chapterNumber: 1, title: 'Chapter 1', text: 'Hero completes the safe chapter 1 choice.' });
    });

    it('connected presenter, import review, and Canon review do not expose raw Author Secret', async () => {
        const { controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Secret Safe');
        await controller.startBatch(1);
        await advanceToReview(controller);
        const view = buildStoryStudioViewModel(buildConnectedStoryStudioSession(controller.currentProject!));
        expect(JSON.stringify(view)).not.toContain(RAW_SECRET);
        if (controller.currentProject?.workflow.stage === 'ready-for-canon-review') {
            expect(JSON.stringify(controller.currentProject.workflow.proposal.review)).not.toContain(RAW_SECRET);
        }
    });

    it('valid V4 JSON import is offline and preserves only safe review summary', () => {
        const prepared = prepareJsonStorySetupImport(JSON.stringify(document()), 'Novel.json');
        expect(prepared.mode).toBe('json');
        expect(prepared.review.displayName).toBe('Novel');
        expect(JSON.stringify(prepared.review)).not.toContain(RAW_SECRET);
    });

    it('malformed replacement import leaves the exact active project untouched', async () => {
        const { controller } = setup();
        await controller.load();
        const active = await controller.createProject(document('active'), 'Active project');
        expect(() => prepareJsonStorySetupImport('{"kind":"not-v4"}', 'broken.json')).toThrow();
        expect(controller.currentProject).toEqual(active);
    });

    it('TXT compiler output is parsed strictly and raw source is not retained', async () => {
        const source = '# Synthetic Story\n[STORY_ENGINE_SETTINGS] {"plannedChapterCount":3,"safeMaxBatchSize":3}\nARC A (1-2)\nARC B (3-3)\nAUTHOR SECRET: hidden\nSPOILER CHAPTER 3';
        const prepared = await prepareAuthorTextStorySetupImport(source, 'setup.md', {
            compiler: async () => ({ value: document(), selectedModelId: 'gemini-test' }),
        });
        expect(prepared.review.criticalIssues).toEqual([]);
        expect(prepared.review.authorSecretCount).toBe(1);
        expect(JSON.stringify(prepared)).not.toContain('AUTHOR SECRET: hidden');
        expect(JSON.stringify(prepared.review)).not.toContain(RAW_SECRET);
    });

    it('coverage audit blocks planned chapter, arc range, and Author Secret loss', async () => {
        const source = '[STORY_ENGINE_SETTINGS] {"plannedChapterCount":8}\nARC ONE (1-4)\nARC TWO (5-8)\nAUTHOR SECRET\nAUTHOR_SECRET';
        const prepared = await prepareAuthorTextStorySetupImport(source, 'setup.txt', {
            compiler: async () => ({ value: document(), selectedModelId: 'gemini-test' }),
        });
        expect(prepared.review.criticalIssues.map(issue => issue.code)).toEqual([
            'PLANNED_CHAPTER_COUNT_MISMATCH', 'ARC_RANGE_MISSING', 'ARC_RANGE_MISSING', 'AUTHOR_SECRET_COUNT_UNDERRUN',
        ]);
        expect(auditAuthorSetupSource(source).plannedChapterCount).toBe(8);
    });

    it('setup compiler prompt marks the complete source as DATA', () => {
        const prompt = buildStorySetupCompilerPrompt('PRIVATE_SETUP_PAYLOAD');
        expect(prompt).toContain('BEGIN_AUTHOR_SETUP_DATA');
        expect(prompt).toContain('PRIVATE_SETUP_PAYLOAD');
        expect(prompt).toContain('END_AUTHOR_SETUP_DATA');
        expect(prompt).toContain('untrusted AUTHOR DATA');
        expect(prompt).not.toContain('DeepSeek');
    });

    it('Gemini setup compiler scopes client lookup inside smartExecution and preserves candidate order', async () => {
        const events: string[] = [];
        let generatedContents = '';
        const result = await compileStorySetupWithGemini({
            source: 'COMPLETE_PRIVATE_AUTHOR_SETUP',
            availableModelIds: ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash'],
        }, {
            smartExecution: async <T>(candidateModels: string[], operation: (modelId: string) => Promise<T>, _taskName?: string, _onLog?: undefined, preferredModelId?: string): Promise<T> => {
                events.push('smartExecution');
                expect(candidateModels).toEqual(['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash']);
                expect(preferredModelId).toBe('gemini-3.1-pro-preview');
                return operation(candidateModels[0]);
            },
            getAiClient: () => {
                events.push('getAiClient');
                return {
                    models: {
                        generateContent: async (request) => {
                            events.push('generateContent');
                            generatedContents = String(request.contents);
                            expect(request.model).toBe('gemini-3.1-pro-preview');
                            expect(request.config).toMatchObject({ temperature: 0.1, responseMimeType: 'application/json' });
                            return { text: JSON.stringify(document('compiled')) } as GenerateContentResponse;
                        },
                    },
                };
            },
        });
        expect(events).toEqual(['smartExecution', 'getAiClient', 'generateContent']);
        expect(generatedContents).toContain('COMPLETE_PRIVATE_AUTHOR_SETUP');
        expect(result.selectedModelId).toBe('gemini-3.1-pro-preview');
        expect(result.value).toEqual(document('compiled'));
    });

    it('Gemini setup compiler rejects malformed model JSON without trying to repair it', async () => {
        await expect(compileStorySetupWithGemini({
            source: 'AUTHOR SETUP',
            availableModelIds: ['gemini-3.7-flash'],
        }, {
            smartExecution: async <T>(candidateModels: string[], operation: (modelId: string) => Promise<T>): Promise<T> => operation(candidateModels[0]),
            getAiClient: () => ({
                models: {
                    generateContent: async () => ({ text: '```json\n{}\n```' }) as GenerateContentResponse,
                },
            }),
        })).rejects.toMatchObject({ code: 'MALFORMED_JSON' });
    });

    it('delete removes only the dedicated Story Studio key', async () => {
        const { adapter, controller } = setup();
        await controller.load();
        await controller.createProject(document(), 'Delete');
        const legacy = createStoryStudioProject(document('legacy-shape-only-for-test'), 'Legacy sentinel');
        adapter.values.set('current_session_v1', withoutRuntimeControl(legacy));
        await controller.deleteProject();
        expect(adapter.values.has(STORY_STUDIO_STORAGE_KEY)).toBe(false);
        expect(adapter.values.has('current_session_v1')).toBe(true);
    });

    it('surfaces a load failure without writing or clearing the occupied storage slot', async () => {
        const { adapter, controller } = setup();
        const existing = withoutRuntimeControl(createStoryStudioProject(document(), 'Existing'));
        adapter.values.set(STORY_STUDIO_STORAGE_KEY, existing);
        adapter.failNextLoad = true;
        expect(await controller.load()).toMatchObject({ status: 'core-corrupt', error: { code: 'LOAD_FAILED' } });
        expect(adapter.values.get(STORY_STUDIO_STORAGE_KEY)).toEqual(existing);
    });

    it('serialized repository writes ensure the later requested snapshot wins', async () => {
        const adapter = new InMemoryStoryStudioStorageAdapter();
        const repository = new StoryStudioProjectRepository(adapter);
        const first = createStoryStudioProject(document(), 'First');
        const second = rebuildRuntimeProject(first, { displayName: 'Second', updatedAt: '2026-09-03T01:00:00.000Z' });
        await Promise.all([repository.save(first), repository.save(second)]);
        expect(adapter.values.get(STORY_STUDIO_STORAGE_KEY)?.displayName).toBe('Second');
    });

    it('never persists FullStoryControl in the project document', () => {
        const project = createStoryStudioProject(document(), 'No Control');
        const persisted = withoutRuntimeControl(project);
        expect(Object.keys(persisted)).not.toContain('control');
        expect(parseStoryStudioProjectDocument(persisted).project.control.id).toBe(document().blueprint.id);
        expect(createV4ProjectSeed(persisted.setupDocument).storyControlIdentity).toBe(persisted.storyControlIdentity);
    });
});
