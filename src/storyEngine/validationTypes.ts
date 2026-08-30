import { ChapterNumber } from './types';
import { WriterChapterDraft } from './writerTypes';

export const VALIDATION_ISSUE_CODES = [
    'CONTROL_PROTOCOL_LEAK', 'METADATA_LEAK', 'WRONG_CHAPTER', 'MULTI_CHAPTER_OUTPUT',
    'INVALID_DRAFT_PROTOCOL', 'INVALID_SOURCE_PLAN', 'PLAN_DRIFT', 'POV_VIOLATION',
    'CHARACTER_GATE_VIOLATION', 'PREMATURE_REVEAL', 'AUTHOR_SECRET_LEAK', 'FUTURE_PLOT_LEAK',
    'CANON_CONTRADICTION', 'CONTINUITY_CONTRADICTION', 'REQUIRED_EVENT_MISSING',
    'FORBIDDEN_EVENT_OCCURRED', 'OPPONENT_IRRATIONALITY', 'CONSEQUENCE_MISSING', 'FILLER_SCENE',
    'INTERNAL_ID_LEAK', 'VALIDATOR_PROTOCOL_FAILURE', 'REPAIR_PROTOCOL_FAILURE',
] as const;

export type ValidationIssueCode = typeof VALIDATION_ISSUE_CODES[number];
export type ValidationSeverity = 'critical' | 'error' | 'warning';
export type ValidationScope = 'chapter' | 'scene';
export type ValidationIssueSource = 'deterministic' | 'semantic-validator' | 'infrastructure';
export type ValidationCategory = 'protocol' | 'gate' | 'secret' | 'plan-adherence' | 'canon' | 'continuity' | 'pov' | 'character' | 'conflict' | 'consequence' | 'filler' | 'prose';

export interface ValidationIssue {
    readonly code: ValidationIssueCode;
    readonly category: ValidationCategory;
    readonly severity: ValidationSeverity;
    readonly blocking: boolean;
    readonly repairable: boolean;
    readonly scope: ValidationScope;
    readonly sceneId?: string;
    readonly source: ValidationIssueSource;
}

export interface ValidationReport {
    readonly kind: 'validation-report';
    readonly chapterNumber: ChapterNumber;
    readonly status: 'passed' | 'blocked';
    readonly validationPass: number;
    readonly issues: readonly ValidationIssue[];
    readonly blockingIssueCount: number;
    readonly warningCount: number;
}

export interface ValidationApprovedCandidate {
    readonly status: 'approved-not-canon';
    readonly draft: WriterChapterDraft;
    readonly report: ValidationReport;
    readonly repairAttempts: number;
}

export interface RejectedValidationCandidate {
    readonly status: 'rejected';
    readonly draft: WriterChapterDraft;
    readonly report: ValidationReport;
    readonly repairAttempts: number;
}

export type ValidationPipelineResult = ValidationApprovedCandidate | RejectedValidationCandidate;

const categoryByCode: Readonly<Record<ValidationIssueCode, ValidationCategory>> = {
    CONTROL_PROTOCOL_LEAK: 'protocol', METADATA_LEAK: 'protocol', WRONG_CHAPTER: 'protocol', MULTI_CHAPTER_OUTPUT: 'protocol',
    INVALID_DRAFT_PROTOCOL: 'protocol', INVALID_SOURCE_PLAN: 'protocol', VALIDATOR_PROTOCOL_FAILURE: 'protocol', REPAIR_PROTOCOL_FAILURE: 'protocol',
    PLAN_DRIFT: 'plan-adherence', POV_VIOLATION: 'pov', CHARACTER_GATE_VIOLATION: 'character', PREMATURE_REVEAL: 'gate',
    AUTHOR_SECRET_LEAK: 'secret', FUTURE_PLOT_LEAK: 'gate', CANON_CONTRADICTION: 'canon', CONTINUITY_CONTRADICTION: 'continuity',
    REQUIRED_EVENT_MISSING: 'plan-adherence', FORBIDDEN_EVENT_OCCURRED: 'gate', OPPONENT_IRRATIONALITY: 'conflict',
    CONSEQUENCE_MISSING: 'consequence', FILLER_SCENE: 'filler', INTERNAL_ID_LEAK: 'prose',
};

const nonRepairable = new Set<ValidationIssueCode>(['INVALID_SOURCE_PLAN', 'VALIDATOR_PROTOCOL_FAILURE', 'REPAIR_PROTOCOL_FAILURE']);

export const createValidationIssue = (
    code: ValidationIssueCode,
    severity: ValidationSeverity,
    source: ValidationIssueSource,
    scope: ValidationScope = 'chapter',
    sceneId?: string,
): ValidationIssue => ({
    code, category: categoryByCode[code], severity, blocking: severity !== 'warning',
    repairable: !nonRepairable.has(code), scope, ...(sceneId === undefined ? {} : { sceneId }), source,
});

const severityOrder: Readonly<Record<ValidationSeverity, number>> = { critical: 0, error: 1, warning: 2 };

export const buildValidationReport = (chapterNumber: number, validationPass: number, input: readonly ValidationIssue[]): ValidationReport => {
    const unique = new Map<string, ValidationIssue>();
    input.forEach(issue => unique.set(`${issue.code}\u0000${issue.severity}\u0000${issue.source}\u0000${issue.scope}\u0000${issue.sceneId ?? ''}`, issue));
    const issues = [...unique.values()].sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
        || left.category.localeCompare(right.category) || left.code.localeCompare(right.code)
        || (left.sceneId ?? '').localeCompare(right.sceneId ?? '') || left.scope.localeCompare(right.scope));
    const blockingIssueCount = issues.filter(issue => issue.blocking).length;
    return {
        kind: 'validation-report', chapterNumber, status: blockingIssueCount === 0 ? 'passed' : 'blocked', validationPass,
        issues, blockingIssueCount, warningCount: issues.filter(issue => issue.severity === 'warning').length,
    };
};
