import {
    CharacterBlueprint,
    CharacterGateBlueprint,
    GateTimingInput,
    PovGateBlueprint,
    RelationshipGateBlueprint,
    RevealGateBlueprint,
    StoryBlueprint,
    StoryEventGateBlueprint,
    compileStoryControl,
} from './compiler';
import {
    RELATIONSHIP_ACTION_TYPES,
    RELATIONSHIP_CATEGORIES,
    RELATIONSHIP_DYNAMIC_TAGS,
    ROMANCE_MILESTONES,
    RelationshipDefinition,
} from './relationshipTypes';
import { createInitialStoryState } from './storyState';
import { parseStoryState } from './storyStateRuntime';
import {
    AuthorOnlySecret,
    CanonRule,
    ForbiddenEvent,
    ForbiddenRelationshipEvent,
    ForbiddenReveal,
    RelationshipEventDefinition,
    RevealDefinition,
    StoryArc,
    StoryBeat,
    StoryEventDefinition,
    WriterCharacterProfile,
} from './types';
import { createEmptyNarrativeMemoryState, NarrativeMemoryState } from './narrativeMemory';
import { createStoryControlIdentity } from './canonicalIdentity';

type UnknownRecord = Record<string, unknown>;

export interface StoryBlueprintDocument {
    readonly kind: 'story-blueprint-document';
    readonly formatVersion: 1;
    readonly blueprint: StoryBlueprint;
}

export class StoryBlueprintParseError extends Error {
    constructor(readonly path: string, message: string) {
        super(`${path}: ${message}`);
        this.name = 'StoryBlueprintParseError';
    }
}

const record = (value: unknown, path: string, allowed: readonly string[]): UnknownRecord => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new StoryBlueprintParseError(path, 'must be an object');
    }
    const result = value as UnknownRecord;
    const unknown = Object.keys(result).find(key => !allowed.includes(key));
    if (unknown !== undefined) throw new StoryBlueprintParseError(`${path}.${unknown}`, 'is not supported');
    return result;
};

const array = (value: unknown, path: string): readonly unknown[] => {
    if (!Array.isArray(value)) throw new StoryBlueprintParseError(path, 'must be an array');
    return value;
};

const optionalArray = (owner: UnknownRecord, key: string, path: string): readonly unknown[] | undefined =>
    owner[key] === undefined ? undefined : array(owner[key], `${path}.${key}`);

const text = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || !value.trim()) throw new StoryBlueprintParseError(path, 'must be a non-empty string');
    return value.trim();
};

const optionalText = (owner: UnknownRecord, key: string, path: string): string | undefined =>
    owner[key] === undefined ? undefined : text(owner[key], `${path}.${key}`);

const integer = (value: unknown, path: string, minimum: number): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
        throw new StoryBlueprintParseError(path, `must be a safe integer >= ${minimum}`);
    }
    return value;
};

const optionalInteger = (owner: UnknownRecord, key: string, path: string, minimum: number): number | undefined =>
    owner[key] === undefined ? undefined : integer(owner[key], `${path}.${key}`, minimum);

const textArray = (value: unknown, path: string): readonly string[] => {
    const values = array(value, path).map((entry, index) => text(entry, `${path}.${index}`));
    if (new Set(values).size !== values.length) throw new StoryBlueprintParseError(path, 'must not contain duplicates');
    return values;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
    if (typeof value !== 'string' || !values.includes(value as T)) throw new StoryBlueprintParseError(path, 'contains an unsupported value');
    return value as T;
};

const enumArray = <T extends string>(value: unknown, values: readonly T[], path: string): readonly T[] => {
    const entries = array(value, path).map((entry, index) => enumValue(entry, values, `${path}.${index}`));
    if (new Set(entries).size !== entries.length) throw new StoryBlueprintParseError(path, 'must not contain duplicates');
    return entries;
};

const assertUniqueIds = (values: readonly { readonly id: string }[], path: string): void => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        if (seen.has(value.id)) throw new StoryBlueprintParseError(`${path}.${index}.id`, `duplicates ${value.id}`);
        seen.add(value.id);
    });
};

const timing = (value: UnknownRecord, path: string): GateTimingInput => {
    const allowedFromChapter = optionalInteger(value, 'allowedFromChapter', path, 1);
    const lockedThroughChapter = optionalInteger(value, 'lockedThroughChapter', path, 0);
    if (allowedFromChapter === undefined && lockedThroughChapter === undefined) {
        throw new StoryBlueprintParseError(path, 'requires allowedFromChapter or lockedThroughChapter');
    }
    return {
        ...(allowedFromChapter === undefined ? {} : { allowedFromChapter }),
        ...(lockedThroughChapter === undefined ? {} : { lockedThroughChapter }),
    };
};

