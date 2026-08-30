import { parseWriterChapterDraft } from './writerDraft';
import { WriterDraftValidationError, WriterChapterDraft } from './writerTypes';
import { FullStoryControl, StoryState } from './types';
import { WriterChapterPlan } from './plannerTypes';
import { buildValidatorContext, ValidatorContext } from './validatorContext';
import { buildSemanticValidatorPrompt, parseSemanticValidationResult, SemanticValidatorModel } from './semanticValidator';
import { buildValidationReport, createValidationIssue, ValidationIssue, ValidationIssueCode, ValidationReport } from './validationTypes';

const controlMarkup = /<\/?(?:CHAPTER|STORY_SUMMARY|NEW_CHARACTER|WRITER_CONTEXT|WRITER_CHAPTER_PLAN|PLANNER_CONTEXT|FULL_STORY_CONTROL|STORY_STATE)\b[^>]*>/i;
const metadataAssignment = /\b(?:STORY_SUMMARY|NEW_CHARACTER)\b\s*[:=]/i;
const internalName = /\b(?:FullStoryControl|StoryControl|StoryState|WriterContext|WriterChapterPlan|PlannerContext)\b/;

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
    const lowerProse = draft.prose.toLocaleLowerCase();
    if (context.secretValidation.some(secret => !secret.revealAllowed && lowerProse.includes(secret.rawValue.toLocaleLowerCase()))) {
        issues.push(createValidationIssue('AUTHOR_SECRET_LEAK', 'critical', 'deterministic'));
    }
    return issues;
};

export interface ValidateWriterChapterRequest {
    readonly control: FullStoryControl;
    readonly state: StoryState;
    readonly plan: WriterChapterPlan;
    readonly draft: WriterChapterDraft;
    readonly semanticModel: SemanticValidatorModel;
    readonly validationPass?: number;
}

export interface WriterChapterValidationResult {
    readonly draft: WriterChapterDraft;
    readonly report: ValidationReport;
    readonly context?: ValidatorContext;
}

/** Production-grade validation: a semantic model is mandatory and every boundary fails closed. */
export const validateWriterChapter = async (request: ValidateWriterChapterRequest): Promise<WriterChapterValidationResult> => {
    const validationPass = request.validationPass ?? 1;
    let context: ValidatorContext;
    try {
        context = buildValidatorContext(request.control, request.state, request.plan);
    } catch {
        return { draft: request.draft, report: buildValidationReport(request.plan.chapterNumber, validationPass, [createValidationIssue('INVALID_SOURCE_PLAN', 'critical', 'infrastructure')]) };
    }
    let draft: WriterChapterDraft;
    try {
        draft = parseWriterChapterDraft(request.draft, context.targetChapter);
    } catch (error) {
        const issues = error instanceof WriterDraftValidationError
            ? error.issues.map(entry => createValidationIssue(parserCode(entry.code), 'critical', 'deterministic'))
            : [createValidationIssue('INVALID_DRAFT_PROTOCOL', 'critical', 'deterministic')];
        return { draft: request.draft, context, report: buildValidationReport(context.targetChapter, validationPass, issues) };
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
    return { draft, context, report: buildValidationReport(context.targetChapter, validationPass, issues) };
};
