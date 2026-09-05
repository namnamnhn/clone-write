// Nhóm hàm SỬA LỖI HÀNG LOẠT: repairBatch (gọi AI sửa từng dòng lỗi cụ thể),
// performAggregatedRepair (gom nhiều lỗi từ nhiều file thành ít batch hơn để sửa),
// repairTranslations (dùng cho luồng Sửa Lỗi Thông Minh - Smart Fix).
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { fetchDeepSeek } from '../../api/deepseek';
import { REPAIR_CONFIG, TIER_MODELS } from '../../../constants';
import { StoryInfo, TranslationTier } from '../../../types';
import { optimizeContext, optimizeDictionary, dedupeContextAgainstDictionary, LineContext } from '../../../utils/text';
import { getPronounRules } from '../../../prompts';
import { getEffectiveModelsForTier } from './modelSelection';

export interface GlobalRepairEntry { fileId: string; lineIndex: number; originalLine: string; }

export const repairBatch = async (entries: GlobalRepairEntry[], dictionary: string, tier: TranslationTier, context?: string, storyInfo?: StoryInfo, promptTemplate?: string, onLog?: (msg: string) => void, enabledModels?: string[], shouldAbort?: () => boolean, taskType: 'auto_fix' | 'smart_fix' = 'auto_fix', deepseekKey?: string, forcedModels?: string[]): Promise<Map<string, Map<number, string>>> => {
    if (!entries.length) return new Map();
    const instruction = `Senior Editor: Fix errors (typos, wrong pronouns, foreign chars). Return ONLY the corrected text for each ID. Format: ID_X: Corrected text. DO NOT include meta tags like [Fixed]. Story: ${storyInfo?.title}.
CRITICAL: Nếu dòng có chứa tiếng Anh/CJK (như Trung, Nhật, Hàn, etc.) chưa được dịch, bạn BẮT BUỘC PHẢI dịch toàn bộ dòng đó sang tiếng Việt, không chỉ sửa lỗi chính tả hay giữ nguyên.
CRITICAL: You MUST return EXACTLY ONE LINE per ID. Do not use multiple lines for a single ID correction.`;
    
    const genreRules = storyInfo ? getPronounRules(storyInfo.genres, storyInfo.worldSetting || []) : ""; 

    // Combine provided context and storyInfo contextNotes, then optimize and deduplicate
    const chunkContent = entries.map(e => e.originalLine).join('\n');
    let relCtx = "";
    try {
        const fullContext = [context || "", storyInfo?.contextNotes || ""].filter(Boolean).join('\n\n');
        relCtx = typeof optimizeContext === 'function' ? optimizeContext(fullContext, chunkContent) : fullContext.substring(0, 2000);
        if (typeof dedupeContextAgainstDictionary === 'function') {
            relCtx = dedupeContextAgainstDictionary(relCtx, dictionary);
        }
    } catch {
        relCtx = storyInfo?.contextNotes?.substring(0,2000) || "";
    }

    const prompt = `[DICT]\n${dictionary}\n[ROLES]\n${relCtx}\n[RULES & PRONOUNS (MANDATORY)]\n${genreRules}\n[LINES]\n${entries.map((e,i) => `ID_${i}: ${e.originalLine}`).join('\n')}`;
    // Auto Fix Raw thủ công cho người dùng khoá đúng 3.1 Pro hoặc model Flash mới nhất. Pool cưỡng bức
    // không đi qua mapping tier/auto_fix, nếu không lựa chọn Pro có thể bị lọc mất và âm thầm
    // đổi sang model khác.
    const candidates = forcedModels?.length ? [...forcedModels] : getEffectiveModelsForTier(tier, taskType, enabledModels);
    
    const isPro = candidates.some(id => TIER_MODELS.PRO_POOL.includes(id));
    const fixModelLabel = isPro ? "Pro" : "Flash";
    
    return await smartExecution(candidates, async mid => {
        let timeoutId: NodeJS.Timeout | undefined;
        const connectionTimeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('CONNECTION_TIMEOUT')), 900000); // 900s timeout for full generation
        });
        try {
            if (shouldAbort && shouldAbort()) throw new Error('ABORTED');
            let text = "";
            if (mid.startsWith('deepseek:')) {
                const deepseekModelName = mid.replace('deepseek:', '');
                const resPromise = fetchDeepSeek(deepseekKey || "", deepseekModelName, instruction, prompt, false);
                text = await Promise.race([resPromise, connectionTimeout]) as string;
            } else {
                const ai = getAiClient();
                const resPromise = ai.models.generateContent({ model: mid, contents: prompt, config: { systemInstruction: instruction, temperature: 0.1, maxOutputTokens: 65536, safetySettings: SAFETY_SETTINGS } });
                const res = await Promise.race([resPromise, connectionTimeout]) as any;
                text = res.text;
            }
            if (timeoutId) clearTimeout(timeoutId);
            
            const map = new Map<string, Map<number, string>>();
            text?.split('\n').forEach((l: string) => {
                const m = l.match(/^(?:\*\*)?ID_(\d+)(?:\*\*)?\s*[:.-]\s*(.*)$/i);
                if (m) {
                    const entry = entries[parseInt(m[1])];
                    if (entry) {
                        if (!map.has(entry.fileId)) map.set(entry.fileId, new Map());
                        let cleanedText = m[2].trim();
                        cleanedText = cleanedText.replace(/^\[(Fixed|Corrected|Sửa|Done)\]\s*[:.-]?\s*/i, '');
                        cleanedText = cleanedText.replace(/^Fixed:\s*/i, '');
                        map.get(entry.fileId)?.set(entry.lineIndex, cleanedText);
                    }
                }
            });
            return map;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }, `Sửa lỗi Batch (${fixModelLabel})`, onLog);
};

