import React from 'react';
import { AlertTriangle, FlaskConical, Gauge, ShieldCheck, Workflow } from 'lucide-react';
import { useStoryStudio } from '../../hooks/pages/useStoryStudio';
import { ChapterWorkflowPanel } from './ChapterWorkflowPanel';
import { DraftPanel } from './DraftPanel';
import { PlanPanel } from './PlanPanel';
import { StoryIntelligencePanel } from './StoryIntelligencePanel';
import { StoryStudioHeader } from './StoryStudioHeader';
import { StoryStudioOverview } from './StoryStudioOverview';
import { ValidationPanel } from './ValidationPanel';

interface StoryStudioErrorBoundaryState { readonly failed: boolean; }

class StoryStudioErrorBoundary extends React.Component<React.PropsWithChildren, StoryStudioErrorBoundaryState> {
    state: StoryStudioErrorBoundaryState = { failed: false };

    static getDerivedStateFromError(): StoryStudioErrorBoundaryState {
        return { failed: true };
    }

    render() {
        if (this.state.failed) {
            return (
                <div className="flex h-full items-center justify-center p-6">
                    <div className="max-w-lg rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm dark:border-rose-900/60 dark:bg-slate-900">
                        <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
                        <h1 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Không thể hiển thị phiên Story Studio</h1>
                        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">Phiên hiện tại không hợp lệ. Canon và dữ liệu Sáng Tác cũ không bị thay đổi.</p>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

const StoryStudioContent: React.FC = () => {
    const { showDemo, setShowDemo, viewModel } = useStoryStudio();
    if (!showDemo) {
        return (
            <div className="flex h-full overflow-y-auto custom-scrollbar">
                <div className="m-auto w-full max-w-4xl p-5 sm:p-8">
                    <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-10 text-center text-white sm:px-10 sm:py-14">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 shadow-inner"><Workflow className="h-8 w-8" /></div>
                            <div className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-indigo-100">Story Engine V4</div>
                            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Writing Studio</h1>
                            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-indigo-100 sm:text-base">Story Engine V4 chưa được nối vào dự án Sáng Tác hiện tại. Studio cung cấp giao diện quan sát an toàn; pipeline production sẽ được kết nối ở bước tích hợp sau.</p>
                        </div>
                        <div className="p-6 sm:p-8">
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Promise icon={ShieldCheck} title="Không đổi Canon" text="Không có State Extractor hoặc Make Canon." />
                                <Promise icon={Gauge} title="Hiển thị có giới hạn" text="Không tải toàn bộ lịch sử truyện dài." />
                                <Promise icon={FlaskConical} title="Demo tách biệt" text="Không lưu, không gọi model, không dùng dữ liệu truyện thật." />
                            </div>
                            <button type="button" onClick={() => setShowDemo(true)} className="mx-auto mt-7 flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 dark:shadow-none">
                                <FlaskConical className="h-4 w-4" /> Xem dữ liệu minh họa
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto custom-scrollbar">
            <div className="mx-auto max-w-[1600px] space-y-6 p-4 pb-10 sm:p-6 lg:p-8">
                <StoryStudioHeader project={viewModel.project} onExitDemo={() => setShowDemo(false)} />
                {viewModel.consistency.status === 'error' && (
                    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/30">
                        <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" /><div><div className="font-black text-rose-800 dark:text-rose-200">Phiên Story Studio không nhất quán</div><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-rose-700 dark:text-rose-300">{viewModel.consistency.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div></div>
                    </div>
                )}
                <StoryStudioOverview overview={viewModel.overview} />
                <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.85fr)]">
                    <ChapterWorkflowPanel stages={viewModel.workflow.stages} />
                    <ValidationPanel validation={viewModel.validation} compact />
                </div>
                <div className="grid items-start gap-6 xl:grid-cols-2">
                    <PlanPanel writerPlan={viewModel.workflow.writerPlan} internalPlan={viewModel.workflow.internalPlan} />
                    <DraftPanel draft={viewModel.workflow.draft} />
                </div>
                <StoryIntelligencePanel intelligence={viewModel.intelligence} writerPlan={viewModel.workflow.writerPlan} />
            </div>
        </div>
    );
};

const Promise: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; text: string }> = ({ icon: Icon, title, text }) => (
    <div className="rounded-2xl bg-slate-50 p-4 text-center dark:bg-slate-950/60"><Icon className="mx-auto h-5 w-5 text-indigo-500" /><div className="mt-2 text-sm font-black text-slate-800 dark:text-slate-100">{title}</div><p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{text}</p></div>
);

export const StoryStudioPage: React.FC = () => (
    <StoryStudioErrorBoundary>
        <StoryStudioContent />
    </StoryStudioErrorBoundary>
);
