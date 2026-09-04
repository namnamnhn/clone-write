import React, { useMemo, useState } from 'react';
import { Clipboard, Download, Library } from 'lucide-react';
import type { StoryStudioRuntimeProject } from '../../storyStudio/production/storyStudioProjectTypes';
import { getCanonicalChapterHistoryEntry } from '../../storyStudio/production/storyStudioSession';

const downloadText = (filename: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
};

export const CanonicalChapterHistoryPanel: React.FC<{ project: StoryStudioRuntimeProject }> = ({ project }) => {
    const [selectedChapter, setSelectedChapter] = useState(Math.max(1, project.state.currentChapter));
    const safeSelectedChapter = project.state.currentChapter > 0 ? Math.min(selectedChapter, project.state.currentChapter) : 1;
    const entry = useMemo(() => getCanonicalChapterHistoryEntry(project, safeSelectedChapter), [project, safeSelectedChapter]);
    return (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 p-5 dark:border-slate-800 sm:p-6">
                <h2 className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-white"><Library className="h-5 w-5 text-emerald-500" /> Lịch sử chương Canon</h2>
                <p className="mt-1 text-sm text-slate-500">Văn bản lấy trực tiếp từ bộ nhớ Canon đã lưu, không lấy từ bản nháp.</p>
            </div>
            {project.state.currentChapter === 0 ? <div className="p-8 text-center text-sm text-slate-400">Chương chỉ xuất hiện ở đây sau Make Canon và lưu thành công.</div> : (
                <div className="grid min-h-80 md:grid-cols-[13rem_minmax(0,1fr)]">
                    <div className="max-h-[32rem] overflow-y-auto border-b border-slate-200 p-3 dark:border-slate-800 md:border-b-0 md:border-r">
                        {project.chapterMetadata.map(metadata => <button key={metadata.chapterNumber} type="button" onClick={() => setSelectedChapter(metadata.chapterNumber)} className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left text-xs transition ${safeSelectedChapter === metadata.chapterNumber ? 'bg-emerald-100 font-black text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}><span className="block">Chương {metadata.chapterNumber}</span>{metadata.title && <span className="mt-0.5 block truncate font-normal opacity-75">{metadata.title}</span>}</button>)}
                    </div>
                    <div className="min-w-0">
                        {entry && <>
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
                                <div><div className="text-xs font-black uppercase tracking-wide text-emerald-500">Canon C{entry.chapterNumber}</div><h3 className="mt-1 font-black text-slate-900 dark:text-white">{entry.title ?? `Chương ${entry.chapterNumber}`}</h3></div>
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => void navigator.clipboard.writeText(entry.text)} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:text-emerald-600 dark:border-slate-700" title="Sao chép"><Clipboard className="h-4 w-4" /></button>
                                    <button type="button" onClick={() => downloadText(`Chapter_${String(entry.chapterNumber).padStart(3, '0')}.txt`, entry.text)} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:text-emerald-600 dark:border-slate-700" title="Tải TXT"><Download className="h-4 w-4" /></button>
                                </div>
                            </div>
                            <article className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap p-5 font-serif text-[15px] leading-8 text-slate-700 dark:text-slate-300">{entry.text}</article>
                        </>}
                    </div>
                </div>
            )}
        </section>
    );
};
