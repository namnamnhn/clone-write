import { CONFLICT_IMPORTANCE, SCENE_PURPOSE_TAGS } from './plannerTypes';

const ref = (name: string) => ({ $ref: `#/$defs/${name}` });

/**
 * Compact Gemini structural guidance for the untrusted Planner response.
 *
 * This intentionally constrains the core plan and scene shapes while leaving
 * strategicActions and relationshipActions as generic object arrays. Their
 * deep domain contracts remain enforced by the strict runtime parsers and
 * validators after generation.
 */
export const INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA = {
    $id: 'internal-chapter-plan-v4',
    title: 'InternalChapterPlan',
    description: 'Compact Story Engine V4 internal chapter plan. JSON only; never chapter prose.',
    type: 'object',
    additionalProperties: false,
    required: [
        'kind', 'chapterNumber', 'arcId', 'primaryGoal', 'povCharacterId', 'participantIds', 'scenes',
        'activeConstraintIds', 'allowedRevealIds', 'plannedRevealIds', 'relationshipEventIds',
        'storyEventIds', 'cluesPlantedIds', 'cluesPaidOffIds', 'expectedResourceDeltas',
        'expectedRelationshipDeltas', 'expectedContinuityConsequences', 'strategicActions',
        'relationshipActions', 'endStateIntent',
    ],
    propertyOrdering: [
        'kind', 'chapterNumber', 'arcId', 'beatId', 'primaryGoal', 'povCharacterId', 'participantIds',
        'scenes', 'activeConstraintIds', 'allowedRevealIds', 'plannedRevealIds', 'relationshipEventIds',
        'storyEventIds', 'cluesPlantedIds', 'cluesPaidOffIds', 'expectedResourceDeltas',
        'expectedRelationshipDeltas', 'expectedContinuityConsequences', 'strategicActions',
        'relationshipActions', 'endStateIntent',
    ],
    properties: {
        kind: { type: 'string', enum: ['internal-chapter-plan'] },
        chapterNumber: ref('positiveInteger'),
        arcId: ref('nonEmptyString'),
        beatId: ref('nonEmptyString'),
        primaryGoal: ref('nonEmptyString'),
        povCharacterId: ref('nonEmptyString'),
        participantIds: ref('stringArray'),
        scenes: { type: 'array', items: ref('scene') },
        activeConstraintIds: ref('stringArray'),
        allowedRevealIds: ref('stringArray'),
        plannedRevealIds: ref('stringArray'),
        relationshipEventIds: ref('stringArray'),
        storyEventIds: ref('stringArray'),
        cluesPlantedIds: ref('stringArray'),
        cluesPaidOffIds: ref('stringArray'),
        expectedResourceDeltas: { type: 'array', items: ref('expectedResourceDelta') },
        expectedRelationshipDeltas: { type: 'array', items: ref('expectedRelationshipDelta') },
        expectedContinuityConsequences: { type: 'array', items: ref('expectedContinuityConsequence') },
        strategicActions: { type: 'array', items: ref('genericDomainAction') },
        relationshipActions: { type: 'array', items: ref('genericDomainAction') },
        endStateIntent: ref('nonEmptyString'),
    },
    $defs: {
        // Gemini does not support minLength; strict runtime parsing rejects empty strings.
        nonEmptyString: { type: 'string' },
        positiveInteger: { type: 'integer', minimum: 1 },
        stringArray: { type: 'array', items: ref('nonEmptyString') },
        scene: {
            type: 'object', additionalProperties: false,
            required: [
                'id', 'order', 'goal', 'location', 'povCharacterId', 'participantIds',
                'conflictOrObstacle', 'uncertainty', 'expectedConsequence', 'purposeTags', 'conflictImportance',
            ],
            propertyOrdering: [
                'id', 'order', 'goal', 'location', 'povCharacterId', 'participantIds',
                'conflictOrObstacle', 'uncertainty', 'expectedConsequence', 'purposeTags',
                'conflictImportance', 'intelligentConflict',
            ],
            properties: {
                id: ref('nonEmptyString'),
                order: ref('positiveInteger'),
                goal: ref('nonEmptyString'),
                location: ref('nonEmptyString'),
                povCharacterId: ref('nonEmptyString'),
                participantIds: ref('stringArray'),
                conflictOrObstacle: ref('nonEmptyString'),
                uncertainty: ref('nonEmptyString'),
                expectedConsequence: ref('nonEmptyString'),
                purposeTags: {
                    type: 'array', minItems: 1,
                    items: { type: 'string', enum: [...SCENE_PURPOSE_TAGS] },
                },
                conflictImportance: { type: 'string', enum: [...CONFLICT_IMPORTANCE] },
                intelligentConflict: ref('intelligentConflict'),
            },
        },
        intelligentConflict: {
            type: 'object', additionalProperties: false,
            required: [
                'protagonistObjective', 'opponentObjective', 'opponentKnowledge', 'opponentBeliefs',
                'rationalCountermove', 'uncertainty', 'expectedCostOrTradeoff',
            ],
            properties: {
                opponentCharacterId: ref('nonEmptyString'),
                protagonistObjective: ref('nonEmptyString'),
                opponentObjective: ref('nonEmptyString'),
                opponentKnowledge: ref('stringArray'),
                opponentBeliefs: ref('stringArray'),
                rationalCountermove: ref('nonEmptyString'),
                uncertainty: ref('nonEmptyString'),
                expectedCostOrTradeoff: ref('nonEmptyString'),
            },
        },
        expectedResourceDelta: {
            type: 'object', additionalProperties: false,
            required: ['characterId', 'resourceId'],
            properties: {
                characterId: ref('nonEmptyString'), resourceId: ref('nonEmptyString'),
                quantityDelta: { type: 'number' }, nextState: ref('nonEmptyString'),
            },
        },
        expectedRelationshipDelta: {
            type: 'object', additionalProperties: false,
            required: ['relationshipId', 'participantIds', 'expectedState'],
            properties: {
                relationshipId: ref('nonEmptyString'),
                participantIds: { type: 'array', minItems: 2, items: ref('nonEmptyString') },
                expectedState: ref('nonEmptyString'),
            },
        },
        expectedContinuityConsequence: {
            type: 'object', additionalProperties: false, required: ['id', 'text'],
            properties: { id: ref('nonEmptyString'), text: ref('nonEmptyString') },
        },
        // Provider guidance stops here deliberately. Runtime domain parsers own deep validation.
        genericDomainAction: { type: 'object', additionalProperties: true },
    },
} as const;
