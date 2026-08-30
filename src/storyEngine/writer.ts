import { buildWriterContext } from './writerContext';
import { parseWriterChapterDraft } from './writerDraft';
import { buildWriterPrompt } from './writerPrompt';
import { GenerateWriterDraftRequest, WriterChapterDraft, WriterModelRequest } from './writerTypes';

/**
 * Produces one parsed, unvalidated candidate draft. This orchestration seam never mutates
 * controls, state, plans, or memory, and deliberately does not make canon or update state.
 */
export const generateWriterDraft = async (request: GenerateWriterDraftRequest): Promise<WriterChapterDraft> => {
    const context = buildWriterContext(request.control, request.state, request.plan, request.memoryInput, request.memoryPolicy, request.contextSelectionPolicy);
    const modelRequest: WriterModelRequest = { kind: 'writer-model-request', context, prompt: buildWriterPrompt(context) };
    const output = await request.model.write(modelRequest);
    return parseWriterChapterDraft(output, context.targetChapter);
};
