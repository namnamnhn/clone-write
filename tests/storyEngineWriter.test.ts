import { describe, expect, it } from 'vitest';
import {
    buildWriterContext,
    buildWriterPrompt,
    buildPlannerContext,
    compileStoryControl,
    createInitialStoryState,
    generateWriterDraft,
    InternalChapterPlan,
    parseWriterChapterDraft,
    sanitizeWriterChapterPlan,
    StoryBlueprint,
    WriterChapterPlan,
    WriterContextError,
    WriterDraftValidationError,
} from '../src/storyEngine';

const blueprint = (): StoryBlueprint => ({
    id: 'writer-test-story', engine: { plannedChapterCount: 600 },
    characters: [
        { id: 'a', name: 'A', availableFromChapter: 1, writerProfile: { role: 'traveler' }, authorNotes: 'author character dossier' },
        { id: 'b', name: 'B', availableFromChapter: 1, writerProfile: { role: 'ally' } },
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
    relationshipEvents: [{ id: 'a-b-meeting', relationshipId: 'a-b', eventType: 'meeting', participantIds: ['a', 'b'], writerText: 'A and B may meet.' }],
    gates: {
        characters: [{ id: 'a-character', characterId: 'a', allowedFromChapter: 1 }, { id: 'b-character', characterId: 'b', allowedFromChapter: 1 }, { id: 'future-character', characterId: 'future', allowedFromChapter: 301 }],
        pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }, { id: 'future-pov', characterId: 'future', allowedFromChapter: 301 }],
        reveals: [{ id: 'mastermind-gate', revealId: 'mastermind-reveal', allowedFromChapter: 561 }], relationships: [{ id: 'meeting-gate', eventId: 'a-b-meeting', allowedFromChapter: 1 }], events: [],
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

const internalPlanFor = (chapter: number): InternalChapterPlan => {
    const context = buildPlannerContext(control, stateFor(chapter), chapter);
    return {
        kind: 'internal-chapter-plan', chapterNumber: chapter, arcId: context.currentArc.id,
        ...(context.currentBeat === undefined ? {} : { beatId: context.currentBeat.id }),
        primaryGoal: 'Reach the gate.', povCharacterId: 'a', participantIds: ['a'],
        scenes: [{ id: `internal-scene-${chapter}`, order: 1, goal: 'Cross the gate.', location: 'Gate district', povCharacterId: 'a', participantIds: ['a'], conflictOrObstacle: 'The gate is shut.', uncertainty: 'The key may fail.', expectedConsequence: 'The route changes.', purposeTags: ['plot'], conflictImportance: 'minor' }],
        activeConstraintIds: ['travel-rule'], allowedRevealIds: context.allowedRevealIds, plannedRevealIds: [], relationshipEventIds: [], storyEventIds: [], cluesPlantedIds: [], cluesPaidOffIds: [], expectedResourceDeltas: [], expectedRelationshipDeltas: [], expectedContinuityConsequences: [], endStateIntent: 'End with uncertainty.',
    };
};

const stateFor = (chapter: number) => ({
    ...createInitialStoryState(chapter), knownCharacterIds: ['a', 'b', 'future'], activeCharacterIds: ['a', 'b', 'future'],
    facts: [{ id: 'writer-fact', text: 'A has a gate token.', establishedChapter: 1, visibility: 'writer' as const }, { id: 'internal-fact', text: 'INTERNAL FACT NEVER FOR WRITER.', establishedChapter: 1, visibility: 'internal' as const }],
    extensions: { internalDossier: 'RAW SECRET: Omega backup identity.', authorPlan: 'never expose' },
    continuity: { pendingThreads: [], notes: [{ text: 'author-only continuity', visibility: 'internal' as const, establishedChapter: 1 }] },
});

describe('WriterChapterPlan runtime validation', () => {
    const rejects = (plan: WriterChapterPlan) => expect(() => buildWriterContext(control, stateFor(100), plan)).toThrow(WriterContextError);

    it('rejects omitted, duplicate, and unknown mandatory canon constraints', () => {
        rejects({ ...planFor(100), canonConstraints: [] });
        rejects({ ...planFor(100), canonConstraints: [planFor(100).canonConstraints[0], planFor(100).canonConstraints[0]] });
        rejects({ ...planFor(100), canonConstraints: [{ id: 'unknown-rule', text: 'Unknown.', scope: 'world' }] });
    });

    it('rejects malformed runtime scene data and undeclared scene participants', () => {
        rejects({ ...planFor(100), scenes: [{ ...planFor(100).scenes[0], purposeTags: [] }] });
        const unsupported = planFor(100);
        Object.assign(unsupported.scenes[0], { purposeTags: ['unsupported'] });
        rejects(unsupported);
        rejects({ ...planFor(100), scenes: [{ ...planFor(100).scenes[0], order: 2 }] });
        rejects({ ...planFor(100), scenes: [{ ...planFor(100).scenes[0], order: 1 }, { ...planFor(100).scenes[0], id: 'scene-duplicate', order: 1 }] });
        const invalidImportance = planFor(100);
        Object.assign(invalidImportance.scenes[0], { conflictImportance: 'invalid' });
        rejects(invalidImportance);
        rejects({ ...planFor(100), scenes: [{ ...planFor(100).scenes[0], participantIds: ['a', 'b'] }] });
    });

    it('rejects controlled events and deltas that introduce undeclared characters', () => {
        rejects({ ...planFor(100), relationshipEvents: [{ id: 'a-b-meeting', relationshipId: 'a-b', eventType: 'meeting', participantIds: ['a', 'b'], text: 'A and B may meet.' }] });
        rejects({ ...planFor(100), expectedResourceDeltas: [{ characterId: 'b', resourceId: 'key' }] });
        rejects({ ...planFor(100), expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'allies' }] });
    });

    it('accepts the WORK 02 sanitized WriterChapterPlan and projects every active canon rule exactly once', () => {
        const sanitized = sanitizeWriterChapterPlan(internalPlanFor(100), control, stateFor(100));
        const context = buildWriterContext(control, stateFor(100), sanitized);
        expect(context.chapterPlan).toEqual(sanitized);
        expect(context.activeCanonConstraints).toEqual([{ id: 'travel-rule', text: 'Travel needs a gate token.', scope: 'world' }]);
        expect(context.chapterPlan.canonConstraints.map(rule => rule.id)).toEqual(['travel-rule']);
    });
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

describe('WriterContext bounded non-memory selection', () => {
    it('deterministically bounds long-run state while retaining mandatory plan material', () => {
        const extras = Array.from({ length: 110 }, (_, index) => ({ id: `extra-${String(index).padStart(3, '0')}`, name: `Extra ${index}`, availableFromChapter: 1, writerProfile: { role: 'support' } }));
        const source = blueprint();
        const largeControl = compileStoryControl({
            ...source,
            characters: [...source.characters, ...extras],
            gates: { ...source.gates, characters: [...(source.gates?.characters ?? []), ...extras.map(character => ({ id: `${character.id}-gate`, characterId: character.id, allowedFromChapter: 1 }))] },
        });
        const facts = Array.from({ length: 200 }, (_, index) => ({ id: `fact-${index}`, text: `Fact ${index}`, establishedChapter: index + 1, visibility: 'writer' as const }));
        const selectedExtraIds = extras.map(character => character.id);
        const state = {
            ...createInitialStoryState(561),
            knownCharacterIds: ['a', 'b', ...selectedExtraIds], activeCharacterIds: ['a', 'b', ...selectedExtraIds],
            facts: [...facts, { id: 'future-fact', text: 'FUTURE MATERIAL', establishedChapter: 580, visibility: 'writer' as const }],
            characterKnowledge: ['a', 'b', ...selectedExtraIds].map((characterId, index) => ({ characterId, factIds: [`fact-${index}`] })),
            relationships: Array.from({ length: 100 }, (_, index) => ({ id: `relationship-${index}`, participantIds: ['a', selectedExtraIds[index]], state: 'open', establishedChapter: index + 1 })),
            unresolvedClues: [{ id: 'required-clue', text: 'Required clue.', openedChapter: 1, visibility: 'writer' as const }, ...Array.from({ length: 80 }, (_, index) => ({ id: `clue-${index}`, text: `Clue ${index}`, openedChapter: index + 1, visibility: 'writer' as const }))],
            unresolvedPromises: Array.from({ length: 80 }, (_, index) => ({ id: `promise-${index}`, text: `Promise ${index}`, openedChapter: index + 1, visibility: 'writer' as const })),
            resources: Object.fromEntries(['a', 'b', ...selectedExtraIds].map(characterId => [characterId, Array.from({ length: 30 }, (_, index) => ({ id: index === 0 && characterId === 'a' ? 'required-resource' : `resource-${index}`, name: `Resource ${index}` }))])),
            continuity: {
                pendingThreads: [{ text: 'Required continuity.', visibility: 'writer' as const, establishedChapter: 1 }, ...Array.from({ length: 80 }, (_, index) => ({ text: `Pending ${index}`, visibility: 'writer' as const, establishedChapter: index + 1 }))],
                notes: Array.from({ length: 80 }, (_, index) => ({ text: `Note ${index}`, visibility: 'writer' as const, establishedChapter: index + 1 })),
            },
        };
        const base = planFor(561, true);
        const plan: WriterChapterPlan = {
            ...base, participantIds: ['a', 'b'], scenes: [{ ...base.scenes[0], participantIds: ['a', 'b'] }],
            relationshipEvents: [{ id: 'a-b-meeting', relationshipId: 'a-b', eventType: 'meeting', participantIds: ['a', 'b'], text: 'A and B may meet.' }],
            cluesPaidOffIds: ['required-clue'], expectedResourceDeltas: [{ characterId: 'a', resourceId: 'required-resource' }],
            expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'allies' }],
            expectedContinuityConsequences: [{ id: 'required-continuity', text: 'Required continuity.' }],
        };
        const policy = { maxCharacters: 4, maxRelationships: 3, maxFacts: 8, maxUnresolvedClues: 3, maxUnresolvedPromises: 3, maxContinuityEntries: 3, maxResourcesPerCharacter: 2 };
        const original = JSON.stringify(state);
        const first = buildWriterContext(largeControl, state, plan, undefined, undefined, policy);
        const second = buildWriterContext(largeControl, state, plan, undefined, undefined, policy);
        expect(first).toEqual(second);
        expect(first.characters).toHaveLength(4);
        expect(first.characters.map(character => character.id)).toEqual(expect.arrayContaining(['a', 'b']));
        expect(first.relationships.length).toBeLessThanOrEqual(policy.maxRelationships);
        expect(first.writerVisibleFacts.length).toBeLessThanOrEqual(policy.maxFacts);
        expect(first.unresolvedClues.length).toBeLessThanOrEqual(policy.maxUnresolvedClues);
        expect(first.unresolvedPromises.length).toBeLessThanOrEqual(policy.maxUnresolvedPromises);
        expect(first.continuity.pendingThreads.length).toBeLessThanOrEqual(policy.maxContinuityEntries);
        expect(first.continuity.notes.length).toBeLessThanOrEqual(policy.maxContinuityEntries);
        expect(Object.values(first.resources).every(resources => resources.length <= policy.maxResourcesPerCharacter)).toBe(true);
        expect(first.activeCanonConstraints).toEqual([{ id: 'travel-rule', text: 'Travel needs a gate token.', scope: 'world' }]);
        expect(first.controlledReveals).toEqual([{ id: 'mastermind-reveal', text: 'The mastermind is Character Omega.' }]);
        expect(first.controlledRelationshipEvents.map(event => event.id)).toEqual(['a-b-meeting']);
        expect(first.unresolvedClues.map(clue => clue.id)).toContain('required-clue');
        expect(first.continuity.pendingThreads.map(entry => entry.text)).toContain('Required continuity.');
        const factIds = new Set(first.writerVisibleFacts.map(fact => fact.id));
        expect(first.characterKnowledge.every(entry => entry.factIds.every(id => factIds.has(id)))).toBe(true);
        expect(JSON.stringify(first)).not.toContain('FUTURE MATERIAL');
        expect(JSON.stringify(state)).toBe(original);
        expect(Object.isFrozen(state)).toBe(false);
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
