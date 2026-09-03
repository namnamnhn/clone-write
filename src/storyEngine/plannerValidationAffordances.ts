import type { PlannerContext } from './plannerTypes';
import { STRATEGIC_DOMAINS } from './strategicTypes';

export interface PlannerValidationAffordances {
    readonly targetChapter: number;
    readonly currentArcId: string;
    readonly currentBeatId: string | null;
    readonly allowedPovIds: readonly string[];
    readonly availableCharacterIds: readonly string[];
    readonly allowedRevealIds: readonly string[];
    readonly allowedStoryEventIds: readonly string[];
    readonly allowedRelationshipEventIds: readonly string[];
    readonly relationshipDefinitions: readonly {
        readonly id: string;
        readonly participantIds: readonly string[];
    }[];
    readonly canonicalRelationshipIds: readonly string[];
    readonly characterKnowledgeFactIdsByCharacter: Readonly<Record<string, readonly string[]>>;
    readonly strategicDomainTags: typeof STRATEGIC_DOMAINS;
    readonly relationshipSceneTag: 'relationship';
}

/**
 * Projects target-valid identifiers from the already bounded PlannerContext. This is guidance for
 * model selection only; the strict plan parser and semantic validators remain authoritative.
 */
export const buildPlannerValidationAffordances = (
    context: PlannerContext,
): PlannerValidationAffordances => {
    const availableCharacterIds = context.availableCharacters.map(character => character.id);
    const canonicalKnowledge = new Map(
        context.characterKnowledge.map(entry => [entry.characterId, entry.factIds] as const),
    );
    const characterKnowledgeFactIdsByCharacter = Object.fromEntries(
        availableCharacterIds.map(characterId => [
            characterId,
            [...(canonicalKnowledge.get(characterId) ?? [])],
        ]),
    );

    return {
        targetChapter: context.targetChapter,
        currentArcId: context.currentArc.id,
        currentBeatId: context.currentBeat?.id ?? null,
        allowedPovIds: context.povEligibility.filter(entry => entry.allowed).map(entry => entry.id),
        availableCharacterIds,
        allowedRevealIds: [...context.allowedRevealIds],
        allowedStoryEventIds: [...context.allowedStoryEventIds],
        allowedRelationshipEventIds: [...context.allowedRelationshipEventIds],
        relationshipDefinitions: context.relationshipContext.relationships.map(relationship => ({
            id: relationship.id,
            participantIds: [...relationship.participantIds],
        })),
        canonicalRelationshipIds: context.relationships.map(relationship => relationship.id),
        characterKnowledgeFactIdsByCharacter,
        strategicDomainTags: STRATEGIC_DOMAINS,
        relationshipSceneTag: 'relationship',
    };
};
