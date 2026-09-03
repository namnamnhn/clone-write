import {
    buildNarrativeMemoryInput,
    buildPlannerContext,
    buildValidationReport,
    buildValidatorRelationshipView,
    buildValidatorStrategicView,
    canonicalContentIdentity,
    canonicalValuesEqual,
    compileStoryControl,
    createCanonicalizationSourceIdentity,
    createProductionCanonIdentity,
    createProductionDraftArtifactIdentity,
    createProductionExtractionArtifactIdentity,
    createProductionPlanArtifactIdentity,
    createProductionValidationArtifactIdentity,
    createStoryControlIdentity,
    createValidationIssue,
    createV4ProjectSeed,
    normalizeProductionStoryRuntimePolicy,
    parseInternalChapterPlan,
    parseNarrativeMemoryState,
    parseStoryBlueprintDocument,
    parseStoryState,
    parseStoryStateDelta,
    parseWriterChapterDraft,
    prepareCanonCommit,
    sanitizeWriterChapterPlan,
    VALIDATION_ISSUE_CODES,
} from '../../storyEngine';
import { isValidatedExtractionSource, validateApprovedExtractionSource } from '../../storyEngine/stateExtractor';
import type {
    CanonCommitProposal,
    NarrativeMemoryState,
    ProductionDraftArtifact,
    ProductionExtractionArtifact,
    ProductionPlanArtifact,
    ProductionStageCursor,
    ProductionValidationArtifact,
    StoryBlueprintDocument,
    ValidationIssue,
    ValidationPipelineResult,
} from '../../storyEngine';
import type {
    CanonicalChapterMetadata,
    StoryStudioProjectDocumentV1,
    StoryStudioRuntimeProject,
} from './storyStudioProjectTypes';
import { StoryStudioProjectError } from './storyStudioProjectTypes';
import {
    DEFAULT_STORY_STUDIO_BATCH_QUEUE,
    IDLE_STORY_STUDIO_WORKFLOW,
    isStoryStudioBatchSize,
} from './storyStudioWorkflowTypes';
import type {
    PersistedStoryStudioWorkflow,
    StoryStudioBatchQueue,
    StoryStudioBatchRemaining,
} from './storyStudioWorkflowTypes';

type UnknownRecord = Record<string, unknown>;

const exactObject = (value: unknown, path: string, keys: readonly string[]): UnknownRecord => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new StoryStudioProjectError('INVALID_PROJECT');
    }
    const source = value as UnknownRecord;
    const ownKeys = Object.keys(source);
    if (ownKeys.some(key => !keys.includes(key))) throw new StoryStudioProjectError('INVALID_PROJECT');
    return source;
};

const text = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) throw new StoryStudioProjectError('INVALID_PROJECT');
    return value.trim();
};

const integer = (value: unknown, minimum = 0): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
        throw new StoryStudioProjectError('INVALID_PROJECT');
    }
    return value;
};

const isoDate = (value: unknown): string => {
    const normalized = text(value);
    if (!Number.isFinite(Date.parse(normalized))) throw new StoryStudioProjectError('INVALID_PROJECT');
    return normalized;
};

const clone = <T>(value: T): T => structuredClone(value);

export const createCanonicalChapterMetadataIdentity = (
    value: Omit<CanonicalChapterMetadata, 'metadataIdentity'>,
): string => canonicalContentIdentity('canonical-chapter-metadata-v1', value);

export const createStoryStudioCoreIdentity = (value: Pick<StoryStudioProjectDocumentV1,
    'displayName' | 'setupDocument' | 'storyControlIdentity' | 'state' | 'memory' | 'chapterMetadata' | 'createdAt'>): string =>
    canonicalContentIdentity('story-studio-project-core-v1', {
        displayName: value.displayName, setupDocument: value.setupDocument,
        storyControlIdentity: value.storyControlIdentity, state: value.state, memory: value.memory,
        chapterMetadata: value.chapterMetadata, createdAt: value.createdAt,
    });

export const createStoryStudioWorkflowIdentity = (value: Pick<StoryStudioProjectDocumentV1,
    'workflow' | 'batchQueue'>): string => canonicalContentIdentity('story-studio-project-workflow-v1', {
        workflow: value.workflow, batchQueue: value.batchQueue,
    });

