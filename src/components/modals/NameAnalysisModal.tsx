import React, { useState } from 'react';
import { X, Microscope, Zap, Feather, ListFilter, ArrowRight, PlayCircle, Minimize2, BookOpen, Tags } from 'lucide-react';
import { StoryInfo } from '../../types';
import { StoryInfoFields, SamplingFields } from './shared';

const AnalysisSkeleton = () => {
    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header Skeleton */}
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="w-12 h-12 bg-slate-200 rounded-full animate-pulse shrink-0"></div>
                <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-200 rounded w-1/3 animate-pulse"></div>
                    <div className="h-3 bg-slate-200 rounded w-1/2 animate-pulse"></div>
                </div>
            </div>

            {/* Content Skeletons */}
            <div className="space-y-4">
                <div className="h-3 bg-slate-200 rounded w-24 animate-pulse"></div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="h-24 bg-slate-100 rounded-xl border border-slate-200 animate-pulse"></div>
                    <div className="h-24 bg-slate-100 rounded-xl border border-slate-200 animate-pulse"></div>
                </div>
            </div>

            <div className="space-y-3">
                <div className="h-3 bg-slate-200 rounded w-32 animate-pulse"></div>
                <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-slate-100 rounded-lg animate-pulse"></div>
                            <div className="flex-1 h-8 bg-slate-100 rounded-lg animate-pulse"></div>
                        </div>
                    ))}
                </div>
            </div>
            
            {/* Progress Simulation */}
            <div className="pt-4 border-t border-slate-100">
                <div className="flex justify-between mb-2">
                    <div className="h-3 bg-slate-200 rounded w-20 animate-pulse"></div>
                    <div className="h-3 bg-slate-200 rounded w-10 animate-pulse"></div>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-400/50 w-2/3 animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]"></div>
                </div>
            </div>
        </div>
    );
};

