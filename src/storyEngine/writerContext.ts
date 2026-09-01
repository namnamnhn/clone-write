import { buildWriterSafeContext } from './contextViews';
import { selectNarrativeMemory } from './contextBuilder';
import { isPovAllowed, isStoryEventAllowed } from './gates';
import {
    DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY,
    NarrativeMemoryInput,
    NarrativeMemorySelectionPolicy,
    SCENE_PURPOSE_TAGS,
    WriterChapterPlan,
} from './plannerTypes';
import { FullStoryControl, StoryState } from './types';
import { assertModelBoundaryStringsSecretSafe } from './secretTextSafety';
import { parseWriterStrategicDirectives } from './strategicContext';
import { validateWriterStrategicDirectives } from './writerStrategicValidator';
import { parseWriterRelationshipDirectives } from './relationshipRuntime';
import { validateWriterRelationshipDirectives } from './writerRelationshipValidator';
import { buildRelationshipGateValidationView } from './relationshipGateValidation';
import {
    DEFAULT_WRITER_CONTEXT_SELECTION_POLICY,
    WriterContext,
    WriterContextSelectionPolicy,
} from './writerTypes';

export class WriterContextError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || !value.trim()) throw new WriterContextError(`${field} must be a non-empty string`);
    return value;
};

const ids = (values: unknown, field: string): readonly string[] => {
    if (!Array.isArray(values) || !values.every(value => typeof value === 'string' && value.trim())) {
        throw new WriterContextError(`${field} must contain non-empty IDs`);
    }
    return values.map(value => value);
};

const noDuplicates = (values: readonly string[], field: string): void => {
    if (new Set(values).size !== values.length) throw new WriterContextError(`${field} must not contain duplicate IDs`);
};

const normalizeSelectionPolicy = (policy: WriterContextSelectionPolicy): WriterContextSelectionPolicy => {
    const keys: (keyof WriterContextSelectionPolicy)[] = [
        'maxCharacters', 'maxRelationships', 'maxFacts', 'maxUnresolvedClues',
        'maxUnresolvedPromises', 'maxContinuityEntries', 'maxResourcesPerCharacter',
    ];
    keys.forEach((key) => {
        if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) {
            throw new WriterContextError(`writer context selection policy ${key} must be a non-negative safe integer`);
        }
    });
    return {
        maxCharacters: policy.maxCharacters,
        maxRelationships: policy.maxRelationships,
        maxFacts: policy.maxFacts,
        maxUnresolvedClues: policy.maxUnresolvedClues,
        maxUnresolvedPromises: policy.maxUnresolvedPromises,
        maxContinuityEntries: policy.maxContinuityEntries,
        maxResourcesPerCharacter: policy.maxResourcesPerCharacter,
    };
};

const requireCapacity = (requiredCount: number, limit: number, field: string): void => {
    if (requiredCount > limit) throw new WriterContextError(`${field} has ${requiredCount} mandatory entries but limit is ${limit}`);
};

const selectRequiredThenRecent = <T extends { readonly id: string; readonly establishedChapter?: number; readonly openedChapter?: number; readonly text?: string }>(
    values: readonly T[],
    requiredIds: ReadonlySet<string>,
    limit: number,
    field: string,
): readonly T[] => {
    const required = values.filter(value => requiredIds.has(value.id));
    requireCapacity(required.length, limit, field);
    const requiredSet = new Set(required.map(value => value.id));
    const fallback = values
        .filter(value => !requiredSet.has(value.id))
        .map((value, index) => ({ value, index }))
        .sort((left, right) => (right.value.establishedChapter ?? right.value.openedChapter ?? 0) - (left.value.establishedChapter ?? left.value.openedChapter ?? 0)
            || left.value.id.localeCompare(right.value.id) || left.index - right.index)
        .slice(0, limit - required.length)
        .map(entry => entry.value);
    return [...required, ...fallback]
        .map((value, index) => ({ value, index }))
        .sort((left, right) => (left.value.establishedChapter ?? left.value.openedChapter ?? 0) - (right.value.establishedChapter ?? right.value.openedChapter ?? 0)
            || left.value.id.localeCompare(right.value.id) || left.index - right.index)
        .map(entry => entry.value);
};

