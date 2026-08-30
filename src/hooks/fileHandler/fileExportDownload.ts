// Nhóm hàm: XUẤT/TẢI file (merge, zip raw/dịch, epub, docx).
import { StoryInfo, FileItem, EpubDesignOptions, EpubDesignAssets } from '../../types';
import { createMergedFile, downloadTextFile, generateExportFileName, downloadRawAsZip, downloadTranslatedAsZip, downloadEpubFile, generateEpub, downloadDocxFile } from '../../utils/fileHelpers';
import type { CoreApi, UIApi } from '../apiTypes';

export const useFileExportDownload = (core: CoreApi, ui: UIApi) => {
    const handleDownloadMerged = () => {
        ui.setActionProgress({ current: 0, total: 100, message: "Đang gộp và định dạng nội dung (Local AI)..." });
        setTimeout(() => {
            const content = createMergedFile(core.files, core.storyInfo.enableTitleFormatting !== false, core.storyInfo.enableAutoFormat !== false);
            if(!content) { ui.addToast("Chưa có nội dung", 'error'); ui.setActionProgress(null); return; }
            const fileName = generateExportFileName(core.storyInfo.title, core.storyInfo.author, '.txt');
            downloadTextFile(fileName, content);
            ui.addToast("Đã tải xuống file Gộp (Đã lọc rác & định dạng)", 'success');
            ui.setActionProgress(null);
        }, 100);
    };


    const handleDownloadRaw = async (splitCount: number = 1) => {
        if (core.files.length === 0) { ui.addToast("Không có file nào", 'error'); return; }
        try {
            ui.setActionProgress({ current: 0, total: 100, message: "Đang chuẩn bị ZIP Raw (Auto Clean)..." });
            const fileName = generateExportFileName(core.storyInfo.title, core.storyInfo.author, '_Raw.zip');
            await downloadRawAsZip(core.files, fileName, splitCount, (percent, msg) => { ui.setActionProgress({ current: percent, total: 100, message: msg }); }, core.storyInfo.enableTitleFormatting !== false, core.storyInfo.enableAutoFormat !== false);
            ui.addToast("Đã tải xuống file ZIP raw (Đã lọc rác)", 'success');
        } catch (e: any) { ui.addToast(`Lỗi tạo ZIP: ${e.message}`, 'error'); } finally { ui.setActionProgress(null); }
    };


    const handleDownloadTranslatedZip = async () => {
        if (core.files.length === 0) { ui.addToast("Không có file nào", 'error'); return; }
        try {
            ui.setActionProgress({ current: 0, total: 100, message: "Đang chuẩn bị ZIP Dịch (Auto Clean)..." });
            const fileName = generateExportFileName(core.storyInfo.title, core.storyInfo.author, '_Dich.zip');
            await downloadTranslatedAsZip(core.files, fileName, (percent, msg) => { ui.setActionProgress({ current: percent, total: 100, message: msg }); }, core.storyInfo.enableTitleFormatting !== false, core.storyInfo.enableAutoFormat !== false);
            ui.addToast("Đã tải xuống file ZIP các chương dịch (Đã lọc rác & định dạng)", 'success');
        } catch (e: any) { ui.addToast(`Lỗi: ${e.message}`, 'error'); } finally { ui.setActionProgress(null); }
    };


    const performEpubGeneration = async (updatedInfo: StoryInfo, updatedCover: File | null, customFont: File | null = null, designOptions?: EpubDesignOptions, designAssets?: EpubDesignAssets) => {
        ui.setShowEpubModal(false);
        const readyFiles = core.stateRef.current.files.filter((f: FileItem) => !!f.translatedContent);
        if (readyFiles.length === 0) return;
        ui.setActionProgress({ current: 0, total: 100, message: "Đang tạo Ebook chuẩn (Batch Processing)..." });
        try {
            core.setStoryInfo(updatedInfo);
            if (updatedCover !== core.coverImage) core.setCoverImage(updatedCover);
            const blob = await generateEpub(
                readyFiles, updatedInfo, updatedCover, updatedInfo.summary || "", 
                (percent) => ui.setActionProgress({ current: percent, total: 100, message: `Đang đóng gói EPUB ${percent}%` }),
                customFont, designOptions, designAssets
            );
            const fileName = generateExportFileName(updatedInfo.title, updatedInfo.author, '.epub');
            downloadEpubFile(fileName, blob);
            ui.addToast("Đã xuất bản EPUB thành công!", "success");
        } catch (e: any) { ui.addToast(`Lỗi tạo EPUB: ${e.message}`, "error"); } finally { ui.setActionProgress(null); }
    };


    const handleExportDocx = async () => {
        const readyFiles = core.files.filter(f => !!f.translatedContent);
        if (readyFiles.length === 0) {
            ui.addToast("Không có chương nào đã dịch để xuất DOCX", "warning");
            return;
        }
        ui.setActionProgress({ current: 0, total: 100, message: "Đang tạo file DOCX..." });
        try {
            const fileName = generateExportFileName(core.storyInfo.title, core.storyInfo.author, '.docx');
            await downloadDocxFile(fileName, readyFiles, core.storyInfo, (percent) => {
                ui.setActionProgress({ current: percent, total: 100, message: `Đang tạo DOCX ${percent}%` });
            });
            ui.addToast("Đã xuất bản DOCX thành công!", "success");
        } catch (e: any) {
            ui.addToast(`Lỗi tạo DOCX: ${e.message}`, "error");
        } finally {
            ui.setActionProgress(null);
        }
    };


    return { handleDownloadMerged, handleDownloadRaw, handleDownloadTranslatedZip, performEpubGeneration, handleExportDocx };
};
