import { describe, expect, it } from 'vitest';
import {
    CanonicalChapterMemoryRecord,
    ProductionPlanArtifact,
    ProductionRuntimeError,
    StoryBlueprintDocument,
    StoryState,
    applyStoryStateDelta,
    buildNarrativeMemoryInput,
    createMakeCanonConfirmation,
    createProductionStoryRuntime,
    createV4ProjectSeed,
    makeCanon,
    recordCanonicalChapterMemory,
    selectNarrativeMemory,
} from '../src/storyEngine';
import {
    GeminiStoryEngineGenerationRuntime,
    createGeminiStoryEngineAdapters,
} from '../src/services/storyEngine';

const RAW_SECRET = 'RAW_RUNTIME_AUTHOR_SECRET_9F3A';

const document = (): StoryBlueprintDocument => ({
    kind: 'story-blueprint-document', formatVersion: 1,
    blueprint: {
        id: 'runtime-story', engine: { plannedChapterCount: 3 },
        characters: [{ id: 'hero', name: 'Hero', availableFromChapter: 1 }],
        arcs: [{ id: 'arc', title: 'Runtime Arc', startChapter: 1, endChapter: 3 }],
        reveals: [{ id: 'truth', writerText: 'The sealed route was deliberately redirected.' }],
        gates: {
            pov: [{ id: 'hero-pov', characterId: 'hero', allowedFromChapter: 1 }],
            reveals: [{ id: 'truth-gate', revealId: 'truth', allowedFromChapter: 1 }],
        },
        authorOnlySecrets: [{ id: 'secret', value: RAW_SECRET, revealId: 'truth' }],
    },
});

const chapterFrom = (contents: string): number => {
    const match = contents.match(/"targetChapter":(\d+)/)
        ?? contents.match(/"chapterNumber":(\d+)/)
        ?? contents.match(/chapter (\d+)/i);
    if (!match) throw new Error('test payload has no chapter');
    return Number(match[1]);
};

const internalPlan = (chapter: number, goal = 'Reach the archive.', plannedReveal = false, storyEvent = false) => ({
    kind: 'internal-chapter-plan', chapterNumber: chapter, arcId: 'arc', primaryGoal: goal,
    povCharacterId: 'hero', participantIds: ['hero'],
    scenes: [{
        id: `scene-${chapter}`, order: 1, goal: 'Make a bounded choice.', location: 'Archive',
        povCharacterId: 'hero', participantIds: ['hero'], conflictOrObstacle: 'The route is blocked.',
        uncertainty: 'The cost remains unclear.', expectedConsequence: 'A durable fact is established.',
        purposeTags: ['plot'], conflictImportance: 'minor',
    }],
    activeConstraintIds: [], allowedRevealIds: ['truth'], plannedRevealIds: plannedReveal ? ['truth'] : [],
    relationshipEventIds: [], storyEventIds: storyEvent ? ['event'] : [], cluesPlantedIds: [], cluesPaidOffIds: [],
    expectedResourceDeltas: [], expectedRelationshipDeltas: [], expectedContinuityConsequences: [],
    strategicActions: [], relationshipActions: [], endStateIntent: 'End after the choice becomes Canon-reviewable.',
});

const delta = (chapter: number, reveal = false) => ({
    kind: 'story-state-delta', schemaVersion: 2, chapterNumber: chapter, expectedRevision: chapter - 1,
    factChanges: [{
        id: `fact-${chapter}`, text: `Canonical chapter ${chapter} outcome.`, establishedChapter: chapter,
        visibility: 'writer', status: 'active', provenance: { sourceChapter: chapter, sourceType: 'chapter' },
    }],
    epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [], relationshipChanges: [],
    resourceChanges: [], continuityChanges: [],
    revealChanges: reveal ? [{
        operation: 'record', occurrence: {
            id: `reveal-occurrence-${chapter}`, revealId: 'truth', chapterNumber: chapter,
            provenance: { sourceChapter: chapter, sourceType: 'chapter' },
        },
    }] : [],
    foreshadowChanges: [], payoffChanges: [],
});

