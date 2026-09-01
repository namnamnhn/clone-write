import {
    AuthorOnlySecret,
    CanonRule,
    ControlledCharacter,
    ForbiddenEvent,
    ForbiddenRelationshipEvent,
    ForbiddenReveal,
    FullStoryControl,
    RelationshipEventDefinition,
    RevealDefinition,
    StoryArc,
    StoryBeat,
    StoryEventDefinition,
    WriterCharacterProfile,
} from './types';
import type { RelationshipDefinition } from './relationshipTypes';
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

export interface StoryEventGateBlueprint extends GateTimingInput {
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
    readonly relationshipDefinitions?: readonly RelationshipDefinition[];
    readonly relationshipEvents?: readonly RelationshipEventDefinition[];
    readonly storyEvents?: readonly StoryEventDefinition[];
    readonly gates?: {
        readonly characters?: readonly CharacterGateBlueprint[];
        readonly pov?: readonly PovGateBlueprint[];
        readonly reveals?: readonly RevealGateBlueprint[];
        readonly relationships?: readonly RelationshipGateBlueprint[];
        readonly events?: readonly StoryEventGateBlueprint[];
    };
    readonly forbiddenEvents?: readonly ForbiddenEvent[];
    readonly forbiddenRelationshipEvents?: readonly ForbiddenRelationshipEvent[];
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

const cloneWriterProfile = (profile: WriterCharacterProfile | undefined): WriterCharacterProfile => ({
    ...(profile?.role === undefined ? {} : { role: profile.role }),
    ...(profile?.appearance === undefined ? {} : { appearance: profile.appearance }),
    ...(profile?.personality === undefined ? {} : { personality: profile.personality }),
    ...(profile?.publicFacts === undefined ? {} : { publicFacts: [...profile.publicFacts] }),
});

const cloneArc = (arc: StoryArc): StoryArc => ({
    id: arc.id,
    title: arc.title,
    startChapter: arc.startChapter,
    endChapter: arc.endChapter,
    ...(arc.writerBrief === undefined ? {} : { writerBrief: arc.writerBrief }),
    ...(arc.authorPlan === undefined ? {} : { authorPlan: arc.authorPlan }),
});

const cloneBeat = (beat: StoryBeat): StoryBeat => ({
    id: beat.id,
    arcId: beat.arcId,
    order: beat.order,
    startChapter: beat.startChapter,
    endChapter: beat.endChapter,
    ...(beat.writerBrief === undefined ? {} : { writerBrief: beat.writerBrief }),
    ...(beat.authorPlan === undefined ? {} : { authorPlan: beat.authorPlan }),
});

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

    const configuredCharacterBoundaries = new Map<string, number>();
    blueprint.characters.forEach((input, index) => {
        configuredCharacterBoundaries.set(input.id, compileAllowedFrom({
            allowedFromChapter: input.availableFromChapter === undefined
                ? input.allowedFromChapter
                : Math.max(input.availableFromChapter, input.allowedFromChapter ?? 1),
            lockedThroughChapter: input.lockedThroughChapter,
        }, `characters.${index}`));
    });

    const explicitCharacterGates = (blueprint.gates?.characters ?? []).map((gate, index) => ({
        id: requireId(gate.id, `gates.characters.${index}.id`),
        characterId: requireId(gate.characterId, `gates.characters.${index}.characterId`),
        allowedFromChapter: compileAllowedFrom(gate, `gates.characters.${index}`),
    })).sort(byAllowedThenId);
    const materializedCharacterGates = blueprint.characters.map((character, index) => ({
        id: `character-timing:${requireId(character.id, `characters.${index}.id`)}`,
        characterId: requireId(character.id, `characters.${index}.id`),
        allowedFromChapter: configuredCharacterBoundaries.get(character.id)!,
    }));
    const characterGates = [...materializedCharacterGates, ...explicitCharacterGates].sort(byAllowedThenId);
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
    const eventGates = (blueprint.gates?.events ?? []).map((gate, index) => ({
        id: requireId(gate.id, `gates.events.${index}.id`),
        eventId: requireId(gate.eventId, `gates.events.${index}.eventId`),
        allowedFromChapter: compileAllowedFrom(gate, `gates.events.${index}`),
    })).sort(byAllowedThenId);
    [characterGates, povGates, revealGates, relationshipGates, eventGates].forEach((values, index) =>
        assertUniqueIds(values, ['gates.characters', 'gates.pov', 'gates.reveals', 'gates.relationships', 'gates.events'][index]));

    const effectiveCharacterBoundaries = new Map<string, number>();
    blueprint.characters.forEach((character) => {
        const boundaries = characterGates
            .filter(gate => gate.characterId === character.id)
            .map(gate => gate.allowedFromChapter);
        effectiveCharacterBoundaries.set(character.id, Math.max(...boundaries));
    });
    const compiledCharacters = blueprint.characters.map((input, index): ControlledCharacter => {
        const availableFromChapter = effectiveCharacterBoundaries.get(input.id)!;
        return {
            id: requireId(input.id, `characters.${index}.id`),
            name: requireId(input.name, `characters.${index}.name`),
            initialStatus: availableFromChapter === 1 ? 'active' : 'future-locked',
            availableFromChapter,
            writerProfile: cloneWriterProfile(input.writerProfile),
            ...(input.authorNotes === undefined ? {} : { authorNotes: input.authorNotes }),
        };
    }).sort((left, right) => left.id.localeCompare(right.id));
    const characters: Record<string, ControlledCharacter> = {};
    compiledCharacters.forEach(character => { characters[character.id] = character; });

