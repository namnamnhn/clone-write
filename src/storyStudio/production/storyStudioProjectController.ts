import {
    createMakeCanonConfirmation,
    makeCanon,
    recordCanonicalChapterMemory,
} from '../../storyEngine';
import type {
    MakeCanonConfirmation,
    ProductionDraftArtifact,
    ProductionExtractionArtifact,
    ProductionPlanArtifact,
    ProductionValidationArtifact,
    createProductionStoryRuntime,
} from '../../storyEngine';
import { StoryStudioProjectRepository } from './storyStudioProjectPersistence';
import {
    StoryStudioProjectError,
} from './storyStudioProjectTypes';
import type {
    CanonicalChapterMetadata,
    StoryStudioProjectLoadResult,
    StoryStudioRuntimeProject,
} from './storyStudioProjectTypes';
import {
    createCanonicalChapterMetadataIdentity,
    createStoryStudioProject,
    rebuildRuntimeProject,
} from './storyStudioProjectRuntime';
import {
    IDLE_STORY_STUDIO_WORKFLOW,
    isStoryStudioBatchSize,
} from './storyStudioWorkflowTypes';
import type { PersistedStoryStudioWorkflow, StoryStudioBatchSize } from './storyStudioWorkflowTypes';

export type StoryStudioProductionRuntime = ReturnType<typeof createProductionStoryRuntime>;

export interface StoryStudioStageResult {
    readonly project: StoryStudioRuntimeProject;
    readonly modelStage?: 'planning' | 'writing' | 'validation' | 'extraction';
    readonly reachedHumanReview: boolean;
    readonly rejected: boolean;
}

export interface StoryStudioCanonCommitResult {
    readonly project: StoryStudioRuntimeProject;
    readonly shouldContinueBatch: boolean;
}

export class StoryStudioProjectController {
    private durableProject?: StoryStudioRuntimeProject;
    private slotOccupied = false;
    private transitionActive = false;
    private stageRunActive = false;

    constructor(
        private readonly repository = new StoryStudioProjectRepository(),
        private readonly now: () => string = () => new Date().toISOString(),
    ) {}

    get currentProject(): StoryStudioRuntimeProject | undefined {
        return this.durableProject;
    }

    get isTransitionActive(): boolean {
        return this.transitionActive || this.stageRunActive;
    }

    async load(): Promise<StoryStudioProjectLoadResult> {
        const result = await this.repository.load();
        this.slotOccupied = result.status !== 'empty';
        this.durableProject = result.status === 'loaded' || result.status === 'workflow-recovered'
            ? result.project : undefined;
        return result;
    }

    async createProject(setupDocument: unknown, displayName: string, confirmReplacement = false): Promise<StoryStudioRuntimeProject> {
        if (this.slotOccupied && !confirmReplacement) {
            throw new StoryStudioProjectError('PROJECT_REPLACEMENT_CONFIRMATION_REQUIRED');
        }
        const next = createStoryStudioProject(setupDocument, displayName, this.now());
        await this.persistAndPublish(next);
        this.slotOccupied = true;
        return next;
    }

    private requireProject(): StoryStudioRuntimeProject {
        if (!this.durableProject) throw new StoryStudioProjectError('NO_PROJECT');
        return this.durableProject;
    }

    private async persistAndPublish(next: StoryStudioRuntimeProject): Promise<void> {
        if (this.transitionActive) throw new StoryStudioProjectError('SAVE_FAILED');
        this.transitionActive = true;
        try {
            await this.repository.save(next);
            this.durableProject = next;
        } finally {
            this.transitionActive = false;
        }
    }

    private async update(updates: Parameters<typeof rebuildRuntimeProject>[1]): Promise<StoryStudioRuntimeProject> {
        const current = this.requireProject();
        const next = rebuildRuntimeProject(current, { ...updates, updatedAt: this.now() });
        await this.persistAndPublish(next);
        return next;
    }

