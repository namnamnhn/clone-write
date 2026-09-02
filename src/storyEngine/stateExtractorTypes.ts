import type { WriterChapterPlan } from './plannerTypes';
import type {
    CharacterActivationChange,
    CharacterLocationChange,
    CharacterStatusChange,
    ContinuityChange,
    EpistemicAddition,
    FactAddition,
    RelationshipChange,
    ResourceChange,
    StoryStateDeltaV2,
} from './storyStateTypes';
import type { ForeshadowChange, PayoffChange, RevealChange } from './plotTypes';
import type { FullStoryControl, StoryState } from './types';
import type { ValidatedChapterSource, ValidationPipelineResult } from './validationTypes';
import type { WriterChapterDraft } from './writerTypes';

export const STATE_EXTRACTION_ISSUE_CODES = [
    'INVALID_APPROVED_SOURCE', 'APPROVED_SOURCE_IDENTITY_MISMATCH', 'SOURCE_IDENTITY_MISMATCH',
    'SOURCE_CONTROL_MISMATCH', 'SOURCE_REVISION_MISMATCH',
    'SOURCE_CHAPTER_MISMATCH', 'EXTRACTOR_PROTOCOL_FAILURE', 'INVALID_EXTRACTOR_OUTPUT',
    'EXTRACTION_CONTEXT_CAPACITY_EXCEEDED',
    'UNSUPPORTED_DELTA_VERSION', 'DELTA_CHAPTER_MISMATCH', 'DELTA_REVISION_MISMATCH',
    'PROVENANCE_VIOLATION', 'INTERNAL_FACT_NOT_ALLOWED', 'INVALID_NEW_FACT_STATUS',
    'PLAN_RESOURCE_MISMATCH', 'RESOURCE_IDENTITY_MISMATCH', 'PLAN_RELATIONSHIP_MISMATCH',
    'PLAN_REVEAL_MISMATCH', 'PLAN_CLUE_MISMATCH', 'PLAN_CONTINUITY_MISMATCH', 'UNAUTHORIZED_CHARACTER_MUTATION',
    'INVALID_EPISTEMIC_CHANGE', 'UNREPRESENTABLE_CANON_OPERATION',
    'CANON_PREVIEW_REJECTED', 'REVIEW_CAPACITY_EXCEEDED',
] as const;

export type StateExtractionIssueCode = typeof STATE_EXTRACTION_ISSUE_CODES[number];

export interface StateExtractionIssue {
    readonly code: StateExtractionIssueCode;
    readonly path: string;
    /** Safe identifiers or deterministic diagnostics only; never privileged prose. */
    readonly detail?: string;
}

export interface StateExtractionContext {
    readonly kind: 'state-extraction-context';
    readonly targetChapter: number;
    readonly baseRevision: number;
    readonly chapterPlan: WriterChapterPlan;
    readonly participants: readonly {
        readonly id: string;
        readonly name: string;
        readonly active: boolean;
        readonly lifeStatus: 'unknown' | 'alive' | 'dead';
        readonly location?: string;
        readonly statuses: readonly { readonly id: string; readonly kind: string; readonly state: string }[];
    }[];
    readonly writerVisibleFacts: readonly { readonly id: string; readonly text: string; readonly establishedChapter: number }[];
    readonly characterKnowledge: readonly { readonly characterId: string; readonly factIds: readonly string[] }[];
    readonly relationships: readonly { readonly id: string; readonly participantIds: readonly string[]; readonly state: string }[];
    readonly resources: Readonly<Record<string, readonly { readonly id: string; readonly name: string; readonly quantity?: number; readonly state?: string }[]>>;
    readonly continuity: {
        readonly pendingThreads: readonly { readonly text: string; readonly establishedChapter: number }[];
        readonly unresolvedClues: readonly { readonly id: string; readonly text: string; readonly openedChapter: number }[];
        readonly unresolvedPromises: readonly { readonly id: string; readonly text: string; readonly openedChapter: number }[];
    };
    readonly controlledRevealIds: readonly string[];
    readonly openForeshadowThreads: readonly { readonly id: string; readonly writerLabel: string }[];
    readonly openPayoffObligations: readonly { readonly id: string; readonly writerLabel: string }[];
}

export interface StateExtractorModelRequest {
    readonly kind: 'state-extractor-model-request';
    readonly chapterNumber: number;
    readonly context: StateExtractionContext;
    readonly candidate: WriterChapterDraft;
    readonly prompt: string;
}

export interface StateExtractorModel {
    extract(request: StateExtractorModelRequest): Promise<unknown>;
}

