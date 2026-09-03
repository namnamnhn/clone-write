import type { GenerateContentResponse } from '@google/genai';
import { getAiClient, SAFETY_SETTINGS, smartExecution } from '../api/gemini';
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
    return dependencies.smartExecution(
        [...request.route.candidateModelIds],
        async (modelId) => {
            if (request.signal?.aborted) throw new Error('ABORTED');
            // This must remain inside the selected smartExecution operation so key attribution is correct.
            const ai = dependencies.getAiClient();
            let response: GenerateContentResponse;
            try {
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
                throw error;
            }
            const output = response.text?.trim();
            if (!output) throw new GeminiStoryEngineProtocolError('EMPTY_RESPONSE');
            let value: unknown;
            try {
                value = JSON.parse(output);
            } catch {
                throw new GeminiStoryEngineProtocolError('MALFORMED_JSON');
            }
            return { value, selectedModelId: modelId };
        },
        `Story Engine V4 ${request.role}`,
        undefined,
        request.route.preferredModelId,
    );
};
