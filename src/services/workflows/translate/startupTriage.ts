// "Hậu kiểm khởi động" (Startup Rescue Triage) — chạy khi người dùng bấm Auto hoặc bắt đầu
// dịch ở phiên làm việc mới (executeProcessing). Giải quyết ca: file thực ra đã dịch xong
// (nội dung + tỷ lệ hợp lệ đúng ngôn ngữ) nhưng bị đánh dấu ERROR oan vì model hậu kiểm
// (Tier 2) bị cắt ngang, không trả kết quả, hoặc lỗi gọi API thoáng qua.
//
// Luồng xử lý:
// 1. identifyRecoveryCandidates: lọc file ERROR/IDLE có translatedContent + tỷ lệ hợp lệ theo
//    đúng ngôn ngữ truyện (validateTranslationIntegrity), CHƯA bị khoá cứu hộ từ trước.
// 2. runRecoveryVerification: hậu kiểm lại các ứng viên trên bằng AI (dùng lại validateBatchWithAI
//    có sẵn), chia theo lô tối đa 6 tệp/lô, nghỉ vài giây giữa các lô để tránh lỗi dồn dập.
//    Lô nào bị lỗi gọi API (không phải bị hậu kiểm từ chối) sẽ tự coi các file trong lô đó là
//    "chưa xác định" và đưa thẳng vào diện cứu hộ (an toàn, fail-closed) thay vì mất trắng.
// 3. File hậu kiểm lại PASS -> phục hồi COMPLETED, giữ nguyên bản dịch, không dịch lại.
//    File hậu kiểm lại FAIL (hoặc lỗi gọi API), cộng với các file lỗi thật từ trước (không có
//    bản dịch hợp lệ để hậu kiểm) -> gộp thành "diện cứu hộ", đánh dấu isRescueLocked=true.
//    Cờ này KHÔNG bị executeProcessing() reset ở bất kỳ phiên làm việc nào (cũ lẫn mới) - chỉ
//    được xử lý lại khi có model cứu hộ (DeepSeek) khả dụng.
import { FileItem, FileStatus, RatioLimits, StoryInfo } from '../../../types';
import { validateTranslationIntegrity } from '../../../utils/text/validation';
import { validateBatchWithAI } from './aiValidation';

const RECOVERY_BATCH_SIZE = 6;
const RECOVERY_BATCH_DELAY_MS = 3000; // "vài giây" nghỉ giữa các lô hậu kiểm
const DIAGNOSIS_BATCH_DELAY_MS = 2000;
const DEFAULT_DIAGNOSIS_BATCH_SIZE = 10; // fallback nếu chưa đọc được config Pro (limits.v31)

