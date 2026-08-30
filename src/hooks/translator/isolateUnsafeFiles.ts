import { FileItem, FileStatus } from '../../types';
import { getRescueTarget, getRescueBudget, getRescueLabel, getSafetyRescueBudgetLimit } from '../../services/workflows/translate/rescueTarget';
import { reorderQueueWithPriority } from './queuePriority';
import type { CoreApi, UIApi } from '../apiTypes';

export interface IsolateUnsafeFilesContext {
    batchIds: string[];
    batchFiles: FileItem[];
    // Lỗi gốc ném ra từ translateBatchStream - chỉ xử lý khi là lỗi Safety Filter
    error: any;
    core: CoreApi;
    ui: UIApi;
    myRunId: number;
    runIdRef: any;
    isFixPhaseRef: any;
    setProcessingQueue: (action: (prev: string[]) => string[]) => void;
    setRetryTrigger: (action: (prev: number) => number) => void;
}

// R-A (tách khỏi processBatch/useTranslator): nhánh safety-scan của khối catch trở thành
// hàm riêng - khi batch lỗi vì bộ lọc an toàn: quét sơ bộ cả batch -> quét riêng từng tệp
// để dò tệp vi phạm thật, tệp vi phạm thì bàn giao cho vệ tinh cứu hộ (DeepSeek)
// theo ngân sách còn lại hoặc đánh ERROR nếu hết lượt, các tệp "vạ lây" an toàn được reset
// (isSafeRebatch, không tăng retryCount) để ghép batch lại. Cuối cùng reorder hàng chờ ưu
// tiên tệp cứu hộ lên đầu + kích hoạt retry. Hành vi giữ nguyên 100% so với bản nội tuyến.
//
// Trả về TRUE khi đã xử lý xong lỗi này (caller phải thoát sớm khỏi catch), FALSE khi lỗi
// KHÔNG phải Safety Filter và cần rơi xuống các nhánh xử lý khác (quota/blacklist...).
export const isolateUnsafeFiles = async (ctx: IsolateUnsafeFilesContext): Promise<boolean> => {
    const { batchIds, batchFiles, error, core, ui, myRunId, runIdRef, isFixPhaseRef, setProcessingQueue, setRetryTrigger } = ctx;

    const isAllQuotaExhausted = error.message.includes("Tất cả model khả dụng đã hết Quota hoặc bị tắt") || error.message.includes("Tất cả model đã thử đều gặp lỗi hoặc hết Quota");
    const isQuotaError = error.message.includes("429") || error.message.toLowerCase().includes("quota");
    const isSafetyError = !isAllQuotaExhausted && !isQuotaError && (error.message.includes("bộ lọc an toàn") || error.message.toLowerCase().includes("safety") || error.message.includes("BLOCKLIST") || error.message.includes("PROHIBITED_CONTENT"));

    if (!isSafetyError) return false;

    {
        ui.addLog(`⚠️ Bị chặn bởi Safety Filter. Đang xác định các tệp vi phạm...`, "warning");

        const unsafeIds = new Set<string>();

        try {
            const { testContentSafety } = await import('../../services/workflows/translator');

            let needsIndividualScan = true;
            if (batchFiles.length > 1) {
                ui.addLog(`🔍 Đang quét sơ bộ bộ lọc an toàn cho toàn bộ Batch (${batchFiles.length} tệp)...`, 'info');
                const fullBatchContent = batchFiles.map(f => f.content).join('\n\n');
                const scanResult = await testContentSafety(fullBatchContent, core.enabledModels);

                if (scanResult.modelUsed && scanResult.modelUsed !== 'error' && !scanResult.modelUsed.includes('unknown')) {
                    // Usage is now recorded inside testContentSafety
                }

                const isBatchUnsafe = !scanResult.isSafe;

                if (!isBatchUnsafe) {
                    ui.addLog(`✅ Toàn batch an toàn (Quét bởi ${scanResult.modelUsed}). Lỗi có thể do ngắt kết nối (bảng thông tin, format).`, 'info');
                    needsIndividualScan = false;
                } else {
                    ui.addLog(`⚠️ Phát hiện nội dung vi phạm trong Batch (Quét bởi ${scanResult.modelUsed}). Đang dò tìm tệp lỗi cụ thể...`, 'warning');
                }
            }

            if (needsIndividualScan) {
                for (const f of batchFiles) {
                    // FIX (phiên cũ ghi đè phiên mới): quét riêng từng tệp mất 2s+/tệp — giữa
                    // chừng người dùng bấm Dừng rồi Bắt Đầu lại (runId tăng, hàng đợi bị xoá)
                    // thì vòng quét cũ vẫn tiếp tục và ghi trạng thái IDLE/retryCount lên đúng
                    // các file phiên MỚI có thể đang dịch. Thoát ngay khi phát hiện hết hiệu lực.
                    if (myRunId !== runIdRef?.current) return true;
                    let isUnsafe = false;

                    // Nếu batch chỉ có 1 file và bị lỗi safety từ API dịch, chắc chắn file này là nguyên nhân!
                    if (batchFiles.length === 1 && isSafetyError) {
                        isUnsafe = true;
                        ui.addLog(`🔍 Tệp ${f.name} là nguyên nhân gây lỗi Safety.`, 'info');
                    } else {
                        ui.addLog(`🔍 Kiểm tra an toàn tệp: ${f.name}...`, 'info');
                        // Add delay BEFORE individual scan to avoid overwhelming quota
                        await new Promise(r => setTimeout(r, 2000));

                        const individualScan = await testContentSafety(f.content, core.enabledModels);
                        isUnsafe = !individualScan.isSafe;

                        if (individualScan.modelUsed && individualScan.modelUsed !== 'error' && !individualScan.modelUsed.includes('unknown')) {
                            // Usage is now recorded inside testContentSafety
                        }
                    }

                    if (isUnsafe) {
                        unsafeIds.add(f.id);
                        const maxRetries = getSafetyRescueBudgetLimit(!!isFixPhaseRef?.current);
                        const hasDS = !!(core.deepseekKey && core.deepseekKey.trim().length > 0);
                        const target = getRescueTarget(f.retryCount || 0, hasDS, maxRetries);
                        if (target) {
                            ui.addLog(`🚨 Tệp ${f.name} nghi vấn vi phạm/lỗi! Bàn giao cho vệ tinh ${getRescueLabel(target)}...`, "warning");
                        } else {
                            ui.addLog(`🚨 Tệp ${f.name} bị Gemini chặn nội dung! Đánh dấu lỗi. (Mẹo: Thêm API Key DeepSeek trong Cài đặt để dự phòng cho các tệp lỗi)`, "error");
                        }
                    } else {
                        ui.addLog(`✅ Tệp ${f.name} an toàn.`, "success");
                    }
                }

                ui.addLog(`📊 Kết quả quét: ${unsafeIds.size} tệp lỗi, ${batchFiles.length - unsafeIds.size} tệp an toàn.`, 'info');
            }

            // Nếu lỗi gốc là Safety mà quét không ra file nào, BẮT BUỘC phải cách ly 1 file để loại trừ dần.
            // FIX67 (đề xuất fix66): thay vì mù quáng cách ly tệp ĐẦU TIÊN, ưu tiên tệp có
            // "tiền sử nội dung" cao nhất (contentStrikes) — các phiên trước đã từng dính lỗi
            // thì xác suất là thủ phạm cao hơn hẳn, hội tụ nhanh hơn ở những lần tái diễn.
            if (unsafeIds.size === 0 && isSafetyError && batchFiles.length > 0) {
                 const suspect = [...batchFiles].sort((a, b) => (b.contentStrikes || 0) - (a.contentStrikes || 0))[0];
                 const historyNote = (suspect.contentStrikes || 0) > 0 ? ` (có tiền sử ${(suspect.contentStrikes)} lần gây lỗi nội dung)` : '';
                 ui.addLog(`⚠️ Không dò ra tệp vi phạm bằng công cụ quét, nhưng API dịch báo lỗi Safety. Tự động cách ly tệp "${suspect.name}"${historyNote} để loại trừ dần...`, "warning");
                 unsafeIds.add(suspect.id);
            }

        } catch (internalErr: any) {
            ui.addLog(`❌ Lỗi khi quét bộ lọc: ${internalErr.message || 'Lỗi không xác định'}. Đang áp dụng cơ chế cách ly an toàn...`, "error");
            if (myRunId !== runIdRef?.current) return true; // phiên đã bị thay - không ghi đè state
            // FIX67: tệp bị cách ly trong nhánh lỗi-quét cũng được cộng tiền sử nội dung
            core.setFiles((prev: FileItem[]) => prev.map((item: FileItem) => {
                if (batchIds.includes(item.id)) {
                    const batchIndex = batchIds.indexOf(item.id);
                    if (batchIndex === 0) {
                        return { ...item, status: FileStatus.IDLE, retryCount: (item.retryCount || 0) + 1, contentStrikes: (item.contentStrikes || 0) + 1, errorMessage: "Nghi vấn lỗi nội dung hoặc format - Đang cách ly để kiểm tra riêng" };
                    } else {
                        return { ...item, status: FileStatus.IDLE, retryCount: (item.retryCount || 0), errorMessage: `Chờ thử lại do vạ lây từ batch có file safety`, isSafeRebatch: true } as any;
                    }
                }
                return item;
            }));
            if (myRunId === runIdRef?.current) {
                // batchIndex 0 vừa được gắn "Đang cách ly để kiểm tra riêng" ở trên -> ưu tiên
                // lên đầu hàng chờ thay vì chôn ở cuối cùng với các tệp "vạ lây" phía sau.
                setProcessingQueue(prev => reorderQueueWithPriority(prev, batchIds, new Set(batchIds.length > 0 ? [batchIds[0]] : [])));
                setRetryTrigger(prev => prev + 1);
            }
            return true; // Thoát sớm sau khi đã cập nhật trạng thái của tệp
        }

        const rescueMaxRetries = getSafetyRescueBudgetLimit(!!isFixPhaseRef?.current);
        const rescueHasDS = !!(core.deepseekKey && core.deepseekKey.trim().length > 0);
        // FIX (phiên cũ ghi đè phiên mới): chặn trước mọi lượt core.setFiles bên dưới — quét an
        // toàn mất nhiều giây, nếu phiên đã bị thay (Dừng/Bắt Đầu lại) thì các IDLE/retryCount
        // ở đây sẽ đè lên file phiên MỚI đang dịch dở.
        if (myRunId !== runIdRef?.current) return true;
        // Tệp nào trong unsafeIds thực sự có vệ tinh cứu hộ tiếp nhận (còn lượt) sẽ được ưu
        // tiên lên đầu hàng chờ (xem reorderQueueWithPriority) thay vì chờ tới lượt cuối cùng.
        const priorityIdsForRescue = new Set<string>();
        if (unsafeIds.size > 0) {
            for (const uid of unsafeIds) {
                const uf = batchFiles.find((x: FileItem) => x.id === uid);
                const target = getRescueTarget(uf?.retryCount || 0, rescueHasDS, rescueMaxRetries);
                if (target) priorityIdsForRescue.add(uid);
            }
        }

        if (unsafeIds.size > 0) {
            const maxRetries = rescueMaxRetries;
            const hasDS = rescueHasDS;
            core.setFiles((prev: FileItem[]) => prev.map((item: FileItem) => {
                if (unsafeIds.has(item.id)) {
                    // FIX67: ghi "tiền sử nội dung" vào hồ sơ tệp — các lần cách ly sau sẽ ưu
                    // tiên tệp này trước; processBatch cũng cảnh báo khi batch chứa tệp có tiền sử.
                    const newStrikes = ((item.contentStrikes || 0) + 1);
                    const target = getRescueTarget(item.retryCount || 0, hasDS, maxRetries);
                    if (target) {
                        const rescueBudget = getRescueBudget(hasDS, maxRetries);
                        return { ...item, status: FileStatus.IDLE, retryCount: (item.retryCount || 0) + 1, contentStrikes: newStrikes, errorMessage: `Lỗi bộ lọc an toàn - Bàn giao ${getRescueLabel(target)} (${(item.retryCount || 0) + 1}/${rescueBudget})` };
                    } else {
                        const reason = hasDS ? "Đã hết lượt cứu hộ DeepSeek" : "Không có vệ tinh DeepSeek dự phòng";
                        return { ...item, status: FileStatus.ERROR, contentStrikes: newStrikes, errorMessage: `Bị chặn bởi Safety Filter (${reason})` };
                    }
                } else if (batchIds.includes(item.id)) {
                    // Safe files get reset without increasing retryCount so they can be re-batched
                    return { ...item, status: FileStatus.IDLE, errorMessage: "Chờ thử lại do vạ lây từ file lỗi trong batch", isSafeRebatch: true } as any;
                }
                return item;
            }));
        } else {
            // Nếu quét xong mà không có file nào lỗi safety thật, thì xử lý như retry bình thường
            core.setFiles((prev: FileItem[]) => prev.map((item: FileItem) => {
                if (batchIds.includes(item.id)) {
                    return { ...item, status: FileStatus.IDLE, retryCount: (item.retryCount || 0) + 1, errorMessage: "Lỗi kết nối hoặc format (Đã check Safety an toàn)" };
                }
                return item;
            }));
        }

        if (myRunId === runIdRef?.current) {
            setProcessingQueue(prev => reorderQueueWithPriority(prev, batchIds, priorityIdsForRescue));
            setRetryTrigger(prev => prev + 1);
        }
        return true;
    }
};
