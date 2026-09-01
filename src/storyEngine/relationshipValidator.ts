import type { InternalChapterPlan, PlanValidationIssue, PlannerContext } from './plannerTypes';
import { ROMANCE_MILESTONES } from './relationshipTypes';
import type { RelationshipActionPlan, RelationshipEvidenceRef, RelationshipValidationResult } from './relationshipTypes';
import type { RelationshipGateValidationView } from './relationshipGateValidation';
import {
    orphanIntermediateActionIds,
    relationshipContractContradictions,
    requiresFinalCanonicalRelationshipConsequence,
    requiresPowerImbalanceAddressing,
    romanceMilestoneChanged,
} from './relationshipContract';
import { relationshipEvidenceAdequacyProblems } from './relationshipEvidence';

const romanticActions = new Set([
    'flirtation', 'romantic-tension', 'courtship', 'confession', 'accept-romance', 'reject-romance',
]);
const nonRomanticActions = new Set([
    'cooperate', 'professional-respect', 'alliance', 'rivalry-escalation',
]);
const mutualMilestoneIndex = ROMANCE_MILESTONES.indexOf('mutual-tension');
const milestoneIndex = (value: string): number => ROMANCE_MILESTONES.indexOf(value as typeof ROMANCE_MILESTONES[number]);
const sameIds = (left: readonly string[], right: readonly string[]): boolean => left.join('\u0000') === right.join('\u0000');
const issue = (code: string, path: string, message: string): PlanValidationIssue => ({ code, path, message, severity: 'error' });

export const orderRelationshipActions = (
    actions: readonly RelationshipActionPlan[],
    plan: Pick<InternalChapterPlan, 'scenes'>,
): readonly RelationshipActionPlan[] => {
    const sceneOrder = new Map(plan.scenes.map(scene => [scene.id, scene.order]));
    return actions.map((action, index) => ({ action, index }))
        .sort((left, right) => Math.min(...left.action.sceneIds.map(id => sceneOrder.get(id) ?? Number.MAX_SAFE_INTEGER))
            - Math.min(...right.action.sceneIds.map(id => sceneOrder.get(id) ?? Number.MAX_SAFE_INTEGER))
            || left.action.relationshipId.localeCompare(right.action.relationshipId)
            || left.action.id.localeCompare(right.action.id) || left.index - right.index)
        .map(entry => entry.action);
};

const evidenceIdentity = (reference: RelationshipEvidenceRef): string => {
    if (reference.type === 'knowledge') return `${reference.type}\u0000${reference.characterId}\u0000${reference.factId}`;
    if (reference.type === 'belief') return `${reference.type}\u0000${reference.characterId}\u0000${reference.epistemicId}`;
    if (reference.type === 'character-status') return `${reference.type}\u0000${reference.characterId}\u0000${reference.value}`;
    return `${reference.type}\u0000${reference.id}`;
};

const validateEvidence = (
    reference: RelationshipEvidenceRef,
    plan: InternalChapterPlan,
    context: PlannerContext,
): boolean => {
    if (reference.type === 'fact') return [...context.writerVisibleFacts, ...context.internalFacts].some(value => value.id === reference.id);
    if (reference.type === 'knowledge') return context.characterKnowledge.some(value => value.characterId === reference.characterId && value.factIds.includes(reference.factId));
    if (reference.type === 'belief') return context.relationshipContext.participantBeliefs.some(value => value.id === reference.epistemicId && value.characterId === reference.characterId);
    if (reference.type === 'relationship') return context.relationships.some(value => value.id === reference.id);
    if (reference.type === 'relationship-history') return context.relationshipContext.relationships.some(value => value.recentHistory.some(history => history.id === reference.id));
    if (reference.type === 'strategic-action') return (plan.strategicActions ?? []).some(value => value.id === reference.id);
    const character = context.availableCharacters.find(value => value.id === reference.characterId);
    return character !== undefined && [character.status?.status, ...(character.status?.injuries ?? []), ...(character.status?.conditions ?? [])].includes(reference.value);
};

const hasCanonicalKnowledge = (context: PlannerContext, characterId: string, factId: string): boolean =>
    context.characterKnowledge.some(entry => entry.characterId === characterId && entry.factIds.includes(factId));

