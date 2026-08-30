// HÀM LÕI QUAN TRỌNG NHẤT của app: dịch 1 batch file bằng streaming (gọi Gemini/DeepSeek,
// nhận response dạng stream, validate, tự sửa lỗi nếu cần...). ~840 dòng, nhiều bước xử lý
// tuần tự phụ thuộc thứ tự lẫn nhau — cố tình KHÔNG tách nhỏ nội dung hàm ra ở bước refactor
// này (rủi ro cao nếu không có bộ test hồi quy đầy đủ). Việc tách RIÊNG hàm này ra 1 file
// chỉ nhằm mục đích: khi cần sửa lỗi luồng dịch, chỉ cần mở đúng 1 file này thay vì phải
// tìm trong 1 file 1500 dòng gộp chung 8 hàm khác nhau.
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { fetchDeepSeekStream, getDeepSeekModelInfo } from '../../api/deepseek';
import { StoryInfo, TranslationTier, RatioLimits, FileItem } from '../../../types';
import { isContentFilterFinishReason, buildContentFilterErrorMessage } from '../../../utils/contentFilterError';
import { optimizeDictionary, optimizeContext, dedupeContextAgainstDictionary, findLinesWithForeignChars, mergeFixedLines, formatBookStyle, fixMergedTitle, createBatchFingerprints, validateBatch, registerCompletedChapterFingerprint, cleanupAiTextArtifacts } from '../../../utils/text';
import { getPronounModeOverride, getNumberUnitModeOverride } from '../../../prompts/analysis';
import { getEffectiveModelsForTier } from './modelSelection';
import { validateBatchWithAI } from './aiValidation';
import { performAggregatedRepair, GlobalRepairEntry } from './repair';
import { getRescueTarget, getSafetyRescueBudgetLimit } from './rescueTarget';

// ===================== TÁI CẤU TRÚC: PARSER STREAM DÙNG CHUNG =====================
// Trước đây khối "dò thẻ part_N mới nhất trong accumulator -> trích nội dung -> kiểm tra
// giới hạn tỷ lệ -> onUpdate" bị SAO CHÉP 3 LẦN y hệt trong translateBatchStream (nhánh
// OpenRouter cũ, nhánh DeepSeek, nhánh Gemini — nay chỉ còn 2 nhánh DeepSeek/Gemini). Gom về
// 2 hàm thuần dưới đây để mọi sửa đổi logic parse chỉ cần làm MỘT nơi. Thân hàm được sao chép
// NGUYÊN VĂN từ bản cũ — hành vi giữ nguyên 100%, kể cả thông điệp lỗi throw (các luồng retry
// phía dưới dò theo chuỗi).
interface StreamInputFile { id: string; content: string; name?: string }

const makeStreamTagRegex = (): RegExp => /(?:\[\[\[\s*|\[\s*|<\s*)(part_[0-9]+)(?:\s*\]\]\]|\s*\]|\s*>)/gi;
const makeStreamEndTagRegex = (): RegExp => /(?:\[\[\[\s*\/|\[\s*\/|<\s*\/)(part_[0-9]+)(?:\s*\]\]\]|\s*\]|\s*>)/gi;

export const getRatioMultiplier = (ratioLimits?: RatioLimits): number => {
    let multiplier = 5;
    if (ratioLimits && ratioLimits.cn) {
        multiplier = Math.max(5, (Number.isFinite(ratioLimits.cn.max) ? ratioLimits.cn.max : 6.2) + 1);
    }
    return multiplier;
};

export const extractLatestStreamUpdate = (
    fullTextAccumulator: string,
    files: StreamInputFile[],
    idMap: Map<string, string>
): { realId: string; content: string } | null => {
    const startRegex = makeStreamTagRegex();
    const matches = [...fullTextAccumulator.matchAll(startRegex)];
    if (matches.length === 0) return null;
    const lastMatch = matches[matches.length - 1];
    const fileKey = lastMatch[1].toLowerCase();
    // ƯU TIÊN TUYỆT ĐỐI: dùng đúng SỐ THỰC ghi trong tag (vd "part_3" -> file thứ 3), KHÔNG
    // dùng vị trí xuất hiện tuần tự của tag trong response. Nếu dùng vị trí, một tag bị bỏ
    // sót/lặp lại sẽ làm MỌI tag phía sau bị dồn lệch sang sai file — nguyên nhân "trả kết
    // quả nhầm file" giữa các chương trong batch.
    let realId: string | undefined;
    const numericMatch = fileKey.match(/(\d+)/);
    if (numericMatch) {
        const idx = parseInt(numericMatch[1], 10) - 1;
        if (idx >= 0 && idx < files.length) realId = files[idx].id;
    }
    if (!realId) {
        realId = idMap.get(fileKey) || idMap.get(`file_${fileKey}`);
    }
    if (!realId) {
        // Phương án cuối cùng khi tag hỏng nặng không đọc được số: dùng vị trí xuất hiện.
        const expectedIdx = matches.length - 1;
        if (expectedIdx >= 0 && expectedIdx < files.length) realId = files[expectedIdx].id;
    }
    if (!realId) return null;
    const contentStart = lastMatch.index! + lastMatch[0].length;
    // Look for next tag or end of string
    const nextTagIndex = fullTextAccumulator.substring(contentStart).search(startRegex);
    const contentEnd = nextTagIndex !== -1 ? contentStart + nextTagIndex : fullTextAccumulator.length;

    let content = fullTextAccumulator.substring(contentStart, contentEnd);
    // Remove end tag if present in streaming
    content = content.replace(makeStreamEndTagRegex(), '');
    return { realId, content };
};

const assertStreamContentWithinLimit = (
    realId: string,
    content: string,
    files: StreamInputFile[],
    ratioLimits?: RatioLimits
): void => {
    const matchedFile = files.find(f => f.id === realId);
    if (!matchedFile) return;
    const multiplier = getRatioMultiplier(ratioLimits);
    const maxLen = Math.max(matchedFile.content.length * multiplier, 4000);
    if (content.length > maxLen) {
        throw new Error(`⚠️ Lỗi AI lặp từ hoặc mất thẻ (Tỷ lệ > ${multiplier}x). Đang tự ngắt kết nối...`);
    }
};
// ===================== HẾT PARSER STREAM DÙNG CHUNG =====================

// ===================== TÁI CẤU TRÚC R-B: PARSE CUỐI (DEEP SWEEP) THÀNH HÀM THUẦN =====================
// Toàn bộ khối "FINAL DEEP SWEEP" (parse chuẩn theo tag + khôi phục Hybrid Proportional Split)
// trước đây nằm inline ~165 dòng trong translateBatchStream. Tách thành hàm thuần để test hồi
// quy trực tiếp bằng Vitest (tests/streamParser.test.ts). Logic được sao chép NGUYÊN VĂN — kể cả
// thứ tự ưu tiên resolve realId, luật isCompleted (end-tag / start-tag kế / stream kết thúc tự
// nhiên trừ MAX_TOKENS), skip tag trùng giữ bản đầu, và header cảnh báo của Hybrid recovery.
export interface FinalParseOutcome {
    results: Map<string, string>;
    completedFileIds: Set<string>;
    hybridRecoveredIds: Set<string>;
}

