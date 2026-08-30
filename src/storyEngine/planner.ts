import { InternalChapterPlan, PlannerContext, PlannerModel } from './plannerTypes';
import { ChapterPlanValidationError, parseInternalChapterPlan, validateInternalChapterPlan } from './planValidator';

/**
 * A model-agnostic prompt for later structured-output adapters. It requests plans only, never
 * chapter prose, and keeps controlled reveal text outside the model's output contract.
 */
export const buildPlannerPrompt = (context: PlannerContext): string => [
    'You are a structured chapter planner. Return JSON only; do not write novel prose.',
    'Plan exactly the target chapter and current arc/beat in the context.',
    'Use IDs for reveals, relationship events, story events, clues, constraints, and secret references.',
    'Never invent a future arc, future beat, locked character, locked POV, locked event, or locked reveal.',
    'Every scene needs one or more purposeTags and conflictImportance. A major conflict must include protagonist and opponent objectives, opponent knowledge/beliefs, a rational countermove, uncertainty, and cost/tradeoff.',
    'Do not put author-secret values or reveal prose in the output. Reveal text is resolved separately after validation.',
    'Required JSON shape: InternalChapterPlan with kind="internal-chapter-plan", chapterNumber, arcId, optional beatId, primaryGoal, povCharacterId, participantIds, scenes, activeConstraintIds, allowedRevealIds, plannedRevealIds, relationshipEventIds, storyEventIds, cluesPlantedIds, cluesPaidOffIds, expectedResourceDeltas, expectedRelationshipDeltas, expectedContinuityConsequences, endStateIntent.',
    `CONTEXT:\n${JSON.stringify(context)}`,
].join('\n\n');

/** Calls an adapter, parses unknown output at runtime, and rejects every hard validation failure. */
export const createStructuredPlanner = (model: PlannerModel) => ({
    async plan(context: PlannerContext): Promise<InternalChapterPlan> {
        const rawOutput = await model.plan(context);
        const parsed = parseInternalChapterPlan(rawOutput);
        const semanticIssues = parsed.plan === undefined ? [] : validateInternalChapterPlan(parsed.plan, context);
        const issues = [...parsed.issues, ...semanticIssues];
        if (!parsed.plan || issues.some(entry => entry.severity === 'error')) throw new ChapterPlanValidationError(issues);
        return parsed.plan;
    },
});
