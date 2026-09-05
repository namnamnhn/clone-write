import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileJson, FileText, FolderOpen, Pencil, Sparkles, Trash2 } from 'lucide-react';
import type {
    StoryStudioProjectId,
    StoryStudioProjectLibraryViewEntry,
} from '../../storyStudio/production/storyStudioProjectTypes';

export const StoryStudioProjectLibrary: React.FC<{
    entries: readonly StoryStudioProjectLibraryViewEntry[];
    activeProjectId?: StoryStudioProjectId;
    disabled: boolean;
    onSwitch: (projectId: StoryStudioProjectId) => void;
    onRenameActive: (displayName: string) => void;
    onDeleteActive: () => void;
    onImport: (file: File) => void;
    onNewStory: () => void;
    onDownloadTemplate: () => void;
    onExportActive: () => void;
}> = ({ entries, activeProjectId, disabled, onSwitch, onRenameActive, onDeleteActive, onImport, onNewStory, onDownloadTemplate, onExportActive }) => {
    const activeEntry = entries.find(entry => entry.projectId === activeProjectId);
    const [nameDraft, setNameDraft] = useState<{ readonly projectId?: StoryStudioProjectId; readonly value: string }>({ value: '' });
    const name = nameDraft.projectId === activeProjectId ? nameDraft.value : activeEntry?.displayName ?? '';
    const canRename = Boolean(activeEntry && activeEntry.availability === 'available' && name.trim()
        && name.trim() !== activeEntry.displayName && !disabled);

    return (
        <details className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <span className="inline-flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
                    <FolderOpen className="h-4 w-4 text-indigo-500" /> Thư viện dự án
                </span>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
                    {entries.length} dự án
                </span>
            </summary>
            <div className="border-t border-slate-100 p-4 dark:border-slate-800">
                <div className="grid gap-2 lg:grid-cols-2">
                    {entries.map(entry => {
                        const active = entry.projectId === activeProjectId;
                        const unavailable = entry.availability !== 'available';
                        return (
                            <button
                                type="button"
                                key={entry.projectId}
                                disabled={disabled || active || unavailable}
                                onClick={() => onSwitch(entry.projectId)}
                                className={`rounded-xl border p-3 text-left transition ${active ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30' : 'border-slate-200 hover:border-indigo-300 dark:border-slate-700'} disabled:cursor-default`}
                            >
                                <span className="flex items-start justify-between gap-3">
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-black text-slate-900 dark:text-white">{entry.displayName}</span>
                                        <span className="mt-1 block text-xs text-slate-500">
                                            Chương {entry.currentChapter}/{entry.plannedChapterCount} · {new Date(entry.updatedAt).toLocaleString('vi-VN')}
                                        </span>
                                    </span>
                                    {active ? <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-600" />
                                        : unavailable ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" /> : null}
                                </span>
                                <span className={`mt-2 block text-[11px] font-bold ${unavailable ? 'text-amber-600' : active ? 'text-indigo-600' : 'text-slate-400'}`}>
                                    {unavailable ? 'Không khả dụng — không tự sửa Canon' : active ? 'Đang mở' : 'Chuyển sang dự án này'}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {activeEntry && <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row dark:border-slate-800">
                    <input value={name} onChange={event => setNameDraft({ projectId: activeProjectId, value: event.target.value })} disabled={disabled || activeEntry.availability !== 'available'} aria-label="Tên dự án đang mở" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-950" />
                    <button type="button" disabled={!canRename} onClick={() => onRenameActive(name.trim())} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"><Pencil className="h-4 w-4" /> Đổi tên</button>
                    <button type="button" disabled={disabled || activeEntry.availability !== 'available'} onClick={onExportActive} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"><Download className="h-4 w-4" /> Xuất Setup</button>
                    <button type="button" disabled={disabled} onClick={onDeleteActive} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-sm font-bold text-rose-600 disabled:opacity-40 dark:border-rose-900"><Trash2 className="h-4 w-4" /> Xóa dự án đang mở</button>
                </div>}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-black text-slate-500">Tạo/import dự án khác:</span>
                    <button type="button" disabled={disabled} onClick={onNewStory} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"><Sparkles className="h-4 w-4" /> Tạo truyện mới</button>
                    <ImportButton icon={FileText} label="Nhập Setup TXT/MD" accept=".txt,.md,text/plain,text/markdown" disabled={disabled} onImport={onImport} />
                    <ImportButton icon={FileJson} label="Nhập V4 JSON (offline)" accept=".json,application/json" disabled={disabled} onImport={onImport} />
                    <button type="button" disabled={disabled} onClick={onDownloadTemplate} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"><Download className="h-4 w-4" /> Tải mẫu Setup</button>
                    <span className="text-[11px] text-slate-400">Dự án đang mở sẽ không bị xóa.</span>
                </div>
            </div>
        </details>
    );
};

const ImportButton: React.FC<{
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    accept: string;
    disabled: boolean;
    onImport: (file: File) => void;
}> = ({ icon: Icon, label, accept, disabled, onImport }) => (
    <label className={`inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white ${disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'}`}>
        <Icon className="h-4 w-4" /> {label}
        <input type="file" accept={accept} disabled={disabled} className="hidden" onChange={event => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.currentTarget.value = '';
        }} />
    </label>
);
