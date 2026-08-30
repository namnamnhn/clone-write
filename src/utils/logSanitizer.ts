import type { LogContext, LogEntry } from '../types';

const DEFAULT_MAX_MESSAGE_LENGTH = 6000;
const normalizeLength = (value: string, maxLength: number): string =>
    value.length > maxLength ? `${value.slice(0, maxLength)}…[TRUNCATED]` : value;

export const redactSensitiveText = (value: unknown, maxLength: number = DEFAULT_MAX_MESSAGE_LENGTH): string => {
    let text = String(value ?? '');
    text = text
        .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,"']+/gi, '$1[REDACTED]')
        .replace(/\bAIza[\w-]{20,}\b/g, 'AIza…[REDACTED]')
        .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-…[REDACTED]')
        .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/\b(api[_-]?key|apikey|geminiKey|deepseekKey|token|access_token)\s*[:=]\s*[^\s,;"']+/gi, '$1=[REDACTED]')
        .replace(/("(?:apiKey|api_key|apikey|geminiKey|deepseekKey|token|access_token|authorization)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"')
        .replace(/("(?:prompt|response|input|contents|systemInstruction|system_instruction)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED_CONTENT]"')
        .replace(/\b(prompt|response|input|contents)\s*=\s*[^\r\n&]+/gi, '$1=[REDACTED_CONTENT]');
    return normalizeLength(text, Math.max(200, maxLength));
};

const cleanShort = (value: unknown, max = 160): string | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    return redactSensitiveText(value, max).replace(/[\r\n]+/g, ' ').trim() || undefined;
};

export const sanitizeLogContext = (context?: LogContext): LogContext | undefined => {
    if (!context) return undefined;
    const sanitized: LogContext = {
        operation: cleanShort(context.operation), provider: context.provider,
        modelId: cleanShort(context.modelId), runId: cleanShort(context.runId, 80),
        batchId: cleanShort(context.batchId, 120),
        attempt: Number.isFinite(context.attempt) ? context.attempt : undefined,
        maxAttempts: Number.isFinite(context.maxAttempts) ? context.maxAttempts : undefined,
        httpStatus: Number.isFinite(context.httpStatus) ? context.httpStatus : undefined,
        apiStatus: cleanShort(context.apiStatus, 80), cause: cleanShort(context.cause, 200),
        durationMs: Number.isFinite(context.durationMs) ? context.durationMs : undefined,
    };
    return Object.values(sanitized).some(value => value !== undefined) ? sanitized : undefined;
};

export const sanitizeLogEntry = (entry: LogEntry): LogEntry => ({
    ...entry, message: redactSensitiveText(entry.message), context: sanitizeLogContext(entry.context),
});

export const createSanitizedLogEntry = (
    message: string, type: LogEntry['type'], context?: LogContext,
    id: string = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
): LogEntry => sanitizeLogEntry({ id, timestamp: new Date(), message, type, context });
