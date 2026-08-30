import { LogContext, LogEntry } from '../types';
import { createSanitizedLogEntry, sanitizeLogEntry } from './logSanitizer';

const STORAGE_KEY = 'app_system_logs_v1';
const MAX_ENTRIES = 500;

export function loadPersistedLogs(): LogEntry[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as LogEntry[];
        if (!Array.isArray(parsed)) return [];
        return parsed.map(l => sanitizeLogEntry({ ...l, timestamp: new Date(l.timestamp) }));
    } catch {
        return [];
    }
}

export function persistLogs(logs: LogEntry[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, MAX_ENTRIES).map(sanitizeLogEntry)));
    } catch {
        // localStorage đầy hoặc bị chặn (chế độ ẩn danh nghiêm ngặt...) - bỏ qua, không để việc
        // ghi log làm crash thêm lần nữa.
    }
}

// Trong lúc dịch hàng loạt, addLog có thể được gọi rất dày (nhiều dòng/giây). Ghi localStorage
// (JSON.stringify tới 500 mục) ở MỌI lần gọi sẽ gây giật lag không cần thiết cho các log thường
// (info/success) — vốn không quá quan trọng phải lưu ngay tức thì. Debounce lại việc ghi các log
// này (gộp nhiều lần gọi liên tiếp thành 1 lần ghi sau khi ngừng gọi ~800ms).
//
// FIX (race mất log): trước đây timer CHỤP ẢNH mảng logs tại thời điểm schedulePersistLogs được
// gọi rồi ghi bản chụp đó sau 800ms — nếu trong khoảng chờ appendPersistedLog vừa ghi thêm 1
// entry mới (vd log lỗi từ window.onerror) thì entry đó sẽ bị BỊ GHI ĐÈ MẤT bởi bản chụp cũ.
// Giữ tham chiếu tới danh sách MỚI NHẤT (pendingLogs luôn được cập nhật mỗi lần gọi) thay vì
// chụp cứng, và appendPersistedLog cũng hợp nhất vào pendingLogs để mọi đường ghi đều thấy
// nhau theo đúng thứ tự.
let pendingLogs: LogEntry[] | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function flushPendingLogs(): void {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    if (pendingLogs) {
        persistLogs(pendingLogs);
        pendingLogs = null;
    }
}

export function schedulePersistLogs(logs: LogEntry[]): void {
    pendingLogs = logs;
    if (persistTimer) return;
    persistTimer = setTimeout(flushPendingLogs, 800);
}

// FIX (mất log khi đóng trang): timer debounce không kịp bắn nếu người dùng đóng/refresh tab
// ngay sau lần log cuối -> cả đuôi log phiên bị mất. Flush ngay khi trang sắp bị dỡ.
if (typeof window !== 'undefined') {
    const handlePageUnload = () => flushPendingLogs();
    window.addEventListener('pagehide', handlePageUnload);
    window.addEventListener('beforeunload', handlePageUnload);
}

// Ghi trực tiếp 1 dòng log mới nhất vào localStorage. Hàm này dùng được cả NGOÀI cây React (ví
// dụ window.onerror/unhandledrejection chạy độc lập, hoặc bên trong ErrorBoundary SAU KHI toàn
// bộ state React trong App đã mất do crash) — vì nó tự đọc/ghi thẳng localStorage, không phụ
// thuộc vào state của bất kỳ component nào còn sống hay không.
export function appendPersistedLog(message: string, type: LogEntry['type'] = 'info', context?: LogContext): void {
    // Nếu đang có đợt ghi debounce treo (pendingLogs chứa dữ liệu MỚI HƠN localStorage), lấy nó
    // làm gốc thay vì đọc localStorage để không ghi đè ngược log chưa flush.
    const base = (pendingLogs && pendingLogs.length > 0) ? pendingLogs : loadPersistedLogs();
    const entry = createSanitizedLogEntry(message, type, context);
    const merged = [entry, ...base];
    persistLogs(merged);
    pendingLogs = merged;
}

export function clearPersistedLogs(): void {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
