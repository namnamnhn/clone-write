export const GEMINI_BRIDGE_GENERATE_PATH = '/api/gemini/v1/generate-content';
export const GEMINI_BRIDGE_STREAM_PATH = '/api/gemini/v1/generate-content-stream';

export const GEMINI_BRIDGE_API_STATUSES = [
    'INVALID_ARGUMENT',
    'RESOURCE_EXHAUSTED',
    'UNAVAILABLE',
    'PERMISSION_DENIED',
    'DEADLINE_EXCEEDED',
    'CANCELLED',
    'INTERNAL',
] as const;

export type GeminiBridgeApiStatus = typeof GEMINI_BRIDGE_API_STATUSES[number];

export interface GeminiBridgeErrorPayload {
    readonly error: {
        readonly code: 'GEMINI_BRIDGE_REQUEST_FAILED';
        readonly httpStatus: number;
        readonly apiStatus?: GeminiBridgeApiStatus;
    };
}

export interface GeminiBridgeRequestPayload {
    readonly request: {
        readonly model: string;
        readonly contents: unknown;
        readonly config?: Readonly<Record<string, unknown>>;
    };
    readonly personalApiKey?: string;
}

export interface GeminiBridgeResponsePayload {
    readonly response: Readonly<Record<string, unknown>>;
}

