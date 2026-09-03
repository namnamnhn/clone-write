import {
    COMMERCE_ACTION_TYPES,
    COMMERCE_FLOW_ROLES,
    MILITARY_OPERATION_TYPES,
    MILITARY_READINESS_DIMENSIONS,
    POLITICAL_DIMENSIONS,
    STRATEGIC_ASSESSMENT_STATUSES,
} from './strategicTypes';
import {
    POWER_BALANCE_STATES,
    RELATIONSHIP_ACTION_TYPES,
    RELATIONSHIP_ASSESSMENT_LEVELS,
    RELATIONSHIP_BOUNDARY_CONSTRAINTS,
    RELATIONSHIP_BOUNDARY_STANCES,
    RELATIONSHIP_BOUNDARY_TYPES,
    RELATIONSHIP_CATEGORIES,
    RELATIONSHIP_DIRECTIONS,
    ROMANCE_MILESTONES,
} from './relationshipTypes';
import { CONFLICT_IMPORTANCE, SCENE_PURPOSE_TAGS } from './plannerTypes';

const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const stringEnum = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

const STRATEGIC_COMMON_REQUIRED = [
    'id', 'domain', 'sceneIds', 'importance', 'actorCharacterId', 'objective', 'uncertainty',
    'expectedCostOrTradeoff', 'writerVisibleConstraints', 'actorKnowledgeFactIds', 'relationshipEffects',
] as const;

const strategicCommonProperties = (domain: 'politics' | 'military' | 'commerce') => ({
    id: ref('nonEmptyString'),
    domain: { type: 'string', enum: [domain] },
    sceneIds: { type: 'array', minItems: 1, items: ref('nonEmptyString') },
    importance: stringEnum(CONFLICT_IMPORTANCE),
    actorCharacterId: ref('nonEmptyString'),
    objective: ref('nonEmptyString'),
    uncertainty: ref('nonEmptyString'),
    expectedCostOrTradeoff: ref('nonEmptyString'),
    writerVisibleConstraints: ref('stringArray'),
    actorKnowledgeFactIds: ref('stringArray'),
    relationshipEffects: { type: 'array', items: ref('strategicRelationshipEffect') },
    countermove: ref('strategicCountermove'),
    writerVisibleCounterplay: ref('writerVisibleCounterplay'),
    noCountermoveReason: ref('nonEmptyString'),
});

/**
 * Gemini-compatible structural guidance for the untrusted Planner response.
 * Runtime parsing and validation remain authoritative for non-empty strings,
 * uniqueness, references, scene ordering, and all semantic invariants.
 */
