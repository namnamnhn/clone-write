import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import {
    GEMINI_BRIDGE_GENERATE_PATH,
    GEMINI_BRIDGE_STREAM_PATH,
    type GeminiBridgeApiStatus,
    type GeminiBridgeErrorPayload,
    type GeminiBridgeRequestPayload,
    type GeminiBridgeResponsePayload,
} from './geminiBridgeProtocol';

declare const __GEMINI_SERVER_BRIDGE__: boolean | undefined;

export const isGeminiServerBridgeEnabled = (): boolean =>
    typeof __GEMINI_SERVER_BRIDGE__ !== 'undefined' && __GEMINI_SERVER_BRIDGE__ === true;

export class GeminiBridgeRequestError extends Error {
    readonly status: number;
    readonly apiStatus?: GeminiBridgeApiStatus;
    readonly statusText?: GeminiBridgeApiStatus;

    constructor(status: number, apiStatus?: GeminiBridgeApiStatus) {
        super(`Gemini bridge request failed (${status}${apiStatus ? ` ${apiStatus}` : ''})`);
        this.name = 'GeminiBridgeRequestError';
        this.status = status;
        this.apiStatus = apiStatus;
        this.statusText = apiStatus;
    }
}

type FetchLike = typeof fetch;

const splitRequest = (request: GenerateContentParameters): {
    payload: GeminiBridgeRequestPayload['request'];
    signal?: AbortSignal;
} => {
    const config = request.config as (Record<string, unknown> & { abortSignal?: AbortSignal }) | undefined;
    if (!config) {
        return {
            payload: {
                model: request.model,
                contents: request.contents,
            },
        };
    }
    const { abortSignal, ...serializableConfig } = config;
    return {
        payload: {
            model: request.model,
            contents: request.contents,
            config: serializableConfig,
        },
        signal: abortSignal,
    };
};

const readSafeError = async (response: Response): Promise<GeminiBridgeRequestError> => {
    try {
        const payload = await response.json() as GeminiBridgeErrorPayload;
        if (payload?.error?.code === 'GEMINI_BRIDGE_REQUEST_FAILED') {
            return new GeminiBridgeRequestError(payload.error.httpStatus, payload.error.apiStatus);
        }
    } catch {
        // The bridge deliberately never forwards a provider response body. A malformed
        // bridge error therefore collapses to the HTTP status only.
    }
    return new GeminiBridgeRequestError(response.status || 500);
};

const hydrateResponse = (value: Readonly<Record<string, unknown>>): GenerateContentResponse =>
    value as unknown as GenerateContentResponse;

const parseResponsePayload = (raw: string): GeminiBridgeResponsePayload => {
    try {
        const parsed = JSON.parse(raw) as GeminiBridgeResponsePayload;
        if (!parsed || typeof parsed !== 'object' || !parsed.response || typeof parsed.response !== 'object') {
            throw new Error('INVALID_BRIDGE_RESPONSE');
        }
        return parsed;
    } catch {
        throw new GeminiBridgeRequestError(502);
    }
};

const createPayload = (
    request: GenerateContentParameters,
    personalApiKey: string | undefined,
): { body: string; signal?: AbortSignal } => {
    const { payload, signal } = splitRequest(request);
    const bridgePayload: GeminiBridgeRequestPayload = {
        request: payload,
        ...(personalApiKey ? { personalApiKey } : {}),
    };
    return { body: JSON.stringify(bridgePayload), signal };
};

const decodeNdjsonStream = async function* (
    response: Response,
): AsyncGenerator<GenerateContentResponse> {
    if (!response.body) throw new GeminiBridgeRequestError(502);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            buffered += decoder.decode(value, { stream: !done });
            let newline = buffered.indexOf('\n');
            while (newline >= 0) {
                const line = buffered.slice(0, newline).trim();
                buffered = buffered.slice(newline + 1);
                if (line) {
                    const payload = parseResponsePayload(line);
                    yield hydrateResponse(payload.response);
                }
                newline = buffered.indexOf('\n');
            }
            if (done) break;
        }
        const trailing = buffered.trim();
        if (trailing) {
            const payload = parseResponsePayload(trailing);
            yield hydrateResponse(payload.response);
        }
    } finally {
        reader.releaseLock();
    }
};

export const createGeminiServerBridgeClient = (
    personalApiKey?: string,
    fetchImpl: FetchLike = fetch,
) => ({
    models: {
        generateContent: async (request: GenerateContentParameters): Promise<GenerateContentResponse> => {
            const { body, signal } = createPayload(request, personalApiKey);
            const response = await fetchImpl(GEMINI_BRIDGE_GENERATE_PATH, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                signal,
            });
            if (!response.ok) throw await readSafeError(response);
            const payload = parseResponsePayload(await response.text());
            return hydrateResponse(payload.response);
        },
        generateContentStream: async (request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> => {
            const { body, signal } = createPayload(request, personalApiKey);
            const response = await fetchImpl(GEMINI_BRIDGE_STREAM_PATH, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                signal,
            });
            if (!response.ok) throw await readSafeError(response);
            return decodeNdjsonStream(response);
        },
    },
});

export const serializeGeminiBridgeRequestForTest = (
    request: GenerateContentParameters,
    personalApiKey?: string,
): string => createPayload(request, personalApiKey).body;