const writerProfile = (value: unknown, path: string): WriterCharacterProfile => {
    const input = record(value, path, ['role', 'appearance', 'personality', 'publicFacts']);
    const role = optionalText(input, 'role', path);
    const appearance = optionalText(input, 'appearance', path);
    const personality = optionalText(input, 'personality', path);
    const publicFacts = input.publicFacts === undefined ? undefined : textArray(input.publicFacts, `${path}.publicFacts`);
    return {
        ...(role === undefined ? {} : { role }),
        ...(appearance === undefined ? {} : { appearance }),
        ...(personality === undefined ? {} : { personality }),
        ...(publicFacts === undefined ? {} : { publicFacts }),
    };
};

const character = (value: unknown, path: string): CharacterBlueprint => {
    const input = record(value, path, [
        'id', 'name', 'availableFromChapter', 'allowedFromChapter', 'lockedThroughChapter', 'writerProfile', 'authorNotes',
    ]);
    const availableFromChapter = optionalInteger(input, 'availableFromChapter', path, 1);
    const allowedFromChapter = optionalInteger(input, 'allowedFromChapter', path, 1);
    const lockedThroughChapter = optionalInteger(input, 'lockedThroughChapter', path, 0);
    if (availableFromChapter === undefined && allowedFromChapter === undefined && lockedThroughChapter === undefined) {
        throw new StoryBlueprintParseError(path, 'requires character availability timing');
    }
    const authorNotes = optionalText(input, 'authorNotes', path);
    return {
        id: text(input.id, `${path}.id`), name: text(input.name, `${path}.name`),
        ...(availableFromChapter === undefined ? {} : { availableFromChapter }),
        ...(allowedFromChapter === undefined ? {} : { allowedFromChapter }),
        ...(lockedThroughChapter === undefined ? {} : { lockedThroughChapter }),
        ...(input.writerProfile === undefined ? {} : { writerProfile: writerProfile(input.writerProfile, `${path}.writerProfile`) }),
        ...(authorNotes === undefined ? {} : { authorNotes }),
    };
};

const arc = (value: unknown, path: string): StoryArc => {
    const input = record(value, path, ['id', 'title', 'startChapter', 'endChapter', 'writerBrief', 'authorPlan']);
    const writerBrief = optionalText(input, 'writerBrief', path);
    const authorPlan = optionalText(input, 'authorPlan', path);
    return {
        id: text(input.id, `${path}.id`), title: text(input.title, `${path}.title`),
        startChapter: integer(input.startChapter, `${path}.startChapter`, 1),
        endChapter: integer(input.endChapter, `${path}.endChapter`, 1),
        ...(writerBrief === undefined ? {} : { writerBrief }),
        ...(authorPlan === undefined ? {} : { authorPlan }),
    };
};

const beat = (value: unknown, path: string): StoryBeat => {
    const input = record(value, path, ['id', 'arcId', 'order', 'startChapter', 'endChapter', 'writerBrief', 'authorPlan']);
    const writerBrief = optionalText(input, 'writerBrief', path);
    const authorPlan = optionalText(input, 'authorPlan', path);
    return {
        id: text(input.id, `${path}.id`), arcId: text(input.arcId, `${path}.arcId`),
        order: integer(input.order, `${path}.order`, 1),
        startChapter: integer(input.startChapter, `${path}.startChapter`, 1),
        endChapter: integer(input.endChapter, `${path}.endChapter`, 1),
        ...(writerBrief === undefined ? {} : { writerBrief }),
        ...(authorPlan === undefined ? {} : { authorPlan }),
    };
};

const reveal = (value: unknown, path: string): RevealDefinition => {
    const input = record(value, path, ['id', 'writerText', 'authorNotes']);
    const authorNotes = optionalText(input, 'authorNotes', path);
    return { id: text(input.id, `${path}.id`), writerText: text(input.writerText, `${path}.writerText`), ...(authorNotes === undefined ? {} : { authorNotes }) };
};

