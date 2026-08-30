import { FileItem, FileStatus } from '../../types';
import { BATCH_MISSING_TAG_WARNING, countForeignChars, formatBookStyle, validateTranslationIntegrity, fixMergedTitle, cleanupAiTextArtifacts } from '../../utils/text';
import { getRescueTarget, getRescueBudget, getRescueLabel, getSafetyRescueBudgetLimit } from '../../services/workflows/translate/rescueTarget';

// Bản đồ kết quả trả về từ translateBatchStream cho 1 batch (kết quả từng file + lỗi
// riêng từng file + lỗi stream toàn batch + model đã dùng + các file bị hậu kiểm nghi vấn).
export interface BatchResultsMap {
    results: Map<string, string>;
    model?: string;
    errors?: Map<string, string>;
    streamError?: Error;
    flaggedStaleIds?: Set<string>;
}

// Kết quả "áp kết quả batch" lên trạng thái files: mảng files mới + toàn bộ thống kê/counter
// mà processBatch cần cho bước log tổng kết và reorder hàng chờ phía sau.
export interface BatchApplyOutcome {
    files: FileItem[];
    hasChanges: boolean;
    successCount: number;
    tmCollected: { src: string; dst: string }[];
    ratioErrorFiles: string[];
    ratioErrorIds: string[];
    missingResultFiles: string[];
    missingResultIds: string[];
    priorityRetryIds: Set<string>;
}

export interface ApplyBatchResultsContext {
    prev: FileItem[];
    batchIds: string[];
    resultsMap: BatchResultsMap;
    // Các file hậu kiểm (Tier 1/2) nghi vấn bản dịch - đã qua bước hậu kiểm lại (nếu có)
    flaggedStaleIds: Set<string>;
    // Kết quả quét trước an toàn cho các tệp "vạ lây" khi batch bị cắt ngang giữa chừng
    tailSafetyScan: Map<string, { isUnsafe: boolean; modelUsed: string }>;
    processingDuration: number;
    isFixPhase: boolean;
    storyInfo: any;
    stateStoryInfo: any;
    ratioLimits: any;
    deepseekKey?: string;
}