interface FakeRuntimeOptions {
    readonly goal?: string;
    readonly reveal?: boolean;
    readonly storyEvent?: boolean;
    readonly reject?: boolean;
    readonly repairOnce?: boolean;
    readonly malformedPlan?: boolean;
    readonly invalidExtractor?: boolean;
    readonly abortRole?: string;
    readonly failRole?: string;
}

const fakeRuntime = (
    captures: { role: string; contents: string }[],
    options: FakeRuntimeOptions = {},
): GeminiStoryEngineGenerationRuntime => {
    let validationPass = 0;
    return {
        async run(request) {
            captures.push({ role: request.role, contents: request.contents });
            if (request.role === options.abortRole) throw new Error('ABORTED');
            if (request.role === options.failRole) throw new Error('provider failed with unsafe details that must not escape');
            const chapter = chapterFrom(request.contents);
            if (request.role === 'planner') return { value: options.malformedPlan ? {} : internalPlan(chapter, options.goal, options.reveal && chapter === 1, options.storyEvent), selectedModelId: 'gemini-test' };
            if (request.role === 'writer') return { value: { kind: 'writer-chapter-draft', chapterNumber: chapter, title: `Chapter ${chapter}`, prose: `Hero completes the bounded chapter ${chapter} choice.` }, selectedModelId: 'gemini-test' };
            if (request.role === 'semanticValidator') {
                validationPass += 1;
                const issues = options.reject || (options.repairOnce && validationPass === 1)
                    ? [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }] : [];
                return { value: { kind: 'semantic-validation-result', chapterNumber: chapter, issues }, selectedModelId: 'gemini-test' };
            }
            if (request.role === 'repair') return { value: { kind: 'writer-chapter-draft', chapterNumber: chapter, title: `Chapter ${chapter}`, prose: `Hero completes the corrected bounded chapter ${chapter} choice.` }, selectedModelId: 'gemini-test' };
            return { value: options.invalidExtractor ? { ...delta(chapter), schemaVersion: 3 } : delta(chapter, options.reveal && chapter === 1), selectedModelId: 'gemini-test' };
        },
    };
};

const harness = (options: FakeRuntimeOptions = {}) => {
    const captures: { role: string; contents: string }[] = [];
    const models = createGeminiStoryEngineAdapters(fakeRuntime(captures, options));
    return { seed: createV4ProjectSeed(document()), captures, runtime: createProductionStoryRuntime({ models }) };
};

