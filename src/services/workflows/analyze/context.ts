// Nhóm hàm PHÂN TÍCH NGỮ CẢNH truyện: phân tích từng đoạn (analyzeContextBatch), gộp nhiều
// kết quả phân tích lại (mergeContexts - FIX85: tuyến tính có tích lũy/rolling, không còn đệ quy
// chia đôi), điều phối lấy mẫu + phân tích toàn bộ truyện (analyzeStoryContext), và gộp ngữ cảnh
// thô khi hết quota AI (refineRawContext).
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { StoryInfo, FileItem } from '../../../types';
import { cleanRepetitiveContent, extractPotentialEntities, extractGlossaryBlocks, deduplicateDictionary, optimizeDictionary } from '../../../utils/text';
import { getSmartSampledFiles, chunkTextByFileBoundary } from '../../../utils/fileHelpers';
import { ANALYSIS_CHUNK_MAX_CHARS, MERGE_CONTEXT_CHUNK_MAX_CHARS, IS_LITE } from '../../../constants';
import { GLOSSARY_ANALYSIS_PROMPT, MERGE_CONTEXT_PROMPT } from '../../../constants';
import { AnalysisEngine, runDeepSeekWithFallback } from './engineDispatch';
import { isContentFilterFinishReason } from '../../../utils/contentFilterError';

