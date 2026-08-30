import React from 'react';
import { Upload, Play, RefreshCw, BookOpen, Sparkles, Database, CheckCircle2, PenTool, User, Edit, Trash2, Plus, Download, FileDown, FileUp, Square, History, Undo2 } from 'lucide-react';
import { useCreativePage, UseCreativePageProps } from '../hooks/pages/useCreativePage';

type CreativePageProps = UseCreativePageProps

const STEPS = [
    { id: 1, title: "Ý tưởng", desc: "Thiết lập bối cảnh chung" },
    { id: 2, title: "Thế giới", desc: "Hệ thống tu luyện, mô tả" },
    { id: 3, title: "Nhân vật", desc: "Main & phụ" },
    { id: 4, title: "Dàn ý", desc: "Cốt truyện chi tiết" },
    { id: 5, title: "Sáng tác", desc: "Auto viết bằng AI" },
];

export const CreativePage: React.FC<CreativePageProps> = (props) => {
    const { state, setState } = props;
    const {
        currentStep, setCurrentStep,
        mode, setMode,
        isAnalyzing,
        userPrompt, setUserPrompt,
        fileInputRef, chaptersEndRef,
        setupFileInputRef,
        isGenerating, handleStopGenerating,
        editingCharId, setEditingCharId,
        charForm, setCharForm,
        handleSaveChar, handleEditChar, handleDeleteChar,
        setSetup,
        seedTitle, premise, worldNotes, outline, genre,
        handleAnalyzeNew, handleEpubUpload, handleGenerateCreativeChapters,
        handleExportSetup, handleDownloadChapters, handleImportSetup,
        handleRestoreSnapshot,
    } = useCreativePage(props);

    // FIX (yêu cầu người dùng — UI khôi phục snapshot): ẩn/hiện danh sách các mốc đã chụp tự động
    // trước mỗi lượt "Viết Tiếp", để không chiếm chỗ màn hình khi người dùng không cần dùng tới.
    const [showSnapshots, setShowSnapshots] = React.useState(false);
    const snapshots = state?.snapshots || [];

    if (!state) return null;

    return (
        <div className="flex flex-col md:flex-row w-full flex-1 min-h-0 overflow-hidden bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-sans relative">
            {/* Left Sidebar / Top Nav Wizard */}
            <div className="w-full md:w-64 shrink-0 bg-slate-50 dark:bg-[#0f172a] border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 flex flex-col p-4 md:p-4 z-10 z-[20]">
                <div className="mb-4 md:mb-6 p-2 pt-0 hidden md:block">
                    <h2 className="text-[11px] font-bold text-amber-500 uppercase tracking-widest mb-1 leading-tight flex items-center">
                        <Sparkles className="w-3 h-3 mr-1" /> 
                        Sáng Tác Truyện AI
                    </h2>
                    <p className="text-[9px] text-slate-500 dark:text-slate-400">Quy trình tự động hóa tác phẩm</p>
                </div>
                <div className="flex md:flex-col gap-2 md:gap-1 relative overflow-x-auto md:overflow-visible custom-scrollbar pb-2 md:pb-0 scroll-smooth snap-x">
                    {STEPS.map((step, idx) => {
                        const isActive = currentStep === step.id;
                        const isPast = currentStep > step.id;
                        return (
                            <div key={step.id} className="relative shrink-0 snap-start">
                                {idx !== STEPS.length - 1 && (
                                    <div className={`hidden md:block absolute left-[1.15rem] top-10 bottom-[-10px] w-0.5 z-0 ${isPast ? 'bg-amber-500/30' : 'bg-slate-100 dark:bg-slate-800'}`} />
                                )}
                                <button
                                    onClick={() => setCurrentStep(step.id)}
                                    className={`w-full text-left flex items-center md:items-start gap-2 md:gap-4 p-2 md:p-3 rounded-xl transition-all relative z-10 ${
                                        isActive 
                                            ? 'bg-amber-500/10 text-amber-500 shadow-sm ring-1 ring-amber-500/20' 
                                            : isPast 
                                                ? 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50' 
                                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                                    }`}
                                >
                                    <div className={`w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-sm transition-colors ${
                                        isActive ? 'bg-amber-500 text-slate-900 shadow-amber-500/20' : isPast ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700'
                                    }`}>
                                        {isPast && !isActive ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : step.id}
                                    </div>
                                    <div className="pt-0.5 whitespace-nowrap">
                                        <div className={`text-[12px] md:text-[13px] font-bold md:mb-0.5 tracking-wide ${isActive ? 'text-amber-500' : ''}`}>{step.title}</div>
                                        {isActive && <div className="hidden md:block text-[10px] text-amber-500/70">{step.desc}</div>}
                                    </div>
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* Tiện ích luôn hiện: xuất thiết lập / tải xuống chương - không phụ thuộc bước
                    đang xem, để người dùng luôn tìm thấy chỗ lưu lại dữ liệu. */}
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5 shrink-0">
                    <button
                        onClick={handleExportSetup}
                        title="Xuất Ý tưởng/Thế giới/Nhân vật/Dàn ý ra file .txt"
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                    >
                        <FileDown className="w-3.5 h-3.5 shrink-0" /> Xuất Thiết Lập (.txt)
                    </button>
                    <input type="file" ref={setupFileInputRef} onChange={handleImportSetup} accept=".txt" className="hidden" />
                    <button
                        onClick={() => setupFileInputRef.current?.click()}
                        title="Nhập lại file thiết lập (.txt) đã xuất trước đó - sẽ ghi đè Ý tưởng/Thế giới/Nhân vật/Dàn ý hiện tại"
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                    >
                        <FileUp className="w-3.5 h-3.5 shrink-0" /> Nhập Thiết Lập (.txt)
                    </button>
                    <button
                        onClick={handleDownloadChapters}
                        disabled={!state.chapters || state.chapters.length === 0}
                        title="Tải xuống toàn bộ chương đã sáng tác ra file .txt"
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                    >
                        <Download className="w-3.5 h-3.5 shrink-0" /> Tải Chương ({state.chapters?.length || 0})
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-[#0b1120] overflow-y-auto custom-scrollbar scroll-smooth p-0 relative">
                <div className="max-w-4xl mx-auto w-full p-4 md:p-10 space-y-8 scroll-smooth">
                    
                    {/* Header */}
                    <div className="space-y-3 pb-6 border-b border-slate-200 dark:border-slate-800 md:pl-0 pl-2">
                        <h1 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-3">
                            <span className="bg-amber-500 text-slate-900 w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-base md:text-lg shrink-0">{currentStep}</span>
                            {STEPS.find(s => s.id === currentStep)?.title}
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm md:text-[15px] pl-11 md:pl-14">
                            {STEPS.find(s => s.id === currentStep)?.desc}
                        </p>
                    </div>

                    {/* Step 1: Ý tưởng */}
                    {currentStep === 1 && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 pl-14">
                            <div className="flex gap-3">
                                <button onClick={() => setMode('new')} className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${mode === 'new' ? 'bg-amber-500 text-slate-900 shadow-lg shadow-amber-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                                    <PenTool className="w-4 h-4 inline-block mr-2 -mt-0.5" /> Viết Mới Từ Đầu
                                </button>
                                <button onClick={() => setMode('continue')} className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${mode === 'continue' ? 'bg-amber-500 text-slate-900 shadow-lg shadow-amber-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                                    <Upload className="w-4 h-4 inline-block mr-2 -mt-0.5" /> Nạp EPUB & Viết Tiếp
                                </button>
                            </div>

                            <div className="bg-white dark:bg-slate-900 ring-1 ring-slate-100 dark:ring-slate-800 p-8 rounded-2xl shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-amber-700"></div>
                                <h3 className="text-[15px] font-bold text-amber-500 mb-6 flex items-center gap-2">
                                    <Sparkles className="w-5 h-5" /> 
                                    Nạp ý tưởng nhanh bằng AI
                                </h3>
                                
                                {mode === 'new' ? (
                                    <div className="flex flex-col md:flex-row gap-4">
                                        <input 
                                            type="text"
                                            value={userPrompt}
                                            onChange={e => setUserPrompt(e.target.value)}
                                            placeholder="Ví dụ: Truyện về một bác sĩ xuyên không về thế giới tu tiên làm lại từ đầu..."
                                            className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-3.5 text-[15px] focus:ring-2 focus:ring-amber-500/50 outline-none placeholder:text-slate-600 dark:text-slate-300 text-slate-800 dark:text-slate-200 transition-all font-medium"
                                            onKeyDown={e => e.key === 'Enter' && !isAnalyzing && handleAnalyzeNew()}
                                        />
                                        <button 
                                            onClick={handleAnalyzeNew}
                                            disabled={isAnalyzing}
                                            className="px-8 py-3.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition-all whitespace-nowrap flex items-center justify-center gap-2 disabled:opacity-50 text-[15px] shadow-lg shadow-amber-900/50"
                                        >
                                            {isAnalyzing ? <RefreshCw className="w-5 h-5 animate-spin"/> : null} 
                                            Tự Điền Bằng AI
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex gap-3 items-center">
                                        <div className="flex-1 bg-white dark:bg-[#0b1120] border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-sky-500/50 transition-colors rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                            <Database className="w-10 h-10 text-sky-500 mb-4" />
                                            <p className="text-[15px] text-slate-600 dark:text-slate-300 font-bold mb-2">Tải lên file truyện đang viết dở (.epub)</p>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6 leading-relaxed">AI sẽ tự động trích xuất nội dung, phân tích nhân vật và bối cảnh hiện tại để chuẩn bị viết tiếp mạch truyện, đảm bảo logic.</p>
                                            <input type="file" ref={fileInputRef} onChange={handleEpubUpload} accept=".epub" className="hidden" />
                                            <button 
                                                disabled={isAnalyzing}
                                                className="px-8 py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-sky-900/50"
                                            >
                                                {isAnalyzing ? <RefreshCw className="w-5 h-5 animate-spin"/> : <Upload className="w-5 h-5"/>}
                                                Chọn file EPUB
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-6 pt-6">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2.5">Tên truyện</label>
                                    <input value={seedTitle} onChange={e => setSetup({seedTitle: e.target.value})} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50 focus:border-slate-300 dark:focus:border-slate-600 rounded-xl px-5 py-4 text-[15px] focus:ring-1 focus:ring-amber-500/50 outline-none text-slate-800 dark:text-slate-200 transition-all font-medium shadow-sm" placeholder="Danh xưng tác phẩm..." />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2.5">Thể loại (Tùy chọn nhập)</label>
                                    <input 
                                        type="text"
                                        value={genre} 
                                        onChange={e => setSetup({genre: e.target.value})} 
                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50 focus:border-slate-300 dark:focus:border-slate-600 rounded-xl px-5 py-4 text-[15px] focus:ring-1 focus:ring-amber-500/50 outline-none text-slate-800 dark:text-slate-200 transition-all font-medium shadow-sm" 
                                        placeholder="Ví dụ: Tiên Hiệp, Đô Thị, Hài Hước..."
                                    />
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {["Tiên Hiệp", "Huyền Huyễn", "Đô Thị", "Kỳ Ảo", "Khoa Huyễn", "Trọng Sinh", "Xuyên Không", "Đồng Nhân", "Võng Du", "Linh Dị"].map(g => (
                                            <button 
                                                key={g}
                                                onClick={() => {
                                                    const current = genre.trim();
                                                    if (!current) setSetup({genre: g});
                                                    else if (!current.includes(g)) setSetup({genre: `${current}, ${g}`});
                                                }}
                                                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-amber-500/20 text-slate-500 dark:text-slate-400 hover:text-amber-400 border border-slate-200 dark:border-slate-700/50 hover:border-amber-500/50 rounded-lg text-xs font-medium transition-all"
                                            >
                                                + {g}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2.5 flex justify-between">
                                        <span>Premise (Tiền đề / Ý tưởng cốt lõi)</span>
                                        <span className="text-slate-600 dark:text-slate-300 normal-case font-normal">(Quan trọng nhất)</span>
                                    </label>
                                    <textarea value={premise} onChange={e => setSetup({premise: e.target.value})} className="w-full h-40 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50 focus:border-slate-300 dark:focus:border-slate-600 rounded-xl p-5 text-[15px] focus:ring-1 focus:ring-amber-500/50 outline-none resize-none text-slate-800 dark:text-slate-200 leading-relaxed shadow-sm custom-scrollbar scroll-smooth" placeholder="Tóm tắt nội dung chính để định hướng AI. Ví dụ: Main tên XYZ, nhặt được bình nhỏ..." />
                                </div>
                            </div>

                            <div className="flex justify-end pt-8 pb-10 border-t border-slate-200 dark:border-slate-800 mt-8">
                                <button onClick={() => setCurrentStep(2)} className="px-8 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-white font-bold rounded-xl transition-all flex items-center gap-2">
                                    Lưu & Tiếp theo <Play className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Thế giới */}
                    {currentStep === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 pl-14">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3 flex justify-between">
                                    <span>Hệ thống bối cảnh & Tu luyện</span>
                                </label>
                                <textarea value={worldNotes} onChange={e => setSetup({worldNotes: e.target.value})} className="w-full h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50 focus:border-slate-300 dark:focus:border-slate-600 rounded-xl p-6 text-[15px] focus:ring-1 focus:ring-amber-500/50 outline-none resize-none custom-scrollbar scroll-smooth text-slate-800 dark:text-slate-200 leading-relaxed shadow-sm dark:bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjMGYxNzJhIiAvPgo8cGF0aCBkPSJNMCAwTDggOFpNOCAwTDAgOFoiIHN0cm9rZT0iIzFlMjkzYiIHN0cm9rZS13aWR0aD0iMSIgLz4KPC9zdmc+')] dark:bg-repeat" placeholder="Ví dụ:&#10;- Trúc Cơ, Kim Đan, Nguyên Anh...&#10;- Bối cảnh thế giới chia làm 5 châu: Đông Thần, Nam Cương...&#10;- Khí cụ chia Thượng, Trung, Hạ phẩm..." />
                            </div>
                            <div className="flex justify-between pt-8 pb-10 border-t border-slate-200 dark:border-slate-800 mt-8">
                                <button onClick={() => setCurrentStep(1)} className="px-6 py-3.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 font-bold rounded-xl transition-all">
                                    &larr; Quay lại
                                </button>
                                <button onClick={() => setCurrentStep(3)} className="px-8 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-white font-bold rounded-xl transition-all flex items-center gap-2">
                                    Xác nhận Hệ thống <Play className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Nhân vật */}
                    {currentStep === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 pl-14">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3 flex justify-between items-center">
                                    <span>Danh sách nhân vật</span>
                                </label>

                                <div className="space-y-4 mb-6">
                                    {state.characters?.map(c => (
                                        <div key={c.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50 rounded-xl p-5 shadow-sm">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400"><User className="w-5 h-5" /></div>
                                                    <div>
                                                        <h4 className="font-bold text-lg text-slate-800 dark:text-slate-200">{c.name}</h4>
                                                        <div className="flex gap-2 mt-1">
                                                            {c.gender && <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">Giới tính: {c.gender}</span>}
                                                            {c.age && <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">Tuổi: {c.age}</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleEditChar(c)} className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-sky-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"><Edit className="w-4 h-4" /></button>
                                                    <button onClick={() => handleDeleteChar(c.id)} className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-rose-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                                                </div>
                                            </div>
                                            <div className="space-y-3 text-sm">
                                                {c.role && <div><span className="text-slate-500 dark:text-slate-400 uppercase text-[10px] font-bold block mb-1">Vai trò / Thân phận:</span> <p className="text-slate-600 dark:text-slate-300 pl-2 border-l-2 border-slate-200 dark:border-slate-700">{c.role}</p></div>}
                                                {c.appearance && <div><span className="text-slate-500 dark:text-slate-400 uppercase text-[10px] font-bold block mb-1">Ngoại hình:</span> <p className="text-slate-600 dark:text-slate-300 pl-2 border-l-2 border-slate-200 dark:border-slate-700">{c.appearance}</p></div>}
                                                {c.personality && <div><span className="text-slate-500 dark:text-slate-400 uppercase text-[10px] font-bold block mb-1">Tính cách:</span> <p className="text-slate-600 dark:text-slate-300 pl-2 border-l-2 border-slate-200 dark:border-slate-700">{c.personality}</p></div>}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                                    <h4 className="font-bold text-slate-600 dark:text-slate-300 mb-4 flex items-center gap-2">
                                        <Plus className="w-4 h-4 text-amber-500" />
                                        {editingCharId ? 'Chỉnh sửa nhân vật' : 'Thêm nhân vật mới'}
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                        <div>
                                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Tên nhân vật *</label>
                                            <input value={charForm.name || ''} onChange={e => setCharForm({...charForm, name: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-amber-500/50 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none" placeholder="VD: Lâm Phong" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Giới tính</label>
                                                <input value={charForm.gender || ''} onChange={e => setCharForm({...charForm, gender: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-amber-500/50 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none" placeholder="VD: Nam" />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Tuổi</label>
                                                <input value={charForm.age || ''} onChange={e => setCharForm({...charForm, age: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-amber-500/50 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none" placeholder="VD: 16" />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-4 mb-4">
                                        <div>
                                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Vai trò / Thân phận</label>
                                            <input value={charForm.role || ''} onChange={e => setCharForm({...charForm, role: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-amber-500/50 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none" placeholder="VD: Nhân vật chính, đệ tử ngoại môn..." />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Ngoại hình</label>
                                            <textarea value={charForm.appearance || ''} onChange={e => setCharForm({...charForm, appearance: e.target.value})} className="w-full h-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-amber-500/50 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none resize-none" placeholder="VD: Tóc đen hơi rối, khuôn mặt kiên nghị..." />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Tính cách</label>
                                            <textarea value={charForm.personality || ''} onChange={e => setCharForm({...charForm, personality: e.target.value})} className="w-full h-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:border-amber-500/50 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none resize-none" placeholder="VD: Lãnh tĩnh, thông minh, sát phạt quyết đoán..." />
                                        </div>
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        {editingCharId && <button onClick={() => { setEditingCharId(null); setCharForm({}); }} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-bold">Hủy</button>}
                                        <button onClick={handleSaveChar} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-900 rounded-lg text-sm font-bold">
                                            {editingCharId ? 'Cập nhật' : 'Thêm nhân vật'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-between pt-8 pb-10 border-t border-slate-200 dark:border-slate-800 mt-8">
                                <button onClick={() => setCurrentStep(2)} className="px-6 py-3.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 font-bold rounded-xl transition-all">
                                    &larr; Quay lại
                                </button>
                                <button onClick={() => setCurrentStep(4)} className="px-8 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-white font-bold rounded-xl transition-all flex items-center gap-2">
                                    Xác nhận Nhân vật <Play className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 4: Dàn ý */}
                    {currentStep === 4 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 pl-14">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Dàn ý cốt truyện</label>
                                <textarea value={outline} onChange={e => setSetup({outline: e.target.value})} className="w-full h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50 focus:border-slate-300 dark:focus:border-slate-600 rounded-xl p-6 text-[15px] focus:ring-1 focus:ring-amber-500/50 outline-none resize-none custom-scrollbar scroll-smooth text-slate-800 dark:text-slate-200 leading-relaxed shadow-sm dark:bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjMGYxNzJhIiAvPgo8cGF0aCBkPSJNMCAwTDggOFpNOCAwTDAgOFoiIHN0cm9rZT0iIzFlMjkzYiIHN0cm9rZS13aWR0aD0iMSIgLz4KPC9zdmc+')] dark:bg-repeat" placeholder="Ví dụ:&#10;- Giai đoạn 1: Lên núi bái sư, bị khinh bỉ.&#10;- Giai đoạn 2: Tham gia thi đấu nội địa, đạt top 1.&#10;- Giai đoạn 3: Rời núi thám hiểm bí cảnh..." />
                            </div>
                            <div className="flex justify-between pt-8 pb-10 border-t border-slate-200 dark:border-slate-800 mt-8">
                                <button onClick={() => setCurrentStep(3)} className="px-6 py-3.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 font-bold rounded-xl transition-all">
                                    &larr; Quay lại
                                </button>
                                <button onClick={() => setCurrentStep(5)} className="px-8 py-3.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-amber-900/40">
                                    Đến phần Sáng tác <Play className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 5: Sáng tác */}
                    {currentStep === 5 && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 pl-14">
                            <div className="bg-gradient-to-br from-amber-50 to-white dark:from-[#0f172a] dark:to-slate-900 border border-t-amber-500/30 border-l-amber-500/10 border-r-transparent border-b-transparent rounded-3xl p-10 text-center shadow-xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-8 opacity-10">
                                    <Sparkles className="w-48 h-48 text-amber-500" />
                                </div>
                                <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-4 relative z-10">Sẵn sàng sáng tác với Gemini 3.1 Pro (dự phòng 3.7 Flash / 3.6 Flash)</h3>
                                <p className="text-slate-500 dark:text-slate-400 text-[15px] mb-8 max-w-2xl mx-auto leading-relaxed relative z-10">
                                    Mô hình sẽ tận dụng tối đa <b>65,536 tokens</b> output để viết liên tiếp <b>hàng tá chương truyện</b> trong một lần thực thi duy nhất. Hãy bấm "Bắt Đầu" và đi pha một tách trà.
                                </p>
                                
                                <div className="flex flex-col md:flex-row items-center justify-center gap-6 mb-8 relative z-10 max-w-lg mx-auto bg-slate-100 dark:bg-slate-950/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center gap-3">
                                        <label className="text-sm font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">Tổng chương dự kiến:</label>
                                        <input 
                                            type="number" 
                                            min={1}
                                            value={state.totalTargetChapters || 200}
                                            onChange={e => setState(p => ({ ...p, totalTargetChapters: parseInt(e.target.value) || 200 }))}
                                            className="w-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50 focus:border-amber-500/50 rounded-lg px-3 py-2 text-center font-bold text-amber-500 focus:outline-none transition-all"
                                        />
                                    </div>
                                    <div className="w-px h-8 bg-slate-100 dark:bg-slate-800 hidden md:block"></div>
                                    <div className="flex items-center gap-3">
                                        <label className="text-sm font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">Số chương lần này:</label>
                                        <input 
                                            type="number" 
                                            min={1}
                                            max={50}
                                            value={state.targetChapters || 10}
                                            onChange={e => setState(p => ({ ...p, targetChapters: parseInt(e.target.value) || 10 }))}
                                            className="w-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50 focus:border-amber-500/50 rounded-lg px-3 py-2 text-center font-bold text-amber-500 focus:outline-none transition-all"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-center gap-3 relative z-10">
                                    <button 
                                        onClick={handleGenerateCreativeChapters}
                                        disabled={isGenerating || (!premise || !outline)}
                                        className="px-10 py-5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-900 font-black text-lg rounded-2xl transition-all shadow-xl shadow-amber-600/30 flex items-center gap-3 mx-auto disabled:opacity-50 transform active:scale-95"
                                    >
                                        {isGenerating ? <RefreshCw className="w-6 h-6 animate-spin"/> : <Sparkles className="w-6 h-6" />}
                                        {isGenerating
                                            ? 'ĐANG VIẾT LIÊN HOÀN (VUI LÒNG ĐỢI VÀI PHÚT...)..'
                                            : (state.chapters && state.chapters.length > 0)
                                                ? `VIẾT TIẾP (${state.chapters.length} chương đã có)`
                                                : 'BẮT ĐẦU SÁNG TÁC (MAX TOKENS)'}
                                    </button>
                                    {isGenerating && (
                                        <button
                                            onClick={handleStopGenerating}
                                            title="Dừng lượt viết đang chạy (lượt đang viết dở sẽ không được lưu)"
                                            className="px-5 py-5 bg-rose-100 dark:bg-rose-950/40 hover:bg-rose-200 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 border border-rose-200 dark:border-rose-900/50"
                                        >
                                            <Square className="w-5 h-5 fill-current" />
                                            Tạm Ngừng
                                        </button>
                                    )}
                                </div>
                                {(!premise || !outline) && (
                                    <p className="text-danger-600 dark:text-rose-400 text-sm mt-4 font-bold">Vui lòng quay lại điền tối thiểu Tiền đề và Dàn ý!</p>
                                )}
                            </div>

                            {/* Danh sách chương */}
                            {state.chapters && state.chapters.length > 0 && (
                                <div className="space-y-6 pt-10">
                                    <h3 className="font-bold text-slate-600 dark:text-slate-300 text-lg border-b border-slate-200 dark:border-slate-800 pb-3 flex items-center gap-3 justify-between">
                                        <span className="flex items-center gap-3">
                                            <BookOpen className="w-5 h-5 text-amber-500" />
                                            Nội dung đã viết ({state.chapters.length} chương)
                                        </span>
                                        {snapshots.length > 0 && (
                                            <button
                                                onClick={() => setShowSnapshots(!showSnapshots)}
                                                title="Xem/khôi phục các mốc đã lưu tự động trước mỗi lượt Viết Tiếp"
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${showSnapshots ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                                            >
                                                <History className="w-3.5 h-3.5" /> Lịch sử ({snapshots.length})
                                            </button>
                                        )}
                                    </h3>

                                    {/* FIX (yêu cầu người dùng — snapshot mỗi lượt Viết Tiếp): mỗi lần bấm "Viết
                                        Tiếp" ứng dụng tự chụp lại trạng thái ngay trước lượt đó, cho phép lùi về nếu
                                        lượt vừa viết không ưng ý (lạc đề/sai văn phong...) mà không mất công viết
                                        tay lại từ đầu. Khôi phục 1 mốc sẽ xoá các mốc SAU nó (vì chúng đã lỗi thời). */}
                                    {showSnapshots && snapshots.length > 0 && (
                                        <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                                            {[...snapshots].reverse().map((snap) => (
                                                <div key={snap.id} className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5">
                                                    <div className="text-sm">
                                                        <div className="font-bold text-slate-700 dark:text-slate-300">Trước lượt viết lúc {snap.chapterCountBefore} chương</div>
                                                        <div className="text-xs text-slate-400">{new Date(snap.createdAt).toLocaleString('vi-VN')}</div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRestoreSnapshot(snap.id)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 font-bold text-xs rounded-lg transition-all shrink-0"
                                                    >
                                                        <Undo2 className="w-3.5 h-3.5" /> Khôi phục
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {state.chapters.map((chap, i) => (
                                        <div key={chap.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-sm">
                                            <h4 className="font-bold text-xl mb-6 flex items-center gap-4 text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800/50 pb-4">
                                                <span className="text-amber-500 bg-amber-500/10 w-10 h-10 rounded-full flex items-center justify-center text-sm font-black">{i+1}</span>
                                                {chap.title}
                                            </h4>
                                            <div className="whitespace-pre-wrap text-[16px] text-slate-600 dark:text-slate-300 leading-[1.8] font-serif pl-1">
                                                {chap.content}
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={chaptersEndRef} className="h-2"></div>

                                    {/* Thanh hành động liền ngay sau danh sách chương - giải quyết đúng
                                        phản hồi "viết xong không thấy chỗ nào bấm viết tiếp/tải xuống",
                                        không cần cuộn lại lên đầu trang. */}
                                    <div className="sticky bottom-4 flex flex-wrap items-center justify-center gap-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-4 mt-6">
                                        <button
                                            onClick={handleGenerateCreativeChapters}
                                            disabled={isGenerating || (!premise || !outline)}
                                            className="px-6 py-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-900 font-bold text-sm rounded-xl transition-all shadow-lg shadow-amber-600/20 flex items-center gap-2 disabled:opacity-50"
                                        >
                                            {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                            {isGenerating ? 'Đang viết...' : 'Viết Tiếp'}
                                        </button>
                                        {isGenerating && (
                                            <button
                                                onClick={handleStopGenerating}
                                                title="Dừng lượt viết đang chạy (lượt đang viết dở sẽ không được lưu)"
                                                className="px-6 py-3 bg-rose-100 dark:bg-rose-950/40 hover:bg-rose-200 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 font-bold text-sm rounded-xl transition-all flex items-center gap-2 border border-rose-200 dark:border-rose-900/50"
                                            >
                                                <Square className="w-4 h-4 fill-current" />
                                                Tạm Ngừng
                                            </button>
                                        )}
                                        <button
                                            onClick={handleDownloadChapters}
                                            className="px-6 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded-xl transition-all flex items-center gap-2"
                                        >
                                            <Download className="w-4 h-4" /> Tải Xuống ({state.chapters.length} chương)
                                        </button>
                                    </div>
                                    <div className="h-20"></div>
                                </div>
                            )}

                            <div className="flex justify-start pt-8 pb-10 border-t border-slate-200 dark:border-slate-800 mt-8">
                                <button onClick={() => setCurrentStep(4)} className="px-6 py-3 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 font-bold rounded-xl transition-all">
                                    &larr; Quay lại xem dàn ý
                                </button>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
