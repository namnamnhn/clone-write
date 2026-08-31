import {
    ExpectedContinuityConsequence,
    ExpectedRelationshipDelta,
    ExpectedResourceDelta,
    IntelligentConflictPlan,
    InternalChapterPlan,
    InternalPlanScene,
    PlannerContext,
    PlanValidationIssue,
    CONFLICT_IMPORTANCE,
    ConflictImportance,
    SCENE_PURPOSE_TAGS,
    ScenePurposeTag,
} from './plannerTypes';
import { parseStrategicActions } from './strategicRuntime';
import { validateStrategicActions } from './strategicValidator';

export class ChapterPlanValidationError extends Error {
    constructor(public readonly issues: readonly PlanValidationIssue[]) {
        super(issues.map(issue => `${issue.code} ${issue.path}: ${issue.message}`).join('\n'));
        this.name = 'ChapterPlanValidationError';
    }
}

export interface InternalPlanParseResult {
    readonly plan?: InternalChapterPlan;
    readonly issues: readonly PlanValidationIssue[];
}

const issue = (issues: PlanValidationIssue[], code: string, path: string, message: string): void => {
    issues.push({ code, path, message, severity: 'error' });
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isIdArray = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isText);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const requiredText = (source: Record<string, unknown>, key: string, path: string, issues: PlanValidationIssue[]): string | undefined => {
    if (!isText(source[key])) {
        issue(issues, 'INVALID_SHAPE', `${path}.${key}`, 'must be a non-empty string');
        return undefined;
    }
    return source[key];
};
const requiredIds = (source: Record<string, unknown>, key: string, path: string, issues: PlanValidationIssue[]): readonly string[] | undefined => {
    if (!isIdArray(source[key])) {
        issue(issues, 'INVALID_SHAPE', `${path}.${key}`, 'must be an array of non-empty IDs');
        return undefined;
    }
    return [...source[key]];
};

const parseIntelligentConflict = (
    value: unknown,
    path: string,
    issues: PlanValidationIssue[],
): IntelligentConflictPlan | undefined => {
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
        issue(issues, 'INVALID_INTELLIGENT_CONFLICT', path, 'must be an object when supplied');
        return undefined;
    }
    const protagonistObjective = requiredText(value, 'protagonistObjective', path, issues);
    const opponentCharacterId = value.opponentCharacterId === undefined ? undefined : requiredText(value, 'opponentCharacterId', path, issues);
    const opponentObjective = requiredText(value, 'opponentObjective', path, issues);
    const opponentKnowledge = requiredIds(value, 'opponentKnowledge', path, issues);
    const opponentBeliefs = requiredIds(value, 'opponentBeliefs', path, issues);
    const rationalCountermove = requiredText(value, 'rationalCountermove', path, issues);
    const uncertainty = requiredText(value, 'uncertainty', path, issues);
    const expectedCostOrTradeoff = requiredText(value, 'expectedCostOrTradeoff', path, issues);
    if (!protagonistObjective || !opponentObjective || !opponentKnowledge || !opponentBeliefs || !rationalCountermove || !uncertainty || !expectedCostOrTradeoff) return undefined;
    return { ...(opponentCharacterId === undefined ? {} : { opponentCharacterId }), protagonistObjective, opponentObjective, opponentKnowledge, opponentBeliefs, rationalCountermove, uncertainty, expectedCostOrTradeoff };
};

