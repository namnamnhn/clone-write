// Wiring <input type="file"> change events to the app's file/context/prompt/
// dictionary loading logic. Split out of the old monolithic `useAppHandlers.ts`.
import React from 'react';
import { StoryInfo } from '../../types';
import { readFileAsText } from '../../utils/fileHelpers';
import type { CoreApi, UIApi } from '../apiTypes';

export const useUploadHandlers = (core: CoreApi, ui: UIApi, fileHandler: any) => {
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) fileHandler.processFiles(Array.from(e.target.files)); e.target.value = ''; };
    const handleTranslatedFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) fileHandler.processFiles(Array.from(e.target.files), true); e.target.value = ''; };

    const handleContextFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const content = await readFileAsText(file);
            core.setStoryInfo((prev: StoryInfo) => ({ ...prev, contextNotes: content }));
            ui.addToast("Đã tải lên file Ngữ Cảnh (Context)", "success");
        } catch(e: any) { ui.addToast(`Lỗi đọc file: ${e.message}`, "error"); }
        e.target.value = '';
    };

    const handlePromptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const content = await readFileAsText(file);
            core.setPromptTemplate(content);
            ui.addToast("Đã tải lên Prompt mới", "success");
        } catch(e: any) { ui.addToast(`Lỗi đọc file: ${e.message}`, "error"); }
        e.target.value = '';
    };

    const handleDictionaryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        let combinedContent = core.additionalDictionary || "";
        let count = 0;

        try {
            for (let i = 0; i < files.length; i++) {
                const content = await readFileAsText(files[i]);
                combinedContent += (combinedContent ? "\n" : "") + content;
                count++;
            }
            core.setAdditionalDictionary(combinedContent);
            ui.setDictTab('custom');
            ui.addToast(`Đã gộp ${count} file vào Từ điển`, "success");
        } catch(e: any) { ui.addToast(`Lỗi đọc file: ${e.message}`, "error"); }
        e.target.value = '';
    };

    return {
        handleFileUpload,
        handleTranslatedFileUpload,
        handleContextFileUpload,
        handlePromptUpload,
        handleDictionaryUpload,
    };
};
