import { describe, expect, it } from 'vitest';
import { buildCrashReportContent, buildLogFileContent } from '../src/utils/logExport';
import { createSanitizedLogEntry, redactSensitiveText, sanitizeLogContext } from '../src/utils/logSanitizer';

describe('fix76 — redaction tập trung', () => {
    it('che key/token và raw prompt/response', () => {
        const safe = redactSensitiveText('Bearer secret AIza123456789012345678901234567890 api_key=top-secret {"prompt":"raw prompt","response":"raw response"}');
        expect(safe).not.toContain('top-secret'); expect(safe).not.toContain('raw prompt'); expect(safe).not.toContain('raw response');
    });
    it('chỉ giữ whitelist metadata', () => {
        const context = sanitizeLogContext({ operation: 'translate', provider: 'gemini', httpStatus: 503, rawPrompt: 'secret' } as any) as any;
        expect(context).toMatchObject({ operation: 'translate', provider: 'gemini', httpStatus: 503 }); expect(context.rawPrompt).toBeUndefined();
    });
    it('export giữ metadata nhưng không lộ dữ liệu nhạy cảm', () => {
        const entry = createSanitizedLogEntry('api_key=top-secret prompt=raw chapter', 'error', { operation: 'translate', provider: 'gemini', attempt: 2, maxAttempts: 3, httpStatus: 503 }, 'id');
        const log = buildLogFileContent([entry]);
        const crash = buildCrashReportContent(new Error('sk-1234567890abcdef response=raw output'), 'prompt=secret component', [entry]);
        expect(log).toContain('provider=gemini'); expect(log).toContain('attempt=2/3'); expect(log).not.toContain('top-secret'); expect(log).not.toContain('raw chapter');
        expect(crash).not.toContain('1234567890abcdef'); expect(crash).not.toContain('raw output'); expect(crash).not.toContain('secret component');
    });
});
