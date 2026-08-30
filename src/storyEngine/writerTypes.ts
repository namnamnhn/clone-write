import {
    CharacterResource,
    CharacterRuntimeStatus,
    ChapterNumber,
    ContinuityState,
    StoryFact,
    StoryId,
    WriterCharacterProfile,
} from './types';
import { NarrativeMemorySelectionPolicy, SelectedNarrativeMemory, WriterChapterPlan } from './plannerTypes';

/**
 * Bounded selection for non-memory Writer state. Mandatory plan-derived material is never
 * truncated: a context that cannot fit it fails closed instead of silently dropping it.
 */
export interface WriterContextSelectionPolicy {
    readonly maxCharacters: number;
    readonly maxRelationships: number;
    readonly maxFacts: number;
    readonly maxUnresolvedClues: number;
    readonly maxUnresolvedPromises: number;
    readonly maxContinuityEntries: number;
    readonly maxResourcesPerCharacter: number;
}

export const DEFAULT_WRITER_CONTEXT_SELECTION_POLICY: WriterContextSelectionPolicy = {
    maxCharacters: 24,
    maxRelationships: 32,
    maxFacts: 64,
    maxUnresolvedClues: 24,
    maxUnresolvedPromises: 24,
    maxContinuityEntries: 24,
    maxResourcesPerCharacter: 16,
};

/** The only deterministic, writer-facing state projection used by the V4 prose layer. */
export interface WriterContext {
    readonly kind: 'writer-context';
    readonly targetChapter: ChapterNumber;
    readonly currentArc: { readonly id: StoryId; readonly title: string; readonly writerBrief?: string };
    readonly currentBeat?: { readonly id: StoryId; readonly order: number; readonly writerBrief?: string };
    readonly chapterPlan: WriterChapterPlan;
    readonly characters: readonly { readonly id: StoryId; readonly name: string; readonly profile: WriterCharacterProfile }[];
    readonly characterLocations: Readonly<Record<StoryId, string>>;
    readonly characterStatuses: Readonly<Record<StoryId, CharacterRuntimeStatus>>;
    readonly writerVisibleFacts: readonly Pick<StoryFact, 'id' | 'text' | 'establishedChapter'>[];
    readonly characterKnowledge: readonly { readonly characterId: StoryId; readonly factIds: readonly StoryId[] }[];
    readonly relationships: readonly { readonly id: StoryId; readonly participantIds: readonly StoryId[]; readonly state: string }[];
    readonly resources: Readonly<Record<StoryId, readonly CharacterResource[]>>;
    readonly continuity: ContinuityState;
    readonly unresolvedClues: readonly { readonly id: StoryId; readonly text: string; readonly openedChapter: ChapterNumber }[];
    readonly unresolvedPromises: readonly { readonly id: StoryId; readonly text: string; readonly openedChapter: ChapterNumber }[];
    readonly activeCanonConstraints: readonly { readonly id: StoryId; readonly text: string; readonly scope: 'world' | 'canon' }[];
    readonly controlledReveals: readonly { readonly id: StoryId; readonly text: string }[];
    readonly controlledRelationshipEvents: readonly { readonly id: StoryId; readonly relationshipId: StoryId; readonly eventType: string; readonly participantIds: readonly StoryId[]; readonly text?: string }[];
    readonly controlledStoryEvents: readonly { readonly id: StoryId; readonly eventType: string; readonly text?: string }[];
    readonly narrativeMemory: SelectedNarrativeMemory;
}

/** A prompt-ready request; the model never receives FullStoryControl, StoryState, or planner input. */
export interface WriterModelRequest {
    readonly kind: 'writer-model-request';
    readonly context: WriterContext;
    readonly prompt: string;
}

export interface WriterModel {
    write(request: WriterModelRequest): Promise<unknown>;
}

export interface GenerateWriterDraftRequest {
    readonly control: import('./types').FullStoryControl;
    readonly state: import('./types').StoryState;
    readonly plan: WriterChapterPlan;
    readonly memoryInput?: import('./plannerTypes').NarrativeMemoryInput;
    readonly memoryPolicy?: NarrativeMemorySelectionPolicy;
    readonly contextSelectionPolicy?: WriterContextSelectionPolicy;
    readonly model: WriterModel;
}

/** A parsed candidate only. It cannot be treated as canonical story material. */
export interface WriterChapterDraft {
    readonly kind: 'writer-chapter-draft';
    readonly validationStatus: 'unvalidated';
    readonly chapterNumber: ChapterNumber;
    readonly title?: string;
    readonly prose: string;
}

export interface WriterDraftValidationIssue {
    readonly code: string;
    readonly path: string;
    readonly message: string;
}

export class WriterDraftValidationError extends Error {
    constructor(public readonly issues: readonly WriterDraftValidationIssue[]) {
        super(issues.map(entry => `${entry.code} ${entry.path}: ${entry.message}`).join('\n'));
        this.name = 'WriterDraftValidationError';
    }
}
