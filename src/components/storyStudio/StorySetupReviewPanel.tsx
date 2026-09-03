import React from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { PreparedStorySetupImport } from '../../storyStudio/production/storySetupImport';

export const StorySetupReviewPanel: React.FC<{
    prepared: PreparedStorySetupImport;
    displayName: string;
    disabled: boolean;
    onDisplayNameChange: (value: string) => void;
    onCreate: () => void;
    onCancel: () => void;
}> = ({ prepared, displayName, disabled, onDisplayNameChange, onCreate, onCancel }) => {
    const review = prepared.review;
    return (
        <section className="rounded-3xl border border-indigo-200 bg-white p-5 shadow-sm sm:p-7 dark:border-indigo-900 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">Review setup V4</div>
                    <h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white">Kiểm tra trước khi tạo dự án</h2>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        {prepared.mode === 'json' ? 'JSON đã qua parser V4 nghiêm ngặt, không gọi Gemini.' : 'TXT/MD đã được Gemini đề xuất cấu trúc, sau đó qua parser và kiểm tra độ phủ.'}
                    </p>
                </div>
                <button type="button" onClick={onCancel} disabled={disabled} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Hủy review"><X className="h-5 w-5" /></button>
            </div>
            <label className="mt-5 block text-sm font-bold text-slate-700 dark:text-slate-200">
                Tên hiển thị dự án
                <input value={displayName} onChange={event => onDisplayNameChange(event.target.value)} disabled={disabled} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Metric label="Chương dự kiến" value={review.plannedChapterCount} />
                <Metric label="Nhân vật" value={review.characterCount} />
                <Metric label="Nhân vật khóa" value={review.futureCharacterCount} />
                <Metric label="Arc" value={review.arcs.length} />
                <Metric label="Reveal" value={review.revealCount} />
                <Metric label="Gate" value={review.gateCount} />
                <Metric label="Quan hệ" value={review.relationshipDefinitionCount} />
                <Metric label="Author Secret" value={review.authorSecretCount} />
                <Metric label="Luật Canon" value={review.canonRuleCount} />
                <Metric label="Mốc spoiler nhận diện" value={review.recognizedSpoilerMarkerCount} />
            </div>
            {review.arcs.length > 0 && (
                <div className="mt-5 rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/60">
                    <div className="text-xs font-black uppercase tracking-wide text-slate-400">Dải Arc</div>
                    <div className="mt-2 flex flex-wrap gap-2">{review.arcs.map(arc => <span key={arc.id} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">{arc.title}: {arc.startChapter}–{arc.endChapter}</span>)}</div>
                </div>
            )}
            {review.criticalIssues.length > 0 && (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                    <div className="flex items-center gap-2 font-black"><AlertTriangle className="h-4 w-4" /> Không thể tạo dự án</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{review.criticalIssues.map(issue => <li key={`${issue.code}:${issue.detail}`}>{issue.detail}</li>)}</ul>
                </div>
            )}
            {review.warnings.length > 0 && <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{review.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" onClick={onCancel} disabled={disabled} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">Hủy</button>
                <button type="button" onClick={onCreate} disabled={disabled || !displayName.trim() || review.criticalIssues.length > 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 className="h-4 w-4" /> Tạo dự án V4</button>
            </div>
            <p className="mt-4 text-center text-[11px] text-slate-400">Giá trị Author Secret không được hiển thị trong review này.</p>
        </section>
    );
};

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => <div className="rounded-2xl bg-slate-50 p-3 text-center dark:bg-slate-950/60"><div className="text-xl font-black text-slate-900 dark:text-white">{value}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div></div>;
