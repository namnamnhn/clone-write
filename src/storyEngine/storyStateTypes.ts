import { ChapterNumber, StoryId } from './types';
import type { PlotDeltaOperations, PlotLedgers } from './plotTypes';

export const FACT_SOURCE_TYPES = ['chapter', 'canon-rule', 'imported-setup', 'state-transition'] as const;
export type FactSourceType = typeof FACT_SOURCE_TYPES[number];

/** Machine references only. Author notes, model reasoning, and chapter prose are forbidden here. */
export interface FactProvenance {
    readonly sourceChapter: ChapterNumber;
    readonly sourceType: FactSourceType;
    readonly sourceId?: StoryId;
}

export type CanonicalFactStatus = 'active' | 'superseded' | 'invalidated';

export interface CanonicalStoryFact {
    readonly id: StoryId;
    readonly text: string;
    readonly establishedChapter: ChapterNumber;
    readonly visibility: 'writer' | 'internal';
    readonly status: CanonicalFactStatus;
    readonly provenance: FactProvenance;
}

export const KNOWLEDGE_SOURCE_TYPES = [
    'witnessed', 'told-by-character', 'document', 'inference',
    'public-information', 'prior-canon', 'imported-setup',
] as const;
export type KnowledgeSourceType = typeof KNOWLEDGE_SOURCE_TYPES[number];

export interface KnowledgeSource {
    readonly type: KnowledgeSourceType;
    readonly sourceChapter: ChapterNumber;
    readonly sourceCharacterId?: StoryId;
    readonly sourceFactId?: StoryId;
    readonly sourceReference?: string;
    readonly basisFactIds?: readonly StoryId[];
}

export interface EpistemicEntry {
    readonly id: StoryId;
    readonly characterId: StoryId;
    readonly kind: 'known' | 'believed';
    /** Required for known truth; forbidden for beliefs so false claims never become canonical facts. */
    readonly factId?: StoryId;
    /** A compact canonical claim, required only for beliefs. */
    readonly claim?: string;
    readonly learnedChapter: ChapterNumber;
    readonly source: KnowledgeSource;
    readonly status: 'active' | 'superseded' | 'retracted';
}

export interface CharacterLocationRecord {
    readonly id: StoryId;
    readonly characterId: StoryId;
    readonly location: string;
    readonly sinceChapter: ChapterNumber;
    readonly provenance: FactProvenance;
}

export interface CharacterStatusRecord {
    readonly id: StoryId;
    readonly characterId: StoryId;
    readonly kind: 'injury' | 'condition' | 'status' | 'role';
    readonly state: string;
    readonly establishedChapter: ChapterNumber;
    readonly resolvedChapter?: ChapterNumber;
    readonly provenance: FactProvenance;
}

export interface CharacterStateProjection {
    readonly characterId: StoryId;
    readonly active: boolean;
    readonly lifeStatus: 'unknown' | 'alive' | 'dead';
    readonly currentLocationRecordId?: StoryId;
    readonly activeStatusIds: readonly StoryId[];
}

/** Authoritative append-only history behind CharacterStateProjection.active/lifeStatus. */
export interface CharacterLifecycleRecord {
    readonly id: StoryId;
    readonly characterId: StoryId;
    readonly chapterNumber: ChapterNumber;
    readonly active: boolean;
    readonly lifeStatus: 'unknown' | 'alive' | 'dead';
    readonly provenance: FactProvenance;
}

export interface RelationshipHistoryRecord {
    readonly id: StoryId;
    readonly relationshipId: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly state: string;
    readonly chapterNumber: ChapterNumber;
    readonly provenance: FactProvenance;
}

export interface CanonicalRelationshipState {
    readonly id: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly currentState: string;
    readonly lastChangedChapter: ChapterNumber;
    readonly currentHistoryId: StoryId;
}

export interface ResourceLedgerRecord {
    readonly id: StoryId;
    readonly characterId: StoryId;
    readonly resourceId: StoryId;
    readonly name: string;
    readonly chapterNumber: ChapterNumber;
    readonly quantityDelta?: number;
    readonly resultingQuantity?: number;
    readonly previousState?: string;
    readonly nextState?: string;
    readonly provenance: FactProvenance;
}

export interface CanonicalResourceState {
    readonly characterId: StoryId;
    readonly resourceId: StoryId;
    readonly name: string;
    readonly quantity?: number;
    readonly state?: string;
    readonly lastChangedChapter: ChapterNumber;
    readonly currentHistoryId: StoryId;
}

export interface CanonicalContinuityEntry {
    readonly id: StoryId;
    readonly kind: 'pending-thread' | 'obligation' | 'condition' | 'clue' | 'promise';
    readonly text: string;
    readonly visibility: 'writer' | 'internal';
    readonly establishedChapter: ChapterNumber;
    readonly status: 'open' | 'resolved' | 'superseded';
    readonly resolvedChapter?: ChapterNumber;
    readonly provenance: FactProvenance;
}

