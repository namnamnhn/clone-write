import {
    ChapterNumber,
    FullStoryControl,
    StoryArc,
    StoryBeat,
} from './types';

export interface StoryControlValidationIssue {
    readonly path: string;
    readonly message: string;
}

export class StoryControlValidationError extends Error {
    constructor(public readonly issues: readonly StoryControlValidationIssue[]) {
        super(issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
        this.name = 'StoryControlValidationError';
    }
}

export const isValidChapter = (chapter: number): chapter is ChapterNumber =>
    Number.isSafeInteger(chapter) && chapter >= 1;

export const maxRestrictionChapter = (chapters: readonly number[]): number | undefined => {
    if (chapters.length === 0 || chapters.some(chapter => !isValidChapter(chapter))) return undefined;
    return Math.max(...chapters);
};

const rangesOverlap = (
    left: Pick<StoryArc | StoryBeat, 'startChapter' | 'endChapter'>,
    right: Pick<StoryArc | StoryBeat, 'startChapter' | 'endChapter'>,
): boolean => left.startChapter <= right.endChapter && right.startChapter <= left.endChapter;

export const validateFullStoryControl = (control: FullStoryControl): readonly StoryControlValidationIssue[] => {
    const issues: StoryControlValidationIssue[] = [];
    const issue = (path: string, message: string) => issues.push({ path, message });

    if (control.kind !== 'full-story-control') issue('kind', 'must be full-story-control');
    if (!control.id.trim()) issue('id', 'must not be empty');
    if (control.engine.schemaVersion !== 4) issue('engine.schemaVersion', 'must be 4');
    if (control.engine.failClosed !== true) issue('engine.failClosed', 'must remain enabled');
    if (!isValidChapter(control.engine.plannedChapterCount)) issue('engine.plannedChapterCount', 'must be a positive integer');

    const characterIds = new Set(Object.keys(control.characters));
    for (const id of control.characterOrder) {
        if (!characterIds.has(id)) issue('characterOrder', `references unknown character ${id}`);
    }
    for (const [id, character] of Object.entries(control.characters)) {
        if (character.id !== id) issue(`characters.${id}.id`, 'must match registry key');
        if (!character.name.trim()) issue(`characters.${id}.name`, 'must not be empty');
        if (!isValidChapter(character.availableFromChapter)) issue(`characters.${id}.availableFromChapter`, 'must be a positive integer');
    }

    const arcIds = new Set<string>();
    control.arcs.forEach((arc, index) => {
        if (!arc.id.trim() || arcIds.has(arc.id)) issue(`arcs.${index}.id`, 'must be non-empty and unique');
        arcIds.add(arc.id);
        if (!isValidChapter(arc.startChapter) || !isValidChapter(arc.endChapter) || arc.startChapter > arc.endChapter) {
            issue(`arcs.${index}`, 'must have a valid inclusive chapter range');
        }
        if (arc.endChapter > control.engine.plannedChapterCount) issue(`arcs.${index}.endChapter`, 'exceeds planned chapter count');
        for (let other = 0; other < index; other += 1) {
            if (rangesOverlap(arc, control.arcs[other])) issue(`arcs.${index}`, `overlaps arc ${control.arcs[other].id}`);
        }
    });

    const beatIds = new Set<string>();
    control.beats.forEach((beat, index) => {
        if (!beat.id.trim() || beatIds.has(beat.id)) issue(`beats.${index}.id`, 'must be non-empty and unique');
        beatIds.add(beat.id);
        const arc = control.arcs.find(candidate => candidate.id === beat.arcId);
        if (!arc) issue(`beats.${index}.arcId`, `references unknown arc ${beat.arcId}`);
        if (!Number.isSafeInteger(beat.order) || beat.order < 0) issue(`beats.${index}.order`, 'must be a non-negative integer');
        if (!isValidChapter(beat.startChapter) || !isValidChapter(beat.endChapter) || beat.startChapter > beat.endChapter) {
            issue(`beats.${index}`, 'must have a valid inclusive chapter range');
        } else if (arc && (beat.startChapter < arc.startChapter || beat.endChapter > arc.endChapter)) {
            issue(`beats.${index}`, 'must stay inside its arc range');
        }
        for (let other = 0; other < index; other += 1) {
            const candidate = control.beats[other];
            if (candidate.arcId === beat.arcId && rangesOverlap(beat, candidate)) issue(`beats.${index}`, `overlaps beat ${candidate.id}`);
        }
    });

    const revealIds = new Set(control.reveals.map(reveal => reveal.id));
    const eventIds = new Set(control.relationshipEvents.map(event => event.id));
    const checkAllowedFrom = (path: string, chapter: number) => {
        if (!isValidChapter(chapter)) issue(path, 'must be a positive first-allowed chapter');
    };
    control.gates.characters.forEach((gate, index) => {
        if (!characterIds.has(gate.characterId)) issue(`gates.characters.${index}.characterId`, `references unknown character ${gate.characterId}`);
        checkAllowedFrom(`gates.characters.${index}.allowedFromChapter`, gate.allowedFromChapter);
    });
    control.gates.pov.forEach((gate, index) => {
        if (!characterIds.has(gate.characterId)) issue(`gates.pov.${index}.characterId`, `references unknown character ${gate.characterId}`);
        checkAllowedFrom(`gates.pov.${index}.allowedFromChapter`, gate.allowedFromChapter);
    });
    control.gates.reveals.forEach((gate, index) => {
        if (!revealIds.has(gate.revealId)) issue(`gates.reveals.${index}.revealId`, `references unknown reveal ${gate.revealId}`);
        checkAllowedFrom(`gates.reveals.${index}.allowedFromChapter`, gate.allowedFromChapter);
    });
    control.gates.relationships.forEach((gate, index) => {
        if (!eventIds.has(gate.eventId)) issue(`gates.relationships.${index}.eventId`, `references unknown event ${gate.eventId}`);
        checkAllowedFrom(`gates.relationships.${index}.allowedFromChapter`, gate.allowedFromChapter);
    });
    control.forbiddenEvents.forEach((entry, index) => {
        if (!eventIds.has(entry.eventId)) issue(`forbiddenEvents.${index}.eventId`, `references unknown event ${entry.eventId}`);
        if (!Number.isSafeInteger(entry.forbiddenThroughChapter) || entry.forbiddenThroughChapter < 0) issue(`forbiddenEvents.${index}.forbiddenThroughChapter`, 'must be a non-negative integer');
    });
    control.forbiddenReveals.forEach((entry, index) => {
        if (!revealIds.has(entry.revealId)) issue(`forbiddenReveals.${index}.revealId`, `references unknown reveal ${entry.revealId}`);
        if (!Number.isSafeInteger(entry.forbiddenThroughChapter) || entry.forbiddenThroughChapter < 0) issue(`forbiddenReveals.${index}.forbiddenThroughChapter`, 'must be a non-negative integer');
    });
    control.authorOnlySecrets.forEach((secret, index) => {
        if (!secret.id.trim() || !secret.value.trim()) issue(`authorOnlySecrets.${index}`, 'must have a non-empty id and value');
        if (secret.revealId && !revealIds.has(secret.revealId)) issue(`authorOnlySecrets.${index}.revealId`, `references unknown reveal ${secret.revealId}`);
    });
    control.relationshipEvents.forEach((event, index) => {
        if (event.participantIds.length < 2) issue(`relationshipEvents.${index}.participantIds`, 'must contain at least two characters');
        event.participantIds.forEach(id => {
            if (!characterIds.has(id)) issue(`relationshipEvents.${index}.participantIds`, `references unknown character ${id}`);
        });
    });
    control.canonRules.forEach((rule, index) => {
        if (!isValidChapter(rule.availableFromChapter)) issue(`canonRules.${index}.availableFromChapter`, 'must be a positive integer');
        if (rule.expiresAfterChapter !== undefined && (!isValidChapter(rule.expiresAfterChapter) || rule.expiresAfterChapter < rule.availableFromChapter)) {
            issue(`canonRules.${index}.expiresAfterChapter`, 'must not precede availability');
        }
    });

    return issues;
};

export const deepFreezeStoryControl = (control: FullStoryControl): FullStoryControl => {
    const freeze = (value: unknown): void => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
        Object.freeze(value);
        for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    };
    freeze(control);
    return control;
};
