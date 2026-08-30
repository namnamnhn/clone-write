import { describe, it, expect } from 'vitest';
import { BASE_TRANSLATION_IDENTITY } from '../src/prompts/translation';
import { DEFAULT_PROMPT, generateBasePrompt } from '../src/prompts';

// FIX68: bug người dùng báo — bản dịch/edit convert đôi khi bị ngắt dòng rời rạc kiểu
// raw lỗi font/OCR (một câu bị chẻ vụn thành nhiều dòng ngắn). Quy tắc "GỘP DÒNG" cũ
// (mục 0.2) quá ngắn gọn, không nêu rõ dấu hiệu nhận biết dòng rác lẫn ranh giới chống
// tóm tắt, dễ khiến model bỏ sót hoặc hiểu nhầm sang tóm tắt nội dung khi gộp.
describe('BASE_TRANSLATION_IDENTITY — quy tắc gộp dòng rác bị gãy (mục 0.2)', () => {
    it('nêu rõ dấu hiệu nhận biết dòng rác cần gộp (không kết thúc bằng dấu câu, nối liền ý)', () => {
        expect(BASE_TRANSLATION_IDENTITY).toContain('GỘP DÒNG RÁC BỊ GÃY');
        expect(BASE_TRANSLATION_IDENTITY).toContain('Dấu hiệu nhận biết dòng rác cần gộp');
        expect(BASE_TRANSLATION_IDENTITY).toContain('KHÔNG kết thúc bằng dấu câu kết ý');
    });

    it('khoá rõ ràng: gộp dòng KHÔNG PHẢI là tóm tắt, phải giữ nguyên 100% số từ', () => {
        expect(BASE_TRANSLATION_IDENTITY).toContain('TUYỆT ĐỐI KHÔNG PHẢI TÓM TẮT');
        expect(BASE_TRANSLATION_IDENTITY).toContain('PHẢI giữ nguyên 100% số từ/ý của bản gốc');
        expect(BASE_TRANSLATION_IDENTITY).toContain('TUYỆT ĐỐI KHÔNG được lược bớt, rút gọn, diễn giải lại hay tóm tắt');
    });

    it('liệt kê rõ các trường hợp CẤM gộp (đoạn văn trọn ý, lượt thoại riêng, chuyển cảnh)', () => {
        expect(BASE_TRANSLATION_IDENTITY).toContain('TUYỆT ĐỐI KHÔNG gộp các trường hợp sau');
        expect(BASE_TRANSLATION_IDENTITY).toContain('mỗi lượt thoại trong ngoặc kép');
        expect(BASE_TRANSLATION_IDENTITY).toContain('chuyển cảnh/xuống dòng ngắt nhịp có chủ đích');
    });

    it('khi phân vân thì ưu tiên giữ nguyên, không gộp nhầm', () => {
        expect(BASE_TRANSLATION_IDENTITY).toContain('ưu tiên GIỮ NGUYÊN, không gộp nhầm');
    });
});

describe('DEFAULT_PROMPT / generateBasePrompt — quy tắc gộp dòng rác có mặt ngay từ đầu phiên', () => {
    it('DEFAULT_PROMPT (khởi tạo phiên mới, chưa Reset/Tối Ưu) đã chứa quy tắc gộp dòng rác mới', () => {
        expect(DEFAULT_PROMPT).toContain('GỘP DÒNG RÁC BỊ GÃY');
        expect(DEFAULT_PROMPT).toContain('TUYỆT ĐỐI KHÔNG PHẢI TÓM TẮT');
    });

    it('generateBasePrompt (dùng khi Reset Prompt) cũng chứa quy tắc gộp dòng rác mới', () => {
        const prompt = generateBasePrompt(['Đô Thị'], ['Hiện đại/Đô thị'], true);
        expect(prompt).toContain('GỘP DÒNG RÁC BỊ GÃY');
        expect(prompt).toContain('TUYỆT ĐỐI KHÔNG PHẢI TÓM TẮT');
    });
});
