import { FullStoryControl, StoryState } from './types';
import {
    CANONICAL_EVENT_TYPES,
    CanonicalContinuityEntry,
    CanonicalLedgers,
    CanonicalProjections,
    CanonicalRelationshipState,
    CanonicalResourceState,
    CanonicalStateEvent,
    CanonicalStoryFact,
    CharacterLocationRecord,
    CharacterStateProjection,
    CharacterStatusRecord,
    EpistemicEntry,
    FACT_SOURCE_TYPES,
    FactProvenance,
    KNOWLEDGE_SOURCE_TYPES,
    KnowledgeSource,
    RelationshipHistoryRecord,
    ResourceLedgerRecord,
    StoryStateDelta,
    StoryStateTransitionError,
    StoryStateTransitionIssueCode,
} from './storyStateTypes';

type UnknownRecord = Record<string, unknown>;

const fail = (code: StoryStateTransitionIssueCode, message: string, path = ''): never => {
    throw new StoryStateTransitionError(code, message, path);
};

const record = (value: unknown, path: string, allowed?: readonly string[]): UnknownRecord => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('INVALID_STATE', 'expected object', path);
    const result = value as UnknownRecord;
    if (allowed) {
        const extra = Object.keys(result).find(key => !allowed.includes(key));
        if (extra) fail('INVALID_STATE', 'unexpected field', `${path}.${extra}`);
    }
    return result;
};

const deltaRecord = (value: unknown, path: string, allowed: readonly string[]): UnknownRecord => {
    try { return record(value, path, allowed); } catch (error) {
        if (error instanceof StoryStateTransitionError) fail('INVALID_DELTA', error.message, error.path);
        throw error;
    }
};

const array = (value: unknown, path: string): readonly unknown[] => {
    if (!Array.isArray(value)) fail('INVALID_STATE', 'expected array', path);
    return value as readonly unknown[];
};

const deltaArray = (value: unknown, path: string): readonly unknown[] => {
    if (!Array.isArray(value)) fail('INVALID_DELTA', 'expected array', path);
    return value as readonly unknown[];
};

const textValue = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || value.trim().length === 0) fail('INVALID_STATE', 'expected non-empty string', path);
    return value as string;
};

const deltaText = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || value.trim().length === 0) fail('INVALID_DELTA', 'expected non-empty string', path);
    return value as string;
};

const chapterValue = (value: unknown, path: string, code: StoryStateTransitionIssueCode = 'INVALID_STATE'): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 1) fail(code, 'expected positive safe integer', path);
    return value as number;
};

const nonNegativeInteger = (value: unknown, path: string, code: StoryStateTransitionIssueCode): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code, 'expected non-negative safe integer', path);
    return value as number;
};

const finite = (value: unknown, path: string, code: StoryStateTransitionIssueCode): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(code, 'expected finite number', path);
    return value as number;
};

const optionalText = (owner: UnknownRecord, key: string, path: string, delta = false): string | undefined =>
    owner[key] === undefined ? undefined : (delta ? deltaText(owner[key], `${path}.${key}`) : textValue(owner[key], `${path}.${key}`));

const oneOf = <T extends string>(value: unknown, values: readonly T[], path: string, code: StoryStateTransitionIssueCode): T => {
    if (typeof value !== 'string' || !values.includes(value as T)) fail(code, 'unexpected enum value', path);
    return value as T;
};

const unique = <T>(values: readonly T[], key: (value: T) => string, path: string, code: StoryStateTransitionIssueCode): void => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        const id = key(value);
        if (seen.has(id)) fail(code, 'duplicate id', `${path}[${index}]`);
        seen.add(id);
    });
};

const strings = (value: unknown, path: string, code: StoryStateTransitionIssueCode): readonly string[] => {
    const values = (code === 'INVALID_DELTA' ? deltaArray(value, path) : array(value, path))
        .map((entry, index) => code === 'INVALID_DELTA' ? deltaText(entry, `${path}[${index}]`) : textValue(entry, `${path}[${index}]`));
    if (new Set(values).size !== values.length) fail(code, 'duplicate value', path);
    return values;
};

const provenance = (value: unknown, path: string, delta = false): FactProvenance => {
    const code = delta ? 'INVALID_DELTA' : 'INVALID_STATE';
    const source = delta ? deltaRecord(value, path, ['sourceChapter', 'sourceType', 'sourceId'])
        : record(value, path, ['sourceChapter', 'sourceType', 'sourceId']);
    const sourceChapter = chapterValue(source.sourceChapter, `${path}.sourceChapter`, code);
    const sourceType = oneOf(source.sourceType, FACT_SOURCE_TYPES, `${path}.sourceType`, code);
    const sourceId = optionalText(source, 'sourceId', path, delta);
    return { sourceChapter, sourceType, ...(sourceId === undefined ? {} : { sourceId }) };
};

const parseFact = (value: unknown, path: string, delta = false): CanonicalStoryFact => {
    const code = delta ? 'INVALID_DELTA' : 'INVALID_STATE';
    const source = delta ? deltaRecord(value, path, ['id', 'text', 'establishedChapter', 'visibility', 'status', 'provenance'])
        : record(value, path, ['id', 'text', 'establishedChapter', 'visibility', 'status', 'provenance']);
    const fact: CanonicalStoryFact = {
        id: delta ? deltaText(source.id, `${path}.id`) : textValue(source.id, `${path}.id`),
        text: delta ? deltaText(source.text, `${path}.text`) : textValue(source.text, `${path}.text`),
        establishedChapter: chapterValue(source.establishedChapter, `${path}.establishedChapter`, code),
        visibility: oneOf(source.visibility, ['writer', 'internal'] as const, `${path}.visibility`, code),
        status: oneOf(source.status, ['active', 'superseded', 'invalidated'] as const, `${path}.status`, code),
        provenance: provenance(source.provenance, `${path}.provenance`, delta),
    };
    if (fact.provenance.sourceChapter > fact.establishedChapter) fail('TEMPORAL_VIOLATION', 'fact provenance is in the future', path);
    return fact;
};

const parseKnowledgeSource = (value: unknown, path: string, delta = false): KnowledgeSource => {
    const code = delta ? 'INVALID_DELTA' : 'INVALID_STATE';
    const source = delta ? deltaRecord(value, path, ['type', 'sourceChapter', 'sourceCharacterId', 'sourceFactId', 'sourceReference', 'basisFactIds'])
        : record(value, path, ['type', 'sourceChapter', 'sourceCharacterId', 'sourceFactId', 'sourceReference', 'basisFactIds']);
    const type = oneOf(source.type, KNOWLEDGE_SOURCE_TYPES, `${path}.type`, code);
    const sourceChapter = chapterValue(source.sourceChapter, `${path}.sourceChapter`, code);
    const sourceCharacterId = optionalText(source, 'sourceCharacterId', path, delta);
    const sourceFactId = optionalText(source, 'sourceFactId', path, delta);
    const sourceReference = optionalText(source, 'sourceReference', path, delta);
    const basisFactIds = source.basisFactIds === undefined ? undefined : strings(source.basisFactIds, `${path}.basisFactIds`, code);
    if (type === 'told-by-character' && sourceCharacterId === undefined) fail('KNOWLEDGE_SOURCE_INVALID', 'told source requires sourceCharacterId', path);
    if (type !== 'told-by-character' && sourceCharacterId !== undefined) fail('KNOWLEDGE_SOURCE_INVALID', 'sourceCharacterId is not allowed for this source', path);
    if (type === 'document' && sourceFactId === undefined && sourceReference === undefined) fail('KNOWLEDGE_SOURCE_INVALID', 'document source requires a fact or reference', path);
    if (type === 'inference' && (!basisFactIds || basisFactIds.length === 0)) fail('KNOWLEDGE_SOURCE_INVALID', 'inference requires basisFactIds', path);
    if (type !== 'inference' && basisFactIds !== undefined) fail('KNOWLEDGE_SOURCE_INVALID', 'basisFactIds are only valid for inference', path);
    return { type, sourceChapter, ...(sourceCharacterId ? { sourceCharacterId } : {}), ...(sourceFactId ? { sourceFactId } : {}), ...(sourceReference ? { sourceReference } : {}), ...(basisFactIds ? { basisFactIds } : {}) };
};

