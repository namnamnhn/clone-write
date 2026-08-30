import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
    wrapAiClientWithTaggedKeyErrors,
} from '../src/services/api/gemini';
import { quotaManager } from '../src/utils/quotaManager';
import { MODEL_CONFIGS } from '../src/constants';

// ============================================================================
// FIX67 — kiểm chứng 3 đề xuất cải thiện đã triển khai (từ cuối log fix65/fix66):
//  1. (fix65) Gắn id key THỰC TẾ vào mọi lỗi SDK qua wrapper client -> ghi nhận quota-per-key
//     đúng key đã gọi thật kể cả khi batch song song chen scope.
//  2. (fix65) getPerKeySummary phục vụ chip usage theo key ở Header (bản Lite).
// ============================================================================

describe('FIX67-1 — wrapAiClientWithTaggedKeyErrors', () => {
    const KEY_ID = 'k12abc_wxyz';

    it('lỗi từ generateContent mang __qkKeyId = key thực tế', async () => {
        const boom = new Error('server error');
        const fakeAi: any = {
            models: { generateContent: async () => { throw boom; } }
        };
        const wrapped = wrapAiClientWithTaggedKeyErrors(fakeAi, KEY_ID);
        await expect(wrapped.models.generateContent({ model: 'm' })).rejects.toMatchObject({
            __qkKeyId: KEY_ID,
            message: 'server error'
        });
    });

    it('lỗi GIỮA LUỒNG streaming cũng được gắn tag key', async () => {
        const midStream = new Error('mid-stream failure');
        const fakeAi: any = {
            models: {
                generateContentStream: async () => ({
                    stream: {
                        [Symbol.asyncIterator]: () => ({
                            next: async () => { throw midStream; }
                        })
                    }
                })
            }
        };
        const wrapped = wrapAiClientWithTaggedKeyErrors(fakeAi, KEY_ID);
        const res = await wrapped.models.generateContentStream({ model: 'm', contents: 'x' });
        const it = res.stream[Symbol.asyncIterator]();
        await expect(it.next()).rejects.toMatchObject({ __qkKeyId: KEY_ID });
    });

    it('result stream giữ nguyên các property khác (vd response)', async () => {
        let call = 0;
        const fakeAi: any = {
            models: {
                generateContentStream: async () => ({
                    response: Promise.resolve('RESP'),
                    stream: {
                        [Symbol.asyncIterator]: () => ({
                            next: async () => ({ value: ++call, done: false })
                        })
                    }
                })
            }
        };
        const wrapped = wrapAiClientWithTaggedKeyErrors(fakeAi, KEY_ID);
        const res = await wrapped.models.generateContentStream({});
        await expect(res.response).resolves.toBe('RESP');
        const it = res.stream[Symbol.asyncIterator]();
        expect((await it.next()).value).toBe(1);
    });

    it('không có keyId (bản Full) -> trả nguyên client, KHÔNG bọc Proxy', () => {
        const fakeAi: any = { models: {} };
        expect(wrapAiClientWithTaggedKeyErrors(fakeAi, undefined)).toBe(fakeAi);
    });
});

describe('FIX67-2 — quotaManager.getPerKeySummary (chip usage theo key ở Header)', () => {
    const modelId = MODEL_CONFIGS[0].id;
    const rpdLimit = MODEL_CONFIGS[0].rpdLimit;

    beforeEach(() => {
        quotaManager.__setPerKeyEnabledForTests(true);
        quotaManager.reset();
        quotaManager.registerApiKeys(['ka_zzz9', 'kb_yyy8']);
    });

    afterAll(() => {
        quotaManager.__setPerKeyEnabledForTests(false);
        quotaManager.reset();
    });

    it('trả usage từng key đúng định danh 4 ký tự cuối + ngưỡng RPD của model', () => {
        for (let i = 0; i < 3; i++) quotaManager.recordSuccess(modelId, 'ka_zzz9');
        const s = quotaManager.getPerKeySummary(modelId);
        expect(s).toHaveLength(2);
        expect(s[0]).toMatchObject({ label: '…zzz9', requestsToday: 3, rpdLimit, isDepleted: false });
        expect(s[1]).toMatchObject({ label: '…yyy8', requestsToday: 0 });
    });

    it('key cạn/hết hạn RPD riêng -> isDepleted=true để Header tô đỏ', () => {
        quotaManager.markAsDepleted(modelId, 'kb_yyy8');
        const s = quotaManager.getPerKeySummary(modelId);
        expect(s.find(x => x.label === '…yyy8')?.isDepleted).toBe(true);
        expect(s.find(x => x.label === '…zzz9')?.isDepleted).toBe(false);
    });

    it('chạm đúng trần RPD riêng (chưa bị đánh dấu) -> tự coi là depleted', () => {
        for (let i = 0; i < rpdLimit; i++) quotaManager.recordSuccess(modelId, 'ka_zzz9');
        const s = quotaManager.getPerKeySummary(modelId);
        expect(s.find(x => x.label === '…zzz9')?.isDepleted).toBe(true);
    });

    it('không ở chế độ per-key (bản Full) -> mảng rỗng, Header không vẽ gì', () => {
        quotaManager.__setPerKeyEnabledForTests(false);
        expect(quotaManager.getPerKeySummary(modelId)).toEqual([]);
        quotaManager.__setPerKeyEnabledForTests(true);
    });
});
