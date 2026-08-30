import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    EMPTY_RESULT_MARKER,
    shouldBailOutToIsolationForEmptyResults,
    determineExhaustionCauseTag,
    formatGoogleApiErrorDetails,
    GEMINI_LAUNCH_INTERVAL_MS,
    GOOGLE_SERVER_SOFT_COOLDOWN_MS,
    calculateGeminiLaunchReservation,
    getForeignServerCooldownRemainingMs,
    getGoogleApiErrorDetails,
    getServerErrorBackoffMs,
    isGoogleServerError,
} from '../src/services/api/gemini';

// ============================================================================
// FIX66 — regression cho sự cố 26/8 18:04-18:06 (nhat-ky-loi_2026-08-26T11-19-55.txt):
// batch 671-676 khiến gemini-3.6-flash rồi gemini-3.7-flash lần lượt trả KẾT QUẢ RỖNG
// (bộ lọc an toàn chặn âm thầm). Khi đó:
//  1. Mỗi model bị đốt đủ 3 lượt retry backoff 2s/4s/8s với CÙNG payload tất định -> lãng phí.
//  2. Lỗi cuối bị dán nhầm [CAUSE:DEPLETED] chỉ vì pro (gemini-3.1-pro-preview) cạn thật,
//     trong khi 2 flash vẫn còn nguyên quota (debug: 3.6 waitTime=0, depleted=false!)
//     -> useTranslator coi như hết Quota thật -> DỪNG TOÀN HỆ THỐNG -> người dùng phải
//     reset data + restore backup mới chạy lại được.
// ============================================================================

describe('FIX66 — shouldBailOutToIsolationForEmptyResults', () => {
    it('model ĐẦU TIÊN trả rỗng mà còn model dự phòng -> KHÔNG cách ly ngay, chuyển sang model khác', () => {
        expect(shouldBailOutToIsolationForEmptyResults(1, 2)).toBe(false);
        expect(shouldBailOutToIsolationForEmptyResults(1, 1)).toBe(false);
    });

    it('model THỨ HAI khác cũng trả rỗng -> gần chắc chắn do nội dung -> ném lỗi để quét/cách ly tệp', () => {
        expect(shouldBailOutToIsolationForEmptyResults(2, 5)).toBe(true);
    });

    it('không còn model nào khác khả dụng -> ném lỗi để vào luồng cách ly thay vì retry mù', () => {
        expect(shouldBailOutToIsolationForEmptyResults(1, 0)).toBe(true);
    });
});

describe('FIX66 — determineExhaustionCauseTag (sửa tag nguyên nhân)', () => {
    it('SỰ CỐ THỰC TẾ: pro depleted nhưng 2 flash còn quota (chỉ blacklist tạm) -> phải là BLACKLIST_TEMP (tự thử lại), KHÔNG phải DEPLETED (dừng hệ thống)', () => {
        const incident = [
            { enabled: true, depleted: true },   // gemini-3.1-pro-preview (cạn thật)
            { enabled: true, depleted: false },  // gemini-3.7-flash (waitTime=29028, chưa cạn)
            { enabled: true, depleted: false },  // gemini-3.6-flash (waitTime=0, chưa cạn!)
        ];
        expect(determineExhaustionCauseTag(incident)).toBe('[CAUSE:BLACKLIST_TEMP]');
    });

    it('TẤT CẢ model đều cạn thật -> DEPLETED (dừng là đúng)', () => {
        expect(determineExhaustionCauseTag([
            { enabled: true, depleted: true },
            { enabled: true, depleted: true },
        ])).toBe('[CAUSE:DEPLETED]');
    });

    it('còn model enabled+chưa cạn dù đang cooldown/backoff -> vẫn BLACKLIST_TEMP (chờ rồi thử lại được)', () => {
        expect(determineExhaustionCauseTag([{ enabled: true, depleted: false }])).toBe('[CAUSE:BLACKLIST_TEMP]');
    });

    it('toàn bộ bị TẮT hoặc cạn (không còn gì sống) -> DEPLETED', () => {
        expect(determineExhaustionCauseTag([
            { enabled: false, depleted: false },
            { enabled: true, depleted: true },
        ])).toBe('[CAUSE:DEPLETED]');
    });
});

