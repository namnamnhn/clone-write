import React from 'react';
import { BookOpen, Download, FileJson, FileText, Loader2, Pause, Play, RotateCcw, Settings, ShieldCheck, Trash2 } from 'lucide-react';
import type { StoryStudioRuntimeProject } from '../../storyStudio/production/storyStudioProjectTypes';
import type { StoryStudioOperation, StoryStudioSaveStatus } from '../../hooks/pages/useStoryStudio';

const operationLabels: Readonly<Record<StoryStudioOperation, string>> = {
    'compiling-setup': 'Đang biên dịch setup bằng Gemini…',
    'preparing-continuation': 'Đang kiểm tra bản sao tiếp tục…',
    'restoring-continuation': 'Đang kiểm tra và lưu bản sao tiếp tục…',
    'publishing-epub': 'Đang tạo EPUB từ Canon…',
    planning: 'Planner đang chạy', writing: 'Writer đang chạy', validation: 'Validator đang kiểm tra / Repair đang sửa',
    extraction: 'Extractor đang cập nhật đề xuất Canon', 'canon-review': 'Đang chuẩn bị Review Canon',
    stopping: 'Đang dừng an toàn…',
};
export const StoryStudioActionBar: React.FC<{
    project: StoryStudioRuntimeProject;
    batchSize: number;
    saveStatus: StoryStudioSaveStatus;
    operation?: StoryStudioOperation;
    disabled: boolean;
    onBatchSize: (value: number) => void;
    onStart: () => void;
    onResume: () => void;
    onStop: () => void;
    onRewrite: () => void;
    onReplan: () => void;
    onImport: (file: File) => void;
    onOpenSettings: () => void;
    onExportSetup: () => void;
    onBackupContinuation: () => void;
    onPublishEpub: () => void;
    onDelete: () => void;
}> = ({ project, batchSize, saveStatus, operation, disabled, onBatchSize, onStart, onResume, onStop, onRewrite, onReplan, onImport, onOpenSettings, onExportSetup, onBackupContinuation, onPublishEpub, onDelete }) => {
    const workflow = project.workflow;
    const storyComplete = project.state.currentChapter >= project.control.engine.plannedChapterCount;
    const approvedRecoveryStage = workflow.stage === 'validated' || workflow.stage === 'extracted';
    const canStart = workflow.stage === 'idle' && project.batchQueue.remaining === 0 && !storyComplete;
    const canResume = !canStart && !approvedRecoveryStage && workflow.stage !== 'ready-for-canon-review' && workflow.stage !== 'rejected' && !storyComplete;
    const pendingChapter = workflow.stage === 'idle' ? undefined : project.state.currentChapter + 1;
    const epubDisabled = disabled || saveStatus !== 'saved' || project.state.currentChapter === 0;
    return (
        <section className="sticky top-0 z-30 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="mr-2">
                        <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Batch tuần tự</div>
                        <select value={batchSize} onChange={event => onBatchSize(Number(event.target.value))} disabled={disabled || workflow.stage !== 'idle' || project.batchQueue.remaining > 0} className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-950">
                            <option value={1}>1 chương</option><option value={2}>2 chương</option><option value={3}>3 chương</option>
                        </select>
                    </div>
                    {operation ? <button type="button" onClick={onStop} disabled={operation === 'stopping'} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"><Pause className="h-4 w-4" /> {operation === 'stopping' ? 'Đang dừng an toàn…' : 'Dừng'}</button> : <>
                        {canStart && <button type="button" onClick={onStart} disabled={disabled} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"><Play className="h-4 w-4" /> Bắt đầu viết</button>}
                        {canResume && <button type="button" onClick={onResume} disabled={disabled} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"><Play className="h-4 w-4" /> Tiếp tục từ bước đã lưu</button>}
                        {approvedRecoveryStage && <>
                            <button type="button" onClick={onResume} disabled={disabled} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"><Play className="h-4 w-4" /> Thử lại bước hiện tại</button>
                            <button type="button" onClick={onRewrite} disabled={disabled} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-white"><RotateCcw className="h-4 w-4" /> Viết lại từ cùng kế hoạch</button>
                            <button type="button" onClick={onReplan} disabled={disabled} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold dark:border-slate-700">Lập kế hoạch lại chương</button>
                        </>}
                        {workflow.stage === 'rejected' && <>
                            <button type="button" onClick={onRewrite} disabled={disabled} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-white"><RotateCcw className="h-4 w-4" /> Viết lại từ cùng kế hoạch</button>
                            <button type="button" onClick={onReplan} disabled={disabled} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold dark:border-slate-700">Lập kế hoạch lại chương</button>
                        </>}
                    </>}
                    {storyComplete && <span className="rounded-xl bg-emerald-100 px-4 py-2.5 text-sm font-black text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Đã hoàn thành số chương theo kế hoạch.</span>}
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500 dark:bg-slate-800">Còn {project.batchQueue.remaining} chương trong batch{project.batchQueue.paused ? ' · đã tạm dừng' : ''}</span>
                    {workflow.stage !== 'idle' && 'validation' in workflow && <span className="rounded-full bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">Repair: {workflow.validation.result.repairAttempts} lượt</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    {operation && <span className="inline-flex items-center gap-2 font-bold text-indigo-600 dark:text-indigo-300"><Loader2 className="h-4 w-4 animate-spin" /> {operationLabels[operation]}</span>}
                    <SaveBadge status={saveStatus} />
                    <label className="cursor-pointer rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:text-indigo-600 dark:border-slate-700" title="Nhập V4 JSON khác (nâng cao / offline)"><FileJson className="h-4 w-4" /><input type="file" accept=".json,application/json" className="hidden" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ''; }} /></label>
                    <label className="cursor-pointer rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:text-indigo-600 dark:border-slate-700" title="Nhập Setup TXT/MD khác"><FileText className="h-4 w-4" /><input type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ''; }} /></label>
                    <button type="button" onClick={onExportSetup} disabled={disabled} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:text-indigo-600 disabled:opacity-40 dark:border-slate-700" title="Xuất Setup Markdown (có thể chứa bí mật tác giả)"><Download className="h-4 w-4" /></button>
                    <button type="button" onClick={onBackupContinuation} disabled={disabled} className="rounded-xl border border-emerald-200 p-2.5 text-emerald-600 hover:text-emerald-700 disabled:opacity-40 dark:border-emerald-900" title="Sao lưu để tiếp tục (chứa dữ liệu riêng tư)"><ShieldCheck className="h-4 w-4" /></button>
                    <button type="button" onClick={onPublishEpub} disabled={epubDisabled} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-3 py-2.5 font-black text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40" title={project.state.currentChapter === 0 ? 'Chưa có chương Canon để xuất EPUB.' : 'Xuất EPUB từ Canon'}><BookOpen className="h-4 w-4" /> Xuất EPUB từ Canon</button>
                    <button type="button" onClick={onOpenSettings} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:text-indigo-600 dark:border-slate-700" title="Mở Cài đặt Gemini"><Settings className="h-4 w-4" /></button>
                    <button type="button" onClick={onDelete} disabled={disabled} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:text-rose-600 dark:border-slate-700" title="Xóa dự án V4 khỏi máy"><Trash2 className="h-4 w-4" /></button>
                </div>
            </div>
            <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                {project.state.currentChapter === 0
                    ? 'Chưa có chương Canon để xuất EPUB. Chỉ các chương đã Make Canon được đưa vào EPUB.'
                    : `${project.state.currentChapter} chương Canon sẽ được xuất.${pendingChapter === undefined ? ' Chỉ các chương đã Make Canon được đưa vào EPUB.' : ` Chương ${pendingChapter} ${workflow.stage === 'ready-for-canon-review' ? 'đang chờ Make Canon' : 'chưa Make Canon'} và chưa được đưa vào EPUB.`}`}
            </p>
        </section>
    );
};

const SaveBadge: React.FC<{ status: StoryStudioSaveStatus }> = ({ status }) => {
    const ui = status === 'saved' ? ['Đã lưu', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300']
        : status === 'saving' ? ['Đang lưu', 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300']
            : ['Lỗi lưu', 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'];
    return <span className={`rounded-full px-3 py-1.5 font-black ${ui[1]}`}>{ui[0]}</span>;
};
