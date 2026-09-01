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
import {
    assertModelBoundaryStringsSecretSafe,
    assertWriterFacingControlSecretSafe,
} from './secretTextSafety';
import { buildPlannerPlotGuidance } from './plotContext';
import {
    buildPlannerRelationshipContext,
    DEFAULT_RELATIONSHIP_CONTEXT_SELECTION_POLICY,
} from './relationshipContext';
import type { RelationshipContextSelectionPolicy } from './relationshipContext';
import {
    DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY,
    DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY,
    LongTermMemory,
    NarrativeMemoryInput,
    NarrativeMemorySelectionPolicy,
    PlannerContext,
    PlannerContextSelectionPolicy,
    RawChapterMemory,
    SelectedNarrativeMemory,
    StructuredChapterMemory,
} from './plannerTypes';

export class PlannerContextCapacityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PlannerContextCapacityError';
    }
}

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

const PLANNER_CONTEXT_SELECTION_POLICY_KEYS = [
    'maxCharacters',
    'maxWriterVisibleFacts',
    'maxInternalFacts',
    'maxKnowledgeFactRefs',
    'maxRelationships',
    'maxUnresolvedClues',
    'maxUnresolvedPromises',
    'maxContinuityEntries',
    'maxResourcesPerCharacter',
    'maxGateIdsPerCategory',
    'maxAuthorSecretReferences',
    'maxActiveHardConstraints',
] as const satisfies readonly (keyof PlannerContextSelectionPolicy)[];

export const normalizePlannerContextSelectionPolicy = (
    policy: PlannerContextSelectionPolicy,
): PlannerContextSelectionPolicy => {
    PLANNER_CONTEXT_SELECTION_POLICY_KEYS.forEach((key) => {
        if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) {
            throw new PlannerContextCapacityError(`planner context selection policy ${key} must be a non-negative safe integer`);
        }
    });
    return {
        maxCharacters: policy.maxCharacters,
        maxWriterVisibleFacts: policy.maxWriterVisibleFacts,
        maxInternalFacts: policy.maxInternalFacts,
        maxKnowledgeFactRefs: policy.maxKnowledgeFactRefs,
        maxRelationships: policy.maxRelationships,
        maxUnresolvedClues: policy.maxUnresolvedClues,
        maxUnresolvedPromises: policy.maxUnresolvedPromises,
        maxContinuityEntries: policy.maxContinuityEntries,
        maxResourcesPerCharacter: policy.maxResourcesPerCharacter,
        maxGateIdsPerCategory: policy.maxGateIdsPerCategory,
        maxAuthorSecretReferences: policy.maxAuthorSecretReferences,
        maxActiveHardConstraints: policy.maxActiveHardConstraints,
    };
};

const requirePlannerCapacity = (label: string, count: number, maximum: number): void => {
    if (count > maximum) throw new PlannerContextCapacityError(`${label} requires ${count} items but capacity is ${maximum}`);
};

const newestThenChronological = <T>(
    values: readonly T[],
    maximum: number,
    chapter: (value: T) => number,
    id: (value: T) => string,
): readonly T[] => values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => chapter(right.value) - chapter(left.value)
        || id(left.value).localeCompare(id(right.value)) || left.index - right.index)
    .slice(0, maximum)
    .sort((left, right) => chapter(left.value) - chapter(right.value)
        || id(left.value).localeCompare(id(right.value)) || left.index - right.index)
    .map(entry => entry.value);

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

const copyResources = (
    resources: StoryState['resources'],
    allowedIds: ReadonlySet<StoryId>,
    maximumPerCharacter: number,
): Record<StoryId, readonly CharacterResource[]> => {
    const output: Record<StoryId, readonly CharacterResource[]> = {};
    [...allowedIds].sort().forEach((id) => {
        const values = resources[id];
        if (values) output[id] = values.slice().sort((left, right) => left.id.localeCompare(right.id))
            .slice(0, maximumPerCharacter).map(resource => ({ ...resource }));
    });
    return output;
};

const copyContinuityEntries = (entries: readonly ContinuityEntry[], chapter: number): readonly ContinuityEntry[] =>
    entries
        .filter(entry => entry.establishedChapter <= chapter)
        .map(entry => ({ text: entry.text, visibility: entry.visibility, establishedChapter: entry.establishedChapter }));

