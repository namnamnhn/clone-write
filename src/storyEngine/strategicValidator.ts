import type {
    InternalChapterPlan,
    PlanValidationIssue,
    PlannerContext,
} from './plannerTypes';
import { validateCommerceAction } from './commerceEngine';
import { validateMilitaryAction } from './militaryEngine';
import { validatePoliticalAction } from './politicsEngine';
import {
    actionResourceEffects,
    strategicCharacterKnowsFact,
    collectActionEvidence,
    evidenceIdentity,
    isMeaningfulText,
    relationshipExists,
    resourceFor,
    resourceKey,
    sortedUnique,
    strategicIssue,
    validateEvidenceReference,
} from './strategicEvidence';
import type {
    StrategicActionPlan,
    StrategicDomain,
    StrategicValidationResult,
} from './strategicTypes';

const domainOrder: Readonly<Record<StrategicDomain, number>> = { politics: 0, military: 1, commerce: 2 };

const firstSceneOrder = (action: StrategicActionPlan, plan: InternalChapterPlan): number =>
    Math.min(...action.sceneIds.map(id => plan.scenes.find(scene => scene.id === id)?.order ?? Number.MAX_SAFE_INTEGER));

export const orderStrategicActions = (
    actions: readonly StrategicActionPlan[],
    plan: InternalChapterPlan,
): readonly StrategicActionPlan[] => actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => domainOrder[left.action.domain] - domainOrder[right.action.domain]
        || firstSceneOrder(left.action, plan) - firstSceneOrder(right.action, plan)
        || left.action.id.localeCompare(right.action.id) || left.index - right.index)
    .map(entry => entry.action);

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
    sortedUnique(left).join('\u0000') === sortedUnique(right).join('\u0000');

const validateCountermove = (
    action: StrategicActionPlan,
    context: PlannerContext,
    path: string,
): readonly PlanValidationIssue[] => {
    const issues: PlanValidationIssue[] = [];
    if ((action.countermove === undefined) === (action.noCountermoveReason === undefined)) {
        issues.push(strategicIssue('STRATEGIC_REFERENCE_INVALID', path, 'action requires exactly one structured countermove or explicit no-countermove reason'));
    }
    if (!isMeaningfulText(action.expectedCostOrTradeoff)) {
        issues.push(strategicIssue('STRATEGIC_REFERENCE_INVALID', `${path}.expectedCostOrTradeoff`, 'strategic action requires a meaningful cost or tradeoff'));
    }
    if (action.noCountermoveReason !== undefined && !isMeaningfulText(action.noCountermoveReason)) {
        issues.push(strategicIssue('STRATEGIC_REFERENCE_INVALID', `${path}.noCountermoveReason`, 'no-countermove reason must be meaningful'));
    }
    const counter = action.countermove;
    if (!counter) return issues;
    if (!isMeaningfulText(counter.action) || !isMeaningfulText(counter.costOrTradeoff)) {
        issues.push(strategicIssue('STRATEGIC_REFERENCE_INVALID', `${path}.countermove`, 'countermove action and cost must be meaningful'));
    }
    if (!context.availableCharacters.some(character => character.id === counter.opponentCharacterId)) {
        issues.push(strategicIssue('STRATEGIC_REFERENCE_INVALID', `${path}.countermove.opponentCharacterId`, 'countermove opponent is unavailable at the target chapter'));
    }
    counter.opponentKnowledgeFactIds.forEach((factId, index) => {
        if (!strategicCharacterKnowsFact(context, counter.opponentCharacterId, factId)) {
            issues.push(strategicIssue('OPPONENT_KNOWLEDGE_VIOLATION', `${path}.countermove.opponentKnowledgeFactIds.${index}`, 'opponent may use only canonical knowledge assigned to that opponent'));
        }
    });
    return issues;
};

