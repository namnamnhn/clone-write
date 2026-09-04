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

/**
 * Compact Gemini guidance for the StateDelta V2 envelope, exact durable cursor, and
 * extraction-valid new facts/location changes. All other deep operation parsing,
 * reconciliation, and Canon representability remain runtime-owned.
 */
export const buildStoryStateDeltaResponseJsonSchema = (
    chapterNumber: number,
    expectedRevision: number,
    participantIds: readonly string[],
) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
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
            activationChanges: operationArray(),
            relationshipChanges: operationArray(),
            resourceChanges: operationArray(),
            continuityChanges: operationArray(),
            revealChanges: operationArray(),
            foreshadowChanges: operationArray(),
            payoffChanges: operationArray(),
        },
    } as const;
};
