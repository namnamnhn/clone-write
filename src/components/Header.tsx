
import React, { useState, useEffect } from 'react';
import { 
    Cpu, RefreshCw, Zap, Clock, Timer, CheckCircle, HelpCircle, 
    Terminal, FileText, Loader2, AlertCircle, Settings,
    Activity, Moon, Sun, ChevronUp, ChevronDown, 
    Scale, HardDrive, Maximize, Minimize,
    Ban, Hourglass
} from 'lucide-react';
import { APP_FULL_TITLE } from '../changelog';
import { ModelQuota, BatchLimits, RatioLimits } from '../types';
import { TIER_MODELS, ACCESS_CONFIG } from '../constants';
import { DEFAULT_RATIO_LIMITS } from '../constants/ratioLimits';
import { IS_LITE } from '../constants';
import { quotaManager } from '../utils/quotaManager';
import { clampNumberDraft, NumberInputState, NumberInputValue, syncNumberInputState, toDisplayStr } from './numberInputLocal';

// --- LIVE TIMER COMPONENT (ISOLATED FOR PERFORMANCE) ---
const LiveTimer = ({ startTime, endTime }: { startTime: number, endTime: number | null }) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (endTime) return;
        
        // Update every second
        const intervalId = setInterval(() => {
            setNow(Date.now());
        }, 1000);
        return () => clearInterval(intervalId);
    }, [startTime, endTime]);

    const targetTime = endTime || now;
    const diff = Math.max(0, Math.floor((targetTime - startTime) / 1000));
    
    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');

    return (
        <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-bold min-w-[60px]">
            <Timer className={`w-3 h-3 ${!endTime ? 'animate-pulse' : ''}`} />
            <span>{h}:{m}:{s}</span>
        </div>
    );
};

export const NumberInputLocal = ({ value, onChange, className = "", step = 1, min, max, widthClass = "w-14" }: {
    value: NumberInputValue;
    onChange: (value: NumberInputValue) => void;
    className?: string;
    step?: number;
    min?: number;
    max?: number;
    widthClass?: string;
}) => {
    // FIX (crash "z.toFixed is not a function"): input type="number" của trình duyệt
    // tự "sanitize" các giá trị dở dang không hợp lệ (vd đang gõ "6" rồi bấm "." ra "6.")
    // về chuỗi rỗng '' ngay trong e.target.value, TRƯỚC KHI code kịp xử lý. Giá trị ''
    // đó bị lưu thẳng vào state ratioLimits, và vì '' không phải null/undefined nên toán
    // tử ?? DEFAULT_RATIO_LIMITS không "cứu" được, dẫn tới ''.toFixed() crash ứng dụng.
    // => Chuyển sang input type="text" (inputMode decimal) để giữ lại đúng chuỗi người
    // dùng đang gõ (kể cả trạng thái dở dang như "6." hay "-"), không để trình duyệt
    // âm thầm biến nó thành rỗng.
    const [inputState, setInputState] = React.useState<NumberInputState>(() => ({ text: toDisplayStr(value), syncedValue: value }));

    // Đồng bộ lại từ prop khi giá trị thay đổi từ bên ngoài (vd bấm nút tăng/giảm,
    // load lại cấu hình...), nhưng không ghi đè khi người dùng đang gõ dở một chuỗi
    // mà về mặt số học là tương đương (vd đang gõ "6." trong khi prop value = 6).
    if (!Object.is(inputState.syncedValue, value)) {
        setInputState(syncNumberInputState(inputState, value));
    }
    const localValue = inputState.text;

    const commit = (raw: string) => {
        const committed = clampNumberDraft(raw, min, max);
        if (committed !== null) onChange(committed);
    };

    const handleIncrement = () => {
        const val = parseFloat(localValue);
        const base = Number.isNaN(val) ? (Number.parseFloat(String(value)) || 0) : val;
        let next = base + step;
        if (max !== undefined && next > max) next = max;
        setInputState({ text: String(next), syncedValue: next });
        onChange(next);
    };
    const handleDecrement = () => {
        const val = parseFloat(localValue);
        const base = Number.isNaN(val) ? (Number.parseFloat(String(value)) || 0) : val;
        let next = base - step;
        if (min !== undefined && next < min) next = min;
        setInputState({ text: String(next), syncedValue: next });
        onChange(next);
    };

    const handleChange = (e: any) => {
        const raw = e.target.value;
        // Chỉ chấp nhận ký tự hợp lệ của một số thập phân đang gõ dở: số, tối đa 1 dấu
        // chấm, tối đa 1 dấu trừ ở đầu. Ký tự khác (chữ, dấu chấm thứ 2...) bị bỏ qua,
        // giữ nguyên nội dung ô nhập trước đó thay vì để crash phía sau.
        if (!/^-?\d*\.?\d*$/.test(raw)) return;
        setInputState({ text: raw, syncedValue: value });
        commit(raw);
    };

    const handleBlur = () => {
        const committed = clampNumberDraft(localValue, min, max);
        if (committed === null) {
            setInputState({ text: toDisplayStr(value), syncedValue: value });
            return;
        }
        setInputState({ text: toDisplayStr(committed), syncedValue: committed });
        onChange(committed);
    };

    return (
        <div className={`relative flex items-center ${widthClass}`}>
            <input 
                type="text" 
                inputMode="decimal"
                className={`config-input w-full pr-3.5 ${className}`} 
                value={localValue} 
                onChange={handleChange} 
                onBlur={handleBlur}
            />
            <div className="absolute right-0 top-0 bottom-0 flex flex-col border-l border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 rounded-r overflow-hidden w-3.5 opacity-80 hover:opacity-100">
                <button onClick={handleIncrement} className="flex-1 flex items-center justify-center text-[7px] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 leading-none">▲</button>
                <div className="h-px w-full bg-slate-200 dark:bg-slate-700"></div>
                <button onClick={handleDecrement} className="flex-1 flex items-center justify-center text-[7px] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 leading-none">▼</button>
            </div>
        </div>
    );
};

