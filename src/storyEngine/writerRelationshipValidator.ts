import type { ExpectedRelationshipDelta, WriterPlanScene } from './plannerTypes';
import { ROMANCE_MILESTONES } from './relationshipTypes';
import type { WriterRelationshipDirective } from './relationshipTypes';
import type { WriterSafeContext } from './types';

export interface WriterRelationshipValidationInput {
    readonly participantIds: readonly string[];
    readonly scenes: readonly WriterPlanScene[];
    readonly expectedRelationshipDeltas: readonly ExpectedRelationshipDelta[];
    readonly relationshipEventIds: readonly string[];
    readonly directives: readonly WriterRelationshipDirective[];
}

const fail = (message: string): never => { throw new Error(message); };
const sameIds = (left: readonly string[], right: readonly string[]): boolean => left.join('\u0000') === right.join('\u0000');
const indexOfMilestone = (value: string): number => ROMANCE_MILESTONES.indexOf(value as typeof ROMANCE_MILESTONES[number]);
const romanticActions = new Set(['flirtation', 'romantic-tension', 'courtship', 'confession', 'accept-romance', 'reject-romance']);
const nonRomanticActions = new Set(['cooperate', 'professional-respect', 'alliance', 'rivalry-escalation']);

/** Revalidates all relationship invariants expressible from Writer-safe source data. */
export const validateWriterRelationshipDirectives = (
    input: WriterRelationshipValidationInput,
    safe: WriterSafeContext,
): void => {
    const declaredParticipants = new Set(input.participantIds);
    const definitions = new Map(safe.relationshipDefinitions.map(value => [value.id, value]));
    const allowedEvents = new Map(safe.relationshipEvents.map(value => [value.id, value]));
    const sceneById = new Map(input.scenes.map(value => [value.id, value]));
    const actionById = new Map(input.directives.map((value, index) => [value.id, { value, index }]));
    if (actionById.size !== input.directives.length) fail('relationship directives must not contain duplicate action IDs');

    input.directives.forEach((directive, index) => {
        const definition = definitions.get(directive.relationshipId);
        if (!definition) fail(`relationshipDirectives.${index} references an unsupported relationship`);
        if (!sameIds(definition.participantIds, directive.participantIds)
            || !directive.participantIds.every(id => declaredParticipants.has(id))) fail(`relationshipDirectives.${index} participants do not match the declared relationship`);
        if (!definition.categories.includes(directive.category)) fail(`relationshipDirectives.${index} category is not canon-declared`);
        const linkedScenes = directive.sceneIds.map(id => sceneById.get(id));
        if (linkedScenes.some(scene => scene === undefined || !scene.purposeTags.includes('relationship')
            || !directive.participantIds.every(id => scene.participantIds.includes(id)))) fail(`relationshipDirectives.${index} contains an invalid scene reference`);

        const event = directive.relationshipEventId === undefined ? undefined : allowedEvents.get(directive.relationshipEventId);
        if (directive.relationshipEventId !== undefined && (!event || event.relationshipId !== directive.relationshipId)) fail(`relationshipDirectives.${index} relationship event is unavailable`);
        if (directive.relationshipEventId !== undefined && !input.relationshipEventIds.includes(directive.relationshipEventId)) fail(`relationshipDirectives.${index} relationship event is not declared by the Writer plan`);
        const currentState = safe.state.relationships.find(value => value.id === directive.relationshipId)?.state;
        const derivedMilestone = currentState !== undefined && ROMANCE_MILESTONES.includes(currentState as typeof ROMANCE_MILESTONES[number])
            ? currentState : definition.initialRomanceMilestone;
        if (directive.currentRomanceMilestone !== derivedMilestone) fail(`relationshipDirectives.${index} current milestone is stale`);
        const currentIndex = indexOfMilestone(directive.currentRomanceMilestone);
        const nextIndex = indexOfMilestone(directive.intendedProgression.romanticMilestone);
        const advance = nextIndex - currentIndex;
        const authorizedJump = event?.authorizedRomanceMilestone === directive.intendedProgression.romanticMilestone;
        if (advance > definition.progressionPolicy.maxMajorMilestoneAdvancePerChapter && !authorizedJump) fail(`relationshipDirectives.${index} advances too many romantic milestones`);
        if (nextIndex > 0 && !definition.categories.includes('romantic')) fail(`relationshipDirectives.${index} invents non-canon romance`);
        if (romanticActions.has(directive.actionType) && (directive.category !== 'romantic' || !definition.categories.includes('romantic'))) fail(`relationshipDirectives.${index} uses unsupported romantic action`);
        if (nonRomanticActions.has(directive.actionType) && nextIndex !== currentIndex) fail(`relationshipDirectives.${index} converts professional or strategic progress into romance`);
        if (definition.dynamicProfile.coreDynamicTags.includes('unequal-power')
            && !['unequal', 'contested'].includes(directive.visiblePowerBalance)) fail(`relationshipDirectives.${index} erases the declared power imbalance`);

        const choiceIds = directive.participantChoices.map(value => value.characterId);
        if (new Set(choiceIds).size !== choiceIds.length || choiceIds.some(id => !directive.participantIds.includes(id))) fail(`relationshipDirectives.${index} contains malformed participant choices`);
        const mutualRequired = nextIndex >= indexOfMilestone('mutual-tension') || directive.actionType === 'accept-romance' || directive.intendedProgression.mutual;
        if (mutualRequired && (!directive.intendedProgression.mutual || !sameIds(choiceIds, directive.participantIds)
            || directive.participantChoices.some(value => value.willingness !== 'yes'))) fail(`relationshipDirectives.${index} lacks explicit mutual willingness`);
        if (nextIndex > currentIndex && directive.visibleBoundaries.some(value => ['professional-only', 'no-romance'].includes(value.constraint)
            && ['maintain', 'set'].includes(value.stance))) fail(`relationshipDirectives.${index} contradicts an active romantic boundary`);
        directive.visibleBoundaries.forEach((boundary) => {
            if (!directive.participantIds.includes(boundary.characterId)) fail(`relationshipDirectives.${index} boundary owner is not a participant`);
            if (['revise', 'release'].includes(boundary.stance)
                && !directive.participantChoices.some(value => value.characterId === boundary.characterId && value.willingness === 'yes')) fail(`relationshipDirectives.${index} changes a boundary without the owner's willing choice`);
        });
        const delta = input.expectedRelationshipDeltas.find(value => value.relationshipId === directive.relationshipId);
        if (directive.intendedProgression.expectedState !== undefined && !directive.intendedProgression.intermediate
            && (!delta || delta.expectedState !== directive.intendedProgression.expectedState || !sameIds(delta.participantIds, directive.participantIds))) fail(`relationshipDirectives.${index} does not reconcile with expectedRelationshipDeltas`);
        if (directive.dependsOnActionId !== undefined) {
            const prior = actionById.get(directive.dependsOnActionId);
            if (!prior || prior.index >= index || prior.value.relationshipId !== directive.relationshipId) fail(`relationshipDirectives.${index} has an invalid causal predecessor`);
        }
    });
    input.scenes.forEach((scene, index) => {
        if (scene.purposeTags.includes('relationship') && !input.directives.some(value => value.sceneIds.includes(scene.id))) fail(`scenes.${index} lacks a matching relationship directive`);
    });
    const grouped = new Map<string, WriterRelationshipDirective[]>();
    input.directives.forEach(value => grouped.set(value.relationshipId, [...(grouped.get(value.relationshipId) ?? []), value]));
    grouped.forEach((values) => {
        const finalStates = values.filter(value => !value.intendedProgression.intermediate).map(value => value.intendedProgression.expectedState).filter(Boolean);
        if (new Set(finalStates).size > 1) fail('relationship directives declare contradictory same-chapter final states');
    });
};
