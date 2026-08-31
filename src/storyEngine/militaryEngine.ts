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

const resolvedLocationBeforeAction = (
    action: MilitaryActionPlan,
    plan: InternalChapterPlan,
    canonicalLocation: string,
): string => (plan.strategicActions ?? [])
    .map((candidate, index) => ({ candidate, index }))
    .filter((entry): entry is { readonly candidate: MilitaryActionPlan; readonly index: number } =>
        entry.candidate.domain === 'military'
        && entry.candidate.id !== action.id
        && entry.candidate.actorCharacterId === action.actorCharacterId
        && firstSceneOrder(entry.candidate, plan) < firstSceneOrder(action, plan))
    .sort((left, right) => firstSceneOrder(left.candidate, plan) - firstSceneOrder(right.candidate, plan)
        || left.index - right.index)
    .reduce((location, entry) => {
        const movement = entry.candidate.movement;
        return movement?.transitChapters === 0 && movement.fromLocation === location
            ? movement.toLocation : location;
    }, canonicalLocation);

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
        if (!isMeaningfulText(logistics.resupplyOrFallback)) {
            issues.push(strategicIssue('MILITARY_LOGISTICS_VIOLATION', `${path}.logistics.resupplyOrFallback`, 'logistics requires a meaningful resupply or fallback plan'));
        }
    }

    const actor = context.availableCharacters.find(character => character.id === action.actorCharacterId);
    if (action.movement !== undefined) {
        const transit = action.movement.transitChapters;
        if (transit !== 'unknown' && (!Number.isSafeInteger(transit) || transit < 0)) {
            issues.push(strategicIssue('MILITARY_LOCATION_VIOLATION', `${path}.movement.transitChapters`, 'movement time must be a non-negative safe integer or unknown'));
        }
    }
    if (actor?.location !== undefined) {
        const resolvedLocation = resolvedLocationBeforeAction(action, plan, actor.location);
        const movementStartsHere = action.movement?.fromLocation === resolvedLocation;
        const movementTargetsOperation = action.movement?.toLocation === action.location;
        const completesThisChapter = action.movement?.transitChapters === 0;
        const validJourneyStart = action.operationType === 'march' && movementStartsHere && movementTargetsOperation;
        const validInlineArrival = movementStartsHere && movementTargetsOperation && completesThisChapter;
        if (resolvedLocation !== action.location && !validJourneyStart && !validInlineArrival) {
            issues.push(strategicIssue('MILITARY_LOCATION_VIOLATION', `${path}.location`, 'operation location is not reached by a strictly earlier or current-chapter-completable movement'));
        } else if (action.movement !== undefined && resolvedLocation === action.location
            && action.movement.fromLocation !== resolvedLocation) {
            issues.push(strategicIssue('MILITARY_LOCATION_VIOLATION', `${path}.movement.fromLocation`, 'movement must start at the deterministically resolved same-plan location'));
        }
    }

    if (!isMeaningfulText(action.retreatOrFailurePlan)) {
        issues.push(strategicIssue('MILITARY_LOGISTICS_VIOLATION', `${path}.retreatOrFailurePlan`, 'military action requires a meaningful retreat or failure plan'));
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
