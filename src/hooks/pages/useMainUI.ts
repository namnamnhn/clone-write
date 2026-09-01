/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useState, useMemo } from 'react';
import { validateTranslationIntegrity } from '../../utils/text';
import { DEFAULT_PROMPT, generateBasePrompt } from '../../constants';
import { FileItem, StoryInfo, ModelQuota, BatchLimits, TranslationTier, RatioLimits, FileStatus } from '../../types';

export interface MainUIProps {
    // ... (All existing props)
    files: FileItem[];
    stats: any;
    progressPercentage: number;
    storyInfo: StoryInfo;
    setStoryInfo: React.Dispatch<React.SetStateAction<StoryInfo>>;
    
    // UI State Props
    showSettings: boolean;
    setShowSettings: (v: boolean) => void;
    showLogs: boolean;
    setShowLogs: (v: boolean) => void;
    systemLogs: any[];
    hasLogErrors: boolean;
    isDragging: boolean;
    
    // Header & Sidebar Logic
    onShowChangelog: () => void;
    onShowIntro: () => void;
    isAutoSaving: boolean;
    lastSaved: Date | null;
    enabledModels: string[];
    modelConfigs: ModelQuota[];
    modelUsages: any;
    toggleModel: (id: string) => void;
    handleManualResetQuota: () => void;
    handleTestModel: (id: string) => void;
    testingModelId: string | null;
    startTime: number | null;
    endTime: number | null;
    setStartTime?: (v: number | null) => void;
    setEndTime?: (v: number | null) => void;
    addLog?: (msg: string, type?: 'success' | 'error' | 'info') => void;
    
    // Story Info
    setStoryInfoSafe: (info: StoryInfo) => void;
    
    // File Logic
    setFilesSafe: (files: FileItem[]) => void;
    
    // Batch Config Logic
    batchLimits: BatchLimits;
    setBatchLimits: React.Dispatch<React.SetStateAction<BatchLimits>>;
    
    // Concurrency Logic
    concurrency: number | 'auto';
    setConcurrency: React.Dispatch<React.SetStateAction<number | 'auto'>>;

    // Ratio Config Logic
    ratioLimits: RatioLimits;
    setRatioLimits: React.Dispatch<React.SetStateAction<RatioLimits>>;

    // Dark Mode Props
    isDarkMode: boolean;
    toggleDarkMode: () => void;

    // Dashboard Logic
    coverPreviewUrl: string | null;
    handleCoverUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleAutoAnalyze: () => void;
    isAutoAnalyzing: boolean;
    autoAnalyzeStatus: string;
    quickInput: string;
    setQuickInput: (v: string) => void;
    handleQuickParse: () => void;
    handleRegenerateCover: () => void;
    isGeneratingCover: boolean;
    handleBackup: () => void;
    handleRestore: (e: React.ChangeEvent<HTMLInputElement>) => Promise<boolean> | void;
    handleSyncSupportInfo: (e: React.ChangeEvent<HTMLInputElement>) => Promise<boolean> | void;
    handleExportSupportInfo: () => void;
    requestResetApp: () => void;
    handleRefineSummary: () => void;

    // Knowledge Logic
    handleContextDownload: () => void;
    handleContextFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    setShowContextBuilder: (v: boolean) => void;
    setShowNameAnalysisModal: (v: boolean) => void;
    isAnalyzingNames: boolean;
    handleRefineContext: () => void;
    isRefiningContext: boolean;
    setShowSmartStartModal: (v: boolean) => void;
    viewOriginalPrompt: boolean;
    setViewOriginalPrompt: (v: boolean) => void;
    handlePromptUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    resetPrompt: () => void;
    promptTemplate: string;
    setPromptTemplate: (v: string) => void;
    handleOptimizePrompt: () => void;
    isOptimizingPrompt: boolean;
    selectedTemplateKey: string;
    setSelectedTemplateKey: (v: string) => void;
    handleDictionaryDownload: () => void;
    handleDictionaryUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    dictTab: 'custom' | 'default';
    setDictTab: (v: 'custom' | 'default') => void;
    additionalDictionary: string;
    setAdditionalDictionary: (v: string) => void;
    setShowPromptDesigner: (v: boolean) => void;

