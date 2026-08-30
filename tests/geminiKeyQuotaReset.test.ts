import { describe, it, expect, beforeEach } from 'vitest';
import { setUserGeminiKeys } from '../src/services/api/gemini';
import { quotaManager } from '../src/utils/quotaManager';
import { MODEL_CONFIGS } from '../src/constants';

// FIX (báo cáo người dùng — bản Lite): "đã chèn API Key Gemini hợp lệ, key không lỗi, nhưng
// app không gọi được model nào". Nguyên nhân: quotaManager đánh dấu 1 model "hết Quota/depleted"
// dùng CHUNG cho MỌI key cá nhân đã nhập (không phân biệt key nào gây lỗi), chỉ tự reset 1
// lần/ngày. Nếu 1 key CŨ từng khiến model X bị đánh dấu depleted trong ngày, dán vào 1 key MỚI
// hoàn toàn (còn nguyên quota) vẫn bị coi là "đã cạn" cho tới nửa đêm — không lỗi nào hiện ra ở
// bước nhập key. Fix: setUserGeminiKeys() reset lại trạng thái depleted/cooldown khi danh sách
// key THỰC SỰ thay đổi.
describe('setUserGeminiKeys — reset trạng thái depleted khi đổi sang key cá nhân mới', () => {
    const sampleModelId = MODEL_CONFIGS[0].id;

    beforeEach(() => {
        // Trạng thái sạch trước mỗi test
        setUserGeminiKeys('');
    });

    it('model bị đánh dấu depleted với key cũ vẫn depleted nếu key KHÔNG đổi', () => {
        setUserGeminiKeys('key-A');
        quotaManager.markAsDepleted(sampleModelId);
        expect(quotaManager.isModelDepleted(sampleModelId)).toBe(true);

        // Gọi lại với CÙNG 1 key (vd re-render/gõ lại y hệt) — KHÔNG được tự ý reset
        setUserGeminiKeys('key-A');
        expect(quotaManager.isModelDepleted(sampleModelId)).toBe(true);
    });

    it('đổi sang key cá nhân MỚI thực sự khác -> reset cờ depleted của model', () => {
        setUserGeminiKeys('key-A');
        quotaManager.markAsDepleted(sampleModelId);
        expect(quotaManager.isModelDepleted(sampleModelId)).toBe(true);

        // Người dùng xoá key cũ, dán key MỚI hoàn toàn khác
        setUserGeminiKeys('key-B-hoan-toan-moi');
        expect(quotaManager.isModelDepleted(sampleModelId)).toBe(false);
    });

    it('không reset nếu chuỗi key rỗng (chưa nhập key nào)', () => {
        setUserGeminiKeys('key-A');
        quotaManager.markAsDepleted(sampleModelId);
        setUserGeminiKeys(''); // xoá hết key -> không có key mới nào để "cho cơ hội"
        expect(quotaManager.isModelDepleted(sampleModelId)).toBe(true);
    });
});
