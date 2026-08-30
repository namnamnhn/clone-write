import { buildWriterSafeContext } from './contextViews';
import { selectNarrativeMemory } from './contextBuilder';
import { isPovAllowed, isStoryEventAllowed } from './gates';
import { DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY, NarrativeMemoryInput, NarrativeMemorySelectionPolicy, WriterChapterPlan } from './plannerTypes';
import { FullStoryControl, StoryState } from './types';
import { WriterContext } from './writerTypes';

export class WriterContextError extends Error {}

const text = (value: string, field: string): string => {
    if (!value.trim()) throw new WriterContextError(`${field} must be a non-empty string`);
    return value;
};

const ids = (values: readonly string[], field: string): readonly string[] => {
    if (!values.every(value => value.trim())) throw new WriterContextError(`${field} must contain non-empty IDs`);
    return values.map(value => value);
};

const clonePlan = (
    plan: WriterChapterPlan,
    safe: ReturnType<typeof buildWriterSafeContext>,
    control: FullStoryControl,
): WriterChapterPlan => {
    if (plan.kind !== 'writer-chapter-plan') throw new WriterContextError('plan must be a writer-chapter-plan');
    if (plan.chapterNumber !== safe.chapter) throw new WriterContextError('plan chapter must match target chapter');
    if (plan.arc.id !== safe.arc.id || plan.arc.title !== safe.arc.title) throw new WriterContextError('plan arc must match current arc');
    if ((plan.beat?.id ?? undefined) !== (safe.beat?.id ?? undefined)) throw new WriterContextError('plan beat must match current beat');
    const allowedCharacters = new Set(safe.characters.map(character => character.id));
    if (!allowedCharacters.has(plan.povCharacterId) || !isPovAllowed(control, plan.povCharacterId, safe.chapter)) {
        throw new WriterContextError('plan POV is unavailable for this chapter');
    }
    if (!plan.participantIds.includes(plan.povCharacterId) || !plan.participantIds.every(id => allowedCharacters.has(id))) {
        throw new WriterContextError('plan participants must be currently writer-visible and include the POV');
    }
    if (plan.scenes.length === 0) throw new WriterContextError('plan must contain at least one scene');
    plan.scenes.forEach((scene, index) => {
        text(scene.id, `scenes.${index}.id`);
        text(scene.goal, `scenes.${index}.goal`);
        text(scene.location, `scenes.${index}.location`);
        text(scene.conflictOrObstacle, `scenes.${index}.conflictOrObstacle`);
        text(scene.uncertainty, `scenes.${index}.uncertainty`);
        text(scene.expectedConsequence, `scenes.${index}.expectedConsequence`);
        if (!Number.isSafeInteger(scene.order) || scene.order < 1) throw new WriterContextError(`scenes.${index}.order must be a positive integer`);
        if (!allowedCharacters.has(scene.povCharacterId) || !isPovAllowed(control, scene.povCharacterId, safe.chapter) || !scene.participantIds.includes(scene.povCharacterId)
            || !scene.participantIds.every(id => allowedCharacters.has(id))) {
            throw new WriterContextError(`scenes.${index} contains an unavailable character or POV`);
        }
    });

    const byId = <T extends { readonly id: string }>(values: readonly T[]): Map<string, T> => new Map(values.map(value => [value.id, value]));
    const canonById = byId(safe.canonRules);
    const revealById = byId(safe.reveals);
    const relationshipById = byId(safe.relationshipEvents);
    const storyById = byId(control.storyEvents.filter(event => isStoryEventAllowed(control, event.id, safe.chapter)));
    const noDuplicates = (values: readonly string[], field: string): void => {
        if (new Set(values).size !== values.length) throw new WriterContextError(`${field} must not contain duplicate IDs`);
    };
    noDuplicates(plan.canonConstraints.map(value => value.id), 'canonConstraints');
    noDuplicates(plan.reveals.map(value => value.id), 'reveals');
    noDuplicates(plan.relationshipEvents.map(value => value.id), 'relationshipEvents');
    noDuplicates(plan.storyEvents.map(value => value.id), 'storyEvents');

    const canonConstraints = plan.canonConstraints.map((entry, index) => {
        const source = canonById.get(entry.id);
        if (!source || source.text !== entry.text || source.scope !== entry.scope) throw new WriterContextError(`canonConstraints.${index} is not an active source-of-truth constraint`);
        return { id: source.id, text: source.text, scope: source.scope } as const;
    });
    const reveals = plan.reveals.map((entry, index) => {
        const source = revealById.get(entry.id);
        if (!source || source.text !== entry.text) throw new WriterContextError(`reveals.${index} is not an allowed controlled reveal`);
        return { id: source.id, text: source.text };
    });
    const relationshipEvents = plan.relationshipEvents.map((entry, index) => {
        const source = relationshipById.get(entry.id);
        if (!source || source.relationshipId !== entry.relationshipId || source.eventType !== entry.eventType
            || !source.participantIds.every(id => allowedCharacters.has(id))
            || source.participantIds.join('\u0000') !== entry.participantIds.join('\u0000') || source.writerText !== entry.text) {
            throw new WriterContextError(`relationshipEvents.${index} is not an allowed controlled event`);
        }
        return {
            id: source.id, relationshipId: source.relationshipId, eventType: source.eventType,
            participantIds: source.participantIds.map(id => id),
            ...(source.writerText === undefined ? {} : { text: source.writerText }),
        };
    });
    const storyEvents = plan.storyEvents.map((entry, index) => {
        const source = storyById.get(entry.id);
        if (!source || source.eventType !== entry.eventType || source.writerText !== entry.text) {
            throw new WriterContextError(`storyEvents.${index} is not an allowed controlled event`);
        }
        return { id: source.id, eventType: source.eventType, ...(source.writerText === undefined ? {} : { text: source.writerText }) };
    });

    return {
        kind: 'writer-chapter-plan', chapterNumber: plan.chapterNumber,
        arc: { id: safe.arc.id, title: safe.arc.title, ...(safe.arc.writerBrief === undefined ? {} : { writerBrief: safe.arc.writerBrief }) },
        ...(safe.beat === undefined ? {} : { beat: { id: safe.beat.id, order: safe.beat.order, ...(safe.beat.writerBrief === undefined ? {} : { writerBrief: safe.beat.writerBrief }) } }),
        primaryGoal: text(plan.primaryGoal, 'primaryGoal'), povCharacterId: plan.povCharacterId, participantIds: ids(plan.participantIds, 'participantIds'),
        scenes: plan.scenes.map(scene => ({
            id: scene.id, order: scene.order, goal: scene.goal, location: scene.location, povCharacterId: scene.povCharacterId,
            participantIds: ids(scene.participantIds, 'scene.participantIds'), conflictOrObstacle: scene.conflictOrObstacle,
            uncertainty: scene.uncertainty, expectedConsequence: scene.expectedConsequence, purposeTags: scene.purposeTags.map(tag => tag), conflictImportance: scene.conflictImportance,
        })),
        canonConstraints, reveals, relationshipEvents, storyEvents,
        cluesPlantedIds: ids(plan.cluesPlantedIds, 'cluesPlantedIds'), cluesPaidOffIds: ids(plan.cluesPaidOffIds, 'cluesPaidOffIds'),
        expectedResourceDeltas: plan.expectedResourceDeltas.map(delta => ({ characterId: delta.characterId, resourceId: delta.resourceId, ...(delta.quantityDelta === undefined ? {} : { quantityDelta: delta.quantityDelta }), ...(delta.nextState === undefined ? {} : { nextState: delta.nextState }) })),
        expectedRelationshipDeltas: plan.expectedRelationshipDeltas.map(delta => ({ relationshipId: delta.relationshipId, participantIds: ids(delta.participantIds, 'expectedRelationshipDeltas.participantIds'), expectedState: delta.expectedState })),
        expectedContinuityConsequences: plan.expectedContinuityConsequences.map(value => ({ id: value.id, text: value.text })), endStateIntent: text(plan.endStateIntent, 'endStateIntent'),
    };
};

