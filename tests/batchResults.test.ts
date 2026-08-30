import { describe, it, expect } from 'vitest';
import { FileItem, FileStatus } from '../src/types';
import { applyBatchResults } from '../src/hooks/translator/applyBatchResults';
import { BATCH_MISSING_TAG_WARNING } from '../src/utils/text';
import { countForeignChars } from '../src/utils/text';

// Test hồi quy R-A (fix36 - tách khối "áp kết quả batch" khỏi processBatch/useTranslator
// thành hàm thuần applyBatchResults): đảm bảo hành vi giữ nguyên 100% so với bản nội tuyến -
// phân nhánh COMPLETED/IDLE/ERROR, giữ bản dịch nghi vấn (stale), cách ly tệp đầu khi thiếu
// kết quả do Safety, bàn giao vệ tinh cho tệp quét trước ra nghi vấn thật, và Translation Memory.
const storyInfo = { enableTitleFormatting: false, enableAutoFormat: false };

const mkFile = (id: string, content: string, extra: Partial<FileItem> = {}): FileItem => ({
    id,
    name: `${id}.txt`,
    content,
    translatedContent: null,
    status: FileStatus.PROCESSING,
    retryCount: 0,
    originalCharCount: content.length,
    remainingRawCharCount: content.length,
    ...extra,
});

const baseCtx = (over: Record<string, unknown> = {}) => ({
    batchIds: ['a'],
    resultsMap: { results: new Map<string, string>() },
    flaggedStaleIds: new Set<string>(),
    tailSafetyScan: new Map<string, { isUnsafe: boolean; modelUsed: string }>(),
    processingDuration: 1234,
    isFixPhase: false,
    storyInfo,
    stateStoryInfo: undefined,
    ratioLimits: undefined,
    deepseekKey: undefined,
    ...over,
}) as Parameters<typeof applyBatchResults>[0];

