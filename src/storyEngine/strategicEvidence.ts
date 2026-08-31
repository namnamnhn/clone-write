import type { PlanValidationIssue, PlannerContext } from './plannerTypes';
import type {
    StrategicActionPlan,
    StrategicEvidenceRef,
    StrategicIssueCode,
    StrategicResourceEffect,
} from './strategicTypes';

export const strategicIssue = (
    code: StrategicIssueCode,
    path: string,
    message: string,
): PlanValidationIssue => ({ code, path, message, severity: 'error' });

export const isMeaningfulText = (value: string): boolean => {
    const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US')
        .replace(/[\p{P}\p{S}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.length > 0
        && !['none', 'no cost', 'no tradeoff', 'not applicable', 'n a', 'na'].includes(normalized);
};

export const factExists = (context: PlannerContext, factId: string): boolean =>
    context.writerVisibleFacts.some(fact => fact.id === factId)
    || context.internalFacts.some(fact => fact.id === factId);

export const strategicCharacterKnowsFact = (
    context: PlannerContext,
    characterId: string,
    factId: string,
): boolean => context.characterKnowledge.some(entry =>
    entry.characterId === characterId && entry.factIds.includes(factId));

export const resourceFor = (
    context: PlannerContext,
    characterId: string,
    resourceId: string,
) => context.resources[characterId]?.find(resource => resource.id === resourceId);

export const relationshipExists = (context: PlannerContext, relationshipId: string): boolean =>
    context.relationships.some(relationship => relationship.id === relationshipId);

export const evidenceIdentity = (reference: StrategicEvidenceRef): string => {
    switch (reference.type) {
        case 'fact':
        case 'relationship':
        case 'canon-rule': return `${reference.type}\u0000${reference.id}`;
        case 'knowledge': return `${reference.type}\u0000${reference.characterId}\u0000${reference.factId}`;
        case 'resource': return `${reference.type}\u0000${reference.characterId}\u0000${reference.resourceId}`;
        case 'character-status': return `${reference.type}\u0000${reference.characterId}\u0000${reference.value}`;
    }
};

export const validateEvidenceReference = (
    reference: StrategicEvidenceRef,
    context: PlannerContext,
    path: string,
): readonly PlanValidationIssue[] => {
    const invalid = () => [strategicIssue('STRATEGIC_REFERENCE_INVALID', path, 'strategic evidence does not resolve in the target-chapter context')];
    switch (reference.type) {
        case 'fact': return factExists(context, reference.id) ? [] : invalid();
        case 'knowledge': return factExists(context, reference.factId)
            && strategicCharacterKnowsFact(context, reference.characterId, reference.factId) ? [] : invalid();
        case 'relationship': return relationshipExists(context, reference.id) ? [] : invalid();
        case 'resource': return resourceFor(context, reference.characterId, reference.resourceId) ? [] : invalid();
        case 'canon-rule': return context.activeHardConstraints.some(rule => rule.referenceId === reference.id) ? [] : invalid();
        case 'character-status': {
            const character = context.availableCharacters.find(candidate => candidate.id === reference.characterId);
            const values = character === undefined ? [] : [
                character.status?.status,
                ...(character.status?.injuries ?? []),
                ...(character.status?.conditions ?? []),
            ].filter((value): value is string => value !== undefined);
            return values.includes(reference.value) ? [] : invalid();
        }
    }
};

export const collectActionEvidence = (action: StrategicActionPlan): readonly StrategicEvidenceRef[] => {
    const common: StrategicEvidenceRef[] = [];
    if (action.domain === 'politics') {
        action.dimensions.forEach(dimension => common.push(...dimension.evidenceRefs));
    } else if (action.domain === 'military') {
        action.readiness.forEach(dimension => common.push(...dimension.evidenceRefs));
    } else {
        common.push(...action.sourceEvidenceRefs);
    }
    return common;
};

export const actionResourceEffects = (action: StrategicActionPlan): readonly StrategicResourceEffect[] =>
    action.domain === 'commerce' ? action.resourceFlows : action.resourceEffects;

export const resourceKey = (characterId: string, resourceId: string): string =>
    `${characterId}\u0000${resourceId}`;

export const sortedUnique = (values: readonly string[]): readonly string[] =>
    [...new Set(values)].sort((left, right) => left.localeCompare(right));
