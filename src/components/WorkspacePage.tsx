
import React, { useMemo, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { 
    FileArchive, FileUp, Copy, AlertTriangle, Layers, ShieldAlert, RefreshCw
} from 'lucide-react';
import { FileItem, FileStatus, StoryInfo, RatioLimits } from '../types';
import { validateTranslationIntegrity, BATCH_MISSING_TAG_WARNING } from '../utils/text';
import FileCard from './FileCard';

interface WorkspacePageProps {
    files: FileItem[];
    visibleFiles: FileItem[];
    selectedFiles: Set<string>;
    setSelectedFiles: (ids: Set<string>) => void;
    currentPage: number;
    setCurrentPage: (v: number) => void;
    totalPages: number;
    handleSelectFile: (id: string, shiftKey: boolean) => void;
    handleManualFixSingle: (e: React.MouseEvent, id: string) => void;
    handleRescueCopy: (e: React.MouseEvent, file: FileItem) => void;
    requestRetranslateSingle: (e: React.MouseEvent, id: string) => void;
    handleAutoSplitChapters: (scope: 'all' | 'selected' | 'single', id?: string, threshold?: number, numParts?: number) => void;
    openEditor: (file: FileItem) => void;
    handleRemoveFile: (id: string) => void;
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    
    // Bottom Bar Logic
    setShowPasteModal: (v: boolean) => void;
    selectAll: () => void;
    rangeStart: string;
    setRangeStart: (v: string) => void;
    rangeEnd: string;
    setRangeEnd: (v: string) => void;
    handleRangeSelect: () => void;
    setShowFindReplace: (v: boolean) => void;
    isProcessing: boolean;
    handleSmartFix: () => void;
    
    // Filter Logic
    showFilterPanel: boolean;
    setShowFilterPanel: (v: boolean) => void;
    filterModels: Set<string>;
    filterStatuses: Set<string>;
    toggleFilterModel: (key: string) => void;
    toggleFilterStatus: (key: string) => void;
    clearFilters: () => void;

    handleScanJunk: () => void;
    handleScanFuzzyDuplicates: () => void;
    handleFilterMismatchedRatio: () => void;
    handleManualCleanup: (scope: 'all' | 'selected') => void;
    handleTitleNormalization: (scope: 'all' | 'selected') => void; // NEW
    setShowRetranslateModal: (v: boolean) => void;
    handleSmartDelete: () => void;
    requestDeleteAll: () => void;
    handleDownloadRaw: () => void;
    handleDownloadTranslatedZip: () => void;
    handleDownloadMerged: () => void;
    handleExportDocx: () => void;
    handleDownloadSelected: () => void;
    handleDownloadEpub: () => void;
    stopProcessing: () => void;
    handleStartButton: () => void;
    handleManualRescueCheck: () => void;
    autoStoppedRemainingCount: number | null;
    continueAfterAutoStop: () => void;
    
    // Story Info & Ratio Limits
    storyInfo: StoryInfo;
    ratioLimits: RatioLimits; // Injected
}

export const WorkspacePage: React.FC<WorkspacePageProps> = (props) => {
    const [displayLimit, setDisplayLimit] = useState(300);

    // FIX48 (hiệu năng - "đang dịch mà giật khắp lưới thẻ"): FileCard được bọc React.memo nhưng
    // TRƯỚC ĐÂY memo vô dụng vì toàn bộ 7 hàm handler truyền cho nó (handleSelectFile,
    // handleManualFixSingle, requestRetranslateSingle, handleAutoSplitChapters, handleRescueCopy,
    // openEditor, handleRemoveFile) đều là hàm thường được tạo lại MỖI LẦN RENDER ở tầng hook/App
    // -> prop tham chiếu luôn đổi -> MỌI thẻ đang hiển thị (tới 300) re-render cùng lúc, và mỗi
    // thẻ lại chạy validateTranslationIntegrity (quét regex/split trên toàn bộ nội dung chương)
    // -> cứ mỗi lần streaming flush (~500ms) hoặc gõ chữ là cả lưới giật mạnh. SỬA theo pattern
    // "latest-ref": bọc 1 lớp hàm ỔN ĐỊNH vĩnh viễn (useMemo rỗng) chỉ việc gọi xuống implementation
    // MỚI NHẤT qua ref -> prop của FileCard không đổi tham chiếu -> memo hoạt động đúng, chỉ thẻ
    // nào thực sự đổi dữ liệu mới re-render. Không đổi hành vi gì (luôn gọi bản hàm mới nhất).
    const propsRef = useRef(props);
    useLayoutEffect(() => {
        propsRef.current = props;
    });
    const stableFileCardHandlers = useMemo(() => ({
        handleSelectFile: (id: string, shiftKey: boolean) => propsRef.current.handleSelectFile(id, shiftKey),
        handleManualFixSingle: (e: React.MouseEvent, id: string) => propsRef.current.handleManualFixSingle(e, id),
        requestRetranslateSingle: (e: React.MouseEvent, id: string) => propsRef.current.requestRetranslateSingle(e, id),
        handleAutoSplitChapters: (scope: 'all' | 'selected' | 'single', id?: string, threshold?: number, numParts?: number) => propsRef.current.handleAutoSplitChapters(scope, id, threshold, numParts),
        handleRescueCopy: (e: React.MouseEvent, file: FileItem) => propsRef.current.handleRescueCopy(e, file),
        openEditor: (file: FileItem) => propsRef.current.openEditor(file),
        handleRemoveFile: (id: string) => propsRef.current.handleRemoveFile(id),
    }), []);

    // --- REAL-TIME STATS CALCULATION (ENHANCED) ---
    // FIX48 (hiệu năng - tiếp nghi vấn từ fix45): trước đây `counts` chạy ~25 lượt .filter()
    // RIÊNG BIỆT trên toàn bộ mảng files (mỗi lượt cấp phát 1 mảng mới), trong đó có các lượt
    // nặng nhất là: lowRatio gọi validateTranslationIntegrity (normalize 2 chuỗi full chương
    // qua nhiều bước regex/split) cho MỌI file COMPLETED, unchanged trim 2 chuỗi lớn, merged
    // split('\n') 2 chuỗi lớn THÀNH MẢNG. Toàn bộ cụm này chạy lại mỗi khi mảng files đổi
    // (streaming flush mỗi ~500ms lúc đang dịch) VÀ mỗi khi người dùng tick chọn/bỏ chọn 1 thẻ
    // (selectedFiles đổi) -> mở Filter Panel đúng lúc đang dịch là giật rõ. SỬA: gộp về ĐÚNG 1
    // lượt duyệt duy nhất với biến đếm thủ công (không cấp phát mảng trung gian); số dòng
    // '\n' đếm trực tiếp thay vì split; kiểm tra tỷ lệ Ảo/Lệch (lowRatio - phần duy nhất nặng)
    // CHỈ chạy khi Filter Panel đang MỞ (số đếm này chỉ được hiển thị trong panel; ngoài panel
    // không ai đọc nó) nên lúc đang dịch mà panel đóng thì gần như không còn chi phí nữa.
    // Dependency cũng đổi từ nguyên Set selectedFiles sang .size để tick chọn thẻ không còn
    // kích hoạt tính lại (counts chỉ dùng .size của selection).
    const counts = useMemo(() => {
        let pending = 0, completed = 0, raw = 0, error = 0, english = 0, short = 0, processing = 0;
        let unchanged = 0, merged = 0, suspicious = 0, rescueLocked = 0, nonStory = 0;
        let m31pro = 0, m37flash = 0, m36flash = 0, m35flash = 0, m3flash = 0, m35flashlite = 0, m31flashlite = 0, mDeepSeek = 0, mManual = 0, mOther = 0;
        let lowRatio = 0;
        const needLowRatio = props.showFilterPanel;

        // Đếm số dòng (giống length của str.split('\n')) mà không cấp phát mảng
        const lineCount = (s: string) => {
            let n = 1;
            for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 10) n++; }
            return n;
        };
        const isSuspiciousMsg = (msg?: string) =>
            !!msg && (msg.includes('phân loại riêng') || msg.toLowerCase().includes('an toàn') || msg.includes('Nghi vấn lỗi nội dung') || msg.includes('BLOCKLIST') || msg.includes('PROHIBITED_CONTENT'));

        for (const f of props.files) {
            const st = f.status;
            const em = f.errorMessage;

            if (st === FileStatus.IDLE) pending++;
            else if (st === FileStatus.COMPLETED) {
                if (f.remainingRawCharCount === 0) completed++; else raw++;
                if (f.translatedContent) {
                    if (f.translatedContent.trim() === f.content.trim()) unchanged++;
                    if (
                        f.translatedContent.includes(BATCH_MISSING_TAG_WARNING) ||
                        (lineCount(f.content) > 5 && lineCount(f.translatedContent) <= 2 && f.translatedContent.length > 300)
                    ) merged++;

                    if (needLowRatio) {
                        const integrity = validateTranslationIntegrity(f.content, f.translatedContent, props.ratioLimits, props.storyInfo.languages, f.usedModel);
                        if (!integrity.isValid && (integrity.reason?.toLowerCase().includes('tỷ lệ') || false)) lowRatio++;
                    }
                }
            }
            else if (st === FileStatus.ERROR) {
                if (em?.includes("English")) english++; else error++;
                if (em && (em.toLowerCase().includes('tỷ lệ') || em.toLowerCase().includes('ratio')) && needLowRatio) lowRatio++;
            }

            if (st === FileStatus.PROCESSING || st === FileStatus.REPAIRING) processing++;
            if (f.content.length < 1200) short++;
            if (isSuspiciousMsg(em)) suspicious++;
            if (f.isRescueLocked) rescueLocked++;
            if (f.shortContentKind === 'non_story') nonStory++;

            const um = f.usedModel;
            if (um) {
                if (um.includes('gemini-3.1-pro')) m31pro++;
                if (um.includes('gemini-3.7-flash')) m37flash++;
                if (um.includes('gemini-3.6-flash')) m36flash++;
                if (um.includes('gemini-3.5-flash') && !um.includes('lite')) m35flash++;
                if (um.includes('gemini-3-flash')) m3flash++;
                if (um.includes('gemini-3.5-flash-lite')) m35flashlite++;
                if (um.includes('gemini-3.1-flash-lite') || um.includes('gemini-3.1-flash')) m31flashlite++;
                if (um.includes('deepseek:')) mDeepSeek++;
                if (um.includes('Thủ công')) mManual++;
            }
            if (st === FileStatus.COMPLETED && (!um || (!um.includes('gemini-3.1-pro') && !um.includes('gemini-3.7-flash') && !um.includes('gemini-3.6-flash') && !um.includes('gemini-3.5-flash') && !um.includes('gemini-3.1-flash') && !um.includes('gemini-3-flash') && !um.includes('deepseek:') && !um.includes('Thủ công')))) mOther++;
        }

        return {
            selected: props.selectedFiles.size,
            pending, completed, raw, error, english, short, processing,
            unchanged, merged, lowRatio, suspicious, rescueLocked, nonStory,
            m31pro, m37flash, m36flash, m35flash, m3flash, m35flashlite, m31flashlite, mDeepSeek, mManual, mOther,
        };
    }, [props.files, props.selectedFiles.size, props.ratioLimits, props.storyInfo.languages, props.showFilterPanel]);

    const renderFilterBadge = (label: string, count: number, active: boolean, onClick: () => void, colorClass: string, icon?: React.ReactNode) => (
        <button 
            onClick={onClick}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ease-smooth border flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1
            ${active ? colorClass : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'}`}
        >
            <div className="flex items-center gap-1.5">
                {icon}
                <span>{label}</span>
            </div>
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${active ? 'bg-white/30' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {count}
            </span>
        </button>
    );

    // Filter Logic inside WorkspacePage
    const filteredFiles = useMemo(() => {
        let filtered = props.files;
        if (props.filterStatuses.size > 0 || props.filterModels.size > 0) {
            filtered = props.files.filter(f => {
                let statusMatch = true;
                if (props.filterStatuses.size > 0) {
                    if (props.filterStatuses.has('selected')) { if (!props.selectedFiles.has(f.id)) return false; if (props.filterStatuses.size === 1) return true; }
                    
                    const isCompleted = f.status === FileStatus.COMPLETED;
                    const isError = f.status === FileStatus.ERROR;
                    const isEnglishError = isError && f.errorMessage?.includes("English");
                    const isRaw = isCompleted && f.remainingRawCharCount > 0;
                    const isClean = isCompleted && f.remainingRawCharCount === 0;
                    const isProcessing = f.status === FileStatus.PROCESSING || f.status === FileStatus.REPAIRING;
                    const isPending = f.status === FileStatus.IDLE;
                    const isShort = f.content.length < 1200;
                    const isNonStory = f.shortContentKind === 'non_story';
                    const isUnchanged = isCompleted && f.translatedContent?.trim() === f.content.trim();
                    const isMergedWarning = isCompleted && f.translatedContent && (
                        f.translatedContent.includes(BATCH_MISSING_TAG_WARNING) ||
                        (f.content.split('\n').length > 5 && f.translatedContent.split('\n').length <= 2 && f.translatedContent.length > 300)
                    );

                    const isErrorFilterMatch = props.filterStatuses.has('error') && ((isError && !isEnglishError) || isProcessing);
                    
                    // SUSPICIOUS RATIO FILTER (Precise)
                    let isLowRatio = false;
                    if (props.filterStatuses.has('low_ratio')) {
                        if (isCompleted && f.translatedContent) {
                            const integrity = validateTranslationIntegrity(f.content, f.translatedContent, props.ratioLimits, props.storyInfo.languages, f.usedModel);
                            if (!integrity.isValid && integrity.reason?.toLowerCase().includes('tỷ lệ')) isLowRatio = true;
                        } else if (isError && (f.errorMessage?.toLowerCase().includes('tỷ lệ') || f.errorMessage?.toLowerCase().includes('ratio'))) {
                            isLowRatio = true;
                        }
                    }
                    
                    let isSuspicious = false;
                    if (props.filterStatuses.has('suspicious')) {
                        if (f.errorMessage && (f.errorMessage.includes('phân loại riêng') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.includes('Nghi vấn lỗi nội dung') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT'))) {
                            isSuspicious = true;
                        }
                    }

                    const isRescueLocked = props.filterStatuses.has('rescue_locked') && !!f.isRescueLocked;

                    const matchesStandardStatus = ( 
                        (props.filterStatuses.has('completed') && isClean) || 
                        (props.filterStatuses.has('raw') && isRaw) || 
                        isErrorFilterMatch || 
                        (props.filterStatuses.has('english') && isEnglishError) || 
                        (props.filterStatuses.has('processing') && isProcessing) || 
                        (props.filterStatuses.has('pending') && isPending) || 
                        (props.filterStatuses.has('short') && isShort) ||
                        (props.filterStatuses.has('non_story') && isNonStory) ||
                        (props.filterStatuses.has('unchanged') && isUnchanged) ||
                        (props.filterStatuses.has('merged') && isMergedWarning)
                    );
                    
                    if (props.filterStatuses.size > (props.filterStatuses.has('selected') ? 1 : 0)) { 
                        statusMatch = matchesStandardStatus || isLowRatio || isSuspicious || isRescueLocked; 
                    }
                }
                
                let modelMatch = true;
                if (props.filterModels.size > 0) { 
                    const m = f.usedModel || ""; 
                    modelMatch = ( 
                        (props.filterModels.has('31pro') && m.includes('gemini-3.1-pro')) || 
                        (props.filterModels.has('37flash') && m.includes('gemini-3.7-flash')) || 
                        (props.filterModels.has('36flash') && m.includes('gemini-3.6-flash')) || 
                        (props.filterModels.has('35flash') && m.includes('gemini-3.5-flash') && !m.includes('lite')) || 
                        (props.filterModels.has('3flash') && m.includes('gemini-3-flash')) || 
                        (props.filterModels.has('35flashlite') && m.includes('gemini-3.5-flash-lite')) || 
                        (props.filterModels.has('31flashlite') && (m.includes('gemini-3.1-flash-lite') || m.includes('gemini-3.1-flash'))) ||
                        (props.filterModels.has('deepseek') && m.includes('deepseek:')) ||
                        (props.filterModels.has('manual') && m.includes('Thủ công')) ||

                        (props.filterModels.has('other') && f.status === FileStatus.COMPLETED && (!m || (!m.includes('gemini-3.1-pro') && !m.includes('gemini-3.7-flash') && !m.includes('gemini-3.6-flash') && !m.includes('gemini-3.5-flash') && !m.includes('gemini-3.1-flash') && !m.includes('gemini-3-flash') && !m.includes('deepseek:') && !m.includes('Thủ công'))))
                    ); 
                }
                return statusMatch && modelMatch;
            });
        }
        return filtered;
    }, [props.files, props.filterStatuses, props.filterModels, props.selectedFiles, props.ratioLimits, props.storyInfo.languages]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDisplayLimit(300);
    }, [props.currentPage, props.filterStatuses, props.filterModels]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        if (props.currentPage !== 0) return;
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        if (scrollHeight - scrollTop <= clientHeight + 800) {
            setDisplayLimit(prev => Math.min(prev + 100, filteredFiles.length));
        }
    }, [props.currentPage, filteredFiles.length]);

    const localVisibleFiles = useMemo(() => {
        if (props.currentPage === 0) return filteredFiles.slice(0, displayLimit); 
        const startIndex = (props.currentPage - 1) * 100; // Change to 100
        const endIndex = startIndex + 100;
        return filteredFiles.slice(startIndex, endIndex);
    }, [filteredFiles, props.currentPage, displayLimit]);

    const { filterStatuses, filterModels, setSelectedFiles } = props;
    const prevFiltersRef = useRef({ statuses: filterStatuses, models: filterModels });

    useEffect(() => {
        const statusesChanged = filterStatuses !== prevFiltersRef.current.statuses;
        const modelsChanged = filterModels !== prevFiltersRef.current.models;

        if (statusesChanged || modelsChanged) {
            prevFiltersRef.current = { statuses: filterStatuses, models: filterModels };
            
            if (filterStatuses.size === 0 && filterModels.size === 0) {
                setSelectedFiles(new Set());
            } else {
                const newSelected = new Set(filteredFiles.map(f => f.id));
                setSelectedFiles(newSelected);
            }
        }
    }, [filterStatuses, filterModels, filteredFiles, setSelectedFiles]);

    return (
        <div className="flex flex-col h-full relative animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden">
            {/* 1. Toolbar & Pagination - Flex Item */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shadow-elevation-1 flex-wrap gap-2 shrink-0 z-20">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full">
                     <button 
                        onClick={() => props.setCurrentPage(0)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ease-smooth shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${props.currentPage === 0 || props.totalPages === 0 ? 'bg-primary-600 text-white shadow-elevation-2' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                        Tất cả ({props.files.length})
                    </button>
                    {Array.from({ length: props.totalPages }).map((_, idx) => (
                        <button 
                            key={idx} 
                            onClick={() => props.setCurrentPage(idx + 1)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ease-smooth shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${props.currentPage === idx + 1 ? 'bg-primary-600 text-white shadow-elevation-2' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                            Trang {idx + 1}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={props.handleManualRescueCheck}
                        disabled={props.isProcessing}
                        title="Chủ động hậu kiểm lại các tệp ERROR/IDLE nghi bị đánh oan, không cần đợi bấm Bắt Đầu Dịch"
                        className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all duration-200 ease-smooth bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <RefreshCw className="w-3.5 h-3.5" /> Hậu kiểm lại ngay
                    </button>
                </div>
            </div>

            {/* 1.2 Rescue-Locked Banner - chỉ hiện khi có file đang ở diện "cứu hộ" (isRescueLocked),
                để người dùng biết cần bật DeepSeek mới xử lý tiếp được, thay vì chỉ
                thấy ERROR chung chung (đề xuất thêm). */}
            {counts.rescueLocked > 0 && (
                <div className="px-6 py-2.5 border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 flex items-center gap-2 shrink-0 z-10">
                    <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                        {counts.rescueLocked} tệp đang ở diện cứu hộ (hậu kiểm khởi động xác nhận lỗi thật) — chỉ dịch lại được qua DeepSeek. Bật vệ tinh này rồi Bắt Đầu Dịch lại để xử lý tiếp.
                    </span>
                </div>
            )}

            {/* 1.3 Auto-Stopped Banner - đề xuất cải thiện fix12: chỉ hiện khi hệ thống VỪA TỰ
                DỪNG do Gemini hết Quota toàn bộ (autoStoppedRemainingCount !== null), kèm 1 nút
                "Tiếp tục" nổi bật ngay tại chỗ thay vì người dùng phải tự nhớ bấm lại Bắt Đầu. */}
            {props.autoStoppedRemainingCount !== null && props.autoStoppedRemainingCount > 0 && (
                <div className="px-6 py-2.5 border-b border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/30 flex items-center justify-between gap-2 shrink-0 z-10 flex-wrap">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                        <span className="text-xs font-semibold text-sky-800 dark:text-sky-300">
                            Gemini hết Quota — đã tự dừng. Còn {props.autoStoppedRemainingCount} tệp chưa dịch.
                        </span>
                    </div>
                    <button
                        onClick={props.continueAfterAutoStop}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all duration-200 ease-smooth bg-sky-600 text-white hover:bg-sky-700 shadow-sm shrink-0"
                    >
                        <RefreshCw className="w-3.5 h-3.5" /> Tiếp tục dịch phần còn lại
                    </button>
                </div>
            )}
            {props.showFilterPanel && (
                <div className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 p-4 animate-in slide-in-from-top-2 shrink-0 z-10">
                    <div className="max-w-7xl mx-auto flex flex-col gap-4">
                        <div className="flex items-start gap-4">
                            <div className="w-24 text-xs font-bold text-slate-400 uppercase mt-2">Trạng thái:</div>
                            <div className="flex flex-wrap gap-2 flex-1">
                                {renderFilterBadge("Đã chọn", counts.selected, props.filterStatuses.has('selected'), () => props.toggleFilterStatus('selected'), 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800')}
                                {renderFilterBadge("Chưa dịch", counts.pending, props.filterStatuses.has('pending'), () => props.toggleFilterStatus('pending'), 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600')}
                                {renderFilterBadge("Hoàn thành", counts.completed, props.filterStatuses.has('completed'), () => props.toggleFilterStatus('completed'), 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800')}
                                {renderFilterBadge("Còn Raw", counts.raw, props.filterStatuses.has('raw'), () => props.toggleFilterStatus('raw'), 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800')}
                                {renderFilterBadge("Lỗi Gộp Chương", counts.merged, props.filterStatuses.has('merged'), () => props.toggleFilterStatus('merged'), 'bg-fuchsia-200 dark:bg-fuchsia-900 text-fuchsia-800 dark:text-fuchsia-200 border-fuchsia-300 dark:border-fuchsia-800', <Layers className="w-3.5 h-3.5" />)}
                                {renderFilterBadge("Tỉ lệ Ảo/Lệch", counts.lowRatio, props.filterStatuses.has('low_ratio'), () => {
                                    const isActive = props.filterStatuses.has('low_ratio');
                                    props.toggleFilterStatus('low_ratio');
                                    if (!isActive) {
                                        // Auto-select files with low ratio
                                        const lowRatioIds = new Set<string>();
                                        props.files.forEach(f => {
                                            if (f.status === FileStatus.COMPLETED && f.translatedContent) {
                                                const integrity = validateTranslationIntegrity(f.content, f.translatedContent, props.ratioLimits, props.storyInfo.languages, f.usedModel);
                                                if (!integrity.isValid && integrity.reason?.toLowerCase().includes('tỷ lệ')) {
                                                    lowRatioIds.add(f.id);
                                                }
                                            } else if (f.status === FileStatus.ERROR && (f.errorMessage?.toLowerCase().includes('tỷ lệ') || f.errorMessage?.toLowerCase().includes('ratio'))) {
                                                lowRatioIds.add(f.id);
                                            }
                                        });
                                        props.setSelectedFiles(lowRatioIds);
                                    }
                                }, 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800', <AlertTriangle className="w-3.5 h-3.5" />)}
                                {renderFilterBadge("Nghi vấn (Lỗi/Nhầm)", counts.suspicious, props.filterStatuses.has('suspicious'), () => {
                                    const isActive = props.filterStatuses.has('suspicious');
                                    props.toggleFilterStatus('suspicious');
                                    if (!isActive) {
                                        const suspiciousIds = new Set<string>();
                                        props.files.forEach(f => {
                                            if (f.errorMessage && (f.errorMessage.includes('phân loại riêng') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.includes('Nghi vấn lỗi nội dung') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT'))) {
                                                suspiciousIds.add(f.id);
                                            }
                                        });
                                        props.setSelectedFiles(suspiciousIds);
                                    }
                                }, 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800', <AlertTriangle className="w-3.5 h-3.5" />)}
                                {renderFilterBadge("Không dịch (Lỗi)", counts.unchanged, props.filterStatuses.has('unchanged'), () => props.toggleFilterStatus('unchanged'), 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800', <Copy className="w-3.5 h-3.5" />)}
                                {renderFilterBadge("Lỗi/Chờ", counts.error + counts.processing, props.filterStatuses.has('error'), () => props.toggleFilterStatus('error'), 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800')}
                                {renderFilterBadge("Cứu hộ (chờ DeepSeek)", counts.rescueLocked, props.filterStatuses.has('rescue_locked'), () => props.toggleFilterStatus('rescue_locked'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800', <ShieldAlert className="w-3.5 h-3.5" />)}
                                {renderFilterBadge("Lỗi Tiếng Anh", counts.english, props.filterStatuses.has('english'), () => props.toggleFilterStatus('english'), 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800')}
                                {renderFilterBadge("Quá ngắn (<1200)", counts.short, props.filterStatuses.has('short'), () => props.toggleFilterStatus('short'), 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600')}
                                {renderFilterBadge("Ngoài truyện (AI)", counts.nonStory, props.filterStatuses.has('non_story'), () => props.toggleFilterStatus('non_story'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800')}
                            </div>
                        </div>
                        <div className="flex items-start gap-4 border-t border-slate-200 dark:border-slate-700 pt-3">
                            <div className="w-24 text-xs font-bold text-slate-400 uppercase mt-2">Model:</div>
                            <div className="flex flex-wrap gap-2 flex-1">
                                {renderFilterBadge("3.1 Pro", counts.m31pro, props.filterModels.has('31pro'), () => props.toggleFilterModel('31pro'), 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800')}
                                {renderFilterBadge("3.7 Flash", counts.m37flash, props.filterModels.has('37flash'), () => props.toggleFilterModel('37flash'), 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800')}
                                {renderFilterBadge("3.6 Flash", counts.m36flash, props.filterModels.has('36flash'), () => props.toggleFilterModel('36flash'), 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800')}
                                {renderFilterBadge("3.5 Flash", counts.m35flash, props.filterModels.has('35flash'), () => props.toggleFilterModel('35flash'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800')}
                                {renderFilterBadge("3.0 Flash", counts.m3flash, props.filterModels.has('3flash'), () => props.toggleFilterModel('3flash'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800')}
                                {renderFilterBadge("3.5 Flash Lite", counts.m35flashlite, props.filterModels.has('35flashlite'), () => props.toggleFilterModel('35flashlite'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800')}
                                {renderFilterBadge("3.1 Flash Lite", counts.m31flashlite, props.filterModels.has('31flashlite'), () => props.toggleFilterModel('31flashlite'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800')}
                                {renderFilterBadge("DeepSeek", counts.mDeepSeek, props.filterModels.has('deepseek'), () => props.toggleFilterModel('deepseek'), 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800')}
                                {renderFilterBadge("Thủ công", counts.mManual, props.filterModels.has('manual'), () => props.toggleFilterModel('manual'), 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800')}
                                {renderFilterBadge("Khác", counts.mOther, props.filterModels.has('other'), () => props.toggleFilterModel('other'), 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700')}
                            </div>
                            <button onClick={props.clearFilters} className="px-3 py-1.5 text-xs font-bold text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/20 rounded-lg transition-colors duration-200 ease-smooth ml-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                                Xóa bộ lọc
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. File Grid - Main Scrollable Area (Flex-1) */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-slate-50/50 dark:bg-slate-900/50" onScroll={handleScroll}>
                {props.files.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-300/50 dark:border-slate-700/50 rounded-3xl bg-white/50 dark:bg-slate-900/50">
                        <div className="p-8 bg-white dark:bg-slate-800 rounded-full shadow-xl shadow-indigo-100 dark:shadow-none mb-6 animate-bounce"><FileArchive className="w-16 h-16 text-indigo-200 dark:text-indigo-800" /></div>
                        <h3 className="text-xl font-display font-bold text-slate-600 dark:text-slate-300 mb-2">Chưa có file nào</h3>
                        <p className="text-sm text-slate-400 dark:text-slate-500 mb-8 max-w-xs text-center">Kéo thả file .txt, .zip, .epub, .pdf vào đây</p>
                        <label className="px-8 py-3 bg-primary-600 text-white rounded-xl font-bold shadow-elevation-3 hover:bg-primary-700 hover:shadow-elevation-4 cursor-pointer transition-all duration-200 ease-smooth flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                            <FileUp className="w-4 h-4" /> Tải Truyện Lên
                            <input type="file" multiple accept=".txt,.zip,.epub,.docx,.doc,.pdf,.srt,.vtt" className="hidden" onChange={props.handleFileUpload} />
                        </label>
                    </div>
                ) : localVisibleFiles.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-300/50 dark:border-slate-700/50 rounded-3xl bg-white/50 dark:bg-slate-900/50">
                        <div className="p-8 bg-white dark:bg-slate-800 rounded-full shadow-xl shadow-indigo-100 dark:shadow-none mb-6"><FileArchive className="w-16 h-16 text-slate-300 dark:text-slate-600" /></div>
                        <h3 className="text-xl font-display font-bold text-slate-600 dark:text-slate-300 mb-2">Không có file nào khớp với bộ lọc</h3>
                        <p className="text-sm text-slate-400 dark:text-slate-500 mb-8 max-w-xs text-center">Hãy thử thay đổi hoặc xóa bộ lọc để xem các file khác.</p>
                        <button onClick={props.clearFilters} className="px-8 py-3 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                            Xóa Bộ Lọc
                        </button>
                    </div>
                ) : (
                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {localVisibleFiles.map(file => (
                            <FileCard 
                                key={file.id}
                                file={file}
                                isSelected={props.selectedFiles.has(file.id)}
                                storyInfo={props.storyInfo}
                                ratioLimits={props.ratioLimits}
                                handleSelectFile={stableFileCardHandlers.handleSelectFile}
                                handleManualFixSingle={stableFileCardHandlers.handleManualFixSingle}
                                requestRetranslateSingle={stableFileCardHandlers.requestRetranslateSingle}
                                handleAutoSplitChapters={stableFileCardHandlers.handleAutoSplitChapters}
                                handleRescueCopy={stableFileCardHandlers.handleRescueCopy}
                                openEditor={stableFileCardHandlers.openEditor}
                                handleRemoveFile={stableFileCardHandlers.handleRemoveFile}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
