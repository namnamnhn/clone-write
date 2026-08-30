import { describe, expect, it } from 'vitest';
import {
    buildPlannerContext,
    ChapterPlanValidationError,
    compileStoryControl,
    createInitialStoryState,
    createStructuredPlanner,
    InternalChapterPlan,
    NarrativeMemoryInput,
    sanitizeWriterChapterPlan,
    selectNarrativeMemory,
    StoryBlueprint,
    validateInternalChapterPlan,
} from '../src/storyEngine';

const makeBlueprint = (): StoryBlueprint => ({
    id: 'planner-test-story',
    engine: { plannedChapterCount: 600 },
    characters: [
        { id: 'character-a', name: 'Character A', lockedThroughChapter: 32, writerProfile: { role: 'traveler' }, authorNotes: 'A future secret' },
        { id: 'character-b', name: 'Character B', availableFromChapter: 1, writerProfile: { role: 'scholar' }, authorNotes: 'B author notes' },
    ],
    arcs: [
        { id: 'arc-current', title: 'Current arc', startChapter: 1, endChapter: 300, authorPlan: 'hidden current arc plan' },
        { id: 'arc-future', title: 'Future arc', startChapter: 301, endChapter: 600, authorPlan: 'future antagonist truth' },
    ],
    beats: [
        { id: 'beat-current', arcId: 'arc-current', order: 1, startChapter: 1, endChapter: 300, authorPlan: 'hidden beat plan' },
        { id: 'beat-future', arcId: 'arc-future', order: 1, startChapter: 301, endChapter: 600, authorPlan: 'future beat plan' },
    ],
    reveals: [{ id: 'mastermind-reveal', writerText: 'The mastermind is Character Omega.', authorNotes: 'do not expose backup identity' }],
    relationshipEvents: [{ id: 'first-meeting', relationshipId: 'a-b', eventType: 'meeting', participantIds: ['character-a', 'character-b'], writerText: 'Character A and Character B may meet.', authorNotes: 'author-only relationship motive' }],
    storyEvents: [{ id: 'palace-civil-war', eventType: 'civil-war', writerText: 'The palace civil war may begin.', authorNotes: 'hidden political design' }],
    gates: {
        characters: [{ id: 'a-character-gate', characterId: 'character-a', lockedThroughChapter: 32 }],
        pov: [
            { id: 'a-pov-gate', characterId: 'character-a', lockedThroughChapter: 32 },
            { id: 'b-pov-gate', characterId: 'character-b', allowedFromChapter: 1 },
        ],
        reveals: [{ id: 'mastermind-gate', revealId: 'mastermind-reveal', allowedFromChapter: 500 }],
        relationships: [{ id: 'meeting-gate', eventId: 'first-meeting', allowedFromChapter: 200 }],
        events: [{ id: 'civil-war-gate', eventId: 'palace-civil-war', allowedFromChapter: 400 }],
    },
    forbiddenRelationshipEvents: [{ id: 'meeting-lock', eventId: 'first-meeting', forbiddenThroughChapter: 218, authorReason: 'not yet' }],
    forbiddenEvents: [{ id: 'civil-war-lock', eventId: 'palace-civil-war', forbiddenThroughChapter: 500, authorReason: 'not yet' }],
    forbiddenReveals: [{ id: 'mastermind-lock', revealId: 'mastermind-reveal', forbiddenThroughChapter: 560, authorReason: 'not yet' }],
    authorOnlySecrets: [{ id: 'mastermind-secret', value: 'INTERNAL DOSSIER: Omega backup identity is classified.', revealId: 'mastermind-reveal', notes: 'never give raw truth to writer' }],
    canonRules: [{ id: 'travel-rule', text: 'Travel requires a gate token.', availableFromChapter: 1, scope: 'world', authorNotes: 'hidden token origin' }],
});

const control = compileStoryControl(makeBlueprint());

const stateFor = (chapter: number) => ({
    ...createInitialStoryState(chapter),
    knownCharacterIds: ['character-a', 'character-b'],
    activeCharacterIds: ['character-a', 'character-b'],
    extensions: { authorPlan: 'DO NOT LEAK', mastermind: 'INTERNAL DOSSIER' },
});