const parseEpistemic = (value: unknown, path: string, delta = false): EpistemicEntry => {
    const code = delta ? 'INVALID_DELTA' : 'INVALID_STATE';
    const source = delta ? deltaRecord(value, path, ['id', 'characterId', 'kind', 'factId', 'claim', 'learnedChapter', 'source', 'status'])
        : record(value, path, ['id', 'characterId', 'kind', 'factId', 'claim', 'learnedChapter', 'source', 'status']);
    const kind = oneOf(source.kind, ['known', 'believed'] as const, `${path}.kind`, code);
    const factId = optionalText(source, 'factId', path, delta);
    const claim = optionalText(source, 'claim', path, delta);
    if (kind === 'known' && (factId === undefined || claim !== undefined)) fail(code, 'known entry requires only factId', path);
    if (kind === 'believed' && (claim === undefined || factId !== undefined)) fail(code, 'belief entry requires only claim', path);
    return {
        id: delta ? deltaText(source.id, `${path}.id`) : textValue(source.id, `${path}.id`),
        characterId: delta ? deltaText(source.characterId, `${path}.characterId`) : textValue(source.characterId, `${path}.characterId`),
        kind, ...(factId ? { factId } : {}), ...(claim ? { claim } : {}),
        learnedChapter: chapterValue(source.learnedChapter, `${path}.learnedChapter`, code),
        source: parseKnowledgeSource(source.source, `${path}.source`, delta),
        status: oneOf(source.status, ['active', 'superseded', 'retracted'] as const, `${path}.status`, code),
    };
};

const parseLocation = (value: unknown, path: string, delta = false): CharacterLocationRecord => {
    const code = delta ? 'INVALID_DELTA' : 'INVALID_STATE';
    const source = delta ? deltaRecord(value, path, ['id', 'characterId', 'location', 'sinceChapter', 'provenance'])
        : record(value, path, ['id', 'characterId', 'location', 'sinceChapter', 'provenance']);
    return { id: delta ? deltaText(source.id, `${path}.id`) : textValue(source.id, `${path}.id`), characterId: delta ? deltaText(source.characterId, `${path}.characterId`) : textValue(source.characterId, `${path}.characterId`), location: delta ? deltaText(source.location, `${path}.location`) : textValue(source.location, `${path}.location`), sinceChapter: chapterValue(source.sinceChapter, `${path}.sinceChapter`, code), provenance: provenance(source.provenance, `${path}.provenance`, delta) };
};

const parseStatus = (value: unknown, path: string, delta = false): CharacterStatusRecord => {
    const code = delta ? 'INVALID_DELTA' : 'INVALID_STATE';
    const source = delta ? deltaRecord(value, path, ['id', 'characterId', 'kind', 'state', 'establishedChapter', 'resolvedChapter', 'provenance'])
        : record(value, path, ['id', 'characterId', 'kind', 'state', 'establishedChapter', 'resolvedChapter', 'provenance']);
    const establishedChapter = chapterValue(source.establishedChapter, `${path}.establishedChapter`, code);
    const resolvedChapter = source.resolvedChapter === undefined ? undefined : chapterValue(source.resolvedChapter, `${path}.resolvedChapter`, code);
    if (resolvedChapter !== undefined && resolvedChapter < establishedChapter) fail('TEMPORAL_VIOLATION', 'status resolves before it is established', path);
    return { id: delta ? deltaText(source.id, `${path}.id`) : textValue(source.id, `${path}.id`), characterId: delta ? deltaText(source.characterId, `${path}.characterId`) : textValue(source.characterId, `${path}.characterId`), kind: oneOf(source.kind, ['injury', 'condition', 'status', 'role'] as const, `${path}.kind`, code), state: delta ? deltaText(source.state, `${path}.state`) : textValue(source.state, `${path}.state`), establishedChapter, ...(resolvedChapter === undefined ? {} : { resolvedChapter }), provenance: provenance(source.provenance, `${path}.provenance`, delta) };
};

const parseRelationshipHistory = (value: unknown, path: string, delta = false): RelationshipHistoryRecord => {
    const code = delta ? 'INVALID_DELTA' : 'INVALID_STATE';
    const source = delta ? deltaRecord(value, path, ['id', 'relationshipId', 'participantIds', 'state', 'chapterNumber', 'provenance'])
        : record(value, path, ['id', 'relationshipId', 'participantIds', 'state', 'chapterNumber', 'provenance']);
    const participantIds = strings(source.participantIds, `${path}.participantIds`, code);
    if (participantIds.length < 2) fail(code, 'relationship requires at least two participants', path);
    return { id: delta ? deltaText(source.id, `${path}.id`) : textValue(source.id, `${path}.id`), relationshipId: delta ? deltaText(source.relationshipId, `${path}.relationshipId`) : textValue(source.relationshipId, `${path}.relationshipId`), participantIds, state: delta ? deltaText(source.state, `${path}.state`) : textValue(source.state, `${path}.state`), chapterNumber: chapterValue(source.chapterNumber, `${path}.chapterNumber`, code), provenance: provenance(source.provenance, `${path}.provenance`, delta) };
};

const parseResourceHistory = (value: unknown, path: string): ResourceLedgerRecord => {
    const source = record(value, path, ['id', 'characterId', 'resourceId', 'name', 'chapterNumber', 'quantityDelta', 'resultingQuantity', 'previousState', 'nextState', 'provenance']);
    const quantityDelta = source.quantityDelta === undefined ? undefined : finite(source.quantityDelta, `${path}.quantityDelta`, 'RESOURCE_VALUE_INVALID');
    const resultingQuantity = source.resultingQuantity === undefined ? undefined : finite(source.resultingQuantity, `${path}.resultingQuantity`, 'RESOURCE_VALUE_INVALID');
    const previousState = optionalText(source, 'previousState', path);
    const nextState = optionalText(source, 'nextState', path);
    if (quantityDelta === undefined && nextState === undefined) fail('INVALID_STATE', 'resource record requires a change', path);
    return { id: textValue(source.id, `${path}.id`), characterId: textValue(source.characterId, `${path}.characterId`), resourceId: textValue(source.resourceId, `${path}.resourceId`), name: textValue(source.name, `${path}.name`), chapterNumber: chapterValue(source.chapterNumber, `${path}.chapterNumber`), ...(quantityDelta === undefined ? {} : { quantityDelta }), ...(resultingQuantity === undefined ? {} : { resultingQuantity }), ...(previousState === undefined ? {} : { previousState }), ...(nextState === undefined ? {} : { nextState }), provenance: provenance(source.provenance, `${path}.provenance`) };
};

const parseContinuity = (value: unknown, path: string, delta = false): CanonicalContinuityEntry => {
    const code = delta ? 'INVALID_DELTA' : 'INVALID_STATE';
    const source = delta ? deltaRecord(value, path, ['id', 'kind', 'text', 'visibility', 'establishedChapter', 'status', 'resolvedChapter', 'provenance'])
        : record(value, path, ['id', 'kind', 'text', 'visibility', 'establishedChapter', 'status', 'resolvedChapter', 'provenance']);
    const establishedChapter = chapterValue(source.establishedChapter, `${path}.establishedChapter`, code);
    const resolvedChapter = source.resolvedChapter === undefined ? undefined : chapterValue(source.resolvedChapter, `${path}.resolvedChapter`, code);
    const status = oneOf(source.status, ['open', 'resolved', 'superseded'] as const, `${path}.status`, code);
    if ((status === 'open') === (resolvedChapter !== undefined)) fail(code, 'continuity lifecycle is inconsistent', path);
    if (resolvedChapter !== undefined && resolvedChapter < establishedChapter) fail('TEMPORAL_VIOLATION', 'continuity resolves before opening', path);
    return { id: delta ? deltaText(source.id, `${path}.id`) : textValue(source.id, `${path}.id`), kind: oneOf(source.kind, ['pending-thread', 'obligation', 'condition', 'clue', 'promise'] as const, `${path}.kind`, code), text: delta ? deltaText(source.text, `${path}.text`) : textValue(source.text, `${path}.text`), visibility: oneOf(source.visibility, ['writer', 'internal'] as const, `${path}.visibility`, code), establishedChapter, status, ...(resolvedChapter === undefined ? {} : { resolvedChapter }), provenance: provenance(source.provenance, `${path}.provenance`, delta) };
};

