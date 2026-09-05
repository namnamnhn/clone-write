
import React, { useState } from 'react';
import { Play, CheckSquare, Square, X, Settings, Zap, ShieldAlert, PauseCircle, Minimize2, StopCircle, Key, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import { TranslationTier, AutomationConfig } from '../types';
import { IS_LITE, MODEL_CONFIGS } from '../constants';
import { DEEPSEEK_MODELS } from '../services/api/deepseek';
import { getSelectableTranslationModels, loadTranslationModelSelection, saveTranslationModelSelection } from '../services/workflows/translate/modelSelection';

// Model IDs dùng trong toàn bộ quy trình DeepSeek (trừ tạo bìa)
const DS_MODELS = DEEPSEEK_MODELS.filter(m => m.id === 'deepseek-v4-pro' || m.id === 'deepseek-v4-flash');
const DS_PRO_ID   = 'deepseek-v4-pro';
const DS_FLASH_ID = 'deepseek-v4-flash';

interface AutomationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStart: (config: AutomationConfig) => void;
    onStop: () => void;
    isRunning: boolean;
    currentStep: number;
    countdown: number;
    totalSteps: number;
    stepStatus: string;
    initialConfig: { steps: number[], rules: string, tier: TranslationTier, engine?: 'gemini' | 'deepseek' };
    // DeepSeek credentials (shared với ApiSettingsModal)
    deepseekKey: string;
    deepseekModel: string;
    setDeepseekKey: (v: string) => void;
    setDeepseekModel: (v: string) => void;
}

