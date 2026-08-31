import type { PlanValidationIssue } from './plannerTypes';
import {
    POWER_BALANCE_STATES,
    RELATIONSHIP_ACTION_TYPES,
    RELATIONSHIP_ASSESSMENT_LEVELS,
    RELATIONSHIP_BOUNDARY_CONSTRAINTS,
    RELATIONSHIP_BOUNDARY_STANCES,
    RELATIONSHIP_BOUNDARY_TYPES,
    RELATIONSHIP_CATEGORIES,
    RELATIONSHIP_DIRECTIONS,
    ROMANCE_MILESTONES,
} from './relationshipTypes';
import type {
    RelationshipActionPlan,
    RelationshipBoundary,
    RelationshipCurrentAssessment,
    RelationshipEvidenceRef,
    RelationshipParticipantAgency,
    RelationshipProgressionIntent,
    RelationshipWriterVisibleContract,
    WriterRelationshipDirective,
} from './relationshipTypes';

class RelationshipParseError extends Error {
    constructor(readonly path: string, message: string) { super(message); }
}

const fail = (path: string, message: string): never => { throw new RelationshipParseError(path, message); };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const record = (value: unknown, path: string): Record<string, unknown> => isRecord(value) ? value : fail(path, 'must be an object');
const strictKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string): void => {
    const set = new Set(allowed);
    if (Object.keys(value).some(key => !set.has(key))) fail(path, 'contains unsupported fields');
};
const text = (value: unknown, path: string): string => typeof value === 'string' && value.trim() ? value : fail(path, 'must be a non-empty string');
const bool = (value: unknown, path: string): boolean => typeof value === 'boolean' ? value : fail(path, 'must be boolean');
const strings = (value: unknown, path: string, nonEmpty = false): readonly string[] => {
    const values = Array.isArray(value) ? value : fail(path, 'must be an array');
    const result = values.map((entry, index) => text(entry, `${path}.${index}`));
    if (nonEmpty && result.length === 0) fail(path, 'must not be empty');
    if (new Set(result).size !== result.length) fail(path, 'must not contain duplicates');
    return result;
};
const closed = <T extends string>(value: unknown, values: readonly T[], path: string): T =>
    typeof value === 'string' && values.includes(value as T) ? value as T : fail(path, 'is unsupported');

const parseAssessment = (value: unknown, path: string): RelationshipCurrentAssessment => {
    const source = record(value, path);
    strictKeys(source, ['trust', 'respect', 'attraction', 'emotionalOpenness', 'dependency', 'conflict', 'sharedInterest', 'powerBalance'], path);
    return {
        trust: closed(source.trust, RELATIONSHIP_ASSESSMENT_LEVELS, `${path}.trust`),
        respect: closed(source.respect, RELATIONSHIP_ASSESSMENT_LEVELS, `${path}.respect`),
        attraction: closed(source.attraction, RELATIONSHIP_ASSESSMENT_LEVELS, `${path}.attraction`),
        emotionalOpenness: closed(source.emotionalOpenness, RELATIONSHIP_ASSESSMENT_LEVELS, `${path}.emotionalOpenness`),
        dependency: closed(source.dependency, RELATIONSHIP_ASSESSMENT_LEVELS, `${path}.dependency`),
        conflict: closed(source.conflict, RELATIONSHIP_ASSESSMENT_LEVELS, `${path}.conflict`),
        sharedInterest: closed(source.sharedInterest, RELATIONSHIP_ASSESSMENT_LEVELS, `${path}.sharedInterest`),
        powerBalance: closed(source.powerBalance, POWER_BALANCE_STATES, `${path}.powerBalance`),
    };
};

const parseProgression = (value: unknown, path: string): RelationshipProgressionIntent => {
    const source = record(value, path);
    strictKeys(source, ['direction', 'romanticMilestone', 'expectedState', 'mutual', 'intermediate'], path);
    return {
        direction: closed(source.direction, RELATIONSHIP_DIRECTIONS, `${path}.direction`),
        romanticMilestone: closed(source.romanticMilestone, ROMANCE_MILESTONES, `${path}.romanticMilestone`),
        ...(source.expectedState === undefined ? {} : { expectedState: text(source.expectedState, `${path}.expectedState`) }),
        mutual: bool(source.mutual, `${path}.mutual`),
        intermediate: bool(source.intermediate, `${path}.intermediate`),
    };
};

