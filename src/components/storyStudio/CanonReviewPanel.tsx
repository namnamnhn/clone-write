import React from 'react';
import { BookCheck, ShieldAlert } from 'lucide-react';
import type { CanonCommitProposal } from '../../storyEngine';

const CATEGORY_LABELS: ReadonlyArray<[keyof Omit<CanonCommitProposal['review'], 'kind' | 'totalChanges'>, string]> = [
    ['facts', 'Sự kiện / sự thật'],
    ['epistemic', 'Tri thức / nhận biết'],
    ['locations', 'Vị trí'],
    ['statuses', 'Trạng thái'],
    ['activations', 'Kích hoạt nhân vật'],
    ['relationships', 'Quan hệ'],
    ['resources', 'Tài nguyên'],
    ['continuity', 'Liên tục truyện'],
    ['reveals', 'Reveal'],
    ['foreshadow', 'Foreshadow'],
    ['payoffs', 'Payoff'],
];

const flatten = (value: unknown, prefix = ''): readonly { readonly label: string; readonly value: string }[] => {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [{ label: prefix || 'Giá trị', value: String(value) }];
    }
    if (Array.isArray(value)) return value.flatMap((entry, index) => flatten(entry, `${prefix || 'Mục'} ${index + 1}`));
    if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
        .flatMap(([key, entry]) => flatten(entry, prefix ? `${prefix} · ${key}` : key));
    return [];
};

export const CanonReviewPanel: React.FC<{
    proposal: CanonCommitProposal;
    disabled: boolean;
    onMakeCanon: () => void;
    onReplan: () => void;
}> = ({ proposal, disabled, onMakeCanon, onReplan }) => (
    <section className="overflow-hidden rounded-3xl border-2 border-indigo-300 bg-white shadow-sm dark:border-indigo-800 dark:bg-slate-900">
        <div className="bg-indigo-50 p-5 dark:bg-indigo-950/30 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300"><ShieldAlert className="h-4 w-4" /> Review Canon</div>
                    <h2 className="mt-2 text-xl font-black text-slate-900 dark:text-white">Đã duyệt — CHƯA vào Canon</h2>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Chương {proposal.targetChapter} có {proposal.review.totalChanges} thay đổi đề xuất. Hãy xem toàn bộ trước khi xác nhận.</p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                    <button type="button" onClick={onMakeCanon} disabled={disabled} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40"><BookCheck className="h-4 w-4" /> Make Canon</button>
                    <button type="button" onClick={onReplan} disabled={disabled} className="text-xs font-bold text-slate-500 hover:text-indigo-600">Bỏ bản này và lập kế hoạch lại</button>
                </div>
            </div>
        </div>
        <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-2">
            {CATEGORY_LABELS.map(([key, label]) => {
                const entries = proposal.review[key];
                return (
                    <div key={key} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-black text-slate-800 dark:text-slate-100">{label}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500 dark:bg-slate-800">{entries.length}</span></div>
                        {entries.length === 0 ? <p className="mt-3 text-xs text-slate-400">Không có thay đổi.</p> : (
                            <ol className="mt-3 space-y-3">{entries.map((entry, index) => (
                                <li key={`${key}-${index}`} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60">
                                    <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-indigo-500">Thay đổi {index + 1}</div>
                                    <dl className="space-y-1.5">{flatten(entry).map((field, fieldIndex) => <div key={`${field.label}-${fieldIndex}`} className="grid grid-cols-[minmax(7rem,0.45fr)_1fr] gap-2 text-xs"><dt className="break-words font-bold text-slate-400">{field.label}</dt><dd className="break-words text-slate-700 dark:text-slate-200">{field.value}</dd></div>)}</dl>
                                </li>
                            ))}</ol>
                        )}
                    </div>
                );
            })}
        </div>
    </section>
);
