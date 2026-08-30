import { FullStoryControl, StoryArc, StoryBeat } from './types';
import { isValidChapter, maxRestrictionChapter } from './storyControl';

const controlIsFailClosed = (control: FullStoryControl): boolean =>
    control.kind === 'full-story-control' &&
    control.engine.schemaVersion === 4 &&
    control.engine.failClosed === true;

export const isCharacterDirectAppearanceAllowed = (
    control: FullStoryControl,
    characterId: string,
    chapter: number,
): boolean => {
    if (!controlIsFailClosed(control) || !isValidChapter(chapter)) return false;
    const character = control.characters[characterId];
    if (!character || !isValidChapter(character.availableFromChapter)) return false;
    const restrictions = control.gates.characters.filter(gate => gate.characterId === characterId);
    // Character appearance is critical: an absent explicit gate is denied.
    if (restrictions.length === 0) return false;
    const allowedFrom = maxRestrictionChapter([
        character.availableFromChapter,
        ...restrictions.map(gate => gate.allowedFromChapter),
    ]);
    return allowedFrom !== undefined && chapter >= allowedFrom;
};

export const isPovAllowed = (control: FullStoryControl, characterId: string, chapter: number): boolean => {
    if (!isCharacterDirectAppearanceAllowed(control, characterId, chapter)) return false;
    const restrictions = control.gates.pov.filter(gate => gate.characterId === characterId);
    if (restrictions.length === 0) return false;
    const allowedFrom = maxRestrictionChapter(restrictions.map(gate => gate.allowedFromChapter));
    return allowedFrom !== undefined && chapter >= allowedFrom;
};

export const isRevealAllowed = (control: FullStoryControl, revealId: string, chapter: number): boolean => {
    if (!controlIsFailClosed(control) || !isValidChapter(chapter)) return false;
    if (!control.reveals.some(reveal => reveal.id === revealId)) return false;
    const gates = control.gates.reveals.filter(gate => gate.revealId === revealId);
    if (gates.length === 0) return false;
    const forbidden = control.forbiddenReveals.filter(entry => entry.revealId === revealId);
    const allowedFrom = maxRestrictionChapter([
        ...gates.map(gate => gate.allowedFromChapter),
        ...forbidden.map(entry => entry.forbiddenThroughChapter + 1),
    ]);
    return allowedFrom !== undefined && chapter >= allowedFrom;
};

export const isRelationshipEventAllowed = (
    control: FullStoryControl,
    eventId: string,
    chapter: number,
): boolean => {
    if (!controlIsFailClosed(control) || !isValidChapter(chapter)) return false;
    const event = control.relationshipEvents.find(candidate => candidate.id === eventId);
    if (!event || event.participantIds.length < 2) return false;
    if (!event.participantIds.every(characterId => isCharacterDirectAppearanceAllowed(control, characterId, chapter))) return false;
    const gates = control.gates.relationships.filter(gate => gate.eventId === eventId);
    if (gates.length === 0) return false;
    const forbidden = control.forbiddenEvents.filter(entry => entry.eventId === eventId);
    const allowedFrom = maxRestrictionChapter([
        ...gates.map(gate => gate.allowedFromChapter),
        ...forbidden.map(entry => entry.forbiddenThroughChapter + 1),
    ]);
    return allowedFrom !== undefined && chapter >= allowedFrom;
};

export const getArcForChapter = (control: FullStoryControl, chapter: number): StoryArc | undefined => {
    if (!controlIsFailClosed(control) || !isValidChapter(chapter)) return undefined;
    const matches = control.arcs.filter(arc =>
        isValidChapter(arc.startChapter) &&
        isValidChapter(arc.endChapter) &&
        arc.startChapter <= arc.endChapter &&
        chapter >= arc.startChapter && chapter <= arc.endChapter);
    return matches.length === 1 ? matches[0] : undefined;
};

export const getBeatForChapter = (control: FullStoryControl, chapter: number): StoryBeat | undefined => {
    const arc = getArcForChapter(control, chapter);
    if (!arc) return undefined;
    const matches = control.beats.filter(beat =>
        beat.arcId === arc.id &&
        isValidChapter(beat.startChapter) &&
        isValidChapter(beat.endChapter) &&
        beat.startChapter <= beat.endChapter &&
        chapter >= beat.startChapter && chapter <= beat.endChapter);
    return matches.length === 1 ? matches[0] : undefined;
};

export const getAllowedCharactersForChapter = (control: FullStoryControl, chapter: number) =>
    control.characterOrder
        .filter(characterId => isCharacterDirectAppearanceAllowed(control, characterId, chapter))
        .map(characterId => control.characters[characterId]);