const planFor = (chapter: number, participants?: readonly string[]): InternalChapterPlan => {
    const context = buildPlannerContext(control, stateFor(chapter), chapter);
    const pov = participants?.[0] ?? context.povEligibility.find(entry => entry.allowed)!.id;
    const ids = participants ?? [pov];
    return {
        kind: 'internal-chapter-plan',
        chapterNumber: chapter,
        arcId: context.currentArc.id,
        ...(context.currentBeat === undefined ? {} : { beatId: context.currentBeat.id }),
        primaryGoal: 'Advance the immediate chapter problem.',
        povCharacterId: pov,
        participantIds: [...ids],
        scenes: [{
            id: `scene-${chapter}`,
            order: 1,
            goal: 'Force a meaningful choice.',
            location: 'Gate district',
            povCharacterId: pov,
            participantIds: [...ids],
            conflictOrObstacle: 'The route is blocked.',
            uncertainty: 'The cost of a detour is unclear.',
            expectedConsequence: 'The next move becomes constrained.',
            purposeTags: ['plot'],
            conflictImportance: 'minor',
        }],
        activeConstraintIds: ['travel-rule'],
        allowedRevealIds: [...context.allowedRevealIds],
        plannedRevealIds: [],
        relationshipEventIds: [],
        storyEventIds: [],
        cluesPlantedIds: [],
        cluesPaidOffIds: [],
        expectedResourceDeltas: [],
        expectedRelationshipDeltas: [],
        expectedContinuityConsequences: [],
        endStateIntent: 'End with a concrete unresolved choice.',
    };
};

const validationCodes = (plan: InternalChapterPlan) =>
    validateInternalChapterPlan(plan, buildPlannerContext(control, stateFor(plan.chapterNumber), plan.chapterNumber)).map(issue => issue.code);

