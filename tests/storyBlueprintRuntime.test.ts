import { describe, expect, it } from 'vitest';
import {
    StoryBlueprintDocument,
    StoryBlueprintParseError,
    createEmptyNarrativeMemoryState,
    createV4ProjectSeed,
    parseStoryBlueprint,
    parseStoryBlueprintDocument,
    parseStoryBlueprintJson,
} from '../src/storyEngine';

const minimalDocument = (): StoryBlueprintDocument => ({
    kind: 'story-blueprint-document',
    formatVersion: 1,
    blueprint: {
        id: 'production-story',
        engine: { plannedChapterCount: 3 },
        characters: [{ id: 'hero', name: 'Hero', availableFromChapter: 1 }],
        arcs: [{ id: 'arc-1', title: 'Opening', startChapter: 1, endChapter: 3 }],
        gates: { pov: [{ id: 'hero-pov', characterId: 'hero', allowedFromChapter: 1 }] },
    },
});

const fullDocument = (): StoryBlueprintDocument => ({
    kind: 'story-blueprint-document', formatVersion: 1,
    blueprint: {
        id: 'full-production-story', engine: { plannedChapterCount: 10 },
        characters: [
            { id: 'a', name: 'A', availableFromChapter: 1, writerProfile: { role: 'lead', publicFacts: ['Public role.'] }, authorNotes: 'private' },
            { id: 'b', name: 'B', lockedThroughChapter: 1 },
        ],
        arcs: [{ id: 'arc', title: 'Arc', startChapter: 1, endChapter: 10, writerBrief: 'Advance carefully.', authorPlan: 'Private arc.' }],
        beats: [{ id: 'beat', arcId: 'arc', order: 1, startChapter: 1, endChapter: 10, writerBrief: 'Opening beat.', authorPlan: 'Private beat.' }],
        reveals: [{ id: 'reveal', writerText: 'The public wording.', authorNotes: 'private reveal note' }],
        relationshipDefinitions: [{
            id: 'a-b', participantIds: ['a', 'b'], categories: ['professional'], initialRomanceMilestone: 'none',
            dynamicProfile: {
                coreDynamicTags: ['professional-equals'], dominantConflictSources: ['Duty'],
                trustBasis: ['Evidence'], respectBasis: ['Competence'], prohibitedShortcuts: ['confession'],
            },
            progressionPolicy: {
                maxMajorMilestoneAdvancePerChapter: 1, maxConsecutiveProgressionChapters: 2,
                requireCanonicalBasis: true, requireMutualAgencyForMutualMilestone: true,
            },
        }],
        relationshipEvents: [{ id: 'meeting', relationshipId: 'a-b', eventType: 'cooperate', participantIds: ['a', 'b'], writerText: 'They may cooperate.' }],
        storyEvents: [{ id: 'vote', eventType: 'vote', writerText: 'A vote may occur.' }],
        gates: {
            characters: [{ id: 'b-character', characterId: 'b', allowedFromChapter: 2 }],
            pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }],
            reveals: [{ id: 'reveal-gate', revealId: 'reveal', allowedFromChapter: 3 }],
            relationships: [{ id: 'meeting-gate', eventId: 'meeting', allowedFromChapter: 2 }],
            events: [{ id: 'vote-gate', eventId: 'vote', allowedFromChapter: 4 }],
        },
        forbiddenEvents: [{ id: 'vote-lock', eventId: 'vote', forbiddenThroughChapter: 3, authorReason: 'later' }],
        forbiddenRelationshipEvents: [{ id: 'meeting-lock', eventId: 'meeting', forbiddenThroughChapter: 1 }],
        forbiddenReveals: [{ id: 'reveal-lock', revealId: 'reveal', forbiddenThroughChapter: 2 }],
        authorOnlySecrets: [{ id: 'secret', value: 'RAW_AUTHOR_SECRET', revealId: 'reveal', notes: 'private' }],
        canonRules: [{ id: 'rule', text: 'Promises have consequences.', availableFromChapter: 1, expiresAfterChapter: 10, scope: 'canon', authorNotes: 'private' }],
    },
});

