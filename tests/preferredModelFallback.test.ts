import { describe, it, expect, beforeEach } from 'vitest';
import { quotaManager } from '../src/utils/quotaManager';
import { MODEL_CONFIGS } from '../src/constants';

// FIX (báo cáo người dùng): khi model ƯU TIÊN (preferredModelId, vd gemini-3.1-pro-preview ở
// tier "normal") dính 429/RPM cooldown DÀI, bản cũ luôn return null bắt smartExecution
// (gemini.ts) vòng lặp "Hệ thống đang điều phối tải (Chờ xen kẽ)" mỗi 2s cho tới khi cooldown
// hết HOẶC cạn hẳn 50 lượt thử rồi báo lỗi dừng batch — dù các model dự phòng cùng pool (vd
// gemini-3.7-flash, gemini-3.6-flash) đang HOÀN TOÀN RẢNH suốt thời gian đó. Nay chỉ ép chờ
// đúng preferred khi cooldown còn NGẮN (<=15s); dài hơn thì rớt xuống chọn model dự phòng sẵn
// sàng ngay.
describe('quotaManager.getBestModelForTask — preferred model cooldown dài phải fallback', () => {
    const [proId, flashId, flash2Id] = MODEL_CONFIGS.map(m => m.id);

    beforeEach(() => {
        quotaManager.reset();
        quotaManager.setEnabledModels(MODEL_CONFIGS.map(m => m.id));
    });

    it('preferred model sẵn sàng -> luôn chọn đúng preferred', () => {
        const id = quotaManager.getBestModelForTask([proId, flashId], [], proId);
        expect(id).toBe(proId);
    });

    it('preferred model cooldown NGẮN (<=15s) -> vẫn trả null để chờ đúng preferred (giữ đúng thiết kế fix61)', () => {
        quotaManager.recordRateLimit(proId, 5000); // 5s
        const id = quotaManager.getBestModelForTask([proId, flashId], [], proId);
        expect(id).toBeNull();
    });

    it('preferred model cooldown DÀI (>15s) -> fallback ngay sang model dự phòng đang sẵn sàng, KHÔNG trả null', () => {
        quotaManager.recordRateLimit(proId, 30000); // 30s — dài hơn ngưỡng 15s
        const id = quotaManager.getBestModelForTask([proId, flashId, flash2Id], [], proId);
        expect(id).not.toBeNull();
        expect(id).not.toBe(proId);
        expect([flashId, flash2Id]).toContain(id);
    });

    it('preferred model cooldown DÀI nhưng KHÔNG có model dự phòng nào sẵn sàng -> vẫn trả null (chờ, không còn lựa chọn khác)', () => {
        quotaManager.recordRateLimit(proId, 30000);
        quotaManager.recordRateLimit(flashId, 30000);
        const id = quotaManager.getBestModelForTask([proId, flashId], [], proId);
        expect(id).toBeNull();
    });
});