export const chunkArray = <T,>(arr: T[], size: number): T[][] => {
    if (size <= 0) return [arr];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

/**
 * Lọc ra các file ERROR/IDLE có sẵn bản dịch với tỷ lệ hợp lệ đúng ngôn ngữ - ứng viên nghi
 * ngờ bị đánh oan, cần hậu kiểm lại trước khi coi là lỗi thật. Bỏ qua file đã bị khoá cứu hộ
 * từ trước (giữ nguyên trạng thái, không đụng lại mỗi phiên).
 */
export const identifyRecoveryCandidates = (
    files: FileItem[],
    ratioLimits?: RatioLimits,
    storyInfo?: StoryInfo
): FileItem[] => {
    return files.filter(f => {
        // FIX (báo cáo "vẫn nhầm lẫn ở khâu lọc/xử lý cứu hộ" - 24 tệp cứu hộ nhưng "Hậu Kiểm Lại
        // Ngay" báo không có gì để kiểm): TRƯỚC ĐÂY file đã bị `isRescueLocked=true` bị loại trừ
        // VĨNH VIỄN khỏi MỌI lượt hậu kiểm sau này (cả tự động lẫn nút thủ công) - một khi bị khoá,
        // không có cách nào để hệ thống tự "gỡ oan" nữa dù bản dịch cũ có thể vẫn đúng (đúng như
        // người dùng quan sát: nhiều tệp trong 24 tệp đó thực ra dịch lại vẫn ổn). Bỏ điều kiện loại
        // trừ này - để MỖI PHIÊN LÀM VIỆC MỚI (Auto/Bắt Đầu Dịch) hoặc mỗi lần bấm "Hậu Kiểm Lại
        // Ngay" đều cho các tệp đang khoá cứu hộ 1 cơ hội hậu kiểm lại, đúng như thiết kế được yêu
        // cầu: chỉ kiểm tra lại ở thời điểm bắt đầu phiên mới (không kiểm tra liên tục giữa chừng,
        // vì runStartupTriage() chỉ được gọi 1 lần mỗi khi bấm Auto/Bắt Đầu/"Hậu Kiểm Lại Ngay").
        if (f.status !== FileStatus.ERROR && f.status !== FileStatus.IDLE) return false;
        if (!f.translatedContent || !f.translatedContent.trim()) return false;
        const integrity = validateTranslationIntegrity(f.content, f.translatedContent, ratioLimits, storyInfo?.languages, f.usedModel);
        return integrity.isValid;
    });
};

/**
 * Lọc ra các file ERROR có bản dịch nhưng tỷ lệ (ratio) bị đánh giá KHÔNG hợp lệ - diện "biên
 * giới" (borderline), không chắc chắn là lỗi thật hay chỉ lệch tỷ lệ nhẹ do thể loại/văn phong.
 * Được cho thêm 1 lượt xác định cuối bằng AI (theo batch Pro) trước khi khoá cứu hộ hẳn.
 */
export const identifyBorderlineFiles = (
    files: FileItem[],
    ratioLimits?: RatioLimits,
    storyInfo?: StoryInfo
): FileItem[] => {
    return files.filter(f => {
        // FIX: xem giải thích đầy đủ ở identifyRecoveryCandidates() bên trên - cùng lý do, bỏ loại
        // trừ isRescueLocked để tệp đang khoá cứu hộ cũng được xét lại ở diện "biên giới" nếu bản
        // dịch cũ (nếu có) chưa đạt tỷ lệ hợp lệ.
        if (f.status !== FileStatus.ERROR) return false;
        if (!f.translatedContent || !f.translatedContent.trim()) return false;
        const integrity = validateTranslationIntegrity(f.content, f.translatedContent, ratioLimits, storyInfo?.languages, f.usedModel);
        return !integrity.isValid;
    });
};

export interface TriageResult {
    recoveredIds: Set<string>;
    // File thực sự bị AI đối chiếu nội dung và TỪ CHỐI rõ ràng (isValid=false, không phải do
    // thiếu kết quả) - đây mới là "lỗi thật đã xác nhận", đúng như thông báo hiển thị cho người
    // dùng.
    confirmedErrorIds: Set<string>;
    // FIX (nhầm lẫn "chưa xác định" thành "lỗi thật"): file KHÔNG hề nhận được kết luận rõ ràng
    // từ hậu kiểm - gọi API lỗi/mạng, JSON hỏng, hết candidate model, hoặc không có entry nào trả
    // về (xem `unresolved` trong aiValidation.ts) - hoàn toàn khác với file bị AI thực sự từ chối.
    // Trước đây các file này bị gộp chung vào `confirmedErrorIds` rồi hiển thị thông báo "hậu
    // kiểm khởi động xác nhận lỗi thật" dù chưa hề có xác nhận nào - gây hiểu lầm cho người dùng
    // khi tự kiểm tra lại thấy nội dung dịch vẫn đủ/đúng. Giữ riêng ra để tầng gọi (useTranslator.ts)
    // xử lý/thông báo đúng bản chất, KHÔNG khoá cứng "chỉ dịch lại qua DeepSeek".
    apiFailureIds: Set<string>;
}

/**
 * Hậu kiểm lại (Tier 2) các ứng viên nghi bị đánh oan, theo lô tối đa 6 tệp, nghỉ vài giây
 * giữa các lô. Trả về tập id đã phục hồi (PASS) và tập id vẫn bị từ chối/lỗi (giữ diện nghi
 * vấn để gộp vào bước xác định lỗi thật ở tầng gọi).
 */
export const runRecoveryVerification = async (
    candidates: FileItem[],
    enabledModels: string[],
    onLog?: (msg: string) => void,
    deepseekKey?: string,
    // Đề xuất cải thiện tồn đọng: cho tinh chỉnh khoảng nghỉ qua Cài Đặt thay vì cố định cứng
    // (mặc định y hệt hằng số cũ nếu không truyền, không đổi hành vi cho caller chưa cập nhật).
    delays?: { recoveryBatchDelayMs?: number; staggerDelayMs?: number }
): Promise<TriageResult> => {
    const recoveredIds = new Set<string>();
    const confirmedErrorIds = new Set<string>();
    const apiFailureIds = new Set<string>();
    if (candidates.length === 0) return { recoveredIds, confirmedErrorIds, apiFailureIds };

    const batches = chunkArray(candidates, RECOVERY_BATCH_SIZE);
    if (onLog) onLog(`🔎 Hậu kiểm khởi động: ${candidates.length} tệp nghi bị đánh oan, chia ${batches.length} lô (tối đa ${RECOVERY_BATCH_SIZE} tệp/lô)...`);

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const resultsMap = new Map<string, string>();
        batch.forEach(f => resultsMap.set(f.id, f.translatedContent as string));

        try {
            const report = await validateBatchWithAI(
                batch.map(f => ({ id: f.id, content: f.content, name: f.name })),
                resultsMap,
                enabledModels,
                onLog,
                undefined,
                deepseekKey,
                delays?.staggerDelayMs
            );
            batch.forEach(f => {
                const res = report.get(f.id);
                if (res && res.isValid === true) recoveredIds.add(f.id);
                // FIX (nhầm "chưa xác định" thành "lỗi thật"): không có entry (Tier 2 tắt hết
                // model) hoặc entry được TỰ ĐIỀN BÙ do không hậu kiểm được (res.unresolved, xem
                // aiValidation.ts) -> đây KHÔNG phải AI đã xác nhận lỗi, chỉ là chưa xác định được
                // (fail-closed, an toàn). Chỉ res.isValid===false RÕ RÀNG (AI thực sự đối chiếu và
                // từ chối) mới được coi là lỗi thật.
                else if (!res || res.unresolved) apiFailureIds.add(f.id);
                else confirmedErrorIds.add(f.id);
            });
        } catch (e) {
            // Cả lô lỗi gọi API (mạng/timeout) - không phải bị hậu kiểm từ chối. Fail-closed:
            // đưa cả lô vào diện nghi vấn (chưa xác định) thay vì phục hồi liều lĩnh HOẶC gán oan
            // thành "lỗi thật".
            if (onLog) onLog(`⚠️ Hậu kiểm khởi động lô ${i + 1}/${batches.length} lỗi gọi API, giữ nguyên diện nghi vấn: ${(e as any)?.message || e}`);
            batch.forEach(f => apiFailureIds.add(f.id));
        }

        if (i < batches.length - 1) {
            // FIX (dead param): delays.recoveryBatchDelayMs là cài đặt người dùng thật (tab Cài
            // Đặt Hậu Kiểm Khởi Động) nhưng hàm này từng bỏ qua, luôn dùng hằng số cứng — lệch
            // với runDiagnosisPass bên dưới (đọc đúng delays.diagnosisBatchDelayMs).
            await new Promise(res => setTimeout(res, delays?.recoveryBatchDelayMs ?? RECOVERY_BATCH_DELAY_MS));
        }
    }

    if (onLog) onLog(`✅ Hậu kiểm khởi động hoàn tất: phục hồi ${recoveredIds.size} tệp, ${confirmedErrorIds.size} tệp xác nhận lỗi thật, ${apiFailureIds.size} tệp chưa xác định được (sẽ kiểm tra lại).`);
    return { recoveredIds, confirmedErrorIds, apiFailureIds };
};