const parseAgency = (value: unknown, path: string): RelationshipParticipantAgency => {
    const source = record(value, path);
    strictKeys(source, ['characterId', 'currentGoal', 'desiredOutcome', 'boundary', 'choice', 'willingness', 'uncertainty', 'costOrRisk', 'knowledgeBasisFactIds'], path);
    return {
        characterId: text(source.characterId, `${path}.characterId`),
        currentGoal: text(source.currentGoal, `${path}.currentGoal`),
        desiredOutcome: text(source.desiredOutcome, `${path}.desiredOutcome`),
        boundary: text(source.boundary, `${path}.boundary`),
        choice: text(source.choice, `${path}.choice`),
        willingness: closed(source.willingness, ['yes', 'no', 'uncertain'] as const, `${path}.willingness`),
        uncertainty: text(source.uncertainty, `${path}.uncertainty`),
        costOrRisk: text(source.costOrRisk, `${path}.costOrRisk`),
        knowledgeBasisFactIds: strings(source.knowledgeBasisFactIds, `${path}.knowledgeBasisFactIds`),
    };
};

const parseBoundary = (value: unknown, path: string): RelationshipBoundary => {
    const source = record(value, path);
    strictKeys(source, ['characterId', 'type', 'constraint', 'stance', 'instruction'], path);
    return {
        characterId: text(source.characterId, `${path}.characterId`),
        type: closed(source.type, RELATIONSHIP_BOUNDARY_TYPES, `${path}.type`),
        constraint: closed(source.constraint, RELATIONSHIP_BOUNDARY_CONSTRAINTS, `${path}.constraint`),
        stance: closed(source.stance, RELATIONSHIP_BOUNDARY_STANCES, `${path}.stance`),
        instruction: text(source.instruction, `${path}.instruction`),
    };
};

export const parseRelationshipEvidenceRef = (value: unknown, path: string): RelationshipEvidenceRef => {
    const source = record(value, path);
    if (source.type === 'fact' || source.type === 'relationship' || source.type === 'relationship-history'
        || source.type === 'relationship-event' || source.type === 'story-event' || source.type === 'strategic-action') {
        strictKeys(source, ['type', 'id'], path);
        const id = text(source.id, `${path}.id`);
        if (source.type === 'fact') return { type: 'fact', id };
        if (source.type === 'relationship') return { type: 'relationship', id };
        if (source.type === 'relationship-history') return { type: 'relationship-history', id };
        if (source.type === 'relationship-event') return { type: 'relationship-event', id };
        if (source.type === 'story-event') return { type: 'story-event', id };
        return { type: 'strategic-action', id };
    }
    if (source.type === 'knowledge') {
        strictKeys(source, ['type', 'characterId', 'factId'], path);
        return { type: 'knowledge', characterId: text(source.characterId, `${path}.characterId`), factId: text(source.factId, `${path}.factId`) };
    }
    if (source.type === 'belief') {
        strictKeys(source, ['type', 'characterId', 'epistemicId'], path);
        return { type: 'belief', characterId: text(source.characterId, `${path}.characterId`), epistemicId: text(source.epistemicId, `${path}.epistemicId`) };
    }
    if (source.type === 'character-status') {
        strictKeys(source, ['type', 'characterId', 'value'], path);
        return { type: 'character-status', characterId: text(source.characterId, `${path}.characterId`), value: text(source.value, `${path}.value`) };
    }
    fail(`${path}.type`, 'is unsupported');
};

const parseWriterContract = (value: unknown, path: string): RelationshipWriterVisibleContract => {
    const source = record(value, path);
    strictKeys(source, ['currentDynamic', 'objective', 'visibleConflict', 'visibleUncertainty'], path);
    return {
        currentDynamic: text(source.currentDynamic, `${path}.currentDynamic`),
        objective: text(source.objective, `${path}.objective`),
        visibleConflict: text(source.visibleConflict, `${path}.visibleConflict`),
        visibleUncertainty: text(source.visibleUncertainty, `${path}.visibleUncertainty`),
    };
};

const ACTION_KEYS = [
    'id', 'sceneIds', 'relationshipId', 'relationshipEventId', 'participantIds', 'category', 'actionType', 'importance',
    'currentStateAssessment', 'currentRomanceMilestone', 'intendedProgression', 'participantAgency', 'boundaries',
    'evidenceRefs', 'counterpressure', 'uncertainty', 'expectedCostOrTradeoff', 'powerImbalanceAddressed',
    'writerVisibleContract', 'dependsOnActionId',
] as const;

