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
    StoryStudioProjectId,
    StoryStudioProjectLibrarySnapshot,
    StoryStudioProjectLibraryViewEntry,
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
import {
    createStoryStudioContinuationBackup,
    parseStoryStudioContinuationBackup,
    StoryStudioContinuationBackupError,
} from './storyStudioContinuationBackup';
import type {
    ParsedStoryStudioContinuationBackup,
    StoryStudioContinuationBackupV1,
} from './storyStudioContinuationBackup';
import { createStoryStudioEpubPublication } from './storyStudioEpubPublication';
import type { StoryStudioEpubPublicationSnapshot } from './storyStudioEpubPublication';

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

export interface StoryStudioProjectSwitchResult {
    readonly project: StoryStudioRuntimeProject;
    readonly workflowRecovered: boolean;
}

export class StoryStudioProjectController {
    private durableProject?: StoryStudioRuntimeProject;
    private durableProjectId?: StoryStudioProjectId;
    private librarySnapshot?: StoryStudioProjectLibrarySnapshot;
    private workflowRecovered = false;
    private transitionActive = false;
    private stageRunActive = false;

    constructor(
        private readonly repository = new StoryStudioProjectRepository(),
        private readonly now: () => string = () => new Date().toISOString(),
    ) {}

    get currentProject(): StoryStudioRuntimeProject | undefined {
        return this.durableProject;
    }

    get activeProjectId(): StoryStudioProjectId | undefined {
        return this.durableProjectId;
    }

    get projectLibrary(): readonly StoryStudioProjectLibraryViewEntry[] {
        return this.librarySnapshot?.entries ?? [];
    }

    get isTransitionActive(): boolean {
        return this.transitionActive || this.stageRunActive;
    }

    async load(): Promise<StoryStudioProjectLoadResult> {
        const result = await this.repository.load();
        this.librarySnapshot = result.library;
        this.durableProject = result.status === 'loaded' || result.status === 'workflow-recovered'
            ? result.project : undefined;
        this.durableProjectId = result.status === 'loaded' || result.status === 'workflow-recovered'
            ? result.projectId : result.library?.index.activeProjectId;
        this.workflowRecovered = result.status === 'workflow-recovered';
        return result;
    }

    private requireLibraryOperationAllowed(): void {
        if (this.isTransitionActive) throw new StoryStudioProjectError('PROJECT_OPERATION_BLOCKED');
    }

    async createProject(setupDocument: unknown, displayName: string, confirmReplacement = false): Promise<StoryStudioRuntimeProject> {
        void confirmReplacement; // Retained only for source compatibility; creation never replaces another project.
        this.requireLibraryOperationAllowed();
        const next = createStoryStudioProject(setupDocument, displayName, this.now());
        this.transitionActive = true;
        try {
            const result = await this.repository.createProject(next);
            this.durableProject = result.project;
            this.durableProjectId = result.projectId;
            this.librarySnapshot = result.library;
            this.workflowRecovered = false;
        } finally {
            this.transitionActive = false;
        }
        return next;
    }

    createContinuationBackup(): StoryStudioContinuationBackupV1 {
        this.requireLibraryOperationAllowed();
        if (this.workflowRecovered) {
            throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_WORKFLOW_NOT_EXACT');
        }
        const project = this.requireProject();
        const catalogDisplayName = this.librarySnapshot?.entries
            .find(entry => entry.projectId === this.durableProjectId)?.displayName ?? project.displayName;
        return createStoryStudioContinuationBackup(project, catalogDisplayName, this.now());
    }

    createCanonEpubPublication(): StoryStudioEpubPublicationSnapshot {
        this.requireLibraryOperationAllowed();
        const project = this.requireProject();
        const catalogDisplayName = this.librarySnapshot?.entries
            .find(entry => entry.projectId === this.durableProjectId)?.displayName ?? project.displayName;
        return createStoryStudioEpubPublication(project, catalogDisplayName);
    }