const parseScene = (value: unknown, path: string, issues: PlanValidationIssue[]): InternalPlanScene | undefined => {
    if (!isRecord(value)) {
        issue(issues, 'INVALID_SCENE', path, 'must be an object');
        return undefined;
    }
    const id = requiredText(value, 'id', path, issues);
    const goal = requiredText(value, 'goal', path, issues);
    const location = requiredText(value, 'location', path, issues);
    const povCharacterId = requiredText(value, 'povCharacterId', path, issues);
    const participantIds = requiredIds(value, 'participantIds', path, issues);
    const conflictOrObstacle = requiredText(value, 'conflictOrObstacle', path, issues);
    const uncertainty = requiredText(value, 'uncertainty', path, issues);
    const expectedConsequence = requiredText(value, 'expectedConsequence', path, issues);
    const order = value.order;
    if (!Number.isSafeInteger(order) || (order as number) < 1) issue(issues, 'INVALID_SCENE_ORDER', `${path}.order`, 'must be a positive integer');
    const rawTags = value.purposeTags;
    if (!isIdArray(rawTags) || rawTags.some(tag => !SCENE_PURPOSE_TAGS.includes(tag as ScenePurposeTag))) {
        issue(issues, 'INVALID_PURPOSE_TAGS', `${path}.purposeTags`, 'must contain supported purpose tags');
    }
    const conflictImportance = value.conflictImportance;
    if (!isText(conflictImportance) || !CONFLICT_IMPORTANCE.includes(conflictImportance as ConflictImportance)) {
        issue(issues, 'INVALID_CONFLICT_IMPORTANCE', `${path}.conflictImportance`, 'must be minor or major');
    }
    if (conflictImportance === 'major' && value.intelligentConflict === undefined) {
        issue(issues, 'INTELLIGENT_CONFLICT_REQUIRED', `${path}.intelligentConflict`, 'major conflict requires intelligent conflict details');
    }
    const intelligentConflict = parseIntelligentConflict(value.intelligentConflict, `${path}.intelligentConflict`, issues);
    if (!id || !goal || !location || !povCharacterId || !participantIds || !conflictOrObstacle || !uncertainty || !expectedConsequence
        || !Number.isSafeInteger(order) || (order as number) < 1 || !isIdArray(rawTags) || rawTags.some(tag => !SCENE_PURPOSE_TAGS.includes(tag as ScenePurposeTag))
        || !isText(conflictImportance) || !CONFLICT_IMPORTANCE.includes(conflictImportance as ConflictImportance)
        || (conflictImportance === 'major' && intelligentConflict === undefined)) return undefined;
    return {
        id, order: order as number, goal, location, povCharacterId, participantIds,
        conflictOrObstacle, uncertainty, expectedConsequence, purposeTags: [...rawTags] as ScenePurposeTag[], conflictImportance: conflictImportance as ConflictImportance,
        ...(value.intelligentConflict === undefined ? {} : intelligentConflict === undefined ? {} : { intelligentConflict }),
    };
};

const parseResourceDeltas = (value: unknown, path: string, issues: PlanValidationIssue[]): readonly ExpectedResourceDelta[] | undefined => {
    if (!Array.isArray(value)) { issue(issues, 'INVALID_SHAPE', path, 'must be an array'); return undefined; }
    const result: ExpectedResourceDelta[] = [];
    value.forEach((entry, index) => {
        const entryPath = `${path}.${index}`;
        if (!isRecord(entry)) { issue(issues, 'INVALID_RESOURCE_DELTA', entryPath, 'must be an object'); return; }
        const characterId = requiredText(entry, 'characterId', entryPath, issues);
        const resourceId = requiredText(entry, 'resourceId', entryPath, issues);
        if (entry.quantityDelta !== undefined && !isNumber(entry.quantityDelta)) issue(issues, 'INVALID_RESOURCE_DELTA', `${entryPath}.quantityDelta`, 'must be a finite number');
        if (entry.nextState !== undefined && !isText(entry.nextState)) issue(issues, 'INVALID_RESOURCE_DELTA', `${entryPath}.nextState`, 'must be a non-empty string');
        if (!characterId || !resourceId || (entry.quantityDelta !== undefined && !isNumber(entry.quantityDelta)) || (entry.nextState !== undefined && !isText(entry.nextState))) return;
        result.push({ characterId, resourceId, ...(entry.quantityDelta === undefined ? {} : { quantityDelta: entry.quantityDelta as number }), ...(entry.nextState === undefined ? {} : { nextState: entry.nextState as string }) });
    });
    return result;
};

const parseRelationshipDeltas = (value: unknown, path: string, issues: PlanValidationIssue[]): readonly ExpectedRelationshipDelta[] | undefined => {
    if (!Array.isArray(value)) { issue(issues, 'INVALID_SHAPE', path, 'must be an array'); return undefined; }
    const result: ExpectedRelationshipDelta[] = [];
    value.forEach((entry, index) => {
        const entryPath = `${path}.${index}`;
        if (!isRecord(entry)) { issue(issues, 'INVALID_RELATIONSHIP_DELTA', entryPath, 'must be an object'); return; }
        const relationshipId = requiredText(entry, 'relationshipId', entryPath, issues);
        const participantIds = requiredIds(entry, 'participantIds', entryPath, issues);
        const expectedState = requiredText(entry, 'expectedState', entryPath, issues);
        if (relationshipId && participantIds && expectedState) result.push({ relationshipId, participantIds, expectedState });
    });
    return result;
};

