import {
    CharacterResource,
    CharacterRuntimeStatus,
    ChapterNumber,
    ContinuityState,
    StoryId,
    WriterCharacterProfile,
} from './types';
import type { PlannerPlotGuidance } from './plotContext';
import type { StrategicActionPlan, WriterStrategicDirective } from './strategicTypes';
import type { PlannerRelationshipContext, RelationshipActionPlan, WriterRelationshipDirective } from './relationshipTypes';

export const SCENE_PURPOSE_TAGS = [
    'plot', 'character', 'resource', 'clue', 'relationship', 'consequence', 'world',
    'politics', 'military', 'commerce',
] as const;

export type ScenePurposeTag = typeof SCENE_PURPOSE_TAGS[number];
export const CONFLICT_IMPORTANCE = ['minor', 'major'] as const;
export type ConflictImportance = typeof CONFLICT_IMPORTANCE[number];
export type PlanValidationSeverity = 'error' | 'warning';

export const PLANNER_CONTEXT_ERROR_CODES = ['NO_ALLOWED_POV'] as const;
export type PlannerContextErrorCode = typeof PLANNER_CONTEXT_ERROR_CODES[number];

export class PlannerContextError extends Error {
    constructor(readonly code: PlannerContextErrorCode) {
        super(code);
        this.name = 'PlannerContextError';
    }
}

export interface PlanValidationIssue {
    readonly code: string;
    readonly path: string;
    readonly message: string;
    readonly severity: PlanValidationSeverity;
}

export interface PlannerArc {
    readonly id: StoryId;
    readonly title: string;
    readonly startChapter: ChapterNumber;
    readonly endChapter: ChapterNumber;
    readonly writerBrief?: string;
}

export interface PlannerBeat {
    readonly id: StoryId;
    readonly order: number;
    readonly startChapter: ChapterNumber;
    readonly endChapter: ChapterNumber;
    readonly writerBrief?: string;
}

export interface PlannerCharacter {
    readonly id: StoryId;
    readonly name: string;
    readonly profile: WriterCharacterProfile;
    readonly isKnown: boolean;
    readonly isActive: boolean;
    readonly location?: string;
    readonly status?: CharacterRuntimeStatus;
}

export interface PlannerGateStatus {
    readonly id: StoryId;
    readonly allowed: boolean;
}

export interface PlannerHardConstraint {
    readonly id: StoryId;
    /** Writer-visible active constraints are canon rules only; gates use dedicated status views. */
    readonly type: 'canon-rule';
    readonly referenceId: StoryId;
    readonly writerText: string;
}

export interface RawChapterMemory {
    readonly chapterNumber: ChapterNumber;
    readonly text: string;
}

export interface StructuredChapterMemory {
    readonly chapterNumber: ChapterNumber;
    readonly summary: string;
    readonly factIds?: readonly StoryId[];
}

export interface LongTermMemory {
    readonly id: StoryId;
    readonly establishedChapter: ChapterNumber;
    readonly summary: string;
    /** Higher values are selected first before the chronological presentation order is restored. */
    readonly relevance?: number;
}

export interface NarrativeMemoryInput {
    readonly recentRawChapters?: readonly RawChapterMemory[];
    readonly structuredRecentSummaries?: readonly StructuredChapterMemory[];
    readonly selectedLongTermMemories?: readonly LongTermMemory[];
}

export interface NarrativeMemorySelectionPolicy {
    readonly recentRawChapters: number;
    readonly structuredSummaryWindow: number;
    readonly selectedLongTermMemories: number;
}

export const DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY: NarrativeMemorySelectionPolicy = {
    recentRawChapters: 4,
    structuredSummaryWindow: 12,
    selectedLongTermMemories: 8,
};

export interface SelectedNarrativeMemory {
    readonly recentRawChapters: readonly RawChapterMemory[];
    readonly structuredRecentSummaries: readonly StructuredChapterMemory[];
    readonly selectedLongTermMemories: readonly LongTermMemory[];
}

/**
 * Bounded selection for canonical/current-state data copied into Planner model input.
 * Narrative memory and relationship history retain their independent policies.
 */