export const CANONICAL_EVENT_TYPES = [
    'fact-added', 'knowledge-added', 'belief-added', 'character-moved',
    'character-state-changed', 'status-added', 'status-resolved', 'relationship-changed', 'resource-changed',
    'continuity-opened', 'continuity-resolved', 'continuity-superseded',
    'reveal-recorded', 'foreshadow-opened', 'foreshadow-cue-added',
    'foreshadow-paid', 'foreshadow-superseded', 'payoff-opened', 'payoff-resolved', 'payoff-superseded',
] as const;
export type CanonicalEventType = typeof CANONICAL_EVENT_TYPES[number];

export interface CanonicalStateEvent {
    readonly id: StoryId;
    readonly chapterNumber: ChapterNumber;
    readonly type: CanonicalEventType;
    readonly affectedIds: readonly StoryId[];
    readonly provenance: FactProvenance;
}

export interface CanonicalLedgers extends PlotLedgers {
    readonly facts: readonly CanonicalStoryFact[];
    readonly epistemic: readonly EpistemicEntry[];
    readonly locations: readonly CharacterLocationRecord[];
    readonly statuses: readonly CharacterStatusRecord[];
    readonly characterStates: readonly CharacterLifecycleRecord[];
    readonly relationships: readonly RelationshipHistoryRecord[];
    readonly resources: readonly ResourceLedgerRecord[];
    readonly continuity: readonly CanonicalContinuityEntry[];
    readonly events: readonly CanonicalStateEvent[];
}

export interface CanonicalProjections {
    readonly characters: readonly CharacterStateProjection[];
    readonly relationships: readonly CanonicalRelationshipState[];
    readonly resources: readonly CanonicalResourceState[];
}

export type FactAddition = CanonicalStoryFact;
export type EpistemicAddition = EpistemicEntry;

export type CharacterLocationChange = CharacterLocationRecord;

export interface CharacterStatusChange {
    readonly operation: 'add' | 'resolve';
    readonly record?: CharacterStatusRecord;
    readonly statusId?: StoryId;
    readonly resolvedChapter?: ChapterNumber;
    readonly provenance: FactProvenance;
}

export interface CharacterActivationChange {
    readonly characterId: StoryId;
    readonly active: boolean;
    readonly lifeStatus?: 'unknown' | 'alive' | 'dead';
    readonly provenance: FactProvenance;
}

export type RelationshipChange = RelationshipHistoryRecord;

export interface ResourceChange {
    readonly id: StoryId;
    readonly characterId: StoryId;
    readonly resourceId: StoryId;
    readonly name: string;
    readonly quantityDelta?: number;
    readonly nextState?: string;
    readonly provenance: FactProvenance;
}

export interface ContinuityChange {
    readonly operation: 'open' | 'resolve' | 'supersede';
    readonly entry?: CanonicalContinuityEntry;
    readonly continuityId?: StoryId;
    readonly chapterNumber?: ChapterNumber;
    readonly provenance: FactProvenance;
}

/** Runtime-untrusted, allow-listed input for a future extractor/review gate. It contains no prose draft. */
export interface StoryStateDelta {
    readonly kind: 'story-state-delta';
    readonly schemaVersion: 1;
    readonly chapterNumber: ChapterNumber;
    readonly expectedRevision: number;
    readonly factChanges: readonly FactAddition[];
    readonly epistemicChanges: readonly EpistemicAddition[];
    readonly locationChanges: readonly CharacterLocationChange[];
    readonly statusChanges: readonly CharacterStatusChange[];
    readonly activationChanges: readonly CharacterActivationChange[];
    readonly relationshipChanges: readonly RelationshipChange[];
    readonly resourceChanges: readonly ResourceChange[];
    readonly continuityChanges: readonly ContinuityChange[];
}

/** Explicit V2 extension. V1 remains accepted and normalizes to empty plot operations. */
export interface StoryStateDeltaV2 extends Omit<StoryStateDelta, 'schemaVersion'>, PlotDeltaOperations {
    readonly schemaVersion: 2;
}

export type NormalizedStoryStateDelta = StoryStateDeltaV2;

export const STORY_STATE_TRANSITION_ISSUE_CODES = [
    'INVALID_STATE', 'INVALID_DELTA', 'CHAPTER_SEQUENCE_VIOLATION',
    'REVISION_MISMATCH', 'UNKNOWN_CHARACTER', 'UNKNOWN_FACT',
    'DUPLICATE_ID', 'TEMPORAL_VIOLATION', 'KNOWLEDGE_SOURCE_INVALID',
    'CONFLICTING_OPERATION', 'RESOURCE_VALUE_INVALID',
    'REFERENTIAL_INTEGRITY_FAILURE',
] as const;

export type StoryStateTransitionIssueCode = typeof STORY_STATE_TRANSITION_ISSUE_CODES[number];

export class StoryStateTransitionError extends Error {
    constructor(
        readonly code: StoryStateTransitionIssueCode,
        message: string,
        readonly path = '',
    ) {
        super(message);
        this.name = 'StoryStateTransitionError';
    }
}
