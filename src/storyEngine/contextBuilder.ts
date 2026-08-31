import {
    CharacterKnowledge,
    CharacterResource,
    ContinuityEntry,
    FullStoryControl,
    OpenThread,
    StoryFact,
    StoryId,
    StoryState,
} from './types';
import {
    getAllowedCharactersForChapter,
    getArcForChapter,
    getBeatForChapter,
    isPovAllowed,
    isRelationshipEventAllowed,
    isRevealAllowed,
    isStoryEventAllowed,
} from './gates';
import { isValidChapter } from './storyControl';
import { buildPlannerPlotGuidance } from './plotContext';
import {
    DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY,
    LongTermMemory,
    NarrativeMemoryInput,
    NarrativeMemorySelectionPolicy,
    PlannerContext,
    RawChapterMemory,
    SelectedNarrativeMemory,
    StructuredChapterMemory,
} from './plannerTypes';

const byChapterThenIndex = <T extends { readonly chapterNumber: number }>(
    values: readonly T[],
): readonly { readonly value: T; readonly index: number }[] => values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value.chapterNumber - right.value.chapterNumber || left.index - right.index);

const selectNewestChapters = <T extends { readonly chapterNumber: number }>(
    values: readonly T[],
    count: number,
    clone: (value: T) => T,
): readonly T[] => {
    if (count === 0) return [];
    return byChapterThenIndex(values)
        .slice(-count)
        .map(entry => clone(entry.value));
};

const cloneRawMemory = (value: RawChapterMemory): RawChapterMemory => ({
    chapterNumber: value.chapterNumber,
    text: value.text,
});

const cloneStructuredMemory = (value: StructuredChapterMemory): StructuredChapterMemory => ({
    chapterNumber: value.chapterNumber,
    summary: value.summary,
    ...(value.factIds === undefined ? {} : { factIds: [...value.factIds] }),
});

const cloneLongTermMemory = (value: LongTermMemory): LongTermMemory => ({
    id: value.id,
    establishedChapter: value.establishedChapter,
    summary: value.summary,
    ...(value.relevance === undefined ? {} : { relevance: value.relevance }),
});

const normalizePolicy = (policy: NarrativeMemorySelectionPolicy): NarrativeMemorySelectionPolicy => {
    const keys: (keyof NarrativeMemorySelectionPolicy)[] = [
        'recentRawChapters', 'structuredSummaryWindow', 'selectedLongTermMemories',
    ];
    keys.forEach((key) => {
        if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) {
            throw new Error(`memory selection policy ${key} must be a non-negative integer`);
        }
    });
    return {
        recentRawChapters: policy.recentRawChapters,
        structuredSummaryWindow: policy.structuredSummaryWindow,
        selectedLongTermMemories: policy.selectedLongTermMemories,
    };
};

/**
 * Select bounded pre-target memory deterministically. Material from the target chapter or later
 * is filtered out before windowing; recent material is selected by recency, while long-term
 * memories are selected by explicit relevance and then presented chronologically.
 */
export const selectNarrativeMemory = (
    input: NarrativeMemoryInput | undefined,
    targetChapter: number,
    suppliedPolicy: NarrativeMemorySelectionPolicy = DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY,
): SelectedNarrativeMemory => {
    if (!isValidChapter(targetChapter)) throw new Error('target chapter must be a positive integer');
    const policy = normalizePolicy(suppliedPolicy);
    const recentRawChapters = selectNewestChapters(
        (input?.recentRawChapters ?? []).filter(memory => isValidChapter(memory.chapterNumber) && memory.chapterNumber < targetChapter),
        policy.recentRawChapters,
        cloneRawMemory,
    );
    const structuredRecentSummaries = selectNewestChapters(
        (input?.structuredRecentSummaries ?? []).filter(memory => isValidChapter(memory.chapterNumber) && memory.chapterNumber < targetChapter),
        policy.structuredSummaryWindow,
        cloneStructuredMemory,
    );
    const selectedLongTermMemories = (input?.selectedLongTermMemories ?? [])
        .filter(memory => isValidChapter(memory.establishedChapter) && memory.establishedChapter < targetChapter)
        .map((value, index) => ({ value, index }))
        .sort((left, right) => (right.value.relevance ?? 0) - (left.value.relevance ?? 0)
            || right.value.establishedChapter - left.value.establishedChapter || left.index - right.index)
        .slice(0, policy.selectedLongTermMemories)
        .sort((left, right) => left.value.establishedChapter - right.value.establishedChapter || left.index - right.index)
        .map(entry => cloneLongTermMemory(entry.value));

    return { recentRawChapters, structuredRecentSummaries, selectedLongTermMemories };
};

