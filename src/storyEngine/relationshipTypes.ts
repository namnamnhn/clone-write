import type { PlanValidationIssue } from './plannerTypes';
import type { StoryId } from './types';

export const RELATIONSHIP_CATEGORIES = [
    'romantic', 'professional', 'friendship', 'rivalry', 'family',
    'political-alliance', 'mentor', 'loyalty', 'adversarial',
] as const;
export type RelationshipCategory = typeof RELATIONSHIP_CATEGORIES[number];

export const RELATIONSHIP_ACTION_TYPES = [
    'establish-contact', 'cooperate', 'test-trust', 'deepen-trust',
    'reveal-vulnerability', 'professional-respect', 'flirtation', 'romantic-tension',
    'courtship', 'confession', 'accept-romance', 'reject-romance', 'jealousy',
    'rivalry-escalation', 'rupture', 'reconciliation', 'alliance',
    'boundary-setting', 'support', 'sacrifice', 'separation',
] as const;
export type RelationshipActionType = typeof RELATIONSHIP_ACTION_TYPES[number];

export const ROMANCE_MILESTONES = [
    'none', 'awareness', 'interest', 'attraction', 'trust-building',
    'mutual-tension', 'acknowledged-interest', 'courtship', 'committed-romance',
] as const;
export type RomanceMilestone = typeof ROMANCE_MILESTONES[number];

export const RELATIONSHIP_ASSESSMENT_LEVELS = ['low', 'emerging', 'moderate', 'high', 'unknown'] as const;
export type RelationshipAssessmentLevel = typeof RELATIONSHIP_ASSESSMENT_LEVELS[number];
export const POWER_BALANCE_STATES = ['balanced', 'unequal', 'contested', 'unknown'] as const;
export type PowerBalanceState = typeof POWER_BALANCE_STATES[number];
export const RELATIONSHIP_DIRECTIONS = ['strengthening', 'stable', 'weakening', 'conflicted'] as const;
export type RelationshipDirection = typeof RELATIONSHIP_DIRECTIONS[number];

export const RELATIONSHIP_DYNAMIC_TAGS = [
    'professional-equals', 'ideological-rivals', 'political-alliance', 'mentor-tension',
    'mutual-respect', 'adversarial-attraction', 'slow-earned-trust', 'family-duty',
    'loyalty-under-pressure', 'unequal-power', 'public-formality', 'private-vulnerability',
] as const;
export type RelationshipDynamicTag = typeof RELATIONSHIP_DYNAMIC_TAGS[number];

export const RELATIONSHIP_BOUNDARY_TYPES = [
    'professional', 'emotional', 'public-private', 'political', 'personal-space', 'commitment',
] as const;
export type RelationshipBoundaryType = typeof RELATIONSHIP_BOUNDARY_TYPES[number];
export const RELATIONSHIP_BOUNDARY_CONSTRAINTS = [
    'professional-only', 'no-romance', 'no-public-display', 'no-intimacy',
    'political-duty', 'personal-space', 'custom',
] as const;
export type RelationshipBoundaryConstraint = typeof RELATIONSHIP_BOUNDARY_CONSTRAINTS[number];
export const RELATIONSHIP_BOUNDARY_STANCES = ['maintain', 'set', 'revise', 'release'] as const;
export type RelationshipBoundaryStance = typeof RELATIONSHIP_BOUNDARY_STANCES[number];

export interface RelationshipProgressionPolicy {
    readonly maxMajorMilestoneAdvancePerChapter: number;
    readonly maxConsecutiveProgressionChapters: number;
    readonly requireCanonicalBasis: true;
    readonly requireMutualAgencyForMutualMilestone: true;
}

export interface RelationshipDynamicProfile {
    readonly coreDynamicTags: readonly RelationshipDynamicTag[];
    readonly dominantConflictSources: readonly string[];
    readonly trustBasis: readonly string[];
    readonly respectBasis: readonly string[];
    readonly prohibitedShortcuts: readonly RelationshipActionType[];
}

