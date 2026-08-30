// Nhóm hàm: TÁCH file (xác nhận tách chương thủ công, xử lý file zip lồng bên trong,
// tự động tách chương theo ngưỡng ký tự).
import { FileItem, FileStatus } from '../../types';
import { sortFiles } from '../../utils/fileHelpers';
import { fixMergedTitle, splitLargeChapter, countForeignChars } from '../../utils/text';
import type { CoreApi, UIApi } from '../apiTypes';

export const useFileSplitting = (core: CoreApi, ui: UIApi, onFilesAdded?: () => void) => {
    const handleSplitConfirm = (splitFiles: FileItem[]) => {
        const importedCover = ui.splitterModal.tempCover || null;
        ui.setSplitterModal({ isOpen: false, content: '', name: '' });
        if (splitFiles.length === 0) { ui.addToast("Không tách được chương nào", 'error'); return; }
        
        // Chỉ chạy fixMergedTitle chủ động sau khi đã tách chương.
        // FIX (fix56): trước đây `remainingRawCharCount` dùng thẳng `.length` (độ dài RAW toàn
        // bộ chuỗi) — với các phần tách ra từ luồng "Dán nội dung ĐÃ DỊCH" (isTranslatedImport,
        // xem SplitterModal.tsx), `f.content` ở bước này thực chất chính là bản dịch (translatedContent
        // = f.content), nên gán `.length` khiến badge "Sót Raw" hiển thị gần bằng NGUYÊN VĂN độ dài
        // bản dịch dù nó đã sạch hoàn toàn. Đổi sang countForeignChars cho đúng bản chất "số ký tự
        // CJK/Kana/Hangul/Cyrillic/Thái còn sót", nhất quán với mọi nơi khác trong app.
        const fixedSplitFiles = splitFiles.map(f => {
            const fixedContent = fixMergedTitle(f.content);
            return {
                ...f,
                content: fixedContent,
                originalCharCount: fixedContent.length,
                remainingRawCharCount: f.status === FileStatus.COMPLETED && f.translatedContent
                    ? countForeignChars(f.translatedContent)
                    : countForeignChars(fixedContent)
            };
        });

        if (core.files.length > 0) {
            ui.setImportModal({ isOpen: true, pendingFiles: fixedSplitFiles, tempInfo: null, tempCover: importedCover });
        } else {
            core.setFiles(fixedSplitFiles);
            core.setCoverImage(importedCover);
            ui.addToast(`Đã tách thành ${fixedSplitFiles.length} chương`, 'success');
            onFilesAdded?.();
        }
    };


    const handleZipKeepSeparate = () => {
        ui.setZipActionModal(false);
        const pending = ui.importModal.pendingFiles;
        const info = ui.importModal.tempInfo;
        const importedCover = ui.importModal.tempCover || null;
        if (pending.length === 0) return;
        if (core.files.length > 0) {
            ui.setImportModal({ isOpen: true, pendingFiles: pending, tempInfo: info, tempCover: importedCover });
        } else {
            core.setFiles(sortFiles(pending));
            core.setCoverImage(importedCover);
            if (info) core.setStoryInfo(info);
            ui.setFilterStatuses(new Set()); // Clear filters
            ui.setFilterModels(new Set()); // Clear filters
            ui.addToast(`Đã nhập ${pending.length} file (Giữ nguyên cấu trúc)`, 'success');
            ui.setImportModal({ isOpen: false, pendingFiles: [] });
            onFilesAdded?.();
        }
    };


    const handleZipMergeAndSplit = () => {
        ui.setZipActionModal(false);
        const pending = ui.importModal.pendingFiles;
        const info = ui.importModal.tempInfo;
        const importedCover = ui.importModal.tempCover || null;
        if (pending.length === 0) return;
        const sortedForMerge = sortFiles(pending);
        const hugeContent = sortedForMerge.map(f => f.content).join('\n\n');
        const mergedTitle = info ? info.title : sortedForMerge[0].name;
        const isTranslatedImport = pending.every(f => f.translatedContent !== null && f.status === FileStatus.COMPLETED);
        if (info) core.setStoryInfo(info);
        ui.setSplitterModal({ isOpen: true, content: hugeContent, name: mergedTitle, isTranslatedImport, tempCover: importedCover });
        ui.setImportModal({ isOpen: false, pendingFiles: [] });
    };


    const handleAutoSplitChapters = (scope: 'all' | 'selected' | 'single', targetFileId?: string, threshold: number = 8000, numParts?: number) => {
        let targets: FileItem[] = [];
        
        if (scope === 'single' && targetFileId) {
            const file = core.files.find((f: FileItem) => f.id === targetFileId);
            if (file) targets = [file];
        } else if (scope === 'selected') {
            targets = core.files.filter((f: FileItem) => ui.selectedFiles.has(f.id));
        } else {
            targets = [...core.files];
        }

        // Filter for files that are untranslated and length > threshold
        const filesToSplit = targets.filter(f => 
            (f.status === FileStatus.IDLE || f.status === FileStatus.ERROR) && 
            f.content && 
            f.content.length > threshold
        );

        if (filesToSplit.length === 0) {
            ui.addToast(`Không tìm thấy chương gốc nào > ${threshold} kí tự cần tách.`, "info");
            return;
        }

        const newFilesList: FileItem[] = [];
        let splitCount = 0;

        for (let i = 0; i < core.files.length; i++) {
            const currentFile = core.files[i];
            const isTarget = filesToSplit.find(ft => ft.id === currentFile.id);
            
            if (isTarget) {
                const splits = splitLargeChapter(currentFile, threshold, numParts);
                if (splits.length > 1) {
                    newFilesList.push(...splits);
                    splitCount++;
                } else {
                    newFilesList.push(currentFile);
                }
            } else {
                newFilesList.push(currentFile);
            }
        }

        if (splitCount > 0) {
            core.setFiles(newFilesList);
            ui.addToast(`Đã tách thành công ${splitCount} chương lớn.`, "success");
            ui.setSelectedFiles(new Set()); // clear selected
        } else {
            ui.addToast("Không có chương nào thoả mãn độ dài để tách.", "info");
        }
    };


    return { handleSplitConfirm, handleZipKeepSeparate, handleZipMergeAndSplit, handleAutoSplitChapters };
};
