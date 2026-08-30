import React from 'react';
import { AlertTriangle, RefreshCw, ArrowRight, X } from 'lucide-react';

export interface MissingInfoModalProps {
    isOpen: boolean;
    missingLabels: string[];
    onRestore: () => void;
    onContinue: () => void;
    onExit: () => void;
}

export const MissingInfoModal: React.FC<MissingInfoModalProps> = ({ isOpen, missingLabels, onRestore, onContinue, onExit }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-elevation-5 border border-transparent dark:border-slate-700 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 p-6">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <h3 className="font-display font-bold text-lg text-slate-800 dark:text-slate-100">Hiện tại chưa có một số thông tin cơ bản</h3>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">
                    Dự án hiện tại chưa có: <span className="font-semibold text-slate-800 dark:text-slate-100">{missingLabels.join(', ')}</span>.
                    Thiếu các thông tin này có thể khiến công cụ AI ở đây kém chính xác hơn.
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">Bạn có muốn đồng bộ/khôi phục từ file backup trước không?</p>
                <div className="flex flex-col gap-2">
                    <button onClick={onRestore} className="w-full py-3 text-white font-bold bg-primary-500 hover:bg-primary-600 rounded-xl flex items-center justify-center gap-2 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        <RefreshCw className="w-4 h-4" /> Đồng Bộ Từ Backup
                    </button>
                    <button onClick={onContinue} className="w-full py-3 text-slate-600 dark:text-slate-300 font-bold bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors duration-200 ease-smooth flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        <ArrowRight className="w-4 h-4" /> Tiếp Tục (Không Cần)
                    </button>
                    <button onClick={onExit} className="w-full py-2.5 text-slate-400 dark:text-slate-500 font-medium hover:text-slate-600 dark:hover:text-slate-300 rounded-xl flex items-center justify-center gap-2 transition-colors duration-200 ease-smooth">
                        <X className="w-4 h-4" /> Thoát
                    </button>
                </div>
            </div>
        </div>
    );
};