export const analyzeContextBatch = async (
    contentChunk: string, storyInfo: StoryInfo, existingDictionary: string, useSearch: boolean = false,
    forcedCandidates?: string[], additionalRules: string = "", enabledModels?: string[],
    engine: AnalysisEngine = 'gemini', deepseekKey?: string, deepseekModel?: string
): Promise<string> => {
    let candidates = forcedCandidates || ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
    candidates = candidates.filter(id => enabledModels?.includes(id) ?? true);
    if (candidates.length === 0) candidates = forcedCandidates || ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
    const langs = storyInfo.languages.join(' ').toLowerCase();
    let sourceInstruction = "";
    
    if (langs.includes('trung') || langs.includes('chinese') || langs.includes('raw') || 
        langs.includes('anh') || langs.includes('english') || 
        langs.includes('nhật') || langs.includes('japan') || 
        langs.includes('hàn') || langs.includes('korea')) {
        sourceInstruction = "NGUỒN: RAW (NGOẠI NGỮ). BẮT BUỘC GIỮ NGUYÊN MẶT CHỮ GỐC Ở VẾ TRÁI (KEY). TUYỆT ĐỐI KHÔNG DỊCH VẾ TRÁI.";
    } else {
        sourceInstruction = "NGUỒN: CONVERT/TIẾNG VIỆT. BẮT BUỘC GIỮ TỪ GỐC TRONG VĂN BẢN (DÙ SAI CHÍNH TẢ) Ở VẾ TRÁI.";
    }

    const potentialEntities = extractPotentialEntities(contentChunk);
    const hintSection = potentialEntities.length > 0 
        ? `\n\n[GỢI Ý TỪ HỆ THỐNG (LOCAL EXTRACTION)]\nHệ thống đã quét sơ bộ và tìm thấy các cụm từ đáng chú ý sau. Hãy kiểm tra xem chúng là gì (Tên người, Địa danh, Chiêu thức, Vật phẩm...), dịch chúng và tìm thêm các tên riêng khác mà hệ thống bỏ sót:\n${potentialEntities.join(', ')}` 
        : "";

    // FIX (fix55): trước đây existingDictionary được truyền vào hàm nhưng KHÔNG hề được đưa vào
    // prompt gửi AI (dead parameter) — nghĩa là khi 1 truyện bị chia làm nhiều phần để phân tích
    // (vd phần 1-1000 / 1001-2000), phần sau hoàn toàn không biết phần trước đã tìm ra nhân vật/
    // thuật ngữ/xưng hô gì, dẫn tới phân tích rời rạc, thiếu nhất quán khi gộp lại. Giờ đưa thẳng
    // từ điển/ngữ cảnh đã có (nếu có) vào prompt, kèm chỉ dẫn rõ: dùng để GIỮ NHẤT QUÁN tên gọi đã
    // chốt, không tự ý dịch khác đi; chỉ bổ sung mục MỚI hoặc diễn biến MỚI (vd xưng hô đổi giai
    // đoạn) cho các mục đã có.
    const relevantExistingDictionary = optimizeDictionary(existingDictionary || '', contentChunk);
    const dictionarySection = relevantExistingDictionary && relevantExistingDictionary.trim()
        ? `\n\n[NGỮ CẢNH & TỪ ĐIỂN ĐÃ CÓ TỪ CÁC PHẦN TRƯỚC CỦA TRUYỆN NÀY — BẮT BUỘC THAM CHIẾU]\nĐây là những gì đã được phân tích/chốt từ (các) phần trước (nếu truyện bị chia nhiều phần để phân tích). TUYỆT ĐỐI giữ nhất quán tên gọi/thuật ngữ đã có ở đây, KHÔNG tự ý đổi cách dịch khác đi. Chỉ bổ sung thêm nhân vật/thuật ngữ MỚI xuất hiện trong đoạn dưới đây, hoặc diễn biến MỚI cho mục đã có (vd xưng hô của 1 cặp nhân vật đổi sang giai đoạn mới):\n${relevantExistingDictionary}`
        : "";

    const metaHeader = `[METADATA]\n- Tên: ${storyInfo.title}\n- Thể loại: ${storyInfo.genres.join(', ')}\n- Ngôn ngữ truyện: ${storyInfo.languages.join(', ')}\n- CHẾ ĐỘ: ${sourceInstruction}${additionalRules ? `\n- QUY TẮC BỔ SUNG: ${additionalRules}` : ''}${dictionarySection}${hintSection}`;

    if (engine === 'deepseek') {
        const dsText = await runDeepSeekWithFallback(deepseekKey || "", deepseekModel || "", GLOSSARY_ANALYSIS_PROMPT, `${metaHeader}\n${contentChunk}`, false);
        return cleanRepetitiveContent(dsText || "");
    }

    const ai = getAiClient();
    return await smartExecution(candidates, async (modelId) => {
            const config: any = { systemInstruction: GLOSSARY_ANALYSIS_PROMPT, temperature: 0.2, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 };
            if (useSearch && (modelId.includes('gemini-3.1-pro') || modelId.includes('gemini-3-pro'))) config.tools = [{googleSearch: {}}];
            const response = await ai.models.generateContent({ model: modelId, contents: `${metaHeader}\n${contentChunk}`, config });
            
            if (isContentFilterFinishReason(response.candidates?.[0]?.finishReason)) {
                throw new Error(`Bị chặn bởi bộ lọc an toàn (Safety Filter). Mặc dù đã dùng lệnh lách luật, nhưng nội dung quá nhạy cảm nên API vẫn từ chối. Vui lòng kiểm tra lại nội dung gốc. Finish Reason: ${response.candidates[0].finishReason}`);
            }
            
            return cleanRepetitiveContent(response.text || "");
        }, "Phân Tích Ngữ Cảnh", undefined, candidates[0]
    );
};

