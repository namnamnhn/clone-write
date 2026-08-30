import React from 'react';
import {
    BookA, BookOpen, Download, Upload, Microscope, Loader2,
    Zap, Wrench, RefreshCw, Eye, EyeOff, Lock, CheckCircle2
} from 'lucide-react';
import { DEFAULT_DICTIONARY, DEFAULT_PROMPT, generateBasePrompt, IS_LITE } from '../constants';
import { GlossaryTable } from './GlossaryTable';
import { useKnowledgePage, KnowledgePageProps } from '../hooks/pages/useKnowledgePage';

export const KnowledgePage: React.FC<KnowledgePageProps> = (props) => {
    const {
        viewMode, setViewMode,
        uploadFiles, setUploadFiles,
        showUploadModal, setShowUploadModal,
        handleLocalDictionaryUpload,
        processUpload,
    } = useKnowledgePage(props);

    // Prompt gốc (master template, chưa tùy chỉnh riêng cho truyện này) vs Prompt đã Tối Ưu
    // (kết quả của "Tối Ưu Hóa Prompt (AI Architect)" — đã lồng ghép Series Bible/từ điển/quy
    // tắc riêng cho truyện). App chỉ lưu 1 field `promptTemplate` duy nhất — sau khi Tối Ưu chạy
    // xong, field này TRỞ THÀNH bản đã tối ưu, nên hiển thị nó là đúng. Vấn đề trước đây: khi
    // CHƯA tối ưu (vẫn còn nguyên prompt gốc mặc định), field này lộ nguyên văn prompt gốc dài,
    // kỹ thuật, không dành cho người dùng thường chỉnh tay trực tiếp — nên mặc định che lại,
    // chỉ hiện khi bấm "Xem Prompt Gốc" tường minh (dùng lại state viewOriginalPrompt đã có sẵn
    // trong props nhưng trước đây chưa được dùng ở đây).
    const normalize = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const basePrompt = generateBasePrompt(props.storyInfo.genres, props.storyInfo.worldSetting || []);
    const isOptimizedPrompt = normalize(props.promptTemplate) !== normalize(basePrompt) && normalize(props.promptTemplate) !== normalize(DEFAULT_PROMPT);
    const shouldHideRaw = !isOptimizedPrompt && !props.viewOriginalPrompt;

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Left Column: Context & Dictionary */}
            <div className="flex flex-col gap-4">
                
                {/* 1. Context Section */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-elevation-1 border border-slate-200 dark:border-slate-800 flex-1 flex flex-col min-h-[350px]">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-base font-display font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-amber-500" /> Ngữ Cảnh (Context)
                        </h3>
                        <div className="flex gap-1">
                            <button onClick={props.handleContextDownload} className="p-1.5 hover:bg-amber-50 dark:hover:bg-amber-900/30 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 rounded-lg transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Tải về"><Download className="w-3.5 h-3.5" /></button>
                            <label className="p-1.5 hover:bg-amber-50 dark:hover:bg-amber-900/30 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 rounded-lg transition-colors duration-200 ease-smooth cursor-pointer focus-within:ring-2 focus-within:ring-primary-400" title="Tải lên">
                                <Upload className="w-3.5 h-3.5" />
                                <input type="file" accept=".txt,.docx,.doc,.pdf" className="hidden" onChange={props.handleContextFileUpload} />
                            </label>
                        </div>
                    </div>
                    
                    <textarea 
                        className="flex-1 w-full bg-amber-50/30 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl p-3 text-xs font-mono text-slate-700 dark:text-slate-300 resize-none outline-none focus:ring-2 focus:ring-amber-200 dark:focus:ring-amber-800 transition-all duration-200 ease-smooth custom-scrollbar leading-relaxed" 
                        placeholder="Nhập thông tin bối cảnh, tóm tắt cốt truyện, quan hệ nhân vật..." 
                        value={props.storyInfo.contextNotes || ''} 
                        onChange={e => props.setStoryInfo({...props.storyInfo, contextNotes: e.target.value})}
                    />

                    {/* Tùy Chọn Xưng Hô: quyết định cách "Phân Tích Sâu" xây dựng Ma trận xưng hô
                        trong Series Bible. Sửa trực tiếp storyInfo.pronounMode ở đây (thay vì chỉ
                        trong modal Phân Tích Sâu) để người dùng thấy và đổi lựa chọn ngay tại trang
                        Tri Thức mà không cần mở modal. */}
                    <div className="mt-3 pt-3 border-t border-amber-100 dark:border-amber-900/30">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lối Xưng Hô Mong Muốn</span>
                            <span title="Linh Động: AI tự phân loại xưng hô theo bối cảnh từng nhân vật (Cổ trang/Hiện đại/Phương Tây) — hành vi mặc định. Hiện Đại/Cổ Đại: ép toàn truyện chỉ dùng 1 lối xưng hô duy nhất, bỏ qua phân loại theo bối cảnh." className="text-[9px] font-bold text-primary-500 dark:text-primary-400 uppercase tracking-wide cursor-help select-none">
                                Quy Tắc Thông Minh
                            </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <button type="button" onClick={() => props.setStoryInfo((prev: any) => ({...prev, pronounMode: 'modern'}))} className={`py-2 px-1.5 rounded-xl border text-center transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${props.storyInfo.pronounMode === 'modern' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 ring-2 ring-emerald-200 dark:ring-emerald-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800'}`}>
                                <div className={`text-xs font-bold ${props.storyInfo.pronounMode === 'modern' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>Hiện Đại</div>
                                <div className="text-[9px] text-slate-400 mt-0.5">Thuần Việt 100%</div>
                            </button>
                            <button type="button" onClick={() => props.setStoryInfo((prev: any) => ({...prev, pronounMode: 'ancient'}))} className={`py-2 px-1.5 rounded-xl border text-center transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${props.storyInfo.pronounMode === 'ancient' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 ring-2 ring-emerald-200 dark:ring-emerald-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800'}`}>
                                <div className={`text-xs font-bold ${props.storyInfo.pronounMode === 'ancient' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>Cổ Đại</div>
                                <div className="text-[9px] text-slate-400 mt-0.5">Cổ Trang 100%</div>
                            </button>
                            <button type="button" onClick={() => props.setStoryInfo((prev: any) => ({...prev, pronounMode: 'flexible'}))} className={`py-2 px-1.5 rounded-xl border text-center transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${(!props.storyInfo.pronounMode || props.storyInfo.pronounMode === 'flexible') ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 ring-2 ring-emerald-200 dark:ring-emerald-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800'}`}>
                                <div className={`text-xs font-bold ${(!props.storyInfo.pronounMode || props.storyInfo.pronounMode === 'flexible') ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>Linh Động</div>
                                <div className="text-[9px] text-slate-400 mt-0.5">Mặc định/Tự nhiên</div>
                            </button>
                        </div>
                    </div>

                    {/* Tùy Chọn Đơn Vị Số Đếm: cùng cơ chế với Lối Xưng Hô ở trên — quyết định
                        "Phân Tích Sâu" ép toàn truyện dùng 1 hệ đơn vị số (vạn/ức Hán Việt cổ hay
                        nghìn/triệu/tỷ hiện đại) hay để AI tự chọn theo bối cảnh (Linh Động). */}
                    <div className="mt-3 pt-3 border-t border-amber-100 dark:border-amber-900/30">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Đơn Vị Số Đếm Mong Muốn</span>
                            <span title="Linh Động: AI tự chọn hệ đơn vị số theo bối cảnh, chỉ được nhắc phải nhất quán chung chung — hành vi mặc định. Hiện Đại/Cổ Đại: ép toàn truyện (kể cả bảng thông số hệ thống) chỉ dùng 1 hệ đơn vị số duy nhất." className="text-[9px] font-bold text-primary-500 dark:text-primary-400 uppercase tracking-wide cursor-help select-none">
                                Quy Tắc Thông Minh
                            </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <button type="button" onClick={() => props.setStoryInfo((prev: any) => ({...prev, numberUnitMode: 'modern'}))} className={`py-2 px-1.5 rounded-xl border text-center transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${props.storyInfo.numberUnitMode === 'modern' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 ring-2 ring-emerald-200 dark:ring-emerald-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800'}`}>
                                <div className={`text-xs font-bold ${props.storyInfo.numberUnitMode === 'modern' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>Hiện Đại</div>
                                <div className="text-[9px] text-slate-400 mt-0.5">Nghìn/Triệu/Tỷ</div>
                            </button>
                            <button type="button" onClick={() => props.setStoryInfo((prev: any) => ({...prev, numberUnitMode: 'ancient'}))} className={`py-2 px-1.5 rounded-xl border text-center transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${props.storyInfo.numberUnitMode === 'ancient' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 ring-2 ring-emerald-200 dark:ring-emerald-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800'}`}>
                                <div className={`text-xs font-bold ${props.storyInfo.numberUnitMode === 'ancient' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>Cổ Đại</div>
                                <div className="text-[9px] text-slate-400 mt-0.5">Vạn/Ức</div>
                            </button>
                            <button type="button" onClick={() => props.setStoryInfo((prev: any) => ({...prev, numberUnitMode: 'flexible'}))} className={`py-2 px-1.5 rounded-xl border text-center transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${(!props.storyInfo.numberUnitMode || props.storyInfo.numberUnitMode === 'flexible') ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 ring-2 ring-emerald-200 dark:ring-emerald-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800'}`}>
                                <div className={`text-xs font-bold ${(!props.storyInfo.numberUnitMode || props.storyInfo.numberUnitMode === 'flexible') ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>Linh Động</div>
                                <div className="text-[9px] text-slate-400 mt-0.5">Mặc định/Tự nhiên</div>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                        <button onClick={() => props.setShowNameAnalysisModal(true)} disabled={props.isAnalyzingNames} className="py-2.5 bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-xl text-xs font-bold shadow-elevation-1 flex items-center justify-center gap-2 transition-all duration-200 ease-smooth disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                             {props.isAnalyzingNames ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Microscope className="w-3.5 h-3.5" />} Phân Tích Sâu
                        </button>

                    </div>
                    {props.storyInfo.contextNotes?.includes("[HỆ THỐNG: CHẾ ĐỘ TỔNG HỢP THÔ (LOCAL MERGE)]") && (
                        <button onClick={props.handleRefineContext} disabled={props.isRefiningContext} className="mt-2 py-2 w-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 rounded-xl text-xs font-bold shadow-elevation-1 flex items-center justify-center gap-2 transition-all duration-200 ease-smooth disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                            {props.isRefiningContext ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Hợp Nhất Ngữ Cảnh Thô
                        </button>
                    )}
                </div>

                {/* 2. Dictionary Section */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-elevation-1 border border-slate-200 dark:border-slate-800 flex-1 flex flex-col min-h-[450px]">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-base font-display font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <BookA className="w-4 h-4 text-emerald-500" /> Từ Điển (Glossary)
                        </h3>
                        <div className="flex gap-2 items-center">
                            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                                <button onClick={() => setViewMode('table')} className={`px-2 py-1 text-[10px] font-bold rounded-md transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${viewMode === 'table' ? 'bg-white dark:bg-slate-700 shadow-elevation-1 text-emerald-600' : 'text-slate-400'}`}>Table</button>
                                <button onClick={() => setViewMode('text')} className={`px-2 py-1 text-[10px] font-bold rounded-md transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${viewMode === 'text' ? 'bg-white dark:bg-slate-700 shadow-elevation-1 text-emerald-600' : 'text-slate-400'}`}>Raw</button>
                            </div>
                            <div className="w-px h-3 bg-slate-200 dark:bg-slate-700"></div>
                            <button onClick={() => props.setDictTab(props.dictTab === 'custom' ? 'default' : 'custom')} className="text-[10px] font-bold px-2 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-100 dark:border-emerald-900/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                                {props.dictTab === 'custom' ? "Mặc định" : "Tùy chỉnh"}
                            </button>
                            <button onClick={props.handleDictionaryEnforce} className="text-[10px] font-bold px-2 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-lg border border-primary-100 dark:border-primary-900/50 hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Áp dụng từ điển lên các file đã chọn">
                                Áp dụng
                            </button>
                            <label className="p-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg transition-colors cursor-pointer">
                                <Upload className="w-3.5 h-3.5" />
                                <input type="file" multiple accept=".txt,.docx,.doc,.pdf" className="hidden" onChange={handleLocalDictionaryUpload} />
                            </label>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0">
                        {props.dictTab === 'custom' ? (
                            viewMode === 'table' ? (
                                <GlossaryTable content={props.additionalDictionary} onChange={props.setAdditionalDictionary} setConfirmModal={props.setConfirmModal} />
                            ) : (
                                <textarea 
                                    className="w-full h-full bg-emerald-50/30 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-xl p-3 text-xs font-mono text-slate-700 dark:text-slate-300 resize-none outline-none focus:ring-2 focus:ring-emerald-200 dark:focus:ring-emerald-800 transition-all duration-200 ease-smooth custom-scrollbar whitespace-pre leading-relaxed" 
                                    placeholder="Mỗi dòng một từ: Trung=Việt" 
                                    value={props.additionalDictionary || ''} 
                                    onChange={e => props.setAdditionalDictionary(e.target.value)} 
                                />
                            )
                        ) : (
                            <textarea 
                                className="w-full h-full bg-slate-50 dark:bg-slate-800 border-0 rounded-xl p-3 text-xs font-mono text-slate-500 dark:text-slate-400 resize-none outline-none custom-scrollbar leading-relaxed" 
                                value={DEFAULT_DICTIONARY} 
                                readOnly 
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* Right Column: Prompt Engineering */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 shadow-elevation-1 border border-slate-200 dark:border-slate-800 flex flex-col h-full min-h-[600px]">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-display font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-primary-500" /> Prompt Engineering
                        {isOptimizedPrompt && (
                            <span className="text-[9px] font-bold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5" /> Đã tối ưu
                            </span>
                        )}
                    </h3>
                    <div className="flex gap-2">
                         {!IS_LITE && (<button onClick={() => props.setViewOriginalPrompt(!props.viewOriginalPrompt)} className={`p-1.5 rounded-lg transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${props.viewOriginalPrompt ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-slate-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:text-primary-600 dark:hover:text-primary-400'}`} title={props.viewOriginalPrompt ? "Ẩn Prompt Gốc" : "Xem Prompt Gốc (nâng cao)"}>
                             {props.viewOriginalPrompt ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                         </button>)}
                         <label className="p-1.5 hover:bg-primary-50 dark:hover:bg-primary-900/30 text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 rounded-lg transition-colors duration-200 ease-smooth cursor-pointer focus-within:ring-2 focus-within:ring-primary-400" title="Load Prompt">
                             <Upload className="w-4 h-4" />
                             <input type="file" accept=".txt,.docx,.doc" className="hidden" onChange={props.handlePromptUpload} />
                         </label>
                         <button onClick={props.resetPrompt} className="p-1.5 hover:bg-danger-50 dark:hover:bg-rose-900/30 text-slate-400 hover:text-danger-600 dark:hover:text-rose-400 rounded-lg transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Reset"><RefreshCw className="w-4 h-4" /></button>
                    </div>
                </div>

                {/* Improved Editor Area */}
                {shouldHideRaw ? (
                    /* Prompt CHƯA được tối ưu riêng cho truyện này -> đây vẫn là prompt gốc/mặc
                       định (kỹ thuật, dài, không dành để người dùng thường sửa tay trực tiếp).
                       Che lại mặc định, chỉ khuyến khích chạy "Tối Ưu Hóa Prompt" hoặc bấm icon
                       con mắt ở trên để xem/sửa tay nếu thực sự cần (người dùng nâng cao). */
                    <div className="flex-1 mb-3 min-h-[400px] rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 flex flex-col items-center justify-center text-center p-6 gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                            <Lock className="w-5 h-5 text-slate-400" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Đang dùng Prompt mặc định</p>
                            <p className="text-[11px] text-slate-400 mt-1 max-w-xs">Truyện này chưa có Prompt riêng. Bấm "Tối Ưu Hóa Prompt" bên dưới để AI tạo bản chỉ thị dịch thuật riêng cho truyện, dựa trên Series Bible và từ điển.</p>
                        </div>
                        {!IS_LITE && (<button onClick={() => props.setViewOriginalPrompt(true)} className="text-[10px] font-bold text-primary-500 hover:text-primary-600 underline underline-offset-2">Xem Prompt Gốc (nâng cao)</button>)}
                    </div>
                ) : (
                    <div className="flex-1 relative mb-3 min-h-[400px] rounded-xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden bg-[#f8fafc] dark:bg-slate-950 shadow-elevation-1 focus-within:border-primary-400 focus-within:ring-4 focus-within:ring-primary-100 dark:focus-within:ring-primary-900 transition-all duration-200 ease-smooth group">
                         <textarea 
                            className="absolute inset-0 w-full h-full bg-transparent p-4 text-xs font-mono text-slate-800 dark:text-slate-200 resize-none outline-none custom-scrollbar whitespace-pre-wrap leading-6" 
                            placeholder="Nội dung Prompt..." 
                            value={props.promptTemplate} 
                            onChange={e => props.setPromptTemplate(e.target.value)}
                            spellCheck={false}
                        />
                    </div>
                )}
                
                <button onClick={() => props.setShowPromptDesigner(true)} disabled={props.isOptimizingPrompt} className="w-full py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-xs font-bold shadow-glow-primary transition-all duration-200 ease-smooth flex items-center justify-center gap-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                    {props.isOptimizingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} 
                    {props.isOptimizingPrompt ? "Đang Tối Ưu..." : "Tối Ưu Hóa Prompt (AI Architect)"}
                </button>
            </div>

            {/* Upload Modal */}
            {showUploadModal && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-elevation-5 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-700">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Upload className="w-5 h-5 text-emerald-500" />
                                Tải lên từ điển
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                Bạn muốn xử lý {uploadFiles?.length} file từ điển này như thế nào?
                            </p>
                        </div>
                        <div className="p-5 flex flex-col gap-3">
                            <button 
                                onClick={() => processUpload('append')}
                                className="w-full text-left p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            >
                                <div className="font-bold text-emerald-700 dark:text-emerald-400">Thêm nối tiếp (Append)</div>
                                <div className="text-xs text-emerald-600/80 dark:text-emerald-500 mt-1">Giữ nguyên từ điển cũ, thêm các từ mới vào và tự động lọc trùng.</div>
                            </button>
                            <button 
                                onClick={() => processUpload('overwrite')}
                                className="w-full text-left p-4 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            >
                                <div className="font-bold text-rose-700 dark:text-rose-400">Ghi đè (Overwrite)</div>
                                <div className="text-xs text-rose-600/80 dark:text-rose-500 mt-1">Xóa toàn bộ từ điển cũ và thay thế bằng nội dung từ file mới.</div>
                            </button>
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                            <button 
                                onClick={() => { setShowUploadModal(false); setUploadFiles(null); }}
                                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            >
                                Hủy bỏ
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