const parseAction = (value: unknown, path: string): RelationshipActionPlan => {
    const source = record(value, path);
    strictKeys(source, ACTION_KEYS, path);
    const agencyValues = Array.isArray(source.participantAgency) ? source.participantAgency : fail(path, 'contains malformed participantAgency');
    const boundaryValues = Array.isArray(source.boundaries) ? source.boundaries : fail(path, 'contains malformed boundaries');
    const evidenceValues = Array.isArray(source.evidenceRefs) ? source.evidenceRefs : fail(path, 'contains malformed evidenceRefs');
    const participantAgency = agencyValues.map((entry, index) => parseAgency(entry, `${path}.participantAgency.${index}`));
    if (new Set(participantAgency.map(entry => entry.characterId)).size !== participantAgency.length) fail(`${path}.participantAgency`, 'must not contain duplicate characters');
    return {
        id: text(source.id, `${path}.id`),
        sceneIds: strings(source.sceneIds, `${path}.sceneIds`, true),
        relationshipId: text(source.relationshipId, `${path}.relationshipId`),
        ...(source.relationshipEventId === undefined ? {} : { relationshipEventId: text(source.relationshipEventId, `${path}.relationshipEventId`) }),
        participantIds: strings(source.participantIds, `${path}.participantIds`, true),
        category: closed(source.category, RELATIONSHIP_CATEGORIES, `${path}.category`),
        actionType: closed(source.actionType, RELATIONSHIP_ACTION_TYPES, `${path}.actionType`),
        importance: closed(source.importance, ['minor', 'major'] as const, `${path}.importance`),
        currentStateAssessment: parseAssessment(source.currentStateAssessment, `${path}.currentStateAssessment`),
        currentRomanceMilestone: closed(source.currentRomanceMilestone, ROMANCE_MILESTONES, `${path}.currentRomanceMilestone`),
        intendedProgression: parseProgression(source.intendedProgression, `${path}.intendedProgression`),
        participantAgency,
        boundaries: boundaryValues.map((entry, index) => parseBoundary(entry, `${path}.boundaries.${index}`)),
        evidenceRefs: evidenceValues.map((entry, index) => parseRelationshipEvidenceRef(entry, `${path}.evidenceRefs.${index}`)),
        counterpressure: text(source.counterpressure, `${path}.counterpressure`),
        uncertainty: text(source.uncertainty, `${path}.uncertainty`),
        expectedCostOrTradeoff: text(source.expectedCostOrTradeoff, `${path}.expectedCostOrTradeoff`),
        powerImbalanceAddressed: bool(source.powerImbalanceAddressed, `${path}.powerImbalanceAddressed`),
        writerVisibleContract: parseWriterContract(source.writerVisibleContract, `${path}.writerVisibleContract`),
        ...(source.dependsOnActionId === undefined ? {} : { dependsOnActionId: text(source.dependsOnActionId, `${path}.dependsOnActionId`) }),
    };
};

export const parseRelationshipActions = (
    value: unknown,
    path = 'relationshipActions',
    issues: PlanValidationIssue[] = [],
): readonly RelationshipActionPlan[] | undefined => {
    if (!Array.isArray(value)) {
        issues.push({ code: 'INVALID_RELATIONSHIP_ACTION', path, message: 'must be an array', severity: 'error' });
        return undefined;
    }
    const result: RelationshipActionPlan[] = [];
    value.forEach((entry, index) => {
        try { result.push(parseAction(entry, `${path}.${index}`)); }
        catch (error) {
            const parsed = error instanceof RelationshipParseError ? error : new RelationshipParseError(`${path}.${index}`, 'is invalid');
            issues.push({ code: 'INVALID_RELATIONSHIP_ACTION', path: parsed.path, message: parsed.message, severity: 'error' });
        }
    });
    if (new Set(result.map(entry => entry.id)).size !== result.length) issues.push({ code: 'INVALID_RELATIONSHIP_ACTION', path, message: 'must not contain duplicate action IDs', severity: 'error' });
    return issues.some(entry => entry.code === 'INVALID_RELATIONSHIP_ACTION') ? undefined : result;
};

