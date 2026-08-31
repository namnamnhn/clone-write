import type { ConflictImportance, PlanValidationIssue } from './plannerTypes';
import type { StoryId } from './types';

export const STRATEGIC_DOMAINS = ['politics', 'military', 'commerce'] as const;
export type StrategicDomain = typeof STRATEGIC_DOMAINS[number];

export const STRATEGIC_ISSUE_CODES = [
    'INVALID_STRATEGIC_ACTION',
    'STRATEGIC_REFERENCE_INVALID',
    'STRATEGIC_SCENE_COVERAGE_VIOLATION',
    'STRATEGIC_RESOURCE_RECONCILIATION_VIOLATION',
    'STRATEGIC_RELATIONSHIP_RECONCILIATION_VIOLATION',
    'STRATEGIC_RESOURCE_CAPACITY_VIOLATION',
    'STRATEGIC_INTELLIGENT_CONFLICT_VIOLATION',
    'OPPONENT_KNOWLEDGE_VIOLATION',
    'POLITICAL_DIMENSION_VIOLATION',
    'POLITICAL_AUTHORITY_VIOLATION',
    'POLITICAL_INFORMATION_VIOLATION',
    'POLITICAL_LAW_VIOLATION',
    'POLITICAL_RESOURCE_VIOLATION',
    'POLITICAL_TIMING_VIOLATION',
    'POLITICAL_COUNTERMOVE_MISSING',
    'MILITARY_LOGISTICS_VIOLATION',
    'MILITARY_LOCATION_VIOLATION',
    'MILITARY_RESOURCE_VIOLATION',
    'MILITARY_INTELLIGENCE_VIOLATION',
    'MILITARY_COST_MISSING',
    'COMMERCE_FLOW_VIOLATION',
    'COMMERCE_RESOURCE_VIOLATION',
    'COMMERCE_COUNTERPARTY_VIOLATION',
    'COMMERCE_FINANCING_VIOLATION',
    'COMMERCE_COUNTERMOVE_MISSING',
] as const;
export type StrategicIssueCode = typeof STRATEGIC_ISSUE_CODES[number];

export type StrategicEvidenceRef =
    | { readonly type: 'fact'; readonly id: StoryId }
    | { readonly type: 'knowledge'; readonly characterId: StoryId; readonly factId: StoryId }
    | { readonly type: 'relationship'; readonly id: StoryId }
    | { readonly type: 'resource'; readonly characterId: StoryId; readonly resourceId: StoryId }
    | { readonly type: 'canon-rule'; readonly id: StoryId }
    | { readonly type: 'character-status'; readonly characterId: StoryId; readonly value: string };

export interface StrategicResourceEffect {
    readonly characterId: StoryId;
    readonly resourceId: StoryId;
    readonly quantityDelta: number;
}

export interface StrategicRelationshipEffect {
    readonly relationshipId: StoryId;
    readonly expectedState: string;
}

export interface StrategicCountermove {
    readonly opponentCharacterId: StoryId;
    readonly opponentKnowledgeFactIds: readonly StoryId[];
    /** Canonical belief projection is intentionally deferred; claims remain explicitly uncertain. */
    readonly opponentBeliefClaims: readonly string[];
    readonly action: string;
    readonly uncertainty: string;
    readonly costOrTradeoff: string;
}

export interface StrategicActionBase {
    readonly id: StoryId;
    readonly domain: StrategicDomain;
    readonly sceneIds: readonly StoryId[];
    readonly importance: ConflictImportance;
    readonly actorCharacterId: StoryId;
    readonly objective: string;
    readonly uncertainty: string;
    readonly expectedCostOrTradeoff: string;
    readonly writerVisibleConstraints: readonly string[];
    readonly actorKnowledgeFactIds: readonly StoryId[];
    readonly relationshipEffects: readonly StrategicRelationshipEffect[];
    readonly countermove?: StrategicCountermove;
    /** Required when no structured countermove applies; major politics/commerce cannot use it. */
    readonly noCountermoveReason?: string;
}

export const POLITICAL_DIMENSIONS = [
    'authority', 'information', 'personnel', 'money', 'law', 'reputation', 'time',
] as const;
export type PoliticalDimension = typeof POLITICAL_DIMENSIONS[number];
export const STRATEGIC_ASSESSMENT_STATUSES = ['supporting', 'constraining', 'neutral', 'unknown'] as const;
export type StrategicAssessmentStatus = typeof STRATEGIC_ASSESSMENT_STATUSES[number];

export interface PoliticalDimensionAssessment {
    readonly dimension: PoliticalDimension;
    readonly status: StrategicAssessmentStatus;
    readonly evidenceRefs: readonly StrategicEvidenceRef[];
}

export interface PoliticalTiming {
    readonly earliestChapter?: number;
    readonly deadlineChapter?: number;
    readonly preparationChapters: number;
}

export interface PoliticalActionPlan extends StrategicActionBase {
    readonly domain: 'politics';
    readonly dimensions: readonly PoliticalDimensionAssessment[];
    readonly timing: PoliticalTiming;
    readonly resourceEffects: readonly StrategicResourceEffect[];
}

