import React, { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';

export interface LoadingModalProps {
    isOpen: boolean;
    progress: { current: number; total: number; message: string };
    /** Khi được cung cấp, hiển thị nút "Hủy" để người dùng tự dừng tác vụ. */
    onCancel?: () => void;
    /** Khi được cung cấp, hiển thị nút thu nhỏ để ẩn modal (tác vụ vẫn chạy nền). */
    onMinimize?: () => void;
    /** Sau bao nhiêu ms không có tiến triển thì coi là "bị treo" và gợi ý người dùng hủy. Mặc định 20s. */
    stallWarningMs?: number;
}

export const LoadingModal: React.FC<LoadingModalProps> = ({ isOpen, progress, onCancel, onMinimize, stallWarningMs = 20000 }) => {
    const signature = isOpen ? `${progress.current}/${progress.total}/${progress.message}` : '';
    const [stallState, setStallState] = useState({ signature, stalled: false });
    if (stallState.signature !== signature) {
        setStallState({ signature, stalled: false });
    }
    const isStalled = stallState.signature === signature && stallState.stalled;

    // Phát hiện tình trạng "treo": nếu current/message không thay đổi trong stallWarningMs,
    // hiển thị gợi ý cho người dùng biết có thể hủy thay vì chỉ chờ vô thời hạn.
    useEffect(() => {
        if (!isOpen) return;
        const timer = window.setTimeout(() => {
            setStallState(current => current.signature === signature ? { ...current, stalled: true } : current);
        }, stallWarningMs);
        return () => window.clearTimeout(timer);
    }, [isOpen, signature, stallWarningMs]);

    if (!isOpen) return null;
    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="relative bg-white rounded-3xl shadow-2xl p-8 flex flex-col items-center max-w-sm w-full animate-in zoom-in-95 duration-300">
                {onMinimize && (
                    <button
                        onClick={onMinimize}
                        title="Thu nhỏ (tác vụ vẫn chạy nền)"
                        className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}
                <div className="relative mb-6">
                    <div className="w-20 h-20 rounded-full border-4 border-indigo-100 border-t-indigo-500 animate-spin"></div>
                    <FileText className="absolute inset-0 m-auto w-8 h-8 text-indigo-500 animate-pulse" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Đang Xử Lý...</h3>
                <p className="text-sm text-slate-500 mb-6 text-center animate-pulse">{progress.message}</p>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300" style={{ width: `${percent}%` }}></div>
                </div>
                <div className="flex justify-between w-full text-xs font-bold text-slate-400 mb-2">
                    {progress.total === 100 ? (
                        <span>{Math.round(progress.current)}%</span> 
                    ) : (
                        <span>{progress.current} / {progress.total}</span> 
                    )}
                    <span>{percent}%</span>
                </div>
                {isStalled && (
                    <p className="text-xs text-amber-600 text-center mb-3 mt-1">
                        Tác vụ đang chạy lâu hơn dự kiến (có thể do mạng/API chậm).{onCancel ? ' Bạn có thể hủy nếu muốn.' : ''}
                    </p>
                )}
                {onCancel && (
                    <button
                        onClick={onCancel}
                        className="mt-1 w-full py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-red-600 hover:border-red-200 transition-colors"
                    >
                        Hủy tác vụ
                    </button>
                )}
            </div>
        </div>
    );
};
