import type {
    FullStoryControl,
    InternalChapterPlan,
    PlannerContext,
    StoryState,
    ValidationReport,
    ValidatorRelationshipView,
    ValidatorStrategicView,
    WriterChapterDraft,
    WriterChapterPlan,
    WriterContext,
} from '../storyEngine';

export type StoryStudioMode = 'empty' | 'demo' | 'connected';
export type StoryStudioApprovalStatus = 'approved-not-canon' | 'rejected';

/** UI-only orchestration envelope. It is never persisted and is not canonical state. */
export interface StoryStudioSession {
    readonly mode: StoryStudioMode;
    readonly projectTitle?: string;
    readonly control?: FullStoryControl;
    readonly state?: StoryState;
    readonly plannerContext?: PlannerContext;
    readonly internalPlan?: InternalChapterPlan;
    readonly writerPlan?: WriterChapterPlan;
    readonly writerContext?: WriterContext;
    readonly writerDraft?: WriterChapterDraft;
    readonly validationReport?: ValidationReport;
    readonly validatorStrategicView?: ValidatorStrategicView;
    readonly validatorRelationshipView?: ValidatorRelationshipView;
    readonly approvalStatus?: StoryStudioApprovalStatus;
}

export type StoryStudioPrivilege =
    | 'canon-safe'
    | 'planner-internal'
    | 'writer-safe'
    | 'validator-only'
    | 'author-secret-metadata';

export interface StoryStudioDisplayLimits {
    readonly maxCharacters: number;
    readonly maxRelationships: number;
    readonly maxFacts: number;
    readonly maxKnowledgeEntries: number;
    readonly maxPlotItems: number;
    readonly maxValidationIssues: number;
    readonly maxContinuityItems: number;
    readonly maxScenes: number;
    readonly maxWriterConstraints: number;
    readonly maxStrategicDirectives: number;
    readonly maxRelationshipDirectives: number;
    readonly maxConsequences: number;
    readonly maxInternalIds: number;
    readonly maxInternalActions: number;
}

export const DEFAULT_STORY_STUDIO_DISPLAY_LIMITS: StoryStudioDisplayLimits = {
    maxCharacters: 50,
    maxRelationships: 50,
    maxFacts: 100,
    maxKnowledgeEntries: 100,
    maxPlotItems: 100,
    maxValidationIssues: 100,
    maxContinuityItems: 60,
    maxScenes: 30,
    maxWriterConstraints: 60,
    maxStrategicDirectives: 40,
    maxRelationshipDirectives: 40,
    maxConsequences: 60,
    maxInternalIds: 60,
    maxInternalActions: 40,
};

export interface BoundedList<T> {
    readonly items: readonly T[];
    readonly displayedCount: number;
    readonly totalCount: number;
    readonly truncated: boolean;
}

export type StudioArtifactStatus =
    | 'canon'
    | 'planned'
    | 'draft'
    | 'validated'
    | 'approved-not-canon'
    | 'rejected';

export type StudioStageStatus = 'waiting' | 'ready' | 'complete' | 'failed' | 'blocked' | 'unavailable';

export interface StoryStudioWorkflowStageView {
    readonly id: 'canon' | 'planner' | 'writer' | 'validator' | 'repair' | 'approved' | 'make-canon';
    readonly label: string;
    readonly status: StudioStageStatus;
    readonly detail: string;
    readonly help: string;
}

export interface StoryStudioProjectView {
    readonly privilege: 'canon-safe';
    readonly mode: StoryStudioMode;
    readonly id?: string;
    readonly title: string;
    readonly isDemo: boolean;
    readonly canonChapter?: number;
    readonly targetChapter?: number;
    readonly currentArc?: { readonly id: string; readonly title: string };
    readonly currentBeat?: { readonly id: string; readonly label: string };
    readonly artifactStatus: StudioArtifactStatus;
    readonly artifactStatusLabel: string;
}

export interface StoryStudioOverviewView {
    readonly privilege: 'canon-safe';
    readonly plannedChapterCount: number;
    readonly activeCharacterCount: number;
    readonly relationshipCount: number;
    readonly activeConstraintCount: number;
    readonly factCount: number;
    readonly openForeshadowCount: number;
    readonly outstandingPayoffCount: number;
    readonly strategicActionCount: number;
    readonly validationIssueCount: number;
}