const DIRECTIVE_KEYS = [
    'id', 'relationshipId', 'relationshipEventId', 'sceneIds', 'participantIds', 'category', 'actionType', 'importance',
    'currentRomanceMilestone', 'intendedProgression', 'participantChoices', 'visibleBoundaries', 'visibleCurrentDynamic',
    'visibleObjective', 'visibleConflict', 'expectedCostOrTradeoff', 'visibleUncertainty', 'visiblePowerBalance', 'powerImbalanceAddressed', 'dependsOnActionId',
] as const;

const parseDirective = (value: unknown, path: string): WriterRelationshipDirective => {
    const source = record(value, path);
    strictKeys(source, DIRECTIVE_KEYS, path);
    const choiceValues = Array.isArray(source.participantChoices) ? source.participantChoices : fail(path, 'contains malformed participantChoices');
    const boundaryValues = Array.isArray(source.visibleBoundaries) ? source.visibleBoundaries : fail(path, 'contains malformed visibleBoundaries');
    const participantChoices = choiceValues.map((entry, index) => {
        const entryPath = `${path}.participantChoices.${index}`;
        const choice = record(entry, entryPath);
        strictKeys(choice, ['characterId', 'choice', 'willingness'], entryPath);
        return {
            characterId: text(choice.characterId, `${entryPath}.characterId`),
            choice: text(choice.choice, `${entryPath}.choice`),
            willingness: closed(choice.willingness, ['yes', 'no', 'uncertain'] as const, `${entryPath}.willingness`),
        };
    });
    if (new Set(participantChoices.map(entry => entry.characterId)).size !== participantChoices.length) fail(`${path}.participantChoices`, 'must not contain duplicate characters');
    return {
        id: text(source.id, `${path}.id`),
        relationshipId: text(source.relationshipId, `${path}.relationshipId`),
        ...(source.relationshipEventId === undefined ? {} : { relationshipEventId: text(source.relationshipEventId, `${path}.relationshipEventId`) }),
        sceneIds: strings(source.sceneIds, `${path}.sceneIds`, true),
        participantIds: strings(source.participantIds, `${path}.participantIds`, true),
        category: closed(source.category, RELATIONSHIP_CATEGORIES, `${path}.category`),
        actionType: closed(source.actionType, RELATIONSHIP_ACTION_TYPES, `${path}.actionType`),
        importance: closed(source.importance, ['minor', 'major'] as const, `${path}.importance`),
        currentRomanceMilestone: closed(source.currentRomanceMilestone, ROMANCE_MILESTONES, `${path}.currentRomanceMilestone`),
        intendedProgression: parseProgression(source.intendedProgression, `${path}.intendedProgression`),
        participantChoices,
        visibleBoundaries: boundaryValues.map((entry, index) => parseBoundary(entry, `${path}.visibleBoundaries.${index}`)),
        visibleCurrentDynamic: text(source.visibleCurrentDynamic, `${path}.visibleCurrentDynamic`),
        visibleObjective: text(source.visibleObjective, `${path}.visibleObjective`),
        visibleConflict: text(source.visibleConflict, `${path}.visibleConflict`),
        expectedCostOrTradeoff: text(source.expectedCostOrTradeoff, `${path}.expectedCostOrTradeoff`),
        visibleUncertainty: text(source.visibleUncertainty, `${path}.visibleUncertainty`),
        visiblePowerBalance: closed(source.visiblePowerBalance, POWER_BALANCE_STATES, `${path}.visiblePowerBalance`),
        powerImbalanceAddressed: bool(source.powerImbalanceAddressed, `${path}.powerImbalanceAddressed`),
        ...(source.dependsOnActionId === undefined ? {} : { dependsOnActionId: text(source.dependsOnActionId, `${path}.dependsOnActionId`) }),
    };
};

export const parseWriterRelationshipDirectives = (value: unknown, path = 'relationshipDirectives'): readonly WriterRelationshipDirective[] => {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    const result = value.map((entry, index) => {
        try { return parseDirective(entry, `${path}.${index}`); }
        catch (error) {
            if (error instanceof RelationshipParseError) throw new Error(`${error.path} ${error.message}`);
            throw error;
        }
    });
    if (new Set(result.map(entry => entry.id)).size !== result.length) throw new Error(`${path} must not contain duplicate action IDs`);
    return result;
};