    async startBatch(size: StoryStudioBatchSize): Promise<StoryStudioRuntimeProject> {
        const current = this.requireProject();
        if (!isStoryStudioBatchSize(size) || current.state.currentChapter >= current.control.engine.plannedChapterCount) {
            throw new StoryStudioProjectError('INVALID_PROJECT');
        }
        if (current.workflow.stage !== 'idle') throw new StoryStudioProjectError('WORKFLOW_INVALID');
        return this.update({
            batchQueue: { kind: 'story-studio-batch-queue', requestedSize: size, remaining: size, paused: false },
        });
    }

    async runNextStage(runtime: StoryStudioProductionRuntime): Promise<StoryStudioStageResult> {
        if (this.stageRunActive) throw new StoryStudioProjectError('WORKFLOW_INVALID');
        this.stageRunActive = true;
        try {
        const current = this.requireProject();
        if (current.batchQueue.paused || current.batchQueue.remaining === 0) {
            throw new StoryStudioProjectError('WORKFLOW_INVALID');
        }
        const request = { control: current.control, state: current.state, memoryState: current.memory };
        let workflow: PersistedStoryStudioWorkflow;
        let modelStage: StoryStudioStageResult['modelStage'];
        switch (current.workflow.stage) {
            case 'idle': {
                modelStage = 'planning';
                const plan: ProductionPlanArtifact = await runtime.planProductionChapter(request);
                workflow = { stage: 'planned', plan };
                break;
            }
            case 'planned': {
                modelStage = 'writing';
                const draft: ProductionDraftArtifact = await runtime.writeProductionChapter({ ...request, plan: current.workflow.plan });
                workflow = { stage: 'drafted', plan: current.workflow.plan, draft };
                break;
            }
            case 'drafted': {
                modelStage = 'validation';
                const validation: ProductionValidationArtifact = await runtime.validateProductionChapter({
                    ...request, plan: current.workflow.plan, draft: current.workflow.draft,
                });
                workflow = validation.result.status === 'rejected'
                    ? { stage: 'rejected', plan: current.workflow.plan, draft: current.workflow.draft, validation }
                    : { stage: 'validated', plan: current.workflow.plan, draft: current.workflow.draft, validation };
                break;
            }
            case 'validated': {
                modelStage = 'extraction';
                const extraction: ProductionExtractionArtifact = await runtime.extractProductionChapter({
                    ...request, plan: current.workflow.plan, draft: current.workflow.draft,
                    validation: current.workflow.validation,
                });
                workflow = { ...current.workflow, stage: 'extracted', extraction };
                break;
            }
            case 'extracted': {
                const proposal = runtime.prepareProductionCanonReview({
                    ...request, plan: current.workflow.plan, draft: current.workflow.draft,
                    validation: current.workflow.validation, extraction: current.workflow.extraction,
                });
                workflow = { ...current.workflow, stage: 'ready-for-canon-review', proposal };
                break;
            }
            case 'rejected':
            case 'ready-for-canon-review':
                return {
                    project: current, reachedHumanReview: current.workflow.stage === 'ready-for-canon-review',
                    rejected: current.workflow.stage === 'rejected',
                };
        }
        const project = await this.update({ workflow });
        return {
            project, ...(modelStage === undefined ? {} : { modelStage }),
            reachedHumanReview: workflow.stage === 'ready-for-canon-review', rejected: workflow.stage === 'rejected',
        };
        } finally {
            this.stageRunActive = false;
        }
    }

    async rewriteFromSamePlan(): Promise<StoryStudioRuntimeProject> {
        const current = this.requireProject();
        if (!['rejected', 'ready-for-canon-review', 'validated', 'extracted'].includes(current.workflow.stage)) {
            throw new StoryStudioProjectError('WORKFLOW_INVALID');
        }
        const workflow = current.workflow as Exclude<PersistedStoryStudioWorkflow, { readonly stage: 'idle' }>;
        return this.update({ workflow: { stage: 'planned', plan: workflow.plan } });
    }