export const parseFinalResults = (
    fullTextAccumulator: string,
    files: StreamInputFile[],
    idMap: Map<string, string>,
    storyInfo: StoryInfo | undefined,
    streamEndedNaturally: boolean,
    hitMaxTokensCutoff: boolean,
    onUpdate: (fileId: string, partialContent: string) => void,
    onLog?: (msg: string) => void
): FinalParseOutcome => {
    const results = new Map<string, string>();
    const completedFileIds = new Set<string>();
    const hybridRecoveredIds = new Set<string>();
    let foundValidParts = 0;
    const assignedIdsThisPass = new Set<string>();

    // 1. Try Standard Parsing with XML tags and END_OF_FILE barriers
    const parts = fullTextAccumulator.split(makeStreamTagRegex());
    // parts[0] is pre-text (junk), parts[1] is ID, parts[2] is Content, parts[3] is ID, parts[4] is Content...

    for (let i = 1; i < parts.length; i += 2) {
        const fileKey = parts[i].toLowerCase();
        let content = parts[i+1] || "";

        // Cleanup End Tag AND any trailing junk after the end tag
        const endTagIndex = content.search(/(?:\[\[\[\s*\/|\[\s*\/|<\s*\/)(part_[0-9]+)(?:\s*\]\]\]|\s*\]|\s*>)/i);
        let isCompleted = false;
        if (endTagIndex !== -1) {
            content = content.substring(0, endTagIndex);
            isCompleted = true;
        } else if (i + 2 < parts.length) {
            // If there is no end tag, but there is ANOTHER start tag after this one,
            // then this file is complete (the AI just forgot the end tag).
            isCompleted = true;
        } else if (streamEndedNaturally && !hitMaxTokensCutoff) {
            // Last file, no end tag, no next start tag, stream finished on its own
            // (not timeout/length-cut/error/MAX_TOKENS) -> AI simply forgot the tag.
            // Nếu hitMaxTokensCutoff=true thì streamEndedNaturally là "red herring" — nội dung
            // thật sự bị cắt đuôi, để isCompleted=false rơi vào luồng retry phía dưới.
            isCompleted = true;
        }

        const fileIndex = Math.floor(i / 2); // vị trí xuất hiện tuần tự (phương án CUỐI CÙNG)
        // ƯU TIÊN TUYỆT ĐỐI: dùng đúng SỐ THỰC ghi trong tag (vd tag "part_3" -> files[2]),
        // KHÔNG dùng vị trí xuất hiện tuần tự — tránh dồn lệch hàng loạt khi AI bỏ sót 1 tag.
        let realId: string | undefined;
        const numericMatch = fileKey.match(/(\d+)/);
        if (numericMatch) {
            const idx = parseInt(numericMatch[1], 10) - 1;
            if (idx >= 0 && idx < files.length) {
                realId = files[idx].id;
            }
        }
        if (!realId) {
            realId = idMap.get(fileKey) || idMap.get(`file_${fileKey}`);
        }
        if (!realId && fileIndex >= 0 && fileIndex < files.length) {
            realId = files[fileIndex].id;
        }

        if (realId) {
            if (assignedIdsThisPass.has(realId)) {
                // Tag trùng số: bỏ bản sau, giữ bản ĐẦU TIÊN (an toàn hơn — model lỗi dần về cuối).
                if (onLog) onLog(`⚠️ AI trả trùng tag "${fileKey}" nhiều lần trong cùng batch — đã bỏ qua bản trùng, giữ bản dịch xuất hiện đầu tiên.`);
            } else {
                assignedIdsThisPass.add(realId);
                const originalFile = files.find(f => f.id === realId);
                const contentText = originalFile ? originalFile.content : "";
                const formatted = cleanupAiTextArtifacts(formatBookStyle(content, contentText, storyInfo?.enableTitleFormatting !== false, storyInfo?.titleFormat, storyInfo?.enableAutoFormat !== false));
                results.set(realId, formatted);
                onUpdate(realId, formatted);
                foundValidParts++;
                if (isCompleted) {
                    completedFileIds.add(realId);
                }
            }
        }
    }

    // --- VALIDATION & RECOVERY: Hybrid Proportional Split khi AI gộp nhầm cả batch thành 1 khối ---
    if (foundValidParts !== files.length) {
        if (foundValidParts === 0 && fullTextAccumulator.trim().length > 0) {
            const translatedParagraphs = fullTextAccumulator.split(/\n+/).filter(p => p.trim().length > 0);
            const originalCharCounts = files.map(f => f.content.length);
            const totalOriginalChars = originalCharCounts.reduce((a, b) => a + b, 0);
            const totalTranslatedChars = translatedParagraphs.reduce((a, p) => a + p.length, 0);

            if (totalOriginalChars > 0 && translatedParagraphs.length > 0) {
                let currentParagraphIndex = 0;
                let assignedCount = 0;

                files.forEach((f, idx) => {
                    const originalCount = originalCharCounts[idx];
                    const targetTranslatedChars = Math.round((originalCount / totalOriginalChars) * totalTranslatedChars);

                    let currentFileChars = 0;
                    const paragraphsForFile = [];

                    while (currentParagraphIndex < translatedParagraphs.length) {
                        const p = translatedParagraphs[currentParagraphIndex];

                        if (idx < files.length - 1 && currentFileChars + p.length > targetTranslatedChars * 1.2 && paragraphsForFile.length > 0) {
                            break;
                        }

                        paragraphsForFile.push(p);
                        currentFileChars += p.length;
                        currentParagraphIndex++;

                        if (idx < files.length - 1 && currentFileChars >= targetTranslatedChars) {
                            break;
                        }
                    }

                    // File cuối nhận toàn bộ phần còn lại
                    if (idx === files.length - 1 && currentParagraphIndex < translatedParagraphs.length) {
                        paragraphsForFile.push(...translatedParagraphs.slice(currentParagraphIndex));
                        currentParagraphIndex = translatedParagraphs.length;
                    }

                    if (paragraphsForFile.length > 0) {
                        const partContent = paragraphsForFile.join('\n\n');
                        const warningHeader = `\n\n[CẢNH BÁO BỞI AI STUDIO: File này được khôi phục do AI gộp nhầm chương. Có thể bị cắt nhầm ranh giới câu. Hãy kiểm tra lại]\n\n`;
                        const formatted = warningHeader + cleanupAiTextArtifacts(formatBookStyle(partContent, f.content, storyInfo?.enableTitleFormatting !== false, storyInfo?.titleFormat, storyInfo?.enableAutoFormat !== false));
                        results.set(f.id, formatted);
                        onUpdate(f.id, formatted);
                        completedFileIds.add(f.id);
                        hybridRecoveredIds.add(f.id);
                        assignedCount++;
                    }
                });

                if (assignedCount > 0) {
                    foundValidParts = assignedCount;
                     onLog(`✅ [BATCH RECOVERY] Đã tách và khôi phục ${assignedCount} file bị AI gộp nhầm bằng thuật toán Hybrid.`);
                 } else if (onLog) {
                     onLog(`⚠️ [BATCH PARTIAL] Chỉ tìm thấy ${foundValidParts}/${files.length} file. Các file còn lại sẽ được tự động thử lại (Retry).`);
                 }
             }
        }
    }

    return { results, completedFileIds, hybridRecoveredIds };
};
// ===================== HẾT DEEP SWEEP THUẦN =====================

