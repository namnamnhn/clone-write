import type {
    FullStoryControl,
    NarrativeMemoryState,
    StoryBlueprintDocument,
    StoryState,
} from '../../storyEngine';
import type { PersistedStoryStudioWorkflow, StoryStudioBatchQueue } from './storyStudioWorkflowTypes';

export const STORY_STUDIO_STORAGE_KEY = 'story_studio_v4_current_project_v1';

export interface CanonicalChapterMetadata {
    readonly kind: 'canonical-chapter-metadata';
    readonly chapterNumber: number;
    readonly title?: string;
    readonly canonicalizationSourceIdentity: string;
    readonly proposalIdentity: string;
    readonly beforeCanonIdentity: string;
    readonly afterCanonIdentity: string;
    readonly metadataIdentity: string;
}
/** Serializable local project format. Story Engine schemaVersion remains independently fixed at 4. */
export interface StoryStudioProjectDocumentV1 {
    readonly kind: 'story-studio-project-document';
    readonly formatVersion: 1;
    readonly displayName: string;
    readonly setupDocument: StoryBlueprintDocument;
    readonly storyControlIdentity: string;
    readonly state: StoryState;
    readonly memory: NarrativeMemoryState;
    readonly chapterMetadata: readonly CanonicalChapterMetadata[];
    readonly workflow: PersistedStoryStudioWorkflow;
    readonly batchQueue: StoryStudioBatchQueue;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly coreIdentity: string;
    readonly workflowIdentity: string;
}

/** In-memory reconstruction. FullStoryControl is deliberately derived, never persisted. */
export interface StoryStudioRuntimeProject extends StoryStudioProjectDocumentV1 {
    readonly control: FullStoryControl;
}

export type StoryStudioProjectLoadResult =
    | { readonly status: 'empty' }
    | { readonly status: 'loaded'; readonly project: StoryStudioRuntimeProject }
    | {
        readonly status: 'workflow-recovered';
        readonly project: StoryStudioRuntimeProject;
        readonly warning: 'WORKFLOW_CORRUPT_OR_STALE';
    }
    | { readonly status: 'core-corrupt'; readonly error: StoryStudioProjectError };

export type StoryStudioProjectErrorCode =
    | 'LOAD_FAILED'
    | 'SAVE_FAILED'
    | 'INVALID_PROJECT'
    | 'CORE_IDENTITY_MISMATCH'
    | 'WORKFLOW_INVALID'
    | 'PROJECT_REPLACEMENT_CONFIRMATION_REQUIRED'
    | 'NO_PROJECT';

export class StoryStudioProjectError extends Error {
    constructor(readonly code: StoryStudioProjectErrorCode) {
        super(code);
        this.name = 'StoryStudioProjectError';
    }
}
