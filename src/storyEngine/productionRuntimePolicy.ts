import { normalizePlannerContextSelectionPolicy } from './contextBuilder';
import {
    DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY,
    DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY,
    NarrativeMemorySelectionPolicy,
    PlannerContextSelectionPolicy,
} from './plannerTypes';
import {
    DEFAULT_RELATIONSHIP_CONTEXT_SELECTION_POLICY,
    normalizeRelationshipContextSelectionPolicy,
    RelationshipContextSelectionPolicy,
} from './relationshipContext';
import { DEFAULT_MAX_REPAIR_ATTEMPTS } from './repair';
import { DEFAULT_STATE_EXTRACTION_CONTEXT_SELECTION_POLICY, StateExtractionContextSelectionPolicy } from './stateExtractionContext';
import { DEFAULT_MAX_CANON_REVIEW_CHANGES } from './canonCommit';
import {
    ProductionStoryRuntimePolicy,
    STORY_ENGINE_MODEL_ROLES,
    StoryEngineModelRolePolicy,
} from './productionRuntimeTypes';
import { DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY, ValidatorContextSelectionPolicy } from './validatorContext';
import { DEFAULT_WRITER_CONTEXT_SELECTION_POLICY, WriterContextSelectionPolicy } from './writerTypes';

type UnknownRecord = Record<string, unknown>;

const object = (value: unknown, path: string, keys: readonly string[]): UnknownRecord => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new Error(`${path} must be a plain object`);
    }
    const result = value as UnknownRecord;
    const unsupported = Object.keys(result).find(key => !keys.includes(key));
    if (unsupported !== undefined) throw new Error(`${path}.${unsupported} is unsupported`);
    return result;
};

const integer = (value: unknown, path: string, minimum = 0): number => {
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
        throw new Error(`${path} must be a safe integer >= ${minimum}`);
    }
    return value as number;
};

const MEMORY_KEYS = ['recentRawChapters', 'structuredSummaryWindow', 'selectedLongTermMemories'] as const;
const PLANNER_KEYS = [
    'maxCharacters', 'maxWriterVisibleFacts', 'maxInternalFacts', 'maxKnowledgeFactRefs', 'maxRelationships',
    'maxUnresolvedClues', 'maxUnresolvedPromises', 'maxContinuityEntries', 'maxResourcesPerCharacter',
    'maxGateIdsPerCategory', 'maxAuthorSecretReferences', 'maxActiveHardConstraints',
] as const;
const WRITER_KEYS = [
    'maxCharacters', 'maxRelationships', 'maxFacts', 'maxUnresolvedClues',
    'maxUnresolvedPromises', 'maxContinuityEntries', 'maxResourcesPerCharacter',
] as const;
const EXTRACTION_KEYS = [...WRITER_KEYS, 'maxPlotItems', 'maxStatusesPerCharacter'] as const;
const RELATIONSHIP_KEYS = ['maxRelationships', 'maxRecentHistoryPerRelationship', 'maxParticipantBeliefs'] as const;
const VALIDATOR_KEYS = [
    'maxLockedCharacters', 'maxLockedReveals', 'maxLockedRelationshipEvents', 'maxLockedStoryEvents',
    'maxSecretValidationItems', 'maxPlotItems', 'maxStrategicItems', 'maxRelationshipItems',
    'relationshipContextPolicy', 'plannerContextSelectionPolicy',
] as const;
const RUNTIME_KEYS = [
    'narrativeMemorySelectionPolicy', 'plannerContextSelectionPolicy', 'writerContextSelectionPolicy',
    'validatorContextSelectionPolicy', 'stateExtractionContextSelectionPolicy', 'relationshipContextSelectionPolicy',
    'maxRepairAttempts', 'maxCanonReviewChanges', 'modelRolePolicy',
] as const;

const normalizeMemoryPolicy = (value: unknown): NarrativeMemorySelectionPolicy => {
    const input = object(value, 'runtimePolicy.narrativeMemorySelectionPolicy', MEMORY_KEYS);
    return {
        recentRawChapters: integer(input.recentRawChapters, 'runtimePolicy.narrativeMemorySelectionPolicy.recentRawChapters'),
        structuredSummaryWindow: integer(input.structuredSummaryWindow, 'runtimePolicy.narrativeMemorySelectionPolicy.structuredSummaryWindow'),
        selectedLongTermMemories: integer(input.selectedLongTermMemories, 'runtimePolicy.narrativeMemorySelectionPolicy.selectedLongTermMemories'),
    };
};

