import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
    GEMINI_BRIDGE_API_STATUSES,
    GEMINI_BRIDGE_GENERATE_PATH,
    GEMINI_BRIDGE_STREAM_PATH,
    type GeminiBridgeApiStatus,
    type GeminiBridgeErrorPayload,
    type GeminiBridgeRequestPayload,
    type GeminiBridgeResponsePayload,
} from '../src/services/api/geminiBridgeProtocol';

const MAX_BRIDGE_REQUEST_BYTES = 20 * 1024 * 1024;
const MODEL_ID_PATTERN = /^(?:gemini|gemma)-[a-z0-9][a-z0-9.-]*$/;
const API_STATUS_SET = new Set<string>(GEMINI_BRIDGE_API_STATUSES);

type Next = () => void;
type AiFactory = (apiKey: string) => {
    readonly models: {
        generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse>;
        generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>>;
    };
};

export interface GeminiBridgeDependencies {
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly createAi?: AiFactory;
}

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
    if (response.writableEnded || response.destroyed) return;
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(JSON.stringify(body));
};

const safeErrorPayload = (httpStatus: number, apiStatus?: GeminiBridgeApiStatus): GeminiBridgeErrorPayload => ({
    error: {
        code: 'GEMINI_BRIDGE_REQUEST_FAILED',
        httpStatus,
        ...(apiStatus ? { apiStatus } : {}),
    },
});

const finiteHttpStatus = (value: unknown): number | undefined => {
    const numeric = typeof value === 'number' ? value : Number.NaN;
    return Number.isInteger(numeric) && numeric >= 400 && numeric <= 599 ? numeric : undefined;
};

const allowlistedApiStatus = (value: unknown): GeminiBridgeApiStatus | undefined =>
    typeof value === 'string' && API_STATUS_SET.has(value)
        ? value as GeminiBridgeApiStatus
        : undefined;

export const normalizeGeminiBridgeError = (error: unknown): {
    readonly httpStatus: number;
    readonly apiStatus?: GeminiBridgeApiStatus;
} => {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === 'object'
        ? record.error as Record<string, unknown>
        : {};
    let httpStatus = finiteHttpStatus(record.status)
        ?? finiteHttpStatus(record.statusCode)
        ?? finiteHttpStatus(record.code)
        ?? finiteHttpStatus(nested.code);
    let apiStatus = allowlistedApiStatus(record.apiStatus)
        ?? allowlistedApiStatus(record.statusText)
        ?? allowlistedApiStatus(nested.status);

    // Some SDK errors expose only a provider-formatted message. Extract closed tokens
    // for classification, then discard the message completely.
    const message = typeof record.message === 'string' ? record.message : '';
    if (!apiStatus) {
        apiStatus = GEMINI_BRIDGE_API_STATUSES.find(status => message.includes(status));
    }
    if (!httpStatus) {
        const statusMatch = message.match(/(?:^|\D)(400|403|408|429|5\d\d)(?:\D|$)/);
        httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
    }
    if (!httpStatus) {
        if (apiStatus === 'INVALID_ARGUMENT') httpStatus = 400;
        else if (apiStatus === 'PERMISSION_DENIED') httpStatus = 403;
        else if (apiStatus === 'RESOURCE_EXHAUSTED') httpStatus = 429;
        else if (apiStatus === 'UNAVAILABLE') httpStatus = 503;
        else if (apiStatus === 'DEADLINE_EXCEEDED') httpStatus = 504;
        else if (apiStatus === 'CANCELLED') httpStatus = 499;
        else httpStatus = 502;
    }
    return { httpStatus, ...(apiStatus ? { apiStatus } : {}) };
};

const readBody = async (request: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > MAX_BRIDGE_REQUEST_BYTES) throw new Error('BRIDGE_BODY_TOO_LARGE');
        chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export const isSupportedGeminiApiModelId = (value: unknown): value is string =>
    typeof value === 'string' && MODEL_ID_PATTERN.test(value);

const parsePayload = (raw: string): GeminiBridgeRequestPayload | undefined => {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (!isRecord(value) || !isRecord(value.request)) return undefined;
    const request = value.request;
    if (!isSupportedGeminiApiModelId(request.model)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(request, 'contents')) return undefined;
    if (request.config !== undefined && !isRecord(request.config)) return undefined;
    if (value.personalApiKey !== undefined && (typeof value.personalApiKey !== 'string' || value.personalApiKey.length === 0 || value.personalApiKey.length > 512)) {
        return undefined;
    }
    return value as unknown as GeminiBridgeRequestPayload;
};

