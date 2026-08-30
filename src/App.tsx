
import React, { useEffect, useState, useRef } from 'react';
import { deepSeekKeyManager } from './services/api/deepseek';
import { MainUI } from './components/MainUI';
import { ModalManager } from './components/ModalManager';
import { IS_LITE, isWithinLicense } from './constants';
import { ToastContainer, LoadingModal, RawDownloadModal, ApiSettingsModal } from './components/modals';
import { Loader2, AlertTriangle, UploadCloud } from 'lucide-react';
import { IntroPage } from './components/IntroPage';

import { useCoreState } from './hooks/useCoreState';
import { useUIState } from './hooks/useUIState';
import { useFileHandler } from './hooks/useFileHandler';
import { useTranslationEngine } from './hooks/useTranslationEngine';
import { useAutomation } from './hooks/useAutomation';
import { useAppHandlers } from './hooks/useAppHandlers';

import { FileStatus, RatioLimits, FileItem } from './types';
import { generateBasePrompt, ACCESS_CONFIG } from './constants';
import { DEFAULT_RATIO_LIMITS } from './constants/ratioLimits';
import { downloadTextFile } from './utils/fileHelpers';
import { quotaManager } from './utils/quotaManager';
import { countForeignChars, validateTranslationIntegrity } from './utils/text';

