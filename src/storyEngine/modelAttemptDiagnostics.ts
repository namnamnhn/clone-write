export const MODEL_ATTEMPT_OUTCOME_KINDS = [
    'SUCCESS',
    'REQUEST_TIMEOUT',
    'RATE_LIMIT_429',
    'SERVER_5XX',
    'PERMISSION_403',
    'INVALID_REQUEST_400',
    'CANCELLED',
    'EMPTY_RESPONSE',
    'MALFORMED_JSON',
    'SAFETY_BLOCK',
    'UNKNOWN_PROVIDER_FAILURE',
] as const;

export type ModelAttemptOutcomeKind = typeof MODEL_ATTEMPT_OUTCOME_KINDS[number];

export const SAFE_STORY_ENGINE_V4_MODEL_IDS = [
    'gemini-3.1-pro-preview',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
] as const;

export const MAX_SAFE_MODEL_ATTEMPTS = 12;
export const MAX_SAFE_MODEL_ATTEMPT_ELAPSED_MS = 600_000;
export const MAX_SAFE_MODEL_ATTEMPT_COUNT = 99;

export const SAFE_GEMINI_API_STATUSES = [
    'ABORTED',
    'CANCELLED',
    'DATA_LOSS',
    'DEADLINE_EXCEEDED',
    'FAILED_PRECONDITION',
    'INTERNAL',
    'INVALID_ARGUMENT',
    'PERMISSION_DENIED',
    'RESOURCE_EXHAUSTED',
    'UNAVAILABLE',
    'UNKNOWN',
] as const;

export type SafeGeminiApiStatus = typeof SAFE_GEMINI_API_STATUSES[number];

export interface SafeModelAttemptOutcome {
    readonly modelId: string;
    readonly outcomeKind: ModelAttemptOutcomeKind;
    readonly httpStatus?: number;
    readonly apiStatus?: SafeGeminiApiStatus;
    readonly elapsedMs?: number;
    readonly attemptCount?: number;
}

const OUTCOME_KINDS = new Set<string>(MODEL_ATTEMPT_OUTCOME_KINDS);
const API_STATUSES = new Set<string>(SAFE_GEMINI_API_STATUSES);
const MODEL_IDS = new Set<string>(SAFE_STORY_ENGINE_V4_MODEL_IDS);

const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;

export const sanitizeSafeModelAttemptOutcome = (
    value: unknown,
): SafeModelAttemptOutcome | undefined => {
    const source = record(value);
    if (!source || typeof source.modelId !== 'string' || !MODEL_IDS.has(source.modelId)
        || typeof source.outcomeKind !== 'string' || !OUTCOME_KINDS.has(source.outcomeKind)) return undefined;
    const httpStatus = typeof source.httpStatus === 'number' && Number.isSafeInteger(source.httpStatus)
        && (source.httpStatus === 400 || source.httpStatus === 403 || source.httpStatus === 429
            || (source.httpStatus >= 500 && source.httpStatus <= 599))
        ? source.httpStatus : undefined;
    const apiStatus = typeof source.apiStatus === 'string' && API_STATUSES.has(source.apiStatus)
        ? source.apiStatus as SafeGeminiApiStatus : undefined;
    const elapsedMs = typeof source.elapsedMs === 'number' && Number.isFinite(source.elapsedMs) && source.elapsedMs >= 0
        ? Math.min(MAX_SAFE_MODEL_ATTEMPT_ELAPSED_MS, Math.trunc(source.elapsedMs)) : undefined;
    const attemptCount = typeof source.attemptCount === 'number' && Number.isFinite(source.attemptCount) && source.attemptCount >= 1
        ? Math.min(MAX_SAFE_MODEL_ATTEMPT_COUNT, Math.trunc(source.attemptCount)) : undefined;
    return {
        modelId: source.modelId,
        outcomeKind: source.outcomeKind as ModelAttemptOutcomeKind,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(apiStatus === undefined ? {} : { apiStatus }),
        ...(elapsedMs === undefined ? {} : { elapsedMs }),
        ...(attemptCount === undefined ? {} : { attemptCount }),
    };
};

export const sanitizeSafeModelAttemptOutcomes = (
    value: unknown,
): readonly SafeModelAttemptOutcome[] => Array.isArray(value)
    ? value.slice(0, MAX_SAFE_MODEL_ATTEMPTS)
        .map(sanitizeSafeModelAttemptOutcome)
        .filter((entry): entry is SafeModelAttemptOutcome => entry !== undefined)
    : [];