describe('fix73 — chẩn đoán và backoff lỗi máy chủ Google', () => {
    it('giữ mã HTTP/code/status/message gốc từ cấu trúc lỗi Google', () => {
        const error = {
            status: 503,
            error: {
                code: 503,
                status: 'UNAVAILABLE',
                message: 'The model is overloaded. Please try again later.',
            },
        };

        expect(getGoogleApiErrorDetails(error)).toEqual({
            httpStatus: 503,
            code: 503,
            status: 'UNAVAILABLE',
            message: 'The model is overloaded. Please try again later.',
        });
        expect(formatGoogleApiErrorDetails(error)).toBe(
            'HTTP 503 | code=503 | status=UNAVAILABLE | message=The model is overloaded. Please try again later.'
        );
    });

    it('đọc được payload Google bị SDK nhúng trong message và che API key nếu có', () => {
        const error = new Error('[503] {"error":{"code":503,"status":"UNAVAILABLE","message":"Call https://example.test?key=AIzaSy123456789012345678901234 failed"}}');
        const details = getGoogleApiErrorDetails(error);

        expect(details.httpStatus).toBe(503);
        expect(details.code).toBe(503);
        expect(details.status).toBe('UNAVAILABLE');
        expect(details.message).toContain('key=[REDACTED]');
        expect(details.message).not.toContain('AIzaSy123456789012345678901234');
    });

    it('đọc được status UNAVAILABLE khi Google SDK đặt error.error thành chuỗi JSON', () => {
        const error = {
            status: 503,
            message: 'Request failed with status 503',
            error: '{"error":{"code":503,"status":"UNAVAILABLE","message":"High demand"}}',
        };
        expect(getGoogleApiErrorDetails(error)).toEqual({
            httpStatus: 503,
            code: 503,
            status: 'UNAVAILABLE',
            message: 'High demand',
        });
    });

    it('backoff 5xx tăng nhẹ 5s → 8s → 12s và không vượt 12s', () => {
        expect([1, 2, 3, 4, 99].map(getServerErrorBackoffMs)).toEqual([5000, 8000, 12000, 12000, 12000]);
    });

    it('nhận diện cả status chữ UNAVAILABLE khi SDK không cung cấp status HTTP dạng số', () => {
        const error = { status: 'UNAVAILABLE', message: 'Backend temporarily unavailable' };
        expect(isGoogleServerError(error)).toBe(true);
        expect(isGoogleServerError({ status: 400, message: 'Bad request' })).toBe(false);
    });

    it('đặt chỗ khởi phát tuần tự cách nhau 1.8s thay vì để các worker cùng bắn request', () => {
        const first = calculateGeminiLaunchReservation(1000, 0);
        const second = calculateGeminiLaunchReservation(1000, first.nextLaunchAt);
        const third = calculateGeminiLaunchReservation(1000, second.nextLaunchAt);

        expect(GEMINI_LAUNCH_INTERVAL_MS).toBe(1800);
        expect([first.waitMs, second.waitMs, third.waitMs]).toEqual([0, 1800, 3600]);
    });

    it('soft cooldown 503 chỉ chặn batch khác, không đổi backoff retry của batch sở hữu', () => {
        const entry = { until: 30000, ownerExecutionId: 7 };
        expect(GOOGLE_SERVER_SOFT_COOLDOWN_MS).toBe(20000);
        expect(getForeignServerCooldownRemainingMs(entry, 7, 10000)).toBe(0);
        expect(getForeignServerCooldownRemainingMs(entry, 8, 10000)).toBe(20000);
        expect(getForeignServerCooldownRemainingMs(entry, 8, 30000)).toBe(0);
    });
});

describe('FIX66 — hợp đồng message giữa streamTranslate và bộ phân loại lỗi', () => {
    // Bộ phân loại ở gemini.ts/useTranslator/isolateUnsafeFiles dò chuỗi trong message.
    // Nếu sau này ai đổi wording mà mất 1 trong 2 cụm dưới đây, luồng "rỗng -> chuyển model /
    // cách ly tệp" vỡ ngầm nên khoá lại bằng test đọc thẳng mã nguồn.
    const src = readFileSync(
        join(process.cwd(), 'src', 'services', 'workflows', 'translate', 'streamTranslate.ts'),
        'utf-8'
    );

    it('message "kết quả rỗng" của streamTranslate giữ marker mà smartExecution dò (EMPTY_RESULT_MARKER)', () => {
        expect(src).toContain(EMPTY_RESULT_MARKER);
    });

    it('message "kết quả rỗng" phải chứa cụm "bộ lọc an toàn" để đi đúng nhánh cách ly, và KHÔNG được chứa từ "quota" (tránh bị tính nhầm là lỗi quota)', () => {
        const idx = src.indexOf('kết quả rỗng');
        expect(idx).toBeGreaterThan(-1);
        const around = src.substring(Math.max(0, idx - 200), idx + 300);
        expect(around).toContain('bộ lọc an toàn');
        expect(around.toLowerCase()).not.toContain('quota');
    });
});
