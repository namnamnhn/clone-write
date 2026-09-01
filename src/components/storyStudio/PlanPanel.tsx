import React, { useState } from 'react';
import { BriefcaseBusiness, ChevronRight, Eye, HeartHandshake, MapPin, Shield, Swords, Users } from 'lucide-react';
import type { StoryStudioInternalPlanView, StoryStudioWriterPlanView } from '../../storyStudio/storyStudioTypes';

export const PlanPanel: React.FC<{ writerPlan?: StoryStudioWriterPlanView; internalPlan?: StoryStudioInternalPlanView }> = ({ writerPlan, internalPlan }) => {
    const [view, setView] = useState<'writer' | 'internal'>('writer');
    if (!writerPlan && !internalPlan) {
        return <PanelEmpty title="Kế hoạch chương" text="Chưa có kế hoạch Writer-safe cho chương mục tiêu." />;
    }
    const showInternal = view === 'internal' && internalPlan;
    return (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="plan-panel-title">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                <div>
                    <h2 id="plan-panel-title" className="text-lg font-black text-slate-900 dark:text-white">Kế hoạch chương</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Mặc định là đúng phần Writer thực sự nhận được.</p>
                </div>
                {writerPlan && internalPlan && (
                    <div className="inline-flex self-start rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="tablist" aria-label="Loại kế hoạch">
                        <button type="button" role="tab" aria-selected={view === 'writer'} onClick={() => setView('writer')} className={`rounded-lg px-3 py-2 text-xs font-bold ${view === 'writer' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-300' : 'text-slate-500'}`}>Writer-safe</button>
                        <button type="button" role="tab" aria-selected={view === 'internal'} onClick={() => setView('internal')} className={`rounded-lg px-3 py-2 text-xs font-bold ${view === 'internal' ? 'bg-white text-violet-600 shadow-sm dark:bg-slate-700 dark:text-violet-300' : 'text-slate-500'}`}>Nội bộ Planner</button>
                    </div>
                )}
            </div>
            <div className="p-5 sm:p-6">
                {showInternal ? <InternalPlan plan={internalPlan} /> : writerPlan ? <WriterPlan plan={writerPlan} /> : internalPlan ? <InternalPlan plan={internalPlan} /> : null}
            </div>
        </section>
    );
};

const WriterPlan: React.FC<{ plan: StoryStudioWriterPlanView }> = ({ plan }) => (
    <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
            <Metric icon={Eye} label="POV" value={plan.povName} />
            <Metric icon={Users} label="Tham gia" value={plan.participantNames.join(', ') || 'Chưa có'} />
            <Metric icon={Shield} label="Ràng buộc" value={`${plan.constraints.length} mục`} />
        </div>
        <div className="rounded-2xl bg-indigo-50 p-4 dark:bg-indigo-950/25">
            <div className="text-xs font-black uppercase tracking-wider text-indigo-500">Mục tiêu chính</div>
            <p className="mt-1.5 text-sm font-semibold leading-relaxed text-indigo-900 dark:text-indigo-100">{plan.primaryGoal}</p>
        </div>
        <div>
            <h3 className="mb-3 text-sm font-black text-slate-800 dark:text-slate-100">Danh sách cảnh</h3>
            <div className="space-y-3">
                {plan.scenes.items.map(scene => (
                    <article key={scene.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                        <div className="flex items-start gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white dark:bg-white dark:text-slate-900">{scene.order}</span>
                            <div className="min-w-0 flex-1">
                                <div className="font-bold text-slate-800 dark:text-slate-100">{scene.goal}</div>
                                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                    <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {scene.location}</span>
                                    <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {scene.povName}</span>
                                </div>
                                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                                    <p className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><b>Xung đột:</b> {scene.conflict}</p>
                                    <p className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><b>Hệ quả:</b> {scene.expectedConsequence}</p>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-1.5">{scene.purposeTags.map(tag => <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{tag}</span>)}</div>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
            {plan.scenes.truncated && <Truncated shown={plan.scenes.displayedCount} total={plan.scenes.totalCount} />}
        </div>
        {(plan.strategicDirectives.length > 0 || plan.relationshipDirectives.length > 0) && (
            <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100"><Swords className="h-4 w-4 text-indigo-500" /> Chỉ thị chiến lược</div>
                    <div className="space-y-2">{plan.strategicDirectives.map(item => <div key={item.id} className="flex gap-2 text-xs text-slate-600 dark:text-slate-300"><ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" /><span><b className="uppercase">{item.domain}</b> · {item.objective}</span></div>)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100"><HeartHandshake className="h-4 w-4 text-pink-500" /> Chỉ thị quan hệ</div>
                    <div className="space-y-2">{plan.relationshipDirectives.map(item => <div key={item.id} className="flex gap-2 text-xs text-slate-600 dark:text-slate-300"><ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pink-500" /><span>{item.participants.join(' & ')} · <b>{item.milestone}</b> · {item.objective}</span></div>)}</div>
                </div>
            </div>
        )}
    </div>
);

const InternalPlan: React.FC<{ plan: StoryStudioInternalPlanView }> = ({ plan }) => (
    <div className="space-y-5">
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900/60 dark:bg-violet-950/25">
            <div className="text-xs font-black uppercase tracking-wider text-violet-600 dark:text-violet-300">Nội bộ Planner · Không phải hợp đồng Writer</div>
            <p className="mt-2 text-sm font-semibold text-violet-900 dark:text-violet-100">{plan.primaryGoal}</p>
        </div>
        <div className="space-y-2">
            {plan.scenes.items.map(scene => (
                <div key={scene.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <div className="flex items-center gap-2 text-sm font-bold"><span className="text-violet-500">{scene.order}.</span> {scene.goal}</div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Hệ quả dự kiến: {scene.expectedConsequence}</p>
                </div>
            ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
            <InternalList label="Constraint IDs" values={plan.activeConstraintIds} />
            <InternalList label="Reveal dự kiến" values={plan.plannedRevealIds} />
            <InternalList label="Hành động nội bộ" values={[...plan.strategicActions.map(item => `${item.domain}: ${item.id}`), ...plan.relationshipActions.map(item => `relationship: ${item.id}`)]} />
        </div>
    </div>
);

const Metric: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string }> = ({ icon: Icon, label, value }) => (
    <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800"><div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400"><Icon className="h-3.5 w-3.5" /> {label}</div><div className="mt-1.5 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{value}</div></div>
);

const InternalList: React.FC<{ label: string; values: readonly string[] }> = ({ label, values }) => (
    <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950/60"><div className="text-[10px] font-black uppercase text-slate-400">{label}</div><div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">{values.length ? values.map(value => <div key={value}>{value}</div>) : <span className="text-slate-400">Không có</span>}</div></div>
);

const Truncated: React.FC<{ shown: number; total: number }> = ({ shown, total }) => <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Hiển thị {shown} / {total} mục.</div>;

const PanelEmpty: React.FC<{ title: string; text: string }> = ({ title, text }) => <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900"><BriefcaseBusiness className="mx-auto h-8 w-8 text-slate-300" /><h2 className="mt-3 font-black text-slate-700 dark:text-slate-200">{title}</h2><p className="mt-1 text-sm text-slate-500">{text}</p></section>;
