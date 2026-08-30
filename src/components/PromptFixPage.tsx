import React, { useState, useMemo, useRef } from 'react';
import { Search, Loader2, FileText, CheckCircle, Upload, RefreshCw, Download, Image as ImageIcon, X, Sparkles, Eye, ShieldAlert, XCircle, Settings, CheckSquare, Square } from 'lucide-react';
import { InlineEnglishFixPanel } from './InlineEnglishFixPanel';
import { MissingInfoModal } from './modals/MissingInfoModal';
import { getMissingSupportInfoLabels, getSparseSupportInfoLabels } from '../utils/storyInfoHelpers';
import { usePromptFixPage, UsePromptFixPageProps } from '../hooks/pages/usePromptFixPage';
import { downloadTextFile } from '../utils/fileHelpers';
import { useOnClickOutside } from '../hooks/useOnClickOutside';

type PromptFixPageProps = UsePromptFixPageProps

export const PromptFixPage: React.FC<PromptFixPageProps> = (props) => {
    const {
        isAnalyzingReq, isScanning, isProposing, isFixing, isPreviewing, scanProgress,
        imageInputRef, fileInputRef,
        setRawErrors, setProcessedFixes, setPrompt,
        rawErrors, processedFixes, fixPrompt, fixImages,
        previewRules, togglePreviewRule, cancelPreview, setAllPreviewRulesEnabled,
        ruleFixSettings, setRuleFixSettings,
        handleImageUpload, handleUploadTxt, removeImage,
        handleAnalyzeRequirements, handleScan, handlePropose, applyFixesToTranslation,
        isWorking,
    } = usePromptFixPage(props);
    const { handleTranslatedFileUpload, handleSyncSupportInfo, handleExportSupportInfo, promptTemplate, dictionary, files, setFilesSafe, addToast, addLog, storyInfo } = props;

    // Nút "Đồng Bộ" + cảnh báo thiếu thông tin cơ bản khi Import file dịch (dành cho người
    // đang dịch truyện và chỉ muốn dùng công cụ Sửa Lỗi ở đây trên 1 file đã dịch sẵn).
    const syncInputRef = useRef<HTMLInputElement>(null);
    const [showMissingInfoModal, setShowMissingInfoModal] = useState(false);
    const [pendingMissingLabels, setPendingMissingLabels] = useState<string[]>([]);
    const handleRequestImport = () => {
        const missing = getMissingSupportInfoLabels(storyInfo, promptTemplate, dictionary);
        if (missing.length > 0) {
            setPendingMissingLabels(missing);
            setShowMissingInfoModal(true);
            return;
        }
        // Không thiếu hẳn field nào, nhưng có thể sơ sài (vd Ngữ cảnh quá ngắn) - chỉ nhắc nhẹ
        // qua toast, không chặn luồng import.
        const sparse = getSparseSupportInfoLabels(storyInfo, promptTemplate, dictionary, {
            minContextLength: ruleFixSettings.sparseContextMinLength,
            minDictEntries: ruleFixSettings.sparseDictMinEntries,
            minPromptLength: ruleFixSettings.sparsePromptMinLength,
        });
        if (sparse.length > 0) {
            addToast(`Lưu ý: ${sparse.join(', ')} có vẻ còn sơ sài - có thể ảnh hưởng độ chính xác khi sửa lỗi.`, 'info');
        }
        fileInputRef.current?.click();
    };

    // Bộ lọc cục bộ cho bảng xem trước (không cần persist — chỉ là tiện ích soát rule).
    const [previewFilter, setPreviewFilter] = useState('');
    const [previewConfidenceFilter, setPreviewConfidenceFilter] = useState<'all' | 'high' | 'low'>('all');
    // Lọc riêng theo trạng thái tick/untick (đề xuất cải thiện tồn đọng) - độc lập với độ tin
    // cậy, giúp soát nhanh khi danh sách dài (vd chỉ muốn xem lại các rule đã BỎ TICH).
    const [previewEnabledFilter, setPreviewEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
    const [previewUseRegex, setPreviewUseRegex] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const settingsRef = useRef<HTMLDivElement>(null);
    useOnClickOutside(settingsRef, () => setShowSettings(false), showSettings);
    const filteredPreviewRules = useMemo(() => {
        if (!previewRules) return null;
        const needle = previewFilter.trim();
        let regex: RegExp | null = null;
        let regexError = false;
        if (previewUseRegex && needle) {
            try { regex = new RegExp(needle, 'iu'); } catch { regexError = true; }
        }
        return previewRules.filter(r => {
            if (previewConfidenceFilter !== 'all' && r.confidence !== previewConfidenceFilter) return false;
            if (previewEnabledFilter === 'enabled' && !r.enabled) return false;
            if (previewEnabledFilter === 'disabled' && r.enabled) return false;
            if (!needle) return true;
            if (previewUseRegex) {
                if (regexError) return true; // regex lỗi cú pháp -> tạm không lọc gì, tránh ẩn hết danh sách
                return regex ? (regex.test(r.wrong) || regex.test(r.right)) : true;
            }
            const lowerNeedle = needle.toLowerCase();
            return r.wrong.toLowerCase().includes(lowerNeedle) || r.right.toLowerCase().includes(lowerNeedle);
        });
    }, [previewRules, previewFilter, previewConfidenceFilter, previewEnabledFilter, previewUseRegex]);
    const previewFilterRegexInvalid = previewUseRegex && !!previewFilter.trim() && (() => {
        try { new RegExp(previewFilter.trim()); return false; } catch { return true; }
    })();

    return (
        <div className="flex flex-col flex-1 min-h-0 w-full bg-slate-50 dark:bg-slate-900 rounded-2xl overflow-hidden shadow-elevation-1 border border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400">
                        <Search className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="font-bold text-base text-slate-800 dark:text-slate-100">AI Quét & Sửa Lỗi Hàng Loạt</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">3.7 Flash quét lỗi thô → 3.1 Pro đề xuất quy tắc → Áp dụng tự động</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 relative">
                    <input type="file" multiple accept="image/*" className="hidden" ref={imageInputRef} onChange={handleImageUpload} />
                    <input type="file" accept=".epub,.zip,.txt,.srt,.vtt" className="hidden" ref={fileInputRef} onChange={handleTranslatedFileUpload} />
                    <input type="file" accept=".json" className="hidden" ref={syncInputRef} onChange={(e) => { handleSyncSupportInfo?.(e); }} />
                    <button
                        onClick={() => setShowSettings(v => !v)}
                        title="Cài đặt"
                        className={`p-2 rounded-xl transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${showSettings ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-600' : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                    >
                        <Settings className="w-4 h-4" />
                    </button>
                    {showSettings && (
                        <div ref={settingsRef} className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-elevation-2 p-4 z-20 space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar">
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Cài đặt Sửa Lỗi Hàng Loạt</p>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400 flex justify-between">
                                    <span>Số dòng/lô hậu kiểm</span>
                                    <span className="font-mono">{ruleFixSettings.postCheckBatchSize}</span>
                                </label>
                                <input
                                    type="number" min={50} max={1000} step={50}
                                    value={ruleFixSettings.postCheckBatchSize}
                                    onChange={e => setRuleFixSettings({ postCheckBatchSize: Math.max(50, Math.min(1000, Number(e.target.value) || 300)) })}
                                    className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400 flex justify-between">
                                    <span>Số lô hậu kiểm chạy song song</span>
                                    <span className="font-mono">{ruleFixSettings.postCheckParallelism}</span>
                                </label>
                                <input
                                    type="number" min={1} max={3} step={1}
                                    value={ruleFixSettings.postCheckParallelism}
                                    onChange={e => setRuleFixSettings({ postCheckParallelism: Math.max(1, Math.min(3, Number(e.target.value) || 2)) })}
                                    className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                                />
                                <p className="text-[10px] text-slate-400">Truyện càng dài (nhiều lô) càng nên tăng để hậu kiểm nhanh hơn, nhưng dễ dồn API cùng lúc hơn.</p>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-slate-500 dark:text-slate-400 flex justify-between">
                                    <span>Ngưỡng hiện ô tìm kiếm (số rule)</span>
                                    <span className="font-mono">{ruleFixSettings.previewSearchThreshold}</span>
                                </label>
                                <input
                                    type="number" min={10} max={500} step={10}
                                    value={ruleFixSettings.previewSearchThreshold}
                                    onChange={e => setRuleFixSettings({ previewSearchThreshold: Math.max(10, Math.min(500, Number(e.target.value) || 40)) })}
                                    className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                                />
                            </div>
                            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Ngưỡng cảnh báo "thông tin sơ sài" khi Import</p>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400 flex justify-between">
                                        <span>Ngữ cảnh tối thiểu (ký tự)</span>
                                        <span className="font-mono">{ruleFixSettings.sparseContextMinLength}</span>
                                    </label>
                                    <input
                                        type="number" min={0} max={1000} step={10}
                                        value={ruleFixSettings.sparseContextMinLength}
                                        onChange={e => setRuleFixSettings({ sparseContextMinLength: Math.max(0, Math.min(1000, Number(e.target.value) || 30)) })}
                                        className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400 flex justify-between">
                                        <span>Từ điển tối thiểu (mục)</span>
                                        <span className="font-mono">{ruleFixSettings.sparseDictMinEntries}</span>
                                    </label>
                                    <input
                                        type="number" min={0} max={100} step={1}
                                        value={ruleFixSettings.sparseDictMinEntries}
                                        onChange={e => setRuleFixSettings({ sparseDictMinEntries: Math.max(0, Math.min(100, Number(e.target.value) || 3)) })}
                                        className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-slate-500 dark:text-slate-400 flex justify-between">
                                        <span>Prompt tối ưu tối thiểu (ký tự)</span>
                                        <span className="font-mono">{ruleFixSettings.sparsePromptMinLength}</span>
                                    </label>
                                    <input
                                        type="number" min={0} max={2000} step={50}
                                        value={ruleFixSettings.sparsePromptMinLength}
                                        onChange={e => setRuleFixSettings({ sparsePromptMinLength: Math.max(0, Math.min(2000, Number(e.target.value) || 200)) })}
                                        className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                                    />
                                </div>
                            </div>
                            <button onClick={() => setShowSettings(false)} className="w-full text-xs py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium">Đóng</button>
                        </div>
                    )}
                    <button
                        onClick={() => handleExportSupportInfo?.()}
                        title="Xuất riêng gói Thông Tin Bổ Trợ (Truyện/Tag/Ngữ Cảnh/Từ Điển/Prompt Tối Ưu/Quy Tắc Bổ Sung) - không kèm file/chương, gọn để mang qua máy/phiên khác"
                        className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        <Download className="w-3.5 h-3.5" /> Xuất Bổ Trợ
                    </button>
                    <button
                        onClick={() => syncInputRef.current?.click()}
                        title="Đồng bộ Thông Tin Truyện / Tag / Ngữ Cảnh / Từ Điển / Prompt Tối Ưu / Quy Tắc Bổ Sung từ file backup"
                        className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        <RefreshCw className="w-3.5 h-3.5" /> Đồng Bộ
                    </button>
                    <button
                        onClick={handleRequestImport}
                        className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        <Upload className="w-3.5 h-3.5" /> Tải File Dịch
                    </button>
                </div>
            </div>

            <MissingInfoModal
                isOpen={showMissingInfoModal}
                missingLabels={pendingMissingLabels}
                onRestore={() => { setShowMissingInfoModal(false); syncInputRef.current?.click(); }}
                onContinue={() => { setShowMissingInfoModal(false); fileInputRef.current?.click(); }}
                onExit={() => setShowMissingInfoModal(false)}
            />

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth p-4 md:p-6 lg:p-8 space-y-6 lg:space-y-8 relative">
                {/* Requirements input */}
                <div className="p-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 rounded-2xl shrink-0 space-y-3 shadow-elevation-1">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Yêu Cầu Sửa Lỗi:</label>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => imageInputRef.current?.click()}
                                className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            >
                                <ImageIcon className="w-3.5 h-3.5" /> Ảnh lỗi
                            </button>
                            <button
                                onClick={handleAnalyzeRequirements}
                                disabled={isWorking}
                                className="px-2.5 py-1.5 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-50 text-amber-700 dark:text-amber-400 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            >
                                {isAnalyzingReq ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                Phân tích (Flash)
                            </button>
                            <button
                                onClick={handleScan}
                                disabled={isWorking}
                                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-elevation-2 shadow-orange-500/20 transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                            >
                                {isScanning ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{scanProgress.total > 0 ? ` ${scanProgress.current}/${scanProgress.total}` : ''}</> : <><Search className="w-3.5 h-3.5" /> Quét</>}
                            </button>
                        </div>
                    </div>

                    {fixImages.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto py-1 custom-scrollbar">
                            {fixImages.map((img, i) => (
                                <div key={i} className="relative shrink-0">
                                    <img src={img} className="h-12 w-12 object-cover rounded-lg border border-slate-300 dark:border-slate-600" alt="" />
                                    <button onClick={() => removeImage(i)} className="absolute -top-1.5 -right-1.5 bg-danger-500 hover:bg-danger-600 text-white rounded-full p-0.5 shadow-elevation-1 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><X className="w-3 h-3" /></button>
                                </div>
                            ))}
                        </div>
                    )}

                    <textarea
                        value={fixPrompt || ''}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder="Ví dụ: Tìm các đoạn bị lỗi xưng hô từ Ta thành Ngươi, hoặc tên nhân vật bị sai...&#10;Nhấn 'Phân tích' để AI đề xuất quy tắc từ mô tả/ảnh. Chỉnh sửa xong rồi nhấn 'Quét'."
                        className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm shadow-elevation-1 focus:ring-2 focus:ring-orange-500 outline-none transition-all duration-200 ease-smooth resize-y min-h-[90px] custom-scrollbar scroll-smooth"
                    />
                    <p className="text-xs text-slate-400 dark:text-slate-500">💡 Sau khi AI phân tích, bạn có thể chỉnh sửa quy tắc trước khi nhấn <strong>Quét</strong></p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 w-full min-h-0">
                    {/* LEFT: Raw errors pane */}
                    <div className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-elevation-1">
                        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950 shrink-0">
                            <div className="font-semibold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                                <FileText className="w-4 h-4 text-rose-500" />
                                Lỗi thô (AI tìm thấy)
                            </div>
                            <div className="flex items-center gap-1">
                                <label className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-500 cursor-pointer transition-colors duration-200 ease-smooth focus-within:ring-2 focus-within:ring-primary-400" title="Tải lên danh sách lỗi thô (.txt)">
                                    <Upload className="w-3.5 h-3.5" />
                                    <input type="file" className="hidden" accept=".txt" onChange={e => handleUploadTxt(e, setRawErrors)} />
                                </label>
                                <button onClick={() => downloadTextFile('Lỗi thô - Sửa lỗi.txt', rawErrors)} disabled={!rawErrors} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-500 disabled:opacity-50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><Download className="w-3.5 h-3.5" /></button>
                            </div>
                        </div>
                        <textarea
                            value={rawErrors || ''}
                            onChange={e => setRawErrors(e.target.value)}
                            className="w-full h-72 lg:h-96 p-4 text-sm font-mono bg-transparent border-none focus:ring-0 outline-none resize-none leading-relaxed custom-scrollbar scroll-smooth text-slate-700 dark:text-slate-300"
                            placeholder="Lỗi thô xuất hiện sau khi quét..."
                            spellCheck={false}
                        />
                    </div>

                    {/* RIGHT: Processed fixes */}
                    <div className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-elevation-1">
                        <div className="px-4 py-3 border-b border-primary-100 dark:border-primary-900/30 flex justify-between items-center bg-primary-50/50 dark:bg-primary-950 shrink-0">
                            <div className="font-semibold gap-2 items-center flex text-primary-700 dark:text-primary-400 text-sm">
                                <CheckCircle className="w-4 h-4" />
                                Quy tắc ĐÃ XỬ LÝ
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handlePropose}
                                    disabled={isWorking || !rawErrors.trim()}
                                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all duration-200 ease-smooth shadow-glow-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                                >
                                    {isProposing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đề xuất...</> : <><Sparkles className="w-3.5 h-3.5" /> Đề xuất Pro</>}
                                </button>
                                <label className="p-1.5 hover:bg-primary-100 dark:hover:bg-primary-900/50 rounded-lg text-primary-500 cursor-pointer transition-colors duration-200 ease-smooth focus-within:ring-2 focus-within:ring-primary-400" title="Tải lên quy tắc đã xử lý (.txt)">
                                    <Upload className="w-3.5 h-3.5" />
                                    <input type="file" className="hidden" accept=".txt" onChange={e => handleUploadTxt(e, setProcessedFixes)} />
                                </label>
                                <button onClick={() => downloadTextFile('Quy tắc đã xử lý.txt', processedFixes)} disabled={!processedFixes} className="p-1.5 hover:bg-primary-100 dark:hover:bg-primary-900/50 rounded-lg text-primary-500 disabled:opacity-50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><Download className="w-3.5 h-3.5" /></button>
                            </div>
                        </div>
                        <div className="flex-1 flex flex-col relative w-full h-72 lg:h-96">
                            <textarea
                                value={processedFixes || ''}
                                onChange={e => setProcessedFixes(e.target.value)}
                                className="absolute inset-0 w-full h-full p-4 text-sm font-mono bg-primary-50/20 dark:bg-primary-950/20 border-none focus:ring-0 outline-none resize-none leading-relaxed custom-scrollbar scroll-smooth text-slate-700 dark:text-slate-300"
                                placeholder="Định dạng: Lỗi cũ = Đoạn mới sửa&#10;(Nhấn 'Đề xuất Pro' sau khi có lỗi thô)"
                                spellCheck={false}
                            />
                        </div>
                        {/* Bảng xem trước (preview) — chỉ hiện sau khi đã đếm thử, chưa ghi đè gì vào file */}
                        {previewRules && previewRules.length > 0 && (
                            <div className="border-t border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 shrink-0">
                                <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                                        <Eye className="w-3.5 h-3.5" /> Xem trước {previewRules.length} quy tắc (chưa áp dụng)
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setAllPreviewRulesEnabled(true)}
                                            disabled={isFixing}
                                            className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 flex items-center gap-1 disabled:opacity-50"
                                        >
                                            <CheckSquare className="w-3.5 h-3.5" /> Tích tất cả
                                        </button>
                                        <button
                                            onClick={() => setAllPreviewRulesEnabled(false)}
                                            disabled={isFixing}
                                            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 disabled:opacity-50"
                                        >
                                            <Square className="w-3.5 h-3.5" /> Bỏ tích tất cả
                                        </button>
                                        <button
                                            onClick={() => { cancelPreview(); setPreviewFilter(''); setPreviewConfidenceFilter('all'); setPreviewEnabledFilter('all'); }}
                                            disabled={isFixing}
                                            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 disabled:opacity-50"
                                        >
                                            <XCircle className="w-3.5 h-3.5" /> Huỷ xem trước
                                        </button>
                                    </div>
                                </div>

                                {/* Ô tìm/lọc — chỉ hiện khi danh sách đủ dài để cần tìm thay vì cuộn tay */}
                                {previewRules.length > ruleFixSettings.previewSearchThreshold && (
                                    <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
                                        <input
                                            type="text"
                                            value={previewFilter}
                                            onChange={(e) => setPreviewFilter(e.target.value)}
                                            placeholder={previewUseRegex ? "Regex, vd: ^Linh.*thạch$" : "Tìm theo cụm sai/đúng..."}
                                            className={`flex-1 min-w-[140px] text-xs px-2.5 py-1.5 rounded-lg border bg-white dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-primary-400 font-mono ${previewFilterRegexInvalid ? 'border-danger-400 text-danger-600' : 'border-amber-200 dark:border-amber-900/50'}`}
                                        />
                                        <label className="text-xs flex items-center gap-1 text-slate-500 dark:text-slate-400 cursor-pointer whitespace-nowrap">
                                            <input type="checkbox" checked={previewUseRegex} onChange={e => setPreviewUseRegex(e.target.checked)} className="accent-primary-600" />
                                            Dùng regex
                                        </label>
                                        <select
                                            value={previewConfidenceFilter}
                                            onChange={(e) => setPreviewConfidenceFilter(e.target.value as 'all' | 'high' | 'low')}
                                            className="text-xs px-2 py-1.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-white dark:bg-slate-900"
                                        >
                                            <option value="all">Tất cả độ tin cậy</option>
                                            <option value="high">Chỉ tin cậy cao</option>
                                            <option value="low">Chỉ cần xem lại</option>
                                        </select>
                                        <select
                                            value={previewEnabledFilter}
                                            onChange={(e) => setPreviewEnabledFilter(e.target.value as 'all' | 'enabled' | 'disabled')}
                                            className="text-xs px-2 py-1.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-white dark:bg-slate-900"
                                        >
                                            <option value="all">Tất cả trạng thái</option>
                                            <option value="enabled">Chỉ rule đang bật</option>
                                            <option value="disabled">Chỉ rule đang tắt</option>
                                        </select>
                                    </div>
                                )}
                                {previewFilterRegexInvalid && (
                                    <p className="px-4 pb-1 text-[10px] text-danger-500">Regex không hợp lệ — đang hiện toàn bộ danh sách (chưa lọc).</p>
                                )}

                                <div className="max-h-56 overflow-y-auto custom-scrollbar px-4 pb-2 space-y-1">
                                    {filteredPreviewRules && filteredPreviewRules.length === 0 && (
                                        <div className="text-xs text-slate-500 text-center py-3">Không có quy tắc nào khớp bộ lọc.</div>
                                    )}
                                    {filteredPreviewRules?.map(rule => (
                                        <label
                                            key={rule.id}
                                            className={`flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 cursor-pointer transition-colors duration-150 ${rule.enabled ? 'bg-white dark:bg-slate-900' : 'bg-slate-100/60 dark:bg-slate-800/40 opacity-60'}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={rule.enabled}
                                                onChange={() => togglePreviewRule(rule.id)}
                                                className="mt-0.5 accent-primary-600"
                                            />
                                            <span className="flex-1 font-mono break-all">
                                                <span className="text-rose-600 dark:text-rose-400">{rule.wrong}</span>
                                                <span className="text-slate-400 mx-1">→</span>
                                                <span className="text-emerald-600 dark:text-emerald-400">{rule.right}</span>
                                            </span>
                                            <span className="shrink-0 flex items-center gap-1">
                                                {rule.confidence === 'low' && (
                                                    <span title="Chỉ xuất hiện 1 lần trong lỗi thô — nên xem lại" className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                                                        <ShieldAlert className="w-3 h-3" /> cần xem lại
                                                    </span>
                                                )}
                                                <span className={`px-1.5 py-0.5 rounded-full ${rule.matchCount > 0 ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'}`}>
                                                    {rule.matchCount} vị trí
                                                </span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0 flex justify-center">
                            <button
                                onClick={applyFixesToTranslation}
                                disabled={isFixing || isPreviewing || !processedFixes.trim() || (previewRules !== null && previewRules.filter(r => r.enabled).length === 0)}
                                className="w-full md:w-auto px-8 py-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm shadow-glow-primary transition-all duration-200 ease-smooth active:scale-95 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                            >
                                {(isFixing || isPreviewing) ? <Loader2 className="w-5 h-5 animate-spin" /> : previewRules ? <CheckCircle className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                {isPreviewing
                                    ? 'Đang xem trước...'
                                    : isFixing
                                        ? 'Đang áp dụng...'
                                        : previewRules
                                            ? `Xác nhận áp dụng (${previewRules.filter(r => r.enabled).length}/${previewRules.length} quy tắc, ${files.length} chap)`
                                            : `Xem trước trước khi áp dụng (${files.length} chap)`}
                            </button>
                        </div>
                    </div>
                </div>

                <InlineEnglishFixPanel 
                    files={files} 
                    setFilesSafe={setFilesSafe} 
                    addToast={addToast} 
                    addLog={addLog} 
                    storyInfo={storyInfo} 
                    promptTemplate={promptTemplate}
                    dictionary={dictionary}
                />
            </div>
        </div>
    );
};
