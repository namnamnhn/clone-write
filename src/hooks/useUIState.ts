
import { useState, useMemo, useCallback } from 'react';
import { Toast, LogContext, LogEntry, TranslationTier } from '../types';
import { loadPersistedLogs, persistLogs, schedulePersistLogs, clearPersistedLogs } from '../utils/logStore';
import { createSanitizedLogEntry, redactSensitiveText } from '../utils/logSanitizer';

const THEME_KEY = 'app_theme_preference';

export const useUIState = () => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        let storedTheme = null;
        try { storedTheme = localStorage.getItem(THEME_KEY); } catch {}
        if (storedTheme) return storedTheme === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    });
    const [showSettings, setShowSettings] = useState<boolean>(false);
    const [showLogs, setShowLogs] = useState<boolean>(false);
    const [toasts, setToasts] = useState<Toast[]>([]);
    // Khôi phục log từ localStorage lúc khởi tạo — để lịch sử log (kể cả log dẫn tới 1 lần
    // crash/tải lại trang trước đó) không biến mất khỏi UI, người dùng vẫn xem/xuất lại được.
    const [systemLogs, setSystemLogs] = useState<LogEntry[]>(() => loadPersistedLogs());
    
    // Filter State
    const [activeTab, setActiveTab] = useState<'dashboard' | 'workspace' | 'knowledge' | 'titles' | 'creative' | 'story-studio' | 'hanviet'>('dashboard');
    const [showFilterPanel, setShowFilterPanel] = useState<boolean>(false);
    const [filterModels, setFilterModels] = useState<Set<string>>(new Set());
    const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set());
    
    // Pagination / Selection State
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [rangeStart, setRangeStart] = useState<string>('');
    const [rangeEnd, setRangeEnd] = useState<string>('');
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

    // Modal States
    const [editingFileId, setEditingFileId] = useState<string | null>(null);
    const [showFindReplace, setShowFindReplace] = useState<boolean>(false);
    const [showPasteModal, setShowPasteModal] = useState<boolean>(false);
    const [splitterModal, setSplitterModal] = useState<{ isOpen: boolean, content: string, name: string, isTranslatedImport?: boolean, tempCover?: File | null }>({ isOpen: false, content: '', name: '' });
    const [zipActionModalState, setZipActionModalState] = useState<{ isOpen: boolean, sourceType: 'zip' | 'epub' }>({ isOpen: false, sourceType: 'zip' });
    const zipActionModal = zipActionModalState.isOpen;
    const zipActionModalSourceType = zipActionModalState.sourceType;
    const setZipActionModal = (isOpen: boolean, sourceType: 'zip' | 'epub' = 'zip') => {
        setZipActionModalState(prev => ({ isOpen, sourceType: isOpen ? sourceType : prev.sourceType }));
    };
    const [showGuide, setShowGuide] = useState<boolean>(false);
    const [showContextBuilder, setShowContextBuilder] = useState<boolean>(false);
    const [showSmartStartModal, setShowSmartStartModal] = useState<boolean>(false);
    const [smartStartStep, setSmartStartStep] = useState<'idle' | 'optimizing' | 'analyzing'>('idle');
    const [autoOptimizePrompt, setAutoOptimizePrompt] = useState<boolean>(true);
    const [showStartOptions, setShowStartOptions] = useState<boolean>(false);
    const [showNameAnalysisModal, setShowNameAnalysisModal] = useState<boolean>(false);
    const [isAnalyzingNames, setIsAnalyzingNames] = useState<boolean>(false);
    const [isRefiningContext, setIsRefiningContext] = useState<boolean>(false);
    const [showRetranslateModal, setShowRetranslateModal] = useState<boolean>(false);
    const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; isDanger: boolean; confirmText?: string; onCancel?: () => void }>({ isOpen: false, title: '', message: '', onConfirm: () => {}, isDanger: false });
    const [importModal, setImportModal] = useState<{ isOpen: boolean; pendingFiles: any[]; tempInfo?: any; tempCover?: File | null }>({ isOpen: false, pendingFiles: [] });
    const [showChangelog, setShowChangelog] = useState<boolean>(false);
    const [showPromptDesigner, setShowPromptDesigner] = useState<boolean>(false);
    const [showEpubModal, setShowEpubModal] = useState<boolean>(false);
    const [showAutomationModal, setShowAutomationModal] = useState<boolean>(false);
    const [showRawDownloadModal, setShowRawDownloadModal] = useState<boolean>(false);
    
    // New: Smart Automation Config State
    const [automationInitialConfig, setAutomationInitialConfig] = useState<{ steps: number[], rules: string, tier: TranslationTier, engine?: 'gemini' | 'deepseek' }>({ steps: [0,1,2,3,4,5,6,7], rules: 'Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.', tier: 'normal' });

    // Loaders
    const [importProgress, setImportProgress] = useState<{ current: number; total: number; message: string } | null>(null);
    const [actionProgress, setActionProgress] = useState<{ current: number; total: number; message: string } | null>(null);
    const [nameAnalysisProgress, setNameAnalysisProgress] = useState<{ current: number; total: number; stage: string }>({ current: 0, total: 0, stage: '' });
    
    // Test Model State
    const [testingModelId, setTestingModelId] = useState<string | null>(null);

    // Other UI
    const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
    const [viewOriginalPrompt, setViewOriginalPrompt] = useState<boolean>(false);
    const [dictTab, setDictTab] = useState<'custom' | 'default'>('custom');
    const [quickInput, setQuickInput] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
    const [isGeneratingCover, setIsGeneratingCover] = useState(false);
    const [autoAnalyzeStatus, setAutoAnalyzeStatus] = useState<string>('');

    // Theme Logic
    const toggleDarkMode = () => { const newMode = !isDarkMode; setIsDarkMode(newMode); try { localStorage.setItem(THEME_KEY, newMode ? 'dark' : 'light'); } catch {} };

    // Logging
    const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
        // FIX (bug treo giao diện): trước đây addToast luôn push toast mới bất kể nội dung, nên
        // nếu 1 hành động no-op bị gọi lặp lại liên tục (ví dụ effect lập lịch trong
        // useTranslator.ts tự re-run vì phụ thuộc vào object `ui` — object này bị tạo mới mỗi
        // render nên tự đổi tham chiếu ngay khi `toasts` đổi, tạo vòng lặp), y hệt 1 câu toast
        // ("Không có file nào cần sửa" chẳng hạn) bị chồng hàng chục/hàng trăm lần liên tiếp,
        // vừa che giao diện vừa làm trình duyệt lag/treo vì phải render+animate từng cái.
        // SỬA: nếu đã có toast TRÙNG Y HỆT nội dung+loại đang hiển thị thì bỏ qua, không thêm
        // mới. Tác dụng phụ có lợi: khi bị bỏ qua, state `toasts` không đổi -> chuỗi re-render
        // do vòng lặp ở trên (nếu có) cũng tự dừng theo, không cần sửa sâu vào effect lập lịch.
        // FIX (bug toast không tự tắt): trước đây dùng biến `wasAdded` gán bên TRONG hàm updater
        // của setToasts rồi kiểm tra ngay sau đó. Nhưng setToasts(prev => ...) là bất đồng bộ
        // (React 19 auto-batch mọi update state), updater chỉ chạy sau ở giai đoạn render, nên
        // `if (wasAdded)` đọc được gần như luôn là `false` -> setTimeout hẹn giờ xoá toast KHÔNG
        // bao giờ được lên lịch, toast nằm vĩnh viễn đến khi tự bấm X. SỬA: bỏ hẳn biến
        // `wasAdded`, LUÔN lên lịch xoá sau 5s ngay sau khi gọi setToasts. Nếu toast thực ra bị
        // dedupe (không được thêm), filter theo `id` không tìm thấy gì -> no-op, vô hại.
        const id = crypto.randomUUID();
        const safeMessage = redactSensitiveText(message);
        setToasts(prev => {
            if (prev.some(t => t.message === safeMessage && t.type === type)) return prev;
            // FIX47 (lớp bảo hiểm cho bug treo vì chồng toast - xem ảnh người dùng chụp): giới hạn
            // tối đa 5 toast hiển thị cùng lúc, tự bỏ bớt toast CŨ NHẤT khi vượt. Dù vì bất kỳ
            // nguyên nhân nào (loop, gọi dồn dập...) cũng không bao giờ còn hàng chục/hàng trăm
            // toast xếp chồng làm render nặng rồi treo giao diện như trước.
            return [...prev, { id, message: safeMessage, type }].slice(-5);
        });
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
        if (type === 'error' || type === 'success') {
            setSystemLogs(prev => {
                const next = [createSanitizedLogEntry(safeMessage, type, undefined, id), ...prev].slice(0, 500);
                // Log lỗi ghi NGAY xuống localStorage (quan trọng nhất, không được mất dù app
                // crash ngay sau đó). Log success ít khẩn cấp hơn, dùng debounce như log thường.
                if (type === 'error') persistLogs(next); else schedulePersistLogs(next);
                return next;
            });
        }
    }, []);

    const addLog = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info', context?: LogContext) => {
        const entry = createSanitizedLogEntry(message, type, context);
        setSystemLogs(prev => {
            const next = [entry, ...prev].slice(0, 500);
            if (type === 'error') persistLogs(next); else schedulePersistLogs(next);
            return next;
        });
    }, []);

    const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), []);
    const clearLogs = useCallback(() => { setSystemLogs([]); clearPersistedLogs(); }, []);

    const hasLogErrors = useMemo(() => systemLogs.some(l => l.type === 'error'), [systemLogs]);
    const isAutoAnalyzing = useMemo(() => !!autoAnalyzeStatus, [autoAnalyzeStatus]);

    return {
        activeTab, setActiveTab,
        isDarkMode, toggleDarkMode,
        showSettings, setShowSettings,
        showLogs, setShowLogs,
        toasts, addToast, removeToast,
        systemLogs, addLog, clearLogs, hasLogErrors,
        showFilterPanel, setShowFilterPanel,
        filterModels, setFilterModels,
        filterStatuses, setFilterStatuses,
        currentPage, setCurrentPage,
        rangeStart, setRangeStart,
        rangeEnd, setRangeEnd,
        selectedFiles, setSelectedFiles,
        lastSelectedId, setLastSelectedId,
        
        // Modals
        editingFileId, setEditingFileId,
        showFindReplace, setShowFindReplace,
        showPasteModal, setShowPasteModal,
        splitterModal, setSplitterModal,
        zipActionModal, setZipActionModal, zipActionModalSourceType,
        showGuide, setShowGuide,
        showContextBuilder, setShowContextBuilder,
        showSmartStartModal, setShowSmartStartModal,
        smartStartStep, setSmartStartStep,
        autoOptimizePrompt, setAutoOptimizePrompt,
        showStartOptions, setShowStartOptions,
        showNameAnalysisModal, setShowNameAnalysisModal,
        isAnalyzingNames, setIsAnalyzingNames,
        isRefiningContext, setIsRefiningContext,
        showRetranslateModal, setShowRetranslateModal,
        confirmModal, setConfirmModal,
        importModal, setImportModal,
        showChangelog, setShowChangelog,
        showPromptDesigner, setShowPromptDesigner,
        showEpubModal, setShowEpubModal,
        showAutomationModal, setShowAutomationModal,
        showRawDownloadModal, setShowRawDownloadModal,
        
        automationInitialConfig, setAutomationInitialConfig,

        importProgress, setImportProgress,
        actionProgress, setActionProgress,
        nameAnalysisProgress, setNameAnalysisProgress,
        testingModelId, setTestingModelId, // Added

        coverPreviewUrl, setCoverPreviewUrl,
        viewOriginalPrompt, setViewOriginalPrompt,
        dictTab, setDictTab,
        quickInput, setQuickInput,
        isDragging, setIsDragging,
        isOptimizingPrompt, setIsOptimizingPrompt,
        isGeneratingCover, setIsGeneratingCover,
        autoAnalyzeStatus, setAutoAnalyzeStatus,
        isAutoAnalyzing
    };
};