describe('Story Engine V4 planner gates', () => {
    it('rejects Character A at chapter 32 and accepts it at chapter 33', () => {
        const locked = planFor(32, ['character-a']);
        expect(validationCodes(locked)).toContain('POV_LOCKED');
        expect(validationCodes(locked)).toContain('CHARACTER_LOCKED');
        expect(validationCodes(planFor(33, ['character-a']))).toEqual([]);
    });

    it('enforces relationship, generic-event, and reveal gates at their exact boundaries', () => {
        const meeting218 = { ...planFor(218, ['character-a', 'character-b']), relationshipEventIds: ['first-meeting'] };
        const meeting219 = { ...planFor(219, ['character-a', 'character-b']), relationshipEventIds: ['first-meeting'] };
        expect(validationCodes(meeting218)).toContain('RELATIONSHIP_EVENT_LOCKED');
        expect(validationCodes(meeting219)).toEqual([]);

        const event500 = { ...planFor(500, ['character-a']), storyEventIds: ['palace-civil-war'] };
        const event501 = { ...planFor(501, ['character-a']), storyEventIds: ['palace-civil-war'] };
        expect(validationCodes(event500)).toContain('STORY_EVENT_LOCKED');
        expect(validationCodes(event501)).toEqual([]);

        const reveal560 = { ...planFor(560, ['character-a']), plannedRevealIds: ['mastermind-reveal'] };
        const reveal561 = { ...planFor(561, ['character-a']), plannedRevealIds: ['mastermind-reveal'], allowedRevealIds: ['mastermind-reveal'] };
        expect(validationCodes(reveal560)).toContain('REVEAL_LOCKED');
        expect(validationCodes(reveal561)).toEqual([]);
    });

    it('rejects locked POVs, future arcs, and wrong beats', () => {
        expect(validationCodes(planFor(32, ['character-a']))).toContain('POV_LOCKED');
        const futureArc = { ...planFor(33, ['character-a']), arcId: 'arc-future' };
        const wrongBeat = { ...planFor(33, ['character-a']), beatId: 'beat-future' };
        expect(validationCodes(futureArc)).toContain('ARC_MISMATCH');
        expect(validationCodes(wrongBeat)).toContain('BEAT_MISMATCH');
    });

    it('rejects filler scenes and enforces the major-conflict contract at runtime', async () => {
        const filler = { ...planFor(33, ['character-a']), scenes: [{ ...planFor(33, ['character-a']).scenes[0], purposeTags: [] }] };
        expect(validationCodes(filler)).toContain('SCENE_PURPOSE_MISSING');
        const majorWithoutDetails = { ...planFor(33, ['character-a']), scenes: [{ ...planFor(33, ['character-a']).scenes[0], conflictImportance: 'major' }] };
        const partialMajor = { ...planFor(33, ['character-a']), scenes: [{ ...planFor(33, ['character-a']).scenes[0], conflictImportance: 'major', intelligentConflict: {} }] };
        const context = buildPlannerContext(control, stateFor(33), 33);
        await expect(createStructuredPlanner({ async plan() { return majorWithoutDetails; } }).plan(context)).rejects.toBeInstanceOf(ChapterPlanValidationError);
        await expect(createStructuredPlanner({ async plan() { return partialMajor; } }).plan(context)).rejects.toBeInstanceOf(ChapterPlanValidationError);

        const completeMajor = {
            ...planFor(33, ['character-a']),
            scenes: [{
                ...planFor(33, ['character-a']).scenes[0],
                conflictImportance: 'major' as const,
                intelligentConflict: {
                    protagonistObjective: 'Cross the gate district.',
                    opponentObjective: 'Keep the protagonist away from the gate.',
                    opponentKnowledge: ['gate-token'],
                    opponentBeliefs: ['The protagonist lacks a token.'],
                    rationalCountermove: 'Block the official route.',
                    uncertainty: 'A hidden passage may exist.',
                    expectedCostOrTradeoff: 'The opponent exposes a patrol pattern.',
                },
            }],
        };
        expect(validationCodes(completeMajor)).toEqual([]);
        expect(validationCodes(planFor(33, ['character-a']))).toEqual([]);
    });

    it('rejects future gate IDs as active constraints and retains every validated canon constraint', () => {
        const futureRevealConstraint = { ...planFor(100, ['character-a']), activeConstraintIds: ['mastermind-gate'] };
        const futureEventConstraint = { ...planFor(100, ['character-a']), activeConstraintIds: ['civil-war-gate'] };
        expect(validationCodes(futureRevealConstraint)).toContain('UNKNOWN_CONSTRAINT');
        expect(validationCodes(futureEventConstraint)).toContain('UNKNOWN_CONSTRAINT');

        const plan = planFor(100, ['character-a']);
        expect(validationCodes(plan)).toEqual([]);
        expect(sanitizeWriterChapterPlan(plan, control, stateFor(100)).canonConstraints).toEqual([
            { id: 'travel-rule', text: 'Travel requires a gate token.', scope: 'world' },
        ]);
    });
});

describe('Writer plan sanitizer and secret isolation', () => {
    it('fails closed instead of repairing a locked plan', () => {
        const locked = { ...planFor(560, ['character-a']), plannedRevealIds: ['mastermind-reveal'], allowedRevealIds: ['mastermind-reveal'] };
        expect(() => sanitizeWriterChapterPlan(locked, control, stateFor(560))).toThrow(ChapterPlanValidationError);
    });

    it('serializes no mastermind secret at chapter 560, and only controlled reveal text at 561', () => {
        const at560 = sanitizeWriterChapterPlan(planFor(560, ['character-a']), control, stateFor(560));
        const at561 = sanitizeWriterChapterPlan({ ...planFor(561, ['character-a']), plannedRevealIds: ['mastermind-reveal'], allowedRevealIds: ['mastermind-reveal'] }, control, stateFor(561));
        const blocked = JSON.stringify(at560);
        const revealed = JSON.stringify(at561);
        expect(blocked).not.toContain('Omega backup identity');
        expect(blocked).not.toContain('INTERNAL DOSSIER');
        expect(revealed).toContain('The mastermind is Character Omega.');
        expect(revealed).not.toContain('Omega backup identity');
        ['authorOnlySecrets', 'authorNotes', 'authorPlan', 'extensions'].forEach(key => expect(revealed).not.toContain(key));
    });

    it('does not mutate or freeze caller state, plan, or memory input', () => {
        const state = stateFor(561);
        const plan = { ...planFor(561, ['character-a']), plannedRevealIds: ['mastermind-reveal'], allowedRevealIds: ['mastermind-reveal'] };
        const memory: NarrativeMemoryInput = { recentRawChapters: Array.from({ length: 20 }, (_, index) => ({ chapterNumber: index + 1, text: `raw-${index + 1}` })) };
        const stateJson = JSON.stringify(state);
        const planJson = JSON.stringify(plan);
        const memoryJson = JSON.stringify(memory);
        buildPlannerContext(control, state, 561, memory);
        sanitizeWriterChapterPlan(plan, control, state);
        expect(JSON.stringify(state)).toBe(stateJson);
        expect(JSON.stringify(plan)).toBe(planJson);
        expect(JSON.stringify(memory)).toBe(memoryJson);
        expect(Object.isFrozen(state)).toBe(false);
        expect(Object.isFrozen(plan)).toBe(false);
        expect(Object.isFrozen(memory)).toBe(false);
    });
});

