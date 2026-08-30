// Sửa lỗi thủ công cho 1 file đơn lẻ (bấm nút sửa trên từng dòng file trong danh sách).
import { FileItem, FileStatus } from '../../types';
import { repairTranslations } from '../../services/workflows/translate/repair';
import { findLinesWithForeignChars, mergeFixedLines, formatBookStyle, countForeignChars, cleanupAiTextArtifacts } from '../../utils/text';
import type { CoreApi, UIApi } from '../apiTypes';

export const useManualFix = (core: CoreApi, ui: UIApi, sharedState: any) => {
    const { effectiveDictionary, translationTier } = sharedState;

    // FIX48-b: trước đây file sót > 100 ký tự CJK (hoặc tỉ lệ > 15%) bị XOÁ bản dịch và dịch lại
    // toàn bộ khi bấm nút búa. Giờ đồng bộ với Smart Fix: dù sót nhiều hay ít cũng CHỈ vá theo
    // dòng, không bao giờ dịch lại từ đầu chỉ vì lý do còn sót raw.
    const handleManualFixSingle = async (e: React.MouseEvent, fileId: string) => {
        e.stopPropagation();
        const file = core.files.find((f: FileItem) => f.id === fileId);
        if (!file) return;
        if (file.status === FileStatus.REPAIRING || file.status === FileStatus.PROCESSING) return;

        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === fileId ? { ...f, status: FileStatus.REPAIRING } : f));
        ui.addToast("Đang sửa lỗi nhỏ bằng Model Pro (Assistant Mode)...", "info");
        try {
            if (file.translatedContent) {
                const badLines = findLinesWithForeignChars(file.translatedContent);
                if (badLines.length > 0) {
                    const fixes = await repairTranslations(badLines, effectiveDictionary, translationTier, core.storyInfo.contextNotes, core.storyInfo, core.promptTemplate, (msg) => ui.addLog(msg, 'info'), core.enabledModels);
                    if (fixes.length > 0) {
                        const fixedContent = mergeFixedLines(file.translatedContent, fixes);
                        const cleanContent = cleanupAiTextArtifacts(formatBookStyle(fixedContent, file.content, core.storyInfo?.enableTitleFormatting !== false, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false));
                        const remainingRaw = countForeignChars(cleanContent);
                        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === file.id ? { ...f, status: FileStatus.COMPLETED, translatedContent: cleanContent, remainingRawCharCount: remainingRaw, isRescueLocked: false } : f));
                        ui.addToast("Đã sửa xong!", "success");
                    } else {
                        ui.addToast("Không thể sửa tự động.", "error");
                        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === file.id ? { ...f, status: FileStatus.COMPLETED, isRescueLocked: false } : f));
                    }
                } else {
                    core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === file.id ? { ...f, status: FileStatus.COMPLETED, remainingRawCharCount: 0, isRescueLocked: false } : f));
                    ui.addToast("File đã sạch, không cần sửa.", "success");
                }
            }
        } catch (err: any) {
            ui.addToast(`Lỗi sửa: ${err.message}`, "error");
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === file.id ? { ...f, status: FileStatus.COMPLETED, isRescueLocked: false } : f));
        }
    };

    return { handleManualFixSingle };
};