const relationshipDefinition = (value: unknown, path: string): RelationshipDefinition => {
    const input = record(value, path, ['id', 'participantIds', 'categories', 'initialRomanceMilestone', 'dynamicProfile', 'progressionPolicy']);
    const profile = record(input.dynamicProfile, `${path}.dynamicProfile`, [
        'coreDynamicTags', 'dominantConflictSources', 'trustBasis', 'respectBasis', 'prohibitedShortcuts',
    ]);
    const policy = record(input.progressionPolicy, `${path}.progressionPolicy`, [
        'maxMajorMilestoneAdvancePerChapter', 'maxConsecutiveProgressionChapters',
        'requireCanonicalBasis', 'requireMutualAgencyForMutualMilestone',
    ]);
    if (policy.requireCanonicalBasis !== true || policy.requireMutualAgencyForMutualMilestone !== true) {
        throw new StoryBlueprintParseError(`${path}.progressionPolicy`, 'required safeguards must be true');
    }
    return {
        id: text(input.id, `${path}.id`), participantIds: textArray(input.participantIds, `${path}.participantIds`),
        categories: enumArray(input.categories, RELATIONSHIP_CATEGORIES, `${path}.categories`),
        initialRomanceMilestone: enumValue(input.initialRomanceMilestone, ROMANCE_MILESTONES, `${path}.initialRomanceMilestone`),
        dynamicProfile: {
            coreDynamicTags: enumArray(profile.coreDynamicTags, RELATIONSHIP_DYNAMIC_TAGS, `${path}.dynamicProfile.coreDynamicTags`),
            dominantConflictSources: textArray(profile.dominantConflictSources, `${path}.dynamicProfile.dominantConflictSources`),
            trustBasis: textArray(profile.trustBasis, `${path}.dynamicProfile.trustBasis`),
            respectBasis: textArray(profile.respectBasis, `${path}.dynamicProfile.respectBasis`),
            prohibitedShortcuts: enumArray(profile.prohibitedShortcuts, RELATIONSHIP_ACTION_TYPES, `${path}.dynamicProfile.prohibitedShortcuts`),
        },
        progressionPolicy: {
            maxMajorMilestoneAdvancePerChapter: integer(policy.maxMajorMilestoneAdvancePerChapter, `${path}.progressionPolicy.maxMajorMilestoneAdvancePerChapter`, 1),
            maxConsecutiveProgressionChapters: integer(policy.maxConsecutiveProgressionChapters, `${path}.progressionPolicy.maxConsecutiveProgressionChapters`, 1),
            requireCanonicalBasis: true,
            requireMutualAgencyForMutualMilestone: true,
        },
    };
};

const relationshipEvent = (value: unknown, path: string): RelationshipEventDefinition => {
    const input = record(value, path, ['id', 'relationshipId', 'eventType', 'participantIds', 'writerText', 'authorNotes', 'authorizedRomanceMilestone']);
    const writerText = optionalText(input, 'writerText', path);
    const authorNotes = optionalText(input, 'authorNotes', path);
    const authorizedRomanceMilestone = input.authorizedRomanceMilestone === undefined
        ? undefined : enumValue(input.authorizedRomanceMilestone, ROMANCE_MILESTONES, `${path}.authorizedRomanceMilestone`);
    return {
        id: text(input.id, `${path}.id`), relationshipId: text(input.relationshipId, `${path}.relationshipId`),
        eventType: text(input.eventType, `${path}.eventType`), participantIds: textArray(input.participantIds, `${path}.participantIds`),
        ...(writerText === undefined ? {} : { writerText }), ...(authorNotes === undefined ? {} : { authorNotes }),
        ...(authorizedRomanceMilestone === undefined ? {} : { authorizedRomanceMilestone }),
    };
};

const storyEvent = (value: unknown, path: string): StoryEventDefinition => {
    const input = record(value, path, ['id', 'eventType', 'writerText', 'authorNotes']);
    const writerText = optionalText(input, 'writerText', path);
    const authorNotes = optionalText(input, 'authorNotes', path);
    return { id: text(input.id, `${path}.id`), eventType: text(input.eventType, `${path}.eventType`), ...(writerText === undefined ? {} : { writerText }), ...(authorNotes === undefined ? {} : { authorNotes }) };
};

const forbidden = <T extends ForbiddenEvent | ForbiddenRelationshipEvent | ForbiddenReveal>(
    value: unknown, path: string, referenceKey: 'eventId' | 'revealId',
): T => {
    const input = record(value, path, ['id', referenceKey, 'forbiddenThroughChapter', 'authorReason']);
    const authorReason = optionalText(input, 'authorReason', path);
    return {
        id: text(input.id, `${path}.id`), [referenceKey]: text(input[referenceKey], `${path}.${referenceKey}`),
        forbiddenThroughChapter: integer(input.forbiddenThroughChapter, `${path}.forbiddenThroughChapter`, 0),
        ...(authorReason === undefined ? {} : { authorReason }),
    } as T;
};