export const INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA = {
    $id: 'internal-chapter-plan-v4',
    title: 'InternalChapterPlan',
    description: 'Strict Story Engine V4 internal chapter plan. JSON only; never chapter prose.',
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
        strategicActions: { type: 'array', items: ref('strategicAction') },
        relationshipActions: { type: 'array', items: ref('relationshipAction') },
        endStateIntent: ref('nonEmptyString'),
    },
    $defs: {
        // Gemini does not support minLength; strict runtime parsing rejects empty strings.
        nonEmptyString: { type: 'string' },
        positiveInteger: { type: 'integer', minimum: 1 },
        nonNegativeInteger: { type: 'integer', minimum: 0 },
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
                purposeTags: { type: 'array', minItems: 1, items: stringEnum(SCENE_PURPOSE_TAGS) },
                conflictImportance: stringEnum(CONFLICT_IMPORTANCE),
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
        strategicResourceEffect: {
            type: 'object', additionalProperties: false, required: ['characterId', 'resourceId', 'quantityDelta'],
            properties: { characterId: ref('nonEmptyString'), resourceId: ref('nonEmptyString'), quantityDelta: { type: 'number' } },
        },
        strategicRelationshipEffect: {
            type: 'object', additionalProperties: false, required: ['relationshipId', 'expectedState'],
            properties: { relationshipId: ref('nonEmptyString'), expectedState: ref('nonEmptyString') },
        },
        strategicCountermove: {
            type: 'object', additionalProperties: false,
            required: ['opponentCharacterId', 'opponentKnowledgeFactIds', 'opponentBeliefClaims', 'action', 'uncertainty', 'costOrTradeoff'],
            properties: {
                opponentCharacterId: ref('nonEmptyString'), opponentKnowledgeFactIds: ref('stringArray'),
                opponentBeliefClaims: ref('stringArray'), action: ref('nonEmptyString'),
                uncertainty: ref('nonEmptyString'), costOrTradeoff: ref('nonEmptyString'),
            },
        },
        writerVisibleCounterplay: {
            type: 'object', additionalProperties: false,
            required: ['opponentCharacterId', 'action', 'uncertainty', 'costOrTradeoff'],
            properties: {
                opponentCharacterId: ref('nonEmptyString'), action: ref('nonEmptyString'),
                uncertainty: ref('nonEmptyString'), costOrTradeoff: ref('nonEmptyString'),
            },
        },
        strategicEvidence: {
            oneOf: [
                { type: 'object', additionalProperties: false, required: ['type', 'id'], properties: { type: { type: 'string', enum: ['fact', 'relationship', 'canon-rule'] }, id: ref('nonEmptyString') } },
                { type: 'object', additionalProperties: false, required: ['type', 'characterId', 'factId'], properties: { type: { type: 'string', enum: ['knowledge'] }, characterId: ref('nonEmptyString'), factId: ref('nonEmptyString') } },
                { type: 'object', additionalProperties: false, required: ['type', 'characterId', 'resourceId'], properties: { type: { type: 'string', enum: ['resource'] }, characterId: ref('nonEmptyString'), resourceId: ref('nonEmptyString') } },
                { type: 'object', additionalProperties: false, required: ['type', 'characterId', 'value'], properties: { type: { type: 'string', enum: ['character-status'] }, characterId: ref('nonEmptyString'), value: ref('nonEmptyString') } },
            ],
        },
        politicalDimension: {
            type: 'object', additionalProperties: false, required: ['dimension', 'status', 'evidenceRefs'],
            properties: {
                dimension: stringEnum(POLITICAL_DIMENSIONS), status: stringEnum(STRATEGIC_ASSESSMENT_STATUSES),
                evidenceRefs: { type: 'array', items: ref('strategicEvidence') },
            },
        },
        politicalTiming: {
            type: 'object', additionalProperties: false, required: ['preparationChapters'],
            properties: {
                earliestChapter: ref('positiveInteger'), deadlineChapter: ref('positiveInteger'),
                preparationChapters: ref('nonNegativeInteger'),
            },
        },
        resourceReference: {
            type: 'object', additionalProperties: false, required: ['characterId', 'resourceId'],
            properties: { characterId: ref('nonEmptyString'), resourceId: ref('nonEmptyString') },
        },
        readinessAssessment: {
            type: 'object', additionalProperties: false, required: ['dimension', 'status', 'evidenceRefs'],
            properties: {
                dimension: stringEnum(MILITARY_READINESS_DIMENSIONS), status: stringEnum(STRATEGIC_ASSESSMENT_STATUSES),
                evidenceRefs: { type: 'array', items: ref('strategicEvidence') },
            },
        },
        numberOrUnknown: { oneOf: [{ type: 'number' }, { type: 'string', enum: ['unknown'] }] },
        nonNegativeIntegerOrUnknown: { oneOf: [ref('nonNegativeInteger'), { type: 'string', enum: ['unknown'] }] },
        militaryLogistics: {
            type: 'object', additionalProperties: false,
            required: ['supplyResource', 'expectedSupplyConsumption', 'movementConstraint', 'operationalTimeChapters', 'resupplyOrFallback'],
            properties: {
                supplyResource: ref('resourceReference'), expectedSupplyConsumption: ref('numberOrUnknown'),
                mobilityResource: ref('resourceReference'), movementConstraint: ref('nonEmptyString'),
                operationalTimeChapters: ref('nonNegativeIntegerOrUnknown'), resupplyOrFallback: ref('nonEmptyString'),
            },
        },
        militaryMovement: {
            type: 'object', additionalProperties: false,
            required: ['fromLocation', 'toLocation', 'method', 'transitChapters'],
            properties: {
                fromLocation: ref('nonEmptyString'), toLocation: ref('nonEmptyString'), method: ref('nonEmptyString'),
                transitChapters: ref('nonNegativeIntegerOrUnknown'),
            },
        },
        commerceResourceFlow: {
            type: 'object', additionalProperties: false, required: ['characterId', 'resourceId', 'quantityDelta', 'role'],
            properties: {
                characterId: ref('nonEmptyString'), resourceId: ref('nonEmptyString'), quantityDelta: { type: 'number' },
                role: stringEnum(COMMERCE_FLOW_ROLES),
            },
        },
        commerceTiming: {
            type: 'object', additionalProperties: false, required: ['settlementChapters'],
            properties: { settlementChapters: ref('nonNegativeIntegerOrUnknown'), deadlineChapter: ref('positiveInteger') },
        },
        politicalAction: {
            type: 'object', additionalProperties: false,
            required: [...STRATEGIC_COMMON_REQUIRED, 'dimensions', 'timing', 'resourceEffects'],
            properties: {
                ...strategicCommonProperties('politics'),
                dimensions: { type: 'array', minItems: POLITICAL_DIMENSIONS.length, maxItems: POLITICAL_DIMENSIONS.length, items: ref('politicalDimension') },
                timing: ref('politicalTiming'), resourceEffects: { type: 'array', items: ref('strategicResourceEffect') },
            },
        },
        militaryAction: {
            type: 'object', additionalProperties: false,
            required: [...STRATEGIC_COMMON_REQUIRED, 'operationType', 'location', 'intelligenceFactIds', 'readiness', 'resourceEffects', 'expectedLossOrCost', 'retreatOrFailurePlan'],
            properties: {
                ...strategicCommonProperties('military'), operationType: stringEnum(MILITARY_OPERATION_TYPES),
                location: ref('nonEmptyString'), intelligenceFactIds: ref('stringArray'),
                readiness: { type: 'array', minItems: MILITARY_READINESS_DIMENSIONS.length, maxItems: MILITARY_READINESS_DIMENSIONS.length, items: ref('readinessAssessment') },
                resourceEffects: { type: 'array', items: ref('strategicResourceEffect') }, logistics: ref('militaryLogistics'),
                movement: ref('militaryMovement'), expectedLossOrCost: ref('nonEmptyString'), retreatOrFailurePlan: ref('nonEmptyString'),
            },
        },
        commerceAction: {
            type: 'object', additionalProperties: false,
            required: [...STRATEGIC_COMMON_REQUIRED, 'actionType', 'resourceFlows', 'sourceEvidenceRefs', 'logistics', 'timing', 'risk'],
            properties: {
                ...strategicCommonProperties('commerce'), actionType: stringEnum(COMMERCE_ACTION_TYPES),
                resourceFlows: { type: 'array', items: ref('commerceResourceFlow') }, counterpartyCharacterId: ref('nonEmptyString'),
                marketSource: ref('nonEmptyString'), sourceEvidenceRefs: { type: 'array', items: ref('strategicEvidence') },
                serviceOrContractBasis: ref('nonEmptyString'), logistics: ref('nonEmptyString'), timing: ref('commerceTiming'),
                risk: ref('nonEmptyString'), competitorCharacterId: ref('nonEmptyString'), fundingResource: ref('resourceReference'),
            },
        },
        strategicAction: { oneOf: [ref('politicalAction'), ref('militaryAction'), ref('commerceAction')] },
        relationshipAssessment: {
            type: 'object', additionalProperties: false,
            required: ['trust', 'respect', 'attraction', 'emotionalOpenness', 'dependency', 'conflict', 'sharedInterest', 'powerBalance'],
            properties: {
                trust: stringEnum(RELATIONSHIP_ASSESSMENT_LEVELS), respect: stringEnum(RELATIONSHIP_ASSESSMENT_LEVELS),
                attraction: stringEnum(RELATIONSHIP_ASSESSMENT_LEVELS), emotionalOpenness: stringEnum(RELATIONSHIP_ASSESSMENT_LEVELS),
                dependency: stringEnum(RELATIONSHIP_ASSESSMENT_LEVELS), conflict: stringEnum(RELATIONSHIP_ASSESSMENT_LEVELS),
                sharedInterest: stringEnum(RELATIONSHIP_ASSESSMENT_LEVELS), powerBalance: stringEnum(POWER_BALANCE_STATES),
            },
        },
        relationshipProgression: {
            type: 'object', additionalProperties: false,
            required: ['direction', 'romanticMilestone', 'mutual', 'intermediate'],
            properties: {
                direction: stringEnum(RELATIONSHIP_DIRECTIONS), romanticMilestone: stringEnum(ROMANCE_MILESTONES),
                expectedState: ref('nonEmptyString'), mutual: { type: 'boolean' }, intermediate: { type: 'boolean' },
            },
        },
        relationshipParticipantAgency: {
            type: 'object', additionalProperties: false,
            required: ['characterId', 'currentGoal', 'desiredOutcome', 'boundary', 'choice', 'willingness', 'uncertainty', 'costOrRisk', 'knowledgeBasisFactIds'],
            properties: {
                characterId: ref('nonEmptyString'), currentGoal: ref('nonEmptyString'), desiredOutcome: ref('nonEmptyString'),
                boundary: ref('nonEmptyString'), choice: ref('nonEmptyString'), willingness: stringEnum(['yes', 'no', 'uncertain']),
                uncertainty: ref('nonEmptyString'), costOrRisk: ref('nonEmptyString'), knowledgeBasisFactIds: ref('stringArray'),
            },
        },
        relationshipBoundary: {
            type: 'object', additionalProperties: false, required: ['characterId', 'type', 'constraint', 'stance', 'instruction'],
            properties: {
                characterId: ref('nonEmptyString'), type: stringEnum(RELATIONSHIP_BOUNDARY_TYPES),
                constraint: stringEnum(RELATIONSHIP_BOUNDARY_CONSTRAINTS), stance: stringEnum(RELATIONSHIP_BOUNDARY_STANCES),
                instruction: ref('nonEmptyString'),
            },
        },
        relationshipEvidence: {
            oneOf: [
                { type: 'object', additionalProperties: false, required: ['type', 'id'], properties: { type: { type: 'string', enum: ['fact', 'relationship', 'relationship-history', 'strategic-action'] }, id: ref('nonEmptyString') } },
                { type: 'object', additionalProperties: false, required: ['type', 'characterId', 'factId'], properties: { type: { type: 'string', enum: ['knowledge'] }, characterId: ref('nonEmptyString'), factId: ref('nonEmptyString') } },
                { type: 'object', additionalProperties: false, required: ['type', 'characterId', 'epistemicId'], properties: { type: { type: 'string', enum: ['belief'] }, characterId: ref('nonEmptyString'), epistemicId: ref('nonEmptyString') } },
                { type: 'object', additionalProperties: false, required: ['type', 'characterId', 'value'], properties: { type: { type: 'string', enum: ['character-status'] }, characterId: ref('nonEmptyString'), value: ref('nonEmptyString') } },
            ],
        },
        relationshipWriterVisibleContract: {
            type: 'object', additionalProperties: false,
            required: ['currentDynamic', 'objective', 'visibleConflict', 'visibleUncertainty'],
            properties: {
                currentDynamic: ref('nonEmptyString'), objective: ref('nonEmptyString'),
                visibleConflict: ref('nonEmptyString'), visibleUncertainty: ref('nonEmptyString'),
            },
        },
        relationshipAction: {
            type: 'object', additionalProperties: false,
            required: [
                'id', 'sceneIds', 'relationshipId', 'participantIds', 'category', 'actionType', 'importance',
                'currentStateAssessment', 'currentRomanceMilestone', 'intendedProgression', 'participantAgency',
                'boundaries', 'evidenceRefs', 'counterpressure', 'uncertainty', 'expectedCostOrTradeoff',
                'powerImbalanceAddressed', 'writerVisibleContract',
            ],
            properties: {
                id: ref('nonEmptyString'), sceneIds: { type: 'array', minItems: 1, items: ref('nonEmptyString') },
                relationshipId: ref('nonEmptyString'), relationshipEventId: ref('nonEmptyString'),
                participantIds: { type: 'array', minItems: 1, items: ref('nonEmptyString') },
                category: stringEnum(RELATIONSHIP_CATEGORIES), actionType: stringEnum(RELATIONSHIP_ACTION_TYPES),
                jealousCharacterId: ref('nonEmptyString'), importance: stringEnum(CONFLICT_IMPORTANCE),
                currentStateAssessment: ref('relationshipAssessment'), currentRomanceMilestone: stringEnum(ROMANCE_MILESTONES),
                intendedProgression: ref('relationshipProgression'),
                participantAgency: { type: 'array', items: ref('relationshipParticipantAgency') },
                boundaries: { type: 'array', items: ref('relationshipBoundary') },
                evidenceRefs: { type: 'array', items: ref('relationshipEvidence') },
                counterpressure: ref('nonEmptyString'), uncertainty: ref('nonEmptyString'),
                expectedCostOrTradeoff: ref('nonEmptyString'), powerImbalanceAddressed: { type: 'boolean' },
                writerVisibleContract: ref('relationshipWriterVisibleContract'), dependsOnActionId: ref('nonEmptyString'),
            },
        },
    },
} as const;