const copyContinuity = (continuity: StoryState['continuity'], chapter: number, maximumEntries: number) => {
    const tagged = [
        ...copyContinuityEntries(continuity.pendingThreads, chapter).map((entry, index) => ({ entry, section: 'pending' as const, index })),
        ...copyContinuityEntries(continuity.notes, chapter).map((entry, index) => ({ entry, section: 'notes' as const, index })),
    ].sort((left, right) => right.entry.establishedChapter - left.entry.establishedChapter
        || left.entry.text.localeCompare(right.entry.text) || left.section.localeCompare(right.section) || left.index - right.index)
        .slice(0, maximumEntries)
        .sort((left, right) => left.entry.establishedChapter - right.entry.establishedChapter
            || left.entry.text.localeCompare(right.entry.text) || left.section.localeCompare(right.section) || left.index - right.index);
    return {
    ...(continuity.timelinePosition === undefined ? {} : { timelinePosition: continuity.timelinePosition }),
    ...(continuity.lastScene === undefined ? {} : { lastScene: continuity.lastScene }),
    ...(continuity.povCharacterId === undefined ? {} : { povCharacterId: continuity.povCharacterId }),
        pendingThreads: tagged.filter(value => value.section === 'pending').map(value => value.entry),
        notes: tagged.filter(value => value.section === 'notes').map(value => value.entry),
    };
};

const visibleFacts = (
    facts: readonly StoryFact[],
    chapter: number,
    visibility: StoryFact['visibility'],
    maximum: number,
) => newestThenChronological(
    facts.filter(fact => fact.visibility === visibility && fact.establishedChapter <= chapter),
    maximum,
    fact => fact.establishedChapter,
    fact => fact.id,
)
    .map(fact => ({ id: fact.id, text: fact.text }));

const copyKnowledge = (
    knowledge: readonly CharacterKnowledge[],
    allowedIds: ReadonlySet<StoryId>,
    validFactIds: ReadonlySet<StoryId>,
    facts: readonly StoryFact[],
    maximumFactRefs: number,
) => {
    const factsById = new Map(facts.map(value => [value.id, value]));
    const selected = knowledge
        .filter(entry => allowedIds.has(entry.characterId))
        .flatMap(entry => entry.factIds.filter(factId => validFactIds.has(factId)).map(factId => ({
            characterId: entry.characterId,
            factId,
            chapter: factsById.get(factId)?.establishedChapter ?? 0,
        })))
        .sort((left, right) => right.chapter - left.chapter
            || left.characterId.localeCompare(right.characterId) || left.factId.localeCompare(right.factId))
        .slice(0, maximumFactRefs);
    const byCharacter = new Map<StoryId, typeof selected>();
    selected.forEach((entry) => {
        const values = byCharacter.get(entry.characterId) ?? [];
        values.push(entry);
        byCharacter.set(entry.characterId, values);
    });
    return [...byCharacter.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([characterId, values]) => ({
        characterId,
        factIds: values.slice().sort((left, right) => left.chapter - right.chapter || left.factId.localeCompare(right.factId)).map(value => value.factId),
    }));
};

const currentThreads = (threads: readonly OpenThread[], chapter: number, maximum: number) => newestThenChronological(
    threads.filter(thread => thread.openedChapter <= chapter),
    maximum,
    thread => thread.openedChapter,
    thread => thread.id,
)
    .map(thread => ({ id: thread.id, text: thread.text }));

