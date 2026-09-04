import type {
    FullStoryControl,
    NarrativeMemoryState,
    StoryBlueprintDocument,
    StoryState,
} from '../../storyEngine';
import type { PersistedStoryStudioWorkflow, StoryStudioBatchQueue } from './storyStudioWorkflowTypes';

export const STORY_STUDIO_STORAGE_KEY = 'story_studio_v4_current_project_v1';
export const STORY_STUDIO_PROJECT_LIBRARY_KEY = 'story_studio_v4_project_library_v1';
export const STORY_STUDIO_PROJECT_KEY_PREFIX = 'story_studio_v4_project_v1:';

declare const storyStudioProjectIdBrand: unique symbol;
export type StoryStudioProjectId = string & { readonly [storyStudioProjectIdBrand]: true };

export interface StoryStudioProjectLibraryEntry {
    readonly projectId: StoryStudioProjectId;
    readonly displayName: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly currentChapter: number;
    readonly plannedChapterCount: number;
    readonly workflowStage: PersistedStoryStudioWorkflow['stage'];
}

export interface StoryStudioProjectLibraryIndexV1 {
    readonly kind: 'story-studio-project-library-index';
    readonly formatVersion: 1;
    readonly activeProjectId?: StoryStudioProjectId;
    readonly entries: readonly StoryStudioProjectLibraryEntry[];
    readonly updatedAt: string;
}

export interface StoryStudioProjectLibraryViewEntry extends StoryStudioProjectLibraryEntry {
    readonly availability: 'available' | 'missing' | 'corrupt';
}

export interface StoryStudioProjectLibrarySnapshot {
    readonly index: StoryStudioProjectLibraryIndexV1;
    readonly entries: readonly StoryStudioProjectLibraryViewEntry[];
}

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
    | { readonly status: 'empty'; readonly library: StoryStudioProjectLibrarySnapshot }
    | {
        readonly status: 'loaded';
        readonly projectId: StoryStudioProjectId;
        readonly project: StoryStudioRuntimeProject;
        readonly library: StoryStudioProjectLibrarySnapshot;
    }
    | {
        readonly status: 'workflow-recovered';
        readonly projectId: StoryStudioProjectId;
        readonly project: StoryStudioRuntimeProject;
        readonly warning: 'WORKFLOW_CORRUPT_OR_STALE';
        readonly library: StoryStudioProjectLibrarySnapshot;
    }
    | {
        readonly status: 'core-corrupt';
        readonly error: StoryStudioProjectError;
        readonly library?: StoryStudioProjectLibrarySnapshot;
    };

export type StoryStudioProjectErrorCode =
    | 'LOAD_FAILED'
    | 'SAVE_FAILED'
    | 'INVALID_PROJECT'
    | 'CORE_IDENTITY_MISMATCH'
    | 'WORKFLOW_INVALID'
    | 'PROJECT_REPLACEMENT_CONFIRMATION_REQUIRED'
    | 'NO_PROJECT'
    | 'INVALID_LIBRARY'
    | 'MIGRATION_FAILED'
    | 'LEGACY_CLEANUP_FAILED'
    | 'PROJECT_NOT_FOUND'
    | 'PROJECT_UNAVAILABLE'
    | 'PROJECT_OPERATION_BLOCKED';

export class StoryStudioProjectError extends Error {
    constructor(readonly code: StoryStudioProjectErrorCode) {
        super(code);
        this.name = 'StoryStudioProjectError';
    }
}