export const performAggregatedRepair = async (
    allBadLines: GlobalRepairEntry[], 
    dictionary: string, 
    tier: TranslationTier, 
    context?: string, 
    storyInfo?: StoryInfo, 
    promptTemplate?: string, 
    onLog?: (msg: string) => void, 
    enabledModels?: string[],
    onBatchComplete?: (batchFixes: Map<string, Map<number, string>>) => void,
    shouldAbort?: () => boolean,
    taskType: 'auto_fix' | 'smart_fix' = 'auto_fix',
    deepseekKey?: string,
    // FIX (cứu hộ sửa-lỗi ghim cứng 1 model): nhánh rescue Safety bên dưới từng hardcode
    // ['deepseek:deepseek-v4-flash'] trong khi mọi nơi khác đều tôn trọng model DeepSeek người
    // dùng cấu hình (core.deepseekModel). Truyền model cấu hình qua tham số này; không truyền
    // thì mới dùng mặc định như cũ.
    deepseekModel?: string,
    forcedModels?: string[]
): Promise<Map<string, Map<number, string>>> => {
    const combined = new Map<string, Map<number, string>>();
    const total = allBadLines.length;
    const batchLimit = REPAIR_CONFIG.BATCH_SIZE;
    
    for (let i = 0; i < total; i += batchLimit) {
        if (shouldAbort && shouldAbort()) {
            if (onLog) onLog(`⚠️ Đã dừng sửa lỗi do người dùng yêu cầu.`);
            break;
        }
        const chunk = allBadLines.slice(i, i + batchLimit);
        const batchNum = Math.floor(i / batchLimit) + 1;
        const totalBatches = Math.ceil(total / batchLimit);
        
        if (onLog) onLog(`🛠️ Đang sửa Batch ${batchNum}/${totalBatches} (${chunk.length} dòng)...`);
        const batchStartTime = Date.now();
        
        const chunkContent = chunk.map(c => c.originalLine).join('\n');
        const chunkDict = optimizeDictionary(dictionary, chunkContent);
        
        try {
            const res = await repairBatch(chunk, chunkDict, tier, context, storyInfo, promptTemplate, onLog, enabledModels, shouldAbort, taskType, deepseekKey, forcedModels);
            
            res.forEach((m, id) => {
                if (!combined.has(id)) combined.set(id, new Map());
                m.forEach((t, idx) => combined.get(id)?.set(idx, t));
            });
            if (onBatchComplete) onBatchComplete(res);
            const batchEndTime = Date.now();
            const durationStr = ((batchEndTime - batchStartTime) / 1000).toFixed(1);
            if (onLog) onLog(`✅ Hoàn tất sửa lỗi Batch ${batchNum}/${totalBatches} trong ${durationStr}s`);
        } catch (e: any) {
            const isSafetyError = e.message.includes('an toàn') || e.message.includes('safety') || e.message.includes('BLOCKLIST') || e.message.includes('PROHIBITED_CONTENT');
            const hasDS = !!(deepseekKey && deepseekKey.trim().length > 0);
            if (isSafetyError && hasDS) {
                // Cứu hộ 1 tầng qua vệ tinh DeepSeek (vệ tinh duy nhất của hệ thống).
                const label = 'DeepSeek';
                let rescued = false;
                if (onLog) onLog(`⚠️ Lỗi Safety Filter ở Batch ${batchNum}. Đang chuyển hướng vệ tinh qua ${label} để thử lại...`);
                try {
                    const rescueModels = (deepseekModel || 'deepseek-v4-flash').split(',').map(s => s.trim()).filter(Boolean).map(m => `deepseek:${m}`);
                    const res = await repairBatch(chunk, chunkDict, tier, context, storyInfo, promptTemplate, onLog, rescueModels, shouldAbort, taskType, deepseekKey);
                    
                    res.forEach((m, id) => {
                        if (!combined.has(id)) combined.set(id, new Map());
                        m.forEach((t, idx) => combined.get(id)?.set(idx, t));
                    });
                    if (onBatchComplete) onBatchComplete(res);
                    const batchEndTime = Date.now();
                    const durationStr = ((batchEndTime - batchStartTime) / 1000).toFixed(1);
                    if (onLog) onLog(`✅ Hoàn tất sửa lỗi Batch ${batchNum}/${totalBatches} bằng ${label} trong ${durationStr}s`);
                    rescued = true;
                } catch (fallbackError: any) {
                    if (onLog) onLog(`❌ Lỗi ${label} tại Batch ${batchNum}: ${fallbackError.message}`);
                }
                if (!rescued && onLog) onLog(`❌ Đã thử hết các vệ tinh cứu hộ nhưng Batch ${batchNum} vẫn lỗi.`);
            } else {
                if (onLog) onLog(`❌ Lỗi Batch ${batchNum}: ${e.message}`);
                if (e.message.includes('Quota') || e.message.includes('429')) break;
            }
        }
    }
    return combined;
};

export const repairTranslations = async (badLines: LineContext[], dictionary: string, tier: TranslationTier = 'normal', context?: string, storyInfo?: StoryInfo, promptTemplate?: string, onLog?: (msg: string) => void, enabledModels?: string[], deepseekKey?: string): Promise<{ index: number; text: string }[]> => {
    const map = await repairBatch(badLines.map(bl => ({ fileId: 'temp', lineIndex: bl.index, originalLine: bl.originalLine })), dictionary, tier, context, storyInfo, promptTemplate, onLog, enabledModels, undefined, 'smart_fix', deepseekKey);
    return Array.from(map.get('temp')?.entries() || []).map(([idx, txt]) => ({ index: idx, text: txt }));
};
