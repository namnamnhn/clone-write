import { describe, expect, it } from 'vitest';
import { IS_LITE, MODEL_CONFIGS } from '../src/constants';
import { getEffectiveModelsForTier, getRequiredSupportModels, getSelectableTranslationModels, loadTranslationModelSelection, sanitizeTranslationModelSelection, saveTranslationModelSelection } from '../src/services/workflows/translate/modelSelection';
import type { TranslationTier } from '../src/types';

const makeStorage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };

describe('lựa chọn model dịch theo tier', () => {
    const tier: TranslationTier = IS_LITE ? 'flash' : 'normal';
    it('giữ đúng thứ tự ưu tiên và không cho danh sách rỗng', () => {
        const allowed = getSelectableTranslationModels(tier);
        expect(allowed.length).toBeGreaterThan(1);
        const lastAllowed = allowed[allowed.length - 1];
        expect(sanitizeTranslationModelSelection(tier, [])).toEqual([allowed[0]]);
        expect(sanitizeTranslationModelSelection(tier, [lastAllowed, allowed[0]])).toEqual([allowed[0], lastAllowed]);
        if (!IS_LITE) expect(allowed).toEqual(['gemini-3.1-pro-preview', 'gemini-3.7-flash']);
    });
    it('lưu và đọc lựa chọn riêng của chế độ', () => {
        const storage = makeStorage(); const allowed = getSelectableTranslationModels(tier);
        expect(saveTranslationModelSelection(tier, [allowed[1]], storage)).toEqual([allowed[1]]);
        expect(loadTranslationModelSelection(tier, storage)).toEqual([allowed[1]]);
    });
    it('không tự gọi ngược model đã bị loại khỏi pool dịch', () => {
        const allowed = getSelectableTranslationModels(tier);
        expect(getEffectiveModelsForTier(tier, 'translate', [allowed[0]])).toEqual([allowed[0]]);
        expect(getEffectiveModelsForTier(tier, 'translate', ['gemini-3.1-flash-lite-image'])).toEqual([]);
    });
    it('tự chuẩn bị đủ model hậu kiểm, Auto-Fix và Safety đang tồn tại trong edition', () => {
        const supportModels = getRequiredSupportModels(tier); const available = new Set(MODEL_CONFIGS.map(model => model.id));
        expect(supportModels).toContain('gemini-3.5-flash-lite');
        expect(supportModels).toContain('gemma-4-31b-it');
        expect(supportModels.every(id => available.has(id))).toBe(true);
    });
    it('Smart Fix Pro khoá đúng Gemini 3.1 Pro', () => { expect(getEffectiveModelsForTier(tier, 'smart_fix', MODEL_CONFIGS.map(model => model.id))).toEqual(['gemini-3.1-pro-preview']); });
});
