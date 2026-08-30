import { useEffect, useCallback, useRef } from 'react';
import { FileItem, FileStatus, LogContext, TranslationTier } from '../types';
import { IS_LITE, LITE_BATCH_CONFIG, MODEL_CONFIGS, getModelFamily } from '../constants';
import { ensureGeminiKeyForLite } from '../services/api/gemini';
import { translateBatchStream } from '../services/workflows/translate/streamTranslate';
import { getEffectiveModelsForTier, getRequiredSupportModels, loadTranslationModelSelection, normalizeTranslationTier, sanitizeTranslationModelSelection } from '../services/workflows/translate/modelSelection';
import { BATCH_MISSING_TAG_WARNING } from '../utils/text';
import { quotaManager } from '../utils/quotaManager';
import { getRescueTarget, getRescueBudget, getRescueLabel, getSafetyRescueBudgetLimit, getQuotaRescueBudgetLimit } from '../services/workflows/translate/rescueTarget';
import { identifyRecoveryCandidates, identifyBorderlineFiles, runRecoveryVerification, runDiagnosisPass } from '../services/workflows/translate/startupTriage';
import { classifyShortRawFiles, isConfirmedNonStoryFile, needsShortFileClassification } from '../services/workflows/translate/shortFileClassifier';
import { fingerprintShortRawContent } from '../utils/text/nonStoryPolicy';
import { stripTitleAnchor } from '../utils/fileHelpers';
import { lookupTranslationMemory, saveTranslationMemoryEntries, deleteTranslationMemoryEntries } from '../utils/text/translationMemory';
import { reorderQueueWithPriority } from './translator/queuePriority';
import { applyBatchResults, BatchApplyOutcome, BatchResultsMap } from './translator/applyBatchResults';
import { isolateUnsafeFiles } from './translator/isolateUnsafeFiles';
import { beginFileTransactions, rollbackAndCloseAllFileTransactions, rollbackAndCloseFileTransactions, rollbackBatchFileTransactions, settleBatchFileTransactions } from './translator/fileTransactions';
import type { CoreApi, UIApi } from './apiTypes';

// FIX67 (đề xuất fix66): chỉ cảnh báo TIỀN SỬ nội dung của 1 tệp đúng 1 lần mỗi phiên (tránh
// spam log khi tệp đó lặp lại qua nhiều batch). Set sống theo module = theo phiên tải trang.
const strikeWarnedIds = new Set<string>();

