import type { CanonicalLedgers, CanonicalProjections, FactProvenance } from './storyStateTypes';

export type StoryId = string;
export type ChapterNumber = number;
/** Canonical snapshot cursor; zero alone means no chapter has been applied yet. */
export type CanonicalChapterCursor = 0 | ChapterNumber;

export interface EngineSettings {
    readonly schemaVersion: 4;
    readonly plannedChapterCount: number;
    readonly failClosed: true;
    readonly unknownCharacterPolicy: 'deny';
    readonly missingGatePolicy: 'deny';
    /** Beats are optional only for arcs that define no beats at all. */
    readonly beatPolicy: 'required-for-arcs-with-beats';
}

export interface WriterCharacterProfile {
    readonly role?: string;
    readonly appearance?: string;
    readonly personality?: string;
    readonly publicFacts?: readonly string[];
}

export interface ControlledCharacter {
    readonly id: StoryId;
    readonly name: string;
    readonly initialStatus: 'active' | 'future-locked';
    /** First chapter in which this character may be used directly. */
    readonly availableFromChapter: ChapterNumber;
    readonly writerProfile: WriterCharacterProfile;
    /** Compiler/internal systems only. Never copied into WriterSafeContext. */
    readonly authorNotes?: string;
}

export interface StoryArc {
    readonly id: StoryId;
    readonly title: string;
    readonly startChapter: ChapterNumber;
    readonly endChapter: ChapterNumber;
    readonly writerBrief?: string;
    /** Long-range truth/planning. Never copied into WriterSafeContext. */
    readonly authorPlan?: string;
}

export interface StoryBeat {
    readonly id: StoryId;
    readonly arcId: StoryId;
    readonly order: number;
    readonly startChapter: ChapterNumber;
    readonly endChapter: ChapterNumber;
    readonly writerBrief?: string;
    readonly authorPlan?: string;
}

export interface CharacterGate {
    readonly id: StoryId;
    readonly characterId: StoryId;
    readonly allowedFromChapter: ChapterNumber;
}

export interface PovGate {
    readonly id: StoryId;
    readonly characterId: StoryId;
    readonly allowedFromChapter: ChapterNumber;
}

export interface RevealDefinition {
    readonly id: StoryId;
    /** Only this deliberately writer-facing text can cross the safe-context boundary. */
    readonly writerText: string;
    readonly authorNotes?: string;
}

export interface RevealGate {
    readonly id: StoryId;
    readonly revealId: StoryId;
    readonly allowedFromChapter: ChapterNumber;
}

export interface RelationshipEventDefinition {
    readonly id: StoryId;
    readonly relationshipId: StoryId;
    readonly eventType: string;
    readonly participantIds: readonly StoryId[];
    readonly writerText?: string;
    readonly authorNotes?: string;
}

export interface RelationshipGate {
    readonly id: StoryId;
    readonly eventId: StoryId;
    readonly allowedFromChapter: ChapterNumber;
}

/** A hard story event independent from relationships (war, coup, coronation, etc.). */
export interface StoryEventDefinition {
    readonly id: StoryId;
    readonly eventType: string;
    readonly writerText?: string;
    readonly authorNotes?: string;
}

export interface StoryEventGate {
    readonly id: StoryId;
    readonly eventId: StoryId;
    readonly allowedFromChapter: ChapterNumber;
}

export interface ForbiddenEvent {
    readonly id: StoryId;
    readonly eventId: StoryId;
    readonly forbiddenThroughChapter: ChapterNumber;
    readonly authorReason?: string;
}

/** Relationship restrictions stay in their own control plane. */
export interface ForbiddenRelationshipEvent {
    readonly id: StoryId;
    readonly eventId: StoryId;
    readonly forbiddenThroughChapter: ChapterNumber;
    readonly authorReason?: string;
}

export interface ForbiddenReveal {
    readonly id: StoryId;
    readonly revealId: StoryId;
    readonly forbiddenThroughChapter: ChapterNumber;
    readonly authorReason?: string;
}

export interface AuthorOnlySecret {
    readonly id: StoryId;
    /** Raw author truth. This property has no counterpart in WriterSafeContext. */
    readonly value: string;
    /** Optional controlled transition from secret to a writer-facing reveal. */
    readonly revealId?: StoryId;
    readonly notes?: string;
}

export interface CanonRule {
    readonly id: StoryId;
    readonly text: string;
    readonly availableFromChapter: ChapterNumber;
    readonly expiresAfterChapter?: ChapterNumber;
    readonly scope: 'world' | 'canon';
    readonly authorNotes?: string;
}

export interface StoryGates {
    readonly characters: readonly CharacterGate[];
    readonly pov: readonly PovGate[];
    readonly reveals: readonly RevealGate[];
    readonly relationships: readonly RelationshipGate[];
    readonly events: readonly StoryEventGate[];
}

/** Complete control plane. It is intentionally unsafe to give to a Writer model. */
export interface FullStoryControl {
    readonly kind: 'full-story-control';
    readonly id: StoryId;
    readonly engine: EngineSettings;
    readonly characters: Readonly<Record<StoryId, ControlledCharacter>>;
    readonly characterOrder: readonly StoryId[];
    readonly arcs: readonly StoryArc[];
    readonly beats: readonly StoryBeat[];
    readonly reveals: readonly RevealDefinition[];
    readonly relationshipEvents: readonly RelationshipEventDefinition[];
    readonly storyEvents: readonly StoryEventDefinition[];
    readonly gates: StoryGates;
    readonly forbiddenEvents: readonly ForbiddenEvent[];
    readonly forbiddenRelationshipEvents: readonly ForbiddenRelationshipEvent[];
    readonly forbiddenReveals: readonly ForbiddenReveal[];
    readonly authorOnlySecrets: readonly AuthorOnlySecret[];
    readonly canonRules: readonly CanonRule[];
}