    // Workspace Logic
    currentPage: number;
    setCurrentPage: (v: number) => void;
    totalPages: number;
    visibleFiles: FileItem[];
    selectedFiles: Set<string>;
    setSelectedFiles: (ids: Set<string>) => void;
    handleSelectFile: (id: string, shiftKey: boolean) => void;
    handleManualFixSingle: (e: React.MouseEvent, id: string) => void;
    handleRescueCopy: (e: React.MouseEvent, file: FileItem) => void; // Added prop definition
    requestRetranslateSingle: (e: React.MouseEvent, id: string) => void;
    openEditor: (file: FileItem) => void;
    handleRemoveFile: (id: string) => void;
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    setShowPasteModal: (v: boolean) => void;
    selectAll: () => void;
    rangeStart: string;
    setRangeStart: (v: string) => void;
    rangeEnd: string;
    setRangeEnd: (v: string) => void;
    handleRangeSelect: () => void;
    setShowFindReplace: (v: boolean) => void;
    isProcessing: boolean;
    isCustomFixing: boolean;
    handleSmartFix: () => void;
    handleAutoFixRaw: (mode: 'pro' | 'flash') => void;
    showFilterPanel: boolean;
    setShowFilterPanel: (v: boolean) => void;
    filterModels: Set<string>;
    filterStatuses: Set<string>;
    toggleFilterModel: (key: string) => void;
    toggleFilterStatus: (key: string) => void;
    clearFilters: () => void;
    handleScanJunk: () => void;
    handleScanFuzzyDuplicates: () => void;
    handleRemoveDuplicates: (scope: 'all' | 'selected') => void;
    handleFilterMismatchedRatio: () => void;
    handleManualCleanup: (scope: 'all' | 'selected') => void;
    handleRemoveJunk: (scope: 'all' | 'selected') => void;
    handleTitleNormalization: (scope: 'all' | 'selected') => void;
    stopTitleNormalization: () => void;
    isNormalizingTitles: boolean;
    handleAutoSplitChapters: (scope: 'all' | 'selected' | 'single', id?: string, threshold?: number, numParts?: number) => void;
    handleCustomErrorCorrection: (prompt: string, scope: 'all' | 'selected', imageBase64?: string) => void;
    handleAnalyzeCustomError: (prompt: string, scope: 'all' | 'selected', imageBase64?: string) => Promise<string>;
    stopCustomFixing: () => void;
    setShowRetranslateModal: (v: boolean) => void;
    handleSmartDelete: () => void;
    requestDeleteAll: () => void;
    handleDownloadRaw: (parts?: number) => void;
    handleDownloadTranslatedZip: () => void;
    handleDownloadMerged: () => void;
    handleExportDocx: () => void;
    handleDownloadSelected: () => void;
    handleSaveSelected: () => void;
    handleDownloadEpub: () => void;
    stopProcessing: () => void;
    handleStartButton: () => void;
    handleManualRescueCheck: () => void;
    // NEW (đề xuất cải thiện fix12 - "Tiếp tục dịch phần còn lại"): số tệp còn lại chưa từng thử
    // khi hệ thống TỰ ĐỘNG dừng do Gemini hết Quota toàn bộ (null = không ở trạng thái này).
    autoStoppedRemainingCount: number | null;
    continueAfterAutoStop: () => void;
    
    // AUTOMATION PROPS
    setShowAutomationModal: (v: boolean) => void;
    setShowRawDownloadModal: (v: boolean) => void;
    automationState: { isRunning: boolean, currentStep: number, countdown: number };
    setAutomationInitialConfig: (v: { steps: number[], rules: string, tier: TranslationTier, engine?: 'gemini' | 'deepseek' }) => void; // New Prop
    
    handleRetranslateConfirm: (keepOld: boolean, tier: TranslationTier) => void;
    setShowGuide: (v: boolean) => void;
    handleTranslatedFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleMergeSelected: () => void;
    handleDictionaryEnforce: () => void;
    activeTab: 'dashboard' | 'knowledge' | 'workspace' | 'titles' | 'creative' | 'story-studio' | 'hanviet';
    setActiveTab: (v: 'dashboard' | 'knowledge' | 'workspace' | 'titles' | 'creative' | 'story-studio' | 'hanviet') => void;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
    setConfirmModal: (modal: { isOpen: boolean; title: string; message: string; onConfirm: () => void; isDanger: boolean; confirmText?: string }) => void;
    
    // Creative
    creativeState: any;
    setCreativeState: any;
    setCoverImage?: (file: File | null) => void;
    
    // HanViet
    sinoVietnameseState: any;
    setSinoVietnameseState: any;

    // FixError
    fixErrorState: any;
    setFixErrorState: any;
    
    deepseekKey?: string;
    setDeepseekKey?: (key: string) => void;
}

