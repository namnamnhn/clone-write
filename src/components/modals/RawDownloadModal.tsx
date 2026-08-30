import React, { useState } from 'react';
import { FileDown, X } from 'lucide-react';

export interface RawDownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (parts: number) => void;
}

export const RawDownloadModal: React.FC<RawDownloadModalProps> = ({ isOpen, onClose, onConfirm }) => {
    const [parts, setParts] = useState(1);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 p-6">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-sky-50 dark:bg-sky-900/30 rounded-xl text-sky-600 dark:text-sky-400">
                            <FileDown className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">Tải File Raw</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Chia nhỏ file để nén dễ dàng hơn</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="mb-6">
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Số phần muốn chia:</label>
                    <input 
                        type="number" 
                        min={1} 
                        value={parts} 
                        onChange={(e) => setParts(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-sky-500 outline-none transition-all dark:text-slate-200"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Mặc định là 1 (Tải toàn bộ vào 1 file ZIP)</p>
                </div>

                <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 py-3 text-slate-500 dark:text-slate-400 font-bold bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">Hủy</button>
                    <button onClick={() => { onConfirm(parts); onClose(); }} className="flex-1 py-3 text-white font-bold bg-sky-500 rounded-xl hover:bg-sky-600 transition-colors">Tải Về</button>
                </div>
            </div>
        </div>
    );
}
