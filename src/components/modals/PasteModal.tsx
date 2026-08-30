import React, { useState } from 'react';

export interface PasteModalProps { isOpen: boolean; onClose: () => void; onConfirm: (title: string, content: string, isTranslated?: boolean) => void; }
export const PasteModal: React.FC<PasteModalProps> = ({ isOpen, onClose, onConfirm }) => {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [isTranslated, setIsTranslated] = useState(false);
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 p-6">
                <h3 className="font-bold text-lg mb-4">Dán Nội Dung</h3>
                <input className="w-full mb-3 p-2 border rounded" placeholder="Tiêu đề (không bắt buộc)" value={title} onChange={e => setTitle(e.target.value)} />
                <textarea className="w-full h-64 p-2 border rounded resize-none mb-3" placeholder="Nội dung..." value={content} onChange={e => setContent(e.target.value)} />
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input type="checkbox" checked={isTranslated} onChange={e => setIsTranslated(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                    <span className="text-sm font-medium text-slate-700">Đây là bản dịch có sẵn (Không cần dịch lại)</span>
                </label>
                <div className="flex justify-end gap-3 mt-4">
                    <button onClick={onClose} className="px-4 py-2 text-slate-500 font-bold">Hủy</button>
                    <button onClick={() => { if(content.trim()) { onConfirm(title, content, isTranslated); onClose(); setTitle(''); setContent(''); setIsTranslated(false); } }} className="px-6 py-2 bg-indigo-600 text-white rounded font-bold">Xác Nhận</button>
                </div>
            </div>
        </div>
    );
}
