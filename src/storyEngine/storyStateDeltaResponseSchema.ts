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

/**
 * Compact Gemini guidance for the StateDelta V2 envelope and exact durable cursor.
 * Deep operation parsing, reconciliation, and Canon representability remain runtime-owned.
 */
export const buildStoryStateDeltaResponseJsonSchema = (
    chapterNumber: number,
    expectedRevision: number,
) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
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
            factChanges: operationArray(),
            epistemicChanges: operationArray(),
            locationChanges: operationArray(),
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