/** Control-plane declaration only. Canonical current truth remains in StoryState relationships. */
export interface RelationshipDefinition {
    readonly id: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly categories: readonly RelationshipCategory[];
    readonly initialRomanceMilestone: RomanceMilestone;
    readonly dynamicProfile: RelationshipDynamicProfile;
    readonly progressionPolicy: RelationshipProgressionPolicy;
}

export interface RelationshipCurrentAssessment {
    readonly trust: RelationshipAssessmentLevel;
    readonly respect: RelationshipAssessmentLevel;
    readonly attraction: RelationshipAssessmentLevel;
    readonly emotionalOpenness: RelationshipAssessmentLevel;
    readonly dependency: RelationshipAssessmentLevel;
    readonly conflict: RelationshipAssessmentLevel;
    readonly sharedInterest: RelationshipAssessmentLevel;
    readonly powerBalance: PowerBalanceState;
}

export type RelationshipEvidenceRef =
    | { readonly type: 'fact'; readonly id: StoryId }
    | { readonly type: 'knowledge'; readonly characterId: StoryId; readonly factId: StoryId }
    | { readonly type: 'belief'; readonly characterId: StoryId; readonly epistemicId: StoryId }
    | { readonly type: 'relationship'; readonly id: StoryId }
    | { readonly type: 'relationship-history'; readonly id: StoryId }
    | { readonly type: 'strategic-action'; readonly id: StoryId }
    | { readonly type: 'character-status'; readonly characterId: StoryId; readonly value: string };

export interface RelationshipParticipantAgency {
    readonly characterId: StoryId;
    readonly currentGoal: string;
    readonly desiredOutcome: string;
    readonly boundary: string;
    readonly choice: string;
    readonly willingness: 'yes' | 'no' | 'uncertain';
    readonly uncertainty: string;
    readonly costOrRisk: string;
    readonly knowledgeBasisFactIds: readonly StoryId[];
}

export interface RelationshipBoundary {
    readonly characterId: StoryId;
    readonly type: RelationshipBoundaryType;
    readonly constraint: RelationshipBoundaryConstraint;
    readonly stance: RelationshipBoundaryStance;
    readonly instruction: string;
}

export interface RelationshipProgressionIntent {
    readonly direction: RelationshipDirection;
    readonly romanticMilestone: RomanceMilestone;
    /** Required on final changing actions; milestone changes use the exact new milestone literal. */
    readonly expectedState?: string;
    readonly mutual: boolean;
    /** Earlier same-chapter step; only a later causal action may declare the final delta. */
    readonly intermediate: boolean;
}

export interface RelationshipWriterVisibleContract {
    readonly currentDynamic: string;
    readonly objective: string;
    readonly visibleConflict: string;
    readonly visibleUncertainty: string;
}

/** Planner-owned and runtime-untrusted. It never mutates the canonical relationship ledger. */
export interface RelationshipActionPlan {
    readonly id: StoryId;
    readonly sceneIds: readonly StoryId[];
    readonly relationshipId: StoryId;
    readonly relationshipEventId?: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly category: RelationshipCategory;
    readonly actionType: RelationshipActionType;
    /** Required only for jealousy; identifies whose reaction and trigger are being planned. */
    readonly jealousCharacterId?: StoryId;
    readonly importance: 'minor' | 'major';
    readonly currentStateAssessment: RelationshipCurrentAssessment;
    readonly currentRomanceMilestone: RomanceMilestone;
    readonly intendedProgression: RelationshipProgressionIntent;
    readonly participantAgency: readonly RelationshipParticipantAgency[];
    readonly boundaries: readonly RelationshipBoundary[];
    readonly evidenceRefs: readonly RelationshipEvidenceRef[];
    readonly counterpressure: string;
    readonly uncertainty: string;
    readonly expectedCostOrTradeoff: string;
    readonly powerImbalanceAddressed: boolean;
    readonly writerVisibleContract: RelationshipWriterVisibleContract;
    readonly dependsOnActionId?: StoryId;
}