const App: React.FC = () => {
  const [hasSeenIntro, setHasSeenIntro] = useState<boolean>(false);
  const [forceShowIntro, setForceShowIntro] = useState<boolean>(false);
  const dragDepthRef = useRef(0);

  // 1. Initialize State Hooks
  const ui = useUIState();
  const core = useCoreState(ui.addToast);
  
  // 2. Initialize Logic Hooks (Dependency Injection)
  const engine = useTranslationEngine(core, ui);
  const fileHandler = useFileHandler(core, ui, () => {
      ui.setActiveTab('workspace');
      ui.setCurrentPage(1);
  });
  const automation = useAutomation(core, ui, engine, fileHandler);
  const appHandlers = useAppHandlers(core, ui, fileHandler, engine, automation);

  // --- Helpers that bridge hooks ---
  
  // Auto-sync Cover Image Preview whenever core.coverImage changes
    const { setCoverPreviewUrl } = ui;
    useEffect(() => {
        if (core.coverImage) {
            const url = URL.createObjectURL(core.coverImage);
            setCoverPreviewUrl(url);
            return () => URL.revokeObjectURL(url);
        } else {
            setCoverPreviewUrl(null);
        }
    }, [core.coverImage, setCoverPreviewUrl]);

    const { setRatioLimits } = core;
    useEffect(() => {
      setRatioLimits((prev: RatioLimits) => {
          let updated = false;
          const newLimits = { ...prev };
          
          // Dùng spread copy ({...DEFAULT_RATIO_LIMITS.x}) thay vì gán thẳng object mặc định,
          // để tránh việc các dòng gán field lẻ (.min = ...) bên dưới vô tình sửa luôn vào
          // hằng số DEFAULT_RATIO_LIMITS dùng chung (object dùng chung không nên bị mutate).
          if (!newLimits.vn) { newLimits.vn = { ...DEFAULT_RATIO_LIMITS.vn }; updated = true; }
          if (!newLimits.en) { newLimits.en = { ...DEFAULT_RATIO_LIMITS.en }; updated = true; }
          if (!newLimits.krjp) { newLimits.krjp = { ...DEFAULT_RATIO_LIMITS.krjp }; updated = true; }
          if (!newLimits.cn) { newLimits.cn = { ...DEFAULT_RATIO_LIMITS.cn }; updated = true; }

          // FIX (check falsy nuốt giá trị 0 hợp lệ): các field min/max là số thập phân tuỳ chỉnh
          // được (Header cho nhập step 0.1) — dùng `!x` khiến min=0 (người dùng chủ động đặt)
          // bị ép về mặc định mỗi lần mount app. Soi đúng "chưa có dữ liệu" bằng === undefined.
          if (newLimits.vn.min === undefined) { newLimits.vn.min = DEFAULT_RATIO_LIMITS.vn.min; updated = true; }
          if (newLimits.en.min === undefined) { newLimits.en.min = DEFAULT_RATIO_LIMITS.en.min; updated = true; }
          if (newLimits.en.max === undefined) { newLimits.en.max = DEFAULT_RATIO_LIMITS.en.max; updated = true; }
          if (newLimits.vn.max === undefined) { newLimits.vn.max = DEFAULT_RATIO_LIMITS.vn.max; updated = true; }
          if (newLimits.krjp.max === undefined) { newLimits.krjp.max = DEFAULT_RATIO_LIMITS.krjp.max; updated = true; }
          if (newLimits.krjp.min === undefined) { newLimits.krjp.min = DEFAULT_RATIO_LIMITS.krjp.min; updated = true; }
          if (newLimits.cn.min === undefined) { newLimits.cn.min = DEFAULT_RATIO_LIMITS.cn.min; updated = true; }
          if (newLimits.cn.max === undefined) { newLimits.cn.max = DEFAULT_RATIO_LIMITS.cn.max; updated = true; }
          
          return updated ? newLimits : prev;
      });
    }, [setRatioLimits]); // Run only once on mount

    const prevRatioLimitsRef = useRef<string>(JSON.stringify(core.ratioLimits));
    useEffect(() => {
        const currentStringified = JSON.stringify(core.ratioLimits);
        if (prevRatioLimitsRef.current !== currentStringified) {
            prevRatioLimitsRef.current = currentStringified;
            // Scan through all files and invalidate those that don't match the new limits
            core.setFiles((prevFiles: FileItem[]) => {
                let hasChanges = false;
                const newFiles = prevFiles.map((f: FileItem) => {
                    if (f.status === FileStatus.COMPLETED && f.translatedContent) {
                        const integrity = validateTranslationIntegrity(f.content, f.translatedContent, core.ratioLimits, core.storyInfo.languages, f.usedModel);
                        if (!integrity.isValid) {
                            hasChanges = true;
                            // If invalid due to ratio limits, set to ERROR
                            return { ...f, status: FileStatus.ERROR, errorMessage: integrity.reason || 'Lỗi Ratio' };
                        }
                    } else if (f.status === FileStatus.ERROR && f.translatedContent && (f.errorMessage?.toLowerCase().includes('tỷ lệ') || f.errorMessage?.toLowerCase().includes('ratio'))) {
                        const integrity = validateTranslationIntegrity(f.content, f.translatedContent, core.ratioLimits, core.storyInfo.languages, f.usedModel);
                        if (integrity.isValid) {
                            hasChanges = true;
                            // If valid now, set back to COMPLETED
                            // FIX (bug "file đã dịch xong vẫn bị xếp vào diện cứu hộ"): cũng xoá
                            // isRescueLocked cho nhất quán - COMPLETED và khoá cứu hộ là 2 trạng
                            // thái mâu thuẫn nhau.
                            return { ...f, status: FileStatus.COMPLETED, errorMessage: undefined, isRescueLocked: false };
                        } else if (integrity.reason !== f.errorMessage) {
                            hasChanges = true;
                            // Update the error message if it changed
                            return { ...f, errorMessage: integrity.reason || 'Lỗi Ratio' };
                        }
                    }
                    return f;
                });
                return hasChanges ? newFiles : prevFiles;
            });
        }
        // Cố ý dùng dependency chi tiết (core.ratioLimits/setFiles/storyInfo.languages) thay vì
        // cả object `core`: `core` được tạo mới mỗi lần render (không memo hóa ở useCoreState),
        // nên đưa cả object vào đây sẽ khiến effect chạy lại ở MỌI lần render thay vì chỉ khi
        // ratioLimits/ngôn ngữ truyện thực sự đổi.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [core.ratioLimits, core.setFiles, core.storyInfo.languages]);

  // Visible Files Calculation (Unused locally but passed to prop types)
  const visibleFiles = React.useMemo(() => {
        const filtered = core.files;
        if (ui.currentPage === 0) return filtered;
        const startIndex = (ui.currentPage - 1) * 100;
        return filtered.slice(startIndex, startIndex + 100);
  }, [core.files, ui.currentPage]);

  const totalPages = Math.ceil(core.files.length / 100);

  // Stats
  const stats = React.useMemo(() => {
      const completed = core.files.filter((f: FileItem) => f.status === FileStatus.COMPLETED).length;
      const failed = core.files.filter((f: FileItem) => f.status === FileStatus.ERROR).length;
      const processing = core.files.filter((f: FileItem) => f.status === FileStatus.PROCESSING || f.status === FileStatus.REPAIRING).length;
      const pending = core.files.filter((f: FileItem) => f.status === FileStatus.IDLE).length;
      return {
          total: core.files.length,
          completed, failed, processing, pending
      };
  }, [core.files]);

  const progressPercentage = React.useMemo(() => {
    return engine.isCustomFixing && engine.customFixProgress
      ? Math.round((engine.customFixProgress.completed / engine.customFixProgress.total) * 100)
      : core.files.length > 0 ? Math.round(((stats.completed + stats.failed) / core.files.length) * 100) : 0;
  }, [engine.isCustomFixing, engine.customFixProgress, stats.completed, stats.failed, core.files.length]);

  // NOTE (nhóm C - dependency array): các useCallback bên dưới cố ý liệt kê từng hàm/giá trị cụ
  // thể của `core`/`ui` (vd. core.setEnabledModels, ui.setSelectedFiles) thay vì đưa cả object
  // `core`/`ui` vào dependency array. Lý do: `core` và `ui` là object PHẲNG được tạo mới mỗi lần
  // App render (không memo hóa trong useCoreState/useUIState), nên nếu đưa cả object vào deps,
  // mọi useCallback này sẽ bị tạo lại ở MỌI lần render — làm mất tác dụng memoization (một số
  // callback như autoSaveEditor được memo hóa có chủ đích để tránh reset effect debounce ở
  // EditorModal). Dependency chi tiết là đúng ý đồ thiết kế, không phải thiếu sót.
  /* eslint-disable react-hooks/exhaustive-deps */
  const openEditor = React.useCallback((f: any) => ui.setEditingFileId(f.id), [ui.setEditingFileId]);
  const requestRetranslateSingle = React.useCallback((e: any, id: string) => { 
      e.stopPropagation(); 
      ui.setSelectedFiles(new Set([id])); 
      ui.setShowRetranslateModal(true); 
  }, [ui.setSelectedFiles, ui.setShowRetranslateModal]);
  const handleToggleModel = React.useCallback((id: string) => core.setEnabledModels((prev: string[]) => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]), [core.setEnabledModels]);
  const clearFilters = React.useCallback(() => { ui.setFilterModels(new Set()); ui.setFilterStatuses(new Set()); }, [ui.setFilterModels, ui.setFilterStatuses]);
  // Memoized so EditorModal's autosave debounce/flush effects (which depend on this
  // function's identity) don't reset on every unrelated App re-render.
  const autoSaveEditor = React.useCallback((id: string, content: string) => {
    core.setFiles((prev: any[]) => prev.map((f: any) => f.id === id ? {
        ...f,
        translatedContent: content,
        remainingRawCharCount: countForeignChars(content),
        status: FileStatus.COMPLETED,
        usedModel: 'Thủ công',
        // Người dùng đã tự sửa/dán bản dịch đúng — mọi cảnh báo "nghi vấn" từ lần dịch AI
        // trước đó (errorMessage, ratioWarning...) không còn ý nghĩa và PHẢI được xoá, nếu
        // không hệ thống sẽ tiếp tục coi file này là "khả nghi" mãi mãi ở các bước sau
        // (lọc file cần xử lý lại, hiển thị badge cảnh báo...) dù nội dung đã đúng.
        errorMessage: undefined,
        ratioWarning: undefined,
        integrityOverrideAccepted: true,
    } : f));
  }, [core.setFiles]);
  const toggleFilterModel = React.useCallback((k: string) => ui.setFilterModels((p: Set<string>) => { const n = new Set(p); if(n.has(k)) n.delete(k); else n.add(k); return n; }), [ui.setFilterModels]);
  const toggleFilterStatus = React.useCallback((k: string) => ui.setFilterStatuses((p: Set<string>) => { const n = new Set(p); if(n.has(k)) n.delete(k); else n.add(k); return n; }), [ui.setFilterStatuses]);
  const handleCoverUpload = React.useCallback((e: any) => {
      const file = e.target.files?.[0];
      if (file) {
          core.setCoverImage(file);
          ui.addToast("Đã tải lên ảnh bìa", "success");
      }
      e.target.value = '';
  }, [core.setCoverImage, ui.addToast]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const handleAutomationStop = React.useCallback(() => { automation.stopAutomation(); engine.stopProcessing(); }, [automation, engine]);
  
  // Keep deepSeekKeyManager in sync with core state
  useEffect(() => {
      deepSeekKeyManager.syncKeys(core.deepseekKey);
  }, [core.deepseekKey]);

  // GIÁM SÁT HẠN SỬ DỤNG NGAY CẢ KHI APP ĐANG MỞ (không đóng tab):
  // Trước đây EXPIRY_TS chỉ được kiểm tra 1 LẦN lúc bấm "Vào Ứng Dụng" ở IntroPage. Nếu người
  // dùng đã vào app từ trước khi hết hạn và cứ để tab mở xuyên qua thời điểm hết hạn, họ vẫn dùng
  // được app bình thường (vì không có gì kiểm tra lại sau đó). Effect này chủ động:
  //   1. Kiểm tra định kỳ (mỗi 30s) — đủ nhanh để không cần chờ người dùng F5 mà vẫn nhẹ tài nguyên.
  //   2. Kiểm tra ngay khi tab được focus/visible trở lại (visibilitychange) — xử lý luôn trường
  //      hợp máy sleep/tab bị trình duyệt "đóng băng" khiến setInterval bị trì hoãn.
  // Khi phát hiện đã quá EXPIRY_TS, set forceShowIntro=true để App tự động render lại IntroPage
  // (đã tự hiện thông báo "hết hạn" ngay khi mount — xem IntroPage.tsx), coi như đá người dùng
  // ra khỏi app, chặn truy cập tiếp mà không cần họ phải tắt/mở lại tab.
  // FIX59 (Lite): lắng nghe event yêu cầu nhập API Key Gemini -> mở Cài đặt
  const setShowSettings = ui.setShowSettings;
  useEffect(() => {
      const openKey = () => setShowSettings(true);
      window.addEventListener('open-gemini-key-settings', openKey);
      return () => window.removeEventListener('open-gemini-key-settings', openKey);
  }, [setShowSettings]);

  useEffect(() => {
      if (!ACCESS_CONFIG.EXPIRY_TS && !IS_LITE) return;

      const checkExpiry = () => {
          // FIX59: dùng isWithinLicense() hợp nhất — Full theo EXPIRY_TS, Lite chỉ mở ngày 1-3
          if (!isWithinLicense()) {
              setForceShowIntro(true);
          }
      };

      checkExpiry(); // Kiểm tra ngay lập tức (phòng trường hợp mount sau khi đã hết hạn)

      const intervalId = setInterval(checkExpiry, 30000);

      const handleVisibility = () => {
          if (document.visibilityState === 'visible') checkExpiry();
      };
      document.addEventListener('visibilitychange', handleVisibility);

      return () => {
          clearInterval(intervalId);
          document.removeEventListener('visibilitychange', handleVisibility);
      };
  }, []);

  if (!hasSeenIntro || forceShowIntro) {
      return <IntroPage onEnter={() => {
          setHasSeenIntro(true);
          setForceShowIntro(false);
      }} />;
  }

  // Render
  if (!core.isLoaded) {
      return ( <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 text-slate-600 animate-in fade-in"> <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" /> <h2 className="text-xl font-bold">Đang tải dữ liệu...</h2> </div> );
  }

  if (core.isResetting) {
      return ( <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 text-slate-600 animate-in fade-in"> <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" /> <h2 className="text-xl font-bold">Resetting System...</h2> </div> );
  }

  return (
    <div className={`h-[100dvh] w-screen flex flex-col font-sans transition-colors duration-300 overflow-hidden ${ui.isDarkMode ? 'dark bg-slate-950 text-slate-200' : 'bg-slate-50 text-slate-800'}`}
      // TÁI CẤU TRÚC UX kéo-thả: dragleave bắn từ MỌI element con nên trước đây isDragging
      // bật/tắt liên tục (flicker) và không được render ở đâu cả. Dùng depth-counter chuẩn:
      // dragEnter++ / dragLeave-- , chỉ hiện overlay khi depth > 0, drop reset về 0.
      onDragEnter={e => { e.preventDefault(); if (e.dataTransfer?.types?.includes('Files')) { dragDepthRef.current++; ui.setIsDragging(true); } }}
      onDragOver={e => e.preventDefault()}
      onDragLeave={e => { e.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (dragDepthRef.current === 0) ui.setIsDragging(false); }}
      onDrop={e => { e.preventDefault(); dragDepthRef.current = 0; ui.setIsDragging(false); if (e.dataTransfer.files && e.dataTransfer.files.length > 0) fileHandler.processFiles(Array.from(e.dataTransfer.files)); }}>
      <ToastContainer toasts={ui.toasts} removeToast={ui.removeToast} />
      {ui.isDragging && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-600/20 backdrop-blur-sm pointer-events-none animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-3 px-10 py-10 rounded-3xl border-4 border-dashed border-indigo-400 bg-white/95 dark:bg-slate-900/95 shadow-elevation-4">
            <UploadCloud className="w-14 h-14 text-indigo-500" />
            <p className="text-lg font-bold text-indigo-600 dark:text-indigo-300">Thả tệp để nhập vào workspace</p>
            <p className="text-xs text-slate-500">Hỗ trợ: .txt · .epub · .pdf · .zip · .docx</p>
          </div>
        </div>
      )}
      {ui.importProgress && <LoadingModal isOpen={!!ui.importProgress} progress={ui.importProgress} />}
      {ui.actionProgress && (
        <LoadingModal
          isOpen={!!ui.actionProgress}
          progress={ui.actionProgress}
          // Chỉ cho hủy khi đây là tác vụ chuẩn hóa tiêu đề bằng AI (có thể chạy lâu / bị treo do mạng-API).
          // Các tác vụ nhanh khác (tải file, dọn dẹp...) tự kết thúc nên không cần nút hủy.
          onCancel={engine.isNormalizingTitles ? engine.stopTitleNormalization : undefined}
        />
      )}
      
      <RawDownloadModal isOpen={ui.showRawDownloadModal} onClose={() => ui.setShowRawDownloadModal(false)} onConfirm={(parts) => fileHandler.handleDownloadRaw(parts)} />
      
      <ApiSettingsModal isOpen={ui.showSettings} onClose={() => ui.setShowSettings(false)} deepseekKey={core.deepseekKey} setDeepseekKey={core.setDeepseekKey} deepseekModel={core.deepseekModel} setDeepseekModel={core.setDeepseekModel} triageDelays={core.triageDelays} setTriageDelays={core.setTriageDelays} />

      <ModalManager 
        // State Props
        showPasteModal={ui.showPasteModal} setShowPasteModal={ui.setShowPasteModal}
        showFindReplace={ui.showFindReplace} setShowFindReplace={ui.setShowFindReplace}
        confirmModal={ui.confirmModal} setConfirmModal={ui.setConfirmModal}
        importModal={ui.importModal} setImportModal={ui.setImportModal}
        splitterModal={ui.splitterModal} setSplitterModal={ui.setSplitterModal}
        zipActionModal={ui.zipActionModal} setZipActionModal={ui.setZipActionModal} zipActionModalSourceType={ui.zipActionModalSourceType}
        showGuide={ui.showGuide} setShowGuide={ui.setShowGuide}
        showStartOptions={ui.showStartOptions} setShowStartOptions={ui.setShowStartOptions}
        showNameAnalysisModal={ui.showNameAnalysisModal} setShowNameAnalysisModal={ui.setShowNameAnalysisModal}
        showSmartStartModal={ui.showSmartStartModal} setShowSmartStartModal={ui.setShowSmartStartModal}
        showChangelog={ui.showChangelog} setShowChangelog={ui.setShowChangelog}
        editingFileId={ui.editingFileId} setEditingFileId={ui.setEditingFileId}
        showRetranslateModal={ui.showRetranslateModal} setShowRetranslateModal={ui.setShowRetranslateModal}
        showEpubModal={ui.showEpubModal} setShowEpubModal={ui.setShowEpubModal}
        showLogs={ui.showLogs} setShowLogs={ui.setShowLogs}
        systemLogs={ui.systemLogs} clearLogs={ui.clearLogs}
        showPromptDesigner={ui.showPromptDesigner} setShowPromptDesigner={ui.setShowPromptDesigner}
        showAutomationModal={ui.showAutomationModal} setShowAutomationModal={ui.setShowAutomationModal}
        
        // Data Props
        files={core.files}
        storyInfo={core.storyInfo}
        setStoryInfo={core.setStoryInfo}
        coverImage={core.coverImage}
        setCoverImage={core.setCoverImage}
        dictionary={core.additionalDictionary}
        setAdditionalDictionary={core.setAdditionalDictionary}
        promptTemplate={core.promptTemplate}
        totalFiles={core.files.length}
        selectedCount={ui.selectedFiles.size}
        isOptimizingPrompt={ui.isOptimizingPrompt}
        
        // Handlers from Hooks
        handlePasteConfirm={fileHandler.handlePasteConfirm}
        handleImportAppend={fileHandler.handleImportAppend}
        handleImportOverwrite={fileHandler.handleImportOverwrite}
        handleSplitConfirm={fileHandler.handleSplitConfirm}
        handleZipKeepSeparate={fileHandler.handleZipKeepSeparate}
        handleZipMergeAndSplit={fileHandler.handleZipMergeAndSplit}
        handleRegenerateCover={async (info) => {
            const { createCoverPrompt, generateCoverImage, addTextToCover } = await import('./services/workflows/analyzer');
            const prompt = await createCoverPrompt(info, info.summary || "");
            const baseCover = await generateCoverImage(prompt, core.enabledModels);
            if (baseCover) {
                const finalCover = await addTextToCover(baseCover, info.title, info.author);
                core.setCoverImage(finalCover);
                ui.addToast("Tạo ảnh bìa thành công!", "success");
                return finalCover;
            } else {
                ui.addToast("Tạo ảnh bìa thất bại.", "error");
                return null;
            }
        }}
        handleEpubConfirm={async (updatedInfo, updatedCover, customFont, designOptions, designAssets) => {
            await appHandlers.handleRemoveJunk('all');
            await engine.handleTitleNormalization('all');
            await appHandlers.handleManualCleanup('all');
            await fileHandler.performEpubGeneration(updatedInfo, updatedCover, customFont, designOptions, designAssets);
        }}
        
        handleConfirmStart={(tier, translationModels) => {
            // FIX (bug thực tế 19/8: automation báo "Hoàn tất" trong khi batch 549 tệp vẫn đang
            // dịch dở dưới nền): nếu người dùng bấm "Bắt Đầu" thủ công (StartOptionsModal) trong
            // lúc Automation vẫn đang chạy (dù đang ở bước nào - dịch/sửa lỗi/chuẩn hóa tiêu đề...),
            // KHÔNG cho khởi động thêm 1 phiên executeProcessing() thứ 2 song song. Trước đây không
            // có chặn này: Automation chỉ theo dõi cờ isProcessing của ĐÚNG phiên dịch nó tự gọi ở
            // Bước 4; nếu người dùng bấm Bắt Đầu thêm 1 lần nữa (vd sau khi tự tay Tách/Gộp chương
            // để sửa file lỗi), sẽ tạo ra 1 phiên dịch mới, độc lập, KHÔNG được Automation theo dõi.
            // Khi phiên CŨ mà Automation đang đợi kết thúc trước, Automation tưởng nhầm "mọi việc đã
            // xong" (vì cờ isProcessing nó theo dõi đã tắt), báo "Hoàn tất" và chạy nốt các bước còn
            // lại (chuẩn hóa tiêu đề, dọn định dạng) - trong khi phiên dịch MỚI vẫn đang chạy ngầm,
            // còn quota nên cứ tiếp tục dịch bình thường, không còn ai theo dõi/báo cáo tiến độ nữa.
            if (automation.automationState.isRunning) {
                ui.addToast("Đang có Quy trình Tự động hóa chạy dở (không chỉ riêng bước Dịch), vui lòng đợi hoàn tất hoặc bấm Dừng Tự động hóa trước khi Bắt đầu dịch thủ công - tránh 2 phiên dịch chạy chồng lên nhau.", "warning");
                ui.setShowStartOptions(false);
                return;
            }
            ui.setShowStartOptions(false);
            engine.setTranslationTier(tier);
            engine.executeProcessing(false, tier, translationModels);
        }}
        handleRetranslateConfirm={(keepOld, tier) => {
            // Cùng lý do như trên: "Dịch lại N chương" cũng tự đặt isProcessing=true và có thể tạo
            // ra 1 luồng dịch song song không được Automation theo dõi nếu bấm giữa lúc Automation
            // đang chạy.
            if (automation.automationState.isRunning) {
                ui.addToast("Đang có Quy trình Tự động hóa chạy dở, vui lòng đợi hoàn tất hoặc bấm Dừng Tự động hóa trước khi Dịch lại thủ công - tránh 2 phiên dịch chạy chồng lên nhau.", "warning");
                return;
            }
            engine.handleRetranslateConfirm(Array.from(ui.selectedFiles), keepOld, tier);
        }}
        
        handlePromptDesignerConfirm={automation.handlePromptDesignerConfirm}
        handleAutomationStart={automation.handleAutomationStart}
        handleAutomationStop={handleAutomationStop} 
        resumeAutomationWithCooldown={automation.resumeAutomationWithCooldown}
        automationState={automation.automationState}
        
        // PASS NEW CONFIG PROPS
        automationInitialConfig={ui.automationInitialConfig} 
        
        handleNameAnalysis={appHandlers.handleNameAnalysis}
        nameAnalysisProgress={ui.nameAnalysisProgress}
        isAnalyzingNames={ui.isAnalyzingNames} 
        
        handleSmartStartRun={appHandlers.handleSmartStartRun}
        handleSkipSmartStart={() => { 
          ui.setShowSmartStartModal(false); 
          ui.setAutomationInitialConfig({ steps: [0,1,2,3,4,5,6,7], rules: (core.storyInfo.additionalRules || "").replace(/Nếu văn bản gốc chứa nội dung nhạy cảm.*thành công\./g, 'Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.'), tier: 'normal' });
          ui.setShowAutomationModal(true); 
        }}
        smartStartStep={ui.smartStartStep}
        autoOptimizePrompt={ui.autoOptimizePrompt}
        setAutoOptimizePrompt={ui.setAutoOptimizePrompt}
        
        saveEditor={(id, content) => { core.setFiles(prev => prev.map(f => f.id === id ? {...f, translatedContent: content, remainingRawCharCount: countForeignChars(content), status: FileStatus.COMPLETED, usedModel: 'Thủ công', errorMessage: undefined, ratioWarning: undefined, integrityOverrideAccepted: true, isRescueLocked: false} : f)); ui.setEditingFileId(null); }}
        autoSaveEditor={autoSaveEditor}
        addToast={ui.addToast}
        handleFindReplace={appHandlers.handleFindReplace}
        
        isSmartAutoMode={engine.isSmartAutoMode}
        selectedTemplateKey="" setSelectedTemplateKey={() => {}}
        handleFindReplaceInFile={appHandlers.handleFindReplaceInFile}
        deepseekKey={core.deepseekKey}
        deepseekModel={core.deepseekModel}
        setDeepseekKey={core.setDeepseekKey}
        setDeepseekModel={core.setDeepseekModel}
        handleRefineAdditionalRules={appHandlers.handleRefineAdditionalRules}
        
        // IMPLEMENTED HANDLERS (New)
      />

      {/* Database Load Error Overlay */}
      {core.loadError && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-8 text-center border border-rose-200 dark:border-rose-900/50">
            <div className="w-16 h-16 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Lỗi Kết Nối Bộ Nhớ</h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8 leading-relaxed">
              Ứng dụng không thể kết nối với cơ sở dữ liệu trình duyệt (IndexedDB). Điều này thường xảy ra do trình duyệt đang khóa dữ liệu hoặc bộ nhớ bị đầy.
              <br /><br />
              <span className="font-bold text-rose-500">Vui lòng tải lại trang (F5) hoặc đóng bớt các tab đang mở để khắc phục.</span>
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-200 dark:shadow-none"
            >
              Tải Lại Trang Ngay
            </button>
          </div>
        </div>
      )}

      <MainUI 
        activeTab={ui.activeTab}
        setActiveTab={ui.setActiveTab}
        files={core.files}
        stats={stats}
        progressPercentage={progressPercentage}
        storyInfo={core.storyInfo}
        setStoryInfo={core.setStoryInfo}
        setStoryInfoSafe={core.setStoryInfo}
        setFilesSafe={core.setFiles}
        setCoverImage={core.setCoverImage}
        
        showSettings={ui.showSettings}
        setShowSettings={ui.setShowSettings}
        showLogs={ui.showLogs}
        setShowLogs={ui.setShowLogs}
        systemLogs={ui.systemLogs}
        hasLogErrors={ui.hasLogErrors}
        isDragging={ui.isDragging}
        
        isAutoSaving={core.isAutoSaving}
        lastSaved={core.lastSaved}
        
        enabledModels={core.enabledModels}
        toggleModel={handleToggleModel}
        modelConfigs={core.modelConfigs}
        
        // --- PASS REAL MODEL USAGES HERE ---
        modelUsages={core.modelUsages} 
        
        handleManualResetQuota={() => {
            quotaManager.clearUsage();
            deepSeekKeyManager.resetQuota();
            core.setModelUsages(quotaManager.getUsageSnapshot());
            ui.addToast("Đã reset sử dụng API Quota và DeepSeek.", "success");
        }}
        handleTestModel={appHandlers.handleTestModel} // Pass real implementation
        testingModelId={ui.testingModelId} // Pass state
        
        batchLimits={core.batchLimits}
        setBatchLimits={core.setBatchLimits}
        ratioLimits={core.ratioLimits}
        setRatioLimits={core.setRatioLimits}
        
        isDarkMode={ui.isDarkMode}
        toggleDarkMode={ui.toggleDarkMode}
        
        // Concurrency
        concurrency={core.concurrency}
        setConcurrency={core.setConcurrency}
        
        // Creative
        creativeState={core.creativeState}
        setCreativeState={core.setCreativeState}

        // SinoVietnamese
        sinoVietnameseState={core.sinoVietnameseState}
        setSinoVietnameseState={core.setSinoVietnameseState}

        // FixError
        fixErrorState={core.fixErrorState}
        setFixErrorState={core.setFixErrorState}

        // Dashboard
        coverPreviewUrl={ui.coverPreviewUrl}
        handleCoverUpload={handleCoverUpload}
        handleAutoAnalyze={automation.handleAutoAnalyze}
        handleRefineSummary={appHandlers.handleRefineSummary}
        isAutoAnalyzing={ui.isAutoAnalyzing}
        autoAnalyzeStatus={ui.autoAnalyzeStatus}
        quickInput={ui.quickInput}
        setQuickInput={ui.setQuickInput}
        handleQuickParse={appHandlers.handleQuickParse}
        handleRegenerateCover={async () => { 
             ui.setIsGeneratingCover(true);
             try {
                 const { createCoverPrompt, generateCoverImage, addTextToCover } = await import('./services/workflows/analyzer');
                 const prompt = await createCoverPrompt(core.storyInfo, core.storyInfo.summary || "");
                 const baseCover = await generateCoverImage(prompt, core.enabledModels);
                 if (baseCover) {
                     const finalCover = await addTextToCover(baseCover, core.storyInfo.title, core.storyInfo.author);
                     core.setCoverImage(finalCover);
                     ui.addToast("Tạo ảnh bìa thành công!", "success");
                 } else {
                     ui.addToast("Tạo ảnh bìa thất bại.", "error");
                 }
             } catch (e: any) {
                 console.error("Cover generation error:", e);
                 ui.addToast(`Lỗi tạo ảnh bìa: ${e.message}`, "error");
             } finally {
                 ui.setIsGeneratingCover(false);
             }
        }}
        isGeneratingCover={ui.isGeneratingCover}
        handleBackup={fileHandler.handleBackup}
        handleRestore={fileHandler.handleRestore}
        handleSyncSupportInfo={fileHandler.handleSyncSupportInfo}
        handleExportSupportInfo={fileHandler.handleExportSupportInfo}
        requestResetApp={appHandlers.requestResetApp}
        
        // Knowledge
        handleContextDownload={() => downloadTextFile("Context.txt", core.storyInfo.contextNotes || "")}
        handleContextFileUpload={appHandlers.handleContextFileUpload} // Pass real handler
        setShowContextBuilder={ui.setShowContextBuilder}
        setShowNameAnalysisModal={ui.setShowNameAnalysisModal}
        isAnalyzingNames={ui.isAnalyzingNames}
        handleRefineContext={appHandlers.handleRefineContext}
        isRefiningContext={ui.isRefiningContext}
        setShowSmartStartModal={ui.setShowSmartStartModal}
        viewOriginalPrompt={ui.viewOriginalPrompt}
        setViewOriginalPrompt={ui.setViewOriginalPrompt}
        handlePromptUpload={appHandlers.handlePromptUpload} // Pass real handler
        resetPrompt={() => core.setPromptTemplate(generateBasePrompt(core.storyInfo.genres, core.storyInfo.worldSetting || []))}
        promptTemplate={core.promptTemplate}
        setPromptTemplate={core.setPromptTemplate}
        handleOptimizePrompt={() => ui.setShowPromptDesigner(true)}
        isOptimizingPrompt={ui.isOptimizingPrompt}
        handleDictionaryDownload={() => downloadTextFile("Dictionary.txt", core.additionalDictionary)}
        handleDictionaryUpload={appHandlers.handleDictionaryUpload} // Pass real handler
        dictTab={ui.dictTab}
        setDictTab={ui.setDictTab}
        additionalDictionary={core.additionalDictionary}
        setAdditionalDictionary={core.setAdditionalDictionary}
        setShowPromptDesigner={ui.setShowPromptDesigner}
        
        // Workspace
        currentPage={ui.currentPage}
        setCurrentPage={ui.setCurrentPage}
        totalPages={totalPages}
        visibleFiles={visibleFiles} // Calculated locally
        selectedFiles={ui.selectedFiles}
        setSelectedFiles={ui.setSelectedFiles}
        handleSelectFile={appHandlers.handleSelectFile}
        handleManualFixSingle={engine.handleManualFixSingle}
        handleRescueCopy={appHandlers.handleRescueCopy}
        requestRetranslateSingle={requestRetranslateSingle}
        openEditor={openEditor}
        handleRemoveFile={appHandlers.handleRemoveFile}
        handleFileUpload={appHandlers.handleFileUpload}
        handleTranslatedFileUpload={appHandlers.handleTranslatedFileUpload}
        setShowPasteModal={ui.setShowPasteModal}
        selectAll={appHandlers.selectAll}
        rangeStart={ui.rangeStart}
        setRangeStart={ui.setRangeStart}
        rangeEnd={ui.rangeEnd}
        setRangeEnd={ui.setRangeEnd}
        handleRangeSelect={appHandlers.handleRangeSelect}
        setShowFindReplace={ui.setShowFindReplace}
        isProcessing={engine.isProcessing}
        isCustomFixing={engine.isCustomFixing}
        handleSmartFix={engine.handleSmartFix}
        handleAutoFixRaw={engine.handleManualAutoFixRaw}
        
        showFilterPanel={ui.showFilterPanel}
        setShowFilterPanel={ui.setShowFilterPanel}
        filterModels={ui.filterModels}
        filterStatuses={ui.filterStatuses}
        toggleFilterModel={toggleFilterModel}
        toggleFilterStatus={toggleFilterStatus}
        clearFilters={clearFilters}
        
        handleScanJunk={fileHandler.handleScanJunk}
        handleScanFuzzyDuplicates={fileHandler.handleScanFuzzyDuplicates}
        handleRemoveDuplicates={fileHandler.handleRemoveDuplicates}
        handleAutoSplitChapters={fileHandler.handleAutoSplitChapters}
        handleFilterMismatchedRatio={appHandlers.handleFilterMismatchedRatio}
        handleManualCleanup={appHandlers.handleManualCleanup}
        handleRemoveJunk={appHandlers.handleRemoveJunk}
        handleTitleNormalization={engine.handleTitleNormalization}
        stopTitleNormalization={engine.stopTitleNormalization}
        isNormalizingTitles={engine.isNormalizingTitles}
        handleCustomErrorCorrection={engine.handleCustomErrorCorrection}
        handleAnalyzeCustomError={engine.handleAnalyzeCustomError}
        stopCustomFixing={engine.stopCustomFixing}
        setShowRetranslateModal={ui.setShowRetranslateModal}
        handleSmartDelete={appHandlers.handleSmartDelete} 
        requestDeleteAll={appHandlers.requestDeleteAll}
        
        handleDownloadRaw={fileHandler.handleDownloadRaw}
        handleDownloadTranslatedZip={fileHandler.handleDownloadTranslatedZip}
        handleDownloadMerged={fileHandler.handleDownloadMerged}
        handleExportDocx={fileHandler.handleExportDocx}
        handleMergeSelected={appHandlers.handleMergeSelected}
        handleDictionaryEnforce={appHandlers.handleDictionaryEnforce}
        handleDownloadSelected={appHandlers.handleDownloadSelected} // Pass real implementation
        handleSaveSelected={appHandlers.handleSaveSelected} // NEW
        handleDownloadEpub={() => ui.setShowEpubModal(true)}
        
        stopProcessing={() => { engine.stopProcessing(); automation.stopAutomation(); }}
        handleManualRescueCheck={engine.runManualRescueCheck}
        handleStartButton={() => { 
          if(core.files.length > 0) {
            // Setup automation default config
            ui.setAutomationInitialConfig({ steps: [0,1,2,3,4,5,6,7], rules: (core.storyInfo.additionalRules || "").replace(/Nếu văn bản gốc chứa nội dung nhạy cảm.*thành công\./g, 'Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.'), tier: 'normal' });
            ui.setShowAutomationModal(true); 
          }
        }}
        
        setShowAutomationModal={ui.setShowAutomationModal}
        setShowRawDownloadModal={ui.setShowRawDownloadModal}
        automationState={automation.automationState}
        handleRetranslateConfirm={(keepOld, tier) => engine.handleRetranslateConfirm(Array.from(ui.selectedFiles), keepOld, tier)}
        
        // PASS NEW SETTER PROP
        setAutomationInitialConfig={ui.setAutomationInitialConfig}

        onShowChangelog={() => ui.setShowChangelog(true)}
        onShowIntro={() => setForceShowIntro(true)}
        startTime={engine.startTime}
        setStartTime={engine.setStartTime}
        endTime={engine.endTime}
        setEndTime={engine.setEndTime}
        addLog={ui.addLog}
        setShowGuide={ui.setShowGuide}
        selectedTemplateKey=""
        setSelectedTemplateKey={() => {}}
        addToast={ui.addToast}
        setConfirmModal={ui.setConfirmModal}
        deepseekKey={core.deepseekKey}
        setDeepseekKey={core.setDeepseekKey}
        autoStoppedRemainingCount={engine.autoStoppedRemainingCount}
        continueAfterAutoStop={() => {
            // Cùng lý do khoá 2 chiều như handleConfirmStart/handleRetranslateConfirm ở trên -
            // "Tiếp tục dịch phần còn lại" cũng tự gọi executeProcessing() nên cần chặn tương tự
            // nếu Automation đang chạy dở, tránh 2 phiên dịch chạy chồng lên nhau.
            if (automation.automationState.isRunning) {
                ui.addToast("Đang có Quy trình Tự động hóa chạy dở, vui lòng đợi hoàn tất hoặc bấm Dừng Tự động hóa trước khi tiếp tục dịch thủ công.", "warning");
                return;
            }
            engine.continueAfterAutoStop();
        }}
      />
    </div>
  );
};

export default App;