/** Pure deterministic validation. It inspects contracts only and never chooses outcomes or mutates canon. */
export const validateRelationshipActions = (
    plan: InternalChapterPlan,
    context: PlannerContext,
    gateView?: RelationshipGateValidationView,
): readonly PlanValidationIssue[] => {
    const issues: PlanValidationIssue[] = [];
    const actions = orderRelationshipActions(plan.relationshipActions ?? [], plan);
    const sceneById = new Map(plan.scenes.map(scene => [scene.id, scene]));
    const definitions = new Map(context.relationshipContext.relationships.map(value => [value.id, value]));
    if ((actions.length > 0 || (plan.relationshipEventIds.length > 0 && definitions.size > 0))
        && (!gateView || gateView.targetChapter !== context.targetChapter)) {
        issues.push(issue('RELATIONSHIP_GATE_VIOLATION', 'relationshipActions', 'trusted relationship gate validation data is required'));
    }
    const work08Relationships = new Map((gateView?.relationships ?? [...definitions.values()])
        .map(value => [value.id, value]));
    const knownRelationships = new Set([
        ...context.relationships.map(value => value.id), ...definitions.keys(),
        ...context.allowedRelationshipEvents.map(value => value.relationshipId),
    ]);

    plan.expectedRelationshipDeltas.forEach((delta, index) => {
        if (!knownRelationships.has(delta.relationshipId)) issues.push(issue('RELATIONSHIP_REFERENCE_INVALID', `expectedRelationshipDeltas.${index}.relationshipId`, 'relationship does not resolve in the target context'));
        const descriptor = definitions.get(delta.relationshipId)
            ?? context.relationships.find(value => value.id === delta.relationshipId)
            ?? context.allowedRelationshipEvents.find(value => value.relationshipId === delta.relationshipId);
        if (descriptor && !sameIds(descriptor.participantIds, delta.participantIds)) issues.push(issue('RELATIONSHIP_REFERENCE_INVALID', `expectedRelationshipDeltas.${index}.participantIds`, 'participants do not match the canonical relationship'));
        if (work08Relationships.has(delta.relationshipId)) {
            const matchingFinals = actions.filter(action => !action.intendedProgression.intermediate
                && action.relationshipId === delta.relationshipId
                && sameIds(action.participantIds, delta.participantIds)
                && action.intendedProgression.expectedState === delta.expectedState);
            if (matchingFinals.length !== 1) issues.push(issue('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION', `expectedRelationshipDeltas.${index}`, 'WORK 08 relationship delta requires exactly one matching final RelationshipAction'));
        }
    });
    const deltaRelationshipIds = plan.expectedRelationshipDeltas.map(value => value.relationshipId);
    if (new Set(deltaRelationshipIds).size !== deltaRelationshipIds.length) {
        issues.push(issue('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION', 'expectedRelationshipDeltas', 'must contain at most one final delta per relationship'));
    }

    plan.relationshipEventIds.forEach((eventId, index) => {
        const controlledEvent = gateView?.events.find(value => value.id === eventId);
        if (!controlledEvent || !work08Relationships.has(controlledEvent.relationshipId)) return;
        const matchingActions = actions.filter(action => action.relationshipEventId === controlledEvent.id
            && action.relationshipId === controlledEvent.relationshipId
            && sameIds(action.participantIds, controlledEvent.participantIds)
            && action.actionType === controlledEvent.eventType);
        if (matchingActions.length !== 1) issues.push(issue('RELATIONSHIP_GATE_VIOLATION', `relationshipEventIds.${index}`, 'controlled WORK 08 relationship event requires exactly one compatible RelationshipAction'));
    });

    actions.forEach((action, index) => {
        const path = `relationshipActions.${index}`;
        const descriptor = definitions.get(action.relationshipId);
        if (!descriptor) {
            issues.push(issue('RELATIONSHIP_REFERENCE_INVALID', `${path}.relationshipId`, 'relationship is not declared in the control relationship domain'));
            return;
        }
        if (!sameIds(descriptor.participantIds, action.participantIds)
            || !action.participantIds.every(id => plan.participantIds.includes(id))) issues.push(issue('RELATIONSHIP_REFERENCE_INVALID', `${path}.participantIds`, 'participants must exactly match the declared relationship and chapter plan'));
        if (!descriptor.categories.includes(action.category)) issues.push(issue('RELATIONSHIP_REFERENCE_INVALID', `${path}.category`, 'category is not canon-declared for this relationship'));
        if (action.currentRomanceMilestone !== descriptor.currentRomanceMilestone) issues.push(issue('RELATIONSHIP_PROGRESSION_VIOLATION', `${path}.currentRomanceMilestone`, 'must match the derived current milestone'));
        if (descriptor.dynamicProfile.prohibitedShortcuts.includes(action.actionType)) issues.push(issue('RELATIONSHIP_PROGRESSION_VIOLATION', `${path}.actionType`, 'action is prohibited by the relationship dynamic profile'));
        if (descriptor.dynamicProfile.coreDynamicTags.includes('unequal-power')
            && !['unequal', 'contested'].includes(action.currentStateAssessment.powerBalance)) issues.push(issue('RELATIONSHIP_AGENCY_VIOLATION', `${path}.currentStateAssessment.powerBalance`, 'assessment must preserve the canon-declared power imbalance'));

        const linkedScenes = action.sceneIds.map(id => sceneById.get(id));
        if (linkedScenes.some(scene => scene === undefined || !scene.purposeTags.includes('relationship')
            || !action.participantIds.every(id => scene.participantIds.includes(id)))) issues.push(issue('RELATIONSHIP_REFERENCE_INVALID', `${path}.sceneIds`, 'must identify relationship-tagged scenes containing every participant'));

        const event = action.relationshipEventId === undefined ? undefined
            : gateView?.events.find(value => value.id === action.relationshipEventId);
        if (action.relationshipEventId !== undefined && (!event || !event.allowed || event.relationshipId !== action.relationshipId)) issues.push(issue('RELATIONSHIP_GATE_VIOLATION', `${path}.relationshipEventId`, 'relationship event is locked, unknown, or belongs to another relationship'));
        if (action.relationshipEventId !== undefined && !plan.relationshipEventIds.includes(action.relationshipEventId)) issues.push(issue('RELATIONSHIP_GATE_VIOLATION', `${path}.relationshipEventId`, 'relationship action event must also be declared in relationshipEventIds'));
        const gatedEvents = gateView?.events.filter(value => value.relationshipId === action.relationshipId && value.eventType === action.actionType) ?? [];
        if (gatedEvents.length > 0 && (!event || event.eventType !== action.actionType)) issues.push(issue('RELATIONSHIP_GATE_VIOLATION', `${path}.relationshipEventId`, 'this action requires its allowed control event'));

        const currentIndex = milestoneIndex(action.currentRomanceMilestone);
        const nextIndex = milestoneIndex(action.intendedProgression.romanticMilestone);
        const advance = nextIndex - currentIndex;
        const explicitJump = event?.authorizedRomanceMilestone === action.intendedProgression.romanticMilestone;
        if (advance > descriptor.progressionPolicy.maxMajorMilestoneAdvancePerChapter && !explicitJump) issues.push(issue('RELATIONSHIP_PROGRESSION_VIOLATION', `${path}.intendedProgression.romanticMilestone`, 'romantic milestone advance exceeds the declared per-chapter policy'));
        if (nextIndex > 0 && !descriptor.categories.includes('romantic')) issues.push(issue('RELATIONSHIP_PROGRESSION_VIOLATION', `${path}.intendedProgression.romanticMilestone`, 'romantic progression requires a canon-declared romantic relationship'));
        if (romanticActions.has(action.actionType) && (!descriptor.categories.includes('romantic') || action.category !== 'romantic')) issues.push(issue('RELATIONSHIP_PROGRESSION_VIOLATION', `${path}.actionType`, 'romantic action requires the canon-declared romantic category'));
        if (nonRomanticActions.has(action.actionType) && nextIndex !== currentIndex) issues.push(issue('RELATIONSHIP_PROGRESSION_VIOLATION', `${path}.intendedProgression.romanticMilestone`, 'professional, alliance, and rivalry actions cannot advance romance'));
        relationshipContractContradictions(action).forEach(message => issues.push(issue(
            message.includes('boundary') ? 'RELATIONSHIP_BOUNDARY_VIOLATION' : 'RELATIONSHIP_PROGRESSION_VIOLATION',
            `${path}.actionType`,
            message,
        )));

        const agencyIds = action.participantAgency.map(value => value.characterId);
        if (agencyIds.some(id => !action.participantIds.includes(id)) || ((action.importance === 'major' || nextIndex > currentIndex) && !sameIds(agencyIds, action.participantIds))) issues.push(issue('RELATIONSHIP_AGENCY_VIOLATION', `${path}.participantAgency`, 'major progression requires one structured agency choice for every participant'));
        action.participantAgency.forEach((agency, agencyIndex) => agency.knowledgeBasisFactIds.forEach((factId, factIndex) => {
            if (!hasCanonicalKnowledge(context, agency.characterId, factId)) issues.push(issue('RELATIONSHIP_KNOWLEDGE_VIOLATION', `${path}.participantAgency.${agencyIndex}.knowledgeBasisFactIds.${factIndex}`, 'fact is not canonical knowledge for this participant'));
        }));

        const identities = action.evidenceRefs.map(evidenceIdentity);
        if (action.evidenceRefs.some(reference => reference.type === 'knowledge'
            && !hasCanonicalKnowledge(context, reference.characterId, reference.factId))) {
            issues.push(issue('RELATIONSHIP_KNOWLEDGE_VIOLATION', `${path}.evidenceRefs`, 'knowledge evidence must be canonical for its specific character'));
        }
        if (new Set(identities).size !== identities.length || action.evidenceRefs.some(reference => !validateEvidence(reference, plan, context))) issues.push(issue('RELATIONSHIP_REFERENCE_INVALID', `${path}.evidenceRefs`, 'evidence must be unique and resolve target-safely'));
        relationshipEvidenceAdequacyProblems({
            actionType: action.actionType,
            importance: action.importance,
            participantIds: action.participantIds,
            participantActorIds: action.participantAgency.map(agency => agency.characterId),
            ...(action.jealousCharacterId === undefined ? {} : { jealousCharacterId: action.jealousCharacterId }),
            direction: action.intendedProgression.direction,
            evidenceRefs: action.evidenceRefs,
        }).forEach(message => issues.push(issue(
            message.includes('knowledge') || message.includes('belief') || message.includes('trigger')
                ? 'RELATIONSHIP_KNOWLEDGE_VIOLATION' : 'RELATIONSHIP_REFERENCE_INVALID',
            `${path}.evidenceRefs`,
            message,
        )));

        const mutualRequired = nextIndex >= mutualMilestoneIndex || action.actionType === 'accept-romance' || action.intendedProgression.mutual;
        if (mutualRequired && (!action.intendedProgression.mutual || action.participantAgency.length !== action.participantIds.length
            || action.participantAgency.some(agency => agency.willingness !== 'yes'))) issues.push(issue('RELATIONSHIP_MUTUALITY_VIOLATION', `${path}.participantAgency`, 'mutual romance requires explicit willing choices from every participant'));

        const activeRomanticBoundaries = action.boundaries.filter(boundary => ['professional-only', 'no-romance'].includes(boundary.constraint)
            && ['maintain', 'set'].includes(boundary.stance));
        if (nextIndex > currentIndex && activeRomanticBoundaries.length > 0) issues.push(issue('RELATIONSHIP_BOUNDARY_VIOLATION', `${path}.boundaries`, 'romantic progression conflicts with an active professional-only or no-romance boundary'));
        action.boundaries.forEach((boundary, boundaryIndex) => {
            if (!action.participantIds.includes(boundary.characterId)) issues.push(issue('RELATIONSHIP_BOUNDARY_VIOLATION', `${path}.boundaries.${boundaryIndex}.characterId`, 'boundary owner must be a relationship participant'));
            if (['revise', 'release'].includes(boundary.stance) && !action.participantAgency.some(agency => agency.characterId === boundary.characterId && agency.willingness === 'yes')) issues.push(issue('RELATIONSHIP_BOUNDARY_VIOLATION', `${path}.boundaries.${boundaryIndex}`, 'boundary change requires the owner\'s explicit willing choice'));
        });
        if (requiresPowerImbalanceAddressing(action.importance, action.category, action.currentStateAssessment.powerBalance)
            && !action.powerImbalanceAddressed) issues.push(issue('RELATIONSHIP_AGENCY_VIOLATION', `${path}.powerImbalanceAddressed`, 'major romantic progression must address the declared power imbalance'));

        if (action.actionType === 'jealousy') {
            const attachment = currentIndex >= milestoneIndex('interest');
            if (!attachment) issues.push(issue('RELATIONSHIP_PROGRESSION_VIOLATION', path, 'jealousy requires canonically established attachment'));
        }
        if (advance > 0 && !descriptor.slowBurnHistoryComplete) issues.push(issue('RELATIONSHIP_REPETITION_VIOLATION', `${path}.intendedProgression`, 'relationship history capacity is insufficient to prove the slow-burn policy'));
        else if (advance > 0 && descriptor.consecutiveProgressionCount >= descriptor.progressionPolicy.maxConsecutiveProgressionChapters) issues.push(issue('RELATIONSHIP_REPETITION_VIOLATION', `${path}.intendedProgression`, 'consecutive romantic progression exceeds the declared slow-burn policy'));

        const delta = plan.expectedRelationshipDeltas.find(value => value.relationshipId === action.relationshipId);
        if (!action.intendedProgression.intermediate && romanceMilestoneChanged(action)
            && action.intendedProgression.expectedState !== action.intendedProgression.romanticMilestone) {
            issues.push(issue('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION', `${path}.intendedProgression.expectedState`, 'romantic milestone changes must persist the exact milestone literal'));
        }
        if (requiresFinalCanonicalRelationshipConsequence(action)
            && (action.intendedProgression.expectedState === undefined || !delta
                || delta.expectedState !== action.intendedProgression.expectedState
                || !sameIds(delta.participantIds, action.participantIds))) {
            issues.push(issue('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION', `${path}.intendedProgression.expectedState`, 'final relationship consequence and matching expectedRelationshipDelta are required'));
        }
    });

    const actionById = new Map(actions.map((action, index) => [action.id, { action, index }]));
    actions.forEach((action, index) => {
        if (action.dependsOnActionId !== undefined) {
            const prior = actionById.get(action.dependsOnActionId);
            if (!prior || prior.index >= index || prior.action.relationshipId !== action.relationshipId) issues.push(issue('RELATIONSHIP_PROGRESSION_VIOLATION', `relationshipActions.${index}.dependsOnActionId`, 'causal predecessor must be an earlier action for the same relationship'));
        }
    });
    const orphanIds = new Set(orphanIntermediateActionIds(actions));
    actions.forEach((action, index) => {
        if (orphanIds.has(action.id)) issues.push(issue('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION', `relationshipActions.${index}.intendedProgression.intermediate`, 'meaningful intermediate progression requires a causally linked later final action'));
    });
    const groups = new Map<string, RelationshipActionPlan[]>();
    actions.forEach(action => groups.set(action.relationshipId, [...(groups.get(action.relationshipId) ?? []), action]));
    groups.forEach((values) => {
        const finals = values.filter(value => !value.intendedProgression.intermediate && value.intendedProgression.expectedState !== undefined);
        if (new Set(finals.map(value => value.intendedProgression.expectedState)).size > 1) issues.push(issue('RELATIONSHIP_PROGRESSION_VIOLATION', 'relationshipActions', 'same-chapter actions declare contradictory final relationship states'));
        const signatures = values.map(value => `${value.actionType}\u0000${value.intendedProgression.direction}\u0000${value.intendedProgression.romanticMilestone}`);
        if (new Set(signatures).size !== signatures.length) issues.push(issue('RELATIONSHIP_REPETITION_VIOLATION', 'relationshipActions', 'same relationship repeats the same progression contract in one chapter'));
    });
    plan.scenes.forEach((scene, index) => {
        if (scene.purposeTags.includes('relationship') && !actions.some(action => action.sceneIds.includes(scene.id))) issues.push(issue('RELATIONSHIP_REFERENCE_INVALID', `scenes.${index}.purposeTags`, 'relationship-tagged scene requires a RelationshipActionPlan'));
    });
    return issues;
};

export const relationshipValidationResult = (issues: readonly PlanValidationIssue[]): RelationshipValidationResult => ({
    status: issues.length === 0 ? 'feasible' : issues.some(value => value.code === 'RELATIONSHIP_REFERENCE_INVALID') ? 'under-specified' : 'infeasible',
    issues: issues.map(value => ({ ...value })),
});