export interface PlannerContextSelectionPolicy {
    readonly maxCharacters: number;
    readonly maxWriterVisibleFacts: number;
    readonly maxInternalFacts: number;
    readonly maxKnowledgeFactRefs: number;
    readonly maxRelationships: number;
    readonly maxUnresolvedClues: number;
    readonly maxUnresolvedPromises: number;
    readonly maxContinuityEntries: number;
    readonly maxResourcesPerCharacter: number;
    readonly maxGateIdsPerCategory: number;
    readonly maxAuthorSecretReferences: number;
    readonly maxActiveHardConstraints: number;
}

export const DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY: PlannerContextSelectionPolicy = {
    maxCharacters: 64,
    maxWriterVisibleFacts: 64,
    maxInternalFacts: 64,
    maxKnowledgeFactRefs: 64,
    maxRelationships: 64,
    maxUnresolvedClues: 24,
    maxUnresolvedPromises: 24,
    maxContinuityEntries: 24,
    maxResourcesPerCharacter: 16,
    maxGateIdsPerCategory: 128,
    maxAuthorSecretReferences: 64,
    maxActiveHardConstraints: 64,
};

/** Internal-only planning input. It deliberately exposes no raw author-secret values. */
export interface PlannerContext {
    readonly kind: 'planner-context';
    readonly storyControlId: StoryId;
    readonly targetChapter: ChapterNumber;
    readonly plannedChapterCount: ChapterNumber;
    readonly currentArc: PlannerArc;
    readonly currentBeat?: PlannerBeat;
    readonly availableCharacters: readonly PlannerCharacter[];
    readonly activeCharacterIds: readonly StoryId[];
    readonly povEligibility: readonly PlannerGateStatus[];
    readonly writerVisibleFacts: readonly { readonly id: StoryId; readonly text: string }[];
    readonly internalFacts: readonly { readonly id: StoryId; readonly text: string }[];
    readonly characterKnowledge: readonly { readonly characterId: StoryId; readonly factIds: readonly StoryId[] }[];
    readonly relationships: readonly { readonly id: StoryId; readonly participantIds: readonly StoryId[]; readonly state: string }[];
    readonly unresolvedClues: readonly { readonly id: StoryId; readonly text: string }[];
    readonly unresolvedPromises: readonly { readonly id: StoryId; readonly text: string }[];
    readonly resources: Readonly<Record<StoryId, readonly CharacterResource[]>>;
    readonly continuity: ContinuityState;
    readonly allowedRevealIds: readonly StoryId[];
    readonly lockedRevealIds: readonly StoryId[];
    readonly allowedStoryEventIds: readonly StoryId[];
    readonly lockedStoryEventIds: readonly StoryId[];
    readonly allowedRelationshipEventIds: readonly StoryId[];
    readonly lockedRelationshipEventIds: readonly StoryId[];
    readonly allowedRelationshipEvents: readonly { readonly id: StoryId; readonly relationshipId: StoryId; readonly participantIds: readonly StoryId[] }[];
    /** References only; raw secret values are intentionally never copied into model context. */
    readonly authorOnlySecretReferences: readonly { readonly id: StoryId; readonly revealId?: StoryId }[];
    /** Only constraints currently applicable to this chapter; locked gates live in typed status/allow lists. */
    readonly activeHardConstraints: readonly PlannerHardConstraint[];
    readonly narrativeMemory: SelectedNarrativeMemory;
    readonly plotGuidance: PlannerPlotGuidance;
    readonly relationshipContext: PlannerRelationshipContext;
}

export interface IntelligentConflictPlan {
    readonly opponentCharacterId?: StoryId;
    readonly protagonistObjective: string;
    readonly opponentObjective: string;
    readonly opponentKnowledge: readonly StoryId[];
    readonly opponentBeliefs: readonly string[];
    readonly rationalCountermove: string;
    readonly uncertainty: string;
    readonly expectedCostOrTradeoff: string;
}

export interface InternalPlanScene {
    readonly id: StoryId;
    readonly order: number;
    readonly goal: string;
    readonly location: string;
    readonly povCharacterId: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly conflictOrObstacle: string;
    readonly uncertainty: string;
    readonly expectedConsequence: string;
    readonly purposeTags: readonly ScenePurposeTag[];
    readonly conflictImportance: ConflictImportance;
    readonly intelligentConflict?: IntelligentConflictPlan;
}