const parseContinuityConsequences = (value: unknown, path: string, issues: PlanValidationIssue[]): readonly ExpectedContinuityConsequence[] | undefined => {
    if (!Array.isArray(value)) { issue(issues, 'INVALID_SHAPE', path, 'must be an array'); return undefined; }
    const result: ExpectedContinuityConsequence[] = [];
    value.forEach((entry, index) => {
        const entryPath = `${path}.${index}`;
        if (!isRecord(entry)) { issue(issues, 'INVALID_CONTINUITY_CONSEQUENCE', entryPath, 'must be an object'); return; }
        const id = requiredText(entry, 'id', entryPath, issues);
        const text = requiredText(entry, 'text', entryPath, issues);
        if (id && text) result.push({ id, text });
    });
    return result;
};

/** Runtime parser: unknown model JSON is copied into a fresh typed plan only after structural checks. */
export const parseInternalChapterPlan = (value: unknown): InternalPlanParseResult => {
    const issues: PlanValidationIssue[] = [];
    if (!isRecord(value)) {
        issue(issues, 'INVALID_SHAPE', '$', 'planner output must be an object');
        return { issues };
    }
    const chapterNumber = value.chapterNumber;
    if (!Number.isSafeInteger(chapterNumber) || (chapterNumber as number) < 1) issue(issues, 'INVALID_CHAPTER', 'chapterNumber', 'must be a positive integer');
    const kind = requiredText(value, 'kind', '$', issues);
    if (kind !== undefined && kind !== 'internal-chapter-plan') issue(issues, 'INVALID_KIND', 'kind', 'must be internal-chapter-plan');
    const arcId = requiredText(value, 'arcId', '$', issues);
    const beatId = value.beatId === undefined ? undefined : requiredText(value, 'beatId', '$', issues);
    const primaryGoal = requiredText(value, 'primaryGoal', '$', issues);
    const povCharacterId = requiredText(value, 'povCharacterId', '$', issues);
    const participantIds = requiredIds(value, 'participantIds', '$', issues);
    const scenes = Array.isArray(value.scenes)
        ? value.scenes.map((scene, index) => parseScene(scene, `scenes.${index}`, issues)).filter((scene): scene is InternalPlanScene => scene !== undefined)
        : (issue(issues, 'INVALID_SHAPE', 'scenes', 'must be an array'), [] as InternalPlanScene[]);
    const activeConstraintIds = requiredIds(value, 'activeConstraintIds', '$', issues);
    const allowedRevealIds = requiredIds(value, 'allowedRevealIds', '$', issues);
    const plannedRevealIds = requiredIds(value, 'plannedRevealIds', '$', issues);
    const relationshipEventIds = requiredIds(value, 'relationshipEventIds', '$', issues);
    const storyEventIds = requiredIds(value, 'storyEventIds', '$', issues);
    const cluesPlantedIds = requiredIds(value, 'cluesPlantedIds', '$', issues);
    const cluesPaidOffIds = requiredIds(value, 'cluesPaidOffIds', '$', issues);
    const expectedResourceDeltas = parseResourceDeltas(value.expectedResourceDeltas, 'expectedResourceDeltas', issues);
    const expectedRelationshipDeltas = parseRelationshipDeltas(value.expectedRelationshipDeltas, 'expectedRelationshipDeltas', issues);
    const expectedContinuityConsequences = parseContinuityConsequences(value.expectedContinuityConsequences, 'expectedContinuityConsequences', issues);
    const strategicActions = parseStrategicActions(value.strategicActions, 'strategicActions', issues);
    const endStateIntent = requiredText(value, 'endStateIntent', '$', issues);
    if (issues.length > 0 || kind !== 'internal-chapter-plan' || !Number.isSafeInteger(chapterNumber) || (chapterNumber as number) < 1
        || !arcId || !primaryGoal || !povCharacterId || !participantIds || !activeConstraintIds || !allowedRevealIds || !plannedRevealIds
        || !relationshipEventIds || !storyEventIds || !cluesPlantedIds || !cluesPaidOffIds || !expectedResourceDeltas || !expectedRelationshipDeltas
        || !expectedContinuityConsequences || !strategicActions || !endStateIntent) return { issues };
    return { plan: {
        kind: 'internal-chapter-plan', chapterNumber: chapterNumber as number, arcId, ...(beatId === undefined ? {} : { beatId }), primaryGoal, povCharacterId,
        participantIds, scenes, activeConstraintIds, allowedRevealIds, plannedRevealIds, relationshipEventIds, storyEventIds,
        cluesPlantedIds, cluesPaidOffIds, expectedResourceDeltas, expectedRelationshipDeltas, expectedContinuityConsequences, strategicActions, endStateIntent,
    }, issues };
};

