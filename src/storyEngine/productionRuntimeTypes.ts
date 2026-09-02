import type { NarrativeMemorySelectionPolicy, InternalChapterPlan, PlannerContextSelectionPolicy, WriterChapterPlan, PlannerModel } from './plannerTypes';
import type { RelationshipContextSelectionPolicy } from './relationshipContext';
import type { ValidatorRelationshipView } from './relationshipTypes';
import type { RepairModel } from './repair';
import type { SemanticValidatorModel } from './semanticValidator';
import type { StateExtractionContextSelectionPolicy } from './stateExtractionContext';
import type { CanonCommitProposal, StateExtractionResult, StateExtractorModel } from './stateExtractorTypes';
import type { ValidatorStrategicView } from './strategicTypes';
import type { ValidationPipelineResult } from './validationTypes';
import type { ValidatorContextSelectionPolicy } from './validatorContext';
import type { WriterChapterDraft, WriterContextSelectionPolicy, WriterModel } from './writerTypes';

export const STORY_ENGINE_MODEL_ROLES = ['planner', 'writer', 'semanticValidator', 'repair', 'stateExtractor'] as const;
export type StoryEngineModelRole = typeof STORY_ENGINE_MODEL_ROLES[number];

export interface StoryEngineModelRoute {
    readonly preferredModelId: string;
    readonly candidateModelIds: readonly string[];
    readonly temperature: number;
}

export type StoryEngineModelRolePolicy = Readonly<Record<StoryEngineModelRole, StoryEngineModelRoute>>;

export interface StoryEngineModelBundle {
    readonly planner: PlannerModel;
    readonly writer: WriterModel;
    readonly semanticValidator: SemanticValidatorModel;
    readonly repair: RepairModel;
    readonly stateExtractor: StateExtractorModel;
}

export interface ProductionStoryRuntimePolicy {
    readonly narrativeMemorySelectionPolicy: NarrativeMemorySelectionPolicy;
    readonly plannerContextSelectionPolicy: PlannerContextSelectionPolicy;
    readonly writerContextSelectionPolicy: WriterContextSelectionPolicy;
    readonly validatorContextSelectionPolicy: ValidatorContextSelectionPolicy;
    readonly stateExtractionContextSelectionPolicy: StateExtractionContextSelectionPolicy;
    readonly relationshipContextSelectionPolicy: RelationshipContextSelectionPolicy;
    readonly maxRepairAttempts: number;
    readonly maxCanonReviewChanges: number;
    /** Optional operational policy snapshot. Core orchestration never invokes providers directly. */
    readonly modelRolePolicy?: StoryEngineModelRolePolicy;
}

export interface ProductionStageCursor {
    readonly storyControlId: string;
    readonly storyControlIdentity: string;
    readonly baseChapter: number;
    readonly baseRevision: number;
    readonly targetChapter: number;
    readonly baseCanonIdentity: string;
}

export interface ProductionPlanArtifact extends ProductionStageCursor {
    readonly kind: 'production-plan-artifact';
    readonly artifactIdentity: string;
    readonly memoryIdentity: string;
    readonly writerPlan: WriterChapterPlan;
    readonly privileged: {
        readonly internalPlan: InternalChapterPlan;
        readonly strategicView: ValidatorStrategicView;
        readonly relationshipView: ValidatorRelationshipView;
    };
}

export interface ProductionDraftArtifact extends ProductionStageCursor {
    readonly kind: 'production-draft-artifact';
    readonly artifactIdentity: string;
    readonly planArtifactIdentity: string;
    readonly draft: WriterChapterDraft;
}

export interface ProductionValidationArtifact extends ProductionStageCursor {
    readonly kind: 'production-validation-artifact';
    readonly artifactIdentity: string;
    readonly planArtifactIdentity: string;
    readonly draftArtifactIdentity: string;
    readonly result: ValidationPipelineResult;
}

export interface ProductionExtractionArtifact extends ProductionStageCursor {
    readonly kind: 'production-extraction-artifact';
    readonly artifactIdentity: string;
    readonly validationArtifactIdentity: string;
    readonly result: Extract<StateExtractionResult, { readonly status: 'extracted-not-canon' }>;
}

export interface ProductionModelCallTelemetry {
    readonly role: StoryEngineModelRole;
    readonly status: 'succeeded' | 'failed';
    readonly selectedModelId?: string;
}

export interface ProductionRunTelemetry {
    readonly modelCalls: readonly ProductionModelCallTelemetry[];
    readonly repairAttemptCount: number;
}

export const PRODUCTION_RUNTIME_ERROR_CODES = [
    'INVALID_PROJECT', 'INVALID_CURRENT_CANON', 'STORY_COMPLETE', 'STALE_STAGE_ARTIFACT',
    'MEMORY_STORY_MISMATCH', 'MEMORY_CANON_MISMATCH',
    'PLAN_PROTOCOL_FAILURE', 'PLAN_VALIDATION_FAILURE', 'WRITER_PROTOCOL_FAILURE',
    'VALIDATION_REJECTED', 'VALIDATOR_INFRASTRUCTURE_FAILURE', 'EXTRACTION_BLOCKED',
    'CANON_REVIEW_BLOCKED', 'MODEL_RUNTIME_FAILURE', 'NO_MODEL_AVAILABLE', 'CANCELLED',
] as const;
export type ProductionRuntimeErrorCode = typeof PRODUCTION_RUNTIME_ERROR_CODES[number];
export type ProductionRuntimeStage = 'planning' | 'writing' | 'validation' | 'extraction' | 'canon-review';

export class ProductionRuntimeError extends Error {
    constructor(
        readonly code: ProductionRuntimeErrorCode,
        readonly stage: ProductionRuntimeStage,
        readonly chapter: number,
        readonly role?: StoryEngineModelRole,
        readonly issueCodes?: readonly string[],
    ) {
        super(`${code} at ${stage} for chapter ${chapter}`);
        this.name = 'ProductionRuntimeError';
    }
}

export type ProductionChapterRunResult =
    | {
        readonly status: 'ready-for-canon-review';
        readonly plan: ProductionPlanArtifact;
        readonly draft: ProductionDraftArtifact;
        readonly approved: ProductionValidationArtifact & { readonly result: Extract<ValidationPipelineResult, { readonly status: 'approved-not-canon' }> };
        readonly extraction: ProductionExtractionArtifact;
        readonly proposal: CanonCommitProposal;
        readonly telemetry: ProductionRunTelemetry;
    }
    | {
        readonly status: 'rejected';
        readonly stage: 'validation';
        readonly plan: ProductionPlanArtifact;
        readonly draft: ProductionDraftArtifact;
        readonly validation: ProductionValidationArtifact;
        readonly telemetry: ProductionRunTelemetry;
    }
    | {
        readonly status: 'blocked';
        readonly stage: ProductionRuntimeStage;
        readonly code: ProductionRuntimeErrorCode;
        readonly chapter: number;
        readonly role?: StoryEngineModelRole;
        readonly issueCodes?: readonly string[];
        readonly telemetry: ProductionRunTelemetry;
    };
