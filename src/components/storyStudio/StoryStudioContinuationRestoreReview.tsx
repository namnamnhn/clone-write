import React from 'react';
import { AlertTriangle, CheckCircle2, CopyPlus, ShieldCheck } from 'lucide-react';
import type { StoryStudioContinuationRestorePreview } from '../../storyStudio/production/storyStudioContinuationBackup';

const WORKFLOW_LABELS: Readonly<Record<StoryStudioContinuationRestorePreview['workflowStage'], string>> = {
    idle: 'Sẵn sàng cho chương tiếp theo',
    planned: 'Đã lưu kế hoạch chương',
    drafted: 'Đã lưu bản nháp chương',
    validated: 'Đã lưu kết quả kiểm tra',
    rejected: 'Bản nháp đang chờ xử lý lại',
    extracted: 'Đã lưu đề xuất thay đổi Canon',
    'ready-for-canon-review': 'Đã duyệt — CHƯA vào Canon',
};

export const StoryStudioContinuationRestoreReview: React.FC<{
    preview: StoryStudioContinuationRestorePreview;
    disabled: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ preview, disabled, onConfirm, onCancel }) => (
    <section className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-xl dark:border-emerald-900 dark:bg-slate-900">
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 px-6 py-7 text-white sm:px-8">
            <div className="flex items-center gap-3">
                <ShieldCheck className="h-8 w-8" />
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Bản sao tiếp tục hợp lệ</div>
                    <h1 className="mt-1 text-2xl font-black">Xác nhận khôi phục dự án</h1>
                </div>
            </div>
        </div>
        <div className="space-y-5 p-6 sm:p-8">
            <div className="grid gap-3 sm:grid-cols-2">
                <PreviewItem label="Tên dự án" value={preview.catalogDisplayName} />
                <PreviewItem label="Phiên bản bản sao" value={`V${preview.formatVersion}`} />
                <PreviewItem label="Canon hiện tại" value={`Chương ${preview.currentChapter}/${preview.plannedChapterCount}`} />
                <PreviewItem label="Điểm tiếp tục" value={WORKFLOW_LABELS[preview.workflowStage]} />
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                <p>Backup đã vượt qua kiểm tra toàn vẹn và có thể tiếp tục chính xác. Chưa có dự án hoặc thư viện nào được ghi ở bước xem trước này.</p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <p>Tệp chứa dữ liệu riêng tư của tác giả. Khi xác nhận, Story Studio sẽ tạo và mở một dự án cục bộ MỚI; các dự án hiện có không bị ghi đè.</p>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" disabled={disabled} onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300">Hủy</button>
                <button type="button" disabled={disabled} onClick={onConfirm} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40"><CopyPlus className="h-4 w-4" /> Khôi phục dự án</button>
            </div>
        </div>
    </section>
);

const PreviewItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
        <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{value}</div>
    </div>
);
