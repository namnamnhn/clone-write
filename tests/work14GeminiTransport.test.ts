import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import {
    createGeminiBridgeMiddleware,
    isSupportedGeminiApiModelId,
    normalizeGeminiBridgeError,
} from '../server/geminiBridge';
import { resolveGeminiTransportMode } from '../server/geminiBridgeMode';
import {
    createGeminiServerBridgeClient,
    GeminiBridgeRequestError,
    serializeGeminiBridgeRequestForTest,
} from '../src/services/api/geminiTransport';
import { GEMINI_BRIDGE_GENERATE_PATH } from '../src/services/api/geminiBridgeProtocol';
import { classifyGeminiV4Failure } from '../src/services/storyEngine/geminiV4AttemptOutcomes';
import { IS_LITE } from '../src/constants';

const servers: Server[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/services/api/geminiTransport');
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

const startBridge = async (
    createAi: Parameters<typeof createGeminiBridgeMiddleware>[0]['createAi'],
    environment: Record<string, string | undefined> = { GEMINI_API_KEY: 'SERVER_SECRET_SENTINEL' },
): Promise<string> => {
    const middleware = createGeminiBridgeMiddleware({ createAi, environment });
    const server = createServer((request, response) => {
        void middleware(request, response, () => {
            response.statusCode = 404;
            response.end();
        });
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
};

const textResponse = (text: string): GenerateContentResponse => ({
    candidates: [{ content: { role: 'model', parts: [{ text }] } }],
    text,
} as unknown as GenerateContentResponse);

describe('WORK14 Gemini transport selection', () => {
    it.each([
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemma-4-31b-it',
        'gemma-4-26b-a4b-it',
    ])('accepts supported Google Gemini API model ID %s', modelId => {
        expect(isSupportedGeminiApiModelId(modelId)).toBe(true);
    });

    it.each([
        'deepseek:deepseek-chat',
        'deepseek-chat',
        'openrouter/google/gemini',
        'untrusted-model',
        '../gemini-3.7-flash',
        'gemma_4_31b_it',
        '',
    ])('rejects non-Google or untrusted model ID %s', modelId => {
        expect(isSupportedGeminiApiModelId(modelId)).toBe(false);
    });

    it('keeps local Vite direct by default and selects the server bridge from explicit/server-secret configuration', () => {
        expect(resolveGeminiTransportMode({})).toBe('direct');
        expect(resolveGeminiTransportMode({ GEMINI_TRANSPORT_MODE: 'direct', GEMINI_API_KEY: 'secret' })).toBe('direct');
        expect(resolveGeminiTransportMode({ GEMINI_TRANSPORT_MODE: 'server' })).toBe('server');
        expect(resolveGeminiTransportMode({ GEMINI_API_KEY: 'server-only-secret' })).toBe('server');
    });

    it('preserves responseJsonSchema and excludes AbortSignal from hosted request JSON', () => {
        const signal = new AbortController().signal;
        const serialized = serializeGeminiBridgeRequestForTest({
            model: 'gemini-3.7-flash',
            contents: 'AUTHOR_SETUP_SENTINEL',
            config: {
                temperature: 0.1,
                responseMimeType: 'application/json',
                responseJsonSchema: {
                    type: 'object',
                    required: ['kind'],
                    properties: { kind: { type: 'string', enum: ['story-blueprint-document'] } },
                },
                safetySettings: [],
                abortSignal: signal,
            },
        });
        const parsed = JSON.parse(serialized);
        expect(parsed.request.config.responseJsonSchema.properties.kind.enum).toEqual(['story-blueprint-document']);
        expect(parsed.request.config.responseMimeType).toBe('application/json');
        expect(parsed.request.config.temperature).toBe(0.1);
        expect(serialized).not.toContain('abortSignal');
    });

    it('uses server default without serializing it and sends a personal key only in that one request', () => {
        const request = { model: 'gemini-3.5-flash', contents: 'Hi' } as GenerateContentParameters;
        const defaultBody = serializeGeminiBridgeRequestForTest(request);
        const personalBody = serializeGeminiBridgeRequestForTest(request, 'PERSONAL_KEY_SENTINEL');
        expect(defaultBody).not.toContain('GEMINI_API_KEY');
        expect(defaultBody).not.toContain('personalApiKey');
        expect(personalBody).toContain('PERSONAL_KEY_SENTINEL');
    });

    it('keeps the hosted server credential and personal credentials in the same rotating key pool', async () => {
        if (IS_LITE) return;
        const createHostedClient = vi.fn<(personalApiKey?: string) => { models: Record<string, never> }>(() => ({ models: {} }));
        vi.doMock('../src/services/api/geminiTransport', () => ({
            isGeminiServerBridgeEnabled: () => true,
            createGeminiServerBridgeClient: createHostedClient,
        }));
        vi.resetModules();
        const originalKey = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;
        try {
            const gemini = await import('../src/services/api/gemini');
            gemini.setUserGeminiKeys('PERSONAL_KEY_ONE_1111\nPERSONAL_KEY_TWO_2222');
            expect(gemini.getGeminiKeyPoolForUi().map(entry => ({
                isDefault: entry.isDefault,
                maskedTail: entry.maskedTail,
            }))).toEqual([
                { isDefault: true, maskedTail: 'srv0' },
                { isDefault: false, maskedTail: '1111' },
                { isDefault: false, maskedTail: '2222' },
            ]);
            gemini.getAiClient();
            gemini.getAiClient();
            gemini.getAiClient();
            expect(createHostedClient.mock.calls.map(call => call[0])).toEqual([
                undefined,
                'PERSONAL_KEY_ONE_1111',
                'PERSONAL_KEY_TWO_2222',
            ]);
        } finally {
            if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
            else process.env.GEMINI_API_KEY = originalKey;
        }
    });
});

describe('WORK14 same-origin Node bridge', () => {
    it('forwards a supported Gemma request without altering its model ID', async () => {
        const observedModels: string[] = [];
        const baseUrl = await startBridge(() => ({
            models: {
                generateContent: async request => {
                    observedModels.push(request.model);
                    return textResponse('gemma response');
                },
                generateContentStream: async () => (async function* () { /* unused */ })(),
            },
        }));
        const response = await fetch(`${baseUrl}${GEMINI_BRIDGE_GENERATE_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                request: { model: 'gemma-4-31b-it', contents: 'Hi' },
            }),
        });
        expect(response.status).toBe(200);
        expect(observedModels).toEqual(['gemma-4-31b-it']);
        expect(await response.text()).toContain('gemma response');
    });

    it.each([
        'deepseek:deepseek-chat',
        'untrusted-model',
    ])('rejects unsupported hosted model %s before provider execution', async modelId => {
        const createAi = vi.fn(() => ({
            models: {
                generateContent: async () => textResponse('must not run'),
                generateContentStream: async () => (async function* () { /* unused */ })(),
            },
        }));
        const baseUrl = await startBridge(createAi);
        const response = await fetch(`${baseUrl}${GEMINI_BRIDGE_GENERATE_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ request: { model: modelId, contents: 'Hi' } }),
        });
        expect(response.status).toBe(400);
        expect(createAi).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({
            error: {
                code: 'GEMINI_BRIDGE_REQUEST_FAILED',
                httpStatus: 400,
                apiStatus: 'INVALID_ARGUMENT',
            },
        });
    });

    it('uses the server secret in memory and never returns either server or personal keys', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const observedKeys: string[] = [];
        const baseUrl = await startBridge(apiKey => {
            observedKeys.push(apiKey);
            return {
                models: {
                    generateContent: async () => textResponse('safe response'),
                    generateContentStream: async () => (async function* () { yield textResponse('safe stream'); })(),
                },
            };
        });

        const serverResult = await fetch(`${baseUrl}${GEMINI_BRIDGE_GENERATE_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ request: { model: 'gemini-3.5-flash', contents: 'Hi' } }),
        });
        const personalResult = await fetch(`${baseUrl}${GEMINI_BRIDGE_GENERATE_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                request: { model: 'gemini-3.5-flash', contents: 'Hi' },
                personalApiKey: 'PERSONAL_KEY_SENTINEL',
            }),
        });
        const serializedResponses = `${await serverResult.text()}${await personalResult.text()}`;
        expect(observedKeys).toEqual(['SERVER_SECRET_SENTINEL', 'PERSONAL_KEY_SENTINEL']);
        expect(serializedResponses).not.toContain('SERVER_SECRET_SENTINEL');
        expect(serializedResponses).not.toContain('PERSONAL_KEY_SENTINEL');
        expect(serializedResponses).toContain('safe response');
        expect(JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls])).not.toContain('KEY_SENTINEL');
    });

    it.each([
        [400, 'INVALID_ARGUMENT'],
        [403, 'PERMISSION_DENIED'],
        [429, 'RESOURCE_EXHAUSTED'],
        [503, 'UNAVAILABLE'],
        [504, 'DEADLINE_EXCEEDED'],
    ] as const)('normalizes provider %s/%s without returning its raw message', async (status, apiStatus) => {
        const rawSentinel = 'RAW_PROVIDER_MESSAGE_WITH_SECRET_SENTINEL';
        const baseUrl = await startBridge(() => ({
            models: {
                generateContent: async () => {
                    const error = new Error(`${status} ${apiStatus} ${rawSentinel}`) as Error & { status: number; statusText: string };
                    error.status = status;
                    error.statusText = apiStatus;
                    throw error;
                },
                generateContentStream: async () => (async function* () { /* unused */ })(),
            },
        }));
        const response = await fetch(`${baseUrl}${GEMINI_BRIDGE_GENERATE_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ request: { model: 'gemini-3.7-flash', contents: 'STORY_SENTINEL' } }),
        });
        const body = await response.text();
        expect(response.status).toBe(status);
        expect(JSON.parse(body).error).toEqual({
            code: 'GEMINI_BRIDGE_REQUEST_FAILED',
            httpStatus: status,
            apiStatus,
        });
        expect(body).not.toContain(rawSentinel);
        expect(body).not.toContain('STORY_SENTINEL');
    });

    it('relays stream chunks while keeping the official SDK response shape used by legacy translation', async () => {
        const baseUrl = await startBridge(() => ({
            models: {
                generateContent: async () => textResponse('unused'),
                generateContentStream: async () => (async function* () {
                    yield textResponse('first');
                    yield textResponse('second');
                })(),
            },
        }));
        const bridgeClient = createGeminiServerBridgeClient(undefined, (input, init) =>
            fetch(`${baseUrl}${String(input)}`, init));
        const stream = await bridgeClient.models.generateContentStream({ model: 'gemini-3.5-flash', contents: 'Hi' });
        const chunks: string[] = [];
        for await (const chunk of stream) chunks.push(chunk.text ?? '');
        expect(chunks).toEqual(['first', 'second']);
    });
});

describe('WORK14 safe client error and cancellation behavior', () => {
    it('maps only safe bridge status metadata into an SDK-compatible error', async () => {
        const providerSentinel = 'RAW_PROVIDER_SENTINEL';
        const client = createGeminiServerBridgeClient(undefined, async () => new Response(JSON.stringify({
            error: { code: 'GEMINI_BRIDGE_REQUEST_FAILED', httpStatus: 503, apiStatus: 'UNAVAILABLE' },
            ignored: providerSentinel,
        }), { status: 503, headers: { 'content-type': 'application/json' } }));
        const error = await client.models.generateContent({ model: 'gemini-3.7-flash', contents: 'Hi' }).catch(value => value);
        expect(error).toBeInstanceOf(GeminiBridgeRequestError);
        expect(error.status).toBe(503);
        expect(error.statusText).toBe('UNAVAILABLE');
        expect(JSON.stringify(error)).not.toContain(providerSentinel);
    });

    it.each([
        [400, 'INVALID_ARGUMENT', 'INVALID_REQUEST_400'],
        [403, 'PERMISSION_DENIED', 'PERMISSION_403'],
        [429, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_429'],
        [503, 'UNAVAILABLE', 'SERVER_5XX'],
    ] as const)('feeds bridge %s/%s into existing V4 classification as %s', (status, apiStatus, outcomeKind) => {
        expect(classifyGeminiV4Failure(new GeminiBridgeRequestError(status, apiStatus))).toMatchObject({
            outcomeKind,
            httpStatus: status,
            apiStatus,
        });
    });

    it('preserves AbortError so user cancellation and V4 deadlines retain current semantics', async () => {
        const controller = new AbortController();
        const client = createGeminiServerBridgeClient(undefined, async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
            }));
        const pending = client.models.generateContent({
            model: 'gemini-3.7-flash',
            contents: 'Hi',
            config: { abortSignal: controller.signal },
        });
        controller.abort();
        const error = await pending.catch(value => value);
        expect(error.name).toBe('AbortError');
    });

    it('collapses a malformed bridge success body without exposing its contents', async () => {
        const rawBody = 'RAW_AUTHOR_SECRET_AND_STORY_SENTINEL';
        const client = createGeminiServerBridgeClient(undefined, async () => new Response(rawBody, { status: 200 }));
        const error = await client.models.generateContent({ model: 'gemini-3.7-flash', contents: 'Hi' }).catch(value => value);
        expect(error).toBeInstanceOf(GeminiBridgeRequestError);
        expect(error.status).toBe(502);
        expect(JSON.stringify(error)).not.toContain(rawBody);
        expect(error.message).not.toContain(rawBody);
    });

    it('normalizes messages only into closed status metadata', () => {
        const safe = normalizeGeminiBridgeError(new Error('503 UNAVAILABLE RAW_SECRET_OR_PROMPT'));
        expect(safe).toEqual({ httpStatus: 503, apiStatus: 'UNAVAILABLE' });
        expect(JSON.stringify(safe)).not.toContain('RAW_SECRET_OR_PROMPT');
    });

    it('keeps server secrets out of V4 React components', () => {
        const sourceRoots = ['src/components', 'src/hooks'];
        const files = sourceRoots.flatMap(root => {
            const output = execFileSync('rg', ['--files', root], { encoding: 'utf8' });
            return output.trim().split(/\r?\n/).filter(file => /\.(ts|tsx)$/.test(file));
        });
        for (const file of files) {
            const source = readFileSync(path.resolve(file), 'utf8');
            expect(source, file).not.toContain('process.env.GEMINI_API_KEY');
        }
    });
});