export interface ExtractStateRequest {
    readonly approved: ValidationPipelineResult | unknown;
    readonly state: StoryState | unknown;
    readonly control: FullStoryControl;
    readonly model: StateExtractorModel;
    readonly contextSelectionPolicy?: import('./stateExtractionContext').StateExtractionContextSelectionPolicy;
}

export type StateExtractionResult =
    | { readonly status: 'extracted-not-canon'; readonly sourceIdentity: string; readonly delta: StoryStateDeltaV2 }
    | { readonly status: 'blocked'; readonly issues: readonly StateExtractionIssue[] };

export interface CanonCommitReview {
    readonly kind: 'canon-commit-review';
    readonly totalChanges: number;
    readonly facts: readonly FactAddition[];
    readonly epistemic: readonly EpistemicAddition[];
    readonly locations: readonly CharacterLocationChange[];
    readonly statuses: readonly CharacterStatusChange[];
    readonly activations: readonly CharacterActivationChange[];
    readonly relationships: readonly RelationshipChange[];
    readonly resources: readonly ResourceChange[];
    readonly continuity: readonly ContinuityChange[];
    readonly reveals: readonly RevealChange[];
    readonly foreshadow: readonly ForeshadowChange[];
    readonly payoffs: readonly PayoffChange[];
}

export interface CanonCommitProposal {
    readonly kind: 'canon-commit-proposal';
    readonly status: 'ready-for-review';
    readonly storyControlId: string;
    readonly baseChapter: number;
    readonly baseRevision: number;
    readonly targetChapter: number;
    readonly sourceIdentity: string;
    readonly proposalIdentity: string;
    readonly source: ValidatedChapterSource;
    readonly delta: StoryStateDeltaV2;
    readonly review: CanonCommitReview;
}

export interface PrepareCanonCommitRequest {
    readonly approved: ValidationPipelineResult | unknown;
    readonly extraction: StateExtractionResult | unknown;
    readonly state: StoryState | unknown;
    readonly control: FullStoryControl;
    readonly maxTotalChanges?: number;
}

export type PrepareCanonCommitResult = CanonCommitProposal
    | { readonly status: 'blocked'; readonly issues: readonly StateExtractionIssue[] };

export interface MakeCanonConfirmation {
    readonly kind: 'make-canon-confirmation';
    readonly confirmed: true;
    readonly storyControlId: string;
    readonly baseChapter: number;
    readonly baseRevision: number;
    readonly targetChapter: number;
    readonly proposalIdentity: string;
}

export const MAKE_CANON_ERROR_CODES = [
    'INVALID_CURRENT_CANON', 'INVALID_PROPOSAL', 'WRONG_STORY', 'STALE_PROPOSAL',
    'CONFIRMATION_REQUIRED', 'CONFIRMATION_MISMATCH', 'CANON_TRANSITION_REJECTED',
] as const;
export type MakeCanonErrorCode = typeof MAKE_CANON_ERROR_CODES[number];

export class MakeCanonError extends Error {
    constructor(readonly code: MakeCanonErrorCode, message: string) {
        super(message);
        this.name = 'MakeCanonError';
    }
}

export interface MakeCanonRequest {
    readonly control: FullStoryControl;
    readonly state: StoryState | unknown;
    readonly approved: ValidationPipelineResult | unknown;
    readonly proposal: CanonCommitProposal | unknown;
    readonly confirmation: MakeCanonConfirmation | unknown;
}

export type RepresentabilityClassification = 'DIRECT' | 'SEMANTIC + HUMAN REVIEW' | 'NOT REPRESENTABLE IN V2';

export const STATE_DELTA_V2_REPRESENTABILITY_MATRIX = {
    newFacts: 'SEMANTIC + HUMAN REVIEW',
    existingFactLifecycle: 'NOT REPRESENTABLE IN V2',
    epistemicChanges: 'SEMANTIC + HUMAN REVIEW',
    location: 'SEMANTIC + HUMAN REVIEW',
    status: 'SEMANTIC + HUMAN REVIEW',
    activation: 'SEMANTIC + HUMAN REVIEW',
    resources: 'DIRECT',
    relationships: 'DIRECT',
    reveals: 'DIRECT',
    clues: 'DIRECT',
    continuity: 'SEMANTIC + HUMAN REVIEW',
    foreshadow: 'SEMANTIC + HUMAN REVIEW',
    payoff: 'SEMANTIC + HUMAN REVIEW',
    genericStoryEvents: 'NOT REPRESENTABLE IN V2',
    // No current StoryState consumer requires historical occurrence IDs. Persisting them remains history/analytics debt;
    // the directive's actual state consequences can still be represented and committed through existing V2 operations.
    strategicActionOccurrence: 'NOT REPRESENTABLE IN V2',
} as const satisfies Readonly<Record<string, RepresentabilityClassification>>;
