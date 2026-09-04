import type { StateExtractionAffordances } from './stateExtractionAffordances';

export const STORY_STATE_DELTA_V2_OPERATION_FIELDS = [
    'factChanges',
    'epistemicChanges',
    'locationChanges',
    'statusChanges',
    'activationChanges',
    'relationshipChanges',
    'resourceChanges',
    'continuityChanges',
    'revealChanges',
    'foreshadowChanges',
    'payoffChanges',
] as const;

export class StoryStateDeltaResponseSchemaError extends Error {
    readonly code = 'INVALID_STATE_EXTRACTOR_CURSOR';

    constructor() {
        super('INVALID_STATE_EXTRACTOR_CURSOR');
        this.name = 'StoryStateDeltaResponseSchemaError';
    }
}

const operationArray = () => ({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
} as const);

const chapterProvenance = (chapterNumber: number) => ({
    type: 'object',
    additionalProperties: false,
    required: ['sourceChapter', 'sourceType'],
    properties: {
        sourceChapter: { type: 'integer', enum: [chapterNumber] },
        sourceType: { type: 'string', enum: ['chapter'] },
        sourceId: { type: 'string' },
    },
} as const);

const factChangesArray = (chapterNumber: number) => ({
    type: 'array',
    items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'establishedChapter', 'visibility', 'status', 'provenance'],
        properties: {
            id: { type: 'string' },
            text: { type: 'string' },
            establishedChapter: { type: 'integer', enum: [chapterNumber] },
            visibility: { type: 'string', enum: ['writer'] },
            status: { type: 'string', enum: ['active'] },
            provenance: chapterProvenance(chapterNumber),
        },
    },
} as const);

const locationChangesArray = (chapterNumber: number, participantIds: readonly string[]) => ({
    type: 'array',
    items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'characterId', 'location', 'sinceChapter', 'provenance'],
        properties: {
            id: { type: 'string' },
            characterId: { type: 'string', enum: [...participantIds] },
            location: { type: 'string' },
            sinceChapter: { type: 'integer', enum: [chapterNumber] },
            provenance: chapterProvenance(chapterNumber),
        },
    },
} as const);

const constrainedString = (values: readonly string[]) => values.length === 0
    ? { type: 'string' } as const
    : { type: 'string', enum: [...new Set(values)] } as const;

const exactArray = (count: number, items: object) => ({
    type: 'array', minItems: count, maxItems: count, items,
} as const);

const activationChangesArray = (chapterNumber: number, participantIds: readonly string[]) => ({
    type: 'array',
    items: {
        type: 'object', additionalProperties: false,
        required: ['characterId', 'active', 'provenance'],
        properties: {
            characterId: constrainedString(participantIds),
            active: { type: 'boolean' },
            lifeStatus: { type: 'string', enum: ['unknown', 'alive', 'dead'] },
            provenance: chapterProvenance(chapterNumber),
        },
    },
} as const);

const relationshipChangesArray = (chapterNumber: number, affordances: StateExtractionAffordances) => exactArray(
    affordances.expectedRelationshipDeltas.length,
    {
        type: 'object', additionalProperties: false,
        required: ['id', 'relationshipId', 'participantIds', 'state', 'chapterNumber', 'provenance'],
        properties: {
            id: { type: 'string' },
            relationshipId: constrainedString(affordances.allowedRelationshipIds),
            participantIds: {
                type: 'array', minItems: 2, items: constrainedString(affordances.participantIds),
            },
            state: constrainedString(affordances.expectedRelationshipDeltas.map(value => value.expectedState)),
            chapterNumber: { type: 'integer', enum: [chapterNumber] },
            provenance: chapterProvenance(chapterNumber),
        },
    },
);

const resourceChangesArray = (chapterNumber: number, affordances: StateExtractionAffordances) => exactArray(
    affordances.expectedResourceDeltas.length,
    {
        type: 'object', additionalProperties: false,
        required: ['id', 'characterId', 'resourceId', 'name', 'provenance'],
        properties: {
            id: { type: 'string' },
            characterId: constrainedString(affordances.allowedResourceRefs.map(value => value.characterId)),
            resourceId: constrainedString(affordances.allowedResourceRefs.map(value => value.resourceId)),
            name: constrainedString(affordances.allowedResourceRefs.map(value => value.name)),
            quantityDelta: { type: 'number' },
            nextState: { type: 'string' },
            provenance: chapterProvenance(chapterNumber),
        },
    },
);

const CANONICAL_CONTINUITY_KINDS = [
    'pending-thread', 'obligation', 'condition', 'clue', 'promise',
] as const;