export interface PlannerRelationshipDescriptor {
    readonly id: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly categories: readonly RelationshipCategory[];
    readonly currentState?: string;
    readonly currentRomanceMilestone: RomanceMilestone;
    readonly dynamicProfile: RelationshipDynamicProfile;
    readonly progressionPolicy: RelationshipProgressionPolicy;
    /** False only when the requested zero-history projection cannot prove the slow-burn window. */
    readonly slowBurnHistoryComplete: boolean;
    readonly consecutiveProgressionCount: number;
    readonly recentHistory: readonly {
        readonly id: StoryId;
        readonly state: string;
        readonly chapterNumber: number;
    }[];
}

export interface PlannerRelationshipContext {
    readonly relationships: readonly PlannerRelationshipDescriptor[];
    readonly allowedRelationshipEvents: readonly {
        readonly id: StoryId;
        readonly relationshipId: StoryId;
        readonly eventType: string;
        readonly authorizedRomanceMilestone?: RomanceMilestone;
    }[];
    readonly participantBeliefs: readonly {
        readonly id: StoryId;
        readonly characterId: StoryId;
        readonly claim: string;
    }[];
    readonly maxRelationships: number;
    readonly maxRecentHistoryPerRelationship: number;
    readonly maxParticipantBeliefs: number;
}

export interface WriterRelationshipDirective {
    readonly id: StoryId;
    readonly relationshipId: StoryId;
    readonly relationshipEventId?: StoryId;
    readonly sceneIds: readonly StoryId[];
    readonly participantIds: readonly StoryId[];
    readonly category: RelationshipCategory;
    readonly actionType: RelationshipActionType;
    readonly jealousCharacterId?: StoryId;
    readonly importance: 'minor' | 'major';
    readonly currentRomanceMilestone: RomanceMilestone;
    readonly intendedProgression: RelationshipProgressionIntent;
    readonly participantChoices: readonly {
        readonly characterId: StoryId;
        readonly choice: string;
        readonly willingness: 'yes' | 'no' | 'uncertain';
    }[];
    readonly visibleBoundaries: readonly RelationshipBoundary[];
    readonly visibleCurrentDynamic: string;
    readonly visibleObjective: string;
    readonly visibleConflict: string;
    readonly expectedCostOrTradeoff: string;
    readonly visibleUncertainty: string;
    readonly visiblePowerBalance: PowerBalanceState;
    readonly powerImbalanceAddressed: boolean;
    readonly dependsOnActionId?: StoryId;
}

export interface ValidatorRelationshipActionDescriptor extends WriterRelationshipDirective {
    readonly evidenceRefs: readonly RelationshipEvidenceRef[];
    readonly participantKnowledgeRefs: readonly { readonly characterId: StoryId; readonly factId: StoryId }[];
    readonly privilegedConstraints: readonly string[];
}

export interface ValidatorRelationshipView {
    readonly kind: 'validator-relationship-view';
    readonly chapterNumber: number;
    readonly actions: readonly ValidatorRelationshipActionDescriptor[];
    readonly canonicalRelationships: readonly {
        readonly id: StoryId;
        readonly participantIds: readonly StoryId[];
        readonly currentState?: string;
        readonly currentRomanceMilestone: RomanceMilestone;
    }[];
    readonly deterministicIssues: readonly Pick<PlanValidationIssue, 'code' | 'path' | 'severity'>[];
}

export const RELATIONSHIP_ISSUE_CODES = [
    'INVALID_RELATIONSHIP_ACTION',
    'RELATIONSHIP_REFERENCE_INVALID',
    'RELATIONSHIP_GATE_VIOLATION',
    'RELATIONSHIP_PROGRESSION_VIOLATION',
    'RELATIONSHIP_AGENCY_VIOLATION',
    'RELATIONSHIP_KNOWLEDGE_VIOLATION',
    'RELATIONSHIP_BOUNDARY_VIOLATION',
    'RELATIONSHIP_MUTUALITY_VIOLATION',
    'RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION',
    'RELATIONSHIP_REPETITION_VIOLATION',
] as const;
export type RelationshipIssueCode = typeof RELATIONSHIP_ISSUE_CODES[number];

export interface RelationshipValidationResult {
    readonly status: 'feasible' | 'infeasible' | 'under-specified';
    readonly issues: readonly PlanValidationIssue[];
}