const CustomNumberInput = NumberInputLocal;

interface HeaderProps {
    stats: any;
    showLogs: boolean;
    setShowLogs: (v: boolean) => void;
    showSettings: boolean;
    setShowSettings: (v: boolean) => void;
    onShowChangelog: () => void;
    onShowIntro: () => void;
    enabledModels: string[];
    modelConfigs: ModelQuota[];
    modelUsages: any;
    toggleModel: (id: string) => void;
    handleManualResetQuota: () => void;
    handleTestModel: (id: string) => void;
    testingModelId: string | null;
    startTime: number | null;
    endTime: number | null;
    hasLogErrors: boolean;
    progressPercentage?: number; 
    batchLimits: BatchLimits;
    setBatchLimits: React.Dispatch<React.SetStateAction<BatchLimits>>;
    ratioLimits: RatioLimits; // Added Ratio Limits
    setRatioLimits: React.Dispatch<React.SetStateAction<RatioLimits>>; // Added Ratio Limits Setter
    concurrency: number | 'auto';
    setConcurrency: React.Dispatch<React.SetStateAction<number | 'auto'>>;
    isDarkMode?: boolean;
    toggleDarkMode?: () => void;
    onShowComicToNovel?: () => void;
}

export const Header: React.FC<HeaderProps> = (props) => {
    const [now, setNow] = useState(() => Date.now());
    const [isExpanded, setIsExpanded] = useState(true);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string | null>(null);
    const [lastManualConcurrency, setLastManualConcurrency] = useState<number>(3);

    useEffect(() => {
        if (props.startTime && !props.endTime && props.progressPercentage && props.progressPercentage > 0 && props.progressPercentage < 100) {
            const interval = setInterval(() => {
                const elapsed = Date.now() - props.startTime!;
                const rate = props.progressPercentage! / elapsed; // percentage per ms
                const remainingPercentage = 100 - props.progressPercentage!;
                const remainingMs = remainingPercentage / rate;
                
                if (remainingMs > 0 && isFinite(remainingMs)) {
                    const seconds = Math.floor((remainingMs / 1000) % 60);
                    const minutes = Math.floor((remainingMs / (1000 * 60)) % 60);
                    const hours = Math.floor((remainingMs / (1000 * 60 * 60)));
                    setEstimatedTimeRemaining(`${hours > 0 ? hours + 'h ' : ''}${minutes}m ${seconds}s`);
                }
            }, 1000);
            return () => clearInterval(interval);
        } else {
            const clearTimer = setTimeout(() => setEstimatedTimeRemaining(null), 0);
            return () => clearTimeout(clearTimer);
        }
    }, [props.startTime, props.endTime, props.progressPercentage]);

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            clearInterval(interval);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch((err) => console.error(err));
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
        }
    };

    const formatNumber = (num: number) => new Intl.NumberFormat('vi-VN').format(num);
    const proModels = props.modelConfigs.filter(m => TIER_MODELS.PRO_POOL.includes(m.id));
    const flashModels = props.modelConfigs.filter(m => TIER_MODELS.FLASH_POOL.includes(m.id));
    
    const renderModelBadge = (config: ModelQuota) => {
        const isEnabled = props.enabledModels.includes(config.id);
        const usage = props.modelUsages[config.id] || { requestsToday: 0, recentRequests: [], isDepleted: false, cooldownUntil: 0 };
        const requestsToday = usage.requestsToday || 0;
        const recentReqs = usage.recentRequests || [];
        const currentRpmCount = recentReqs.filter((t: number) => now - t < 60000).length;
        const isRpmFull = currentRpmCount >= config.rpmLimit;
        const isDepleted = usage.isDepleted;
        
        // Calculate Wait Time
        const cooldownRemaining = Math.max(0, (usage.cooldownUntil || 0) - now);
        const isCoolingDown = cooldownRemaining > 0;

        return (
            <div key={config.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all duration-200 ease-smooth whitespace-nowrap shadow-elevation-1 min-w-[140px]
                ${isDepleted ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900' : 
                  isCoolingDown ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900' :
                  isEnabled ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:shadow-elevation-2 hover:-translate-y-px' : 
                  'bg-slate-50 dark:bg-slate-900 border-transparent opacity-60 grayscale'}`}>
                
                {isDepleted ? <Ban className="w-3.5 h-3.5 text-rose-500 shrink-0" /> : <input type="checkbox" checked={isEnabled} onChange={() => props.toggleModel(config.id)} className="w-3.5 h-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer shrink-0"/>}

                <div className="flex flex-col w-full">
                    <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-bold ${isDepleted ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`} title={config.name}>
                            {config.name.replace('Gemini ', '')}
                        </span>
                        {isDepleted ? (
                            <span className="text-[8px] font-black text-rose-500 border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 px-1 rounded-sm leading-tight">HẾT</span>
                        ) : (
                            <button aria-label="Test tốc độ" onClick={() => props.handleTestModel(config.id)} disabled={!!props.testingModelId} className="p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-sky-600 transition-colors">
                                {props.testingModelId === config.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            </button>
                        )}
                    </div>
                    
                    {/* Logic hiển thị Stats (Vẫn hiện khi Hết RPD) */}
                    {isCoolingDown && !isDepleted ? (
                        <div className="text-[10px] font-bold text-amber-600 dark:text-amber-500 flex items-center gap-1 animate-pulse mt-0.5">
                            <Hourglass className="w-2.5 h-2.5" /> Chờ {(cooldownRemaining/1000).toFixed(0)}s
                        </div>
                    ) : (
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            <span className={isDepleted ? "text-rose-600 dark:text-rose-400 font-bold" : ""}>
                                {requestsToday}/{config.rpdLimit}
                            </span>
                            <span className={`font-bold ${isDepleted ? "text-rose-400" : isRpmFull ? "text-amber-600 animate-pulse" : "text-sky-600"}`}>
                                {currentRpmCount}/{config.rpmLimit} RPM
                            </span>
                        </div>
                    )}

                    {/* FIX67 (đề xuất fix65 — bản Lite nhiều key cá nhân): usage RIÊNG từng key
                        dưới thanh quota của model. fix70 (sửa comment lỗi thời do fix69 để
                        lại): CÂU CŨ "getPerKeySummary trả rỗng ở bản Full nên không render gì"
                        KHÔNG còn đúng — từ fix69, quotaManager.perKeyEnabled luôn bật cho CẢ 2
                        bản (không còn khoá theo IS_LITE), nên khối này giờ TỰ ĐỘNG hiện chip
                        quota riêng từng key (kể cả khi bản Full chỉ có đúng 1 key mặc định, chưa
                        thêm key cá nhân nào) — không cần sửa gì thêm, vẫn không cần rẽ nhánh
                        IS_LITE vì getPerKeySummary() đã tự trả mảng rỗng khi hồ bơi HOÀN TOÀN
                        không có key nào (lỗi cấu hình) hoặc per-key bị tắt thủ công. */}
                    {(() => {
                        const perKeys = quotaManager.getPerKeySummary(config.id);
                        if (perKeys.length === 0) return null;
                        return (
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 pt-1 border-t border-slate-100 dark:border-slate-700/60">
                                {perKeys.map(p => (
                                    <span
                                        key={p.label}
                                        title={`Key ${p.label}${p.isDepleted ? ' đã hết Quota hôm nay' : `: ${p.requestsToday}/${p.rpdLimit} request hôm nay`}`}
                                        className={`text-[9px] leading-tight font-mono ${
                                            p.isDepleted ? 'text-rose-500 line-through'
                                            : p.requestsToday >= p.rpdLimit * 0.8 ? 'text-amber-600 dark:text-amber-500'
                                            : 'text-emerald-600 dark:text-emerald-400'
                                        }`}
                                    >
                                        {p.label} {p.requestsToday}/{p.rpdLimit}
                                    </span>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            </div>
        );
    };

    return (
        <header className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shrink-0 shadow-elevation-1 flex flex-col transition-colors duration-300 relative z-40">
            {/* Top Bar */}
            <div className="px-3 py-1.5 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                    <div className="bg-gradient-to-tr from-primary-600 to-violet-600 p-1 rounded-lg text-white shadow-elevation-1"><Cpu className="w-3.5 h-3.5" /></div>
                    <div>
                        <h1 className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-none">{APP_FULL_TITLE} <span className="text-primary-500 dark:text-primary-400 font-semibold">({ACCESS_CONFIG.EDITION})</span></h1>
                    </div>
                    <button onClick={props.onShowIntro} className="px-2 py-0.5 ml-2 text-[10px] font-bold bg-amber-100/50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 rounded-lg border border-amber-200/50 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">Về tác giả</button>
                    <button aria-label="Hướng dẫn sử dụng" onClick={props.onShowChangelog} className="text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"><HelpCircle className="w-3.5 h-3.5" /></button>
                </div>
                
                <div className="flex items-center gap-1 relative z-50">
                    {props.startTime && (
                        <div className="hidden md:flex items-center gap-2 px-2 py-1 bg-slate-50 dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 text-[10px] font-mono font-medium text-slate-600 dark:text-slate-300 shadow-sm">
                            <Clock className="w-3 h-3 text-sky-500" />
                            <LiveTimer startTime={props.startTime} endTime={props.endTime} />
                        </div>
                    )}
                    
                    <button aria-label="Chuyển đổi giao diện" onClick={props.toggleDarkMode} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-amber-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        {props.isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                    </button>

                    <button aria-label="Toàn màn hình" onClick={toggleFullScreen} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
                    </button>

                    <button aria-label="Cài đặt API" onClick={() => props.setShowSettings(true)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        <Settings className="w-3.5 h-3.5" />
                    </button>

                    <button aria-label="Xem Nhật ký (Logs)" onClick={() => props.setShowLogs(true)} className={`relative p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${props.showLogs ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600' : 'hover:bg-slate-100 text-slate-400'}`}>
                        <Terminal className="w-3.5 h-3.5" />
                        {props.hasLogErrors && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-danger-500 rounded-full animate-ping" />}
                    </button>

                    <button aria-label="Thu gọn/Mở rộng Header" onClick={() => setIsExpanded(!isExpanded)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                </div>
            </div>

            {/* Expandable Area */}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                {/* Models & Stats */}
                <div className="px-3 py-2 overflow-x-auto no-scrollbar flex items-center gap-3">
                    <div className="flex items-center gap-2 shrink-0">
                        {proModels.map(renderModelBadge)}
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0 mx-1"></div>
                        {flashModels.map(renderModelBadge)}
                    </div>
                    <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0 mx-1"></div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 shrink-0 text-[10px] bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded border border-slate-100 dark:border-slate-700">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                <FileText className="w-3 h-3" />
                                <span>Tổng:</span>
                            </div>
                            <span className="font-bold text-slate-700 dark:text-slate-200">{formatNumber(props.stats.total)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-sky-500 dark:text-sky-400">
                                <Activity className="w-3 h-3" />
                                <span>Xử lý:</span>
                            </div>
                            <span className="font-bold text-sky-700 dark:text-sky-300">{formatNumber(props.stats.processing)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-emerald-500 dark:text-emerald-400">
                                <CheckCircle className="w-3 h-3" />
                                <span>Xong:</span>
                            </div>
                            <span className="font-bold text-emerald-700 dark:text-emerald-300">{formatNumber(props.stats.completed)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2" title="Tệp lỗi / Tệp đang chờ">
                            <div className="flex items-center gap-1.5 text-rose-500 dark:text-rose-400">
                                <AlertCircle className="w-3 h-3" />
                                <span>Lỗi/Chờ:</span>
                            </div>
                            <span className="font-bold text-rose-700 dark:text-rose-300">{props.stats.failed}/{props.stats.pending}</span>
                        </div>
                    </div>
                    <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0 mx-1"></div>
                    <button onClick={props.handleManualResetQuota} className="px-2 py-1.5 text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-lg hover:text-primary-600 flex items-center gap-1 whitespace-nowrap shadow-elevation-1 shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        <RefreshCw className="w-3 h-3" /> Reset Quota
                    </button>
                </div>

                {/* Advanced Settings Toggle — gộp Batch/Ratio thành khu thu gọn, mặc định
                    đóng, để hàng model phía trên nhẹ nhàng hơn khi mới mở app; ai cần chỉnh
                    thông số kỹ thuật thì bấm mở ra. */}
                <button
                    onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                    className="w-full flex items-center justify-center gap-1.5 py-1 border-t border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 dark:text-slate-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-inset"
                >
                    <Scale className="w-3 h-3" /> Cài Đặt Nâng Cao (Batch / Ratio Control)
                    {isAdvancedOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {/* Config Bar */}
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isAdvancedOpen ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-3 py-1.5 text-[10px]">
                    <div className="flex items-center gap-4 overflow-x-auto no-scrollbar whitespace-nowrap">
                        {/* Batch */}
                        <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider"><HardDrive className="w-3 h-3" /> Batch</div>
                            
                            {/* Concurrency Config */}
                            <div className="flex items-center gap-1 pl-2 border-l border-slate-200 dark:border-slate-700">
                                <span className="font-bold text-teal-600 text-[10px]">Luồng</span>
                                <div className="flex items-center gap-1">
                                    <select 
                                        className="config-input text-teal-600 font-bold py-1 px-2 text-xs"
                                        value={props.concurrency === 'auto' ? 'auto' : 'manual'}
                                        onChange={(e) => {
                                            if (e.target.value === 'auto') {
                                                props.setConcurrency('auto');
                                            } else {
                                                // Nhớ giá trị tuỳ chỉnh gần nhất thay vì reset cứng về 3
                                                // mỗi lần chuyển Auto -> Tùy chỉnh.
                                                props.setConcurrency(lastManualConcurrency);
                                            }
                                        }}
                                    >
                                        <option value="auto">Auto</option>
                                        <option value="manual">Tùy chỉnh</option>
                                    </select>
                                    {props.concurrency !== 'auto' && (
                                        <CustomNumberInput widthClass="w-14" className="text-teal-600 font-bold" value={props.concurrency ?? ''} onChange={(val: any) => {
                                            const num = val === '' ? 1 : val;
                                            setLastManualConcurrency(num);
                                            props.setConcurrency(num);
                                        }} />
                                    )}
                                </div>
                            </div>

                            {/* Batch Limits Config */}
                            <div className={`flex flex-col gap-1.5 pl-3 border-l border-slate-200 dark:border-slate-700 ${IS_LITE ? "hidden" : ""}`}>
                                <div className="flex items-center gap-3">
                                    <span className="font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">Số kí tự tối đa:</span>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-indigo-600 font-medium uppercase">Latin:</span>
                                        <CustomNumberInput widthClass="w-16" value={props.batchLimits.latin.maxTotalChars ?? ''} onChange={(val: any) => props.setBatchLimits(prev => ({...prev, latin: {...prev.latin, maxTotalChars: val === '' ? 0 : val}}))} />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-amber-600 font-medium uppercase">Raw:</span>
                                        <CustomNumberInput widthClass="w-16" value={props.batchLimits.complex.maxTotalChars ?? ''} onChange={(val: any) => props.setBatchLimits(prev => ({...prev, complex: {...prev.complex, maxTotalChars: val === '' ? 0 : val}}))} />
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">Số tệp tối đa:</span>
                                    <div className="flex items-center gap-1.5 pl-2">
                                        <span className="text-[10px] text-purple-600 font-medium uppercase">Pro:</span>
                                        <CustomNumberInput widthClass="w-12" value={props.batchLimits.latin.v31 ?? ''} onChange={(val: any) => { const num = val === '' ? 0 : val; props.setBatchLimits(prev => ({ ...prev, latin: { ...prev.latin, v31: num }, complex: { ...prev.complex, v31: num } })) }} />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-teal-600 font-medium uppercase">Flash/Lite:</span>
                                        <CustomNumberInput widthClass="w-12" value={props.batchLimits.latin.v36 ?? ''} onChange={(val: any) => { const num = val === '' ? 0 : val; props.setBatchLimits(prev => ({ ...prev, latin: { ...prev.latin, v36: num, v35: num, v3: num, v25: num }, complex: { ...prev.complex, v36: num, v35: num, v3: num, v25: num } })) }} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="w-px h-8 bg-slate-300 dark:bg-slate-700 shrink-0 mx-1"></div>

                        {/* Ratio Config */}
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider"><Scale className="w-3 h-3" /> Ratio Control</div>
                            
                            <div className="flex items-center gap-3 pl-2 border-l border-slate-200 dark:border-slate-700">
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-sky-600">VN/Convert</span>
                                    <div className="flex items-center gap-0.5">
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-sky-600" value={props.ratioLimits.vn?.min ?? DEFAULT_RATIO_LIMITS.vn.min} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, vn: {...prev.vn, min: val}}))} />
                                        <span className="text-slate-300">-</span>
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-sky-600" value={props.ratioLimits.vn?.max ?? DEFAULT_RATIO_LIMITS.vn.max} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, vn: {...prev.vn, max: val}}))} />
                                    </div>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-indigo-600">EN/Western</span>
                                    <div className="flex items-center gap-0.5">
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-indigo-600" value={props.ratioLimits.en?.min ?? DEFAULT_RATIO_LIMITS.en.min} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, en: {...prev.en, min: val}}))} />
                                        <span className="text-slate-300">-</span>
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-indigo-600" value={props.ratioLimits.en?.max ?? DEFAULT_RATIO_LIMITS.en.max} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, en: {...prev.en, max: val}}))} />
                                    </div>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-fuchsia-600">KR/JP</span>
                                    <div className="flex items-center gap-0.5">
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-fuchsia-600" value={props.ratioLimits.krjp?.min ?? DEFAULT_RATIO_LIMITS.krjp.min} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, krjp: {...prev.krjp, min: val}}))} />
                                        <span className="text-slate-300">-</span>
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-fuchsia-600" value={props.ratioLimits.krjp?.max ?? DEFAULT_RATIO_LIMITS.krjp.max} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, krjp: {...prev.krjp, max: val}}))} />
                                    </div>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-amber-600">Trung (CN)</span>
                                    <div className="flex items-center gap-0.5">
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-amber-600" value={props.ratioLimits.cn?.min ?? DEFAULT_RATIO_LIMITS.cn.min} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, cn: {...prev.cn, min: val}}))} />
                                        <span className="text-slate-300">-</span>
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-amber-600" value={props.ratioLimits.cn?.max ?? DEFAULT_RATIO_LIMITS.cn.max} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, cn: {...prev.cn, max: val}}))} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                </div>
            </div>

            {/* Global Progress Bar */}
             <div className="w-full h-0.5 bg-slate-100 dark:bg-slate-800 relative group">
                 <div className="h-full bg-gradient-to-r from-sky-400 via-indigo-500 to-purple-500 transition-all duration-300 ease-out" style={{ width: `${props.progressPercentage || 0}%` }} />
                 {estimatedTimeRemaining && (
                    <div className="absolute bottom-full right-0 mb-1 bg-slate-800 text-white text-[10px] px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity font-mono whitespace-nowrap z-50 pointer-events-none">
                        ETA: {estimatedTimeRemaining}
                    </div>
                 )}
            </div>

            <style>{`
                .config-input {
                    @apply px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-mono font-bold text-slate-700 dark:text-slate-200 focus:ring-1 focus:ring-indigo-300 outline-none text-[10px];
                    -moz-appearance: textfield;
                }
                /* Hide native spinners completely */
                .config-input::-webkit-inner-spin-button, 
                .config-input::-webkit-outer-spin-button { 
                    -webkit-appearance: none !important;
                    margin: 0 !important;
                }
            `}</style>
        </header>
    );
};
