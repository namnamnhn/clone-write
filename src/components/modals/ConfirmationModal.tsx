import React from 'react';

export interface ConfirmationModalProps { isOpen: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void; isDanger?: boolean; confirmText?: string; }
export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, title, message, onConfirm, onCancel, isDanger, confirmText }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-elevation-5 border border-transparent dark:border-slate-700 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 p-6 text-center">
                <h3 className="font-display font-bold text-xl text-slate-800 dark:text-slate-100 mb-2">{title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">{message}</p>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="flex-1 py-3 text-slate-500 dark:text-slate-300 font-bold bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">Hủy</button>
                    <button onClick={onConfirm} className={`flex-1 py-3 text-white font-bold rounded-xl transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${isDanger ? 'bg-danger-500 hover:bg-danger-600 focus-visible:ring-danger-400' : 'bg-info-500 hover:bg-info-600 focus-visible:ring-info-400'}`}>{confirmText || 'Xác Nhận'}</button>
                </div>
            </div>
        </div>
    );
}