const hasOnlyKnown = (values: readonly string[], allowed: ReadonlySet<string>): boolean => values.every(value => allowed.has(value));

const hasCompleteIntelligentConflict = (conflict: IntelligentConflictPlan | undefined): boolean => conflict !== undefined
    && isText(conflict.protagonistObjective)
    && isText(conflict.opponentObjective)
    && isIdArray(conflict.opponentKnowledge)
    && isIdArray(conflict.opponentBeliefs)
    && isText(conflict.rationalCountermove)
    && isText(conflict.uncertainty)
    && isText(conflict.expectedCostOrTradeoff);

/** Checks semantic invariants against the freshly built target-chapter context. */
export const validateInternalChapterPlan = (
    plan: InternalChapterPlan,
    context: PlannerContext,
): readonly PlanValidationIssue[] => {
    const issues: PlanValidationIssue[] = [];
    const add = (code: string, path: string, message: string) => issue(issues, code, path, message);
    const availableCharacters = new Set(context.availableCharacters.map(character => character.id));
    const allowedPovs = new Set(context.povEligibility.filter(entry => entry.allowed).map(entry => entry.id));
    const allowedConstraints = new Set(context.activeHardConstraints.map(constraint => constraint.id));
    const allowedReveals = new Set(context.allowedRevealIds);
    const allowedEvents = new Set(context.allowedStoryEventIds);
    const allowedRelationshipEvents = new Map(context.allowedRelationshipEvents.map(event => [event.id, new Set(event.participantIds)]));

    if (plan.chapterNumber !== context.targetChapter) add('CHAPTER_MISMATCH', 'chapterNumber', `must equal target chapter ${context.targetChapter}`);
    if (plan.chapterNumber > context.plannedChapterCount) add('CHAPTER_OUT_OF_RANGE', 'chapterNumber', `must not exceed planned chapter count ${context.plannedChapterCount}`);
    if (plan.chapterNumber < context.currentArc.startChapter || plan.chapterNumber > context.currentArc.endChapter) add('FUTURE_ARC', 'chapterNumber', 'must remain inside the current arc');
    if (plan.arcId !== context.currentArc.id) add('ARC_MISMATCH', 'arcId', `must equal current arc ${context.currentArc.id}`);
    if (context.currentBeat && plan.beatId !== context.currentBeat.id) add('BEAT_MISMATCH', 'beatId', `must equal current beat ${context.currentBeat.id}`);
    if (!context.currentBeat && plan.beatId !== undefined) add('FUTURE_BEAT', 'beatId', 'must be omitted because this arc has no active beat');
    if (!allowedPovs.has(plan.povCharacterId)) add('POV_LOCKED', 'povCharacterId', 'POV is unavailable for this chapter');
    if (!hasOnlyKnown(plan.participantIds, availableCharacters)) add('CHARACTER_LOCKED', 'participantIds', 'contains unavailable character');
    if (!plan.participantIds.includes(plan.povCharacterId)) add('POV_NOT_PARTICIPANT', 'participantIds', 'must include the chapter POV');
    const activeConstraintIds = new Set(plan.activeConstraintIds);
    if (activeConstraintIds.size !== plan.activeConstraintIds.length) add('DUPLICATE_ACTIVE_CONSTRAINT', 'activeConstraintIds', 'must not contain duplicate constraint IDs');
    if (!hasOnlyKnown(plan.activeConstraintIds, allowedConstraints)) add('UNKNOWN_CONSTRAINT', 'activeConstraintIds', 'contains a constraint outside the context allow-list');
    const missingActiveConstraints = [...allowedConstraints].filter(id => !activeConstraintIds.has(id));
    if (missingActiveConstraints.length > 0) add('MISSING_ACTIVE_CONSTRAINT', 'activeConstraintIds', `must include all active hard constraints: ${missingActiveConstraints.join(', ')}`);
    if (!hasOnlyKnown(plan.allowedRevealIds, allowedReveals)) add('REVEAL_LOCKED', 'allowedRevealIds', 'contains a locked or unknown reveal');
    if (!hasOnlyKnown(plan.plannedRevealIds, allowedReveals) || !plan.plannedRevealIds.every(id => plan.allowedRevealIds.includes(id))) add('REVEAL_LOCKED', 'plannedRevealIds', 'must be both allowed by context and declared allowed by the plan');
    if (!hasOnlyKnown(plan.storyEventIds, allowedEvents)) add('STORY_EVENT_LOCKED', 'storyEventIds', 'contains a locked or unknown story event');
    plan.relationshipEventIds.forEach((eventId, index) => {
        const requiredParticipants = allowedRelationshipEvents.get(eventId);
        if (!requiredParticipants) add('RELATIONSHIP_EVENT_LOCKED', `relationshipEventIds.${index}`, 'event is locked or unknown');
        else if (![...requiredParticipants].every(id => availableCharacters.has(id) && plan.participantIds.includes(id))) add('RELATIONSHIP_PARTICIPANTS_INVALID', `relationshipEventIds.${index}`, 'all event participants must be currently available and in the plan');
    });
    const sceneOrders = plan.scenes.map(scene => scene.order);
    if (new Set(sceneOrders).size !== sceneOrders.length || sceneOrders.some((order, index) => order !== index + 1)) add('SCENE_ORDER_INVALID', 'scenes', 'scene order must be unique, consecutive, and start at 1');
    plan.scenes.forEach((scene, index) => {
        if (scene.purposeTags.length === 0) add('SCENE_PURPOSE_MISSING', `scenes.${index}.purposeTags`, 'every scene requires at least one purpose tag');
        if (!hasOnlyKnown(scene.purposeTags, new Set(SCENE_PURPOSE_TAGS))) add('SCENE_PURPOSE_INVALID', `scenes.${index}.purposeTags`, 'contains an unsupported purpose tag');
        if (!allowedPovs.has(scene.povCharacterId)) add('POV_LOCKED', `scenes.${index}.povCharacterId`, 'scene POV is unavailable');
        if (!hasOnlyKnown(scene.participantIds, availableCharacters) || !scene.participantIds.every(id => plan.participantIds.includes(id))) add('CHARACTER_LOCKED', `scenes.${index}.participantIds`, 'scene includes an unavailable or undeclared participant');
        if (scene.conflictImportance === 'major' && scene.intelligentConflict === undefined) {
            add('INTELLIGENT_CONFLICT_REQUIRED', `scenes.${index}.intelligentConflict`, 'major conflict requires intelligent conflict details');
        } else if (scene.intelligentConflict !== undefined && !hasCompleteIntelligentConflict(scene.intelligentConflict)) {
            add('INTELLIGENT_CONFLICT_INCOMPLETE', `scenes.${index}.intelligentConflict`, 'intelligent conflict must include all required strategic fields');
        }
        if (scene.intelligentConflict?.opponentCharacterId !== undefined) {
            const opponent = scene.intelligentConflict.opponentCharacterId;
            if (!availableCharacters.has(opponent)) add('CHARACTER_LOCKED', `scenes.${index}.intelligentConflict.opponentCharacterId`, 'opponent is unavailable');
            const known = new Set(context.characterKnowledge.find(entry => entry.characterId === opponent)?.factIds ?? []);
            scene.intelligentConflict.opponentKnowledge.forEach((factId, knowledgeIndex) => {
                if (!known.has(factId)) add('OPPONENT_KNOWLEDGE_VIOLATION', `scenes.${index}.intelligentConflict.opponentKnowledge.${knowledgeIndex}`, 'opponent knowledge is not canonical for the identified opponent');
            });
        }
    });
    plan.expectedResourceDeltas.forEach((delta, index) => {
        if (!availableCharacters.has(delta.characterId)) add('CHARACTER_LOCKED', `expectedResourceDeltas.${index}.characterId`, 'resource delta uses unavailable character');
    });
    plan.expectedRelationshipDeltas.forEach((delta, index) => {
        if (delta.participantIds.length < 2 || !hasOnlyKnown(delta.participantIds, availableCharacters)) add('RELATIONSHIP_PARTICIPANTS_INVALID', `expectedRelationshipDeltas.${index}.participantIds`, 'relationship delta needs at least two available participants');
    });
    issues.push(...validateStrategicActions(plan, context));
    return issues;
};