export const useTranslator = (
    core: CoreApi,
    ui: UIApi,
    sharedState: any,
    smartFixFns: any
) => {
    const {
        isProcessing, setIsProcessing,
        activeBatches, setActiveBatches,
        processingQueue, setProcessingQueue,
        translationTier, setTranslationTier,
        startTime, setStartTime,
        setEndTime,
        isSmartAutoMode, setIsSmartAutoMode,
        autoFixEnabled, setAutoFixEnabled,
        retryTrigger, setRetryTrigger,
        setAutoStoppedRemainingCount,
        isFixPhaseRef, scheduledBatchesRef, runIdRef, isProcessingRef,
        effectiveDictionary, filesRef, isRepairRunningRef, fileTransactionsRef
    } = sharedState;

    const { handleSmartFix, handleFixRemainingRaw } = smartFixFns;

    // NEW (theo yêu cầu người dùng): đánh dấu khi Gemini đã xác nhận hết Quota TẤT CẢ model khả
    // dụng cho chế độ dịch hiện tại (nhánh isAllQuotaExhausted bên dưới). Khi cờ này bật, hệ thống
    // KHÔNG tự động đẩy thêm các tệp CHƯA từng thử (chưa mang tag bàn giao vệ tinh) sang DeepSeek
    // nữa — chỉ để đúng các tệp ĐÃ được bàn giao (đang dở dang từ đợt vừa hết Quota)
    // chạy cho xong qua vệ tinh, rồi DỪNG HẲN hệ thống thay vì âm thầm biến vệ tinh thành công cụ
    // dịch chính cho toàn bộ phần còn lại của hàng đợi. Reset về false mỗi khi bắt đầu phiên dịch
    // mới (executeProcessing) để lần Start tiếp theo thử lại Gemini bình thường.
    const geminiExhaustedRef = useRef<boolean>(false);
    // FIX (hậu kiểm khởi động chạy chồng): trong khoảng hàng phút khi triage đang gọi AI đối
    // chiếu, isProcessing vẫn là false và không có ref nào đánh dấu "triage đang chạy" — nên
    // double-click Bắt Đầu (hoặc bấm Start trong lúc "Hậu kiểm lại ngay" đang chạy) khởi tạo
    // 2 lượt triage song song: cả 2 cùng setFiles + đè filesRef, cùng tăng runIdRef, gấp đôi
    // chi phí API. Ref này làm khoá nhập cho cả 2 cửa vào (executeProcessing,
    // runManualRescueCheck).
    const isTriageRunningRef = useRef<boolean>(false);
    const activeTranslationModelsRef = useRef<string[]>([]);
    const runtimeEnabledModelsRef = useRef<string[]>(core.enabledModels);

    useEffect(() => { runtimeEnabledModelsRef.current = core.enabledModels; }, [core.enabledModels]);

    // FIX "Dịch Lại không có tác dụng với file đã có bản dịch": các id được người dùng chủ động
    // Dịch Lại sẽ bị CẤM tra cứu Translation Memory trong phiên hiện tại. Không có chặn này,
    // scheduler bên dưới khớp TM ngay (bản dịch cũ đã được lưu khi lần trước thành công) và gắn
    // TRẢ LẠI đúng bản cũ với usedModel='TM' — người dùng thấy "dịch lại xong" mà văn bản không
    // đổi, tốn 0 request API. Id được thêm vào handleRetranslateConfirm và sống theo phiên hook.
    const retranslateSkipTmIdsRef = useRef<Set<string>>(new Set());

    const processBatch = useCallback(async (batchIds: string[], tier: TranslationTier, myRunId: number, preferredModelId?: string) => {
        if (!isProcessing || myRunId !== runIdRef?.current) return;
        
        const batchFiles = filesRef?.current.filter((f: FileItem) => batchIds.includes(f.id));
        if (batchFiles.length === 0) return;

        const batchId = `${myRunId}-${crypto.randomUUID().slice(0, 8)}`;
        beginFileTransactions(fileTransactionsRef.current, batchFiles, myRunId,
            batchFiles.some((file: FileItem) => !!file.translatedContent) ? 'retranslate' : 'translate');

        const firstFileName = batchFiles[0].name;
        const lastFileName = batchFiles[batchFiles.length - 1].name;
        const batchStartTime = Date.now();
        
        const isSafeRebatch = batchFiles.every(f => (f as any).isSafeRebatch);
        if (isSafeRebatch) {
             ui.addLog(`✅ Bắt đầu dịch lại gộp (Batch) ${batchFiles.length} tệp an toàn qua Gemini...`, 'success');
             // remove flag to not print this again if it fails for other reasons later
             core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => 
                batchIds.includes(f.id) ? { ...f, isSafeRebatch: false } as FileItem : f
             ));
        } else {
             ui.addLog(`🚀 Bắt đầu dịch Batch gồm ${batchFiles.length} tệp (từ ${firstFileName} đến ${lastFileName})`, 'info');
        }

        const inputs = batchFiles.map(f => ({ id: f.id, content: f.content, name: f.name, fileRetryCount: f.retryCount || 0, errorMessage: f.errorMessage }));

        // FIX67 (đề xuất fix66): cảnh báo khi batch chứa tệp có TIỀN SỬ gây lỗi nội dung
        // (contentStrikes >= 2 — được ghi ở isolateUnsafeFiles các lần trước, sống qua restart).
        // Không chặn dịch (nội dung có thể đã được chỉnh sửa), chỉ đặt dấu hỏi để khi batch này
        // dính lỗi rỗng/Safety thì cơ chế cách ly sẽ ưu tiên tệp này trước tiên.
        for (const sf of batchFiles) {
            const strikes = sf.contentStrikes || 0;
            if (strikes >= 2 && !strikeWarnedIds.has(sf.id)) {
                strikeWarnedIds.add(sf.id);
                ui.addLog(`⚠️ Tệp "${sf.name}" từng gây lỗi nội dung ${strikes} lần trước đây. Nếu batch này lại dính lỗi rỗng/Safety Filter, hệ thống sẽ ưu tiên cách ly tệp này trước.`, 'warning');
            }
        }

        let stalledTimeoutId: any = null;
        
        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => 
            batchIds.includes(f.id) ? { ...f, status: FileStatus.PROCESSING, usedModel: undefined } : f
        ));
        
        try {
            if (myRunId !== runIdRef?.current) return;

            // Throttled updater to prevent React crash from too many state updates during streaming
            const pendingUpdates = new Map<string, string>();
            let updateTimeout: any = null;
            const flushUpdates = () => {
                if (pendingUpdates.size > 0 && myRunId === runIdRef?.current) {
                    const updates = new Map(pendingUpdates);
                    pendingUpdates.clear();
                    core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => 
                        updates.has(f.id) ? { ...f, translatedContent: updates.get(f.id)! } : f
                    ));
                }
                updateTimeout = null;
            };

            const translationModels = isFixPhaseRef?.current
                ? getEffectiveModelsForTier(translationTier, 'smart_fix', runtimeEnabledModelsRef.current)
                : activeTranslationModelsRef.current.length > 0
                    ? activeTranslationModelsRef.current
                    : getEffectiveModelsForTier(tier, 'translate', runtimeEnabledModelsRef.current);
            const resultsMap = await Promise.race([
                translateBatchStream(
                    inputs,
                    core.promptTemplate,
                    effectiveDictionary,
                    core.storyInfo.contextNotes,
                    translationModels,
                    "", // previousBatchContext
                    (fileId, partialContent) => {
                        if (myRunId === runIdRef?.current) {
                            // Không để lộ marker nội bộ "__TITLE_ANCHOR__:" ra bản xem trước lúc đang
                            // dịch (streaming) - marker chỉ được formatBookStyle lọc bỏ khi batch dịch
                            // xong hẳn (dòng ~239), nên nếu không lọc ở đây, người dùng đang theo dõi
                            // trực tiếp có thể thoáng thấy dòng "__TITLE_ANCHOR__: ..." vài trăm ms
                            // trước khi batch hoàn tất.
                            pendingUpdates.set(fileId, stripTitleAnchor(partialContent));
                            if (!updateTimeout) {
                                updateTimeout = setTimeout(flushUpdates, 500); // 500ms throttle
                            }
                        }
                    }, // onUpdate
                    (msg: string, context?: LogContext) => {
                        if (myRunId === runIdRef?.current) ui.addLog(msg, 'info', { ...context, operation: context?.operation || 'translate', runId: String(myRunId), batchId });
                    },
                    tier,
                    translationModels,
                    core.stateRef.current.storyInfo,
                    preferredModelId, // FIX61: ghép cặp sizing-model ↔ execution-model (trước đây luôn undefined)
                    () => myRunId !== runIdRef?.current, // shouldAbort
                    core.stateRef.current.ratioLimits,
                    core.deepseekKey,
                    core.deepseekModel,
                    runtimeEnabledModelsRef.current
                ),
                // BUGFIX (batch bị "treo" vô thời hạn): translateBatchStream() có timeout nội bộ
                // riêng cho từng chunk (STREAM_TIMEOUT 900s) và cho lúc mở kết nối (CONNECTION_TIMEOUT
                // 3600s) — nhưng nếu vì lý do nào đó (ví dụ 1 lời gọi phụ bên trong smartExecution/hậu
                // kiểm AI bị treo sau khi stream chính đã đọc xong, không nằm trong 2 timeout trên) mà
                // promise không bao giờ resolve/reject, cả batch (và slot đồng thời nó chiếm) sẽ bị
                // "mồ côi" vĩnh viễn — các file trong batch đứng yên ở trạng thái PROCESSING
                // ("Streaming...") mãi mãi, không có log lỗi, không được thử lại, không giải phóng slot
                // cho các batch sau (khiến hệ thống âm thầm giảm số luồng chạy song song thực tế).
                // Thêm 1 mốc timeout TỔNG ở tầng ngoài này (rộng rãi hơn nhiều so với timeout nội bộ,
                // để không cắt ngang batch đang chạy bình thường) làm lưới an toàn cuối cùng: nếu vẫn
                // chưa xong sau 25 phút, coi như lỗi treo, ném lỗi để rơi vào catch bên dưới — nơi đã
                // có sẵn logic reset file về IDLE để thử lại + giải phóng activeBatches ở finally.
                new Promise<never>((_, reject) => {
                    stalledTimeoutId = setTimeout(() => reject(new Error('BATCH_STALLED_TIMEOUT: Batch không phản hồi sau 25 phút, có thể đã bị treo.')), 25 * 60 * 1000) as any;
                })
            ]);
            
            if (stalledTimeoutId) clearTimeout(stalledTimeoutId);
            
            // Flush any remaining updates
            if (updateTimeout) {
                clearTimeout(updateTimeout);
                flushUpdates();
            }
            
            if (myRunId !== runIdRef?.current) {
                // Phiên đã bị thay thế (runId tăng) giữa chừng: trả các file của batch cũ khỏi
                // trạng thái PROCESSING để chúng không kẹt badge "Đang xử lý" vĩnh viễn. Chỉ những
                // file vẫn đang PROCESSING mới bị đụng tới - kết quả đã ghi trước đó giữ nguyên.
                core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) =>
                    batchIds.includes(f.id) && f.status === FileStatus.PROCESSING
                        ? { ...f, status: FileStatus.IDLE }
                        : f
                ));
                return;
            }
            const batchEndTime = Date.now();
            const processingDuration = batchEndTime - batchStartTime;

            // FIX (cách ly quá gắt khi cắt ngang giữa batch): trước đây nếu batch bị cắt ngang bởi
            // bộ lọc an toàn ở 1 tệp giữa chừng (ví dụ tệp 51/60), TOÀN BỘ các tệp phía sau (chưa
            // kịp dịch vì stream đã dừng) chỉ bị gắn nhãn chung "vạ lây" và đưa lại hàng chờ mà
            // không hề được kiểm tra riêng nội dung của chính chúng - khiến các tệp thực sự có vấn
            // đề (nếu có) không bao giờ kích hoạt được cơ chế cứu hộ (DeepSeek), cứ dịch
            // lại với Gemini vô thời hạn. Ở đây ta quét TRƯỚC (bằng testContentSafety, giống hệt cơ
            // chế đã có sẵn cho trường hợp cả batch rỗng hoàn toàn) cho từng tệp "vạ lây" này, để
            // phân biệt: tệp nào tự nó nghi vấn vi phạm -> bàn giao thẳng cho vệ tinh cứu hộ; tệp
            // nào an toàn -> giữ nguyên hành vi cũ (trả lại hàng chờ dịch bình thường, không tính
            // thêm retryCount).
            const tailSafetyScan = new Map<string, { isUnsafe: boolean; modelUsed: string }>();
            {
                const missingIdsInOrder = batchIds.filter(id => !resultsMap.results.has(id));
                if (missingIdsInOrder.length > 1 && myRunId === runIdRef?.current) {
                    const globalStreamErr = (resultsMap as any).streamError;
                    const firstMissingId = missingIdsInOrder[0];
                    const firstSpecificErr = ((resultsMap as any).errors?.get(firstMissingId) || '') as string;
                    const streamErrStr = (globalStreamErr?.message || firstSpecificErr).toLowerCase();
                    const isQuotaErrorMsg = streamErrStr.includes("429") || streamErrStr.includes("quota");
                    const isSafetyCutoff = !isQuotaErrorMsg && (streamErrStr.includes("bộ lọc an toàn") || streamErrStr.includes("safety") || streamErrStr.includes("blocklist") || streamErrStr.includes("prohibited_content"));

                    if (isSafetyCutoff) {
                        const tailIds = missingIdsInOrder.slice(1); // tệp đầu tiên đã có luồng cách ly-thử-lại-riêng của chính nó
                        if (tailIds.length > 0) {
                            ui.addLog(`🔍 Batch bị cắt ngang giữa chừng, nghi do bộ lọc an toàn. Đang quét trước nội dung ${tailIds.length} tệp "vạ lây" (chưa kịp dịch) trước khi đưa lại hàng chờ...`, 'info');
                            try {
                                const { testContentSafety } = await import('../services/workflows/translator');
                                for (const tailId of tailIds) {
                                    if (myRunId !== runIdRef?.current) break;
                                    const tf = batchFiles.find((x: FileItem) => x.id === tailId);
                                    if (!tf) continue;
                                    await new Promise(r => setTimeout(r, 1500)); // tránh dồn dập request quét, giống luồng quét cả-batch-rỗng
                                    const scan = await testContentSafety(tf.content, runtimeEnabledModelsRef.current);
                                    tailSafetyScan.set(tailId, { isUnsafe: !scan.isSafe, modelUsed: scan.modelUsed });
                                    if (!scan.isSafe) {
                                        ui.addLog(`🚨 Tệp ${tf.name} (vạ lây) thực chất TỰ nó nghi vấn vi phạm bộ lọc an toàn (Quét bởi ${scan.modelUsed})!`, 'warning');
                                    }
                                }
                                if (tailSafetyScan.size > 0) {
                                    const unsafeCount = Array.from(tailSafetyScan.values()).filter(v => v.isUnsafe).length;
                                    ui.addLog(`📊 Kết quả quét trước tệp vạ lây: ${unsafeCount} tệp nghi vấn, ${tailSafetyScan.size - unsafeCount} tệp an toàn.`, 'info');
                                }
                            } catch (scanErr: any) {
                                ui.addLog(`⚠️ Không quét trước được an toàn cho các tệp vạ lây (${scanErr?.message || 'lỗi không xác định'}) - giữ hành vi cũ (đưa lại hàng chờ dịch bình thường).`, 'warning');
                            }
                        }
                    }
                }
            }

            const flaggedStaleIds: Set<string> = (resultsMap as any).flaggedStaleIds || new Set();

            // FIX (đề xuất từ fix13 - tránh dịch lại lãng phí khi hậu kiểm chỉ "không chắc" chứ
            // không hẳn "sai thật"): trước đây MỌI file rơi vào `flaggedStaleIds` (dù do Tier 2 xác
            // nhận rõ ràng sai, HAY chỉ đơn giản là hậu kiểm không lấy được kết quả - lỗi gọi API/
            // JSON hỏng, xem aiValidation.ts) đều bị coi như nhau: đưa về IDLE, và ở lượt xử lý tiếp
            // theo bị DỊCH LẠI TOÀN BỘ bằng model (translateBatchStream) - tốn nguyên 1 lượt gọi dịch
            // dù bản dịch cũ có thể hoàn toàn ổn. Startup Triage đã có bước "hậu kiểm lại thay vì
            // dịch lại" (runRecoveryVerification, fix8) cho các file ERROR/IDLE khi BẮT ĐẦU phiên -
            // ở đây áp dụng lại đúng cơ chế đó cho các file vừa bị flag NGAY TRONG batch hiện tại,
            // trước khi quyết định đưa về IDLE để dịch lại từ đầu. Chỉ 1 lượt hậu kiểm nhẹ (không
            // tốn model dịch), nếu xác nhận lại là ỔN thì nhận luôn COMPLETED (bỏ qua nhánh
            // flaggedStaleIds bên dưới hoàn toàn); nếu vẫn bị từ chối hoặc hậu kiểm lại cũng lỗi
            // (fail-closed, giữ nguyên tinh thần an toàn cũ) thì rơi về đúng hành vi cũ (IDLE, dịch
            // lại thật ở lượt sau).
            if (flaggedStaleIds.size > 0 && myRunId === runIdRef?.current) {
                const reverifyCandidates: FileItem[] = [];
                flaggedStaleIds.forEach(id => {
                    if (!resultsMap.results.has(id)) return;
                    const bf = batchFiles.find((x: FileItem) => x.id === id);
                    if (!bf) return;
                    const staleContent = resultsMap.results.get(id);
                    if (!staleContent) return;
                    reverifyCandidates.push({ ...bf, translatedContent: staleContent });
                });

                if (reverifyCandidates.length > 0) {
                    try {
                        const reverify = await runRecoveryVerification(
                            reverifyCandidates,
                            runtimeEnabledModelsRef.current,
                            (msg: string) => { if (myRunId === runIdRef?.current) ui.addLog(`[Hậu kiểm lại trước khi dịch lại] ${msg}`, 'info'); },
                            core.deepseekKey,
                            core.triageDelays
                        );
                        if (reverify.recoveredIds.size > 0) {
                            ui.addLog(`✅ Hậu kiểm lại xác nhận ${reverify.recoveredIds.size}/${reverifyCandidates.length} tệp thực chất ỔN (không cần dịch lại) — bỏ qua, giữ nguyên bản dịch.`, 'success');
                            reverify.recoveredIds.forEach(id => flaggedStaleIds.delete(id));
                        }
                    } catch (e: any) {
                        // Hậu kiểm lại thất bại (lỗi gọi API) - fail-closed, giữ nguyên flaggedStaleIds
                        // như cũ (rơi về hành vi dịch lại như trước khi có bước này).
                        ui.addLog(`⚠️ Hậu kiểm lại trước khi dịch lại thất bại (giữ hành vi cũ - đưa vào hàng chờ dịch lại): ${e?.message || e}`, 'warning');
                    }
                }
            }

            // R-A (tách khỏi processBatch): khối "áp kết quả batch" giờ là hàm THUẦN
            // applyBatchResults() - nhận prev + ngữ cảnh batch, trả về mảng files mới và toàn bộ
            // counter thống kê (xem hooks/translator/applyBatchResults.ts). createSafeSetter gọi
            // updater ĐỒNG BỘ ngay tại lời gọi nên ta thu kết quả ở ngay dưới đây - semantics y
            // hệt bản cũ (bản trước cũng mutate các counter ngoài ngay trong updater).
            let applyOutcome: BatchApplyOutcome | null = null;
            core.setFiles((prev: FileItem[]) => {
                applyOutcome = applyBatchResults({
                    prev,
                    batchIds,
                    resultsMap: resultsMap as unknown as BatchResultsMap,
                    flaggedStaleIds,
                    tailSafetyScan,
                    processingDuration,
                    isFixPhase: !!isFixPhaseRef?.current,
                    storyInfo: core.storyInfo,
                    stateStoryInfo: core.stateRef.current.storyInfo,
                    ratioLimits: core.stateRef.current.ratioLimits,
                    deepseekKey: core.deepseekKey
                });
                applyOutcome.files = settleBatchFileTransactions(applyOutcome.files, batchIds, fileTransactionsRef.current, myRunId);
                return applyOutcome.files;
            });
            // ratioErrorFiles/missingResultFiles (tên tệp, chỉ dùng cho thống kê nội bộ của
            // applyBatchResults) không được đọc ở đây nên không destructuring ra.
            const { successCount, tmCollected, ratioErrorIds, missingResultIds, priorityRetryIds } = applyOutcome!;

            // NÂNG CẤP #7 — persist các bản dịch sạch vào Translation Memory (sau khi setFiles,
            // cùng tick nên an toàn với createSafeSetter). API giờ bất đồng bộ (IndexedDB) nên
            // chạy nền fire-and-forget: thành công thì ghi log số lượng, lỗi chỉ warn không làm
            // rơi batch dịch chính.
            if (tmCollected.length > 0) {
                const tmStoryTitle = core.stateRef?.current?.storyInfo?.title;
                saveTranslationMemoryEntries(tmStoryTitle, tmCollected)
                    .then((savedCount) => { if (savedCount > 0) ui.addLog(`💾 Đã lưu ${savedCount} bản dịch vào Translation Memory.`, 'info'); })
                    .catch((e) => console.warn("Lưu Translation Memory thất bại:", e));
            }

            if (myRunId === runIdRef?.current) {
                setProcessingQueue(prev => {
                    const failedIds = [...missingResultIds, ...ratioErrorIds].filter(id => batchIds.includes(id));
                    if (failedIds.length > 0) {
                        return reorderQueueWithPriority(prev, failedIds, priorityRetryIds);
                    }
                    return prev;
                });
                
                const durationStr = (processingDuration / 1000).toFixed(1);
                
                // FIX (log tổng kết batch luôn rỗng): trước đây đọc filesRef.current NGAY SAU
                // core.setFiles(...) trong cùng 1 tick - filesRef chỉ được useEffect đồng bộ sau
                // khi React commit nên luôn thấy trạng thái TRƯỚC batch (đang PROCESSING), khiến
                // finalErrorFiles/retryingFiles hầu như luôn rỗng dù batch thất bại một nửa.
                // createSafeSetter cập nhật core.stateRef.current.files ĐỒNG BỘ ngay tại lời gọi
                // setFiles -> đọc từ đó để log phản ánh đúng thực tế.
                const freshFiles: FileItem[] = (core.stateRef?.current?.files as FileItem[]) || filesRef.current || [];
                
                const finalErrorFiles = batchFiles.filter(f => {
                    const updated = freshFiles.find((x: FileItem) => x.id === f.id);
                    return updated && updated.status === FileStatus.ERROR;
                }).map(f => f.name);
                
                const retryingFiles = batchFiles.filter(f => {
                    const updated = freshFiles.find((x: FileItem) => x.id === f.id);
                    return updated && updated.status === FileStatus.IDLE;
                }).map(f => ({ name: f.name, id: f.id }));
                
                let icon = '✅';
                let logLevel: 'success'|'warning'|'error' = 'success';
                
                if (successCount === batchFiles.length) {
                    icon = '✅';
                    logLevel = 'success';
                } else if (successCount > 0) {
                    icon = '⚠️';
                    logLevel = 'warning';
                } else {
                    icon = '❌';
                    logLevel = 'error';
                }
                
                let logMsg = `${icon} Batch ${batchFiles.length} tệp (${firstFileName} → ${lastFileName}) | ${durationStr}s | `;
                logMsg += `✓${successCount} `;
                
                if (finalErrorFiles.length > 0) {
                    logMsg += `| ❌ Thất bại (${finalErrorFiles.length}): ${finalErrorFiles.join(', ')} `;
                }
                
                if (retryingFiles.length > 0) {
                    // FIX ([object Object] trong log): retryingFiles giờ là mảng {name,id} —
                    // phải map ra name trước khi join, nếu không log hiện "[object Object]".
                    logMsg += `| 🔄 Đang thử lại (${retryingFiles.length}): ${retryingFiles.map(r => r.name).join(', ')}`;
                }
                
                const resolvedModel = (resultsMap as any).model as string | undefined;
                ui.addLog(logMsg, logLevel, { operation: 'translate', provider: resolvedModel?.startsWith('deepseek:') ? 'deepseek' : 'gemini', modelId: resolvedModel, runId: String(myRunId), batchId, durationMs: processingDuration, cause: successCount === batchFiles.length ? 'completed' : (successCount > 0 ? 'partial' : 'failed') });

                // FIX (giảm rủi ro "mất trắng dữ liệu"): trước đây chỉ lưu tự động mỗi 2 phút
                // (hẹn giờ) hoặc khi TOÀN BỘ hàng đợi dịch xong. Với các job dịch dài (hàng chục,
                // hàng trăm file), nếu app bị crash/đóng đột ngột giữa chừng, mọi tiến độ đã dịch
                // xong nhưng chưa tới mốc lưu định kỳ sẽ mất hết, khiến người dùng thấy "về như
                // mới". Gọi lưu (không ép buộc, không chặn UI) ngay sau MỖI batch nhỏ hoàn tất để
                // thu hẹp cửa sổ mất dữ liệu xuống chỉ còn ~1 batch nhỏ thay vì cả job.
                core.saveSession();
                
                if (retryingFiles.length > 0) {
                    retryingFiles.forEach(({ name, id }) => {
                        const f = freshFiles.find((x: FileItem) => x.id === id);
                        if (f && f.errorMessage) {
                            ui.addLog(`  🔄 [Thử lại] ${name}: ratio=${f.integrityRatio?.toFixed(2) ?? '?'} | ${f.errorMessage}`, 'warning');
                        }
                    });
                }
                
                if (finalErrorFiles.length > 0) {
                    finalErrorFiles.forEach(name => {
                        const f = freshFiles.find((x: FileItem) => x.name === name && batchIds.includes(x.id));
                        if (f && f.errorMessage) {
                            ui.addLog(`  ❌ [Lỗi] ${name}: ratio=${f.integrityRatio?.toFixed(2) ?? '?'} | ${f.errorMessage}`, 'error');
                        }
                    });
                }
            }

        } catch (error: any) {
            core.setFiles((prev: FileItem[]) => rollbackBatchFileTransactions(prev, batchIds, fileTransactionsRef.current, myRunId));
            if (myRunId !== runIdRef?.current || error.message === 'ABORTED') {
                if (myRunId !== runIdRef?.current) {
                    core.setFiles((prev: FileItem[]) => rollbackAndCloseFileTransactions(prev, batchIds, fileTransactionsRef.current, myRunId));
                }
                return;
            }
            const isAllQuotaExhausted = error.message.includes("Tất cả model khả dụng đã hết Quota hoặc bị tắt") || error.message.includes("Tất cả model đã thử đều gặp lỗi hoặc hết Quota");
            const isQuotaError = error.message.includes("429") || error.message.toLowerCase().includes("quota");
            const isSafetyError = !isAllQuotaExhausted && !isQuotaError && (error.message.includes("bộ lọc an toàn") || error.message.toLowerCase().includes("safety") || error.message.includes("BLOCKLIST") || error.message.includes("PROHIBITED_CONTENT"));
            
            // R-A (tách khỏi processBatch): nhánh safety-scan/cách ly giờ là hàm riêng
            // isolateUnsafeFiles() - quét an toàn, bàn giao vệ tinh cứu hộ hoặc cách ly, tự
            // reorder hàng chờ + kích hoạt retry (xem hooks/translator/isolateUnsafeFiles.ts).
            // Trả về true khi đã xử lý xong lỗi Safety -> thoát sớm khỏi catch; false khi lỗi
            // không thuộc loại này và phải rơi xuống các nhánh quota/blacklist bên dưới.
            if (isSafetyError && await isolateUnsafeFiles({
                batchIds,
                batchFiles,
                error,
                core,
                ui,
                myRunId,
                runIdRef,
                isFixPhaseRef,
                setProcessingQueue,
                setRetryTrigger
            })) {
                return;
            }

            if (isAllQuotaExhausted) {
                // FIX (bug "lỗi bộ lọc an toàn âm thầm -> dừng cả hệ thống -> báo sai hết Quota"):
                // message "Tất cả model..." hiện có 2 bản chất HOÀN TOÀN khác nhau, phân biệt qua
                // tag do gemini.ts gắn ở cuối message:
                //  - [CAUSE:BLACKLIST_TEMP]: không model nào cạn quota thật — toàn bộ chỉ bị
                //    blacklist TẠM trong lượt này (rất hay do bộ lọc nội dung chặn ÂM THẦM khiến
                //    model trả kết quả rỗng/lặp vô nghĩa liên tục). Trước đây nhánh này DỪNG HẲN
                //    hệ thống + xoá sạch hàng đợi + báo "hết Quota" — trong khi chỉ cần chờ chút
                //    là model tự hồi phục. Giờ xử lý đúng bản chất: giữ nguyên phần còn lại của
                //    hàng đợi, batch lỗi về IDLE + backoff 20s rồi TỰ ĐỘNG thử lại.
                const isTransientModelBlacklist = error.message.includes('[CAUSE:BLACKLIST_TEMP]');
                if (isTransientModelBlacklist) {
                    ui.addLog(`⏸️ Toàn bộ model Gemini tạm nghỉ trong lượt này (blacklist tạm — thường do lỗi lặp lại/bộ lọc chặn âm thầm, KHÔNG phải hết Quota thật): ${error.message}`, 'warning');
                    const TRANSIENT_HARD_CAP = 4;
                    if (batchFiles.every((f: FileItem) => (f.retryCount || 0) >= TRANSIENT_HARD_CAP)) {
                        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) =>
                            batchIds.includes(f.id)
                                ? { ...f, status: FileStatus.ERROR, errorMessage: "Lỗi lặp lại trên mọi model (nghi vấn nội dung nhạy cảm ẩn hoặc nghẽn kéo dài) - Hãy kiểm tra tay hoặc thêm vệ tinh dự phòng" }
                                : f
                        ));
                        ui.addToast("Batch này lỗi lặp lại nhiều lần trên mọi model — đã đánh dấu để xử lý thủ công, hệ thống vẫn dịch tiếp các file khác.", "warning");
                        return;
                    }
                    core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) =>
                        batchIds.includes(f.id)
                            ? { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0) + 1, errorMessage: "Model tạm nghỉ (blacklist tạm trong lượt) - Sẽ tự động thử lại" }
                            : f
                    ));
                    if (myRunId === runIdRef?.current) {
                        setProcessingQueue(prev => reorderQueueWithPriority(prev, batchIds, new Set<string>()));
                        ui.addLog(`⏳ Chờ 20s cho các model hồi phục rồi tự thử lại ${batchIds.length} tệp này... (các tệp khác vẫn dịch bình thường)`, 'info');
                        await new Promise(r => setTimeout(r, 20000));
                        setRetryTrigger(prev => prev + 1);
                    }
                    return;
                }

                // FIX (bug "có DeepSeek nhưng app vẫn không cứu hộ, cứ dừng hẳn"):
                // Trước đây hễ smartExecution (gemini.ts) throw "Tất cả model khả dụng đã hết
                // Quota hoặc bị tắt hoặc bị lỗi" là app coi như HẾT MỌI PHƯƠNG ÁN — đánh ERROR
                // toàn bộ batch, xoá sạch hàng đợi, DỪNG HẲN hệ thống dịch — mà KHÔNG hề kiểm tra
                // xem DeepSeek có đang cấu hình hay không, cũng không gọi getRescueTarget
                // như nhánh isSafetyError bên trên đã làm. Vấn đề: thông báo "hết Quota" này không
                // chỉ xảy ra khi Gemini THẬT SỰ hết quota — nó cũng xảy ra khi TẤT CẢ model Gemini
                // đang thử đều dính waitTime tạm thời (backoff do lỗi thoáng qua/kết quả rỗng lặp
                // lại nhiều lần, ví dụ do bộ lọc an toàn chặn âm thầm mà không trả lỗi rõ ràng —
                // xem services/api/gemini.ts), tức KHÔNG PHẢI hết quota thật. DeepSeek
                // dùng quota HOÀN TOÀN RIÊNG với Gemini, nên trước khi dừng hẳn, luôn thử bàn giao
                // cho vệ tinh cứu hộ (nếu có key) giống hệt cách nhánh Safety Filter đã làm, chỉ
                // thực sự dừng hệ thống khi KHÔNG có vệ tinh nào cấu hình.
                const maxRetries = getQuotaRescueBudgetLimit(!!isFixPhaseRef?.current);
                const hasDS = !!(core.deepseekKey && core.deepseekKey.trim().length > 0);

                if (hasDS) {
                    ui.addLog(`⚠️ Toàn bộ model Gemini tạm hết Quota/bị lỗi cho batch này (${error.message}) — có cấu hình vệ tinh cứu hộ, chuyển sang DeepSeek để hoàn tất đúng batch đang dở dang này. Sẽ KHÔNG tự động đẩy thêm tệp mới khác sang vệ tinh sau đó.`, "warning");
                    // Đánh dấu Gemini đã hết Quota toàn bộ cho phiên này — chặn scheduler bên dưới
                    // không tự ý đẩy thêm tệp CHƯA từng thử vào vệ tinh (xem điều kiện dùng
                    // geminiExhaustedRef.current phía dưới, gần chỗ tính maxConcurrentBatches).
                    geminiExhaustedRef.current = true;

                    const priorityIdsForRescue = new Set<string>();
                    core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                        if (batchIds.includes(f.id)) {
                            const target = getRescueTarget(f.retryCount || 0, hasDS, maxRetries);
                            if (target) {
                                priorityIdsForRescue.add(f.id);
                                const rescueBudget = getRescueBudget(hasDS, maxRetries);
                                return { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0) + 1, errorMessage: `Gemini tạm hết Quota/lỗi - Bàn giao ${getRescueLabel(target)} (${(f.retryCount || 0) + 1}/${rescueBudget})` };
                            }
                            return { ...f, status: FileStatus.ERROR, errorMessage: "Hết Quota tất cả model Gemini (đã hết lượt cứu hộ DeepSeek)" };
                        }
                        return f;
                    }));

                    if (myRunId === runIdRef?.current) {
                        setProcessingQueue(prev => reorderQueueWithPriority(prev, batchIds, priorityIdsForRescue));
                        setRetryTrigger(prev => prev + 1);
                    }
                    return; // Đã bàn giao cho vệ tinh cứu hộ (hoặc đánh lỗi từng file hết lượt) - không dừng cả hệ thống
                }

                ui.addLog(`❌ Lỗi Batch: ${error.message}`, "error", { operation: 'translate', runId: String(myRunId), batchId, cause: 'all_models_unavailable' });
            } else if (!isQuotaError) {
                ui.addLog(`❌ Lỗi Batch: ${error.message}`, "error", { operation: 'translate', runId: String(myRunId), batchId, cause: 'api_or_processing_error' });
            }

            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                if (batchIds.includes(f.id)) {
                    if (isAllQuotaExhausted) {
                        return { ...f, status: FileStatus.ERROR, errorMessage: "Hết Quota tất cả model khả dụng" };
                    }
                    
                    const maxRetries = isFixPhaseRef?.current ? 1 : 2;
                    
                    if (error.message.includes("429") || error.message.toLowerCase().includes("quota")) {
                        if ((f.retryCount || 0) < maxRetries * 2) { // Allow more retries for quota (transient)
                            return { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0) + 1, errorMessage: "Lỗi Quota (429) - Sẽ thử lại" };
                        } else {
                            return { ...f, status: FileStatus.ERROR, errorMessage: "Lỗi Quota (Quá nhiều lần thử lại)" };
                        }
                    }
                    
                    // Lỗi Safety Filter được tách khỏi cổng `maxRetries` chung, dùng ngân sách cứu hộ
                    // riêng (rescueBudget = tổng lượt của vệ tinh DeepSeek đang có key) để
                    // có đủ lượt cứu hộ. Dùng
                    // `getSafetyRescueBudgetLimit` (biến RIÊNG, không phải `maxRetries` chung ở trên -
                    // biến đó còn phục vụ 2 mục đích khác không liên quan tới cứu hộ ngay phía trên/
                    // dưới) để tách rõ ngân sách theo loại lỗi (đề xuất tồn đọng fix15/17/18).
                    if (isSafetyError) {
                        const safetyRescueMaxRetries = getSafetyRescueBudgetLimit(!!isFixPhaseRef?.current);
                        const batchIndex = batchIds.indexOf(f.id);
                        if (batchIndex === 0) {
                            const hasDS = !!(core.deepseekKey && core.deepseekKey.trim().length > 0);
                            const target = getRescueTarget(f.retryCount || 0, hasDS, safetyRescueMaxRetries);
                            if (target) {
                                const rescueBudget = getRescueBudget(hasDS, safetyRescueMaxRetries);
                                const errMsg = `Nghi vấn lỗi nội dung nhạy cảm - Bàn giao ${getRescueLabel(target)} (${(f.retryCount || 0) + 1}/${rescueBudget})`;
                                return { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0) + 1, errorMessage: errMsg };
                            } else {
                                const reason = hasDS ? 'đã hết lượt xử lý' : 'không có vệ tinh DeepSeek dự phòng';
                                return { ...f, status: FileStatus.ERROR, errorMessage: `Bị chặn do lỗi bộ lọc an toàn (${reason})` };
                            }
                        } else {
                            const errMsg = `Chờ thử lại do vạ lây từ batch có file safety`;
                            return { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0), errorMessage: errMsg, isSafeRebatch: true } as any;
                        }
                    }
                    if ((f.retryCount || 0) < maxRetries) {
                        return { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0) + 1, errorMessage: `Lỗi: ${error.message} - Đang thử lại (${(f.retryCount || 0) + 1}/${maxRetries})` };
                    }
                    return { ...f, status: FileStatus.ERROR, errorMessage: `Lỗi: ${error.message}` };
                }
                return f;
            }));
            
            if (isAllQuotaExhausted) {
                ui.addToast("Tất cả model khả dụng đã hết Quota. Dừng hệ thống dịch.", "error");
                if (myRunId === runIdRef?.current) {
                    setProcessingQueue([]); // Clear queue to stop
                    setEndTime(Date.now());
                    setIsSmartAutoMode(false);
                    setAutoFixEnabled(false);
                    isFixPhaseRef.current = false;
                }
                return; // Stop execution, do not retry or push to queue
            } else if (error.message.includes("429") || error.message.includes("Quota")) {
                ui.addToast("Lỗi Quota (429). Đang tạm dừng 30s...", "warning");
                await new Promise(resolve => setTimeout(resolve, 30000));
                if (myRunId === runIdRef?.current) {
                    setRetryTrigger(prev => prev + 1);
                }
            } else {
                const maxRetries = isFixPhaseRef?.current ? 1 : 2;
                const maxRetryCount = Math.max(...batchFiles.map(f => f.retryCount || 0));
                if (maxRetryCount < maxRetries) {
                    const waitTime = Math.pow(2, maxRetryCount + 1) * 1000; // 2s, 4s, 8s
                    ui.addLog(`⏳ Tạm dừng ${waitTime/1000}s trước khi thử lại...`, "warning");
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    if (myRunId === runIdRef?.current) {
                        setRetryTrigger(prev => prev + 1);
                    }
                }
            }
        } finally {
            if (stalledTimeoutId) clearTimeout(stalledTimeoutId);
            core.setFiles((prev: FileItem[]) => settleBatchFileTransactions(prev, batchIds, fileTransactionsRef.current, myRunId));
            setActiveBatches(prev => Math.max(0, prev - 1));
            batchIds.forEach(id => scheduledBatchesRef?.current.delete(id));
        }
    }, [isProcessing, effectiveDictionary, translationTier, core, ui, setRetryTrigger, setActiveBatches, scheduledBatchesRef, runIdRef, filesRef, isFixPhaseRef, setAutoFixEnabled, setEndTime, setIsSmartAutoMode, setProcessingQueue, fileTransactionsRef]);

    useEffect(() => {
        if (!isProcessing) return;

        // TM (NÂNG CẤP mục 4.1) đã dời sang IndexedDB nên bước tra cứu là BẤT ĐỒNG BỘ. Toàn bộ
        // thân effect chạy trong 1 hàm async: các lệnh return bên trong vẫn giữ nguyên ngữ nghĩa
        // "kết thúc phiên này", còn effectDisposed chặn kết quả tra cứu cũ áp lên phiên mới hơn.
        let effectDisposed = false;
        const runSchedulerPass = async () => {
        const myRunId = runIdRef?.current;
        const currentFiles = filesRef?.current;
        // QUAN TRỌNG: phải duyệt theo THỨ TỰ của processingQueue (không phải thứ tự gốc của
        // currentFiles). Khi 1 file lỗi/hậu kiểm bị đưa xuống cuối processingQueue (xem các chỗ
        // setProcessingQueue([...otherIds, ...retryingIds]) ở trên/dưới), nếu ở đây vẫn lọc theo
        // currentFiles thì file đó vẫn nằm ở vị trí cũ trong mảng gốc -> vẫn bị chọn lại NGAY LẬP
        // TỨC làm batch kế tiếp (thử đi thử lại liên tục, phí request) thay vì nhường chỗ cho các
        // file mới/chưa thử trong hàng đợi. Duyệt theo processingQueue đảm bảo file lỗi thực sự bị
        // đẩy xuống cuối và chỉ được thử lại sau khi các file khác trong hàng đợi đã được xử lý.
        const fileMap = new Map<string, FileItem>(currentFiles.map((f: FileItem) => [f.id, f]));
        const pendingFiles = processingQueue
            .map((id: string) => fileMap.get(id))
            .filter((f: FileItem | undefined): f is FileItem => !!f && f.status === FileStatus.IDLE && !scheduledBatchesRef?.current.has(f.id));

        // NÂNG CẤP #7 — Translation Memory (khôi phục): file IDLE khớp 100% nội dung gốc với
        // 1 chương đã dịch THÀNH CÔNG trước đây -> gắn bản dịch cũ ngay lập tức, không tốn
        // request API. Rất hiệu quả khi retry sau lỗi bộ lọc: các file "vạ lây" an toàn trong
        // batch được phục hồi miễn phí thay vì phải dịch lại từ đầu.
            {
                const storyTitle = core.stateRef?.current?.storyInfo?.title;
                const tmCandidates = pendingFiles.filter(f => !retranslateSkipTmIdsRef.current.has(f.id));
                const tmHits = await lookupTranslationMemory(storyTitle, tmCandidates.map(f => f.content));
                // Sau điểm await: nếu phiên đã bị thay (Dịch Lại mới/Stop) hoặc effect cũ bị dọn,
                // KHÔNG áp kết quả tra cứu của lần này lên state hiện tại.
                if (effectDisposed || myRunId !== runIdRef?.current || !isProcessingRef?.current) return;
                const tmHitIds = new Set(tmCandidates.filter(f => tmHits.has(f.content.trim())).map(f => f.id));
                if (tmHitIds.size > 0) {
                    core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                        if (!tmHitIds.has(f.id)) return f;
                        const cached = tmHits.get(f.content.trim());
                        if (!cached) return f;
                        return { ...f, status: FileStatus.COMPLETED, translatedContent: cached, remainingRawCharCount: 0, errorMessage: undefined, hasStaleTranslation: false, retryCount: 0, usedModel: 'TM' };
                    }));
                    ui.addLog(`⚡ Translation Memory: Phục hồi miễn phí ${tmHitIds.size} tệp từ bản dịch đã duyệt trước đây (không tốn API).`, 'success');
                    pendingFiles.splice(0, pendingFiles.length, ...pendingFiles.filter(f => !tmHitIds.has(f.id)));
                }
            }

        if (pendingFiles.length === 0 && activeBatches === 0) {
            // FIX (cờ "Gemini hết Quota" dính vĩnh viễn sang phiên sau): cờ này từng CHỈ được
            // reset khi bấm Bắt Đầu/Dừng/Dịch Lại hoặc tại điểm tự-dừng-hết-quota — các nhánh
            // HOÀN TẮT PHIÊN bình thường không reset. Hệ quả: phiên trước hết Quota Gemini ->
            // cứu hộ DeepSeek xong xuôi đẹp, cờ vẫn kẹt true -> lần bấm Smart Fix kế tiếp
            // (không đi qua executeProcessing) bị chặn đứng ngay bởi điều kiện
            // geminiExhaustedRef ở dưới, gắn oan nhãn "Chưa thử dịch..." cho mọi file rồi tự
            // dừng. Hết queue + hết batch đang chạy = phiên đã kết thúc -> trả cờ về false để
            // pha làm việc tiếp theo (kể cả Smart Fix/Auto-Fix nối tiếp) thử Gemini bình thường.
            geminiExhaustedRef.current = false;
            if (isSmartAutoMode && !isFixPhaseRef?.current) {
                const hasIssues = handleSmartFix();
                if (!hasIssues) {
                    setIsProcessing(false);
                    setEndTime(Date.now());
                    setIsSmartAutoMode(false);
                    setAutoFixEnabled(false);
                    ui.addToast("Hoàn tất quy trình dịch tự động thông minh!", "success");
                    core.saveSession(true);
                }
            } else if (isSmartAutoMode && isFixPhaseRef?.current && autoFixEnabled) {
                // BUGFIX: file đang được Sửa Lỗi (Pro/Flash) mang status REPAIRING, không phải
                // COMPLETED lẫn IDLE, nên KHÔNG được lọt qua 2 điều kiện trên. Nếu không chặn ở đây,
                // effect sẽ tưởng "không còn gì để sửa" ngay khi 1 batch sửa lỗi còn đang chạy dở ở
                // dưới nền (performAggregatedRepair), tự tắt isProcessing/isFixPhaseRef và báo "Hoàn
                // tất" giả, khiến nút Smart Fix có thể bị gọi lại lần 2 -> tăng runIdRef -> phiên sửa
                // lỗi đang chạy bị coi là "người dùng hủy" ngay sau batch hiện tại.
                const repairingFiles = currentFiles.filter((f: FileItem) => f.status === FileStatus.REPAIRING);
                if (repairingFiles.length > 0) {
                    return;
                }
                // FIX47: thêm loại trừ usedModel='Thủ công' cho KHỚP với bộ lọc bên trong
                // handleFixRemainingRaw() (hàm này bỏ qua file cứu hộ thủ công - xem smartFixCore.ts).
                // Trước đây 2 bộ lọc lệch nhau: rawFiles đếm cả file 'Thủ công' -> tưởng còn việc ->
                // gọi handleFixRemainingRaw() nhưng bên trong targets=0 -> chỉ toast rồi return mà
                // không dọn trạng thái -> vòng lặp gọi lại vô hạn (xem FIX47 ở smartFixCore.ts).
                const rawFiles = currentFiles.filter((f: FileItem) => f.status === FileStatus.COMPLETED && f.remainingRawCharCount > 0 && f.usedModel !== 'Thủ công');
                if (rawFiles.length > 0) {
                    handleFixRemainingRaw();
                } else {
                    setIsProcessing(false);
                    setEndTime(Date.now());
                    setIsSmartAutoMode(false);
                    setAutoFixEnabled(false);
                    isFixPhaseRef.current = false;
                    ui.addToast("Hoàn tất quy trình dịch tự động thông minh!", "success");
                    core.saveSession(true);
                }
            } else {
                // FIX (đề xuất tồn đọng từ fix22): trước đây nhánh "hoàn tất bình thường" (KHÔNG bật
                // Smart Auto Mode) chỉ tổng kết rồi dừng hẳn — không hề tự kiểm tra file nào còn sót
                // raw/tiếng Anh (`remainingRawCharCount > 0`) như nhánh Smart Auto Mode đang làm ở
                // trên. Người dùng dịch bằng nút "Bắt Đầu Dịch" thường (không bật Smart Auto) phải tự
                // nhớ bấm thêm "Smart Fix" nếu muốn dò/sửa sót raw. `handleFixRemainingRaw()` tự quản
                // lý trọn vòng đời của nó (tự set/reset isProcessing, isSmartAutoMode, autoFixEnabled,
                // isFixPhaseRef, tự lưu session, tự báo toast hoàn tất riêng) nên gọi an toàn ở đây mà
                // không cần đã bật Smart Auto Mode trước đó - không đụng/đổi hành vi của Smart Auto
                // Mode, chỉ mở rộng thêm cho nhánh bình thường.
                const totalFiles = currentFiles.length;
                const completedCount = currentFiles.filter((f: FileItem) => f.status === FileStatus.COMPLETED).length;
                const errorFiles = currentFiles.filter((f: FileItem) => f.status === FileStatus.ERROR);
                const errorCount = errorFiles.length;
                const notTranslatedCount = totalFiles - completedCount - errorCount;
                const errorDetails = errorFiles.map(f => `File ${currentFiles.findIndex(cf => cf.id === f.id) + 1}: ${f.errorMessage || 'Lỗi không xác định'}`).join(', ');
                const errorMsgStr = errorCount > 0 ? `. Chi tiết thất bại: ${errorDetails}` : '';

                const rawFilesAfterNormal = currentFiles.filter((f: FileItem) =>
                    f.status === FileStatus.COMPLETED && f.remainingRawCharCount > 0 && f.usedModel !== 'Thủ công'
                );

                ui.addLog(`[DEBUG] Xác nhận hoàn tất: pendingFiles=0, activeBatches=${activeBatches}, scheduledBatches=${scheduledBatchesRef?.current.size ?? 0}, processingQueue=${processingQueue.length}`, "info");
                ui.addLog(`✓ Hoàn tất dịch gộp (Batch) ${totalFiles} tệp. (Thành công: ${completedCount}, Thất bại: ${errorCount}, Chưa dịch: ${notTranslatedCount})${errorMsgStr}${rawFilesAfterNormal.length > 0 ? ` — phát hiện ${rawFilesAfterNormal.length} tệp còn sót raw CJK, tự động chuyển sang Auto-Fix In-stream...` : ''}`, errorCount > 0 ? "warning" : "success");

                if (rawFilesAfterNormal.length > 0) {
                    ui.addToast(`✓ Dịch xong ${totalFiles} tệp — phát hiện ${rawFilesAfterNormal.length} tệp còn sót raw, đang tự động sửa...`, "success");
                    handleFixRemainingRaw(false);
                } else {
                    setIsProcessing(false);
                    setEndTime(Date.now());
                    ui.addToast(`✓ Hoàn tất dịch gộp (Batch) ${totalFiles} tệp. (Thành công: ${completedCount}, Thất bại: ${errorCount}, Chưa dịch: ${notTranslatedCount})`, "success");
                    core.saveSession(true);
                }
            }
            return;
        }

        let maxConcurrentBatches = 3;
        if (core.concurrency === 'auto') {
            if (translationTier === 'flash') {
                maxConcurrentBatches = 3;
            } else if (translationTier === 'normal') {
                // FIX (nâng Normal 2 -> 3 luồng theo yêu cầu người dùng - áp dụng cho bản Full):
                // với 3 luồng song song, cơ chế chọn model theo điểm tải sẵn có của
                // quotaManager.getBestModelForTask tự động phân bổ thông minh quanh giới hạn
                // RPM 2/phút của 3.1 Pro: luồng đầu tiên luôn ưu tiên 3.1 Pro (priority thấp
                // nhất = điểm cao nhất); ngay khi Pro vừa ghi nhận request và bước vào khoảng
                // cách tối thiểu 30s (60000/rpmLimit=2), các lượt chọn kế tiếp tự tràn sang
                // 3.7 Flash rồi 3.6 Flash (thứ tự priority 3.2 > 3.4) — đạt đủ 3 luồng chạy
                // đồng thời mà không có luồng nào phải chờ Pro hết spacing, Pro cũng không bị
                // dồn cứng request gây rate-limit tạm thời.
                maxConcurrentBatches = 3;
            } else if (translationTier === 'pro') {
                maxConcurrentBatches = 2;
            } else if (translationTier === 'full') {
                maxConcurrentBatches = 3;
            } else if (translationTier === 'lite') {
                maxConcurrentBatches = 3;
            } else if (translationTier === 'deepseek') {
                maxConcurrentBatches = 1; // 1 luồng, 1 tệp theo yêu cầu
            }
        } else {
            maxConcurrentBatches = typeof core.concurrency === 'number' ? core.concurrency : parseInt(core.concurrency) || 3;
        }

        // FIX (bug "hết Quota Gemini rồi lôi cả nùi file vào DeepSeek cùng lúc"):
        // batchSize đã được ép về 1 cho file mang tag bàn giao vệ tinh (xem điều kiện
        // isRescueHandoffTag bên dưới), NHƯNG maxConcurrentBatches ở TRÊN chỉ bị ép về 1 khi
        // translationTier THẬT SỰ là 'deepseek' (người dùng tự chọn tier đó ở
        // StartOptionsModal). Khi đang chạy tier Gemini bình thường (pro/normal/flash/full/lite)
        // và một số file bị bàn giao cho vệ tinh GIỮA CHỪNG (hết Quota tạm thời/lỗi bộ lọc an
        // toàn), maxConcurrentBatches vẫn giữ nguyên giá trị của tier Gemini (2-3, hoặc cao hơn
        // nếu người dùng tự cấu hình concurrency thủ công) — vòng lặp effect này chạy lại nhiều
        // lần liên tiếp, mỗi lần schedule đúng 1 batch-1-file (đúng batchSize=1) nhưng KHÔNG chờ
        // batch trước xong, nên vẫn có thể có 2-3 file rescue chạy CÙNG LÚC sang DeepSeek —
        // sai với chính sách "1 luồng, 1 tệp" áp dụng cho vệ tinh. SỬA: kiểm tra
        // TRƯỚC file kế tiếp trong hàng đợi (pendingFiles[0]) có mang tag bàn giao vệ tinh hay
        // không (dùng lại đúng điều kiện isRescueHandoffTag ở dưới) — nếu có, ép cứng
        // maxConcurrentBatches = 1 bất kể tier/concurrency đang cấu hình gì, đảm bảo mọi batch
        // rescue luôn chạy tuần tự, không chồng lấn với batch khác (kể cả batch Gemini thường).
        const nextPendingIsRescueHandoff = pendingFiles.length > 0 && !!pendingFiles[0].errorMessage &&
            !(pendingFiles[0] as any).isSafeRebatch &&
            !pendingFiles[0].errorMessage.includes('vạ lây') &&
            (pendingFiles[0].errorMessage.includes('Bàn giao DeepSeek') ||
             pendingFiles[0].errorMessage.includes('Nghi vấn lỗi nội dung') ||
             pendingFiles[0].errorMessage.includes('Lỗi kiểm định AI') ||
             pendingFiles[0].errorMessage.includes('Đã phân loại riêng') ||
             pendingFiles[0].errorMessage.toLowerCase().includes('an toàn') ||
             pendingFiles[0].errorMessage.toLowerCase().includes('safety') ||
             pendingFiles[0].errorMessage.includes('Thiếu kết quả từ API') ||
             pendingFiles[0].errorMessage.includes('Lỗi ngắt kết nối API') ||
             pendingFiles[0].errorMessage.includes('BLOCKLIST'));
        if (nextPendingIsRescueHandoff) {
            maxConcurrentBatches = 1;
        }

        // NEW (theo yêu cầu người dùng): khi Gemini đã hết Quota TẤT CẢ model khả dụng (đánh dấu ở
        // nhánh isAllQuotaExhausted trong processBatch), chỉ tệp ĐÃ mang tag bàn giao vệ tinh
        // (đang dở dang, tiếp tục ở nhánh nextPendingIsRescueHandoff phía trên) mới được schedule
        // tiếp. Tệp kế tiếp trong hàng đợi CHƯA từng thử/không mang tag đó -> không tự động đẩy
        // sang vệ tinh nữa. Nếu không còn batch nào đang chạy dở dang (activeBatches===0), dừng
        // hẳn hệ thống ở đây thay vì tiếp tục vòng lặp vô ích (Gemini vẫn hết Quota nên mọi batch
        // mới cũng sẽ lại thất bại y hệt). Bỏ qua nhánh này nếu người dùng tự chọn thẳng tier
        // 'deepseek' làm tier chính (không liên quan tới cứu hộ tự động Gemini).
        const isSatelliteTierSelected = translationTier === 'deepseek';
        if (geminiExhaustedRef.current && !isSatelliteTierSelected && !nextPendingIsRescueHandoff && pendingFiles.length > 0) {
            if (activeBatches === 0) {
                const remainingCount = pendingFiles.length;
                ui.addLog(`⛔ Gemini đã hết Quota tất cả model khả dụng cho chế độ dịch hiện tại. Đã xử lý xong các tệp đang dở dang qua vệ tinh cứu hộ (nếu có) — DỪNG hệ thống, không tự động đẩy tiếp ${remainingCount} tệp còn lại sang DeepSeek.`, "warning");
                ui.addToast(`Gemini hết Quota — đã dừng. Còn ${remainingCount} tệp chưa dịch (chọn tier DeepSeek thủ công, hoặc đợi Quota reset rồi Bắt Đầu lại).`, "warning");
                // NEW (đề xuất cải thiện fix12 - phân biệt "chưa từng thử vì hệ thống chủ động
                // dừng" với "đã thử và lỗi thật"): gắn errorMessage riêng cho đúng các tệp CÒN LẠI
                // trong pendingFiles (vẫn giữ nguyên status IDLE - KHÔNG đổi thành ERROR, vì các
                // tệp này chưa hề được thử dịch lần nào ở lượt này). FileCard.tsx hiển thị badge
                // "Tạm dừng" màu hổ phách riêng cho trường hợp IDLE + có errorMessage này.
                const stoppedIds = new Set(pendingFiles.map((f: FileItem) => f.id));
                core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) =>
                    stoppedIds.has(f.id) ? { ...f, errorMessage: "Chưa thử dịch — hệ thống tự dừng do Gemini hết Quota toàn bộ. Bấm \"Tiếp tục dịch phần còn lại\" hoặc \"Bắt Đầu\" khi sẵn sàng." } : f
                ));
                // NEW: lưu số tệp còn lại để UI (MainUI.tsx) hiện banner/nút "Tiếp tục dịch phần
                // còn lại" ngay tại chỗ dừng, thay vì người dùng phải tự nhớ bấm lại Bắt Đầu.
                if (setAutoStoppedRemainingCount) setAutoStoppedRemainingCount(remainingCount);
                setIsProcessing(false);
                setProcessingQueue([]);
                setEndTime(Date.now());
                setIsSmartAutoMode(false);
                setAutoFixEnabled(false);
                isFixPhaseRef.current = false;
                geminiExhaustedRef.current = false; // reset để lần Start kế tiếp thử lại Gemini bình thường
            }
            return;
        }

        if (activeBatches < maxConcurrentBatches && pendingFiles.length > 0) {
            const lang = core.storyInfo.languages?.[0]?.toLowerCase() || '';
            const isLatin = lang.includes('việt') || lang.includes('convert') || lang.includes('en') || lang.includes('anh');
            const limits = isLatin ? (core.batchLimits?.latin || { v36: 6, v35: 6, v3: 6, v31: 10, v25: 6, maxTotalChars: 90000 }) : (core.batchLimits?.complex || { v36: 6, v35: 6, v3: 6, v31: 10, v25: 6, maxTotalChars: 45000 });
            // FIX59 (Lite): khoá cứng batch — 3 tệp/batch, latin 60k, raw 30k
            const effLimits: any = IS_LITE ? { v31: LITE_BATCH_CONFIG.FILES_PER_BATCH, v36: LITE_BATCH_CONFIG.FILES_PER_BATCH, v35: LITE_BATCH_CONFIG.FILES_PER_BATCH, v3: LITE_BATCH_CONFIG.FILES_PER_BATCH, v25: LITE_BATCH_CONFIG.FILES_PER_BATCH, maxTotalChars: isLatin ? LITE_BATCH_CONFIG.LATIN_MAX_CHARS : LITE_BATCH_CONFIG.COMPLEX_MAX_CHARS } : limits;
            const currentTier = isFixPhaseRef?.current ? (translationTier === 'lite' ? 'lite' : 'pro') : translationTier;
            const effectiveModels = isFixPhaseRef?.current
                ? getEffectiveModelsForTier(translationTier, 'smart_fix', runtimeEnabledModelsRef.current)
                : getEffectiveModelsForTier(currentTier, 'translate', activeTranslationModelsRef.current.length > 0 ? activeTranslationModelsRef.current : runtimeEnabledModelsRef.current);
            const bestModel = quotaManager.getBestModelForTask(effectiveModels) || effectiveModels[0];
            // FIX (treo êm khi không còn model nào): nếu tier hiện tại không khớp model nào đang
            // bật, bestModel là undefined và dòng `bestModel.startsWith(...)` bên dưới ném
            // TypeError — bị .catch() của runSchedulerPass nuốt gọn thành 1 dòng log, không batch
            // nào được schedule, isProcessing kẹt true vĩnh viễn không báo lỗi cho người dùng.
            if (!bestModel) {
                ui.addLog(`⛔ Không có model nào khả dụng cho chế độ dịch hiện tại (kiểm tra bảng bật/tắt model hoặc tier đã chọn). Hệ thống dừng.`, "error");
                ui.addToast(`Không có model nào khả dụng cho chế độ dịch hiện tại — hãy bật ít nhất 1 model phù hợp rồi thử lại.`, "error");
                setIsProcessing(false);
                setEndTime(Date.now());
                return;
            }
            
            let batchSize = 15;
            if (bestModel.startsWith('deepseek:')) {
                batchSize = 1;
            } else {
                // FIX60 (phân nhóm model qua "family" khai báo trong MODEL_CONFIGS thay cho
                // so-chuỗi id): chuỗi includes('pro')/('3.6')/('3.1')... từng dễ gãy — ví dụ
                // model Flash mới mang chữ 'pro' trong tên sẽ bị nhầm sang cấu hình Pro (batch
                // 10 tệp), hoặc model mới không khớp bất kỳ nhánh số-hiệu nào rơi xuống nhánh
                // cuối sai cột. Giờ tra family tường minh: pro -> v31, flash -> v36,
                // flash-lite/lite -> v35, còn lại -> v36. Thêm model mới chỉ cần khai báo
                // family trong MODEL_CONFIGS là đúng nhóm.
                const fam = getModelFamily(bestModel);
                if (fam === 'pro') {
                    batchSize = parseInt(String(effLimits.v31)) || 10;
                } else if (fam === 'flash') {
                    batchSize = parseInt(String(effLimits.v36)) || 6;
                } else if (fam === 'flash-lite' || fam === 'lite') {
                    batchSize = parseInt(String(effLimits.v35)) || 6;
                } else {
                    batchSize = parseInt(String(effLimits.v36)) || 6;
                }
            }
            
            batchSize = Math.max(1, isNaN(batchSize) ? 15 : batchSize);
            
            const isFirstSafeRebatch = pendingFiles.length > 0 && !!(pendingFiles[0] as any).isSafeRebatch;
            // FIX (nguyên nhân "gửi hàng loạt 6 file cùng lúc cho vệ tinh DeepSeek" dù
            // đáng lẽ phải chạy TỪNG TỆP MỘT): điều kiện ép batchSize=1 trước đây chỉ dò một danh
            // sách từ khoá CỐ ĐỊNH cho đúng 1 nguyên nhân cứu hộ (Safety Filter/Lỗi kiểm định AI).
            // Khi thêm nhánh cứu hộ MỚI cho trường hợp "Gemini tạm hết Quota/lỗi" (xem catch block
            // isAllQuotaExhausted phía trên), tag errorMessage mới ("... - Bàn giao
            // DeepSeek (x/y)") KHÔNG khớp bất kỳ từ khoá nào trong danh sách cũ — nên file này vẫn
            // bị gộp chung batch 6-12 file như bình thường, rồi streamTranslate.ts phát hiện CHỈ 1
            // file trong batch có tag "Bàn giao DeepSeek" là ép TOÀN BỘ batch (kể cả các file
            // KHÔNG liên quan) chạy qua DeepSeek — đúng hiện tượng người dùng báo cáo. SỬA: kiểm
            // tra trực tiếp tag "Bàn giao DeepSeek" (nguồn chân lý duy nhất
            // mà streamTranslate.ts cũng dùng để định tuyến rescue) thay vì liệt kê từng nguyên
            // nhân gốc riêng lẻ — mọi file đã được gắn tag bàn giao vệ tinh, bất kể lý do gốc là
            // gì (an toàn, lỗi kiểm định AI, hay hết Quota Gemini tạm thời), đều PHẢI chạy riêng
            // từng tệp một để không kéo cả batch không liên quan vào cùng 1 lượt gọi vệ tinh.
            const isRescueHandoffTag = (msg?: string) => !!msg && msg.includes('Bàn giao DeepSeek');
            if (pendingFiles.length > 0 && pendingFiles[0].errorMessage && 
                !isFirstSafeRebatch &&
                !pendingFiles[0].errorMessage.includes('vạ lây') &&
                (isRescueHandoffTag(pendingFiles[0].errorMessage) ||
                 pendingFiles[0].errorMessage.includes('Nghi vấn lỗi nội dung') || 
                 pendingFiles[0].errorMessage.includes('Lỗi kiểm định AI') || 
                 pendingFiles[0].errorMessage.includes('Đã phân loại riêng') || 
                 pendingFiles[0].errorMessage.toLowerCase().includes('an toàn') || 
                 pendingFiles[0].errorMessage.toLowerCase().includes('safety') || 
                 pendingFiles[0].errorMessage.includes('Thiếu kết quả từ API') || pendingFiles[0].errorMessage.includes('Lỗi ngắt kết nối API') ||
                 pendingFiles[0].errorMessage.includes('BLOCKLIST'))) {
                
                batchSize = 1;
            }
            

            let maxChars = effLimits.maxTotalChars || (isLatin ? 100000 : 50000);

            // CẢI TIẾN (chống "tạch NGUYÊN batch lặp lại vì MAX_TOKENS" — báo cáo thực tế
            // bộ Thế Cửu Chi Thần: 2 batch 10 tệp liên tiếp đều chết vì trần Token):
            // khi các tệp kế tiếp còn mang chữ ký lỗi 'MAX_TOKENS' (lượt trước vừa đụng trần
            // output), THU NHỎ batch lượt này đi một nửa (sàn 2) thay vì gom lại đúng nhóm cũ
            // rồi tạch y hệt. Mỗi lần vẫn fail sẽ tiếp tục chia đôi (10 -> 5 -> 2) — tự thích
            // ứng với sức chứa output thật của model. KHÔNG đụng batchSize đã bị ép = 1
            // (rescue handoff) ở khối phía trên.
            // FIX61 (chính xác hoá điều kiện thu nhỏ): trước đây đếm file dính chữ ký
            // 'MAX_TOKENS' trên TOÀN BỘ hàng chờ — 1 file lỗi duy nhất nằm đâu đó trong queue
            // (kể cả khi lượt này KHÔNG nằm trong batch sắp chạy) cũng khiến MỌI batch kế tiếp
            // bị ép về 2 tệp, đúng hiện tượng log thực tế ("thu nhỏ 3 -> 2" lặp lại liên tục
            // suốt phiên dù các batch khác dịch bình thường). Giờ chỉ xét các file SẮP được
            // đưa vào batch này (pendingFiles.slice(0, batchSize)).
            const upcomingSlice = pendingFiles.slice(0, batchSize);
            const tokenCappedCount = upcomingSlice.filter(f => !!f.errorMessage && f.errorMessage.includes('MAX_TOKENS')).length;
            if (tokenCappedCount > 0 && batchSize > 2) {
                const shrunkBatchSize = Math.max(2, Math.floor(batchSize / 2));
                if (shrunkBatchSize < batchSize) {
                    ui.addLog(`📉 Có ${tokenCappedCount} tệp vừa dính trần Token (MAX_TOKENS) ở lượt trước: tự thu nhỏ batch ${batchSize} -> ${shrunkBatchSize} tệp cho lượt retry này (sẽ tiếp tục chia nhỏ nếu vẫn tạch).`, 'warning');
                    batchSize = shrunkBatchSize;
                }
            }

            if (bestModel.startsWith('deepseek:')) {
                maxChars = 15000;
            }
            
            // Co giãn theo tỷ lệ (nếu cấu hình batch lớn hơn chuẩn 15 thì tăng maxChars tương ứng).
            // Với batch nhỏ (ví dụ 6 của 2.5 Pro), giữ nguyên maxChars gốc để "đảm bảo tối đa 6 tệp nếu chưa chạm 55k".
            if (batchSize > 15) {
                maxChars = Math.floor(maxChars * (batchSize / 15));
            }
            
            const nextBatchFiles = [];
            let currentChars = 0;
            for (let i = 0; i < pendingFiles.length && i < batchSize; i++) {
                const f = pendingFiles[i];
                const charCount = f.content.length;
                if (nextBatchFiles.length > 0 && currentChars + charCount > maxChars) {
                    break; // Ensure at least 1 file, but stop if limit exceeded
                }
                
                // Do not mix files with safety errors into a normal batch
                if (nextBatchFiles.length > 0) {
                     const isCurrentSpecial = !!(f.errorMessage && 
                         !(f as any).isSafeRebatch &&
                         !f.errorMessage.includes('vạ lây') && (
                         f.errorMessage.includes('phân loại riêng') || 
                         f.errorMessage.toLowerCase().includes('an toàn') ||
                         f.errorMessage.toLowerCase().includes('safety') ||
                         f.errorMessage.includes('BLOCKLIST') ||
                         f.errorMessage.includes('Lỗi kiểm định AI') ||
                         f.errorMessage.includes('Nghi vấn lỗi nội dung')
                     ));
                     if (isCurrentSpecial) break; 
                }
                
                nextBatchFiles.push(f);
                currentChars += charCount;
            }
            
            const batchIds = nextBatchFiles.map(f => f.id);
            
            batchIds.forEach(id => scheduledBatchesRef?.current.add(id));
            setActiveBatches(prev => prev + 1);
            
            processBatch(batchIds, currentTier, myRunId, bestModel); // FIX61: truyền kèm model dùng để tính size batch
        }
        };
        runSchedulerPass().catch((e) => console.warn("[scheduler] Lỗi không mong muốn:", e));
        return () => { effectDisposed = true; };
    }, [isProcessing, processingQueue, activeBatches, core.concurrency, core.batchLimits, translationTier, processBatch, isSmartAutoMode, autoFixEnabled, retryTrigger, handleSmartFix, handleFixRemainingRaw, setIsProcessing, setEndTime, setIsSmartAutoMode, setAutoFixEnabled, setAutoStoppedRemainingCount, setProcessingQueue, ui, core, scheduledBatchesRef, runIdRef, isFixPhaseRef, filesRef, setActiveBatches, isProcessingRef]);

    // HẬU KIỂM KHỞI ĐỘNG (startupTriage): trích xuất thành hàm riêng để dùng chung cho cả
    // (a) executeProcessing() - tự động chạy mỗi khi bấm Auto/Bắt đầu dịch, và (b) nút thủ công
    // "Hậu kiểm lại ngay" (đề xuất thêm) - người dùng chủ động chạy bất cứ lúc nào không cần đợi
    // bấm Bắt đầu dịch. Phục hồi file bị đánh ERROR/IDLE oan (đã có bản dịch + tỷ lệ hợp lệ
    // nhưng hậu kiểm cũ bị cắt ngang/lỗi), đồng thời khoá "cứu hộ" (isRescueLocked) CHỈ những file
    // THỰC SỰ được AI đối chiếu nội dung và xác nhận lỗi (không bị dịch lại bằng Gemini nữa, chỉ
    // chờ vệ tinh DeepSeek). File chưa hậu kiểm được (lỗi mạng/API, không trả kết quả)
    // KHÔNG bị coi là "lỗi thật" và KHÔNG bị khoá cứu hộ — xem `apiFailureIds` trong startupTriage.ts.
    const runStartupTriage = async (enabledModels: string[] = runtimeEnabledModelsRef.current): Promise<{ recoveredCount: number, lockedCount: number, pendingCount: number, requeuedCount: number }> => {
        // FIX (báo cáo "nhầm lẫn khâu lọc/xử lý cứu hộ" - tiếp nối): tệp bị khoá cứu hộ nhưng
        // KHÔNG HỀ có bản dịch (translatedContent rỗng) thì không có gì để hậu kiểm lại cả - không
        // rơi vào identifyRecoveryCandidates/identifyBorderlineFiles (cả 2 đều đòi hỏi có
        // translatedContent). Trước đây các tệp này bị kẹt vĩnh viễn ở diện khoá vì không đường
        // nào xử lý tới. Mở khoá thẳng, đưa về ERROR bình thường (retryCount reset) để hàng đợi
        // dịch bình thường (executeProcessing) tự nhận lại và dịch mới từ đầu ở phiên này.
        const lockedEmptyFiles = core.files.filter((f: FileItem) => f.isRescueLocked && (!f.translatedContent || !f.translatedContent.trim()));
        let requeuedCount = 0;
        if (lockedEmptyFiles.length > 0) {
            requeuedCount = lockedEmptyFiles.length;
            const requeueIds = new Set(lockedEmptyFiles.map((f: FileItem) => f.id));
            const unlockEmpty = (f: FileItem): FileItem => requeueIds.has(f.id)
                ? { ...f, isRescueLocked: false, status: FileStatus.ERROR, retryCount: 0, errorMessage: "Trước đó chưa từng dịch được (không có nội dung để hậu kiểm) - đã mở khoá, sẽ dịch lại bình thường ở phiên này." }
                : f;
            core.setFiles((prev: FileItem[]) => prev.map(unlockEmpty));
            if (filesRef && filesRef.current) filesRef.current = filesRef.current.map(unlockEmpty);
            ui.addLog(`🔓 Mở khoá cứu hộ cho ${requeuedCount} tệp chưa từng có bản dịch (không có gì để hậu kiểm) - sẽ dịch lại bình thường.`, 'info');
        }

        const recoveryCandidates = identifyRecoveryCandidates(core.files, core.ratioLimits, core.storyInfo);
        const borderlineFiles = identifyBorderlineFiles(core.files, core.ratioLimits, core.storyInfo);
        if (recoveryCandidates.length === 0 && borderlineFiles.length === 0) {
            return { recoveredCount: 0, lockedCount: 0, pendingCount: 0, requeuedCount };
        }

        let recoveredIds = new Set<string>();
        // File thực sự bị AI đối chiếu và từ chối - "lỗi thật đã xác nhận".
        let confirmedErrorIds = new Set<string>();
        // FIX (nhầm lẫn "chưa xác định" thành "lỗi thật" đã báo cáo): file chưa hề nhận được kết
        // luận rõ ràng (lỗi gọi API/mạng, hết candidate model...) - KHÔNG khoá cứu hộ vĩnh viễn,
        // chỉ giữ nguyên ERROR để lượt hậu kiểm sau (Auto/Bắt đầu dịch lại/"Hậu kiểm lại ngay" kế
        // tiếp) tự kiểm tra lại bằng bất kỳ model nào đang bật, không bắt buộc phải DeepSeek.
        let apiFailureIds = new Set<string>();

        if (recoveryCandidates.length > 0) {
            ui.addLog(`🔎 Phát hiện ${recoveryCandidates.length} tệp ERROR/IDLE có bản dịch hợp lệ, đang hậu kiểm lại trước khi bắt đầu...`, 'info');
            const pass1 = await runRecoveryVerification(
                recoveryCandidates,
                enabledModels,
                (msg: string) => ui.addLog(msg, 'info'),
                core.deepseekKey,
                core.triageDelays
            );
            recoveredIds = pass1.recoveredIds;
            confirmedErrorIds = pass1.confirmedErrorIds;
            apiFailureIds = pass1.apiFailureIds;
        }

        // FIX (bug quy trình hậu kiểm khởi động - theo đúng mô tả yêu cầu): lượt 2 (runDiagnosisPass)
        // đáng lẽ phải GỘP các file "vẫn thất bại" ở lượt 1 (Tier 2 hậu kiểm 6 tệp/lô) VỚI diện
        // "biên giới" (ratio không hợp lệ từ trước) thành 1 nhóm DUY NHẤT rồi cùng chạy 1 lượt kiểm
        // tra lỗi bộ lọc nội dung CUỐI CÙNG bằng model kiểm tra (validateBatchWithAI) — để xác định
        // chính xác file nào lỗi thật (khoá cứu hộ) và file nào an toàn (false-positive, trả về xử
        // lý bình thường). Code trước đây CHỈ carry-forward nguyên trạng thái "thất bại" của lượt 1
        // vào thẳng `confirmedErrorIds` (qua `priorKnownErrorIds`) mà KHÔNG hề re-validate lại cùng
        // batch biên giới — nghĩa là 1 file bị lượt 1 từ chối (có thể do lỗi gọi API thoáng qua/lô
        // hậu kiểm 6 tệp bị dồn tải) sẽ bị khoá cứu hộ vĩnh viễn chỉ dựa trên ĐÚNG 1 lượt kiểm tra,
        // không có cơ hội "gỡ oan" ở lượt kiểm tra cuối như comment cũ mô tả (chỉ đúng trên giấy).
        // SỬA: lấy lại FileItem gốc (có translatedContent) của các file lượt 1 từ chối, gộp thẳng
        // vào danh sách cần validate của lượt 2 — để CẢ HAI nhóm cùng được model kiểm tra soi lại
        // 1 lần cuối trước khi kết luận, đúng tinh thần "gom lại rồi mới kiểm tra lỗi bộ lọc".
        // Gộp CẢ file bị lượt 1 xác nhận lỗi thật LẪN file lượt 1 chưa xác định được (apiFailureIds)
        // vào lượt kiểm tra cuối - cho cả 2 nhóm 1 cơ hội cuối trước khi kết luận, đúng tinh thần
        // "gỡ oan" đã mô tả ở trên (không chỉ riêng nhóm lỗi thật).
        const pass1FailedIds = new Set<string>([...confirmedErrorIds, ...apiFailureIds]);
        const pass1RejectedFiles = recoveryCandidates.filter(f => pass1FailedIds.has(f.id));
        const combinedForFinalCheck = [...pass1RejectedFiles, ...borderlineFiles];
        if (combinedForFinalCheck.length > 0) {
            // FIX (đề xuất): trước đây luôn ưu tiên cứng bảng `complex` (`?? latin` chỉ dùng khi
            // complex chưa cấu hình), bất kể ngôn ngữ truyện thực tế. Nếu truyện là tiếng Việt
            // Convert (dùng bảng `latin`), batch Pro thực tế đang áp dụng lúc dịch chính có thể
            // khác với batch dùng để chia lô ở đây. Chọn đúng bảng theo ngôn ngữ, giống hệt cách
            // useTranslator.ts đang làm ở đoạn scheduling chính (dòng ~803-805 phía trên).
            const lang = core.storyInfo.languages?.[0]?.toLowerCase() || '';
            const isLatinLang = lang.includes('việt') || lang.includes('convert') || lang.includes('en') || lang.includes('anh');
            const limitsTable = isLatinLang ? (core.batchLimits?.latin ?? core.batchLimits?.complex) : (core.batchLimits?.complex ?? core.batchLimits?.latin);
            const proBatchSize = parseInt(String(limitsTable?.v31)) || undefined;
            const pass2 = await runDiagnosisPass(
                combinedForFinalCheck,
                proBatchSize,
                enabledModels,
                (msg: string) => ui.addLog(msg, 'info'),
                core.deepseekKey,
                core.triageDelays
            );
            // `confirmedErrorIds`/`apiFailureIds` giờ được TÍNH LẠI TỪ ĐẦU bởi pass2 (chỉ chứa
            // file thực sự bị lượt kiểm tra CUỐI xác nhận lỗi/chưa xác định) — không còn giữ
            // nguyên "án treo" từ lượt 1 nữa.
            pass2.recoveredIds.forEach(id => { recoveredIds.add(id); });
            confirmedErrorIds = pass2.confirmedErrorIds;
            apiFailureIds = pass2.apiFailureIds;
        }

        if (recoveredIds.size > 0 || confirmedErrorIds.size > 0 || apiFailureIds.size > 0) {
            const applyTriageResult = (f: FileItem): FileItem => {
                if (recoveredIds.has(f.id)) {
                    // FIX (tiếp nối việc bỏ loại trừ isRescueLocked ở startupTriage.ts): file này
                    // có thể ĐANG bị khoá cứu hộ từ phiên trước (giờ hậu kiểm lại xác nhận vẫn ổn)
                    // - phải xoá cờ khoá tường minh ở đây, nếu không {...f, status: COMPLETED}
                    // vẫn giữ nguyên isRescueLocked=true cũ (mâu thuẫn: COMPLETED nhưng vẫn báo
                    // đang chờ cứu hộ) - đúng loại lỗi trạng thái người dùng đã báo cáo.
                    return { ...f, status: FileStatus.COMPLETED, errorMessage: undefined, hasStaleTranslation: false, isRescueLocked: false, integrityOverrideAccepted: true };
                }
                if (confirmedErrorIds.has(f.id)) {
                    // Lỗi THẬT đã được AI đối chiếu nội dung và xác nhận từ chối - khoá cứu hộ,
                    // chỉ dịch lại được qua DeepSeek (khác model/nhà cung cấp với hậu
                    // kiểm vừa từ chối, tránh dính lại y hệt lỗi cũ).
                    return { ...f, isRescueLocked: true, status: FileStatus.ERROR, retryCount: 0, errorMessage: "Cứu hộ: hậu kiểm khởi động xác nhận lỗi thật, chỉ dịch lại qua DeepSeek." };
                }
                if (apiFailureIds.has(f.id)) {
                    // FIX (báo cáo "nhầm lẫn khi lọc/thông báo cứu hộ"): file này CHƯA hề được AI
                    // xác nhận lỗi - chỉ là hậu kiểm không gọi được (mạng/API) hoặc không trả kết
                    // quả. Giữ nguyên bản dịch. MỞ KHOÁ (isRescueLocked: false) dù trước đó có bị
                    // khoá hay không - "chưa xác định được" không đủ căn cứ để tiếp tục bắt buộc
                    // chỉ dịch qua DeepSeek; để lượt sau (Auto/Bắt đầu dịch lại/"Hậu
                    // kiểm lại ngay") tự kiểm tra lại bằng BẤT KỲ model nào đang bật.
                    return { ...f, status: FileStatus.ERROR, retryCount: 0, isRescueLocked: false, errorMessage: "Chưa xác định được (lỗi gọi API/mạng lúc hậu kiểm, không phải lỗi thật) - giữ nguyên bản dịch, sẽ tự kiểm tra lại ở lượt hậu kiểm kế tiếp." };
                }
                return f;
            };
            core.setFiles((prev: FileItem[]) => prev.map(applyTriageResult));
            if (filesRef && filesRef.current) {
                filesRef.current = filesRef.current.map(applyTriageResult);
            }
        }

        return { recoveredCount: recoveredIds.size, lockedCount: confirmedErrorIds.size, pendingCount: apiFailureIds.size, requeuedCount };
    };

    // Nút thủ công "Hậu kiểm lại ngay" (đề xuất thêm): cho phép người dùng chủ động chạy
    // startupTriage bất cứ lúc nào, không cần đợi bấm Auto/Bắt đầu dịch. Chặn chạy chồng nếu
    // đang có phiên dịch/sửa lỗi/hậu kiểm khác chạy dưới nền.
    const runRescueCheck = async (showToasts: boolean) => {
        if (isProcessingRef?.current || isRepairRunningRef?.current || isTriageRunningRef.current) {
            if (showToasts) ui.addToast("Đang có phiên xử lý khác chạy dở, vui lòng đợi hoàn tất trước khi hậu kiểm lại thủ công.", 'info');
            return { recoveredCount: 0, lockedCount: 0, pendingCount: 0, requeuedCount: 0 };
        }
        if (showToasts) ui.addToast("Đang hậu kiểm lại các tệp nghi vấn...", 'info');
        try {
            isTriageRunningRef.current = true;
            const result = await runStartupTriage();
            const { recoveredCount, lockedCount, pendingCount, requeuedCount } = result;
            if (showToasts && recoveredCount === 0 && lockedCount === 0 && pendingCount === 0 && requeuedCount === 0) {
                ui.addToast("Không có tệp nào cần hậu kiểm lại lúc này.", 'info');
            } else if (showToasts) {
                const pendingPart = pendingCount > 0 ? `, ${pendingCount} tệp chưa xác định được (lỗi mạng/API, sẽ tự kiểm tra lại sau)` : '';
                const requeuedPart = requeuedCount > 0 ? `, mở khoá ${requeuedCount} tệp không có bản dịch để dịch lại bình thường` : '';
                ui.addToast(`Hậu kiểm xong: phục hồi ${recoveredCount} tệp, ${lockedCount} tệp chuyển diện cứu hộ${pendingPart}${requeuedPart}.`, 'success');
            }
            return result;
        } catch (e: any) {
            if (showToasts) ui.addToast(`Hậu kiểm thủ công lỗi: ${e?.message || e}`, 'error');
            else ui.addLog(`⚠️ Auto: bước phân loại nghi vấn trước Smart Fix bị lỗi (${e?.message || e}); giữ nguyên trạng thái tệp, không suy đoán lỗi thật.`, 'warning');
            return { recoveredCount: 0, lockedCount: 0, pendingCount: 0, requeuedCount: 0 };
        } finally {
            isTriageRunningRef.current = false;
        }
    };
    const runManualRescueCheck = () => runRescueCheck(true);
    const runPostTranslationTriage = () => runRescueCheck(false);

    const prepareModelsForRun = (requestedTier: TranslationTier, requestedTranslationModels?: string[]) => {
        const tier = normalizeTranslationTier(requestedTier);
        const translationModels = tier === 'deepseek'
            ? (core.deepseekModel || 'deepseek-v4-flash').split(',').map((id: string) => id.trim()).filter(Boolean).map((id: string) => `deepseek:${id}`)
            : sanitizeTranslationModelSelection(tier, requestedTranslationModels || loadTranslationModelSelection(tier));
        if (tier !== 'deepseek' && translationModels.length === 0) {
            ui.addToast('Cần chọn ít nhất 1 model dùng để dịch.', 'error');
            return null;
        }
        const availableModelIds = new Set(MODEL_CONFIGS.map(model => model.id));
        const previouslyEnabled = core.stateRef.current.enabledModels || core.enabledModels;
        const modelsToEnable = [...translationModels, ...getRequiredSupportModels(tier)].filter(id => availableModelIds.has(id));
        const enabledModels = Array.from(new Set([...previouslyEnabled, ...modelsToEnable]));
        const reenabledModels = enabledModels.filter(id => !previouslyEnabled.includes(id));
        activeTranslationModelsRef.current = translationModels;
        runtimeEnabledModelsRef.current = enabledModels;
        setTranslationTier(tier);
        if (reenabledModels.length > 0) {
            core.setEnabledModels(enabledModels);
            quotaManager.setEnabledModels(enabledModels);
            ui.addLog(`🔓 Auto/Bắt đầu: tự bật lại ${reenabledModels.length} model cần cho dịch, hậu kiểm, Auto-Fix hoặc Safety: ${reenabledModels.join(', ')}.`, 'info');
        }
        ui.addLog(`🎯 Model dịch được chọn cho ${tier}: ${translationModels.join(' > ')}.`, 'info');
        return { tier, translationModels, enabledModels };
    };

    const verifyShortRawFilesForAuto = async (enabledModels: string[]) => {
        const snapshot: FileItem[] = filesRef?.current || core.files;
        const hasSelection = ui.selectedFiles && ui.selectedFiles.size > 0;
        const candidates = snapshot.filter((file: FileItem) => (!hasSelection || ui.selectedFiles.has(file.id)) && needsShortFileClassification(file) && (file.status === FileStatus.IDLE || file.status === FileStatus.ERROR));
        if (candidates.length === 0) return snapshot.filter(isConfirmedNonStoryFile).length;
        ui.addLog(`🔎 Auto: đang dùng AI xác minh ${candidates.length} file raw ngắn <1200 ký tự theo lô tối đa 10; trường hợp mơ hồ vẫn được giữ để dịch.`, 'info');
        const classifications = await classifyShortRawFiles(candidates, enabledModels, (message: string) => ui.addLog(message, 'info'));
        const applyClassification = (file: FileItem): FileItem => {
            const result = classifications.get(file.id);
            if (!result) return file;
            const previousMessageWasClassifier = file.errorMessage?.startsWith('Auto xác minh file ngắn:');
            return { ...file, shortContentKind: result.kind, shortContentConfidence: result.confidence, shortContentReason: result.reason, shortContentFingerprint: fingerprintShortRawContent(file.content), errorMessage: result.kind === 'non_story' ? `Auto xác minh file ngắn: lời ngoài truyện (${Math.round(result.confidence * 100)}%) — ${result.reason || 'không đưa vào hàng dịch tự động'}` : previousMessageWasClassifier ? undefined : file.errorMessage };
        };
        let updatedSnapshot: FileItem[] | undefined;
        core.setFiles((previous: FileItem[]) => { updatedSnapshot = previous.map(applyClassification); return updatedSnapshot; });
        if (filesRef && updatedSnapshot) filesRef.current = updatedSnapshot;
        const applied = updatedSnapshot || snapshot.map(applyClassification);
        const nonStoryCount = applied.filter(isConfirmedNonStoryFile).length;
        const storyCount = Array.from(classifications.values()).filter(item => item.kind === 'story').length;
        const uncertainCount = Array.from(classifications.values()).filter(item => item.kind === 'uncertain').length;
        ui.addLog(`🧾 Auto xác minh file ngắn: ${nonStoryCount} file lời ngoài truyện được giữ trong workspace nhưng bỏ qua khi dịch tự động; ${storyCount} file xác nhận là nội dung truyện; ${uncertainCount} file mơ hồ vẫn đưa vào dịch.`, nonStoryCount > 0 ? 'warning' : 'info');
        return nonStoryCount;
    };

    const executeProcessing = async (smartAuto: boolean = false, overrideTier?: TranslationTier, requestedTranslationModels?: string[], verifyShortRawFiles: boolean = false) => {
        // BUGFIX (bước C): nếu đang có phiên Sửa Lỗi (Repair) thật sự chạy dưới nền, không cho bắt
        // đầu 1 lượt dịch mới đè lên (sẽ làm tăng runIdRef và khiến phiên repair đang chạy bị coi là
        // "người dùng hủy"). Báo cho người dùng biết và dừng ở đây.
        if (IS_LITE && !ensureGeminiKeyForLite()) {
            ui.addToast('Bản Lite yêu cầu API Key Gemini cá nhân — đã mở Cài đặt để nhập key (lấy miễn phí tại aistudio.google.com/apikey).', 'error');
            return false;
        }
        if (isRepairRunningRef?.current || isTriageRunningRef.current) {
            ui.addToast(isTriageRunningRef.current
                ? "Đang hậu kiểm khởi động chạy dở, vui lòng đợi hoàn tất trước khi Bắt đầu."
                : "Đang có phiên Sửa Lỗi chạy dở, vui lòng đợi hoàn tất trước khi Bắt đầu dịch lại.", 'info');
            return false;
        }

        const preparedModels = prepareModelsForRun(overrideTier || translationTier, requestedTranslationModels);
        if (!preparedModels) return false;
        const { tier: currentTier, enabledModels: nextEnabledModels } = preparedModels;
        if (verifyShortRawFiles) await verifyShortRawFilesForAuto(nextEnabledModels);

        // HẬU KIỂM KHỞI ĐỘNG: xem hàm runStartupTriage() ở trên. Có khoá nhập chống chạy chồng
        // (isTriageRunningRef) — xem ghi chú tại nơi khai báo ref.
        isTriageRunningRef.current = true;
        try {
            await runStartupTriage(nextEnabledModels);
        } finally {
            isTriageRunningRef.current = false;
        }


        const hasSelection = ui.selectedFiles && ui.selectedFiles.size > 0;
        const rescueTierActive = currentTier === 'deepseek';

        // FIX (tiếp nối việc hậu kiểm lại file đang khoá cứu hộ ngay trong runStartupTriage() ở
        // trên): core.files là snapshot state CŨ (chụp lúc executeProcessing() bắt đầu chạy, TRƯỚC
        // khi await runStartupTriage() cập nhật state) - dùng trực tiếp core.files ở đây sẽ bỏ lỡ
        // đúng những file vừa được mở khoá/phục hồi trong LƯỢT NÀY (phải đợi tới lần bấm kế tiếp
        // mới thấy). filesRef.current được cập nhật ĐỒNG BỘ trong applyTriageResult() nên phản ánh
        // đúng kết quả hậu kiểm vừa xong - ưu tiên dùng nó nếu có.
        const filesSnapshot: FileItem[] = (filesRef && filesRef.current) ? filesRef.current : core.files;

        const filesToReset = filesSnapshot.filter((f: FileItem) => {
            // File đã bị khoá cứu hộ: KHÔNG bao giờ đụng tới trạng thái/bản dịch ở đây (dù phiên
            // hiện tại hay phiên mới) - chỉ được gỡ khoá khi dịch thành công qua vệ tinh, hoặc
            // người dùng chủ động chọn (hasSelection) để Bắt đầu dịch lại thủ công.
            if (f.isRescueLocked && !hasSelection) return false;
            if (hasSelection && !ui.selectedFiles.has(f.id)) return false;
            const isPendingTriageVerification = !!f.translatedContent && !!f.errorMessage && f.errorMessage.includes('Chưa xác định được (lỗi gọi API/mạng lúc hậu kiểm');
            if (isPendingTriageVerification && !hasSelection) return false;
            
            const isSuspiciousContentError = f.errorMessage && (f.errorMessage.includes('Nghi vấn lỗi nội dung') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.toLowerCase().includes('safety') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT'));

            // Ngoại trừ các file dịch từ thủ công nếu không chọn trực tiếp (NHƯNG NGOẠI TRỪ LỖI NGHI VẤN NỘI DUNG)
            if (!hasSelection && f.usedModel === 'Thủ công' && !isSuspiciousContentError) return false;

            if (f.status === FileStatus.ERROR) return true;
            if (f.status === FileStatus.IDLE && isSuspiciousContentError) return true;
            if (f.status === FileStatus.PROCESSING || f.status === FileStatus.REPAIRING) return true;
            if (f.status === FileStatus.COMPLETED && f.translatedContent) {
                if (f.translatedContent.trim() === f.content.trim()) return true;
                if (f.translatedContent.includes(BATCH_MISSING_TAG_WARNING)) return true;
                // FIX48-b: KHÔNG còn ép xoá bản dịch + dịch lại toàn bộ chỉ vì còn sót nhiều raw -
                // Auto-Fix In-stream/Smart Fix (chạy tự động sau khi phiên dịch hoàn tất) sẽ tự vá
                // theo dòng, lặp lại đến khi sạch, dù sót ít hay nhiều.
            }
            return false;
        });

        const resetIds = new Set(filesToReset.map(f => f.id));

        const queue = filesSnapshot.filter((f: FileItem) => {
            if (hasSelection && !ui.selectedFiles.has(f.id)) return false;
            if (isConfirmedNonStoryFile(f) && (verifyShortRawFiles || !hasSelection)) return false;
            // File cứu hộ chỉ được đưa vào hàng chờ khi tier đang chọn là DeepSeek, hoặc
            // người dùng chủ động chọn file đó để dịch lại thủ công (hasSelection đã lọc ở trên).
            if (f.isRescueLocked && !hasSelection && !rescueTierActive) return false;
            return f.status === FileStatus.IDLE || resetIds.has(f.id);
        }).map((f: FileItem) => f.id);
        
        if (queue.length === 0) {
            ui.addToast("Không có file nào để dịch", 'info');
            return false;
        }
        
        const nextRunId = (runIdRef?.current || 0) + 1;
        let preparedFiles: FileItem[] | undefined;
        core.setFiles((prev: FileItem[]) => {
            const stableFiles = rollbackAndCloseAllFileTransactions(prev, fileTransactionsRef.current);
            beginFileTransactions(fileTransactionsRef.current, stableFiles.filter((f: FileItem) => resetIds.has(f.id)), nextRunId, 'retranslate');
            preparedFiles = stableFiles.map((f: FileItem) => {
                if (!queue.includes(f.id)) return f;
                return { ...f, status: FileStatus.IDLE, retryCount: 0, usedModel: undefined, errorMessage: undefined,
                    translatedContent: resetIds.has(f.id) ? null : f.translatedContent,
                    hasStaleTranslation: resetIds.has(f.id) ? false : f.hasStaleTranslation,
                    remainingRawCharCount: resetIds.has(f.id) ? 0 : f.remainingRawCharCount,
                    integrityOverrideAccepted: resetIds.has(f.id) ? false : f.integrityOverrideAccepted };
            });
            return preparedFiles;
        });
        if (filesRef && preparedFiles) filesRef.current = preparedFiles;
        if (runIdRef) runIdRef.current = nextRunId;
        if (scheduledBatchesRef) scheduledBatchesRef.current.clear();
        geminiExhaustedRef.current = false; // Phiên dịch mới - thử lại Gemini bình thường từ đầu
        if (setAutoStoppedRemainingCount) setAutoStoppedRemainingCount(null); // Xoá banner "tự dừng" cũ (nếu có) khi bắt đầu phiên mới
        setProcessingQueue(queue);
        setIsSmartAutoMode(smartAuto);
        setAutoFixEnabled(smartAuto);
        setStartTime(Date.now());
        setEndTime(null);
        setIsProcessing(true);
        isFixPhaseRef.current = false;
        
        // Dùng snapshot tươi (filesRef được cập nhật đồng bộ ngay phía trên) thay vì core.files
        // render-time để toast "từ X đến Y" không hiển thị số thứ tự cũ khi triage vừa đổi trạng thái.
        const freshSnapshot: FileItem[] = (filesRef?.current as FileItem[]) || core.files;
        const firstIndex = freshSnapshot.findIndex(f => f.id === queue[0]) + 1;
        const lastIndex = freshSnapshot.findIndex(f => f.id === queue[queue.length - 1]) + 1;
        
        ui.addToast(`🚀 Bắt đầu dịch gộp (Batch) ${queue.length} tệp (từ ${firstIndex} đến ${lastIndex})`, 'info');
        ui.addLog(`🚀 Bắt đầu dịch gộp (Batch) ${queue.length} tệp (từ ${firstIndex} đến ${lastIndex}) - ${currentTier} tier${smartAuto ? ' - Smart Auto Mode' : ''}`, 'info');
        if (resetIds.size > 0) {
            ui.addLog(`🔄 Auto Continue: Đã tự động reset và nối tiếp ${resetIds.size} file lỗi/treo/nghi vấn vào hàng đợi.`, 'info');
        }
        return true;
    };

    const stopProcessing = () => {
        if (runIdRef) runIdRef.current += 1;
        if (scheduledBatchesRef) scheduledBatchesRef.current.clear();
        let restoredFiles: FileItem[] | undefined;
        core.setFiles((prev: FileItem[]) => { restoredFiles = rollbackAndCloseAllFileTransactions(prev, fileTransactionsRef.current); return restoredFiles; });
        if (filesRef && restoredFiles) filesRef.current = restoredFiles;
        setIsProcessing(false);
        setProcessingQueue([]);
        setActiveBatches(0);
        setEndTime(Date.now());
        setIsSmartAutoMode(false);
        setAutoFixEnabled(false);
        isFixPhaseRef.current = false;
        geminiExhaustedRef.current = false;
        if (setAutoStoppedRemainingCount) setAutoStoppedRemainingCount(null);
        ui.addToast("Đã dừng dịch và khôi phục bản ổn định trước khi chạy cho các tệp đang xử lý.", 'warning');
        ui.addLog('⏹️ Người dùng dừng phiên: các batch đang chạy đã bị hủy và transaction chưa hoàn tất đã rollback.', 'warning', { operation: 'cancel_and_rollback', provider: 'system', runId: String(runIdRef?.current || '') });
    };

    const handleRetranslateConfirm = (selectedIds: string[], keepOld: boolean, tier: TranslationTier) => {
        if (selectedIds.length === 0) {
            ui.addToast("Chưa chọn file nào để dịch lại.", "warning");
            return;
        }
        if (isRepairRunningRef?.current) {
            ui.addToast("Đang có phiên Sửa Lỗi chạy dở, vui lòng đợi hoàn tất trước khi dịch lại.", 'info');
            return;
        }
        // Người dùng Dịch Lại = bác bỏ bản dịch cũ: xoá cặp gốc->dịch tương ứng khỏi Translation
        // Memory (nếu có) và đưa id vào danh sách cấm tra cứu TM của phiên. Nếu không, scheduler
        // sẽ khớp TM và gắn TRẢ LẠI đúng bản cũ ngay lập tức (usedModel='TM', 0 request API) —
        // lỗi "dịch lại file đã có bản dịch thì không có tác dụng". Bản dịch MỚI sau khi thành
        // công sẽ được applyBatchResults lưu lại vào TM, thay thế chỗ cũ.
        const storyTitle = core.stateRef?.current?.storyInfo?.title;
        const currentFiles = core.stateRef?.current?.files || [];
        const selectedContents = currentFiles
            .filter((f: FileItem) => selectedIds.includes(f.id))
            .map((f: FileItem) => f.content);
        // API TM giờ bất đồng bộ — xoá nền fire-and-forget; cơ chế cấm tra cứu theo id ở dưới
        // vẫn chạy NGAY (đồng bộ) nên lượt Dịch Lại này chắc chắn không dính bản cũ dù việc
        // xoá entry chưa kịp xong.
        deleteTranslationMemoryEntries(storyTitle, selectedContents)
            .then((purgedTmCount) => { if (purgedTmCount > 0) ui.addLog(`🗑️ Đã xoá ${purgedTmCount} bản dịch cũ khỏi Translation Memory (bị bác bỏ theo yêu cầu Dịch Lại).`, "info"); })
            .catch((e) => console.warn("Xoá Translation Memory thất bại:", e));
        selectedIds.forEach((id: string) => retranslateSkipTmIdsRef.current.add(id));
        const nextRunId = (runIdRef?.current || 0) + 1;
        let preparedFiles: FileItem[] | undefined;
        core.setFiles((prev: FileItem[]) => {
            const stableFiles = rollbackAndCloseAllFileTransactions(prev, fileTransactionsRef.current);
            beginFileTransactions(fileTransactionsRef.current, stableFiles.filter((f: FileItem) => selectedIds.includes(f.id)), nextRunId, 'retranslate');
            preparedFiles = stableFiles.map((f: FileItem) => selectedIds.includes(f.id) ? { ...f, status: FileStatus.IDLE, translatedContent: keepOld ? f.translatedContent : null, remainingRawCharCount: 0, retryCount: 0, usedModel: undefined, integrityOverrideAccepted: false } : f);
            return preparedFiles;
        });
        if (filesRef && preparedFiles) filesRef.current = preparedFiles;
        
        const newQueue = Array.from(new Set([...processingQueue, ...selectedIds]));
        // Phiên dịch lại là 1 run MỚI: tăng runId để các batch dang dở của phiên cũ bị hủy
        // (shouldAbort) và không còn được phép chèn id retry/ghi kết quả vào hàng đợi mới.
        if (runIdRef) runIdRef.current = nextRunId;
        if (scheduledBatchesRef) scheduledBatchesRef.current.clear();
        geminiExhaustedRef.current = false;
        setProcessingQueue(newQueue);
        setTranslationTier(tier);
        setIsProcessing(true);
        isFixPhaseRef.current = false;
        if (!startTime) setStartTime(Date.now());
        ui.addToast(`Đã thêm ${selectedIds.length} file vào hàng đợi dịch lại (${tier} tier).`, "success");
    };

    return {
        processBatch,
        executeProcessing,
        prepareModelsForRun,
        runManualRescueCheck,
        runPostTranslationTriage,
        stopProcessing,
        handleRetranslateConfirm
    };
};
