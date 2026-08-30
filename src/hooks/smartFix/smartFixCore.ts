// Nhóm hàm SMART FIX (Pro Mode): dò và tự sửa các dòng còn sót raw CJK (handleFixRemainingRaw),
// và hàm điều phối tổng gom toàn bộ file lỗi/nghi vấn vào hàng đợi xử lý lại (handleSmartFix).
// handleSmartFix có gọi trực tiếp handleFixRemainingRaw ở 1 nhánh (file lỗi raw nhẹ) nên 2 hàm
// này được giữ chung 1 file.
// FIX49-c: BỎ hẳn module dò "tiếng Anh sót" tự động (silent) từng chạy kèm mỗi lượt Auto-Fix/
// Smart Fix (gọi detectUnmappedInlineEnglish rồi gửi AI dịch lại các dòng nghi có tiếng Anh sót).
// Cơ chế phát hiện raw chính (countForeignChars/findLinesWithForeignChars) CHƯA BAO GIỜ tính
// tiếng Anh (chỉ Hán/Nhật/Hàn/Cyrillic/Thái) nên việc bỏ module này không đổi hành vi "check
// raw".
// FIX51: BỎ LUÔN applyInlineEnglishFix (dịch theo từ điển cố định) khỏi pipeline tự động ở
// đây lẫn ở applyBatchResults.ts (ngay sau khi dịch xong) — do dictionary Anh-Việt có thể
// trùng mặt chữ với từ tiếng Việt không dấu (nguy cơ sửa nhầm câu đúng thành câu sai). Từ giờ
// applyInlineEnglishFix CHỈ chạy khi người dùng tự bấm nút trong panel thủ công ở tab Sửa Lỗi
// (InlineEnglishFixPanel.tsx: "Sửa tự động (Rule)" / "AI Fix toàn diện") — không còn tự động
// áp dụng trong lúc dịch hay trong Smart Fix nữa.
import { FileItem, FileStatus, GlobalRepairEntry } from '../../types';
import { performAggregatedRepair } from '../../services/workflows/translate/repair';
import { getEffectiveModelsForTier } from '../../services/workflows/translate/modelSelection';
import { ensureGeminiKeyForLite } from '../../services/api/gemini';
import { IS_LITE } from '../../constants';
import { pickRepairModels } from '../../services/api/rescueModels';
import { findLinesWithForeignChars, mergeFixedLines, formatBookStyle, countForeignChars, validateTranslationIntegrity, BATCH_MISSING_TAG_WARNING, attemptFormatMergedParagraphs, cleanupAiTextArtifacts } from '../../utils/text';
import { beginFileTransactions, commitFileTransactions, rollbackAndCloseAllFileTransactions, rollbackAndCloseFileTransactions } from '../translator/fileTransactions';
import type { CoreApi, UIApi } from '../apiTypes';
import { isSafetyOrSuspiciousError, shouldExcludeFromSmartFix } from './smartFixClassification';

// FIX49-a: giới hạn số lượt vá dòng raw CHỈ TÍNH ở đúng bước "Smart Fix (Pro Mode)" (đang trong
// isFixPhaseRef) cho 1 file - trước đây lặp vô hạn tới khi remainingRawCharCount = 0. Auto-Fix
// In-stream (lượt vá dòng rẻ tiền chạy ngay sau khi dịch xong, isFixPhaseRef còn false lúc đó)
// KHÔNG bị tính vào giới hạn này.
const MAX_SMART_FIX_RAW_ATTEMPTS = 2;