describe('Narrative memory selection', () => {
    it('keeps only the newest configured windows in chronological order without mutating input', () => {
        const input: NarrativeMemoryInput = {
            recentRawChapters: Array.from({ length: 20 }, (_, index) => ({ chapterNumber: 20 - index, text: `raw-${20 - index}` })),
            structuredRecentSummaries: Array.from({ length: 20 }, (_, index) => ({ chapterNumber: 20 - index, summary: `summary-${20 - index}` })),
            selectedLongTermMemories: Array.from({ length: 10 }, (_, index) => ({ id: `memory-${index + 1}`, establishedChapter: index + 1, summary: `memory-${index + 1}`, relevance: index + 1 })),
        };
        const original = JSON.stringify(input);
        const selected = selectNarrativeMemory(input, 21);
        expect(selected.recentRawChapters.map(value => value.chapterNumber)).toEqual([17, 18, 19, 20]);
        expect(selected.structuredRecentSummaries.map(value => value.chapterNumber)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
        expect(selected.selectedLongTermMemories.map(value => value.establishedChapter)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
        expect(JSON.stringify(input)).toBe(original);
    });

    it('filters target and future material before selecting windows without mutating input', () => {
        const input: NarrativeMemoryInput = {
            recentRawChapters: [
                { chapterNumber: 99, text: 'raw-past' },
                { chapterNumber: 100, text: 'raw-target' },
                { chapterNumber: 580, text: 'raw-future' },
            ],
            structuredRecentSummaries: [
                { chapterNumber: 99, summary: 'summary-past' },
                { chapterNumber: 100, summary: 'summary-target' },
                { chapterNumber: 580, summary: 'summary-future' },
            ],
            selectedLongTermMemories: [
                { id: 'past-memory', establishedChapter: 99, summary: 'long-past', relevance: 1 },
                { id: 'target-memory', establishedChapter: 100, summary: 'long-target', relevance: 99 },
                { id: 'future-memory', establishedChapter: 580, summary: 'long-future', relevance: 100 },
            ],
        };
        const original = JSON.stringify(input);
        const selected = buildPlannerContext(control, stateFor(100), 100, input).narrativeMemory;
        expect(selected.recentRawChapters.map(memory => memory.chapterNumber)).toEqual([99]);
        expect(selected.structuredRecentSummaries.map(memory => memory.chapterNumber)).toEqual([99]);
        expect(selected.selectedLongTermMemories.map(memory => memory.id)).toEqual(['past-memory']);
        expect(JSON.stringify(input)).toBe(original);
    });

    it('returns no memory when every configured window is zero', () => {
        const input: NarrativeMemoryInput = {
            recentRawChapters: [{ chapterNumber: 99, text: 'raw' }],
            structuredRecentSummaries: [{ chapterNumber: 99, summary: 'summary' }],
            selectedLongTermMemories: [{ id: 'memory', establishedChapter: 99, summary: 'long' }],
        };
        const selected = selectNarrativeMemory(input, 100, {
            recentRawChapters: 0,
            structuredSummaryWindow: 0,
            selectedLongTermMemories: 0,
        });
        expect(selected).toEqual({ recentRawChapters: [], structuredRecentSummaries: [], selectedLongTermMemories: [] });
    });
});
