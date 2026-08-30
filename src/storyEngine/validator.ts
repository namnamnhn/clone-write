import { parseWriterChapterDraft } from './writerDraft';
import { WriterDraftValidationError, WriterChapterDraft } from './writerTypes';
import { FullStoryControl, StoryState } from './types';
import { WriterChapterPlan } from './plannerTypes';
import { buildValidatorContext, ValidatorContext, ValidatorContextCapacityError, ValidatorContextSelectionPolicy } from './validatorContext';
import { buildSemanticValidatorPrompt, parseSemanticValidationResult, SemanticValidatorModel } from './semanticValidator';
import { buildValidationReport, createValidationIssue, RepairCandidateSnapshot, ValidationIssue, ValidationIssueCode, ValidationReport } from './validationTypes';

const controlMarkup = /<\/?(?:CHAPTER|STORY_SUMMARY|NEW_CHARACTER|WRITER_CONTEXT|WRITER_CHAPTER_PLAN|PLANNER_CONTEXT|FULL_STORY_CONTROL|STORY_STATE)\b[^>]*>/i;
const metadataAssignment = /\b(?:STORY_SUMMARY|NEW_CHARACTER)\b\s*[:=]/i;
const internalName = /\b(?:FullStoryControl|StoryControl|StoryState|WriterContext|WriterChapterPlan|PlannerContext)\b/;

/** Projects runtime candidate data through an explicit primitive-field allow-list. */
const buildRepairCandidateSnapshot = (value: unknown, targetChapter: number): RepairCandidateSnapshot | undefined => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.prose !== 'string' || !record.prose.trim()) return undefined;
    const title = typeof record.title === 'string' && record.title.trim() && !/[<>]/.test(record.title)
        ? record.title.trim() : undefined;
    return {
        kind: 'repair-candidate-snapshot', chapterNumber: targetChapter,
        ...(title === undefined ? {} : { title }), prose: record.prose.trim(),
    };
};

const planTargetChapter = (plan: unknown): number | undefined => {
    if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) return undefined;
    const value = (plan as Record<string, unknown>).chapterNumber;
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
};

const parserCode = (code: string): ValidationIssueCode => {
    if (code === 'CHAPTER_MISMATCH') return 'WRONG_CHAPTER';
    if (code === 'MULTI_CHAPTER_PAYLOAD') return 'MULTI_CHAPTER_OUTPUT';
    if (code === 'CONTROL_PROTOCOL_LEAKAGE') return 'CONTROL_PROTOCOL_LEAK';
    return 'INVALID_DRAFT_PROTOCOL';
};

const deterministicIssues = (draft: WriterChapterDraft, context: ValidatorContext): readonly ValidationIssue[] => {
    const issues: ValidationIssue[] = [];
    if (controlMarkup.test(draft.prose)) issues.push(createValidationIssue('CONTROL_PROTOCOL_LEAK', 'critical', 'deterministic'));
    if (metadataAssignment.test(draft.prose)) issues.push(createValidationIssue('METADATA_LEAK', 'critical', 'deterministic'));
    if (internalName.test(draft.prose)) issues.push(createValidationIssue('INTERNAL_ID_LEAK', 'error', 'deterministic'));
    const normalizedProse = draft.prose.normalize('NFKC').toLowerCase();
    if (context.secretValidation.some(secret => !secret.revealAllowed && normalizedProse.includes(secret.rawValue.normalize('NFKC').toLowerCase()))) {
        issues.push(createValidationIssue('AUTHOR_SECRET_LEAK', 'critical', 'deterministic'));
    }
    return issues;
};

export interface ValidateWriterChapterRequest {
    readonly control: FullStoryControl;
    readonly state: StoryState;
    readonly plan: WriterChapterPlan;
    readonly draft: unknown;
    readonly semanticModel: SemanticValidatorModel;
    readonly validationPass?: number;
    readonly validatorContextSelectionPolicy?: ValidatorContextSelectionPolicy;
}

export interface ParsedWriterChapterValidationResult {
    readonly candidateStatus: 'parsed';
    readonly draft: WriterChapterDraft;
    readonly report: ValidationReport;
    readonly context?: ValidatorContext;
    readonly repairCandidate?: RepairCandidateSnapshot;
}

export interface UnparsedWriterChapterValidationResult {
    readonly candidateStatus: 'unparsed';
    readonly candidate?: RepairCandidateSnapshot;
    readonly report: ValidationReport;
    readonly context?: ValidatorContext;
}

export type WriterChapterValidationResult = ParsedWriterChapterValidationResult | UnparsedWriterChapterValidationResult;

/** Production-grade validation: a semantic model is mandatory and every boundary fails closed. */
export const validateWriterChapter = async (request: ValidateWriterChapterRequest): Promise<WriterChapterValidationResult> => {
    const validationPass = request.validationPass ?? 1;
    let context: ValidatorContext;
    try {
        context = buildValidatorContext(request.control, request.state, request.plan, request.validatorContextSelectionPolicy);
    } catch (error) {
        const code = error instanceof ValidatorContextCapacityError ? 'VALIDATOR_CONTEXT_CAPACITY_EXCEEDED' : 'INVALID_SOURCE_PLAN';
        const targetChapter = planTargetChapter(request.plan);
        const candidate = targetChapter === undefined ? undefined : buildRepairCandidateSnapshot(request.draft, targetChapter);
        return {
            candidateStatus: 'unparsed', ...(candidate === undefined ? {} : { candidate }),
            report: buildValidationReport(targetChapter ?? 0, validationPass, [createValidationIssue(code, 'critical', 'infrastructure')]),
        };
    }
    let draft: WriterChapterDraft;
    try {
        draft = parseWriterChapterDraft(request.draft, context.targetChapter);
    } catch (error) {
        const issues = error instanceof WriterDraftValidationError
            ? error.issues.map(entry => createValidationIssue(parserCode(entry.code), 'critical', 'deterministic'))
            : [createValidationIssue('INVALID_DRAFT_PROTOCOL', 'critical', 'deterministic')];
        const repairCandidate = buildRepairCandidateSnapshot(request.draft, context.targetChapter);
        return {
            candidateStatus: 'unparsed', context, ...(repairCandidate === undefined ? {} : { candidate: repairCandidate }),
            report: buildValidationReport(context.targetChapter, validationPass, issues),
        };
    }
    const issues = [...deterministicIssues(draft, context)];
    try {
        const output = await request.semanticModel.validate({
            kind: 'semantic-validator-model-request', chapterNumber: context.targetChapter, context, candidate: draft,
            prompt: buildSemanticValidatorPrompt(context),
        });
        issues.push(...parseSemanticValidationResult(output, context));
    } catch {
        issues.push(createValidationIssue('VALIDATOR_PROTOCOL_FAILURE', 'critical', 'infrastructure'));
    }
    return {
        candidateStatus: 'parsed', draft, context, repairCandidate: buildRepairCandidateSnapshot(draft, context.targetChapter),
        report: buildValidationReport(context.targetChapter, validationPass, issues),
    };
};
