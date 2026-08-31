import { describe, expect, it } from 'vitest';
import {
    applyStoryStateDelta,
    buildStoryStateViewForChapter,
    characterKnowsFact,
    createInitialStoryState,
    FullStoryControl,
    getActiveCharacterStatuses,
    getCharacterBeliefs,
    getCharacterLocation,
    getCharacterResources,
    getFactsKnownByCharacter,
    getOpenContinuityAtChapter,
    getRelationshipState,
    parseStoryState,
    parseStoryStateDelta,
    StoryState,
    StoryStateDelta,
    StoryStateTransitionError,
} from '../src/storyEngine';

const control: FullStoryControl = {
    kind: 'full-story-control', id: 'story',
    engine: { schemaVersion: 4, plannedChapterCount: 600, failClosed: true, unknownCharacterPolicy: 'deny', missingGatePolicy: 'deny', beatPolicy: 'required-for-arcs-with-beats' },
    characters: {
        a: { id: 'a', name: 'A', initialStatus: 'active', availableFromChapter: 1, writerProfile: {} },
        b: { id: 'b', name: 'B', initialStatus: 'active', availableFromChapter: 1, writerProfile: {} },
        c: { id: 'c', name: 'C', initialStatus: 'active', availableFromChapter: 1, writerProfile: {} },
        future: { id: 'future', name: 'Future', initialStatus: 'future-locked', availableFromChapter: 50, writerProfile: {} },
    },
    characterOrder: ['a', 'b', 'c', 'future'], arcs: [{ id: 'arc', title: 'Arc', startChapter: 1, endChapter: 600 }], beats: [],
    reveals: [], relationshipEvents: [], storyEvents: [], gates: { characters: [], pov: [], reveals: [], relationships: [], events: [] },
    forbiddenEvents: [], forbiddenRelationshipEvents: [], forbiddenReveals: [], authorOnlySecrets: [], canonRules: [],
};

const provenance = (chapter: number, sourceId: string) => ({ sourceChapter: chapter, sourceType: 'chapter' as const, sourceId });

const delta = (chapter: number, revision: number, values: Partial<StoryStateDelta> = {}): StoryStateDelta => ({
    kind: 'story-state-delta', schemaVersion: 1, chapterNumber: chapter, expectedRevision: revision,
    factChanges: [], epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [],
    relationshipChanges: [], resourceChanges: [], continuityChanges: [], ...values,
});

const chapter10Delta = (): StoryStateDelta => delta(10, 9, {
    activationChanges: [
        { characterId: 'a', active: true, lifeStatus: 'alive', provenance: provenance(10, 'chapter-10') },
        { characterId: 'b', active: true, lifeStatus: 'alive', provenance: provenance(10, 'chapter-10') },
    ],
    locationChanges: [{ id: 'loc-a-10', characterId: 'a', location: 'capital', sinceChapter: 10, provenance: provenance(10, 'chapter-10') }],
    statusChanges: [{ operation: 'add', record: { id: 'wound-a', characterId: 'a', kind: 'injury', state: 'wounded', establishedChapter: 10, provenance: provenance(10, 'chapter-10') }, provenance: provenance(10, 'chapter-10') }],
    relationshipChanges: [{ id: 'rel-ab-10', relationshipId: 'rel-ab', participantIds: ['a', 'b'], state: 'distrust', chapterNumber: 10, provenance: provenance(10, 'chapter-10') }],
    resourceChanges: [{ id: 'money-a-10', characterId: 'a', resourceId: 'money', name: 'Money', quantityDelta: 100, provenance: provenance(10, 'chapter-10') }],
});

const chapter11Delta = (): StoryStateDelta => delta(11, 10, {
    factChanges: [{ id: 'fact-letter', text: 'The letter names the envoy.', establishedChapter: 11, visibility: 'writer', status: 'active', provenance: provenance(11, 'chapter-11') }],
    epistemicChanges: [{ id: 'know-a-letter', characterId: 'a', kind: 'known', factId: 'fact-letter', learnedChapter: 11, source: { type: 'told-by-character', sourceCharacterId: 'b', sourceChapter: 11 }, status: 'active' }],
    locationChanges: [{ id: 'loc-a-11', characterId: 'a', location: 'river port', sinceChapter: 11, provenance: provenance(11, 'chapter-11') }],
    statusChanges: [{ operation: 'resolve', statusId: 'wound-a', resolvedChapter: 11, provenance: provenance(11, 'chapter-11') }],
    relationshipChanges: [{ id: 'rel-ab-11', relationshipId: 'rel-ab', participantIds: ['a', 'b'], state: 'uneasy cooperation', chapterNumber: 11, provenance: provenance(11, 'chapter-11') }],
    resourceChanges: [{ id: 'money-a-11', characterId: 'a', resourceId: 'money', name: 'Money', quantityDelta: -25, provenance: provenance(11, 'chapter-11') }],
    continuityChanges: [{ operation: 'open', entry: { id: 'letter-unopened', kind: 'obligation', text: 'Letter remains unopened.', visibility: 'writer', establishedChapter: 11, status: 'open', provenance: provenance(11, 'chapter-11') }, provenance: provenance(11, 'chapter-11') }],
});

