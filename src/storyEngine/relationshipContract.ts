import { ROMANCE_MILESTONES } from './relationshipTypes';
import type {
    RelationshipActionType,
    RelationshipBoundary,
    RelationshipCategory,
    RelationshipProgressionIntent,
    PowerBalanceState,
    RomanceMilestone,
} from './relationshipTypes';

export interface RelationshipContractAction {
    readonly id: string;
    readonly sceneIds: readonly string[];
    readonly relationshipId: string;
    readonly actionType: RelationshipActionType;
    readonly importance: 'minor' | 'major';
    readonly currentRomanceMilestone: RomanceMilestone;
    readonly intendedProgression: RelationshipProgressionIntent;
    readonly boundaries: readonly RelationshipBoundary[];
    readonly dependsOnActionId?: string;
}

const boundaryIncompatibleRomanticActions = new Set<RelationshipActionType>([
    'flirtation', 'romantic-tension', 'courtship', 'confession', 'accept-romance',
]);

const intrinsicallyMajorActionTypes = new Set<RelationshipActionType>([
    'confession', 'accept-romance', 'reject-romance', 'rupture', 'reconciliation',
]);

const finalCanonicalOutcomeActionTypes = new Set<RelationshipActionType>([
    'accept-romance', 'reject-romance', 'rupture', 'reconciliation',
]);

export const isIntrinsicallyMajorRelationshipAction = (actionType: RelationshipActionType): boolean =>
    intrinsicallyMajorActionTypes.has(actionType);

export const isFinalCanonicalOutcomeRelationshipAction = (actionType: RelationshipActionType): boolean =>
    finalCanonicalOutcomeActionTypes.has(actionType);

export const romanceMilestoneChanged = (action: RelationshipContractAction): boolean =>
    action.currentRomanceMilestone !== action.intendedProgression.romanticMilestone;

export const romanceMilestoneAdvances = (action: RelationshipContractAction): boolean =>
    ROMANCE_MILESTONES.indexOf(action.intendedProgression.romanticMilestone)
    > ROMANCE_MILESTONES.indexOf(action.currentRomanceMilestone);

export const requiresFullParticipantChoices = (action: RelationshipContractAction): boolean =>
    action.importance === 'major' || romanceMilestoneAdvances(action);

export const requiresPowerImbalanceAddressing = (
    importance: 'minor' | 'major',
    category: RelationshipCategory,
    powerBalance: PowerBalanceState,
): boolean => importance === 'major' && category === 'romantic' && powerBalance === 'unequal';

export const requiresFinalCanonicalRelationshipConsequence = (action: RelationshipContractAction): boolean =>
    isFinalCanonicalOutcomeRelationshipAction(action.actionType) || (!action.intendedProgression.intermediate && (
        romanceMilestoneChanged(action)
        || action.intendedProgression.direction !== 'stable'
        || action.intendedProgression.expectedState !== undefined
    ));

export const relationshipContractContradictions = (action: RelationshipContractAction): readonly string[] => {
    const problems: string[] = [];
    const currentIndex = ROMANCE_MILESTONES.indexOf(action.currentRomanceMilestone);
    const nextIndex = ROMANCE_MILESTONES.indexOf(action.intendedProgression.romanticMilestone);
    if (isIntrinsicallyMajorRelationshipAction(action.actionType) && action.importance !== 'major') {
        problems.push('action type is intrinsically major and cannot be classified as minor');
    }
    if (isFinalCanonicalOutcomeRelationshipAction(action.actionType) && action.intendedProgression.intermediate) {
        problems.push('outcome action must be final rather than intermediate');
    }
    if (action.intendedProgression.direction === 'stable' && nextIndex !== currentIndex) {
        problems.push('stable direction requires the romantic milestone to remain unchanged');
    }
    if (action.intendedProgression.direction === 'strengthening' && nextIndex < currentIndex) {
        problems.push('strengthening direction cannot regress the romantic milestone');
    }
    if (action.intendedProgression.direction === 'weakening' && nextIndex > currentIndex) {
        problems.push('weakening direction cannot advance the romantic milestone');
    }
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
    if (action.actionType === 'accept-romance' && action.intendedProgression.direction !== 'strengthening') {
        problems.push('accept-romance requires strengthening direction');
    }
    if (action.actionType === 'accept-romance' && nextIndex <= currentIndex) {
        problems.push('accept-romance requires a strictly advancing romantic milestone');
    }
    if (action.actionType === 'accept-romance'
        && nextIndex < ROMANCE_MILESTONES.indexOf('acknowledged-interest')) {
        problems.push('accept-romance must reach at least acknowledged-interest');
    }
    if (action.actionType === 'rupture'
        && (action.intendedProgression.direction === 'strengthening' || nextIndex > currentIndex)) {
        problems.push('rupture cannot strengthen or advance the relationship');
    }
    if (action.actionType === 'rupture'
        && action.intendedProgression.direction !== 'weakening'
        && action.intendedProgression.direction !== 'conflicted') {
        problems.push('rupture requires weakening or conflicted direction');
    }
    if (action.actionType === 'reconciliation'
        && action.intendedProgression.direction !== 'strengthening'
        && action.intendedProgression.direction !== 'conflicted') {
        problems.push('reconciliation requires strengthening or conflicted direction');
    }
    return problems;
};