    async replanCurrentChapter(): Promise<StoryStudioRuntimeProject> {
        return this.update({ workflow: IDLE_STORY_STUDIO_WORKFLOW });
    }

    async pauseBatch(): Promise<StoryStudioRuntimeProject> {
        const current = this.requireProject();
        return this.update({ batchQueue: { ...current.batchQueue, paused: true } });
    }

    async resumeBatch(): Promise<StoryStudioRuntimeProject> {
        const current = this.requireProject();
        return this.update({ batchQueue: { ...current.batchQueue, paused: false } });
    }

    createConfirmation(): MakeCanonConfirmation {
        const current = this.requireProject();
        if (current.workflow.stage !== 'ready-for-canon-review') throw new StoryStudioProjectError('WORKFLOW_INVALID');
        return createMakeCanonConfirmation(current.workflow.proposal);
    }

    async makeCanonDurably(confirmation: MakeCanonConfirmation): Promise<StoryStudioCanonCommitResult> {
        const current = this.requireProject();
        if (current.workflow.stage !== 'ready-for-canon-review') throw new StoryStudioProjectError('WORKFLOW_INVALID');
        const workflow = current.workflow;
        const approved = workflow.validation.result;
        if (approved.status !== 'approved-not-canon') throw new StoryStudioProjectError('WORKFLOW_INVALID');
        const afterState = makeCanon({
            control: current.control, state: current.state, approved,
            proposal: workflow.proposal, confirmation,
        });
        const afterMemory = recordCanonicalChapterMemory({
            control: current.control, memoryState: current.memory, beforeState: current.state,
            afterState, approved, proposal: workflow.proposal,
        });
        const record = afterMemory.records.at(-1);
        if (!record) throw new StoryStudioProjectError('INVALID_PROJECT');
        const metadataBody: Omit<CanonicalChapterMetadata, 'metadataIdentity'> = {
            kind: 'canonical-chapter-metadata', chapterNumber: record.chapterNumber,
            ...(approved.draft.title === undefined ? {} : { title: approved.draft.title }),
            canonicalizationSourceIdentity: record.canonicalizationSourceIdentity,
            proposalIdentity: record.proposalIdentity, beforeCanonIdentity: record.beforeCanonIdentity,
            afterCanonIdentity: record.afterCanonIdentity,
        };
        const metadata: CanonicalChapterMetadata = {
            ...metadataBody, metadataIdentity: createCanonicalChapterMetadataIdentity(metadataBody),
        };
        const remaining = Math.max(0, current.batchQueue.remaining - 1) as 0 | 1 | 2 | 3;
        const batchQueue = { ...current.batchQueue, remaining };
        const next = rebuildRuntimeProject(current, {
            state: afterState, memory: afterMemory, chapterMetadata: [...current.chapterMetadata, metadata],
            workflow: IDLE_STORY_STUDIO_WORKFLOW, batchQueue, updatedAt: this.now(),
        });
        // Canon, memory, metadata, workflow, and queue become visible only after this atomic snapshot saves.
        await this.persistAndPublish(next);
        return {
            project: next,
            shouldContinueBatch: remaining > 0 && !batchQueue.paused
                && afterState.currentChapter < current.control.engine.plannedChapterCount,
        };
    }

    async updateDisplayName(displayName: string): Promise<StoryStudioRuntimeProject> {
        return this.update({ displayName: displayName.trim() });
    }

    async deleteProject(): Promise<void> {
        if (this.transitionActive) throw new StoryStudioProjectError('SAVE_FAILED');
        this.transitionActive = true;
        try {
            await this.repository.delete();
            this.durableProject = undefined;
            this.slotOccupied = false;
        } finally {
            this.transitionActive = false;
        }
    }
}