const validateIntelligentConflict = (
    action: StrategicActionPlan,
    plan: InternalChapterPlan,
    context: PlannerContext,
    path: string,
): readonly PlanValidationIssue[] => {
    const issues: PlanValidationIssue[] = [];
    action.sceneIds.forEach((sceneId) => {
        const sceneIndex = plan.scenes.findIndex(scene => scene.id === sceneId);
        const scene = plan.scenes[sceneIndex];
        if (!scene || scene.conflictImportance !== 'major') return;
        const conflict = scene.intelligentConflict;
        if (!conflict || !action.countermove) {
            issues.push(strategicIssue('STRATEGIC_INTELLIGENT_CONFLICT_VIOLATION', `${path}.sceneIds`, 'major strategic scene requires one compatible intelligent conflict and countermove'));
            return;
        }
        const counter = action.countermove;
        if ((conflict.opponentCharacterId !== undefined && conflict.opponentCharacterId !== counter.opponentCharacterId)
            || !sameStrings(conflict.opponentKnowledge, counter.opponentKnowledgeFactIds)
            || !sameStrings(conflict.opponentBeliefs, counter.opponentBeliefClaims)
            || conflict.rationalCountermove !== counter.action) {
            issues.push(strategicIssue('STRATEGIC_INTELLIGENT_CONFLICT_VIOLATION', `scenes.${sceneIndex}.intelligentConflict`, 'intelligent conflict must agree with the linked strategic countermove'));
        }
        conflict.opponentKnowledge.forEach((factId, knowledgeIndex) => {
            if (!strategicCharacterKnowsFact(context, counter.opponentCharacterId, factId)) {
                issues.push(strategicIssue('OPPONENT_KNOWLEDGE_VIOLATION', `scenes.${sceneIndex}.intelligentConflict.opponentKnowledge.${knowledgeIndex}`, 'intelligent conflict knowledge must belong to the identified opponent'));
            }
        });
    });
    return issues;
};

const validateResourceEffects = (
    actions: readonly StrategicActionPlan[],
    plan: InternalChapterPlan,
    context: PlannerContext,
): readonly PlanValidationIssue[] => {
    const issues: PlanValidationIssue[] = [];
    const strategicTotals = new Map<string, number>();
    actions.forEach((action, actionIndex) => {
        actionResourceEffects(action).forEach((effect, effectIndex) => {
            const key = resourceKey(effect.characterId, effect.resourceId);
            strategicTotals.set(key, (strategicTotals.get(key) ?? 0) + effect.quantityDelta);
            if (!resourceFor(context, effect.characterId, effect.resourceId)) {
                const code = action.domain === 'politics' ? 'POLITICAL_RESOURCE_VIOLATION'
                    : action.domain === 'military' ? 'MILITARY_RESOURCE_VIOLATION' : 'COMMERCE_RESOURCE_VIOLATION';
                issues.push(strategicIssue(code, `strategicActions.${actionIndex}.${action.domain === 'commerce' ? 'resourceFlows' : 'resourceEffects'}.${effectIndex}`, 'resource effect references unavailable canonical capacity'));
            }
        });
    });
    const expectedTotals = new Map<string, number>();
    plan.expectedResourceDeltas.forEach((delta) => {
        if (delta.quantityDelta === undefined) return;
        const key = resourceKey(delta.characterId, delta.resourceId);
        expectedTotals.set(key, (expectedTotals.get(key) ?? 0) + delta.quantityDelta);
    });
    [...strategicTotals].sort(([left], [right]) => left.localeCompare(right)).forEach(([key, total]) => {
        const [characterId, resourceId] = key.split('\u0000');
        if (expectedTotals.get(key) !== total) {
            issues.push(strategicIssue('STRATEGIC_RESOURCE_RECONCILIATION_VIOLATION', 'expectedResourceDeltas', 'strategic resource effects must reconcile exactly with expected resource deltas'));
        }
        const resource = resourceFor(context, characterId, resourceId);
        if (resource?.quantity !== undefined && Number.isFinite(resource.quantity) && resource.quantity + total < 0) {
            issues.push(strategicIssue('STRATEGIC_RESOURCE_CAPACITY_VIOLATION', 'strategicActions', 'strategic consumption exceeds finite current capacity after same-plan replenishment'));
        }
    });
    return issues;
};

const validateRelationshipEffects = (
    actions: readonly StrategicActionPlan[],
    plan: InternalChapterPlan,
    context: PlannerContext,
): readonly PlanValidationIssue[] => {
    const issues: PlanValidationIssue[] = [];
    actions.forEach((action, actionIndex) => action.relationshipEffects.forEach((effect, effectIndex) => {
        const expected = plan.expectedRelationshipDeltas.find(delta => delta.relationshipId === effect.relationshipId);
        const canonical = context.relationships.find(relationship => relationship.id === effect.relationshipId);
        if (!relationshipExists(context, effect.relationshipId) || expected?.expectedState !== effect.expectedState
            || canonical === undefined || !sameStrings(canonical.participantIds, expected.participantIds)) {
            issues.push(strategicIssue('STRATEGIC_RELATIONSHIP_RECONCILIATION_VIOLATION', `strategicActions.${actionIndex}.relationshipEffects.${effectIndex}`, 'strategic relationship effect must resolve and match expectedRelationshipDeltas'));
        }
    }));
    return issues;
};