const parseEvent = (value: unknown, path: string): CanonicalStateEvent => {
    const source = record(value, path, ['id', 'chapterNumber', 'type', 'affectedIds', 'provenance']);
    return { id: textValue(source.id, `${path}.id`), chapterNumber: chapterValue(source.chapterNumber, `${path}.chapterNumber`), type: oneOf(source.type, CANONICAL_EVENT_TYPES, `${path}.type`, 'INVALID_STATE'), affectedIds: strings(source.affectedIds, `${path}.affectedIds`, 'INVALID_STATE'), provenance: provenance(source.provenance, `${path}.provenance`) };
};

const parseLedgers = (value: unknown, path: string): CanonicalLedgers => {
    const source = record(value, path, ['facts', 'epistemic', 'locations', 'statuses', 'relationships', 'resources', 'continuity', 'events']);
    const facts = array(source.facts, `${path}.facts`).map((entry, index) => parseFact(entry, `${path}.facts[${index}]`));
    const epistemic = array(source.epistemic, `${path}.epistemic`).map((entry, index) => parseEpistemic(entry, `${path}.epistemic[${index}]`));
    const locations = array(source.locations, `${path}.locations`).map((entry, index) => parseLocation(entry, `${path}.locations[${index}]`));
    const statuses = array(source.statuses, `${path}.statuses`).map((entry, index) => parseStatus(entry, `${path}.statuses[${index}]`));
    const relationships = array(source.relationships, `${path}.relationships`).map((entry, index) => parseRelationshipHistory(entry, `${path}.relationships[${index}]`));
    const resources = array(source.resources, `${path}.resources`).map((entry, index) => parseResourceHistory(entry, `${path}.resources[${index}]`));
    const continuity = array(source.continuity, `${path}.continuity`).map((entry, index) => parseContinuity(entry, `${path}.continuity[${index}]`));
    const events = array(source.events, `${path}.events`).map((entry, index) => parseEvent(entry, `${path}.events[${index}]`));
    unique(facts, entry => entry.id, `${path}.facts`, 'DUPLICATE_ID');
    unique(epistemic, entry => entry.id, `${path}.epistemic`, 'DUPLICATE_ID');
    unique(locations, entry => entry.id, `${path}.locations`, 'DUPLICATE_ID');
    unique(statuses, entry => entry.id, `${path}.statuses`, 'DUPLICATE_ID');
    unique(relationships, entry => entry.id, `${path}.relationships`, 'DUPLICATE_ID');
    unique(resources, entry => entry.id, `${path}.resources`, 'DUPLICATE_ID');
    unique(continuity, entry => entry.id, `${path}.continuity`, 'DUPLICATE_ID');
    unique(events, entry => entry.id, `${path}.events`, 'DUPLICATE_ID');
    return { facts, epistemic, locations, statuses, relationships, resources, continuity, events };
};

const parseCharacterProjection = (value: unknown, path: string): CharacterStateProjection => {
    const source = record(value, path, ['characterId', 'active', 'lifeStatus', 'currentLocationRecordId', 'activeStatusIds']);
    if (typeof source.active !== 'boolean') fail('INVALID_STATE', 'expected boolean', `${path}.active`);
    const currentLocationRecordId = optionalText(source, 'currentLocationRecordId', path);
    return { characterId: textValue(source.characterId, `${path}.characterId`), active: source.active as boolean, lifeStatus: oneOf(source.lifeStatus, ['unknown', 'alive', 'dead'] as const, `${path}.lifeStatus`, 'INVALID_STATE'), ...(currentLocationRecordId ? { currentLocationRecordId } : {}), activeStatusIds: strings(source.activeStatusIds, `${path}.activeStatusIds`, 'INVALID_STATE') };
};

const parseRelationshipProjection = (value: unknown, path: string): CanonicalRelationshipState => {
    const source = record(value, path, ['id', 'participantIds', 'currentState', 'lastChangedChapter', 'currentHistoryId']);
    return { id: textValue(source.id, `${path}.id`), participantIds: strings(source.participantIds, `${path}.participantIds`, 'INVALID_STATE'), currentState: textValue(source.currentState, `${path}.currentState`), lastChangedChapter: chapterValue(source.lastChangedChapter, `${path}.lastChangedChapter`), currentHistoryId: textValue(source.currentHistoryId, `${path}.currentHistoryId`) };
};

const parseResourceProjection = (value: unknown, path: string): CanonicalResourceState => {
    const source = record(value, path, ['characterId', 'resourceId', 'name', 'quantity', 'state', 'lastChangedChapter', 'currentHistoryId']);
    const quantity = source.quantity === undefined ? undefined : finite(source.quantity, `${path}.quantity`, 'RESOURCE_VALUE_INVALID');
    const state = optionalText(source, 'state', path);
    return { characterId: textValue(source.characterId, `${path}.characterId`), resourceId: textValue(source.resourceId, `${path}.resourceId`), name: textValue(source.name, `${path}.name`), ...(quantity === undefined ? {} : { quantity }), ...(state === undefined ? {} : { state }), lastChangedChapter: chapterValue(source.lastChangedChapter, `${path}.lastChangedChapter`), currentHistoryId: textValue(source.currentHistoryId, `${path}.currentHistoryId`) };
};

const parseProjections = (value: unknown, path: string): CanonicalProjections => {
    const source = record(value, path, ['characters', 'relationships', 'resources']);
    const characters = array(source.characters, `${path}.characters`).map((entry, index) => parseCharacterProjection(entry, `${path}.characters[${index}]`));
    const relationships = array(source.relationships, `${path}.relationships`).map((entry, index) => parseRelationshipProjection(entry, `${path}.relationships[${index}]`));
    const resources = array(source.resources, `${path}.resources`).map((entry, index) => parseResourceProjection(entry, `${path}.resources[${index}]`));
    unique(characters, entry => entry.characterId, `${path}.characters`, 'DUPLICATE_ID');
    unique(relationships, entry => entry.id, `${path}.relationships`, 'DUPLICATE_ID');
    unique(resources, entry => `${entry.characterId}\u0000${entry.resourceId}`, `${path}.resources`, 'DUPLICATE_ID');
    return { characters, relationships, resources };
};

