import { describe, it, expect } from 'vitest';
import { planMergeChunks, mergeContexts } from '../src/services/workflows/analyze/context';
import { MERGE_CONTEXT_CHUNK_MAX_CHARS, ANALYSIS_CHUNK_MAX_CHARS, IS_LITE } from '../src/constants';
import { StoryInfo } from '../src/types';

// FIX85: hợp nhất ngữ cảnh chuyển từ cây đệ quy nhị phân sang tuyến tính có tích lũy (rolling
// fold) — planMergeChunks là hàm THUẦN (không gọi AI) chịu trách nhiệm gộp cục bộ + chia lại theo
// ranh giới, nên có thể test độc lập không cần mock AI.
describe('planMergeChunks — gộp cục bộ rồi chia lại theo ranh giới từng phần (FIX85)', () => {
    it('contexts nhỏ (tổng < ngưỡng) -> gộp vào ĐÚNG 1 chunk duy nhất', () => {
        const contexts = ['[A] = Nhân vật A', '[B] = Nhân vật B', '[C] = Nhân vật C'];
        const chunks = planMergeChunks(contexts);
        expect(chunks.length).toBe(1);
        expect(chunks[0]).toContain('[A] = Nhân vật A');
        expect(chunks[0]).toContain('[B] = Nhân vật B');
        expect(chunks[0]).toContain('[C] = Nhân vật C');
    });

    it('không bao giờ xé đôi 1 context giữa 2 chunk khi tổng vượt ngưỡng', () => {
        // Mỗi context ~ nửa ngưỡng, nội dung KHÁC NHAU (đánh dấu riêng) -> gộp 2 cái đầu vừa 1
        // chunk, context thứ 3 phải rớt sang chunk mới (không được cắt ngang bất kỳ context nào).
        const half = Math.floor(MERGE_CONTEXT_CHUNK_MAX_CHARS / 2) - 100;
        const makeUnit = (tag: string) => `[MARKER_${tag}_START]` + 'X'.repeat(half) + `[MARKER_${tag}_END]`;
        const contexts = [makeUnit('A'), makeUnit('B'), makeUnit('C')];
        const chunks = planMergeChunks(contexts);

        // Mỗi context gốc phải xuất hiện TRỌN VẸN (nguyên khối, không bị cắt đứt) trong đúng 1
        // chunk kết quả — dùng cặp marker start/end để xác nhận cả 2 đầu đều nằm CÙNG 1 chunk.
        for (const ctx of contexts) {
            const occurrences = chunks.filter(c => c.includes(ctx)).length;
            expect(occurrences).toBe(1);
        }
        // Có ít nhất 2 chunk vì tổng 3 context vượt ngưỡng 1 chunk.
        expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('giữ đúng thứ tự các phần trong chunk', () => {
        const contexts = ['[1] = Phần một', '[2] = Phần hai'];
        const chunks = planMergeChunks(contexts);
        const joined = chunks.join('\n');
        expect(joined.indexOf('[1] = Phần một')).toBeLessThan(joined.indexOf('[2] = Phần hai'));
    });

    it('1 context rỗng bị bỏ qua, không tạo chunk rác', () => {
        const chunks = planMergeChunks(['', '[A] = X', '']);
        expect(chunks.length).toBe(1);
        expect(chunks[0]).toContain('[A] = X');
    });
});

describe('MERGE_CONTEXT_CHUNK_MAX_CHARS — ngưỡng hợp nhất phải thận trọng hơn ngưỡng phân tích', () => {
    it('nhỏ hơn ANALYSIS_CHUNK_MAX_CHARS của cùng bản build (input hợp nhất đã cô đọng, tỉ lệ nén thấp hơn)', () => {
        expect(MERGE_CONTEXT_CHUNK_MAX_CHARS).toBeLessThan(ANALYSIS_CHUNK_MAX_CHARS);
    });

    it(`giá trị đúng theo bản build hiện tại (${IS_LITE ? 'Lite' : 'Full'})`, () => {
        expect(MERGE_CONTEXT_CHUNK_MAX_CHARS).toBe(IS_LITE ? 30000 : 80000);
    });
});

describe('mergeContexts — trường hợp trivial không cần gọi AI', () => {
    const storyInfo = { title: 'T', genres: [], languages: ['Trung'] } as unknown as StoryInfo;

    it('mảng rỗng -> trả về chuỗi rỗng ngay, không lập kế hoạch merge', async () => {
        expect(await mergeContexts([], storyInfo)).toBe('');
    });

    it('chỉ có 1 context -> trả về luôn (không cần hợp nhất/không gọi AI)', async () => {
        const result = await mergeContexts(['[A] = Duy nhất'], storyInfo);
        expect(result).toContain('[A] = Duy nhất');
    });
});
