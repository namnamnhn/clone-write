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
        future: { id: 'future', name: 'Future', initialStatus: 'future-locked', availableFromChapter: 50, writerProfile: {} },
    },
    characterOrder: ['a', 'b', 'future'], arcs: [{ id: 'arc', title: 'Arc', startChapter: 1, endChapter: 600 }], beats: [],
    reveals: [], relationshipEvents: [], storyEvents: [], gates: { characters: [], pov: [], reveals: [], relationships: [], events: [] },
    forbiddenEvents: [], forbiddenRelationshipEvents: [], forbiddenReveals: [], authorOnlySecrets: [], canonRules: [],
};

const provenance = (chapter: number, sourceId: string) => ({ sourceChapter: chapter, sourceType: 'chapter' as const, sourceId });

const delta = (chapter: number, revision: number, values: Partial<StoryStateDelta> = {}): StoryStateDelta => ({
    kind: 'story-state-delta', schemaVersion: 1, chapterNumber: chapter, expectedRevision: revision,
    factChanges: [], epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [],
    relationshipChanges: [], resourceChanges: [], continuityChanges: [], ...values,
});

const chapter10Delta = (): StoryStateDelta => delta(10, 0, {
    activationChanges: [
        { characterId: 'a', active: true, lifeStatus: 'alive', provenance: provenance(10, 'chapter-10') },
        { characterId: 'b', active: true, lifeStatus: 'alive', provenance: provenance(10, 'chapter-10') },
    ],
    locationChanges: [{ id: 'loc-a-10', characterId: 'a', location: 'capital', sinceChapter: 10, provenance: provenance(10, 'chapter-10') }],
    statusChanges: [{ operation: 'add', record: { id: 'wound-a', characterId: 'a', kind: 'injury', state: 'wounded', establishedChapter: 10, provenance: provenance(10, 'chapter-10') }, provenance: provenance(10, 'chapter-10') }],
    relationshipChanges: [{ id: 'rel-ab-10', relationshipId: 'rel-ab', participantIds: ['a', 'b'], state: 'distrust', chapterNumber: 10, provenance: provenance(10, 'chapter-10') }],
    resourceChanges: [{ id: 'money-a-10', characterId: 'a', resourceId: 'money', name: 'Money', quantityDelta: 100, provenance: provenance(10, 'chapter-10') }],
});

const chapter11Delta = (): StoryStateDelta => delta(11, 1, {
    factChanges: [{ id: 'fact-letter', text: 'The letter names the envoy.', establishedChapter: 11, visibility: 'writer', status: 'active', provenance: provenance(11, 'chapter-11') }],
    epistemicChanges: [{ id: 'know-a-letter', characterId: 'a', kind: 'known', factId: 'fact-letter', learnedChapter: 11, source: { type: 'told-by-character', sourceCharacterId: 'b', sourceChapter: 11 }, status: 'active' }],
    locationChanges: [{ id: 'loc-a-11', characterId: 'a', location: 'river port', sinceChapter: 11, provenance: provenance(11, 'chapter-11') }],
    statusChanges: [{ operation: 'resolve', statusId: 'wound-a', resolvedChapter: 11, provenance: provenance(11, 'chapter-11') }],
    relationshipChanges: [{ id: 'rel-ab-11', relationshipId: 'rel-ab', participantIds: ['a', 'b'], state: 'uneasy cooperation', chapterNumber: 11, provenance: provenance(11, 'chapter-11') }],
    resourceChanges: [{ id: 'money-a-11', characterId: 'a', resourceId: 'money', name: 'Money', quantityDelta: -25, provenance: provenance(11, 'chapter-11') }],
    continuityChanges: [{ operation: 'open', entry: { id: 'letter-unopened', kind: 'obligation', text: 'Letter remains unopened.', visibility: 'writer', establishedChapter: 11, status: 'open', provenance: provenance(11, 'chapter-11') }, provenance: provenance(11, 'chapter-11') }],
});

const stateAt10 = (): StoryState => applyStoryStateDelta(control, createInitialStoryState(9), chapter10Delta());
const stateAt11 = (): StoryState => applyStoryStateDelta(control, stateAt10(), chapter11Delta());