const normalizePlannerPolicy = (value: unknown, path = 'runtimePolicy.plannerContextSelectionPolicy'): PlannerContextSelectionPolicy => {
    const input = object(value, path, PLANNER_KEYS);
    return normalizePlannerContextSelectionPolicy(Object.fromEntries(PLANNER_KEYS.map(key => [key, integer(input[key], `${path}.${key}`)])) as unknown as PlannerContextSelectionPolicy);
};

const normalizeWriterPolicy = (value: unknown, path = 'runtimePolicy.writerContextSelectionPolicy'): WriterContextSelectionPolicy => {
    const input = object(value, path, WRITER_KEYS);
    return {
        maxCharacters: integer(input.maxCharacters, `${path}.maxCharacters`),
        maxRelationships: integer(input.maxRelationships, `${path}.maxRelationships`),
        maxFacts: integer(input.maxFacts, `${path}.maxFacts`),
        maxUnresolvedClues: integer(input.maxUnresolvedClues, `${path}.maxUnresolvedClues`),
        maxUnresolvedPromises: integer(input.maxUnresolvedPromises, `${path}.maxUnresolvedPromises`),
        maxContinuityEntries: integer(input.maxContinuityEntries, `${path}.maxContinuityEntries`),
        maxResourcesPerCharacter: integer(input.maxResourcesPerCharacter, `${path}.maxResourcesPerCharacter`),
    };
};

const normalizeRelationshipPolicy = (value: unknown, path = 'runtimePolicy.relationshipContextSelectionPolicy'): RelationshipContextSelectionPolicy => {
    const input = object(value, path, RELATIONSHIP_KEYS);
    return normalizeRelationshipContextSelectionPolicy({
        maxRelationships: integer(input.maxRelationships, `${path}.maxRelationships`),
        maxRecentHistoryPerRelationship: integer(input.maxRecentHistoryPerRelationship, `${path}.maxRecentHistoryPerRelationship`),
        maxParticipantBeliefs: integer(input.maxParticipantBeliefs, `${path}.maxParticipantBeliefs`),
    });
};

const normalizeValidatorPolicy = (value: unknown): ValidatorContextSelectionPolicy => {
    const path = 'runtimePolicy.validatorContextSelectionPolicy';
    const input = object(value, path, VALIDATOR_KEYS);
    const defaultPolicy = DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY;
    return {
        maxLockedCharacters: integer(input.maxLockedCharacters, `${path}.maxLockedCharacters`),
        maxLockedReveals: integer(input.maxLockedReveals, `${path}.maxLockedReveals`),
        maxLockedRelationshipEvents: integer(input.maxLockedRelationshipEvents, `${path}.maxLockedRelationshipEvents`),
        maxLockedStoryEvents: integer(input.maxLockedStoryEvents, `${path}.maxLockedStoryEvents`),
        maxSecretValidationItems: integer(input.maxSecretValidationItems, `${path}.maxSecretValidationItems`),
        maxPlotItems: integer(input.maxPlotItems ?? defaultPolicy.maxPlotItems, `${path}.maxPlotItems`),
        maxStrategicItems: integer(input.maxStrategicItems ?? defaultPolicy.maxStrategicItems, `${path}.maxStrategicItems`),
        maxRelationshipItems: integer(input.maxRelationshipItems ?? defaultPolicy.maxRelationshipItems, `${path}.maxRelationshipItems`),
        relationshipContextPolicy: normalizeRelationshipPolicy(
            input.relationshipContextPolicy ?? defaultPolicy.relationshipContextPolicy,
            `${path}.relationshipContextPolicy`,
        ),
        plannerContextSelectionPolicy: normalizePlannerPolicy(
            input.plannerContextSelectionPolicy ?? defaultPolicy.plannerContextSelectionPolicy,
            `${path}.plannerContextSelectionPolicy`,
        ),
    };
};

const normalizeExtractionPolicy = (value: unknown): StateExtractionContextSelectionPolicy => {
    const path = 'runtimePolicy.stateExtractionContextSelectionPolicy';
    const input = object(value, path, EXTRACTION_KEYS);
    return {
        maxCharacters: integer(input.maxCharacters, `${path}.maxCharacters`),
        maxRelationships: integer(input.maxRelationships, `${path}.maxRelationships`),
        maxFacts: integer(input.maxFacts, `${path}.maxFacts`),
        maxUnresolvedClues: integer(input.maxUnresolvedClues, `${path}.maxUnresolvedClues`),
        maxUnresolvedPromises: integer(input.maxUnresolvedPromises, `${path}.maxUnresolvedPromises`),
        maxContinuityEntries: integer(input.maxContinuityEntries, `${path}.maxContinuityEntries`),
        maxResourcesPerCharacter: integer(input.maxResourcesPerCharacter, `${path}.maxResourcesPerCharacter`),
        maxPlotItems: integer(input.maxPlotItems, `${path}.maxPlotItems`, 1),
        maxStatusesPerCharacter: integer(input.maxStatusesPerCharacter, `${path}.maxStatusesPerCharacter`, 1),
    };
};

