import { InternalChapterPlan, PlannerContext, PlannerModel } from './plannerTypes';
import { ChapterPlanValidationError, parseInternalChapterPlan, validateInternalChapterPlan } from './planValidator';
import type { FullStoryControl } from './types';
import { buildRelationshipGateValidationView } from './relationshipGateValidation';

/**
 * A model-agnostic prompt for later structured-output adapters. It requests plans only, never
 * chapter prose, and keeps controlled reveal text outside the model's output contract.
 */
export const buildPlannerPrompt = (context: PlannerContext): string => [
    'You are a structured chapter planner. Return JSON only; do not write novel prose.',
    'Plan exactly the target chapter and current arc/beat in the context.',
    'Use IDs for reveals, relationship events, story events, clues, constraints, and secret references.',
    'Never invent a future arc, future beat, locked character, locked POV, locked event, or locked reveal.',
    'Use plotGuidance only as safe timing memory. A due payoff or eligible reveal is not evidence that it already occurred.',
    'Every scene needs one or more purposeTags and conflictImportance. A major conflict must include protagonist and opponent objectives, opponent knowledge/beliefs, a rational countermove, uncertainty, and cost/tradeoff.',
    'Use strategicActions for politics, military, or commerce scene tags. Politics must cover authority/information/personnel/money/law/reputation/time; military must cover logistics, movement, intelligence, failure, and cost; commerce must balance resource flows, source/financing, logistics/time/risk, and competitor response.',
    'Major strategic actions require rational structured counterplay. Certain actor/opponent information must use canonical knowledge fact IDs, and all strategic resource effects must exactly match expectedResourceDeltas.',
    'Use relationshipActions for every relationship-tagged scene. Romantic actions are allowed only for canon-declared romantic relationships and must obey the current milestone, gates, per-relationship slow-burn policy, evidence, participant knowledge, agency, mutuality, boundaries, and expectedRelationshipDeltas.',
    'A controlled relationship or story event being eligible is authorization, not evidence that it occurred. Use canonical relationship history, facts, character knowledge, beliefs, current relationships, or validated same-chapter strategic actions as causal evidence.',
    'Professional cooperation, respect, rivalry, loyalty, and political alliance never imply romantic advancement. Jealousy requires established attachment plus a known or believed trigger. Rejection, hesitation, withdrawal, and stable non-romantic outcomes are valid.',
    'Jealousy actions must set jealousCharacterId to the participant whose canonical knowledge or belief supplies the trigger.',
    'Do not put author-secret values or reveal prose in the output. Reveal text is resolved separately after validation.',
    'Required JSON shape: InternalChapterPlan with kind="internal-chapter-plan", chapterNumber, arcId, optional beatId, primaryGoal, povCharacterId, participantIds, scenes, activeConstraintIds, allowedRevealIds, plannedRevealIds, relationshipEventIds, storyEventIds, cluesPlantedIds, cluesPaidOffIds, expectedResourceDeltas, expectedRelationshipDeltas, expectedContinuityConsequences, strategicActions, relationshipActions, endStateIntent. Legacy non-domain plans may use strategicActions: [] and relationshipActions: [].',
    `CONTEXT:\n${JSON.stringify(context)}`,
].join('\n\n');

/** Calls an adapter, parses unknown output at runtime, and rejects every hard validation failure. */
export const createStructuredPlanner = (model: PlannerModel, trustedControl?: FullStoryControl) => ({
    async plan(context: PlannerContext): Promise<InternalChapterPlan> {
        const rawOutput = await model.plan(context);
        const parsed = parseInternalChapterPlan(rawOutput);
        const semanticIssues = parsed.plan === undefined ? [] : validateInternalChapterPlan(
            parsed.plan,
            context,
            trustedControl === undefined ? undefined : buildRelationshipGateValidationView(trustedControl, context.targetChapter),
        );
        const issues = [...parsed.issues, ...semanticIssues];
        if (!parsed.plan || issues.some(entry => entry.severity === 'error')) throw new ChapterPlanValidationError(issues);
        return parsed.plan;
    },
});