export const buildStoryStudioProjectDocument = (value: Omit<StoryStudioProjectDocumentV1,
    'kind' | 'formatVersion' | 'coreIdentity' | 'workflowIdentity'>): StoryStudioProjectDocumentV1 => {
    const body = {
        kind: 'story-studio-project-document' as const,
        formatVersion: 1 as const,
        displayName: value.displayName.trim(),
        setupDocument: clone(value.setupDocument),
        storyControlIdentity: value.storyControlIdentity,
        state: clone(value.state),
        memory: clone(value.memory),
        chapterMetadata: clone(value.chapterMetadata),
        workflow: clone(value.workflow),
        batchQueue: clone(value.batchQueue),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
    return {
        ...body,
        coreIdentity: createStoryStudioCoreIdentity(body),
        workflowIdentity: createStoryStudioWorkflowIdentity(body),
    };
};

export const createStoryStudioProject = (
    setupValue: unknown,
    displayNameValue: string,
    now = new Date().toISOString(),
): StoryStudioRuntimeProject => {
    const setupDocument = parseStoryBlueprintDocument(setupValue);
    const seed = createV4ProjectSeed(setupDocument);
    const document = buildStoryStudioProjectDocument({
        displayName: text(displayNameValue), setupDocument, storyControlIdentity: seed.storyControlIdentity,
        state: seed.state, memory: seed.memory, chapterMetadata: [],
        workflow: IDLE_STORY_STUDIO_WORKFLOW, batchQueue: DEFAULT_STORY_STUDIO_BATCH_QUEUE,
        createdAt: now, updatedAt: now,
    });
    return { ...document, control: seed.control };
};

const parseBatchQueue = (value: unknown): StoryStudioBatchQueue => {
    const input = exactObject(value, 'batchQueue', ['kind', 'requestedSize', 'remaining', 'paused']);
    if (input.kind !== 'story-studio-batch-queue' || !isStoryStudioBatchSize(input.requestedSize)
        || !Number.isSafeInteger(input.remaining) || (input.remaining as number) < 0 || (input.remaining as number) > 3
        || (input.remaining as number) > input.requestedSize
        || typeof input.paused !== 'boolean') throw new StoryStudioProjectError('WORKFLOW_INVALID');
    return {
        kind: 'story-studio-batch-queue', requestedSize: input.requestedSize,
        remaining: input.remaining as StoryStudioBatchRemaining, paused: input.paused,
    };
};

const parseCursor = (value: UnknownRecord, controlId: string, controlIdentity: string, baseCanonIdentity: string, target: number): ProductionStageCursor => {
    const cursor = {
        storyControlId: text(value.storyControlId), storyControlIdentity: text(value.storyControlIdentity),
        baseChapter: integer(value.baseChapter), baseRevision: integer(value.baseRevision),
        targetChapter: integer(value.targetChapter, 1), baseCanonIdentity: text(value.baseCanonIdentity),
    };
    if (cursor.storyControlId !== controlId || cursor.storyControlIdentity !== controlIdentity
        || cursor.baseChapter !== target - 1 || cursor.baseRevision !== target - 1
        || cursor.targetChapter !== target || cursor.baseCanonIdentity !== baseCanonIdentity) {
        throw new StoryStudioProjectError('WORKFLOW_INVALID');
    }
    return cursor;
};

const parsePlan = (
    value: unknown,
    project: Pick<StoryStudioRuntimeProject, 'control' | 'state' | 'memory' | 'storyControlIdentity'>,
): ProductionPlanArtifact => {
    const input = exactObject(value, 'workflow.plan', [
        'kind', 'artifactIdentity', 'storyControlId', 'storyControlIdentity', 'baseChapter', 'baseRevision',
        'targetChapter', 'baseCanonIdentity', 'memoryIdentity', 'writerPlan', 'privileged',
    ]);
    if (input.kind !== 'production-plan-artifact') throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const target = project.state.currentChapter + 1;
    const cursor = parseCursor(input, project.control.id, project.storyControlIdentity, createProductionCanonIdentity(project.state), target);
    const privilegedInput = exactObject(input.privileged, 'workflow.plan.privileged', ['internalPlan', 'strategicView', 'relationshipView']);
    const parsedInternal = parseInternalChapterPlan(privilegedInput.internalPlan);
    if (!parsedInternal.plan || parsedInternal.issues.some(issue => issue.severity === 'error')) {
        throw new StoryStudioProjectError('WORKFLOW_INVALID');
    }
    const policy = normalizeProductionStoryRuntimePolicy();
    const writerPlan = sanitizeWriterChapterPlan(
        parsedInternal.plan, project.control, project.state,
        policy.relationshipContextSelectionPolicy, policy.plannerContextSelectionPolicy,
    );
    if (!canonicalValuesEqual(writerPlan, input.writerPlan)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const plannerContext = buildPlannerContext(
        project.control, project.state, target, buildNarrativeMemoryInput(project.memory, project.control),
        policy.narrativeMemorySelectionPolicy, policy.relationshipContextSelectionPolicy,
        policy.plannerContextSelectionPolicy,
    );
    const strategicView = buildValidatorStrategicView(parsedInternal.plan, plannerContext, policy.validatorContextSelectionPolicy.maxStrategicItems);
    const relationshipView = buildValidatorRelationshipView(project.control, parsedInternal.plan, plannerContext, policy.validatorContextSelectionPolicy.maxRelationshipItems);
    if (!canonicalValuesEqual(strategicView, privilegedInput.strategicView)
        || !canonicalValuesEqual(relationshipView, privilegedInput.relationshipView)) {
        throw new StoryStudioProjectError('WORKFLOW_INVALID');
    }
    const memoryIdentity = text(input.memoryIdentity);
    const expectedMemoryIdentity = canonicalContentIdentity('production-narrative-memory-v1', project.memory);
    if (memoryIdentity !== expectedMemoryIdentity) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const body = {
        ...cursor, memoryIdentity, writerPlan,
        privileged: { internalPlan: parsedInternal.plan, strategicView, relationshipView },
    };
    const artifactIdentity = text(input.artifactIdentity);
    if (artifactIdentity !== createProductionPlanArtifactIdentity(body)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    return { kind: 'production-plan-artifact', artifactIdentity, ...body };
};

const parseDraft = (value: unknown, plan: ProductionPlanArtifact): ProductionDraftArtifact => {
    const input = exactObject(value, 'workflow.draft', [
        'kind', 'artifactIdentity', 'storyControlId', 'storyControlIdentity', 'baseChapter', 'baseRevision',
        'targetChapter', 'baseCanonIdentity', 'planArtifactIdentity', 'draft',
    ]);
    if (input.kind !== 'production-draft-artifact') throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const cursor = parseCursor(input, plan.storyControlId, plan.storyControlIdentity, plan.baseCanonIdentity, plan.targetChapter);
    const planArtifactIdentity = text(input.planArtifactIdentity);
    if (planArtifactIdentity !== plan.artifactIdentity) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const draft = parseWriterChapterDraft(input.draft, plan.targetChapter);
    const body = { ...cursor, planArtifactIdentity, draft };
    const artifactIdentity = text(input.artifactIdentity);
    if (artifactIdentity !== createProductionDraftArtifactIdentity(body)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    return { kind: 'production-draft-artifact', artifactIdentity, ...body };
};

const parseIssue = (value: unknown, chapter: number): ValidationIssue => {
    const input = exactObject(value, 'validation.issue', [
        'code', 'category', 'severity', 'blocking', 'repairable', 'scope', 'sceneId', 'source',
    ]);
    if (typeof input.code !== 'string' || !VALIDATION_ISSUE_CODES.includes(input.code as typeof VALIDATION_ISSUE_CODES[number])
        || !['critical', 'error', 'warning'].includes(String(input.severity))
        || !['deterministic', 'semantic-validator', 'infrastructure'].includes(String(input.source))
        || !['chapter', 'scene'].includes(String(input.scope))
        || (input.sceneId !== undefined && typeof input.sceneId !== 'string')) {
        throw new StoryStudioProjectError('WORKFLOW_INVALID');
    }
    const rebuilt = createValidationIssue(
        input.code as typeof VALIDATION_ISSUE_CODES[number],
        input.severity as ValidationIssue['severity'], input.source as ValidationIssue['source'],
        input.scope as ValidationIssue['scope'], typeof input.sceneId === 'string' ? input.sceneId : undefined,
    );
    void chapter;
    if (!canonicalValuesEqual(rebuilt, input)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    return rebuilt;
};

const parseValidationReport = (value: unknown, chapter: number) => {
    const input = exactObject(value, 'validation.report', [
        'kind', 'chapterNumber', 'status', 'validationPass', 'issues', 'blockingIssueCount', 'warningCount',
    ]);
    if (input.kind !== 'validation-report' || input.chapterNumber !== chapter || !Array.isArray(input.issues)) {
        throw new StoryStudioProjectError('WORKFLOW_INVALID');
    }
    const report = buildValidationReport(chapter, integer(input.validationPass, 1), input.issues.map(issue => parseIssue(issue, chapter)));
    if (!canonicalValuesEqual(report, input)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    return report;
};

const parseValidationResult = (
    value: unknown,
    project: Pick<StoryStudioRuntimeProject, 'control' | 'state'>,
    plan: ProductionPlanArtifact,
    draftArtifact: ProductionDraftArtifact,
): ValidationPipelineResult => {
    const input = exactObject(value, 'workflow.validation.result', ['status', 'draft', 'candidate', 'report', 'repairAttempts', 'source']);
    const report = parseValidationReport(input.report, plan.targetChapter);
    const repairAttempts = integer(input.repairAttempts);
    if (input.status === 'approved-not-canon') {
        if (input.candidate !== undefined) throw new StoryStudioProjectError('WORKFLOW_INVALID');
        const draft = parseWriterChapterDraft(input.draft, plan.targetChapter);
        if (!canonicalValuesEqual(draft, draftArtifact.draft)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
        const sourceInput = exactObject(input.source, 'workflow.validation.result.source', [
            'kind', 'storyControlId', 'storyControlIdentity', 'baseChapter', 'baseRevision', 'chapterPlan', 'canonicalizationSourceIdentity',
        ]);
        const source = {
            kind: 'validated-chapter-source' as const,
            storyControlId: text(sourceInput.storyControlId), storyControlIdentity: text(sourceInput.storyControlIdentity),
            baseChapter: integer(sourceInput.baseChapter), baseRevision: integer(sourceInput.baseRevision),
            chapterPlan: plan.writerPlan,
            canonicalizationSourceIdentity: text(sourceInput.canonicalizationSourceIdentity),
        };
        const expectedSourceIdentity = createCanonicalizationSourceIdentity({
            storyControlId: source.storyControlId, storyControlIdentity: source.storyControlIdentity,
            baseChapter: source.baseChapter, baseRevision: source.baseRevision, chapterPlan: source.chapterPlan, draft,
        });
        if (source.canonicalizationSourceIdentity !== expectedSourceIdentity || !canonicalValuesEqual(sourceInput.chapterPlan, plan.writerPlan)) {
            throw new StoryStudioProjectError('WORKFLOW_INVALID');
        }
        const result = { status: 'approved-not-canon' as const, draft, report, repairAttempts, source };
        const validated = validateApprovedExtractionSource(result, project.state, project.control);
        if (!isValidatedExtractionSource(validated) || !canonicalValuesEqual(result, input)) {
            throw new StoryStudioProjectError('WORKFLOW_INVALID');
        }
        return result;
    }
    if (input.status !== 'rejected' || input.source !== undefined) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    if (input.draft !== undefined && input.candidate !== undefined) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    if (input.draft !== undefined) {
        const draft = parseWriterChapterDraft(input.draft, plan.targetChapter);
        const result = { status: 'rejected' as const, draft, report, repairAttempts };
        if (!canonicalValuesEqual(result, input)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
        return result;
    }
    let candidate: { readonly kind: 'repair-candidate-snapshot'; readonly chapterNumber: number; readonly title?: string; readonly prose: string } | undefined;
    if (input.candidate !== undefined) {
        const candidateInput = exactObject(input.candidate, 'workflow.validation.result.candidate', ['kind', 'chapterNumber', 'title', 'prose']);
        if (candidateInput.kind !== 'repair-candidate-snapshot' || candidateInput.chapterNumber !== plan.targetChapter
            || typeof candidateInput.prose !== 'string' || !candidateInput.prose.trim()
            || (candidateInput.title !== undefined && (typeof candidateInput.title !== 'string' || !candidateInput.title.trim()))) {
            throw new StoryStudioProjectError('WORKFLOW_INVALID');
        }
        candidate = {
            kind: 'repair-candidate-snapshot', chapterNumber: plan.targetChapter,
            ...(typeof candidateInput.title === 'string' ? { title: candidateInput.title } : {}), prose: candidateInput.prose,
        };
    }
    const result = { status: 'rejected' as const, ...(candidate === undefined ? {} : { candidate }), report, repairAttempts };
    if (!canonicalValuesEqual(result, input)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    return result;
};

const parseValidation = (
    value: unknown,
    project: Pick<StoryStudioRuntimeProject, 'control' | 'state'>,
    plan: ProductionPlanArtifact,
    draft: ProductionDraftArtifact,
): ProductionValidationArtifact => {
    const input = exactObject(value, 'workflow.validation', [
        'kind', 'artifactIdentity', 'storyControlId', 'storyControlIdentity', 'baseChapter', 'baseRevision',
        'targetChapter', 'baseCanonIdentity', 'planArtifactIdentity', 'draftArtifactIdentity', 'result',
    ]);
    if (input.kind !== 'production-validation-artifact') throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const cursor = parseCursor(input, plan.storyControlId, plan.storyControlIdentity, plan.baseCanonIdentity, plan.targetChapter);
    const planArtifactIdentity = text(input.planArtifactIdentity);
    const draftArtifactIdentity = text(input.draftArtifactIdentity);
    if (planArtifactIdentity !== plan.artifactIdentity || draftArtifactIdentity !== draft.artifactIdentity) {
        throw new StoryStudioProjectError('WORKFLOW_INVALID');
    }
    const result = parseValidationResult(input.result, project, plan, draft);
    const body = { ...cursor, planArtifactIdentity, draftArtifactIdentity, result };
    const artifactIdentity = text(input.artifactIdentity);
    if (artifactIdentity !== createProductionValidationArtifactIdentity(body)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    return { kind: 'production-validation-artifact', artifactIdentity, ...body };
};

const parseExtraction = (
    value: unknown,
    plan: ProductionPlanArtifact,
    validation: ProductionValidationArtifact,
): ProductionExtractionArtifact => {
    const input = exactObject(value, 'workflow.extraction', [
        'kind', 'artifactIdentity', 'storyControlId', 'storyControlIdentity', 'baseChapter', 'baseRevision',
        'targetChapter', 'baseCanonIdentity', 'validationArtifactIdentity', 'result',
    ]);
    if (input.kind !== 'production-extraction-artifact') throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const cursor = parseCursor(input, plan.storyControlId, plan.storyControlIdentity, plan.baseCanonIdentity, plan.targetChapter);
    const validationArtifactIdentity = text(input.validationArtifactIdentity);
    if (validationArtifactIdentity !== validation.artifactIdentity) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const resultInput = exactObject(input.result, 'workflow.extraction.result', ['status', 'sourceIdentity', 'delta']);
    if (resultInput.status !== 'extracted-not-canon') throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const result = {
        status: 'extracted-not-canon' as const,
        sourceIdentity: text(resultInput.sourceIdentity),
        delta: parseStoryStateDelta(resultInput.delta),
    };
    if (!canonicalValuesEqual(result, resultInput)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const body = { ...cursor, validationArtifactIdentity, result };
    const artifactIdentity = text(input.artifactIdentity);
    if (artifactIdentity !== createProductionExtractionArtifactIdentity(body)) throw new StoryStudioProjectError('WORKFLOW_INVALID');
    return { kind: 'production-extraction-artifact', artifactIdentity, ...body };
};

const parseWorkflow = (
    value: unknown,
    project: Pick<StoryStudioRuntimeProject, 'control' | 'state' | 'memory' | 'storyControlIdentity'>,
): PersistedStoryStudioWorkflow => {
    const stageInput = exactObject(value, 'workflow', ['stage', 'plan', 'draft', 'validation', 'extraction', 'proposal']);
    if (stageInput.stage === 'idle') {
        if (Object.keys(stageInput).length !== 1) throw new StoryStudioProjectError('WORKFLOW_INVALID');
        return IDLE_STORY_STUDIO_WORKFLOW;
    }
    const plan = parsePlan(stageInput.plan, project);
    if (stageInput.stage === 'planned') return { stage: 'planned', plan };
    const draft = parseDraft(stageInput.draft, plan);
    if (stageInput.stage === 'drafted') return { stage: 'drafted', plan, draft };
    const validation = parseValidation(stageInput.validation, project, plan, draft);
    if (stageInput.stage === 'rejected') {
        if (validation.result.status !== 'rejected') throw new StoryStudioProjectError('WORKFLOW_INVALID');
        return { stage: 'rejected', plan, draft, validation };
    }
    if (validation.result.status !== 'approved-not-canon') throw new StoryStudioProjectError('WORKFLOW_INVALID');
    if (stageInput.stage === 'validated') return { stage: 'validated', plan, draft, validation };
    const extraction = parseExtraction(stageInput.extraction, plan, validation);
    if (stageInput.stage === 'extracted') return { stage: 'extracted', plan, draft, validation, extraction };
    if (stageInput.stage !== 'ready-for-canon-review') throw new StoryStudioProjectError('WORKFLOW_INVALID');
    const prepared = prepareCanonCommit({ approved: validation.result, extraction: extraction.result, state: project.state, control: project.control });
    if (prepared.status !== 'ready-for-review' || !canonicalValuesEqual(prepared, stageInput.proposal)) {
        throw new StoryStudioProjectError('WORKFLOW_INVALID');
    }
    return { stage: 'ready-for-canon-review', plan, draft, validation, extraction, proposal: prepared };
};

const parseMetadata = (value: unknown, memory: NarrativeMemoryState): readonly CanonicalChapterMetadata[] => {
    if (!Array.isArray(value) || value.length !== memory.records.length) throw new StoryStudioProjectError('INVALID_PROJECT');
    return value.map((entryValue, index) => {
        const input = exactObject(entryValue, `chapterMetadata.${index}`, [
            'kind', 'chapterNumber', 'title', 'canonicalizationSourceIdentity', 'proposalIdentity',
            'beforeCanonIdentity', 'afterCanonIdentity', 'metadataIdentity',
        ]);
        const record = memory.records[index];
        if (input.kind !== 'canonical-chapter-metadata' || input.chapterNumber !== index + 1
            || (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim()))) {
            throw new StoryStudioProjectError('INVALID_PROJECT');
        }
        const body = {
            kind: 'canonical-chapter-metadata' as const, chapterNumber: index + 1,
            ...(typeof input.title === 'string' ? { title: input.title.trim() } : {}),
            canonicalizationSourceIdentity: text(input.canonicalizationSourceIdentity),
            proposalIdentity: text(input.proposalIdentity), beforeCanonIdentity: text(input.beforeCanonIdentity),
            afterCanonIdentity: text(input.afterCanonIdentity),
        };
        if (body.canonicalizationSourceIdentity !== record.canonicalizationSourceIdentity
            || body.proposalIdentity !== record.proposalIdentity || body.beforeCanonIdentity !== record.beforeCanonIdentity
            || body.afterCanonIdentity !== record.afterCanonIdentity) throw new StoryStudioProjectError('INVALID_PROJECT');
        const metadataIdentity = text(input.metadataIdentity);
        if (metadataIdentity !== createCanonicalChapterMetadataIdentity(body)) throw new StoryStudioProjectError('INVALID_PROJECT');
        return { ...body, metadataIdentity };
    });
};

export interface ParsedStoryStudioProject {
    readonly project: StoryStudioRuntimeProject;
    readonly workflowRecovered: boolean;
}

export const parseStoryStudioProjectDocument = (value: unknown): ParsedStoryStudioProject => {
    const input = exactObject(value, 'project', [
        'kind', 'formatVersion', 'displayName', 'setupDocument', 'storyControlIdentity', 'state', 'memory',
        'chapterMetadata', 'workflow', 'batchQueue', 'createdAt', 'updatedAt', 'coreIdentity', 'workflowIdentity',
    ]);
    if (input.kind !== 'story-studio-project-document' || input.formatVersion !== 1) {
        throw new StoryStudioProjectError('INVALID_PROJECT');
    }
    const displayName = text(input.displayName);
    const setupDocument: StoryBlueprintDocument = parseStoryBlueprintDocument(input.setupDocument);
    const control = compileStoryControl(setupDocument.blueprint);
    const storyControlIdentity = text(input.storyControlIdentity);
    if (storyControlIdentity !== createStoryControlIdentity(control)) throw new StoryStudioProjectError('INVALID_PROJECT');
    const state = parseStoryState(input.state, control);
    const memory = parseNarrativeMemoryState(input.memory, control);
    const latestMemory = memory.records.at(-1);
    if (memory.records.length !== state.currentChapter
        || (state.currentChapter === 0 && latestMemory !== undefined)
        || (state.currentChapter > 0 && latestMemory?.afterCanonIdentity !== createProductionCanonIdentity(state))) {
        throw new StoryStudioProjectError('INVALID_PROJECT');
    }
    const chapterMetadata = parseMetadata(input.chapterMetadata, memory);
    const createdAt = isoDate(input.createdAt);
    const updatedAt = isoDate(input.updatedAt);
    const core = { displayName, setupDocument, storyControlIdentity, state, memory, chapterMetadata, createdAt };
    if (text(input.coreIdentity) !== createStoryStudioCoreIdentity(core)) {
        throw new StoryStudioProjectError('CORE_IDENTITY_MISMATCH');
    }
    const coreProject = { ...core, control };
    try {
        const batchQueue = parseBatchQueue(input.batchQueue);
        const workflow = parseWorkflow(input.workflow, coreProject);
        if (text(input.workflowIdentity) !== createStoryStudioWorkflowIdentity({ workflow, batchQueue })) {
            throw new StoryStudioProjectError('WORKFLOW_INVALID');
        }
        return {
            workflowRecovered: false,
            project: {
                kind: 'story-studio-project-document', formatVersion: 1, ...coreProject, workflow, batchQueue,
                createdAt, updatedAt, coreIdentity: text(input.coreIdentity), workflowIdentity: text(input.workflowIdentity),
            },
        };
    } catch {
        const recoveredDocument = buildStoryStudioProjectDocument({
            ...core, workflow: IDLE_STORY_STUDIO_WORKFLOW,
            batchQueue: { ...DEFAULT_STORY_STUDIO_BATCH_QUEUE, paused: true }, updatedAt,
        });
        return { workflowRecovered: true, project: { ...recoveredDocument, control } };
    }
};

export const withoutRuntimeControl = (project: StoryStudioRuntimeProject): StoryStudioProjectDocumentV1 => ({
    kind: project.kind, formatVersion: project.formatVersion, displayName: project.displayName,
    setupDocument: clone(project.setupDocument), storyControlIdentity: project.storyControlIdentity,
    state: clone(project.state), memory: clone(project.memory), chapterMetadata: clone(project.chapterMetadata),
    workflow: clone(project.workflow), batchQueue: clone(project.batchQueue), createdAt: project.createdAt,
    updatedAt: project.updatedAt, coreIdentity: project.coreIdentity, workflowIdentity: project.workflowIdentity,
});

export const rebuildRuntimeProject = (
    project: StoryStudioRuntimeProject,
    updates: Partial<Pick<StoryStudioProjectDocumentV1,
        'displayName' | 'state' | 'memory' | 'chapterMetadata' | 'workflow' | 'batchQueue' | 'updatedAt'>>,
): StoryStudioRuntimeProject => {
    const document = buildStoryStudioProjectDocument({
        displayName: updates.displayName ?? project.displayName, setupDocument: project.setupDocument,
        storyControlIdentity: project.storyControlIdentity, state: updates.state ?? project.state,
        memory: updates.memory ?? project.memory, chapterMetadata: updates.chapterMetadata ?? project.chapterMetadata,
        workflow: updates.workflow ?? project.workflow, batchQueue: updates.batchQueue ?? project.batchQueue,
        createdAt: project.createdAt, updatedAt: updates.updatedAt ?? project.updatedAt,
    });
    return { ...document, control: project.control };
};

export const proposalFromWorkflow = (workflow: PersistedStoryStudioWorkflow): CanonCommitProposal | undefined =>
    workflow.stage === 'ready-for-canon-review' ? workflow.proposal : undefined;
