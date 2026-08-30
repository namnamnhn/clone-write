// Model connection testing, zipping+downloading selected translated files,
// and the "rescue copy" clipboard export (trimmed dictionary/context +
// prompt, for pasting into an external AI chat when the app itself fails).
// Split out of the old monolithic `useAppHandlers.ts` — logic unchanged.
import React from 'react';
import { FileItem } from '../../types';
import { testModelConnection } from '../../services/api/gemini';
import { downloadTranslatedAsZip, generateExportFileName } from '../../utils/fileHelpers';
import { optimizeDictionary, optimizeContext, dedupeContextAgainstDictionary } from '../../utils/text';
import type { CoreApi, UIApi } from '../apiTypes';

export const useDownloadHandlers = (core: CoreApi, ui: UIApi) => {
    const handleTestModel = async (modelId: string) => {
        ui.setTestingModelId(modelId);
        const result = await testModelConnection(modelId);
        if (result.success) {
            ui.addToast(result.message, 'success');
        } else {
            ui.addToast(result.message, 'error');
        }
        ui.setTestingModelId(null);
    };

    const handleDownloadSelected = async () => {
        if (ui.selectedFiles.size === 0) { ui.addToast("Chưa chọn file nào", "warning"); return; }
        
        const selectedItems = core.files.filter((f: FileItem) => ui.selectedFiles.has(f.id));
        const readyFiles = selectedItems.filter((f: FileItem) => !!f.translatedContent);
        
        if (readyFiles.length === 0) { 
            ui.addToast("Các file đã chọn chưa có nội dung dịch.", "error"); 
            return; 
        }

        ui.setActionProgress({ current: 0, total: 100, message: "Đang nén các file đã chọn..." });
        try {
            const fileName = generateExportFileName(core.storyInfo.title, core.storyInfo.author, '_Selected.zip');
            await downloadTranslatedAsZip(readyFiles, fileName, (percent, msg) => { 
                ui.setActionProgress({ current: percent, total: 100, message: msg }); 
            });
            ui.addToast(`Đã tải ${readyFiles.length} file được chọn`, 'success');
        } catch (e: any) { 
            ui.addToast(`Lỗi tải xuống: ${e.message}`, 'error'); 
        } finally { 
            ui.setActionProgress(null); 
        }
    };

    const handleRescueCopy = (e: React.MouseEvent, file: FileItem) => {
        e.stopPropagation();
        const localDict = optimizeDictionary(core.additionalDictionary || "", file.content);
        let localContext = optimizeContext(core.storyInfo.contextNotes || "", file.content);
        if (typeof dedupeContextAgainstDictionary === 'function') {
            localContext = dedupeContextAgainstDictionary(localContext, localDict);
        }
        
        const rescuePrompt = `*** BẠN LÀ HỆ THỐNG CỨU HỘ DỊCH THUẬT ***\nHãy dịch nội dung sau sang tiếng Việt.\n[NGỮ CẢNH]:\n${localContext}\n[TỪ ĐIỂN]:\n${localDict}\n[YÊU CẦU]: ${core.promptTemplate}\n[NỘI DUNG RAW]:\n${file.content}`;
        
        navigator.clipboard.writeText(rescuePrompt.trim()).then(() => {
            ui.addToast("Đã copy gói cứu hộ! (Đã lọc Từ điển & Ngữ cảnh)", "success");
        }).catch(() => {
            ui.addToast("Lỗi khi copy!", "error");
        });
    };

    return { handleTestModel, handleDownloadSelected, handleRescueCopy };
};
