import React, { Suspense } from 'react';
import {
    LayoutDashboard, BookOpen, PenTool,
    Plus, Clipboard, CheckSquare, ArrowRight, Check, Search, Sparkles, Loader2,
    Hammer, ListFilter, Eraser, RefreshCw, Trash2, FileDown, FileArchive,
    FileText, Play, Book, Zap, Wand2, Layers, Split, X,
    ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Save, Upload, RotateCcw,
    ShieldCheck, AlertTriangle, ExternalLink, ScanSearch
} from 'lucide-react';
import { Header } from './Header';
import { DashboardPage } from './DashboardPage';
import { WorkspacePage } from './WorkspacePage';
import { ToolbarGroupMenu } from './ToolbarGroupMenu';
import { useMainUI, MainUIProps } from '../hooks/pages/useMainUI';
import { DEFAULT_PROMPT, generateBasePrompt } from '../constants';
import { IS_LITE } from '../constants';
import { lazyWithRecovery } from '../utils/lazyWithRecovery';

// TÁI CẤU TRÚC: 4 trang phụ (ít dùng hơn Dashboard/Workspace) được lazy-load để
// tách khỏi chunk chính — lần đầu mở tab mới trình duyệt mới tải code trang đó.
const KnowledgePage = lazyWithRecovery(() => import('./KnowledgePage').then(m => ({ default: m.KnowledgePage })), 'KnowledgePage');
const PromptFixPage = lazyWithRecovery(() => import('./PromptFixPage').then(m => ({ default: m.PromptFixPage })), 'PromptFixPage');
const CreativePage = lazyWithRecovery(() => import('./CreativePage').then(m => ({ default: m.CreativePage })), 'CreativePage');
const SinoVietnameseFixerPage = lazyWithRecovery(() => import('./SinoVietnameseFixerPage').then(m => ({ default: m.SinoVietnameseFixerPage })), 'SinoVietnameseFixerPage');

const LazyTabFallback = () => (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        <span className="text-xs font-bold uppercase tracking-wider">Đang tải trang...</span>
    </div>
);

