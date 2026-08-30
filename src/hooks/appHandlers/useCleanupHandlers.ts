// Local (non-AI) content cleanup: strip junk artifacts, normalize book
// formatting, and find translations whose raw/translated length ratio
// looks broken. Split out of the old monolithic `useAppHandlers.ts`.
import { FileItem, FileStatus } from '../../types';
import { formatBookStyle, countForeignChars, removeJunkContent, fixMergedTitle, validateTranslationIntegrity } from '../../utils/text';
import type { CoreApi, UIApi } from '../apiTypes';

export const useCleanupHandlers = (core: CoreApi, ui: UIApi) => {
    const handleManualCleanup = async (scope: 'all' | 'selected') => {
        ui.setActionProgress({ current: 0, total: 100, message: "Đang lọc rác & định dạng..." });
        const prevFiles = core.files;
        const newFiles = [...prevFiles];
        let count = 0;
        
        const CHUNK_SIZE = 100;
        for (let i = 0; i < newFiles.length; i += CHUNK_SIZE) {
            await new Promise(r => setTimeout(r, 0));
            const chunk = newFiles.slice(i, i + CHUNK_SIZE);
            for (let j = 0; j < chunk.length; j++) {
                const f = chunk[j];
                const originalIndex = i + j;
                if (scope === 'selected' && !ui.selectedFiles.has(f.id)) continue;
                if (f.translatedContent) {
                    const fixed = fixMergedTitle(f.translatedContent);
                    const cleaned = formatBookStyle(fixed, f.content, core.storyInfo?.enableTitleFormatting !== false, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false);
                    if (cleaned !== f.translatedContent) {
                        count++;
                        const newRawCount = countForeignChars(cleaned);
                        newFiles[originalIndex] = { ...f, translatedContent: cleaned, remainingRawCharCount: newRawCount };
                    }
                }
            }
            ui.setActionProgress({ current: Math.min(100, Math.round(((i + CHUNK_SIZE) / newFiles.length) * 100)), total: 100, message: "Đang lọc rác & định dạng..." });
        }
        
        if (count > 0) {
            core.setFiles(newFiles);
            ui.addToast(`Trợ Lý Local đã lọc rác & định dạng chuẩn cho ${count} file.`, 'success');
        } else {
            ui.addToast(`Trợ Lý Local: Các file đã sạch và chuẩn form sách in.`, 'info');
        }
        ui.setActionProgress(null);
    };

    const handleRemoveJunk = async (scope: 'all' | 'selected') => {
        ui.setActionProgress({ current: 0, total: 100, message: "Đang lọc rác nội dung..." });
        const prevFiles = core.files;
        const newFiles = [...prevFiles];
        let count = 0;
        
        const CHUNK_SIZE = 100;
        for (let i = 0; i < newFiles.length; i += CHUNK_SIZE) {
            await new Promise(r => setTimeout(r, 0));
            const chunk = newFiles.slice(i, i + CHUNK_SIZE);
            for (let j = 0; j < chunk.length; j++) {
                const f = chunk[j];
                const originalIndex = i + j;
                if (scope === 'selected' && !ui.selectedFiles.has(f.id)) continue;
                
                let changed = false;
                const newFileItem = { ...f };

                // Clean RAW content
                if (newFileItem.content) {
                    const cleanedRaw = removeJunkContent(newFileItem.content);
                    if (cleanedRaw !== newFileItem.content) {
                        changed = true;
                        newFileItem.content = cleanedRaw;
                        newFileItem.originalCharCount = cleanedRaw.length;
                    }
                }

                // Clean TRANSLATED content
                if (newFileItem.translatedContent) {
                    const cleanedTrans = removeJunkContent(newFileItem.translatedContent);
                    if (cleanedTrans !== newFileItem.translatedContent) {
                        changed = true;
                        newFileItem.translatedContent = cleanedTrans;
                        newFileItem.remainingRawCharCount = countForeignChars(cleanedTrans);
                    }
                } else if (changed) {
                    // If raw changed and there is no translated, update raw count
                    newFileItem.remainingRawCharCount = countForeignChars(newFileItem.content);
                }

                if (changed) {
                    count++;
                    newFiles[originalIndex] = newFileItem;
                }
            }
            ui.setActionProgress({ current: Math.min(100, Math.round(((i + CHUNK_SIZE) / newFiles.length) * 100)), total: 100, message: "Đang lọc rác nội dung..." });
        }

        if (count > 0) {
            core.setFiles(newFiles);
            ui.addToast(`Đã lọc rác cho ${count} file.`, 'success');
        } else {
            ui.addToast(`Không tìm thấy nội dung rác.`, 'info');
        }
        ui.setActionProgress(null);
    };

    const handleFilterMismatchedRatio = () => {
        const mismatchedIds = new Set<string>();

        core.files.forEach((f: FileItem) => {
            if (f.status === FileStatus.COMPLETED && f.translatedContent) {
                const integrity = validateTranslationIntegrity(f.content, f.translatedContent, core.stateRef.current.ratioLimits, core.stateRef.current.storyInfo.languages, f.usedModel);
                if (!integrity.isValid) {
                    mismatchedIds.add(f.id);
                }
            } else if (f.status === FileStatus.ERROR && f.translatedContent && (f.errorMessage?.toLowerCase().includes('tỷ lệ') || f.errorMessage?.toLowerCase().includes('ratio'))) {
                const integrity = validateTranslationIntegrity(f.content, f.translatedContent, core.stateRef.current.ratioLimits, core.stateRef.current.storyInfo.languages, f.usedModel);
                if (!integrity.isValid) {
                    mismatchedIds.add(f.id);
                }
            }
        });

        if (mismatchedIds.size > 0) {
            ui.setConfirmModal({
                isOpen: true,
                title: `Phát hiện ${mismatchedIds.size} file lệch Ratio`,
                message: "Bạn có muốn chọn các file này và xóa nội dung dịch cũ để chuẩn bị cho Smart Fix không?",
                isDanger: true,
                confirmText: "Chọn & Xóa nội dung",
                onConfirm: () => {
                    core.setFiles((prev: FileItem[]) => prev.map(f => 
                        mismatchedIds.has(f.id) ? { ...f, translatedContent: null, status: FileStatus.IDLE, remainingRawCharCount: 0, usedModel: undefined, errorMessage: 'Lệch Ratio' } : f
                    ));
                    ui.setSelectedFiles(mismatchedIds);
                    ui.setFilterStatuses(new Set(['selected']));
                    ui.setCurrentPage(1);
                    ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}));
                    ui.addToast(`Đã chọn ${mismatchedIds.size} file và xóa nội dung dịch cũ.`, 'success');
                },
                onCancel: () => ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}))
            });
        } else {
            ui.addToast("Không tìm thấy file nào có tỉ lệ dịch bị lệch.", 'info');
        }
    };

    return { handleManualCleanup, handleRemoveJunk, handleFilterMismatchedRatio };
};