    async restoreContinuationBackup(
        prepared: ParsedStoryStudioContinuationBackup,
    ): Promise<StoryStudioRuntimeProject> {
        this.requireLibraryOperationAllowed();
        // Re-validate at the controller trust boundary; callers cannot forge a parsed wrapper.
        const validated = parseStoryStudioContinuationBackup(prepared.backup);
        this.transitionActive = true;
        try {
            const result = await this.repository.restoreContinuationProject(
                validated.project,
                validated.backup.catalogDisplayName,
            );
            this.durableProject = result.project;
            this.durableProjectId = result.projectId;
            this.librarySnapshot = result.library;
            this.workflowRecovered = false;
            return result.project;
        } finally {
            this.transitionActive = false;
        }
    }

    private requireProject(): StoryStudioRuntimeProject {
        if (!this.durableProject) throw new StoryStudioProjectError('NO_PROJECT');
        return this.durableProject;
    }

    private async persistAndPublish(next: StoryStudioRuntimeProject): Promise<void> {
        if (this.transitionActive) throw new StoryStudioProjectError('SAVE_FAILED');
        const projectId = this.durableProjectId;
        if (!projectId) throw new StoryStudioProjectError('NO_PROJECT');
        this.transitionActive = true;
        try {
            const result = await this.repository.saveProject(projectId, next);
            this.durableProject = result.project;
            this.librarySnapshot = result.library;
            this.workflowRecovered = false;
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
        const storyComplete = afterState.currentChapter >= current.control.engine.plannedChapterCount;
        const remaining = (storyComplete ? 0 : Math.max(0, current.batchQueue.remaining - 1)) as 0 | 1 | 2 | 3;
        const batchQueue = { ...current.batchQueue, remaining };
        const next = rebuildRuntimeProject(current, {
            state: afterState, memory: afterMemory, chapterMetadata: [...current.chapterMetadata, metadata],
            workflow: IDLE_STORY_STUDIO_WORKFLOW, batchQueue, updatedAt: this.now(),
        });
        // Canon, memory, metadata, workflow, and queue become visible only after this atomic snapshot saves.
        await this.persistAndPublish(next);
        return {
            project: next,
            shouldContinueBatch: !storyComplete && remaining > 0 && !batchQueue.paused,
        };
    }

    async updateDisplayName(displayName: string): Promise<StoryStudioRuntimeProject> {
        this.requireLibraryOperationAllowed();
        const projectId = this.durableProjectId;
        if (!projectId) throw new StoryStudioProjectError('NO_PROJECT');
        this.transitionActive = true;
        try {
            const result = await this.repository.renameProject(projectId, this.requireProject(), displayName.trim(), this.now());
            this.durableProject = result.project;
            this.librarySnapshot = result.library;
            return result.project;
        } finally {
            this.transitionActive = false;
        }
    }

    async switchProject(projectId: StoryStudioProjectId | string): Promise<StoryStudioProjectSwitchResult> {
        this.requireLibraryOperationAllowed();
        this.transitionActive = true;
        try {
            const result = await this.repository.switchActiveProject(projectId);
            this.durableProject = result.project;
            this.durableProjectId = result.projectId;
            this.librarySnapshot = result.library;
            this.workflowRecovered = result.workflowRecovered;
            return { project: result.project, workflowRecovered: result.workflowRecovered };
        } finally {
            this.transitionActive = false;
        }
    }

    async deleteProject(projectId: StoryStudioProjectId | string | undefined = this.durableProjectId): Promise<StoryStudioProjectLoadResult> {
        this.requireLibraryOperationAllowed();
        if (!projectId) throw new StoryStudioProjectError('NO_PROJECT');
        this.transitionActive = true;
        try {
            const result = await this.repository.deleteProject(projectId);
            this.librarySnapshot = result.library;
            this.durableProject = result.status === 'loaded' || result.status === 'workflow-recovered'
                ? result.project : undefined;
            this.durableProjectId = result.status === 'loaded' || result.status === 'workflow-recovered'
                ? result.projectId : undefined;
            this.workflowRecovered = result.status === 'workflow-recovered';
            return result;
        } finally {
            this.transitionActive = false;
        }
    }

    async deleteCorruptLegacyProject(): Promise<StoryStudioProjectLoadResult> {
        this.requireLibraryOperationAllowed();
        this.transitionActive = true;
        try {
            const result = await this.repository.deleteCorruptLegacyProject();
            this.librarySnapshot = result.library;
            this.durableProject = undefined;
            this.durableProjectId = undefined;
            this.workflowRecovered = false;
            return result;
        } finally {
            this.transitionActive = false;
        }
    }
}
