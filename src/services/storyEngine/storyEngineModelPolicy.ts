import { MODEL_CONFIGS } from '../../constants';
import {
    STORY_ENGINE_MODEL_ROLES,
    StoryEngineModelRole,
    StoryEngineModelRolePolicy,
    StoryEngineModelRoute,
} from '../../storyEngine/productionRuntimeTypes';

type UnknownRecord = Record<string, unknown>;

export class StoryEngineModelPolicyError extends Error {
    constructor(readonly code: 'INVALID_MODEL_POLICY' | 'NO_MODEL_AVAILABLE', message: string) {
        super(message);
        this.name = 'StoryEngineModelPolicyError';
    }
}

export const DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY: StoryEngineModelRolePolicy = {
    planner: {
        preferredModelId: 'gemini-3.1-pro-preview',
        candidateModelIds: ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        temperature: 0.3,
    },
    writer: {
        preferredModelId: 'gemini-3.1-pro-preview',
        candidateModelIds: ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        temperature: 0.8,
    },
    semanticValidator: {
        preferredModelId: 'gemini-3.7-flash',
        candidateModelIds: ['gemini-3.7-flash', 'gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        temperature: 0.1,
    },
    repair: {
        preferredModelId: 'gemini-3.7-flash',
        candidateModelIds: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        temperature: 0.3,
    },
    stateExtractor: {
        preferredModelId: 'gemini-3.7-flash',
        candidateModelIds: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        temperature: 0.1,
    },
};

const record = (value: unknown, path: string, allowed: readonly string[]): UnknownRecord => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new StoryEngineModelPolicyError('INVALID_MODEL_POLICY', `${path} must be an object`);
    }
    const result = value as UnknownRecord;
    const unknown = Object.keys(result).find(key => !allowed.includes(key));
    if (unknown !== undefined) throw new StoryEngineModelPolicyError('INVALID_MODEL_POLICY', `${path}.${unknown} is not supported`);
    return result;
};

const modelId = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || !value.trim()) throw new StoryEngineModelPolicyError('INVALID_MODEL_POLICY', `${path} must be a non-empty model ID`);
    const normalized = value.trim();
    if (!normalized.toLowerCase().startsWith('gemini-')) {
        throw new StoryEngineModelPolicyError('INVALID_MODEL_POLICY', `${path} must use Gemini`);
    }
    return normalized;
};

export const normalizeStoryEngineModelRoute = (value: unknown, path = 'route'): StoryEngineModelRoute => {
    const input = record(value, path, ['preferredModelId', 'candidateModelIds', 'temperature']);
    if (!Array.isArray(input.candidateModelIds) || input.candidateModelIds.length === 0) {
        throw new StoryEngineModelPolicyError('INVALID_MODEL_POLICY', `${path}.candidateModelIds must be a non-empty array`);
    }
    const candidateModelIds = input.candidateModelIds.map((entry, index) => modelId(entry, `${path}.candidateModelIds.${index}`));
    if (new Set(candidateModelIds).size !== candidateModelIds.length) {
        throw new StoryEngineModelPolicyError('INVALID_MODEL_POLICY', `${path}.candidateModelIds must not contain duplicates`);
    }
    const preferredModelId = modelId(input.preferredModelId, `${path}.preferredModelId`);
    if (!candidateModelIds.includes(preferredModelId)) {
        throw new StoryEngineModelPolicyError('INVALID_MODEL_POLICY', `${path}.preferredModelId must be one of candidateModelIds`);
    }
    if (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature)
        || input.temperature < 0 || input.temperature > 2) {
        throw new StoryEngineModelPolicyError('INVALID_MODEL_POLICY', `${path}.temperature must be finite and between 0 and 2`);
    }
    return { preferredModelId, candidateModelIds, temperature: input.temperature };
};

export const normalizeStoryEngineModelRolePolicy = (value: unknown): StoryEngineModelRolePolicy => {
    const input = record(value, 'modelRolePolicy', STORY_ENGINE_MODEL_ROLES);
    return Object.fromEntries(STORY_ENGINE_MODEL_ROLES.map(role => [
        role, normalizeStoryEngineModelRoute(input[role], `modelRolePolicy.${role}`),
    ])) as unknown as StoryEngineModelRolePolicy;
};

export const resolveStoryEngineModelRoute = (
    role: StoryEngineModelRole,
    routeValue: unknown,
    availableModelIds: readonly string[] = MODEL_CONFIGS.map(model => model.id),
): StoryEngineModelRoute => {
    const route = normalizeStoryEngineModelRoute(routeValue, `modelRolePolicy.${role}`);
    const configuredTextModels = new Set(MODEL_CONFIGS
        .filter(model => model.id.toLowerCase().startsWith('gemini-') && model.family !== 'image')
        .map(model => model.id));
    const callerAvailability = new Set(availableModelIds.filter(id => typeof id === 'string'));
    const enabled = new Set([...configuredTextModels].filter(id => callerAvailability.has(id)));
    const candidateModelIds = route.candidateModelIds.filter(id => enabled.has(id));
    if (candidateModelIds.length === 0) {
        throw new StoryEngineModelPolicyError('NO_MODEL_AVAILABLE', `no configured Gemini model is available for ${role}`);
    }
    return {
        candidateModelIds,
        preferredModelId: candidateModelIds.includes(route.preferredModelId) ? route.preferredModelId : candidateModelIds[0],
        temperature: route.temperature,
    };
};

export const resolveStoryEngineModelRolePolicy = (
    policyValue: unknown = DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY,
    availableModelIds: readonly string[] = MODEL_CONFIGS.map(model => model.id),
): StoryEngineModelRolePolicy => {
    const policy = normalizeStoryEngineModelRolePolicy(policyValue);
    return Object.fromEntries(STORY_ENGINE_MODEL_ROLES.map(role => [
        role, resolveStoryEngineModelRoute(role, policy[role], availableModelIds),
    ])) as unknown as StoryEngineModelRolePolicy;
};
