import React from 'react';
import { AlertCircle, Check, CircleDashed, Clock3, LockKeyhole, X } from 'lucide-react';
import type { StoryStudioWorkflowStageView } from '../../storyStudio/storyStudioTypes';

const statusUi: Readonly<Record<StoryStudioWorkflowStageView['status'], { label: string; icon: React.ComponentType<{ className?: string }>; classes: string }>> = {
    complete: { label: 'Hoàn tất', icon: Check, classes: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300' },
    ready: { label: 'Sẵn sàng', icon: Clock3, classes: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300' },
    waiting: { label: 'Đang chờ', icon: CircleDashed, classes: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300' },
    failed: { label: 'Không đạt', icon: X, classes: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300' },
    blocked: { label: 'Bị chặn', icon: AlertCircle, classes: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300' },
    unavailable: { label: 'Chưa khả dụng', icon: LockKeyhole, classes: 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400' },
};

export const ChapterWorkflowPanel: React.FC<{ stages: readonly StoryStudioWorkflowStageView[] }> = ({ stages }) => (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="workflow-title">
        <div className="mb-5">
            <h2 id="workflow-title" className="text-lg font-black text-slate-900 dark:text-white">Workflow chương</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Mỗi bước phản ánh hiện vật thật đang có; không có nút chạy giả.</p>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stages.map((item, index) => {
                const ui = statusUi[item.status];
                const Icon = ui.icon;
                return (
                    <li key={item.id} className={`relative rounded-2xl border p-4 ${ui.classes}`} title={item.help}>
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-xs font-black shadow-sm dark:bg-slate-900/70">{index + 1}</span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide"><Icon className="h-3.5 w-3.5" /> {ui.label}</span>
                        </div>
                        <div className="text-sm font-black">{item.label}</div>
                        <div className="mt-1 text-xs leading-relaxed opacity-80">{item.detail}</div>
                    </li>
                );
            })}
        </ol>
        <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-950/50">
            <div>
                <div className="text-sm font-bold text-slate-700 dark:text-slate-200">Make Canon</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Chưa khả dụng — State Extractor / Make Canon chưa được triển khai.</div>
            </div>
            <button type="button" disabled title="State Extractor / Make Canon chưa được triển khai" className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                Make Canon
            </button>
        </div>
    </section>
);
