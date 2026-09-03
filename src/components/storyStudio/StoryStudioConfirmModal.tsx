import React from 'react';

export const StoryStudioConfirmModal: React.FC<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}> = ({ open, title, message, confirmLabel, danger = false, onCancel, onConfirm }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="story-studio-confirm-title">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
                <h2 id="story-studio-confirm-title" className="text-xl font-black text-slate-900 dark:text-white">{title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{message}</p>
                <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">Hủy</button>
                    <button type="button" onClick={onConfirm} className={`rounded-xl px-4 py-2.5 text-sm font-black text-white ${danger ? 'bg-rose-600' : 'bg-indigo-600'}`}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
};
