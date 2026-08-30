import React, { useMemo, useState } from 'react';
import { Terminal, Trash2, X, Download, Search, AlertTriangle } from 'lucide-react';
import { LogEntry } from '../../types';
import { exportSystemLogs } from '../../utils/logExport';

const STALL_THRESHOLD_SEC = 15;
// FIX48 (hiệu năng): trước đây modal render TOÀN BỘ log khớp bộ lọc (tới 500 dòng) và cứ mỗi
// lần có log mới/bấm phím lọc là toàn bộ danh sách được dựng lại (kèm toLocaleTimeString từng
// dòng) -> mở nhật ký lúc hệ thống đang chạy dồn dập thì kéo/đọc bị giật. Giờ giới hạn số dòng
// hiển thị ban đầu (mới nhất ở trên nên phần thấy được không đổi), có nút "Hiện thêm" để đọc
// sâu dần nếu cần.
const LOG_DISPLAY_STEP = 200;

export interface LogModalProps { isOpen: boolean; onClose: () => void; logs: LogEntry[]; clearLogs: () => void; }
export const LogModal: React.FC<LogModalProps> = ({ isOpen, onClose, logs, clearLogs }) => {
    const [keyword, setKeyword] = useState('');
    const [errorOnly, setErrorOnly] = useState(false);
    const [displayLimit, setDisplayLimit] = useState(LOG_DISPLAY_STEP);

    // Tính khoảng lặng (gap) so với dòng KẾ TIẾP theo thời gian thực (logs hiển thị mới nhất ở
    // trên, nên "dòng kế tiếp theo thời gian" là dòng NGAY DƯỚI mỗi log trong mảng gốc) - đánh
    // dấu trực quan chỗ có thể đang chạy tác vụ nền, dễ đối chiếu khi nghi ngờ log báo xong sớm
    // hơn thực tế.
    const gapBeforeMap = useMemo(() => {
        const map = new Map<string, number>();
        for (let i = 0; i < logs.length - 1; i++) {
            const gapSec = (new Date(logs[i].timestamp).getTime() - new Date(logs[i + 1].timestamp).getTime()) / 1000;
            if (gapSec >= STALL_THRESHOLD_SEC) map.set(logs[i].id, gapSec);
        }
        return map;
    }, [logs]);

    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            if (errorOnly && log.type !== 'error') return false;
            if (keyword.trim() && !log.message.toLowerCase().includes(keyword.trim().toLowerCase())) return false;
            return true;
        });
    }, [logs, keyword, errorOnly]);

    const visibleLogs = useMemo(() => filteredLogs.slice(0, displayLimit), [filteredLogs, displayLimit]);

    const errorCount = useMemo(() => logs.filter(l => l.type === 'error').length, [logs]);

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-700 ring-1 ring-black/50">
                <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-800 text-sky-400 rounded-xl"><Terminal className="w-5 h-5" /></div>
                        <div>
                            <h3 className="font-mono font-bold text-lg text-slate-200">System Deep Logs</h3>
                            <p className="text-xs text-slate-500 font-mono">Nhật ký chi tiết hệ thống (Mới nhất ở trên) — {filteredLogs.length}/{logs.length}</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => exportSystemLogs(logs)}
                            title="Xuất log ra file .txt để gửi cho dev kiểm tra"
                            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-sky-400 transition-colors"
                        >
                            <Download className="w-5 h-5" />
                        </button>
                        <button onClick={clearLogs} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-500 transition-colors"><Trash2 className="w-5 h-5" /></button>
                        <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
                    </div>
                </div>
                <div className="px-6 py-3 border-b border-slate-800 bg-slate-950/50 flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            value={keyword}
                            onChange={(e) => { setKeyword(e.target.value); setDisplayLimit(LOG_DISPLAY_STEP); }}
                            placeholder="Lọc từ khoá..."
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                    </div>
                    <button
                        onClick={() => { setErrorOnly(v => !v); setDisplayLimit(LOG_DISPLAY_STEP); }}
                        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-colors ${errorOnly ? 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/50' : 'bg-slate-800 text-slate-400 hover:text-rose-400'}`}
                    >
                        <AlertTriangle className="w-3.5 h-3.5" /> Lỗi ({errorCount})
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-slate-900 custom-scrollbar font-mono text-xs leading-relaxed space-y-1">
                    {filteredLogs.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-700 italic">{logs.length === 0 ? 'Trống...' : 'Không có dòng log nào khớp bộ lọc.'}</div>
                    ) : (
                        <>
                            {visibleLogs.map(log => (
                                <React.Fragment key={log.id}>
                                    <div className="flex gap-3 hover:bg-slate-800/50 p-1 rounded transition-colors border-b border-slate-800/50 pb-1">
                                        <span className="text-slate-500 shrink-0 select-none w-20">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                        <span className={`break-words flex-1 ${log.type === 'error' ? 'text-rose-400 font-bold' : log.type === 'success' ? 'text-emerald-400' : (log.type as string) === 'warning' ? 'text-amber-400' : 'text-slate-300'}`}>
                                            {log.message}
                                        </span>
                                    </div>
                                    {gapBeforeMap.has(log.id) && (
                                        <div className="text-amber-500/70 text-[11px] italic pl-2 py-0.5">
                                            · · · khoảng lặng {gapBeforeMap.get(log.id)!.toFixed(0)}s không có log (có thể đang chạy tác vụ nền) · · ·
                                        </div>
                                    )}
                                </React.Fragment>
                            ))}
                            {filteredLogs.length > visibleLogs.length && (
                                <button
                                    onClick={() => setDisplayLimit(prev => prev + LOG_DISPLAY_STEP)}
                                    className="w-full py-2 mt-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-sky-400 text-[11px] font-mono transition-colors"
                                >
                                    Hiện thêm {LOG_DISPLAY_STEP} dòng (còn {filteredLogs.length - visibleLogs.length} dòng nữa)
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