/**
 * Lượt xác định cuối — nhận 1 danh sách file ĐÃ GỘP (diện "biên giới" + file bị lượt hậu kiểm
 * khởi động đầu tiên từ chối), cùng chạy 1 lượt kiểm tra lỗi bộ lọc nội dung cuối cùng bằng model
 * kiểm tra (validateBatchWithAI) trước khi khoá cứu hộ hẳn. Chia theo batch tối đa bằng config
 * Pro hiện tại (mặc định 12, đọc từ batchLimits.complex.v31/batchLimits.latin.v31 tuỳ ngôn ngữ).
 * KHÔNG nhận trước danh sách "đã coi là lỗi" — mọi file truyền vào đều được validate lại từ đầu,
 * để file bị lượt trước từ chối oan (lỗi gọi API thoáng qua, lô hậu kiểm dồn tải...) vẫn có cơ
 * hội được "gỡ oan" ở lượt kiểm tra cuối này thay vì bị khoá cứu hộ chỉ dựa trên 1 lượt duy nhất.
 */
export const runDiagnosisPass = async (
    filesToCheck: FileItem[],
    proBatchSize: number | undefined,
    enabledModels: string[],
    onLog?: (msg: string) => void,
    deepseekKey?: string,
    delays?: { diagnosisBatchDelayMs?: number; staggerDelayMs?: number }
): Promise<TriageResult> => {
    const recoveredIds = new Set<string>();
    const confirmedErrorIds = new Set<string>();
    const apiFailureIds = new Set<string>();
    if (filesToCheck.length === 0) return { recoveredIds, confirmedErrorIds, apiFailureIds };

    const batchSize = proBatchSize && proBatchSize > 0 ? proBatchSize : DEFAULT_DIAGNOSIS_BATCH_SIZE;
    const batches = chunkArray(filesToCheck, batchSize);
    if (onLog) onLog(`🩺 Xác định lỗi (biên giới + nghi vấn từ lượt hậu kiểm trước): ${filesToCheck.length} tệp, chia ${batches.length} lô (tối đa ${batchSize} tệp/lô theo config Pro hiện tại)...`);

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const resultsMap = new Map<string, string>();
        batch.forEach(f => resultsMap.set(f.id, f.translatedContent as string));
        try {
            const report = await validateBatchWithAI(
                batch.map(f => ({ id: f.id, content: f.content, name: f.name })),
                resultsMap,
                enabledModels,
                onLog,
                undefined,
                deepseekKey,
                delays?.staggerDelayMs
            );
            batch.forEach(f => {
                const res = report.get(f.id);
                if (res && res.isValid === true) recoveredIds.add(f.id);
                // FIX (giống runRecoveryVerification ở trên): entry thiếu/`unresolved` = chưa xác
                // định được, KHÔNG phải AI xác nhận lỗi thật. Đây là lượt kiểm tra CUỐI CÙNG trước
                // khi khoá cứu hộ nên càng phải phân biệt rõ, tránh khoá oan file chỉ vì lỗi mạng.
                else if (!res || res.unresolved) apiFailureIds.add(f.id);
                else confirmedErrorIds.add(f.id);
            });
        } catch (e) {
            if (onLog) onLog(`⚠️ Xác định lỗi lô ${i + 1}/${batches.length} lỗi gọi API, giữ diện chưa xác định (không khoá cứu hộ): ${(e as any)?.message || e}`);
            batch.forEach(f => apiFailureIds.add(f.id));
        }
        if (i < batches.length - 1) {
            await new Promise(res => setTimeout(res, delays?.diagnosisBatchDelayMs ?? DIAGNOSIS_BATCH_DELAY_MS));
        }
    }

    if (onLog) onLog(`✅ Xác định lỗi hoàn tất: phục hồi thêm ${recoveredIds.size} tệp, ${confirmedErrorIds.size} tệp xác nhận lỗi thật (khoá cứu hộ), ${apiFailureIds.size} tệp vẫn chưa xác định được.`);
    return { recoveredIds, confirmedErrorIds, apiFailureIds };
};
