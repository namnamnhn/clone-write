import React, { useEffect, useState } from 'react';
import { Archive, Download, RefreshCw, Loader2 } from 'lucide-react';
import { listBackupSnapshotKeys, loadBackupSnapshot } from '../utils/storage';

// NÂNG CẤP #10 — Panel "Bản Dự Phòng Tự Động": liệt kê các snapshot mà hệ thống tự chụp
// vào IndexedDB (giữ 5 bản gần nhất, 1 bản/10 phút khi có thay đổi), cho phép tải về dạng
// .json (cùng cấu trúc với file backup thủ công nên có thể dùng nút Khôi Phục hiện có).
// Component tự quản lý dữ liệu qua storage util — không cần thêm props mới cho Dashboard.
export const AutoBackupPanel: React.FC = () => {
    const [keys, setKeys] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

    const refresh = async () => {
        setLoading(true);
        try {
            const list = await listBackupSnapshotKeys();
            setKeys(list);
        } catch {
            setKeys([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let active = true;
        void listBackupSnapshotKeys()
            .then(list => { if (active) setKeys(list); })
            .catch(() => { if (active) setKeys([]); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const handleDownload = async (key: string) => {
        setDownloadingKey(key);
        try {
            const data = await loadBackupSnapshot(key);
            if (!data) throw new Error('Snapshot rỗng');
            // FIX (rò rỉ API key): snapshot tự động chứa nguyên state (kèm deepseekKey) trong khi
            // backup THỦ CÔNG thì chủ động xoá key trước khi xuất ("Do not backup API key"). Tải
            // snapshot về để gửi người khác/máy khác sẽ lộ key — lược bỏ cùng loại field nhạy cảm
            // như handleBackup để file tải về an toàn và nhất quán với backup thủ công.
            const safeData = { ...data };
            delete safeData.deepseekKey;
            delete (safeData as any).openRouterKey;
            delete (safeData as any).openRouterModel;
            const blob = new Blob([JSON.stringify(safeData)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-tu-dong-${key}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
            // im lặng — tải backup là tiện ích phụ
        } finally {
            setDownloadingKey(null);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-elevation-1">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Archive className="w-4 h-4 text-indigo-500" />
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Bản Dự Phòng Tự Động</h3>
                </div>
                <button onClick={refresh} className="p-1.5 text-slate-400 hover:text-primary-600 rounded-lg transition-colors" title="Làm mới">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
                Hệ thống tự chụp nhanh mỗi 10 phút khi có thay đổi (giữ 5 bản gần nhất). Tải về để khôi phục bằng nút Khôi Phục phía trên.
            </p>
            {!loading && keys.length === 0 && (
                <p className="text-xs text-slate-400 italic">Chưa có bản dự phòng nào — sẽ xuất hiện sau lần lưu đầu tiên (~10 phút).</p>
            )}
            <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                {keys.map(key => {
                    const ts = parseInt(key.replace('bk_', ''), 10);
                    const label = isNaN(ts) ? key : new Date(ts).toLocaleString('vi-VN');
                    return (
                        <div key={key} className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-100 dark:border-slate-700">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">{label}</span>
                            <button
                                onClick={() => handleDownload(key)}
                                disabled={downloadingKey === key}
                                className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-white dark:hover:bg-slate-800 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-50 shrink-0"
                                title="Tải snapshot (.json)"
                            >
                                {downloadingKey === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
