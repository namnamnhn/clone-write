import React from 'react';
import { BookMarked, CircleHelp, FlaskConical, Layers3, Target } from 'lucide-react';
import type { StoryStudioProjectView } from '../../storyStudio/storyStudioTypes';

const statusStyles: Readonly<Record<StoryStudioProjectView['artifactStatus'], string>> = {
    canon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    planned: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
    draft: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
    validated: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
    'approved-not-canon': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
    rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
};

export const StoryStudioHeader: React.FC<{ project: StoryStudioProjectView; onExitDemo: () => void }> = ({ project, onExitDemo }) => (
    <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-5 py-5 text-white sm:px-7 sm:py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-indigo-100">
                        <span>Story Engine V4</span>
                        {project.isDemo && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 normal-case tracking-normal">
                                <FlaskConical className="h-3.5 w-3.5" /> Dữ liệu minh họa
                            </span>
                        )}
                    </div>
                    <h1 className="truncate text-2xl font-black tracking-tight sm:text-3xl">{project.title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-indigo-100">
                        Không gian quan sát Canon, kế hoạch, bản nháp và kiểm định — không tự động thay đổi trạng thái truyện.
                    </p>
                </div>
                {project.isDemo && (
                    <button
                        type="button"
                        onClick={onExitDemo}
                        className="shrink-0 rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                        Thoát minh họa
                    </button>
                )}
            </div>
        </div>
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4 dark:bg-slate-800">
            <HeaderMetric icon={BookMarked} label="Canon hiện tại" value={project.canonChapter === undefined ? 'Chưa có' : `Chương ${project.canonChapter}`} help="Canon là phần truyện đã được xác nhận." />
            <HeaderMetric icon={Target} label="Chương mục tiêu" value={project.targetChapter === undefined ? 'Chưa có' : `Chương ${project.targetChapter}`} help="Chương đang được lập kế hoạch hoặc viết." />
            <HeaderMetric icon={Layers3} label="Mạch hiện tại" value={project.currentArc?.title ?? 'Chưa có'} secondary={project.currentBeat?.label} />
            <div className="bg-white px-5 py-4 dark:bg-slate-900">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Trạng thái workflow
                    <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black ${statusStyles[project.artifactStatus]}`}>
                    {project.artifactStatusLabel}
                </span>
            </div>
        </div>
    </header>
);

const HeaderMetric: React.FC<{
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    secondary?: string;
    help?: string;
}> = ({ icon: Icon, label, value, secondary, help }) => (
    <div className="bg-white px-5 py-4 dark:bg-slate-900" title={help}>
        <div className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Icon className="h-4 w-4 text-indigo-500" /> {label}
        </div>
        <div className="truncate text-sm font-black text-slate-800 dark:text-slate-100">{value}</div>
        {secondary && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{secondary}</div>}
    </div>
);