export interface CharacterRuntimeStatus {
    readonly status?: string;
    readonly injuries: readonly string[];
    readonly conditions: readonly string[];
}

export interface StoryFact {
    readonly id: StoryId;
    readonly text: string;
    readonly establishedChapter: ChapterNumber;
    readonly visibility: 'writer' | 'internal';
    /** Present for canonical V4 facts; optional only on the legacy context projection. */
    readonly status?: 'active' | 'superseded' | 'invalidated';
    readonly provenance?: FactProvenance;
}

export interface CharacterKnowledge {
    readonly characterId: StoryId;
    readonly factIds: readonly StoryId[];
}

export interface RuntimeRelationship {
    readonly id: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly state: string;
    readonly establishedChapter: ChapterNumber;
}

export interface OpenThread {
    readonly id: StoryId;
    readonly text: string;
    readonly openedChapter: ChapterNumber;
    readonly visibility: 'writer' | 'internal';
}

export interface CharacterResource {
    readonly id: StoryId;
    readonly name: string;
    readonly quantity?: number;
    readonly state?: string;
}

export interface ContinuityEntry {
    readonly text: string;
    readonly visibility: 'writer' | 'internal';
    readonly establishedChapter: ChapterNumber;
}

export interface ContinuityState {
    readonly timelinePosition?: string;
    readonly lastScene?: string;
    readonly povCharacterId?: StoryId;
    readonly pendingThreads: readonly ContinuityEntry[];
    readonly notes: readonly ContinuityEntry[];
}

export interface StoryState {
    readonly kind: 'story-state';
    readonly schemaVersion: 4;
    /** Increments exactly once per successful sequential transition. */
    readonly revision: number;
    /** Latest canonical chapter whose consequences are reflected by this snapshot. */
    readonly currentChapter: CanonicalChapterCursor;
    readonly currentArcId?: StoryId;
    readonly currentBeatId?: StoryId;
    readonly knownCharacterIds: readonly StoryId[];
    readonly activeCharacterIds: readonly StoryId[];
    readonly characterLocations: Readonly<Record<StoryId, string>>;
    readonly characterStatuses: Readonly<Record<StoryId, CharacterRuntimeStatus>>;
    readonly facts: readonly StoryFact[];
    readonly characterKnowledge: readonly CharacterKnowledge[];
    readonly relationships: readonly RuntimeRelationship[];
    readonly unresolvedClues: readonly OpenThread[];
    readonly unresolvedPromises: readonly OpenThread[];
    readonly resources: Readonly<Record<StoryId, readonly CharacterResource[]>>;
    readonly continuity: ContinuityState;
    /** Authoritative append-only canonical history. Compatibility fields above are bounded projections. */
    readonly ledgers: CanonicalLedgers;
    readonly projections: CanonicalProjections;
    /** Extension storage for internal systems. It is never copied to WriterSafeContext. */
    readonly extensions: Readonly<Record<string, unknown>>;
}

export interface WriterSafeCharacter {
    readonly id: StoryId;
    readonly name: string;
    readonly profile: WriterCharacterProfile;
}

export interface WriterSafeArc {
    readonly id: StoryId;
    readonly title: string;
    readonly writerBrief?: string;
}

export interface WriterSafeBeat {
    readonly id: StoryId;
    readonly order: number;
    readonly writerBrief?: string;
}

export interface WriterSafeReveal {
    readonly id: StoryId;
    readonly text: string;
}

export interface WriterSafeRelationshipEvent {
    readonly id: StoryId;
    readonly relationshipId: StoryId;
    readonly eventType: string;
    readonly participantIds: readonly StoryId[];
    readonly writerText?: string;
}

export interface WriterSafeState {
    readonly currentChapter: ChapterNumber;
    readonly knownCharacterIds: readonly StoryId[];
    readonly activeCharacterIds: readonly StoryId[];
    readonly characterLocations: Readonly<Record<StoryId, string>>;
    readonly characterStatuses: Readonly<Record<StoryId, CharacterRuntimeStatus>>;
    readonly facts: readonly StoryFact[];
    readonly characterKnowledge: readonly CharacterKnowledge[];
    readonly relationships: readonly RuntimeRelationship[];
    readonly unresolvedClues: readonly OpenThread[];
    readonly unresolvedPromises: readonly OpenThread[];
    readonly resources: Readonly<Record<StoryId, readonly CharacterResource[]>>;
    readonly continuity: ContinuityState;
}

/** Explicit allow-list projection used as the only Writer-facing control view. */
export interface WriterSafeContext {
    readonly kind: 'writer-safe-context';
    readonly storyControlId: StoryId;
    readonly chapter: ChapterNumber;
    readonly arc: WriterSafeArc;
    readonly beat?: WriterSafeBeat;
    readonly characters: readonly WriterSafeCharacter[];
    readonly canonRules: readonly Pick<CanonRule, 'id' | 'text' | 'scope'>[];
    readonly reveals: readonly WriterSafeReveal[];
    readonly relationshipEvents: readonly WriterSafeRelationshipEvent[];
    readonly state: WriterSafeState;
}