// Extracted from MainUI.tsx (step 4 refactor): local UI state, derived counts, and
// the "Smart Automation" click handler. Logic kept 100% identical to original; the
// component still reads most values off `props` directly, same as before.
export const useMainUI = (props: MainUIProps) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isBottomBarOpen, setIsBottomBarOpen] = useState(true);
    const [showRescuePrompt, setShowRescuePrompt] = useState(false);
    // Chỉ nhắc DeepSeek một lần trong vòng đời tab/app hiện tại. Sau khi người dùng đã thấy
    // popup (dù đóng hay tiếp tục không nhập key), những lần Auto sau đi thẳng vào cấu hình;
    // người dùng vẫn có thể tự thêm key trong Cài đặt. Reload/Reset Data tạo phiên mới nên được
    // phép nhắc lại từ đầu.
    const rescuePromptShownRef = React.useRef(false);
    const [tempDeepseekKey, setTempDeepseekKey] = useState("");
    const [showSplitConfig, setShowSplitConfig] = useState(false);
    const [splitThreshold, setSplitThreshold] = useState("8000");
    const [splitParts, setSplitParts] = useState(""); // để trống = tự động tính số phần

    const { files, setCurrentPage, activeTab, setActiveTab } = props;
    const prevFilesLength = React.useRef(files.length);
    React.useEffect(() => {
        if (files.length > prevFilesLength.current) {
            setActiveTab('workspace');
            setCurrentPage(1);
        }
        prevFilesLength.current = files.length;
    }, [files.length, setCurrentPage, setActiveTab]);

    const fixableCount = useMemo(() => {
        const raw = props.files.filter(f => f.status === FileStatus.COMPLETED && f.remainingRawCharCount > 0).length;
        const error = props.files.filter(f => f.status === FileStatus.ERROR && !f.errorMessage?.includes("English")).length;
        const english = props.files.filter(f => f.status === FileStatus.ERROR && f.errorMessage?.includes("English")).length;
        const processing = props.files.filter(f => f.status === FileStatus.PROCESSING || f.status === FileStatus.REPAIRING).length;
        
        // Suspicious Ratio / Unchanged
        const suspicious = props.files.filter(f => {
            if (f.status !== FileStatus.COMPLETED || !f.translatedContent) return false;
            // Check 1: Unchanged content (Did not translate)
            if (f.translatedContent.trim() === f.content.trim()) return true;
            // Check 2: Ratio check (Precise with limits)
            const integrity = validateTranslationIntegrity(f.content, f.translatedContent, props.ratioLimits, props.storyInfo.languages, f.usedModel);
            return !integrity.isValid && (integrity.reason?.toLowerCase().includes('tỷ lệ') || false);
        }).length;

        return raw + error + english + processing + suspicious;
    }, [props.files, props.ratioLimits, props.storyInfo.languages]);

    const rawFixCount = useMemo(
        () => props.files.filter(f => f.status === FileStatus.COMPLETED && f.remainingRawCharCount > 0 && f.usedModel !== 'Thủ công').length,
        [props.files]
    );

    // SMART AUTOMATION LOGIC (UPDATED WITH LOWER THRESHOLDS)
    const handleSmartAutomationClick = () => {
        const proceedWithAuto = () => {
            const currentRules = (props.storyInfo.additionalRules || "").replace(/Nếu văn bản gốc chứa nội dung nhạy cảm.*thành công\./g, 'Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.') || "Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.";
            
            // 1. Check Metadata: STRICT CHECK
            const hasMetadata = !!(
                props.storyInfo.title && props.storyInfo.title.trim().length > 0 &&
                props.storyInfo.author && props.storyInfo.author.trim().length > 0 &&
                props.storyInfo.genres && props.storyInfo.genres.length > 0 &&
                props.storyInfo.summary && props.storyInfo.summary.trim().length > 0
            );
            
            // 2. Check Context: Relaxed check (> 10 chars is enough to assume user input).
            const hasDict = props.additionalDictionary && props.additionalDictionary.trim().length > 10;
            const hasCtx = props.storyInfo.contextNotes && props.storyInfo.contextNotes.trim().length > 10;
            const hasContextData = hasDict || hasCtx;
            
            // 3. Check Prompt: Relaxed check.
            const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
            const basePrompt = generateBasePrompt(props.storyInfo.genres, props.storyInfo.worldSetting || []);
            const isNotDefaultPrompt = normalize(props.promptTemplate) !== normalize(basePrompt) && normalize(props.promptTemplate) !== normalize(DEFAULT_PROMPT);
            const hasPromptConfig = isNotDefaultPrompt;

            let stepsToRun = [0, 1, 2, 3, 4, 5, 6, 7];

            if (hasMetadata) stepsToRun = stepsToRun.filter(s => s !== 1);
            if (hasContextData) stepsToRun = stepsToRun.filter(s => s !== 2);
            if (hasPromptConfig) stepsToRun = stepsToRun.filter(s => s !== 3);

            if (stepsToRun.length === 0) stepsToRun = [0, 4, 5, 6, 7];

            props.setAutomationInitialConfig({
                steps: stepsToRun,
                rules: currentRules,
                tier: 'normal'
            });
            props.setShowAutomationModal(true);
        };

        const hasDeepseek = !!props.deepseekKey && props.deepseekKey.trim() !== '';
        if (!hasDeepseek && !rescuePromptShownRef.current) {
            rescuePromptShownRef.current = true;
            setShowRescuePrompt(true);
        } else {
            proceedWithAuto();
        }
    };


    return {
        isSidebarOpen, setIsSidebarOpen,
        isBottomBarOpen, setIsBottomBarOpen,
        showRescuePrompt, setShowRescuePrompt,
        tempDeepseekKey, setTempDeepseekKey,
        showSplitConfig, setShowSplitConfig,
        splitThreshold, setSplitThreshold,
        splitParts, setSplitParts,
        fixableCount,
        rawFixCount,
        handleSmartAutomationClick,
    };
};
