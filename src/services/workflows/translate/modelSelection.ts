// Picks which Gemini/DeepSeek models to use for a given tier + task type
// (translate / auto_fix / smart_fix), respecting the user's enabled-models
// list. Split out of the old monolithic `translator.ts` — logic unchanged.
import { MODEL_CONFIGS, IS_LITE } from '../../../constants';
import { TranslationTier } from '../../../types';

const PRO_MODEL = 'gemini-3.1-pro-preview';

export const getEffectiveModelsForTier = (
    tier: TranslationTier,
    taskType: 'translate' | 'auto_fix' | 'smart_fix',
    enabledModels: string[] = MODEL_CONFIGS.map(m => m.id)
): string[] => {
    // Bản Lite chỉ còn Flash/Lite/DeepSeek — tier khác (Normal/Pro/Full đều dính model
    // Pro đã xoá) tự quy về Flash phòng hờ caller cũ còn truyền vào.
    if (IS_LITE && tier !== 'flash' && tier !== 'lite' && tier !== 'deepseek') {
        tier = 'flash';
    }
    // Utility to strictly filter enabled models to prevent calling disabled ones.
    const filterModels = (models: string[]) => models.filter(id => enabledModels.includes(id) || enabledModels.length === 0);
    
    const getFallback = (defaultModels: string[]) => {
        const matchingModels = filterModels(defaultModels);
        if (matchingModels.length > 0) return matchingModels;
        // Danh sách bật không rỗng nghĩa là người dùng đã chọn lọc rõ ràng. Không gọi ngược
        // model đã tắt; caller sẽ dừng với thông báo nếu không còn model phù hợp.
        return enabledModels.length === 0 ? defaultModels : [];
    };

    // RULE 1: Smart Fix Button always uses Pro Models (Explicit user request, except Lite tier)
    if (taskType === 'smart_fix') {
        if (tier === 'lite') {
            return getFallback(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
        }
        if (tier === 'deepseek') {
            const deepseekModels = enabledModels.filter(m => m.startsWith('deepseek:'));
            if (deepseekModels.length > 0) return deepseekModels;
            return ['deepseek:deepseek-v4-flash'];
        }
        return getFallback([PRO_MODEL]);
    }

    // RULE 2: Pro Tier
    // - Translate: 3.1 Pro
    // - Auto Fix: model Flash mới nhất
    if (tier === 'pro') {
        if (taskType === 'translate') {
            return getFallback([PRO_MODEL]);
        } else {
            return getFallback(['gemini-3.8-flash']);
        }
    }

    // RULE 3: Normal Tier
    // - Translate: 3.1 Pro > 3.8 Flash > 3.7 Flash
    // - Auto Fix: 3.5 Flash > 3.0 Flash > 3.5 Flash Lite > 3.1 Flash Lite
    if (tier === 'normal') {
        if (taskType === 'translate') {
            return getFallback([PRO_MODEL, 'gemini-3.8-flash', 'gemini-3.7-flash']);
        } else {
            return getFallback(['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
        }
    }

    // RULE 4: Full Tier
    // - Translate: 3.1 Pro > 3.8 Flash > 3.7 Flash > 3.6 Flash > 3.0 Flash
    // - Auto Fix: 3.5 Flash > 3.5 Flash Lite > 3.1 Flash Lite
    if (tier === 'full') {
        if (taskType === 'translate') {
            return getFallback([PRO_MODEL, 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview']);
        } else {
            return getFallback(['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
        }
    }

    // RULE 5: Flash Tier
    // - Translate: 3.8 Flash > 3.7 Flash > 3.6 Flash > 3.0 Flash
    // - Auto Fix: 3.5 Flash > 3.5 Flash Lite > 3.1 Flash Lite
    if (tier === 'flash') {
        if (taskType === 'translate') {
            return getFallback(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview']);
        } else {
            return getFallback(['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
        }
    }

    // RULE 6: Lite Tier
    // - Translate: 3.5 Flash Lite > 3.1 Flash Lite
    // - Auto Fix: 3.5 Flash Lite > 3.1 Flash Lite
    if (tier === 'lite') {
        return getFallback(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    }
    
    // RULE 7: DeepSeek Tier
    if (tier === 'deepseek') {
        const deepseekModels = enabledModels.filter(m => m.startsWith('deepseek:'));
        if (deepseekModels.length > 0) return deepseekModels;
        return ['deepseek:deepseek-v4-flash'];
    }
    
    return ['gemini-3.8-flash'];
};

const TRANSLATION_MODEL_PREFERENCES_KEY = 'aiko.translation-model-preferences.v1';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type TranslationModelPreferences = Partial<Record<TranslationTier, string[]>>;

export const normalizeTranslationTier = (tier: TranslationTier): TranslationTier => {
    if (IS_LITE && tier !== 'flash' && tier !== 'lite' && tier !== 'deepseek') return 'flash';
    return tier;
};

export const getSelectableTranslationModels = (tier: TranslationTier): string[] => {
    if (normalizeTranslationTier(tier) === 'deepseek') return [];
    return getEffectiveModelsForTier(tier, 'translate', MODEL_CONFIGS.map(model => model.id));
};

export const sanitizeTranslationModelSelection = (
    tier: TranslationTier,
    requestedModels?: string[]
): string[] => {
    const allowed = getSelectableTranslationModels(tier);
    if (allowed.length === 0) return [];
    if (!requestedModels) return allowed;
    const selected = allowed.filter(id => requestedModels.includes(id));
    return selected.length > 0 ? selected : [allowed[0]];
};

const getBrowserStorage = (): PreferenceStorage | undefined => {
    try {
        return typeof window !== 'undefined' ? window.localStorage : undefined;
    } catch {
        return undefined;
    }
};

const readPreferences = (storage: PreferenceStorage | undefined): TranslationModelPreferences => {
    if (!storage) return {};
    try {
        const parsed = JSON.parse(storage.getItem(TRANSLATION_MODEL_PREFERENCES_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed as TranslationModelPreferences : {};
    } catch {
        return {};
    }
};

export const loadTranslationModelSelection = (
    tier: TranslationTier,
    storage: PreferenceStorage | undefined = getBrowserStorage()
): string[] => {
    const normalizedTier = normalizeTranslationTier(tier);
    const saved = readPreferences(storage)[normalizedTier];
    return sanitizeTranslationModelSelection(normalizedTier, Array.isArray(saved) ? saved : undefined);
};

export const saveTranslationModelSelection = (
    tier: TranslationTier,
    models: string[],
    storage: PreferenceStorage | undefined = getBrowserStorage()
): string[] => {
    const normalizedTier = normalizeTranslationTier(tier);
    const sanitized = sanitizeTranslationModelSelection(normalizedTier, models);
    if (!storage || normalizedTier === 'deepseek') return sanitized;
    try {
        const preferences = readPreferences(storage);
        preferences[normalizedTier] = sanitized;
        storage.setItem(TRANSLATION_MODEL_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
        // localStorage bị chặn: lựa chọn vẫn có hiệu lực trong lượt chạy hiện tại.
    }
    return sanitized;
};

export const getRequiredSupportModels = (tier: TranslationTier): string[] => {
    const validationAndSafetyModels = [
        'gemini-3.5-flash-lite',
        'gemini-3.5-flash',
        'gemini-3.1-flash-lite',
        'gemma-4-31b-it',
        'gemma-4-26b-a4b-it',
    ];
    const available = new Set(MODEL_CONFIGS.map(model => model.id));
    return Array.from(new Set([
        ...getEffectiveModelsForTier(tier, 'auto_fix', MODEL_CONFIGS.map(model => model.id)),
        ...getEffectiveModelsForTier(tier, 'smart_fix', MODEL_CONFIGS.map(model => model.id)),
        ...validationAndSafetyModels,
    ])).filter(id => available.has(id));
};
