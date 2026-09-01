import type { RelationshipEvidenceRef } from './relationshipTypes';

export interface RelationshipEvidenceAdequacyAction {
    readonly actionType: string;
    readonly importance: 'minor' | 'major';
    readonly participantIds: readonly string[];
    readonly participantActorIds: readonly string[];
    readonly jealousCharacterId?: string;
    readonly direction: 'strengthening' | 'stable' | 'weakening' | 'conflicted';
    readonly evidenceRefs: readonly RelationshipEvidenceRef[];
}

/** Pure causal-adequacy checks shared by source and privileged Validator boundaries. */
export const relationshipEvidenceAdequacyProblems = (
    action: RelationshipEvidenceAdequacyAction,
): readonly string[] => {
    const problems: string[] = [];
    if ((action.importance === 'major' || action.direction !== 'stable') && action.evidenceRefs.length === 0) {
        problems.push('major or changing relationship action requires canonical evidence');
    }
    const facts = action.evidenceRefs.filter((value): value is Extract<RelationshipEvidenceRef, { type: 'fact' }> => value.type === 'fact');
    if (action.direction === 'strengthening' && facts.some(fact => action.participantIds.some(characterId =>
        !action.evidenceRefs.some(reference => reference.type === 'knowledge'
            && reference.characterId === characterId && reference.factId === fact.id)))) {
        problems.push('each reacting participant needs exact character-specific knowledge of every causal fact');
    }
    if (action.actionType === 'jealousy') {
        const subject = action.jealousCharacterId;
        const subjectValid = subject !== undefined && action.participantIds.includes(subject) && action.participantActorIds.includes(subject);
        const factTriggerOwned = facts.length === 0 || (subject !== undefined && facts.every(fact => action.evidenceRefs.some(reference =>
            reference.type === 'knowledge' && reference.characterId === subject && reference.factId === fact.id)));
        const subjectTrigger = subject !== undefined && action.evidenceRefs.some(reference =>
            (reference.type === 'knowledge' || reference.type === 'belief') && reference.characterId === subject);
        if (!subjectValid || !factTriggerOwned || !subjectTrigger) {
            problems.push('jealousy requires a participant subject who owns the exact canonical knowledge or belief trigger');
        }
    } else if (action.jealousCharacterId !== undefined) {
        problems.push('jealousy subject is supported only for jealousy actions');
    }
    return problems;
};
