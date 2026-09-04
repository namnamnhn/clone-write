import React from 'react';
import { FileText, LockKeyhole } from 'lucide-react';
import type { StoryStudioDraftView } from '../../storyStudio/storyStudioTypes';

const statusStyle: Readonly<Record<StoryStudioDraftView['status'], string>> = {
    draft: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    validated: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
    'approved-not-canon': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
    rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};

export const DraftPanel: React.FC<{ draft?: StoryStudioDraftView }> = ({ draft }) => {
    if (!draft) {
        return <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900"><FileText className="mx-auto h-8 w-8 text-slate-300" /><h2 className="mt-3 font-black text-slate-700 dark:text-slate-200">Không gian bản nháp</h2><p className="mt-1 text-sm text-slate-500">Chưa có WriterChapterDraft để hiển thị.</p></section>;
    }
    return (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="draft-title">
            <div className="border-b border-slate-200 p-5 dark:border-slate-800">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="text-xs font-black uppercase tracking-wider text-slate-400">Bản nháp chương {draft.chapterNumber}</div>
                        <h2 id="draft-title" className="mt-1 text-xl font-black text-slate-900 dark:text-white">{draft.title ?? 'Chưa có tiêu đề'}</h2>
                    </div>
                    <span className={`self-start rounded-full px-3 py-1.5 text-xs font-black ${statusStyle[draft.status]}`}>{draft.statusLabel}</span>
                </div>
            </div>
            <article className="max-h-[34rem] overflow-y-auto p-5 font-serif text-[15px] leading-8 text-slate-700 sm:p-7 dark:text-slate-300">
                {draft.prose.split('\n').map((paragraph, index) => paragraph ? <p key={`paragraph-${index}`} className="mb-4">{paragraph}</p> : <div key={`space-${index}`} className="h-2" />)}
            </article>
            <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                <LockKeyhole className="h-4 w-4" /> Chỉ đọc · Bản nháp chỉ vào Canon sau Review và xác nhận Make Canon.
            </div>
        </section>
    );
};
