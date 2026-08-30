import React from 'react';
import { X } from 'lucide-react';
import { Toast } from '../../types';

export interface ToastContainerProps { toasts: Toast[]; removeToast: (id: string) => void; }
export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, removeToast }) => {
    return (
        <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
            {toasts.map(toast => (
                <div key={toast.id} className={`pointer-events-auto min-w-[300px] max-w-sm p-4 rounded-xl shadow-lg border flex items-start gap-3 animate-in slide-in-from-right duration-300 ${toast.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-800' : toast.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : toast.type === 'warning' ? 'bg-amber-50 border-amber-100 text-amber-800' : 'bg-white border-slate-100 text-slate-800'}`}>
                    <div className="flex-1 text-sm font-medium">{toast.message}</div>
                    <button onClick={() => removeToast(toast.id)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                </div>
            ))}
        </div>
    );
};
