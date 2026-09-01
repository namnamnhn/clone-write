import type { FullStoryControl } from './types';

export const normalizeSecretSafetyText = (value: string): string =>
    value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();

export const containsProtectedAuthorSecret = (control: FullStoryControl, value: string): boolean => {
    const normalized = normalizeSecretSafetyText(value);
    return control.authorOnlySecrets.some((secret) => {
        const protectedValue = normalizeSecretSafetyText(secret.value);
        return protectedValue.length > 0 && normalized.includes(protectedValue);
    });
};

export interface WriterFacingSecretSafetyIssue { readonly path: string; }

const writerFacingControlText = (control: FullStoryControl): readonly { readonly path: string; readonly value: string }[] => [
    ...Object.values(control.characters).flatMap((character, characterIndex) => [
        { path: `characters.${characterIndex}.name`, value: character.name },
        ...(['role', 'appearance', 'personality'] as const).flatMap(key => character.writerProfile[key] === undefined ? [] : [{ path: `characters.${characterIndex}.writerProfile.${key}`, value: character.writerProfile[key] }]),
        ...(character.writerProfile.publicFacts ?? []).map((value, index) => ({ path: `characters.${characterIndex}.writerProfile.publicFacts.${index}`, value })),
    ]),
    ...control.arcs.flatMap((arc, index) => [
        { path: `arcs.${index}.title`, value: arc.title },
        ...(arc.writerBrief === undefined ? [] : [{ path: `arcs.${index}.writerBrief`, value: arc.writerBrief }]),
    ]),
    ...control.beats.flatMap((beat, index) => beat.writerBrief === undefined ? [] : [{ path: `beats.${index}.writerBrief`, value: beat.writerBrief }]),
    ...control.reveals.map((reveal, index) => ({ path: `reveals.${index}.writerText`, value: reveal.writerText })),
    ...control.relationshipDefinitions.flatMap((definition, index) => [
        ...definition.dynamicProfile.dominantConflictSources.map((value, valueIndex) => ({ path: `relationshipDefinitions.${index}.dynamicProfile.dominantConflictSources.${valueIndex}`, value })),
        ...definition.dynamicProfile.trustBasis.map((value, valueIndex) => ({ path: `relationshipDefinitions.${index}.dynamicProfile.trustBasis.${valueIndex}`, value })),
        ...definition.dynamicProfile.respectBasis.map((value, valueIndex) => ({ path: `relationshipDefinitions.${index}.dynamicProfile.respectBasis.${valueIndex}`, value })),
    ]),
    ...control.relationshipEvents.flatMap((event, index) => [
        { path: `relationshipEvents.${index}.eventType`, value: event.eventType },
        ...(event.writerText === undefined ? [] : [{ path: `relationshipEvents.${index}.writerText`, value: event.writerText }]),
    ]),
    ...control.storyEvents.flatMap((event, index) => [
        { path: `storyEvents.${index}.eventType`, value: event.eventType },
        ...(event.writerText === undefined ? [] : [{ path: `storyEvents.${index}.writerText`, value: event.writerText }]),
    ]),
    ...control.canonRules.map((rule, index) => ({ path: `canonRules.${index}.text`, value: rule.text })),
];

export const getWriterFacingControlSecretSafetyIssues = (control: FullStoryControl): readonly WriterFacingSecretSafetyIssue[] =>
    writerFacingControlText(control).filter(entry => containsProtectedAuthorSecret(control, entry.value)).map(entry => ({ path: entry.path }));

export class WriterFacingSecretBoundaryError extends Error {
    constructor(readonly path: string) {
        super('writer-facing text contains protected author material');
        this.name = 'WriterFacingSecretBoundaryError';
    }
}

export const assertWriterFacingTextSecretSafe = (control: FullStoryControl, value: string, path: string): void => {
    if (containsProtectedAuthorSecret(control, value)) throw new WriterFacingSecretBoundaryError(path);
};

export const assertWriterFacingControlSecretSafe = (control: FullStoryControl): void => {
    const issue = getWriterFacingControlSecretSafetyIssues(control)[0];
    if (issue) throw new WriterFacingSecretBoundaryError(issue.path);
};

/** Recursively checks a bounded, already allow-listed model-boundary object. */
export const assertModelBoundaryStringsSecretSafe = (control: FullStoryControl, value: unknown, path: string): void => {
    if (typeof value === 'string') return assertWriterFacingTextSecretSafe(control, value, path);
    if (Array.isArray(value)) return value.forEach((entry, index) => assertModelBoundaryStringsSecretSafe(control, entry, `${path}[${index}]`));
    if (typeof value !== 'object' || value === null) return;
    Object.entries(value).forEach(([key, entry]) => assertModelBoundaryStringsSecretSafe(control, entry, `${path}.${key}`));
};
