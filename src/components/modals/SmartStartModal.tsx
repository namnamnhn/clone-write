import React, { useState } from 'react';
import { X, Sparkles, Brain } from 'lucide-react';
import { StoryInfo } from '../../types';
import { StoryInfoFields, SamplingFields } from './shared';

export interface SmartStartModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (useSearch: boolean, additionalRules: string, sampling: {start: number, middle: number, end: number}) => void;
    onSkip: () => void;
    storyInfo: StoryInfo;
    setStoryInfo: React.Dispatch<React.SetStateAction<StoryInfo>>;
    autoOptimize: boolean;
    setAutoOptimize: (v: boolean) => void;
    step: 'idle' | 'optimizing' | 'analyzing';
}
export const SmartStartModal: React.FC<SmartStartModalProps> = ({ isOpen, onClose, onConfirm, onSkip, storyInfo, setStoryInfo, autoOptimize, setAutoOptimize, step }) => {
    const [useSearch, setUseSearch] = useState(false);
    const [sampleHead, setSampleHead] = useState(100);
    const [sampleMid, setSampleMid] = useState(100);
    const [sampleTail, setSampleTail] = useState(100);
    if (!isOpen) return null;
    const isRunning = step !== 'idle';
    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-300 relative flex flex-col max-h-[95vh]">
                {isRunning && (
                    <div className="absolute inset-0 bg-white/95 z-[70] flex flex-col items-center justify-center p-8 text-center">
                        <div className="relative mb-6">
                            <div className="w-20 h-20 rounded-full border-4 border-indigo-100 border-t-indigo-500 animate-spin"></div>
                            <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-indigo-500 animate-pulse" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">{step === 'optimizing' ? "Đang Tối Ưu Prompt..." : "Đang Phân Tích Cốt Truyện..."}</h3>
                        <p className="text-sm text-slate-500">Vui lòng không đóng cửa sổ này...</p>
                    </div>
                )}
                
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50/30">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Brain className="w-5 h-5 text-indigo-500"/> Smart Start AI Configuration</h3>
                    <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
                </div>

                <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-6">
                    <div className="space-y-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">1. Thông tin truyện</label>
                        <StoryInfoFields info={storyInfo} setInfo={setStoryInfo} />
                    </div>
                    <div className="space-y-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quy tắc bổ sung (Tùy chọn)</label>
                        <textarea 
                            className="w-full h-24 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 resize-none outline-none focus:ring-2 focus:ring-indigo-200 transition-all custom-scrollbar leading-relaxed" 
                            placeholder="- Không được dịch tên chiêu thức sang Hán Việt...&#10;- Main tên là Lâm Lôi, không phải Rừng Sấm...&#10;- Văn phong phải cực kỳ nghiêm túc..." 
                            value={storyInfo.additionalRules || ''} 
                            onChange={e => setStoryInfo({...storyInfo, additionalRules: e.target.value})}
                        />
                    </div>
                    <div className="space-y-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">2. Phạm vi phân tích</label>
                        <SamplingFields head={sampleHead} mid={sampleMid} tail={sampleTail} setHead={setSampleHead} setMid={setSampleMid} setTail={setSampleTail} />
                    </div>
                    <div className="space-y-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">3. Tùy chọn nâng cao</label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${autoOptimize ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'}`}>
                                <input type="checkbox" checked={autoOptimize} onChange={e => setAutoOptimize(e.target.checked)} className="w-4 h-4 text-indigo-600 rounded" />
                                <div className="text-xs">
                                    <span className="font-bold text-indigo-700 block">Prompt Architect</span>
                                    <span className="text-[9px] text-slate-500">Tự động thiết kế Prompt riêng</span>
                                </div>
                            </label>
                            <label className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${useSearch ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200'}`}>
                                <input type="checkbox" checked={useSearch} onChange={e => setUseSearch(e.target.checked)} className="w-4 h-4 text-sky-600 rounded" />
                                <div className="text-xs">
                                    <span className="font-bold text-sky-700 block">Google Search</span>
                                    <span className="text-[9px] text-slate-500">Truy tìm thực thể (Gemini 3 Pro)</span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 shrink-0">
                     <button onClick={onSkip} className="px-6 py-2.5 text-slate-400 font-bold hover:text-slate-600 text-sm">Bỏ Qua</button>
                     <button onClick={() => onConfirm(useSearch, storyInfo.additionalRules || "", {start: sampleHead, middle: sampleMid, end: sampleTail})} className="flex-1 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-200/50 transition-all flex items-center justify-center gap-2">
                        <Sparkles className="w-5 h-5" /> Kích Hoạt Smart Start
                    </button>
                </div>
            </div>
        </div>
    );
}
