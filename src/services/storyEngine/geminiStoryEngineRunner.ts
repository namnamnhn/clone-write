import type { GenerateContentResponse } from '@google/genai';
import { getAiClient, SAFETY_SETTINGS, smartExecution } from '../api/gemini';
import { StoryEngineModelRuntimeError } from '../../storyEngine/productionRuntimeTypes';
import type { StoryEngineModelRole, StoryEngineModelRoute } from '../../storyEngine/productionRuntimeTypes';

export class GeminiStoryEngineProtocolError extends Error {
    constructor(readonly code: 'EMPTY_RESPONSE' | 'MALFORMED_JSON') {
        super(code);
        this.name = 'GeminiStoryEngineProtocolError';
    }
}

export interface GeminiStoryEngineRunnerDependencies {
    readonly smartExecution: <T>(
        candidateModels: string[],
        operation: (modelId: string) => Promise<T>,
        taskName?: string,
        onLog?: undefined,
        preferredModelId?: string,
    ) => Promise<T>;
    readonly getAiClient: () => {
        readonly models: {
            generateContent(request: Parameters<ReturnType<typeof getAiClient>['models']['generateContent']>[0]): Promise<GenerateContentResponse>;
        };
    };
}

export const DEFAULT_GEMINI_STORY_ENGINE_RUNNER_DEPENDENCIES: GeminiStoryEngineRunnerDependencies = {
    smartExecution,
    getAiClient,
};

export interface RunGeminiStoryEngineJsonRequest {
    readonly role: StoryEngineModelRole;
    readonly route: StoryEngineModelRoute;
    readonly contents: string;
    readonly signal?: AbortSignal;
}

export interface GeminiStoryEngineJsonResult {
    readonly value: unknown;
    readonly selectedModelId: string;
}

export const runGeminiStoryEngineJson = async (
    request: RunGeminiStoryEngineJsonRequest,
    dependencies: GeminiStoryEngineRunnerDependencies = DEFAULT_GEMINI_STORY_ENGINE_RUNNER_DEPENDENCIES,
): Promise<GeminiStoryEngineJsonResult> => {
    if (request.signal?.aborted) throw new Error('ABORTED');
    let lastProtocolError: GeminiStoryEngineProtocolError | undefined;
    let sawInfrastructureFailure = false;
    try {
        return await dependencies.smartExecution(
        [...request.route.candidateModelIds],
        async (modelId) => {
            if (request.signal?.aborted) throw new Error('ABORTED');
            // This must remain inside the selected smartExecution operation so key attribution is correct.
            let response: GenerateContentResponse;
            try {
                const ai = dependencies.getAiClient();
                response = await ai.models.generateContent({
                    model: modelId,
                    contents: request.contents,
                    config: {
                        temperature: request.route.temperature,
                        responseMimeType: 'application/json',
                        safetySettings: SAFETY_SETTINGS,
                        ...(request.signal === undefined ? {} : { abortSignal: request.signal }),
                    },
                });
            } catch (error) {
                if (request.signal?.aborted) throw new Error('ABORTED');
                sawInfrastructureFailure = true;
                throw error;
            }
            const output = response.text?.trim();
            if (!output) {
                lastProtocolError = new GeminiStoryEngineProtocolError('EMPTY_RESPONSE');
                throw lastProtocolError;
            }
            let value: unknown;
            try {
                value = JSON.parse(output);
            } catch {
                lastProtocolError = new GeminiStoryEngineProtocolError('MALFORMED_JSON');
                throw lastProtocolError;
            }
            return { value, selectedModelId: modelId };
        },
        `Story Engine V4 ${request.role}`,
        undefined,
        request.route.preferredModelId,
        );
    } catch (error) {
        if (request.signal?.aborted || (error instanceof Error && (error.message === 'ABORTED' || error.name === 'AbortError'))) throw error;
        if (error instanceof GeminiStoryEngineProtocolError) throw error;
        if (!sawInfrastructureFailure && lastProtocolError) throw lastProtocolError;
        throw new StoryEngineModelRuntimeError(request.role);
    }
};
