import { useState, useRef, useEffect } from 'react';
import { FileItem, TranslationTier } from '../types';
import { DEFAULT_DICTIONARY, IS_LITE } from '../constants';
import { useTranslator } from './useTranslator';
import { useSmartFix } from './useSmartFix';
import { useTitleNormalizer } from './useTitleNormalizer';
import type { CoreApi, UIApi } from './apiTypes';
import type { FileTransactionStore } from './translator/fileTransactions';

export const useTranslationEngine = (core: CoreApi, ui: UIApi) => {
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [activeBatches, setActiveBatches] = useState<number>(0);
    const [processingQueue, setProcessingQueue] = useState<string[]>([]);
    // Bản Lite mặc định Flash (chỉ còn Flash/Lite); bản Full giữ nguyên 'normal'
    const [translationTier, setTranslationTier] = useState<TranslationTier>(IS_LITE ? 'flash' : 'normal');
    const [isSmartAutoMode, setIsSmartAutoMode] = useState<boolean>(false);
    const [autoFixEnabled, setAutoFixEnabled] = useState<boolean>(false);
    const [retryTrigger, setRetryTrigger] = useState<number>(0);
    
    const [startTime, setStartTime] = useState<number | null>(null);
    const [endTime, setEndTime] = useState<number | null>(null);
    // NEW (đề xuất cải thiện fix12 - "Tiếp tục dịch phần còn lại"): lưu số tệp còn lại CHƯA từng
    // thử khi hệ thống TỰ ĐỘNG dừng do Gemini hết Quota toàn bộ (xem geminiExhaustedRef trong
    // useTranslator.ts). null = không ở trạng thái vừa tự dừng. UI (MainUI.tsx) dùng cờ này để
    // hiện 1 banner/nút nổi bật ngay tại chỗ, thay vì người dùng phải tự nhớ bấm lại "Bắt Đầu".
    const [autoStoppedRemainingCount, setAutoStoppedRemainingCount] = useState<number | null>(null);
    
    // Refs
    const isFixPhaseRef = useRef<boolean>(false);
    const isProcessingRef = useRef<boolean>(false);
    const runIdRef = useRef<number>(0);
    const filesRef = useRef<FileItem[]>(core.files);
    const scheduledBatchesRef = useRef<Set<string>>(new Set());
    // BUGFIX (bước C): cờ tường minh báo "đang có 1 phiên Sửa Lỗi (Repair) thực sự chạy dưới nền".
    // Khác với state isProcessing (có thể bị các effect khác vô tình set sai/sớm), ref này CHỈ do
    // chính handleFixRemainingRaw bật/tắt, nên executeProcessing() và handleSmartFix() có thể dựa
    // vào đây để biết chắc có nên khởi động phiên mới (và tăng runIdRef) hay không.
    const isRepairRunningRef = useRef<boolean>(false);
    const fileTransactionsRef = useRef<FileTransactionStore>(new Map());

    useEffect(() => {
        filesRef.current = core.files;
    }, [core.files]);

    useEffect(() => {
        isProcessingRef.current = isProcessing;
    }, [isProcessing]);

    const effectiveDictionary = core.additionalDictionary ? DEFAULT_DICTIONARY + '\n' + core.additionalDictionary : DEFAULT_DICTIONARY;

    const sharedState = {
        isProcessing, setIsProcessing,
        activeBatches, setActiveBatches,
        processingQueue, setProcessingQueue,
        translationTier, setTranslationTier,
        isSmartAutoMode, setIsSmartAutoMode,
        autoFixEnabled, setAutoFixEnabled,
        retryTrigger, setRetryTrigger,
        startTime, setStartTime,
        endTime, setEndTime,
        autoStoppedRemainingCount, setAutoStoppedRemainingCount,
        isFixPhaseRef, isProcessingRef, runIdRef, filesRef, scheduledBatchesRef,
        isRepairRunningRef, fileTransactionsRef,
        effectiveDictionary
    };

    const smartFixFns = useSmartFix(core, ui, sharedState);
    const translatorFns = useTranslator(core, ui, sharedState, smartFixFns);
    const titleNormalizerFns = useTitleNormalizer(core, ui);

    return {
        isProcessing,
        isCustomFixing: smartFixFns.isCustomFixing,
        customFixProgress: smartFixFns.customFixProgress,
        activeBatches,
        processingQueue,
        translationTier,
        setTranslationTier,
        startTime,
        setStartTime,
        endTime,
        setEndTime,
        isSmartAutoMode,
        autoFixEnabled,
        autoStoppedRemainingCount,
        // NEW (đề xuất cải thiện fix12): tiếp tục dịch đúng các tệp còn lại sau khi hệ thống tự
        // dừng do Gemini hết Quota toàn bộ - gọi thẳng executeProcessing() với translationTier
        // GIỮ NGUYÊN như phiên vừa dừng (không cần mở lại StartOptionsModal chọn tier từ đầu).
        continueAfterAutoStop: () => {
            setAutoStoppedRemainingCount(null);
            translatorFns.executeProcessing();
        },
        isNormalizingTitles: titleNormalizerFns.isNormalizingTitles,
        
        executeProcessing: translatorFns.executeProcessing,
        prepareModelsForRun: translatorFns.prepareModelsForRun,
        runManualRescueCheck: translatorFns.runManualRescueCheck,
        runPostTranslationTriage: translatorFns.runPostTranslationTriage,
        stopProcessing: translatorFns.stopProcessing,
        handleRetranslateConfirm: translatorFns.handleRetranslateConfirm,
        
        handleCustomErrorCorrection: smartFixFns.handleCustomErrorCorrection,
        handleAnalyzeCustomError: smartFixFns.handleAnalyzeCustomError,
        stopCustomFixing: smartFixFns.stopCustomFixing,
        handleFixRemainingRaw: smartFixFns.handleFixRemainingRaw,
        handleManualAutoFixRaw: (mode: 'pro' | 'flash') => {
            const prepared = translatorFns.prepareModelsForRun(translationTier);
            if (!prepared) return false;
            const forcedModel = mode === 'pro' ? 'gemini-3.1-pro-preview' : 'gemini-3.8-flash';
            const enabledModels = Array.from(new Set([...prepared.enabledModels, forcedModel]));
            core.setEnabledModels(enabledModels);
            return smartFixFns.handleFixRemainingRaw(false, enabledModels, 2, [forcedModel]);
        },
        handleSmartFix: smartFixFns.handleSmartFix,
        handleManualFixSingle: smartFixFns.handleManualFixSingle,
        
        handleTitleNormalization: async (scope: 'all' | 'selected' = 'all') => {
            setStartTime(Date.now());
            setEndTime(null);
            const res = await titleNormalizerFns.handleTitleNormalization(scope);
            setEndTime(Date.now());
            return res;
        },
        stopTitleNormalization: titleNormalizerFns.stopTitleNormalization
    };
};