const authorSecret = (value: unknown, path: string): AuthorOnlySecret => {
    const input = record(value, path, ['id', 'value', 'revealId', 'notes']);
    const revealId = optionalText(input, 'revealId', path);
    const notes = optionalText(input, 'notes', path);
    return { id: text(input.id, `${path}.id`), value: text(input.value, `${path}.value`), ...(revealId === undefined ? {} : { revealId }), ...(notes === undefined ? {} : { notes }) };
};

const canonRule = (value: unknown, path: string): CanonRule => {
    const input = record(value, path, ['id', 'text', 'availableFromChapter', 'expiresAfterChapter', 'scope', 'authorNotes']);
    const expiresAfterChapter = optionalInteger(input, 'expiresAfterChapter', path, 1);
    const authorNotes = optionalText(input, 'authorNotes', path);
    return {
        id: text(input.id, `${path}.id`), text: text(input.text, `${path}.text`),
        availableFromChapter: integer(input.availableFromChapter, `${path}.availableFromChapter`, 1),
        ...(expiresAfterChapter === undefined ? {} : { expiresAfterChapter }),
        scope: enumValue(input.scope, ['world', 'canon'] as const, `${path}.scope`),
        ...(authorNotes === undefined ? {} : { authorNotes }),
    };
};

const gate = <T extends CharacterGateBlueprint | PovGateBlueprint | RevealGateBlueprint | RelationshipGateBlueprint | StoryEventGateBlueprint>(
    value: unknown, path: string, referenceKey: 'characterId' | 'revealId' | 'eventId',
): T => {
    const input = record(value, path, ['id', referenceKey, 'allowedFromChapter', 'lockedThroughChapter']);
    return { id: text(input.id, `${path}.id`), [referenceKey]: text(input[referenceKey], `${path}.${referenceKey}`), ...timing(input, path) } as T;
};

const mapOptional = <T>(owner: UnknownRecord, key: string, path: string, parser: (value: unknown, path: string) => T): readonly T[] | undefined => {
    const values = optionalArray(owner, key, path);
    if (values === undefined) return undefined;
    const parsed = values.map((entry, index) => parser(entry, `${path}.${key}.${index}`));
    if (parsed.every((entry): entry is T & { readonly id: string } => typeof entry === 'object' && entry !== null && 'id' in entry)) {
        assertUniqueIds(parsed, `${path}.${key}`);
    }
    return parsed;
};