    const arcs = (blueprint.arcs ?? []).map(cloneArc).sort(byChapterThenId);
    const beats = (blueprint.beats ?? []).map(cloneBeat).sort((left, right) =>
        left.startChapter - right.startChapter || left.order - right.order || left.id.localeCompare(right.id));
    const reveals = (blueprint.reveals ?? []).map(reveal => ({
        id: reveal.id,
        writerText: reveal.writerText,
        ...(reveal.authorNotes === undefined ? {} : { authorNotes: reveal.authorNotes }),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const relationshipDefinitions = (blueprint.relationshipDefinitions ?? []).map(definition => ({
        id: definition.id,
        participantIds: [...definition.participantIds],
        categories: [...definition.categories],
        initialRomanceMilestone: definition.initialRomanceMilestone,
        dynamicProfile: {
            coreDynamicTags: [...definition.dynamicProfile.coreDynamicTags],
            dominantConflictSources: [...definition.dynamicProfile.dominantConflictSources],
            trustBasis: [...definition.dynamicProfile.trustBasis],
            respectBasis: [...definition.dynamicProfile.respectBasis],
            prohibitedShortcuts: [...definition.dynamicProfile.prohibitedShortcuts],
        },
        progressionPolicy: { ...definition.progressionPolicy },
    })).sort((left, right) => left.id.localeCompare(right.id));
    const relationshipEvents = (blueprint.relationshipEvents ?? []).map(event => ({
        id: event.id,
        relationshipId: event.relationshipId,
        eventType: event.eventType,
        participantIds: [...event.participantIds],
        ...(event.writerText === undefined ? {} : { writerText: event.writerText }),
        ...(event.authorNotes === undefined ? {} : { authorNotes: event.authorNotes }),
        ...(event.authorizedRomanceMilestone === undefined ? {} : { authorizedRomanceMilestone: event.authorizedRomanceMilestone }),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const storyEvents = (blueprint.storyEvents ?? []).map(event => ({
        id: event.id,
        eventType: event.eventType,
        ...(event.writerText === undefined ? {} : { writerText: event.writerText }),
        ...(event.authorNotes === undefined ? {} : { authorNotes: event.authorNotes }),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const forbiddenEvents = (blueprint.forbiddenEvents ?? []).map(event => ({
        id: event.id,
        eventId: event.eventId,
        forbiddenThroughChapter: event.forbiddenThroughChapter,
        ...(event.authorReason === undefined ? {} : { authorReason: event.authorReason }),
    })).sort((left, right) => left.forbiddenThroughChapter - right.forbiddenThroughChapter || left.id.localeCompare(right.id));
    const forbiddenRelationshipEvents = (blueprint.forbiddenRelationshipEvents ?? []).map(event => ({
        id: event.id,
        eventId: event.eventId,
        forbiddenThroughChapter: event.forbiddenThroughChapter,
        ...(event.authorReason === undefined ? {} : { authorReason: event.authorReason }),
    })).sort((left, right) => left.forbiddenThroughChapter - right.forbiddenThroughChapter || left.id.localeCompare(right.id));
    const forbiddenReveals = (blueprint.forbiddenReveals ?? []).map(reveal => ({
        id: reveal.id,
        revealId: reveal.revealId,
        forbiddenThroughChapter: reveal.forbiddenThroughChapter,
        ...(reveal.authorReason === undefined ? {} : { authorReason: reveal.authorReason }),
    })).sort((left, right) => left.forbiddenThroughChapter - right.forbiddenThroughChapter || left.id.localeCompare(right.id));
    const authorOnlySecrets = (blueprint.authorOnlySecrets ?? []).map(secret => ({
        id: secret.id,
        value: secret.value,
        ...(secret.revealId === undefined ? {} : { revealId: secret.revealId }),
        ...(secret.notes === undefined ? {} : { notes: secret.notes }),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const canonRules = (blueprint.canonRules ?? []).map(rule => ({
        id: rule.id,
        text: rule.text,
        availableFromChapter: rule.availableFromChapter,
        ...(rule.expiresAfterChapter === undefined ? {} : { expiresAfterChapter: rule.expiresAfterChapter }),
        scope: rule.scope,
        ...(rule.authorNotes === undefined ? {} : { authorNotes: rule.authorNotes }),
    })).sort((left, right) => left.availableFromChapter - right.availableFromChapter || left.id.localeCompare(right.id));

    [arcs, beats, reveals, relationshipDefinitions, relationshipEvents, storyEvents, forbiddenEvents, forbiddenRelationshipEvents, forbiddenReveals, authorOnlySecrets, canonRules]
        .forEach((values, index) => assertUniqueIds(values, ['arcs', 'beats', 'reveals', 'relationshipDefinitions', 'relationshipEvents', 'storyEvents', 'forbiddenEvents', 'forbiddenRelationshipEvents', 'forbiddenReveals', 'authorOnlySecrets', 'canonRules'][index]));

    const control: FullStoryControl = {
        kind: 'full-story-control',
        id: blueprint.id.trim(),
        engine: {
            schemaVersion: 4,
            plannedChapterCount: blueprint.engine.plannedChapterCount,
            failClosed: true,
            unknownCharacterPolicy: 'deny',
            missingGatePolicy: 'deny',
            beatPolicy: 'required-for-arcs-with-beats',
        },
        characters,
        characterOrder: compiledCharacters.map(character => character.id),
        arcs,
        beats,
        reveals,
        relationshipDefinitions,
        relationshipEvents,
        storyEvents,
        gates: {
            characters: characterGates,
            pov: povGates,
            reveals: revealGates,
            relationships: relationshipGates,
            events: eventGates,
        },
        forbiddenEvents,
        forbiddenRelationshipEvents,
        forbiddenReveals,
        authorOnlySecrets,
        canonRules,
    };

    const issues = validateFullStoryControl(control);
    if (issues.length > 0) throw new StoryControlValidationError(issues);
    return deepFreezeStoryControl(control);
};
