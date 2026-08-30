import React from 'react';
import { DEFAULT_TRIAGE_DELAYS, TriageDelays } from './apiSettingsShared';

interface TriageSettingsTabProps {
    active: boolean;
    delays: TriageDelays;
    onChange: (v: Partial<TriageDelays>) => void;
}

export const TriageSettingsTab: React.FC<TriageSettingsTabProps> = ({ active, delays, onChange }) => (
    <div className={active ? 'p-6 overflow-y-auto no-scrollbar overscroll-contain flex-1 space-y-5' : 'hidden'}>
        <p className="text-xs text-slate-500 dark:text-slate-400">
            Khoảng nghỉ giữa các lô khi hậu kiểm khởi động (đối chiếu lại bản dịch cũ trước khi
            bắt đầu/tiếp tục dịch). Tăng lên nếu hay gặp lỗi 429/Rate Limit; giảm xuống nếu muốn
            hậu kiểm nhanh hơn và ít khi bị giới hạn tốc độ.
        </p>
        <div className="space-y-1">
            <label className="text-sm text-slate-600 dark:text-slate-300 flex justify-between">
                <span>Nghỉ giữa mỗi luồng hậu kiểm kế tiếp (ms)</span>
                <span className="font-mono text-xs text-slate-400">{delays.staggerDelayMs}</span>
            </label>
            <input
                type="number" min={0} max={20000} step={500}
                value={delays.staggerDelayMs}
                onChange={e => onChange({ staggerDelayMs: Math.max(0, Math.min(20000, Number(e.target.value) || 0)) })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
            />
        </div>
        <div className="space-y-1">
            <label className="text-sm text-slate-600 dark:text-slate-300 flex justify-between">
                <span>Nghỉ giữa các lô "hậu kiểm phục hồi" (ms)</span>
                <span className="font-mono text-xs text-slate-400">{delays.recoveryBatchDelayMs}</span>
            </label>
            <input
                type="number" min={0} max={20000} step={500}
                value={delays.recoveryBatchDelayMs}
                onChange={e => onChange({ recoveryBatchDelayMs: Math.max(0, Math.min(20000, Number(e.target.value) || 0)) })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
            />
        </div>
        <div className="space-y-1">
            <label className="text-sm text-slate-600 dark:text-slate-300 flex justify-between">
                <span>Nghỉ giữa các lô "chẩn đoán cuối" (ms)</span>
                <span className="font-mono text-xs text-slate-400">{delays.diagnosisBatchDelayMs}</span>
            </label>
            <input
                type="number" min={0} max={20000} step={500}
                value={delays.diagnosisBatchDelayMs}
                onChange={e => onChange({ diagnosisBatchDelayMs: Math.max(0, Math.min(20000, Number(e.target.value) || 0)) })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
            />
        </div>
        <button
            onClick={() => onChange(DEFAULT_TRIAGE_DELAYS)}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium"
        >
            Khôi phục mặc định
        </button>
    </div>
);
