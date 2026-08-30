import { WriterChapterDraft, WriterDraftValidationError, WriterDraftValidationIssue } from './writerTypes';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const issue = (issues: WriterDraftValidationIssue[], code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
const forbiddenControlMarkup = /<\/?(?:CHAPTER|STORY_SUMMARY|NEW_CHARACTER|WRITER_CONTEXT|WRITER_CHAPTER_PLAN|FULL_STORY_CONTROL|STORY_STATE)\b[^>]*>/i;
const forbiddenMetadata = /\b(?:STORY_SUMMARY|NEW_CHARACTER)\b\s*[:=]/i;

/** Parses unknown model output into a fresh, explicitly allow-listed unvalidated draft. */
export const parseWriterChapterDraft = (value: unknown, expectedChapterNumber: number): WriterChapterDraft => {
    const issues: WriterDraftValidationIssue[] = [];
    if (!isRecord(value)) {
        issue(issues, 'INVALID_SHAPE', '$', 'writer output must be an object');
    } else {
        if (value.kind !== 'writer-chapter-draft') issue(issues, 'INVALID_KIND', 'kind', 'must be writer-chapter-draft');
        if (!Number.isSafeInteger(value.chapterNumber) || value.chapterNumber !== expectedChapterNumber) issue(issues, 'CHAPTER_MISMATCH', 'chapterNumber', `must equal ${expectedChapterNumber}`);
        if (Array.isArray(value.chapters) || Array.isArray(value.drafts) || Array.isArray(value.chapterDrafts)) issue(issues, 'MULTI_CHAPTER_PAYLOAD', '$', 'writer output must represent exactly one chapter');
        if (typeof value.prose !== 'string' || !value.prose.trim()) issue(issues, 'INVALID_PROSE', 'prose', 'must be a non-empty string');
        if (value.title !== undefined && (typeof value.title !== 'string' || !value.title.trim() || /[<>]/.test(value.title))) issue(issues, 'INVALID_TITLE', 'title', 'must be a non-empty plain-text string when supplied');
        if (typeof value.prose === 'string' && (forbiddenControlMarkup.test(value.prose) || forbiddenMetadata.test(value.prose))) {
            issue(issues, 'CONTROL_PROTOCOL_LEAKAGE', 'prose', 'must not contain prohibited engine control metadata');
        }
    }
    if (issues.length > 0 || !isRecord(value) || typeof value.prose !== 'string' || !value.prose.trim() || !Number.isSafeInteger(value.chapterNumber) || value.chapterNumber !== expectedChapterNumber) {
        throw new WriterDraftValidationError(issues);
    }
    return {
        kind: 'writer-chapter-draft', validationStatus: 'unvalidated', chapterNumber: value.chapterNumber,
        ...(typeof value.title === 'string' && value.title.trim() ? { title: value.title.trim() } : {}), prose: value.prose.trim(),
    };
};
