import { prepareCanonCommit } from './canonCommit';
import { createStoryControlIdentity } from './canonicalIdentity';
import { buildPlannerContext } from './contextBuilder';
import { createStructuredPlanner } from './planner';
import { ChapterPlanValidationError } from './planValidator';
import { summarizePlanValidationIssues } from './planDiagnostics';
import {
    PlannerModel,
} from './plannerTypes';
import { sanitizeWriterChapterPlan } from './planSanitizer';
import {
    createProductionDraftArtifactIdentity,
    createProductionExtractionArtifactIdentity,
    createProductionCanonIdentity,
    createProductionPlanArtifactIdentity,
    createProductionValidationArtifactIdentity,
} from './productionArtifactIdentity';
import {
    ProductionChapterRunResult,
    ProductionDraftArtifact,
    ProductionExtractionArtifact,
    ProductionModelCallTelemetry,
    ProductionPlanArtifact,
    ProductionRuntimeError,
    ProductionRunTelemetry,
    ProductionStoryRuntimePolicy,
    ProductionValidationArtifact,
    StoryEngineModelBundle,
    StoryEngineModelRuntimeError,
} from './productionRuntimeTypes';
import { buildValidatorRelationshipView } from './relationshipValidatorContext';
import { RepairModel, validateAndRepairWriterChapter } from './repair';
import { SemanticValidatorModel } from './semanticValidator';
import {
    buildNarrativeMemoryInput,
    createNarrativeMemoryIdentity,
    NarrativeMemoryError,
    NarrativeMemoryState,
    parseNarrativeMemoryState,
} from './narrativeMemory';
import { extractState } from './stateExtractor';
import { StateExtractorModel } from './stateExtractorTypes';
import { parseStoryState } from './storyStateRuntime';
import { buildValidatorStrategicView } from './strategicContext';
import { FullStoryControl, StoryState } from './types';
import { generateWriterDraft } from './writer';
import { WriterModel } from './writerTypes';
import { normalizeProductionStoryRuntimePolicy } from './productionRuntimePolicy';

interface ModelTelemetrySource {
    getLastSelectedModelId(): string | undefined;
}

const hasTelemetry = (value: unknown): value is ModelTelemetrySource =>
    typeof value === 'object' && value !== null
    && typeof (value as { readonly getLastSelectedModelId?: unknown }).getLastSelectedModelId === 'function';

const selectedModel = (value: unknown): string | undefined => hasTelemetry(value) ? value.getLastSelectedModelId() : undefined;

const isCancelled = (error: unknown): boolean => error instanceof Error
    && (error.message === 'ABORTED' || error.name === 'AbortError');

const strictState = (control: FullStoryControl, value: StoryState | unknown, stage: ProductionRuntimeError['stage'], chapter: number): StoryState => {
    try {
        return parseStoryState(value, control);
    } catch {
        throw new ProductionRuntimeError('INVALID_CURRENT_CANON', stage, chapter);
    }
};

const assertCursor = (
    control: FullStoryControl,
    state: StoryState,
    artifact: {
        readonly storyControlId: string;
        readonly storyControlIdentity: string;
        readonly baseChapter: number;
        readonly baseRevision: number;
        readonly targetChapter: number;
        readonly baseCanonIdentity: string;
    },
    stage: ProductionRuntimeError['stage'],
): void => {
    if (artifact.storyControlId !== control.id
        || artifact.storyControlIdentity !== createStoryControlIdentity(control)
        || artifact.baseChapter !== state.currentChapter
        || artifact.baseRevision !== state.revision || artifact.targetChapter !== state.currentChapter + 1) {
        throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', stage, state.currentChapter + 1);
    }
    if (artifact.baseCanonIdentity !== createProductionCanonIdentity(state)) {
        throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', stage, state.currentChapter + 1);
    }
};

