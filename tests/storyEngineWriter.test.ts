import { describe, expect, it } from 'vitest';
import {
    buildWriterContext,
    buildWriterPrompt,
    compileStoryControl,
    createInitialStoryState,
    generateWriterDraft,
    parseWriterChapterDraft,
    StoryBlueprint,
    WriterChapterPlan,
    WriterDraftValidationError,
} from '../src/storyEngine';

const blueprint = (): StoryBlueprint => ({
    id: 'writer-test-story', engine: { plannedChapterCount: 600 },
    characters: [
        { id: 'a', name: 'A', availableFromChapter: 1, writerProfile: { role: 'traveler' }, authorNotes: 'author character dossier' },
        { id: 'future', name: 'Future Character', availableFromChapter: 301, writerProfile: { role: 'future' }, authorNotes: 'future character truth' },
    ],
    arcs: [
        { id: 'current', title: 'Current Arc', startChapter: 1, endChapter: 300, writerBrief: 'Solve now.', authorPlan: 'future mastermind plan' },
        { id: 'future-arc', title: 'Future Arc', startChapter: 301, endChapter: 600, writerBrief: 'Do not leak.', authorPlan: 'future arc truth' },
    ],
    beats: [
        { id: 'current-beat', arcId: 'current', order: 1, startChapter: 1, endChapter: 300, writerBrief: 'Current beat.', authorPlan: 'future beat truth' },
        { id: 'future-beat', arcId: 'future-arc', order: 1, startChapter: 301, endChapter: 600, writerBrief: 'Future beat.', authorPlan: 'future beat truth' },
    ],
    reveals: [{ id: 'mastermind-reveal', writerText: 'The mastermind is Character Omega.', authorNotes: 'secret notes' }],
    gates: {
        characters: [{ id: 'a-character', characterId: 'a', allowedFromChapter: 1 }, { id: 'future-character', characterId: 'future', allowedFromChapter: 301 }],
        pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }, { id: 'future-pov', characterId: 'future', allowedFromChapter: 301 }],
        reveals: [{ id: 'mastermind-gate', revealId: 'mastermind-reveal', allowedFromChapter: 561 }], relationships: [], events: [],
    },
    authorOnlySecrets: [{ id: 'mastermind-secret', value: 'RAW SECRET: Omega backup identity.', revealId: 'mastermind-reveal', notes: 'author secret notes' }],
    canonRules: [{ id: 'travel-rule', text: 'Travel needs a gate token.', availableFromChapter: 1, scope: 'world', authorNotes: 'hidden origin' }],
});

const control = compileStoryControl(blueprint());
const planFor = (chapter: number, reveal = false): WriterChapterPlan => ({
    kind: 'writer-chapter-plan', chapterNumber: chapter,
    arc: { id: chapter <= 300 ? 'current' : 'future-arc', title: chapter <= 300 ? 'Current Arc' : 'Future Arc' },
    beat: { id: chapter <= 300 ? 'current-beat' : 'future-beat', order: 1 },
    primaryGoal: 'Reach the gate.', povCharacterId: 'a', participantIds: ['a'],
    scenes: [{ id: `scene-${chapter}`, order: 1, goal: 'Cross the gate.', location: 'Gate district', povCharacterId: 'a', participantIds: ['a'], conflictOrObstacle: 'The gate is shut.', uncertainty: 'The key may fail.', expectedConsequence: 'The route changes.', purposeTags: ['plot'], conflictImportance: 'minor' }],
    canonConstraints: [{ id: 'travel-rule', text: 'Travel needs a gate token.', scope: 'world' }],
    reveals: reveal ? [{ id: 'mastermind-reveal', text: 'The mastermind is Character Omega.' }] : [],
    relationshipEvents: [], storyEvents: [], cluesPlantedIds: [], cluesPaidOffIds: [], expectedResourceDeltas: [], expectedRelationshipDeltas: [], expectedContinuityConsequences: [], endStateIntent: 'End with uncertainty.',
});

const stateFor = (chapter: number) => ({
    ...createInitialStoryState(chapter), knownCharacterIds: ['a', 'future'], activeCharacterIds: ['a', 'future'],
    facts: [{ id: 'writer-fact', text: 'A has a gate token.', establishedChapter: 1, visibility: 'writer' as const }, { id: 'internal-fact', text: 'INTERNAL FACT NEVER FOR WRITER.', establishedChapter: 1, visibility: 'internal' as const }],
    extensions: { internalDossier: 'RAW SECRET: Omega backup identity.', authorPlan: 'never expose' },
    continuity: { pendingThreads: [], notes: [{ text: 'author-only continuity', visibility: 'internal' as const, establishedChapter: 1 }] },
});

