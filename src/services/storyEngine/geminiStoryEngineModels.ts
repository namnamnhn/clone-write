import { buildPlannerPrompt } from '../../storyEngine/planner';
import { INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA } from '../../storyEngine/internalChapterPlanResponseSchema';
import { createProductionStoryRuntime } from '../../storyEngine/productionRuntime';
import type {
    ProductionStoryRuntimePolicy,
    StoryEngineModelBundle,
    StoryEngineModelRole,
    StoryEngineModelRolePolicy,
} from '../../storyEngine/productionRuntimeTypes';
import type { PlannerContext } from '../../storyEngine/plannerTypes';
import type { RepairModelRequest } from '../../storyEngine/repair';
import type { SemanticValidatorModelRequest } from '../../storyEngine/semanticValidator';
import type { StateExtractorModelRequest } from '../../storyEngine/stateExtractorTypes';
import type { WriterModelRequest } from '../../storyEngine/writerTypes';
import {
    GeminiStoryEngineRunnerDependencies,
    runGeminiStoryEngineJson,
} from './geminiStoryEngineRunner';
import {
    DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY,
    resolveStoryEngineModelRolePolicy,
} from './storyEngineModelPolicy';

export interface GeminiStoryEngineGenerationRuntime {
    run(request: {
        readonly role: StoryEngineModelRole;
        readonly contents: string;
        readonly responseJsonSchema?: unknown;
        readonly signal?: AbortSignal;
    }): Promise<{ readonly value: unknown; readonly selectedModelId: string }>;
}

interface TelemetryCapableAdapter {
    getLastSelectedModelId(): string | undefined;
}

const createAdapter = <TRequest>(
    role: StoryEngineModelRole,
    runtime: GeminiStoryEngineGenerationRuntime,
    serialize: (request: TRequest) => string,
    responseJsonSchema?: unknown,
) => {
    let selectedModelId: string | undefined;
    const execute = async (request: TRequest): Promise<unknown> => {
        selectedModelId = undefined;
        const result = await runtime.run({
            role, contents: serialize(request),
            ...(responseJsonSchema === undefined ? {} : { responseJsonSchema }),
        });
        selectedModelId = result.selectedModelId;
        return result.value;
    };
    const telemetry: TelemetryCapableAdapter = { getLastSelectedModelId: () => selectedModelId };
    return { execute, telemetry };
};

export const createGeminiStoryEngineAdapters = (runtime: GeminiStoryEngineGenerationRuntime): StoryEngineModelBundle => {
    const planner = createAdapter<PlannerContext>(
        'planner', runtime, buildPlannerPrompt, INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA,
    );
    const writer = createAdapter<WriterModelRequest>('writer', runtime, request => request.prompt);
    const semanticValidator = createAdapter<SemanticValidatorModelRequest>('semanticValidator', runtime, request => JSON.stringify({
        prompt: request.prompt,
        context: request.context,
        candidate: request.candidate,
    }));
    const repair = createAdapter<RepairModelRequest>('repair', runtime, request => JSON.stringify({
        prompt: request.prompt,
        context: request.context,
    }));
    const stateExtractor = createAdapter<StateExtractorModelRequest>('stateExtractor', runtime, request => JSON.stringify({
        prompt: request.prompt,
        context: request.context,
        candidate: request.candidate,
    }));
    return {
        planner: { plan: planner.execute, ...planner.telemetry },
        writer: { write: writer.execute, ...writer.telemetry },
        semanticValidator: { validate: semanticValidator.execute, ...semanticValidator.telemetry },
        repair: { repair: repair.execute, ...repair.telemetry },
        stateExtractor: { extract: stateExtractor.execute, ...stateExtractor.telemetry },
    };
};

export interface CreateGeminiStoryEngineModelBundleOptions {
    readonly modelRolePolicy?: unknown;
    readonly availableModelIds?: readonly string[];
    readonly signal?: AbortSignal;
    readonly runnerDependencies?: GeminiStoryEngineRunnerDependencies;
}

export interface GeminiStoryEngineModelBundle extends StoryEngineModelBundle {
    readonly modelRolePolicy: StoryEngineModelRolePolicy;
}

export const createGeminiStoryEngineModelBundle = (
    options: CreateGeminiStoryEngineModelBundleOptions = {},
): GeminiStoryEngineModelBundle => {
    const modelRolePolicy = resolveStoryEngineModelRolePolicy(
        options.modelRolePolicy ?? DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY,
        options.availableModelIds,
    );
    const adapters = createGeminiStoryEngineAdapters({
        run: ({ role, contents, responseJsonSchema }) => runGeminiStoryEngineJson({
            role, contents, route: modelRolePolicy[role],
            ...(responseJsonSchema === undefined ? {} : { responseJsonSchema }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        }, options.runnerDependencies),
    });
    return { ...adapters, modelRolePolicy };
};

export interface CreateGeminiProductionStoryRuntimeOptions extends CreateGeminiStoryEngineModelBundleOptions {
    readonly runtimePolicy?: Partial<ProductionStoryRuntimePolicy>;
}

/** Discoverable WORK 13 facade: real Gemini adapters plus pure staged orchestration. */
export const createGeminiProductionStoryRuntime = (
    options: CreateGeminiProductionStoryRuntimeOptions = {},
) => {
    const models = createGeminiStoryEngineModelBundle(options);
    return createProductionStoryRuntime({
        models,
        runtimePolicy: { ...options.runtimePolicy, modelRolePolicy: models.modelRolePolicy },
    });
};
