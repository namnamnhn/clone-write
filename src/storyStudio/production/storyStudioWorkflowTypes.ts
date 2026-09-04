import type {
    CanonCommitProposal,
    ProductionDraftArtifact,
    ProductionExtractionArtifact,
    ProductionPlanArtifact,
    ProductionValidationArtifact,
} from '../../storyEngine';

export type StoryStudioBatchSize = 1 | 2 | 3;
export type StoryStudioBatchRemaining = 0 | 1 | 2 | 3;

export interface StoryStudioBatchQueue {
    readonly kind: 'story-studio-batch-queue';
    readonly requestedSize: StoryStudioBatchSize;
    readonly remaining: StoryStudioBatchRemaining;
    readonly paused: boolean;
}

export const DEFAULT_STORY_STUDIO_BATCH_QUEUE: StoryStudioBatchQueue = {
    kind: 'story-studio-batch-queue',
    requestedSize: 2,
    remaining: 0,
    paused: false,
};

export type PersistedStoryStudioWorkflow =
    | { readonly stage: 'idle' }
    | { readonly stage: 'planned'; readonly plan: ProductionPlanArtifact }
    | { readonly stage: 'drafted'; readonly plan: ProductionPlanArtifact; readonly draft: ProductionDraftArtifact }
    | {
        readonly stage: 'validated';
        readonly plan: ProductionPlanArtifact;
        readonly draft: ProductionDraftArtifact;
        readonly validation: ProductionValidationArtifact;
    }
    | {
        readonly stage: 'rejected';
        readonly plan: ProductionPlanArtifact;
        readonly draft: ProductionDraftArtifact;
        readonly validation: ProductionValidationArtifact;
    }
    | {
        readonly stage: 'extracted';
        readonly plan: ProductionPlanArtifact;
        readonly draft: ProductionDraftArtifact;
        readonly validation: ProductionValidationArtifact;
        readonly extraction: ProductionExtractionArtifact;
    }
    | {
        readonly stage: 'ready-for-canon-review';
        readonly plan: ProductionPlanArtifact;
        readonly draft: ProductionDraftArtifact;
        readonly validation: ProductionValidationArtifact;
        readonly extraction: ProductionExtractionArtifact;
        readonly proposal: CanonCommitProposal;
    };

export const IDLE_STORY_STUDIO_WORKFLOW: PersistedStoryStudioWorkflow = { stage: 'idle' };

export const isStoryStudioBatchSize = (value: unknown): value is StoryStudioBatchSize =>
    value === 1 || value === 2 || value === 3;
