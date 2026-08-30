import { describe, expect, it } from 'vitest';
import {
    buildWriterSafeContext,
    compileStoryControl,
    createInitialStoryState,
    getAllowedCharactersForChapter,
    getArcForChapter,
    isCharacterDirectAppearanceAllowed,
    isPovAllowed,
    isRelationshipEventAllowed,
    isRevealAllowed,
    StoryBlueprint,
    StoryControlValidationError,
} from '../src/storyEngine';

const makeBlueprint = (): StoryBlueprint => ({
    id: 'generic-long-story',
    engine: { plannedChapterCount: 600 },
    characters: [
        {
            id: 'character-a',
            name: 'Character A',
            availableFromChapter: 1,
            writerProfile: { role: 'traveler' },
            authorNotes: 'internal future for A',
        },
        {
            id: 'character-b',
            name: 'Character B',
            availableFromChapter: 1,
            writerProfile: { role: 'scholar' },
            authorNotes: 'internal future for B',
        },
    ],
    arcs: [
        {
            id: 'arc-current',
            title: 'Current Arc',
            startChapter: 1,
            endChapter: 300,
            writerBrief: 'Solve only the current problem.',
            authorPlan: 'current arc hidden resolution',
        },
        {
            id: 'arc-future',
            title: 'Future Arc Classified Title',
            startChapter: 301,
            endChapter: 600,
            writerBrief: 'Future writer instructions must stay locked.',
            authorPlan: 'future antagonist identity and final truth',
        },
    ],
    beats: [
        {
            id: 'beat-current',
            arcId: 'arc-current',
            order: 1,
            startChapter: 1,
            endChapter: 300,
            writerBrief: 'Current beat only.',
            authorPlan: 'hidden beat resolution',
        },
        {
            id: 'beat-future',
            arcId: 'arc-future',
            order: 2,
            startChapter: 301,
            endChapter: 600,
            writerBrief: 'Future beat instructions.',
            authorPlan: 'future beat truth',
        },
    ],
    reveals: [
        {
            id: 'mastermind-reveal',
            writerText: 'The mastermind is Character Omega.',
            authorNotes: 'Never disclose the backup antagonist plan.',
        },
    ],
    relationshipEvents: [
        {
            id: 'first-meeting',
            relationshipId: 'a-b-relationship',
            eventType: 'meeting',
            participantIds: ['character-a', 'character-b'],
            writerText: 'The two characters may meet now.',
            authorNotes: 'The meeting has a hidden author-only purpose.',
        },
    ],
    gates: {
        characters: [
            { id: 'a-lock', characterId: 'character-a', lockedThroughChapter: 32 },
            { id: 'b-lock', characterId: 'character-b', lockedThroughChapter: 46 },
        ],
        pov: [
            { id: 'a-pov', characterId: 'character-a', lockedThroughChapter: 32 },
            { id: 'b-pov', characterId: 'character-b', lockedThroughChapter: 46 },
        ],
        reveals: [
            { id: 'mastermind-base-gate', revealId: 'mastermind-reveal', allowedFromChapter: 500 },
        ],
        relationships: [
            { id: 'meeting-base-gate', eventId: 'first-meeting', allowedFromChapter: 200 },
        ],
    },
    forbiddenEvents: [
        {
            id: 'meeting-hard-lock',
            eventId: 'first-meeting',
            forbiddenThroughChapter: 218,
            authorReason: 'hard plot boundary',
        },
    ],
    forbiddenReveals: [
        {
            id: 'mastermind-hard-lock',
            revealId: 'mastermind-reveal',
            forbiddenThroughChapter: 560,
            authorReason: 'final mystery boundary',
        },
    ],
    authorOnlySecrets: [
        {
            id: 'mastermind-secret',
            value: 'INTERNAL DOSSIER: Character Omega is the mastermind; backup identity is classified.',
            revealId: 'mastermind-reveal',
            notes: 'Compiler and validators only.',
        },
    ],
    canonRules: [
        {
            id: 'world-rule',
            text: 'Travel requires a gate token.',
            availableFromChapter: 1,
            scope: 'world',
            authorNotes: 'The token has a future hidden origin.',
        },
        {
            id: 'future-canon',
            text: 'Future-only canon truth.',
            availableFromChapter: 301,
            scope: 'canon',
        },
    ],
});

