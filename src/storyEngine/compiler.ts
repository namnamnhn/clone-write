import {
    AuthorOnlySecret,
    CanonRule,
    ControlledCharacter,
    ForbiddenEvent,
    ForbiddenReveal,
    FullStoryControl,
    RelationshipEventDefinition,
    RevealDefinition,
    StoryArc,
    StoryBeat,
    WriterCharacterProfile,
} from './types';
import {
    deepFreezeStoryControl,
    isValidChapter,
    StoryControlValidationError,
    validateFullStoryControl,
} from './storyControl';

export interface GateTimingInput {
    /** Inclusive first allowed chapter. */
    readonly allowedFromChapter?: number;
    /** Inclusive last forbidden chapter. Compiles to lockedThroughChapter + 1. */
    readonly lockedThroughChapter?: number;
}

export interface CharacterBlueprint extends GateTimingInput {
    readonly id: string;
    readonly name: string;
    /** Character-friendly alias for allowedFromChapter. */
    readonly availableFromChapter?: number;
    readonly writerProfile?: WriterCharacterProfile;
    readonly authorNotes?: string;
}

export interface CharacterGateBlueprint extends GateTimingInput {
    readonly id: string;
    readonly characterId: string;
}

export interface PovGateBlueprint extends GateTimingInput {
    readonly id: string;
    readonly characterId: string;
}

export interface RevealGateBlueprint extends GateTimingInput {
    readonly id: string;
    readonly revealId: string;
}

export interface RelationshipGateBlueprint extends GateTimingInput {
    readonly id: string;
    readonly eventId: string;
}

export interface StoryBlueprint {
    readonly id: string;
    readonly engine: {
        readonly plannedChapterCount: number;
    };
    readonly characters: readonly CharacterBlueprint[];
    readonly arcs?: readonly StoryArc[];
    readonly beats?: readonly StoryBeat[];
    readonly reveals?: readonly RevealDefinition[];
    readonly relationshipEvents?: readonly RelationshipEventDefinition[];
    readonly gates?: {
        readonly characters?: readonly CharacterGateBlueprint[];
        readonly pov?: readonly PovGateBlueprint[];
        readonly reveals?: readonly RevealGateBlueprint[];
        readonly relationships?: readonly RelationshipGateBlueprint[];
    };
    readonly forbiddenEvents?: readonly ForbiddenEvent[];
    readonly forbiddenReveals?: readonly ForbiddenReveal[];
    readonly authorOnlySecrets?: readonly AuthorOnlySecret[];
    readonly canonRules?: readonly CanonRule[];
}

export class StoryControlCompileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StoryControlCompileError';
    }
}

const requireId = (value: string, path: string): string => {
    const normalized = value.trim();
    if (!normalized) throw new StoryControlCompileError(`${path} must not be empty`);
    return normalized;
};

/** Resolve contradictory restrictions conservatively by taking the latest boundary. */
const compileAllowedFrom = (timing: GateTimingInput, path: string): number => {
    const candidates: number[] = [];
    if (timing.allowedFromChapter !== undefined) candidates.push(timing.allowedFromChapter);
    if (timing.lockedThroughChapter !== undefined) {
        if (!Number.isSafeInteger(timing.lockedThroughChapter) || timing.lockedThroughChapter < 0) {
            throw new StoryControlCompileError(`${path}.lockedThroughChapter must be a non-negative integer`);
        }
        candidates.push(timing.lockedThroughChapter + 1);
    }
    if (candidates.length === 0 || candidates.some(chapter => !isValidChapter(chapter))) {
        throw new StoryControlCompileError(`${path} requires a valid allowedFromChapter or lockedThroughChapter`);
    }
    return Math.max(...candidates);
};

const assertUniqueIds = (values: readonly { readonly id: string }[], path: string): void => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        const id = requireId(value.id, `${path}.${index}.id`);
        if (seen.has(id)) throw new StoryControlCompileError(`${path}.${index}.id duplicates ${id}`);
        seen.add(id);
    });
};

const byChapterThenId = <T extends { readonly id: string; readonly startChapter: number }>(left: T, right: T) =>
    left.startChapter - right.startChapter || left.id.localeCompare(right.id);

const byAllowedThenId = <T extends { readonly id: string; readonly allowedFromChapter: number }>(left: T, right: T) =>
    left.allowedFromChapter - right.allowedFromChapter || left.id.localeCompare(right.id);

/**
 * Compile a serializable author blueprint into deterministic, immutable StoryControl data.
 * No model call, current time, random id, or story-specific rule participates in compilation.
 */
