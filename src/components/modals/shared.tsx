import React from 'react';
import { Layers, Globe, Tags, Users, Palette, Sword } from 'lucide-react';
import { StoryInfo } from '../../types';
import { AVAILABLE_LANGUAGES, AVAILABLE_GENRES, AVAILABLE_PERSONALITIES, AVAILABLE_SETTINGS, AVAILABLE_FLOWS } from '../../constants';
import { TagInput } from './TagInput';

export const StoryInfoFields = ({ info, setInfo }: { info: StoryInfo, setInfo: (v: StoryInfo) => void }) => {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">Tên Truyện</label><input className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-xl text-sm font-bold shadow-elevation-1 outline-none focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-800 transition-all duration-200 ease-smooth" value={info.title || ''} onChange={e => setInfo({...info, title: e.target.value})} /></div>
                <div><label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">Tác Giả</label><input className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-xl text-sm shadow-elevation-1 outline-none focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-800 transition-all duration-200 ease-smooth" value={info.author || ''} onChange={e => setInfo({...info, author: e.target.value})} /></div>
            </div>
            <TagInput label="Ngôn ngữ truyện" icon={<Globe className="w-3.5 h-3.5" />} options={AVAILABLE_LANGUAGES} selected={info.languages} onChange={v => setInfo({...info, languages: v})} />
            <div className="grid grid-cols-2 gap-3">
                <TagInput label="Thể loại" icon={<Tags className="w-3.5 h-3.5" />} options={AVAILABLE_GENRES} selected={info.genres} onChange={v => setInfo({...info, genres: v})} />
                <TagInput label="Tính cách Main" icon={<Users className="w-3.5 h-3.5" />} options={AVAILABLE_PERSONALITIES} selected={info.mcPersonality} onChange={v => setInfo({...info, mcPersonality: v})} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <TagInput label="Bối cảnh" icon={<Palette className="w-3.5 h-3.5" />} options={AVAILABLE_SETTINGS} selected={info.worldSetting} onChange={v => setInfo({...info, worldSetting: v})} />
                <TagInput label="Lưu phái" icon={<Sword className="w-3.5 h-3.5" />} options={AVAILABLE_FLOWS} selected={info.sectFlow} onChange={v => setInfo({...info, sectFlow: v})} />
            </div>
            <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1 flex justify-between items-center">
                    <span>Quy tắc bổ sung (Nếu có)</span>
                    <span className="text-[9px] bg-info-50 dark:bg-info-900/30 text-info-600 dark:text-info-400 px-1.5 py-0.5 rounded">Tailor-Made</span>
                </label>
                <textarea 
                    className="w-full h-20 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-mono resize-none outline-none focus:ring-2 focus:ring-info-200 dark:focus:ring-info-800 transition-all duration-200 ease-smooth shadow-elevation-1" 
                    placeholder="- Main tên John, không phải Gioan...&#10;- Giữ nguyên tên chiêu thức..." 
                    value={info.additionalRules || ''} 
                    onChange={e => setInfo({...info, additionalRules: e.target.value})}
                />
            </div>
        </div>
    );
};

export const SamplingFields = ({ head, mid, tail, setHead, setMid, setTail }: any) => {
    return (
        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-inner">
            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-3 flex items-center gap-2"><Layers className="w-3.5 h-3.5"/> Phạm vi lấy mẫu (Lượng chương AI sẽ đọc)</label>
            <div className="flex items-center gap-4">
                <div className="flex-1 flex flex-col items-center">
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold mb-1">ĐẦU TRUYỆN</span>
                    <input type="number" className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-center text-sm font-bold shadow-elevation-1 outline-none focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-800 transition-all duration-200 ease-smooth" value={head} onChange={e => setHead(parseInt(e.target.value) || 0)} />
                </div>
                <div className="flex-1 flex flex-col items-center">
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold mb-1">GIỮA TRUYỆN</span>
                    <input type="number" className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-center text-sm font-bold shadow-elevation-1 outline-none focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-800 transition-all duration-200 ease-smooth" value={mid} onChange={e => setMid(parseInt(e.target.value) || 0)} />
                </div>
                <div className="flex-1 flex flex-col items-center">
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold mb-1">CUỐI TRUYỆN</span>
                    <input type="number" className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-lg text-center text-sm font-bold shadow-elevation-1 outline-none focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-800 transition-all duration-200 ease-smooth" value={tail} onChange={e => setTail(parseInt(e.target.value) || 0)} />
                </div>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 italic text-center">AI sẽ tự động lọc bỏ các file trùng lặp và sắp xếp theo thứ tự.</p>
        </div>
    );
};