describe('Story Engine V4 deterministic hard gates', () => {
    const control = compileStoryControl(makeBlueprint());

    it('locks character A through chapter 32 and allows direct appearance from 33', () => {
        expect(isCharacterDirectAppearanceAllowed(control, 'character-a', 32)).toBe(false);
        expect(isCharacterDirectAppearanceAllowed(control, 'character-a', 33)).toBe(true);
    });

    it('locks character B through chapter 46 and allows direct appearance from 47', () => {
        expect(isCharacterDirectAppearanceAllowed(control, 'character-b', 46)).toBe(false);
        expect(isCharacterDirectAppearanceAllowed(control, 'character-b', 47)).toBe(true);
        expect(getAllowedCharactersForChapter(control, 46).map(character => character.id)).toEqual(['character-a']);
        expect(getAllowedCharactersForChapter(control, 47).map(character => character.id)).toEqual(['character-a', 'character-b']);
    });

    it('applies the same fail-closed boundary to POV gates', () => {
        expect(isPovAllowed(control, 'character-b', 46)).toBe(false);
        expect(isPovAllowed(control, 'character-b', 47)).toBe(true);
        expect(isPovAllowed(control, 'unknown-character', 999)).toBe(false);
    });

    it('forbids a relationship/meeting event through 218 and allows it from 219', () => {
        expect(isRelationshipEventAllowed(control, 'first-meeting', 218)).toBe(false);
        expect(isRelationshipEventAllowed(control, 'first-meeting', 219)).toBe(true);
    });

    it('forbids the mastermind reveal through 560 and allows it from 561', () => {
        expect(isRevealAllowed(control, 'mastermind-reveal', 560)).toBe(false);
        expect(isRevealAllowed(control, 'mastermind-reveal', 561)).toBe(true);
    });

    it('uses the later, more conservative restriction when gates conflict', () => {
        // Base reveal gate says 500, hard forbidden-through gate says 560 => first allowed 561.
        expect(isRevealAllowed(control, 'mastermind-reveal', 500)).toBe(false);
        expect(isRevealAllowed(control, 'mastermind-reveal', 561)).toBe(true);
        // Base meeting gate says 200, hard event lock says through 218 => first allowed 219.
        expect(isRelationshipEventAllowed(control, 'first-meeting', 200)).toBe(false);
        expect(isRelationshipEventAllowed(control, 'first-meeting', 219)).toBe(true);
    });

    it('fails closed for missing critical gates or invalid chapters', () => {
        expect(isRevealAllowed(control, 'unknown-reveal', 600)).toBe(false);
        expect(isRelationshipEventAllowed(control, 'unknown-event', 600)).toBe(false);
        expect(isCharacterDirectAppearanceAllowed(control, 'character-a', 0)).toBe(false);
    });
});

describe('WriterSafeContext isolation', () => {
    const control = compileStoryControl(makeBlueprint());
    const state = {
        ...createInitialStoryState(560),
        knownCharacterIds: ['character-a', 'character-b'],
        activeCharacterIds: ['character-a', 'character-b'],
        extensions: {
            authorScratchpad: 'INTERNAL DOSSIER: never cross this boundary',
        },
        continuity: {
            pendingThreads: [],
            notes: [{
                text: 'INTERNAL CONTINUITY: future mastermind preparation',
                visibility: 'internal' as const,
                establishedChapter: 1,
            }],
        },
    };

    it('does not contain the actual mastermind secret at chapter 560', () => {
        const safe = buildWriterSafeContext(control, state, 560);
        const serialized = JSON.stringify(safe);
        expect(safe.reveals).toEqual([]);
        expect(serialized).not.toContain('Character Omega is the mastermind');
        expect(serialized).not.toContain('INTERNAL DOSSIER');
        expect(serialized).not.toContain('INTERNAL CONTINUITY');
        expect(serialized).not.toContain('authorOnlySecrets');
        expect(serialized).not.toContain('authorNotes');
        expect(serialized).not.toContain('authorPlan');
        expect(serialized).not.toContain('extensions');
    });

    it('receives only the controlled writer reveal at chapter 561 when its gate permits it', () => {
        const safe = buildWriterSafeContext(control, state, 561);
        const serialized = JSON.stringify(safe);
        expect(safe.reveals).toEqual([
            { id: 'mastermind-reveal', text: 'The mastermind is Character Omega.' },
        ]);
        expect(serialized).not.toContain('backup identity is classified');
        expect(serialized).not.toContain('Never disclose the backup antagonist plan');
    });

    it('does not include future arc, future beat, or future canon data in the current arc', () => {
        const safe = buildWriterSafeContext(control, state, 100);
        const serialized = JSON.stringify(safe);
        expect(safe.arc?.id).toBe('arc-current');
        expect(safe.beat?.id).toBe('beat-current');
        expect(serialized).not.toContain('arc-future');
        expect(serialized).not.toContain('Future Arc Classified Title');
        expect(serialized).not.toContain('beat-future');
        expect(serialized).not.toContain('Future-only canon truth');
        expect(serialized).not.toContain('hidden resolution');
    });
});

describe('StoryControl compiler and arc lookup', () => {
    it('supports a 600-chapter blueprint, normalizes locks, sorts deterministically, and freezes output', () => {
        const control = compileStoryControl(makeBlueprint());
        expect(control.engine.plannedChapterCount).toBe(600);
        expect(control.gates.characters.find(gate => gate.characterId === 'character-a')?.allowedFromChapter).toBe(33);
        expect(control.gates.characters.find(gate => gate.characterId === 'character-b')?.allowedFromChapter).toBe(47);
        expect(Object.isFrozen(control)).toBe(true);
        expect(Object.isFrozen(control.authorOnlySecrets)).toBe(true);
        expect(compileStoryControl(makeBlueprint())).toEqual(control);
    });

    it('returns only the unique arc for a chapter', () => {
        const control = compileStoryControl(makeBlueprint());
        expect(getArcForChapter(control, 300)?.id).toBe('arc-current');
        expect(getArcForChapter(control, 301)?.id).toBe('arc-future');
        expect(getArcForChapter(control, 601)).toBeUndefined();
    });

    it('rejects contradictory overlapping arc data during compilation', () => {
        const blueprint = makeBlueprint();
        expect(() => compileStoryControl({
            ...blueprint,
            arcs: [
                blueprint.arcs![0],
                { ...blueprint.arcs![1], startChapter: 300 },
            ],
        })).toThrow(StoryControlValidationError);
    });
});
