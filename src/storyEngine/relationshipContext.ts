import { isCharacterDirectAppearanceAllowed, isRelationshipEventAllowed } from './gates';
import type { PlannerRelationshipContext } from './relationshipTypes';
import type { RelationshipActionPlan, WriterRelationshipDirective } from './relationshipTypes';
import type { FullStoryControl, StoryState } from './types';
import type { InternalChapterPlan } from './plannerTypes';
import { assertModelBoundaryStringsSecretSafe } from './secretTextSafety';
import { orderRelationshipActions } from './relationshipValidator';
import { countConsecutiveRomanticProgressions, deriveCurrentRomanceMilestone, isRomanceMilestone } from './relationshipMilestone';

export interface RelationshipContextSelectionPolicy {
    readonly maxRelationships: number;
    readonly maxRecentHistoryPerRelationship: number;
    readonly maxParticipantBeliefs: number;
}

export const DEFAULT_RELATIONSHIP_CONTEXT_SELECTION_POLICY: RelationshipContextSelectionPolicy = {
    maxRelationships: 64,
    maxRecentHistoryPerRelationship: 6,
    maxParticipantBeliefs: 64,
};

const normalizePolicy = (policy: RelationshipContextSelectionPolicy): RelationshipContextSelectionPolicy => {
    if (!Number.isSafeInteger(policy.maxRelationships) || policy.maxRelationships < 0
        || !Number.isSafeInteger(policy.maxRecentHistoryPerRelationship) || policy.maxRecentHistoryPerRelationship < 0
        || !Number.isSafeInteger(policy.maxParticipantBeliefs) || policy.maxParticipantBeliefs < 0) {
        throw new Error('relationship context limits must be non-negative safe integers');
    }
    return { ...policy };
};

export class RelationshipHistoryCapacityError extends Error {
    constructor(message: string) { super(message); this.name = 'RelationshipHistoryCapacityError'; }
}

/**
 * Deterministic bounded relationship intelligence. It derives from control plus canonical
 * projections/history and creates no independent relationship truth or mutation path.
 */