export const compileStoryControl = (blueprint: StoryBlueprint): FullStoryControl => {
    requireId(blueprint.id, 'id');
    if (!isValidChapter(blueprint.engine.plannedChapterCount)) {
        throw new StoryControlCompileError('engine.plannedChapterCount must be a positive integer');
    }
    assertUniqueIds(blueprint.characters, 'characters');

    const characters: Record<string, ControlledCharacter> = {};
    const compiledCharacters = blueprint.characters.map((input, index): ControlledCharacter => {
        const availableFromChapter = compileAllowedFrom({
            allowedFromChapter: input.availableFromChapter === undefined
                ? input.allowedFromChapter
                : Math.max(input.availableFromChapter, input.allowedFromChapter ?? 1),
            lockedThroughChapter: input.lockedThroughChapter,
        }, `characters.${index}`);
        const character: ControlledCharacter = {
            id: requireId(input.id, `characters.${index}.id`),
            name: requireId(input.name, `characters.${index}.name`),
            initialStatus: availableFromChapter === 1 ? 'active' : 'future-locked',
            availableFromChapter,
            writerProfile: { ...(input.writerProfile ?? {}) },
            ...(input.authorNotes === undefined ? {} : { authorNotes: input.authorNotes }),
        };
        characters[character.id] = character;
        return character;
    }).sort((left, right) => left.id.localeCompare(right.id));

    const arcs = [...(blueprint.arcs ?? [])].sort(byChapterThenId);
    const beats = [...(blueprint.beats ?? [])].sort((left, right) =>
        left.startChapter - right.startChapter || left.order - right.order || left.id.localeCompare(right.id));
    const reveals = [...(blueprint.reveals ?? [])].sort((left, right) => left.id.localeCompare(right.id));
    const relationshipEvents = [...(blueprint.relationshipEvents ?? [])].sort((left, right) => left.id.localeCompare(right.id));

    [arcs, beats, reveals, relationshipEvents, blueprint.forbiddenEvents ?? [], blueprint.forbiddenReveals ?? [], blueprint.authorOnlySecrets ?? [], blueprint.canonRules ?? []]
        .forEach((values, index) => assertUniqueIds(values, ['arcs', 'beats', 'reveals', 'relationshipEvents', 'forbiddenEvents', 'forbiddenReveals', 'authorOnlySecrets', 'canonRules'][index]));

    const characterGates = (blueprint.gates?.characters ?? []).map((gate, index) => ({
        id: requireId(gate.id, `gates.characters.${index}.id`),
        characterId: requireId(gate.characterId, `gates.characters.${index}.characterId`),
        allowedFromChapter: compileAllowedFrom(gate, `gates.characters.${index}`),
    })).sort(byAllowedThenId);
    const povGates = (blueprint.gates?.pov ?? []).map((gate, index) => ({
        id: requireId(gate.id, `gates.pov.${index}.id`),
        characterId: requireId(gate.characterId, `gates.pov.${index}.characterId`),
        allowedFromChapter: compileAllowedFrom(gate, `gates.pov.${index}`),
    })).sort(byAllowedThenId);
    const revealGates = (blueprint.gates?.reveals ?? []).map((gate, index) => ({
        id: requireId(gate.id, `gates.reveals.${index}.id`),
        revealId: requireId(gate.revealId, `gates.reveals.${index}.revealId`),
        allowedFromChapter: compileAllowedFrom(gate, `gates.reveals.${index}`),
    })).sort(byAllowedThenId);
    const relationshipGates = (blueprint.gates?.relationships ?? []).map((gate, index) => ({
        id: requireId(gate.id, `gates.relationships.${index}.id`),
        eventId: requireId(gate.eventId, `gates.relationships.${index}.eventId`),
        allowedFromChapter: compileAllowedFrom(gate, `gates.relationships.${index}`),
    })).sort(byAllowedThenId);
    [characterGates, povGates, revealGates, relationshipGates].forEach((values, index) =>
        assertUniqueIds(values, ['gates.characters', 'gates.pov', 'gates.reveals', 'gates.relationships'][index]));

    const control: FullStoryControl = {
        kind: 'full-story-control',
        id: blueprint.id.trim(),
        engine: {
            schemaVersion: 4,
            plannedChapterCount: blueprint.engine.plannedChapterCount,
            failClosed: true,
            unknownCharacterPolicy: 'deny',
            missingGatePolicy: 'deny',
        },
        characters,
        characterOrder: compiledCharacters.map(character => character.id),
        arcs,
        beats,
        reveals,
        relationshipEvents,
        gates: {
            characters: characterGates,
            pov: povGates,
            reveals: revealGates,
            relationships: relationshipGates,
        },
        forbiddenEvents: [...(blueprint.forbiddenEvents ?? [])].sort((left, right) => left.forbiddenThroughChapter - right.forbiddenThroughChapter || left.id.localeCompare(right.id)),
        forbiddenReveals: [...(blueprint.forbiddenReveals ?? [])].sort((left, right) => left.forbiddenThroughChapter - right.forbiddenThroughChapter || left.id.localeCompare(right.id)),
        authorOnlySecrets: [...(blueprint.authorOnlySecrets ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
        canonRules: [...(blueprint.canonRules ?? [])].sort((left, right) => left.availableFromChapter - right.availableFromChapter || left.id.localeCompare(right.id)),
    };

    const issues = validateFullStoryControl(control);
    if (issues.length > 0) throw new StoryControlValidationError(issues);
    return deepFreezeStoryControl(control);
};