export const translateBatchStream = async (
    files: { id: string, content: string, name?: string, fileRetryCount?: number, errorMessage?: string }[],
    userPrompt: string,
    dictionary: string,
    globalContext: string,
    allowedModelIds: string[], 
    previousBatchContext: string = "",
    onUpdate: (fileId: string, partialContent: string) => void,
    onLog?: (msg: string) => void,
    tier: TranslationTier = 'normal', 
    enabledModels: string[] = [],     
    storyInfo?: StoryInfo,
    preferredModelId?: string,
    shouldAbort?: () => boolean,
    ratioLimits?: RatioLimits,
    deepseekKey?: string,
    deepseekModel?: string,
    supportEnabledModels?: string[]
): Promise<{ results: Map<string, string>, model: string, stats?: { dictLines: number, contextLines: number }, streamError?: Error }> => {
    // Bước 2: Tạo fingerprints TRƯỚC khi gửi AI
    const batchFingerprints = createBatchFingerprints(files);

    const combined = files.map(f => f.content).join('\n');
    let relDict = "";
    let relCtx = "";
    try {
        relDict = (typeof optimizeDictionary === 'function' ? optimizeDictionary(dictionary || "", combined) : dictionary) || "";
        relCtx = (typeof optimizeContext === 'function' ? optimizeContext(globalContext || "", combined, relDict) : globalContext) || "";
        
        // --- ADDED: Deduplicate context against dictionary ---
        if (typeof dedupeContextAgainstDictionary === 'function') {
            relCtx = dedupeContextAgainstDictionary(relCtx, relDict);
        }
    } catch (e) {
        console.warn("Optimization function missing or failed in translator", e);
        relDict = dictionary || "";
        relCtx = globalContext || "";
    }
    
    // FIX61 (ghép cặp sizing-model ↔ execution-model — đề xuất tồn đọng từ fix60): scheduler
    // đoán kích thước batch theo bestModel NGAY LÚC XẾP LỊCH, nhưng model chạy thật trước đây
    // được chọn lại hoàn toàn tự do lúc request (preferredModelId=undefined) nên batch được xếp
    // cho Pro vẫn có thể chạy Flash và ngược lại. Giờ scheduler truyền bestModel xuống làm
    // preferredModelId; model này ĐỨNG ĐẦU danh sách ứng viên — quotaManager.getBestModelForTask
    // có nhánh strict-preferred (dùng đúng model ưu tiên, kể cả phải chờ RPM cooldown ngắn),
    // chỉ khi model chính DEPLETED THẬT SỰ mới luân chuyển sang các model còn lại của tier.
    const tierTranslateModels = getEffectiveModelsForTier(tier, 'translate', enabledModels.length > 0 ? enabledModels : allowedModelIds);
    let effectiveModels = preferredModelId && !tierTranslateModels.includes(preferredModelId)
        ? [preferredModelId, ...tierTranslateModels]
        : tierTranslateModels;

    if (tier === 'deepseek') {
        const selectedDs = (deepseekModel || 'deepseek-v4-flash').split(',').map(s => s.trim()).filter(Boolean);
        effectiveModels = (selectedDs.length > 0 ? selectedDs : ['deepseek-v4-flash']).map(m => `deepseek:${m}`);
    }

    const hasStrictSafetyError = files.some(f => f.errorMessage && !f.errorMessage.includes('vạ lây') && !f.errorMessage.toLowerCase().includes('quota') && (f.errorMessage.toLowerCase().includes("an toàn") || f.errorMessage.toLowerCase().includes("safety") || f.errorMessage.includes("BLOCKLIST") || f.errorMessage.includes("PROHIBITED_CONTENT")));
    const hasValidationError = files.some(f => f.errorMessage && !f.errorMessage.includes('vạ lây') && (f.errorMessage.toLowerCase().includes("nghi vấn lỗi nội dung") || f.errorMessage.toLowerCase().includes("lỗi kiểm định ai")));

    // Ưu tiên đọc thẳng tag "Bàn giao DeepSeek" đã được useTranslator.ts gắn sẵn vào errorMessage
    // (tính theo retryCount qua getRescueTarget) - nếu không thấy tag rõ ràng (ví dụ lỗi phát sinh
    // ngay lần đầu, chưa qua useTranslator gắn tag), suy luận lại từ fileRetryCount + key đang có,
    // dùng đúng 1 helper getRescueTarget dùng chung cả 2 nơi.
    const hasDeepSeekKeyAvail = !!(deepseekKey && deepseekKey.trim().length > 0);
    const taggedRescueTarget: 'deepseek' | null = files.some(f => f.errorMessage?.includes('Bàn giao DeepSeek')) ? 'deepseek' : null;
    const maxRetryFile = Math.max(0, ...files.map(f => f.fileRetryCount || 0));
    // FIX (đề xuất tồn đọng "tách ngân sách cứu hộ theo loại lỗi" - fix15/17/18): trước đây hardcode
    // `2` ở đây. Hàm này không biết phiên hiện tại có đang ở "pha Sửa Lỗi" hay không (không có tham
    // số isFixPhase truyền vào tới tận đây) nên tạm dùng `false` (giữ đúng giá trị cũ = 2) - đa số
    // các trường hợp CHƯA từng gắn tag rõ ràng khi rơi vào nhánh suy luận này là do lỗi nội dung/hậu
    // kiểm (Safety), không phải Quota tạm (nhánh Quota luôn gắn tag tường minh từ useTranslator.ts
    // trước khi tới đây), nên dùng `getSafetyRescueBudgetLimit` là hợp lý hơn hardcode vô danh.
    const inferredRescueTarget = taggedRescueTarget || getRescueTarget(maxRetryFile, hasDeepSeekKeyAvail, getSafetyRescueBudgetLimit(false));

    // FIX: trước đây needsRescueFallback CHỈ dựa vào hasStrictSafetyError/hasValidationError (dò
    // vài cụm từ cố định trong errorMessage). Nếu file đã được useTranslator.ts gắn tag rõ ràng
    // "Bàn giao DeepSeek" (taggedRescueTarget khác null — nghĩa là hệ thống ĐÃ quyết định đây là
    // ca cần cứu hộ ở lượt trước) nhưng chuỗi errorMessage đó lại không chứa đúng các cụm "an toàn"/
    // "safety"/"nghi vấn lỗi nội dung"/"lỗi kiểm định ai" (ví dụ do lỗi gốc là "Thiếu kết quả từ
    // API"/"Lỗi ngắt kết nối API" — vẫn được scheduler ở useTranslator.ts xếp vào diện cứu hộ nhưng
    // không khớp bộ từ khoá hẹp hơn ở đây), thì needsRescueFallback = false, khiến khối override
    // effectiveModels bên dưới bị BỎ QUA hoàn toàn dù inferredRescueTarget đã tính đúng là
    // 'deepseek'. Sửa: coi taggedRescueTarget khác null cũng là điều kiện đủ để kích hoạt
    // needsRescueFallback, không chỉ dựa vào dò từ khoá nữa.
    const needsRescueFallback = hasStrictSafetyError || hasValidationError || taggedRescueTarget !== null;

    let relPrevCtx = previousBatchContext;
    if (needsRescueFallback) {
        relPrevCtx = "";
    }

    if(onLog) onLog(`[DEBUG] hasStrictSafetyError=${hasStrictSafetyError}, hasValidationError=${hasValidationError}, rescueTarget=${inferredRescueTarget || 'none'}, deepseekKey.length=${deepseekKey ? deepseekKey.length : 0}`);

    if (needsRescueFallback) {
        // FIX (kiểm tra Key trước khi dùng vệ tinh): chỉ chuyển hướng sang DeepSeek khi Key khả
        // dụng — nếu file mang tag "Bàn giao DeepSeek" từ lượt thử trước nhưng người dùng vừa XOÁ
        // Key giữa chừng, không cắm model `deepseek:...` với Key rỗng gây lỗi xác thực khó hiểu.
        if (inferredRescueTarget === 'deepseek' && hasDeepSeekKeyAvail) {
            const dsRescueModels = (deepseekModel || 'deepseek-v4-flash').split(',').map(s => s.trim()).filter(Boolean);
            effectiveModels = (dsRescueModels.length > 0 ? dsRescueModels : ['deepseek-v4-flash']).map(m => `deepseek:${m}`);
            if (onLog) onLog(`⚠️ Phát hiện lỗi phức tạp (${hasStrictSafetyError ? 'Safety' : (hasValidationError ? 'Validation' : 'Đã gắn tag Bàn giao')}). Tự động dùng vệ tinh dự phòng DeepSeek: ${effectiveModels.join(', ')}...`);
        } else {
            if (hasStrictSafetyError) {
                throw new Error("BLOCKLIST: File bị chặn bởi Safety Filter và không có DeepSeek API Key để vượt nghiệm.");
            } else {
                // FIX: Không throw cứng HALLUCINATION_PERSIST nữa. Lý do: chuỗi lỗi cũ chứa
                // đúng cụm "lỗi kiểm định ai" mà hasValidationError ở trên dùng để dò lỗi từ
                // errorMessage cũ của lần retry trước — nên nếu throw lại y hệt, lần retry kế
                // sẽ tự nhận lại lỗi của chính nó và throw ngay lập tức mà KHÔNG hề gọi lại API
                // dịch (vòng lặp vô hạn giả). Vì Tier 2 hoàn toàn có thể báo nhầm (false
                // positive), ở đây ta chỉ log cảnh báo và để effectiveModels giữ nguyên danh
                // sách model Gemini gốc đã tính ở trên, cho file một cơ hội dịch
                // lại thật sự thay vì bị bác bỏ oan.
                if (onLog) onLog(`⚠️ Hậu kiểm Tier 2 nghi vấn lỗi nội dung nhưng không có DeepSeek API Key dự phòng. Bỏ qua chuyển hướng, thử dịch lại bằng model gốc (${effectiveModels.join(', ')}) — có thể Tier 2 chỉ báo nhầm.`);
            }
        }
    }

    if(onLog) {
        // FIX61: log cũ đếm SỐ DÒNG rồi gắn nhãn "đoạn ngữ cảnh" (1401 "đoạn" thực ra là 1401
        // dòng) — vừa sai đơn vị vừa không thấy được mức độ phình to của prompt. Log mới báo
        // đủ: số dòng/đoạn + số ký tự từng phần và tổng raw của batch để đối chiếu trực tiếp.
        const dictLines = relDict.split('\n').filter(l => l.trim()).length;
        const ctxBlocks = relCtx.split(/\n\s*\n/).filter(b => b.trim()).length;
        onLog(`🔍 Lọc ngữ cảnh cho ${files.length} tệp (${combined.length} ký tự raw): từ điển ${dictLines} dòng/${relDict.length} ký tự · ngữ cảnh ${ctxBlocks} đoạn/${relCtx.length} ký tự.`);
        onLog(`🤖 Các model khả dụng cho batch này (${tier}): ${effectiveModels.join(', ')}${preferredModelId ? ` (ưu tiên: ${preferredModelId})` : ''}`);
    }

    const idMap = new Map<string, string>();
    files.forEach((f, idx) => { 
        const k = `part_${idx + 1}`; 
        idMap.set(k, f.id);
    });

    const getInstruction = (mid: string) => {
        const is25Pro = mid && mid.includes('2.5-pro');
        const formatType = (!storyInfo?.tagFormat || storyInfo.tagFormat === 'auto') ? (is25Pro ? 'xml' : 'brackets') : storyInfo.tagFormat;
        const startTag = formatType === 'xml' ? '<X>' : '[[[X]]]';
        const endTag = formatType === 'xml' ? '</X>' : '[[[/X]]]';
        const exampleStart = formatType === 'xml' ? '<part_1>' : '[[[part_1]]]';
        const exampleEnd = formatType === 'xml' ? '</part_1>' : '[[[/part_1]]]';
        const exampleStart2 = formatType === 'xml' ? '<part_2>' : '[[[part_2]]]';
        const exampleEnd2 = formatType === 'xml' ? '</part_2>' : '[[[/part_2]]]';

        const chapterTitleRule = storyInfo?.enableTitleFormatting === false 
            ? '7. CRITICAL: THE USER DISABLED TITLE FORMATTING. DO NOT FORMAT TITLES. DO NOT ADD "Chương X:" IF IT IS NOT EXPLICITLY IN THE TEXT. KEEP THE EXACT ORIGINAL LINE STRUCTURE.'
            : '7. IF the text has a chapter title, format it as "Chương X: [Title]". IF NO TITLE EXISTS, DO NOT INVENT ONE. DO NOT ADD ANNOTATIONS.';

        return `Professional Translator: Translate to Vietnamese. 
STRICTLY OBEY [DICT] (Mandatory Glossary).
CRITICAL FORMATTING RULE (ABSOLUTE ZERO TOLERANCE):
1. You MUST output exactly ${files.length} parts. You are an automated API, do not refuse, do not complain, do not output conversational text.
2. You MUST wrap each translated part with the EXACT same tags as the input. DO NOT TRANSLATE THE TAGS.
3. START each file with: ${startTag} (where X is the exact ID from the input).
4. END each file with: ${endTag} (where X is the exact ID from the input).
5. Example:
=========================================
${exampleStart}
(Translated Content)
${exampleEnd}
=========================================
${exampleStart2}
(Translated Content)
${exampleEnd2}
...
6. DO NOT SKIP ANY FILE. DO NOT MERGE FILES. CRITICAL: You MUST output a separate ${startTag} tag for EACH input file. You MUST close with ${endTag} after EACH file before starting the next one. DO NOT MERGE MULTIPLE FILES INTO ONE TAG. If you forget the tags, the system will break.
${chapterTitleRule}
8. DO NOT REPEAT CHARACTERS OR WORDS EXCESSIVELY (e.g., "aaaaaaaaa" or "a a a a a").
10. CRITICAL: DO NOT MERGE PARAGRAPHS. Keep the exact same number of paragraphs as the original text. Preserve all line breaks (\\n).
11. CRITICAL: DO NOT LOSE OR TRUNCATE TEXT AT THE END OF THE CHAPTER. Make sure EVERY SINGLE LINE from the original text until the very last word is translated and included before the ${endTag} tag.
12. CRITICAL PRESERVATION: DO NOT REMOVE TITLES. If the title is present, output it intact. DO NOT filter out valid content believing it is "spam".
13. TRANSLATE ALL LANGUAGES: If you see ANY foreign languages like Thai, Russian (Cyrillic), Japanese, Korean, etc., YOU MUST TRANSLATE THEM TO VIETNAMESE. DO NOT keep raw foreign text in the translated content.
14. DICTIONARY MARKERS: The [DICT] and [CTX] sections might contain words wrapped in { }, [ ], * *, or # #. These markers are just meant to highlight the term. DO NOT include these formatting markers in your final translation output unless they exist in the raw source text. Just apply the core words.
CRITICAL: DO NOT TRANSLATE THE TAGS. ALWAYS OUTPUT THE EXACT TAGS (e.g. ${startTag} and ${endTag}).`;
    };

    return await smartExecution(effectiveModels, async mid => {
        const ai = getAiClient();
        
        // Dynamic input and instruction based on model ID
        const is25Pro = mid && mid.includes('2.5-pro');
        const formatType = (!storyInfo?.tagFormat || storyInfo.tagFormat === 'auto') ? (is25Pro ? 'xml' : 'brackets') : storyInfo.tagFormat;

        let currentInput = "";
        files.forEach((f, idx) => { 
             const k = `part_${idx + 1}`; 
             // Pre-process raw text to avoid triggering Gemini Safety/Recitation filters
             let safeContent = f.content;
             // NEW: Strip leading prefix numbers from chapter titles to avoid hallucinating the chapter number
             safeContent = safeContent.replace(/^\s*\d+[\.\-\s]+(第\s*\d+\s*[章回节篇部卷折]|(?:Chương|Chapter|Ch|Tiết|Hồi|Phần)\s*\d+)/im, '$1');
             safeContent = safeContent.replace(/([1-9]\d*)0000(?!\d)/g, '$1万');
             safeContent = safeContent.replace(/\.{6,}/g, '...');
             safeContent = safeContent.replace(/!{4,}/g, '!!!');
             safeContent = safeContent.replace(/\?{4,}/g, '???');

             if (formatType === 'xml') {
                currentInput += `\n=========================================\n<${k}>\n${safeContent}\n</${k}>\n`;
            } else {
                currentInput += `\n=========================================\n[[[${k}]]]\n${safeContent}\n[[[/${k}]]]\n`;
            }
        });
        const instruction = getInstruction(mid);
        const startTagMock = formatType === 'xml' ? '<...>' : '[[[...]]]';
        const endTagMock = formatType === 'xml' ? '</...>' : '[[[/...]]]';
        
        let localRelCtx = relCtx;
        let localRelPrevCtx = relPrevCtx;
        let localRelDict = relDict;

        // Giảm tải context cho DeepSeek nếu vượt giới hạn (chỉ 2 model cố định, context biết
        // trước nên tra cứu đồng bộ).
        if (mid.startsWith('deepseek:')) {
            const actualModelName = mid.replace('deepseek:', '');
            const modelInfo = getDeepSeekModelInfo(actualModelName);

            const baseEstTokens = Math.ceil(currentInput.length / 2.5) + Math.ceil(instruction.length / 2.5) + 3000;

            if (modelInfo && modelInfo.contextLength) {
                const maxAllowedContext = modelInfo.contextLength;
                const dictTokens = Math.ceil(localRelDict.length / 2.5);
                const prevCtxTokens = Math.ceil(localRelPrevCtx.length / 2.5);
                const ctxTokens = Math.ceil(localRelCtx.length / 2.5);

                let remainingTokens = maxAllowedContext - baseEstTokens;

                if (remainingTokens < dictTokens + prevCtxTokens + ctxTokens) {
                    if (onLog) onLog(`⚠️ [DeepSeek] Input có thể vượt giới hạn token của model (${maxAllowedContext}). Tự động thu gọn ngữ cảnh...`);

                    if (remainingTokens < dictTokens + ctxTokens) {
                        localRelPrevCtx = "";
                    } else {
                        remainingTokens -= prevCtxTokens;
                    }

                    if (localRelPrevCtx === "") {
                        if (remainingTokens < dictTokens) {
                            localRelCtx = "";
                        } else {
                            remainingTokens -= ctxTokens;
                        }
                    }

                    if (localRelCtx === "" && localRelPrevCtx === "") {
                        if (remainingTokens <= 0) {
                            throw new Error(`⚠️ LỖI QUÁ TẢI NGỮ CẢNH: File truyện quá dài (${Math.ceil(currentInput.length / 2.5)} tokens), vượt quá giới hạn tối đa của model DeepSeek này (${maxAllowedContext} tokens) kể cả khi đã lược bỏ toàn bộ từ điển và bối cảnh phụ. Vui lòng chọn model DeepSeek có ngữ cảnh lớn hơn hoặc dùng tính năng TÁCH TRUYỆN để chia nhỏ file này trước khi dịch.`);
                        }
                        if (remainingTokens < dictTokens) {
                            const dictLines = localRelDict.split('\n');
                            const safeLinesCount = Math.max(20, Math.floor(remainingTokens / 15));
                            if (dictLines.length > safeLinesCount) {
                                localRelDict = dictLines.slice(0, safeLinesCount).join('\n') + '\n... (đã rút gọn do giới hạn DeepSeek context)';
                            }
                        }
                    }
                }
            }
        }

        const fullPrompt = `[DICT]\n${localRelDict}\n[CTX]\n${localRelCtx}\n[PREV]\n${localRelPrevCtx}\n[INSTRUCT]\n${instruction}\n[DATA]\n${currentInput}\n\n=========================================\n[FINAL REMINDER / LỜI NHẮC CUỐI]:\n1. You MUST output exactly ${files.length} parts.\n2. Each part MUST start with ${startTagMock} and end with ${endTagMock}.\n3. DO NOT FORGET OR TRANSLATE THE TAGS.\n4. CRITICAL: NO CROSS-CONTAMINATION. Make sure the translated content strictly matches its original source tag. Do not mix chapters together.`;
        
        // Add timeout for the initial connection
        let connectionTimeoutId: NodeJS.Timeout | undefined;
        const connectionTimeout = new Promise<never>((_, reject) => {
            connectionTimeoutId = setTimeout(() => reject(new Error('CONNECTION_TIMEOUT')), 3600000); // 3600s for stream to start
        });

        try {
            if (shouldAbort && shouldAbort()) throw new Error('ABORTED');

            let finalPrompt = userPrompt;
            if (storyInfo?.enableTitleFormatting === false) {
                finalPrompt += `\n\n[LỆNH CƯỠNG CHẾ QUAN TRỌNG: NGƯỜI DÙNG ĐÃ TẮT CHUẨN HÓA TIÊU ĐỀ. BẠN TUYỆT ĐỐI KHÔNG ĐƯỢC CHUẨN HÓA TIÊU ĐỀ. AI ĐƯỢC KHUYẾN CÁO PHẢI GIỮ NGUYÊN CẤU TRÚC DÒNG VÀ TIÊU ĐỀ BẢN GỐC, KHÔNG ĐƯỢC GHÉP VỚI NỘI DUNG, KHÔNG ĐƯỢC MẶC ĐỊNH THÊM CHỮ "Chương X:". GIỮ NGUYÊN NHƯ FILE RAW]`;
            }
            // Ghi đè xưng hô / đơn vị số đếm (nếu người dùng đã chủ động chọn Hiện Đại/Cổ Đại thay vì
            // Linh Động): trước đây 2 override này CHỈ được chèn vào bước "Phân Tích Sâu" (deep_context)
            // để sinh Series Bible nhất quán, nhưng bản thân promptTemplate dùng để DỊCH TỪNG BATCH lại
            // không mang theo chỉ thị này — nên các thuật ngữ/con số MỚI xuất hiện ở chương sau (chưa kịp
            // vào từ điển) vẫn có thể bị AI dịch lệch mode, gây lẫn "vạn/ức" với "triệu/tỷ" hay lẫn xưng
            // hô cổ trang/hiện đại ngay trong cùng 1 chương. Chèn trực tiếp ở đây đảm bảo MỌI lượt dịch
            // (kể cả khi người dùng chưa chạy tối ưu Prompt) đều nhận được ràng buộc cứng này.
            const pronounOverride = getPronounModeOverride(storyInfo?.pronounMode);
            if (pronounOverride) finalPrompt += `\n\n${pronounOverride}`;
            const numberUnitOverride = getNumberUnitModeOverride(storyInfo?.numberUnitMode);
            if (numberUnitOverride) finalPrompt += `\n\n${numberUnitOverride}`;

            finalPrompt += `\n\n[KHÓA NHẤT QUÁN BẮT BUỘC]
- Mọi tên riêng và thuật ngữ có trong [DICT] liên quan đến batch này phải dùng đúng một cách viết; [DICT] luôn ưu tiên khi có phương án khác.
- Áp dụng nhất quán quan hệ và xưng hô trong [CTX] cho toàn bộ các phần của batch.
- Trước khi trả kết quả, âm thầm rà lại tên riêng, thuật ngữ và cách xưng hô của toàn batch; chỉ xuất bản dịch cuối cùng.`;

            let fullTextAccumulator = ""; 
            let streamErrorToReturn: Error | undefined = undefined;
            // TRUE only when the stream reached its own natural end (no timeout, no length-cutoff, no thrown error).
            // Used later to tell "AI finished but forgot the closing tag" apart from "AI got genuinely cut off",
            // so a complete translation isn't wrongly bounced back to the retry queue.
            let streamEndedNaturally = false;
            // TRUE when the Gemini stream reported finishReason === 'MAX_TOKENS' at any point.
            // BUG FIX: previously, hitting the hard output-token cap on the LAST file of a batch
            // still let `streamEndedNaturally` become true (the SDK's async iterator legitimately
            // reaches `done: true` right after the MAX_TOKENS chunk), which made the "last file,
            // no end tag, stream ended naturally => treat as complete" fallback below wrongly
            // swallow a genuinely CUT-OFF translation (missing its tail) as if it were merely
            // "AI forgot to type the closing tag". The file then got saved as done, still lacked
            // its real ending, and later Tier 2 (AI hậu kiểm) compared the truncated tail against
            // the real source tail and mass-flagged unrelated, perfectly-translated files as
            // "Nghi vấn nhầm chương" (false positives) purely because of this earlier truncation.
            let hitMaxTokensCutoff = false;


            try {
            if (mid.startsWith('deepseek:')) {
                // Nhánh dispatch DeepSeek - parse thẻ part_N dùng chung helper extractLatestStreamUpdate.
                const deepseekModelName = mid.replace('deepseek:', '');
                if (connectionTimeoutId) clearTimeout(connectionTimeoutId);

                let lastUpdateTime = 0;
                const maxTotalLen = Math.max(combined.length * getRatioMultiplier(ratioLimits), 10000);

                fullTextAccumulator = await fetchDeepSeekStream(
                    deepseekKey || "",
                    deepseekModelName,
                    finalPrompt,
                    fullPrompt,
                    (chunkAcc) => {
                        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');
                        fullTextAccumulator = chunkAcc;

                        if (fullTextAccumulator.length > maxTotalLen) {
                            throw new Error(`⚠️ Lỗi AI lặp từ hoặc mất thẻ (Vượt giới hạn toàn batch). Đang tự ngắt kết nối...`);
                        }

                        const now = Date.now();
                        if (now - lastUpdateTime > 1000) {
                            lastUpdateTime = now;
                            const update = extractLatestStreamUpdate(fullTextAccumulator, files, idMap);
                            if (update) {
                                assertStreamContentWithinLimit(update.realId, update.content, files, ratioLimits);
                                onUpdate(update.realId, update.content.trim());
                            }
                        }
                    },
                    (actualModel) => {
                        if (onLog) onLog(`🤖 DeepSeek: Model dịch (${actualModel})`);
                    },
                    onLog
                );
                // fetchDeepSeekStream chỉ RETURN (không throw) khi finish_reason không còn là
                // 'length' (đã tự động nối tiếp nếu bị cắt) - tới được đây nghĩa là model tự
                // kết thúc, tức kết thúc tự nhiên thật sự.
                streamEndedNaturally = true;
            } else {
                const responseStreamPromise = ai.models.generateContentStream({ 
                    model: mid, 
                    contents: fullPrompt, 
                    config: { 
                        systemInstruction: finalPrompt, 
                        temperature: 0.2, 
                        safetySettings: SAFETY_SETTINGS,
                        maxOutputTokens: 65536
                    } 
                });

                const responseStream = await Promise.race([responseStreamPromise, connectionTimeout]) as any;
                if (connectionTimeoutId) clearTimeout(connectionTimeoutId);

            let lastUpdateTime = 0;
            const iterator = responseStream[Symbol.asyncIterator]();
            let isDone = false;
            
            while (!isDone) {
                if (shouldAbort && shouldAbort()) {
                    throw new Error('ABORTED');
                }
                let timeoutId: NodeJS.Timeout | undefined;
                try {
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        timeoutId = setTimeout(() => reject(new Error('STREAM_TIMEOUT')), 900000); // 900s between chunks
                    });
                    const nextPromise = iterator.next();
                    const result = await Promise.race([nextPromise, timeoutPromise]) as IteratorResult<any>;
                    
                    if (timeoutId) clearTimeout(timeoutId);
                    
                    if (result.done) {
                        isDone = true;
                        streamEndedNaturally = true;
                        break;
                    }
                    
                    const chunk = result.value;
                    
                    // Check for safety blocks.
                    // FIX (bug "quota tụt về 0 khi dính bộ lọc" + "không cứu hộ DeepSeek"): Gemini có
                    // 6 loại finishReason liên quan kiểm duyệt, chia 2 nhóm cùng bản chất là BỊ CHẶN
                    // NỘI DUNG, chỉ khác lý do kỹ thuật phía Google:
                    //   - Nhóm 1: SAFETY, BLOCKLIST, PROHIBITED_CONTENT
                    //   - Nhóm 2: OTHER, RECITATION, SPII
                    // Trước đây 2 nhóm bị ném lỗi với message KHÁC NHAU — nhóm 1 chứa từ khoá
                    // "Safety/Blocklist" nên toàn hệ thống (gemini.ts, useTranslator.ts, repair.ts,
                    // smartFixCore.ts) nhận diện đúng là isSafetyError và đưa vào luồng cứu hộ
                    // DeepSeek; nhóm 2 chỉ ghi "kiểm duyệt nâng cao" — KHÔNG chứa bất kỳ
                    // từ khoá nào mà 4 nơi trên đang dò ("an toàn"/"safety"/"blocklist"/
                    // "prohibited_content") — nên bị phân loại nhầm thành lỗi chung chung, rơi vào
                    // guồng đếm lỗi liên tiếp/temporary blacklist bình thường của smartExecution.
                    // Nếu cùng 1 đoạn nội dung tiếp tục gặp RECITATION/OTHER/SPII ở các model Gemini
                    // khác trong tier (rất hay xảy ra), toàn bộ model bị blacklist tạm thời trong
                    // vòng lặp đó → smartExecution ném "Tất cả model đã thử đều gặp lỗi hoặc hết
                    // Quota" → useTranslator.ts đọc đúng nguyên văn cụm đó, set
                    // isAllQuotaExhausted = true và dừng hẳn, BỎ QUA hoàn toàn nhánh isSafetyError
                    // (nơi có logic bàn giao DeepSeek) dù quota thật sự còn nguyên.
                    // SỬA TẬN GỐC: gộp chung 2 nhóm vào 1 nhánh, dùng đúng 1 message chứa từ khoá
                    // "Safety/Blocklist" cho cả 6 finishReason — thay vì thêm rải rác điều kiện ở
                    // nhiều nơi (dễ sót, khó bảo trì).
                    const fr = chunk.candidates?.[0]?.finishReason;
                    if (isContentFilterFinishReason(fr)) {
                        // Đề xuất cải thiện tồn đọng: dùng helper dùng chung (contentFilterError.ts)
                        // thay vì tự viết lại điều kiện + message tại chỗ. Chỉ áp dụng cho code MỚI
                        // này - các nơi dò chuỗi lỗi khác trong hệ thống (useTranslator.ts,
                        // gemini.ts, repair.ts, smartFixCore.ts...) giữ nguyên, chưa gộp (xem
                        // contentFilterError.ts để biết lý do và phạm vi).
                        throw new Error(buildContentFilterErrorMessage(mid, fr));
                    }
                    
                    if (chunk.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
                         hitMaxTokensCutoff = true;
                         if (onLog) onLog(`⚠️ Cảnh báo: Model đã đạt giới hạn Token (MAX_TOKENS). Dữ liệu có thể bị cắt ngang. Đang xử lý các phần đã nhận...`);
                    }
                    
                    const chunkText = chunk.text || "";
                    fullTextAccumulator += chunkText;
                    
                    const maxTotalLen = Math.max(combined.length * getRatioMultiplier(ratioLimits), 10000);
                    
                    if (fullTextAccumulator.length > maxTotalLen) {
                        throw new Error(`⚠️ Lỗi AI lặp từ hoặc mất thẻ (Vượt giới hạn toàn batch). Đang tự ngắt kết nối...`);
                    }

                    const now = Date.now();
                    if (now - lastUpdateTime > 1000) {
                        lastUpdateTime = now;
                        // --- STREAMING UPDATE LOGIC (Approximate) — dùng helper dùng chung ---
                        const update = extractLatestStreamUpdate(fullTextAccumulator, files, idMap);
                        if (update) {
                            assertStreamContentWithinLimit(update.realId, update.content, files, ratioLimits);
                            onUpdate(update.realId, update.content.trim());
                        }
                    }
                } catch (e: any) {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (e.message === 'STREAM_TIMEOUT') {
                        if (onLog) onLog(`⚠️ [CẢNH BÁO] Stream bị treo quá 900 giây không nhận được dữ liệu. Đang ngắt kết nối và xử lý phần đã nhận...`);
                        // Try to close the iterator to prevent memory leaks or dangling promises
                        if (iterator.return) {
                            try { await iterator.return(); } catch { /* ignore */ }
                        }
                        break; // Break the loop and parse what we have
                    } else {
                        throw e; // Rethrow other errors
                    }
                }
            }
            } // end else (Gemini stream)
            } catch (e: any) {
                // FIX (dừng mà vẫn tốn API): lỗi ABORTED do người dùng chủ động dừng phiên —
                // nuốt lỗi tại đây khiến luồng tiếp tục parse + hậu kiểm Tier 2 (tốn request
                // thật) cho 1 phiên caller đã bỏ. Ném thẳng như lỗi quota để thoát ngay.
                if (e.message === 'ABORTED' || (e.message && (e.message.includes('Tất cả model khả dụng đã hết Quota') || e.message.includes('Tất cả model đã thử đều gặp lỗi hoặc hết Quota')))) {
                    throw e;
                }
                streamErrorToReturn = e;
            }

        // --- FINAL DEEP SWEEP (Robust Parsing & Fallback) ---
        // TÁI CẤU TRÚC R-B: parse chuẩn + Hybrid recovery đã tách thành hàm thuần
        // parseFinalResults() ở cấp module (test hồi quy: tests/streamParser.test.ts).
        const { results, completedFileIds, hybridRecoveredIds } = parseFinalResults(
            fullTextAccumulator, files, idMap, storyInfo,
            streamEndedNaturally, hitMaxTokensCutoff, onUpdate, onLog
        );

        // --- CHECK EMPTY RESPONSE ---
        if (fullTextAccumulator.trim().length === 0) {
             if (streamErrorToReturn) {
                 throw streamErrorToReturn;
             }
             // FIX66: thêm cụm "bộ lọc an toàn" vào message — nguyên nhân số 1 của kết quả rỗng
             // là bộ lọc chặn ÂM THẦM (API trả 200 nhưng candidates rỗng). Nhờ vậy lỗi này được
             // useTranslator/isolateUnsafeFiles nhận diện đúng và đi vào luồng quét + CÁCH LY tệp
             // nghi vấn thay vì bị tính là lỗi chung chung (trước đây đốt 3 lượt retry/model rồi
             // blacklist cả cụm, cuối cùng dán nhầm [CAUSE:DEPLETED] làm DỪNG cả hệ thống).
             throw new Error(`⚠️ Model ${mid} trả về kết quả rỗng (nghi vấn bộ lọc an toàn chặn âm thầm, hoặc lỗi kết nối/server từ chối). Trả về lỗi ngay để thử lại hoặc chia nhỏ batch cách ly tệp nghi vấn...`);
        }

        // --- NEW: AUTO-CONTINUE FOR MISSING OR INVALID FILES (Token Limit Bypass) ---
        const invalidReasons: string[] = [];
        
        // Cần đảm bảo cleanContent được set trước (chỉ fixMergedTitle, không formatBookStyle 2 lần)
        files.forEach(f => {
            if (completedFileIds.has(f.id)) {
                const content = results.get(f.id);
                if (content) {
                    const cleanContent = fixMergedTitle(content);
                    results.set(f.id, cleanContent);
                }
            }
        });

        // Các file bị hậu kiểm Tier 1/2 từ chối nhưng VẪN có nội dung dịch (chỉ nghi vấn, không
        // chắc chắn sai). KHÔNG xoá khỏi `results` nữa - giữ lại bản dịch nghi vấn để người dùng
        // xem xét, chỉ đánh dấu cách ly qua tập hợp này. Ở tầng useTranslator.ts, các id có trong
        // đây sẽ được lưu translatedContent kèm cờ hasStaleTranslation=true, gắn lỗi, và đẩy xuống
        // cuối hàng chờ - thay vì mất trắng bản dịch như trước đây. Bản dịch nghi vấn chỉ bị ghi đè
        // khi lần dịch lại kế tiếp thành công (không còn bị hậu kiểm từ chối).
        const flaggedStaleIds = new Set<string>();

        // Tích hợp kiểm tra nhầm chương & tỷ lệ bằng validateBatch (Tier 1)
        const batchReport = validateBatch(files as FileItem[], results, { limits: ratioLimits, sourceLanguages: storyInfo?.languages, fingerprints: batchFingerprints, storyKey: storyInfo?.title });
        
        batchReport.details.forEach((report, id) => {
            if (!report.isValid && results.has(id)) {
                const warningMsg = report.warnings.join(' | ');
                if (onLog) onLog(`⚠️ [Tier 1 - Cảnh báo File ${id}]: ${warningMsg}`);
                
                // Nếu "Nghi vấn nhầm chương" hoặc "Nghi vấn nhảy nội dung": giữ lại bản dịch nghi
                // vấn (không xoá), chỉ đánh dấu cách ly và gửi lại vào hàng đợi.
                if (warningMsg.includes("Nghi vấn nhầm chương") || warningMsg.includes("Nghi vấn nhảy nội dung") || warningMsg.includes("nhầm chương/chập chương") || report.contentConfidence < 0.4) {
                    if (onLog) onLog(`❌ Nghi vấn sai lệch quá lớn ở ${id} (Confidence: ${report.contentConfidence.toFixed(2)}). Giữ lại bản dịch để kiểm tra, gửi lại vào hàng đợi.`);
                    flaggedStaleIds.add(id);
                    completedFileIds.delete(id);
                }
            }
        });

        // Tích hợp kiểm tra AI (Tier 2) - Chỉ áp dụng cho các file đã qua được vòng 1
        // CẢI TIẾN: khi stream đã dính MAX_TOKENS, các file CHƯA xác nhận hoàn chỉnh
        // (không có end-tag/không có start-tag kế tiếp) chắc chắn thiếu đuôi nội dung —
        // gửi đi hậu kiểm là lãng phí API và chắc chắn bị đánh nghi vấn (đúng hiện tượng
        // "Tier 2 không trả về kết quả" lặp lại 2 lần ở log thực tế). Loại khỏi lượt hậu
        // kiểm; chúng sẽ rơi vào nhánh specificErrors "Bị cắt ngang do MAX_TOKENS" bên
        // dưới, bản dịch dở vẫn được giữ qua hasStaleTranslation để đối chiếu lần sau.
        const filesForAiValidation = files.filter(f =>
            results.has(f.id) &&
            !flaggedStaleIds.has(f.id) &&
            !(hitMaxTokensCutoff && !completedFileIds.has(f.id))
        );
        const aiValidationResults = await validateBatchWithAI(
            filesForAiValidation,
            results,
            supportEnabledModels || enabledModels,
            onLog,
            mid,
            deepseekKey
        );

        aiValidationResults.forEach((val, id) => {
            if (!val.isValid && results.has(id)) {
                // Giữ lại bản dịch nghi vấn (không xoá), chỉ đánh dấu cách ly.
                flaggedStaleIds.add(id);
                completedFileIds.delete(id);
            }
        });

        // NOTE: Việc cap số lần thử lại theo từng file (retryCount) được quyết định ở tầng
        // orchestrator (useTranslator.ts: maxRetries = 1-2 tuỳ isFixPhaseRef), KHÔNG phải ở
        // đây. Trước đây hàm này có 1 khối MAX_RETRIES=4 / missingOrInvalidFiles / fileRetryCount
        // tự tính riêng, nhưng kết quả không bao giờ được return hay dùng ở đâu cả (dead code) —
        // đã xoá để tránh gây hiểu nhầm khi đọc log debug.
        const specificErrors = new Map<string, string>();

        // "GATE" bắt buộc cho file khôi phục bằng Hybrid Split: chỉ chấp nhận khi Tier 2 AI xác
        // nhận RÕ RÀNG là hợp lệ (isValid === true). Nếu Tier 2 bị người dùng tắt hẳn (không model
        // nào bật -> validateBatchWithAI trả Map rỗng ngay từ đầu) hoặc vì lý do nào đó không có
        // entry cho file này, aiValidationResults.get(id) sẽ là undefined — KHÔNG được coi đó là
        // "không bị từ chối nên là hợp lệ" giống các file bình thường khác, vì ranh giới nội dung
        // của các file này chỉ là suy đoán theo tỷ lệ ký tự, không phải do AI thực sự tách đúng.
        hybridRecoveredIds.forEach(id => {
            if (!completedFileIds.has(id)) return; // đã bị Tier 1/2 tự loại ở trên rồi, khỏi cần chặn thêm
            const aiRes = aiValidationResults.get(id);
            if (!aiRes || aiRes.isValid !== true) {
                flaggedStaleIds.add(id);
                completedFileIds.delete(id);
                specificErrors.set(id, "Ranh giới file này do thuật toán Hybrid Split ĐOÁN theo tỷ lệ ký tự (AI gộp nhầm cả batch thành 1 khối) và chưa được Tier 2 AI xác nhận rõ ràng là đúng nội dung — tự động đưa vào diện nghi vấn, không coi là hoàn tất.");
                if (onLog) onLog(`⚠️ File ${id}: khôi phục bằng Hybrid Split nhưng chưa được Tier 2 xác nhận rõ ràng -> đánh dấu nghi vấn.`);
            }
        });

        // Đăng ký vân tay (fingerprint) phần đuôi của các file đã THỰC SỰ hoàn tất (qua hết Tier
        // 1/2, không bị flaggedStaleIds) vào cache xuyên batch, để các batch dịch SAU (có thể là
        // chương liền kề, dịch ở lượt khác) có thể đối chiếu trùng lặp với các chương này.
        files.forEach(f => {
            if (completedFileIds.has(f.id) && !flaggedStaleIds.has(f.id)) {
                const content = results.get(f.id);
                if (content) registerCompletedChapterFingerprint(storyInfo?.title, f.id, content);
            }
        });

        files.forEach(f => {
            if (!completedFileIds.has(f.id)) {
                // Determine specific error if batchReport flagged it
                const report = batchReport.details.get(f.id);
                const aiReport = aiValidationResults.get(f.id);
                if (aiReport && !aiReport.isValid) {
                    specificErrors.set(f.id, "Lỗi kiểm định AI (Tier 2): " + aiReport.reason);
                } else if (report && !report.isValid) {
                    const warningMsg = report.warnings.join(' | ');
                    if (warningMsg.includes("Lỗi: Trống nội dung (0%)")) {
                        specificErrors.set(f.id, "Thiếu kết quả từ API (Bị cắt ngang)");
                    } else if (warningMsg.includes("Nghi vấn nhầm chương") || warningMsg.includes("Nghi vấn nhảy nội dung") || warningMsg.includes("nhầm chương/chập chương") || report.contentConfidence < 0.4) {
                        specificErrors.set(f.id, "Nghi vấn lỗi nội dung (nhầm chương/lệch dòng)");
                    }
                }
                
                if (!specificErrors.has(f.id)) {
                    specificErrors.set(f.id, hitMaxTokensCutoff
                        ? "Bị cắt ngang do đạt giới hạn Token (MAX_TOKENS) - chưa dịch xong"
                        : "Thiếu kết quả từ API (Bị cắt ngang)");
                }
                
                invalidReasons.push(`${f.name || f.id}: ${specificErrors.get(f.id)}`);

                // BUG FIX: trước đây khối này CHỈ ghi log/specificErrors mà không hề xoá file
                // khỏi `results`, nên dù đã xác định đúng là "chưa hoàn thành" (isCompleted=false),
                // nội dung dịch dở dang vẫn được trả về cho useTranslator.ts như một file THÀNH
                // CÔNG bình thường (vì đó chỉ check results.has(id)) — tức là app "lưu" một file
                // thiếu mất đoạn cuối như thể đã xong, không đưa vào hàng đợi dịch lại. Xoá khỏi
                // results ở đây để đảm bảo file thật sự chưa hoàn chỉnh luôn bị loại và tự động
                // gửi lại vào hàng đợi (giống hệt cách Tier 1/Tier 2 phía trên đã làm).
                // NGOẠI LỆ: file đã bị Tier 1/2 đánh dấu flaggedStaleIds vẫn CÓ nội dung dịch hợp
                // lệ (chỉ nghi vấn, không phải thiếu/cắt ngang) - không được xoá khỏi results ở
                // đây, nếu không sẽ phá vỡ cơ chế "giữ bản dịch nghi vấn" phía trên.
                if (!flaggedStaleIds.has(f.id)) {
                    results.delete(f.id);
                }
            }
        });

        const missingOrInvalidCount = invalidReasons.length;
        if (missingOrInvalidCount > 0 && missingOrInvalidCount < files.length) { 
             if (onLog) {
                 const reasonStr = invalidReasons.join('; ');
                 onLog(`⏭️ Trả về hàng chờ để gom batch mới: ${missingOrInvalidCount}/${files.length} tệp lỗi/thiếu. Chi tiết: ${reasonStr}`);
             }
        } else if (missingOrInvalidCount === files.length && files.length > 0) { 
             if (onLog) {
                 const reasonStr = invalidReasons.join('; ');
                 onLog(`❌ Toàn bộ ${files.length} tệp trong lô (batch) này đều thất bại. Đang phân loại để cách ly... Chi tiết: ${reasonStr}`);
             }
             // BỎ THROW ERROR Ở ĐÂY ĐỂ TRẢ VỀ CỤ THỂ LỖI CHO USTRANSLATOR.TS CÁCH LY
        }
        
        if (streamErrorToReturn && results.size === 0 && specificErrors.size === 0) {
            throw streamErrorToReturn;
        }
        
        
        // --- POST-STREAM AUTO FIX LOGIC ---
        // Bỏ qua các file đã bị hậu kiểm đánh dấu nghi vấn (flaggedStaleIds) - sẽ được dịch lại
        // từ đầu nên không cần tốn thêm request sửa lỗi sót chữ cho bản dịch nghi vấn này.
        const bad: GlobalRepairEntry[] = [];
        results.forEach((c, id) => {
            if (flaggedStaleIds.has(id)) return;
            findLinesWithForeignChars(c).forEach(bl => bad.push({ fileId: id, lineIndex: bl.index, originalLine: bl.originalLine }));
        });

        if (bad.length > 0) {
            if (onLog) onLog(`🛠️ [Auto-Fix] Phát hiện ${bad.length} dòng lỗi sau khi Stream. Đang sửa...`);
            
            const fixModels = mid.startsWith('deepseek:') ? [mid] : (supportEnabledModels || enabledModels);
            const fixes = await performAggregatedRepair(bad, relDict, tier, globalContext, storyInfo, userPrompt, onLog, fixModels, undefined, shouldAbort, 'auto_fix', deepseekKey, deepseekModel);
            
            fixes.forEach((fm, id) => {
                const cur = results.get(id);
                if (cur) {
                    const originalFile = files.find(f => f.id === id);
                    const fixedContent = cleanupAiTextArtifacts(formatBookStyle(mergeFixedLines(cur, Array.from(fm.entries()).map(([idx, txt]) => ({ index: idx, text: txt }))), originalFile?.content, storyInfo?.enableTitleFormatting !== false));
                    results.set(id, fixedContent);
                    onUpdate(id, fixedContent); 
                }
            });
        }


        return { 
            results, 
            model: mid, 
            stats: { dictLines: relDict.split('\n').length, contextLines: relCtx.split('\n').length },
            errors: specificErrors,
            streamError: streamErrorToReturn,
            flaggedStaleIds
        };
        } finally {
            if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
        }
    }, "Dịch Streaming", onLog, preferredModelId);
};