const copyResources = (resources: StoryState['resources'], allowedIds: ReadonlySet<StoryId>): Record<StoryId, readonly CharacterResource[]> => {
    const output: Record<StoryId, readonly CharacterResource[]> = {};
    [...allowedIds].sort().forEach((id) => {
        const values = resources[id];
        if (values) output[id] = values.map(resource => ({ ...resource }));
    });
    return output;
};

const copyContinuityEntries = (entries: readonly ContinuityEntry[], chapter: number): readonly ContinuityEntry[] =>
    entries
        .filter(entry => entry.establishedChapter <= chapter)
        .map(entry => ({ text: entry.text, visibility: entry.visibility, establishedChapter: entry.establishedChapter }));

const copyContinuity = (continuity: StoryState['continuity'], chapter: number) => ({
    ...(continuity.timelinePosition === undefined ? {} : { timelinePosition: continuity.timelinePosition }),
    ...(continuity.lastScene === undefined ? {} : { lastScene: continuity.lastScene }),
    ...(continuity.povCharacterId === undefined ? {} : { povCharacterId: continuity.povCharacterId }),
    pendingThreads: copyContinuityEntries(continuity.pendingThreads, chapter),
    notes: copyContinuityEntries(continuity.notes, chapter),
});

const visibleFacts = (facts: readonly StoryFact[], chapter: number, visibility: StoryFact['visibility']) => facts
    .filter(fact => fact.visibility === visibility && fact.establishedChapter <= chapter)
    .map(fact => ({ id: fact.id, text: fact.text }));

const copyKnowledge = (
    knowledge: readonly CharacterKnowledge[],
    allowedIds: ReadonlySet<StoryId>,
    validFactIds: ReadonlySet<StoryId>,
) => knowledge
    .filter(entry => allowedIds.has(entry.characterId))
    .map(entry => ({ characterId: entry.characterId, factIds: entry.factIds.filter(factId => validFactIds.has(factId)) }));

const currentThreads = (threads: readonly OpenThread[], chapter: number) => threads
    .filter(thread => thread.openedChapter <= chapter)
    .map(thread => ({ id: thread.id, text: thread.text }));

/**
 * Deterministically materializes the planner's bounded, current-chapter context. No input is
 * mutated or frozen; state extensions and raw author-secret values are intentionally excluded.
 */