// FIX86: FALLBACK THÔ CỤC BỘ (0 request) CHO 1 CHUNK PHÂN TÍCH khi CẢ 2 tầng AI (model chính +
// Flash cứu hộ) đều lỗi/hết quota.
//
// Trước đây: catch ngoài cùng của batch loop trong `analyzeStoryContext` (và catch tương đương ở
// `handleNameAnalysis` — useContextAnalysisHandlers.ts) khi thất bại hoàn toàn sẽ trả về "" (hoặc
// 1 dòng lỗi thuần) — bị lọc bỏ khỏi `results[]` (hoặc không đóng góp gì hữu ích) → NGUYÊN CẢ
// CHUNK dữ liệu (có thể vài chục nghìn ký tự truyện) biến mất khỏi Series Bible mà không để lại
// dấu vết, khác hẳn triết lý "không bao giờ mất dữ liệu" mà fix85 vừa áp cho bước Hợp Nhất (Local
// Raw Merge). Nay: khi rơi tới tầng cuối này, trích xuất CỤC BỘ (extractPotentialEntities — hàm
// thuần, không gọi AI, vốn đã dùng làm gợi ý trong analyzeContextBatch) các cụm từ khả nghi trong
// đúng chunk đó, kèm marker hệ thống rõ ràng + số thứ tự chunk, để: (a) không mất dấu vết đoạn nào
// đã lỗi, (b) không bơm nguyên văn thô (có thể rất dài) vào bước Hợp Nhất sau đó — tránh phá ngân
// sách MERGE_CONTEXT_CHUNK_MAX_CHARS, (c) người dùng biết chính xác cần chạy lại phần nào khi còn
// Quota. Dùng CHUNG cho cả `analyzeStoryContext` (Smart Start) và `handleNameAnalysis` (Phân Tích
// Sâu) để 2 luồng nhất quán.
export const LOCAL_RAW_ANALYSIS_FALLBACK_TAG = '[HỆ THỐNG: PHÂN TÍCH THÔ CỤC BỘ (LOCAL FALLBACK)';

export const buildLocalRawAnalysisFallback = (chunkText: string, chunkIndex: number, totalChunks: number, errorDetail?: string): string => {
    const entities = extractPotentialEntities(chunkText);
    const entityLine = entities.length > 0
        ? `Cụm từ khả nghi trích xuất CỤC BỘ (chưa dịch, chưa xác nhận, chỉ mang tính gợi ý): ${entities.join(', ')}`
        : 'Không trích xuất được cụm từ khả nghi nào ở phần dữ liệu này.';
    const errLine = errorDetail ? `\n# Lỗi AI cuối cùng: ${errorDetail}` : '';
    return `\n\n# ==================================================\n# ${LOCAL_RAW_ANALYSIS_FALLBACK_TAG} — Phần dữ liệu ${chunkIndex + 1}/${totalChunks}]\n# Do hết Quota/Lỗi AI ở cả 2 tầng model, phần dữ liệu này CHƯA được AI phân tích đầy đủ.\n# ${entityLine}${errLine}\n# Khuyến nghị: chạy lại Phân Tích khi còn Quota để phân tích đầy đủ phần dữ liệu này.\n# ==================================================\n\n`;
};

// FIX85: HỢP NHẤT TUYẾN TÍNH CÓ TÍCH LŨY (rolling fold) — thay cho cây đệ quy nhị phân cũ.
//
// Trước đây (fix80 trở về trước): contexts.length > 3 thì chia đôi, đệ quy gộp từng nửa, rồi gộp
// tiếp 2 kết quả đã gộp — MỖI nút của cây (kể cả nút gộp-của-nút-đã-gộp) đều tốn 1 lượt gọi AI
// THẬT, khiến 1 truyện chia 20 phần phân tích tốn tới 15 lượt gọi AI chỉ để hợp nhất, và dữ liệu
// bị "nhào" qua nhiều tầng AI liên tiếp (rủi ro trôi/cắt cụt cộng dồn qua từng tầng).
//
// Nay: GHÉP CỤC BỘ (0 request) toàn bộ contexts lại, CHIA LẠI theo ngưỡng MERGE_CONTEXT_CHUNK_MAX_
// CHARS (tái dùng chunkTextByFileBoundary — coi mỗi context là 1 "file", không bao giờ xé đôi 1
// context giữa 2 lượt gọi), rồi HỢP NHẤT TUẦN TỰ CÓ TÍCH LŨY: kết quả đã hợp nhất tới thời điểm
// hiện tại được đưa vào làm "NGỮ CẢNH ĐÃ CÓ" của lượt gọi kế tiếp — đúng bản chất "ACCUMULATIVE"
// mà MERGE_CONTEXT_PROMPT vốn đã yêu cầu (tuyệt đối không xoá dữ liệu cũ, chỉ cộng dồn thêm).
// Với đa số truyện, toàn bộ contexts gộp lại vẫn nằm gọn trong 1 chunk duy nhất → CHỈ 1 lượt gọi
// AI hợp nhất (so với 7-15 lượt trước đây); chỉ truyện cực dài/nhiều nhân vật mới cần 2-3 lượt.