export const MainUI: React.FC<MainUIProps> = (props) => {
    const { activeTab, setActiveTab } = props;
    const [showAutoFixRawChoice, setShowAutoFixRawChoice] = React.useState(false);

    // FIX23: thông báo 1 lần cho người dùng biết chế độ dịch mặc định của Auto/Bắt Đầu đã đổi từ
    // Pro sang Normal - tự ẩn nếu người dùng đã bấm "Đã hiểu" (lưu localStorage, theo đúng pattern
    // try/catch đã dùng cho THEME_KEY ở useUIState.ts, để không vỡ nếu trình duyệt chặn storage).
    const DEFAULT_TIER_NOTICE_KEY = 'dismissed_default_tier_normal_notice_v1';
    const [showDefaultTierNotice, setShowDefaultTierNotice] = React.useState(() => {
        try { return localStorage.getItem(DEFAULT_TIER_NOTICE_KEY) !== '1'; } catch { return true; }
    });
    const dismissDefaultTierNotice = () => {
        setShowDefaultTierNotice(false);
        try { localStorage.setItem(DEFAULT_TIER_NOTICE_KEY, '1'); } catch {}
    };

    const {
        isSidebarOpen, setIsSidebarOpen,
        isBottomBarOpen, setIsBottomBarOpen,
        showRescuePrompt, setShowRescuePrompt,
        tempDeepseekKey, setTempDeepseekKey,
        showSplitConfig, setShowSplitConfig,
        splitThreshold, setSplitThreshold,
        splitParts, setSplitParts,
        fixableCount,
        rawFixCount,
        handleSmartAutomationClick,
    } = useMainUI(props);

    // Sau khi lưu key DeepSeek trong popup "Chưa cấu hình API Cứu Hộ", tự động tiếp tục vào
    // Automation giống hệt luồng cũ.
    const proceedWithAutoAfterKeySaved = () => {
        const currentRules = (props.storyInfo.additionalRules || "").replace(/Nếu văn bản gốc chứa nội dung nhạy cảm.*thành công\./g, 'Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.') || "Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.";
        const hasMetadata = !!(props.storyInfo.title && props.storyInfo.title.trim().length > 0 && props.storyInfo.author && props.storyInfo.author.trim().length > 0 && props.storyInfo.genres && props.storyInfo.genres.length > 0 && props.storyInfo.summary && props.storyInfo.summary.trim().length > 0);
        const hasDict = props.additionalDictionary && props.additionalDictionary.trim().length > 10;
        const hasCtx = props.storyInfo.contextNotes && props.storyInfo.contextNotes.trim().length > 10;
        const hasContextData = hasDict || hasCtx;
        const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
        const basePrompt = generateBasePrompt(props.storyInfo.genres, props.storyInfo.worldSetting || []);
        const hasPromptConfig = normalize(props.promptTemplate) !== normalize(basePrompt) && normalize(props.promptTemplate) !== normalize(DEFAULT_PROMPT);
        let stepsToRun = [0, 1, 2, 3, 4, 5, 6, 7];
        if (hasMetadata) stepsToRun = stepsToRun.filter(s => s !== 1);
        if (hasContextData) stepsToRun = stepsToRun.filter(s => s !== 2);
        if (hasPromptConfig) stepsToRun = stepsToRun.filter(s => s !== 3);
        if (stepsToRun.length === 0) stepsToRun = [0, 4, 5, 6, 7];
        props.setAutomationInitialConfig({ steps: stepsToRun, rules: currentRules, tier: (IS_LITE ? 'flash' : 'normal') });
        props.setShowAutomationModal(true);
    };

    return (
        <div className="flex flex-col h-full w-full bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200 transition-colors duration-300 overflow-hidden">
            {/* 1. Universal Header */}
            <div className="flex-none z-50">
                <Header 
                    stats={props.stats}
                    showLogs={props.showLogs}
                    setShowLogs={props.setShowLogs}
                    showSettings={props.showSettings}
                    setShowSettings={props.setShowSettings}
                    onShowChangelog={props.onShowChangelog}
                    onShowIntro={props.onShowIntro}
                    enabledModels={props.enabledModels}
                    modelConfigs={props.modelConfigs}
                    modelUsages={props.modelUsages}
                    toggleModel={props.toggleModel}
                    handleManualResetQuota={props.handleManualResetQuota}
                    handleTestModel={props.handleTestModel}
                    testingModelId={props.testingModelId}
                    startTime={props.startTime}
                    endTime={props.endTime}
                    hasLogErrors={props.hasLogErrors}
                    progressPercentage={props.progressPercentage}
                    batchLimits={props.batchLimits}
                    setBatchLimits={props.setBatchLimits}
                    ratioLimits={props.ratioLimits}
                    setRatioLimits={props.setRatioLimits}
                    concurrency={props.concurrency}
                    setConcurrency={props.setConcurrency}
                    isDarkMode={props.isDarkMode}
                    toggleDarkMode={props.toggleDarkMode}
                />
            </div>

            <div className="flex-1 flex overflow-hidden relative">
                {/* 2. DESKTOP SIDEBAR (Tabs) — chỉ hiện từ lg (1024px) trở lên.
                     Dưới ngưỡng này (kể cả tablet 768-1023px) dùng thanh
                     điều hướng dưới (mobile bottom nav) để không chiếm mất
                     không gian nội dung chính trên màn hình vừa. */}
                <aside className={`hidden lg:flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-40 shrink-0 transition-all duration-300 relative ${isSidebarOpen ? 'w-64' : 'w-20'}`}>
                    <button 
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="absolute -right-3 top-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full p-1 shadow-elevation-2 z-50 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-500 transition-transform duration-200 ease-smooth hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                    >
                        {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <div className="p-4 flex-1 overflow-y-auto custom-scrollbar overflow-x-hidden">
                        {isSidebarOpen && <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2 whitespace-nowrap">Navigation</h2>}
                        <div className="space-y-2">
                            <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 ${isSidebarOpen ? 'px-4' : 'justify-center'} py-3 rounded-xl text-sm font-bold transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'dashboard' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 shadow-elevation-1 ring-1 ring-primary-200 dark:ring-primary-800' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'}`} title="Thông Tin">
                                <LayoutDashboard className="w-5 h-5 shrink-0" />
                                {isSidebarOpen && <span className="whitespace-nowrap">Thông Tin</span>}
                            </button>
                            <button onClick={() => setActiveTab('knowledge')} className={`w-full flex items-center gap-3 ${isSidebarOpen ? 'px-4' : 'justify-center'} py-3 rounded-xl text-sm font-bold transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'knowledge' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 shadow-elevation-1 ring-1 ring-amber-200 dark:ring-amber-800' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'}`} title="Tri Thức">
                                <BookOpen className="w-5 h-5 shrink-0" />
                                {isSidebarOpen && <span className="whitespace-nowrap">Tri Thức</span>}
                            </button>
                            <button onClick={() => { setActiveTab('workspace'); props.setCurrentPage(1); }} className={`w-full flex items-center gap-3 ${isSidebarOpen ? 'px-4' : 'justify-center'} py-3 rounded-xl text-sm font-bold transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'workspace' ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 shadow-elevation-1 ring-1 ring-sky-200 dark:ring-sky-800' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'}`} title="Biên Tập">
                                <PenTool className="w-5 h-5 shrink-0" />
                                {isSidebarOpen && <span className="flex-1 text-left whitespace-nowrap">Biên Tập</span>}
                                {isSidebarOpen && <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === 'workspace' ? 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-500'}`}>{props.files.length}</span>}
                            </button>
                            <button onClick={() => setActiveTab('titles')} className={`w-full flex items-center gap-3 ${isSidebarOpen ? 'px-4' : 'justify-center'} py-3 rounded-xl text-sm font-bold transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'titles' ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 shadow-elevation-1 ring-1 ring-purple-200 dark:ring-purple-800' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'}`} title="Sửa Lỗi">
                                <Wand2 className="w-5 h-5 shrink-0" />
                                {isSidebarOpen && <span className="whitespace-nowrap">Sửa Lỗi</span>}
                            </button>
                            <button onClick={() => setActiveTab('creative')} className={`w-full flex items-center gap-3 ${isSidebarOpen ? 'px-4' : 'justify-center'} py-3 rounded-xl text-sm font-bold transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'creative' ? 'bg-pink-50 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 shadow-elevation-1 ring-1 ring-pink-200 dark:ring-pink-800' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'}`} title="Sáng Tác">
                                <Sparkles className="w-5 h-5 shrink-0" />
                                {isSidebarOpen && <span className="whitespace-nowrap">Sáng Tác</span>}
                            </button>
                            <button onClick={() => setActiveTab('hanviet')} className={`w-full flex items-center gap-3 ${isSidebarOpen ? 'px-4' : 'justify-center'} py-3 rounded-xl text-sm font-bold transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'hanviet' ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 shadow-elevation-1 ring-1 ring-teal-200 dark:ring-teal-800' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'}`} title="Tìm Hán Việt">
                                <Search className="w-5 h-5 shrink-0" />
                                {isSidebarOpen && <span className="whitespace-nowrap">Tìm Hán Việt</span>}
                            </button>
                        </div>
                    </div>
                </aside>

                {/* 3. Page Content */}
                <main className="flex-1 min-h-0 bg-slate-50 dark:bg-slate-950 relative overflow-hidden flex flex-col min-w-0">
                    {activeTab === 'dashboard' && <div className="flex-1 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-bottom-2 duration-300"><DashboardPage {...props} handleRestore={async (e) => { const success = await props.handleRestore(e); if (success) { setActiveTab('workspace'); props.setCurrentPage(1); } return success || false; }} handleResetQuota={props.handleManualResetQuota} /></div>}
                    {activeTab === 'knowledge' && <div className="flex-1 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-bottom-2 duration-300"><Suspense fallback={<LazyTabFallback />}><KnowledgePage {...props} handleDictionaryEnforce={props.handleDictionaryEnforce} /></Suspense></div>}
                    {activeTab === 'workspace' && <WorkspacePage {...props} />}
                    {activeTab === 'titles' && <Suspense fallback={<LazyTabFallback />}><PromptFixPage files={props.files} setFilesSafe={props.setFilesSafe} handleTranslatedFileUpload={props.handleTranslatedFileUpload} handleSyncSupportInfo={props.handleSyncSupportInfo} handleExportSupportInfo={props.handleExportSupportInfo} addToast={props.addToast} state={props.fixErrorState} setState={props.setFixErrorState} storyInfo={props.storyInfo} addLog={props.addLog} promptTemplate={props.promptTemplate} dictionary={props.additionalDictionary} /></Suspense>}
                    {activeTab === 'creative' && <Suspense fallback={<LazyTabFallback />}><CreativePage addToast={props.addToast} state={props.creativeState} setState={props.setCreativeState} setStoryInfoSafe={props.setStoryInfoSafe} storyInfo={props.storyInfo} files={props.files} setFilesSafe={props.setFilesSafe} setCoverImage={props.setCoverImage} setStartTime={props.setStartTime} setEndTime={props.setEndTime} addLog={props.addLog} /></Suspense>}
                    {activeTab === 'hanviet' && <Suspense fallback={<LazyTabFallback />}><SinoVietnameseFixerPage {...props} setAdditionalDictionary={props.setAdditionalDictionary} state={props.sinoVietnameseState} setState={props.setSinoVietnameseState} storyInfo={props.storyInfo} promptTemplate={props.promptTemplate} dictionary={props.additionalDictionary} setStartTime={props.setStartTime} setEndTime={props.setEndTime} addLog={props.addLog} /></Suspense>}
                    
                    {/* 4. GLOBAL BOTTOM ACTION BAR (Responsive) */}
                    <div className="relative shrink-0 z-30">
                        {/* Toggle Button */}
                        <button 
                            onClick={() => setIsBottomBarOpen(!isBottomBarOpen)}
                            className="absolute -top-6 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-900 border border-b-0 border-slate-200 dark:border-slate-800 rounded-t-xl px-4 py-1 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] text-slate-500 hover:text-primary-600 dark:hover:text-primary-400 flex items-center justify-center transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                        >
                            {isBottomBarOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </button>
                        
                        <div className={`bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] transition-all duration-300 overflow-x-auto custom-scrollbar ${isBottomBarOpen ? 'max-h-[40vh] opacity-100 p-1.5 md:p-3' : 'max-h-0 opacity-0 p-0'}`}>
                            <div className="min-w-max mx-auto flex items-center gap-1.5 px-2 pb-1">

                            {/* TÁI CẤU TRÚC (yêu cầu người dùng, fix38): trước đây 20+ nút hành động dàn
                                hàng ngang liên tục (5 cụm không có nhãn rõ, chỉ cách nhau khoảng trắng),
                                rất khó quét mắt tìm đúng nút trên màn hình nhỏ/tablet. Nay gom lại thành
                                6 nhóm có NHÃN rõ ràng qua ToolbarGroupMenu (Tệp/Hệ Thống/Chọn/Lọc-Quét/
                                Sửa-Dịch/Xuất — nhóm "Xử Lý" cũ 10 nút được tách làm đôi cho gọn), mỗi
                                nhóm là 1 nút bấm ra panel thả lên chứa các nút con — giữ NGUYÊN 100%
                                onClick/disabled/title của từng nút con, chỉ đổi cách hiển thị. Cỡ chữ nhãn
                                nút con cũng nâng từ 9px/7px lên 10px/8px cho dễ đọc hơn. Nút BẮT ĐẦU/DỪNG
                                LẠI (hành động chính, dùng nhiều nhất) và AUTO vẫn luôn hiện sẵn, không gom
                                vào menu, để không phải mở thêm 1 lần bấm cho thao tác quan trọng nhất.
                                Mỗi nhóm còn có phím tắt Alt+1..Alt+6 để mở nhanh không cần rê chuột (hover
                                vào nút nhãn nhóm sẽ hiện tooltip phím tắt tương ứng). */}

                            <ToolbarGroupMenu label="Tệp" icon={<Plus className="w-3.5 h-3.5" />} shortcutKey="1">
                                <label className="flex flex-col items-center justify-center min-w-[44px] h-[44px] px-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-all duration-200 ease-smooth cursor-pointer group active:scale-95 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus-within:ring-2 focus-within:ring-primary-400"> <Plus className="w-3.5 h-3.5 group-hover:scale-110 transition-transform mb-0.5" /> <span className="text-[10px] font-bold uppercase tracking-tight">Thêm</span> <input type="file" multiple accept=".txt,.zip,.epub,.docx,.doc,.pdf,.srt,.vtt" className="hidden" onChange={props.handleFileUpload} /> </label>
                                <button onClick={() => props.setShowPasteModal(true)} className="flex flex-col items-center justify-center min-w-[44px] h-[44px] px-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 transition-all duration-200 ease-smooth group active:scale-95 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"> <Clipboard className="w-3.5 h-3.5 group-hover:scale-110 transition-transform mb-0.5" /> <span className="text-[10px] font-bold uppercase tracking-tight">Paste</span> </button>
                            </ToolbarGroupMenu>

                            <ToolbarGroupMenu label="Hệ Thống" icon={<Save className="w-3.5 h-3.5" />} shortcutKey="2">
                                <button onClick={props.handleSaveSelected} className="action-btn text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400"><Save className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Lưu DB</span></button>
                                <button onClick={props.handleBackup} className="action-btn text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400"><Save className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Backup</span></button>
                                <label className="flex flex-col items-center justify-center min-w-[44px] h-[44px] px-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all duration-200 ease-smooth cursor-pointer group active:scale-95 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus-within:ring-2 focus-within:ring-primary-400" title="Khôi phục"> <Upload className="w-3.5 h-3.5 group-hover:scale-110 transition-transform mb-0.5" /> <span className="text-[10px] font-bold uppercase tracking-tight">Restore</span> <input type="file" accept=".json" className="hidden" onChange={async (e) => { const success = await props.handleRestore(e); if (success) { setActiveTab('workspace'); props.setCurrentPage(1); } }} /> </label>
                                <button onClick={props.requestResetApp} className="action-btn text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"><RotateCcw className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Reset</span></button>
                            </ToolbarGroupMenu>

                            <ToolbarGroupMenu label="Chọn" icon={<CheckSquare className="w-3.5 h-3.5" />} shortcutKey="3">
                                 <button onClick={props.selectAll} className="flex flex-col items-center justify-center min-w-[44px] h-[44px] px-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-all duration-200 ease-smooth cursor-pointer group active:scale-95 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Chọn tất cả"> <CheckSquare className="w-3.5 h-3.5 mb-0.5 group-hover:scale-110 transition-transform" /> <span className="text-[10px] font-bold uppercase tracking-tight">All</span> </button>
                                 <div className="flex items-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-1 h-[44px]">
                                      <div className="flex flex-col items-center justify-center px-1"> <span className="text-[8px] font-bold text-slate-400 uppercase mb-0.5">Start</span> <input type="number" placeholder="1" className="w-10 text-center text-[10px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-0.5 outline-none font-bold focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:focus:ring-primary-800 text-slate-800 dark:text-slate-200 transition-all duration-200 ease-smooth" value={props.rangeStart} onChange={(e) => props.setRangeStart(e.target.value)} /> </div>
                                      <div className="px-0.5 text-slate-300 dark:text-slate-600"> <ArrowRight className="w-3 h-3" /> </div>
                                      <div className="flex flex-col items-center justify-center px-1"> <span className="text-[8px] font-bold text-slate-400 uppercase mb-0.5">End</span> <input type="number" placeholder="50" className="w-10 text-center text-[10px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded py-0.5 outline-none font-bold focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:focus:ring-primary-800 text-slate-800 dark:text-slate-200 transition-all duration-200 ease-smooth" value={props.rangeEnd} onChange={(e) => props.setRangeEnd(e.target.value)} /> </div>
                                      <button onClick={props.handleRangeSelect} className="ml-1 w-6 h-6 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/50 rounded flex items-center justify-center transition-colors duration-200 ease-smooth shadow-elevation-1 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Chọn theo dải"> <Check className="w-3 h-3" /> </button>
                                 </div>
                            </ToolbarGroupMenu>

                            {/* --- AUTO luôn hiện sẵn, không gom vào menu (thao tác chính, dùng liên tục) --- */}
                            <button
                                onClick={handleSmartAutomationClick}
                                disabled={(props.isProcessing || props.isCustomFixing) && !props.automationState.isRunning}
                                className={`action-btn relative shrink-0 ${props.automationState.isRunning ? 'bg-yellow-400 text-red-600 animate-pulse ring-2 ring-red-500' : 'bg-yellow-400 hover:bg-yellow-500 text-red-600'}`}
                            >
                                {props.automationState.isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin mb-0.5" /> : <Zap className="w-3.5 h-3.5 mb-0.5 fill-current" />}
                                <span className="text-[10px] font-black uppercase tracking-tight">AUTO</span>
                            </button>

                            {/* FIX (bug thực tế 19/8: bấm thao tác thủ công trong lúc Automation đang chạy dở
                                tạo ra 1 luồng xử lý song song không được Automation theo dõi, dẫn tới báo
                                "Hoàn tất" sớm trong khi việc vẫn đang chạy) - thêm điều kiện khoá theo
                                automationState.isRunning, không chỉ isProcessing/isCustomFixing: khi Automation
                                đang ở giữa các bước KHÔNG dịch (vd đang đếm ngược cooldown, đang mở modal chờ
                                xác nhận), isProcessing có thể đang là false nhưng Automation vẫn coi là "đang
                                chạy" - nếu không khoá thêm, người dùng vẫn bấm được 2 nút này song song. */}
                            {/* TÁCH NHÓM (fix38, đề xuất "Xử Lý quá dài 10 nút"): tách nhóm "Xử Lý" cũ thành
                                2 nhóm nhỏ hơn theo tính chất — "Lọc/Quét" (các nút lọc hiển thị + quét/dò rác,
                                trùng) và "Sửa/Dịch" (các nút chỉnh sửa nội dung, tiêu đề, dịch lại, xóa file).
                                Giữ NGUYÊN 100% onClick/disabled/title của từng nút con, chỉ đổi nhóm chứa. */}
                            <ToolbarGroupMenu
                                label="Lọc/Quét"
                                icon={<ScanSearch className="w-3.5 h-3.5" />}
                                highlight={props.showFilterPanel || props.filterModels.size > 0 || props.filterStatuses.size > 0}
                                shortcutKey="4"
                            >
                                <button onClick={() => props.setShowFilterPanel(!props.showFilterPanel)} className={`action-btn ${props.showFilterPanel || props.filterModels.size > 0 || props.filterStatuses.size > 0 ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400'}`}> <ListFilter className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Filter</span> </button>
                                <button onClick={props.handleScanJunk} className="action-btn text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400"><FileArchive className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Lọc Rác</span></button>
                                <button onClick={() => props.handleRemoveDuplicates(props.selectedFiles.size > 0 ? 'selected' : 'all')} className="action-btn text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"><Eraser className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Xóa Trùng</span></button>
                                <button onClick={props.handleScanFuzzyDuplicates} title="Quét các chương giống nội dung chương liền trước (≥30%) dù không trùng khớp tuyệt đối — VD raw bị crawl lặp 2 lần, mỗi lần đổi vài từ. Chỉ CHỌN để bạn tự kiểm tra, không tự xoá." className="action-btn text-slate-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400"><ScanSearch className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Trùng ~</span></button>
                            </ToolbarGroupMenu>

                            <ToolbarGroupMenu
                                label="Sửa/Dịch"
                                icon={<Hammer className="w-3.5 h-3.5" />}
                                badgeCount={fixableCount}
                                shortcutKey="5"
                            >
                                <button onClick={() => props.setShowFindReplace(true)} className="action-btn text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400"><Search className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Tìm/Thay</span></button>
                                <button onClick={() => props.handleManualCleanup(props.selectedFiles.size > 0 ? 'selected' : 'all')} className="action-btn text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400"><Wand2 className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Định Dạng</span></button>
                                <button onClick={() => props.handleTitleNormalization(props.selectedFiles.size > 0 ? 'selected' : 'all')} disabled={props.isProcessing || props.isCustomFixing || props.automationState.isRunning} className="action-btn text-slate-500 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400"><Sparkles className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Tiêu Đề</span></button>
                                <button onClick={props.handleSmartFix} disabled={props.isProcessing || props.isCustomFixing || props.automationState.isRunning} className={`action-btn transition-colors relative ${fixableCount > 0 ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 hover:scale-105' : 'text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400'}`}> <Hammer className="w-3.5 h-3.5 mb-0.5" /> <span className="text-[10px] font-bold uppercase tracking-tight">Smart Fix</span> {fixableCount > 0 && ( <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[9px] flex items-center justify-center rounded-full font-bold shadow-sm animate-bounce"> {fixableCount} </span> )} </button>
                                <button onClick={() => rawFixCount > 0 ? setShowAutoFixRawChoice(true) : props.addToast('Không còn tệp sót raw cần sửa', 'info')} disabled={props.isProcessing || props.isCustomFixing || props.automationState.isRunning} className={`action-btn transition-colors relative ${rawFixCount > 0 ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40 hover:scale-105' : 'text-slate-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400'}`} title="Chạy thủ công Auto Fix Raw và chọn 3.1 Pro hoặc 3.7 Flash"><Zap className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Auto Fix Raw</span>{rawFixCount > 0 && (<span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-orange-500 text-white text-[9px] flex items-center justify-center rounded-full font-bold shadow-sm">{rawFixCount}</span>)}</button>
                                <button onClick={() => setShowSplitConfig(true)} className={`action-btn ${showSplitConfig ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600' : 'text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400'}`}><Split className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Tách Chương</span></button>
                                <button onClick={() => props.selectedFiles.size > 0 ? props.setShowRetranslateModal(true) : props.addToast("Chọn file để dịch lại", "error")} className="action-btn text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400"><RefreshCw className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Dịch Lại</span></button>
                                <button onClick={() => props.selectedFiles.size > 0 ? props.handleSmartDelete() : props.requestDeleteAll()} className="action-btn text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"><Trash2 className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Xóa</span></button>
                            </ToolbarGroupMenu>

                            <ToolbarGroupMenu label="Xuất" icon={<FileArchive className="w-3.5 h-3.5" />} shortcutKey="6">
                                <button onClick={() => props.setShowRawDownloadModal(true)} className="action-btn text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400"><FileDown className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Raw</span></button>
                                <button onClick={props.handleDownloadTranslatedZip} className="action-btn text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400"><FileArchive className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Zip</span></button>
                                <button onClick={props.handleMergeSelected} title="Không chọn file nào: tự động quét & gộp mọi chương bị Tách Chương (dạng &quot;Tên (1)(2)(3)&quot;) thành chương hoàn chỉnh. Có chọn file: gộp đúng các file đang chọn." className="action-btn text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400"><Layers className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Gộp File</span></button>
                                <button onClick={props.handleDownloadMerged} className="action-btn text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400"><FileText className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">Tải Gộp</span></button>
                                <button onClick={props.handleExportDocx} className="action-btn text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"><FileText className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">DOCX</span></button>
                                <button onClick={props.handleDownloadEpub} className="action-btn text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40"><Book className="w-3.5 h-3.5 mb-0.5" /><span className="text-[10px] font-bold uppercase tracking-tight">EPUB</span></button>
                            </ToolbarGroupMenu>

                            <button
                              onClick={(props.isProcessing || props.isCustomFixing) ? props.stopProcessing : handleSmartAutomationClick}
                              className={`flex items-center gap-1.5 px-3 h-10 ml-1 rounded-lg shadow-elevation-2 transition-all duration-200 ease-smooth active:scale-95 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 shrink-0 ${(props.isProcessing || props.isCustomFixing) ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-200/50' : 'bg-gradient-to-r from-sky-500 to-primary-600 hover:from-sky-400 hover:to-primary-500 shadow-glow-primary'}`}
                          >
                              {(props.isProcessing || props.isCustomFixing) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                              <span className="text-[10px] sm:text-xs">{(props.isProcessing || props.isCustomFixing) ? "DỪNG LẠI" : "BẮT ĐẦU"}</span>
                          </button>
                            </div>
                        </div>
                    </div>

                    {/* FIX23: Chú ý đổi mặc định Auto/Bắt Đầu từ Pro sang Normal - đặt ngay dưới
                        bảng nút Auto/Bắt Đầu ở trên (luôn hiển thị, không phụ thuộc isBottomBarOpen,
                        để không bị ẩn mất khi người dùng thu gọn thanh công cụ), tự ẩn khi bấm
                        "Đã hiểu". */}
                    {showDefaultTierNotice && (
                        <div className="flex-none flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/30 border-t border-amber-200 dark:border-amber-800 text-xs">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <span className="text-amber-800 dark:text-amber-300 flex-1">
                                <b>Chú ý:</b> Chế độ dịch mặc định đã chỉnh từ Pro sang Normal. Mọi người ai muốn dùng chế độ Pro, vui lòng chọn nút Pro bên dưới bảng Auto (Bắt đầu).
                            </span>
                            <button
                                onClick={dismissDefaultTierNotice}
                                className="shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-bold px-1"
                                title="Đã hiểu, không hiện lại"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}
                </main>
            </div>
            
            {/* 5. MOBILE/TABLET BOTTOM NAVIGATION — hiện tới dưới lg (1024px),
                 tức bao phủ cả điện thoại lẫn tablet. */}
            <div className="lg:hidden flex-none bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 pb-safe z-50 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-1 px-3 py-2 min-w-max px-safe">
                    <button onClick={() => setActiveTab('dashboard')} className={`min-w-[64px] p-2.5 rounded-xl transition-all duration-200 ease-smooth flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'dashboard' ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        <LayoutDashboard className="w-5 h-5" />
                        <span className="text-[10px] font-bold">Quản Lý</span>
                    </button>
                    <button onClick={() => setActiveTab('knowledge')} className={`min-w-[64px] p-2.5 rounded-xl transition-all duration-200 ease-smooth flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'knowledge' ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        <BookOpen className="w-5 h-5" />
                        <span className="text-[10px] font-bold">Từ Điển</span>
                    </button>
                    <button onClick={() => { setActiveTab('workspace'); props.setCurrentPage(1); }} className={`min-w-[64px] p-2.5 rounded-xl transition-all duration-200 ease-smooth flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 relative ${activeTab === 'workspace' ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        <PenTool className="w-5 h-5" />
                        <span className="text-[10px] font-bold">Biên Tập</span>
                        {props.files.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-sky-500 rounded-full border-2 border-white dark:border-slate-900"></span>}
                    </button>
                    <button onClick={() => setActiveTab('titles')} className={`min-w-[64px] p-2.5 rounded-xl transition-all duration-200 ease-smooth flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'titles' ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        <Wand2 className="w-5 h-5" />
                        <span className="text-[10px] font-bold">Sửa Lỗi</span>
                    </button>
                    <button onClick={() => setActiveTab('creative')} className={`min-w-[64px] p-2.5 rounded-xl transition-all duration-200 ease-smooth flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'creative' ? 'text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-900/30' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        <Sparkles className="w-5 h-5" />
                        <span className="text-[10px] font-bold">Sáng Tác</span>
                    </button>
                    <button onClick={() => setActiveTab('hanviet')} className={`min-w-[70px] p-2.5 rounded-xl transition-all duration-200 ease-smooth flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${activeTab === 'hanviet' ? 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        <Search className="w-5 h-5" />
                        <span className="text-[10px] font-bold">Hán Việt</span>
                    </button>
                </div>
            </div>

            {showAutoFixRawChoice && (
                <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
                    <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                        <button aria-label="Đóng" onClick={() => setShowAutoFixRawChoice(false)} className="absolute right-4 top-4 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="h-5 w-5" /></button>
                        <div className="mb-5 flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"><Zap className="h-5 w-5" /></div>
                            <div><h3 className="font-bold text-slate-900 dark:text-white">Auto Fix Raw</h3><p className="text-xs text-slate-500">Còn {rawFixCount} tệp sót raw · tối đa 2 lượt nếu lượt đầu chưa sạch</p></div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <button onClick={() => { setShowAutoFixRawChoice(false); props.handleAutoFixRaw('pro'); }} className="rounded-xl border-2 border-violet-200 bg-violet-50 p-4 text-left transition hover:border-violet-500 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/30 dark:hover:border-violet-500">
                                <span className="block font-bold text-violet-700 dark:text-violet-300">Pro</span><span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">Chỉ dùng Gemini 3.1 Pro</span>
                            </button>
                            <button onClick={() => { setShowAutoFixRawChoice(false); props.handleAutoFixRaw('flash'); }} className="rounded-xl border-2 border-sky-200 bg-sky-50 p-4 text-left transition hover:border-sky-500 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/30 dark:hover:border-sky-500">
                                <span className="block font-bold text-sky-700 dark:text-sky-300">Flash</span><span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">Chỉ dùng Gemini 3.7 Flash</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showRescuePrompt && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
                        <div className="p-6 overflow-y-auto flex-1 overscroll-contain">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center text-primary-600 dark:text-primary-400">
                                    <ShieldCheck className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Chưa cấu hình API Cứu Hộ</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Smart Safety Filter cần DeepSeek để rà soát tệp vi phạm</p>
                                </div>
                            </div>
                            
                            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                                Để hệ thống tự động xử lý và vượt qua rào cản kiểm duyệt khi dịch hàng loạt (Batch Auto-fix), bạn nên thêm API Key DeepSeek (vệ tinh cứu hộ của hệ thống).
                            </p>
                            
                            <div className="space-y-3 mb-6">
                                <button onClick={() => {
                                    setShowRescuePrompt(false);
                                    props.setShowSettings(true);
                                }} className="w-full flex items-center justify-between p-3 rounded-xl border-2 border-primary-100 hover:border-primary-500 hover:bg-primary-50 dark:border-primary-900 dark:hover:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium transition-all text-sm text-left group">
                                    <span>Thoát ra để thêm API Key</span>
                                    <ChevronRight className="w-4 h-4 text-primary-400 group-hover:translate-x-1 transition-transform" />
                                </button>
                                
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 px-1">
                                        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                                        <span className="text-xs font-semibold text-slate-500">Hoặc nhập trực tiếp</span>
                                        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                                    </div>

                                    {/* Khung riêng DeepSeek */}
                                    <div className="p-3 rounded-xl border border-teal-100 dark:border-teal-900/50 bg-teal-50/40 dark:bg-teal-950/10 space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-bold text-teal-700 dark:text-teal-400">DeepSeek</span>
                                            <div className="flex items-center gap-3">
                                                <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400">
                                                    Lấy API Key <ExternalLink className="w-3 h-3" />
                                                </a>
                                                <label className="cursor-pointer text-xs flex items-center gap-1 text-slate-500 hover:text-slate-700 font-medium">
                                                    <Upload className="w-3.5 h-3.5" /> File
                                                    <input 
                                                       type="file" 
                                                       accept=".txt" 
                                                       className="hidden" 
                                                       onChange={(e) => {
                                                           const file = e.target.files?.[0];
                                                           if (!file) return;
                                                           const reader = new FileReader();
                                                           reader.onload = (event) => {
                                                               const text = event.target?.result as string;
                                                               if (text) {
                                                                   setTempDeepseekKey(text);
                                                               }
                                                           };
                                                           reader.readAsText(file);
                                                           e.target.value = '';
                                                       }}
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                        <div className="relative">
                                            <textarea 
                                                placeholder="Dán API Key DeepSeek (Có thể dán nhiều key cách nhau dấu phẩy hoặc xuống dòng)..." 
                                                className="w-full p-3 py-2 min-h-[64px] rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-y" 
                                                value={tempDeepseekKey}
                                                onChange={e => setTempDeepseekKey(e.target.value)}
                                                spellCheck="false"
                                            />
                                            {tempDeepseekKey.trim() && (
                                                <button 
                                                    onClick={() => {
                                                        if (props.setDeepseekKey) props.setDeepseekKey(tempDeepseekKey.trim());
                                                        setShowRescuePrompt(false);
                                                        props.addToast("Đã lưu API Key DeepSeek và tiếp tục.", "success");
                                                        proceedWithAutoAfterKeySaved();
                                                    }}
                                                    className="absolute right-2 bottom-2 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700 transition-colors flex items-center"
                                                >
                                                    Lưu Key
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                
                                <button onClick={() => {
                                    setShowRescuePrompt(false);
                                    proceedWithAutoAfterKeySaved();
                                }} className="w-full py-3 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-white font-medium hover:underline flex items-center justify-center gap-2">
                                    Tiếp tục mà không cần thêm API Key <AlertTriangle className="w-3 h-3 text-amber-500" />
                                </button>
                            </div>
                            
                            <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
                                <button onClick={() => setShowRescuePrompt(false)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all">Đóng</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showSplitConfig && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-6 relative animate-in fade-in zoom-in-95">
                        <button aria-label="Đóng" onClick={() => setShowSplitConfig(false)} className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                            <X className="w-5 h-5" />
                        </button>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Tách Chương</h3>
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-2">Tách chương vượt quá (Kí tự):</label>
                        <div className="flex gap-2 mb-4">
                            <input type="number" value={splitThreshold} onChange={e => setSplitThreshold(e.target.value)} className="w-full text-base border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg p-2 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white" />
                        </div>
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-2">Chia thành (số phần):</label>
                        <div className="flex gap-2 mb-1">
                            <input type="number" min={2} value={splitParts} onChange={e => setSplitParts(e.target.value)} placeholder="Tự động" className="w-full text-base border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg p-2 focus:ring-2 focus:ring-primary-500 outline-none dark:text-white" />
                        </div>
                        <p className="text-[10px] text-slate-400 mb-4">Để trống: app tự tính số phần hợp lý dựa trên ngưỡng kí tự ở trên. Nhập số: chia đúng số phần đó, cân bằng và luôn kết thúc trọn đoạn văn.</p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowSplitConfig(false)} className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm font-bold">Hủy</button>
                            <button onClick={() => { 
                                setShowSplitConfig(false); 
                                const parsedParts = parseInt(splitParts);
                                props.handleAutoSplitChapters(
                                    props.selectedFiles.size > 0 ? 'selected' : 'all',
                                    undefined,
                                    parseInt(splitThreshold) || 8000,
                                    parsedParts >= 2 ? parsedParts : undefined
                                ); 
                            }} className="px-6 py-2 bg-primary-600 text-white rounded-lg font-bold text-sm hover:bg-primary-700">Bắt đầu</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .action-btn {
                    @apply flex flex-col items-center justify-center min-w-[40px] h-[40px] px-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-all group active:scale-95 border border-transparent hover:border-slate-200 dark:border-slate-700;
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                    height: 6px;
                }
                @media (min-width: 768px) {
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 10px;
                        height: 10px;
                    }
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 10px;
                }
                .dark .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #334155;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #94a3b8;
                }
                .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #475569;
                }
            `}</style>
        </div>
    );
};
