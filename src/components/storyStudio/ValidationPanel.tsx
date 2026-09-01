import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Search, ShieldAlert } from 'lucide-react';
import type { StoryStudioIssueSeverity, StoryStudioValidationView } from '../../storyStudio/storyStudioTypes';

const severityStyles: Readonly<Record<StoryStudioIssueSeverity, string>> = {
    critical: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
    error: 'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
};

export const ValidationPanel: React.FC<{ validation: StoryStudioValidationView; compact?: boolean }> = ({ validation, compact = false }) => {
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase('vi-VN');
        if (!normalized) return validation.issues.items;
        return validation.issues.items.filter(item => `${item.code} ${item.message} ${item.domain} ${item.path}`.toLocaleLowerCase('vi-VN').includes(normalized));
    }, [query, validation.issues.items]);
    return (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="validation-title">
            <div className="border-b border-slate-200 p-5 dark:border-slate-800">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 id="validation-title" className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-white"><ShieldAlert className="h-5 w-5 text-violet-500" /> Kiểm định</h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Inspector riêng cho dữ liệu Validator-safe.</p>
                    </div>
                    <ValidationStatus status={validation.status} />
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2">
                    <Count label="Tổng" value={validation.issues.totalCount} />
                    <Count label="Critical" value={validation.counts.critical} tone="text-rose-600 dark:text-rose-300" />
                    <Count label="Error" value={validation.counts.error} tone="text-orange-600 dark:text-orange-300" />
                    <Count label="Warning" value={validation.counts.warning} tone="text-amber-600 dark:text-amber-300" />
                </div>
            </div>
            <div className="p-5">
                {validation.status === 'not-run' ? (
                    <div className="py-8 text-center"><ShieldAlert className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-500">Chưa kiểm định</p></div>
                ) : (
                    <>
                        <label className="relative mb-4 block">
                            <span className="sr-only">Tìm vấn đề kiểm định</span>
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm mã lỗi, miền, vị trí…" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950/60 dark:focus:ring-violet-950" />
                        </label>
                        <div className={`space-y-2 overflow-y-auto pr-1 ${compact ? 'max-h-80' : 'max-h-[34rem]'}`}>
                            {filtered.map(issue => (
                                <article key={issue.id} className="rounded-2xl border border-slate-200 p-3.5 dark:border-slate-800">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${severityStyles[issue.severity]}`}>{issue.severity}</span>
                                        <code className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{issue.code}</code>
                                    </div>
                                    <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{issue.message}</p>
                                    <div className="mt-2 flex flex-wrap gap-x-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400"><span>{issue.domain}</span><span>{issue.path}</span></div>
                                </article>
                            ))}
                            {filtered.length === 0 && <div className="py-8 text-center text-sm text-slate-400">Không tìm thấy vấn đề phù hợp.</div>}
                        </div>
                        {validation.issues.truncated && <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Hiển thị {validation.issues.displayedCount} / {validation.issues.totalCount} lỗi. Các lỗi chặn quan trọng được ưu tiên.</div>}
                    </>
                )}
            </div>
        </section>
    );
};

const ValidationStatus: React.FC<{ status: StoryStudioValidationView['status'] }> = ({ status }) => {
    if (status === 'passed') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Đạt</span>;
    if (status === 'blocked') return <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black uppercase text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><AlertTriangle className="h-3.5 w-3.5" /> Bị chặn</span>;
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">Chưa chạy</span>;
};

const Count: React.FC<{ label: string; value: number; tone?: string }> = ({ label, value, tone = 'text-slate-800 dark:text-slate-100' }) => <div className="rounded-xl bg-slate-50 p-2 text-center dark:bg-slate-950/60"><div className={`text-lg font-black ${tone}`}>{value}</div><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</div></div>;
