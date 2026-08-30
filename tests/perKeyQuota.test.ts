import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { quotaManager } from '../src/utils/quotaManager';
import { MODEL_CONFIGS } from '../src/constants';

// fix65 (quota-per-key, ban đầu CHỈ bản Lite): trước đây toàn bộ trạng thái quota/depleted/
// cooldown của 1 model Gemini là DÙNG CHUNG cho MỌI API key cá nhân. Chỉ cần 1 key hết
// quota/dính 429 là cả model bị khoá/chờ — các key còn nguyên quota bị đì theo tới nửa đêm.
// Sau khi bật chế độ per-key:
//   - 429/cooldown/depleted là trạng thái RIÊNG CỦA TỪNG KEY (model chỉ cạn khi TẤT CẢ key cạn)
//   - pickApiKeyForModel xoay vòng bỏ qua key đang nghỉ/hết hạn
// fix69: bản Full (6 Tháng/1 Năm) giờ CŨNG bật per-key mặc định (hồ bơi = key mặc định + key
// cá nhân, xem gemini.ts) — không còn "per-key tắt = bản Full" như trước. Cờ perKeyEnabled chỉ
// còn bị ép tắt thủ công trong describe con cuối file để xác nhận nhánh dự phòng "dùng chung"
// vẫn hoạt động đúng nếu cần.
describe('quotaManager — chế độ QUOTA-PER-KEY (mặc định BẬT cho cả 2 bản từ fix69)', () => {
    const modelId = MODEL_CONFIGS[0].id; // model bất kỳ trong config (pro ở bản Full / flash ở Lite)
    const rpdLimit = MODEL_CONFIGS[0].rpdLimit;
    const KEY_A = 'ka_aaaa';
    const KEY_B = 'kb_bbbb';
    const KEY_C = 'kc_cccc';

    beforeEach(() => {
        quotaManager.__setPerKeyEnabledForTests(true);
        quotaManager.reset();
        quotaManager.registerApiKeys([KEY_A, KEY_B, KEY_C]);
        quotaManager.setEnabledModels(MODEL_CONFIGS.map(m => m.id));
    });

    afterAll(() => {
        // fix69: trạng thái mặc định thật của runtime giờ là true (cả 2 bản) — trả lại true
        // (không phải false) để không ảnh hưởng các test file khác chạy sau, vốn không tự
        // gọi __setPerKeyEnabledForTests và mong đợi hành vi mặc định của quotaManager thật.
        quotaManager.__setPerKeyEnabledForTests(true);
        quotaManager.reset();
    });

    it('deplete 1 key KHÔNG làm model cạn — các key khác vẫn dùng được', () => {
        quotaManager.markAsDepleted(modelId, KEY_A);
        expect(quotaManager.isModelDepleted(modelId)).toBe(false);

        quotaManager.markAsDepleted(modelId, KEY_B);
        expect(quotaManager.isModelDepleted(modelId)).toBe(false);

        quotaManager.markAsDepleted(modelId, KEY_C);
        expect(quotaManager.isModelDepleted(modelId)).toBe(true); // tất cả key đều cạn
    });

    it('cooldown per-key: key A nghỉ không cản trở key B được chọn ngay', () => {
        quotaManager.recordRateLimit(modelId, 60000, KEY_A);
        // Còn B, C nguyên trạng thái -> vẫn có key usable NGAY
        expect(quotaManager.hasUsableApiKeyFor(modelId)).toBe(true);
        expect(quotaManager.getApiKeyWaitForModel(modelId)).toBe(0); // đã có key rảnh -> chờ 0
        expect(quotaManager.pickApiKeyForModel(modelId)).not.toBe(KEY_A);
        expect([KEY_B, KEY_C]).toContain(quotaManager.pickApiKeyForModel(modelId));

        // Khi CẢ 3 key cùng bị cho nghỉ -> lúc đó mới có thời gian chờ dương (= min các cooldown)
        quotaManager.recordRateLimit(modelId, 30000, KEY_B);
        quotaManager.recordRateLimit(modelId, 20000, KEY_C);
        expect(quotaManager.hasUsableApiKeyFor(modelId)).toBe(false);
        const wait = quotaManager.getApiKeyWaitForModel(modelId);
        expect(wait).toBeGreaterThan(0);
        expect(wait).toBeLessThanOrEqual(20000); // bằng cooldown ngắn nhất còn lại (KEY_C)
    });

    it('pickApiKeyForModel xoay vòng round-robin qua các key usable', () => {
        const picks = [quotaManager.pickApiKeyForModel(modelId), quotaManager.pickApiKeyForModel(modelId), quotaManager.pickApiKeyForModel(modelId)];
        expect(new Set(picks).size).toBe(3); // đủ 3 key khác nhau
    });

    it('chạm RPD riêng của 1 key -> key đó bị bỏ qua, model vẫn còn dùng được', () => {
        for (let i = 0; i < rpdLimit; i++) {
            quotaManager.recordSuccess(modelId, KEY_A);
        }
        expect(quotaManager.getRequestsTodayFor(modelId, KEY_A)).toBe(rpdLimit);
        expect(quotaManager.isModelDepleted(modelId)).toBe(false); // còn 2 key nguyên quota
        expect(quotaManager.pickApiKeyForModel(modelId)).not.toBe(KEY_A);
    });

    it('thang lỗi 429 chạy RIÊNG từng key: lỗi liên tục của key A không đội số của key B', () => {
        quotaManager.recordQuotaError(modelId, KEY_A);
        quotaManager.recordQuotaError(modelId, KEY_A);
        expect(quotaManager.getConsecutiveQuotaErrorsFor(modelId, KEY_A)).toBe(2);
        expect(quotaManager.getConsecutiveQuotaErrorsFor(modelId, KEY_B)).toBe(0);
        // recordSuccess reset đúng counter của riêng key đó
        quotaManager.recordSuccess(modelId, KEY_A);
        expect(quotaManager.getConsecutiveQuotaErrorsFor(modelId, KEY_A)).toBe(0);
    });

    it('registerApiKeys dọn state của key đã bị xoá khỏi danh sách', () => {
        quotaManager.markAsDepleted(modelId, KEY_B);
        quotaManager.registerApiKeys([KEY_A, KEY_C]); // bỏ KEY_B
        expect(quotaManager.getApiKeyIds()).toEqual([KEY_A, KEY_C]);
        expect(quotaManager.pickApiKeyForModel(modelId)).not.toBe(KEY_B);
        // KEY_B không còn -> model không thể bị coi là cạn vì state nó đã biến mất
        expect(quotaManager.isModelDepleted(modelId)).toBe(false);
    });

    it('resetDailyQuotas lật lại toàn bộ sổ per-key (mới ngày mới, key hồi phục)', () => {
        quotaManager.markAsDepleted(modelId, KEY_A);
        quotaManager.markAsDepleted(modelId, KEY_B);
        quotaManager.markAsDepleted(modelId, KEY_C);
        expect(quotaManager.isModelDepleted(modelId)).toBe(true);
        quotaManager.resetDailyQuotas();
        expect(quotaManager.isModelDepleted(modelId)).toBe(false);
    });

    describe('khi PER-KEY bị TẮT thủ công (đường dự phòng — fix69: bản Full mặc định BẬT per-key, không còn khớp mô tả cũ; test này chỉ còn xác nhận nhánh "dùng chung" vẫn hoạt động đúng nếu perKeyEnabled bị ép false)', () => {
        beforeEach(() => {
            quotaManager.__setPerKeyEnabledForTests(false);
            quotaManager.reset();
            quotaManager.setEnabledModels(MODEL_CONFIGS.map(m => m.id));
        });

        it('markAsDepleted với keyId vẫn đánh dấu TOÀN model (dùng chung như cũ)', () => {
            quotaManager.registerApiKeys([KEY_A]); // chỉ ghi nhận danh sách, KHÔNG kích hoạt per-key
            expect(quotaManager.pickApiKeyForModel(modelId)).toBeNull();
            quotaManager.markAsDepleted(modelId, KEY_A);
            expect(quotaManager.isModelDepleted(modelId)).toBe(true);
            expect(quotaManager.hasUsableApiKeyFor(modelId)).toBe(false);
            expect(quotaManager.getApiKeyWaitForModel(modelId)).toBe(0);
        });

        it('recordRateLimit với keyId vẫn cooldown TOÀN model (dùng chung như cũ)', () => {
            quotaManager.recordRateLimit(modelId, 30000, KEY_A);
            expect(quotaManager.getWaitTimeForModel(modelId)).toBeGreaterThan(0);
        });
    });
});
