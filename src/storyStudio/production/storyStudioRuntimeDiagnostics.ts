import {
    MAX_SAFE_PLAN_VALIDATION_ISSUES,
    ProductionRuntimeError,
    SAFE_PLAN_VALIDATION_ISSUE_CODES,
    sanitizeStateExtractionIssueCodes,
    sanitizeSafeModelAttemptOutcomes,
} from '../../storyEngine';
import type {
    ProductionRuntimeErrorCode,
    ProductionRuntimeStage,
    SafePlanValidationIssueCode,
    SafePlanValidationIssuePath,
    SafeStateExtractionIssueCode,
    StoryEngineModelRole,
    SafeModelAttemptOutcome,
} from '../../storyEngine';

const SAFE_CODES = new Set<string>(SAFE_PLAN_VALIDATION_ISSUE_CODES);
const SAFE_PATHS = new Set<SafePlanValidationIssuePath>([
    'chapterNumber', 'arcId', 'beatId', 'povCharacterId', 'participantIds', 'scenes',
    'scenes.intelligentConflict', 'activeConstraintIds', 'allowedRevealIds', 'plannedRevealIds',
    'relationshipEventIds', 'storyEventIds', 'cluesPlantedIds', 'cluesPaidOffIds',
    'expectedResourceDeltas', 'expectedRelationshipDeltas', 'expectedContinuityConsequences',
    'strategicActions', 'relationshipActions', 'endStateIntent', 'other',
]);

export interface SafeStoryStudioRuntimeDiagnostic {
    readonly code: ProductionRuntimeErrorCode;
    readonly stage: ProductionRuntimeStage;
    readonly role?: StoryEngineModelRole;
    readonly issueCount?: number;
    readonly issueCodes?: readonly (SafePlanValidationIssueCode | SafeStateExtractionIssueCode)[];
    readonly issuePaths?: readonly SafePlanValidationIssuePath[];
    readonly modelAttempts?: readonly SafeModelAttemptOutcome[];
}

export const getSafeStoryStudioRuntimeDiagnostic = (
    error: unknown,
): SafeStoryStudioRuntimeDiagnostic | undefined => {
    if (!(error instanceof ProductionRuntimeError)) return undefined;
    const base = {
        code: error.code,
        stage: error.stage,
        ...(error.role === undefined ? {} : { role: error.role }),
    };
    if (error.code === 'MODEL_RUNTIME_FAILURE') {
        const modelAttempts = sanitizeSafeModelAttemptOutcomes(error.modelAttempts);
        return {
            ...base,
            ...(modelAttempts.length === 0 ? {} : { modelAttempts }),
        };
    }
    if (error.code === 'EXTRACTION_BLOCKED' || error.code === 'CANON_REVIEW_BLOCKED') {
        const issueCodes = sanitizeStateExtractionIssueCodes(error.issueCodes ?? []);
        const issueCount = typeof error.issueCount === 'number'
            && Number.isSafeInteger(error.issueCount) && error.issueCount >= 0
            ? error.issueCount : undefined;
        return {
            ...base,
            ...(issueCount === undefined ? {} : { issueCount }),
            ...(issueCodes.length === 0 ? {} : { issueCodes }),
        };
    }
    if (error.code !== 'PLAN_VALIDATION_FAILURE') return base;
    const issueCodes = (error.issueCodes ?? []).slice(0, MAX_SAFE_PLAN_VALIDATION_ISSUES)
        .map(code => SAFE_CODES.has(code) ? code as SafePlanValidationIssueCode : 'OTHER_PLAN_VALIDATION_ISSUE');
    const issuePaths = (error.issuePaths ?? []).slice(0, MAX_SAFE_PLAN_VALIDATION_ISSUES)
        .map(path => SAFE_PATHS.has(path) ? path : 'other');
    const issueCount = typeof error.issueCount === 'number' && Number.isSafeInteger(error.issueCount) && error.issueCount >= 0
        ? error.issueCount : undefined;
    return {
        ...base,
        ...(issueCount === undefined ? {} : { issueCount }),
        ...(issueCodes.length === 0 ? {} : { issueCodes }),
        ...(issuePaths.length === 0 ? {} : { issuePaths }),
    };
};

export const logSafeStoryStudioRuntimeDiagnostic = (error: unknown): void => {
    const diagnostic = getSafeStoryStudioRuntimeDiagnostic(error);
    if (diagnostic) console.error('Story Studio runtime diagnostic', diagnostic);
};