const cloneLegacyState = (source: UnknownRecord): Omit<StoryState, 'kind' | 'schemaVersion' | 'revision' | 'currentChapter' | 'ledgers' | 'projections'> => {
    const stringArray = (key: string): readonly string[] => strings(source[key], `state.${key}`, 'INVALID_STATE');
    const locationsSource = record(source.characterLocations, 'state.characterLocations');
    const characterLocations = Object.fromEntries(Object.keys(locationsSource).sort().map(id => [id, textValue(locationsSource[id], `state.characterLocations.${id}`)]));
    const statusesSource = record(source.characterStatuses, 'state.characterStatuses');
    const characterStatuses = Object.fromEntries(Object.keys(statusesSource).sort().map((id) => {
        const status = record(statusesSource[id], `state.characterStatuses.${id}`, ['status', 'injuries', 'conditions']);
        const statusText = optionalText(status, 'status', `state.characterStatuses.${id}`);
        return [id, { ...(statusText ? { status: statusText } : {}), injuries: strings(status.injuries, `state.characterStatuses.${id}.injuries`, 'INVALID_STATE'), conditions: strings(status.conditions, `state.characterStatuses.${id}.conditions`, 'INVALID_STATE') }];
    }));
    const facts = array(source.facts, 'state.facts').map((entry, index) => {
        const fact = record(entry, `state.facts[${index}]`, ['id', 'text', 'establishedChapter', 'visibility', 'status', 'provenance']);
        const status = fact.status === undefined ? undefined : oneOf(fact.status, ['active', 'superseded', 'invalidated'] as const, `state.facts[${index}].status`, 'INVALID_STATE');
        const factProvenance = fact.provenance === undefined ? undefined : provenance(fact.provenance, `state.facts[${index}].provenance`);
        return { id: textValue(fact.id, `state.facts[${index}].id`), text: textValue(fact.text, `state.facts[${index}].text`), establishedChapter: chapterValue(fact.establishedChapter, `state.facts[${index}].establishedChapter`), visibility: oneOf(fact.visibility, ['writer', 'internal'] as const, `state.facts[${index}].visibility`, 'INVALID_STATE'), ...(status ? { status } : {}), ...(factProvenance ? { provenance: factProvenance } : {}) };
    });
    const characterKnowledge = array(source.characterKnowledge, 'state.characterKnowledge').map((entry, index) => { const item = record(entry, `state.characterKnowledge[${index}]`, ['characterId', 'factIds']); return { characterId: textValue(item.characterId, `state.characterKnowledge[${index}].characterId`), factIds: strings(item.factIds, `state.characterKnowledge[${index}].factIds`, 'INVALID_STATE') }; });
    const relationships = array(source.relationships, 'state.relationships').map((entry, index) => { const item = record(entry, `state.relationships[${index}]`, ['id', 'participantIds', 'state', 'establishedChapter']); return { id: textValue(item.id, `state.relationships[${index}].id`), participantIds: strings(item.participantIds, `state.relationships[${index}].participantIds`, 'INVALID_STATE'), state: textValue(item.state, `state.relationships[${index}].state`), establishedChapter: chapterValue(item.establishedChapter, `state.relationships[${index}].establishedChapter`) }; });
    const threads = (key: 'unresolvedClues' | 'unresolvedPromises') => array(source[key], `state.${key}`).map((entry, index) => { const item = record(entry, `state.${key}[${index}]`, ['id', 'text', 'openedChapter', 'visibility']); return { id: textValue(item.id, `state.${key}[${index}].id`), text: textValue(item.text, `state.${key}[${index}].text`), openedChapter: chapterValue(item.openedChapter, `state.${key}[${index}].openedChapter`), visibility: oneOf(item.visibility, ['writer', 'internal'] as const, `state.${key}[${index}].visibility`, 'INVALID_STATE') }; });
    const resourcesSource = record(source.resources, 'state.resources');
    const resources = Object.fromEntries(Object.keys(resourcesSource).sort().map(id => [id, array(resourcesSource[id], `state.resources.${id}`).map((entry, index) => { const item = record(entry, `state.resources.${id}[${index}]`, ['id', 'name', 'quantity', 'state']); const quantity = item.quantity === undefined ? undefined : finite(item.quantity, `state.resources.${id}[${index}].quantity`, 'RESOURCE_VALUE_INVALID'); const resourceState = optionalText(item, 'state', `state.resources.${id}[${index}]`); return { id: textValue(item.id, `state.resources.${id}[${index}].id`), name: textValue(item.name, `state.resources.${id}[${index}].name`), ...(quantity === undefined ? {} : { quantity }), ...(resourceState === undefined ? {} : { state: resourceState }) }; })]));
    const continuitySource = record(source.continuity, 'state.continuity', ['timelinePosition', 'lastScene', 'povCharacterId', 'pendingThreads', 'notes']);
    const continuityEntries = (key: 'pendingThreads' | 'notes') => array(continuitySource[key], `state.continuity.${key}`).map((entry, index) => { const item = record(entry, `state.continuity.${key}[${index}]`, ['text', 'visibility', 'establishedChapter']); return { text: textValue(item.text, `state.continuity.${key}[${index}].text`), visibility: oneOf(item.visibility, ['writer', 'internal'] as const, `state.continuity.${key}[${index}].visibility`, 'INVALID_STATE'), establishedChapter: chapterValue(item.establishedChapter, `state.continuity.${key}[${index}].establishedChapter`) }; });
    const timelinePosition = optionalText(continuitySource, 'timelinePosition', 'state.continuity'); const lastScene = optionalText(continuitySource, 'lastScene', 'state.continuity'); const povCharacterId = optionalText(continuitySource, 'povCharacterId', 'state.continuity');
    const currentArcId = optionalText(source, 'currentArcId', 'state'); const currentBeatId = optionalText(source, 'currentBeatId', 'state');
    const extensions = record(source.extensions, 'state.extensions');
    if (Object.keys(extensions).length !== 0) fail('INVALID_STATE', 'canonical extensions must be empty', 'state.extensions');
    return { ...(currentArcId ? { currentArcId } : {}), ...(currentBeatId ? { currentBeatId } : {}), knownCharacterIds: stringArray('knownCharacterIds'), activeCharacterIds: stringArray('activeCharacterIds'), characterLocations, characterStatuses, facts, characterKnowledge, relationships, unresolvedClues: threads('unresolvedClues'), unresolvedPromises: threads('unresolvedPromises'), resources, continuity: { ...(timelinePosition ? { timelinePosition } : {}), ...(lastScene ? { lastScene } : {}), ...(povCharacterId ? { povCharacterId } : {}), pendingThreads: continuityEntries('pendingThreads'), notes: continuityEntries('notes') }, extensions: {} };
};

const validateStateReferences = (state: StoryState, control?: FullStoryControl): void => {
    const chapter = state.currentChapter;
    const facts = new Map(state.ledgers.facts.map(value => [value.id, value]));
    const locations = new Map(state.ledgers.locations.map(value => [value.id, value]));
    const statuses = new Map(state.ledgers.statuses.map(value => [value.id, value]));
    const relationshipHistory = new Map(state.ledgers.relationships.map(value => [value.id, value]));
    const resourceHistory = new Map(state.ledgers.resources.map(value => [value.id, value]));
    const knownCharacter = (id: string, path: string, atChapter = chapter) => {
        if (!control) return;
        const character = control.characters[id];
        if (!character) fail('UNKNOWN_CHARACTER', 'unknown character', path);
        if (character.availableFromChapter > atChapter) fail('TEMPORAL_VIOLATION', 'character is not yet available', path);
    };
    state.ledgers.facts.forEach((fact, index) => { if (fact.establishedChapter > chapter || fact.provenance.sourceChapter > chapter) fail('TEMPORAL_VIOLATION', 'future fact', `state.ledgers.facts[${index}]`); });
    state.ledgers.epistemic.forEach((entry, index) => {
        const path = `state.ledgers.epistemic[${index}]`; knownCharacter(entry.characterId, `${path}.characterId`, entry.learnedChapter);
        if (entry.learnedChapter > chapter || entry.source.sourceChapter > entry.learnedChapter) fail('TEMPORAL_VIOLATION', 'future knowledge source', path);
        if (entry.kind === 'known') { const fact = facts.get(entry.factId!); if (!fact) fail('UNKNOWN_FACT', 'unknown fact', `${path}.factId`); if (entry.learnedChapter < fact.establishedChapter) fail('TEMPORAL_VIOLATION', 'knowledge predates fact', path); }
        if (entry.source.sourceCharacterId) knownCharacter(entry.source.sourceCharacterId, `${path}.source.sourceCharacterId`, entry.source.sourceChapter);
        if (entry.source.sourceFactId && !facts.has(entry.source.sourceFactId)) fail('UNKNOWN_FACT', 'unknown source fact', `${path}.source.sourceFactId`);
        entry.source.basisFactIds?.forEach(id => { const fact = facts.get(id); if (!fact || fact.establishedChapter > entry.source.sourceChapter) fail('KNOWLEDGE_SOURCE_INVALID', 'invalid inference basis', `${path}.source.basisFactIds`); });
    });
    const activeKnowledge = state.ledgers.epistemic.filter(value => value.kind === 'known' && value.status === 'active');
    unique(activeKnowledge, value => `${value.characterId}\u0000${value.factId}`, 'state.ledgers.epistemic', 'DUPLICATE_ID');
    state.ledgers.locations.forEach((entry, index) => { knownCharacter(entry.characterId, `state.ledgers.locations[${index}].characterId`, entry.sinceChapter); if (entry.sinceChapter > chapter || entry.provenance.sourceChapter > entry.sinceChapter) fail('TEMPORAL_VIOLATION', 'invalid location time', `state.ledgers.locations[${index}]`); });
    state.ledgers.statuses.forEach((entry, index) => { knownCharacter(entry.characterId, `state.ledgers.statuses[${index}].characterId`, entry.establishedChapter); if (entry.establishedChapter > chapter || (entry.resolvedChapter ?? 0) > chapter || entry.provenance.sourceChapter > entry.establishedChapter) fail('TEMPORAL_VIOLATION', 'invalid status time', `state.ledgers.statuses[${index}]`); });
    state.ledgers.relationships.forEach((entry, index) => { entry.participantIds.forEach(id => knownCharacter(id, `state.ledgers.relationships[${index}].participantIds`, entry.chapterNumber)); if (entry.chapterNumber > chapter || entry.provenance.sourceChapter > entry.chapterNumber) fail('TEMPORAL_VIOLATION', 'invalid relationship time', `state.ledgers.relationships[${index}]`); });
    state.ledgers.resources.forEach((entry, index) => { knownCharacter(entry.characterId, `state.ledgers.resources[${index}].characterId`, entry.chapterNumber); if (entry.chapterNumber > chapter || entry.provenance.sourceChapter > entry.chapterNumber) fail('TEMPORAL_VIOLATION', 'invalid resource time', `state.ledgers.resources[${index}]`); });
    state.ledgers.continuity.forEach((entry, index) => { if (entry.establishedChapter > chapter || (entry.resolvedChapter ?? 0) > chapter || entry.provenance.sourceChapter > entry.establishedChapter) fail('TEMPORAL_VIOLATION', 'invalid continuity time', `state.ledgers.continuity[${index}]`); });
    state.ledgers.events.forEach((entry, index) => { if (entry.chapterNumber > chapter || entry.provenance.sourceChapter > entry.chapterNumber) fail('TEMPORAL_VIOLATION', 'invalid event time', `state.ledgers.events[${index}]`); });
    state.projections.characters.forEach((entry, index) => { knownCharacter(entry.characterId, `state.projections.characters[${index}].characterId`); if (entry.currentLocationRecordId && locations.get(entry.currentLocationRecordId)?.characterId !== entry.characterId) fail('REFERENTIAL_INTEGRITY_FAILURE', 'invalid location projection', `state.projections.characters[${index}]`); entry.activeStatusIds.forEach(id => { const status = statuses.get(id); if (!status || status.characterId !== entry.characterId || status.resolvedChapter !== undefined) fail('REFERENTIAL_INTEGRITY_FAILURE', 'invalid status projection', `state.projections.characters[${index}]`); }); });
    state.projections.relationships.forEach((entry, index) => { const history = relationshipHistory.get(entry.currentHistoryId); if (!history || history.relationshipId !== entry.id || history.state !== entry.currentState || history.chapterNumber !== entry.lastChangedChapter || JSON.stringify(history.participantIds) !== JSON.stringify(entry.participantIds)) fail('REFERENTIAL_INTEGRITY_FAILURE', 'invalid relationship projection', `state.projections.relationships[${index}]`); });
    state.projections.resources.forEach((entry, index) => { const history = resourceHistory.get(entry.currentHistoryId); if (!history || history.characterId !== entry.characterId || history.resourceId !== entry.resourceId || history.resultingQuantity !== entry.quantity || history.nextState !== entry.state || history.chapterNumber !== entry.lastChangedChapter) fail('REFERENTIAL_INTEGRITY_FAILURE', 'invalid resource projection', `state.projections.resources[${index}]`); });
};