/** Runtime validation and source-of-truth reconstruction for untrusted WriterChapterPlan input. */
const clonePlan = (
    plan: WriterChapterPlan,
    safe: ReturnType<typeof buildWriterSafeContext>,
    control: FullStoryControl,
): WriterChapterPlan => {
    if (!isRecord(plan) || plan.kind !== 'writer-chapter-plan' || !isRecord(plan.arc) || (plan.beat !== undefined && !isRecord(plan.beat))) throw new WriterContextError('plan must be a writer-chapter-plan');
    [
        'participantIds', 'scenes', 'canonConstraints', 'reveals', 'relationshipEvents', 'storyEvents',
        'cluesPlantedIds', 'cluesPaidOffIds', 'expectedResourceDeltas', 'expectedRelationshipDeltas', 'expectedContinuityConsequences',
        'strategicDirectives',
        'relationshipDirectives',
    ].forEach((field) => {
        if ((field === 'strategicDirectives' && plan.strategicDirectives === undefined)
            || (field === 'relationshipDirectives' && plan.relationshipDirectives === undefined)) return;
        if (!Array.isArray(plan[field as keyof WriterChapterPlan])) throw new WriterContextError(`plan.${field} must be an array`);
    });
    if (plan.chapterNumber !== safe.chapter) throw new WriterContextError('plan chapter must match target chapter');
    if (plan.arc.id !== safe.arc.id || plan.arc.title !== safe.arc.title) throw new WriterContextError('plan arc must match current arc');
    if ((plan.beat?.id ?? undefined) !== (safe.beat?.id ?? undefined)) throw new WriterContextError('plan beat must match current beat');
    const allowedCharacters = new Set(safe.characters.map(character => character.id));
    const chapterParticipants = ids(plan.participantIds, 'participantIds');
    noDuplicates(chapterParticipants, 'participantIds');
    if (!allowedCharacters.has(plan.povCharacterId) || !isPovAllowed(control, plan.povCharacterId, safe.chapter)) {
        throw new WriterContextError('plan POV is unavailable for this chapter');
    }
    if (!chapterParticipants.includes(plan.povCharacterId) || !chapterParticipants.every(id => allowedCharacters.has(id))) {
        throw new WriterContextError('plan participants must be currently writer-visible and include the POV');
    }
    if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) throw new WriterContextError('plan must contain at least one scene');
    plan.scenes.forEach((scene, index) => {
        if (!scene || typeof scene !== 'object') throw new WriterContextError(`scenes.${index} must be an object`);
        text(scene.id, `scenes.${index}.id`);
        text(scene.goal, `scenes.${index}.goal`);
        text(scene.location, `scenes.${index}.location`);
        text(scene.conflictOrObstacle, `scenes.${index}.conflictOrObstacle`);
        text(scene.uncertainty, `scenes.${index}.uncertainty`);
        text(scene.expectedConsequence, `scenes.${index}.expectedConsequence`);
        if (!Number.isSafeInteger(scene.order) || scene.order !== index + 1) throw new WriterContextError(`scenes.${index}.order must start at 1 and be consecutive`);
        const sceneParticipants = ids(scene.participantIds, `scenes.${index}.participantIds`);
        noDuplicates(sceneParticipants, `scenes.${index}.participantIds`);
        if (!allowedCharacters.has(scene.povCharacterId) || !isPovAllowed(control, scene.povCharacterId, safe.chapter)
            || !sceneParticipants.includes(scene.povCharacterId) || !sceneParticipants.every(id => allowedCharacters.has(id))
            || !sceneParticipants.every(id => chapterParticipants.includes(id))) {
            throw new WriterContextError(`scenes.${index} contains an unavailable, undeclared, or invalid POV participant`);
        }
        if (!Array.isArray(scene.purposeTags) || scene.purposeTags.length === 0 || !scene.purposeTags.every(tag => typeof tag === 'string' && SCENE_PURPOSE_TAGS.includes(tag as typeof SCENE_PURPOSE_TAGS[number]))) {
            throw new WriterContextError(`scenes.${index}.purposeTags must contain supported tags`);
        }
        if (scene.conflictImportance !== 'minor' && scene.conflictImportance !== 'major') {
            throw new WriterContextError(`scenes.${index}.conflictImportance must be minor or major`);
        }
    });

    const byId = <T extends { readonly id: string }>(values: readonly T[]): Map<string, T> => new Map(values.map(value => [value.id, value]));
    const canonById = byId(safe.canonRules);
    const revealById = byId(safe.reveals);
    const relationshipById = byId(safe.relationshipEvents);
    const storyById = byId(control.storyEvents.filter(event => isStoryEventAllowed(control, event.id, safe.chapter)));
    noDuplicates(plan.canonConstraints.map(value => value.id), 'canonConstraints');
    noDuplicates(plan.reveals.map(value => value.id), 'reveals');
    noDuplicates(plan.relationshipEvents.map(value => value.id), 'relationshipEvents');
    noDuplicates(plan.storyEvents.map(value => value.id), 'storyEvents');
    const suppliedCanonIds = new Set(plan.canonConstraints.map(value => value.id));
    if (suppliedCanonIds.size !== canonById.size || [...canonById.keys()].some(id => !suppliedCanonIds.has(id))) {
        throw new WriterContextError('canonConstraints must exactly match all active source-of-truth constraints');
    }

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
            || !source.participantIds.every(id => allowedCharacters.has(id) && chapterParticipants.includes(id))
            || source.participantIds.join('\u0000') !== entry.participantIds.join('\u0000') || source.writerText !== entry.text) {
            throw new WriterContextError(`relationshipEvents.${index} is not an allowed controlled event`);
        }
        return { id: source.id, relationshipId: source.relationshipId, eventType: source.eventType, participantIds: source.participantIds.map(id => id), ...(source.writerText === undefined ? {} : { text: source.writerText }) };
    });
    const storyEvents = plan.storyEvents.map((entry, index) => {
        const source = storyById.get(entry.id);
        if (!source || source.eventType !== entry.eventType || source.writerText !== entry.text) throw new WriterContextError(`storyEvents.${index} is not an allowed controlled event`);
        return { id: source.id, eventType: source.eventType, ...(source.writerText === undefined ? {} : { text: source.writerText }) };
    });

    const resourceDeltas = plan.expectedResourceDeltas.map((delta, index) => {
        text(delta.characterId, `expectedResourceDeltas.${index}.characterId`);
        text(delta.resourceId, `expectedResourceDeltas.${index}.resourceId`);
        if (!allowedCharacters.has(delta.characterId) || !chapterParticipants.includes(delta.characterId)) {
            throw new WriterContextError(`expectedResourceDeltas.${index}.characterId must be available and declared`);
        }
        if (delta.quantityDelta !== undefined && (typeof delta.quantityDelta !== 'number' || !Number.isFinite(delta.quantityDelta))) {
            throw new WriterContextError(`expectedResourceDeltas.${index}.quantityDelta must be a finite number when supplied`);
        }
        return { characterId: delta.characterId, resourceId: delta.resourceId, ...(delta.quantityDelta === undefined ? {} : { quantityDelta: delta.quantityDelta }), ...(delta.nextState === undefined ? {} : { nextState: text(delta.nextState, `expectedResourceDeltas.${index}.nextState`) }) };
    });
    const relationshipDeltas = plan.expectedRelationshipDeltas.map((delta, index) => {
        text(delta.relationshipId, `expectedRelationshipDeltas.${index}.relationshipId`);
        const participants = ids(delta.participantIds, `expectedRelationshipDeltas.${index}.participantIds`);
        noDuplicates(participants, `expectedRelationshipDeltas.${index}.participantIds`);
        if (participants.length < 2 || !participants.every(id => allowedCharacters.has(id) && chapterParticipants.includes(id))) {
            throw new WriterContextError(`expectedRelationshipDeltas.${index}.participantIds must contain two available declared characters`);
        }
        const declaredRelationship = safe.relationshipDefinitions.find(value => value.id === delta.relationshipId)
            ?? safe.state.relationships.find(value => value.id === delta.relationshipId)
            ?? safe.relationshipEvents.find(value => value.relationshipId === delta.relationshipId);
        if (!declaredRelationship || declaredRelationship.participantIds.join('\u0000') !== participants.join('\u0000')) {
            throw new WriterContextError(`expectedRelationshipDeltas.${index}.relationshipId must resolve with matching participants`);
        }
        return { relationshipId: delta.relationshipId, participantIds: participants, expectedState: text(delta.expectedState, `expectedRelationshipDeltas.${index}.expectedState`) };
    });
    let strategicDirectives: ReturnType<typeof parseWriterStrategicDirectives>;
    try {
        strategicDirectives = parseWriterStrategicDirectives(plan.strategicDirectives ?? []);
    } catch (error) {
        throw new WriterContextError(error instanceof Error ? error.message : 'strategicDirectives are invalid');
    }
    try {
        validateWriterStrategicDirectives({
            targetChapter: safe.chapter,
            participantIds: chapterParticipants,
            scenes: plan.scenes,
            expectedResourceDeltas: resourceDeltas,
            directives: strategicDirectives,
        }, safe);
    } catch (error) {
        throw new WriterContextError(error instanceof Error ? error.message : 'strategic directives are infeasible');
    }
    (['politics', 'military', 'commerce'] as const).forEach((domain) => plan.scenes.forEach((scene, index) => {
        if (scene.purposeTags.includes(domain)
            && !strategicDirectives.some(directive => directive.domain === domain && directive.sceneIds.includes(scene.id))) {
            throw new WriterContextError(`scenes.${index} lacks a matching strategic directive`);
        }
    }));
    let relationshipDirectives: ReturnType<typeof parseWriterRelationshipDirectives>;
    try {
        relationshipDirectives = parseWriterRelationshipDirectives(plan.relationshipDirectives ?? []);
        validateWriterRelationshipDirectives({
            participantIds: chapterParticipants,
            scenes: plan.scenes,
            expectedRelationshipDeltas: relationshipDeltas,
            relationshipEventIds: relationshipEvents.map(value => value.id),
            directives: relationshipDirectives,
        }, safe, buildRelationshipGateValidationView(control, safe.chapter));
    } catch (error) {
        throw new WriterContextError(error instanceof Error ? error.message : 'relationship directives are infeasible');
    }

    return {
        kind: 'writer-chapter-plan', chapterNumber: plan.chapterNumber,
        arc: { id: safe.arc.id, title: safe.arc.title, ...(safe.arc.writerBrief === undefined ? {} : { writerBrief: safe.arc.writerBrief }) },
        ...(safe.beat === undefined ? {} : { beat: { id: safe.beat.id, order: safe.beat.order, ...(safe.beat.writerBrief === undefined ? {} : { writerBrief: safe.beat.writerBrief }) } }),
        primaryGoal: text(plan.primaryGoal, 'primaryGoal'), povCharacterId: plan.povCharacterId, participantIds: chapterParticipants.map(id => id),
        scenes: plan.scenes.map(scene => ({ id: scene.id, order: scene.order, goal: scene.goal, location: scene.location, povCharacterId: scene.povCharacterId, participantIds: scene.participantIds.map(id => id), conflictOrObstacle: scene.conflictOrObstacle, uncertainty: scene.uncertainty, expectedConsequence: scene.expectedConsequence, purposeTags: scene.purposeTags.map(tag => tag), conflictImportance: scene.conflictImportance })),
        canonConstraints, reveals, relationshipEvents, storyEvents,
        cluesPlantedIds: ids(plan.cluesPlantedIds, 'cluesPlantedIds'), cluesPaidOffIds: ids(plan.cluesPaidOffIds, 'cluesPaidOffIds'),
        expectedResourceDeltas: resourceDeltas, expectedRelationshipDeltas: relationshipDeltas,
        expectedContinuityConsequences: plan.expectedContinuityConsequences.map((value, index) => ({ id: text(value.id, `expectedContinuityConsequences.${index}.id`), text: text(value.text, `expectedContinuityConsequences.${index}.text`) })),
        strategicDirectives,
        relationshipDirectives,
        endStateIntent: text(plan.endStateIntent, 'endStateIntent'),
    };
};

