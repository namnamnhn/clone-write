import { buildPlannerContext } from './contextBuilder';
import { getArcForChapter, getBeatForChapter, isCharacterDirectAppearanceAllowed, isPovAllowed, isRelationshipEventAllowed, isRevealAllowed, isStoryEventAllowed } from './gates';
import { ChapterPlanValidationError, parseInternalChapterPlan, validateInternalChapterPlan } from './planValidator';
import { InternalChapterPlan, PlanValidationIssue, WriterChapterPlan } from './plannerTypes';
import { FullStoryControl, StoryState } from './types';
import { assertWriterFacingControlSecretSafe } from './secretTextSafety';
import { buildWriterStrategicDirectives } from './strategicContext';
import {
    buildWriterRelationshipDirectives,
    DEFAULT_RELATIONSHIP_CONTEXT_SELECTION_POLICY,
} from './relationshipContext';
import type { RelationshipContextSelectionPolicy } from './relationshipContext';
import { buildRelationshipGateValidationView } from './relationshipGateValidation';

const gateIssue = (code: string, path: string, message: string): PlanValidationIssue => ({ code, path, message, severity: 'error' });

/**
 * Revalidates the internal plan against source-of-truth gates then constructs a new, explicit
 * Writer plan. It never spreads the internal plan or removes unsafe keys after the fact.
 */
