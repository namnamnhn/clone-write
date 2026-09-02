import { describe, expect, it } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import type { PlannerContext } from '../src/storyEngine';
import {
    STORY_ENGINE_MODEL_ROLES,
} from '../src/storyEngine';
import {
    DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY,
    GeminiStoryEngineProtocolError,
    StoryEngineModelPolicyError,
    createGeminiStoryEngineAdapters,
    normalizeStoryEngineModelRolePolicy,
    normalizeStoryEngineModelRoute,
    resolveStoryEngineModelRolePolicy,
    resolveStoryEngineModelRoute,
    runGeminiStoryEngineJson,
} from '../src/services/storyEngine';
import type {
    GeminiStoryEngineGenerationRuntime,
    GeminiStoryEngineRunnerDependencies,
} from '../src/services/storyEngine';

const route = DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.planner;

const dependenciesFor = (output: string, events: string[] = []): GeminiStoryEngineRunnerDependencies => ({
    async smartExecution(candidateModels, operation, _task, _log, preferred) {
        events.push(`execute:${candidateModels.join(',')}:${preferred}`);
        return operation(candidateModels[0]);
    },
    getAiClient() {
        events.push('client');
        return {
            models: {
                async generateContent(request) {
                    events.push(`generate:${request.model}`);
                    return { text: output } as GenerateContentResponse;
                },
            },
        };
    },
});

describe('WORK 12 Story Engine model policy', () => {
    it('normalizes the complete role policy without adding fields', () => {
        const normalized = normalizeStoryEngineModelRolePolicy(DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY);
        expect(Object.keys(normalized)).toEqual(STORY_ENGINE_MODEL_ROLES);
        expect(normalized.writer.temperature).toBe(0.8);
    });

    it.each([
        [{ preferredModelId: 'gemini-a', candidateModelIds: [], temperature: 0.2 }, 'non-empty'],
        [{ preferredModelId: 'gemini-a', candidateModelIds: [''], temperature: 0.2 }, 'non-empty'],
        [{ preferredModelId: 'gemini-a', candidateModelIds: ['gemini-a', 'gemini-a'], temperature: 0.2 }, 'duplicates'],
        [{ preferredModelId: 'gemini-b', candidateModelIds: ['gemini-a'], temperature: 0.2 }, 'must be one'],
        [{ preferredModelId: 'deepseek:x', candidateModelIds: ['deepseek:x'], temperature: 0.2 }, 'Gemini'],
        [{ preferredModelId: 'openai:gpt', candidateModelIds: ['openai:gpt'], temperature: 0.2 }, 'Gemini'],
        [{ preferredModelId: 'gemini-a', candidateModelIds: ['gemini-a'], temperature: Number.NaN }, 'finite'],
        [{ preferredModelId: 'gemini-a', candidateModelIds: ['gemini-a'], temperature: 0.2, extra: true }, 'not supported'],
    ])('rejects malformed route %#', (input, message) => {
        expect(() => normalizeStoryEngineModelRoute(input)).toThrow(message as string);
    });

    it('rejects unknown policy roles', () => {
        expect(() => normalizeStoryEngineModelRolePolicy({ ...DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY, unknown: route }))
            .toThrow(StoryEngineModelPolicyError);
    });

    it('supports Lite-style Pro removal by safely falling back to configured Flash', () => {
        expect(resolveStoryEngineModelRoute('planner', route, ['gemini-3.7-flash'])).toEqual({
            preferredModelId: 'gemini-3.7-flash', candidateModelIds: ['gemini-3.7-flash'], temperature: 0.3,
        });
    });

    it('fails when an edition has no configured candidate for a role', () => {
        expect(() => resolveStoryEngineModelRoute('planner', route, ['gemini-unrelated'])).toThrow(/no configured Gemini/i);
    });

    it('does not let caller availability expand the real configured catalog', () => {
        const fake = { preferredModelId: 'gemini-fake', candidateModelIds: ['gemini-fake'], temperature: 0.2 };
        expect(() => resolveStoryEngineModelRoute('planner', fake, ['gemini-fake']))
            .toThrow(expect.objectContaining({ code: 'NO_MODEL_AVAILABLE' } satisfies Partial<StoryEngineModelPolicyError>));
    });

    it('excludes configured image-only Gemini models from every text role', () => {
        const imageId = 'gemini-3.1-flash-lite-image';
        const imageRoute = { preferredModelId: imageId, candidateModelIds: [imageId], temperature: 0.2 };
        for (const role of STORY_ENGINE_MODEL_ROLES) {
            expect(() => resolveStoryEngineModelRoute(role, imageRoute, [imageId]))
                .toThrow(expect.objectContaining({ code: 'NO_MODEL_AVAILABLE' } satisfies Partial<StoryEngineModelPolicyError>));
        }
    });

    it('keeps all default candidates Gemini-only', () => {
        const policy = resolveStoryEngineModelRolePolicy(DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY, [
            'gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'deepseek:chat',
        ]);
        expect(Object.values(policy).flatMap(value => value.candidateModelIds).every(id => id.startsWith('gemini-'))).toBe(true);
    });
});