const requireProductionMemory = (
    control: FullStoryControl,
    state: StoryState,
    memoryState: NarrativeMemoryState,
    stage: ProductionRuntimeError['stage'],
    chapter: number,
): NarrativeMemoryState => {
    try {
        const parsed = parseNarrativeMemoryState(memoryState, control);
        const latest = parsed.records.at(-1);
        if ((state.currentChapter === 0 && latest !== undefined)
            || (state.currentChapter > 0 && (latest === undefined
                || latest.chapterNumber !== state.currentChapter
                || latest.afterCanonIdentity !== createProductionCanonIdentity(state)))) {
            throw new ProductionRuntimeError('MEMORY_CANON_MISMATCH', stage, chapter);
        }
        return parsed;
    } catch (error) {
        if (error instanceof ProductionRuntimeError) throw error;
        if (error instanceof NarrativeMemoryError && error.code === 'MEMORY_STORY_MISMATCH') {
            throw new ProductionRuntimeError('MEMORY_STORY_MISMATCH', stage, chapter);
        }
        throw new ProductionRuntimeError('INVALID_PROJECT', stage, chapter);
    }
};

const instrumentPlanner = (model: PlannerModel, calls: ProductionModelCallTelemetry[]): PlannerModel => ({
    async plan(context) {
        try {
            const result = await model.plan(context);
            calls.push({ role: 'planner', status: 'succeeded', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            return result;
        } catch (error) {
            calls.push({ role: 'planner', status: 'failed', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            throw error;
        }
    },
});

const instrumentWriter = (model: WriterModel, calls: ProductionModelCallTelemetry[]): WriterModel => ({
    async write(request) {
        try {
            const result = await model.write(request);
            calls.push({ role: 'writer', status: 'succeeded', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            return result;
        } catch (error) {
            calls.push({ role: 'writer', status: 'failed', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            throw error;
        }
    },
});

const instrumentSemanticValidator = (model: SemanticValidatorModel, calls: ProductionModelCallTelemetry[]): SemanticValidatorModel => ({
    async validate(request) {
        try {
            const result = await model.validate(request);
            calls.push({ role: 'semanticValidator', status: 'succeeded', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            return result;
        } catch (error) {
            calls.push({ role: 'semanticValidator', status: 'failed', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            throw error;
        }
    },
});

const instrumentRepair = (model: RepairModel, calls: ProductionModelCallTelemetry[]): RepairModel => ({
    async repair(request) {
        try {
            const result = await model.repair(request);
            calls.push({ role: 'repair', status: 'succeeded', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            return result;
        } catch (error) {
            calls.push({ role: 'repair', status: 'failed', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            throw error;
        }
    },
});

const instrumentStateExtractor = (model: StateExtractorModel, calls: ProductionModelCallTelemetry[]): StateExtractorModel => ({
    async extract(request) {
        try {
            const result = await model.extract(request);
            calls.push({ role: 'stateExtractor', status: 'succeeded', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            return result;
        } catch (error) {
            calls.push({ role: 'stateExtractor', status: 'failed', ...(selectedModel(model) === undefined ? {} : { selectedModelId: selectedModel(model) }) });
            throw error;
        }
    },
});

const issueCodes = (values: readonly { readonly code: string }[]): readonly string[] => [...new Set(values.map(value => value.code))].sort();

export interface ProductionStageRequest {
    readonly control: FullStoryControl;
    readonly state: StoryState | unknown;
    readonly memoryState: NarrativeMemoryState;
    readonly targetChapter?: number;
}

export interface CreateProductionStoryRuntimeRequest {
    readonly models: StoryEngineModelBundle;
    readonly runtimePolicy?: Partial<ProductionStoryRuntimePolicy>;
}

export const createProductionStoryRuntime = ({ models, runtimePolicy: suppliedPolicy }: CreateProductionStoryRuntimeRequest) => {
    const runtimePolicy = normalizeProductionStoryRuntimePolicy(suppliedPolicy);

    const planProductionChapter = async (
        request: ProductionStageRequest,
        calls: ProductionModelCallTelemetry[] = [],
    ): Promise<ProductionPlanArtifact> => {
        const requestedChapter = request.targetChapter ?? ((request.state as { readonly currentChapter?: number })?.currentChapter ?? 0) + 1;
        const state = strictState(request.control, request.state, 'planning', requestedChapter);
        const targetChapter = request.targetChapter ?? state.currentChapter + 1;
        if (targetChapter !== state.currentChapter + 1) throw new ProductionRuntimeError('INVALID_PROJECT', 'planning', targetChapter);
        if (targetChapter > request.control.engine.plannedChapterCount) throw new ProductionRuntimeError('STORY_COMPLETE', 'planning', targetChapter);
        const memory = requireProductionMemory(request.control, state, request.memoryState, 'planning', targetChapter);
        const memoryInput = buildNarrativeMemoryInput(memory, request.control);
        const memoryIdentity = createNarrativeMemoryIdentity(memory, request.control);
        let plannerContext;
        try {
            plannerContext = buildPlannerContext(
                request.control, state, targetChapter, memoryInput,
                runtimePolicy.narrativeMemorySelectionPolicy, runtimePolicy.relationshipContextSelectionPolicy,
                runtimePolicy.plannerContextSelectionPolicy,
            );
        } catch {
            throw new ProductionRuntimeError('INVALID_PROJECT', 'planning', targetChapter);
        }
        let internalPlan;
        try {
            internalPlan = await createStructuredPlanner(instrumentPlanner(models.planner, calls), request.control).plan(plannerContext);
        } catch (error) {
            if (isCancelled(error)) throw new ProductionRuntimeError('CANCELLED', 'planning', targetChapter, 'planner');
            if (error instanceof StoryEngineModelRuntimeError) {
                throw new ProductionRuntimeError(
                    'MODEL_RUNTIME_FAILURE', 'planning', targetChapter, 'planner',
                    undefined, undefined, undefined, error.modelAttempts,
                );
            }
            if (error instanceof ChapterPlanValidationError) {
                const summary = summarizePlanValidationIssues(error.issues);
                throw new ProductionRuntimeError(
                    'PLAN_VALIDATION_FAILURE', 'planning', targetChapter, 'planner',
                    summary.issueCodes, summary.issueCount, summary.issuePaths,
                );
            }
            throw new ProductionRuntimeError('PLAN_PROTOCOL_FAILURE', 'planning', targetChapter, 'planner');
        }
        try {
            const writerPlan = sanitizeWriterChapterPlan(
                internalPlan, request.control, state,
                runtimePolicy.relationshipContextSelectionPolicy, runtimePolicy.plannerContextSelectionPolicy,
            );
            const privileged = {
                internalPlan,
                strategicView: buildValidatorStrategicView(internalPlan, plannerContext, runtimePolicy.validatorContextSelectionPolicy.maxStrategicItems),
                relationshipView: buildValidatorRelationshipView(request.control, internalPlan, plannerContext, runtimePolicy.validatorContextSelectionPolicy.maxRelationshipItems),
            };
            const body = {
                storyControlId: request.control.id, storyControlIdentity: createStoryControlIdentity(request.control),
                baseChapter: state.currentChapter, baseRevision: state.revision,
                targetChapter, baseCanonIdentity: createProductionCanonIdentity(state), memoryIdentity,
                writerPlan: structuredClone(writerPlan), privileged: structuredClone(privileged),
            };
            return { kind: 'production-plan-artifact', artifactIdentity: createProductionPlanArtifactIdentity(body), ...body };
        } catch (error) {
            if (error instanceof ChapterPlanValidationError) {
                const summary = summarizePlanValidationIssues(error.issues);
                throw new ProductionRuntimeError(
                    'PLAN_VALIDATION_FAILURE', 'planning', targetChapter, 'planner',
                    summary.issueCodes, summary.issueCount, summary.issuePaths,
                );
            }
            throw new ProductionRuntimeError('PLAN_VALIDATION_FAILURE', 'planning', targetChapter, 'planner');
        }
    };

    const requirePlan = (control: FullStoryControl, state: StoryState, value: ProductionPlanArtifact, stage: ProductionRuntimeError['stage']): ProductionPlanArtifact => {
        if (!value || value.kind !== 'production-plan-artifact') throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', stage, state.currentChapter + 1);
        assertCursor(control, state, value, stage);
        const expected = createProductionPlanArtifactIdentity({
            storyControlId: value.storyControlId, baseChapter: value.baseChapter, baseRevision: value.baseRevision,
            storyControlIdentity: value.storyControlIdentity,
            targetChapter: value.targetChapter, baseCanonIdentity: value.baseCanonIdentity,
            memoryIdentity: value.memoryIdentity, writerPlan: value.writerPlan, privileged: value.privileged,
        });
        if (expected !== value.artifactIdentity) throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', stage, value.targetChapter);
        return value;
    };

    const writeProductionChapter = async (
        request: ProductionStageRequest & { readonly plan: ProductionPlanArtifact },
        calls: ProductionModelCallTelemetry[] = [],
    ): Promise<ProductionDraftArtifact> => {
        const state = strictState(request.control, request.state, 'writing', request.plan?.targetChapter ?? 0);
        const plan = requirePlan(request.control, state, request.plan, 'writing');
        const memory = requireProductionMemory(request.control, state, request.memoryState, 'writing', plan.targetChapter);
        if (createNarrativeMemoryIdentity(memory, request.control) !== plan.memoryIdentity) {
            throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', 'writing', plan.targetChapter);
        }
        let draft;
        try {
            draft = await generateWriterDraft({
                control: request.control, state, plan: plan.writerPlan,
                memoryInput: buildNarrativeMemoryInput(memory, request.control),
                memoryPolicy: runtimePolicy.narrativeMemorySelectionPolicy,
                contextSelectionPolicy: runtimePolicy.writerContextSelectionPolicy,
                model: instrumentWriter(models.writer, calls),
            });
        } catch (error) {
            if (isCancelled(error)) throw new ProductionRuntimeError('CANCELLED', 'writing', plan.targetChapter, 'writer');
            if (error instanceof StoryEngineModelRuntimeError) {
                throw new ProductionRuntimeError(
                    'MODEL_RUNTIME_FAILURE', 'writing', plan.targetChapter, 'writer',
                    undefined, undefined, undefined, error.modelAttempts,
                );
            }
            throw new ProductionRuntimeError('WRITER_PROTOCOL_FAILURE', 'writing', plan.targetChapter, 'writer');
        }
        const body = {
            storyControlId: plan.storyControlId, storyControlIdentity: plan.storyControlIdentity,
            baseChapter: plan.baseChapter, baseRevision: plan.baseRevision,
            targetChapter: plan.targetChapter, baseCanonIdentity: plan.baseCanonIdentity,
            planArtifactIdentity: plan.artifactIdentity, draft: structuredClone(draft),
        };
        return { kind: 'production-draft-artifact', artifactIdentity: createProductionDraftArtifactIdentity(body), ...body };
    };

    const requireDraft = (
        control: FullStoryControl, state: StoryState, plan: ProductionPlanArtifact,
        value: ProductionDraftArtifact, stage: ProductionRuntimeError['stage'],
    ): ProductionDraftArtifact => {
        if (!value || value.kind !== 'production-draft-artifact' || value.planArtifactIdentity !== plan.artifactIdentity) {
            throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', stage, plan.targetChapter);
        }
        assertCursor(control, state, value, stage);
        const expected = createProductionDraftArtifactIdentity({
            storyControlId: value.storyControlId, baseChapter: value.baseChapter, baseRevision: value.baseRevision,
            storyControlIdentity: value.storyControlIdentity,
            targetChapter: value.targetChapter, baseCanonIdentity: value.baseCanonIdentity,
            planArtifactIdentity: value.planArtifactIdentity, draft: value.draft,
        });
        if (expected !== value.artifactIdentity) throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', stage, plan.targetChapter);
        return value;
    };

    const validateProductionChapter = async (
        request: ProductionStageRequest & { readonly plan: ProductionPlanArtifact; readonly draft: ProductionDraftArtifact },
        calls: ProductionModelCallTelemetry[] = [],
    ): Promise<ProductionValidationArtifact> => {
        const state = strictState(request.control, request.state, 'validation', request.plan?.targetChapter ?? 0);
        const plan = requirePlan(request.control, state, request.plan, 'validation');
        const draft = requireDraft(request.control, state, plan, request.draft, 'validation');
        const validationCallOffset = calls.length;
        let result;
        try {
            result = await validateAndRepairWriterChapter({
                control: request.control, state, plan: plan.writerPlan, draft: draft.draft,
                semanticModel: instrumentSemanticValidator(models.semanticValidator, calls),
                repairModel: instrumentRepair(models.repair, calls), maxRepairAttempts: runtimePolicy.maxRepairAttempts,
                validatorContextSelectionPolicy: {
                    ...runtimePolicy.validatorContextSelectionPolicy,
                    relationshipContextPolicy: runtimePolicy.relationshipContextSelectionPolicy,
                    plannerContextSelectionPolicy: runtimePolicy.plannerContextSelectionPolicy,
                },
                strategicView: plan.privileged.strategicView,
                relationshipView: plan.privileged.relationshipView,
            });
        } catch (error) {
            const failedValidationRole = calls.slice(validationCallOffset).findLast(call => call.status === 'failed'
                && (call.role === 'semanticValidator' || call.role === 'repair'))?.role;
            if (isCancelled(error)) throw new ProductionRuntimeError(
                'CANCELLED', 'validation', plan.targetChapter, failedValidationRole ?? 'semanticValidator',
            );
            if (error instanceof StoryEngineModelRuntimeError) throw new ProductionRuntimeError(
                'MODEL_RUNTIME_FAILURE', 'validation', plan.targetChapter, error.role,
                undefined, undefined, undefined, error.modelAttempts,
            );
            throw new ProductionRuntimeError('MODEL_RUNTIME_FAILURE', 'validation', plan.targetChapter, 'semanticValidator');
        }
        const body = {
            storyControlId: plan.storyControlId, storyControlIdentity: plan.storyControlIdentity,
            baseChapter: plan.baseChapter, baseRevision: plan.baseRevision,
            targetChapter: plan.targetChapter, baseCanonIdentity: plan.baseCanonIdentity, planArtifactIdentity: plan.artifactIdentity,
            draftArtifactIdentity: draft.artifactIdentity, result: structuredClone(result),
        };
        return { kind: 'production-validation-artifact', artifactIdentity: createProductionValidationArtifactIdentity(body), ...body };
    };

    const requireValidation = (
        control: FullStoryControl, state: StoryState, plan: ProductionPlanArtifact, draft: ProductionDraftArtifact,
        value: ProductionValidationArtifact, stage: ProductionRuntimeError['stage'],
    ): ProductionValidationArtifact => {
        if (!value || value.kind !== 'production-validation-artifact') throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', stage, plan.targetChapter);
        assertCursor(control, state, value, stage);
        if (value.planArtifactIdentity !== plan.artifactIdentity || value.draftArtifactIdentity !== draft.artifactIdentity) {
            throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', stage, plan.targetChapter);
        }
        const expected = createProductionValidationArtifactIdentity({
            storyControlId: value.storyControlId, baseChapter: value.baseChapter, baseRevision: value.baseRevision,
            storyControlIdentity: value.storyControlIdentity,
            targetChapter: value.targetChapter, baseCanonIdentity: value.baseCanonIdentity, planArtifactIdentity: value.planArtifactIdentity,
            draftArtifactIdentity: value.draftArtifactIdentity, result: value.result,
        });
        if (expected !== value.artifactIdentity) throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', stage, plan.targetChapter);
        return value;
    };

    const extractProductionChapter = async (
        request: ProductionStageRequest & {
            readonly plan: ProductionPlanArtifact;
            readonly draft: ProductionDraftArtifact;
            readonly validation: ProductionValidationArtifact;
        },
        calls: ProductionModelCallTelemetry[] = [],
    ): Promise<ProductionExtractionArtifact> => {
        const state = strictState(request.control, request.state, 'extraction', request.plan?.targetChapter ?? 0);
        const plan = requirePlan(request.control, state, request.plan, 'extraction');
        const draft = requireDraft(request.control, state, plan, request.draft, 'extraction');
        const validation = requireValidation(request.control, state, plan, draft, request.validation, 'extraction');
        if (validation.result.status !== 'approved-not-canon') {
            throw new ProductionRuntimeError('VALIDATION_REJECTED', 'extraction', plan.targetChapter);
        }
        let result;
        try {
            result = await extractState({
                approved: validation.result, state, control: request.control,
                model: instrumentStateExtractor(models.stateExtractor, calls),
                contextSelectionPolicy: runtimePolicy.stateExtractionContextSelectionPolicy,
            });
        } catch (error) {
            if (isCancelled(error)) throw new ProductionRuntimeError('CANCELLED', 'extraction', plan.targetChapter, 'stateExtractor');
            if (error instanceof StoryEngineModelRuntimeError) throw new ProductionRuntimeError(
                'MODEL_RUNTIME_FAILURE', 'extraction', plan.targetChapter, 'stateExtractor',
                undefined, undefined, undefined, error.modelAttempts,
            );
            throw new ProductionRuntimeError('MODEL_RUNTIME_FAILURE', 'extraction', plan.targetChapter, 'stateExtractor');
        }
        if (result.status === 'blocked') {
            if (calls.at(-1)?.role === 'stateExtractor' && calls.at(-1)?.status === 'failed') {
                throw new ProductionRuntimeError('EXTRACTION_BLOCKED', 'extraction', plan.targetChapter, 'stateExtractor', issueCodes(result.issues));
            }
            throw new ProductionRuntimeError('EXTRACTION_BLOCKED', 'extraction', plan.targetChapter, 'stateExtractor', issueCodes(result.issues));
        }
        const body = {
            storyControlId: plan.storyControlId, storyControlIdentity: plan.storyControlIdentity,
            baseChapter: plan.baseChapter, baseRevision: plan.baseRevision,
            targetChapter: plan.targetChapter, baseCanonIdentity: plan.baseCanonIdentity,
            validationArtifactIdentity: validation.artifactIdentity,
            result: structuredClone(result),
        };
        return { kind: 'production-extraction-artifact', artifactIdentity: createProductionExtractionArtifactIdentity(body), ...body };
    };

    const prepareProductionCanonReview = (
        request: ProductionStageRequest & {
            readonly plan: ProductionPlanArtifact;
            readonly draft: ProductionDraftArtifact;
            readonly validation: ProductionValidationArtifact;
            readonly extraction: ProductionExtractionArtifact;
        },
    ) => {
        const state = strictState(request.control, request.state, 'canon-review', request.plan?.targetChapter ?? 0);
        const plan = requirePlan(request.control, state, request.plan, 'canon-review');
        const draft = requireDraft(request.control, state, plan, request.draft, 'canon-review');
        const validation = requireValidation(request.control, state, plan, draft, request.validation, 'canon-review');
        if (validation.result.status !== 'approved-not-canon') throw new ProductionRuntimeError('VALIDATION_REJECTED', 'canon-review', plan.targetChapter);
        const extraction = request.extraction;
        if (!extraction || extraction.kind !== 'production-extraction-artifact'
            || extraction.validationArtifactIdentity !== validation.artifactIdentity
            || createProductionExtractionArtifactIdentity({
                storyControlId: extraction.storyControlId, baseChapter: extraction.baseChapter,
                storyControlIdentity: extraction.storyControlIdentity,
                baseRevision: extraction.baseRevision, targetChapter: extraction.targetChapter,
                baseCanonIdentity: extraction.baseCanonIdentity,
                validationArtifactIdentity: extraction.validationArtifactIdentity, result: extraction.result,
            }) !== extraction.artifactIdentity) {
            throw new ProductionRuntimeError('STALE_STAGE_ARTIFACT', 'canon-review', plan.targetChapter);
        }
        assertCursor(request.control, state, extraction, 'canon-review');
        const proposal = prepareCanonCommit({
            approved: validation.result, extraction: extraction.result, state, control: request.control,
            maxTotalChanges: runtimePolicy.maxCanonReviewChanges,
        });
        if (proposal.status === 'blocked') {
            throw new ProductionRuntimeError('CANON_REVIEW_BLOCKED', 'canon-review', plan.targetChapter, undefined, issueCodes(proposal.issues));
        }
        return proposal;
    };

    const runChapterToCanonReview = async (request: ProductionStageRequest): Promise<ProductionChapterRunResult> => {
        const calls: ProductionModelCallTelemetry[] = [];
        let stage: ProductionRuntimeError['stage'] = 'planning';
        const telemetry = (repairAttemptCount = 0): ProductionRunTelemetry => ({ modelCalls: structuredClone(calls), repairAttemptCount });
        try {
            const plan = await planProductionChapter(request, calls);
            stage = 'writing';
            const draft = await writeProductionChapter({ ...request, plan }, calls);
            stage = 'validation';
            const validation = await validateProductionChapter({ ...request, plan, draft }, calls);
            if (validation.result.status === 'rejected') {
                const codes = issueCodes(validation.result.report.issues);
                if (codes.some(code => code === 'VALIDATOR_PROTOCOL_FAILURE' || code === 'REPAIR_PROTOCOL_FAILURE' || code === 'VALIDATOR_CONTEXT_CAPACITY_EXCEEDED')) {
                    return {
                        status: 'blocked', stage: 'validation', code: 'VALIDATOR_INFRASTRUCTURE_FAILURE',
                        chapter: plan.targetChapter, issueCodes: codes,
                        telemetry: telemetry(validation.result.repairAttempts),
                    };
                }
                return { status: 'rejected', stage: 'validation', plan, draft, validation, telemetry: telemetry(validation.result.repairAttempts) };
            }
            stage = 'extraction';
            const extraction = await extractProductionChapter({ ...request, plan, draft, validation }, calls);
            stage = 'canon-review';
            const proposal = prepareProductionCanonReview({ ...request, plan, draft, validation, extraction });
            const approved = validation as ProductionValidationArtifact & { readonly result: Extract<typeof validation.result, { readonly status: 'approved-not-canon' }> };
            return {
                status: 'ready-for-canon-review', plan, draft, approved, extraction, proposal,
                telemetry: telemetry(validation.result.repairAttempts),
            };
        } catch (error) {
            if (error instanceof ProductionRuntimeError) {
                return {
                    status: 'blocked', stage: error.stage, code: error.code, chapter: error.chapter,
                    ...(error.role === undefined ? {} : { role: error.role }),
                    ...(error.issueCodes === undefined ? {} : { issueCodes: error.issueCodes }),
                    ...(error.issueCount === undefined ? {} : { issueCount: error.issueCount }),
                    ...(error.issuePaths === undefined ? {} : { issuePaths: error.issuePaths }),
                    ...(error.modelAttempts === undefined ? {} : { modelAttempts: error.modelAttempts }),
                    telemetry: telemetry(),
                };
            }
            return { status: 'blocked', stage, code: isCancelled(error) ? 'CANCELLED' : 'MODEL_RUNTIME_FAILURE', chapter: request.targetChapter ?? 0, telemetry: telemetry() };
        }
    };

    return {
        runtimePolicy,
        planProductionChapter,
        writeProductionChapter,
        validateProductionChapter,
        extractProductionChapter,
        prepareProductionCanonReview,
        runChapterToCanonReview,
    };
};