export const useSmartFixCore = (core: CoreApi, ui: UIApi, sharedState: any) => {
    const {
        setIsProcessing, setProcessingQueue, setStartTime, setEndTime,
        isFixPhaseRef, scheduledBatchesRef, runIdRef,
        setIsSmartAutoMode, setAutoFixEnabled,
        effectiveDictionary, filesRef, translationTier,
        isRepairRunningRef, fileTransactionsRef
    } = sharedState;

    const handleFixRemainingRaw = async (isSmartFixMode: boolean = false, overrideEnabledModels?: string[], maxPasses: number = 1, forcedModels?: string[]) => {
        if (IS_LITE && !ensureGeminiKeyForLite()) {
            ui.addToast('Bản Lite yêu cầu API Key Gemini cá nhân — đã mở Cài đặt để nhập key.', 'error');
            return false;
        }
        if (isRepairRunningRef.current) {
            ui.addLog('⏳ Đang có phiên sửa lỗi chạy dở, bỏ qua yêu cầu Auto Fix Raw trùng lặp.', 'info');
            return false;
        }
        const myRunId = runIdRef.current;
        // FIX49-a: đây có phải 1 lượt vá dòng thuộc phiên "Smart Fix (Pro Mode)" hay không - tính
        // theo isFixPhaseRef.current TẠI THỜI ĐIỂM GỌI (đã được handleSmartFix bật sẵn = true
        // trước khi gọi hàm này ở cả lượt đầu lẫn các lượt lặp lại qua scheduler), KHÔNG chỉ dựa
        // vào tham số isSmartFixMode (tham số này không được truyền lại true ở các lượt lặp).
        const isSmartFixPhaseAttempt = isSmartFixMode || isFixPhaseRef.current;

        let rawTargets = filesRef.current.filter((f: FileItem) => f.status === FileStatus.COMPLETED && f.remainingRawCharCount > 0);
        
        // Bỏ qua các file đã được người dùng tự cứu hộ thủ công
        rawTargets = rawTargets.filter((f: FileItem) => f.usedModel !== 'Thủ công');

        // FIX49-a: ở phiên Smart Fix (Pro Mode), bỏ qua file đã hết lượt vá cho phép (xem
        // MAX_SMART_FIX_RAW_ATTEMPTS) - tránh vá dòng lặp vô hạn cho các file có vài ký tự CJK
        // đặc biệt mà AI xác định đúng là không cần sửa (emoji, tên riêng cố ý giữ nguyên...).
        const staleAttemptTargets = isSmartFixPhaseAttempt
            ? rawTargets.filter((f: FileItem) => (f.rawFixAttemptCount || 0) >= MAX_SMART_FIX_RAW_ATTEMPTS)
            : [];
        if (isSmartFixPhaseAttempt && staleAttemptTargets.length > 0) {
            rawTargets = rawTargets.filter((f: FileItem) => (f.rawFixAttemptCount || 0) < MAX_SMART_FIX_RAW_ATTEMPTS);
        }

        const targets = [...rawTargets];
        // FIX47 (bug treo giao diện khi mở EditorModal - vòng lặp toast "Không có file nào cần sửa"):
        // trước đây nhánh này CHỈ hiện toast rồi return, KHÔNG dọn trạng thái phiên -> nếu được gọi
        // từ vòng lập lịch tự động (isProcessing=true), các cờ isProcessing/isSmartAutoMode/
        // autoFixEnabled/isFixPhaseRef bị KẸT ở trạng thái bật vĩnh viễn. Effect lập lịch trong
        // useTranslator.ts phụ thuộc object `ui` (tạo mới mỗi render) nên cứ mỗi lần render lại
        // (gõ chữ trong editor, toast hiện/bị xoá...) là nó được gọi trở lại -> toast lại -> render
        // lại... thành vòng lặp không đáy: trên bản cũ (không tự tắt toast) toast nằm luôn và hệ
        // thống kẹt "đang xử lý"; trên build thiếu chống trùng toast thì hàng trăm toast chồng nhau
        // sinh ra liên tục làm trình duyệt treo hẳn (đúng như ảnh người dùng chụp). SỬA: dọn sạch
        // trạng thái phiên ngay tại nhánh sớm này (y hệt các nhánh kết thúc khác của hàm) để vòng
        // lập lịch dừng hẳn thay vì quay xe gọi lại vô hạn.
        if (targets.length === 0) {
            if (staleAttemptTargets.length > 0) {
                ui.addLog(`ℹ️ Smart Fix: Bỏ qua ${staleAttemptTargets.length} file vẫn còn sót raw sau khi đã vá dòng đủ ${MAX_SMART_FIX_RAW_ATTEMPTS} lượt bằng Pro Mode - có thể là ký tự đặc biệt (emoji, tên riêng cố ý giữ nguyên...) không thực sự cần sửa. Không tự động thử lại thêm để tránh tốn API; có thể sửa tay bằng nút búa nếu cần.`, 'info');
                ui.addToast(`Đã dừng vá dòng cho ${staleAttemptTargets.length} file (đã thử đủ lượt cho phép)`, 'info');
            } else {
                ui.addToast("Không có file nào cần sửa", 'info');
            }
            setIsProcessing(false);
            setEndTime(Date.now());
            setIsSmartAutoMode(false);
            setAutoFixEnabled(false);
            isFixPhaseRef.current = false;
            return;
        }

        // BUGFIX (bước C): đánh dấu "đang có phiên repair chạy" NGAY khi chắc chắn sẽ chạy thật,
        // để executeProcessing()/handleSmartFix() có thể tự chặn nếu bị gọi chồng trong lúc này.
        isRepairRunningRef.current = true;
        
        setEndTime(null);
        setIsProcessing(true);
        setStartTime(Date.now());
        
        const allBadLines: GlobalRepairEntry[] = [];
        // FIX (lineIndex stale): chụp lại nội dung dịch tại thời điểm dò dòng lỗi. performAggregatedRepair
        // có thể chạy hàng phút - nếu trong lúc đó người dùng mở EditorModal sửa/xoá dòng (autosave ghi
        // ngay), index của allBadLines sẽ lệch so với nội dung hiện tại; mergeFixedLines theo index cũ
        // sẽ thay SAI vị trí hoặc ghi đè lên đúng đoạn người dùng vừa chỉnh. So sánh snapshot trước khi
        // merge: nội dung đã khác -> bỏ qua sửa theo index cho file đó (an toàn hơn corrupt dữ liệu).
        const scannedTranslatedContent = new Map<string, string>();
        const targetIds = targets.map(t => t.id);
        beginFileTransactions(fileTransactionsRef.current, targets, myRunId, 'postprocess');
        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => targets.some(t => t.id === f.id) ? { ...f, status: FileStatus.REPAIRING } : f));
        
        targets.forEach(f => {
            if (f.translatedContent) {
                scannedTranslatedContent.set(f.id, f.translatedContent);
                // FIX49-c: chỉ còn dò dòng sót raw CJK (findLinesWithForeignChars). Bỏ hẳn bước dò
                // "tiếng Anh sót" tự động (detectUnmappedInlineEnglish) từng gộp chung vào đây.
                const rawLines = findLinesWithForeignChars(f.translatedContent);
                
                rawLines.forEach(l => { 
                    allBadLines.push({ fileId: f.id, lineIndex: l.index, originalLine: l.originalLine }); 
                });
            }
        });

        const taskType = isSmartFixMode ? 'smart_fix' : 'auto_fix';
        const enabledModelsForRun = overrideEnabledModels || core.stateRef.current.enabledModels || core.enabledModels;
        const modelsUsed = (forcedModels?.length ? forcedModels : getEffectiveModelsForTier(translationTier, taskType, enabledModelsForRun)).join(', ');
        
        ui.addToast(`Bắt đầu dò và dịch lại ${allBadLines.length} dòng sót raw CJK`, 'info');
        if (isSmartFixMode) {
            ui.addLog(`🔍 Tiến trình Smart Fix (Pro Mode): Tiến hành Autofix sót raw CJK ở ${targets.length} tệp. Tổng cộng ${allBadLines.length} dòng lỗi... (Sử dụng model: ${modelsUsed})`, "info");
        } else {
            ui.addLog(`⚡ Tiến trình Auto-Fix In-stream (Kèm Batch): Tiến hành Autofix sót raw CJK ở ${targets.length} tệp. Tổng cộng ${allBadLines.length} dòng lỗi... (Sử dụng model: ${modelsUsed})`, "info");
        }

        if (allBadLines.length === 0) {
            ui.addToast("Không tìm thấy dòng lỗi cụ thể (có thể do ký tự ẩn).", "warning");
            const targetIdsForNoLines = new Set(targets.map(t => t.id));
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.status === FileStatus.REPAIRING ? {
                ...f,
                status: FileStatus.COMPLETED,
                // FIX49-a: vẫn tính là 1 lượt thử ở phiên Smart Fix dù không tìm thấy dòng cụ thể -
                // nếu không tính, remainingRawCharCount không đổi và file này sẽ bị dò lại y hệt ở
                // lượt kế tiếp, lặp vô hạn.
                rawFixAttemptCount: isSmartFixPhaseAttempt && targetIdsForNoLines.has(f.id) ? (f.rawFixAttemptCount || 0) + 1 : f.rawFixAttemptCount,
            } : f));
            commitFileTransactions(fileTransactionsRef.current, targetIds, myRunId);
            setIsProcessing(false);
            isFixPhaseRef.current = false;
            isRepairRunningRef.current = false;
            return;
        }

        try {
            const affectedFiles: { usedModel?: string | null }[] = [];
            allBadLines.forEach(bl => {
                const f = core.files.find((file: FileItem) => file.id === bl.fileId);
                if (f) affectedFiles.push(f);
            });
            const modelsForFix = forcedModels?.length
                ? [...forcedModels]
                : pickRepairModels(affectedFiles, { ...core, enabledModels: enabledModelsForRun });

            const fixesMap = await performAggregatedRepair(
                allBadLines, effectiveDictionary, translationTier, core.storyInfo.contextNotes, 
                core.storyInfo, core.promptTemplate, (msg) => ui.addLog(msg, 'info'), modelsForFix,
                undefined,
                () => myRunId !== runIdRef.current,
                taskType,
                core.deepseekKey,
                core.deepseekModel,
                forcedModels
            );
            
            if (myRunId !== runIdRef.current) {
                core.setFiles((prev: FileItem[]) => rollbackAndCloseFileTransactions(prev, targetIds, fileTransactionsRef.current, myRunId));
                isRepairRunningRef.current = false; return;
            }

            core.setFiles((prev: FileItem[]) => {
                const newFiles = [...prev];
                let skippedStaleCount = 0;
                fixesMap.forEach((fileFixes, id) => {
                    const fIndex = newFiles.findIndex(f => f.id === id);
                    if (fIndex !== -1 && newFiles[fIndex].translatedContent) {
                        const f = newFiles[fIndex];
                        const snapshot = scannedTranslatedContent.get(id);
                        if (snapshot !== undefined && f.translatedContent !== snapshot) {
                            skippedStaleCount++;
                            return;
                        }
                        const fixArray = Array.from(fileFixes.entries()).map(([idx, txt]) => ({ index: idx, text: txt }));
                        const fixedContent = mergeFixedLines(f.translatedContent!, fixArray);
                        const cleanContent = cleanupAiTextArtifacts(formatBookStyle(fixedContent, f.content, core.storyInfo?.enableTitleFormatting !== false, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false));
                        // fix50->fix51: bỏ applyInlineEnglishFix tự động khỏi Smart Fix — chỉ chạy thủ công ở tab Sửa Lỗi (InlineEnglishFixPanel), tránh false-positive với từ tiếng Việt không dấu.
                        const remainingRaw = countForeignChars(cleanContent);
                        newFiles[fIndex] = { ...f, translatedContent: cleanContent, remainingRawCharCount: remainingRaw };
                    }
                });
                if (skippedStaleCount > 0) {
                    ui.addLog(`⚠️ Bỏ qua sửa theo dòng cho ${skippedStaleCount} file vì nội dung đã bị thay đổi trong lúc sửa lỗi đang chạy (tránh ghi đè nhầm vị trí). Chạy lại Smart Fix nếu vẫn còn sót raw.`, 'warning');
                }
                return newFiles;
            });
        } catch (e: any) {
            core.setFiles((prev: FileItem[]) => rollbackAndCloseFileTransactions(prev, targetIds, fileTransactionsRef.current, myRunId));
            setIsProcessing(false); setIsSmartAutoMode(false); setAutoFixEnabled(false); setEndTime(Date.now());
            isFixPhaseRef.current = false; isRepairRunningRef.current = false;
            if (myRunId === runIdRef.current) {
                ui.addLog(`❌ Lỗi sửa hàng loạt: ${e.message}`, "error", { operation: 'postprocess_repair', provider: 'system', runId: String(myRunId), cause: 'repair_failed' });
                ui.addToast('Sửa lỗi thất bại; app đã khôi phục nguyên vẹn bản dịch trước khi sửa.', 'error');
            }
            return;
        }
        
        if (myRunId !== runIdRef.current) {
            core.setFiles((prev: FileItem[]) => rollbackAndCloseFileTransactions(prev, targetIds, fileTransactionsRef.current, myRunId));
            isRepairRunningRef.current = false; return;
        }
        const targetIdsThisRound = new Set(targets.map(t => t.id));
        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
            if (f.status === FileStatus.REPAIRING) {
                // FIX49-a: mỗi lượt vá dòng thực sự chạy xong ở phiên Smart Fix (Pro Mode) tính là
                // 1 lượt thử, dù có sạch hẳn hay chưa - đủ lượt thì lần "quét lại" kế tiếp
                // (rawFiles trong handleSmartFix) sẽ tự bỏ qua file này, không vá lặp vô hạn.
                const countsHere = isSmartFixPhaseAttempt && targetIdsThisRound.has(f.id);
                return { ...f, status: FileStatus.COMPLETED, rawFixAttemptCount: countsHere ? (f.rawFixAttemptCount || 0) + 1 : f.rawFixAttemptCount };
            }
            if (f.status === FileStatus.PROCESSING) return { ...f, status: FileStatus.IDLE, errorMessage: "Bị treo (Hệ thống tự động reset)" };
            return f;
        }));
        commitFileTransactions(fileTransactionsRef.current, targetIds, myRunId);
        isRepairRunningRef.current = false;

        // Chỉ chạy lượt hai khi state/ref đã nhận kết quả lượt trước và thực sự vẫn còn raw.
        // Không hạ isProcessing giữa hai lượt để Automation không hiểu nhầm Smart Fix đã xong
        // rồi nhảy sang bước Chuẩn hoá tiêu đề quá sớm.
        if (maxPasses > 1) {
            await new Promise(resolve => setTimeout(resolve, 0));
            const remainingTargets = filesRef.current.filter((f: FileItem) =>
                f.status === FileStatus.COMPLETED
                && f.remainingRawCharCount > 0
                && f.usedModel !== 'Thủ công'
            );
            if (remainingTargets.length > 0) {
                ui.addLog(`🔁 Vẫn còn ${remainingTargets.length} tệp sót raw sau lượt đầu; tự động thử lượt 2/${maxPasses}.`, 'info');
                return handleFixRemainingRaw(isSmartFixMode, overrideEnabledModels, maxPasses - 1, forcedModels);
            }
        }

        setIsProcessing(false);
        setIsSmartAutoMode(false);
        setAutoFixEnabled(false);
        setEndTime(Date.now());
        isFixPhaseRef.current = false;
        ui.addToast("Hoàn tất quy trình Auto-fix sót raw CJK & Định dạng lại!", 'success');
        
        core.saveSession(true);
    };

    const handleSmartFix = (): boolean => {
    // FIX59 (Lite): Smart Fix cũng cần Gemini — chặn trước nếu chưa có key cá nhân
    if (IS_LITE && !ensureGeminiKeyForLite()) {
        ui.addToast('Bản Lite yêu cầu API Key Gemini cá nhân — đã mở Cài đặt để nhập key.', 'error');
        return false;
    }
        // BUGFIX (bước C): nếu đang có 1 phiên repair thật sự chạy dưới nền, tuyệt đối không cho
        // khởi động phiên mới/tăng runId — chỉ báo cho biết và bỏ qua lần gọi này.
        if (isRepairRunningRef.current) {
            ui.addLog('⏳ Đang có phiên sửa lỗi chạy dở, bỏ qua yêu cầu Smart Fix trùng lặp.', 'info');
            return false;
        }
        // KHÔNG tăng runIdRef ngay ở đây nữa. Trước đây hàm này tăng runId ngay dòng đầu,
        // trước cả khi biết có file lỗi cần sửa hay không -> chỉ cần handleSmartFix() bị gọi lại lần
        // 2 (dù "rỗng", tự return false ngay sau) trong lúc 1 phiên Sửa Lỗi Pro khác đang chạy dở, nó
        // cũng đủ làm đổi runId -> phiên đang chạy tưởng "bị người dùng hủy" (xem repair.ts: so sánh
        // shouldAbort dựa trên runId). Giờ chỉ tăng runId ở đúng 2 nhánh THỰC SỰ khởi động việc mới,
        // phía cuối hàm.
        const hasSelection = ui.selectedFiles && ui.selectedFiles.size > 0;
        
        const latestFiles: FileItem[] = filesRef.current || core.files;
        const excludedByTriage = latestFiles.filter((f: FileItem) => shouldExcludeFromSmartFix(f));
        const targetFiles = latestFiles.filter((f: FileItem) => {
            if (hasSelection && !ui.selectedFiles.has(f.id)) return false;
            if (shouldExcludeFromSmartFix(f)) return false;
            
            const isSpecialError = isSafetyOrSuspiciousError(f);

            if (!hasSelection && f.usedModel === 'Thủ công' && !isSpecialError) return false;
            
            return true;
        });
        if (excludedByTriage.length > 0) {
            const lockedCount = excludedByTriage.filter((f: FileItem) => f.isRescueLocked).length;
            const pendingCount = excludedByTriage.length - lockedCount;
            ui.addLog(`🧭 Smart Fix giữ nguyên ${excludedByTriage.length} tệp ngoài hàng sửa (${lockedCount} tệp đã xác nhận chờ cứu hộ, ${pendingCount} tệp hậu kiểm chưa kết luận) — không xoá bản dịch/không gọi lại nhầm model.`, 'info');
        }

        // FIX48-b: BỎ hẳn diện raw "nặng" từng bị dịch lại toàn bộ bằng model Pro. Người dùng
        // báo cáo & đã xác minh qua log thật: 1 lượt Auto-Fix In-stream (vá dòng, model rẻ) vừa
        // chạy xong xuôi, thì ~1 phút sau bước "Smart Fix (Pro Mode)" của Automation lại tự động
        // gom đúng số file đó đi XOÁ SẠCH bản dịch và dịch lại từ đầu bằng model Pro - chỉ vì
        // remainingRawCharCount (đo SAU khi đã vá dòng) vẫn còn > 100 ký tự/>15%. Đối chiếu file
        // đã dịch lại xong trong phiên đó: gần như toàn bộ chỉ còn 0-1 ký tự raw - tức mức sạch mà
        // 1 lượt vá dòng rẻ tiền khác cũng đạt được, không cần tốn cả 1 lượt dịch lại toàn bộ đắt
        // đỏ. Từ bản này: KHÔNG còn phân biệt raw nặng/nhẹ theo số ký tự - dù sót bao nhiêu, mọi
        // file COMPLETED còn sót raw (trừ file gốc cứu hộ DeepSeek, xử lý riêng ở
        // `rescueOriginRawFiles` bên dưới) chỉ CHỈ được vá theo dòng qua handleFixRemainingRaw(),
        // lặp lại ở các lượt Smart Fix/Automation kế tiếp nếu vẫn còn sót, KHÔNG BAO GIỜ bị xoá
        // bản dịch để dịch lại từ đầu chỉ vì lý do còn sót raw.
        const rawFiles = targetFiles.filter((f: FileItem) => {
            if (f.status !== FileStatus.COMPLETED || !f.translatedContent) return false;
            // File gốc cứu hộ DeepSeek: xử lý riêng ở rescueOriginRawFiles bên dưới (ép dùng
            // lại đúng model cứu hộ khi vá dòng), không gom vào đây.
            if (f.usedModel && f.usedModel.startsWith('deepseek:')) return false;
            if (f.remainingRawCharCount <= 0) return false;
            // FIX49-a: đã vá đủ số lượt cho phép ở phiên Smart Fix (Pro Mode) mà vẫn còn sót ->
            // bỏ cuộc êm, không gom vào đây nữa (tránh vòng lặp vô hạn vì vài ký tự đặc biệt AI
            // xác định đúng là không cần sửa).
            return (f.rawFixAttemptCount || 0) < MAX_SMART_FIX_RAW_ATTEMPTS;
        });
        
        const suspiciousFiles = targetFiles.filter((f: FileItem) => {
            if (f.status !== FileStatus.COMPLETED || !f.translatedContent) return false;
            if (f.translatedContent.trim() === f.content.trim()) return true;

            if (f.integrityOverrideAccepted) return false;

            const integrity = validateTranslationIntegrity(
                f.content,
                f.translatedContent,
                core.stateRef.current.ratioLimits,
                core.stateRef.current.storyInfo.languages
            );

            return !integrity.isValid;
        });

        const stuckFiles = targetFiles.filter((f: FileItem) => f.status === FileStatus.PROCESSING || f.status === FileStatus.REPAIRING);
        // DO NOT AUTOMATICALLY RE-QUEUE errorFiles infinitely. Only requeue if they haven't been heavily retried inside smart auto logic
        // Bắt buộc lấy file "Nghi vấn" dù đã thử quá giới hạn
        const errorFiles = targetFiles.filter((f: FileItem) => {
            const isSpecialError = isSafetyOrSuspiciousError(f);
            if (f.status === FileStatus.ERROR && (f.retryCount || 0) < 4) return true;
            if (f.status === FileStatus.IDLE && isSpecialError && (f.retryCount || 0) < 4) return true;
            return false;
        });
        const giveUpErrorFiles = targetFiles.filter((f: FileItem) => f.status === FileStatus.ERROR && (f.retryCount || 0) >= 4 && !f.errorMessage?.includes("Nên dùng cứu hộ"));

        // FIX22: file COMPLETED gốc cứu hộ DeepSeek còn sót raw (BẤT KỂ nhiều/ít) - đưa vào chung
        // diện kích hoạt handleFixRemainingRaw() (nhánh else-if bên dưới) thay vì bị dịch lại toàn
        // bộ. handleFixRemainingRaw() đã có sẵn logic ép dùng lại đúng model cứu hộ (DeepSeek) khi
        // sửa dòng.
        const rescueOriginRawFiles = targetFiles.filter((f: FileItem) => {
            if (f.status !== FileStatus.COMPLETED || !f.translatedContent) return false;
            if (!f.usedModel || !f.usedModel.startsWith('deepseek:')) return false;
            if (f.remainingRawCharCount <= 0) return false;
            // FIX49-a: cùng giới hạn số lượt vá như rawFiles ở trên.
            return (f.rawFixAttemptCount || 0) < MAX_SMART_FIX_RAW_ATTEMPTS;
        });

        const mergedWarningFiles = targetFiles.filter((f: FileItem) => 
            f.status === FileStatus.COMPLETED && f.translatedContent && (
                f.translatedContent.includes(BATCH_MISSING_TAG_WARNING) ||
                (f.content.split('\n').length > 5 && f.translatedContent.split('\n').length <= 2 && f.translatedContent.length > 300)
            )
        );

        if (rawFiles.length === 0 && suspiciousFiles.length === 0 && stuckFiles.length === 0 && errorFiles.length === 0 && mergedWarningFiles.length === 0 && rescueOriginRawFiles.length === 0) {
            ui.addToast("Không tìm thấy file lỗi cần sửa/File lỗi đã quá số lần thử lại.", "info");
            return false;
        }

        const queueIds: string[] = [];
        
        // Try to format merged files locally first
        const unformattableMergedFiles: FileItem[] = [];
        let formattedCount = 0;
        
        if (mergedWarningFiles.length > 0) {
            core.setFiles((prev: FileItem[]) => {
                const newFiles = [...prev];
                for (const f of mergedWarningFiles) {
                    const formatted = attemptFormatMergedParagraphs(f.content, f.translatedContent!);
                    if (formatted) {
                        const fIndex = newFiles.findIndex(nf => nf.id === f.id);
                        if (fIndex !== -1) {
                            newFiles[fIndex] = { ...newFiles[fIndex], translatedContent: formatted, status: FileStatus.COMPLETED };
                            formattedCount++;
                        }
                    } else {
                        unformattableMergedFiles.push(f);
                    }
                }
                return newFiles;
            });
        }
        
        if (formattedCount > 0) {
            ui.addToast(`Đã tự động định dạng lại ${formattedCount} file bị gộp chương.`, "success");
            ui.addLog(`✨ Smart Fix: Tự động tách đoạn thành công ${formattedCount} file bị gộp.`, "success");
        }

        // Only queue targets that haven't been retried infinitely in SmartFix loops
        const validRetranslateTargets = [...suspiciousFiles, ...unformattableMergedFiles].filter(f => (f.retryCount || 0) < 4);
        const giveUpRetranslateTargets = [...suspiciousFiles, ...unformattableMergedFiles].filter(f => (f.retryCount || 0) >= 4 && !f.errorMessage?.includes("Nên dùng cứu hộ"));

        const uniqueRetranslateIds = new Set(validRetranslateTargets.map(f => f.id));
        if (uniqueRetranslateIds.size > 0) queueIds.push(...Array.from(uniqueRetranslateIds));

        const resetTargets = [...stuckFiles, ...errorFiles];
        const uniqueResetIds = new Set(resetTargets.map(f => f.id));
        if (uniqueResetIds.size > 0) queueIds.push(...Array.from(uniqueResetIds));

        const nextSmartFixRunId = runIdRef.current + 1;
        if (uniqueRetranslateIds.size > 0 || uniqueResetIds.size > 0) {
            const transactionIds = new Set([...uniqueRetranslateIds, ...uniqueResetIds]);
            let preparedFiles: FileItem[] | undefined;
            core.setFiles((prev: FileItem[]) => {
                const stableFiles = rollbackAndCloseAllFileTransactions(prev, fileTransactionsRef.current);
                beginFileTransactions(fileTransactionsRef.current, stableFiles.filter((f: FileItem) => transactionIds.has(f.id)), nextSmartFixRunId, 'postprocess');
                preparedFiles = stableFiles.map((f: FileItem) => {
                    if (uniqueRetranslateIds.has(f.id)) return { ...f, status: FileStatus.IDLE, translatedContent: null, hasStaleTranslation: false, remainingRawCharCount: 0, retryCount: (f.retryCount || 0) + 1, usedModel: undefined, errorMessage: "Smart Fix: Auto Re-queue (Raw/Ratio/Merged)", integrityOverrideAccepted: false };
                    if (uniqueResetIds.has(f.id)) {
                    const isSpecialError = isSafetyOrSuspiciousError(f);
                    return { ...f, status: FileStatus.IDLE, usedModel: undefined, retryCount: (f.retryCount || 0) + 1, errorMessage: isSpecialError ? f.errorMessage : undefined, translatedContent: null, hasStaleTranslation: false, remainingRawCharCount: 0, integrityOverrideAccepted: false };
                    }
                    return f;
                });
                return preparedFiles;
            });
            if (filesRef && preparedFiles) filesRef.current = preparedFiles;
        }

        const allGiveUpFiles = [...giveUpErrorFiles, ...giveUpRetranslateTargets];
        if (allGiveUpFiles.length > 0) {
            const giveUpIds = new Set(allGiveUpFiles.map(f => f.id));
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => giveUpIds.has(f.id) ? { ...f, status: FileStatus.ERROR, errorMessage: (f.errorMessage || 'Lỗi ratio/gộp đoạn') + " - Nên dùng cứu hộ hoặc dịch thủ công" } : f));
        }

        if (queueIds.length > 0) {
            runIdRef.current = nextSmartFixRunId; // Chỉ tăng khi thực sự bắt đầu 1 phiên sửa lỗi mới
            ui.addToast(`Tiến trình Smart Fix (Pro Mode): Bắt đầu xử lý ${queueIds.length} file lỗi/nghi vấn...`, 'warning');
            ui.addLog(`🔍 Tiến trình Smart Fix (Pro Mode): Đã gom và nối tiếp ${queueIds.length} file bị lỗi/nghi vấn vào hàng đợi.`, 'info');
            const uniqueQueue = Array.from(new Set(queueIds));
            scheduledBatchesRef.current.clear();
            setProcessingQueue(uniqueQueue);
            setStartTime(Date.now());
            setEndTime(null);
            setIsProcessing(true);
            setIsSmartAutoMode(true);
            setAutoFixEnabled(true);
            isFixPhaseRef.current = true;
            return true;
        } else if (rawFiles.length > 0 || rescueOriginRawFiles.length > 0) {
            runIdRef.current += 1; // Chỉ tăng khi thực sự bắt đầu 1 phiên sửa lỗi mới
            setIsSmartAutoMode(true);
            setAutoFixEnabled(true);
            isFixPhaseRef.current = true;
            if (rescueOriginRawFiles.length > 0) {
                ui.addLog(`🛟 Smart Fix: Phát hiện ${rescueOriginRawFiles.length} file gốc cứu hộ DeepSeek còn sót raw - sửa dòng sót bằng đúng model cứu hộ (không dịch lại toàn bộ).`, 'info');
            }
            handleFixRemainingRaw(true, undefined, 2);
            return true;
        } else if (formattedCount > 0) {
            core.saveSession(true);
            return false;
        }
        return false;
    };

    return { handleFixRemainingRaw, handleSmartFix };
};
