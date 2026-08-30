// AI-driven Series Bible workflows: Smart Start (initial glossary + prompt
// generation), Name/Context Analysis (glossary + context extraction, cover
// art generation), and the individual "refine X" follow-ups. This is the
// heaviest, most AI-call-dense group of handlers — kept together because
// they share the same multi-step analyze -> merge -> refine pipeline.
// Split out of the old monolithic `useAppHandlers.ts` — logic unchanged.
import { StoryInfo, FileItem } from '../../types';
import { ANALYSIS_CHUNK_MAX_CHARS, generateBasePrompt } from '../../constants';
import { getPronounModeOverride, getNumberUnitModeOverride } from '../../prompts';
import { analyzeStoryContext, analyzeContextBatch, mergeContexts, refineRawContext, buildLocalRawAnalysisFallback, LOCAL_RAW_ANALYSIS_FALLBACK_TAG } from '../../services/workflows/analyze/context';
import { analyzeNameBatch } from '../../services/workflows/analyze/names';
import { optimizePrompt, refineAdditionalRules, refineSummary } from '../../services/workflows/analyze/promptRules';
import { createCoverPrompt, generateCoverImage, addTextToCover } from '../../services/workflows/analyze/cover';
import { deduplicateDictionary, extractGlossaryBlocks } from '../../utils/text';
import { downloadTextFile, sortFiles, getSmartSampledFiles, chunkTextByFileBoundary } from '../../utils/fileHelpers';
import type { CoreApi, UIApi } from '../apiTypes';