describe('WORK 12 production staged runtime', () => {
    it('runs the offline architectural C0 to ready-for-review golden path without mutating Canon', async () => {
        const { seed, runtime, captures } = harness();
        const before = structuredClone(seed.state);
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result.status).toBe('ready-for-canon-review');
        if (result.status !== 'ready-for-canon-review') return;
        expect(result.proposal).toMatchObject({ status: 'ready-for-review', baseChapter: 0, baseRevision: 0, targetChapter: 1 });
        expect(result.approved.result).toMatchObject({ status: 'approved-not-canon' });
        expect(seed.state).toEqual(before);
        expect(seed.state).toMatchObject({ currentChapter: 0, revision: 0 });
        expect(result.telemetry.modelCalls.map(value => [value.role, value.status, value.selectedModelId])).toEqual([
            ['planner', 'succeeded', 'gemini-test'], ['writer', 'succeeded', 'gemini-test'],
            ['semanticValidator', 'succeeded', 'gemini-test'], ['stateExtractor', 'succeeded', 'gemini-test'],
        ]);
        expect(captures.map(value => value.role)).toEqual(['planner', 'writer', 'semanticValidator', 'stateExtractor']);
    });

    it('creates deterministic plan and draft identities bound to the base cursor', async () => {
        const { seed, runtime } = harness();
        const plan = await runtime.planProductionChapter({ control: seed.control, state: seed.state, memoryState: seed.memory });
        const draft = await runtime.writeProductionChapter({ control: seed.control, state: seed.state, memoryState: seed.memory, plan });
        expect(plan.artifactIdentity).toMatch(/^production-plan-artifact-v1:sha256:/);
        expect(draft.artifactIdentity).toMatch(/^production-draft-artifact-v1:sha256:/);
        expect(draft.planArtifactIdentity).toBe(plan.artifactIdentity);
        expect(plan).toMatchObject({ baseChapter: 0, baseRevision: 0, targetChapter: 1, storyControlId: seed.control.id });
    });

    it('blocks plan tampering before Writer is called', async () => {
        const { seed, runtime, captures } = harness();
        const plan = await runtime.planProductionChapter({ control: seed.control, state: seed.state, memoryState: seed.memory });
        const tampered: ProductionPlanArtifact = { ...plan, writerPlan: { ...plan.writerPlan, primaryGoal: 'Tampered' } };
        await expect(runtime.writeProductionChapter({ control: seed.control, state: seed.state, memoryState: seed.memory, plan: tampered }))
            .rejects.toMatchObject({ code: 'STALE_STAGE_ARTIFACT' } satisfies Partial<ProductionRuntimeError>);
        expect(captures.filter(value => value.role === 'writer')).toHaveLength(0);
    });

    it('blocks privileged-view tampering before Writer is called', async () => {
        const { seed, runtime } = harness();
        const plan = await runtime.planProductionChapter({ control: seed.control, state: seed.state, memoryState: seed.memory });
        const tampered: ProductionPlanArtifact = {
            ...plan,
            privileged: { ...plan.privileged, strategicView: { ...plan.privileged.strategicView, chapterNumber: 2 } },
        };
        await expect(runtime.writeProductionChapter({ control: seed.control, state: seed.state, memoryState: seed.memory, plan: tampered }))
            .rejects.toMatchObject({ code: 'STALE_STAGE_ARTIFACT' });
    });

    it('blocks a draft from Plan A against Plan B before Validator is called', async () => {
        const first = harness({ goal: 'Plan A' });
        const planA = await first.runtime.planProductionChapter({ control: first.seed.control, state: first.seed.state, memoryState: first.seed.memory });
        const draftA = await first.runtime.writeProductionChapter({ control: first.seed.control, state: first.seed.state, memoryState: first.seed.memory, plan: planA });
        const second = harness({ goal: 'Plan B' });
        const planB = await second.runtime.planProductionChapter({ control: second.seed.control, state: second.seed.state, memoryState: second.seed.memory });
        await expect(second.runtime.validateProductionChapter({ control: second.seed.control, state: second.seed.state, memoryState: second.seed.memory, plan: planB, draft: draftA }))
            .rejects.toMatchObject({ code: 'STALE_STAGE_ARTIFACT' });
        expect(second.captures.filter(value => value.role === 'semanticValidator')).toHaveLength(0);
    });

    it('returns direct approval and preserves the canonicalization source identity', async () => {
        const { seed, runtime } = harness();
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result.status).toBe('ready-for-canon-review');
        if (result.status !== 'ready-for-canon-review') return;
        expect(result.approved.result.source.canonicalizationSourceIdentity).toBe(result.proposal.sourceIdentity);
        expect(result.extraction.result.sourceIdentity).toBe(result.proposal.sourceIdentity);
    });

    it('performs one finite Repair and then approves', async () => {
        const { seed, runtime, captures } = harness({ repairOnce: true });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result.status).toBe('ready-for-canon-review');
        if (result.status !== 'ready-for-canon-review') return;
        expect(result.approved.result.repairAttempts).toBe(1);
        expect(result.telemetry.repairAttemptCount).toBe(1);
        expect(captures.filter(value => value.role === 'repair')).toHaveLength(1);
    });

    it('returns a validation rejection as a product outcome, not a transport failure', async () => {
        const { seed, runtime } = harness({ reject: true });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result).toMatchObject({ status: 'rejected', stage: 'validation' });
    });

    it('fails stale plan artifacts against newer strict Canon', async () => {
        const { seed, runtime } = harness();
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        if (result.status !== 'ready-for-canon-review') throw new Error('expected ready result');
        const after = makeCanon({ control: seed.control, state: seed.state, approved: result.approved.result, proposal: result.proposal, confirmation: createMakeCanonConfirmation(result.proposal) });
        await expect(runtime.writeProductionChapter({ control: seed.control, state: after, memoryState: seed.memory, plan: result.plan }))
            .rejects.toMatchObject({ code: 'STALE_STAGE_ARTIFACT' });
    });

    it('fails safely after planned story completion', async () => {
        const { seed, runtime } = harness();
        let completed: StoryState = seed.state;
        for (let chapter = 1; chapter <= 3; chapter += 1) completed = applyStoryStateDelta(seed.control, completed, delta(chapter));
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: completed, memoryState: seed.memory });
        expect(result).toMatchObject({ status: 'blocked', stage: 'planning', code: 'STORY_COMPLETE' });
    });

    it('returns a stable planning failure without raw model output', async () => {
        const { seed, runtime } = harness({ malformedPlan: true });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result).toMatchObject({ status: 'blocked', stage: 'planning', code: 'PLAN_VALIDATION_FAILURE' });
        expect(JSON.stringify(result)).not.toContain(RAW_SECRET);
    });

    it('returns a typed extraction block for unsupported extractor output', async () => {
        const { seed, runtime } = harness({ invalidExtractor: true });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result).toMatchObject({ status: 'blocked', stage: 'extraction', code: 'EXTRACTION_BLOCKED', issueCodes: ['UNSUPPORTED_DELTA_VERSION'] });
        expect(seed.state).toMatchObject({ currentChapter: 0, revision: 0 });
    });

    it('preserves generic StoryEvent as an explicit V2 Canon-review block', async () => {
        const setup = document();
        const eventSetup: StoryBlueprintDocument = {
            ...setup,
            blueprint: {
                ...setup.blueprint,
                storyEvents: [{ id: 'event', eventType: 'coup', writerText: 'A coup may occur.' }],
                gates: { ...setup.blueprint.gates, events: [{ id: 'event-gate', eventId: 'event', allowedFromChapter: 1 }] },
            },
        };
        const seed = createV4ProjectSeed(eventSetup);
        const captures: { role: string; contents: string }[] = [];
        const runtime = createProductionStoryRuntime({ models: createGeminiStoryEngineAdapters(fakeRuntime(captures, { storyEvent: true })) });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result).toMatchObject({ status: 'blocked', stage: 'canon-review', code: 'CANON_REVIEW_BLOCKED', issueCodes: ['UNREPRESENTABLE_CANON_OPERATION'] });
        expect(seed.state).toMatchObject({ currentChapter: 0, revision: 0 });
    });

    it.each(['planner', 'writer', 'semanticValidator', 'stateExtractor'])('cancellation during %s never mutates Canon', async (abortRole) => {
        const { seed, runtime } = harness({ abortRole });
        const before = structuredClone(seed.state);
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result).toMatchObject({ status: 'blocked', code: 'CANCELLED' });
        expect(seed.state).toEqual(before);
        expect(seed.memory.records).toHaveLength(0);
    });

    it('cancellation during finite Repair never retains a half-approved artifact', async () => {
        const { seed, runtime } = harness({ repairOnce: true, abortRole: 'repair' });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result).toMatchObject({ status: 'blocked', stage: 'validation', code: 'CANCELLED' });
        expect(seed.state).toMatchObject({ currentChapter: 0, revision: 0 });
    });

    it('distinguishes Validator infrastructure failure from chapter rejection', async () => {
        const { seed, runtime } = harness({ failRole: 'semanticValidator' });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result).toMatchObject({ status: 'blocked', stage: 'validation', code: 'VALIDATOR_INFRASTRUCTURE_FAILURE' });
        expect(JSON.stringify(result)).not.toContain('unsafe details');
    });

    it('keeps raw secret material out of every role except privileged Semantic Validator', async () => {
        const { seed, runtime, captures } = harness({ repairOnce: true });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result.status).toBe('ready-for-canon-review');
        for (const capture of captures) {
            if (capture.role === 'semanticValidator') expect(capture.contents).toContain(RAW_SECRET);
            else expect(capture.contents).not.toContain(RAW_SECRET);
        }
        expect(JSON.stringify(result)).not.toContain(RAW_SECRET);
    });

    it('does not make an authorized reveal Canon before explicit confirmation and Make Canon', async () => {
        const { seed, runtime } = harness({ reveal: true });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        expect(result.status).toBe('ready-for-canon-review');
        if (result.status !== 'ready-for-canon-review') return;
        expect(seed.state.ledgers.revealOccurrences).toHaveLength(0);
        const after = makeCanon({ control: seed.control, state: seed.state, approved: result.approved.result, proposal: result.proposal, confirmation: createMakeCanonConfirmation(result.proposal) });
        expect(after.ledgers.revealOccurrences.map(value => value.revealId)).toEqual(['truth']);
    });
});