// Lập kế hoạch chia contexts thành các "lượt hợp nhất" — hàm THUẦN (không gọi AI), tách riêng để
// có thể test độc lập và để biết trước TOTAL cho progress bar trước khi bắt đầu vòng lặp AI.
export const planMergeChunks = (contexts: string[]): string[] =>
    chunkTextByFileBoundary(contexts.map(text => ({ text })), MERGE_CONTEXT_CHUNK_MAX_CHARS);

const ROUGH_MERGE_INSTRUCTION = "\n\nNHIỆM VỤ: TỔNG HỢP THÔ DỮ LIỆU TRÊN. GIỮ NGUYÊN CÁC MỤC QUAN TRỌNG.";

// Marker Local Raw Merge — GIỮ NGUYÊN Y HỆT chuỗi cũ vì refineRawContext() tách chuỗi (split) dựa
// trên đúng marker "Do hết Quota" này để phát hiện dữ liệu đã rơi về chế độ nối thô, rồi thử hợp
// nhất lại lần nữa khi có Quota — đổi marker sẽ khiến refineRawContext không nhận diện được nữa.
const LOCAL_RAW_MERGE_MARKER = "\n\n# ==================================================\n# [HỆ THỐNG: CHẾ ĐỘ TỔNG HỢP THÔ (LOCAL MERGE)]\n# Do hết Quota, các phần dữ liệu được nối trực tiếp bên dưới.\n# ==================================================\n\n";
const LOCAL_RAW_MERGE_MARKER_DEEPSEEK = "\n\n# ==================================================\n# [HỆ THỐNG: CHẾ ĐỘ TỔNG HỢP THÔ (LOCAL MERGE)]\n# Do lỗi DeepSeek, các phần dữ liệu được nối trực tiếp bên dưới.\n# ==================================================\n\n";

// Model 1 tầng: lọc theo enabledModels, nếu lọc xong rỗng thì dùng lại danh sách mặc định của
// tầng đó (an toàn — luôn có ít nhất 1 model để thử, giữ đúng hành vi cũ trước fix85).
const filterTierModels = (tier: string[], enabledModels?: string[]): string[] => {
    const filtered = tier.filter(id => enabledModels?.includes(id) ?? true);
    return filtered.length > 0 ? filtered : tier;
};

const buildMergeUserContent = (accumulated: string, newChunkText: string, pronounOverride?: string): string => {
    const body = accumulated
        ? `[NGỮ CẢNH ĐÃ HỢP NHẤT TỪ CÁC PHẦN TRƯỚC — GIỮ NGUYÊN, CHỈ CỘNG DỒN THÊM]\n${accumulated}\n\n[PHẦN MỚI CẦN HỢP NHẤT VÀO NGỮ CẢNH TRÊN]\n${newChunkText}`
        : `[DỮ LIỆU ĐẦU VÀO CẦN HỢP NHẤT]\n${newChunkText}`;
    return pronounOverride ? `${body}\n\n${pronounOverride}` : body;
};

