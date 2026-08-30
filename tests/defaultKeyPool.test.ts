import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IS_LITE } from '../src/constants';

// fix69 (bản Full 6 Tháng/1 Năm — quản lý API Key chuyên nghiệp hơn): trước đây getAiClient()
// của bản Full chỉ dùng ĐÚNG 1 key duy nhất mỗi phiên (`process.env.GEMINI_API_KEY ||
// userGeminiKeys[0]`) và quotaManager.registerApiKeys() luôn nhận mảng RỖNG cho bản Full ->
// quota-per-key (fix65) chỉ thực sự chạy ở Lite. Giờ gemini.ts gộp 1 "hồ bơi hiệu lực" =
// [key mặc định nhúng qua biến môi trường build?] + [key cá nhân...], đăng ký ĐÚNG hồ bơi này
// với quotaManager cho CẢ 2 bản. Bản Lite VẪN từ chối key nhúng (IS_LITE luôn khoá cứng
// DEFAULT_GEMINI_API_KEY = undefined trong gemini.ts) nên file này rẽ nhánh theo IS_LITE để
// đúng với cả 3 gói build (1 Năm/6 Tháng dùng chung nhánh Full, Lite dùng nhánh riêng) mà
// không cần 3 bộ test khác nhau.
//
// Dùng vi.resetModules() + import động để mô phỏng build có/không có GEMINI_API_KEY nhúng sẵn
// mà không cần build lại app thật.
describe('gemini.ts — hồ bơi API Key hiệu lực (fix69)', () => {
    const ORIGINAL_ENV = process.env.GEMINI_API_KEY;

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        if (ORIGINAL_ENV === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = ORIGINAL_ENV;
    });

    it(IS_LITE
        ? 'bản Lite: luôn từ chối key nhúng dù biến môi trường build có set -> hasDefaultGeminiKey() false'
        : 'bản Full: có key mặc định nhúng sẵn -> hasDefaultGeminiKey() true, hồ bơi UI có đúng 1 mục "Mặc định"', async () => {
        process.env.GEMINI_API_KEY = 'AIzaSyTESTDEFAULTKEY0000';
        const gemini = await import('../src/services/api/gemini');
        if (IS_LITE) {
            expect(gemini.hasDefaultGeminiKey()).toBe(false);
            expect(gemini.getGeminiKeyPoolForUi()).toHaveLength(0);
            return;
        }
        expect(gemini.hasDefaultGeminiKey()).toBe(true);
        const pool = gemini.getGeminiKeyPoolForUi();
        expect(pool).toHaveLength(1);
        expect(pool[0].isDefault).toBe(true);
        expect(pool[0].maskedTail).toBe('0000');
    });

    it('thêm key cá nhân -> hồ bơi UI gồm key mặc định (nếu build Full có) CỘNG key cá nhân, không bị thay thế hẳn', async () => {
        process.env.GEMINI_API_KEY = 'AIzaSyTESTDEFAULTKEY1111';
        const gemini = await import('../src/services/api/gemini');
        const { quotaManager } = await import('../src/utils/quotaManager');
        gemini.setUserGeminiKeys('AIzaSyPERSONALKEYAAAA\nAIzaSyPERSONALKEYBBBB');
        const pool = gemini.getGeminiKeyPoolForUi();
        const expectedLen = IS_LITE ? 2 : 3;
        expect(pool).toHaveLength(expectedLen);
        if (!IS_LITE) {
            expect(pool[0].isDefault).toBe(true);
        }
        expect(pool.filter(k => !k.isDefault)).toHaveLength(2);
        expect(quotaManager.getApiKeyIds()).toHaveLength(expectedLen);
    });

    it('build không nhúng key mặc định (biến môi trường trống) -> hasDefaultGeminiKey() false, hồ bơi chỉ có key cá nhân', async () => {
        delete process.env.GEMINI_API_KEY;
        const gemini = await import('../src/services/api/gemini');
        expect(gemini.hasDefaultGeminiKey()).toBe(false);
        gemini.setUserGeminiKeys('AIzaSyONLYPERSONALKEY');
        const pool = gemini.getGeminiKeyPoolForUi();
        expect(pool).toHaveLength(1);
        expect(pool[0].isDefault).toBe(false);
    });

    it(IS_LITE
        ? 'bản Lite: chưa nhập key cá nhân -> getAiClient() vẫn báo lỗi yêu cầu cấu hình (không có key mặc định để tự nạp)'
        : 'bản Full: chưa thêm key cá nhân nào -> getAiClient() vẫn dùng được ngay bằng key mặc định (không cần cấu hình gì thêm)', async () => {
        process.env.GEMINI_API_KEY = 'AIzaSyTESTDEFAULTKEY3333';
        const gemini = await import('../src/services/api/gemini');
        if (IS_LITE) {
            expect(() => gemini.getAiClient()).toThrow();
        } else {
            expect(() => gemini.getAiClient()).not.toThrow();
        }
    });

    it('quota-per-key: key mặc định (bản Full) tiếp tục được xoay vòng CÙNG key cá nhân, không bị bỏ rơi', async () => {
        if (IS_LITE) return; // Không áp dụng — Lite không có key mặc định
        process.env.GEMINI_API_KEY = 'AIzaSyTESTDEFAULTKEY2222';
        const gemini = await import('../src/services/api/gemini');
        const { quotaManager } = await import('../src/utils/quotaManager');
        const { MODEL_CONFIGS } = await import('../src/constants');
        gemini.setUserGeminiKeys('AIzaSyPERSONALKEYCCCC');
        quotaManager.setEnabledModels(MODEL_CONFIGS.map(m => m.id));
        const modelId = MODEL_CONFIGS[0].id;
        const picks = new Set<string | null>();
        for (let i = 0; i < 10; i++) picks.add(quotaManager.pickApiKeyForModel(modelId));
        // Round-robin đều qua đúng 2 key (mặc định + cá nhân) -> cả 2 phải xuất hiện, không có
        // chuyện key mặc định bị loại khỏi vòng xoay chỉ vì đã có key cá nhân.
        expect(picks.size).toBe(2);
    });

    it('key mặc định (bản Full) chạm RPD riêng -> chỉ riêng nó bị loại, key cá nhân vẫn dùng được (model chưa cạn)', async () => {
        if (IS_LITE) return; // Không áp dụng — Lite không có key mặc định
        process.env.GEMINI_API_KEY = 'AIzaSyTESTDEFAULTKEY4444';
        const gemini = await import('../src/services/api/gemini');
        const { quotaManager } = await import('../src/utils/quotaManager');
        const { MODEL_CONFIGS } = await import('../src/constants');
        gemini.setUserGeminiKeys('AIzaSyPERSONALKEYDDDD');
        quotaManager.setEnabledModels(MODEL_CONFIGS.map(m => m.id));
        const modelId = MODEL_CONFIGS[0].id;
        const defaultKeyId = gemini.getGeminiKeyPoolForUi().find(k => k.isDefault)!.id;
        quotaManager.markAsDepleted(modelId, defaultKeyId);
        expect(quotaManager.isModelDepleted(modelId)).toBe(false); // còn key cá nhân
        expect(quotaManager.pickApiKeyForModel(modelId)).not.toBe(defaultKeyId);
    });

    // fix70 (C.1): ApiSettingsModal.tsx đối chiếu badge quota với từng key bằng cách so khớp
    // `…${maskedTail}` (từ getGeminiKeyPoolForUi) với `label` (từ getPerKeySummary) — khoá lại
    // hợp đồng định dạng này bằng test để tránh 1 trong 2 hàm đổi format label mà không ai để ý,
    // làm badge UI âm thầm không khớp được key nào (không lỗi rõ ràng, chỉ mất tính năng).
    it('nhãn getPerKeySummary() khớp ĐÚNG định dạng "…" + maskedTail của getGeminiKeyPoolForUi() (hợp đồng dùng bởi badge UI C.1)', async () => {
        if (IS_LITE) return; // Không áp dụng — badge C.1 chỉ hiện ở bản Full
        process.env.GEMINI_API_KEY = 'AIzaSyTESTDEFAULTKEY5555';
        const gemini = await import('../src/services/api/gemini');
        const { quotaManager } = await import('../src/utils/quotaManager');
        const { MODEL_CONFIGS } = await import('../src/constants');
        gemini.setUserGeminiKeys('AIzaSyPERSONALKEYEEEE');
        quotaManager.setEnabledModels(MODEL_CONFIGS.map(m => m.id));
        const modelId = MODEL_CONFIGS[0].id;
        const pool = gemini.getGeminiKeyPoolForUi();
        expect(pool.length).toBeGreaterThan(0);
        const summary = quotaManager.getPerKeySummary(modelId);
        expect(summary).toHaveLength(pool.length);
        for (const entry of pool) {
            const matched = summary.find(s => s.label === `…${entry.maskedTail}`);
            expect(matched, `Không tìm thấy badge quota khớp key ${entry.label} (…${entry.maskedTail})`).toBeDefined();
        }
    });
});