export interface StoryStudioCharacterView {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
    readonly lifeStatus: 'unknown' | 'alive' | 'dead';
    readonly location?: string;
    readonly role?: string;
    readonly status?: string;
    readonly injuries: readonly string[];
    readonly conditions: readonly string[];
}

export interface StoryStudioRelationshipView {
    readonly id: string;
    readonly participantIds: readonly string[];
    readonly participantNames: readonly string[];
    readonly categories: readonly string[];
    readonly currentState?: string;
    readonly currentRomanceMilestone?: string;
    readonly slowBurnStatus?: 'stable' | 'progressing' | 'not-applicable';
    readonly dynamicTags: readonly string[];
    readonly recentChanges: readonly { readonly id: string; readonly chapterNumber: number; readonly state: string }[];
}

export interface StoryStudioFactView {
    readonly id: string;
    readonly text: string;
    readonly establishedChapter: number;
    readonly visibility: 'writer' | 'internal';
    readonly status: 'active' | 'superseded' | 'invalidated';
    readonly knownBy: readonly { readonly id: string; readonly name: string }[];
}

export interface StoryStudioBeliefView {
    readonly id: string;
    readonly characterId: string;
    readonly characterName: string;
    readonly claim: string;
    readonly learnedChapter: number;
}

export interface StoryStudioSecretMetadataView {
    readonly privilege: 'author-secret-metadata';
    readonly id: string;
    readonly revealId?: string;
    readonly status: 'author-only' | 'locked' | 'eligible-not-revealed' | 'revealed';
}

export interface StoryStudioRevealView {
    readonly id: string;
    readonly gateIds: readonly string[];
    readonly status: 'locked' | 'eligible-not-revealed' | 'revealed';
    readonly occurrenceChapter?: number;
}

export interface StoryStudioForeshadowView {
    readonly id: string;
    readonly label: string;
    readonly openedChapter: number;
    readonly status: 'open' | 'paid' | 'superseded';
    readonly cueCount: number;
    readonly latestCue?: string;
}

export interface StoryStudioPayoffView {
    readonly id: string;
    readonly label: string;
    readonly openedChapter: number;
    readonly targetChapter?: number;
    readonly status: 'not-due' | 'due' | 'overdue' | 'paid' | 'paid-late' | 'superseded';
}

export interface StoryStudioContinuityView {
    readonly timelinePosition?: string;
    readonly lastScene?: string;
    readonly povName?: string;
    readonly activeLocations: readonly { readonly characterId: string; readonly characterName: string; readonly location: string }[];
    readonly items: BoundedList<{
        readonly id: string;
        readonly kind: string;
        readonly text: string;
        readonly establishedChapter: number;
        readonly status: string;
    }>;
}

export interface StoryStudioSceneView {
    readonly id: string;
    readonly order: number;
    readonly goal: string;
    readonly location: string;
    readonly povName: string;
    readonly participantNames: readonly string[];
    readonly conflict: string;
    readonly uncertainty: string;
    readonly expectedConsequence: string;
    readonly purposeTags: readonly string[];
}

export type StoryStudioStrategicDirectiveView =
    | {
        readonly id: string;
        readonly domain: 'politics';
        readonly objective: string;
        readonly actorName: string;
        readonly constraints: readonly string[];
        readonly cost: string;
        readonly counterplay?: string;
        readonly dimensions: readonly { readonly dimension: string; readonly status: string }[];
        readonly timing: string;
    }
    | {
        readonly id: string;
        readonly domain: 'military';
        readonly objective: string;
        readonly actorName: string;
        readonly constraints: readonly string[];
        readonly cost: string;
        readonly counterplay?: string;
        readonly operationType: string;
        readonly location: string;
        readonly movement?: string;
        readonly logistics?: string;
        readonly fallback: string;
    }
    | {
        readonly id: string;
        readonly domain: 'commerce';
        readonly objective: string;
        readonly actorName: string;
        readonly constraints: readonly string[];
        readonly cost: string;
        readonly counterplay?: string;
        readonly actionType: string;
        readonly flows: readonly string[];
        readonly counterparty?: string;
        readonly logistics: string;
        readonly risk: string;
        readonly funding?: string;
    };