const callMergeModel = async (modelId: string, content: string): Promise<string> => {
    const response = await getAiClient().models.generateContent({
        model: modelId,
        contents: content,
        config: { systemInstruction: MERGE_CONTEXT_PROMPT, temperature: 0.2, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 }
    });

    if (isContentFilterFinishReason(response.candidates?.[0]?.finishReason)) {
        throw new Error(`Bị chặn bởi bộ lọc an toàn (Safety Filter). Mặc dù đã dùng lệnh lách luật, nhưng nội dung quá nhạy cảm nên API vẫn từ chối. Vui lòng kiểm tra lại nội dung gốc. Finish Reason: ${response.candidates[0].finishReason}`);
    }

    return cleanRepetitiveContent(response.text || "");
};

// Danh sách model theo TỪNG lượt hợp nhất (1 lượt = 1 chunk trong planMergeChunks), đúng 3 tầng
// người dùng yêu cầu (FIX85):
//   Tầng 1 — Pro (3.1 Pro): chất lượng đầy đủ, đúng nguyên vẹn MERGE_CONTEXT_PROMPT.
//   Tầng 2 — 3.7 Flash / 3.6 Flash: THẾ HỆ MỚI, đủ khả năng hợp nhất ĐẦY ĐỦ ngang Pro (không phải
//            "thô") — chỉ là dự phòng khi Pro hết quota, dùng CHUNG prompt không rút gọn với Pro.
//   Tầng 3 — 3.5 Flash / 3-flash-preview: "Hợp Nhất Thô" thật sự đầu tiên — vẫn gọi AI thật, vẫn
//            dùng nguyên MERGE_CONTEXT_PROMPT, chỉ thêm 1 dòng chỉ thị ưu tiên tốc độ + giữ đúng
//            mục quan trọng (ROUGH_MERGE_INSTRUCTION) vì tier model yếu hơn, không nên bắt cày kỹ
//            y hệt Pro/3.7/3.6 dễ ra kết quả tệ/thiếu.
//   Tầng 4 — Local Raw Merge: KHÔNG gọi AI nữa, chỉ nối thẳng kèm ghi chú hệ thống.
const MERGE_TIER_PRO = ['gemini-3.1-pro-preview'];
const MERGE_TIER_FULL_FLASH = ['gemini-3.7-flash', 'gemini-3.6-flash'];
const MERGE_TIER_ROUGH_FLASH = ['gemini-3.5-flash', 'gemini-3-flash-preview'];

// Thực hiện ĐÚNG 1 lượt hợp nhất (accumulated + 1 mergeChunk mới) — chạy hết 4 tầng fallback rồi
// mới trả về, không bao giờ throw (tầng cuối luôn là Local Raw Merge nối thẳng cục bộ).
const mergeOneChunk = async (
    accumulated: string, newChunkText: string, enabledModels?: string[], forcedCandidates?: string[],
    pronounOverride?: string, engine: AnalysisEngine = 'gemini', deepseekKey?: string, deepseekModel?: string
): Promise<string> => {
    const content = buildMergeUserContent(accumulated, newChunkText, pronounOverride);

    if (engine === 'deepseek') {
        try {
            const dsText = await runDeepSeekWithFallback(deepseekKey || "", deepseekModel || "", MERGE_CONTEXT_PROMPT, content, false);
            return cleanRepetitiveContent(dsText || newChunkText);
        } catch (e) {
            // DeepSeek không có tier Pro/Flash tách biệt như Gemini để "hợp nhất thô" nhiều lớp,
            // nên lỗi thì rơi thẳng về local merge.
            console.warn("Merge API (DeepSeek) failed. Performing Local Raw Merge.", e);
            return `${accumulated}${LOCAL_RAW_MERGE_MARKER_DEEPSEEK}${newChunkText}`;
        }
    }

    const tier1Base = (forcedCandidates && forcedCandidates.length > 0) ? forcedCandidates : MERGE_TIER_PRO;
    const tier1 = filterTierModels(tier1Base, enabledModels);
    try {
        return await smartExecution(tier1, (modelId) => callMergeModel(modelId, content), "Hợp Nhất Ngữ Cảnh (Pro)", undefined, tier1[0]);
    } catch (e) {
        console.warn("Merge API (Pro) failed. Trying 3.7/3.6 Flash (đầy đủ, ngang chất lượng Pro).", e);
    }

    const tier2 = filterTierModels(MERGE_TIER_FULL_FLASH, enabledModels);
    try {
        return await smartExecution(tier2, (modelId) => callMergeModel(modelId, content), "Hợp Nhất Ngữ Cảnh (Flash - Đầy Đủ)", undefined, tier2[0]);
    } catch (e) {
        console.warn("Merge API (3.7/3.6 Flash) failed. Trying 3.5 Flash / 3-flash-preview (Hợp Nhất Thô).", e);
    }

    const tier3 = filterTierModels(MERGE_TIER_ROUGH_FLASH, enabledModels);
    try {
        return await smartExecution(tier3, (modelId) => callMergeModel(modelId, `${content}${ROUGH_MERGE_INSTRUCTION}`), "Hợp Nhất Thô", undefined, tier3[0]);
    } catch (flashError) {
        console.warn("Merge API (3.5 Flash / 3-flash-preview) failed. Performing Local Raw Merge.", flashError);
        return `${accumulated}${LOCAL_RAW_MERGE_MARKER}${newChunkText}`;
    }
};

