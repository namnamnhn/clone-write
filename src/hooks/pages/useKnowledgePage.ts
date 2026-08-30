import { useState } from 'react';
import { StoryInfo } from '../../types';
import { readFileAsText } from '../../utils/fileHelpers';

export interface KnowledgePageProps {
    // Context
    storyInfo: StoryInfo;
    setStoryInfo: React.Dispatch<React.SetStateAction<StoryInfo>>;
    handleContextDownload: () => void;
    handleContextFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    setShowContextBuilder: (v: boolean) => void;
    setShowNameAnalysisModal: (v: boolean) => void;
    isAnalyzingNames: boolean;
    handleRefineContext: () => void;
    isRefiningContext: boolean;
    setShowSmartStartModal: (v: boolean) => void;

    // Dictionary
    handleDictionaryDownload: () => void;
    handleDictionaryUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; // Keep for backward compatibility if needed, but we'll override locally
    dictTab: 'custom' | 'default';
    setDictTab: (v: 'custom' | 'default') => void;
    additionalDictionary: string;
    setAdditionalDictionary: (v: string) => void;

    // Prompt
    viewOriginalPrompt: boolean;
    setViewOriginalPrompt: (v: boolean) => void;
    handlePromptUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    resetPrompt: () => void;
    promptTemplate: string;
    setPromptTemplate: (v: string) => void;
    setShowPromptDesigner: (v: boolean) => void;
    isOptimizingPrompt: boolean;
    handleDictionaryEnforce: () => void;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
    setConfirmModal: (modal: { isOpen: boolean; title: string; message: string; onConfirm: () => void; isDanger: boolean; confirmText?: string }) => void;
}

// Helper used by processUpload — kept here (not exported) since only used locally.
const processDictionary = (content: string) => {
    const lines = content.split('\n');
    const seen = new Set();
    const uniqueLines = lines.filter(line => {
        const isComment = line.trim().startsWith('#') || line.trim().startsWith('//') || !line.includes('=');
        if (isComment) return true;
        const key = line.split('=')[0].trim().replace(/^\[|\]$/g, '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const sortedLines = uniqueLines.sort((a, b) => {
        const isCommentA = a.trim().startsWith('#') || a.trim().startsWith('//') || !a.includes('=');
        const isCommentB = b.trim().startsWith('#') || b.trim().startsWith('//') || !b.includes('=');
        if (isCommentA && !isCommentB) return -1;
        if (!isCommentA && isCommentB) return 1;
        const keyA = isCommentA ? a : a.split('=')[0].trim().replace(/^\[|\]$/g, '');
        const keyB = isCommentB ? b : b.split('=')[0].trim().replace(/^\[|\]$/g, '');
        return keyA.localeCompare(keyB);
    });
    return sortedLines.join('\n');
};

// Extracted from KnowledgePage.tsx (step 4 refactor): local upload state + handlers.
// The GlossaryTable sub-component has been moved to its own file (GlossaryTable.tsx).
// Logic kept 100% identical to original.
export const useKnowledgePage = (props: KnowledgePageProps) => {
    const [viewMode, setViewMode] = useState<'table' | 'text'>('table');
    const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
    const [showUploadModal, setShowUploadModal] = useState(false);

    const handleLocalDictionaryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setUploadFiles(Array.from(files));
        setShowUploadModal(true);
        e.target.value = '';
    };

    const processUpload = async (mode: 'append' | 'overwrite') => {
        if (!uploadFiles) return;
        let combinedContent = mode === 'append' ? (props.additionalDictionary || "") : "";
        try {
            for (let i = 0; i < uploadFiles.length; i++) {
                const content = await readFileAsText(uploadFiles[i]);
                combinedContent += (combinedContent ? "\n" : "") + content;
            }
            const processedContent = processDictionary(combinedContent);
            props.setAdditionalDictionary(processedContent);
            props.setDictTab('custom');
            setShowUploadModal(false);
            setUploadFiles(null);
        } catch(e: any) {
            console.error(e);
            props.addToast(`Lỗi đọc file: ${e.message}`, 'error');
        }
    };

    return {
        viewMode, setViewMode,
        uploadFiles, setUploadFiles,
        showUploadModal, setShowUploadModal,
        handleLocalDictionaryUpload,
        processUpload,
    };
};
