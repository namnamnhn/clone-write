import React from 'react';
import { AlertTriangle, BookOpenCheck, Brain, GitBranch, ScrollText, ShieldCheck, Sparkles, Users } from 'lucide-react';
import type { StoryStudioOverviewView } from '../../storyStudio/storyStudioTypes';

const cards = [
    { key: 'activeCharacterCount', label: 'Nhân vật hoạt động', icon: Users, tone: 'text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-300' },
    { key: 'relationshipCount', label: 'Quan hệ hiện tại', icon: GitBranch, tone: 'text-pink-600 bg-pink-50 dark:bg-pink-950/30 dark:text-pink-300' },
    { key: 'factCount', label: 'Sự thật Canon', icon: Brain, tone: 'text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-300' },
    { key: 'activeConstraintCount', label: 'Ràng buộc đang áp dụng', icon: ShieldCheck, tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300' },
    { key: 'openForeshadowCount', label: 'Mạch gieo mở', icon: Sparkles, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300' },
    { key: 'outstandingPayoffCount', label: 'Payoff còn nghĩa vụ', icon: ScrollText, tone: 'text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-300' },
    { key: 'strategicActionCount', label: 'Hành động chiến lược', icon: BookOpenCheck, tone: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-300' },
    { key: 'validationIssueCount', label: 'Vấn đề kiểm định', icon: AlertTriangle, tone: 'text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300' },
] as const;

export const StoryStudioOverview: React.FC<{ overview: StoryStudioOverviewView }> = ({ overview }) => (
    <section aria-labelledby="studio-overview-title">
        <div className="mb-3 flex items-end justify-between gap-3">
            <div>
                <h2 id="studio-overview-title" className="text-lg font-black text-slate-900 dark:text-white">Tổng quan truyện</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Ảnh chụp gọn của trạng thái hiện tại, không phải toàn bộ lịch sử.</p>
            </div>
            <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500 sm:inline dark:bg-slate-800 dark:text-slate-400">
                Kế hoạch {overview.plannedChapterCount} chương
            </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {cards.map(({ key, label, icon: Icon, tone }) => (
                <div key={key} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon className="h-4.5 w-4.5" /></div>
                    <div className="text-xl font-black text-slate-900 dark:text-white">{overview[key]}</div>
                    <div className="mt-1 text-[11px] font-semibold leading-tight text-slate-500 dark:text-slate-400">{label}</div>
                </div>
            ))}
        </div>
    </section>
);