describe('StoryState V4 canonical ledgers', () => {
    it('applies a sequential chapter atomically and preserves immutable history', () => {
        const before = stateAt10(); const beforeJson = JSON.stringify(before); const input = chapter11Delta(); const inputJson = JSON.stringify(input);
        const next = applyStoryStateDelta(control, before, input);
        expect(next).not.toBe(before); expect(next.currentChapter).toBe(11); expect(next.revision).toBe(2);
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
        const state = applyStoryStateDelta(control, stateAt11(), delta(12, 2, {
            epistemicChanges: [{ id: 'belief-a-traitor', characterId: 'a', kind: 'believed', claim: 'B is the traitor.', learnedChapter: 12, source: { type: 'witnessed', sourceChapter: 12 }, status: 'active' }],
        }));
        expect(getCharacterBeliefs(state, 'a', 12)[0].claim).toBe('B is the traitor.');
        expect(state.ledgers.facts.some(value => value.text === 'B is the traitor.')).toBe(false);
    });

    it('resolves continuity without deleting history', () => {
        const state = applyStoryStateDelta(control, stateAt11(), delta(12, 2, { continuityChanges: [{ operation: 'resolve', continuityId: 'letter-unopened', chapterNumber: 12, provenance: provenance(12, 'chapter-12') }] }));
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
    ])('rejects unsafe knowledge: %s', (_label, changes) => {
        const original = stateAt10(); const snapshot = JSON.stringify(original);
        expect(() => applyStoryStateDelta(control, original, delta(11, 1, changes as Partial<StoryStateDelta>))).toThrow(StoryStateTransitionError);
        expect(JSON.stringify(original)).toBe(snapshot);
    });

    it('rejects the whole delta when a later operation is invalid', () => {
        const original = stateAt10(); const snapshot = JSON.stringify(original);
        const invalid = delta(11, 1, { factChanges: [{ id: 'would-have-been-added', text: 'Atomic fact', establishedChapter: 11, visibility: 'writer', status: 'active', provenance: provenance(11, 'c11') }], epistemicChanges: [{ id: 'bad', characterId: 'missing', kind: 'known', factId: 'would-have-been-added', learnedChapter: 11, source: { type: 'witnessed', sourceChapter: 11 }, status: 'active' }] });
        expect(() => applyStoryStateDelta(control, original, invalid)).toThrow(StoryStateTransitionError);
        expect(original.ledgers.facts).toEqual([]); expect(JSON.stringify(original)).toBe(snapshot);
    });

    it('fails closed on replay, skip, and backwards chapters', () => {
        const state = stateAt11();
        expect(() => applyStoryStateDelta(control, state, chapter11Delta())).toThrowError(expect.objectContaining({ code: 'CHAPTER_SEQUENCE_VIOLATION' }));
        expect(() => applyStoryStateDelta(control, stateAt10(), delta(12, 1))).toThrowError(expect.objectContaining({ code: 'CHAPTER_SEQUENCE_VIOLATION' }));
        expect(() => applyStoryStateDelta(control, state, delta(10, 2))).toThrowError(expect.objectContaining({ code: 'CHAPTER_SEQUENCE_VIOLATION' }));
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

    it('strictly rejects malformed state identity, duplicate IDs, dangling refs, and future data', () => {
        const valid = stateAt11();
        expect(() => parseStoryState({ ...valid, kind: 'writer-memory' }, control)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
        expect(() => parseStoryState({ ...valid, ledgers: { ...valid.ledgers, facts: [valid.ledgers.facts[0], valid.ledgers.facts[0]] } }, control)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
        expect(() => parseStoryState({ ...valid, ledgers: { ...valid.ledgers, locations: [{ ...valid.ledgers.locations[0], id: valid.ledgers.facts[0].id }] } }, control)).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
        expect(() => parseStoryState({ ...valid, ledgers: { ...valid.ledgers, epistemic: [{ ...valid.ledgers.epistemic[0], factId: 'missing' }] } }, control)).toThrowError(expect.objectContaining({ code: 'UNKNOWN_FACT' }));
        expect(() => parseStoryState({ ...valid, ledgers: { ...valid.ledgers, facts: [{ ...valid.ledgers.facts[0], establishedChapter: 12 }] } }, control)).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        expect(() => parseStoryState({ ...valid, unexpected: true }, control)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
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
        let state = createInitialStoryState(1);
        for (let chapter = 2; chapter <= 300; chapter += 1) {
            state = applyStoryStateDelta(control, state, delta(chapter, chapter - 2, {
                factChanges: [{ id: `fact-${chapter}`, text: `Canonical statement ${chapter}`, establishedChapter: chapter, visibility: 'writer', status: 'active', provenance: provenance(chapter, `chapter-${chapter}`) }],
            }));
        }
        expect(state.currentChapter).toBe(300); expect(state.ledgers.facts).toHaveLength(299);
        expect(state.ledgers.facts.map(value => value.id)).toEqual([...state.ledgers.facts].map(value => value.id));
        expect(getFactsKnownByCharacter(state, 'a', 300)).toHaveLength(0);
    });
});
