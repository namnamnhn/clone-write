import { describe, it, expect } from 'vitest';
import { buildLocalRawAnalysisFallback, LOCAL_RAW_ANALYSIS_FALLBACK_TAG } from '../src/services/workflows/analyze/context';

// FIX86: khi cả 2 tầng AI (model chính + Flash cứu hộ) đều lỗi/hết quota cho 1 chunk PHÂN TÍCH,
// hệ thống không còn trả về "" / 1 dòng lỗi thuần (khiến mất trắng cả chunk) mà rơi về
// buildLocalRawAnalysisFallback — hàm THUẦN (không gọi AI), nên test được độc lập không cần mock AI.
describe('buildLocalRawAnalysisFallback (FIX86) — không mất trắng dữ liệu khi cả 2 tầng AI lỗi', () => {
    it('gắn đúng marker hệ thống để nhận diện + loại khỏi rollingDictionary sau này', () => {
        const result = buildLocalRawAnalysisFallback('Một đoạn truyện bất kỳ.', 0, 5);
        expect(result).toContain(LOCAL_RAW_ANALYSIS_FALLBACK_TAG);
        expect(result).toContain('Phần dữ liệu 1/5');
    });

    it('trích xuất được cụm từ khả nghi (tên riêng) cục bộ, không cần AI', () => {
        const chunk = 'Lý Trường Phong bước vào Tông Môn, gặp Trưởng lão Vương.';
        const result = buildLocalRawAnalysisFallback(chunk, 2, 10);
        expect(result).toContain('Cụm từ khả nghi trích xuất CỤC BỘ');
        expect(result).toContain('Lý Trường Phong');
    });

    it('vẫn trả về marker hợp lệ khi chunk không có cụm từ khả nghi nào', () => {
        const result = buildLocalRawAnalysisFallback('a a a a a a.', 3, 4);
        expect(result).toContain(LOCAL_RAW_ANALYSIS_FALLBACK_TAG);
        expect(result).toContain('Không trích xuất được cụm từ khả nghi nào');
    });

    it('đính kèm chi tiết lỗi AI cuối cùng khi có truyền vào (phục vụ debug)', () => {
        const result = buildLocalRawAnalysisFallback('Nội dung.', 0, 1, 'Quota exceeded (429)');
        expect(result).toContain('Lỗi AI cuối cùng: Quota exceeded (429)');
    });

    it('độ dài kết quả không phụ thuộc tuyến tính vào độ dài chunk đầu vào (an toàn ngân sách Hợp Nhất)', () => {
        // Chunk giả lập rất dài (như 1 phần ANALYSIS_CHUNK_MAX_CHARS thật) nhưng lặp lại 1 câu
        // không chứa nhiều cụm từ khả nghi khác nhau -> marker vẫn gọn, không bơm nguyên văn thô
        // vào bước Hợp Nhất kế tiếp (khác hẳn việc trả nguyên `chunkText` làm fallback).
        const longChunk = 'lời thoại bình thường không có tên riêng. '.repeat(5000);
        const result = buildLocalRawAnalysisFallback(longChunk, 0, 1);
        expect(result.length).toBeLessThan(1000);
        expect(result).not.toContain(longChunk);
    });
});
