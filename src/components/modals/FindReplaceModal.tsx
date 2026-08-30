import React, { useState } from 'react';
import { X, Trash2, Plus } from 'lucide-react';

export interface FindReplaceModalProps { 
    isOpen: boolean; 
    onClose: () => void; 
    onReplace: (pairs: {find: string, replace: string, useRegex?: boolean, exactMatch?: boolean}[], scope: 'all' | 'selected') => void; 
    selectedCount: number; 
}

export const FindReplaceModal: React.FC<FindReplaceModalProps> = ({ isOpen, onClose, onReplace, selectedCount }) => {
    const [pairs, setPairs] = useState<{id: string, find: string, replace: string, useRegex: boolean, exactMatch: boolean}[]>([{id: '1', find: '', replace: '', useRegex: false, exactMatch: true}]);

    const handleAddPair = () => {
        setPairs([...pairs, {id: crypto.randomUUID(), find: '', replace: '', useRegex: false, exactMatch: true}]);
    };

    const handleRemovePair = (id: string) => {
        if (pairs.length > 1) {
            setPairs(pairs.filter(p => p.id !== id));
        }
    };

    const handleChange = (id: string, field: 'find' | 'replace' | 'useRegex' | 'exactMatch', value: string | boolean) => {
        setPairs(pairs.map(p => p.id === id ? {...p, [field]: value} : p));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold text-lg text-slate-800">Tìm & Thay Thế Nâng Cao</h3>
                    <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
                </div>
                
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4">
                    {pairs.map((pair, index) => (
                        <div key={pair.id} className="flex gap-2 items-start animate-in fade-in slide-in-from-left-4">
                            <span className="text-xs font-bold text-slate-300 mt-3 w-4">{index + 1}.</span>
                            <div className="flex-1 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <input 
                                        className="w-full p-2 border rounded text-sm bg-slate-50 focus:bg-white transition-colors text-slate-900 dark:text-slate-100 font-medium placeholder:text-slate-400" 
                                        placeholder="Tìm kiếm..." 
                                        value={pair.find} 
                                        onChange={e => handleChange(pair.id, 'find', e.target.value)} 
                                    />
                                    <input 
                                        className="w-full p-2 border rounded text-sm bg-slate-50 focus:bg-white transition-colors text-slate-900 dark:text-slate-100 font-medium placeholder:text-slate-400" 
                                        placeholder="Thay thế bằng..." 
                                        value={pair.replace} 
                                        onChange={e => handleChange(pair.id, 'replace', e.target.value)} 
                                    />
                                </div>
                                <div className="flex items-center gap-4 mt-1">
                                    <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                                        <input 
                                            type="checkbox" 
                                            checked={pair.useRegex} 
                                            onChange={e => handleChange(pair.id, 'useRegex', e.target.checked)}
                                            className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-[10px] font-bold text-slate-500 uppercase">Regex</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer select-none w-fit" title="Chỉ thay chính xác từ, không thay nếu nằm trong từ khác (VD: Không thay ách trong sách)">
                                        <input 
                                            type="checkbox" 
                                            checked={pair.exactMatch !== false} 
                                            onChange={e => handleChange(pair.id, 'exactMatch', e.target.checked)}
                                            disabled={pair.useRegex}
                                            className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                        <span className={`text-[10px] font-bold uppercase ${pair.useRegex ? 'text-slate-400' : 'text-slate-500'}`}>Khớp nguyên từ</span>
                                    </label>
                                </div>
                            </div>
                            {pairs.length > 1 && (
                                <button onClick={() => handleRemovePair(pair.id)} className="p-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 mt-0.5">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ))}
                    
                    <button onClick={handleAddPair} className="flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-lg transition-colors ml-6">
                        <Plus className="w-3 h-3" /> Thêm Dòng
                    </button>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50">
                    <div className="flex flex-col gap-2">
                        <button onClick={() => { if(pairs.some(p => p.find)) { onReplace(pairs, 'all'); onClose(); } }} className="w-full py-3 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-bold shadow-lg shadow-sky-200/50 transition-all">
                            Thay Thế Tất Cả
                        </button>
                        {selectedCount > 0 && (
                            <button onClick={() => { if(pairs.some(p => p.find)) { onReplace(pairs, 'selected'); onClose(); } }} className="w-full py-3 bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 rounded-xl font-bold transition-all">
                                Chỉ Thay {selectedCount} File Đang Chọn
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
