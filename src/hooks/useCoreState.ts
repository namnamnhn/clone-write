/* eslint-disable react-hooks/set-state-in-effect, react-hooks/preserve-manual-memoization */

import { useState, useRef, useEffect, useCallback } from 'react';
import { StoryInfo, FileItem, ModelQuota, BatchLimits, RatioLimits, CreativeState, SinoVietnameseState, FixErrorState } from '../types';
import { DEFAULT_PROMPT, MODEL_CONFIGS } from '../constants';
import { DEFAULT_RATIO_LIMITS } from '../constants/ratioLimits';
import { loadFromStorage, saveToStorage, clearDatabase, saveBackupSnapshot } from '../utils/storage';
import { quotaManager } from '../utils/quotaManager';
import { base64ToFile, fileToBase64, reconcileStaleRescueLocks, reconcileStaleRawCount } from '../utils/fileHelpers';
import { createSafeSetter } from './coreState/createSafeSetter';

const STORAGE_KEY = 'current_session_v1';

// LƯU Ý: languages/genres để mảng RỖNG mặc định (KHÔNG pre-fill 'Tiếng Trung'/'Tiên Hiệp' như
// trước) - giá trị pre-fill trông giống dữ liệu thật khiến người dùng/Auto Phân Tích dễ tưởng
// nhầm là đã có thông tin rồi (vd hasMetadata ở useAutomation.ts/useMainUI.ts kiểm tra
// genres.length > 0 để quyết định có bỏ qua bước xem lại Story Info hay không - để mặc định
// có sẵn 'Tiên Hiệp' khiến bước đó luôn bị coi là "đã có" dù người dùng chưa hề nhập gì).
export const initialStoryInfo: StoryInfo = { 
    title: '', author: '', languages: [], genres: [], 
    mcPersonality: [], worldSetting: [], sectFlow: [], contextNotes: '', summary: '', additionalRules: '',
    enableTitleFormatting: true, enableAutoFormat: true, tagFormat: 'auto'
};

export const initialCreativeState: CreativeState = {
    prompt: '',
    chapters: [],
    summary: '',
    suggestions: [],
    isGenerating: false,
    isSummarizing: false,
    targetChapters: 10,
    totalTargetChapters: 200,
    customNextPrompt: '',
    setup: {},
    characters: []
};

export const initialSinoVietnameseState: SinoVietnameseState = {
    unfixedList: '',
    fixedList: ''
};

export const initialFixErrorState: FixErrorState = {
    prompt: '',
    imageBase64: null
};