export const mergeContexts = async (
    contexts: string[], _storyInfo: StoryInfo, enabledModels?: string[], forcedCandidates?: string[], pronounOverride?: string,
    engine: AnalysisEngine = 'gemini', deepseekKey?: string, deepseekModel?: string,
    // Callback tùy chọn báo tiến độ hợp nhất (done, total lượt gọi AI hợp nhất thực sự).
    onProgress?: (done: number, total: number) => void
): Promise<string> => {
    if (contexts.length === 0) return "";
    if (contexts.length === 1) return cleanRepetitiveContent(contexts[0]);

    const mergeChunks = planMergeChunks(contexts);
    const total = mergeChunks.length;
    let accumulated = "";

    for (let i = 0; i < mergeChunks.length; i++) {
        try {
            accumulated = await mergeOneChunk(accumulated, mergeChunks[i], enabledModels, forcedCandidates, pronounOverride, engine, deepseekKey, deepseekModel);
        } finally {
            onProgress?.(i + 1, total);
        }
    }

    return accumulated;
};


export const analyzeStoryContext = async (files: FileItem[], storyInfo: StoryInfo, dictionary: string = "", useSearch: boolean = false, additionalRules: string = "", sampling: { start: number, middle: number, end: number } = { start: 100, middle: 100, end: 100 }, enabledModels?: string[]): Promise<string> => {
    let filesToAnalyze = getSmartSampledFiles(files, sampling);
    // FIX59 (Lite): ngân sách cố định tối đa 200.000 ký tự, lấy mẫu Đầu/Giữa/Cuối xen kẽ
    // đến khi đủ ngân sách — người dùng không được chọn/see phạm vi quét.
    if (IS_LITE) {
        const BUDGET = 200000;
        const seg = Math.ceil(filesToAnalyze.length / 3);
        const parts = [filesToAnalyze.slice(0, seg), filesToAnalyze.slice(seg, 2 * seg), filesToAnalyze.slice(2 * seg)];
        const kept: typeof filesToAnalyze = [];
        const idx = [0, 0, 0];
        let used = 0, turn = 0;
        while (kept.length < filesToAnalyze.length) {
            const p = turn++ % 3;
            if (idx[p] >= parts[p].length) continue;
            const f = parts[p][idx[p]++];
            if (used + f.content.length > BUDGET && kept.length > 0) continue;
            kept.push(f); used += f.content.length;
        }
        filesToAnalyze = kept;
    }

    // FIX87: Phân Tích Sâu/Smart Start dùng tối đa 600.000 ký tự mỗi phần để giảm số request.
    // Việc cắt vẫn ưu tiên ranh giới chương; ngưỡng Hợp Nhất Ngữ Cảnh phía sau giữ riêng 80k/30k.
    const CHUNK_SIZE = ANALYSIS_CHUNK_MAX_CHARS;
    const cleanedFiles = filesToAnalyze.map(f => {
        let safeContent = f.content;
        safeContent = safeContent.replace(/([1-9]\d*)0000(?!\d)/g, '$1万');
        safeContent = safeContent.replace(/\.{6,}/g, '...');
        safeContent = safeContent.replace(/!{4,}/g, '!!!');
        safeContent = safeContent.replace(/\?{4,}/g, '???');
        return { text: safeContent };
    });
    const chunks = chunkTextByFileBoundary(cleanedFiles, CHUNK_SIZE);

    const results: string[] = [];
    const targetModels = ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'].filter(id => enabledModels?.includes(id) ?? true);
    if (targetModels.length === 0) targetModels.push('gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview');
    
    // Tuần tự để rollingDictionary của chunk N được truyền ngay sang chunk N+1.
    const CONCURRENCY = 1;
    let completedChunks = 0;
    let progressNote = "";
    // FIX (fix55): "ngữ cảnh tích lũy" — trước batch đầu tiên chỉ có từ điển sẵn có (nếu có),
    // sau MỖI batch, rút gọn các mục [Key] = Value từ toàn bộ kết quả đã phân tích tới thời điểm
    // đó rồi gộp vào rollingDictionary, dùng làm "NGỮ CẢNH ĐÃ CÓ TỪ CÁC PHẦN TRƯỚC" cho (các)
    // batch tiếp theo (xem dictionarySection trong analyzeContextBatch). Nhờ vậy phần 2 (vd
    // 1001-2000) sẽ "biết" các nhân vật/thuật ngữ đã chốt ở phần 1 (1-1000) thay vì phân tích mù
    // hoàn toàn độc lập rồi mới gộp ở bước cuối — đây chính là nguyên nhân khiến phân tích chia
    // nhiều phần trước đây bị rời rạc, thiếu nhất quán so với phân tích 1 lần trọn vẹn.
    let rollingDictionary = dictionary || "";

    try {
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
            const batch = chunks.slice(i, i + CONCURRENCY);
            const dictForThisBatch = rollingDictionary;
            const batchPromises = batch.map(async (chunk, idx) => {
                const batchNum = Math.floor(i / CONCURRENCY) + 1;
                // FIX86: bỏ nhánh idx % 2 chết — kể từ khi CONCURRENCY hạ về 1 (để rollingDictionary
                // chạy tuần tự đúng), `batch` luôn chỉ có 1 phần tử nên `idx` luôn = 0, nhánh
                // "idx % 2 !== 0" phía dưới không bao giờ có cơ hội chạy. Giữ lại đúng 1 logic tầng
                // model theo batchNum cho rõ ràng, hành vi thực tế không đổi.
                const models: string[] = batchNum <= 3
                    ? ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview']
                    : ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
                
                try {
                    return await analyzeContextBatch(chunk, storyInfo, dictForThisBatch, useSearch, models, additionalRules, enabledModels);
                } catch (e: any) {
                    console.warn(`Primary models failed for chunk ${i + idx}, falling back to Flash for raw analysis.`, e);
                    try {
                        const flashRes = await analyzeContextBatch(chunk, storyInfo, dictForThisBatch, useSearch, ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'], additionalRules + "\nLƯU Ý: ĐÂY LÀ BẢN PHÂN TÍCH THÔ DO HẾT QUOTA. CHỈ TRÍCH XUẤT NHANH CÁC DANH TỪ RIÊNG.", enabledModels);
                        progressNote = "\n\n[CẢNH BÁO: Quá trình phân tích bị gián đoạn do hết Quota/Lỗi mạng. Một số phần được lưu dưới dạng phân tích thô bằng Flash.]";
                        return flashRes + "\n[GHI CHÚ: BẢN PHÂN TÍCH THÔ BẰNG FLASH DO HẾT QUOTA]";
                    } catch (flashError: any) {
                        // FIX86: trước đây trả về "" -> bị lọc bỏ khỏi results[] -> mất trắng cả
                        // chunk. Nay fallback về trích xuất cục bộ (0 request) thay vì bỏ trắng.
                        console.error(`Flash fallback also failed for chunk ${i + idx}:`, flashError);
                        progressNote = "\n\n[CẢNH BÁO: Quá trình phân tích bị gián đoạn do hết Quota/Lỗi mạng. Một số phần chỉ được trích xuất CỤC BỘ (LOCAL FALLBACK, không qua AI) — tìm marker tương ứng trong kết quả để chạy lại Phân Tích khi có Quota.]";
                        return buildLocalRawAnalysisFallback(chunk, i + idx, chunks.length, flashError?.message || String(flashError));
                    }
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            const validResults = batchResults.filter(r => r.length > 50);
            results.push(...validResults);
            completedChunks += validResults.length;

            // FIX86: loại các chunk đã rơi về LOCAL FALLBACK (chỉ là gợi ý cụm từ khả nghi thô,
            // không phải từ điển [Key] = Value thật) ra khỏi nguồn xây rollingDictionary — vẫn giữ
            // nguyên chúng trong `results` (đã push ở trên) để không mất dấu vết khi Hợp Nhất.
            const dictSourceResults = validResults.filter(r => !r.includes(LOCAL_RAW_ANALYSIS_FALLBACK_TAG));
            if (dictSourceResults.length > 0) {
                rollingDictionary = deduplicateDictionary(`${rollingDictionary}\n${extractGlossaryBlocks(dictSourceResults.join('\n'))}`);
            }
            
            if (i + CONCURRENCY < chunks.length) await new Promise(r => setTimeout(r, 2000));
        }
    } catch (e: any) {
        console.warn("Analysis interrupted (Quota/Network):", e);
        const percent = Math.round((completedChunks / chunks.length) * 100);
        
        // Fallback: Use 2.5 Flash to save raw progress if possible, otherwise just note it.
        // The user said: "sử dụng 2.5 flash để lưu lại thông tin phân tích theo dạng thô"
        // We will append a note saying we are saving raw data.
        progressNote = `\n\n# === [HỆ THỐNG GHI CHÚ TIẾN ĐỘ] ===\n- Trạng thái: TẠM DỪNG (Interrupted)\n- Lý do: Hết Quota API hoặc Lỗi mạng.\n- Tiến độ: Đã phân tích ${completedChunks}/${chunks.length} phần dữ liệu (~${percent}%).\n- Dữ liệu thô đã được lưu lại. Khi có Quota, hãy chạy lại Phân tích.`;
    }

    if (results.length === 0) return "Chưa phân tích được dữ liệu nào do lỗi kết nối/quota ngay từ đầu.";
    
    // Attempt merge even if interrupted
    let finalMerge = "";
    try {
        finalMerge = await mergeContexts(results, storyInfo);
    } catch {
        // Should not happen as mergeContexts now has local fallback, but safe check
        finalMerge = results.join("\n\n=== [DỮ LIỆU THÔ CHƯA HỢP NHẤT] ===\n\n");
    }

    return finalMerge + progressNote;
};

export const refineRawContext = async (rawContext: string, storyInfo: StoryInfo, enabledModels?: string[]): Promise<string> => {
    const parts = rawContext.split("# ==================================================\n# [HỆ THỐNG: CHẾ ĐỘ TỔNG HỢP THÔ (LOCAL MERGE)]\n# Do hết Quota, các phần dữ liệu được nối trực tiếp bên dưới.\n# ==================================================\n\n");
    if (parts.length <= 1) return rawContext; // Not raw merged data
    
    return await mergeContexts(parts, storyInfo, enabledModels);
};
