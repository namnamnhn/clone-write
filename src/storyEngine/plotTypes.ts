import type { ChapterNumber, StoryId } from './types';
import type { FactProvenance } from './storyStateTypes';

export interface RevealOccurrenceRecord {
    readonly id: StoryId;
    readonly revealId: StoryId;
    readonly chapterNumber: ChapterNumber;
    readonly provenance: FactProvenance;
}

export interface ForeshadowThreadRecord {
    readonly id: StoryId;
    readonly writerLabel: string;
    readonly openedChapter: ChapterNumber;
    readonly linkedRevealId?: StoryId;
    readonly linkedPayoffId?: StoryId;
    readonly provenance: FactProvenance;
}

export const FORESHADOW_CUE_TYPES = ['seed', 'reinforcement'] as const;
export type ForeshadowCueType = typeof FORESHADOW_CUE_TYPES[number];

export interface ForeshadowCueRecord {
    readonly id: StoryId;
    readonly threadId: StoryId;
    readonly chapterNumber: ChapterNumber;
    readonly cueType: ForeshadowCueType;
    /** Deliberately writer-safe narrative cue; never author truth. */
    readonly writerText: string;
    readonly provenance: FactProvenance;
}

export interface ForeshadowLifecycleRecord {
    readonly id: StoryId;
    readonly threadId: StoryId;
    readonly chapterNumber: ChapterNumber;
    readonly status: 'paid' | 'superseded';
    readonly provenance: FactProvenance;
}

export interface PayoffObligationRecord {
    readonly id: StoryId;
    readonly writerLabel: string;
    readonly openedChapter: ChapterNumber;
    readonly earliestPayoffChapter?: ChapterNumber;
    readonly targetPayoffChapter?: ChapterNumber;
    readonly latestPayoffChapter?: ChapterNumber;
    readonly linkedForeshadowThreadId?: StoryId;
    readonly linkedRevealId?: StoryId;
    /** When true, resolving requires the linked reveal occurrence in the same delta. */
    readonly revealIsPayoff?: true;
    /** When true, at least one seed cue must exist no later than resolution. */
    readonly requiresForeshadowSeed?: true;
    readonly provenance: FactProvenance;
}

export interface PayoffLifecycleRecord {
    readonly id: StoryId;
    readonly payoffId: StoryId;
    readonly chapterNumber: ChapterNumber;
    readonly status: 'paid' | 'superseded';
    readonly provenance: FactProvenance;
}

export interface PlotLedgers {
    readonly revealOccurrences: readonly RevealOccurrenceRecord[];
    readonly foreshadowThreads: readonly ForeshadowThreadRecord[];
    readonly foreshadowCues: readonly ForeshadowCueRecord[];
    readonly foreshadowLifecycle: readonly ForeshadowLifecycleRecord[];
    readonly payoffObligations: readonly PayoffObligationRecord[];
    readonly payoffLifecycle: readonly PayoffLifecycleRecord[];
}

export interface RevealChange { readonly operation: 'record'; readonly occurrence: RevealOccurrenceRecord; }
export type ForeshadowChange =
    | { readonly operation: 'open'; readonly thread: ForeshadowThreadRecord }
    | { readonly operation: 'add-cue'; readonly cue: ForeshadowCueRecord }
    | { readonly operation: 'pay' | 'supersede'; readonly lifecycle: ForeshadowLifecycleRecord };
export type PayoffChange =
    | { readonly operation: 'open'; readonly obligation: PayoffObligationRecord }
    | { readonly operation: 'resolve' | 'supersede'; readonly lifecycle: PayoffLifecycleRecord };

export interface PlotDeltaOperations {
    readonly revealChanges: readonly RevealChange[];
    readonly foreshadowChanges: readonly ForeshadowChange[];
    readonly payoffChanges: readonly PayoffChange[];
}

export type AuthorSecretStatus = 'author-only' | 'locked' | 'eligible-not-revealed' | 'revealed';
export type ForeshadowThreadStatus = 'open' | 'paid' | 'superseded';
export type PayoffStatus = 'not-due' | 'due' | 'overdue' | 'paid' | 'paid-late' | 'superseded';