describe('WORK 12 strict Gemini JSON runner', () => {
    it('strictly parses one JSON response and obtains the client inside execution', async () => {
        const events: string[] = [];
        const result = await runGeminiStoryEngineJson({ role: 'planner', route, contents: 'prompt' }, dependenciesFor('{"ok":true}', events));
        expect(result).toEqual({ value: { ok: true }, selectedModelId: route.candidateModelIds[0] });
        expect(events).toEqual([
            `execute:${route.candidateModelIds.join(',')}:${route.preferredModelId}`,
            'client', `generate:${route.candidateModelIds[0]}`,
        ]);
    });

    it.each([
        '```json\n{"ok":true}\n```',
        'Here is JSON: {"ok":true}',
        '{"ok":',
    ])('rejects malformed or decorated structured output', async (output) => {
        await expect(runGeminiStoryEngineJson({ role: 'planner', route, contents: 'prompt' }, dependenciesFor(output)))
            .rejects.toMatchObject({ code: 'MALFORMED_JSON' } satisfies Partial<GeminiStoryEngineProtocolError>);
    });

    it.each(['', '   '])('rejects an empty response', async (output) => {
        await expect(runGeminiStoryEngineJson({ role: 'planner', route, contents: 'prompt' }, dependenciesFor(output)))
            .rejects.toMatchObject({ code: 'EMPTY_RESPONSE' } satisfies Partial<GeminiStoryEngineProtocolError>);
    });

    it('threads JSON MIME type, temperature, safety, and cancellation through the SDK config', async () => {
        let captured: unknown;
        const controller = new AbortController();
        const deps = dependenciesFor('{"ok":true}');
        const wrapped: GeminiStoryEngineRunnerDependencies = {
            ...deps,
            getAiClient: () => ({ models: { async generateContent(request) {
                captured = request;
                return { text: '{"ok":true}' } as GenerateContentResponse;
            } } }),
        };
        await runGeminiStoryEngineJson({ role: 'planner', route, contents: 'prompt', signal: controller.signal }, wrapped);
        expect(captured).toMatchObject({ contents: 'prompt', config: { responseMimeType: 'application/json', temperature: 0.3, abortSignal: controller.signal } });
    });

    it('fails closed before execution when already cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(runGeminiStoryEngineJson({ role: 'planner', route, contents: 'prompt', signal: controller.signal }, dependenciesFor('{}')))
            .rejects.toThrow('ABORTED');
    });
});

describe('WORK 12 role-specific Gemini serialization', () => {
    it('keeps Writer prompt-only and preserves distinct privileged/safe envelopes', async () => {
        const captures = new Map<string, string>();
        const runtime: GeminiStoryEngineGenerationRuntime = {
            async run(request) {
                captures.set(request.role, request.contents);
                return { value: {}, selectedModelId: 'gemini-test' };
            },
        };
        const adapters = createGeminiStoryEngineAdapters(runtime);
        await adapters.planner.plan({ kind: 'planner-context', targetChapter: 1 } as unknown as PlannerContext);
        await adapters.writer.write({ kind: 'writer-model-request', prompt: 'WRITER_ONLY', context: { hidden: 'not serialized separately' } } as never);
        await adapters.semanticValidator.validate({ prompt: 'VALIDATE', context: { privileged: 'SECRET_EVIDENCE' }, candidate: { prose: 'chapter' } } as never);
        await adapters.repair.repair({ prompt: 'REPAIR', context: { safe: 'ISSUE_SAFE' } } as never);
        await adapters.stateExtractor.extract({ prompt: 'EXTRACT', context: { safe: 'EXTRACTION_SAFE' }, candidate: { prose: 'chapter' } } as never);

        expect(captures.get('planner')).toContain('CONTEXT:');
        expect(captures.get('writer')).toBe('WRITER_ONLY');
        expect(JSON.parse(captures.get('semanticValidator')!)).toEqual({ prompt: 'VALIDATE', context: { privileged: 'SECRET_EVIDENCE' }, candidate: { prose: 'chapter' } });
        expect(JSON.parse(captures.get('repair')!)).toEqual({ prompt: 'REPAIR', context: { safe: 'ISSUE_SAFE' } });
        expect(JSON.parse(captures.get('stateExtractor')!)).toEqual({ prompt: 'EXTRACT', context: { safe: 'EXTRACTION_SAFE' }, candidate: { prose: 'chapter' } });
        expect(captures.get('repair')).not.toContain('SECRET_EVIDENCE');
        expect(captures.get('stateExtractor')).not.toContain('SECRET_EVIDENCE');
    });
});