describe('WORK 12 post-Canon narrative memory', () => {
    it('records only an exactly committed proposal and feeds C1 memory to the C2 Planner', async () => {
        const { seed, runtime } = harness();
        const first = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        if (first.status !== 'ready-for-canon-review') throw new Error('expected ready result');
        const after = makeCanon({ control: seed.control, state: seed.state, approved: first.approved.result, proposal: first.proposal, confirmation: createMakeCanonConfirmation(first.proposal) });
        const memory = recordCanonicalChapterMemory({ control: seed.control, beforeState: seed.state, afterState: after, approved: first.approved.result, proposal: first.proposal, memoryState: seed.memory });
        expect(memory.records[0]).toMatchObject({ chapterNumber: 1, raw: { chapterNumber: 1 }, structured: { chapterNumber: 1 }, longTerm: { establishedChapter: 1, relevance: 3 } });
        const captures: { role: string; contents: string }[] = [];
        const nextRuntime = createProductionStoryRuntime({ models: createGeminiStoryEngineAdapters(fakeRuntime(captures)) });
        await nextRuntime.planProductionChapter({ control: seed.control, state: after, memoryState: memory });
        const plannerPayload = captures.find(value => value.role === 'planner')!.contents;
        expect(plannerPayload).toContain('Hero completes the bounded chapter 1 choice.');
        expect(plannerPayload).toContain('Canonical chapter 1 outcome.');
    });

    it('is idempotent for the exact same canonical chapter', async () => {
        const { seed, runtime } = harness();
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        if (result.status !== 'ready-for-canon-review') throw new Error('expected ready result');
        const after = makeCanon({ control: seed.control, state: seed.state, approved: result.approved.result, proposal: result.proposal, confirmation: createMakeCanonConfirmation(result.proposal) });
        const memory = recordCanonicalChapterMemory({ control: seed.control, beforeState: seed.state, afterState: after, approved: result.approved.result, proposal: result.proposal, memoryState: seed.memory });
        const repeated = recordCanonicalChapterMemory({ control: seed.control, beforeState: seed.state, afterState: after, approved: result.approved.result, proposal: result.proposal, memoryState: memory });
        expect(repeated).toBe(memory);
        expect(repeated.records).toHaveLength(1);
    });

    it('fails closed for an uncommitted or mismatched after-state', async () => {
        const { seed, runtime } = harness();
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        if (result.status !== 'ready-for-canon-review') throw new Error('expected ready result');
        expect(() => recordCanonicalChapterMemory({ control: seed.control, beforeState: seed.state, afterState: seed.state, approved: result.approved.result, proposal: result.proposal, memoryState: seed.memory }))
            .toThrow(/committed|transition|cursor/i);
    });

    it('fails closed for a tampered proposal identity', async () => {
        const { seed, runtime } = harness();
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        if (result.status !== 'ready-for-canon-review') throw new Error('expected ready result');
        const after = makeCanon({ control: seed.control, state: seed.state, approved: result.approved.result, proposal: result.proposal, confirmation: createMakeCanonConfirmation(result.proposal) });
        expect(() => recordCanonicalChapterMemory({
            control: seed.control, beforeState: seed.state, afterState: after, approved: result.approved.result,
            proposal: { ...result.proposal, proposalIdentity: 'tampered' }, memoryState: seed.memory,
        })).toThrow(/proposal identity/i);
    });

    it('fails closed instead of overwriting a conflicting record for the same chapter', async () => {
        const { seed, runtime } = harness();
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        if (result.status !== 'ready-for-canon-review') throw new Error('expected ready result');
        const after = makeCanon({ control: seed.control, state: seed.state, approved: result.approved.result, proposal: result.proposal, confirmation: createMakeCanonConfirmation(result.proposal) });
        const conflict: CanonicalChapterMemoryRecord = {
            kind: 'canonical-chapter-memory-record', chapterNumber: 1,
            canonicalizationSourceIdentity: 'different', proposalIdentity: 'different',
            raw: { chapterNumber: 1, text: 'Different.' }, structured: { chapterNumber: 1, summary: 'Different.' },
        };
        expect(() => recordCanonicalChapterMemory({ control: seed.control, beforeState: seed.state, afterState: after, approved: result.approved.result, proposal: result.proposal, memoryState: { kind: 'narrative-memory-state', records: [conflict] } }))
            .toThrow(/different canonical source/i);
    });

    it('projects all records and preserves existing bounded 4/12/8 selection', () => {
        const chapters = [...Array.from({ length: 16 }, (_, index) => index + 1), 99];
        const records: CanonicalChapterMemoryRecord[] = chapters.map(chapter => ({
            kind: 'canonical-chapter-memory-record', chapterNumber: chapter,
            canonicalizationSourceIdentity: `source-${chapter}`, proposalIdentity: `proposal-${chapter}`,
            raw: { chapterNumber: chapter, text: `Raw ${chapter}` },
            structured: { chapterNumber: chapter, summary: `Summary ${chapter}` },
            longTerm: { id: `long-${chapter}`, establishedChapter: chapter, summary: `Long ${chapter}`, relevance: chapter },
        }));
        const input = buildNarrativeMemoryInput({ kind: 'narrative-memory-state', records });
        const selected = selectNarrativeMemory(input, 16);
        expect(selected.recentRawChapters).toHaveLength(4);
        expect(selected.structuredRecentSummaries).toHaveLength(12);
        expect(selected.selectedLongTermMemories).toHaveLength(8);
        expect(selected.recentRawChapters.map(value => value.chapterNumber)).toEqual([12, 13, 14, 15]);
        expect(JSON.stringify(selected)).not.toContain('Raw 16');
        expect(JSON.stringify(selected)).not.toContain('Raw 99');
    });

    it('never derives raw Author Secret Vault text into memory', async () => {
        const { seed, runtime } = harness({ reveal: true });
        const result = await runtime.runChapterToCanonReview({ control: seed.control, state: seed.state, memoryState: seed.memory });
        if (result.status !== 'ready-for-canon-review') throw new Error('expected ready result');
        const after = makeCanon({ control: seed.control, state: seed.state, approved: result.approved.result, proposal: result.proposal, confirmation: createMakeCanonConfirmation(result.proposal) });
        const memory = recordCanonicalChapterMemory({ control: seed.control, beforeState: seed.state, afterState: after, approved: result.approved.result, proposal: result.proposal, memoryState: seed.memory });
        expect(JSON.stringify(memory)).not.toContain(RAW_SECRET);
        expect(memory.records[0].structured.summary).toContain('The sealed route was deliberately redirected.');
    });
});
