import type { PlanValidationIssue, PlannerContext } from './plannerTypes';
import {
    strategicCharacterKnowsFact,
    isMeaningfulText,
    strategicIssue,
} from './strategicEvidence';
import {
    POLITICAL_DIMENSIONS,
    PoliticalActionPlan,
} from './strategicTypes';

const supportedAuthorityEvidence = new Set([
    'fact', 'canon-rule', 'relationship', 'resource', 'character-status',
]);

/** Pure political feasibility checks. It never selects an outcome or mutates canonical state. */
export const validatePoliticalAction = (
    action: PoliticalActionPlan,
    context: PlannerContext,
    path: string,
): readonly PlanValidationIssue[] => {
    const issues: PlanValidationIssue[] = [];
    const counts = new Map(POLITICAL_DIMENSIONS.map(dimension => [dimension, 0]));
    action.dimensions.forEach((assessment, index) => {
        counts.set(assessment.dimension, (counts.get(assessment.dimension) ?? 0) + 1);
        if ((assessment.status === 'supporting' || assessment.status === 'constraining') && assessment.evidenceRefs.length === 0) {
            issues.push(strategicIssue('POLITICAL_DIMENSION_VIOLATION', `${path}.dimensions.${index}.evidenceRefs`, 'supporting and constraining political dimensions require evidence'));
        }
        if (assessment.dimension === 'authority' && assessment.status === 'supporting'
            && !assessment.evidenceRefs.some(reference => supportedAuthorityEvidence.has(reference.type))) {
            issues.push(strategicIssue('POLITICAL_AUTHORITY_VIOLATION', `${path}.dimensions.${index}`, 'supporting authority requires current canonical authority evidence'));
        }
        if (assessment.dimension === 'information' && (assessment.status === 'supporting' || assessment.status === 'constraining')) {
            const validKnowledge = assessment.evidenceRefs.some(reference => reference.type === 'knowledge'
                && reference.characterId === action.actorCharacterId
                && strategicCharacterKnowsFact(context, action.actorCharacterId, reference.factId));
            if (!validKnowledge) {
                issues.push(strategicIssue('POLITICAL_INFORMATION_VIOLATION', `${path}.dimensions.${index}`, 'certain political information must be canonical knowledge of the actor'));
            }
            if (assessment.evidenceRefs.some(reference => reference.type === 'fact')) {
                issues.push(strategicIssue('POLITICAL_INFORMATION_VIOLATION', `${path}.dimensions.${index}.evidenceRefs`, 'global facts are not a substitute for actor knowledge'));
            }
        }
        if (assessment.dimension === 'law' && (assessment.status === 'supporting' || assessment.status === 'constraining')
            && !assessment.evidenceRefs.some(reference => reference.type === 'canon-rule' || reference.type === 'fact')) {
            issues.push(strategicIssue('POLITICAL_LAW_VIOLATION', `${path}.dimensions.${index}`, 'legal support or constraint requires an active canon rule or established fact'));
        }
    });
    POLITICAL_DIMENSIONS.forEach((dimension) => {
        if (counts.get(dimension) !== 1) {
            issues.push(strategicIssue('POLITICAL_DIMENSION_VIOLATION', `${path}.dimensions`, `political action requires exactly one ${dimension} assessment`));
        }
    });

    const { earliestChapter, deadlineChapter, preparationChapters } = action.timing;
    if (!Number.isSafeInteger(preparationChapters) || preparationChapters < 0
        || (earliestChapter !== undefined && (!Number.isSafeInteger(earliestChapter) || earliestChapter < 1))
        || (deadlineChapter !== undefined && (!Number.isSafeInteger(deadlineChapter) || deadlineChapter < 1))
        || (earliestChapter !== undefined && deadlineChapter !== undefined && deadlineChapter < earliestChapter)
        || (earliestChapter !== undefined && context.targetChapter < earliestChapter)
        || (deadlineChapter !== undefined && context.targetChapter > deadlineChapter)) {
        issues.push(strategicIssue('POLITICAL_TIMING_VIOLATION', `${path}.timing`, 'political timing must be a valid target-chapter window with explicit non-negative preparation'));
    }
    if (action.importance === 'major' && action.countermove === undefined) {
        issues.push(strategicIssue('POLITICAL_COUNTERMOVE_MISSING', `${path}.countermove`, 'major political action requires structured counterplay'));
    }
    if (!isMeaningfulText(action.expectedCostOrTradeoff)) {
        issues.push(strategicIssue('POLITICAL_RESOURCE_VIOLATION', `${path}.expectedCostOrTradeoff`, 'political action requires a meaningful cost or tradeoff'));
    }
    return issues;
};