export interface StoryStudioRelationshipDirectiveView {
    readonly id: string;
    readonly relationshipId: string;
    readonly participants: readonly string[];
    readonly category: string;
    readonly actionType: string;
    readonly milestone: string;
    readonly objective: string;
    readonly conflict: string;
    readonly uncertainty: string;
    readonly cost: string;
    readonly choices: readonly { readonly characterName: string; readonly choice: string; readonly willingness: string }[];
    readonly boundaries: readonly { readonly characterName: string; readonly instruction: string; readonly stance: string }[];
}

export interface StoryStudioWriterPlanView {
    readonly privilege: 'writer-safe';
    readonly chapterNumber: number;
    readonly primaryGoal: string;
    readonly arcTitle: string;
    readonly beatLabel?: string;
    readonly povName: string;
    readonly participantNames: readonly string[];
    readonly scenes: BoundedList<StoryStudioSceneView>;
    readonly constraints: BoundedList<{ readonly id: string; readonly text: string; readonly scope: string }>;
    readonly strategicDirectives: BoundedList<StoryStudioStrategicDirectiveView>;
    readonly relationshipDirectives: BoundedList<StoryStudioRelationshipDirectiveView>;
    readonly expectedConsequences: BoundedList<string>;
    readonly endStateIntent: string;
}

export interface StoryStudioInternalPlanView {
    readonly privilege: 'planner-internal';
    readonly chapterNumber: number;
    readonly primaryGoal: string;
    readonly participantNames: readonly string[];
    readonly scenes: BoundedList<{
        readonly id: string;
        readonly order: number;
        readonly goal: string;
        readonly expectedConsequence: string;
        readonly purposeTags: readonly string[];
    }>;
    readonly activeConstraintIds: BoundedList<string>;
    readonly plannedRevealIds: BoundedList<string>;
    readonly strategicActions: BoundedList<{ readonly id: string; readonly domain: string; readonly objective: string }>;
    readonly relationshipActions: BoundedList<{ readonly id: string; readonly relationshipId: string; readonly actionType: string }>;
}

export interface StoryStudioDraftView {
    readonly privilege: 'writer-safe';
    readonly chapterNumber: number;
    readonly title?: string;
    readonly prose: string;
    readonly status: Exclude<StudioArtifactStatus, 'canon' | 'planned'>;
    readonly statusLabel: string;
}

export type StoryStudioIssueSeverity = 'critical' | 'error' | 'warning';

export interface StoryStudioValidationIssueView {
    readonly id: string;
    readonly code: string;
    readonly severity: StoryStudioIssueSeverity;
    readonly domain: string;
    readonly message: string;
    readonly path: string;
    readonly blocking: boolean;
    readonly source: 'validation-report' | 'strategic-validator' | 'relationship-validator';
}

export interface StoryStudioValidationView {
    readonly privilege: 'validator-only';
    readonly status: 'not-run' | 'passed' | 'blocked';
    readonly chapterNumber?: number;
    readonly validationPass?: number;
    readonly blockingIssueCount: number;
    readonly counts: Readonly<Record<StoryStudioIssueSeverity, number>>;
    readonly issues: BoundedList<StoryStudioValidationIssueView>;
}

export interface StoryStudioIntelligenceView {
    readonly canonPrivilege: 'canon-safe';
    readonly characters: BoundedList<StoryStudioCharacterView>;
    readonly relationships: BoundedList<StoryStudioRelationshipView>;
    readonly facts: BoundedList<StoryStudioFactView>;
    readonly beliefs: BoundedList<StoryStudioBeliefView>;
    readonly secrets: BoundedList<StoryStudioSecretMetadataView>;
    readonly reveals: BoundedList<StoryStudioRevealView>;
    readonly foreshadow: BoundedList<StoryStudioForeshadowView>;
    readonly payoffs: BoundedList<StoryStudioPayoffView>;
    readonly continuity: StoryStudioContinuityView;
}

export interface StoryStudioConsistencyView {
    readonly status: 'ok' | 'error';
    readonly issues: readonly string[];
}

export interface StoryStudioViewModel {
    readonly project: StoryStudioProjectView;
    readonly overview: StoryStudioOverviewView;
    readonly workflow: {
        readonly stages: readonly StoryStudioWorkflowStageView[];
        readonly writerPlan?: StoryStudioWriterPlanView;
        readonly internalPlan?: StoryStudioInternalPlanView;
        readonly draft?: StoryStudioDraftView;
    };
    readonly validation: StoryStudioValidationView;
    readonly intelligence: StoryStudioIntelligenceView;
    readonly consistency: StoryStudioConsistencyView;
}