export interface NameAnalysisModalProps { isOpen: boolean; onClose: () => void; onConfirm: (config: any) => void; isAnalyzing: boolean; progress: { current: number; total: number; stage: string }; storyInfo: StoryInfo; totalFiles: number; }
export const NameAnalysisModal: React.FC<NameAnalysisModalProps> = ({ isOpen, onClose, onConfirm, isAnalyzing, progress, storyInfo, totalFiles }) => {
    const [mode, setMode] = useState<'only_char' | 'full' | 'deep_context'>('deep_context');
    const [scope, setScope] = useState<'smart' | 'range' | 'full'>('full');
    const [rangeStart, setRangeStart] = useState(1);
    const [rangeEnd, setRangeEnd] = useState(Math.min(100, totalFiles));
    const [useSearch, setUseSearch] = useState(false);
    const [sampleHead, setSampleHead] = useState(100), [sampleMid, setSampleMid] = useState(100), [sampleTail, setSampleTail] = useState(100);
    const [localInfo, setLocalInfo] = useState(storyInfo);
    
    // MINIMIZE STATE
    const [isMinimized, setIsMinimized] = useState(false);
    const [prevIsAnalyzing, setPrevIsAnalyzing] = useState(isAnalyzing);

    if (isAnalyzing !== prevIsAnalyzing) {
        setPrevIsAnalyzing(isAnalyzing);
        if (!isAnalyzing) setIsMinimized(false);
    }
    
    if (!isOpen) return null;
    const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    
    // --- MINIMIZED VIEW ---
    if (isMinimized && isAnalyzing) {
        return (
            <div 
                className="fixed bottom-24 right-6 z-[200] bg-white dark:bg-slate-900 shadow-2xl border-2 border-amber-400 rounded-full p-1.5 flex items-center gap-3 animate-in slide-in-from-bottom-10 group pr-4 cursor-pointer" 
                title="Analysis Running"
                onClick={() => setIsMinimized(false)}
            >
                <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 font-black relative shadow-sm">
                    <span className="text-xs">{percentage}%</span>
                    <div className="absolute inset-0 border-2 border-amber-200 rounded-full opacity-0 group-hover:opacity-100 group-hover:animate-ping"></div>
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">Deep Scan</span>
                    <span className="text-[9px] font-bold text-slate-500 max-w-[120px] truncate animate-pulse">
                        {progress.stage || "Đang phân tích..."}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className={`fixed inset-0 z-[180] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 ${isAnalyzing ? 'pointer-events-none' : ''}`}>
            <div className={`bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative flex flex-col max-h-[95vh] ${isAnalyzing ? 'pointer-events-auto' : ''}`}>
                
                {/* Use SKELETON LOADER instead of basic Spinner Overlay */}
                {isAnalyzing && (
                     <div className="absolute inset-0 bg-white/95 z-[70] flex flex-col p-8 animate-in fade-in duration-300">
                        {/* Header for running state */}
                        <div className="absolute top-4 right-4 flex gap-2 z-50">
                             <button 
                                onClick={() => setIsMinimized(true)} 
                                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 hover:text-slate-700 transition-colors"
                                title="Thu nhỏ"
                             >
                                <Minimize2 className="w-5 h-5" />
                             </button>
                        </div>

                        <div className="w-full text-center mb-8 mt-4">
                            <div className="flex justify-between text-xs font-bold text-slate-500 mb-2"><span>AI đang phân tích & trích xuất dữ liệu...</span><span>{percentage}%</span></div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200 shadow-inner"><div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300" style={{ width: `${percentage}%` }}></div></div>
                            <p className="mt-2 text-sm font-bold text-slate-600 animate-pulse">{progress.stage}</p>
                        </div>
                        {/* THE SKELETON UI */}
                        <div className="flex-1 overflow-hidden relative">
                            <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white to-transparent z-10"></div>
                            <AnalysisSkeleton />
                            <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent z-10"></div>
                        </div>
                    </div>
                )}
                
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-amber-50/30">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Microscope className="w-5 h-5 text-amber-500"/> Deep AI Analysis Panel</h3>
                    {!isAnalyzing && <button onClick={onClose}><X className="w-5 h-5 text-slate-400 hover:text-slate-600" /></button>}
                </div>

                <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-8">
                    <div className="space-y-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Zap className="w-3.5 h-3.5"/> Bước 1: Chọn Chế Độ Phân Tích</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                             <button onClick={() => setMode('deep_context')} className={`p-4 rounded-2xl border flex items-start gap-4 transition-all text-left group ${mode === 'deep_context' ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200 shadow-md' : 'bg-white border-slate-200 hover:border-amber-200'}`}>
                                <div className={`mt-1 p-2 rounded-xl transition-colors ${mode === 'deep_context' ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-600 group-hover:bg-amber-200'}`}><BookOpen className="w-6 h-6" /></div>
                                <div><div className="font-bold text-sm text-slate-800">Phân Tích Ngữ Cảnh</div><p className="text-[10px] text-slate-500 mt-1 font-medium leading-relaxed">Xây dựng Series Bible (Nhân vật, Xưng hô, Cốt truyện).</p></div>
                            </button>
                            <button onClick={() => setMode('full')} className={`p-4 rounded-2xl border flex items-start gap-4 transition-all text-left group ${mode === 'full' ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200 shadow-md' : 'bg-white border-slate-200 hover:border-emerald-200'}`}>
                                <div className={`mt-1 p-2 rounded-xl transition-colors ${mode === 'full' ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-600 group-hover:bg-emerald-200'}`}><Tags className="w-6 h-6" /></div>
                                <div><div className="font-bold text-sm text-slate-800">Trích Xuất Từ Điển</div><p className="text-[10px] text-slate-500 mt-1 font-medium leading-relaxed">Quét toàn bộ tên riêng, chiêu thức, địa danh nguyên bản.</p></div>
                            </button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Feather className="w-3.5 h-3.5"/> Bước 2: Cập Nhật Metadata (Tùy chọn)</label>
                        {mode === 'deep_context' && (
                            <div className="-mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lối Xưng Hô Mong Muốn</span>
                                    <span title="Linh Động: AI tự phân loại xưng hô theo bối cảnh từng nhân vật (Cổ trang/Hiện đại/Phương Tây) — hành vi mặc định. Hiện Đại/Cổ Đại: ép toàn truyện chỉ dùng 1 lối xưng hô duy nhất, bỏ qua phân loại theo bối cảnh." className="text-[9px] font-bold text-primary-500 uppercase tracking-wide cursor-help select-none">
                                        Quy Tắc Thông Minh
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <button type="button" onClick={() => setLocalInfo({...localInfo, pronounMode: 'modern'})} className={`py-2 px-1.5 rounded-xl border text-center transition-all ${localInfo.pronounMode === 'modern' ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200' : 'bg-white border-slate-200 hover:border-emerald-200'}`}>
                                        <div className={`text-xs font-bold ${localInfo.pronounMode === 'modern' ? 'text-emerald-700' : 'text-slate-600'}`}>Hiện Đại</div>
                                        <div className="text-[9px] text-slate-400 mt-0.5">Thuần Việt 100%</div>
                                    </button>
                                    <button type="button" onClick={() => setLocalInfo({...localInfo, pronounMode: 'ancient'})} className={`py-2 px-1.5 rounded-xl border text-center transition-all ${localInfo.pronounMode === 'ancient' ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200' : 'bg-white border-slate-200 hover:border-emerald-200'}`}>
                                        <div className={`text-xs font-bold ${localInfo.pronounMode === 'ancient' ? 'text-emerald-700' : 'text-slate-600'}`}>Cổ Đại</div>
                                        <div className="text-[9px] text-slate-400 mt-0.5">Cổ Trang 100%</div>
                                    </button>
                                    <button type="button" onClick={() => setLocalInfo({...localInfo, pronounMode: 'flexible'})} className={`py-2 px-1.5 rounded-xl border text-center transition-all ${(!localInfo.pronounMode || localInfo.pronounMode === 'flexible') ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200' : 'bg-white border-slate-200 hover:border-emerald-200'}`}>
                                        <div className={`text-xs font-bold ${(!localInfo.pronounMode || localInfo.pronounMode === 'flexible') ? 'text-emerald-700' : 'text-slate-600'}`}>Linh Động</div>
                                        <div className="text-[9px] text-slate-400 mt-0.5">Mặc định/Tự nhiên</div>
                                    </button>
                                </div>
                            </div>
                        )}
                        {mode === 'deep_context' && (
                            <div className="-mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Đơn Vị Số Đếm Mong Muốn</span>
                                    <span title="Linh Động: AI tự chọn hệ đơn vị số theo bối cảnh — hành vi mặc định. Hiện Đại/Cổ Đại: ép toàn truyện (kể cả bảng thông số hệ thống) chỉ dùng 1 hệ đơn vị số duy nhất." className="text-[9px] font-bold text-primary-500 uppercase tracking-wide cursor-help select-none">
                                        Quy Tắc Thông Minh
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <button type="button" onClick={() => setLocalInfo({...localInfo, numberUnitMode: 'modern'})} className={`py-2 px-1.5 rounded-xl border text-center transition-all ${localInfo.numberUnitMode === 'modern' ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200' : 'bg-white border-slate-200 hover:border-emerald-200'}`}>
                                        <div className={`text-xs font-bold ${localInfo.numberUnitMode === 'modern' ? 'text-emerald-700' : 'text-slate-600'}`}>Hiện Đại</div>
                                        <div className="text-[9px] text-slate-400 mt-0.5">Nghìn/Triệu/Tỷ</div>
                                    </button>
                                    <button type="button" onClick={() => setLocalInfo({...localInfo, numberUnitMode: 'ancient'})} className={`py-2 px-1.5 rounded-xl border text-center transition-all ${localInfo.numberUnitMode === 'ancient' ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200' : 'bg-white border-slate-200 hover:border-emerald-200'}`}>
                                        <div className={`text-xs font-bold ${localInfo.numberUnitMode === 'ancient' ? 'text-emerald-700' : 'text-slate-600'}`}>Cổ Đại</div>
                                        <div className="text-[9px] text-slate-400 mt-0.5">Vạn/Ức</div>
                                    </button>
                                    <button type="button" onClick={() => setLocalInfo({...localInfo, numberUnitMode: 'flexible'})} className={`py-2 px-1.5 rounded-xl border text-center transition-all ${(!localInfo.numberUnitMode || localInfo.numberUnitMode === 'flexible') ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200' : 'bg-white border-slate-200 hover:border-emerald-200'}`}>
                                        <div className={`text-xs font-bold ${(!localInfo.numberUnitMode || localInfo.numberUnitMode === 'flexible') ? 'text-emerald-700' : 'text-slate-600'}`}>Linh Động</div>
                                        <div className="text-[9px] text-slate-400 mt-0.5">Mặc định/Tự nhiên</div>
                                    </button>
                                </div>
                            </div>
                        )}
                        <StoryInfoFields info={localInfo} setInfo={setLocalInfo} />
                    </div>

                    <div className="space-y-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><ListFilter className="w-3.5 h-3.5"/> Bước 3: Phạm Vi Quét</label>
                        <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-1.5 shadow-inner">
                             <button onClick={() => setScope('smart')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${scope === 'smart' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>Smart Sampling (Nhanh)</button>
                             <button onClick={() => setScope('range')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${scope === 'range' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>Khoảng cụ thể</button>
                             <button onClick={() => setScope('full')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${scope === 'full' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}>Toàn Bộ</button>
                        </div>

                        {scope === 'smart' && <SamplingFields head={sampleHead} mid={sampleMid} tail={sampleTail} setHead={setSampleHead} setMid={setSampleMid} setTail={setSampleTail} />}
                        
                        {scope === 'range' && (
                             <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-inner">
                                <div className="flex-1 flex flex-col items-center">
                                    <span className="text-[9px] text-slate-400 font-bold mb-1 uppercase">Từ chương</span>
                                    <input type="number" className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-center text-sm font-bold shadow-sm" value={rangeStart} onChange={e => setRangeStart(parseInt(e.target.value) || 1)} min={1} />
                                </div>
                                <ArrowRight className="w-4 h-4 text-slate-300 mt-5" />
                                <div className="flex-1 flex flex-col items-center">
                                    <span className="text-[9px] text-slate-400 font-bold mb-1 uppercase">Đến chương</span>
                                    <input type="number" className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-center text-sm font-bold shadow-sm" value={rangeEnd} onChange={e => setRangeEnd(parseInt(e.target.value) || 1)} min={rangeStart} />
                                </div>
                            </div>
                        )}

                        <div className="pt-2 space-y-4">
                            <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all shadow-sm ${useSearch ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200'}`}>
                                <input type="checkbox" checked={useSearch} onChange={e => setUseSearch(e.target.checked)} className="w-5 h-5 text-sky-600 rounded" />
                                <div className="text-xs">
                                    <span className="font-bold text-sky-700 block">Kích hoạt AI Search (Google Grounding)</span>
                                    <span className="text-[10px] text-slate-500">AI sẽ tự tra cứu thông tin thực thể, địa danh ngoài đời thực để dịch chính xác hơn. (Khuyên dùng Gemini 3 Pro)</span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 shrink-0">
                    <button onClick={onClose} disabled={isAnalyzing} className="px-6 py-2.5 text-slate-500 font-bold text-sm hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50">Đóng</button>
                    <button onClick={() => onConfirm({mode, scope, rangeStart, rangeEnd, updatedStoryInfo: localInfo, useSearch, sampling: {start: sampleHead, middle: sampleMid, end: sampleTail}, additionalRules: localInfo.additionalRules || ''})} disabled={isAnalyzing} className="px-8 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-orange-200/50 hover:shadow-orange-200/80 transition-all flex items-center gap-2 disabled:opacity-50"><PlayCircle className="w-5 h-5" /> Kích Hoạt Phân Tích</button>
                </div>
            </div>
        </div>
    );
}