export const sanitizeWriterChapterPlan = (
    internalPlan: InternalChapterPlan,
    control: FullStoryControl,
    state: StoryState,
    relationshipPolicy: RelationshipContextSelectionPolicy = DEFAULT_RELATIONSHIP_CONTEXT_SELECTION_POLICY,
): WriterChapterPlan => {
    assertWriterFacingControlSecretSafe(control);
    const parsed = parseInternalChapterPlan(internalPlan);
    if (!parsed.plan) throw new ChapterPlanValidationError(parsed.issues);
    const plan = parsed.plan;
    if (plan.chapterNumber > control.engine.plannedChapterCount) {
        throw new ChapterPlanValidationError([gateIssue('CHAPTER_OUT_OF_RANGE', 'chapterNumber', 'chapter exceeds the planned story')]);
    }
    const context = buildPlannerContext(control, state, plan.chapterNumber, undefined, undefined, relationshipPolicy);
    const issues: PlanValidationIssue[] = [...parsed.issues, ...validateInternalChapterPlan(plan, context, buildRelationshipGateValidationView(control, plan.chapterNumber))];
    const arc = getArcForChapter(control, plan.chapterNumber);
    const beat = getBeatForChapter(control, plan.chapterNumber);
    if (!arc || arc.id !== plan.arcId) issues.push(gateIssue('FUTURE_ARC', 'arcId', 'plan arc is not the source-of-truth current arc'));
    if ((beat?.id ?? undefined) !== (plan.beatId ?? undefined)) issues.push(gateIssue('FUTURE_BEAT', 'beatId', 'plan beat is not the source-of-truth current beat'));
    if (!isPovAllowed(control, plan.povCharacterId, plan.chapterNumber)) issues.push(gateIssue('POV_LOCKED', 'povCharacterId', 'POV gate is closed'));
    plan.participantIds.forEach((id, index) => {
        if (!isCharacterDirectAppearanceAllowed(control, id, plan.chapterNumber)) issues.push(gateIssue('CHARACTER_LOCKED', `participantIds.${index}`, 'character gate is closed'));
    });
    plan.scenes.forEach((scene, sceneIndex) => {
        if (!isPovAllowed(control, scene.povCharacterId, plan.chapterNumber)) issues.push(gateIssue('POV_LOCKED', `scenes.${sceneIndex}.povCharacterId`, 'scene POV gate is closed'));
        scene.participantIds.forEach((id, participantIndex) => {
            if (!isCharacterDirectAppearanceAllowed(control, id, plan.chapterNumber)) issues.push(gateIssue('CHARACTER_LOCKED', `scenes.${sceneIndex}.participantIds.${participantIndex}`, 'character gate is closed'));
        });
    });
    plan.plannedRevealIds.forEach((id, index) => {
        if (!isRevealAllowed(control, id, plan.chapterNumber)) issues.push(gateIssue('REVEAL_LOCKED', `plannedRevealIds.${index}`, 'reveal gate is closed'));
    });
    plan.relationshipEventIds.forEach((id, index) => {
        if (!isRelationshipEventAllowed(control, id, plan.chapterNumber)) issues.push(gateIssue('RELATIONSHIP_EVENT_LOCKED', `relationshipEventIds.${index}`, 'relationship event gate is closed'));
    });
    plan.storyEventIds.forEach((id, index) => {
        if (!isStoryEventAllowed(control, id, plan.chapterNumber)) issues.push(gateIssue('STORY_EVENT_LOCKED', `storyEventIds.${index}`, 'story event gate is closed'));
    });
    if (issues.some(entry => entry.severity === 'error') || !arc) throw new ChapterPlanValidationError(issues);

    const canonById = new Map(control.canonRules
        .filter(rule => rule.availableFromChapter <= plan.chapterNumber && (rule.expiresAfterChapter === undefined || plan.chapterNumber <= rule.expiresAfterChapter))
        .map(rule => [rule.id, rule]));
    const revealById = new Map(control.reveals.map(reveal => [reveal.id, reveal]));
    const relationshipById = new Map(control.relationshipEvents.map(event => [event.id, event]));
    const storyEventById = new Map(control.storyEvents.map(event => [event.id, event]));

    return {
        kind: 'writer-chapter-plan',
        chapterNumber: plan.chapterNumber,
        arc: {
            id: arc.id,
            title: arc.title,
            ...(arc.writerBrief === undefined ? {} : { writerBrief: arc.writerBrief }),
        },
        ...(beat === undefined ? {} : { beat: { id: beat.id, order: beat.order, ...(beat.writerBrief === undefined ? {} : { writerBrief: beat.writerBrief }) } }),
        primaryGoal: plan.primaryGoal,
        povCharacterId: plan.povCharacterId,
        participantIds: [...plan.participantIds],
        scenes: plan.scenes.map(scene => ({
            id: scene.id,
            order: scene.order,
            goal: scene.goal,
            location: scene.location,
            povCharacterId: scene.povCharacterId,
            participantIds: [...scene.participantIds],
            conflictOrObstacle: scene.conflictOrObstacle,
            uncertainty: scene.uncertainty,
            expectedConsequence: scene.expectedConsequence,
            purposeTags: [...scene.purposeTags],
            conflictImportance: scene.conflictImportance,
        })),
        canonConstraints: plan.activeConstraintIds.map(id => {
            const rule = canonById.get(id);
            // Validation accepts only currently active canon constraints. Keep this defensive
            // fail-closed assertion so a future schema expansion cannot silently drop one.
            if (!rule) throw new ChapterPlanValidationError([gateIssue('ACTIVE_CONSTRAINT_UNPROJECTABLE', 'activeConstraintIds', `cannot project active constraint ${id}`)]);
            return { id: rule.id, text: rule.text, scope: rule.scope };
        }),
        // Controlled text is resolved only after the ID has passed source-of-truth gates above.
        reveals: plan.plannedRevealIds.map(id => {
            const reveal = revealById.get(id)!;
            return { id: reveal.id, text: reveal.writerText };
        }),
        relationshipEvents: plan.relationshipEventIds.map(id => {
            const event = relationshipById.get(id)!;
            return {
                id: event.id,
                relationshipId: event.relationshipId,
                eventType: event.eventType,
                participantIds: [...event.participantIds],
                ...(event.writerText === undefined ? {} : { text: event.writerText }),
            };
        }),
        storyEvents: plan.storyEventIds.map(id => {
            const event = storyEventById.get(id)!;
            return { id: event.id, eventType: event.eventType, ...(event.writerText === undefined ? {} : { text: event.writerText }) };
        }),
        cluesPlantedIds: [...plan.cluesPlantedIds],
        cluesPaidOffIds: [...plan.cluesPaidOffIds],
        expectedResourceDeltas: plan.expectedResourceDeltas.map(delta => ({
            characterId: delta.characterId,
            resourceId: delta.resourceId,
            ...(delta.quantityDelta === undefined ? {} : { quantityDelta: delta.quantityDelta }),
            ...(delta.nextState === undefined ? {} : { nextState: delta.nextState }),
        })),
        expectedRelationshipDeltas: plan.expectedRelationshipDeltas.map(delta => ({
            relationshipId: delta.relationshipId,
            participantIds: [...delta.participantIds],
            expectedState: delta.expectedState,
        })),
        expectedContinuityConsequences: plan.expectedContinuityConsequences.map(consequence => ({ id: consequence.id, text: consequence.text })),
        strategicDirectives: buildWriterStrategicDirectives(control, plan),
        relationshipDirectives: buildWriterRelationshipDirectives(control, plan),
        endStateIntent: plan.endStateIntent,
    };
};