describe('Story Engine V4 Writer privilege boundary', () => {
    it('keeps chapter 560 context free of secrets, planner facts, futures, and controlled reveal text', () => {
        const context = buildWriterContext(control, stateFor(560), planFor(560));
        const serialized = JSON.stringify(context);
        expect(context.controlledReveals).toEqual([]);
        ['RAW SECRET', 'Omega backup', 'mastermind-secret', 'The mastermind is Character Omega.', 'authorOnlySecrets', 'authorOnlySecretReferences', 'authorNotes', 'authorPlan', 'internal-fact', 'INTERNAL FACT', 'extensions'].forEach(value => expect(serialized).not.toContain(value));
    });

    it('allows only controlled reveal text at chapter 561, never the raw author secret', () => {
        const context = buildWriterContext(control, stateFor(561), planFor(561, true));
        const serialized = JSON.stringify(context);
        expect(context.controlledReveals).toEqual([{ id: 'mastermind-reveal', text: 'The mastermind is Character Omega.' }]);
        expect(serialized).not.toContain('RAW SECRET');
        expect(serialized).not.toContain('Omega backup');
    });

    it('uses target-safe bounded memory and supports a zero-memory policy without mutating caller input', () => {
        const memory = {
            recentRawChapters: [{ chapterNumber: 99, text: 'chapter 99' }, { chapterNumber: 100, text: 'target chapter' }, { chapterNumber: 580, text: 'future chapter' }],
            structuredRecentSummaries: [{ chapterNumber: 99, summary: 'summary 99' }], selectedLongTermMemories: [{ id: 'old', establishedChapter: 99, summary: 'old memory' }],
        };
        const original = JSON.stringify(memory);
        const context = buildWriterContext(control, stateFor(100), planFor(100), memory);
        expect(context.narrativeMemory.recentRawChapters).toEqual([{ chapterNumber: 99, text: 'chapter 99' }]);
        expect(JSON.stringify(memory)).toBe(original);
        expect(Object.isFrozen(memory)).toBe(false);
        const empty = buildWriterContext(control, stateFor(100), planFor(100), memory, { recentRawChapters: 0, structuredSummaryWindow: 0, selectedLongTermMemories: 0 });
        expect(empty.narrativeMemory).toEqual({ recentRawChapters: [], structuredRecentSummaries: [], selectedLongTermMemories: [] });
        expect(JSON.stringify(context)).not.toContain('Future Character');
    });

    it('builds a prompt only from WriterContext and preserves the planner intelligent-conflict boundary', () => {
        const plan = planFor(100);
        Object.assign(plan.scenes[0], { intelligentConflict: { opponentKnowledge: ['secret'], rationalCountermove: 'private reasoning' } });
        const prompt = buildWriterPrompt(buildWriterContext(control, stateFor(100), plan));
        expect(prompt).toContain('Execute the supplied chapter plan only.');
        ['intelligentConflict', 'private reasoning', 'INTERNAL FACT', 'RAW SECRET', 'future-arc', 'authorOnlySecretReferences'].forEach(value => expect(prompt).not.toContain(value));
    });
});

describe('Writer draft parsing and orchestration', () => {
    it('parses one valid draft and reconstructs it without retaining model extras', () => {
        const parsed = parseWriterChapterDraft({ kind: 'writer-chapter-draft', chapterNumber: 100, title: ' Gate ', prose: 'A crosses the gate.', secret: 'RAW SECRET' }, 100);
        expect(parsed).toEqual({ kind: 'writer-chapter-draft', validationStatus: 'unvalidated', chapterNumber: 100, title: 'Gate', prose: 'A crosses the gate.' });
        expect(JSON.stringify(parsed)).not.toContain('RAW SECRET');
    });

    it.each([
        [{ kind: 'writer-chapter-draft', chapterNumber: 101, prose: 'prose' }, 'CHAPTER_MISMATCH'],
        [{ kind: 'writer-chapter-draft', chapterNumber: 100, prose: '' }, 'INVALID_PROSE'],
        [{ kind: 'writer-chapter-draft', chapterNumber: 100, prose: '   ' }, 'INVALID_PROSE'],
        [{ kind: 'wrong-kind', chapterNumber: 100, prose: 'prose' }, 'INVALID_KIND'],
        [{ kind: 'writer-chapter-draft', chapterNumber: 100, prose: '<CHAPTER>prose</CHAPTER>' }, 'CONTROL_PROTOCOL_LEAKAGE'],
        [{ kind: 'writer-chapter-draft', chapterNumber: 100, prose: '<STORY_SUMMARY>metadata</STORY_SUMMARY>' }, 'CONTROL_PROTOCOL_LEAKAGE'],
        [{ kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'prose', chapters: [] }, 'MULTI_CHAPTER_PAYLOAD'],
        [{ kind: 'writer-chapter-draft', chapterNumber: 100, title: '   ', prose: 'prose' }, 'INVALID_TITLE'],
        ['not an object', 'INVALID_SHAPE'],
    ])('rejects invalid writer protocol output', (output, code) => {
        expect(() => parseWriterChapterDraft(output, 100)).toThrow(WriterDraftValidationError);
        try { parseWriterChapterDraft(output, 100); } catch (error) { expect((error as WriterDraftValidationError).issues.map(issue => issue.code)).toContain(code); }
    });

    it('does not mutate or freeze controls, state, plans, or memory while producing an unvalidated one-chapter draft', async () => {
        const state = stateFor(100);
        const plan = planFor(100);
        const memory = { recentRawChapters: [{ chapterNumber: 99, text: 'memory' }] };
        const controlBefore = JSON.stringify(control);
        const stateBefore = JSON.stringify(state);
        const planBefore = JSON.stringify(plan);
        const memoryBefore = JSON.stringify(memory);
        const draft = await generateWriterDraft({ control, state, plan, memoryInput: memory, model: { async write(request) {
            expect(request.context.targetChapter).toBe(100);
            expect(request.prompt).toContain('exactly one chapter');
            return { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A waits at the closed gate.' };
        } } });
        expect(draft.validationStatus).toBe('unvalidated');
        expect(JSON.stringify(control)).toBe(controlBefore);
        expect(JSON.stringify(state)).toBe(stateBefore);
        expect(JSON.stringify(plan)).toBe(planBefore);
        expect(JSON.stringify(memory)).toBe(memoryBefore);
        expect(Object.isFrozen(state)).toBe(false);
        expect(Object.isFrozen(plan)).toBe(false);
        expect(Object.isFrozen(memory)).toBe(false);
    });
});