export const MILITARY_OPERATION_TYPES = [
    'march', 'raid', 'defend', 'siege', 'assault', 'ambush', 'withdrawal', 'escort',
    'blockade', 'reconnaissance', 'resupply', 'other-strategic-operation',
] as const;
export type MilitaryOperationType = typeof MILITARY_OPERATION_TYPES[number];
export const MILITARY_READINESS_DIMENSIONS = [
    'manpower', 'supply', 'mobility', 'intelligence', 'command', 'morale', 'terrain', 'time', 'reserve-retreat',
] as const;
export type MilitaryReadinessDimension = typeof MILITARY_READINESS_DIMENSIONS[number];

export interface MilitaryReadinessAssessment {
    readonly dimension: MilitaryReadinessDimension;
    readonly status: StrategicAssessmentStatus;
    readonly evidenceRefs: readonly StrategicEvidenceRef[];
}

export interface MilitaryLogisticsPlan {
    readonly supplyResource: { readonly characterId: StoryId; readonly resourceId: StoryId };
    readonly expectedSupplyConsumption: number | 'unknown';
    readonly mobilityResource?: { readonly characterId: StoryId; readonly resourceId: StoryId };
    readonly movementConstraint: string;
    readonly operationalTimeChapters: number | 'unknown';
    readonly resupplyOrFallback: string;
}

export interface MilitaryMovementPlan {
    readonly fromLocation: string;
    readonly toLocation: string;
    readonly method: string;
    readonly transitChapters: number | 'unknown';
}

export interface MilitaryActionPlan extends StrategicActionBase {
    readonly domain: 'military';
    readonly operationType: MilitaryOperationType;
    readonly location: string;
    readonly intelligenceFactIds: readonly StoryId[];
    readonly readiness: readonly MilitaryReadinessAssessment[];
    readonly resourceEffects: readonly StrategicResourceEffect[];
    readonly logistics?: MilitaryLogisticsPlan;
    readonly movement?: MilitaryMovementPlan;
    readonly expectedLossOrCost: string;
    readonly retreatOrFailurePlan: string;
}

export const COMMERCE_ACTION_TYPES = [
    'purchase', 'sale', 'loan', 'repayment', 'investment', 'contract', 'market-entry',
    'price-war', 'supply-disruption', 'transport', 'production', 'other-commercial-action',
] as const;
export type CommerceActionType = typeof COMMERCE_ACTION_TYPES[number];
export const COMMERCE_FLOW_ROLES = [
    'cash', 'inventory', 'credit', 'debt', 'transport', 'production', 'barter', 'other',
] as const;
export type CommerceFlowRole = typeof COMMERCE_FLOW_ROLES[number];

export interface CommerceResourceFlow extends StrategicResourceEffect {
    readonly role: CommerceFlowRole;
}

export interface CommerceTiming {
    readonly settlementChapters: number | 'unknown';
    readonly deadlineChapter?: number;
}

export interface CommerceActionPlan extends StrategicActionBase {
    readonly domain: 'commerce';
    readonly actionType: CommerceActionType;
    readonly resourceFlows: readonly CommerceResourceFlow[];
    readonly counterpartyCharacterId?: StoryId;
    readonly marketSource?: string;
    readonly sourceEvidenceRefs: readonly StrategicEvidenceRef[];
    readonly serviceOrContractBasis?: string;
    readonly logistics: string;
    readonly timing: CommerceTiming;
    readonly risk: string;
    readonly competitorCharacterId?: StoryId;
    readonly fundingResource?: { readonly characterId: StoryId; readonly resourceId: StoryId };
}

export type StrategicActionPlan = PoliticalActionPlan | MilitaryActionPlan | CommerceActionPlan;

export interface StrategicValidationResult {
    readonly status: 'feasible' | 'infeasible' | 'under-specified';
    readonly issues: readonly PlanValidationIssue[];
}

/** Deliberately reduced prose-facing projection. It excludes evidence and opponent epistemics. */
export interface WriterStrategicDirective {
    readonly id: StoryId;
    readonly domain: StrategicDomain;
    readonly sceneIds: readonly StoryId[];
    readonly actorCharacterId: StoryId;
    readonly visibleObjective: string;
    readonly visibleConstraints: readonly string[];
    readonly expectedCostOrTradeoff: string;
    readonly visibleOperationalRequirements: readonly string[];
}

export interface ValidatorStrategicActionDescriptor {
    readonly id: StoryId;
    readonly domain: StrategicDomain;
    readonly sceneIds: readonly StoryId[];
    readonly actorCharacterId: StoryId;
    readonly opponentCharacterId?: StoryId;
    readonly evidenceRefs: readonly StrategicEvidenceRef[];
    readonly resourceKeys: readonly string[];
    readonly actorKnowledgeFactIds: readonly StoryId[];
    readonly opponentKnowledgeFactIds: readonly StoryId[];
}

export interface ValidatorStrategicView {
    readonly kind: 'validator-strategic-view';
    readonly chapterNumber: number;
    readonly actions: readonly ValidatorStrategicActionDescriptor[];
    readonly deterministicIssues: readonly Pick<PlanValidationIssue, 'code' | 'path' | 'severity'>[];
    readonly resourceEvidence: readonly { readonly characterId: StoryId; readonly resourceId: StoryId; readonly quantity?: number }[];
    readonly epistemicEvidence: readonly { readonly characterId: StoryId; readonly factId: StoryId }[];
}