/** Strict runtime parser. `currentChapter` is the latest canonical chapter reflected by the snapshot. */
export const parseStoryState = (value: unknown, control?: FullStoryControl): StoryState => {
    const source = record(value, 'state', ['kind', 'schemaVersion', 'revision', 'currentChapter', 'currentArcId', 'currentBeatId', 'knownCharacterIds', 'activeCharacterIds', 'characterLocations', 'characterStatuses', 'facts', 'characterKnowledge', 'relationships', 'unresolvedClues', 'unresolvedPromises', 'resources', 'continuity', 'ledgers', 'projections', 'extensions']);
    if (source.kind !== 'story-state' || source.schemaVersion !== 4) fail('INVALID_STATE', 'unsupported story state identity', 'state');
    const currentChapter = chapterValue(source.currentChapter, 'state.currentChapter');
    const state: StoryState = { kind: 'story-state', schemaVersion: 4, revision: nonNegativeInteger(source.revision, 'state.revision', 'INVALID_STATE'), currentChapter, ...cloneLegacyState(source), ledgers: parseLedgers(source.ledgers, 'state.ledgers'), projections: parseProjections(source.projections, 'state.projections') };
    validateStateReferences(state, control);
    validateCompatibilityProjection(state);
    return state;
};

const parseStatusChange = (value: unknown, path: string) => {
    const source = deltaRecord(value, path, ['operation', 'record', 'statusId', 'resolvedChapter', 'provenance']);
    const operation = oneOf(source.operation, ['add', 'resolve'] as const, `${path}.operation`, 'INVALID_DELTA');
    const changeProvenance = provenance(source.provenance, `${path}.provenance`, true);
    if (operation === 'add') { if (source.record === undefined || source.statusId !== undefined || source.resolvedChapter !== undefined) fail('INVALID_DELTA', 'invalid status add shape', path); return { operation, record: parseStatus(source.record, `${path}.record`, true), provenance: changeProvenance } as const; }
    if (source.record !== undefined || source.statusId === undefined || source.resolvedChapter === undefined) fail('INVALID_DELTA', 'invalid status resolve shape', path);
    return { operation, statusId: deltaText(source.statusId, `${path}.statusId`), resolvedChapter: chapterValue(source.resolvedChapter, `${path}.resolvedChapter`, 'INVALID_DELTA'), provenance: changeProvenance } as const;
};

const parseResourceChange = (value: unknown, path: string) => {
    const source = deltaRecord(value, path, ['id', 'characterId', 'resourceId', 'name', 'quantityDelta', 'nextState', 'provenance']);
    const quantityDelta = source.quantityDelta === undefined ? undefined : finite(source.quantityDelta, `${path}.quantityDelta`, 'RESOURCE_VALUE_INVALID'); const nextState = optionalText(source, 'nextState', path, true);
    if (quantityDelta === undefined && nextState === undefined) fail('INVALID_DELTA', 'resource change requires quantityDelta or nextState', path);
    return { id: deltaText(source.id, `${path}.id`), characterId: deltaText(source.characterId, `${path}.characterId`), resourceId: deltaText(source.resourceId, `${path}.resourceId`), name: deltaText(source.name, `${path}.name`), ...(quantityDelta === undefined ? {} : { quantityDelta }), ...(nextState === undefined ? {} : { nextState }), provenance: provenance(source.provenance, `${path}.provenance`, true) };
};

const parseContinuityChange = (value: unknown, path: string) => {
    const source = deltaRecord(value, path, ['operation', 'entry', 'continuityId', 'chapterNumber', 'provenance']); const operation = oneOf(source.operation, ['open', 'resolve', 'supersede'] as const, `${path}.operation`, 'INVALID_DELTA'); const changeProvenance = provenance(source.provenance, `${path}.provenance`, true);
    if (operation === 'open') { if (source.entry === undefined || source.continuityId !== undefined || source.chapterNumber !== undefined) fail('INVALID_DELTA', 'invalid continuity open shape', path); const entry = parseContinuity(source.entry, `${path}.entry`, true); if (entry.status !== 'open') fail('INVALID_DELTA', 'opened continuity must be open', path); return { operation, entry, provenance: changeProvenance } as const; }
    if (source.entry !== undefined || source.continuityId === undefined || source.chapterNumber === undefined) fail('INVALID_DELTA', 'invalid continuity close shape', path);
    return { operation, continuityId: deltaText(source.continuityId, `${path}.continuityId`), chapterNumber: chapterValue(source.chapterNumber, `${path}.chapterNumber`, 'INVALID_DELTA'), provenance: changeProvenance } as const;
};

