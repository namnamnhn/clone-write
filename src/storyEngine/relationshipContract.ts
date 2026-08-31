import { ROMANCE_MILESTONES } from './relationshipTypes';
import type {
    RelationshipActionType,
    RelationshipBoundary,
    RelationshipProgressionIntent,
    RomanceMilestone,
} from './relationshipTypes';

export interface RelationshipContractAction {
    readonly id: string;
    readonly relationshipId: string;
    readonly actionType: RelationshipActionType;
    readonly currentRomanceMilestone: RomanceMilestone;
    readonly intendedProgression: RelationshipProgressionIntent;
    readonly boundaries: readonly RelationshipBoundary[];
    readonly dependsOnActionId?: string;
}

const boundaryIncompatibleRomanticActions = new Set<RelationshipActionType>([
    'flirtation', 'romantic-tension', 'courtship', 'confession', 'accept-romance',
]);

export const romanceMilestoneChanged = (action: RelationshipContractAction): boolean =>
    action.currentRomanceMilestone !== action.intendedProgression.romanticMilestone;

export const requiresFinalCanonicalRelationshipConsequence = (action: RelationshipContractAction): boolean =>
    !action.intendedProgression.intermediate && (
        romanceMilestoneChanged(action)
        || action.intendedProgression.direction !== 'stable'
        || action.intendedProgression.expectedState !== undefined
    );

export const relationshipContractContradictions = (action: RelationshipContractAction): readonly string[] => {
    const problems: string[] = [];
    const currentIndex = ROMANCE_MILESTONES.indexOf(action.currentRomanceMilestone);
    const nextIndex = ROMANCE_MILESTONES.indexOf(action.intendedProgression.romanticMilestone);
    const activeNoRomanceBoundary = action.boundaries.some(boundary =>
        (boundary.constraint === 'professional-only' || boundary.constraint === 'no-romance')
        && (boundary.stance === 'maintain' || boundary.stance === 'set'));
    if (activeNoRomanceBoundary && boundaryIncompatibleRomanticActions.has(action.actionType)) {
        problems.push('action contradicts an active professional-only or no-romance boundary');
    }
    if (action.actionType === 'reject-romance'
        && (action.intendedProgression.mutual || nextIndex > currentIndex || action.intendedProgression.direction === 'strengthening')) {
        problems.push('reject-romance cannot declare mutual or strengthening romantic progression');
    }
    if (action.actionType === 'accept-romance' && !action.intendedProgression.mutual) {
        problems.push('accept-romance requires mutual progression');
    }
    if (action.actionType === 'rupture'
        && (action.intendedProgression.direction === 'strengthening' || nextIndex > currentIndex)) {
        problems.push('rupture cannot strengthen or advance the relationship');
    }
    return problems;
};

const causallyDependsOn = (
    action: RelationshipContractAction,
    predecessorId: string,
    byId: ReadonlyMap<string, RelationshipContractAction>,
): boolean => {
    const visited = new Set<string>();
    let current = action.dependsOnActionId;
    while (current !== undefined && !visited.has(current)) {
        if (current === predecessorId) return true;
        visited.add(current);
        current = byId.get(current)?.dependsOnActionId;
    }
    return false;
};

export const orphanIntermediateActionIds = (
    actions: readonly RelationshipContractAction[],
): readonly string[] => {
    const byId = new Map(actions.map(action => [action.id, action]));
    return actions.filter((action, index) => {
        if (!action.intendedProgression.intermediate) return false;
        const meaningful = romanceMilestoneChanged(action)
            || action.intendedProgression.direction !== 'stable'
            || action.intendedProgression.expectedState !== undefined;
        if (!meaningful) return false;
        return !actions.slice(index + 1).some(candidate => candidate.relationshipId === action.relationshipId
            && !candidate.intendedProgression.intermediate && causallyDependsOn(candidate, action.id, byId));
    }).map(action => action.id);
};