const stateAt9 = (): StoryState => {
    let state = createInitialStoryState();
    for (let chapter = 1; chapter <= 9; chapter += 1) state = applyStoryStateDelta(control, state, delta(chapter, chapter - 1));
    return state;
};
const stateAt10 = (): StoryState => applyStoryStateDelta(control, stateAt9(), chapter10Delta());
const stateAt11 = (): StoryState => applyStoryStateDelta(control, stateAt10(), chapter11Delta());

describe('StoryState V4 canonical ledgers', () => {
    it('uses cursor zero as the empty canonical state and applies Chapter 1', () => {
        const initial = createInitialStoryState();
        expect(initial).toMatchObject({ kind: 'story-state', schemaVersion: 4, currentChapter: 0, revision: 0 });
        expect(parseStoryState(initial, control)).toEqual(initial);
        const chapter1 = applyStoryStateDelta(control, initial, delta(1, 0));
        expect(chapter1).toMatchObject({ currentChapter: 1, revision: 1, currentArcId: 'arc' });
        expect(() => applyStoryStateDelta(control, chapter1, delta(1, 1))).toThrowError(expect.objectContaining({ code: 'CHAPTER_SEQUENCE_VIOLATION' }));
        expect(() => applyStoryStateDelta(control, initial, delta(2, 0))).toThrowError(expect.objectContaining({ code: 'CHAPTER_SEQUENCE_VIOLATION' }));
    });

    it('rejects positive cursors that bypass their canonical revision history', () => {
        const fakeChapter9 = { ...createInitialStoryState(9), currentArcId: 'arc' };
        expect(() => parseStoryState(fakeChapter9, control)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
        expect(() => applyStoryStateDelta(control, fakeChapter9, delta(10, 0))).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
        const chapter2 = applyStoryStateDelta(control, applyStoryStateDelta(control, createInitialStoryState(), delta(1, 0)), delta(2, 1));
        expect(chapter2).toMatchObject({ currentChapter: 2, revision: 2 });
    });

    it('records character lifecycle history, provenance, events, and immutable inputs', () => {
        const initial = createInitialStoryState(); const initialJson = JSON.stringify(initial);
        const chapter1Delta = delta(1, 0, { activationChanges: [{ characterId: 'a', active: true, lifeStatus: 'alive', provenance: provenance(1, 'chapter-1') }] });
        const deltaJson = JSON.stringify(chapter1Delta); const chapter1 = applyStoryStateDelta(control, initial, chapter1Delta);
        expect(chapter1.ledgers.characterStates).toEqual([{ id: 'character-state:1:a', characterId: 'a', chapterNumber: 1, active: true, lifeStatus: 'alive', provenance: provenance(1, 'chapter-1') }]);
        expect(chapter1.projections.characters[0]).toMatchObject({ characterId: 'a', active: true, lifeStatus: 'alive' });
        expect(chapter1.ledgers.events.some(value => value.type === 'character-state-changed' && value.affectedIds.includes('character-state:1:a'))).toBe(true);
        let chapter4 = chapter1; for (let chapter = 2; chapter <= 4; chapter += 1) chapter4 = applyStoryStateDelta(control, chapter4, delta(chapter, chapter - 1));
        const chapter5 = applyStoryStateDelta(control, chapter4, delta(5, 4, { activationChanges: [{ characterId: 'a', active: false, provenance: provenance(5, 'chapter-5') }] }));
        expect(chapter5.ledgers.characterStates).toHaveLength(2); expect(chapter5.ledgers.characterStates[0].active).toBe(true);
        expect(chapter5.ledgers.characterStates[1]).toMatchObject({ id: 'character-state:5:a', active: false, lifeStatus: 'alive' });
        expect(chapter5.projections.characters[0]).toMatchObject({ active: false, lifeStatus: 'alive' });
        expect(JSON.stringify(initial)).toBe(initialJson); expect(JSON.stringify(chapter1Delta)).toBe(deltaJson);
        expect(Object.isFrozen(initial)).toBe(false); expect(Object.isFrozen(chapter1Delta)).toBe(false);
    });

    it('rejects invented, stale, ambiguous, or invalid loaded lifecycle state', () => {
        const chapter1 = applyStoryStateDelta(control, createInitialStoryState(), delta(1, 0, { activationChanges: [{ characterId: 'a', active: true, lifeStatus: 'alive', provenance: provenance(1, 'chapter-1') }] }));
        const flippedActive = chapter1.projections.characters.map(value => value.characterId === 'a' ? { ...value, active: false } : value);
        expect(() => parseStoryState({ ...chapter1, projections: { ...chapter1.projections, characters: flippedActive } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        const flippedLife = chapter1.projections.characters.map(value => value.characterId === 'a' ? { ...value, lifeStatus: 'dead' as const } : value);
        expect(() => parseStoryState({ ...chapter1, projections: { ...chapter1.projections, characters: flippedLife } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        expect(() => parseStoryState({ ...chapter1, ledgers: { ...chapter1.ledgers, characterStates: [] } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        let chapter4 = chapter1; for (let chapter = 2; chapter <= 4; chapter += 1) chapter4 = applyStoryStateDelta(control, chapter4, delta(chapter, chapter - 1));
        const chapter5 = applyStoryStateDelta(control, chapter4, delta(5, 4, { activationChanges: [{ characterId: 'a', active: false, lifeStatus: 'dead', provenance: provenance(5, 'chapter-5') }] }));
        const stale = chapter5.projections.characters.map(value => value.characterId === 'a' ? { ...value, active: true, lifeStatus: 'alive' as const } : value);
        expect(() => parseStoryState({ ...chapter5, projections: { ...chapter5.projections, characters: stale } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        const duplicateChapter = [...chapter5.ledgers.characterStates, { ...chapter5.ledgers.characterStates[1], id: 'character-state-duplicate' }];
        expect(() => parseStoryState({ ...chapter5, ledgers: { ...chapter5.ledgers, characterStates: duplicateChapter } }, control)).toThrow(StoryStateTransitionError);
        const unknown = chapter1.ledgers.characterStates.map(value => ({ ...value, id: 'character-state:1:missing', characterId: 'missing' }));
        expect(() => parseStoryState({ ...chapter1, ledgers: { ...chapter1.ledgers, characterStates: unknown } }, control)).toThrowError(expect.objectContaining({ code: 'UNKNOWN_CHARACTER' }));
        const future = chapter1.ledgers.characterStates.map(value => ({ ...value, id: 'character-state:1:future', characterId: 'future' }));
        expect(() => parseStoryState({ ...chapter1, ledgers: { ...chapter1.ledgers, characterStates: future } }, control)).toThrowError(StoryStateTransitionError);
    });

    it('derives canonical arc and beat identifiers on every chapter advance', () => {
        const boundaryControl: FullStoryControl = {
            ...control,
            arcs: [{ id: 'arc-1', title: 'One', startChapter: 1, endChapter: 1 }, { id: 'arc-2', title: 'Two', startChapter: 2, endChapter: 600 }],
            beats: [{ id: 'beat-1', arcId: 'arc-1', order: 1, startChapter: 1, endChapter: 1 }, { id: 'beat-2', arcId: 'arc-2', order: 1, startChapter: 2, endChapter: 600 }],
        };
        const chapter1 = applyStoryStateDelta(boundaryControl, createInitialStoryState(), delta(1, 0));
        expect(chapter1).toMatchObject({ currentArcId: 'arc-1', currentBeatId: 'beat-1' });
        const chapter2 = applyStoryStateDelta(boundaryControl, chapter1, delta(2, 1));
        expect(chapter2).toMatchObject({ currentArcId: 'arc-2', currentBeatId: 'beat-2' });
    });

    it('accepts chapter zero only for a structurally empty pre-chapter snapshot', () => {
        const initial = createInitialStoryState();
        expect(() => parseStoryState({ ...initial, revision: 1 }, control)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
        expect(() => parseStoryState({ ...initial, currentArcId: 'arc' }, control)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
        expect(() => parseStoryState({ ...initial, projections: { ...initial.projections, characters: [{ characterId: 'a', active: true, lifeStatus: 'alive', activeStatusIds: [] }] } }, control)).toThrow(StoryStateTransitionError);
    });

    it('never permits chapter zero in canonical records or provenance', () => {
        const initial = createInitialStoryState();
        const invalidLedgers: readonly Partial<StoryState['ledgers']>[] = [
            { facts: [{ id: 'zero-fact', text: 'Invalid', establishedChapter: 0, visibility: 'writer', status: 'active', provenance: provenance(1, 'c1') }] },
            { epistemic: [{ id: 'zero-knowledge', characterId: 'a', kind: 'believed', claim: 'Invalid', learnedChapter: 0, source: { type: 'witnessed', sourceChapter: 1 }, status: 'active' }] },
            { locations: [{ id: 'zero-location', characterId: 'a', location: 'Nowhere', sinceChapter: 0, provenance: provenance(1, 'c1') }] },
            { statuses: [{ id: 'zero-status', characterId: 'a', kind: 'status', state: 'Invalid', establishedChapter: 0, provenance: provenance(1, 'c1') }] },
            { statuses: [{ id: 'zero-resolution', characterId: 'a', kind: 'status', state: 'Invalid', establishedChapter: 1, resolvedChapter: 0, provenance: provenance(1, 'c1') }] },
            { relationships: [{ id: 'zero-rel-history', relationshipId: 'rel', participantIds: ['a', 'b'], state: 'Invalid', chapterNumber: 0, provenance: provenance(1, 'c1') }] },
            { resources: [{ id: 'zero-resource', characterId: 'a', resourceId: 'money', name: 'Money', chapterNumber: 0, quantityDelta: 1, resultingQuantity: 1, provenance: provenance(1, 'c1') }] },
            { continuity: [{ id: 'zero-continuity', kind: 'obligation', text: 'Invalid', visibility: 'writer', establishedChapter: 0, status: 'open', provenance: provenance(1, 'c1') }] },
            { facts: [{ id: 'zero-provenance', text: 'Invalid', establishedChapter: 1, visibility: 'writer', status: 'active', provenance: provenance(0, 'c0') }] },
            { events: [{ id: 'zero-event', chapterNumber: 0, type: 'fact-added', affectedIds: ['x'], provenance: provenance(1, 'c1') }] },
        ];
        invalidLedgers.forEach(ledgers => expect(() => parseStoryState({ ...initial, ledgers: { ...initial.ledgers, ...ledgers } }, control)).toThrow(StoryStateTransitionError));
    });

    it('applies a sequential chapter atomically and preserves immutable history', () => {
        const before = stateAt10(); const beforeJson = JSON.stringify(before); const input = chapter11Delta(); const inputJson = JSON.stringify(input);
        const next = applyStoryStateDelta(control, before, input);
        expect(next).not.toBe(before); expect(next.currentChapter).toBe(11); expect(next.revision).toBe(11);
        expect(getCharacterLocation(next, 'a')?.location).toBe('river port');
        expect(next.ledgers.locations.map(value => value.location)).toEqual(['capital', 'river port']);
        expect(getRelationshipState(next, 'rel-ab')?.currentState).toBe('uneasy cooperation');
        expect(next.ledgers.relationships.map(value => value.state)).toEqual(['distrust', 'uneasy cooperation']);
        expect(getCharacterResources(next, 'a')[0].quantity).toBe(75);
        expect(next.ledgers.resources.map(value => value.resultingQuantity)).toEqual([100, 75]);
        expect(getActiveCharacterStatuses(next, 'a')).toEqual([]); expect(next.ledgers.statuses[0].resolvedChapter).toBe(11);
        expect(getOpenContinuityAtChapter(next, 11).map(value => value.id)).toEqual(['letter-unopened']);
        expect(JSON.stringify(before)).toBe(beforeJson); expect(JSON.stringify(input)).toBe(inputJson);
        expect(Object.isFrozen(before)).toBe(false); expect(Object.isFrozen(input)).toBe(false);
    });

    it('keeps fact and character knowledge separate with temporal source queries', () => {
        const state = stateAt11();
        expect(characterKnowsFact(state, 'a', 'fact-letter', 10)).toBe(false);
        expect(characterKnowsFact(state, 'a', 'fact-letter', 11)).toBe(true);
        expect(getFactsKnownByCharacter(state, 'a', 11).map(value => value.id)).toEqual(['fact-letter']);
        expect(state.ledgers.epistemic[0].source).toEqual({ type: 'told-by-character', sourceChapter: 11, sourceCharacterId: 'b' });
    });

    it('represents a false belief without creating canonical truth', () => {
        const state = applyStoryStateDelta(control, stateAt11(), delta(12, 11, {
            epistemicChanges: [{ id: 'belief-a-traitor', characterId: 'a', kind: 'believed', claim: 'B is the traitor.', learnedChapter: 12, source: { type: 'witnessed', sourceChapter: 12 }, status: 'active' }],
        }));
        expect(getCharacterBeliefs(state, 'a', 12)[0].claim).toBe('B is the traitor.');
        expect(state.ledgers.facts.some(value => value.text === 'B is the traitor.')).toBe(false);
    });

    it('resolves continuity without deleting history', () => {
        const state = applyStoryStateDelta(control, stateAt11(), delta(12, 11, { continuityChanges: [{ operation: 'resolve', continuityId: 'letter-unopened', chapterNumber: 12, provenance: provenance(12, 'chapter-12') }] }));
        expect(getOpenContinuityAtChapter(state, 12)).toEqual([]);
        expect(state.ledgers.continuity[0]).toMatchObject({ id: 'letter-unopened', status: 'resolved', resolvedChapter: 12 });
        expect(getOpenContinuityAtChapter(state, 11).map(value => value.id)).toEqual(['letter-unopened']);
    });

    it.each([
        ['unknown fact', { epistemicChanges: [{ id: 'bad-k', characterId: 'a', kind: 'known', factId: 'missing', learnedChapter: 11, source: { type: 'witnessed', sourceChapter: 11 }, status: 'active' }] }],
        ['unknown character', { epistemicChanges: [{ id: 'bad-k', characterId: 'missing', kind: 'known', factId: 'existing', learnedChapter: 11, source: { type: 'witnessed', sourceChapter: 11 }, status: 'active' }], factChanges: [{ id: 'existing', text: 'Existing', establishedChapter: 11, visibility: 'writer', status: 'active', provenance: provenance(11, 'c11') }] }],
        ['future character', { epistemicChanges: [{ id: 'bad-k', characterId: 'future', kind: 'known', factId: 'existing', learnedChapter: 11, source: { type: 'witnessed', sourceChapter: 11 }, status: 'active' }], factChanges: [{ id: 'existing', text: 'Existing', establishedChapter: 11, visibility: 'writer', status: 'active', provenance: provenance(11, 'c11') }] }],
        ['unknown teller', { epistemicChanges: [{ id: 'bad-k', characterId: 'a', kind: 'known', factId: 'existing', learnedChapter: 11, source: { type: 'told-by-character', sourceCharacterId: 'missing', sourceChapter: 11 }, status: 'active' }], factChanges: [{ id: 'existing', text: 'Existing', establishedChapter: 11, visibility: 'writer', status: 'active', provenance: provenance(11, 'c11') }] }],
        ['unknown inference basis', { epistemicChanges: [{ id: 'bad-k', characterId: 'a', kind: 'believed', claim: 'Conclusion', learnedChapter: 11, source: { type: 'inference', sourceChapter: 11, basisFactIds: ['missing'] }, status: 'active' }] }],
        ['basis not known by character', { epistemicChanges: [{ id: 'bad-k', characterId: 'b', kind: 'believed', claim: 'Conclusion', learnedChapter: 11, source: { type: 'inference', sourceChapter: 11, basisFactIds: ['existing'] }, status: 'active' }], factChanges: [{ id: 'existing', text: 'Existing', establishedChapter: 11, visibility: 'writer', status: 'active', provenance: provenance(11, 'c11') }] }],
    ])('rejects unsafe knowledge: %s', (_label, changes) => {
        const original = stateAt10(); const snapshot = JSON.stringify(original);
        expect(() => applyStoryStateDelta(control, original, delta(11, 10, changes as Partial<StoryStateDelta>))).toThrow(StoryStateTransitionError);
        expect(JSON.stringify(original)).toBe(snapshot);
    });

    it('rejects the whole delta when a later operation is invalid', () => {
        const original = stateAt10(); const snapshot = JSON.stringify(original);
        const invalid = delta(11, 10, { factChanges: [{ id: 'would-have-been-added', text: 'Atomic fact', establishedChapter: 11, visibility: 'writer', status: 'active', provenance: provenance(11, 'c11') }], epistemicChanges: [{ id: 'bad', characterId: 'missing', kind: 'known', factId: 'would-have-been-added', learnedChapter: 11, source: { type: 'witnessed', sourceChapter: 11 }, status: 'active' }] });
        expect(() => applyStoryStateDelta(control, original, invalid)).toThrow(StoryStateTransitionError);
        expect(original.ledgers.facts).toEqual([]); expect(JSON.stringify(original)).toBe(snapshot);
    });

    it('fails closed on replay, skip, and backwards chapters', () => {
        const state = stateAt11();
        expect(() => applyStoryStateDelta(control, state, chapter11Delta())).toThrowError(expect.objectContaining({ code: 'CHAPTER_SEQUENCE_VIOLATION' }));
        expect(() => applyStoryStateDelta(control, stateAt10(), delta(12, 10))).toThrowError(expect.objectContaining({ code: 'CHAPTER_SEQUENCE_VIOLATION' }));
        expect(() => applyStoryStateDelta(control, state, delta(10, 11))).toThrowError(expect.objectContaining({ code: 'CHAPTER_SEQUENCE_VIOLATION' }));
    });

    it('rejects conflicting same-chapter projection updates and non-finite resources', () => {
        const base = chapter11Delta() as unknown as Record<string, unknown>;
        expect(() => parseStoryStateDelta({ ...base, locationChanges: [
            { id: 'one', characterId: 'a', location: 'x', sinceChapter: 11, provenance: provenance(11, 'c11') },
            { id: 'two', characterId: 'a', location: 'y', sinceChapter: 11, provenance: provenance(11, 'c11') },
        ] })).toThrowError(expect.objectContaining({ code: 'CONFLICTING_OPERATION' }));
        expect(() => parseStoryStateDelta({ ...base, resourceChanges: [{ id: 'bad-number', characterId: 'a', resourceId: 'money', name: 'Money', quantityDelta: Number.NaN, provenance: provenance(11, 'c11') }] })).toThrowError(expect.objectContaining({ code: 'RESOURCE_VALUE_INVALID' }));
    });

    it('strictly rejects malformed runtime delta fields and enums', () => {
        expect(() => parseStoryStateDelta({ ...chapter11Delta(), hiddenPayload: { prose: 'not allowed' } })).toThrowError(expect.objectContaining({ code: 'INVALID_DELTA' }));
        const malformed = structuredClone(chapter11Delta()) as unknown as { factChanges: { visibility: string }[] };
        malformed.factChanges[0].visibility = 'author-secret';
        expect(() => parseStoryStateDelta(malformed)).toThrowError(expect.objectContaining({ code: 'INVALID_DELTA' }));
    });

    it('rejects internally inconsistent delta time at the parser boundary', () => {
        const base = chapter11Delta();
        const malformed = [
            { ...base, factChanges: [{ ...base.factChanges[0], establishedChapter: 12 }] },
            { ...base, epistemicChanges: [{ ...base.epistemicChanges[0], learnedChapter: 12 }] },
            { ...base, epistemicChanges: [{ ...base.epistemicChanges[0], source: { ...base.epistemicChanges[0].source, sourceChapter: 12 } }] },
            { ...base, locationChanges: [{ ...base.locationChanges[0], sinceChapter: 12 }] },
            { ...base, statusChanges: [{ operation: 'add', record: { id: 'status-wrong-time', characterId: 'a', kind: 'status', state: 'marked', establishedChapter: 12, provenance: provenance(11, 'c11') }, provenance: provenance(11, 'c11') }] },
            { ...base, statusChanges: [{ operation: 'resolve', statusId: 'wound-a', resolvedChapter: 12, provenance: provenance(11, 'c11') }] },
            { ...base, relationshipChanges: [{ ...base.relationshipChanges[0], chapterNumber: 12 }] },
            { ...base, resourceChanges: [{ ...base.resourceChanges[0], provenance: provenance(12, 'future') }] },
            { ...base, continuityChanges: [{ operation: 'open', entry: { ...base.continuityChanges[0].entry!, establishedChapter: 12 }, provenance: provenance(11, 'c11') }] },
            { ...base, continuityChanges: [{ operation: 'resolve', continuityId: 'existing', chapterNumber: 12, provenance: provenance(11, 'c11') }] },
        ];
        malformed.forEach(value => expect(() => parseStoryStateDelta(value)).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' })));
    });

    it('rejects globally duplicated new IDs at the delta parser boundary', () => {
        expect(() => parseStoryStateDelta({ ...chapter11Delta(), factChanges: [{ ...chapter11Delta().factChanges[0], id: 'know-a-letter' }] })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
        expect(() => parseStoryStateDelta({ ...chapter11Delta(), locationChanges: [{ ...chapter11Delta().locationChanges[0], id: 'money-a-11' }] })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
        expect(() => parseStoryStateDelta({ ...chapter11Delta(), statusChanges: [{ operation: 'add', record: { id: 'letter-unopened', characterId: 'a', kind: 'status', state: 'marked', establishedChapter: 11, provenance: provenance(11, 'c11') }, provenance: provenance(11, 'c11') }] })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
        expect(() => parseStoryStateDelta({ ...chapter11Delta(), factChanges: [{ ...chapter11Delta().factChanges[0], id: 'character-state:11:a' }], activationChanges: [{ characterId: 'a', active: true, provenance: provenance(11, 'c11') }] })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
    });

    it('strictly rejects malformed state identity, duplicate IDs, dangling refs, and future data', () => {
        const valid = stateAt11();
        expect(() => parseStoryState({ ...valid, kind: 'writer-memory' }, control)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
        expect(() => parseStoryState({ ...valid, ledgers: { ...valid.ledgers, facts: [valid.ledgers.facts[0], valid.ledgers.facts[0]] } }, control)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
        expect(() => parseStoryState({ ...valid, ledgers: { ...valid.ledgers, locations: [{ ...valid.ledgers.locations[0], id: valid.ledgers.facts[0].id }] } }, control)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
        expect(() => parseStoryState({ ...valid, ledgers: { ...valid.ledgers, epistemic: [{ ...valid.ledgers.epistemic[0], factId: 'missing' }] } }, control)).toThrowError(expect.objectContaining({ code: 'UNKNOWN_FACT' }));
        expect(() => parseStoryState({ ...valid, ledgers: { ...valid.ledgers, facts: [{ ...valid.ledgers.facts[0], establishedChapter: 12 }] } }, control)).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        expect(() => parseStoryState({ ...valid, unexpected: true }, control)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
    });

    it('rejects stale or incomplete character projections in loaded state', () => {
        const state11 = stateAt11(); const staleLocation = state11.projections.characters.map(value => value.characterId === 'a' ? { ...value, currentLocationRecordId: 'loc-a-10' } : value);
        expect(() => parseStoryState({ ...state11, projections: { ...state11.projections, characters: staleLocation } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        const state10 = stateAt10(); const omittedStatus = state10.projections.characters.map(value => value.characterId === 'a' ? { ...value, activeStatusIds: [] } : value);
        expect(() => parseStoryState({ ...state10, projections: { ...state10.projections, characters: omittedStatus } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        const sameChapterLocations = state11.ledgers.locations.map((value, index) => index === 1 ? { ...value, sinceChapter: 10, provenance: provenance(10, 'chapter-10') } : value);
        expect(() => parseStoryState({ ...state11, ledgers: { ...state11.ledgers, locations: sameChapterLocations } }, control)).toThrowError(expect.objectContaining({ code: 'CONFLICTING_OPERATION' }));
    });

    it('rejects stale, ambiguous, or participant-changing relationship history', () => {
        const state = stateAt11(); const old = state.ledgers.relationships[0];
        const stale = state.projections.relationships.map(value => value.id === 'rel-ab' ? { id: value.id, participantIds: old.participantIds, currentState: old.state, lastChangedChapter: old.chapterNumber, currentHistoryId: old.id } : value);
        expect(() => parseStoryState({ ...state, projections: { ...state.projections, relationships: stale } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        const changedParticipants = state.ledgers.relationships.map((value, index) => index === 1 ? { ...value, participantIds: ['a', 'c'] } : value);
        expect(() => parseStoryState({ ...state, ledgers: { ...state.ledgers, relationships: changedParticipants } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        const sameChapter = state.ledgers.relationships.map((value, index) => index === 1 ? { ...value, chapterNumber: 10, provenance: provenance(10, 'chapter-10') } : value);
        expect(() => parseStoryState({ ...state, ledgers: { ...state.ledgers, relationships: sameChapter } }, control)).toThrowError(expect.objectContaining({ code: 'CONFLICTING_OPERATION' }));
    });

    it('rejects stale, mathematically invalid, or broken resource chains', () => {
        const state = stateAt11(); const old = state.ledgers.resources[0];
        const stale = state.projections.resources.map(value => value.resourceId === 'money' ? { ...value, quantity: old.resultingQuantity, lastChangedChapter: old.chapterNumber, currentHistoryId: old.id } : value);
        expect(() => parseStoryState({ ...state, projections: { ...state.projections, resources: stale } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        const badMath = state.ledgers.resources.map((value, index) => index === 1 ? { ...value, resultingQuantity: 999 } : value);
        expect(() => parseStoryState({ ...state, ledgers: { ...state.ledgers, resources: badMath } }, control)).toThrowError(expect.objectContaining({ code: 'RESOURCE_VALUE_INVALID' }));
        const sameChapterResources = state.ledgers.resources.map((value, index) => index === 1 ? { ...value, chapterNumber: 10, provenance: provenance(10, 'chapter-10') } : value);
        expect(() => parseStoryState({ ...state, ledgers: { ...state.ledgers, resources: sameChapterResources } }, control)).toThrowError(expect.objectContaining({ code: 'CONFLICTING_OPERATION' }));
        const state12 = applyStoryStateDelta(control, state, delta(12, 11, { resourceChanges: [{ id: 'money-a-12', characterId: 'a', resourceId: 'money', name: 'Money', nextState: 'secured', provenance: provenance(12, 'c12') }] }));
        const state13 = applyStoryStateDelta(control, state12, delta(13, 12, { resourceChanges: [{ id: 'money-a-13', characterId: 'a', resourceId: 'money', name: 'Money', quantityDelta: -1, provenance: provenance(13, 'c13') }] }));
        const brokenStateChain = state13.ledgers.resources.map(value => value.id === 'money-a-13' ? { ...value, previousState: 'missing', nextState: undefined } : value);
        expect(() => parseStoryState({ ...state13, ledgers: { ...state13.ledgers, resources: brokenStateChain } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
    });

    it('rejects future compatibility notes and stale canonical arc or beat IDs', () => {
        const state = stateAt11();
        expect(() => parseStoryState({ ...state, continuity: { ...state.continuity, notes: [{ text: 'Future truth', visibility: 'writer', establishedChapter: 20 }] } }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        expect(() => parseStoryState({ ...state, currentArcId: 'stale-arc' }, control)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        const controlWithBeat: FullStoryControl = { ...control, beats: [{ id: 'beat-1', arcId: 'arc', order: 1, startChapter: 1, endChapter: 600 }] };
        expect(() => parseStoryState(state, controlWithBeat)).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
    });

    it('applies the same complete epistemic source rules to loaded state', () => {
        const state = stateAt11(); const knowledge = state.ledgers.epistemic[0];
        const futureSourceFact = [{ ...knowledge, source: { type: 'witnessed' as const, sourceChapter: 10, sourceFactId: 'fact-letter' } }];
        expect(() => parseStoryState({ ...state, ledgers: { ...state.ledgers, epistemic: futureSourceFact } }, control)).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        const invalidInference = [...state.ledgers.epistemic, { id: 'belief-b-inference', characterId: 'b', kind: 'believed' as const, claim: 'Derived claim', learnedChapter: 11, source: { type: 'inference' as const, sourceChapter: 11, basisFactIds: ['fact-letter'] }, status: 'active' as const }];
        expect(() => parseStoryState({ ...state, ledgers: { ...state.ledgers, epistemic: invalidInference } }, control)).toThrowError(expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_INVALID' }));
    });

    it('returns copy-safe deterministic queries', () => {
        const state = stateAt11(); const first = getFactsKnownByCharacter(state, 'a', 11); const second = getFactsKnownByCharacter(state, 'a', 11);
        expect(first).toEqual(second); expect(first).not.toBe(second); expect(first[0]).not.toBe(state.ledgers.facts[0]);
    });

    it('fails closed instead of returning a mixed historical snapshot', () => {
        const state = stateAt11(); expect(() => buildStoryStateViewForChapter(state, 10, control)).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        const copy = buildStoryStateViewForChapter(state, 11, control); expect(copy).toEqual(state); expect(copy).not.toBe(state);
    });

    it('remains deterministic across hundreds of pure synthetic transitions', () => {
        let state = createInitialStoryState();
        for (let chapter = 1; chapter <= 300; chapter += 1) {
            state = applyStoryStateDelta(control, state, delta(chapter, chapter - 1, {
                factChanges: [{ id: `fact-${chapter}`, text: `Canonical statement ${chapter}`, establishedChapter: chapter, visibility: 'writer', status: 'active', provenance: provenance(chapter, `chapter-${chapter}`) }],
            }));
        }
        expect(state.currentChapter).toBe(300); expect(state.revision).toBe(300); expect(state.ledgers.facts).toHaveLength(300);
        expect(state.ledgers.facts.map(value => value.id)).toEqual([...state.ledgers.facts].map(value => value.id));
        expect(getFactsKnownByCharacter(state, 'a', 300)).toHaveLength(0);
    });
});