export const parseStoryStateDelta = (value: unknown): StoryStateDelta => {
    const source = deltaRecord(value, 'delta', ['kind', 'schemaVersion', 'chapterNumber', 'expectedRevision', 'factChanges', 'epistemicChanges', 'locationChanges', 'statusChanges', 'activationChanges', 'relationshipChanges', 'resourceChanges', 'continuityChanges']);
    if (source.kind !== 'story-state-delta' || source.schemaVersion !== 1) fail('INVALID_DELTA', 'unsupported delta identity', 'delta');
    const factChanges = deltaArray(source.factChanges, 'delta.factChanges').map((entry, index) => parseFact(entry, `delta.factChanges[${index}]`, true));
    const epistemicChanges = deltaArray(source.epistemicChanges, 'delta.epistemicChanges').map((entry, index) => parseEpistemic(entry, `delta.epistemicChanges[${index}]`, true));
    const locationChanges = deltaArray(source.locationChanges, 'delta.locationChanges').map((entry, index) => parseLocation(entry, `delta.locationChanges[${index}]`, true));
    const statusChanges = deltaArray(source.statusChanges, 'delta.statusChanges').map((entry, index) => parseStatusChange(entry, `delta.statusChanges[${index}]`));
    const activationChanges = deltaArray(source.activationChanges, 'delta.activationChanges').map((entry, index) => { const path = `delta.activationChanges[${index}]`; const item = deltaRecord(entry, path, ['characterId', 'active', 'lifeStatus', 'provenance']); if (typeof item.active !== 'boolean') fail('INVALID_DELTA', 'expected boolean', `${path}.active`); const lifeStatus = item.lifeStatus === undefined ? undefined : oneOf(item.lifeStatus, ['unknown', 'alive', 'dead'] as const, `${path}.lifeStatus`, 'INVALID_DELTA'); return { characterId: deltaText(item.characterId, `${path}.characterId`), active: item.active as boolean, ...(lifeStatus ? { lifeStatus } : {}), provenance: provenance(item.provenance, `${path}.provenance`, true) }; });
    const relationshipChanges = deltaArray(source.relationshipChanges, 'delta.relationshipChanges').map((entry, index) => parseRelationshipHistory(entry, `delta.relationshipChanges[${index}]`, true));
    const resourceChanges = deltaArray(source.resourceChanges, 'delta.resourceChanges').map((entry, index) => parseResourceChange(entry, `delta.resourceChanges[${index}]`));
    const continuityChanges = deltaArray(source.continuityChanges, 'delta.continuityChanges').map((entry, index) => parseContinuityChange(entry, `delta.continuityChanges[${index}]`));
    unique(factChanges, entry => entry.id, 'delta.factChanges', 'CONFLICTING_OPERATION'); unique(epistemicChanges, entry => entry.id, 'delta.epistemicChanges', 'CONFLICTING_OPERATION'); unique(locationChanges, entry => entry.characterId, 'delta.locationChanges', 'CONFLICTING_OPERATION'); unique(activationChanges, entry => entry.characterId, 'delta.activationChanges', 'CONFLICTING_OPERATION'); unique(relationshipChanges, entry => entry.relationshipId, 'delta.relationshipChanges', 'CONFLICTING_OPERATION'); unique(resourceChanges, entry => `${entry.characterId}\u0000${entry.resourceId}`, 'delta.resourceChanges', 'CONFLICTING_OPERATION'); unique(statusChanges, entry => entry.operation === 'add' ? entry.record!.id : entry.statusId!, 'delta.statusChanges', 'CONFLICTING_OPERATION'); unique(continuityChanges, entry => entry.operation === 'open' ? entry.entry!.id : entry.continuityId!, 'delta.continuityChanges', 'CONFLICTING_OPERATION');
    return { kind: 'story-state-delta', schemaVersion: 1, chapterNumber: chapterValue(source.chapterNumber, 'delta.chapterNumber', 'INVALID_DELTA'), expectedRevision: nonNegativeInteger(source.expectedRevision, 'delta.expectedRevision', 'INVALID_DELTA'), factChanges, epistemicChanges, locationChanges, statusChanges, activationChanges, relationshipChanges, resourceChanges, continuityChanges };
};

const compareChapterId = <T extends { readonly id: string }>(chapter: (entry: T) => number) => (left: T, right: T): number => chapter(left) - chapter(right) || left.id.localeCompare(right.id);
const eventFor = (chapter: number, type: CanonicalStateEvent['type'], id: string, provenanceValue: FactProvenance, affectedIds: readonly string[]): CanonicalStateEvent => ({ id: `event:${chapter}:${type}:${id}`, chapterNumber: chapter, type, affectedIds: [...affectedIds].sort(), provenance: { ...provenanceValue } });
const ensureChapterProvenance = (value: FactProvenance, chapter: number, path: string): void => { if (value.sourceChapter > chapter) fail('TEMPORAL_VIOLATION', 'provenance source is in the future', path); };

const synchronizeCompatibility = (state: StoryState): StoryState => {
    const facts = state.ledgers.facts.slice().sort(compareChapterId(value => value.establishedChapter)).map(value => ({ ...value, provenance: { ...value.provenance } }));
    const knowledgeMap = new Map<string, string[]>(); state.ledgers.epistemic.filter(value => value.kind === 'known' && value.status === 'active').sort(compareChapterId(value => value.learnedChapter)).forEach(value => { const values = knowledgeMap.get(value.characterId) ?? []; values.push(value.factId!); knowledgeMap.set(value.characterId, values); });
    const characterKnowledge = [...knowledgeMap].sort(([left], [right]) => left.localeCompare(right)).map(([characterId, factIds]) => ({ characterId, factIds }));
    const characterLocations = Object.fromEntries(state.projections.characters.filter(value => value.currentLocationRecordId).sort((a, b) => a.characterId.localeCompare(b.characterId)).map(value => [value.characterId, state.ledgers.locations.find(entry => entry.id === value.currentLocationRecordId)!.location]));
    const characterStatuses = Object.fromEntries(state.projections.characters.filter(value => value.activeStatusIds.length > 0).sort((a, b) => a.characterId.localeCompare(b.characterId)).map(value => { const statuses = value.activeStatusIds.map(id => state.ledgers.statuses.find(entry => entry.id === id)!).sort((a, b) => a.id.localeCompare(b.id)); return [value.characterId, { status: statuses.filter(entry => entry.kind === 'status' || entry.kind === 'role').map(entry => entry.state).join('; ') || undefined, injuries: statuses.filter(entry => entry.kind === 'injury').map(entry => entry.state), conditions: statuses.filter(entry => entry.kind === 'condition').map(entry => entry.state) }]; }));
    const relationships = state.projections.relationships.slice().sort((a, b) => a.id.localeCompare(b.id)).map(value => ({ id: value.id, participantIds: [...value.participantIds], state: value.currentState, establishedChapter: value.lastChangedChapter }));
    const resources: Record<string, { id: string; name: string; quantity?: number; state?: string }[]> = {}; state.projections.resources.slice().sort((a, b) => a.characterId.localeCompare(b.characterId) || a.resourceId.localeCompare(b.resourceId)).forEach(value => { (resources[value.characterId] ??= []).push({ id: value.resourceId, name: value.name, ...(value.quantity === undefined ? {} : { quantity: value.quantity }), ...(value.state === undefined ? {} : { state: value.state }) }); });
    const open = state.ledgers.continuity.filter(value => value.status === 'open').sort(compareChapterId(value => value.establishedChapter));
    const unresolvedClues = open.filter(value => value.kind === 'clue').map(value => ({ id: value.id, text: value.text, openedChapter: value.establishedChapter, visibility: value.visibility })); const unresolvedPromises = open.filter(value => value.kind === 'promise').map(value => ({ id: value.id, text: value.text, openedChapter: value.establishedChapter, visibility: value.visibility }));
    const pendingThreads = open.filter(value => value.kind === 'pending-thread' || value.kind === 'obligation' || value.kind === 'condition').map(value => ({ text: value.text, visibility: value.visibility, establishedChapter: value.establishedChapter }));
    return { ...state, knownCharacterIds: state.projections.characters.map(value => value.characterId).sort(), activeCharacterIds: state.projections.characters.filter(value => value.active).map(value => value.characterId).sort(), characterLocations, characterStatuses, facts, characterKnowledge, relationships, resources, unresolvedClues, unresolvedPromises, continuity: { ...state.continuity, pendingThreads } };
};

function validateCompatibilityProjection(state: StoryState): void {
    const expected = synchronizeCompatibility(state);
    const select = (value: StoryState) => ({
        knownCharacterIds: value.knownCharacterIds, activeCharacterIds: value.activeCharacterIds,
        characterLocations: value.characterLocations, characterStatuses: value.characterStatuses,
        facts: value.facts, characterKnowledge: value.characterKnowledge, relationships: value.relationships,
        resources: value.resources, unresolvedClues: value.unresolvedClues,
        unresolvedPromises: value.unresolvedPromises, pendingThreads: value.continuity.pendingThreads,
    });
    if (JSON.stringify(select(state)) !== JSON.stringify(select(expected))) {
        fail('REFERENTIAL_INTEGRITY_FAILURE', 'compatibility projection does not match canonical ledgers', 'state');
    }
}