/**
 * Reconstructs the Writer context from existing safe projections and a verified WriterChapterPlan.
 * It deliberately does not spread or serialize FullStoryControl or StoryState.
 */
export const buildWriterContext = (
    control: FullStoryControl,
    state: StoryState,
    plan: WriterChapterPlan,
    memoryInput?: NarrativeMemoryInput,
    memoryPolicy: NarrativeMemorySelectionPolicy = DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY,
): WriterContext => {
    if (state.currentChapter > plan.chapterNumber) throw new WriterContextError('state current chapter must not be later than the target chapter');
    const safe = buildWriterSafeContext(control, state, plan.chapterNumber);
    const chapterPlan = clonePlan(plan, safe, control);
    const allowedIds = new Set(safe.characters.map(character => character.id));
    const cloneStatus = (status: { readonly status?: string; readonly injuries: readonly string[]; readonly conditions: readonly string[] }) => ({
        ...(status.status === undefined ? {} : { status: status.status }), injuries: status.injuries.map(injury => injury), conditions: status.conditions.map(condition => condition),
    });
    const cloneRecord = <T>(source: Readonly<Record<string, T>>, clone: (value: T) => T): Record<string, T> => {
        const output: Record<string, T> = {};
        [...allowedIds].sort().forEach((id) => { if (source[id] !== undefined) output[id] = clone(source[id]); });
        return output;
    };
    return {
        kind: 'writer-context', targetChapter: safe.chapter,
        currentArc: { id: safe.arc.id, title: safe.arc.title, ...(safe.arc.writerBrief === undefined ? {} : { writerBrief: safe.arc.writerBrief }) },
        ...(safe.beat === undefined ? {} : { currentBeat: { id: safe.beat.id, order: safe.beat.order, ...(safe.beat.writerBrief === undefined ? {} : { writerBrief: safe.beat.writerBrief }) } }),
        chapterPlan,
        characters: safe.characters.map(character => ({ id: character.id, name: character.name, profile: {
            ...(character.profile.role === undefined ? {} : { role: character.profile.role }),
            ...(character.profile.appearance === undefined ? {} : { appearance: character.profile.appearance }),
            ...(character.profile.personality === undefined ? {} : { personality: character.profile.personality }),
            ...(character.profile.publicFacts === undefined ? {} : { publicFacts: character.profile.publicFacts.map(fact => fact) }),
        } })),
        characterLocations: cloneRecord(safe.state.characterLocations, location => location),
        characterStatuses: cloneRecord(safe.state.characterStatuses, cloneStatus),
        writerVisibleFacts: safe.state.facts.map(fact => ({ id: fact.id, text: fact.text, establishedChapter: fact.establishedChapter })),
        characterKnowledge: safe.state.characterKnowledge.map(entry => ({ characterId: entry.characterId, factIds: entry.factIds.map(id => id) })),
        relationships: safe.state.relationships.map(entry => ({ id: entry.id, participantIds: entry.participantIds.map(id => id), state: entry.state })),
        resources: cloneRecord(safe.state.resources, values => values.map(resource => ({ id: resource.id, name: resource.name, ...(resource.quantity === undefined ? {} : { quantity: resource.quantity }), ...(resource.state === undefined ? {} : { state: resource.state }) }))),
        continuity: {
            ...(safe.state.continuity.timelinePosition === undefined ? {} : { timelinePosition: safe.state.continuity.timelinePosition }),
            ...(safe.state.continuity.lastScene === undefined ? {} : { lastScene: safe.state.continuity.lastScene }),
            ...(safe.state.continuity.povCharacterId === undefined ? {} : { povCharacterId: safe.state.continuity.povCharacterId }),
            pendingThreads: safe.state.continuity.pendingThreads.map(entry => ({ text: entry.text, visibility: entry.visibility, establishedChapter: entry.establishedChapter })),
            notes: safe.state.continuity.notes.map(entry => ({ text: entry.text, visibility: entry.visibility, establishedChapter: entry.establishedChapter })),
        },
        unresolvedClues: safe.state.unresolvedClues.map(entry => ({ id: entry.id, text: entry.text, openedChapter: entry.openedChapter })),
        unresolvedPromises: safe.state.unresolvedPromises.map(entry => ({ id: entry.id, text: entry.text, openedChapter: entry.openedChapter })),
        activeCanonConstraints: chapterPlan.canonConstraints.map(entry => ({ id: entry.id, text: entry.text, scope: entry.scope })),
        controlledReveals: chapterPlan.reveals.map(entry => ({ id: entry.id, text: entry.text })),
        controlledRelationshipEvents: chapterPlan.relationshipEvents.map(entry => ({ id: entry.id, relationshipId: entry.relationshipId, eventType: entry.eventType, participantIds: entry.participantIds.map(id => id), ...(entry.text === undefined ? {} : { text: entry.text }) })),
        controlledStoryEvents: chapterPlan.storyEvents.map(entry => ({ id: entry.id, eventType: entry.eventType, ...(entry.text === undefined ? {} : { text: entry.text }) })),
        narrativeMemory: selectNarrativeMemory(memoryInput, plan.chapterNumber, memoryPolicy),
    };
};
