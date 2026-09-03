import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import { quotaManager } from '../src/utils/quotaManager';
import {
    DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY,
    GEMINI_V4_REQUEST_DEADLINE_MS,
    GeminiV4RequestTimeoutError,
    compileStorySetupWithGemini,
    createGeminiProductionStoryRuntime,
    isGeminiV4RequestTimeoutError,
    runGeminiStoryEngineJson,
    runGeminiV4RequestWithDeadline,
    STORY_SETUP_COMPILER_CANDIDATES,
} from '../src/services/storyEngine';
import type {
    GeminiStoryEngineRunnerDependencies,
    GeminiStorySetupCompilerDependencies,
} from '../src/services/storyEngine';
import { smartExecution } from '../src/services/api/gemini';
import type { StoryEngineModelRole } from '../src/storyEngine';
import { createV4ProjectSeed } from '../src/storyEngine';

const PRIVATE_PROMPT = 'PRIVATE_STORY_PROMPT_SENTINEL';
const PRIVATE_PROVIDER = 'PRIVATE_PROVIDER_MESSAGE_SENTINEL';
const PRIVATE_KEY = 'AIza_PRIVATE_KEY_SENTINEL';
const PRIVATE_SECRET = 'PRIVATE_AUTHOR_SECRET_SENTINEL';

const timeoutAwareExecution: GeminiStoryEngineRunnerDependencies['smartExecution'] = async (
    candidateModels,
    operation,
) => {
    let lastError: unknown;
    for (const modelId of candidateModels) {
        try {
            return await operation(modelId);
        } catch (error) {
            lastError = error;
            if (error instanceof Error && (error.message === 'ABORTED' || error.name === 'AbortError')) throw error;
            if (!isGeminiV4RequestTimeoutError(error)) throw error;
        }
    }
    throw lastError;
};

const runnerDependencies = (
    generateContent: (request: { model: string; config?: { abortSignal?: AbortSignal } }) => Promise<GenerateContentResponse>,
): GeminiStoryEngineRunnerDependencies => ({
    smartExecution: timeoutAwareExecution,
    getAiClient: () => ({ models: { generateContent: generateContent as never } }),
});