/** Pure, sequential, atomic low-level transition. It is deliberately not connected to validation output. */
export const applyStoryStateDelta = (control: FullStoryControl, currentValue: unknown, deltaValue: unknown): StoryState => {
    const state = parseStoryState(currentValue, control); const delta = parseStoryStateDelta(deltaValue); const chapter = delta.chapterNumber;
    if (chapter !== state.currentChapter + 1) fail('CHAPTER_SEQUENCE_VIOLATION', 'delta must advance exactly one chapter', 'delta.chapterNumber');
    if (delta.expectedRevision !== state.revision) fail('REVISION_MISMATCH', 'delta revision does not match state', 'delta.expectedRevision');
    const characterExists = (id: string, path: string): void => { const character = control.characters[id]; if (!character) fail('UNKNOWN_CHARACTER', 'unknown character', path); if (character.availableFromChapter > chapter) fail('TEMPORAL_VIOLATION', 'character is not available in this chapter', path); };
    const ids = new Set<string>(); Object.values(state.ledgers).flat().forEach(value => ids.add(value.id));
    const claimId = (id: string, path: string): void => { if (ids.has(id)) fail('DUPLICATE_ID', 'ledger id already exists', path); ids.add(id); };
    delta.factChanges.forEach((value, index) => { claimId(value.id, `delta.factChanges[${index}].id`); if (value.establishedChapter !== chapter) fail('TEMPORAL_VIOLATION', 'fact must be established in delta chapter', `delta.factChanges[${index}]`); ensureChapterProvenance(value.provenance, chapter, `delta.factChanges[${index}].provenance`); });
    const facts = [...state.ledgers.facts, ...delta.factChanges]; const factMap = new Map(facts.map(value => [value.id, value]));
    const epistemic = [...state.ledgers.epistemic];
    delta.epistemicChanges.forEach((value, index) => { const path = `delta.epistemicChanges[${index}]`; claimId(value.id, `${path}.id`); characterExists(value.characterId, `${path}.characterId`); if (value.learnedChapter !== chapter || value.source.sourceChapter > chapter) fail('TEMPORAL_VIOLATION', 'knowledge must be learned in delta chapter from non-future source', path); if (value.source.sourceCharacterId) characterExists(value.source.sourceCharacterId, `${path}.source.sourceCharacterId`); if (value.source.sourceFactId && !factMap.has(value.source.sourceFactId)) fail('UNKNOWN_FACT', 'unknown source fact', `${path}.source.sourceFactId`); if (value.kind === 'known') { const fact = factMap.get(value.factId!); if (!fact) fail('UNKNOWN_FACT', 'unknown fact', `${path}.factId`); if (fact.establishedChapter > chapter) fail('TEMPORAL_VIOLATION', 'knowledge predates fact', path); if (epistemic.some(entry => entry.kind === 'known' && entry.status === 'active' && entry.characterId === value.characterId && entry.factId === value.factId)) fail('CONFLICTING_OPERATION', 'duplicate active character knowledge', path); } value.source.basisFactIds?.forEach(id => { const basis = factMap.get(id); if (!basis || basis.establishedChapter > value.source.sourceChapter) fail('KNOWLEDGE_SOURCE_INVALID', 'unknown or future inference basis', `${path}.source.basisFactIds`); const known = epistemic.some(entry => entry.kind === 'known' && entry.status === 'active' && entry.characterId === value.characterId && entry.factId === id && entry.learnedChapter <= value.source.sourceChapter); if (!known) fail('KNOWLEDGE_SOURCE_INVALID', 'character does not know inference basis', `${path}.source.basisFactIds`); }); epistemic.push(value); });
    const locations = [...state.ledgers.locations]; const statuses = state.ledgers.statuses.map(value => ({ ...value, provenance: { ...value.provenance } })); const characterProjections = state.projections.characters.map(value => ({ ...value, activeStatusIds: [...value.activeStatusIds] }));
    const projectionFor = (characterId: string): CharacterStateProjection => { let found = characterProjections.find(value => value.characterId === characterId); if (!found) { found = { characterId, active: false, lifeStatus: 'unknown', activeStatusIds: [] }; characterProjections.push(found); } return found; };
    delta.locationChanges.forEach((value, index) => { characterExists(value.characterId, `delta.locationChanges[${index}].characterId`); claimId(value.id, `delta.locationChanges[${index}].id`); if (value.sinceChapter !== chapter) fail('TEMPORAL_VIOLATION', 'location must start in delta chapter', `delta.locationChanges[${index}]`); ensureChapterProvenance(value.provenance, chapter, `delta.locationChanges[${index}].provenance`); locations.push(value); const prior = projectionFor(value.characterId); Object.assign(prior, { currentLocationRecordId: value.id }); });
    delta.activationChanges.forEach((value, index) => { characterExists(value.characterId, `delta.activationChanges[${index}].characterId`); ensureChapterProvenance(value.provenance, chapter, `delta.activationChanges[${index}].provenance`); const prior = projectionFor(value.characterId); Object.assign(prior, { active: value.active, ...(value.lifeStatus ? { lifeStatus: value.lifeStatus } : {}) }); });
    delta.statusChanges.forEach((value, index) => { const path = `delta.statusChanges[${index}]`; ensureChapterProvenance(value.provenance, chapter, `${path}.provenance`); if (value.operation === 'add') { const entry = value.record!; characterExists(entry.characterId, `${path}.record.characterId`); claimId(entry.id, `${path}.record.id`); if (entry.establishedChapter !== chapter || entry.resolvedChapter !== undefined) fail('TEMPORAL_VIOLATION', 'new status must begin unresolved in delta chapter', path); statuses.push(entry); const prior = projectionFor(entry.characterId); Object.assign(prior, { activeStatusIds: [...prior.activeStatusIds, entry.id].sort() }); } else { const entryIndex = statuses.findIndex(entry => entry.id === value.statusId); if (entryIndex < 0) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown status', `${path}.statusId`); const priorEntry = statuses[entryIndex]; if (priorEntry.resolvedChapter !== undefined || value.resolvedChapter !== chapter) fail('CONFLICTING_OPERATION', 'status is already resolved or resolution chapter is invalid', path); statuses[entryIndex] = { ...priorEntry, resolvedChapter: chapter }; const prior = projectionFor(priorEntry.characterId); Object.assign(prior, { activeStatusIds: prior.activeStatusIds.filter(id => id !== priorEntry.id) }); } });
    const relationshipHistory = [...state.ledgers.relationships]; const relationshipProjections = state.projections.relationships.map(value => ({ ...value, participantIds: [...value.participantIds] }));
    delta.relationshipChanges.forEach((value, index) => { const path = `delta.relationshipChanges[${index}]`; claimId(value.id, `${path}.id`); value.participantIds.forEach(id => characterExists(id, `${path}.participantIds`)); if (value.chapterNumber !== chapter) fail('TEMPORAL_VIOLATION', 'relationship change must be in delta chapter', path); ensureChapterProvenance(value.provenance, chapter, `${path}.provenance`); const prior = relationshipProjections.find(entry => entry.id === value.relationshipId); if (prior && JSON.stringify(prior.participantIds) !== JSON.stringify(value.participantIds)) fail('REFERENTIAL_INTEGRITY_FAILURE', 'relationship participants cannot change', path); relationshipHistory.push(value); const next = { id: value.relationshipId, participantIds: [...value.participantIds], currentState: value.state, lastChangedChapter: chapter, currentHistoryId: value.id }; if (prior) Object.assign(prior, next); else relationshipProjections.push(next); });
    const resourceHistory = [...state.ledgers.resources]; const resourceProjections = state.projections.resources.map(value => ({ ...value }));
    delta.resourceChanges.forEach((value, index) => { const path = `delta.resourceChanges[${index}]`; characterExists(value.characterId, `${path}.characterId`); claimId(value.id, `${path}.id`); ensureChapterProvenance(value.provenance, chapter, `${path}.provenance`); const prior = resourceProjections.find(entry => entry.characterId === value.characterId && entry.resourceId === value.resourceId); if (prior && prior.name !== value.name) fail('REFERENTIAL_INTEGRITY_FAILURE', 'resource name cannot change', path); const resultingQuantity = value.quantityDelta === undefined ? prior?.quantity : (prior?.quantity ?? 0) + value.quantityDelta; if (resultingQuantity !== undefined && !Number.isFinite(resultingQuantity)) fail('RESOURCE_VALUE_INVALID', 'resource result must be finite', path); const nextState = value.nextState ?? prior?.state; const history: ResourceLedgerRecord = { id: value.id, characterId: value.characterId, resourceId: value.resourceId, name: value.name, chapterNumber: chapter, ...(value.quantityDelta === undefined ? {} : { quantityDelta: value.quantityDelta }), ...(resultingQuantity === undefined ? {} : { resultingQuantity }), ...(prior?.state === undefined ? {} : { previousState: prior.state }), ...(nextState === undefined ? {} : { nextState }), provenance: { ...value.provenance } }; resourceHistory.push(history); const next = { characterId: value.characterId, resourceId: value.resourceId, name: value.name, ...(resultingQuantity === undefined ? {} : { quantity: resultingQuantity }), ...(nextState === undefined ? {} : { state: nextState }), lastChangedChapter: chapter, currentHistoryId: value.id }; if (prior) Object.assign(prior, next); else resourceProjections.push(next); });
    const continuity = state.ledgers.continuity.map(value => ({ ...value, provenance: { ...value.provenance } }));
    delta.continuityChanges.forEach((value, index) => { const path = `delta.continuityChanges[${index}]`; ensureChapterProvenance(value.provenance, chapter, `${path}.provenance`); if (value.operation === 'open') { const entry = value.entry!; claimId(entry.id, `${path}.entry.id`); if (entry.establishedChapter !== chapter) fail('TEMPORAL_VIOLATION', 'continuity must open in delta chapter', path); continuity.push(entry); } else { const entryIndex = continuity.findIndex(entry => entry.id === value.continuityId); if (entryIndex < 0) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown continuity item', path); if (continuity[entryIndex].status !== 'open' || value.chapterNumber !== chapter) fail('CONFLICTING_OPERATION', 'continuity item is not open or chapter is invalid', path); continuity[entryIndex] = { ...continuity[entryIndex], status: value.operation === 'resolve' ? 'resolved' : 'superseded', resolvedChapter: chapter }; } });
    const newEvents: CanonicalStateEvent[] = []; delta.factChanges.forEach(value => newEvents.push(eventFor(chapter, 'fact-added', value.id, value.provenance, [value.id]))); delta.epistemicChanges.forEach(value => newEvents.push(eventFor(chapter, value.kind === 'known' ? 'knowledge-added' : 'belief-added', value.id, { sourceChapter: value.source.sourceChapter, sourceType: 'state-transition', sourceId: value.id }, [value.id, value.characterId, ...(value.factId ? [value.factId] : [])]))); delta.locationChanges.forEach(value => newEvents.push(eventFor(chapter, 'character-moved', value.id, value.provenance, [value.id, value.characterId]))); delta.statusChanges.forEach(value => newEvents.push(eventFor(chapter, value.operation === 'add' ? 'status-added' : 'status-resolved', value.operation === 'add' ? value.record!.id : value.statusId!, value.provenance, [value.operation === 'add' ? value.record!.id : value.statusId!]))); delta.relationshipChanges.forEach(value => newEvents.push(eventFor(chapter, 'relationship-changed', value.id, value.provenance, [value.id, value.relationshipId]))); delta.resourceChanges.forEach(value => newEvents.push(eventFor(chapter, 'resource-changed', value.id, value.provenance, [value.id, value.characterId, value.resourceId]))); delta.continuityChanges.forEach(value => { const id = value.operation === 'open' ? value.entry!.id : value.continuityId!; newEvents.push(eventFor(chapter, value.operation === 'open' ? 'continuity-opened' : value.operation === 'resolve' ? 'continuity-resolved' : 'continuity-superseded', id, value.provenance, [id])); });
    newEvents.forEach((value, index) => claimId(value.id, `generatedEvents[${index}]`));
    const next: StoryState = { ...state, revision: state.revision + 1, currentChapter: chapter, ledgers: { facts: facts.sort(compareChapterId(value => value.establishedChapter)), epistemic: epistemic.sort(compareChapterId(value => value.learnedChapter)), locations: locations.sort(compareChapterId(value => value.sinceChapter)), statuses: statuses.sort(compareChapterId(value => value.establishedChapter)), relationships: relationshipHistory.sort(compareChapterId(value => value.chapterNumber)), resources: resourceHistory.sort(compareChapterId(value => value.chapterNumber)), continuity: continuity.sort(compareChapterId(value => value.establishedChapter)), events: [...state.ledgers.events, ...newEvents].sort(compareChapterId(value => value.chapterNumber)) }, projections: { characters: characterProjections.sort((a, b) => a.characterId.localeCompare(b.characterId)), relationships: relationshipProjections.sort((a, b) => a.id.localeCompare(b.id)), resources: resourceProjections.sort((a, b) => a.characterId.localeCompare(b.characterId) || a.resourceId.localeCompare(b.resourceId)) } };
    const synchronized = synchronizeCompatibility(next); validateStateReferences(synchronized, control); return synchronized;
};

const copy = <T>(value: T): T => structuredClone(value);

/** Historical mixed projections are forbidden; only the exact snapshot chapter is viewable. */
export const buildStoryStateViewForChapter = (stateValue: unknown, chapter: number, control?: FullStoryControl): StoryState => {
    const state = parseStoryState(stateValue, control); if (chapter !== state.currentChapter) fail('TEMPORAL_VIOLATION', 'only the exact snapshot chapter can be viewed safely', 'chapter'); return copy(state);
};

export const getFactById = (state: StoryState, factId: string): CanonicalStoryFact | undefined => { const value = state.ledgers.facts.find(entry => entry.id === factId); return value ? copy(value) : undefined; };
export const getFactsKnownByCharacter = (state: StoryState, characterId: string, targetChapter: number): readonly CanonicalStoryFact[] => {
    if (!Number.isSafeInteger(targetChapter) || targetChapter < 1 || targetChapter > state.currentChapter) fail('TEMPORAL_VIOLATION', 'target is outside state snapshot', 'targetChapter');
    const ids = new Set(state.ledgers.epistemic.filter(value => value.characterId === characterId && value.kind === 'known' && value.status === 'active' && value.learnedChapter <= targetChapter).map(value => value.factId!));
    return state.ledgers.facts.filter(value => ids.has(value.id) && value.establishedChapter <= targetChapter).slice().sort(compareChapterId(value => value.establishedChapter)).map(copy);
};
export const characterKnowsFact = (state: StoryState, characterId: string, factId: string, targetChapter: number): boolean => getFactsKnownByCharacter(state, characterId, targetChapter).some(value => value.id === factId);
export const getCharacterBeliefs = (state: StoryState, characterId: string, targetChapter: number): readonly EpistemicEntry[] => {
    if (!Number.isSafeInteger(targetChapter) || targetChapter < 1 || targetChapter > state.currentChapter) fail('TEMPORAL_VIOLATION', 'target is outside state snapshot', 'targetChapter');
    return state.ledgers.epistemic.filter(value => value.characterId === characterId && value.kind === 'believed' && value.status === 'active' && value.learnedChapter <= targetChapter).slice().sort(compareChapterId(value => value.learnedChapter)).map(copy);
};
export const getCharacterLocation = (state: StoryState, characterId: string): CharacterLocationRecord | undefined => { const projection = state.projections.characters.find(value => value.characterId === characterId); const value = state.ledgers.locations.find(entry => entry.id === projection?.currentLocationRecordId); return value ? copy(value) : undefined; };
export const getActiveCharacterStatuses = (state: StoryState, characterId: string): readonly CharacterStatusRecord[] => { const ids = new Set(state.projections.characters.find(value => value.characterId === characterId)?.activeStatusIds ?? []); return state.ledgers.statuses.filter(value => ids.has(value.id)).slice().sort(compareChapterId(value => value.establishedChapter)).map(copy); };
export const getCharacterResources = (state: StoryState, characterId: string): readonly CanonicalResourceState[] => state.projections.resources.filter(value => value.characterId === characterId).slice().sort((a, b) => a.resourceId.localeCompare(b.resourceId)).map(copy);
export const getRelationshipState = (state: StoryState, relationshipId: string): CanonicalRelationshipState | undefined => { const value = state.projections.relationships.find(entry => entry.id === relationshipId); return value ? copy(value) : undefined; };
export const getOpenContinuityAtChapter = (state: StoryState, targetChapter: number): readonly CanonicalContinuityEntry[] => {
    if (!Number.isSafeInteger(targetChapter) || targetChapter < 1 || targetChapter > state.currentChapter) fail('TEMPORAL_VIOLATION', 'target is outside state snapshot', 'targetChapter');
    return state.ledgers.continuity.filter(value => value.establishedChapter <= targetChapter && (value.resolvedChapter === undefined || value.resolvedChapter > targetChapter)).slice().sort(compareChapterId(value => value.establishedChapter)).map(copy);
};