const serializeResponse = (response: GenerateContentResponse): GeminiBridgeResponsePayload => {
    const text = response.candidates?.[0]?.content?.parts
        ?.filter(part => typeof part.text === 'string' && part.thought !== true)
        .map(part => part.text)
        .join('');
    return {
        response: {
            ...(response.candidates === undefined ? {} : { candidates: response.candidates }),
            ...(response.createTime === undefined ? {} : { createTime: response.createTime }),
            ...(response.automaticFunctionCallingHistory === undefined ? {} : { automaticFunctionCallingHistory: response.automaticFunctionCallingHistory }),
            ...(response.modelVersion === undefined ? {} : { modelVersion: response.modelVersion }),
            ...(response.promptFeedback === undefined ? {} : { promptFeedback: response.promptFeedback }),
            ...(response.responseId === undefined ? {} : { responseId: response.responseId }),
            ...(response.usageMetadata === undefined ? {} : { usageMetadata: response.usageMetadata }),
            ...(response.modelStatus === undefined ? {} : { modelStatus: response.modelStatus }),
            ...(text === undefined ? {} : { text }),
        },
    };
};

const getRequestPath = (request: IncomingMessage): string => {
    try {
        return new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
        return '/';
    }
};

export const createGeminiBridgeMiddleware = (
    dependencies: GeminiBridgeDependencies = {},
) => {
    const environment = dependencies.environment ?? process.env;
    const createAi = dependencies.createAi ?? ((apiKey: string) => new GoogleGenAI({ apiKey }));

    return async (request: IncomingMessage, response: ServerResponse, next: Next = () => undefined): Promise<void> => {
        const path = getRequestPath(request);
        const isGenerate = path === GEMINI_BRIDGE_GENERATE_PATH;
        const isStream = path === GEMINI_BRIDGE_STREAM_PATH;
        if (!isGenerate && !isStream) {
            next();
            return;
        }
        if (request.method !== 'POST') {
            sendJson(response, 405, safeErrorPayload(405));
            return;
        }

        let payload: GeminiBridgeRequestPayload | undefined;
        try {
            payload = parsePayload(await readBody(request));
        } catch {
            sendJson(response, 413, safeErrorPayload(413));
            return;
        }
        if (!payload) {
            sendJson(response, 400, safeErrorPayload(400, 'INVALID_ARGUMENT'));
            return;
        }

        const apiKey = payload.personalApiKey || environment.GEMINI_API_KEY;
        if (!apiKey) {
            sendJson(response, 503, safeErrorPayload(503));
            return;
        }

        const abortController = new AbortController();
        const onAborted = (): void => abortController.abort();
        const onClosed = (): void => {
            if (!response.writableEnded) abortController.abort();
        };
        request.once('aborted', onAborted);
        response.once('close', onClosed);

        const providerRequest: GenerateContentParameters = {
            model: payload.request.model,
            contents: payload.request.contents as GenerateContentParameters['contents'],
            ...(payload.request.config ? {
                config: {
                    ...payload.request.config,
                    abortSignal: abortController.signal,
                } as GenerateContentParameters['config'],
            } : {
                config: { abortSignal: abortController.signal },
            }),
        };

        try {
            const ai = createAi(apiKey);
            if (isGenerate) {
                const providerResponse = await ai.models.generateContent(providerRequest);
                sendJson(response, 200, serializeResponse(providerResponse));
                return;
            }

            const stream = await ai.models.generateContentStream(providerRequest);
            if (response.writableEnded || response.destroyed) return;
            response.statusCode = 200;
            response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
            response.setHeader('cache-control', 'no-store');
            for await (const chunk of stream) {
                if (abortController.signal.aborted || response.destroyed) break;
                response.write(`${JSON.stringify(serializeResponse(chunk))}\n`);
            }
            if (!response.writableEnded && !response.destroyed) response.end();
        } catch (error) {
            if (abortController.signal.aborted || response.destroyed) return;
            const normalized = normalizeGeminiBridgeError(error);
            sendJson(response, normalized.httpStatus, safeErrorPayload(normalized.httpStatus, normalized.apiStatus));
        } finally {
            request.off('aborted', onAborted);
            response.off('close', onClosed);
        }
    };
};
