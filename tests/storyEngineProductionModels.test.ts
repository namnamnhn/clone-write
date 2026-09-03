import { describe, expect, it } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import type { PlannerContext } from '../src/storyEngine';
import {
    CONFLICT_IMPORTANCE,
    INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA,
    SCENE_PURPOSE_TAGS,
    STORY_ENGINE_MODEL_ROLES,
    StoryEngineModelRuntimeError,
} from '../src/storyEngine';
import {
    DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY,
    GeminiStoryEngineProtocolError,
    StoryEngineModelPolicyError,
    createGeminiStoryEngineAdapters,
    createGeminiStoryEngineModelBundle,
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
import { auditGeminiResponseSchema } from './helpers/geminiResponseSchemaAudit';

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
    it('defines exactly the five production runtime roles, with setup compilation kept separate', () => {
        expect(STORY_ENGINE_MODEL_ROLES).toEqual([
            'planner', 'writer', 'semanticValidator', 'repair', 'stateExtractor',
        ]);
    });

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

    it('keeps exact Planner, Writer, and Semantic Validator order with 3.5 Flash final', () => {
        expect(DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.planner).toMatchObject({
            preferredModelId: 'gemini-3.1-pro-preview',
            candidateModelIds: ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        });
        expect(DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.writer).toMatchObject({
            preferredModelId: 'gemini-3.1-pro-preview',
            candidateModelIds: ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        });
        expect(DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.semanticValidator).toMatchObject({
            preferredModelId: 'gemini-3.7-flash',
            candidateModelIds: ['gemini-3.7-flash', 'gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.5-flash'],
        });
        expect(DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.repair.candidateModelIds)
            .toEqual(['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
        expect(DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.stateExtractor.candidateModelIds)
            .toEqual(['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
        expect(JSON.stringify(DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY)).not.toMatch(/flash-lite|gemma/i);
    });

    it.each(['planner', 'writer', 'semanticValidator'] as const)(
        'filters disabled 3.5 Flash from %s without reordering earlier candidates',
        (role) => {
            const expected = DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY[role].candidateModelIds.filter(id => id !== 'gemini-3.5-flash');
            expect(resolveStoryEngineModelRoute(role, DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY[role], expected).candidateModelIds)
                .toEqual(expected);
        },
    );

    it.each(STORY_ENGINE_MODEL_ROLES)(
        'never returns disabled 3.5 Flash in the resolved %s route',
        (role) => {
            const configuredWithoutFinalFallback = DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY[role].candidateModelIds
                .filter(id => id !== 'gemini-3.5-flash');
            expect(resolveStoryEngineModelRoute(
                role,
                DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY[role],
                configuredWithoutFinalFallback,
            ).candidateModelIds).not.toContain('gemini-3.5-flash');
        },
    );
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

    it('threads JSON MIME type, role schema, temperature, safety, and cancellation through the SDK config', async () => {
        let captured: unknown;
        const controller = new AbortController();
        const responseJsonSchema = { type: 'object' };
        const deps = dependenciesFor('{"ok":true}');
        const wrapped: GeminiStoryEngineRunnerDependencies = {
            ...deps,
            getAiClient: () => ({ models: { async generateContent(request) {
                captured = request;
                return { text: '{"ok":true}' } as GenerateContentResponse;
            } } }),
        };
        await runGeminiStoryEngineJson({
            role: 'planner', route, contents: 'prompt', responseJsonSchema, signal: controller.signal,
        }, wrapped);
        expect(captured).toMatchObject({
            contents: 'prompt',
            config: {
                responseMimeType: 'application/json', responseJsonSchema,
                temperature: 0.3, abortSignal: controller.signal,
            },
        });
    });

    it('fails closed before execution when already cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(runGeminiStoryEngineJson({ role: 'planner', route, contents: 'prompt', signal: controller.signal }, dependenciesFor('{}')))
            .rejects.toThrow('ABORTED');
    });

    it('converts provider failures to a safe typed model-runtime boundary without retaining provider text', async () => {
        const sentinel = '503 UNAVAILABLE SENTINEL_PROVIDER_BODY API_KEY_SENTINEL';
        let caught: unknown;
        try {
            await runGeminiStoryEngineJson({ role: 'planner', route, contents: 'PRIVATE_PROMPT_SENTINEL' }, {
                smartExecution: async () => { throw new Error(sentinel); },
                getAiClient: () => { throw new Error('must not be called'); },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(StoryEngineModelRuntimeError);
        expect(caught).toMatchObject({ name: 'StoryEngineModelRuntimeError', message: 'MODEL_RUNTIME_FAILURE', role: 'planner' });
        expect(JSON.stringify(caught)).not.toContain(sentinel);
        expect(JSON.stringify(caught)).not.toContain('PRIVATE_PROMPT_SENTINEL');
    });

    it('converts a direct generateContent failure to the same safe model-runtime boundary', async () => {
        const sentinel = '503 DIRECT_PROVIDER_SENTINEL SECRET_RESPONSE_BODY';
        const deps = dependenciesFor('{}');
        await expect(runGeminiStoryEngineJson({ role: 'writer', route, contents: 'PRIVATE_WRITER_PROMPT' }, {
            ...deps,
            getAiClient: () => ({ models: { generateContent: async () => { throw new Error(sentinel); } } }),
        })).rejects.toMatchObject({
            name: 'StoryEngineModelRuntimeError', message: 'MODEL_RUNTIME_FAILURE', role: 'writer',
        });
        try {
            await runGeminiStoryEngineJson({ role: 'writer', route, contents: 'PRIVATE_WRITER_PROMPT' }, {
                ...deps,
                getAiClient: () => ({ models: { generateContent: async () => { throw new Error(sentinel); } } }),
            });
        } catch (error) {
            expect(JSON.stringify(error)).not.toContain(sentinel);
            expect(JSON.stringify(error)).not.toContain('PRIVATE_WRITER_PROMPT');
        }
    });

    it.each([
        ['', 'EMPTY_RESPONSE'],
        ['not-json', 'MALFORMED_JSON'],
    ] as const)('preserves %s as protocol failure when execution wraps the operation error', async (output, code) => {
        const dependencies = dependenciesFor(output);
        await expect(runGeminiStoryEngineJson({ role: 'planner', route, contents: 'prompt' }, {
            ...dependencies,
            smartExecution: async (candidateModels, operation) => {
                try {
                    return await operation(candidateModels[0]);
                } catch {
                    throw new Error('smartExecution aggregate failure');
                }
            },
        })).rejects.toMatchObject({ code } satisfies Partial<GeminiStoryEngineProtocolError>);
    });

    it.each(STORY_ENGINE_MODEL_ROLES)(
        'continues %s from transient 3.7 failure to the next enabled fallback',
        async (role) => {
            const attempts: string[] = [];
            const resolved = resolveStoryEngineModelRoute(role, DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY[role], [
                'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash',
            ]);
            const result = await runGeminiStoryEngineJson({ role, route: resolved, contents: 'prompt' }, {
                smartExecution: async (candidateModels, operation) => {
                    let lastError: unknown;
                    for (const modelId of candidateModels) {
                        try {
                            return await operation(modelId);
                        } catch (error) {
                            lastError = error;
                        }
                    }
                    throw lastError;
                },
                getAiClient: () => ({ models: { generateContent: async ({ model }) => {
                    attempts.push(model);
                    if (model === 'gemini-3.7-flash') throw new Error('503 UNAVAILABLE');
                    return { text: '{}' } as GenerateContentResponse;
                } } }),
            });
            expect(attempts).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash']);
            expect(result.selectedModelId).toBe('gemini-3.6-flash');
        },
    );

    it.each(STORY_ENGINE_MODEL_ROLES)(
        'continues %s through 3.7 and 3.6 failures to final 3.5 Flash',
        async (role) => {
            const attempts: string[] = [];
            const resolved = resolveStoryEngineModelRoute(role, DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY[role], [
                'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash',
            ]);
            const result = await runGeminiStoryEngineJson({ role, route: resolved, contents: 'prompt' }, {
                smartExecution: async (candidateModels, operation) => {
                    let lastError: unknown;
                    for (const modelId of candidateModels) {
                        try {
                            return await operation(modelId);
                        } catch (error) {
                            lastError = error;
                        }
                    }
                    throw lastError;
                },
                getAiClient: () => ({ models: { generateContent: async ({ model }) => {
                    attempts.push(model);
                    if (model !== 'gemini-3.5-flash') throw new Error('503 UNAVAILABLE');
                    return { text: '{}' } as GenerateContentResponse;
                } } }),
            });
            expect(attempts).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
            expect(result.selectedModelId).toBe('gemini-3.5-flash');
        },
    );
});

describe('WORK 12 role-specific Gemini serialization', () => {
    it('sends the dedicated schema on the Planner SDK request and on no other role request', async () => {
        const configs: unknown[] = [];
        const models = createGeminiStoryEngineModelBundle({
            availableModelIds: ['gemini-3.7-flash'],
            runnerDependencies: {
                smartExecution: async (candidateModels, operation) => operation(candidateModels[0]),
                getAiClient: () => ({ models: { generateContent: async (request) => {
                    configs.push(request.config);
                    return { text: '{}' } as GenerateContentResponse;
                } } }),
            },
        });
        await models.planner.plan({ kind: 'planner-context', targetChapter: 1 } as unknown as PlannerContext);
        await models.writer.write({ kind: 'writer-model-request', prompt: 'WRITER' } as never);
        await models.semanticValidator.validate({ prompt: 'VALIDATOR', context: {}, candidate: {} } as never);
        await models.repair.repair({ prompt: 'REPAIR', context: {} } as never);
        await models.stateExtractor.extract({ prompt: 'EXTRACT', context: {}, candidate: {} } as never);

        expect(configs[0]).toMatchObject({ responseJsonSchema: INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA });
        configs.slice(1).forEach(config => expect(config).not.toHaveProperty('responseJsonSchema'));
    });

    it('keeps Writer prompt-only and preserves distinct privileged/safe envelopes', async () => {
        const captures = new Map<string, string>();
        const schemaCaptures = new Map<string, unknown>();
        const runtime: GeminiStoryEngineGenerationRuntime = {
            async run(request) {
                captures.set(request.role, request.contents);
                schemaCaptures.set(request.role, request.responseJsonSchema);
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
        expect(schemaCaptures.get('planner')).toBe(INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA);
        expect([...schemaCaptures.entries()].filter(([role]) => role !== 'planner').every(([, schema]) => schema === undefined)).toBe(true);
    });

    it('keeps the Planner provider schema inside the supported Gemini subset', () => {
        expect(auditGeminiResponseSchema(INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA)).toEqual([]);
        const serialized = JSON.stringify(INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA);
        [
            'minLength', 'maxLength', 'pattern', 'const', 'uniqueItems', 'allOf',
            'not', 'if', 'then', 'else', 'dependentRequired',
        ].forEach(keyword => expect(serialized).not.toContain(`"${keyword}"`));
    });

    it('keeps Planner scene enums derived exactly from runtime constants', () => {
        const scene = INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA.$defs.scene;
        expect(scene.properties.purposeTags.items.enum).toEqual([...SCENE_PURPOSE_TAGS]);
        expect(scene.properties.conflictImportance.enum).toEqual([...CONFLICT_IMPORTANCE]);
    });

    it('describes the complete parser-supported Planner object families', () => {
        const schema = INTERNAL_CHAPTER_PLAN_RESPONSE_JSON_SCHEMA;
        expect(schema.required).toEqual(expect.arrayContaining([
            'scenes', 'expectedResourceDeltas', 'expectedRelationshipDeltas',
            'expectedContinuityConsequences', 'strategicActions', 'relationshipActions',
        ]));
        expect(schema.$defs.scene.required).toEqual([
            'id', 'order', 'goal', 'location', 'povCharacterId', 'participantIds',
            'conflictOrObstacle', 'uncertainty', 'expectedConsequence', 'purposeTags', 'conflictImportance',
        ]);
        expect(schema.$defs.intelligentConflict.required).toEqual([
            'protagonistObjective', 'opponentObjective', 'opponentKnowledge', 'opponentBeliefs',
            'rationalCountermove', 'uncertainty', 'expectedCostOrTradeoff',
        ]);
        expect(schema.$defs.strategicAction.oneOf).toEqual([
            { $ref: '#/$defs/politicalAction' }, { $ref: '#/$defs/militaryAction' }, { $ref: '#/$defs/commerceAction' },
        ]);
        expect(schema.$defs.relationshipAction.required).toContain('writerVisibleContract');
    });
});