export const AutomationModal: React.FC<AutomationModalProps> = ({
    isOpen, onClose, onStart, onStop,
    isRunning, currentStep, countdown, totalSteps, stepStatus,
    initialConfig,
    deepseekKey, deepseekModel, setDeepseekKey, setDeepseekModel
}) => {
    /* ─── Local state ─── */
    const [selectedSteps, setSelectedSteps] = useState<number[]>(initialConfig.steps);
    const [rules, setRules]                 = useState(initialConfig.rules || "");
    const [tier, setTier]                   = useState<TranslationTier>(() =>
        IS_LITE && initialConfig.tier !== 'lite' && initialConfig.tier !== 'flash' && initialConfig.tier !== 'deepseek'
            ? 'flash'
            : initialConfig.tier
    );
    const [engine, setEngine]               = useState<'gemini' | 'deepseek'>(initialConfig.engine ?? 'gemini');
    const [translationModelsByTier, setTranslationModelsByTier] = useState<Partial<Record<TranslationTier, string[]>>>(() => {
        const tiers: TranslationTier[] = ['lite', 'flash', 'normal', 'pro', 'full'];
        return tiers.reduce<Partial<Record<TranslationTier, string[]>>>((result, translationTier) => {
            result[translationTier] = loadTranslationModelSelection(translationTier);
            return result;
        }, {});
    });
    const [isMinimized, setIsMinimized]     = useState(false);
    const [prevIsRunning, setPrevIsRunning] = useState(isRunning);

    // DeepSeek key/model edit (local draft, flushed on Start)
    const [localDsKey, setLocalDsKey]       = useState(deepseekKey);
    const [showDsKey, setShowDsKey]         = useState(false);
    const [dsExpanded, setDsExpanded]       = useState(false);

    // DeepSeek model selection: main + fallback
    // Derive initial selection from the shared deepseekModel CSV
    const parseModels = (csv: string): string[] =>
        csv.split(',').map(s => s.trim()).filter(Boolean);

    const [dsMain, setDsMain]         = useState<string[]>(() => {
        const ms = parseModels(deepseekModel);
        return ms.length ? ms : [DS_FLASH_ID];
    });
    const [dsFallback, setDsFallback] = useState<string[]>(() => {
        // dự phòng = phần còn lại
        const ms = parseModels(deepseekModel);
        const mainSet = new Set(ms.length ? ms : [DS_FLASH_ID]);
        return DS_MODELS.filter(m => !mainSet.has(m.id)).map(m => m.id);
    });

    if (isRunning !== prevIsRunning) {
        setPrevIsRunning(isRunning);
        if (!isRunning) setIsMinimized(false);
    }

    /* ─── Model selection logic ─── */
    const bothSelected = dsMain.includes(DS_PRO_ID) && dsMain.includes(DS_FLASH_ID);
    // Nếu chọn cả 2 làm model chính → không cần dự phòng (đã có sẵn fallback trong chuỗi)
    const needFallback = !bothSelected;
    // Khi model chính là Pro → mặc định fallback Flash
    const toggleDsMain = (id: string) => {
        setDsMain(prev => {
            const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
            if (next.length === 0) return prev; // ít nhất 1
            // Cập nhật dự phòng: loại những gì đã có trong main, giữ phần còn lại
            setDsFallback(DS_MODELS.filter(m => !next.includes(m.id)).map(m => m.id));
            return next;
        });
    };
    const toggleDsFallback = (id: string) => {
        if (!needFallback) return;
        setDsFallback(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    // Build deepseekModel CSV (main first, then fallback)
    const buildDsModelCsv = () => {
        const all = [...dsMain];
        if (needFallback) dsFallback.forEach(id => { if (!all.includes(id)) all.push(id); });
        return all.join(',');
    };

    const selectableTranslationModels = getSelectableTranslationModels(tier);
    const selectedTranslationModels = translationModelsByTier[tier] || loadTranslationModelSelection(tier);
    const toggleTranslationModel = (modelId: string) => {
        setTranslationModelsByTier(previous => {
            const current = previous[tier] || loadTranslationModelSelection(tier);
            if (current.includes(modelId) && current.length === 1) return previous;
            const next = current.includes(modelId)
                ? current.filter(id => id !== modelId)
                : selectableTranslationModels.filter(id => current.includes(id) || id === modelId);
            return { ...previous, [tier]: next };
        });
    };

    /* ─── Steps ─── */
    const stepsList = [
        { id: 0, label: "Dọn dẹp Trùng Lặp", desc: "Tự động xóa chapter bị duplicate trước khi dịch." },
        { id: 1, label: "Auto Phân Tích Nhanh", desc: "Quét metadata, tạo bìa, tóm tắt." },
        { id: 2, label: "Phân Tích Chuyên Sâu", desc: "Mở bảng phân tích để bạn kiểm tra & chạy Series Bible." },
        { id: 3, label: "Thiết Kế Prompt (Architect)", desc: "Mở bảng Prompt để bạn kiểm tra & tối ưu hóa." },
        { id: 4, label: "Dịch Thuật (Smart Start)", desc: "Chạy dịch toàn bộ file theo chế độ đã chọn." },
        { id: 5, label: "Smart Fix (Sửa Lỗi)", desc: "Tự động quét và sửa các dòng còn Raw/Lỗi." },
        { id: 6, label: "Chuẩn Hóa Tiêu Đề", desc: "Dùng Flash model để tạo/sửa tiêu đề chương chuẩn." },
        { id: 7, label: "Trợ Lý Local (Format)", desc: "Lọc rác, định dạng chuẩn sách in." },
    ];
    const toggleStep = (id: number) => {
        setSelectedSteps(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id].sort((a, b) => a - b));
    };

    /* ─── Validation ─── */
    const dsKeyOk  = localDsKey.trim().length > 10;
    const canStart = selectedSteps.length > 0
        && (engine === 'gemini' || dsKeyOk)
        && (!selectedSteps.includes(4) || engine === 'deepseek' || selectedTranslationModels.length > 0);

    /* ─── Flush & start ─── */
    const handleStart = () => {
        if (engine === 'deepseek') {
            setDeepseekKey(localDsKey.trim());
            setDeepseekModel(buildDsModelCsv());
        }
        const effectiveTier: TranslationTier = engine === 'deepseek' ? 'deepseek' : tier;
        const translationModels = engine === 'gemini' ? saveTranslationModelSelection(effectiveTier, selectedTranslationModels) : undefined;
        onStart({ steps: selectedSteps, additionalRules: rules, tier: effectiveTier, engine, translationModels });
    };

    if (!isOpen) return null;

    /* ─── MINIMIZED VIEW ─── */
    if (isMinimized && isRunning) {
        return (
            <div className="fixed bottom-24 right-6 z-[200] bg-white dark:bg-slate-900 shadow-2xl border-2 border-yellow-400 rounded-full p-1.5 flex items-center gap-3 animate-in slide-in-from-bottom-10 group pr-2" title="Automation Running">
                <div onClick={() => setIsMinimized(false)} className="flex items-center gap-3 cursor-pointer pl-1">
                    <div className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center text-red-800 font-black relative shadow-sm">
                        {countdown > 0 ? <span className="text-xs">{countdown}s</span> : <span>{currentStep}</span>}
                        <div className="absolute inset-0 border-2 border-yellow-200 rounded-full opacity-0 group-hover:opacity-100 group-hover:animate-ping"></div>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">Auto Mode</span>
                        <span className="text-[9px] font-bold text-slate-500 max-w-[120px] truncate">{countdown > 0 ? "Đang nghỉ (Cooldown)..." : stepStatus}</span>
                    </div>
                </div>
                <button onClick={onStop} className="ml-2 p-2 bg-rose-100 hover:bg-rose-200 text-rose-600 rounded-full transition-colors" title="Dừng khẩn cấp">
                    <StopCircle className="w-5 h-5" />
                </button>
            </div>
        );
    }

    /* ─── NORMAL VIEW ─── */
    return (
        <div className={`fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 animate-in fade-in duration-300 ${isRunning ? 'pointer-events-none' : ''}`}>
            <div className={`bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-300 border border-yellow-400/50 flex flex-col max-h-[90vh] relative ${isRunning ? 'pointer-events-auto' : ''}`}>

                {/* Header */}
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-yellow-50 dark:bg-yellow-900/10 flex justify-between items-center flex-shrink-0">
                    <h3 className="font-bold text-xl text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Zap className="w-6 h-6 text-yellow-500 fill-yellow-500" />
                        {isRunning ? "Đang Chạy Tự Động..." : "Thiết Lập Tự Động Hóa"}
                    </h3>
                    <div className="flex items-center gap-2">
                        {isRunning && (
                            <button onClick={() => setIsMinimized(true)} className="p-1.5 hover:bg-yellow-200 dark:hover:bg-yellow-800/30 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 transition-colors" title="Thu nhỏ">
                                <Minimize2 className="w-5 h-5" />
                            </button>
                        )}
                        {!isRunning && <button onClick={onClose}><X className="w-6 h-6 text-slate-400 hover:text-slate-600" /></button>}
                    </div>
                </div>

                {/* ─── RUNNING STATE ─── */}
                {isRunning ? (
                    <div className="p-10 flex flex-col items-center justify-center text-center space-y-6 overflow-y-auto flex-1">
                        <div className="relative flex-shrink-0">
                            <div className="w-32 h-32 rounded-full border-8 border-slate-100 dark:border-slate-800 flex items-center justify-center">
                                <span className={`text-4xl font-black ${countdown > 0 ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200'}`}>
                                    {countdown > 0 ? countdown : currentStep}
                                </span>
                            </div>
                            {countdown === 0 && <div className="absolute inset-0 rounded-full border-8 border-yellow-500 border-t-transparent animate-spin"></div>}
                            {countdown > 0  && <div className="absolute inset-0 rounded-full border-8 border-rose-200 dark:border-rose-900/30"></div>}
                        </div>
                        <div className="flex-shrink-0">
                            <h4 className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mb-2">
                                {countdown > 0 ? "Đang nghỉ an toàn (Cooldown)..." : `Đang thực hiện bước ${currentStep}...`}
                            </h4>
                            <p className="text-sm text-slate-500 max-w-xs mx-auto font-medium">
                                {countdown > 0 ? "Chờ hồi phục giới hạn API (Tránh lỗi 429)" : (stepsList.find(s => s.id === currentStep)?.label || stepStatus)}
                            </p>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 mt-4 flex-shrink-0">
                            <div className="bg-gradient-to-r from-yellow-400 to-red-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${(currentStep / (totalSteps || 1)) * 100}%` }}></div>
                        </div>
                        {countdown > 0 ? (
                            <div className="flex items-center gap-2 text-rose-500 bg-rose-50 dark:bg-rose-900/20 px-4 py-2 rounded-lg text-xs font-bold animate-pulse flex-shrink-0">
                                <PauseCircle className="w-4 h-4" /> Hệ thống đang nghỉ ngơi...
                            </div>
                        ) : (
                            <button onClick={() => setIsMinimized(true)} className="text-xs text-slate-400 font-bold uppercase tracking-widest hover:text-indigo-500 transition-colors flex items-center gap-1 flex-shrink-0">
                                <Minimize2 className="w-3 h-3" /> Thu nhỏ để làm việc khác
                            </button>
                        )}
                        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 w-full flex-shrink-0 mt-auto">
                            <button onClick={onStop} className="mx-auto px-6 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold shadow-lg shadow-rose-200/50 transition-all flex items-center gap-2 text-sm">
                                <StopCircle className="w-4 h-4" /> Dừng Khẩn Cấp
                            </button>
                        </div>
                    </div>

                /* ─── CONFIG STATE ─── */
                ) : (
                    <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">

                        {/* ── RULES ── */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-2">
                                <Settings className="w-3.5 h-3.5" /> Quy tắc bổ sung (Áp dụng toàn cục)
                            </label>
                            <textarea
                                className="w-full h-20 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-yellow-400 transition-all resize-none"
                                placeholder="VD: Giữ nguyên tên tiếng Anh, văn phong hài hước, không viết tắt..."
                                value={rules}
                                onChange={e => setRules(e.target.value)}
                            />
                        </div>

                        {/* ── ENGINE SELECTOR ── */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5" /> Phiên bản AI
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                {/* Gemini */}
                                <button
                                    onClick={() => setEngine('gemini')}
                                    className={`p-3 rounded-xl border-2 text-left transition-all ${engine === 'gemini' ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-base">✨</span>
                                        <span className={`text-sm font-bold ${engine === 'gemini' ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-400'}`}>Gemini</span>
                                        {engine === 'gemini' && <span className="ml-auto text-[9px] font-bold bg-indigo-500 text-white px-1.5 py-0.5 rounded-full">✓ Đang dùng</span>}
                                    </div>
                                    <p className="text-[10px] text-slate-500">Toàn bộ quy trình như hiện tại. Tạo bìa, phân tích, dịch đều dùng Gemini.</p>
                                </button>

                                {/* DeepSeek */}
                                <button
                                    onClick={() => { setEngine('deepseek'); setDsExpanded(true); }}
                                    className={`p-3 rounded-xl border-2 text-left transition-all ${engine === 'deepseek' ? 'border-teal-400 bg-teal-50 dark:bg-teal-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-base">🐳</span>
                                        <span className={`text-sm font-bold ${engine === 'deepseek' ? 'text-teal-700 dark:text-teal-300' : 'text-slate-600 dark:text-slate-400'}`}>DeepSeek</span>
                                        {engine === 'deepseek' && <span className="ml-auto text-[9px] font-bold bg-teal-500 text-white px-1.5 py-0.5 rounded-full">✓ Đang dùng</span>}
                                    </div>
                                    <p className="text-[10px] text-slate-500">Phân tích + Dịch + Fix bằng DeepSeek. Tạo bìa vẫn dùng Gemini. 1 luồng, 1 tệp.</p>
                                </button>
                            </div>
                        </div>

                        {/* ── DEEPSEEK CONFIG (chỉ hiện khi chọn DeepSeek) ── */}
                        {engine === 'deepseek' && (
                            <div className="border-2 border-teal-200 dark:border-teal-800/60 rounded-2xl overflow-hidden">
                                {/* Collapsible header */}
                                <button
                                    onClick={() => setDsExpanded(p => !p)}
                                    className="w-full flex items-center justify-between px-4 py-3 bg-teal-50 dark:bg-teal-900/20 text-left"
                                >
                                    <span className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase flex items-center gap-2">
                                        <Key className="w-3.5 h-3.5" /> Cấu hình DeepSeek
                                        {!dsKeyOk && <span className="text-rose-500 text-[9px] font-bold bg-rose-100 dark:bg-rose-900/30 px-1.5 py-0.5 rounded-full">Chưa có API Key</span>}
                                        {dsKeyOk  && <span className="text-teal-600 text-[9px] font-bold bg-teal-100 dark:bg-teal-900/30 px-1.5 py-0.5 rounded-full">✓ Đã cấu hình</span>}
                                    </span>
                                    {dsExpanded ? <ChevronUp className="w-4 h-4 text-teal-500" /> : <ChevronDown className="w-4 h-4 text-teal-500" />}
                                </button>

                                {dsExpanded && (
                                    <div className="p-4 space-y-4">
                                        {/* API Key */}
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">API Key</label>
                                            <div className="relative">
                                                <input
                                                    type={showDsKey ? 'text' : 'password'}
                                                    value={localDsKey}
                                                    onChange={e => setLocalDsKey(e.target.value)}
                                                    placeholder="sk-..."
                                                    className="w-full px-3 py-2 pr-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-400 font-mono"
                                                />
                                                <button onClick={() => setShowDsKey(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
                                                    {showDsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            </div>
                                            {!dsKeyOk && localDsKey.length > 0 && (
                                                <p className="text-[10px] text-rose-500 mt-1">API Key quá ngắn, vui lòng kiểm tra lại.</p>
                                            )}
                                        </div>

                                        {/* Model chính */}
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">
                                                Model chính <span className="text-slate-400 font-normal normal-case">(tích ít nhất 1)</span>
                                            </label>
                                            <div className="space-y-2">
                                                {DS_MODELS.map(m => (
                                                    <label key={m.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${dsMain.includes(m.id) ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-300 dark:border-teal-700' : 'border-slate-200 dark:border-slate-700 hover:border-teal-200'}`}
                                                        onClick={() => toggleDsMain(m.id)}>
                                                        <div className={`mt-0.5 flex-shrink-0 ${dsMain.includes(m.id) ? 'text-teal-600' : 'text-slate-400'}`}>
                                                            {dsMain.includes(m.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                                        </div>
                                                        <div>
                                                            <span className={`text-xs font-bold ${dsMain.includes(m.id) ? 'text-teal-700 dark:text-teal-300' : 'text-slate-500'}`}>{m.label || m.id}</span>
                                                            {m.id === DS_PRO_ID   && <span className="ml-2 text-[9px] bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 px-1.5 py-0.5 rounded-full font-bold">PRO</span>}
                                                            {m.id === DS_FLASH_ID && <span className="ml-2 text-[9px] bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-300 px-1.5 py-0.5 rounded-full font-bold">FLASH · Mặc định</span>}
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Model dự phòng — chỉ hiện khi KHÔNG chọn cả 2 làm model chính */}
                                        {needFallback && DS_MODELS.filter(m => !dsMain.includes(m.id)).length > 0 && (
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block">
                                                    Model dự phòng <span className="text-slate-400 font-normal normal-case">(tự động chuyển khi model chính lỗi)</span>
                                                </label>
                                                <div className="space-y-2">
                                                    {DS_MODELS.filter(m => !dsMain.includes(m.id)).map(m => (
                                                        <label key={m.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${dsFallback.includes(m.id) ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-300 dark:border-slate-600' : 'border-slate-200 dark:border-slate-700 opacity-60'}`}
                                                            onClick={() => toggleDsFallback(m.id)}>
                                                            <div className={`mt-0.5 flex-shrink-0 ${dsFallback.includes(m.id) ? 'text-slate-600' : 'text-slate-400'}`}>
                                                                {dsFallback.includes(m.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                                            </div>
                                                            <div>
                                                                <span className={`text-xs font-bold ${dsFallback.includes(m.id) ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400'}`}>{m.label || m.id}</span>
                                                                {/* Gợi ý mặc định */}
                                                                {dsMain.includes(DS_PRO_ID) && m.id === DS_FLASH_ID && (
                                                                    <span className="ml-2 text-[9px] bg-slate-200 dark:bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded-full font-bold">Mặc định cho Pro</span>
                                                                )}
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                                {dsMain.includes(DS_PRO_ID) && !dsMain.includes(DS_FLASH_ID) && dsFallback.length === 0 && (
                                                    <p className="text-[10px] text-amber-600 mt-2">
                                                        ⚠️ Nên chọn V4 Flash làm dự phòng khi dùng V4 Pro để tránh gián đoạn khi quota Pro hết.
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {bothSelected && (
                                            <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300 text-[11px] font-medium bg-teal-50 dark:bg-teal-900/20 px-3 py-2 rounded-lg">
                                                <CheckSquare className="w-3.5 h-3.5 flex-shrink-0" />
                                                Đã chọn cả 2 model làm chính — Pro chạy trước, Flash tự động lên khi Pro lỗi. Không cần chọn thêm dự phòng.
                                            </div>
                                        )}

                                        <p className="text-[10px] text-slate-400 italic">
                                            * Tạo bìa luôn dùng Gemini dù chọn phiên bản nào. Phân tích, dịch, fix đều dùng DeepSeek theo thứ tự model đã chọn.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── STEPS ── */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                <Settings className="w-3.5 h-3.5" /> Quy trình thực hiện
                            </label>
                            <div className="space-y-2">
                                {stepsList.map(step => (
                                    <div
                                        key={step.id}
                                        onClick={() => toggleStep(step.id)}
                                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${selectedSteps.includes(step.id) ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-60'}`}
                                    >
                                        <div className={`mt-0.5 ${selectedSteps.includes(step.id) ? 'text-indigo-600' : 'text-slate-400'}`}>
                                            {selectedSteps.includes(step.id) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                                        </div>
                                        <div>
                                            <h4 className={`text-sm font-bold ${selectedSteps.includes(step.id) ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500'}`}>{step.label}</h4>
                                            <p className="text-[10px] text-slate-500">{step.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ── GEMINI TIER (chỉ hiện khi engine = gemini và có chọn bước dịch) ── */}
                        {engine === 'gemini' && selectedSteps.includes(4) && (
                            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Chế độ dịch Gemini (Bước 4)</label>
                                <div className="flex flex-wrap gap-2">
                                    {(['lite', 'flash', 'normal', 'pro', 'full'] as TranslationTier[]).filter(t => !IS_LITE || t === 'lite' || t === 'flash').map(t => {
                                        return (
                                            <button
                                                key={t}
                                                onClick={() => setTier(t)}
                                                className={`py-1 px-3 rounded-lg text-xs font-bold capitalize transition-all ${tier === t ? 'bg-yellow-400 text-red-700 shadow-md scale-105' : 'bg-white dark:bg-slate-700 text-slate-500'}`}
                                            >
                                                {t}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-[10px] text-slate-500 mt-2 italic">
                                    {tier === 'lite'        && '* Chế độ Lite: ưu tiên Flash Lite, tốc độ cao.'}
                                    {tier === 'flash'       && '* Chế độ Flash: 3 luồng, ưu tiên 3.8 rồi 3.7 / 3.6 Flash.'}
                                    {tier === 'normal'      && '* Chế độ Normal: 3.1 Pro, sau đó 3.8 / 3.7 Flash.'}
                                    {tier === 'pro'         && '* Chế độ Pro: 2 luồng 3.1 Pro, chất lượng cao nhất.'}
                                    {tier === 'full'        && '* Chế độ Full: 3 luồng, ưu tiên Pro, tự chuyển Flash khi hết.'}
                                </p>
                                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Model dùng để dịch</span>
                                        <span className="text-[10px] font-bold text-indigo-600">{selectedTranslationModels.length}/{selectableTranslationModels.length} đã chọn · tối thiểu 1</span>
                                    </div>
                                    {selectableTranslationModels.map((modelId, index) => {
                                        const checked = selectedTranslationModels.includes(modelId);
                                        const modelName = MODEL_CONFIGS.find(model => model.id === modelId)?.name || modelId;
                                        return <label key={modelId} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${checked ? 'border-indigo-200 bg-white dark:border-indigo-700 dark:bg-slate-700' : 'border-slate-200 bg-slate-100 opacity-70 dark:border-slate-700 dark:bg-slate-900'}`}>
                                            <input type="checkbox" checked={checked} disabled={checked && selectedTranslationModels.length === 1} onChange={() => toggleTranslationModel(modelId)} className="h-4 w-4 rounded text-indigo-600 disabled:cursor-not-allowed" />
                                            <span className="min-w-0"><span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">{index + 1}. {modelName}</span><span className="block truncate text-[10px] text-slate-400">{modelId}</span></span>
                                        </label>;
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ── INFO BOX ── */}
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-xl flex items-start gap-3 border border-yellow-200 dark:border-yellow-800/50">
                            <ShieldAlert className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-yellow-800 dark:text-yellow-200 leading-relaxed">
                                Hệ thống tự động nghỉ <b>60 giây</b> sau mỗi bước để hồi phục Quota.
                                <br />Ở <b>Bước 2 & 3</b>, hệ thống mở bảng cấu hình để bạn kiểm tra trước khi chạy.
                                {engine === 'deepseek' && <><br /><b>DeepSeek:</b> 1 luồng, 1 tệp. Tạo bìa vẫn dùng Gemini.</>}
                            </p>
                        </div>
                    </div>
                )}

                {/* Footer */}
                {!isRunning && (
                    <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3 flex-shrink-0">
                        <button onClick={onClose} className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors">Hủy</button>
                        <button
                            onClick={handleStart}
                            disabled={!canStart}
                            title={!canStart ? (selectedSteps.length === 0 ? 'Chọn ít nhất 1 bước' : 'Cần nhập API Key DeepSeek') : ''}
                            className="px-8 py-3 bg-yellow-400 hover:bg-yellow-500 text-red-700 rounded-xl font-bold shadow-lg shadow-yellow-200/50 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Play className="w-5 h-5 fill-current" /> Chạy Tự Động
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
