import type { PlanValidationIssue } from './plannerTypes';

export const SAFE_PLAN_VALIDATION_ISSUE_CODES = [
    'ACTIVE_CONSTRAINT_UNPROJECTABLE', 'ARC_MISMATCH', 'BEAT_MISMATCH', 'CHAPTER_MISMATCH',
    'CHAPTER_OUT_OF_RANGE', 'CHARACTER_LOCKED', 'COMMERCE_COUNTERMOVE_MISSING',
    'COMMERCE_COUNTERPARTY_VIOLATION', 'COMMERCE_FINANCING_VIOLATION', 'COMMERCE_FLOW_VIOLATION',
    'COMMERCE_RESOURCE_VIOLATION', 'DUPLICATE_ACTIVE_CONSTRAINT', 'DUPLICATE_RELATIONSHIP_EVENT',
    'FUTURE_ARC', 'FUTURE_BEAT', 'INTELLIGENT_CONFLICT_INCOMPLETE', 'INTELLIGENT_CONFLICT_REQUIRED',
    'INVALID_CHAPTER', 'INVALID_CONFLICT_IMPORTANCE', 'INVALID_CONTINUITY_CONSEQUENCE',
    'INVALID_INTELLIGENT_CONFLICT', 'INVALID_KIND', 'INVALID_PURPOSE_TAGS', 'INVALID_RELATIONSHIP_ACTION',
    'INVALID_RELATIONSHIP_DELTA', 'INVALID_RESOURCE_DELTA', 'INVALID_SCENE', 'INVALID_SCENE_ORDER',
    'INVALID_SHAPE', 'INVALID_STRATEGIC_ACTION', 'MILITARY_COST_MISSING',
    'MILITARY_INTELLIGENCE_VIOLATION', 'MILITARY_LOCATION_VIOLATION', 'MILITARY_LOGISTICS_VIOLATION',
    'MILITARY_RESOURCE_VIOLATION', 'MISSING_ACTIVE_CONSTRAINT', 'OPPONENT_KNOWLEDGE_VIOLATION',
    'POLITICAL_AUTHORITY_VIOLATION', 'POLITICAL_COUNTERMOVE_MISSING', 'POLITICAL_DIMENSION_VIOLATION',
    'POLITICAL_INFORMATION_VIOLATION', 'POLITICAL_LAW_VIOLATION', 'POLITICAL_RESOURCE_VIOLATION',
    'POLITICAL_TIMING_VIOLATION', 'POV_LOCKED', 'POV_NOT_PARTICIPANT',
    'RELATIONSHIP_AGENCY_VIOLATION', 'RELATIONSHIP_BOUNDARY_VIOLATION',
    'RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION', 'RELATIONSHIP_EVENT_LOCKED',
    'RELATIONSHIP_GATE_VIOLATION', 'RELATIONSHIP_KNOWLEDGE_VIOLATION',
    'RELATIONSHIP_MUTUALITY_VIOLATION', 'RELATIONSHIP_PARTICIPANTS_INVALID',
    'RELATIONSHIP_PROGRESSION_VIOLATION', 'RELATIONSHIP_REFERENCE_INVALID',
    'RELATIONSHIP_REPETITION_VIOLATION', 'REVEAL_LOCKED', 'SCENE_ORDER_INVALID',
    'SCENE_PURPOSE_INVALID', 'SCENE_PURPOSE_MISSING', 'STORY_EVENT_LOCKED',
    'STRATEGIC_INTELLIGENT_CONFLICT_VIOLATION', 'STRATEGIC_REFERENCE_INVALID',
    'STRATEGIC_RELATIONSHIP_RECONCILIATION_VIOLATION', 'STRATEGIC_RESOURCE_CAPACITY_VIOLATION',
    'STRATEGIC_RESOURCE_RECONCILIATION_VIOLATION', 'STRATEGIC_SCENE_COVERAGE_VIOLATION',
    'UNKNOWN_CONSTRAINT', 'OTHER_PLAN_VALIDATION_ISSUE',
] as const;

export type SafePlanValidationIssueCode = typeof SAFE_PLAN_VALIDATION_ISSUE_CODES[number];

export type SafePlanValidationIssuePath =
    | 'chapterNumber' | 'arcId' | 'beatId' | 'povCharacterId' | 'participantIds'
    | 'scenes' | 'scenes.intelligentConflict' | 'activeConstraintIds' | 'allowedRevealIds'
    | 'plannedRevealIds' | 'relationshipEventIds' | 'storyEventIds' | 'cluesPlantedIds'
    | 'cluesPaidOffIds' | 'expectedResourceDeltas' | 'expectedRelationshipDeltas'
    | 'expectedContinuityConsequences' | 'strategicActions' | 'relationshipActions'
    | 'endStateIntent' | 'other';

export const MAX_SAFE_PLAN_VALIDATION_ISSUES = 12;

const SAFE_CODES = new Set<string>(SAFE_PLAN_VALIDATION_ISSUE_CODES);
const SAFE_ROOT_PATHS = new Set<SafePlanValidationIssuePath>([
    'chapterNumber', 'arcId', 'beatId', 'povCharacterId', 'participantIds', 'scenes',
    'activeConstraintIds', 'allowedRevealIds', 'plannedRevealIds', 'relationshipEventIds',
    'storyEventIds', 'cluesPlantedIds', 'cluesPaidOffIds', 'expectedResourceDeltas',
    'expectedRelationshipDeltas', 'expectedContinuityConsequences', 'strategicActions',
    'relationshipActions', 'endStateIntent',
]);

const safeIssueCode = (code: string): SafePlanValidationIssueCode =>
    SAFE_CODES.has(code) ? code as SafePlanValidationIssueCode : 'OTHER_PLAN_VALIDATION_ISSUE';

const safeIssuePath = (path: string): SafePlanValidationIssuePath => {
    const normalized = path.startsWith('$.') ? path.slice(2) : path;
    const segments = normalized.split('.');
    const root = segments[0] as SafePlanValidationIssuePath;
    if (root === 'scenes' && segments.includes('intelligentConflict')) return 'scenes.intelligentConflict';
    return SAFE_ROOT_PATHS.has(root) ? root : 'other';
};

export interface SafePlanValidationIssueSummary {
    readonly issueCount: number;
    readonly issueCodes: readonly SafePlanValidationIssueCode[];
    readonly issuePaths: readonly SafePlanValidationIssuePath[];
}

export const summarizePlanValidationIssues = (
    issues: readonly Pick<PlanValidationIssue, 'code' | 'path'>[],
): SafePlanValidationIssueSummary => {
    const visible = issues.slice(0, MAX_SAFE_PLAN_VALIDATION_ISSUES);
    return {
        issueCount: issues.length,
        issueCodes: visible.map(issue => safeIssueCode(issue.code)),
        issuePaths: visible.map(issue => safeIssuePath(issue.path)),
    };
};