describe('WORK 12 strict serialized StoryBlueprint boundary', () => {
    it('creates only story-bound empty narrative memory', () => {
        expect(createEmptyNarrativeMemoryState('story-owner')).toEqual({
            kind: 'narrative-memory-state', storyControlId: 'story-owner', records: [],
        });
        expect(() => createEmptyNarrativeMemoryState('')).toThrow(/non-empty/);
    });

    it('parses a valid minimal V4 setup document into a fresh value', () => {
        const input = minimalDocument();
        const parsed = parseStoryBlueprintDocument(input);
        expect(parsed).toEqual(input);
        expect(parsed).not.toBe(input);
        expect(parsed.blueprint).not.toBe(input.blueprint);
    });

    it('parses every currently supported full setup domain', () => {
        expect(parseStoryBlueprintDocument(fullDocument())).toEqual(fullDocument());
    });

    it('accepts exactly one strict JSON document', () => {
        expect(parseStoryBlueprintJson(JSON.stringify(minimalDocument()))).toEqual(minimalDocument());
    });

    it.each([
        ['', 'must not be empty'],
        ['{', 'valid JSON'],
        ['```json\n{}\n```', 'valid JSON'],
        [`${JSON.stringify(minimalDocument())} {}`, 'valid JSON'],
    ])('rejects invalid JSON text %#', (source, message) => {
        expect(() => parseStoryBlueprintJson(source)).toThrow(message);
    });

    it('rejects unknown document and blueprint keys', () => {
        expect(() => parseStoryBlueprintDocument({ ...minimalDocument(), extra: true })).toThrow(/document.extra/);
        expect(() => parseStoryBlueprintDocument({ ...minimalDocument(), blueprint: { ...minimalDocument().blueprint, extra: true } })).toThrow(/blueprint.extra/);
    });

    it('rejects unknown nested keys instead of casting', () => {
        const document = minimalDocument();
        expect(() => parseStoryBlueprintDocument({
            ...document,
            blueprint: { ...document.blueprint, characters: [{ ...document.blueprint.characters[0], privateLeak: true }] },
        })).toThrow(/privateLeak/);
    });

    it.each([
        [{ ...minimalDocument().blueprint, engine: { plannedChapterCount: 0 } }, 'plannedChapterCount'],
        [{ ...minimalDocument().blueprint, engine: { plannedChapterCount: Number.POSITIVE_INFINITY } }, 'plannedChapterCount'],
        [{ ...minimalDocument().blueprint, characters: [{ id: 'hero', name: 'Hero' }] }, 'availability timing'],
        [{ ...minimalDocument().blueprint, characters: [{ id: 'hero', name: '', availableFromChapter: 1 }] }, 'name'],
        [{ ...minimalDocument().blueprint, arcs: [{ id: 'arc', title: 'Arc', startChapter: 1.5, endChapter: 3 }] }, 'startChapter'],
        [{ ...minimalDocument().blueprint, gates: { pov: [{ id: 'pov', characterId: 'hero' }] } }, 'requires allowedFromChapter'],
        [{ ...minimalDocument().blueprint, canonRules: [{ id: 'rule', text: 'Rule', availableFromChapter: 1, scope: 'bad' }] }, 'unsupported'],
    ])('rejects malformed blueprint runtime shape %#', (blueprint, message) => {
        expect(() => parseStoryBlueprint(blueprint)).toThrow(message as string);
    });

    it('rejects duplicate IDs at the runtime boundary', () => {
        const blueprint = minimalDocument().blueprint;
        expect(() => parseStoryBlueprint({ ...blueprint, characters: [blueprint.characters[0], blueprint.characters[0]] }))
            .toThrow(/duplicates hero/);
    });

    it('rejects malformed relationship definitions and events', () => {
        const full = fullDocument();
        const definition = full.blueprint.relationshipDefinitions![0];
        const badDefinition = { ...full, blueprint: { ...full.blueprint, relationshipDefinitions: [{
            ...definition, progressionPolicy: { ...definition.progressionPolicy, maxMajorMilestoneAdvancePerChapter: 0 },
        }] } };
        expect(() => parseStoryBlueprintDocument(badDefinition)).toThrow(/maxMajorMilestoneAdvancePerChapter/);
        const badEvent = { ...full, blueprint: { ...full.blueprint, relationshipEvents: [{
            ...full.blueprint.relationshipEvents![0], participantIds: ['a', 'a'],
        }] } };
        expect(() => parseStoryBlueprintDocument(badEvent)).toThrow(/duplicates/);
    });

    it('rejects semantically malformed arcs, references, and timing before seeding a project', () => {
        const source = minimalDocument();
        const reversed = { ...source, blueprint: { ...source.blueprint, arcs: [{ ...source.blueprint.arcs![0], endChapter: 0 }] } };
        expect(() => createV4ProjectSeed(reversed)).toThrow();
        const unknownCharacter = { ...source, blueprint: { ...source.blueprint, gates: {
            ...source.blueprint.gates, pov: [{ ...source.blueprint.gates!.pov![0], characterId: 'missing' }],
        } } };
        expect(() => createV4ProjectSeed(unknownCharacter)).toThrow();
    });

    it('compiles a strict C0/rev0 V4 seed with empty in-memory narrative memory', () => {
        const seed = createV4ProjectSeed(minimalDocument());
        expect(seed.control).toMatchObject({ kind: 'full-story-control', id: 'production-story', engine: { schemaVersion: 4 } });
        expect(seed.state).toMatchObject({ kind: 'story-state', currentChapter: 0, revision: 0 });
        expect(seed.memory).toEqual({ kind: 'narrative-memory-state', storyControlId: seed.control.id, records: [] });
    });

    it('uses dedicated safe parse errors for runtime shape failures', () => {
        expect(() => parseStoryBlueprintDocument({})).toThrow(StoryBlueprintParseError);
    });
});