export const buildPlannerRelationshipContext = (
    control: FullStoryControl,
    state: StoryState,
    targetChapter: number,
    suppliedPolicy: RelationshipContextSelectionPolicy = DEFAULT_RELATIONSHIP_CONTEXT_SELECTION_POLICY,
): PlannerRelationshipContext => {
    const policy = normalizePolicy(suppliedPolicy);
    const available = new Set(control.characterOrder.filter(id => isCharacterDirectAppearanceAllowed(control, id, targetChapter)));
    const canonicalById = new Map(state.relationships
        .filter(value => value.establishedChapter <= targetChapter)
        .map(value => [value.id, value]));
    const definitions = control.relationshipDefinitions
        .filter(value => value.participantIds.every(id => available.has(id)))
        .map((value, index) => ({ value, index, canonical: canonicalById.get(value.id) }))
        .sort((left, right) => Number(right.canonical !== undefined) - Number(left.canonical !== undefined)
            || (right.canonical?.establishedChapter ?? 0) - (left.canonical?.establishedChapter ?? 0)
            || left.value.id.localeCompare(right.value.id) || left.index - right.index)
        .slice(0, policy.maxRelationships)
        .sort((left, right) => left.value.id.localeCompare(right.value.id));
    const selectedIds = new Set(definitions.map(entry => entry.value.id));
    const relationships = definitions.map(({ value, canonical }) => {
        const history = state.ledgers.relationships
            .filter(entry => entry.relationshipId === value.id && entry.chapterNumber <= targetChapter)
            .slice()
            .sort((left, right) => left.chapterNumber - right.chapterNumber || left.id.localeCompare(right.id));
        const milestoneHistory = history.filter(entry => isRomanceMilestone(entry.state));
        const requiredMilestoneCount = Math.min(milestoneHistory.length, value.progressionPolicy.maxConsecutiveProgressionChapters + 1);
        const slowBurnHistoryComplete = policy.maxRecentHistoryPerRelationship >= requiredMilestoneCount;
        if (policy.maxRecentHistoryPerRelationship !== 0 && !slowBurnHistoryComplete) {
            throw new RelationshipHistoryCapacityError(`relationship ${value.id} needs ${requiredMilestoneCount} history records to enforce its slow-burn policy, but capacity is ${policy.maxRecentHistoryPerRelationship}`);
        }
        const mandatoryIds = new Set(policy.maxRecentHistoryPerRelationship === 0 ? [] : milestoneHistory.slice(-requiredMilestoneCount).map(entry => entry.id));
        const remainingCapacity = policy.maxRecentHistoryPerRelationship - mandatoryIds.size;
        const selectedHistory = policy.maxRecentHistoryPerRelationship === 0 ? [] : [
            ...history.filter(entry => mandatoryIds.has(entry.id)),
            ...(remainingCapacity === 0 ? [] : history.filter(entry => !mandatoryIds.has(entry.id)).slice(-remainingCapacity)),
        ].sort((left, right) => left.chapterNumber - right.chapterNumber || left.id.localeCompare(right.id));
        const currentRomanceMilestone = deriveCurrentRomanceMilestone(value, state, targetChapter);
        return {
            id: value.id,
            participantIds: [...value.participantIds],
            categories: [...value.categories],
            ...(canonical === undefined ? {} : { currentState: canonical.state }),
            currentRomanceMilestone,
            dynamicProfile: {
                coreDynamicTags: [...value.dynamicProfile.coreDynamicTags],
                dominantConflictSources: [...value.dynamicProfile.dominantConflictSources],
                trustBasis: [...value.dynamicProfile.trustBasis],
                respectBasis: [...value.dynamicProfile.respectBasis],
                prohibitedShortcuts: [...value.dynamicProfile.prohibitedShortcuts],
            },
            progressionPolicy: { ...value.progressionPolicy },
            slowBurnHistoryComplete,
            consecutiveProgressionCount: countConsecutiveRomanticProgressions(selectedHistory, targetChapter),
            recentHistory: selectedHistory.map(entry => ({ id: entry.id, state: entry.state, chapterNumber: entry.chapterNumber })),
        };
    });
    const allowedRelationshipEvents = control.relationshipEvents
        .filter(event => selectedIds.has(event.relationshipId) && isRelationshipEventAllowed(control, event.id, targetChapter))
        .slice()
        .sort((left, right) => left.relationshipId.localeCompare(right.relationshipId) || left.id.localeCompare(right.id))
        .map(event => ({
            id: event.id,
            relationshipId: event.relationshipId,
            eventType: event.eventType,
            ...(event.authorizedRomanceMilestone === undefined ? {} : { authorizedRomanceMilestone: event.authorizedRomanceMilestone }),
        }));
    const selectedParticipantIds = new Set(relationships.flatMap(value => value.participantIds));
    const participantBeliefs = state.ledgers.epistemic
        .filter(entry => entry.kind === 'believed' && entry.status === 'active' && entry.learnedChapter <= targetChapter
            && selectedParticipantIds.has(entry.characterId) && entry.claim !== undefined)
        .slice()
        .sort((left, right) => right.learnedChapter - left.learnedChapter || left.id.localeCompare(right.id))
        .slice(0, policy.maxParticipantBeliefs)
        .sort((left, right) => left.learnedChapter - right.learnedChapter || left.id.localeCompare(right.id))
        .map(entry => ({ id: entry.id, characterId: entry.characterId, claim: entry.claim! }));
    return {
        relationships,
        allowedRelationshipEvents,
        participantBeliefs,
        maxRelationships: policy.maxRelationships,
        maxRecentHistoryPerRelationship: policy.maxRecentHistoryPerRelationship,
        maxParticipantBeliefs: policy.maxParticipantBeliefs,
    };
};

const writerDirectiveFromAction = (action: RelationshipActionPlan): WriterRelationshipDirective => ({
    id: action.id,
    relationshipId: action.relationshipId,
    ...(action.relationshipEventId === undefined ? {} : { relationshipEventId: action.relationshipEventId }),
    sceneIds: action.sceneIds.map(id => id),
    participantIds: action.participantIds.map(id => id),
    category: action.category,
    actionType: action.actionType,
    ...(action.jealousCharacterId === undefined ? {} : { jealousCharacterId: action.jealousCharacterId }),
    importance: action.importance,
    currentRomanceMilestone: action.currentRomanceMilestone,
    intendedProgression: { ...action.intendedProgression },
    participantChoices: action.participantAgency.map(value => ({
        characterId: value.characterId,
        choice: value.choice,
        willingness: value.willingness,
    })),
    visibleBoundaries: action.boundaries.map(value => ({ ...value })),
    visibleCurrentDynamic: action.writerVisibleContract.currentDynamic,
    visibleObjective: action.writerVisibleContract.objective,
    visibleConflict: action.writerVisibleContract.visibleConflict,
    expectedCostOrTradeoff: action.expectedCostOrTradeoff,
    visibleUncertainty: action.writerVisibleContract.visibleUncertainty,
    visiblePowerBalance: action.currentStateAssessment.powerBalance,
    powerImbalanceAddressed: action.powerImbalanceAddressed,
    ...(action.dependsOnActionId === undefined ? {} : { dependsOnActionId: action.dependsOnActionId }),
});

/** Exact safe relationship contract; evidence, hidden motives, and knowledge tables are excluded. */
export const buildWriterRelationshipDirectives = (
    control: FullStoryControl,
    plan: InternalChapterPlan,
): readonly WriterRelationshipDirective[] => {
    const directives = orderRelationshipActions(plan.relationshipActions ?? [], plan).map(writerDirectiveFromAction);
    assertModelBoundaryStringsSecretSafe(control, directives, 'writerRelationshipDirectives');
    return directives;
};