const continuityTargetSchema = (
    chapterNumber: number,
    target: StateExtractionAffordances['continuityTargets'][number],
) => {
    if (target.allowedOperations.length === 1 && target.allowedOperations[0] === 'open') {
        return {
            type: 'object', additionalProperties: false,
            required: ['operation', 'entry', 'provenance'],
            properties: {
                operation: { type: 'string', enum: ['open'] },
                entry: {
                    type: 'object', additionalProperties: false,
                    required: ['id', 'kind', 'text', 'visibility', 'establishedChapter', 'status', 'provenance'],
                    properties: {
                        id: { type: 'string', enum: [target.id] },
                        kind: {
                            type: 'string',
                            enum: target.requiredKind === 'clue'
                                ? ['clue']
                                : [...CANONICAL_CONTINUITY_KINDS],
                        },
                        text: target.exactText === undefined
                            ? { type: 'string' }
                            : { type: 'string', enum: [target.exactText] },
                        visibility: { type: 'string', enum: ['writer'] },
                        establishedChapter: { type: 'integer', enum: [chapterNumber] },
                        status: { type: 'string', enum: ['open'] },
                        provenance: chapterProvenance(chapterNumber),
                    },
                },
                provenance: chapterProvenance(chapterNumber),
            },
        } as const;
    }
    if (target.allowedOperations.length > 0
        && target.allowedOperations.every(operation => operation === 'resolve' || operation === 'supersede')) {
        return {
            type: 'object', additionalProperties: false,
            required: ['operation', 'continuityId', 'chapterNumber', 'provenance'],
            properties: {
                operation: { type: 'string', enum: [...target.allowedOperations] },
                continuityId: { type: 'string', enum: [target.id] },
                chapterNumber: { type: 'integer', enum: [chapterNumber] },
                provenance: chapterProvenance(chapterNumber),
            },
        } as const;
    }
    throw new StoryStateDeltaResponseSchemaError();
};

const continuityChangesArray = (chapterNumber: number, affordances: StateExtractionAffordances) => ({
    type: 'array',
    minItems: affordances.continuityTargets.length,
    maxItems: affordances.continuityTargets.length,
    prefixItems: affordances.continuityTargets.map(target => continuityTargetSchema(chapterNumber, target)),
} as const);

const revealChangesArray = (chapterNumber: number, affordances: StateExtractionAffordances) => exactArray(
    affordances.plannedRevealIds.length,
    {
        type: 'object', additionalProperties: false,
        required: ['operation', 'occurrence'],
        properties: {
            operation: { type: 'string', enum: ['record'] },
            occurrence: {
                type: 'object', additionalProperties: false,
                required: ['id', 'revealId', 'chapterNumber', 'provenance'],
                properties: {
                    id: { type: 'string' },
                    revealId: constrainedString(affordances.plannedRevealIds),
                    chapterNumber: { type: 'integer', enum: [chapterNumber] },
                    provenance: chapterProvenance(chapterNumber),
                },
            },
        },
    },
);

/**
 * Compact Gemini guidance for the StateDelta V2 envelope, exact durable cursor, and
 * extraction-valid small operation families. Union-heavy operation parsing, exact
 * cross-field reconciliation, and Canon representability remain runtime-owned.
 */
export const buildStoryStateDeltaResponseJsonSchema = (
    chapterNumber: number,
    expectedRevision: number,
    affordances: StateExtractionAffordances,
) => {
    const participantIds = affordances.participantIds;
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
        || affordances.kind !== 'state-extraction-affordances'
        || affordances.targetChapter !== chapterNumber
        || !Array.isArray(participantIds) || participantIds.length < 1
        || participantIds.some(id => typeof id !== 'string' || id.trim().length === 0)
        || new Set(participantIds).size !== participantIds.length) {
        throw new StoryStateDeltaResponseSchemaError();
    }
    return {
        $id: 'story-state-delta-v2-envelope',
        title: 'StoryStateDeltaV2Envelope',
        description: 'Compact Story Engine V4 StateDelta V2 envelope with an exact target cursor.',
        type: 'object',
        additionalProperties: false,
        required: [
            'kind', 'schemaVersion', 'chapterNumber', 'expectedRevision',
            ...STORY_STATE_DELTA_V2_OPERATION_FIELDS,
        ],
        propertyOrdering: [
            'kind', 'schemaVersion', 'chapterNumber', 'expectedRevision',
            ...STORY_STATE_DELTA_V2_OPERATION_FIELDS,
        ],
        properties: {
            kind: { type: 'string', enum: ['story-state-delta'] },
            schemaVersion: { type: 'integer', enum: [2] },
            chapterNumber: { type: 'integer', enum: [chapterNumber] },
            expectedRevision: { type: 'integer', enum: [expectedRevision] },
            factChanges: factChangesArray(chapterNumber),
            epistemicChanges: operationArray(),
            locationChanges: locationChangesArray(chapterNumber, participantIds),
            statusChanges: operationArray(),
            activationChanges: activationChangesArray(chapterNumber, participantIds),
            relationshipChanges: relationshipChangesArray(chapterNumber, affordances),
            resourceChanges: resourceChangesArray(chapterNumber, affordances),
            continuityChanges: continuityChangesArray(chapterNumber, affordances),
            revealChanges: revealChangesArray(chapterNumber, affordances),
            foreshadowChanges: operationArray(),
            payoffChanges: operationArray(),
        },
    } as const;
};