export const useContextAnalysisHandlers = (core: CoreApi, ui: UIApi, automation: any) => {
    const handleSmartStartRun = async (useSearch: boolean, additionalRules: string, sampling: { start: number, middle: number, end: number }) => {
        if (!core.storyInfo.title) { ui.addToast("Vui lòng nhập tên truyện", 'error'); return; }
        try {
            ui.setSmartStartStep('analyzing');
            ui.addToast("Bắt đầu phân tích ngữ cảnh mẫu...", 'info');
            const glossaryResult = await analyzeStoryContext(core.files, core.storyInfo, core.additionalDictionary, useSearch, additionalRules, sampling, core.enabledModels);
            
            const currentDict = core.additionalDictionary || "";
            const prefix = currentDict.trim() ? "\n\n" : "";
            const newFullDictionary = currentDict.trim() + prefix + glossaryResult;
            const newContextNotes = (core.storyInfo.contextNotes || "") + (core.storyInfo.contextNotes ? "\n\n" : "") + glossaryResult;
            
            core.setAdditionalDictionary(newFullDictionary);
            core.setStoryInfo((prev: StoryInfo) => ({ ...prev, contextNotes: newContextNotes, additionalRules: additionalRules }));
            ui.setDictTab('custom');
            
            const postAnalysisStoryInfo = { ...core.storyInfo, contextNotes: newContextNotes, additionalRules: additionalRules };
            
            if (ui.autoOptimizePrompt) {
                ui.setSmartStartStep('optimizing');
                ui.addToast("Đang kiến trúc Prompt dựa trên ngữ cảnh vừa tìm được...", 'info');
                const dynamicBasePrompt = generateBasePrompt(postAnalysisStoryInfo.genres, postAnalysisStoryInfo.worldSetting || [], core.storyInfo.enableTitleFormatting !== false);
                // FIX61+: gửi kèm mẫu raw thật (đầu/giữa/cuối, tối đa 4000 ký tự/mẫu) — cùng cơ
                // chế với luồng Tối Ưu Prompt thủ công, để prompt được thiết kế theo bằng chứng
                // dữ liệu thật của dự án thay vì giữ máy móc mọi quy tắc không dùng tới.
                const samplePool = core.files.filter((f: FileItem) => f.content && f.content.trim().length > 0);
                const rawSamples: string[] = [];
                if (samplePool.length > 0) {
                    const picks = samplePool.length <= 3
                        ? samplePool
                        : [samplePool[0], samplePool[Math.floor(samplePool.length / 2)], samplePool[samplePool.length - 1]];
                    picks.forEach((f: FileItem) => rawSamples.push(f.content.substring(0, 4000)));
                }
                const optimized = await optimizePrompt(dynamicBasePrompt, postAnalysisStoryInfo, newContextNotes, newFullDictionary, additionalRules, core.enabledModels, 'gemini', undefined, undefined, rawSamples);
                core.setPromptTemplate(optimized);
            }
            
            core.saveSession(); // Trigger save
            ui.setSmartStartStep('idle');
            ui.setShowSmartStartModal(false);
            ui.addToast("Đã cập nhật bộ quy tắc & Series Bible mới!", 'success');
            ui.setAutomationInitialConfig({ steps: [0,1,2,3,4,5,6,7], rules: (additionalRules || "").replace(/Nếu văn bản gốc chứa nội dung nhạy cảm.*thành công\./g, 'Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.'), tier: 'normal' });
            ui.setShowAutomationModal(true);
            
        } catch (e: any) {
            ui.setSmartStartStep('idle');
            ui.addToast(`Lỗi Smart Start: ${e.message}`, 'error');
        }
    };

    const handleNameAnalysis = async (config: { mode: 'only_char' | 'full' | 'deep_context'; scope: 'smart' | 'range' | 'full'; rangeStart: number; rangeEnd: number; updatedStoryInfo: StoryInfo; useSearch: boolean; additionalRules?: string; sampling?: {start: number, middle: number, end: number} }) => {
        if (core.files.length === 0) return;
        core.setStoryInfo(config.updatedStoryInfo);
        ui.setIsAnalyzingNames(true);
        ui.setNameAnalysisProgress({ current: 0, total: 1, stage: 'Đang chuẩn bị dữ liệu...' });
        
        let filesToAnalyze = sortFiles([...core.files]);
        const totalFileCount = filesToAnalyze.length;
        
        if (config.scope === 'range') {
            const startIdx = Math.max(0, config.rangeStart - 1);
            const endIdx = Math.min(totalFileCount, config.rangeEnd);
            filesToAnalyze = filesToAnalyze.slice(startIdx, endIdx);
        } else if (config.scope === 'smart' && config.sampling) {
            filesToAnalyze = getSmartSampledFiles(filesToAnalyze, config.sampling);
        }

        // FIX (fix55 - bug "phân tích chia 2 phần bị nửa nạc nửa mỡ so với phân tích 1 lần"):
        // trước đây nối hết nội dung các chương thành 1 chuỗi dài rồi cắt cứng theo số ký tự
        // (String.substring), có thể cắt ngang thân 1 chương giữa 2 batch. Giờ gộp theo RANH
        // GIỚI FILE/CHƯƠNG (chunkTextByFileBoundary) — chỉ chuyển chunk mới ở ranh giới giữa 2
        // chương, không còn xé đôi 1 chương nữa.
        const CHUNK_SIZE = ANALYSIS_CHUNK_MAX_CHARS;
        const chunks = chunkTextByFileBoundary(filesToAnalyze.map(f => ({ text: f.content })), CHUNK_SIZE);
        
        ui.setNameAnalysisProgress({ current: 0, total: chunks.length, stage: `Đang chuẩn bị ${chunks.length} phần dữ liệu...` });
        const results: string[] = [];

        try {
            const isDeep = config.mode === 'deep_context';
            // Lấy engine từ config automation đang chạy (Bước 2 - Phân Tích Chuyên Sâu). Nếu chạy
            // thủ công ngoài automation (không có config), mặc định Gemini như cũ.
            const activeEngine: 'gemini' | 'deepseek' = automation?.automationState?.config?.engine || 'gemini';
            const dsKey = core.deepseekKey;
            const dsModel = core.deepseekModel;
            // Tuần tự để phần sau nhận ngay glossary/xưng hô đã chốt ở phần trước.
            const CONCURRENCY = 1;

            // Quy tắc bổ sung: ưu tiên giá trị vừa nhập trong modal, nếu trống thì lấy quy tắc đã lưu trong storyInfo.
            // Tránh tình trạng bị coi là rỗng rồi ghi đè mất quy tắc đã tích lũy từ các Phần trước.
            let effectiveAdditionalRules =
                (config.additionalRules && config.additionalRules.trim()) ||
                (config.updatedStoryInfo?.additionalRules && config.updatedStoryInfo.additionalRules.trim()) ||
                core.storyInfo?.additionalRules ||
                "";

            // Tùy chọn xưng hô (Hiện đại/Cổ đại/Linh động) chọn ở trang Tri Thức. Chỉ có ý
            // nghĩa với mode 'deep_context' (mode 'full'/'only_char' không sinh Ma trận xưng hô).
            // Chèn vào effectiveAdditionalRules để mọi lượt gọi analyzeContextBatch (chunk-level)
            // đều thấy chỉ dẫn này; đồng thời truyền riêng cho mergeContexts/refineAdditionalRules
            // bên dưới vì 2 bước đó có sẵn khối hướng dẫn phân loại 3 NHÓM A/B/C cứng trong prompt
            // của chúng, cần override tường minh để không bị lấn át ngược lại lựa chọn người dùng.
            const pronounOverride = isDeep
                ? getPronounModeOverride(config.updatedStoryInfo?.pronounMode)
                : '';
            if (pronounOverride) {
                effectiveAdditionalRules = effectiveAdditionalRules
                    ? `${effectiveAdditionalRules}\n\n${pronounOverride}`
                    : pronounOverride;
            }

            // Tùy chọn đơn vị số đếm (Hiện đại/Cổ đại/Linh động), cùng cơ chế với pronounOverride
            // ở trên — xem chú thích tại getNumberUnitModeOverride.
            const numberUnitOverride = isDeep
                ? getNumberUnitModeOverride(config.updatedStoryInfo?.numberUnitMode)
                : '';
            if (numberUnitOverride) {
                effectiveAdditionalRules = effectiveAdditionalRules
                    ? `${effectiveAdditionalRules}\n\n${numberUnitOverride}`
                    : numberUnitOverride;
            }

            // Bộ lọc theo enabledModels, giữ nguyên thứ tự ưu tiên; nếu lọc ra rỗng thì dùng lại danh sách gốc.
            const filterEnabled = (list: string[]) => {
                const filtered = list.filter(id => core.enabledModels?.includes(id) ?? true);
                return filtered.length > 0 ? filtered : list;
            };

            // Chế độ Nhanh: ưu tiên hết quota 3.7 Flash > 3.5 Flash > 3.0 Flash preview
            const QUICK_CHAIN = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
            // Chế độ Sâu, từ batch 4 trở đi: 3.7 Flash > 3.5 Flash > 3.0 Flash preview
            const DEEP_LATE_CHAIN = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];

            const totalBatches = Math.ceil(chunks.length / CONCURRENCY);
            // FIX (fix55 - bug "phân tích chia 2 phần bị nửa nạc nửa mỡ so với phân tích 1 lần"):
            // trước đây MỌI batch đều được truyền cùng 1 giá trị tĩnh `core.additionalDictionary`
            // (từ điển chốt trước khi bắt đầu chạy) làm existingDictionary — nghĩa là batch 2 hoàn
            // toàn không biết batch 1 (chạy ngay trước đó trong CÙNG lượt phân tích này) vừa tìm ra
            // nhân vật/thuật ngữ/diễn biến xưng hô gì. rollingDictionary tích lũy dần sau MỖI batch
            // (các batch vẫn chạy tuần tự - for loop await Promise.all trước khi sang batch kế), để
            // batch sau "nhìn thấy" mọi thứ đã chốt ở (các) batch trước, không chỉ từ điển cũ có sẵn
            // trước khi bắt đầu chạy.
            let rollingDictionary = core.additionalDictionary || "";
            for (let i = 0; i < chunks.length; i += CONCURRENCY) {
                const batchNum = Math.floor(i / CONCURRENCY) + 1;
                const batch = chunks.slice(i, i + CONCURRENCY);
                const dictForThisBatch = rollingDictionary;
                
                // Cập nhật chi tiết tiến độ Batch
                ui.setNameAnalysisProgress({ 
                    current: i + 1, 
                    total: chunks.length, 
                    stage: `Đang phân tích Batch ${batchNum}/${totalBatches} (Phần dữ liệu ${i + 1}-${Math.min(i + CONCURRENCY, chunks.length)})` 
                });
                
                const batchPromises = batch.map(async (chunk, idx) => {
                    if (activeEngine === 'deepseek') {
                        try {
                            if (config.mode === 'deep_context') {
                                return await analyzeContextBatch(chunk, config.updatedStoryInfo, dictForThisBatch, false, undefined, effectiveAdditionalRules, core.enabledModels, 'deepseek', dsKey, dsModel);
                            } else {
                                return await analyzeNameBatch(chunk, config.updatedStoryInfo, config.mode as 'only_char' | 'full', false, effectiveAdditionalRules, undefined, core.enabledModels, 'deepseek', dsKey, dsModel, dictForThisBatch);
                            }
                        } catch (e: any) {
                            console.error(`DeepSeek analysis failed for chunk ${i + idx}:`, e);
                            // FIX86: fallback về trích xuất cục bộ (0 request) thay vì chỉ trả về 1
                            // dòng lỗi thuần — không còn mất trắng thông tin của chunk khi DeepSeek lỗi.
                            return buildLocalRawAnalysisFallback(chunk, i + idx, chunks.length, `DeepSeek: ${e.message || e.toString()}`);
                        }
                    }

                    // FIX86: bỏ nhánh idx % 2 chết — `CONCURRENCY = 1` phía trên khiến `batch` luôn
                    // chỉ có 1 phần tử nên `idx` luôn = 0, nhánh "idx % 2 !== 0" trước đây không bao
                    // giờ có cơ hội chạy. Giữ lại đúng 1 logic tầng model, hành vi thực tế không đổi.
                    let models: string[];
                    if (isDeep) {
                        models = batchNum <= 3
                            ? filterEnabled(['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'])
                            : filterEnabled(DEEP_LATE_CHAIN);
                    } else {
                        // Chế độ Nhanh: 3.7 Flash > 3.5 Flash > 3.0 Flash preview
                        models = filterEnabled(QUICK_CHAIN);
                    }
                    
                    try {
                        if (config.mode === 'deep_context') {
                            return await analyzeContextBatch(chunk, config.updatedStoryInfo, dictForThisBatch, config.useSearch, models, effectiveAdditionalRules, core.enabledModels);
                        } else {
                            return await analyzeNameBatch(chunk, config.updatedStoryInfo, config.mode as 'only_char' | 'full', config.useSearch, effectiveAdditionalRules, models, core.enabledModels, undefined, undefined, undefined, dictForThisBatch);
                        }
                    } catch (e: any) {
                        console.warn(`Primary models failed for chunk ${i + idx}, falling back to Flash chain for raw analysis.`, e);
                        const rescueModels = filterEnabled(['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview']);
                        try {
                            if (config.mode === 'deep_context') {
                                const flashRes = await analyzeContextBatch(chunk, config.updatedStoryInfo, dictForThisBatch, config.useSearch, rescueModels, effectiveAdditionalRules + "\nLƯU Ý: ĐÂY LÀ BẢN PHÂN TÍCH THÔ DO HẾT QUOTA. CHỈ TRÍCH XUẤT NHANH CÁC DANH TỪ RIÊNG.", core.enabledModels);
                                return flashRes + "\n[GHI CHÚ: BẢN PHÂN TÍCH THÔ BẰNG FLASH DO HẾT QUOTA]";
                            } else {
                                const flashRes = await analyzeNameBatch(chunk, config.updatedStoryInfo, config.mode as 'only_char' | 'full', config.useSearch, effectiveAdditionalRules + "\nLƯU Ý: ĐÂY LÀ BẢN PHÂN TÍCH THÔ DO HẾT QUOTA. CHỈ TRÍCH XUẤT NHANH CÁC DANH TỪ RIÊNG.", rescueModels, core.enabledModels, undefined, undefined, undefined, dictForThisBatch);
                                return flashRes + "\n[GHI CHÚ: BẢN PHÂN TÍCH THÔ BẰNG FLASH DO HẾT QUOTA]";
                            }
                        } catch (flashError: any) {
                            // FIX86: trước đây trả về 1 dòng lỗi thuần (không mất VỊ TRÍ chunk nhờ
                            // `results.push(...batchResults)` không lọc, nhưng mất TOÀN BỘ nội dung
                            // hữu ích). Nay fallback về trích xuất cục bộ (0 request), đồng nhất với
                            // `analyzeStoryContext` (Smart Start).
                            console.error(`Flash fallback also failed for chunk ${i + idx}:`, flashError);
                            return buildLocalRawAnalysisFallback(chunk, i + idx, chunks.length, flashError.message || flashError.toString());
                        }
                    }
                });
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);

                // FIX86: marker lỗi thuần cũ ('\n// [LỖI]') không còn được tạo ra nữa — loại theo
                // LOCAL_RAW_ANALYSIS_FALLBACK_TAG thay thế (xem buildLocalRawAnalysisFallback).
                const okResults = batchResults.filter(r => r && !r.includes(LOCAL_RAW_ANALYSIS_FALLBACK_TAG));
                if (okResults.length > 0) {
                    rollingDictionary = deduplicateDictionary(`${rollingDictionary}\n${extractGlossaryBlocks(okResults.join('\n'))}`);
                }
            }

            if (config.mode === 'deep_context') {
                if (core.storyInfo?.contextNotes) {
                    results.unshift(core.storyInfo.contextNotes);
                }
                
                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang hợp nhất ngữ cảnh (Merging)..." });
                // FIX80: trước đây stage đứng im ở dòng tĩnh này suốt cả bước hợp nhất (có thể khá
                // lâu khi truyện bị chia nhiều phần, do mergeContexts tự đệ quy gộp theo cặp) —
                // giờ nhận tiến độ theo từng lượt gọi AI hợp nhất thực sự (X/Y phần) kèm % riêng
                // của bước này để người dùng biết máy vẫn đang chạy, không phải bị treo.
                const mergedContext = await mergeContexts(
                    results, config.updatedStoryInfo, core.enabledModels, undefined, pronounOverride, activeEngine, dsKey, dsModel,
                    (done, total) => {
                        const mergePercent = total > 0 ? Math.round((done / total) * 100) : 100;
                        ui.setNameAnalysisProgress({
                            current: chunks.length,
                            total: chunks.length,
                            stage: total > 1
                                ? `Đang hợp nhất ngữ cảnh (Merging)... ${done}/${total} lượt (${mergePercent}%)`
                                : "Đang hợp nhất ngữ cảnh (Merging)..."
                        });
                    }
                );
                
                let finalAdditionalRules = effectiveAdditionalRules;
                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang tinh chỉnh quy tắc bổ sung..." });
                finalAdditionalRules = await refineAdditionalRules(finalAdditionalRules, mergedContext, config.updatedStoryInfo, core.enabledModels, undefined, pronounOverride, activeEngine, dsKey, dsModel);

                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang tổng hợp cốt truyện..." });
                const refinedSummary = await refineSummary(mergedContext, config.updatedStoryInfo, core.enabledModels, undefined, activeEngine, dsKey, dsModel);

                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang trích xuất từ điển từ ngữ cảnh..." });
                const extractedGlossary = extractGlossaryBlocks(mergedContext);
                
                if (extractedGlossary) {
                     core.setAdditionalDictionary((prev: string) => {
                         const newDict = prev ? prev + '\n' + extractedGlossary : extractedGlossary;
                         return deduplicateDictionary(newDict);
                     });
                }
                
                core.setStoryInfo((prev: StoryInfo) => ({ 
                    ...prev, 
                    summary: refinedSummary,
                    contextNotes: mergedContext,
                    additionalRules: finalAdditionalRules
                }));
                downloadTextFile(`${config.updatedStoryInfo.title}_Context.txt`, mergedContext);
                if (extractedGlossary) {
                    downloadTextFile(`${config.updatedStoryInfo.title}_ExtractedDict.txt`, extractedGlossary);
                }

                // TRÍ TUỆ BÌA TUYỆT ĐỐI (Cover Design Base)
                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang đưa tóm tắt sâu vào Prompt Bìa EPUB VIP..." });
                const coverPrompt = await createCoverPrompt(config.updatedStoryInfo, refinedSummary, core.enabledModels);
                core.setStoryInfo((prev: StoryInfo) => ({ ...prev, imagePrompt: coverPrompt }));

                // Không tự ghi đè bìa người dùng đã tải/chỉnh. Prompt mới vẫn được lưu ở trên để nút
                // Tạo Lại hoặc màn hình EPUB dùng đúng tóm tắt sâu mới nhất.
                if (!core.coverImage) {
                    ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang vẽ ảnh bìa (Nano Banana 2 Lite - Gemini 3.1 Flash Lite Image)..." });
                    const baseCover = await generateCoverImage(coverPrompt, core.enabledModels);
                    if (baseCover) {
                         ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang in Typography chữ lên ảnh bìa..." });
                         const finalCover = await addTextToCover(baseCover, config.updatedStoryInfo.title || "Vô Danh", config.updatedStoryInfo.author || "Khuyết Danh");
                         core.setCoverImage(finalCover);
                    }
                }

            } else {
                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang lọc trùng và tạo từ điển..." });
                const cleanDictionary = deduplicateDictionary(results.join("\n"));
                core.setAdditionalDictionary((prev: string) => (prev ? prev + '\n' + cleanDictionary : cleanDictionary));
                ui.setDictTab('custom');
                downloadTextFile(`${config.updatedStoryInfo.title}_Dictionary.txt`, cleanDictionary);
            }
            ui.addToast("Phân tích hoàn tất!", "success");
            
            // --- FIX AUTOMATION HANG: Resume automation if running ---
            if (automation.automationState.isRunning && automation.automationState.currentStep === 2) {
                automation.resumeAutomationWithCooldown();
            }

        } catch (e: any) {
            ui.addToast(`Lỗi phân tích: ${e.message}`, "error");
        } finally {
            ui.setIsAnalyzingNames(false);
            ui.setShowNameAnalysisModal(false);
        }
    };

    const handleRefineContext = async () => {
        if (!core.storyInfo.contextNotes) return;
        ui.setIsRefiningContext(true);
        try {
            const refined = await refineRawContext(core.storyInfo.contextNotes, core.storyInfo, core.enabledModels);
            core.setStoryInfo((prev: StoryInfo) => ({ ...prev, contextNotes: refined }));
            ui.addToast("Đã hợp nhất ngữ cảnh thành công!", "success");
        } catch (e: any) {
            ui.addToast(`Lỗi hợp nhất: ${e.message}`, "error");
        } finally {
            ui.setIsRefiningContext(false);
        }
    };

    const handleRefineSummary = async () => {
        if (!core.storyInfo.contextNotes) {
            ui.addToast("Không có ngữ cảnh (Series Bible) để tạo tóm tắt. Cần phân tích ngữ cảnh trước.", "warning");
            return;
        }
        ui.addToast("Đang tạo tóm tắt...", "info");
        try {
            const refinedSummary = await refineSummary(core.storyInfo.contextNotes, core.storyInfo, core.enabledModels);
            core.setStoryInfo((prev: StoryInfo) => ({ ...prev, summary: refinedSummary }));
            ui.addToast("Tạo tóm tắt thành công!", "success");
        } catch (e: any) {
            ui.addToast(`Lỗi tạo tóm tắt: ${e.message}`, "error");
        }
    };

    const handleRefineAdditionalRules = async () => {
        if (!core.storyInfo.contextNotes) {
            ui.addToast("Không có ngữ cảnh (Series Bible) để tạo quy tắc. Cần phân tích ngữ cảnh trước.", "warning");
            return;
        }
        ui.addToast("Đang tinh chỉnh quy tắc bổ sung...", "info");
        try {
            const finalAdditionalRules = await refineAdditionalRules(core.storyInfo.additionalRules || "", core.storyInfo.contextNotes, core.storyInfo, core.enabledModels);
            core.setStoryInfo((prev: StoryInfo) => ({ ...prev, additionalRules: finalAdditionalRules }));
            ui.addToast("Tinh chỉnh quy tắc thành công!", "success");
        } catch (e: any) {
            ui.addToast(`Lỗi tinh chỉnh quy tắc: ${e.message}`, "error");
        }
    };

    return { handleSmartStartRun, handleNameAnalysis, handleRefineContext, handleRefineSummary, handleRefineAdditionalRules };
};