/** Deterministic, pure validation over a bounded plan and target-scoped canonical projection. */
export const validateStrategicActions = (
    plan: InternalChapterPlan,
    context: PlannerContext,
): readonly PlanValidationIssue[] => {
    const actions = orderStrategicActions(plan.strategicActions ?? [], plan);
    const issues: PlanValidationIssue[] = [];
    const sceneById = new Map(plan.scenes.map((scene, index) => [scene.id, { scene, index }]));
    const ids = new Set<string>();
    actions.forEach((action, index) => {
        const path = `strategicActions.${index}`;
        if (ids.has(action.id)) issues.push(strategicIssue('STRATEGIC_REFERENCE_INVALID', `${path}.id`, 'strategic action IDs must be unique'));
        ids.add(action.id);
        if (!context.availableCharacters.some(character => character.id === action.actorCharacterId)) {
            issues.push(strategicIssue('STRATEGIC_REFERENCE_INVALID', `${path}.actorCharacterId`, 'strategic actor is unavailable at the target chapter'));
        }
        if (!plan.participantIds.includes(action.actorCharacterId)) {
            issues.push(strategicIssue('STRATEGIC_REFERENCE_INVALID', `${path}.actorCharacterId`, 'strategic actor must be declared in chapter participants'));
        }
        action.actorKnowledgeFactIds.forEach((factId, knowledgeIndex) => {
            if (!strategicCharacterKnowsFact(context, action.actorCharacterId, factId)) {
                issues.push(strategicIssue(action.domain === 'politics' ? 'POLITICAL_INFORMATION_VIOLATION'
                    : action.domain === 'military' ? 'MILITARY_INTELLIGENCE_VIOLATION' : 'STRATEGIC_REFERENCE_INVALID',
                `${path}.actorKnowledgeFactIds.${knowledgeIndex}`, 'actor may rely with certainty only on canonical knowledge'));
            }
        });
        action.sceneIds.forEach((sceneId, sceneIdIndex) => {
            const entry = sceneById.get(sceneId);
            if (!entry || !entry.scene.purposeTags.includes(action.domain)) {
                issues.push(strategicIssue('STRATEGIC_SCENE_COVERAGE_VIOLATION', `${path}.sceneIds.${sceneIdIndex}`, 'strategic action must reference a real scene carrying the same domain tag'));
            } else if (entry.scene.conflictImportance === 'major' && action.importance !== 'major') {
                issues.push(strategicIssue('STRATEGIC_SCENE_COVERAGE_VIOLATION', `${path}.importance`, 'action linked to a major strategic scene must be major'));
            }
        });
        collectActionEvidence(action).forEach((reference, evidenceIndex) => {
            issues.push(...validateEvidenceReference(reference, context, `${path}.evidence.${evidenceIndex}`));
        });
        const evidenceIds = collectActionEvidence(action).map(evidenceIdentity);
        if (new Set(evidenceIds).size !== evidenceIds.length) {
            issues.push(strategicIssue('STRATEGIC_REFERENCE_INVALID', `${path}.evidence`, 'strategic evidence references must not be duplicated'));
        }
        issues.push(...validateCountermove(action, context, path));
        issues.push(...validateIntelligentConflict(action, plan, context, path));
        if (action.domain === 'politics') issues.push(...validatePoliticalAction(action, context, path));
        else if (action.domain === 'military') issues.push(...validateMilitaryAction(action, context, plan, path));
        else issues.push(...validateCommerceAction(action, context, path));
    });

    (['politics', 'military', 'commerce'] as const).forEach((domain) => {
        plan.scenes.forEach((scene, sceneIndex) => {
            if (scene.purposeTags.includes(domain)
                && !actions.some(action => action.domain === domain && action.sceneIds.includes(scene.id))) {
                issues.push(strategicIssue('STRATEGIC_SCENE_COVERAGE_VIOLATION', `scenes.${sceneIndex}.purposeTags`, `${domain} scene requires a matching strategic action`));
            }
        });
    });
    issues.push(...validateResourceEffects(actions, plan, context));
    issues.push(...validateRelationshipEffects(actions, plan, context));
    return issues.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
};

export const assessStrategicActions = (
    plan: InternalChapterPlan,
    context: PlannerContext,
): StrategicValidationResult => {
    const issues = validateStrategicActions(plan, context);
    const underSpecified = (plan.strategicActions ?? []).some(action =>
        action.domain === 'politics' ? action.dimensions.some(value => value.status === 'unknown')
            : action.domain === 'military' ? action.readiness.some(value => value.status === 'unknown')
                || action.logistics?.expectedSupplyConsumption === 'unknown'
                || action.logistics?.operationalTimeChapters === 'unknown'
            : action.timing.settlementChapters === 'unknown');
    return { status: issues.length > 0 ? 'infeasible' : underSpecified ? 'under-specified' : 'feasible', issues };
};
