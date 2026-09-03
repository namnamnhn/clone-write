import {
    MAX_SAFE_MODEL_ATTEMPT_COUNT,
    MAX_SAFE_MODEL_ATTEMPT_ELAPSED_MS,
    MAX_SAFE_MODEL_ATTEMPTS,
    sanitizeSafeModelAttemptOutcome,
} from '../../storyEngine/modelAttemptDiagnostics';
import type {
    ModelAttemptOutcomeKind,
    SafeGeminiApiStatus,
    SafeModelAttemptOutcome,
} from '../../storyEngine/modelAttemptDiagnostics';
import { getGoogleApiErrorDetails, isGoogleServerError } from '../api/gemini';
import { isGeminiV4RequestTimeoutError } from './geminiV4RequestDeadline';

const SAFE_API_STATUSES = new Set<SafeGeminiApiStatus>([
    'ABORTED', 'CANCELLED', 'DATA_LOSS', 'DEADLINE_EXCEEDED', 'FAILED_PRECONDITION',
    'INTERNAL', 'INVALID_ARGUMENT', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED',
    'UNAVAILABLE', 'UNKNOWN',
]);

const safeApiStatus = (value: string | undefined): SafeGeminiApiStatus | undefined => {
    const normalized = value?.toUpperCase();
    return normalized && SAFE_API_STATUSES.has(normalized as SafeGeminiApiStatus)
        ? normalized as SafeGeminiApiStatus
        : undefined;
};

const safeHttpStatus = (value: number | undefined): number | undefined =>
    value === 400 || value === 403 || value === 429 || (value !== undefined && value >= 500 && value <= 599)
        ? value
        : undefined;

const rawMessageForClassification = (error: unknown): string => {
    if (!(error instanceof Error)) return '';
    return `${error.message} ${'statusText' in error && typeof error.statusText === 'string' ? error.statusText : ''}`.toLowerCase();
};

export interface ClassifiedGeminiV4Failure {
    readonly outcomeKind: Exclude<ModelAttemptOutcomeKind, 'SUCCESS' | 'EMPTY_RESPONSE' | 'MALFORMED_JSON'>;
    readonly httpStatus?: number;
    readonly apiStatus?: SafeGeminiApiStatus;
}

export const classifyGeminiV4Failure = (
    error: unknown,
    externallyCancelled = false,
): ClassifiedGeminiV4Failure => {
    const details = getGoogleApiErrorDetails(error);
    const numericStatus = safeHttpStatus(details.httpStatus ?? (typeof details.code === 'number' ? details.code : undefined));
    const apiStatus = safeApiStatus(details.status);
    const message = rawMessageForClassification(error);
    let outcomeKind: ClassifiedGeminiV4Failure['outcomeKind'];
    if (externallyCancelled || (error instanceof Error && (error.message === 'ABORTED' || error.name === 'AbortError'))) {
        outcomeKind = 'CANCELLED';
    } else if (isGeminiV4RequestTimeoutError(error)) {
        outcomeKind = 'REQUEST_TIMEOUT';
    } else if (numericStatus === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
        outcomeKind = 'RATE_LIMIT_429';
    } else if (message.includes('safety') || message.includes('blocklist')
        || message.includes('prohibited_content')) {
        outcomeKind = 'SAFETY_BLOCK';
    } else if ((numericStatus !== undefined && numericStatus >= 500) || isGoogleServerError(error)) {
        outcomeKind = 'SERVER_5XX';
    } else if (numericStatus === 403 || apiStatus === 'PERMISSION_DENIED') {
        outcomeKind = 'PERMISSION_403';
    } else if (numericStatus === 400 || apiStatus === 'INVALID_ARGUMENT') {
        outcomeKind = 'INVALID_REQUEST_400';
    } else {
        outcomeKind = 'UNKNOWN_PROVIDER_FAILURE';
    }
    return {
        outcomeKind,
        ...(numericStatus === undefined ? {} : { httpStatus: numericStatus }),
        ...(apiStatus === undefined ? {} : { apiStatus }),
    };
};

interface MutableAttemptOutcome {
    modelId: string;
    outcomeKind: ModelAttemptOutcomeKind;
    httpStatus?: number;
    apiStatus?: SafeGeminiApiStatus;
    elapsedMs: number;
    attemptCount: number;
}

export class GeminiV4AttemptOutcomeCollector {
    private readonly outcomes: MutableAttemptOutcome[] = [];

    record(
        modelId: string,
        outcomeKind: ModelAttemptOutcomeKind,
        startedAt: number,
        metadata: Pick<ClassifiedGeminiV4Failure, 'httpStatus' | 'apiStatus'> = {},
    ): void {
        const elapsedMs = Math.min(MAX_SAFE_MODEL_ATTEMPT_ELAPSED_MS, Math.max(0, Math.trunc(Date.now() - startedAt)));
        const safe = sanitizeSafeModelAttemptOutcome({
            modelId, outcomeKind, elapsedMs, attemptCount: 1,
            ...(metadata.httpStatus === undefined ? {} : { httpStatus: metadata.httpStatus }),
            ...(metadata.apiStatus === undefined ? {} : { apiStatus: metadata.apiStatus }),
        });
        if (!safe) return;
        const existing = this.outcomes.find(entry => entry.modelId === safe.modelId
            && entry.outcomeKind === safe.outcomeKind
            && entry.httpStatus === safe.httpStatus
            && entry.apiStatus === safe.apiStatus);
        if (existing) {
            existing.elapsedMs = Math.min(MAX_SAFE_MODEL_ATTEMPT_ELAPSED_MS, existing.elapsedMs + (safe.elapsedMs ?? 0));
            existing.attemptCount = Math.min(MAX_SAFE_MODEL_ATTEMPT_COUNT, existing.attemptCount + 1);
            return;
        }
        if (this.outcomes.length >= MAX_SAFE_MODEL_ATTEMPTS) return;
        this.outcomes.push({
            modelId: safe.modelId,
            outcomeKind: safe.outcomeKind,
            ...(safe.httpStatus === undefined ? {} : { httpStatus: safe.httpStatus }),
            ...(safe.apiStatus === undefined ? {} : { apiStatus: safe.apiStatus }),
            elapsedMs: safe.elapsedMs ?? 0,
            attemptCount: 1,
        });
    }

    recordFailure(modelId: string, startedAt: number, error: unknown, externallyCancelled = false): void {
        const classified = classifyGeminiV4Failure(error, externallyCancelled);
        this.record(modelId, classified.outcomeKind, startedAt, classified);
    }

    snapshot(): readonly SafeModelAttemptOutcome[] {
        return this.outcomes.map(entry => ({ ...entry }));
    }
}
