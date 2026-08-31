import type { InternalChapterPlan, PlanValidationIssue, PlannerContext } from './plannerTypes';
import {
    strategicCharacterKnowsFact,
    isMeaningfulText,
    resourceFor,
    strategicIssue,
} from './strategicEvidence';
import {
    MILITARY_READINESS_DIMENSIONS,
    MilitaryActionPlan,
} from './strategicTypes';

const majorOffensiveTypes = new Set<MilitaryActionPlan['operationType']>([
    'raid', 'siege', 'assault', 'ambush', 'blockade',
]);

const firstSceneOrder = (action: MilitaryActionPlan, plan: InternalChapterPlan): number => {
    const orders = action.sceneIds.map(id => plan.scenes.find(scene => scene.id === id)?.order ?? Number.MAX_SAFE_INTEGER);
    return Math.min(...orders);
};

const hasPriorMovement = (action: MilitaryActionPlan, plan: InternalChapterPlan): boolean =>
    (plan.strategicActions ?? []).some(candidate => candidate.domain === 'military'
        && candidate.id !== action.id
        && candidate.actorCharacterId === action.actorCharacterId
        && candidate.operationType === 'march'
        && candidate.movement?.toLocation === action.location
        && firstSceneOrder(candidate, plan) <= firstSceneOrder(action, plan));

/** Pure logistics/epistemic checks. No combat winner or probability is produced. */
export const validateMilitaryAction = (
    action: MilitaryActionPlan,
    context: PlannerContext,
    plan: InternalChapterPlan,
    path: string,
): readonly PlanValidationIssue[] => {
    const issues: PlanValidationIssue[] = [];
    const counts = new Map(MILITARY_READINESS_DIMENSIONS.map(dimension => [dimension, 0]));
    action.readiness.forEach((assessment, index) => {
        counts.set(assessment.dimension, (counts.get(assessment.dimension) ?? 0) + 1);
        if ((assessment.status === 'supporting' || assessment.status === 'constraining') && assessment.evidenceRefs.length === 0) {
            issues.push(strategicIssue('MILITARY_RESOURCE_VIOLATION', `${path}.readiness.${index}.evidenceRefs`, 'supporting and constraining military readiness requires evidence'));
        }
    });
    MILITARY_READINESS_DIMENSIONS.forEach((dimension) => {
        if (counts.get(dimension) !== 1) {
            issues.push(strategicIssue('MILITARY_RESOURCE_VIOLATION', `${path}.readiness`, `military action requires exactly one ${dimension} readiness assessment`));
        }
    });

    action.intelligenceFactIds.forEach((factId, index) => {
        if (!strategicCharacterKnowsFact(context, action.actorCharacterId, factId)) {
            issues.push(strategicIssue('MILITARY_INTELLIGENCE_VIOLATION', `${path}.intelligenceFactIds.${index}`, 'military intelligence must be canonical knowledge of the actor'));
        }
    });

    const requiresLogistics = action.importance === 'major' && majorOffensiveTypes.has(action.operationType);
    if (requiresLogistics && action.logistics === undefined) {
        issues.push(strategicIssue('MILITARY_LOGISTICS_VIOLATION', `${path}.logistics`, 'major offensive operation requires an explicit logistics plan'));
    }
    if (action.logistics !== undefined) {
        const logistics = action.logistics;
        if (!resourceFor(context, logistics.supplyResource.characterId, logistics.supplyResource.resourceId)
            || (logistics.mobilityResource !== undefined
                && !resourceFor(context, logistics.mobilityResource.characterId, logistics.mobilityResource.resourceId))) {
            issues.push(strategicIssue('MILITARY_LOGISTICS_VIOLATION', `${path}.logistics`, 'logistics resources must resolve against canonical current resources'));
        }
        if (logistics.expectedSupplyConsumption !== 'unknown'
            && (!Number.isFinite(logistics.expectedSupplyConsumption) || logistics.expectedSupplyConsumption < 0)) {
            issues.push(strategicIssue('MILITARY_LOGISTICS_VIOLATION', `${path}.logistics.expectedSupplyConsumption`, 'supply consumption must be a finite non-negative number or unknown'));
        }
        if (logistics.operationalTimeChapters !== 'unknown'
            && (!Number.isSafeInteger(logistics.operationalTimeChapters) || logistics.operationalTimeChapters < 0)) {
            issues.push(strategicIssue('MILITARY_LOGISTICS_VIOLATION', `${path}.logistics.operationalTimeChapters`, 'operational time must be a non-negative safe integer or unknown'));
        }
        if (typeof logistics.expectedSupplyConsumption === 'number') {
            const represented = action.resourceEffects.some(effect => effect.characterId === logistics.supplyResource.characterId
                && effect.resourceId === logistics.supplyResource.resourceId
                && effect.quantityDelta === -logistics.expectedSupplyConsumption);
            if (!represented) {
                issues.push(strategicIssue('MILITARY_LOGISTICS_VIOLATION', `${path}.resourceEffects`, 'numeric supply consumption must be represented exactly as a resource effect'));
            }
        }
    }

    const actor = context.availableCharacters.find(character => character.id === action.actorCharacterId);
    if (actor?.location !== undefined && actor.location !== action.location) {
        const hasInlineMovement = action.movement?.fromLocation === actor.location
            && action.movement.toLocation === action.location;
        if (!hasInlineMovement && !hasPriorMovement(action, plan)) {
            issues.push(strategicIssue('MILITARY_LOCATION_VIOLATION', `${path}.location`, 'operation location conflicts with canonical actor location and has no movement step'));
        }
    }
    if (action.movement !== undefined) {
        const transit = action.movement.transitChapters;
        if (transit !== 'unknown' && (!Number.isSafeInteger(transit) || transit < 0)) {
            issues.push(strategicIssue('MILITARY_LOCATION_VIOLATION', `${path}.movement.transitChapters`, 'movement time must be a non-negative safe integer or unknown'));
        }
    }

    const hasNumericCost = action.resourceEffects.some(effect => effect.quantityDelta < 0)
        || (typeof action.logistics?.expectedSupplyConsumption === 'number' && action.logistics.expectedSupplyConsumption > 0)
        || (typeof action.logistics?.operationalTimeChapters === 'number' && action.logistics.operationalTimeChapters > 0);
    if (action.importance === 'major' && !hasNumericCost
        && !isMeaningfulText(action.expectedLossOrCost)
        && !isMeaningfulText(action.expectedCostOrTradeoff)) {
        issues.push(strategicIssue('MILITARY_COST_MISSING', `${path}.expectedLossOrCost`, 'major military action requires an explicit loss, cost, time burden, or strategic tradeoff'));
    }
    return issues;
};