export const useCoreState = (addToast: (msg: string, type: 'success'|'error'|'info' | 'warning') => void) => {
    const [files, setFiles] = useState<FileItem[]>([]);
    const [storyInfo, setStoryInfo] = useState<StoryInfo>(initialStoryInfo);
    const [creativeState, setCreativeState] = useState<CreativeState>(initialCreativeState);
    const [sinoVietnameseState, setSinoVietnameseState] = useState<SinoVietnameseState>(initialSinoVietnameseState);
    const [fixErrorState, setFixErrorState] = useState<FixErrorState>(initialFixErrorState);
    const [promptTemplate, setPromptTemplate] = useState<string>(DEFAULT_PROMPT);
    const [additionalDictionary, setAdditionalDictionary] = useState<string>('');
    const [coverImage, setCoverImage] = useState<File | null>(null);
    const [autoSaveInterval, setAutoSaveInterval] = useState<number>(2);
    const [enabledModels, setEnabledModels] = useState<string[]>(MODEL_CONFIGS.map(m => m.id));
    const [modelConfigs, setModelConfigs] = useState<ModelQuota[]>(MODEL_CONFIGS);
    // fix44: OpenRouter đã bị loại bỏ hoàn toàn khỏi hệ thống — chỉ còn DeepSeek làm vệ tinh.
    const [deepseekKey, setDeepseekKey] = useState<string>(() => {
        try { return localStorage.getItem('app_deepseek_key') || ''; } catch { return ''; }
    });
    const [deepseekModel, setDeepseekModel] = useState<string>(() => {
        try { return localStorage.getItem('app_deepseek_model') || 'deepseek-v4-flash'; } catch { return 'deepseek-v4-flash'; }
    });

    // Đề xuất cải thiện tồn đọng: các khoảng nghỉ (delay) giữa các lô hậu kiểm khởi động trước
    // đây là hằng số cố định trong code (aiValidation.ts/startupTriage.ts), không tinh chỉnh
    // được theo rate-limit thực tế của người dùng. Lưu nhẹ qua localStorage (không đi qua
    // stateRef/createSafeSetter như các state dịch chính - đây chỉ là tham số tinh chỉnh tốc độ,
    // không phải dữ liệu cần bảo vệ khỏi mất mát/đè lẫn nhau).
    const DEFAULT_TRIAGE_DELAYS = { staggerDelayMs: 2500, recoveryBatchDelayMs: 3000, diagnosisBatchDelayMs: 2000 };
    const [triageDelays, setTriageDelaysState] = useState<typeof DEFAULT_TRIAGE_DELAYS>(() => {
        try {
            const raw = localStorage.getItem('app_triage_delays');
            if (raw) return { ...DEFAULT_TRIAGE_DELAYS, ...JSON.parse(raw) };
        } catch { /* ignore malformed value, fall back to default */ }
        return DEFAULT_TRIAGE_DELAYS;
    });
    const setTriageDelays = useCallback((partial: Partial<typeof DEFAULT_TRIAGE_DELAYS>) => {
        setTriageDelaysState(prev => {
            const next = { ...prev, ...partial };
            try { localStorage.setItem('app_triage_delays', JSON.stringify(next)); } catch { /* localStorage không khả dụng - vẫn giữ trong state phiên hiện tại */ }
            return next;
        });
    }, []);
    
    // NEW: Real-time Usage Stats
    const [modelUsages, setModelUsages] = useState(quotaManager.getUsageSnapshot());

    // Limits - AGGRESSIVE BATCHING DEFAULTS (Tuned for Stability)
    const [batchLimits, setBatchLimits] = useState<BatchLimits>({
        // Latin (Vietnamese/Convert): Safer limit to avoid timeouts/output cuts
        latin: { v36: 6, v35: 6, v3: 6, v31: 10, v25: 6, maxTotalChars: 90000 },
        // Raw/Complex: Conservative due to token density
        complex: { v36: 6, v35: 6, v3: 6, v31: 10, v25: 6, maxTotalChars: 45000 }
    });
    
    // UPDATED RATIO LIMITS
    const [ratioLimits, setRatioLimits] = useState<RatioLimits>({
        vn: { ...DEFAULT_RATIO_LIMITS.vn },
        en: { ...DEFAULT_RATIO_LIMITS.en },
        krjp: { ...DEFAULT_RATIO_LIMITS.krjp },
        cn: { ...DEFAULT_RATIO_LIMITS.cn },
    });

    const [concurrency, setConcurrency] = useState<number | 'auto'>('auto');
    const [isResetting, setIsResetting] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const lastSavedRef = useRef<Date | null>(null);
    // NÂNG CẤP #10: throttle snapshot auto-backup (1 lần/10 phút)
    const lastAutoBackupRef = useRef<number>(0);
    const [isAutoSaving, setIsAutoSaving] = useState(false);
    const [loadError, setLoadError] = useState(false); // NEW: Track load failure
    const isResettingRef = useRef(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const isLoadedRef = useRef(false); // NEW: Prevent saving before load
    const isStateSyncedRef = useRef(false); // NEW: Prevent saving stale state before React commits
    const isSyncFailedRef = useRef(false); // NEW: Prevent overwriting state if save failed
    const hasUnsavedChangesRef = useRef(false);
    
    // Subscribe to QuotaManager updates
    useEffect(() => {
        const unsubscribe = quotaManager.subscribe(() => {
            setModelUsages(quotaManager.getUsageSnapshot());
        });
        return unsubscribe;
    }, []);

    // Ref for saving to avoid stale closures in timeouts.
    // (Được đưa lên sớm hơn vị trí cũ để các setter "an toàn" bên dưới có thể tham chiếu
    // tới stateRef ngay khi khai báo, thay vì phải định nghĩa 14 khối trùng lặp riêng lẻ.)
    const stateRef = useRef({ files, promptTemplate, storyInfo, creativeState, sinoVietnameseState, fixErrorState, additionalDictionary, autoSaveInterval, enabledModels, modelConfigs, batchLimits, ratioLimits, coverImage, concurrency, deepseekKey, deepseekModel });

    // Custom setters to update stateRef immediately
    //
    // Lý do tắt các rule react-hooks bên dưới: eslint-plugin-react-hooks v7 (hướng tới React
    // Compiler) chỉ chấp nhận literal inline function làm tham số đầu của useCallback nên không
    // "nhìn xuyên" được qua lớp hàm factory createSafeSetter(...) — báo nhầm "đọc ref lúc render".
    // Thực tế stateRef.current chỉ được đọc BÊN TRONG hàm mà createSafeSetter trả về, tức là lúc
    // người dùng gọi setter (event handler) sau này, không phải lúc component render — nên không
    // có bug thật ở đây.
    /* eslint-disable react-hooks/refs, react-hooks/use-memo, react-hooks/exhaustive-deps */
    const setFilesSafe = useCallback(createSafeSetter<FileItem[]>('files', setFiles, stateRef), []);

    const setStoryInfoSafe = useCallback(createSafeSetter<StoryInfo>('storyInfo', setStoryInfo, stateRef), []);

    const setPromptTemplateSafe = useCallback(createSafeSetter<string>('promptTemplate', setPromptTemplate, stateRef), []);

    const setAdditionalDictionarySafe = useCallback(createSafeSetter<string>('additionalDictionary', setAdditionalDictionary, stateRef), []);

    const setCoverImageSafe = useCallback(createSafeSetter<File | null>('coverImage', setCoverImage, stateRef), []);

    const setEnabledModelsSafe = useCallback(createSafeSetter<string[]>('enabledModels', setEnabledModels, stateRef), []);

    const setBatchLimitsSafe = useCallback(createSafeSetter<BatchLimits>('batchLimits', setBatchLimits, stateRef), []);

    const setRatioLimitsSafe = useCallback(createSafeSetter<RatioLimits>('ratioLimits', setRatioLimits, stateRef), []);

    const setConcurrencySafe = useCallback(createSafeSetter<number | 'auto'>('concurrency', setConcurrency, stateRef), []);

    const setAutoSaveIntervalSafe = useCallback(createSafeSetter<number>('autoSaveInterval', setAutoSaveInterval, stateRef), []);

    const setCreativeStateSafe = useCallback(createSafeSetter<CreativeState>('creativeState', setCreativeState, stateRef), []);

    const setSinoVietnameseStateSafe = useCallback(createSafeSetter<SinoVietnameseState>('sinoVietnameseState', setSinoVietnameseState, stateRef), []);

    const setFixErrorStateSafe = useCallback(createSafeSetter<FixErrorState>('fixErrorState', setFixErrorState, stateRef), []);

    const setModelConfigsSafe = useCallback(createSafeSetter<ModelQuota[]>('modelConfigs', setModelConfigs, stateRef), []);

    const setDeepseekKeySafe = useCallback(createSafeSetter<string>('deepseekKey', setDeepseekKey, stateRef, (next) => {
        try { localStorage.setItem('app_deepseek_key', next); } catch {}
    }), []);

    const setDeepseekModelSafe = useCallback(createSafeSetter<string>('deepseekModel', setDeepseekModel, stateRef, (next) => {
        try { localStorage.setItem('app_deepseek_model', next); } catch {}
    }), []);
    /* eslint-enable react-hooks/refs, react-hooks/use-memo, react-hooks/exhaustive-deps */

    // We no longer use a useEffect to sync stateRef.current.
    // The safe setters update stateRef.current immediately, preventing race conditions
    // where useEffect from an older render overwrites newer state.

    const loadData = useCallback(async () => {
        if (isSyncFailedRef.current) {
            console.warn("Skipping loadData because local state has unsaved changes (sync failed).");
            return;
        }
        try {
            const data = await loadFromStorage(STORAGE_KEY);
            if (data) {
                // FIX (fix21): dọn cờ isRescueLocked treo oan trên file đã COMPLETED trước khi
                // đưa vào state - xem giải thích chi tiết tại reconcileStaleRescueLocks().
                // FIX (fix56): tự sửa luôn remainingRawCharCount sai kẹt lại từ phiên cũ - xem
                // giải thích chi tiết tại reconcileStaleRawCount().
                if (data.files) setFilesSafe(reconcileStaleRawCount(reconcileStaleRescueLocks(data.files)));
                if (data.promptTemplate) setPromptTemplateSafe(data.promptTemplate);
                if (data.storyInfo) {
                    const mergeArrays = (arr: any, fallback: any[]) => Array.isArray(arr) ? arr : fallback;
                    setStoryInfoSafe({ 
                        ...initialStoryInfo, 
                        ...data.storyInfo,
                        languages: mergeArrays(data.storyInfo.languages, []),
                        genres: mergeArrays(data.storyInfo.genres, []),
                        mcPersonality: mergeArrays(data.storyInfo.mcPersonality, []),
                        worldSetting: mergeArrays(data.storyInfo.worldSetting, []),
                        sectFlow: mergeArrays(data.storyInfo.sectFlow, [])
                    });
                }
                if (data.creativeState) setCreativeStateSafe({ ...initialCreativeState, ...data.creativeState });
                if (data.sinoVietnameseState) setSinoVietnameseStateSafe({ ...initialSinoVietnameseState, ...data.sinoVietnameseState });
                if (data.fixErrorState) setFixErrorStateSafe({ ...initialFixErrorState, ...data.fixErrorState });
                if (data.additionalDictionary) setAdditionalDictionarySafe(data.additionalDictionary);
                if (data.autoSaveInterval) setAutoSaveIntervalSafe(data.autoSaveInterval);
                if (data.concurrency) setConcurrencySafe(data.concurrency);

                // fix44: OpenRouter đã bị loại bỏ — dọn luôn key/cấu hình cũ trong localStorage
                // và trong dữ liệu phiên đã lưu để tránh nhầm lẫn khi đọc log/khôi phục.
                try {
                    localStorage.removeItem('app_openrouter_key');
                    localStorage.removeItem('app_openrouter_model');
                } catch {}
                delete (data as any).openRouterKey;
                delete (data as any).openRouterModel;

                let lsDeepseekKey: string | null = null;
                let lsDeepseekModel: string | null = null;
                try {
                    lsDeepseekKey = localStorage.getItem('app_deepseek_key');
                    lsDeepseekModel = localStorage.getItem('app_deepseek_model');
                } catch {}

                if (lsDeepseekKey !== null) {
                    setDeepseekKeySafe(lsDeepseekKey);
                } else if (data.deepseekKey) {
                    setDeepseekKeySafe(data.deepseekKey);
                }

                const actualDeepseekModel = lsDeepseekModel !== null ? lsDeepseekModel : data.deepseekModel;
                if (actualDeepseekModel) {
                    setDeepseekModelSafe(actualDeepseekModel);
                }
                
                if (data.enabledModels) {
                    const validModels = data.enabledModels.filter((id: string) => MODEL_CONFIGS.some(m => m.id === id));
                    if (!validModels.includes('gemini-3.6-flash')) validModels.push('gemini-3.6-flash');
                    // Model mới Gemini 3.7 Flash: dữ liệu cũ chưa có id này -> tự bật mặc định.
                    if (!validModels.includes('gemini-3.7-flash')) validModels.push('gemini-3.7-flash');
                    if (!validModels.includes('gemini-3.5-flash-lite')) validModels.push('gemini-3.5-flash-lite');
                    if (!validModels.includes('gemini-3.1-flash-lite')) validModels.push('gemini-3.1-flash-lite');
                    if (!validModels.includes('gemini-3.5-flash')) validModels.push('gemini-3.5-flash');
                    if (!validModels.includes('gemini-3-flash-preview')) validModels.push('gemini-3-flash-preview');
                    if (!validModels.includes('gemini-3.1-flash-lite-image')) validModels.push('gemini-3.1-flash-lite-image');
                    if (!validModels.includes('gemma-4-26b-a4b-it')) validModels.push('gemma-4-26b-a4b-it');
                    if (!validModels.includes('gemma-4-31b-it')) validModels.push('gemma-4-31b-it');
                    setEnabledModelsSafe(validModels);
                    quotaManager.setEnabledModels(validModels);
                } else {
                    quotaManager.setEnabledModels(MODEL_CONFIGS.map(m => m.id));
                }

                if (data.batchLimits) {
                    const bl = { ...data.batchLimits };
                    if (bl.latin) {
                        if (bl.latin.v31 === undefined) bl.latin.v31 = 10;
                        if (bl.latin.v36 === undefined) bl.latin.v36 = 6;
                        if (bl.latin.v35 === undefined || bl.latin.v35 === 5 || bl.latin.v35 === 10) bl.latin.v35 = 6;
                    }
                    if (bl.complex) {
                        if (bl.complex.v31 === undefined) bl.complex.v31 = 10;
                        if (bl.complex.v36 === undefined) bl.complex.v36 = 6;
                        if (bl.complex.v35 === undefined || bl.complex.v35 === 5 || bl.complex.v35 === 10) bl.complex.v35 = 6;
                    }
                    
                    // We removed the forced overwrite logic so custom values (1-100) are preserved
                    
                    setBatchLimitsSafe(bl);
                }
                if (data.ratioLimits) {
                    const rl = { ...data.ratioLimits };
                    if (!rl.vn) rl.vn = { ...DEFAULT_RATIO_LIMITS.vn };
                    if (!rl.en) rl.en = { ...DEFAULT_RATIO_LIMITS.en };
                    if (!rl.krjp) rl.krjp = { ...DEFAULT_RATIO_LIMITS.krjp };
                    if (!rl.cn) rl.cn = { ...DEFAULT_RATIO_LIMITS.cn };
                    setRatioLimitsSafe(rl);
                }
                if (data.coverImageBase64) {
                     try { setCoverImageSafe(base64ToFile(data.coverImageBase64, "restored_cover.png")); } catch { /* ignore */ }
                } else if (data.coverImage && data.coverImage instanceof Blob) {
                     setCoverImageSafe(data.coverImage as File);
                }
                if (data.lastSaved) {
                    const savedDate = new Date(data.lastSaved);
                    setLastSaved(savedDate);
                    lastSavedRef.current = savedDate;
                    try { localStorage.setItem('app_global_last_saved', savedDate.getTime().toString()); } catch {}
                } else {
                    try { localStorage.removeItem('app_global_last_saved'); } catch {}
                }
                
                // Sync quota manager
                quotaManager.updateConfigs(MODEL_CONFIGS);
                
                // Update initial usages
                setModelUsages(quotaManager.getUsageSnapshot());
            } else {
                // DB is empty. Clear localStorage to prevent stale tab detection from blocking the first save.
                try { localStorage.removeItem('app_global_last_saved'); } catch {}
            }
            // Mark as loaded ONLY if we successfully finished the load process
            isStateSyncedRef.current = true; // State is synced immediately because we use Safe setters
            isLoadedRef.current = true;
            setIsLoaded(true);
        } catch (err) { 
            console.error("Restore failed (Database Locked or Error):", err); 
            setLoadError(true);
            setIsLoaded(true); // Still mark as loaded so UI can show error
            addToast("Lỗi kết nối bộ nhớ! Dữ liệu cũ có thể bị tạm khóa. Vui lòng tải lại trang hoặc đổi trình duyệt.", "error");
        }
    }, [addToast, setAdditionalDictionarySafe, setAutoSaveIntervalSafe, setBatchLimitsSafe, setCoverImageSafe, setEnabledModelsSafe, setFilesSafe, setPromptTemplateSafe, setRatioLimitsSafe, setStoryInfoSafe, setCreativeStateSafe, setSinoVietnameseStateSafe, setFixErrorStateSafe, setConcurrencySafe, setDeepseekKeySafe, setDeepseekModelSafe]);

    // Load from storage
    useEffect(() => {
        if (navigator.storage && navigator.storage.persist) { 
            navigator.storage.persist().then(granted => {
                if (!granted) console.warn("Storage persistence denied. Data may be cleared by browser.");
            }); 
        }
        loadData();
    }, [loadData]);  

    // Real-time Sync (BroadcastChannel)
    const [tabId] = useState(() => Math.random().toString(36).substring(2, 15));
    const tabIdRef = useRef(tabId);
    
    useEffect(() => {
        const channel = new BroadcastChannel('app_sync_channel');
        channel.onmessage = (event) => {
            if (event.data && event.data.type === 'RELOAD_DATA' && event.data.tabId !== tabIdRef.current) {
                console.log("Received sync event from another tab. Reloading data...");
                loadData();
            }
        };
        return () => channel.close();
    }, [loadData]);

    // Sync enabled models to QuotaManager whenever changed
    useEffect(() => { quotaManager.setEnabledModels(enabledModels); }, [enabledModels]);

    const isSavingRef = useRef(false);
    const pendingSaveRef = useRef(false);
    const pendingForceRef = useRef(false);

    const saveSession = useCallback(async (force: boolean = false, overrideStale: boolean = false): Promise<boolean> => {
        if (isResettingRef.current || !isLoadedRef.current || loadError || !isStateSyncedRef.current) {
            console.warn("saveSession aborted:", { isResetting: isResettingRef.current, isLoaded: isLoadedRef.current, loadError, isStateSynced: isStateSyncedRef.current });
            return false;
        }
        
        if (isSavingRef.current) {
            pendingSaveRef.current = true;
            if (force) pendingForceRef.current = true;
            return true; // Consider it a success if it's successfully queued
        }
        
        isSavingRef.current = true;
        hasUnsavedChangesRef.current = false;
        const isForced = force || pendingForceRef.current;
        pendingForceRef.current = false;
        
        try {
            // Synchronous stale check using localStorage
            const localLastSaved = lastSavedRef.current ? lastSavedRef.current.getTime() : 0;
            let globalLastSavedStr = null;
            try { globalLastSavedStr = localStorage.getItem('app_global_last_saved'); } catch {}
            const globalLastSaved = globalLastSavedStr ? parseInt(globalLastSavedStr, 10) : 0;
            
            // CRITICAL: Never overwrite newer data with stale data, even if forced (e.g., on tab close)
            if (!overrideStale && globalLastSaved > localLastSaved) {
                console.warn("Stale tab detected via localStorage. Aborting save to prevent data loss.");
                if (!isForced) await loadData(); // Auto-reload only if not forcing (like page hide)
                return false;
            }
            
            setIsAutoSaving(true);
            
            if (!isForced && !overrideStale) {
                // Safe Save: Double check with DB just in case localStorage was cleared
                const currentDbData = await loadFromStorage(STORAGE_KEY);
                if (currentDbData && currentDbData.lastSaved) {
                    const dbLastSaved = new Date(currentDbData.lastSaved).getTime();
                    if (dbLastSaved > localLastSaved) {
                        console.warn("Found newer data in DB. Aborting save and reloading...");
                        await loadData();
                        return false;
                    }
                }

            }
            const newLastSaved = new Date();
            const dataToSave: any = { ...stateRef.current, lastSaved: newLastSaved.toISOString() };
            
            // Convert coverImage to base64 for safe storage (prevents DataCloneError in some browsers)
            if (dataToSave.coverImage instanceof File) {
                try {
                    dataToSave.coverImageBase64 = await fileToBase64(dataToSave.coverImage);
                    delete dataToSave.coverImage;
                } catch (e) {
                    console.error("Failed to convert coverImage to base64", e);
                }
            }
            
            await saveToStorage(STORAGE_KEY, dataToSave);

            // NÂNG CẤP #10 — Auto-backup: chụp nhanh dữ liệu vừa lưu vào kho 'app_backups'
            // (IndexedDB, giữ 5 bản gần nhất). Chạy TỐI ĐA 1 lần/10 phút, nền, không chặn
            // luồng lưu chính; lỗi snapshot không bao giờ làm fail saveSession.
            if (Date.now() - lastAutoBackupRef.current > 10 * 60 * 1000) {
                lastAutoBackupRef.current = Date.now();
                saveBackupSnapshot(dataToSave).catch((e) => console.warn("Auto-backup snapshot failed:", e));
            }
            
            isSyncFailedRef.current = false;
            setLastSaved(newLastSaved);
            lastSavedRef.current = newLastSaved;
            
            try {
                localStorage.setItem('app_global_last_saved', newLastSaved.getTime().toString());
            } catch (e) {
                console.warn("Failed to save to localStorage, stale tab detection might be degraded:", e);
            }
            
            // Broadcast to other tabs
            const channel = new BroadcastChannel('app_sync_channel');
            channel.postMessage({ type: 'RELOAD_DATA', tabId: tabIdRef.current });
            channel.close();
            return true;
        } catch (e: any) { 
            console.error("Auto-save failed:", e); 
            isSyncFailedRef.current = true;
            hasUnsavedChangesRef.current = true;
            if (e.name === 'QuotaExceededError') {
                addToast("Bộ nhớ trình duyệt đã đầy! Hãy xóa bớt file hoặc backup.", "error");
            } else {
                // Show a generic error for other failures if forced (like during restore)
                if (isForced) addToast(`Lỗi lưu dữ liệu: ${e.message || 'Không xác định'}`, "error");
            }
            return false;
        } 
        finally { 
            setIsAutoSaving(false); 
            isSavingRef.current = false;
            if (pendingSaveRef.current) {
                pendingSaveRef.current = false;
                // Use setTimeout to avoid deep recursion
                setTimeout(() => saveSession(pendingForceRef.current), 0);
            }
        }
    }, [addToast, loadError, loadData]);

    // Track changes
    useEffect(() => {
        if (isLoadedRef.current) {
            hasUnsavedChangesRef.current = true;
        }
    }, [files, storyInfo, creativeState, sinoVietnameseState, fixErrorState, promptTemplate, additionalDictionary, enabledModels, batchLimits, ratioLimits, concurrency, autoSaveInterval, modelConfigs, coverImage, deepseekKey, deepseekModel]);

    // --- PERIODIC AUTO SAVE ---
    useEffect(() => {
        const intervalMs = (autoSaveInterval || 2) * 60 * 1000; // Default 2 minutes
        const handler = setInterval(() => {
            if (hasUnsavedChangesRef.current) {
                saveSession();
            }
        }, Math.max(10000, intervalMs)); // Minimum 10 seconds
        return () => clearInterval(handler);
    }, [autoSaveInterval, saveSession]);

    // --- AGGRESSIVE SAVE LISTENERS (Fix Cốc Cốc/Background Tabs) ---
    useEffect(() => {
        const handleVisibilityChange = () => {
            // When user switches tabs or minimizes, save IMMEDIATELY
            if (document.visibilityState === 'hidden') {
                console.log("App hidden: Triggering forced save...");
                saveSession(true);
            }
        };

        const handlePageHide = () => {
            // Last chance to save before page unload/freeze
            saveSession(true);
        };

        // Listen for visibility change (Tab switch) and Page Hide (Close/Refresh)
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('blur', handleVisibilityChange); // Also trigger on window blur

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('blur', handleVisibilityChange);
        };
    }, [saveSession]);

    const performSoftReset = async () => {
        setIsResetting(true);
        isResettingRef.current = true;
        await new Promise(r => setTimeout(r, 50));
        try {
            await clearDatabase();
            try { localStorage.clear(); } catch {}
            quotaManager.reset();
            setFilesSafe([]);
            setStoryInfoSafe(initialStoryInfo);
            setCreativeStateSafe(initialCreativeState);
            setSinoVietnameseStateSafe(initialSinoVietnameseState);
            setFixErrorStateSafe(initialFixErrorState);
            setPromptTemplateSafe(DEFAULT_PROMPT);
            setAdditionalDictionarySafe('');
            setCoverImageSafe(null);
            setEnabledModelsSafe(MODEL_CONFIGS.map(m => m.id));
            setModelUsages(quotaManager.getUsageSnapshot()); // Reset usage UI
            setBatchLimitsSafe({
                latin: { v36: 6, v35: 6, v3: 6, v31: 10, v25: 6, maxTotalChars: 90000 },
                complex: { v36: 6, v35: 6, v3: 6, v31: 10, v25: 6, maxTotalChars: 45000 }
            });
            // Reset ratio limits to new defaults
            setRatioLimitsSafe({
                vn: { ...DEFAULT_RATIO_LIMITS.vn },
                en: { ...DEFAULT_RATIO_LIMITS.en },
                krjp: { ...DEFAULT_RATIO_LIMITS.krjp },
                cn: { ...DEFAULT_RATIO_LIMITS.cn },
            });
            setConcurrencySafe('auto');
            setDeepseekKeySafe('');
            setDeepseekModelSafe('deepseek-v4-flash');
            addToast("Đã Reset toàn bộ dữ liệu!", "success");
        } catch {
            addToast("Lỗi khi reset, vui lòng tải lại trang.", "error");
        } finally {
            isResettingRef.current = false;
            setIsResetting(false);
        }
    };

    return {
        files, setFiles: setFilesSafe,
        storyInfo, setStoryInfo: setStoryInfoSafe,
        creativeState, setCreativeState: setCreativeStateSafe,
        sinoVietnameseState, setSinoVietnameseState: setSinoVietnameseStateSafe,
        fixErrorState, setFixErrorState: setFixErrorStateSafe,
        promptTemplate, setPromptTemplate: setPromptTemplateSafe,
        additionalDictionary, setAdditionalDictionary: setAdditionalDictionarySafe,
        coverImage, setCoverImage: setCoverImageSafe,
        autoSaveInterval, setAutoSaveInterval: setAutoSaveIntervalSafe,
        enabledModels, setEnabledModels: setEnabledModelsSafe,
        modelConfigs, setModelConfigs: setModelConfigsSafe,
        deepseekKey, setDeepseekKey: setDeepseekKeySafe,
        deepseekModel, setDeepseekModel: setDeepseekModelSafe,
        triageDelays, setTriageDelays,
        batchLimits, setBatchLimits: setBatchLimitsSafe,
        ratioLimits, setRatioLimits: setRatioLimitsSafe,
        concurrency, setConcurrency: setConcurrencySafe,
        isResetting, performSoftReset,
        isAutoSaving, lastSaved, saveSession,
        isLoaded, // EXPORTED HERE
        loadError, // EXPORTED HERE
        modelUsages, // EXPORTED HERE
        setModelUsages,
        stateRef
    };
};
