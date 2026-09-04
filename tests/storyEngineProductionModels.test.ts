import { describe, expect, it, vi } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import type { PlannerContext, StateExtractorModelRequest } from '../src/storyEngine';
import {
    buildInternalChapterPlanResponseJsonSchema,
    buildPlannerValidationAffordances,
    buildStoryStateDeltaResponseJsonSchema,
    CONFLICT_IMPORTANCE,
    createV4ProjectSeed,
    PlannerContextError,
    SCENE_PURPOSE_TAGS,
    STORY_STATE_DELTA_V2_OPERATION_FIELDS,
    STORY_ENGINE_MODEL_ROLES,
    StoryEngineModelRuntimeError,
} from '../src/storyEngine';
import {
    DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY,
    GeminiStoryEngineProtocolError,
    StoryEngineModelPolicyError,
    createGeminiStoryEngineAdapters,
    createGeminiStoryEngineModelBundle,
    createGeminiProductionStoryRuntime,
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
import { getSafeStoryStudioRuntimeDiagnostic } from '../src/storyStudio/production/storyStudioRuntimeDiagnostics';
import {
    auditGeminiResponseSchema,
    measureGeminiResponseSchemaComplexity,
} from './helpers/geminiResponseSchemaAudit';

const route = DEFAULT_STORY_ENGINE_MODEL_ROLE_POLICY.planner;

const plannerPromptContext = (): PlannerContext => ({
    kind: 'planner-context',
    targetChapter: 1,
    currentArc: { id: 'arc-1' },
    availableCharacters: [{ id: 'pov-allowed' }, { id: 'pov-locked' }],
    povEligibility: [{ id: 'pov-allowed', allowed: true }, { id: 'pov-locked', allowed: false }],
    characterKnowledge: [],
    relationships: [],
    allowedRevealIds: [],
    allowedStoryEventIds: [],
    allowedRelationshipEventIds: [],
    relationshipContext: { relationships: [] },
} as unknown as PlannerContext);

const plannerSchema = (context: PlannerContext = plannerPromptContext()) =>
    buildInternalChapterPlanResponseJsonSchema(buildPlannerValidationAffordances(context).allowedPovIds);

const extractorRequest = (
    chapterNumber = 1,
    baseRevision = 0,
    contextTargetChapter = chapterNumber,
): StateExtractorModelRequest => ({
    kind: 'state-extractor-model-request',
    chapterNumber,
    prompt: 'EXTRACT',
    context: { targetChapter: contextTargetChapter, baseRevision },
    candidate: { prose: 'chapter' },
} as unknown as StateExtractorModelRequest);

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

    it('threads JSON MIME type, role schema, temperature, safety, and a per-attempt signal through the SDK config', async () => {
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
                temperature: 0.3,
            },
        });
        const attemptSignal = (captured as { config: { abortSignal: AbortSignal } }).config.abortSignal;
        expect(attemptSignal).toBeInstanceOf(AbortSignal);
        expect(attemptSignal).not.toBe(controller.signal);
        expect(attemptSignal.aborted).toBe(false);
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
    it('uses the exact target-allowed POV enum at both root and scene levels', () => {
        const context = plannerPromptContext();
        const allowedPovIds = buildPlannerValidationAffordances(context).allowedPovIds;
        const schema = buildInternalChapterPlanResponseJsonSchema(allowedPovIds);

        expect(schema.properties.povCharacterId).toEqual({ type: 'string', enum: ['pov-allowed'] });
        expect(schema.$defs.scene.properties.povCharacterId).toEqual({ type: 'string', enum: ['pov-allowed'] });
        expect(schema.properties.povCharacterId.enum).toEqual(allowedPovIds);
        expect(schema.$defs.scene.properties.povCharacterId.enum).toEqual(allowedPovIds);
        expect(JSON.stringify([
            schema.properties.povCharacterId.enum,
            schema.$defs.scene.properties.povCharacterId.enum,
        ])).not.toContain('pov-locked');
    });

    it('builds prompt affordances and the provider schema from one per-context allow-list', async () => {
        let captured: Parameters<GeminiStoryEngineGenerationRuntime['run']>[0] | undefined;
        const runtime: GeminiStoryEngineGenerationRuntime = {
            async run(request) {
                captured = request;
                return { value: {}, selectedModelId: 'gemini-test' };
            },
        };
        await createGeminiStoryEngineAdapters(runtime).planner.plan(plannerPromptContext());

        const promptMatch = captured?.contents.match(/VALIDATION_AFFORDANCES:\n([^]*?)\n\nCONTEXT:/);
        expect(promptMatch).toBeTruthy();
        const affordances = JSON.parse(promptMatch![1]) as { readonly allowedPovIds: readonly string[] };
        const schema = captured?.responseJsonSchema as ReturnType<typeof buildInternalChapterPlanResponseJsonSchema>;
        expect(schema.properties.povCharacterId.enum).toEqual(affordances.allowedPovIds);
        expect(schema.$defs.scene.properties.povCharacterId.enum).toEqual(affordances.allowedPovIds);
    });

    it('fails closed before the provider adapter when no POV is eligible', async () => {
        const run = vi.fn<GeminiStoryEngineGenerationRuntime['run']>();
        const context: PlannerContext = {
            ...plannerPromptContext(),
            povEligibility: [{ id: 'pov-allowed', allowed: false }, { id: 'pov-locked', allowed: false }],
        };
        await expect(createGeminiStoryEngineAdapters({ run }).planner.plan(context))
            .rejects.toEqual(expect.objectContaining({ name: 'PlannerContextError', code: 'NO_ALLOWED_POV' }));
        expect(() => buildInternalChapterPlanResponseJsonSchema([])).toThrow(PlannerContextError);
        expect(run).not.toHaveBeenCalled();
    });

    it('returns NO_ALLOWED_POV without a provider call or Canon mutation', async () => {
        const privateStory = 'PRIVATE_LOCKED_POV_STORY_SENTINEL';
        const privateSecret = 'PRIVATE_LOCKED_POV_SECRET_SENTINEL';
        let providerCalls = 0;
        const seed = createV4ProjectSeed({
            kind: 'story-blueprint-document',
            formatVersion: 1,
            blueprint: {
                id: 'no-pov-story',
                engine: { plannedChapterCount: 2 },
                characters: [{ id: 'hero', name: privateStory, availableFromChapter: 1 }],
                arcs: [{ id: 'arc', title: 'Arc', startChapter: 1, endChapter: 2 }],
                gates: { pov: [{ id: 'hero-pov', characterId: 'hero', allowedFromChapter: 2 }] },
                authorOnlySecrets: [{ id: 'secret', value: privateSecret }],
            },
        });
        const stateBefore = structuredClone(seed.state);
        const memoryBefore = structuredClone(seed.memory);
        const runtime = createGeminiProductionStoryRuntime({
            availableModelIds: ['gemini-3.7-flash'],
            runnerDependencies: {
                smartExecution: async (candidates, operation) => operation(candidates[0]),
                getAiClient: () => ({ models: { generateContent: async () => {
                    providerCalls += 1;
                    return { text: '{}' } as GenerateContentResponse;
                } } }),
            },
        });

        let caught: unknown;
        try {
            await runtime.planProductionChapter({ control: seed.control, state: seed.state, memoryState: seed.memory });
        } catch (error) {
            caught = error;
        }
        expect(caught).toMatchObject({ code: 'NO_ALLOWED_POV', stage: 'planning', role: 'planner' });
        expect(getSafeStoryStudioRuntimeDiagnostic(caught)).toEqual({
            code: 'NO_ALLOWED_POV', stage: 'planning', role: 'planner',
        });
        expect(providerCalls).toBe(0);
        expect(seed.state).toEqual(stateBefore);
        expect(seed.memory).toEqual(memoryBefore);
        const serialized = JSON.stringify({ caught, diagnostic: getSafeStoryStudioRuntimeDiagnostic(caught) });
        expect(serialized).not.toContain(privateStory);
        expect(serialized).not.toContain(privateSecret);
    });

    it('sends each dedicated schema only on its matching SDK request', async () => {
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
        await models.planner.plan(plannerPromptContext());
        await models.writer.write({ kind: 'writer-model-request', prompt: 'WRITER' } as never);
        await models.semanticValidator.validate({ prompt: 'VALIDATOR', context: {}, candidate: {} } as never);
        await models.repair.repair({ prompt: 'REPAIR', context: {} } as never);
        await models.stateExtractor.extract(extractorRequest());

        expect(configs[0]).toMatchObject({ responseJsonSchema: plannerSchema() });
        configs.slice(1, 4).forEach(config => expect(config).not.toHaveProperty('responseJsonSchema'));
        expect(configs[4]).toMatchObject({ responseJsonSchema: buildStoryStateDeltaResponseJsonSchema(1, 0) });
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
        await adapters.planner.plan(plannerPromptContext());
        await adapters.writer.write({ kind: 'writer-model-request', prompt: 'WRITER_ONLY', context: { hidden: 'not serialized separately' } } as never);
        await adapters.semanticValidator.validate({ prompt: 'VALIDATE', context: { privileged: 'SECRET_EVIDENCE' }, candidate: { prose: 'chapter' } } as never);
        await adapters.repair.repair({ prompt: 'REPAIR', context: { safe: 'ISSUE_SAFE' } } as never);
        await adapters.stateExtractor.extract({
            ...extractorRequest(),
            context: { ...extractorRequest().context, safe: 'EXTRACTION_SAFE' },
        } as StateExtractorModelRequest);

        expect(captures.get('planner')).toContain('CONTEXT:');
        expect(captures.get('writer')).toBe('WRITER_ONLY');
        expect(JSON.parse(captures.get('semanticValidator')!)).toEqual({ prompt: 'VALIDATE', context: { privileged: 'SECRET_EVIDENCE' }, candidate: { prose: 'chapter' } });
        expect(JSON.parse(captures.get('repair')!)).toEqual({ prompt: 'REPAIR', context: { safe: 'ISSUE_SAFE' } });
        expect(JSON.parse(captures.get('stateExtractor')!)).toEqual({
            prompt: 'EXTRACT',
            context: { targetChapter: 1, baseRevision: 0, safe: 'EXTRACTION_SAFE' },
            candidate: { prose: 'chapter' },
        });
        expect(captures.get('repair')).not.toContain('SECRET_EVIDENCE');
        expect(captures.get('stateExtractor')).not.toContain('SECRET_EVIDENCE');
        expect(schemaCaptures.get('planner')).toEqual(plannerSchema());
        expect(schemaCaptures.get('stateExtractor')).toEqual(buildStoryStateDeltaResponseJsonSchema(1, 0));
        expect(['writer', 'semanticValidator', 'repair'].every(role => schemaCaptures.get(role) === undefined)).toBe(true);
    });

    it.each([
        [1, 0],
        [37, 36],
    ])('builds the exact compact StateDelta cursor schema for C%s/rev%s', (chapterNumber, expectedRevision) => {
        const schema = buildStoryStateDeltaResponseJsonSchema(chapterNumber, expectedRevision);
        expect(schema.properties.kind).toEqual({ type: 'string', enum: ['story-state-delta'] });
        expect(schema.properties.schemaVersion).toEqual({ type: 'integer', enum: [2] });
        expect(schema.properties.chapterNumber).toEqual({ type: 'integer', enum: [chapterNumber] });
        expect(schema.properties.expectedRevision).toEqual({ type: 'integer', enum: [expectedRevision] });
        expect(schema.required).toEqual([
            'kind', 'schemaVersion', 'chapterNumber', 'expectedRevision',
            ...STORY_STATE_DELTA_V2_OPERATION_FIELDS,
        ]);
        expect(schema.properties.factChanges).toEqual({
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'text', 'establishedChapter', 'visibility', 'status', 'provenance'],
                properties: {
                    id: { type: 'string' },
                    text: { type: 'string' },
                    establishedChapter: { type: 'integer', enum: [chapterNumber] },
                    visibility: { type: 'string', enum: ['writer'] },
                    status: { type: 'string', enum: ['active'] },
                    provenance: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['sourceChapter', 'sourceType'],
                        properties: {
                            sourceChapter: { type: 'integer', enum: [chapterNumber] },
                            sourceType: { type: 'string', enum: ['chapter'] },
                            sourceId: { type: 'string' },
                        },
                    },
                },
            },
        });
        STORY_STATE_DELTA_V2_OPERATION_FIELDS.filter(field => field !== 'factChanges').forEach(field => {
            expect(schema.properties[field]).toEqual({
                type: 'array', items: { type: 'object', additionalProperties: true },
            });
        });
    });

    it('passes the per-request StateDelta cursor schema through the specialized extractor adapter', async () => {
        let captured: Parameters<GeminiStoryEngineGenerationRuntime['run']>[0] | undefined;
        const runtime: GeminiStoryEngineGenerationRuntime = {
            async run(request) {
                captured = request;
                return { value: {}, selectedModelId: 'gemini-state-extractor' };
            },
        };
        const adapter = createGeminiStoryEngineAdapters(runtime).stateExtractor;
        await adapter.extract(extractorRequest(37, 36));
        expect(captured).toMatchObject({
            role: 'stateExtractor', responseJsonSchema: buildStoryStateDeltaResponseJsonSchema(37, 36),
        });
        expect((adapter as typeof adapter & { getLastSelectedModelId(): string | undefined })
            .getLastSelectedModelId()).toBe('gemini-state-extractor');
    });

    it.each([
        ['mismatched target chapter', extractorRequest(2, 1, 3)],
        ['non-positive chapter', extractorRequest(0, 0, 0)],
        ['negative base revision', extractorRequest(1, -1)],
    ])('fails closed before runtime.run for an invalid extractor cursor: %s', async (_label, request) => {
        const run = vi.fn<GeminiStoryEngineGenerationRuntime['run']>();
        await expect(createGeminiStoryEngineAdapters({ run }).stateExtractor.extract(request))
            .rejects.toEqual(expect.objectContaining({
                name: 'StoryEngineModelRuntimeError', role: 'stateExtractor',
            }));
        expect(run).not.toHaveBeenCalled();
    });

    it('keeps the StateDelta envelope schema provider-compatible and well below its maintenance budget', () => {
        const schema = buildStoryStateDeltaResponseJsonSchema(37, 36);
        expect(auditGeminiResponseSchema(schema)).toEqual([]);
        const serialized = JSON.stringify(schema);
        ['oneOf', 'anyOf', 'allOf', 'const', 'pattern', 'minLength'].forEach(keyword => {
            expect(serialized).not.toContain(`"${keyword}"`);
        });
        const complexity = measureGeminiResponseSchemaComplexity(schema);
        expect(complexity).toMatchObject({
            hasObjectCycle: false, hasReferenceCycle: false, definitionCount: 0,
        });
        // Conservative internal maintenance budget, not a claimed Google API hard limit.
        expect(complexity.schemaNodeCount).toBeLessThanOrEqual(40);
        expect(complexity.maxDepth).toBeLessThanOrEqual(5);
        expect(complexity.serializedBytes).toBeLessThanOrEqual(4_000);
    });

    it('keeps the Planner provider schema inside the supported Gemini subset', () => {
        const schema = plannerSchema();
        expect(auditGeminiResponseSchema(schema)).toEqual([]);
        const serialized = JSON.stringify(schema);
        [
            'minLength', 'maxLength', 'pattern', 'const', 'uniqueItems', 'allOf',
            'not', 'if', 'then', 'else', 'dependentRequired',
        ].forEach(keyword => expect(serialized).not.toContain(`"${keyword}"`));
    });

    it('keeps Planner scene enums derived exactly from runtime constants', () => {
        const scene = plannerSchema().$defs.scene;
        expect(scene.properties.purposeTags.items.enum).toEqual([...SCENE_PURPOSE_TAGS]);
        expect(scene.properties.conflictImportance.enum).toEqual([...CONFLICT_IMPORTANCE]);
    });

    it('strongly describes core Planner objects but keeps deep domain actions generic', () => {
        const schema = plannerSchema();
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
        expect(schema.properties.strategicActions).toEqual({
            type: 'array', items: { $ref: '#/$defs/genericDomainAction' },
        });
        expect(schema.properties.relationshipActions).toEqual({
            type: 'array', items: { $ref: '#/$defs/genericDomainAction' },
        });
        expect(schema.$defs.genericDomainAction).toEqual({ type: 'object', additionalProperties: true });
        expect(Object.keys(schema.$defs)).not.toEqual(expect.arrayContaining([
            'politicalAction', 'militaryAction', 'commerceAction', 'relationshipAction',
        ]));
    });

    it('stays under the documented internal Planner schema maintenance budget', () => {
        const realisticPovIds = Array.from({ length: 64 }, (_, index) => `character-${index + 1}`);
        const schema = buildInternalChapterPlanResponseJsonSchema(realisticPovIds);
        const serialized = JSON.stringify(schema);
        expect(serialized).not.toContain('"oneOf"');
        expect(serialized).not.toContain('"anyOf"');
        const complexity = measureGeminiResponseSchemaComplexity(schema);
        expect(complexity).toMatchObject({ hasObjectCycle: false, hasReferenceCycle: false });
        // Conservative internal maintenance budget, not a claimed Google API hard limit.
        expect(complexity.schemaNodeCount).toBeLessThanOrEqual(90);
        expect(complexity.maxDepth).toBeLessThanOrEqual(5);
        expect(complexity.definitionCount).toBeLessThanOrEqual(10);
        expect(complexity.serializedBytes).toBeLessThanOrEqual(10_000);
    });
});
