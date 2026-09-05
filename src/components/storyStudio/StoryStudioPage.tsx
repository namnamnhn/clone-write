import React from 'react';
import { AlertTriangle, Download, FileJson, FileText, FlaskConical, Loader2, Settings, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import {
    getStoryStudioNoActiveProjectViewState,
    getStoryStudioPageView,
    useStoryStudio,
} from '../../hooks/pages/useStoryStudio';
import { CanonicalChapterHistoryPanel } from './CanonicalChapterHistoryPanel';
import { CanonReviewPanel } from './CanonReviewPanel';
import { ChapterWorkflowPanel } from './ChapterWorkflowPanel';
import { DraftPanel } from './DraftPanel';
import { PlanPanel } from './PlanPanel';
import { StoryIntelligencePanel } from './StoryIntelligencePanel';
import { StorySetupReviewPanel } from './StorySetupReviewPanel';
import { StorySetupWizard } from './StorySetupWizard';
import { StoryStudioActionBar } from './StoryStudioActionBar';
import { StoryStudioConfirmModal } from './StoryStudioConfirmModal';
import { StoryStudioHeader } from './StoryStudioHeader';
import { StoryStudioOverview } from './StoryStudioOverview';
import { StoryStudioProjectLibrary } from './StoryStudioProjectLibrary';
import { ValidationPanel } from './ValidationPanel';

export interface StoryStudioPageProps {
    readonly enabledModels: readonly string[];
    readonly addToast: (message: string, type: 'success' | 'error' | 'info') => void;
    readonly onOpenGeminiSettings: () => void;
}

interface StoryStudioErrorBoundaryState { readonly failed: boolean; }

class StoryStudioErrorBoundary extends React.Component<React.PropsWithChildren, StoryStudioErrorBoundaryState> {
    state: StoryStudioErrorBoundaryState = { failed: false };
    static getDerivedStateFromError(): StoryStudioErrorBoundaryState { return { failed: true }; }
    render() {
        if (this.state.failed) return <SafeFailure message="Không thể hiển thị phiên Story Studio. Canon và dữ liệu Sáng Tác cũ không bị thay đổi." />;
        return this.props.children;
    }
}

const StoryStudioContent: React.FC<StoryStudioPageProps> = (props) => {
    const studio = useStoryStudio(props);
    const disabled = Boolean(studio.operation) || studio.saveStatus === 'saving';
    const noActiveProjectView = getStoryStudioNoActiveProjectViewState(studio.projectLibrary);
    const pageView = getStoryStudioPageView({
        loadStatus: studio.loadStatus,
        hasValidProjectLibrary: studio.hasValidProjectLibrary,
        hasPreparedImport: studio.preparedImport !== undefined,
        preparedImportOrigin: studio.preparedImportOrigin,
        hasOpenWizard: studio.wizardOpen && studio.wizardDraft !== undefined,
        wizardOrigin: studio.wizardOrigin,
        hasProject: studio.project !== undefined,
        showDemo: studio.showDemo,
    });

    if (pageView === 'loading') return <div className="flex h-full items-center justify-center gap-3 text-sm font-bold text-slate-500"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /> Đang mở dự án Story Studio…</div>;

    if (pageView === 'wizard' && studio.wizardDraft) return (
        <div className="h-full overflow-y-auto p-4 sm:p-7">
            <StorySetupWizard
                draft={studio.wizardDraft}
                compiling={studio.operation === 'compiling-setup'}
                draftStatus={studio.wizardDraftSaveStatus}
                onChange={studio.updateWizardDraft}
                onCancel={studio.closeWizard}
                onDiscard={() => void studio.discardWizardDraft()}
                onCompile={() => void studio.compileWizardDraft()}
                onDownloadMarkdown={studio.downloadWizardMarkdown}
                onDownloadTemplate={studio.downloadBlankTemplate}
            />
        </div>
    );

    if (pageView === 'core-corrupt') return (
        <div className="flex h-full overflow-y-auto p-5">
            <div className="m-auto w-full max-w-3xl space-y-4">
                {studio.projectLibrary.length > 0 && <StoryStudioProjectLibrary entries={studio.projectLibrary} activeProjectId={studio.activeProjectId} disabled={disabled} onSwitch={projectId => void studio.switchProject(projectId)} onRenameActive={name => void studio.renameActiveProject(name)} onDeleteActive={() => studio.setDeleteConfirmationOpen(true)} onImport={file => void studio.importFile(file)} onNewStory={() => void studio.openWizard()} onDownloadTemplate={studio.downloadBlankTemplate} onExportActive={studio.exportActiveSetup} />}
                <div className="rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm dark:border-rose-900 dark:bg-slate-900">
                    <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
                    <h1 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Không thể mở dự án V4 đã lưu</h1>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">{studio.errorMessage}</p>
                    <p className="mt-3 text-xs text-slate-400">
                        {studio.recoveryTarget
                            ? 'Dữ liệu lỗi không bị tự động ghi đè. Chỉ xóa khi bạn xác nhận rõ bên dưới.'
                            : 'Không có định danh dự án đáng tin cậy để xóa an toàn. Story Studio giữ nguyên toàn bộ dữ liệu để có thể phục hồi bằng một cơ chế riêng.'}
                    </p>
                    {studio.recoveryTarget && <button type="button" onClick={() => studio.setDeleteConfirmationOpen(true)} className="mt-6 rounded-xl bg-rose-600 px-5 py-3 text-sm font-black text-white">
                        {studio.recoveryTarget.kind === 'legacy-single-project' ? 'Xóa bản lưu Story Studio cũ bị lỗi' : 'Xóa dự án Story Studio đang chọn bị lỗi'}
                    </button>}
                    {studio.recoveryTarget && <StoryStudioConfirmModal
                        open={studio.deleteConfirmationOpen}
                        title={studio.recoveryTarget.kind === 'legacy-single-project' ? 'Xóa bản lưu Story Studio cũ bị lỗi?' : 'Xóa dự án Story Studio đang chọn bị lỗi?'}
                        message={studio.recoveryTarget.kind === 'legacy-single-project'
                            ? 'Thao tác này chỉ xóa khóa lưu Story Studio một dự án đời cũ. Dữ liệu Sáng Tác, thư viện mới và database khác không bị xóa.'
                            : 'Thao tác này chỉ xóa dự án Story Studio đang chọn. Các dự án Story Studio khác, dữ liệu Sáng Tác cũ và database khác không bị xóa.'}
                        confirmLabel="Xác nhận xóa dữ liệu lỗi"
                        danger
                        onCancel={() => studio.setDeleteConfirmationOpen(false)}
                        onConfirm={() => void studio.deleteProject()}
                    />}
                </div>
            </div>
        </div>
    );

    if (pageView === 'setup-review' && studio.preparedImport) return (
        <div className="h-full overflow-y-auto p-4 sm:p-7">
            <div className="mx-auto max-w-5xl">
                <StorySetupReviewPanel prepared={studio.preparedImport} displayName={studio.importDisplayName} disabled={disabled} onDisplayNameChange={studio.setImportDisplayName} onCreate={() => void studio.finishCreate()} onCancel={studio.cancelImport} />
            </div>
        </div>
    );

    if (pageView === 'no-active') return (
        <StoryStudioEmptyState
            projectLibrary={noActiveProjectView.showProjectLibrary
                ? <StoryStudioProjectLibrary entries={studio.projectLibrary} activeProjectId={studio.activeProjectId} disabled={disabled} onSwitch={projectId => void studio.switchProject(projectId)} onRenameActive={name => void studio.renameActiveProject(name)} onDeleteActive={() => studio.setDeleteConfirmationOpen(true)} onImport={file => void studio.importFile(file)} onNewStory={() => void studio.openWizard()} onDownloadTemplate={studio.downloadBlankTemplate} onExportActive={studio.exportActiveSetup} />
                : undefined}
            compiling={studio.operation === 'compiling-setup'}
            errorMessage={studio.errorMessage}
            onImport={file => void studio.importFile(file)}
            onNewStory={() => void studio.openWizard()}
            onDownloadTemplate={studio.downloadBlankTemplate}
            onDemo={() => studio.setShowDemo(true)}
            onSettings={studio.onOpenGeminiSettings}
        />
    );

    const project = studio.project;
    const viewModel = studio.viewModel;
    const proposal = project?.workflow.stage === 'ready-for-canon-review' ? project.workflow.proposal : undefined;
    return (
        <div className="h-full overflow-y-auto custom-scrollbar">
            <div className="mx-auto max-w-[1600px] space-y-6 p-4 pb-10 sm:p-6 lg:p-8">
                {project && <StoryStudioProjectLibrary entries={studio.projectLibrary} activeProjectId={studio.activeProjectId} disabled={disabled} onSwitch={projectId => void studio.switchProject(projectId)} onRenameActive={name => void studio.renameActiveProject(name)} onDeleteActive={() => studio.setDeleteConfirmationOpen(true)} onImport={file => void studio.importFile(file)} onNewStory={() => void studio.openWizard()} onDownloadTemplate={studio.downloadBlankTemplate} onExportActive={studio.exportActiveSetup} />}
                {project && <StoryStudioActionBar project={project} batchSize={studio.batchSize} saveStatus={studio.saveStatus} operation={studio.operation} disabled={disabled} onBatchSize={studio.setBatchSize} onStart={() => void studio.startBatch()} onResume={() => void studio.resume()} onStop={studio.stop} onRewrite={() => void studio.rewriteFromSamePlan()} onReplan={() => void studio.replan()} onImport={file => void studio.importFile(file)} onOpenSettings={studio.onOpenGeminiSettings} onExportSetup={studio.exportActiveSetup} onDelete={() => studio.setDeleteConfirmationOpen(true)} />}
                <StoryStudioHeader project={viewModel.project} onExitDemo={() => studio.setShowDemo(false)} />
                <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${viewModel.project.isDemo ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>
                    {viewModel.project.isDemo ? 'Dữ liệu minh họa — không gọi model, không lưu, không đổi Canon.' : 'Dự án thật / đã lưu cục bộ. Dự án V4 được lưu cục bộ trên trình duyệt này.'}
                </div>
                {studio.recoveryWarning && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><strong>Canon an toàn.</strong> Phiên chương đang làm không còn hợp lệ và đã được bỏ. Bạn có thể làm lại chương {(project?.state.currentChapter ?? 0) + 1}.</div>}
                {studio.errorMessage && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div className="flex-1">{studio.errorMessage}</div><button type="button" onClick={() => studio.setErrorMessage(undefined)} className="font-black">×</button></div>}
                {viewModel.consistency.status === 'error' && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30"><div className="font-black text-rose-800 dark:text-rose-200">Phiên Story Studio không nhất quán</div><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-rose-700 dark:text-rose-300">{viewModel.consistency.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
                {proposal && <CanonReviewPanel proposal={proposal} disabled={disabled} onMakeCanon={() => studio.setMakeCanonConfirmationOpen(true)} onReplan={() => void studio.replan()} />}
                <StoryStudioOverview overview={viewModel.overview} />
                <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.85fr)]"><ChapterWorkflowPanel stages={viewModel.workflow.stages} /><ValidationPanel validation={viewModel.validation} compact /></div>
                <div className="grid items-start gap-6 xl:grid-cols-2"><PlanPanel writerPlan={viewModel.workflow.writerPlan} internalPlan={viewModel.workflow.internalPlan} /><DraftPanel draft={viewModel.workflow.draft} /></div>
                <StoryIntelligencePanel intelligence={viewModel.intelligence} writerPlan={viewModel.workflow.writerPlan} />
                {project && <CanonicalChapterHistoryPanel project={project} />}
            </div>
            <StoryStudioConfirmModal open={studio.makeCanonConfirmationOpen} title={`Make Canon chương ${proposal?.targetChapter ?? ''}?`} message={`Bạn đang xác nhận ${proposal?.review.totalChanges ?? 0} thay đổi. Canon sẽ tiến đúng một chương và chương này không còn được coi là bản nháp sau khi lưu thành công.`} confirmLabel="Xác nhận Make Canon" onCancel={() => studio.setMakeCanonConfirmationOpen(false)} onConfirm={() => void studio.confirmMakeCanon()} />
            <StoryStudioConfirmModal open={studio.deleteConfirmationOpen} title="Xóa dự án V4 khỏi máy?" message="Toàn bộ Canon, bộ nhớ và chương đã lưu của dự án V4 hiện tại sẽ bị xóa khỏi trình duyệt này. Các dự án Story Studio khác và dữ liệu Sáng Tác cũ không bị ảnh hưởng." confirmLabel="Xóa dự án V4" danger onCancel={() => studio.setDeleteConfirmationOpen(false)} onConfirm={() => void studio.deleteProject()} />
        </div>
    );
};

const StoryStudioEmptyState: React.FC<{
    projectLibrary?: React.ReactNode;
    compiling: boolean;
    errorMessage?: string;
    onImport: (file: File) => void;
    onNewStory: () => void;
    onDownloadTemplate: () => void;
    onDemo: () => void;
    onSettings: () => void;
}> = ({ projectLibrary, compiling, errorMessage, onImport, onNewStory, onDownloadTemplate, onDemo, onSettings }) => (
    <div className="flex h-full overflow-y-auto custom-scrollbar">
        <div className="m-auto w-full max-w-4xl space-y-4 p-5 sm:p-8">
            {projectLibrary}
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-10 text-center text-white sm:px-10 sm:py-14"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15"><Workflow className="h-8 w-8" /></div><div className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-indigo-100">Story Engine V4</div><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Studio Truyện</h1><p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-indigo-100 sm:text-base">Nhập Blueprint V4 JSON hoặc setup tác giả TXT/MD, review cấu trúc rồi tạo dự án Canon mới.</p></div>
                <div className="p-6 sm:p-8">
                    {errorMessage && <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{errorMessage}</div>}
                    {compiling ? <div className="flex items-center justify-center gap-3 py-8 text-sm font-black text-indigo-600"><Loader2 className="h-6 w-6 animate-spin" /> Đang biên dịch setup bằng Gemini…</div> : <div className="grid gap-4 sm:grid-cols-2">
                        <ActionCard icon={Sparkles} title="Tạo truyện mới" text="Wizard 9 bước bằng ngôn ngữ tác giả; tự lưu bản nháp và chỉ gọi Gemini khi bạn yêu cầu biên dịch." action="Mở wizard" onClick={onNewStory} />
                        <ImportCard icon={FileText} title="Nhập Setup TXT/MD" text="Setup tác giả có thể chứa bí mật. Gemini chuyển đổi; kết quả luôn qua parser và Review Setup V4." accept=".txt,.md,text/plain,text/markdown" onImport={onImport} />
                        <ImportCard icon={FileJson} title="Nhập V4 JSON (nâng cao / offline)" text="Đường nhập offline cho StoryBlueprintDocument hợp lệ. Không gọi model." accept=".json,application/json" onImport={onImport} />
                        <ActionCard icon={Download} title="Tải mẫu Setup" text="Mẫu Markdown tiếng Việt để tự điền hoặc nhờ ChatGPT, Gemini, Claude và công cụ khác hỗ trợ." action="Tải tệp .md" onClick={onDownloadTemplate} />
                    </div>}
                    <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row"><button type="button" onClick={onDemo} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300"><FlaskConical className="h-4 w-4" /> Xem dữ liệu demo</button><button type="button" onClick={onSettings} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300"><Settings className="h-4 w-4" /> Mở Cài đặt Gemini</button></div>
                    <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400"><ShieldCheck className="h-4 w-4" /> Dự án V4 được lưu cục bộ trên trình duyệt này; không có cloud backup.</div>
                </div>
            </div>
        </div>
    </div>
);

const ImportCard: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; text: string; accept: string; onImport: (file: File) => void }> = ({ icon: Icon, title, text, accept, onImport }) => <label className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-slate-700 dark:hover:bg-indigo-950/20"><Icon className="mx-auto h-8 w-8 text-indigo-500" /><div className="mt-3 font-black text-slate-900 dark:text-white">{title}</div><p className="mt-2 text-xs leading-relaxed text-slate-500">{text}</p><span className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white">Chọn tệp</span><input type="file" accept={accept} className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ''; }} /></label>;
const ActionCard: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; text: string; action: string; onClick: () => void }> = ({ icon: Icon, title, text, action, onClick }) => <button type="button" onClick={onClick} className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-slate-700 dark:hover:bg-indigo-950/20"><Icon className="mx-auto h-8 w-8 text-indigo-500" /><div className="mt-3 font-black text-slate-900 dark:text-white">{title}</div><p className="mt-2 text-xs leading-relaxed text-slate-500">{text}</p><span className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white">{action}</span></button>;

const SafeFailure: React.FC<{ message: string }> = ({ message }) => <div className="flex h-full items-center justify-center p-6"><div className="max-w-lg rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm dark:border-rose-900 dark:bg-slate-900"><AlertTriangle className="mx-auto h-10 w-10 text-rose-500" /><h1 className="mt-4 text-xl font-black text-slate-900 dark:text-white">Không thể hiển thị Story Studio</h1><p className="mt-2 text-sm text-slate-500">{message}</p></div></div>;

export const StoryStudioPage: React.FC<StoryStudioPageProps> = props => <StoryStudioErrorBoundary><StoryStudioContent {...props} /></StoryStudioErrorBoundary>;