const normalizeModelRolePolicy = (value: unknown): StoryEngineModelRolePolicy => {
    const input = object(value, 'runtimePolicy.modelRolePolicy', STORY_ENGINE_MODEL_ROLES);
    return Object.fromEntries(STORY_ENGINE_MODEL_ROLES.map((role) => {
        const path = `runtimePolicy.modelRolePolicy.${role}`;
        const route = object(input[role], path, ['preferredModelId', 'candidateModelIds', 'temperature']);
        if (typeof route.preferredModelId !== 'string' || !route.preferredModelId.trim()
            || !Array.isArray(route.candidateModelIds) || route.candidateModelIds.length === 0
            || route.candidateModelIds.some(id => typeof id !== 'string' || !id.trim())
            || new Set(route.candidateModelIds).size !== route.candidateModelIds.length
            || !route.candidateModelIds.includes(route.preferredModelId)
            || typeof route.temperature !== 'number' || !Number.isFinite(route.temperature)
            || route.temperature < 0 || route.temperature > 2) {
            throw new Error(`${path} is invalid`);
        }
        return [role, {
            preferredModelId: route.preferredModelId,
            candidateModelIds: route.candidateModelIds.map(id => id as string),
            temperature: route.temperature,
        }];
    })) as unknown as StoryEngineModelRolePolicy;
};

export const DEFAULT_PRODUCTION_STORY_RUNTIME_POLICY: ProductionStoryRuntimePolicy = {
    narrativeMemorySelectionPolicy: DEFAULT_NARRATIVE_MEMORY_SELECTION_POLICY,
    plannerContextSelectionPolicy: DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY,
    writerContextSelectionPolicy: DEFAULT_WRITER_CONTEXT_SELECTION_POLICY,
    validatorContextSelectionPolicy: DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY,
    stateExtractionContextSelectionPolicy: DEFAULT_STATE_EXTRACTION_CONTEXT_SELECTION_POLICY,
    relationshipContextSelectionPolicy: DEFAULT_RELATIONSHIP_CONTEXT_SELECTION_POLICY,
    maxRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS,
    maxCanonReviewChanges: DEFAULT_MAX_CANON_REVIEW_CHANGES,
};

export const normalizeProductionStoryRuntimePolicy = (value: unknown = {}): ProductionStoryRuntimePolicy => {
    const input = object(value, 'runtimePolicy', RUNTIME_KEYS);
    const defaults = DEFAULT_PRODUCTION_STORY_RUNTIME_POLICY;
    return {
        narrativeMemorySelectionPolicy: normalizeMemoryPolicy(input.narrativeMemorySelectionPolicy ?? defaults.narrativeMemorySelectionPolicy),
        plannerContextSelectionPolicy: normalizePlannerPolicy(input.plannerContextSelectionPolicy ?? defaults.plannerContextSelectionPolicy),
        writerContextSelectionPolicy: normalizeWriterPolicy(input.writerContextSelectionPolicy ?? defaults.writerContextSelectionPolicy),
        validatorContextSelectionPolicy: normalizeValidatorPolicy(input.validatorContextSelectionPolicy ?? defaults.validatorContextSelectionPolicy),
        stateExtractionContextSelectionPolicy: normalizeExtractionPolicy(input.stateExtractionContextSelectionPolicy ?? defaults.stateExtractionContextSelectionPolicy),
        relationshipContextSelectionPolicy: normalizeRelationshipPolicy(input.relationshipContextSelectionPolicy ?? defaults.relationshipContextSelectionPolicy),
        maxRepairAttempts: integer(input.maxRepairAttempts ?? defaults.maxRepairAttempts, 'runtimePolicy.maxRepairAttempts'),
        maxCanonReviewChanges: integer(input.maxCanonReviewChanges ?? defaults.maxCanonReviewChanges, 'runtimePolicy.maxCanonReviewChanges'),
        ...(input.modelRolePolicy === undefined ? {} : { modelRolePolicy: normalizeModelRolePolicy(input.modelRolePolicy) }),
    };
};