const selectPlannerCharacters = (
    control: FullStoryControl,
    state: StoryState,
    targetChapter: number,
    maximum: number,
) => {
    const available = getAllowedCharactersForChapter(control, targetChapter);
    const active = new Set(state.activeCharacterIds);
    const known = new Set(state.knownCharacterIds);
    const mandatory = available.filter(character => active.has(character.id));
    requirePlannerCapacity('active characters', mandatory.length, maximum);
    const mandatoryIds = new Set(mandatory.map(character => character.id));
    const selected = [
        ...mandatory,
        ...available.filter(character => !mandatoryIds.has(character.id))
            .map((character, index) => ({ character, index, known: known.has(character.id) }))
            .sort((left, right) => Number(right.known) - Number(left.known)
                || left.character.id.localeCompare(right.character.id) || left.index - right.index)
            .slice(0, maximum - mandatory.length)
            .map(value => value.character),
    ];
    const selectedIds = new Set(selected.map(character => character.id));
    return available.filter(character => selectedIds.has(character.id));
};

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
    relationshipPolicy: RelationshipContextSelectionPolicy = DEFAULT_RELATIONSHIP_CONTEXT_SELECTION_POLICY,
    suppliedSelectionPolicy: PlannerContextSelectionPolicy = DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY,
): PlannerContext => {
    assertWriterFacingControlSecretSafe(control);
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

    const selectionPolicy = normalizePlannerContextSelectionPolicy(suppliedSelectionPolicy);
    const availableCharacters = selectPlannerCharacters(control, state, targetChapter, selectionPolicy.maxCharacters);
    const availableIds = new Set(availableCharacters.map(character => character.id));
    const writerVisibleFacts = visibleFacts(state.facts, targetChapter, 'writer', selectionPolicy.maxWriterVisibleFacts);
    const internalFacts = visibleFacts(state.facts, targetChapter, 'internal', selectionPolicy.maxInternalFacts);
    const validFactIds = new Set([...writerVisibleFacts, ...internalFacts].map(fact => fact.id));
    const activeIds = state.activeCharacterIds.filter(id => availableIds.has(id));
    const makeGateStatus = (ids: readonly StoryId[], allowed: (id: StoryId) => boolean) => ids
        .map(id => ({ id, allowed: allowed(id) }));
    const boundedGateStatus = (label: string, ids: readonly StoryId[], allowed: (id: StoryId) => boolean) => {
        requirePlannerCapacity(label, ids.length, selectionPolicy.maxGateIdsPerCategory);
        return makeGateStatus(ids.slice().sort(), allowed);
    };
    const activeHardConstraints = control.canonRules
        .filter(rule => rule.availableFromChapter <= targetChapter && (rule.expiresAfterChapter === undefined || targetChapter <= rule.expiresAfterChapter))
        .map(rule => ({ id: rule.id, type: 'canon-rule' as const, referenceId: rule.id, writerText: rule.text }));
    requirePlannerCapacity('active hard constraints', activeHardConstraints.length, selectionPolicy.maxActiveHardConstraints);
    requirePlannerCapacity('author secret references', control.authorOnlySecrets.length, selectionPolicy.maxAuthorSecretReferences);
    const revealGateStatus = boundedGateStatus('reveal gates', control.reveals.map(reveal => reveal.id), id => isRevealAllowed(control, id, targetChapter));
    const storyEventGateStatus = boundedGateStatus('story event gates', control.storyEvents.map(event => event.id), id => isStoryEventAllowed(control, id, targetChapter));
    const relationshipEventGateStatus = boundedGateStatus('relationship event gates', control.relationshipEvents.map(event => event.id), id => isRelationshipEventAllowed(control, id, targetChapter));
    const allowedRevealIds = revealGateStatus.filter(status => status.allowed).map(status => status.id);
    const lockedRevealIds = revealGateStatus.filter(status => !status.allowed).map(status => status.id);
    const allowedStoryEventIds = storyEventGateStatus.filter(status => status.allowed).map(status => status.id);
    const lockedStoryEventIds = storyEventGateStatus.filter(status => !status.allowed).map(status => status.id);
    const relationshipEventsById = new Map(control.relationshipEvents.map(event => [event.id, event]));
    const relationshipEventIsPlannerAvailable = (id: StoryId): boolean => {
        const event = relationshipEventsById.get(id);
        return event !== undefined && event.participantIds.every(participantId => availableIds.has(participantId));
    };
    const allowedRelationshipEventIds = relationshipEventGateStatus
        .filter(status => status.allowed && relationshipEventIsPlannerAvailable(status.id))
        .map(status => status.id);
    const lockedRelationshipEventIds = relationshipEventGateStatus
        .filter(status => !status.allowed || !relationshipEventIsPlannerAvailable(status.id))
        .map(status => status.id);

    const context: PlannerContext = {
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
        writerVisibleFacts,
        internalFacts,
        characterKnowledge: copyKnowledge(state.characterKnowledge, availableIds, validFactIds, state.facts, selectionPolicy.maxKnowledgeFactRefs),
        relationships: newestThenChronological(
            state.relationships.filter(relationship => relationship.establishedChapter <= targetChapter
                && relationship.participantIds.every(id => availableIds.has(id))),
            selectionPolicy.maxRelationships,
            relationship => relationship.establishedChapter,
            relationship => relationship.id,
        )
            .map(relationship => ({ id: relationship.id, participantIds: [...relationship.participantIds], state: relationship.state })),
        unresolvedClues: currentThreads(state.unresolvedClues, targetChapter, selectionPolicy.maxUnresolvedClues),
        unresolvedPromises: currentThreads(state.unresolvedPromises, targetChapter, selectionPolicy.maxUnresolvedPromises),
        resources: copyResources(state.resources, availableIds, selectionPolicy.maxResourcesPerCharacter),
        continuity: copyContinuity(state.continuity, targetChapter, selectionPolicy.maxContinuityEntries),
        allowedRevealIds,
        lockedRevealIds,
        allowedStoryEventIds,
        lockedStoryEventIds,
        allowedRelationshipEventIds,
        lockedRelationshipEventIds,
        allowedRelationshipEvents: control.relationshipEvents
            .filter(event => allowedRelationshipEventIds.includes(event.id))
            .slice().sort((left, right) => left.id.localeCompare(right.id))
            .map(event => ({ id: event.id, relationshipId: event.relationshipId, participantIds: [...event.participantIds] })),
        authorOnlySecretReferences: control.authorOnlySecrets.slice().sort((left, right) => left.id.localeCompare(right.id))
            .map(secret => ({ id: secret.id, ...(secret.revealId === undefined ? {} : { revealId: secret.revealId }) })),
        activeHardConstraints,
        narrativeMemory: selectNarrativeMemory(memoryInput, targetChapter, memoryPolicy),
        plotGuidance: buildPlannerPlotGuidance(control, state, targetChapter),
        relationshipContext: buildPlannerRelationshipContext(control, state, targetChapter, relationshipPolicy, availableIds),
    };
    assertModelBoundaryStringsSecretSafe(control, context, 'plannerContext');
    return context;
};