const setupDependencies = (
    generateContent: (request: { model: string; config?: { abortSignal?: AbortSignal } }) => Promise<GenerateContentResponse>,
): GeminiStorySetupCompilerDependencies => ({
    smartExecution: timeoutAwareExecution,
    getAiClient: () => ({ models: { generateContent: generateContent as never } }),
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Story Engine V4 Gemini request deadlines', () => {
    it('defines conservative app-side deadlines for exactly all six V4 call surfaces', () => {
        expect(GEMINI_V4_REQUEST_DEADLINE_MS).toEqual({
            setupCompiler: 300_000,
            planner: 180_000,
            writer: 360_000,
            semanticValidator: 180_000,
            repair: 300_000,
            stateExtractor: 180_000,
        });
    });

    it('aborts a hung attempt at the deadline and ignores its late provider resolution', async () => {
        vi.useFakeTimers();
        let attemptSignal: AbortSignal | undefined;
        let resolveProvider!: (value: string) => void;
        let publishedValue: string | undefined;
        const provider = new Promise<string>(resolve => { resolveProvider = resolve; });
        const request = runGeminiV4RequestWithDeadline({
            surface: 'planner',
            operation: signal => {
                attemptSignal = signal;
                return provider;
            },
        }).then(value => {
            publishedValue = value;
            return value;
        });
        const rejected = expect(request).rejects.toMatchObject({
            name: 'GeminiV4RequestTimeoutError', code: 'MODEL_REQUEST_TIMEOUT', surface: 'planner',
        });

        await vi.advanceTimersByTimeAsync(180_000);
        await rejected;
        expect(attemptSignal?.aborted).toBe(true);
        resolveProvider('LATE_PROVIDER_RESULT');
        await Promise.resolve();
        expect(publishedValue).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the typed timeout authoritative when abort makes the SDK reject immediately', async () => {
        vi.useFakeTimers();
        const request = runGeminiV4RequestWithDeadline({
            surface: 'planner',
            operation: signal => new Promise<string>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new Error(PRIVATE_PROVIDER)), { once: true });
            }),
        });
        const rejected = expect(request).rejects.toMatchObject({
            name: 'GeminiV4RequestTimeoutError', code: 'MODEL_REQUEST_TIMEOUT', surface: 'planner',
        });

        await vi.advanceTimersByTimeAsync(180_000);
        await rejected;
        try {
            await request;
        } catch (error) {
            expect(JSON.stringify(error)).not.toContain(PRIVATE_PROVIDER);
        }
    });

    it('forwards external Stop, clears cleanup, and distinguishes it from timeout', async () => {
        vi.useFakeTimers();
        const external = new AbortController();
        const addListener = vi.spyOn(external.signal, 'addEventListener');
        const removeListener = vi.spyOn(external.signal, 'removeEventListener');
        let attemptSignal: AbortSignal | undefined;
        let resolveProvider!: (value: string) => void;
        let publishedValue: string | undefined;
        const request = runGeminiV4RequestWithDeadline({
            surface: 'writer',
            externalSignal: external.signal,
            operation: signal => {
                attemptSignal = signal;
                return new Promise<string>(resolve => { resolveProvider = resolve; });
            },
        }).then(value => {
            publishedValue = value;
            return value;
        });
        const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError', message: 'ABORTED' });

        await Promise.resolve();
        external.abort();
        await rejected;
        expect(attemptSignal?.aborted).toBe(true);
        expect(addListener).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        resolveProvider('LATE_CANCELLED_RESULT');
        await Promise.resolve();
        expect(publishedValue).toBeUndefined();
    });

    it('makes smartExecution skip only the typed timeout marker without error/quota accounting', async () => {
        const recordError = vi.spyOn(quotaManager, 'recordError');
        const recordQuotaError = vi.spyOn(quotaManager, 'recordQuotaError');
        const markAsDepleted = vi.spyOn(quotaManager, 'markAsDepleted');
        const attempts: string[] = [];

        const result = await smartExecution(
            ['deepseek:timeout-a', 'deepseek:timeout-b'],
            async modelId => {
                attempts.push(modelId);
                if (modelId === 'deepseek:timeout-a') throw new GeminiV4RequestTimeoutError('planner');
                return 'fallback-ok';
            },
            'V4 timeout marker test',
        );

        expect(result).toBe('fallback-ok');
        expect(attempts).toEqual(['deepseek:timeout-a', 'deepseek:timeout-b']);
        expect(recordError).not.toHaveBeenCalled();
        expect(recordQuotaError).not.toHaveBeenCalled();
        expect(markAsDepleted).not.toHaveBeenCalled();
    });

    it('preserves ordinary fast 503 retry/backoff instead of treating it as timeout', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-03T00:00:00Z'));
        vi.spyOn(quotaManager, 'getBestModelForTask').mockImplementation((candidates, blacklist) =>
            candidates.find(candidate => !blacklist.includes(candidate)) ?? null);
        vi.spyOn(quotaManager, 'getWaitTimeForModel').mockReturnValue(0);
        vi.spyOn(quotaManager, 'getApiKeyWaitForModel').mockReturnValue(0);
        vi.spyOn(quotaManager, 'isModelEnabled').mockReturnValue(true);
        vi.spyOn(quotaManager, 'isModelDepleted').mockReturnValue(false);
        vi.spyOn(quotaManager, 'recordRequest').mockImplementation(() => undefined);
        vi.spyOn(quotaManager, 'recordError').mockImplementation(() => undefined);
        vi.spyOn(quotaManager, 'recordRateLimit').mockImplementation(() => undefined);
        const attemptTimes: number[] = [];
        const request = smartExecution(
            ['gemini-3.7-flash'],
            async () => {
                attemptTimes.push(Date.now());
                throw { status: 503, message: 'UNAVAILABLE' };
            },
            'Fast 503 regression',
        );
        const rejected = expect(request).rejects.toThrow();

        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(8_000);
        await vi.advanceTimersByTimeAsync(12_000);
        await rejected;
        expect(attemptTimes).toHaveLength(3);
        expect(attemptTimes[1] - attemptTimes[0]).toBe(5_000);
        expect(attemptTimes[2] - attemptTimes[1]).toBe(8_000);
    });

    it.each([
        [['gemini-3.7-flash'], 'gemini-3.6-flash'],
        [['gemini-3.7-flash', 'gemini-3.6-flash'], 'gemini-3.5-flash'],
    ] as const)('falls Planner through timed-out %j to %s', async (timedOutModels, successfulModel) => {
        vi.useFakeTimers();
        const route = {
            ...DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.planner,
            preferredModelId: 'gemini-3.7-flash',
            candidateModelIds: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        };
        const attempts: string[] = [];
        const signals: AbortSignal[] = [];
        const request = runGeminiStoryEngineJson({ role: 'planner', route, contents: PRIVATE_PROMPT }, runnerDependencies(
            async ({ model, config }) => {
                attempts.push(model);
                signals.push(config!.abortSignal!);
                if (timedOutModels.includes(model as never)) return new Promise<GenerateContentResponse>(() => undefined);
                return { text: '{"ok":true}' } as GenerateContentResponse;
            },
        ));

        for (let index = 0; index < timedOutModels.length; index += 1) {
            await vi.advanceTimersByTimeAsync(180_000);
        }
        await expect(request).resolves.toEqual({ value: { ok: true }, selectedModelId: successfulModel });
        expect(attempts).toEqual([...timedOutModels, successfulModel]);
        expect(signals.slice(0, timedOutModels.length).every(signal => signal.aborted)).toBe(true);
        expect(signals.at(-1)?.aborted).toBe(false);
    });

    it('turns all Planner timeouts into a redacted MODEL_RUNTIME_FAILURE', async () => {
        vi.useFakeTimers();
        const route = {
            ...DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.planner,
            preferredModelId: 'gemini-3.7-flash',
            candidateModelIds: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        };
        const request = runGeminiStoryEngineJson({ role: 'planner', route, contents: PRIVATE_PROMPT }, runnerDependencies(
            async () => new Promise<GenerateContentResponse>(() => undefined),
        ));
        const rejected = expect(request).rejects.toMatchObject({
            name: 'StoryEngineModelRuntimeError', message: 'MODEL_RUNTIME_FAILURE', role: 'planner',
        });

        await vi.advanceTimersByTimeAsync(180_000);
        await vi.advanceTimersByTimeAsync(180_000);
        await vi.advanceTimersByTimeAsync(180_000);
        await rejected;
        try {
            await request;
        } catch (error) {
            const serialized = JSON.stringify(error);
            [PRIVATE_PROMPT, PRIVATE_PROVIDER, PRIVATE_KEY, PRIVATE_SECRET].forEach(value => {
                expect(serialized).not.toContain(value);
            });
        }
    });

    it('keeps Canon and memory at the durable C0 checkpoint when every Planner candidate times out', async () => {
        vi.useFakeTimers();
        const seed = createV4ProjectSeed({
            kind: 'story-blueprint-document',
            formatVersion: 1,
            blueprint: {
                id: 'timeout-durable-story',
                engine: { plannedChapterCount: 1 },
                characters: [{ id: 'hero', name: 'Hero', availableFromChapter: 1 }],
                arcs: [{ id: 'arc', title: 'Arc', startChapter: 1, endChapter: 1 }],
                gates: { pov: [{ id: 'hero-pov', characterId: 'hero', allowedFromChapter: 1 }] },
            },
        });
        const stateBefore = structuredClone(seed.state);
        const memoryBefore = structuredClone(seed.memory);
        const runtime = createGeminiProductionStoryRuntime({
            availableModelIds: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
            runnerDependencies: runnerDependencies(
                async () => new Promise<GenerateContentResponse>(() => undefined),
            ),
        });
        const run = runtime.runChapterToCanonReview({
            control: seed.control,
            state: seed.state,
            memoryState: seed.memory,
        });

        await vi.advanceTimersByTimeAsync(180_000);
        await vi.advanceTimersByTimeAsync(180_000);
        await vi.advanceTimersByTimeAsync(180_000);
        await expect(run).resolves.toMatchObject({
            status: 'blocked', code: 'MODEL_RUNTIME_FAILURE', stage: 'planning', role: 'planner',
        });
        expect(seed.state).toEqual(stateBefore);
        expect(seed.memory).toEqual(memoryBefore);
    });

    it('stops a hung Planner attempt without falling back when the user aborts', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const attempts: string[] = [];
        const request = runGeminiStoryEngineJson({
            role: 'planner',
            route: DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.planner,
            contents: PRIVATE_PROMPT,
            signal: controller.signal,
        }, runnerDependencies(async ({ model }) => {
            attempts.push(model);
            return new Promise<GenerateContentResponse>(() => undefined);
        }));
        const rejected = expect(request).rejects.toMatchObject({ message: 'ABORTED' });

        await Promise.resolve();
        controller.abort();
        await rejected;
        expect(attempts).toEqual(['gemini-3.1-pro-preview']);
    });

    it.each([
        ['planner', 180_000],
        ['writer', 360_000],
        ['semanticValidator', 180_000],
        ['repair', 300_000],
        ['stateExtractor', 180_000],
    ] as const)('applies the configured %s deadline (%i ms)', async (role: StoryEngineModelRole, deadlineMs) => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        const route = DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY[role];
        const oneModelRoute = { ...route, candidateModelIds: [route.preferredModelId] };
        const request = runGeminiStoryEngineJson({ role, route: oneModelRoute, contents: PRIVATE_PROMPT }, runnerDependencies(
            async ({ config }) => {
                signal = config!.abortSignal;
                return new Promise<GenerateContentResponse>(() => undefined);
            },
        ));
        const rejected = expect(request).rejects.toMatchObject({ message: 'MODEL_RUNTIME_FAILURE', role });

        await vi.advanceTimersByTimeAsync(deadlineMs - 1);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(signal?.aborted).toBe(true);
    });

    it('falls Setup Compiler through timeouts and closes all-timeout exhaustion safely', async () => {
        vi.useFakeTimers();
        const attempts: string[] = [];
        const fallback = compileStorySetupWithGemini({
            source: PRIVATE_SECRET,
            availableModelIds: ['gemini-3.7-flash', 'gemini-3.6-flash'],
        }, setupDependencies(async ({ model }) => {
            attempts.push(model);
            if (model === 'gemini-3.6-flash') return { text: '{"ok":true}' } as GenerateContentResponse;
            return new Promise<GenerateContentResponse>(() => undefined);
        }));

        await vi.advanceTimersByTimeAsync(300_000);
        await expect(fallback).resolves.toEqual({ value: { ok: true }, selectedModelId: 'gemini-3.6-flash' });
        expect(attempts).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash']);

        const exhausted = compileStorySetupWithGemini({
            source: PRIVATE_SECRET,
            availableModelIds: ['gemini-3.7-flash'],
        }, setupDependencies(async () => new Promise<GenerateContentResponse>(() => undefined)));
        const rejected = expect(exhausted).rejects.toMatchObject({
            name: 'GeminiStorySetupCompilerError', code: 'MODEL_RUNTIME_FAILURE',
        });
        await vi.advanceTimersByTimeAsync(300_000);
        await rejected;
        try {
            await exhausted;
        } catch (error) {
            expect(JSON.stringify(error)).not.toContain(PRIVATE_SECRET);
        }
    });

    it('keeps disabled setup candidates filtered before timeout execution', async () => {
        const attempts: string[] = [];
        await compileStorySetupWithGemini({
            source: 'SAFE SETUP',
            availableModelIds: ['gemini-3.6-flash'],
        }, setupDependencies(async ({ model }) => {
            attempts.push(model);
            return { text: '{"ok":true}' } as GenerateContentResponse;
        }));
        expect(attempts).toEqual(['gemini-3.6-flash']);
        expect(STORY_SETUP_COMPILER_CANDIDATES).toContain('gemini-3.5-flash');
    });
});
