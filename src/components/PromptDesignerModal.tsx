/* eslint-disable react-hooks/set-state-in-effect */

import React, { useState } from 'react';
import { 
    X, Sparkles, Tags, Users, Palette, Sword, Wrench, 
    BookOpen, BookA, Check, Globe
} from 'lucide-react';
import { StoryInfo } from '../types';
import { TagInput } from '../components/modals';
import { AVAILABLE_GENRES, AVAILABLE_PERSONALITIES, AVAILABLE_SETTINGS, AVAILABLE_FLOWS, AVAILABLE_LANGUAGES } from '../constants';

interface PromptDesignerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (config: { useSearch: boolean, useContext: boolean, useDictionary: boolean, additionalRules: string }) => void;
    storyInfo: StoryInfo;
    setStoryInfo: React.Dispatch<React.SetStateAction<StoryInfo>>;
    isOptimizing: boolean;
    handleRefineAdditionalRules: () => void;
}

export const PromptDesignerModal: React.FC<PromptDesignerModalProps> = ({ 
    isOpen, onClose, onConfirm, storyInfo, setStoryInfo, isOptimizing, handleRefineAdditionalRules
}) => {
    const [useContext, setUseContext] = useState(true);
    const [useDictionary, setUseDictionary] = useState(true);
    const [localRules, setLocalRules] = useState(storyInfo.additionalRules || '');

    const handleRulesChange = (val: string) => {
        setLocalRules(val);
        setStoryInfo(prev => ({ ...prev, additionalRules: val }));
    };

    // Update localRules if it changes from outside
    React.useEffect(() => {
        setLocalRules(storyInfo.additionalRules || '');
    }, [storyInfo.additionalRules]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-300 relative flex flex-col max-h-[90vh]">
                {isOptimizing && (
                    <div className="absolute inset-0 bg-white/95 z-20 flex flex-col items-center justify-center p-8 text-center">
                        <div className="relative mb-6">
                            <div className="w-20 h-20 rounded-full border-4 border-indigo-100 border-t-indigo-500 animate-spin"></div>
                            <Wrench className="absolute inset-0 m-auto w-8 h-8 text-indigo-500 animate-pulse" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">Đang Kiến Trúc Prompt...</h3>
                        <p className="text-sm text-slate-500 max-w-xs mx-auto">
                            AI đang tổng hợp metadata và quy tắc của bạn để tạo ra chỉ thị dịch thuật hoàn hảo nhất.
                        </p>
                    </div>
                )}
                
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50/30">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                        <Wrench className="w-5 h-5 text-indigo-500"/> Prompt Architect (Tối Ưu Hóa)
                    </h3>
                    <button onClick={onClose}><X className="w-5 h-5 text-slate-400 hover:text-slate-600" /></button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                    {/* 1. Metadata Section */}
                    <div className="space-y-4">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">1. Thông tin cốt lõi (Metadata)</label>
                        <div className="grid grid-cols-2 gap-3">
                            <input className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" placeholder="Tên truyện..." value={storyInfo.title || ''} onChange={e => setStoryInfo({...storyInfo, title: e.target.value})} />
                            <input className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs" placeholder="Tác giả..." value={storyInfo.author || ''} onChange={e => setStoryInfo({...storyInfo, author: e.target.value})} />
                        </div>
                        <div className="space-y-3 pt-2">
                            <TagInput label="Ngôn ngữ truyện" icon={<Globe className="w-3.5 h-3.5" />} options={AVAILABLE_LANGUAGES} selected={storyInfo.languages} onChange={v => setStoryInfo({...storyInfo, languages: v})} placeholder="+ Ngôn ngữ"/>
                            <TagInput label="Thể loại" icon={<Tags className="w-3.5 h-3.5" />} options={AVAILABLE_GENRES} selected={storyInfo.genres} onChange={v => setStoryInfo({...storyInfo, genres: v})} placeholder="+ Thể loại"/>
                            <TagInput label="Tính cách Main" icon={<Users className="w-3.5 h-3.5" />} options={AVAILABLE_PERSONALITIES} selected={storyInfo.mcPersonality} onChange={v => setStoryInfo({...storyInfo, mcPersonality: v})} placeholder="+ Tính cách"/>
                            <TagInput label="Bối cảnh" icon={<Palette className="w-3.5 h-3.5" />} options={AVAILABLE_SETTINGS} selected={storyInfo.worldSetting} onChange={v => setStoryInfo({...storyInfo, worldSetting: v})} placeholder="+ Bối cảnh"/>
                            <TagInput label="Lưu phái" icon={<Sword className="w-3.5 h-3.5" />} options={AVAILABLE_FLOWS} selected={storyInfo.sectFlow} onChange={v => setStoryInfo({...storyInfo, sectFlow: v})} placeholder="+ Lưu phái"/>
                        </div>
                    </div>

                    {/* 2. Additional Rules */}
                    <div className="space-y-3 pt-4 border-t border-slate-100">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span>2. Quy tắc bổ sung (Tùy chọn)</span>
                                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">New v10.1</span>
                            </div>
                            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRefineAdditionalRules(); }} className="text-[10px] flex items-center gap-1 font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded-md hover:bg-indigo-100 transition-colors">
                                <Sparkles className="w-3 h-3" /> Tinh Chỉnh {storyInfo.contextNotes ? <Check className="w-3 h-3 text-emerald-500 inline-block ml-0.5" /> : ''}
                            </button>
                        </label>
                        <textarea 
                            className="w-full h-24 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 resize-none outline-none focus:ring-2 focus:ring-indigo-200 transition-all custom-scrollbar leading-relaxed" 
                            placeholder="- Không được dịch tên chiêu thức sang Hán Việt...&#10;- Main tên là Lâm Lôi, không phải Rừng Sấm...&#10;- Văn phong phải cực kỳ nghiêm túc..." 
                            value={localRules} 
                            onChange={e => handleRulesChange(e.target.value)}
                        />
                        <p className="text-[10px] text-slate-500 italic px-1">
                            Các quy tắc này sẽ được AI lồng ghép vào Prompt cuối cùng dựa trên bản sắc riêng của truyện.
                        </p>
                    </div>

                    {/* 3. Optimization Config */}
                    <div className="space-y-3 pt-4 border-t border-slate-100">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">3. Dữ liệu tham khảo</label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${useContext ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'}`}>
                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useContext ? 'bg-indigo-500 border-indigo-500' : 'bg-white border-slate-300'}`}>
                                    {useContext && <Check className="w-3.5 h-3.5 text-white" />}
                                </div>
                                <input type="checkbox" className="hidden" checked={useContext} onChange={e => setUseContext(e.target.checked)} />
                                <div className="text-xs">
                                    <span className="font-bold text-slate-700 block flex items-center gap-1"><BookOpen className="w-3.5 h-3.5"/> Dùng Ngữ Cảnh</span>
                                    <span className="text-[10px] text-slate-500">Series Bible đã phân tích</span>
                                </div>
                            </label>

                            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${useDictionary ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useDictionary ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-slate-300'}`}>
                                    {useDictionary && <Check className="w-3.5 h-3.5 text-white" />}
                                </div>
                                <input type="checkbox" className="hidden" checked={useDictionary} onChange={e => setUseDictionary(e.target.checked)} />
                                <div className="text-xs">
                                    <span className="font-bold text-slate-700 block flex items-center gap-1"><BookA className="w-3.5 h-3.5"/> Dùng Từ Điển</span>
                                    <span className="text-[10px] text-slate-500">Glossary hiện tại</span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 flex-shrink-0">
                    <button onClick={onClose} className="px-5 py-2.5 text-slate-500 font-bold hover:bg-slate-100 rounded-xl text-sm">Hủy</button>
                    <button 
                        onClick={() => onConfirm({useSearch: false, useContext, useDictionary, additionalRules: localRules})} 
                        className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
                        disabled={!storyInfo.title && (!storyInfo.genres || storyInfo.genres.length === 0)}
                    >
                        <Sparkles className="w-4 h-4 fill-current" /> Tối Ưu Hóa Ngay
                    </button>
                </div>
            </div>
        </div>
    );
}