// R-A (tách khỏi processBatch/useTranslator): khối "áp kết quả batch" trở thành hàm THUẦN -
// nhận prev (trạng thái files hiện tại) + ngữ cảnh batch, trả về mảng files mới và toàn bộ
// counter thống kê thay vì mutate closure bên ngoài. Hành vi giữ nguyên 100% so với bản cũ
// (bản thân updater trong processBatch trước đây cũng đã mutate các biến ngoài nên việc
// gọi đúng 1 lần đồng bộ vẫn là điều kiện của call-site, không đổi ở đây).
export const applyBatchResults = (ctx: ApplyBatchResultsContext): BatchApplyOutcome => {
    const { prev, batchIds, resultsMap, flaggedStaleIds, tailSafetyScan, processingDuration, isFixPhase, storyInfo, stateStoryInfo, ratioLimits, deepseekKey } = ctx;

    let successCount = 0;
    let hasChanges = false;
    // NÂNG CẤP #7: gom bản dịch sạch trong batch này để lưu Translation Memory
    const tmCollected: { src: string; dst: string }[] = [];
    const ratioErrorFiles: string[] = [];
    const missingResultFiles: string[] = [];
    // FIX (ghép id retry theo NAME gây nhầm file trùng tên): song song với mảng name ở
    // trên, lưu luôn ID của từng file lỗi để reorderQueueWithPriority dùng thẳng ID -
    // 2 file trùng tên ("Chương 1" paste/zip trùng) trước đây khiến id của file vô tội
    // bị đẩy xuống cuối/ưu tiên oan, file lỗi thật giữ vị trí cũ rồi lại được chọn ngay
    // thành batch kế tiếp (thử đi thử lại liên tục).
    const ratioErrorIds: string[] = [];
    const missingResultIds: string[] = [];
    // Tệp cần được xử lý ƯU TIÊN ở lượt gom batch kế tiếp (xem reorderQueueWithPriority) -
    // gồm tệp vừa bị "cách ly để kiểm tra riêng" và tệp vừa được xác nhận
    // "Bàn giao DeepSeek", để chúng không bị chôn ở cuối hàng chờ dài.
    const priorityRetryIds = new Set<string>();

    const newFiles = [...prev];

    batchIds.forEach(id => {
        const fIndex = newFiles.findIndex(f => f.id === id);
        if (fIndex !== -1) {
            const f = newFiles[fIndex];

            // Hậu kiểm (Tier 1/2 - validateBatch/validateBatchWithAI) đã nghi vấn bản dịch
            // này, nhưng KHÔNG xoá nội dung dịch được nữa - giữ lại để xem xét, gắn cờ lỗi,
            // và đẩy xuống cuối hàng chờ (qua ratioErrorFiles bên dưới). Bản dịch nghi vấn
            // này sẽ tự động bị ghi đè khi lần dịch lại kế tiếp thành công.
            if (flaggedStaleIds.has(id) && resultsMap.results.has(id)) {
                const staleContent = resultsMap.results.get(id) || f.translatedContent;
                const specificErr = resultsMap.errors?.get(id) || "Nghi vấn lỗi nội dung (hậu kiểm)";
                ratioErrorFiles.push(f.name);
                ratioErrorIds.push(f.id);
                const maxRetries = getSafetyRescueBudgetLimit(isFixPhase);
                if ((f.retryCount || 0) < maxRetries) {
                    newFiles[fIndex] = {
                        ...f,
                        status: FileStatus.IDLE,
                        translatedContent: staleContent,
                        hasStaleTranslation: true,
                        // FIX (stale badge): nội dung vừa bị thay bằng bản NGHI VẤN
                        // mới -> phải tính lại số ký tự raw theo chính nội dung đó,
                        // nếu không FileCard/Smart Fix vẫn đọc số cũ của bản trước.
                        remainingRawCharCount: countForeignChars(staleContent || ''),
                        errorMessage: `${specificErr} - Đang thử lại (${(f.retryCount || 0) + 1}/${maxRetries})`,
                        retryCount: (f.retryCount || 0) + 1,
                        processingDuration
                    };
                } else {
                    newFiles[fIndex] = {
                        ...f,
                        status: FileStatus.ERROR,
                        translatedContent: staleContent,
                        hasStaleTranslation: true,
                        remainingRawCharCount: countForeignChars(staleContent || ''),
                        errorMessage: specificErr,
                        processingDuration
                    };
                }
                hasChanges = true;
                return;
            }

            if (resultsMap.results.has(id)) {
                const resultText = resultsMap.results.get(id);
                if (resultText) {
                    const finalContent = resultText;
                    const fixedContent = fixMergedTitle(finalContent);
                    const formattedContent = formatBookStyle(fixedContent, f.content, storyInfo?.enableTitleFormatting !== false, storyInfo?.titleFormat, storyInfo?.enableAutoFormat !== false);
                    // Sửa lặp từ liền kề + lỗi chính tả AI hay mắc (uể ủai -> uể oải...) — chạy
                    // SAU formatBookStyle vì đây là lỗi phát sinh trong lúc AI dịch, không liên
                    // quan tới việc định dạng/tách đoạn.
                    const cleanContent = cleanupAiTextArtifacts(formattedContent);
                    // fix50->fix51: bỏ applyInlineEnglishFix tự động khỏi pipeline dịch — chỉ chạy thủ công ở tab Sửa Lỗi (InlineEnglishFixPanel), tránh false-positive với từ tiếng Việt không dấu.
                    const remainingRaw = countForeignChars(cleanContent);

                    const integrity = validateTranslationIntegrity(f.content, cleanContent, ratioLimits, stateStoryInfo?.languages, resultsMap.model || f.usedModel);

                    let status = FileStatus.COMPLETED;
                    let errorMessage: string | undefined = undefined;
                    let ratioWarning: string | undefined = undefined;

                    if (!integrity.isValid) {
                        ratioErrorFiles.push(f.name);
                        ratioErrorIds.push(f.id);
                        const maxRetries = isFixPhase ? 1 : 2;
                        if ((f.retryCount || 0) < maxRetries) {
                            status = FileStatus.IDLE;
                            errorMessage = `${integrity.reason} - Đang thử lại (${(f.retryCount || 0) + 1}/${maxRetries})`;
                        } else {
                            status = FileStatus.ERROR;
                            errorMessage = integrity.reason;
                        }
                    } else if (cleanContent.includes(BATCH_MISSING_TAG_WARNING)) {
                        errorMessage = "Cảnh báo: Thiếu thẻ kết thúc trong batch";
                        successCount++;
                    } else {
                        if (integrity.reason) {
                            ratioWarning = integrity.reason;
                        }
                        // NÂNG CẤP #7 — Translation Memory: bản dịch sạch (qua hết
                        // kiểm tra tỷ lệ, không cảnh báo tag) được lưu lại để các lần
                        // retry/mở phiên sau khớp 100% nội dung gốc thì phục hồi miễn phí.
                        if (f.content.length <= 300000 && cleanContent.trim().length > 0) {
                            tmCollected.push({ src: f.content, dst: cleanContent });
                        }
                        successCount++;
                    }

                    newFiles[fIndex] = {
                        ...f,
                        status: status,
                        translatedContent: cleanContent,
                        // File này vừa nhận được nội dung dịch mới (dù đạt hay chưa đạt ratio),
                        // nên bản dịch nghi vấn cũ (nếu có) coi như đã bị thay thế - reset cờ.
                        hasStaleTranslation: false,
                        // Chỉ gỡ khoá cứu hộ khi lần dịch lại này THỰC SỰ thành công (COMPLETED) -
                        // dịch lại vẫn lỗi thì giữ nguyên khoá, không thả file quay về Gemini.
                        isRescueLocked: status === FileStatus.COMPLETED ? false : f.isRescueLocked,
                        // FIX49-a: nội dung dịch hoàn toàn mới -> reset lượt đếm vá dòng Smart Fix
                        // (Pro Mode) cũ, để file này lại được tính đủ MAX_SMART_FIX_RAW_ATTEMPTS
                        // lượt vá riêng cho bản dịch mới này nếu còn sót raw.
                        rawFixAttemptCount: 0,
                        remainingRawCharCount: remainingRaw,
                        usedModel: resultsMap.model,
                        errorMessage: errorMessage,
                        processingDuration: processingDuration,
                        // FIX (ngân sách retry bị "mòn" xuyên phiên): retryCount từng chỉ được
                        // tăng khi IDLE, KHÔNG BAO GIỜ reset về 0 khi dịch thành công — counter
                        // mang nghĩa "tổng lần lỗi cả phiên" thay vì "lượt thử lại cho VẤN ĐỀ
                        // HIỆN TẠI". File lỗi ratio 1 lần -> dịch thành công -> hàng giờ sau bị
                        // hậu kiểm gắn nghi vấn sẽ còn đúng 1 cơ hội thay vì đủ maxRetries.
                        // Đường TM-hit ở useTranslator.ts đã reset retryCount: 0 từ trước — đây
                        // là ngữ nghĩa đúng, đồng bộ luôn ở đường dịch thường.
                        retryCount: status === FileStatus.IDLE ? (f.retryCount || 0) + 1 : 0,
                        integrityRatio: integrity.ratio,
                        isFragmentedSource: integrity.isFragmentedSource || f.isFragmentedSource,
                        ratioWarning: ratioWarning || undefined
                    };
                    hasChanges = true;
                } else {
                    missingResultFiles.push(f.name);
                    missingResultIds.push(f.id);
                    const maxRetries = isFixPhase ? 1 : 2;
                    const specificErr = resultsMap.errors?.get(id) || "Lỗi không xác định từ API";
                    // Không nhận được nội dung gì cho lần thử này - giữ nguyên translatedContent
                    // cũ (có thể là bản dịch nghi vấn từ lần hậu kiểm trước) thay vì xoá trắng.
                    if ((f.retryCount || 0) < maxRetries) {
                        newFiles[fIndex] = { ...f, status: FileStatus.IDLE, translatedContent: f.translatedContent, errorMessage: `${specificErr} - Đang thử lại (${(f.retryCount || 0) + 1}/${maxRetries})`, retryCount: (f.retryCount || 0) + 1 };
                    } else {
                        newFiles[fIndex] = { ...f, status: FileStatus.ERROR, translatedContent: f.translatedContent, errorMessage: specificErr };
                    }
                    hasChanges = true;
                }
            } else {
                missingResultFiles.push(f.name);
                missingResultIds.push(f.id);
                const maxRetries = getSafetyRescueBudgetLimit(isFixPhase);

                let specificErr = resultsMap.errors?.get(id) || "Không nhận được kết quả cho file này";
                let shouldIncrementRetry = true;

                if (resultsMap.streamError || specificErr.includes("Thiếu kết quả từ API") || specificErr.includes("Lỗi ngắt kết nối API")) {
                    const streamErrStr = (resultsMap.streamError?.message || specificErr).toLowerCase();
                    const isQuotaErrorMsg = streamErrStr.includes("429") || streamErrStr.includes("quota");
                    const isSafetyError = !isQuotaErrorMsg && (streamErrStr.includes("bộ lọc an toàn") || streamErrStr.includes("safety") || streamErrStr.includes("blocklist") || streamErrStr.includes("prohibited_content"));

                    if (missingResultFiles.length === 1) { // First file missing
                        specificErr = isSafetyError ? "Nghi vấn lỗi nội dung nhạy cảm - Đang cách ly để kiểm tra riêng" : "Nghi vấn lỗi nội dung hoặc format - Đang cách ly để kiểm tra riêng";
                        priorityRetryIds.add(id);
                    } else {
                        // Đã quét trước (tailSafetyScan) cho tệp "ăn theo" này chưa, và nếu có,
                        // chính nội dung của nó có thực sự nghi vấn hay không (xem khối quét
                        // trước core.setFiles ở trên). Nếu nghi vấn thật -> xử lý y hệt 1 tệp
                        // đã xác nhận unsafe: bàn giao thẳng cho vệ tinh cứu hộ thay vì tiếp
                        // tục "vạ lây" chờ dịch lại với Gemini vô thời hạn.
                        const tailScan = tailSafetyScan.get(id);
                        if (tailScan?.isUnsafe) {
                            const hasDS = !!(deepseekKey && deepseekKey.trim().length > 0);
                            const target = getRescueTarget(f.retryCount || 0, hasDS, maxRetries);
                            if (target) {
                                const rescueBudget = getRescueBudget(hasDS, maxRetries);
                                const errMsg = `Nghi vấn lỗi nội dung nhạy cảm (quét trước) - Bàn giao ${getRescueLabel(target)} (${(f.retryCount || 0) + 1}/${rescueBudget})`;
                                newFiles[fIndex] = { ...f, status: FileStatus.IDLE, translatedContent: f.translatedContent, errorMessage: errMsg, retryCount: (f.retryCount || 0) + 1 } as any;
                                priorityRetryIds.add(id);
                            } else {
                                const reason = hasDS ? "Đã hết lượt cứu hộ DeepSeek" : "Không có vệ tinh DeepSeek dự phòng";
                                newFiles[fIndex] = { ...f, status: FileStatus.ERROR, translatedContent: f.translatedContent, errorMessage: `Bị chặn bởi Safety Filter (quét trước) (${reason})` };
                            }
                            hasChanges = true;
                            return;
                        }
                        specificErr = "Chờ thử lại do vạ lây từ file lỗi trong batch";
                        shouldIncrementRetry = false;
                    }
                }

                // Không nhận được nội dung gì cho lần thử này - giữ nguyên translatedContent
                // cũ (có thể là bản dịch nghi vấn từ lần hậu kiểm trước) thay vì xoá trắng.
                if ((f.retryCount || 0) < maxRetries) {
                    const newRetryCount = shouldIncrementRetry ? (f.retryCount || 0) + 1 : (f.retryCount || 0);
                    newFiles[fIndex] = { ...f, status: FileStatus.IDLE, translatedContent: f.translatedContent, errorMessage: shouldIncrementRetry ? `${specificErr} - Đang thử lại (${newRetryCount}/${maxRetries})` : specificErr, retryCount: newRetryCount, isSafeRebatch: !shouldIncrementRetry } as any;
                } else {
                    newFiles[fIndex] = { ...f, status: FileStatus.ERROR, translatedContent: f.translatedContent, errorMessage: specificErr };
                }
                hasChanges = true;
            }
        }
    });

    // Giữ đúng hành vi bản cũ: không có thay đổi thì trả lại chính prev (tránh cập nhật
    // state/re-render thừa).
    return { files: hasChanges ? newFiles : prev, hasChanges, successCount, tmCollected, ratioErrorFiles, ratioErrorIds, missingResultFiles, missingResultIds, priorityRetryIds };
};