export const parseStoryBlueprint = (value: unknown): StoryBlueprint => {
    const input = record(value, 'blueprint', [
        'id', 'engine', 'characters', 'arcs', 'beats', 'reveals', 'relationshipDefinitions', 'relationshipEvents',
        'storyEvents', 'gates', 'forbiddenEvents', 'forbiddenRelationshipEvents', 'forbiddenReveals', 'authorOnlySecrets', 'canonRules',
    ]);
    const engine = record(input.engine, 'blueprint.engine', ['plannedChapterCount']);
    const characters = array(input.characters, 'blueprint.characters').map((entry, index) => character(entry, `blueprint.characters.${index}`));
    assertUniqueIds(characters, 'blueprint.characters');
    const arcs = mapOptional(input, 'arcs', 'blueprint', arc);
    const beats = mapOptional(input, 'beats', 'blueprint', beat);
    const reveals = mapOptional(input, 'reveals', 'blueprint', reveal);
    const relationshipDefinitions = mapOptional(input, 'relationshipDefinitions', 'blueprint', relationshipDefinition);
    const relationshipEvents = mapOptional(input, 'relationshipEvents', 'blueprint', relationshipEvent);
    const storyEvents = mapOptional(input, 'storyEvents', 'blueprint', storyEvent);
    const forbiddenEvents = mapOptional(input, 'forbiddenEvents', 'blueprint', (entry, path) => forbidden<ForbiddenEvent>(entry, path, 'eventId'));
    const forbiddenRelationshipEvents = mapOptional(input, 'forbiddenRelationshipEvents', 'blueprint', (entry, path) => forbidden<ForbiddenRelationshipEvent>(entry, path, 'eventId'));
    const forbiddenReveals = mapOptional(input, 'forbiddenReveals', 'blueprint', (entry, path) => forbidden<ForbiddenReveal>(entry, path, 'revealId'));
    const authorOnlySecrets = mapOptional(input, 'authorOnlySecrets', 'blueprint', authorSecret);
    const canonRules = mapOptional(input, 'canonRules', 'blueprint', canonRule);
    let gates: StoryBlueprint['gates'];
    if (input.gates !== undefined) {
        const source = record(input.gates, 'blueprint.gates', ['characters', 'pov', 'reveals', 'relationships', 'events']);
        const charactersGates = mapOptional(source, 'characters', 'blueprint.gates', (entry, path) => gate<CharacterGateBlueprint>(entry, path, 'characterId'));
        const pov = mapOptional(source, 'pov', 'blueprint.gates', (entry, path) => gate<PovGateBlueprint>(entry, path, 'characterId'));
        const revealGates = mapOptional(source, 'reveals', 'blueprint.gates', (entry, path) => gate<RevealGateBlueprint>(entry, path, 'revealId'));
        const relationships = mapOptional(source, 'relationships', 'blueprint.gates', (entry, path) => gate<RelationshipGateBlueprint>(entry, path, 'eventId'));
        const events = mapOptional(source, 'events', 'blueprint.gates', (entry, path) => gate<StoryEventGateBlueprint>(entry, path, 'eventId'));
        gates = {
            ...(charactersGates === undefined ? {} : { characters: charactersGates }),
            ...(pov === undefined ? {} : { pov }), ...(revealGates === undefined ? {} : { reveals: revealGates }),
            ...(relationships === undefined ? {} : { relationships }), ...(events === undefined ? {} : { events }),
        };
    }
    return {
        id: text(input.id, 'blueprint.id'),
        engine: { plannedChapterCount: integer(engine.plannedChapterCount, 'blueprint.engine.plannedChapterCount', 1) },
        characters,
        ...(arcs === undefined ? {} : { arcs }), ...(beats === undefined ? {} : { beats }),
        ...(reveals === undefined ? {} : { reveals }),
        ...(relationshipDefinitions === undefined ? {} : { relationshipDefinitions }),
        ...(relationshipEvents === undefined ? {} : { relationshipEvents }),
        ...(storyEvents === undefined ? {} : { storyEvents }), ...(gates === undefined ? {} : { gates }),
        ...(forbiddenEvents === undefined ? {} : { forbiddenEvents }),
        ...(forbiddenRelationshipEvents === undefined ? {} : { forbiddenRelationshipEvents }),
        ...(forbiddenReveals === undefined ? {} : { forbiddenReveals }),
        ...(authorOnlySecrets === undefined ? {} : { authorOnlySecrets }), ...(canonRules === undefined ? {} : { canonRules }),
    };
};

export const parseStoryBlueprintDocument = (value: unknown): StoryBlueprintDocument => {
    const input = record(value, 'document', ['kind', 'formatVersion', 'blueprint']);
    if (input.kind !== 'story-blueprint-document') throw new StoryBlueprintParseError('document.kind', 'must be story-blueprint-document');
    if (input.formatVersion !== 1) throw new StoryBlueprintParseError('document.formatVersion', 'must be 1');
    return { kind: 'story-blueprint-document', formatVersion: 1, blueprint: parseStoryBlueprint(input.blueprint) };
};

export const parseStoryBlueprintJson = (source: string): StoryBlueprintDocument => {
    if (typeof source !== 'string' || !source.trim()) throw new StoryBlueprintParseError('document', 'JSON text must not be empty');
    let value: unknown;
    try {
        value = JSON.parse(source);
    } catch {
        throw new StoryBlueprintParseError('document', 'must be one valid JSON document');
    }
    return parseStoryBlueprintDocument(value);
};

export interface V4ProjectSeed {
    readonly kind: 'v4-project-seed';
    readonly storyControlIdentity: string;
    readonly control: ReturnType<typeof compileStoryControl>;
    readonly state: ReturnType<typeof parseStoryState>;
    readonly memory: NarrativeMemoryState;
}

export const createV4ProjectSeed = (documentValue: unknown): V4ProjectSeed => {
    const document = parseStoryBlueprintDocument(documentValue);
    const control = compileStoryControl(document.blueprint);
    const state = parseStoryState(createInitialStoryState(), control);
    const storyControlIdentity = createStoryControlIdentity(control);
    return { kind: 'v4-project-seed', storyControlIdentity, control, state, memory: createEmptyNarrativeMemoryState(control) };
};
