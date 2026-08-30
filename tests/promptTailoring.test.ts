import { describe, it, expect } from 'vitest';
import { resolveRawSourceLanguages, buildOptimizePromptInstruction } from '../src/services/workflows/analyze/promptRules';
import { StoryInfo } from '../src/types';

// FIX61+: bộ test cho chính sách "Thiết Kế Prompt Tối Ưu phải PHÙ HỢP BỘ TRUYỆN" —
// giữ trọn lõi an toàn (Nhóm A), chỉ lược bỏ quy tắc vô dụng theo bằng chứng (Nhóm B/C),
// khoá đúng ngôn ngữ nguồn thay vì liệt kê chung chung mọi ngôn ngữ.
const makeStoryInfo = (overrides: Partial<StoryInfo> = {}): StoryInfo => ({
    title: 'Vô Địch Từ Một Tờ Vé Số Cào',
    author: 'Diệc Thần',
    languages: ['Tiếng Trung'],
    genres: ['Đô Thị', 'Võng Du'],
    mcPersonality: [],
    worldSetting: ['Hiện đại/Đô thị'],
    sectFlow: [],
    ...overrides,
});

const baseInput = {
    modeDirective: '### MODE LOCK RAW TEST',
    originRestorationDirective: 'Duy trì Hán Việt chuẩn.',
    additionalRules: '[RULE-NGUOI-DUNG-TEST]',
    dictionary: '[DICT-TEST]',
    context: '[CTX-TEST]',
    filledTemplate: '[PROMPT-GOC-TEMPLATE-TEST]',
};

describe('resolveRawSourceLanguages — nhận diện đúng ngôn ngữ nguồn từ metadata', () => {
    it('map đúng nhãn tiếng Việt sang nhãn khoá', () => {
        expect(resolveRawSourceLanguages(['Tiếng Trung'])).toEqual(['TIẾNG TRUNG']);
        expect(resolveRawSourceLanguages(['Tiếng Trung', 'Tiếng Anh'])).toEqual(['TIẾNG TRUNG', 'TIẾNG ANH']);
        expect(resolveRawSourceLanguages(['Tiếng Nhật', 'Tiếng Hàn'])).toEqual(['TIẾNG NHẬT', 'TIẾNG HÀN']);
    });

    it('bỏ qua Convert/không khớp và khử trùng lặp', () => {
        expect(resolveRawSourceLanguages(['Convert thô'])).toEqual([]);
        expect(resolveRawSourceLanguages([])).toEqual([]);
        expect(resolveRawSourceLanguages(['Tiếng Trung', 'tiếng trung'])).toEqual(['TIẾNG TRUNG']);
    });
});

describe('buildOptimizePromptInstruction — chính sách chọn lọc 3 NHÓM A/B/C', () => {
    it('chứa đủ 3 nhóm chính sách + lõi an toàn bắt buộc (thẻ ID, chú thích [n], đơn vị số...)', () => {
        const instruction = buildOptimizePromptInstruction(baseInput, makeStoryInfo());
        expect(instruction).toContain('NHÓM A — LÕI AN TOÀN');
        expect(instruction).toContain('NHÓM B — QUY TẮC ĐIỀU KIỆN');
        expect(instruction).toContain('NHÓM C — LOẠI khi bất khả thi');
        // Nhóm A vẫn được neo chặt
        expect(instruction).toContain('[[[part_X]]]');
        expect(instruction).toContain('"[n]"');
        expect(instruction).toContain('BẢO VỆ BẢNG THÔNG SỐ');
        expect(instruction).toContain('CHUẨN HÓA DẤU CÂU LẶP LẠI');
    });

    it('KHÔNG còn mệnh đề cũ ép giữ SRT vô điều kiện ("BẤT KỂ... truyện phụ đề")', () => {
        const instruction = buildOptimizePromptInstruction(baseInput, makeStoryInfo());
        expect(instruction).not.toContain('BẤT KỂ bộ truyện đang tối ưu có phải truyện phụ đề hay không');
        // SRT giờ là quy tắc điều kiện Nhóm B/C có bằng chứng
        expect(instruction).toContain('ĐỊNH DẠNG PHỤ ĐỀ SRT');
    });

    it('chế độ RAW khoá đúng ngôn ngữ nguồn của dự án, không liệt kê chung chung', () => {
        const instruction = buildOptimizePromptInstruction({
            ...baseInput,
            modeDirective: '- **(CÁC) NGÔN NGỮ NGUỒN CỦA DỰ ÁN NÀY:** TIẾNG TRUNG.',
        }, makeStoryInfo({ languages: ['Tiếng Trung'] }));
        expect(instruction).toContain('TIẾNG TRUNG');
    });

    it('nhúng kèm mẫu raw thật khi được cung cấp', () => {
        const withSamples = buildOptimizePromptInstruction({
            ...baseInput,
            rawSamples: ['第1章 无敌，从一张刮刮乐开始！ 林墨看着手中的彩票...', '第2章 全服唯一SSS级天赋！'],
        }, makeStoryInfo());
        expect(withSamples).toContain('[DỮ LIỆU RAW MẪU');
        expect(withSamples).toContain('--- Mẫu 1 ---');
        expect(withSamples).toContain('第1章 无敌，从一张刮刮乐开始');

        const withoutSamples = buildOptimizePromptInstruction(baseInput, makeStoryInfo());
        expect(withoutSamples).not.toContain('[DỮ LIỆU RAW MẪU (trích');
        expect(withoutSamples).not.toContain('--- Mẫu 1 ---');
    });

    it('đưa đầy đủ dữ liệu đầu vào (quy tắc người dùng, bible, prompt gốc) vào chỉ thị', () => {
        const instruction = buildOptimizePromptInstruction(baseInput, makeStoryInfo());
        expect(instruction).toContain('[RULE-NGUOI-DUNG-TEST]');
        expect(instruction).toContain('[DICT-TEST]');
        expect(instruction).toContain('[CTX-TEST]');
        expect(instruction).toContain('[PROMPT-GOC-TEMPLATE-TEST]');
        expect(instruction).toContain('Vô Địch Từ Một Tờ Vé Số Cào');
    });

    // FIX68: quy tắc "gộp dòng rác bị gãy" (mục 0.2) rất dễ bị model hiểu nhầm thành
    // lệnh tóm tắt khi tối ưu prompt nếu không được neo rõ trong NHÓM A. Khoá cả nhãn
    // tóm tắt trong danh sách Nhóm A lẫn mục 9f chi tiết, và khoá luôn ranh giới
    // "nối câu bị gãy" khác "tóm tắt nội dung" để không bị rút gọn mất ý khi tối ưu.
    it('bảo toàn quy tắc "gộp dòng rác bị gãy" và ranh giới chống tóm tắt trong Nhóm A', () => {
        const instruction = buildOptimizePromptInstruction(baseInput, makeStoryInfo());
        expect(instruction).toContain('gộp dòng rác bị gãy giữa câu');
        expect(instruction).toContain('9f.');
        expect(instruction).toContain('BẢO TOÀN NGUYÊN VẸN QUY TẮC GỘP DÒNG RÁC BỊ GÃY');
        expect(instruction).toContain('KHÔNG bao giờ được coi đây là lệnh tóm tắt/rút gọn/diễn giải lại nội dung');
    });
});