export const buildPlannerContext = (
    control: FullStoryControl,
    state: StoryState,
    targetChapter: number = state.currentChapter,
    memoryInput?: NarrativeMemoryInput,
    memoryPolicy: NarrativeMemorySelectionPolicy = DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY,
): PlannerContext => {
    if (!isValidChapter(targetChapter) || targetChapter > control.engine.plannedChapterCount) {
        throw new Error('target chapter must be within the planned story range');
    }
    if ((state.currentChapter !== 0 && !isValidChapter(state.currentChapter)) || state.currentChapter > targetChapter) {
        throw new Error('state current chapter must not be later than the target chapter');
    }
    const arc = getArcForChapter(control, targetChapter);
    const beat = getBeatForChapter(control, targetChapter);
    if (!arc) throw new Error(`no unique arc resolves for chapter ${targetChapter}`);
    const arcUsesBeats = control.beats.some(candidate => candidate.arcId === arc.id);
    if (arcUsesBeats && !beat) throw new Error(`no unique beat resolves for chapter ${targetChapter} in arc ${arc.id}`);

    const availableCharacters = getAllowedCharactersForChapter(control, targetChapter);
    const availableIds = new Set(availableCharacters.map(character => character.id));
    const validFactIds = new Set(state.facts
        .filter(fact => fact.establishedChapter <= targetChapter)
        .map(fact => fact.id));
    const activeIds = state.activeCharacterIds.filter(id => availableIds.has(id));
    const makeGateStatus = (ids: readonly StoryId[], allowed: (id: StoryId) => boolean) => ids
        .map(id => ({ id, allowed: allowed(id) }));

    return {
        kind: 'planner-context',
        storyControlId: control.id,
        targetChapter,
        plannedChapterCount: control.engine.plannedChapterCount,
        currentArc: {
            id: arc.id,
            title: arc.title,
            startChapter: arc.startChapter,
            endChapter: arc.endChapter,
            ...(arc.writerBrief === undefined ? {} : { writerBrief: arc.writerBrief }),
        },
        ...(beat === undefined ? {} : { currentBeat: {
            id: beat.id,
            order: beat.order,
            startChapter: beat.startChapter,
            endChapter: beat.endChapter,
            ...(beat.writerBrief === undefined ? {} : { writerBrief: beat.writerBrief }),
        } }),
        availableCharacters: availableCharacters.map(character => ({
            id: character.id,
            name: character.name,
            profile: { ...character.writerProfile, ...(character.writerProfile.publicFacts === undefined ? {} : { publicFacts: [...character.writerProfile.publicFacts] }) },
            isKnown: state.knownCharacterIds.includes(character.id),
            isActive: activeIds.includes(character.id),
            ...(state.characterLocations[character.id] === undefined ? {} : { location: state.characterLocations[character.id] }),
            ...(state.characterStatuses[character.id] === undefined ? {} : { status: { ...state.characterStatuses[character.id], injuries: [...state.characterStatuses[character.id].injuries], conditions: [...state.characterStatuses[character.id].conditions] } }),
        })),
        activeCharacterIds: [...activeIds],
        povEligibility: makeGateStatus(availableCharacters.map(character => character.id), id => isPovAllowed(control, id, targetChapter)),
        writerVisibleFacts: visibleFacts(state.facts, targetChapter, 'writer'),
        internalFacts: visibleFacts(state.facts, targetChapter, 'internal'),
        characterKnowledge: copyKnowledge(state.characterKnowledge, availableIds, validFactIds),
        relationships: state.relationships
            .filter(relationship => relationship.establishedChapter <= targetChapter && relationship.participantIds.every(id => availableIds.has(id)))
            .map(relationship => ({ id: relationship.id, participantIds: [...relationship.participantIds], state: relationship.state })),
        unresolvedClues: currentThreads(state.unresolvedClues, targetChapter),
        unresolvedPromises: currentThreads(state.unresolvedPromises, targetChapter),
        resources: copyResources(state.resources, availableIds),
        continuity: copyContinuity(state.continuity, targetChapter),
        allowedRevealIds: makeGateStatus(control.reveals.map(reveal => reveal.id), id => isRevealAllowed(control, id, targetChapter)).filter(status => status.allowed).map(status => status.id),
        lockedRevealIds: makeGateStatus(control.reveals.map(reveal => reveal.id), id => isRevealAllowed(control, id, targetChapter)).filter(status => !status.allowed).map(status => status.id),
        allowedStoryEventIds: makeGateStatus(control.storyEvents.map(event => event.id), id => isStoryEventAllowed(control, id, targetChapter)).filter(status => status.allowed).map(status => status.id),
        lockedStoryEventIds: makeGateStatus(control.storyEvents.map(event => event.id), id => isStoryEventAllowed(control, id, targetChapter)).filter(status => !status.allowed).map(status => status.id),
        allowedRelationshipEventIds: makeGateStatus(control.relationshipEvents.map(event => event.id), id => isRelationshipEventAllowed(control, id, targetChapter)).filter(status => status.allowed).map(status => status.id),
        lockedRelationshipEventIds: makeGateStatus(control.relationshipEvents.map(event => event.id), id => isRelationshipEventAllowed(control, id, targetChapter)).filter(status => !status.allowed).map(status => status.id),
        allowedRelationshipEvents: control.relationshipEvents
            .filter(event => isRelationshipEventAllowed(control, event.id, targetChapter))
            .map(event => ({ id: event.id, participantIds: [...event.participantIds] })),
        authorOnlySecretReferences: control.authorOnlySecrets.map(secret => ({ id: secret.id, ...(secret.revealId === undefined ? {} : { revealId: secret.revealId }) })),
        activeHardConstraints: [
            ...control.canonRules
                .filter(rule => rule.availableFromChapter <= targetChapter && (rule.expiresAfterChapter === undefined || targetChapter <= rule.expiresAfterChapter))
                .map(rule => ({ id: rule.id, type: 'canon-rule' as const, referenceId: rule.id, writerText: rule.text })),
        ],
        narrativeMemory: selectNarrativeMemory(memoryInput, targetChapter, memoryPolicy),
        plotGuidance: buildPlannerPlotGuidance(control, state, targetChapter),
    };
};