const selectCharacters = (
    safe: ReturnType<typeof buildWriterSafeContext>,
    plan: WriterChapterPlan,
    policy: WriterContextSelectionPolicy,
) => {
    const requiredIds = new Set(plan.participantIds);
    requireCapacity(requiredIds.size, policy.maxCharacters, 'characters');
    const ordered = safe.characters
        .map((character, index) => ({ character, index, required: requiredIds.has(character.id), active: safe.state.activeCharacterIds.includes(character.id), known: safe.state.knownCharacterIds.includes(character.id) }))
        .sort((left, right) => Number(right.required) - Number(left.required) || Number(right.active) - Number(left.active) || Number(right.known) - Number(left.known) || left.character.id.localeCompare(right.character.id) || left.index - right.index)
        .slice(0, policy.maxCharacters)
        .map(entry => entry.character);
    if (![...requiredIds].every(id => ordered.some(character => character.id === id))) throw new WriterContextError('character selection omitted a mandatory plan participant');
    return ordered;
};

/**
 * Reconstructs a bounded, Writer-only context from safe projections and a runtime-verified plan.
 * It deliberately does not spread or serialize FullStoryControl or StoryState.
 */
export const buildWriterContext = (
    control: FullStoryControl,
    state: StoryState,
    plan: WriterChapterPlan,
    memoryInput?: NarrativeMemoryInput,
    memoryPolicy: NarrativeMemorySelectionPolicy = DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY,
    suppliedSelectionPolicy: WriterContextSelectionPolicy = DEFAULT_WRITER_CONTEXT_SELECTION_POLICY,
): WriterContext => {
    assertModelBoundaryStringsSecretSafe(control, plan, 'writerChapterPlan');
    if (state.currentChapter > plan.chapterNumber) throw new WriterContextError('state current chapter must not be later than the target chapter');
    const selectionPolicy = normalizeSelectionPolicy(suppliedSelectionPolicy);
    const safe = buildWriterSafeContext(control, state, plan.chapterNumber);
    const chapterPlan = clonePlan(plan, safe, control);
    const characters = selectCharacters(safe, chapterPlan, selectionPolicy);
    const selectedIds = new Set(characters.map(character => character.id));
    const cloneStatus = (status: { readonly status?: string; readonly injuries: readonly string[]; readonly conditions: readonly string[] }) => ({ ...(status.status === undefined ? {} : { status: status.status }), injuries: status.injuries.map(injury => injury), conditions: status.conditions.map(condition => condition) });
    const cloneSelectedRecord = <T>(source: Readonly<Record<string, T>>, clone: (value: T) => T): Record<string, T> => {
        const output: Record<string, T> = {};
        [...selectedIds].sort().forEach((id) => { if (source[id] !== undefined) output[id] = clone(source[id]); });
        return output;
    };
    const selectedKnowledge = safe.state.characterKnowledge
        .filter(entry => selectedIds.has(entry.characterId))
        .map(entry => ({ characterId: entry.characterId, factIds: entry.factIds.map(id => id) }));
    const requiredFactIds = new Set(selectedKnowledge.flatMap(entry => entry.factIds));
    const facts = selectRequiredThenRecent(safe.state.facts, requiredFactIds, selectionPolicy.maxFacts, 'writerVisibleFacts')
        .map(fact => ({ id: fact.id, text: fact.text, establishedChapter: fact.establishedChapter }));
    const retainedFactIds = new Set(facts.map(fact => fact.id));
    const characterKnowledge = selectedKnowledge.map(entry => ({ characterId: entry.characterId, factIds: entry.factIds.filter(id => retainedFactIds.has(id)) }));
    const requiredRelationshipIds = new Set([
        ...chapterPlan.relationshipEvents.map(event => event.relationshipId),
        ...chapterPlan.expectedRelationshipDeltas.map(delta => delta.relationshipId),
        ...(chapterPlan.relationshipDirectives ?? []).map(directive => directive.relationshipId),
    ]);
    const eligibleRelationships = safe.state.relationships
        .filter(entry => entry.participantIds.every(id => selectedIds.has(id)));
    const requiredRelationships = eligibleRelationships.filter(entry => requiredRelationshipIds.has(entry.id));
    requireCapacity(requiredRelationships.length, selectionPolicy.maxRelationships, 'relationships');
    const requiredRelationshipSet = new Set(requiredRelationships.map(entry => entry.id));
    const relationships = [...requiredRelationships, ...eligibleRelationships
        .filter(entry => !requiredRelationshipSet.has(entry.id))
        .map((entry, index) => ({ entry, index }))
        .sort((left, right) => right.entry.establishedChapter - left.entry.establishedChapter || left.entry.id.localeCompare(right.entry.id) || left.index - right.index)
        .slice(0, selectionPolicy.maxRelationships - requiredRelationships.length)
        .map(item => item.entry)]
        .map((entry, index) => ({ entry, index }))
        .sort((left, right) => left.entry.establishedChapter - right.entry.establishedChapter || left.entry.id.localeCompare(right.entry.id) || left.index - right.index)
        .map(({ entry }) => ({ id: entry.id, participantIds: entry.participantIds.map(id => id), state: entry.state }));
    const planClueIds = new Set([...chapterPlan.cluesPlantedIds, ...chapterPlan.cluesPaidOffIds]);
    const unresolvedClues = selectRequiredThenRecent(safe.state.unresolvedClues, planClueIds, selectionPolicy.maxUnresolvedClues, 'unresolvedClues')
        .map(entry => ({ id: entry.id, text: entry.text, openedChapter: entry.openedChapter }));
    const unresolvedPromises = selectRequiredThenRecent(safe.state.unresolvedPromises, planClueIds, selectionPolicy.maxUnresolvedPromises, 'unresolvedPromises')
        .map(entry => ({ id: entry.id, text: entry.text, openedChapter: entry.openedChapter }));
    const consequenceTexts = new Set(chapterPlan.expectedContinuityConsequences.map(value => value.text));
    const selectContinuity = (entries: typeof safe.state.continuity.pendingThreads) => {
        const required = entries.filter(entry => consequenceTexts.has(entry.text));
        requireCapacity(required.length, selectionPolicy.maxContinuityEntries, 'continuity entries');
        const fallback = entries
            .filter(entry => !consequenceTexts.has(entry.text))
            .map((entry, index) => ({ entry, index }))
            .sort((left, right) => right.entry.establishedChapter - left.entry.establishedChapter || left.entry.text.localeCompare(right.entry.text) || left.index - right.index)
            .slice(0, selectionPolicy.maxContinuityEntries - required.length)
            .map(item => item.entry);
        return [...required, ...fallback]
            .map((entry, index) => ({ entry, index }))
            .sort((left, right) => left.entry.establishedChapter - right.entry.establishedChapter || left.entry.text.localeCompare(right.entry.text) || left.index - right.index)
            .map(item => ({ text: item.entry.text, visibility: item.entry.visibility, establishedChapter: item.entry.establishedChapter }));
    };
    const requiredResourceIds = new Map<string, Set<string>>();
    chapterPlan.expectedResourceDeltas.forEach(delta => {
        const values = requiredResourceIds.get(delta.characterId) ?? new Set<string>();
        values.add(delta.resourceId);
        requiredResourceIds.set(delta.characterId, values);
    });
    const resources: Record<string, readonly { readonly id: string; readonly name: string; readonly quantity?: number; readonly state?: string }[]> = {};
    [...selectedIds].sort().forEach((characterId) => {
        const values = safe.state.resources[characterId];
        if (!values) return;
        const mandatoryIds = requiredResourceIds.get(characterId) ?? new Set<string>();
        const required = values.filter(value => mandatoryIds.has(value.id));
        requireCapacity(required.length, selectionPolicy.maxResourcesPerCharacter, 'resources');
        const requiredSet = new Set(required.map(value => value.id));
        resources[characterId] = [...required, ...values.filter(value => !requiredSet.has(value.id)).slice().sort((left, right) => left.id.localeCompare(right.id)).slice(0, selectionPolicy.maxResourcesPerCharacter - required.length)]
            .map(resource => ({ id: resource.id, name: resource.name, ...(resource.quantity === undefined ? {} : { quantity: resource.quantity }), ...(resource.state === undefined ? {} : { state: resource.state }) }));
    });
    const context: WriterContext = {
        kind: 'writer-context', targetChapter: safe.chapter,
        currentArc: { id: safe.arc.id, title: safe.arc.title, ...(safe.arc.writerBrief === undefined ? {} : { writerBrief: safe.arc.writerBrief }) },
        ...(safe.beat === undefined ? {} : { currentBeat: { id: safe.beat.id, order: safe.beat.order, ...(safe.beat.writerBrief === undefined ? {} : { writerBrief: safe.beat.writerBrief }) } }),
        chapterPlan,
        characters: characters.map(character => ({ id: character.id, name: character.name, profile: { ...(character.profile.role === undefined ? {} : { role: character.profile.role }), ...(character.profile.appearance === undefined ? {} : { appearance: character.profile.appearance }), ...(character.profile.personality === undefined ? {} : { personality: character.profile.personality }), ...(character.profile.publicFacts === undefined ? {} : { publicFacts: character.profile.publicFacts.map(fact => fact) }) } })),
        characterLocations: cloneSelectedRecord(safe.state.characterLocations, location => location),
        characterStatuses: cloneSelectedRecord(safe.state.characterStatuses, cloneStatus),
        writerVisibleFacts: facts, characterKnowledge, relationships,
        resources,
        continuity: { ...(safe.state.continuity.timelinePosition === undefined ? {} : { timelinePosition: safe.state.continuity.timelinePosition }), ...(safe.state.continuity.lastScene === undefined ? {} : { lastScene: safe.state.continuity.lastScene }), ...(safe.state.continuity.povCharacterId === undefined || !selectedIds.has(safe.state.continuity.povCharacterId) ? {} : { povCharacterId: safe.state.continuity.povCharacterId }), pendingThreads: selectContinuity(safe.state.continuity.pendingThreads), notes: selectContinuity(safe.state.continuity.notes) },
        unresolvedClues, unresolvedPromises,
        activeCanonConstraints: chapterPlan.canonConstraints.map(entry => ({ id: entry.id, text: entry.text, scope: entry.scope })),
        controlledReveals: chapterPlan.reveals.map(entry => ({ id: entry.id, text: entry.text })),
        controlledRelationshipEvents: chapterPlan.relationshipEvents.map(entry => ({ id: entry.id, relationshipId: entry.relationshipId, eventType: entry.eventType, participantIds: entry.participantIds.map(id => id), ...(entry.text === undefined ? {} : { text: entry.text }) })),
        controlledStoryEvents: chapterPlan.storyEvents.map(entry => ({ id: entry.id, eventType: entry.eventType, ...(entry.text === undefined ? {} : { text: entry.text }) })),
        narrativeMemory: selectNarrativeMemory(memoryInput, plan.chapterNumber, memoryPolicy),
    };
    assertModelBoundaryStringsSecretSafe(control, context, 'writerContext');
    return context;
};