export interface ExpectedResourceDelta {
    readonly characterId: StoryId;
    readonly resourceId: StoryId;
    readonly quantityDelta?: number;
    readonly nextState?: string;
}

export interface ExpectedRelationshipDelta {
    readonly relationshipId: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly expectedState: string;
}

export interface ExpectedContinuityConsequence {
    readonly id: StoryId;
    readonly text: string;
}

/** Planner-owned representation. Never pass this type directly to a Writer. */
export interface InternalChapterPlan {
    readonly kind: 'internal-chapter-plan';
    readonly chapterNumber: ChapterNumber;
    readonly arcId: StoryId;
    readonly beatId?: StoryId;
    readonly primaryGoal: string;
    readonly povCharacterId: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly scenes: readonly InternalPlanScene[];
    readonly activeConstraintIds: readonly StoryId[];
    readonly allowedRevealIds: readonly StoryId[];
    readonly plannedRevealIds: readonly StoryId[];
    readonly relationshipEventIds: readonly StoryId[];
    readonly storyEventIds: readonly StoryId[];
    readonly cluesPlantedIds: readonly StoryId[];
    readonly cluesPaidOffIds: readonly StoryId[];
    readonly expectedResourceDeltas: readonly ExpectedResourceDelta[];
    readonly expectedRelationshipDeltas: readonly ExpectedRelationshipDelta[];
    readonly expectedContinuityConsequences: readonly ExpectedContinuityConsequence[];
    /** Legacy runtime plans may omit this field; parsing normalizes omission to an empty list. */
    readonly strategicActions?: readonly StrategicActionPlan[];
    /** Legacy runtime plans may omit this field; parsing normalizes omission to an empty list. */
    readonly relationshipActions?: readonly RelationshipActionPlan[];
    readonly endStateIntent: string;
}

export interface WriterPlanScene {
    readonly id: StoryId;
    readonly order: number;
    readonly goal: string;
    readonly location: string;
    readonly povCharacterId: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly conflictOrObstacle: string;
    readonly uncertainty: string;
    readonly expectedConsequence: string;
    readonly purposeTags: readonly ScenePurposeTag[];
    readonly conflictImportance: ConflictImportance;
}

/** Explicitly projected Writer contract. It has no author-only or state-extension fields. */
export interface WriterChapterPlan {
    readonly kind: 'writer-chapter-plan';
    readonly chapterNumber: ChapterNumber;
    readonly arc: { readonly id: StoryId; readonly title: string; readonly writerBrief?: string };
    readonly beat?: { readonly id: StoryId; readonly order: number; readonly writerBrief?: string };
    readonly primaryGoal: string;
    readonly povCharacterId: StoryId;
    readonly participantIds: readonly StoryId[];
    readonly scenes: readonly WriterPlanScene[];
    readonly canonConstraints: readonly { readonly id: StoryId; readonly text: string; readonly scope: 'world' | 'canon' }[];
    readonly reveals: readonly { readonly id: StoryId; readonly text: string }[];
    readonly relationshipEvents: readonly { readonly id: StoryId; readonly relationshipId: StoryId; readonly eventType: string; readonly participantIds: readonly StoryId[]; readonly text?: string }[];
    readonly storyEvents: readonly { readonly id: StoryId; readonly eventType: string; readonly text?: string }[];
    readonly cluesPlantedIds: readonly StoryId[];
    readonly cluesPaidOffIds: readonly StoryId[];
    readonly expectedResourceDeltas: readonly ExpectedResourceDelta[];
    readonly expectedRelationshipDeltas: readonly ExpectedRelationshipDelta[];
    readonly expectedContinuityConsequences: readonly ExpectedContinuityConsequence[];
    /** Safe strategic projection only; internal evidence and opponent epistemics are excluded. */
    readonly strategicDirectives?: readonly WriterStrategicDirective[];
    /** Exact Writer-safe relationship contract; privileged evidence is excluded. */
    readonly relationshipDirectives?: readonly WriterRelationshipDirective[];
    readonly endStateIntent: string;
}

export interface PlannerModel {
    plan(context: PlannerContext): Promise<unknown>;
}
