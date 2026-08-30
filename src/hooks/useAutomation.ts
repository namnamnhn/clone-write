/* eslint-disable react-hooks/immutability */

import { useState, useRef, useEffect } from 'react';
import { AutomationConfig, FileStatus, FileItem } from '../types';
import { optimizePrompt } from '../services/workflows/analyze/promptRules';
import { autoAnalyzeStory } from '../services/workflows/analyze/autoAnalyze';
import { formatBookStyle, countForeignChars } from '../utils/text';
import { DEFAULT_PROMPT } from '../constants';
import { quotaManager } from '../utils/quotaManager';
import { getEffectiveModelsForTier } from '../services/workflows/translate/modelSelection';
import type { CoreApi, UIApi } from './apiTypes';

export const useAutomation = (core: CoreApi, ui: UIApi, engine: any, fileHandler?: any) => {
    const [automationState, setAutomationState] = useState<{
        isRunning: boolean;
        currentStep: number;
        pendingSteps: number[];
        config: AutomationConfig | null;
        countdown: number;
        totalSteps: number;
        stepStatus: string;
    }>({
        isRunning: false,
        currentStep: 0,
        pendingSteps: [],
        config: null,
        countdown: 0,
        totalSteps: 0,
        stepStatus: ''
    });

    const isAutomationWaitingRef = useRef<boolean>(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const hasSmartFixQuota = (tier = automationState.config?.tier || 'normal'): boolean => {
        if (tier === 'deepseek') return !!core.deepseekKey?.trim();
        const enabledModels = core.stateRef.current.enabledModels || core.enabledModels;
        const candidates = getEffectiveModelsForTier(tier, 'smart_fix', enabledModels);
        return candidates.some(modelId => !quotaManager.isModelDepleted(modelId));
    };

    // Resume automation after background task completion
    useEffect(() => {
        // BẢO VỆ KÉP: ngoài isProcessing/isNormalizingTitles (có thể bị đặt sai/sớm do timing bất
        // đồng bộ - xem giải thích chi tiết ở case 4 bên dưới), còn đòi hỏi thêm activeBatches===0
        // - đây là con số đếm trực tiếp số batch dịch ĐANG THỰC SỰ chạy (tăng/giảm đồng bộ ngay khi
        // 1 batch bắt đầu/kết thúc trong useTranslator.ts), nên là tín hiệu đáng tin cậy nhất để biết
        // "có thật sự không còn gì đang dịch hay không". Nếu activeBatches > 0 mà vì lý do nào đó
        // isProcessing lại về false sớm, effect này vẫn KHÔNG coi là đã xong, tránh lặp lại lỗi
        // "báo Hoàn Tất trong khi batch vẫn đang chạy" người dùng từng gặp.
        if (automationState.isRunning && isAutomationWaitingRef.current && !engine.isProcessing && !engine.isNormalizingTitles && (engine.activeBatches ?? 0) === 0) {
            isAutomationWaitingRef.current = false;
            // Background task finished (Step 4 or 5 or 6), state is stable here, so no override needed
            const skipCooldown = automationState.currentStep === 5 || automationState.currentStep === 6;
            resumeAutomationWithCooldown(undefined, skipCooldown);
        }
        // Cố ý KHÔNG thêm `resumeAutomationWithCooldown`/`automationState.currentStep` vào dependency
        // array: hàm này được tạo lại mỗi lần render (không bọc useCallback), nên nếu thêm vào deps,
        // effect sẽ chạy lại (và gọi resume) ở MỌI lần render trong lúc automation đang chạy, gây lặp vô ích.
        // Effect chỉ nên kích hoạt khi isProcessing/isNormalizingTitles chuyển từ true -> false; tại thời
        // điểm đó, hàm resumeAutomationWithCooldown được gọi vẫn là bản mới nhất của lần render hiện tại
        // (JS closure lấy giá trị tại thời điểm gọi, không phải tại thời điểm định nghĩa effect).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.isProcessing, engine.isNormalizingTitles, engine.activeBatches, automationState.isRunning]);

    const handleAutomationStart = (config: AutomationConfig) => {
        // FIX (bug thực tế 19/8: automation báo "Hoàn tất" trong khi 1 phiên dịch thủ công khác vẫn
        // chạy dở dưới nền): chặn chiều ngược lại - không cho khởi động Automation nếu đang có 1
        // phiên dịch/sửa lỗi thủ công (executeProcessing/handleRetranslateConfirm/handleSmartFix,
        // KHÔNG qua Automation) chạy dở. Xem giải thích đầy đủ ở App.tsx (handleConfirmStart/
        // handleRetranslateConfirm) - đây là nửa còn lại của cùng 1 cặp khoá 2 chiều, đảm bảo tại
        // 1 thời điểm chỉ có ĐÚNG 1 "chủ sở hữu" (Automation HOẶC thao tác thủ công) đang điều
        // khiển engine.isProcessing, tránh trường hợp cờ "đang chờ" của bên này bị bên kia làm tắt
        // sớm/muộn sai thời điểm.
        if (engine.isProcessing) {
            ui.addToast("Đang có phiên dịch/sửa lỗi thủ công chạy dở, vui lòng đợi hoàn tất hoặc bấm Dừng dịch trước khi chạy Tự động hóa - tránh 2 phiên dịch chạy chồng lên nhau.", "warning");
            return;
        }
        if (timerRef.current) clearInterval(timerRef.current);
        // Reset cờ "đang chờ" của phiên cũ: nếu không, cờ=true sót lại từ 1 bước đang chờ dịch
        // khi bị Dừng sẽ kết hợp với isRunning=true của phiên MỚI khiến effect resume phía trên
        // kích hoạt sớm (coi bước đang chạy là đã xong), skip/chạy trùng bước.
        isAutomationWaitingRef.current = false;
        ui.setSelectedFiles(new Set()); // Ensure all files are processed
        engine.setTranslationTier(config.tier);
        if (!config.steps.includes(4) && config.steps.some(step => step === 5)) {
            engine.prepareModelsForRun(config.tier, config.translationModels);
        }
        if (ui.setAutomationInitialConfig) {
            ui.setAutomationInitialConfig({ steps: config.steps, rules: (config.additionalRules || "").replace(/Nếu văn bản gốc chứa nội dung nhạy cảm.*thành công\./g, 'Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.'), tier: config.tier, engine: config.engine });
        }
        setAutomationState({
            isRunning: true,
            currentStep: 0,
            pendingSteps: config.steps,
            config,
            countdown: 0,
            totalSteps: config.steps.length,
            stepStatus: 'Khởi tạo...'
        });
        processNextAutomationStep(config.steps, config);
    };

    const stopAutomation = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        isAutomationWaitingRef.current = false;
        setAutomationState(prev => ({ ...prev, isRunning: false, countdown: 0 }));
        ui.addToast("🛑 Đã dừng quy trình tự động hóa", "info");
    };

    const handlePromptDesignerConfirm = async (config: { useSearch: boolean, useContext: boolean, useDictionary: boolean, additionalRules: string }) => {
        ui.setIsOptimizingPrompt(true);
        try {
            const contextToUse = config.useContext ? (core.storyInfo.contextNotes || "") : "";
            const dictToUse = config.useDictionary ? (core.additionalDictionary || "") : "";
            // FIX61+: gửi kèm MẪU RAW THẬT (đầu/giữa/cuối, mỗi mẫu tối đa 4000 ký tự) cho bước
            // Tối Ưu Prompt — để AI kiến trúc lại prompt dựa trên BẰNG CHỨNG dữ liệu thật của
            // dự án (ngôn ngữ nguồn, có/không phụ đề SRT, có/không lỗi font...) thay vì giữ
            // máy móc toàn bộ quy tắc của prompt gốc kể cả những quy tắc không bao giờ dùng tới.
            const samplePool = core.files.filter((f: FileItem) => f.content && f.content.trim().length > 0);
            const rawSamples: string[] = [];
            if (samplePool.length > 0) {
                const picks = samplePool.length <= 3
                    ? samplePool
                    : [samplePool[0], samplePool[Math.floor(samplePool.length / 2)], samplePool[samplePool.length - 1]];
                picks.forEach((f: FileItem) => rawSamples.push(f.content.substring(0, 4000)));
            }
            // Lấy engine từ config automation đang chạy (nếu có), hoặc mặc định gemini
            // fix70: bỏ `as any` — `config` đã có kiểu `AutomationConfig | null` với field
            // `engine?: 'gemini' | 'deepseek'` khai báo sẵn trong types.ts, không cần ép kiểu.
            const activeEngine = automationState.config?.engine || 'gemini';
            const optimized = await optimizePrompt(
                DEFAULT_PROMPT, core.storyInfo, contextToUse, dictToUse, config.additionalRules,
                core.enabledModels,
                activeEngine, core.deepseekKey, core.deepseekModel, rawSamples
            );
            core.setPromptTemplate(optimized);
            core.setStoryInfo(prev => ({ ...prev, additionalRules: config.additionalRules }));
            ui.addToast("Đã tối ưu hóa Prompt thành công!", "success");
            ui.setShowPromptDesigner(false);
            if (automationState.isRunning) resumeAutomationWithCooldown();
        } catch (e: any) {
            ui.addToast(`Lỗi tối ưu Prompt: ${e.message}`, "error");
        } finally {
            ui.setIsOptimizingPrompt(false);
        }
    };

    const handleAutoAnalyze = async () => {
        if (core.files.length === 0) { ui.addToast("Vui lòng tải lên ít nhất 1 file", "warning"); return; }
        ui.setAutoAnalyzeStatus('Đang chuẩn bị dữ liệu...');
        // Lấy engine từ config automation đang chạy (nếu có), hoặc mặc định gemini
        // fix70: bỏ `as any` — xem chú thích tương tự ở handleAutoOptimizePrompt phía trên.
        const activeEngine = automationState.config?.engine || 'gemini';
        
        try {
            const result = await autoAnalyzeStory(
                core.files, core.storyInfo,
                (msg: string) => { setAutomationState(p => ({ ...p, stepStatus: msg })); ui.setAutoAnalyzeStatus(msg); },
                core.enabledModels,
                activeEngine, core.deepseekKey, core.deepseekModel
            );

            // Tự động chọn "Lối Xưng Hô Mong Muốn" (Hiện Đại/Cổ Đại) dựa trên tag thể loại/bối
            // cảnh vừa quét được, để bước "Phân Tích Sâu" chạy sau đó dùng luôn override tuyệt
            // đối (getPronounModeOverride) thay vì trông cậy hoàn toàn vào AI tự phân loại theo
            // 3 NHÓM A/B/C trong lúc phân tích — đây chính là nguồn gây lẫn xưng hô cổ trang
            // (đại nương, muội tử, tẩu tử...) vào truyện niên đại/hiện đại. CHỈ tự chọn khi
            // người dùng CHƯA từng chọn tay (tránh ghi đè lựa chọn thủ công), và CHỈ khi tín
            // hiệu thể loại rõ ràng nghiêng hẳn về 1 phía — nếu vừa có yếu tố cổ trang vừa có
            // yếu tố hiện đại (hoặc không có tín hiệu nào), giữ nguyên "Linh Động" (mặc định)
            // để AI tự phân loại theo bối cảnh từng nhân vật như cũ.
            let autoPronounMode: 'modern' | 'ancient' | undefined;
            if (!core.storyInfo.pronounMode) {
                const combined = [...(result.info.genres || []), ...(result.info.worldSetting || [])]
                    .map((g: string) => g.toLowerCase());
                const hasAncientSignal = combined.some(g => g.includes('tiên hiệp') || g.includes('kiếm hiệp') || g.includes('cổ đại') || g.includes('tu tiên') || g.includes('huyền huyễn') || g.includes('đông phương') || g.includes('trung cổ'));
                const hasModernSignal = combined.some(g => g.includes('đô thị') || g.includes('hiện đại') || g.includes('ngôn tình') || g.includes('hài hước') || g.includes('thanh xuân') || g.includes('80-90') || g.includes('thập niên') || g.includes('niên đại'));
                if (hasModernSignal && !hasAncientSignal) autoPronounMode = 'modern';
                else if (hasAncientSignal && !hasModernSignal) autoPronounMode = 'ancient';
            }

            core.setStoryInfo({
                ...result.info,
                pronounMode: autoPronounMode || core.storyInfo.pronounMode
            });
            if (result.cover) core.setCoverImage(result.cover);
            ui.addToast("Phân tích tự động hoàn tất", "success");
        } catch (e: any) {
            ui.addToast("Lỗi phân tích tự động: " + e.message, "error");
            throw e;
        } finally {
            ui.setAutoAnalyzeStatus('');
        }
    };

    const processNextAutomationStep = async (remainingSteps: number[], currentConfig?: AutomationConfig) => {
        if (remainingSteps.length === 0) {
            setAutomationState(prev => ({ ...prev, isRunning: false, currentStep: 0, countdown: 0, stepStatus: 'Hoàn tất' }));
            ui.addToast("✅ Quy trình tự động hóa hoàn tất!", "success");
            return;
        }
        const nextStep = remainingSteps[0];
        const futureSteps = remainingSteps.slice(1);
        setAutomationState(prev => ({ ...prev, currentStep: nextStep, pendingSteps: futureSteps }));

        const activeConfig = currentConfig || automationState.config;

        try {
            switch (nextStep) {
                case 0:
                    setAutomationState(p => ({...p, stepStatus: 'Đang dọn dẹp file trùng lặp...'}));
                    if (fileHandler?.handleRemoveDuplicates) {
                        fileHandler.handleRemoveDuplicates('all');
                    }
                    processNextAutomationStep(futureSteps, activeConfig);
                    break;
                // ... (Steps 1, 2, 3 same as before) ...
                case 1: 
                    setAutomationState(p => ({...p, stepStatus: 'Đang chạy Auto Phân Tích...'})); 
                    await handleAutoAnalyze(); 
                    processNextAutomationStep(futureSteps, activeConfig); 
                    break;
                case 2: 
                    setAutomationState(p => ({...p, stepStatus: 'Chờ người dùng kiểm tra phân tích...'})); 
                    setTimeout(() => ui.setShowNameAnalysisModal(true), 100); 
                    break;
                case 3: 
                    if (!core.storyInfo.title && (!core.storyInfo.genres || core.storyInfo.genres.length === 0)) { 
                        ui.addToast("Bỏ qua bước 3 (Thiếu metadata)", "warning"); 
                        processNextAutomationStep(futureSteps, activeConfig); 
                    } else { 
                        setAutomationState(p => ({...p, stepStatus: 'Chờ người dùng kiểm tra Prompt...'})); 
                        setTimeout(() => ui.setShowPromptDesigner(true), 100); 
                    }
                    break;
                case 4: {
                    ui.setShowAutomationModal(false); 
                    ui.addToast("⚡ Auto: Bắt đầu quy trình Dịch thuật nền...", "info"); 
                    setAutomationState(p => ({...p, stepStatus: 'Đang dịch thuật...'})); 

                    // FIX (regression từ khi executeProcessing() được chuyển thành async để chạy Hậu
                    // Kiểm Khởi Động trước khi dịch): TRƯỚC ĐÂY cờ "đang chờ" (isAutomationWaitingRef)
                    // được bật NGAY TRƯỚC KHI gọi executeProcessing() - lúc đó an toàn vì
                    // executeProcessing() là hàm ĐỒNG BỘ, isProcessing được bật true trong CÙNG 1 tick.
                    // Giờ executeProcessing() là ASYNC (phải "await" xong bước Hậu Kiểm Khởi Động rồi
                    // mới build hàng đợi + bật isProcessing=true), nên có 1 khoảng hở thời gian mà cờ
                    // "đang chờ" đã bật nhưng isProcessing THỰC TẾ vẫn còn false - nếu effect theo dõi
                    // (ở trên) vô tình chạy lại đúng lúc đó, nó sẽ hiểu nhầm "không có gì đang chạy"
                    // và coi bước dịch là đã xong ngay, dẫn tới hiện tượng người dùng báo cáo: log
                    // báo "Hoàn tất" trong khi các batch dịch thật vẫn đang chạy dở. SỬA: chỉ bật cờ
                    // "đang chờ" SAU KHI executeProcessing() đã thực sự chạy xong và xác nhận có dịch
                    // (trả về true) - lúc đó isProcessing chắc chắn đã được đặt true bên trong hàm.
                    const startedTranslation = await engine.executeProcessing(false, activeConfig?.tier || 'normal', activeConfig?.translationModels, true); 
                    if (!startedTranslation) {
                        ui.addToast("Dịch thuật: Đã hoàn tất (Skip).", "info");
                        resumeAutomationWithCooldown(futureSteps);
                    } else {
                        isAutomationWaitingRef.current = true; 
                    }
                    return;
                }
                case 5: { // Smart Fix
                    ui.setShowAutomationModal(false); 
                    setAutomationState(p => ({...p, stepStatus: 'Đang phân loại tệp nghi vấn trước Smart Fix...'}));
                    const triage = await engine.runPostTranslationTriage();
                    if (triage && (triage.recoveredCount || triage.lockedCount || triage.pendingCount || triage.requeuedCount)) {
                        ui.addLog(`🧭 Auto trước Smart Fix: phục hồi ${triage.recoveredCount} tệp bị đánh oan; ${triage.lockedCount} tệp xác nhận chờ cứu hộ; ${triage.pendingCount} tệp chưa kết luận được giữ nguyên; ${triage.requeuedCount} tệp rỗng được mở khoá.`, 'info');
                    }

                    const hasQuota = hasSmartFixQuota(activeConfig?.tier || 'normal');
                    const latestFiles: FileItem[] = core.stateRef.current.files || core.files;
                    const isQuotaExhausted = latestFiles.some((f: FileItem) => f.errorMessage === "Hết Quota tất cả model khả dụng");
                    
                    if (!hasQuota || isQuotaExhausted) {
                        ui.addToast("Smart Fix: Bỏ qua do hết Quota. Chuyển sang chuẩn hóa tiêu đề...", "warning");
                        // Skip Step 5, Jump to Step 6 (Title Gen) immediately without cooldown
                        processNextAutomationStep(futureSteps, activeConfig); 
                        return;
                    }

                    ui.addToast("🛠️ Auto: Bắt đầu quy trình Smart Fix nền...", "info"); 
                    setAutomationState(p => ({...p, stepStatus: 'Đang sửa lỗi...'})); 
                    isAutomationWaitingRef.current = true; 
                    
                    const startedFix = engine.handleSmartFix(); 
                    if (!startedFix) {
                        isAutomationWaitingRef.current = false;
                        ui.addToast("Smart Fix: Không có file lỗi (Skip).", "info");
                        // Skip cooldown for SmartFix -> TitleGen transition
                        processNextAutomationStep(futureSteps, activeConfig);
                    }
                    return;
                }
                case 6: { // NEW: Title Normalization (Flash)
                    if (core.storyInfo?.enableTitleFormatting === false) {
                        ui.addLog('⏭️ Bỏ qua Bước 6 (Chuẩn hóa tiêu đề bị tắt)', 'info');
                        resumeAutomationWithCooldown(futureSteps, true);
                        return;
                    }
                    ui.setShowAutomationModal(false);
                    setAutomationState(p => ({...p, stepStatus: 'Đang chuẩn hóa tiêu đề...'}));
                    
                    // Fix: handleTitleNormalization is awaited, so we don't need to wait for useEffect state change.
                    // We just await it and then proceed.
                    const scope = ui.selectedFiles && ui.selectedFiles.size > 0 ? 'selected' : 'all';
                    await engine.handleTitleNormalization(scope);
                    
                    // Proceed immediately (Fast transition logic in resumeAutomationWithCooldown will handle 6->7)
                    resumeAutomationWithCooldown(futureSteps, true);
                    return;
                }
                case 7: { // Final Cleanup (Old Step 6)
                    if (core.storyInfo?.enableAutoFormat === false && core.storyInfo?.enableTitleFormatting === false) {
                        ui.addLog('⏭️ Bỏ qua Bước 7 (Định dạng & Chuẩn hóa tiêu đề đều bị tắt)', 'info');
                        processNextAutomationStep(futureSteps, activeConfig);
                        return;
                    }
                    ui.setShowAutomationModal(false); 
                    setAutomationState(p => ({...p, stepStatus: 'Đang dọn dẹp định dạng...'})); 
                    
                    const hasSelection = ui.selectedFiles && ui.selectedFiles.size > 0;
                    let count = 0;
                    core.setFiles((prev: FileItem[]) => {
                        const newFiles = prev.map((f: FileItem) => {
                            if (hasSelection && !ui.selectedFiles.has(f.id)) return f;
                            if (f.translatedContent && f.status === FileStatus.COMPLETED) {
                                const cleaned = formatBookStyle(f.translatedContent, f.content, core.storyInfo?.enableTitleFormatting !== false, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false);
                                if (cleaned !== f.translatedContent) {
                                    count++;
                                    const newRawCount = countForeignChars(cleaned);
                                    return { ...f, translatedContent: cleaned, remainingRawCharCount: newRawCount };
                                }
                            }
                            return f;
                        });
                        return newFiles;
                    });
                    
                    if (count > 0) {
                        ui.addToast(`Trợ lý Local: Đã xử lý định dạng cho ${count} file.`, "success");
                    } else {
                        ui.addToast("Trợ lý Local: Các file đã được định dạng.", "success");
                    }
                    
                    // No cooldown needed for final step
                    processNextAutomationStep(futureSteps, activeConfig); 
                    break;
                }
            }
        } catch (e: any) {
            ui.addToast(`Lỗi Auto Step ${nextStep}: ${e.message}`, "error");
            setAutomationState(p => ({...p, isRunning: false}));
        }
    };

    // Override resume to handle specific transitions without cooldown
    const resumeAutomationWithCooldown = (stepsOverride?: number[], skipCooldown: boolean = false) => {
        const remainingSteps = stepsOverride !== undefined ? stepsOverride : automationState.pendingSteps;
        
        if (remainingSteps.length === 0) { 
            processNextAutomationStep([]); 
            return; 
        }

        const nextStep = remainingSteps[0];
        
        // NO COOLDOWN LOGIC
        // If coming from Step 5 (SmartFix) -> No Cooldown
        // If coming from Step 6 (TitleGen) -> No Cooldown
        const prevStep = automationState.currentStep;
        
        let isFastTransition = skipCooldown || (prevStep === 5) || (prevStep === 6);

        // Check if previous step failed due to quota
        const isQuotaExhausted = core.files.some((f: FileItem) => f.errorMessage === "Hết Quota tất cả model khả dụng");
        
        if (isQuotaExhausted && prevStep === 4) {
            ui.addToast("Dừng dịch do cạn Quota toàn bộ model. Chuyển sang bước tiếp theo...", "warning");
            isFastTransition = true;
        }

        // Skip cooldown before Smart Fix if we already know there's no Pro quota OR if translation exhausted all quota
        if (nextStep === 5) {
            const currentConfig = automationState.config;
            const hasQuota = hasSmartFixQuota(currentConfig?.tier || 'normal');
            if (!hasQuota || isQuotaExhausted) {
                isFastTransition = true;
            }
        }

        if (isFastTransition) {
             processNextAutomationStep(remainingSteps);
             return;
        }
        
        // Standard Cooldown
        let seconds = 60;
        setAutomationState(prev => ({ ...prev, countdown: seconds }));
        
        if (!ui.showAutomationModal) { 
            ui.addToast(`Auto: Hoàn thành bước hiện tại. Nghỉ ${seconds}s hồi phục API...`, "warning"); 
        }
        
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
            seconds--;
            setAutomationState(prev => ({ ...prev, countdown: seconds }));
            if (seconds <= 0) {
                if (timerRef.current) clearInterval(timerRef.current);
                timerRef.current = null;
                processNextAutomationStep(remainingSteps);
            }
        }, 1000);
    };

    return {
        automationState,
        handleAutomationStart,
        processNextAutomationStep,
        handlePromptDesignerConfirm,
        handleAutoAnalyze,
        stopAutomation,
        resumeAutomationWithCooldown
    };
};
