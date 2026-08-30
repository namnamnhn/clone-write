import { describe, expect, it } from 'vitest';
import { StoryInfo } from '../src/types';
import { createCoverPrompt } from '../src/services/workflows/analyze/cover';
import { buildVipCoverPrompt } from '../src/services/workflows/analyze/coverPromptTemplate';

const storyInfo = {
    title: 'Tinh Hà Trở Lại',
    author: 'Nguyễn An',
    languages: ['Tiếng Việt'],
    genres: ['Khoa Huyễn', 'Võng Du'],
    mcPersonality: ['Điềm tĩnh', 'Quyết đoán'],
    worldSetting: ['Tinh hải tương lai'],
    sectFlow: ['Hệ thống'],
    summary: 'Tóm tắt cũ',
} as StoryInfo;

describe('VIP EPUB cover prompt', () => {
    it('inserts the refined deep-analysis summary and story metadata verbatim', () => {
        const summary = 'Một phi công thức tỉnh giữa mạng lưới các vì sao và phải bảo vệ thuộc địa cuối cùng.';
        const prompt = buildVipCoverPrompt(storyInfo, summary);

        expect(prompt).toContain(summary);
        expect(prompt).toContain('Tên truyện: Tinh Hà Trở Lại');
        expect(prompt).toContain('Tác giả: Nguyễn An');
        expect(prompt).toContain('Thể loại: Khoa Huyễn, Võng Du');
        expect(prompt).toContain('Tỷ lệ dọc EPUB chính xác 2:3');
        expect(prompt).toContain('TUYỆT ĐỐI KHÔNG render chữ');
    });

    it('falls back to the saved summary when no new summary is supplied', () => {
        expect(buildVipCoverPrompt(storyInfo, '')).toContain('Tóm tắt cũ');
    });

    it('does not leak story-specific examples from the reference template', async () => {
        const prompt = await createCoverPrompt(storyInfo, 'Tóm tắt mới');
        expect(prompt).toBe(buildVipCoverPrompt(storyInfo, 'Tóm tắt mới'));
        expect(prompt).not.toContain('Bạch Phù');
        expect(prompt).not.toContain('Quần Tinh Nương');
        expect(prompt).not.toContain('[DÁN TÓM TẮT');
    });
});

