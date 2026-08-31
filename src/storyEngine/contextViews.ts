import {
    CharacterKnowledge,
    FullStoryControl,
    OpenThread,
    StoryFact,
    StoryId,
    StoryState,
    WriterSafeContext,
} from './types';
import {
    getAllowedCharactersForChapter,
    getArcForChapter,
    getBeatForChapter,
    isRelationshipEventAllowed,
    isRevealAllowed,
} from './gates';
import { isValidChapter } from './storyControl';
import { assertWriterFacingControlSecretSafe } from './secretTextSafety';

const pickRecord = <T>(source: Readonly<Record<string, T>>, allowedIds: ReadonlySet<string>): Record<string, T> => {
    const output: Record<string, T> = {};
    for (const id of [...allowedIds].sort()) {
        if (Object.prototype.hasOwnProperty.call(source, id)) output[id] = source[id];
    }
    return output;
};

const safeThreads = (threads: readonly OpenThread[], chapter: number): readonly OpenThread[] =>
    threads.filter(thread => thread.visibility === 'writer' && thread.openedChapter <= chapter);

const safeFacts = (facts: readonly StoryFact[], chapter: number): readonly StoryFact[] =>
    facts.filter(fact => fact.visibility === 'writer' && fact.establishedChapter <= chapter);

const safeContinuityEntries = <T extends { readonly visibility: 'writer' | 'internal'; readonly establishedChapter: number }>(
    entries: readonly T[],
    chapter: number,
): readonly T[] => entries.filter(entry => entry.visibility === 'writer' && entry.establishedChapter <= chapter);

const safeKnowledge = (
    knowledge: readonly CharacterKnowledge[],
    allowedCharacterIds: ReadonlySet<StoryId>,
    allowedFactIds: ReadonlySet<StoryId>,
): readonly CharacterKnowledge[] => knowledge
    .filter(entry => allowedCharacterIds.has(entry.characterId))
    .map(entry => ({
        characterId: entry.characterId,
        factIds: entry.factIds.filter(factId => allowedFactIds.has(factId)),
    }));

/**
 * Build a Writer view by constructing every property from an allow-list. This function never
 * spreads FullStoryControl, author-only secrets, author notes, future arcs, or state extensions.
 */
export const buildWriterSafeContext = (
    control: FullStoryControl,
    state: StoryState,
    chapter: number = state.currentChapter,
): WriterSafeContext => {
    assertWriterFacingControlSecretSafe(control);
    if (!isValidChapter(chapter) || chapter > control.engine.plannedChapterCount) {
        throw new Error('chapter must be within the planned story range');
    }

    const arc = getArcForChapter(control, chapter);
    const beat = getBeatForChapter(control, chapter);
    if (!arc) throw new Error(`no unique arc resolves for chapter ${chapter}`);
    const arcUsesBeats = control.beats.some(candidate => candidate.arcId === arc.id);
    if (arcUsesBeats && !beat) throw new Error(`no unique beat resolves for chapter ${chapter} in arc ${arc.id}`);
    const allowedCharacters = getAllowedCharactersForChapter(control, chapter);
    const allowedCharacterIds = new Set(allowedCharacters.map(character => character.id));
    const facts = safeFacts(state.facts, chapter);
    const factIds = new Set(facts.map(fact => fact.id));

    return {
        kind: 'writer-safe-context',
        storyControlId: control.id,
        chapter,
        arc: {
            id: arc.id,
            title: arc.title,
            ...(arc.writerBrief === undefined ? {} : { writerBrief: arc.writerBrief }),
        },
        ...(beat ? {
            beat: {
                id: beat.id,
                order: beat.order,
                ...(beat.writerBrief === undefined ? {} : { writerBrief: beat.writerBrief }),
            },
        } : {}),
        characters: allowedCharacters.map(character => ({
            id: character.id,
            name: character.name,
            profile: character.writerProfile,
        })),
        canonRules: control.canonRules
            .filter(rule => rule.availableFromChapter <= chapter && (rule.expiresAfterChapter === undefined || chapter <= rule.expiresAfterChapter))
            .map(rule => ({ id: rule.id, text: rule.text, scope: rule.scope })),
        reveals: control.reveals
            .filter(reveal => isRevealAllowed(control, reveal.id, chapter))
            .map(reveal => ({ id: reveal.id, text: reveal.writerText })),
        relationshipDefinitions: control.relationshipDefinitions
            .filter(definition => definition.participantIds.every(id => allowedCharacterIds.has(id)))
            .map(definition => ({
                id: definition.id,
                participantIds: [...definition.participantIds],
                categories: [...definition.categories],
                initialRomanceMilestone: definition.initialRomanceMilestone,
                dynamicProfile: {
                    coreDynamicTags: [...definition.dynamicProfile.coreDynamicTags],
                    dominantConflictSources: [...definition.dynamicProfile.dominantConflictSources],
                    trustBasis: [...definition.dynamicProfile.trustBasis],
                    respectBasis: [...definition.dynamicProfile.respectBasis],
                    prohibitedShortcuts: [...definition.dynamicProfile.prohibitedShortcuts],
                },
                progressionPolicy: { ...definition.progressionPolicy },
            })),
        relationshipEvents: control.relationshipEvents
            .filter(event => isRelationshipEventAllowed(control, event.id, chapter))
            .map(event => ({
                id: event.id,
                relationshipId: event.relationshipId,
                eventType: event.eventType,
                participantIds: event.participantIds,
                ...(event.writerText === undefined ? {} : { writerText: event.writerText }),
                ...(event.authorizedRomanceMilestone === undefined ? {} : { authorizedRomanceMilestone: event.authorizedRomanceMilestone }),
            })),
        state: {
            currentChapter: chapter,
            knownCharacterIds: state.knownCharacterIds.filter(id => allowedCharacterIds.has(id)),
            activeCharacterIds: state.activeCharacterIds.filter(id => allowedCharacterIds.has(id)),
            characterLocations: pickRecord(state.characterLocations, allowedCharacterIds),
            characterStatuses: pickRecord(state.characterStatuses, allowedCharacterIds),
            facts,
            characterKnowledge: safeKnowledge(state.characterKnowledge, allowedCharacterIds, factIds),
            relationships: state.relationships.filter(relationship =>
                relationship.establishedChapter <= chapter &&
                relationship.participantIds.every(id => allowedCharacterIds.has(id))),
            unresolvedClues: safeThreads(state.unresolvedClues, chapter),
            unresolvedPromises: safeThreads(state.unresolvedPromises, chapter),
            resources: pickRecord(state.resources, allowedCharacterIds),
            continuity: {
                ...(state.continuity.timelinePosition === undefined ? {} : { timelinePosition: state.continuity.timelinePosition }),
                ...(state.continuity.lastScene === undefined ? {} : { lastScene: state.continuity.lastScene }),
                ...(state.continuity.povCharacterId && allowedCharacterIds.has(state.continuity.povCharacterId)
                    ? { povCharacterId: state.continuity.povCharacterId }
                    : {}),
                pendingThreads: safeContinuityEntries(state.continuity.pendingThreads, chapter),
                notes: safeContinuityEntries(state.continuity.notes, chapter),
            },
        },
    };
};