export interface RelationshipSequenceScene {
    readonly id: string;
    readonly order: number;
}

export interface RelationshipSequenceProblem {
    readonly actionId: string;
    readonly kind: 'causality' | 'intermediate' | 'boundary';
    readonly message: string;
}

interface SceneRange { readonly minimum: number; readonly maximum: number; }

const sceneRange = (
    action: RelationshipContractAction,
    sceneOrder: ReadonlyMap<string, number>,
): SceneRange | undefined => {
    const orders: number[] = [];
    for (const id of action.sceneIds) {
        const order = sceneOrder.get(id);
        if (order === undefined) return undefined;
        orders.push(order);
    }
    if (orders.length === 0) return undefined;
    return { minimum: Math.min(...orders), maximum: Math.max(...orders) };
};

const strictlyEarlier = (
    prior: RelationshipContractAction,
    current: RelationshipContractAction,
    ranges: ReadonlyMap<string, SceneRange>,
): boolean => {
    const priorRange = ranges.get(prior.id);
    const currentRange = ranges.get(current.id);
    return priorRange !== undefined && currentRange !== undefined && priorRange.maximum < currentRange.minimum;
};

const causallyDependsOn = (
    action: RelationshipContractAction,
    predecessorId: string,
    byId: ReadonlyMap<string, RelationshipContractAction>,
    ranges: ReadonlyMap<string, SceneRange>,
): boolean => {
    const visited = new Set<string>();
    let currentAction = action;
    while (currentAction.dependsOnActionId !== undefined && !visited.has(currentAction.dependsOnActionId)) {
        const current = currentAction.dependsOnActionId;
        const prior = byId.get(current);
        if (!prior || prior.relationshipId !== currentAction.relationshipId || !strictlyEarlier(prior, currentAction, ranges)) return false;
        if (current === predecessorId) return true;
        visited.add(current);
        currentAction = prior;
    }
    return false;
};

export const orphanIntermediateActionIds = (
    actions: readonly RelationshipContractAction[],
    scenes: readonly RelationshipSequenceScene[],
): readonly string[] => {
    const byId = new Map(actions.map(action => [action.id, action]));
    const sceneOrder = new Map(scenes.map(scene => [scene.id, scene.order]));
    const ranges = new Map(actions.flatMap(action => {
        const range = sceneRange(action, sceneOrder);
        return range === undefined ? [] : [[action.id, range] as const];
    }));
    return actions.filter((action) => {
        if (!action.intendedProgression.intermediate) return false;
        const meaningful = romanceMilestoneChanged(action)
            || action.intendedProgression.direction !== 'stable'
            || action.intendedProgression.expectedState !== undefined;
        if (!meaningful) return false;
        return !actions.some(candidate => candidate.relationshipId === action.relationshipId
            && !candidate.intendedProgression.intermediate && causallyDependsOn(candidate, action.id, byId, ranges));
    }).map(action => action.id);
};

const boundaryKey = (boundary: RelationshipBoundary): string =>
    `${boundary.characterId}\u0000${boundary.type}\u0000${boundary.constraint}`;

const boundaryOwnerTypeKey = (boundary: RelationshipBoundary): string =>
    `${boundary.characterId}\u0000${boundary.type}`;

