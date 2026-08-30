import React from 'react';

export interface ImportModalProps { isOpen: boolean; count: number; onAppend: () => void; onOverwrite: () => void; onCancel: () => void; }
export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, count, onAppend, onOverwrite, onCancel }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 p-6">
                <h3 className="font-bold text-lg text-slate-800 mb-4">Nhập {count} file mới</h3>
                <div className="space-y-3">
                    <button onClick={onAppend} className="w-full p-4 bg-sky-50 border border-sky-100 rounded-2xl text-left font-bold text-sky-700">Nối tiếp (Append)</button>
                    <button onClick={onOverwrite} className="w-full p-4 bg-rose-50 border border-rose-100 rounded-2xl text-left font-bold text-rose-700">Tạo Mới (Overwrite)</button>
                </div>
                <button onClick={onCancel} className="w-full mt-4 py-3 text-slate-400 font-bold">Hủy bỏ</button>
            </div>
        </div>
    );
}
