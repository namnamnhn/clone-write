import { describe, it, expect } from 'vitest';
import { createKeyManager } from '../src/services/api/keyManagerFactory';

const KEYS = ['sk-aaaaaaaaaaaaaaaa1234', 'sk-bbbbbbbbbbbbbbbb5678', 'sk-cccccccccccccccc9012'];

describe('createKeyManager', () => {
    it('syncKeys: key đầu Active, còn lại Pending, mask đúng định dạng', () => {
        const km = createKeyManager('Test', ['429']);
        km.syncKeys(KEYS.join(','));
        const st = km.getKeyStatuses();
        expect(st).toHaveLength(3);
        expect(st[0].status).toBe('Active');
        expect(st[1].status).toBe('Pending');
        // fix65 (bảo mật hiển thị): mask CHỈ hiện 4 ký tự cuối, không lộ 8 ký tự đầu như trước
        expect(st[0].maskedKey).toMatch(/^••••••1234$/);
    });

    it('syncKeys không làm gì khi chuỗi key không đổi', () => {
        const km = createKeyManager('Test', ['429']);
        km.syncKeys(KEYS[0]);
        const before = km.getCurrentKeyInfo()!.successCount;
        km.reportSuccess();
        km.syncKeys(KEYS[0]);
        expect(km.getCurrentKeyInfo()!.successCount).toBe(before + 1);
    });

    it('reportError lỗi quota -> Exhausted + tự xoay sang key kế', () => {
        const km = createKeyManager('Test', ['429']);
        km.syncKeys(KEYS.join(','));
        km.reportError('HTTP 429 Too Many Requests');
        expect(km.getKeyStatuses()[0].status).toBe('Exhausted');
        expect(km.getCurrentKey()).toBe(KEYS[1]);
    });

    it('reportError thường (không phải 429) chỉ đánh Error, không xoay vòng', () => {
        const km = createKeyManager('Test', ['rate limit']);
        km.syncKeys(KEYS.join(','));
        km.reportError('Network timeout');
        expect(km.getKeyStatuses()[0].status).toBe('Error');
        expect(km.getCurrentKey()).toBe(KEYS[0]);
    });

    it('marker riêng theo nhà cung cấp: DeepSeek nhận "insufficient balance"', () => {
        const km = createKeyManager('DeepSeek', ['429', 'insufficient balance']);
        km.syncKeys(KEYS.join(','));
        km.reportError('This account has insufficient balance');
        expect(km.getCurrentKey()).toBe(KEYS[1]);
    });

    it('xoay vòng hết tất cả -> reset về Pending rồi Active lại', () => {
        const km = createKeyManager('Test', ['429']);
        km.syncKeys(KEYS.join(','));
        km.reportError('429');
        km.reportError('429');
        km.reportError('429'); // xoay về key 0, mọi key đã Exhausted -> reset
        expect(km.getKeyStatuses().every(s => s.status !== 'Exhausted')).toBe(true);
        expect(km.getCurrentKey()).toBe(KEYS[0]);
    });

    it('chỉ có 1 key: rotateToNext trả false, không đổi trạng thái', () => {
        const km = createKeyManager('Test', ['429']);
        km.syncKeys(KEYS[0]);
        expect(km.rotateToNext()).toBe(false);
        expect(km.getCurrentKey()).toBe(KEYS[0]);
    });

    it('reportSuccess hồi phục key từ trạng thái Error/Exhausted về Active', () => {
        const km = createKeyManager('Test', ['429']);
        km.syncKeys(KEYS[0] + ',' + KEYS[1]);
        km.reportError('429');
        km.switchToKey(0);
        km.reportSuccess();
        expect(km.getKeyStatuses()[0].status).toBe('Active');
    });
});