const applyBoundaryEffects = (
    active: Map<string, RelationshipBoundary>,
    boundaries: readonly RelationshipBoundary[],
): void => {
    boundaries.forEach((boundary) => {
        if (boundary.stance === 'release') {
            active.delete(boundaryKey(boundary));
            return;
        }
        if (boundary.stance === 'revise') {
            const ownerType = boundaryOwnerTypeKey(boundary);
            [...active.entries()].forEach(([key, current]) => {
                if (boundaryOwnerTypeKey(current) === ownerType) active.delete(key);
            });
        }
        active.set(boundaryKey(boundary), boundary);
    });
};

const hasIncompatibleRomanticBoundary = (
    action: RelationshipContractAction,
    boundaries: Iterable<RelationshipBoundary>,
): boolean => boundaryIncompatibleRomanticActions.has(action.actionType) && [...boundaries].some(boundary =>
    boundary.constraint === 'professional-only' || boundary.constraint === 'no-romance');

/**
 * Pure same-plan replay. Boundary identity is owner + type + constraint; revise replaces every
 * active boundary for the same owner + type. Only actions that end in an earlier scene affect a
 * later action, so action IDs and same-scene array order never establish chronology. Persisted
 * cross-chapter structured boundaries remain a future canonical-schema decision.
 */
export const relationshipSequenceProblems = (
    actions: readonly RelationshipContractAction[],
    scenes: readonly RelationshipSequenceScene[],
): readonly RelationshipSequenceProblem[] => {
    const problems: RelationshipSequenceProblem[] = [];
    const sceneOrder = new Map(scenes.map(scene => [scene.id, scene.order]));
    const byId = new Map(actions.map(action => [action.id, action]));
    const ranges = new Map(actions.flatMap(action => {
        const range = sceneRange(action, sceneOrder);
        return range === undefined ? [] : [[action.id, range] as const];
    }));

    actions.forEach((action) => {
        if (action.dependsOnActionId === undefined) return;
        const prior = byId.get(action.dependsOnActionId);
        if (!prior || prior.relationshipId !== action.relationshipId || !strictlyEarlier(prior, action, ranges)) {
            problems.push({ actionId: action.id, kind: 'causality', message: 'causal predecessor must finish in a strictly earlier scene for the same relationship' });
        }
    });

    const orphanIds = new Set(orphanIntermediateActionIds(actions, scenes));
    actions.forEach((action) => {
        if (orphanIds.has(action.id)) problems.push({ actionId: action.id, kind: 'intermediate', message: 'meaningful intermediate progression requires a causally linked final action in a strictly later scene' });
    });

    actions.forEach((action) => {
        const range = ranges.get(action.id);
        if (!range) return;
        const priorActions = actions.filter(candidate => candidate.relationshipId === action.relationshipId
            && candidate.id !== action.id && strictlyEarlier(candidate, action, ranges));
        const active = new Map<string, RelationshipBoundary>();
        priorActions.forEach((prior) => {
            const localOutcome = new Map<string, RelationshipBoundary>();
            applyBoundaryEffects(localOutcome, prior.boundaries);
            localOutcome.forEach((boundary) => {
                const superseded = priorActions.some(later => strictlyEarlier(prior, later, ranges)
                    && later.boundaries.some(laterBoundary => laterBoundary.stance === 'release'
                        ? boundaryKey(laterBoundary) === boundaryKey(boundary)
                        : laterBoundary.stance === 'revise'
                            && boundaryOwnerTypeKey(laterBoundary) === boundaryOwnerTypeKey(boundary)));
                if (!superseded) active.set(boundaryKey(boundary), boundary);
            });
        });
        const effectiveForAction = new Map(active);
        applyBoundaryEffects(effectiveForAction, action.boundaries);
        if (hasIncompatibleRomanticBoundary(action, effectiveForAction.values())) {
            problems.push({ actionId: action.id, kind: 'boundary', message: 'action contradicts an active same-chapter professional-only or no-romance boundary' });
        }

        const actionScenes = new Set(action.sceneIds);
        const overlappingBoundaryAction = actions.find(candidate => candidate.id !== action.id
            && candidate.relationshipId === action.relationshipId
            && candidate.sceneIds.some(id => actionScenes.has(id))
            && candidate.boundaries.some(boundary => (boundary.constraint === 'professional-only' || boundary.constraint === 'no-romance')
                && (boundary.stance === 'set' || boundary.stance === 'maintain')));
        if (overlappingBoundaryAction && boundaryIncompatibleRomanticActions.has(action.actionType)) {
            problems.push({ actionId: action.id, kind: 'boundary', message: 'same-scene boundary and romantic actions are chronologically under-specified' });
        }
    });
    return problems;
};
