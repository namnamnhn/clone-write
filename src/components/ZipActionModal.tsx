
import React from 'react';
import { FileArchive, BookOpen, Split, Files, X } from 'lucide-react';

interface ZipActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onKeepSeparate: () => void;
    onMergeAndSplit: () => void;
    // 'epub': import đến từ file EPUB (tách theo Mục lục/TOC gốc) -> đổi chữ cho đúng ngữ cảnh.
    // 'zip' (mặc định): import đến từ file ZIP nhiều file con, giữ chữ như cũ.
    sourceType?: 'zip' | 'epub';
}

export const ZipActionModal: React.FC<ZipActionModalProps> = ({ isOpen, onClose, onKeepSeparate, onMergeAndSplit, sourceType = 'zip' }) => {
    if (!isOpen) return null;
    const isEpub = sourceType === 'epub';

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 p-6">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
                            {isEpub ? <BookOpen className="w-6 h-6" /> : <FileArchive className="w-6 h-6" />}
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-slate-800">Tùy Chọn Nhập File</h3>
                            <p className="text-xs text-slate-500">
                                {isEpub ? 'File EPUB có nhiều chương theo Mục lục (TOC).' : 'Phát hiện nhiều chương & nội dung lớn.'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="space-y-3">
                    <button 
                        onClick={onKeepSeparate}
                        className="w-full p-4 bg-white border-2 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-2xl flex items-center gap-4 transition-all group text-left"
                    >
                        <div className="p-3 bg-slate-100 group-hover:bg-white rounded-xl text-slate-500 group-hover:text-emerald-600 transition-colors shadow-sm">
                            <Files className="w-6 h-6" />
                        </div>
                        <div>
                            <h4 className="font-bold text-slate-700 group-hover:text-emerald-700 text-sm">
                                {isEpub ? 'Tách Theo Mục Lục (TOC)' : 'Giữ Nguyên (Keep Separate)'}
                            </h4>
                            <p className="text-xs text-slate-500 mt-1">
                                {isEpub
                                    ? 'Giữ đúng số chương & tên chương theo Mục lục gốc của EPUB (khuyên dùng).'
                                    : 'Nhập từng chương như trong file gốc (mục lục EPUB / từng file ZIP). (Đúng cấu trúc nguồn)'}
                            </p>
                        </div>
                    </button>

                    <button 
                        onClick={onMergeAndSplit}
                        className="w-full p-4 bg-white border-2 border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 rounded-2xl flex items-center gap-4 transition-all group text-left"
                    >
                        <div className="p-3 bg-slate-100 group-hover:bg-white rounded-xl text-slate-500 group-hover:text-indigo-600 transition-colors shadow-sm">
                            <Split className="w-6 h-6" />
                        </div>
                        <div>
                            <h4 className="font-bold text-slate-700 group-hover:text-indigo-700 text-sm">Gộp & Tách Lại Bằng Regex</h4>
                            <p className="text-xs text-slate-500 mt-1">
                                {isEpub
                                    ? 'Bỏ qua Mục lục gốc, gộp toàn bộ nội dung EPUB rồi dùng Regex chia lại chương (dùng khi Mục lục lỗi/thiếu/không khớp thực tế).'
                                    : 'Gộp tất cả lại thành 1 file lớn rồi dùng bộ tách Regex chia nhỏ lại.'}
                            </p>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
};