describe('applyBatchResults', () => {
    it('kết quả sạch -> COMPLETED, gom Translation Memory, đếm success', () => {
        const prev = [mkFile('a', 'Xin chào thế giới.')];
        const ctx = baseCtx({
            prev,
            resultsMap: { results: new Map([['a', 'Hello world.']]), model: 'gemini-x' },
        });
        const out = applyBatchResults(ctx);

        expect(out.hasChanges).toBe(true);
        expect(out.successCount).toBe(1);
        expect(out.files[0].status).toBe(FileStatus.COMPLETED);
        expect(out.files[0].translatedContent).toContain('Hello world.');
        expect(out.files[0].usedModel).toBe('gemini-x');
        expect(out.files[0].hasStaleTranslation).toBe(false);
        // Dịch thành công thì gỡ khoá cứu hộ
        expect(out.tmCollected).toHaveLength(1);
        expect(out.tmCollected[0]).toEqual({ src: 'Xin chào thế giới.', dst: out.files[0].translatedContent });
        expect(out.priorityRetryIds.size).toBe(0);
    });

    it('dịch thành công gỡ khoá cứu hộ (isRescueLocked)', () => {
        const prev = [mkFile('a', 'Nội dung ngắn.', { isRescueLocked: true })];
        const out = applyBatchResults(baseCtx({
            prev,
            resultsMap: { results: new Map([['a', 'Translated content.']]) },
        }));
        expect(out.files[0].status).toBe(FileStatus.COMPLETED);
        expect(out.files[0].isRescueLocked).toBe(false);
    });

    it('file bị hậu kiểm nghi vấn (flaggedStale) -> giữ bản nghi vấn + tính lại raw + tăng retry', () => {
        const stale = 'Bản dịch nghi vấn cần xem lại.';
        const prev = [mkFile('a', 'Gốc A.', { retryCount: 0 })];
        const out = applyBatchResults(baseCtx({
            prev,
            flaggedStaleIds: new Set(['a']),
            resultsMap: { results: new Map([['a', stale]]), errors: new Map([['a', 'Lệch tỷ lệ']]) },
        }));

        expect(out.ratioErrorIds).toEqual(['a']);
        expect(out.files[0].status).toBe(FileStatus.IDLE);
        expect(out.files[0].translatedContent).toBe(stale);
        expect(out.files[0].hasStaleTranslation).toBe(true);
        // FIX (stale badge): số ký tự raw phải tính theo chính bản nghi vấn mới
        expect(out.files[0].remainingRawCharCount).toBe(countForeignChars(stale));
        expect(out.files[0].errorMessage).toContain('Lệch tỷ lệ');
        expect(out.files[0].errorMessage).toContain('Đang thử lại (1/');
        expect(out.files[0].retryCount).toBe(1);
    });

    it('flaggedStale hết lượt thử -> ERROR nhưng vẫn giữ bản nghi vấn', () => {
        const prev = [mkFile('a', 'Gốc A.', { retryCount: 2 })];
        const out = applyBatchResults(baseCtx({
            prev,
            flaggedStaleIds: new Set(['a']),
            resultsMap: { results: new Map([['a', 'nghi vấn']]) },
        }));
        expect(out.files[0].status).toBe(FileStatus.ERROR);
        expect(out.files[0].translatedContent).toBe('nghi vấn');
        expect(out.files[0].retryCount).toBe(2); // không tăng thêm ở nhánh ERROR
    });

    it('thiếu kết quả do Safety: tệp ĐẦU bị cách ly + ưu tiên retry, tệp sau là "vạ lây" không tăng retry', () => {
        const prev = [mkFile('a', 'Nội dung tệp 1.'), mkFile('b', 'Nội dung tệp 2.')];
        const out = applyBatchResults(baseCtx({
            batchIds: ['a', 'b'],
            prev,
            resultsMap: {
                results: new Map(),
                streamError: new Error('Yêu cầu bị chặn bởi bộ lọc an toàn'),
            },
        }));

        expect(out.missingResultIds).toEqual(['a', 'b']);
        // Tệp đầu tiên trong batch bị thiếu kết quả -> cách ly kiểm tra riêng
        expect(out.files[0].status).toBe(FileStatus.IDLE);
        expect(out.files[0].errorMessage).toContain('cách ly để kiểm tra riêng');
        expect(out.files[0].retryCount).toBe(1);
        // Tệp "vạ lây": chờ thử lại, KHÔNG tăng retryCount, đánh dấu isSafeRebatch
        expect(out.files[1].status).toBe(FileStatus.IDLE);
        expect(out.files[1].errorMessage).toBe('Chờ thử lại do vạ lây từ file lỗi trong batch');
        expect((out.files[1] as any).isSafeRebatch).toBe(true);
        expect(out.files[1].retryCount).toBe(0);
        expect(Array.from(out.priorityRetryIds)).toEqual(['a']);
    });

    it('tệp "vạ lây" bị quét trước ra NGHI VẤN THẬT -> bàn giao DeepSeek (còn lượt cứu hộ)', () => {
        const prev = [mkFile('a', 'Tệp 1.'), mkFile('b', 'Tệp 2.', { retryCount: 0 })];
        const out = applyBatchResults(baseCtx({
            batchIds: ['a', 'b'],
            prev,
            deepseekKey: 'sk-ds-test',
            tailSafetyScan: new Map([['b', { isUnsafe: true, modelUsed: 'gemini-scan' }]]),
            resultsMap: {
                results: new Map(),
                streamError: new Error('bị bộ lọc an toàn chặn'),
            },
        }));

        expect(out.files[1].status).toBe(FileStatus.IDLE);
        expect(out.files[1].errorMessage).toContain('quét trước');
        expect(out.files[1].errorMessage).toContain('Bàn giao DeepSeek');
        expect(out.files[1].retryCount).toBe(1);
        expect(out.priorityRetryIds.has('b')).toBe(true);
    });

    it('tệp quét trước ra nghi vấn nhưng HẾT lượt/không có vệ tinh -> ERROR chặn Safety', () => {
        const prev = [mkFile('a', 'Tệp 1.'), mkFile('b', 'Tệp 2.', { retryCount: 5 })];
        const out = applyBatchResults(baseCtx({
            batchIds: ['a', 'b'],
            prev,
            tailSafetyScan: new Map([['b', { isUnsafe: true, modelUsed: 'gemini-scan' }]]),
            resultsMap: {
                results: new Map(),
                streamError: new Error('safety blocklist'),
            },
        }));

        expect(out.files[1].status).toBe(FileStatus.ERROR);
        expect(out.files[1].errorMessage).toContain('Không có vệ tinh DeepSeek dự phòng');
    });

    it('lỗi tỷ lệ (ratio) -> IDLE thử lại khi còn lượt, ERROR khi hết', () => {
        const longSource = 'A'.repeat(600);
        // Bản dịch dài gấp ~10 lần gốc -> chắc chắn vượt trần tỷ lệ mọi ngôn ngữ
        const bloatedResult = 'B'.repeat(6000);

        const stillRetrying = applyBatchResults(baseCtx({
            prev: [mkFile('a', longSource, { retryCount: 0 })],
            resultsMap: { results: new Map([['a', bloatedResult]]) },
        }));
        expect(stillRetrying.ratioErrorIds).toEqual(['a']);
        expect(stillRetrying.files[0].status).toBe(FileStatus.IDLE);
        expect(stillRetrying.files[0].errorMessage).toContain('Đang thử lại');
        expect(stillRetrying.tmCollected).toHaveLength(0); // bản lỗi không được lưu TM

        const exhausted = applyBatchResults(baseCtx({
            prev: [mkFile('a', longSource, { retryCount: 2 })],
            resultsMap: { results: new Map([['a', bloatedResult]]) },
        }));
        expect(exhausted.files[0].status).toBe(FileStatus.ERROR);
    });

    it('kết quả có cảnh báo thiếu thẻ tag: vẫn COMPLETED + tính success nhưng KHÔNG lưu TM', () => {
        const prev = [mkFile('a', 'Nội dung gốc.')];
        const out = applyBatchResults(baseCtx({
            prev,
            resultsMap: { results: new Map([['a', `Dịch thường ${BATCH_MISSING_TAG_WARNING}`]]) },
        }));
        expect(out.files[0].status).toBe(FileStatus.COMPLETED);
        expect(out.successCount).toBe(1);
        expect(out.files[0].errorMessage).toContain('Thiếu thẻ kết thúc');
        expect(out.tmCollected).toHaveLength(0);
    });

    it('không có gì thay đổi -> trả lại chính tham chiếu prev (tránh re-render thừa)', () => {
        const prev = [mkFile('x', 'Không thuộc batch này.')];
        const out = applyBatchResults(baseCtx({ prev }));
        expect(out.hasChanges).toBe(false);
        expect(out.files).toBe(prev);
        expect(out.successCount).toBe(0);
    });
});
