import { LogEntry } from '../types';
import { APP_VERSION } from '../changelog';
import { redactSensitiveText, sanitizeLogContext, sanitizeLogEntry } from './logSanitizer';

// Thông tin môi trường đính kèm đầu file log — giúp người nhận (dev) không cần hỏi lại
// "bạn dùng bản nào/trình duyệt gì/máy gì" mỗi lần debug.
function buildEnvironmentHeader(extra?: Record<string, string | number | boolean | undefined>): string {
    const lines: string[] = [];
    lines.push('='.repeat(60));
    lines.push('BÁO CÁO LỖI / NHẬT KÝ HỆ THỐNG');
    lines.push('='.repeat(60));
    lines.push(`Phiên bản app: v${APP_VERSION}`);
    lines.push(`Thời điểm xuất: ${new Date().toLocaleString('vi-VN')}`);
    try {
        lines.push(`Trình duyệt (User Agent): ${navigator.userAgent}`);
        lines.push(`Ngôn ngữ trình duyệt: ${navigator.language}`);
        lines.push(`Kích thước màn hình: ${window.screen.width}x${window.screen.height} (viewport ${window.innerWidth}x${window.innerHeight})`);
        lines.push(`Online: ${navigator.onLine ? 'Có' : 'Không'}`);
    } catch { /* môi trường không có window/navigator (SSR/test) - bỏ qua */ }

    if (extra) {
        Object.entries(extra).forEach(([key, value]) => {
            if (value !== undefined) lines.push(`${redactSensitiveText(key, 120)}: ${redactSensitiveText(value, 500)}`);
        });
    }

    lines.push('='.repeat(60));
    lines.push('');
    return lines.join('\n');
}

// Định dạng danh sách log thành text CHUYÊN NGHIỆP, dễ đối chiếu với tiến độ thực tế hơn bản cũ:
// - Mỗi dòng có thêm mốc thời gian TƯƠNG ĐỐI [+12.3s] tính từ dòng log đầu tiên trong phiên, dễ
//   thấy khoảng cách giữa các bước hơn là chỉ có giờ tuyệt đối.
// - Khoảng lặng >= 15s giữa 2 dòng log liên tiếp (không có gì được ghi) được đánh dấu riêng - đây
//   thường là lúc có tác vụ nền (dịch/hậu kiểm/gọi API) đang chạy ngầm; nếu dòng NGAY SAU khoảng
//   lặng lại là "Hoàn tất" trong khi UI thực tế vẫn còn tệp đang Streaming, đây chính là chỗ cần
//   xem đầu tiên khi đối chiếu lỗi "báo xong nhưng thực tế chưa xong".
// - Cuối file có phần TỔNG KẾT PHIÊN (tổng số dòng, thời lượng, số lỗi/cảnh báo) để nhìn nhanh
//   không cần đọc hết log dài.
function formatLogEntries(logs: LogEntry[]): string {
    if (logs.length === 0) return '(Không có log nào được ghi nhận trong phiên này)';
    const chronological = logs.map(sanitizeLogEntry).reverse();
    const startMs = new Date(chronological[0].timestamp).getTime();
    let prevMs = startMs;

    const TAG_LABELS: Record<string, string> = {
        error: '[LỖI]     ',
        success: '[OK]      ',
        warning: '[CẢNH BÁO]',
        info: '[INFO]    ',
    };
    const STALL_THRESHOLD_SEC = 15;

    const lines = chronological.map(log => {
        const nowMs = new Date(log.timestamp).getTime();
        const time = new Date(log.timestamp).toLocaleString('vi-VN');
        const tag = TAG_LABELS[log.type] || TAG_LABELS.info;
        const elapsedFromStart = ((nowMs - startMs) / 1000).toFixed(1);
        const gapSec = (nowMs - prevMs) / 1000;
        prevMs = nowMs;
        const gapMarker = gapSec >= STALL_THRESHOLD_SEC
            ? `\n  · · · khoảng lặng ${gapSec.toFixed(0)}s không có log (có thể đang chạy tác vụ nền) · · ·\n`
            : '';
        const context = sanitizeLogContext(log.context);
        const contextFields = context ? [
            context.operation && `op=${context.operation}`, context.provider && `provider=${context.provider}`,
            context.modelId && `model=${context.modelId}`, context.runId && `run=${context.runId}`,
            context.batchId && `batch=${context.batchId}`,
            context.attempt !== undefined && `attempt=${context.attempt}${context.maxAttempts ? `/${context.maxAttempts}` : ''}`,
            context.httpStatus !== undefined && `http=${context.httpStatus}`,
            context.apiStatus && `api=${context.apiStatus}`, context.cause && `cause=${context.cause}`,
            context.durationMs !== undefined && `duration=${context.durationMs}ms`,
        ].filter(Boolean).join(' | ') : '';
        return `${gapMarker}[+${elapsedFromStart.padStart(7)}s] ${time} ${tag} ${log.message}${contextFields ? `\n    ↳ ${contextFields}` : ''}`;
    }).join('\n');

    const errorCount = chronological.filter(l => l.type === 'error').length;
    const warningCount = chronological.filter(l => (l.type as string) === 'warning').length;
    const totalDurationSec = ((new Date(chronological[chronological.length - 1].timestamp).getTime() - startMs) / 1000).toFixed(1);
    const summary = [
        '',
        '='.repeat(60),
        'TỔNG KẾT PHIÊN',
        '='.repeat(60),
        `Tổng số dòng log: ${chronological.length}`,
        `Thời lượng phiên (dòng đầu -> dòng cuối): ${totalDurationSec}s`,
        `Số lỗi: ${errorCount} | Số cảnh báo: ${warningCount}`,
    ].join('\n');

    return lines + '\n' + summary;
}

export function buildLogFileContent(logs: LogEntry[], extra?: Record<string, string | number | boolean | undefined>): string {
    return buildEnvironmentHeader(extra) + formatLogEntries(logs);
}

export function buildCrashReportContent(error: Error | null, componentStack: string | null | undefined, priorLogs: LogEntry[]): string {
    const header = buildEnvironmentHeader({ 'Loại sự cố': 'CRASH - Lỗi giao diện nghiêm trọng (ErrorBoundary)' });
    const crashDetail = ['--- CHI TIẾT LỖI CRASH (quan trọng nhất, xem trước) ---',
        redactSensitiveText(error ? (error.stack || error.toString()) : '(Không bắt được đối tượng lỗi)'), '',
        '--- COMPONENT STACK (React) ---', redactSensitiveText(componentStack || '(Không có)'), '',
        '--- LOG HỆ THỐNG TRƯỚC KHI CRASH (cũ -> mới) ---'].join('\n');
    return header + crashDetail + '\n' + formatLogEntries(priorLogs);
}

// Tạo file .txt và kích hoạt tải xuống ngay trên trình duyệt (không cần server).
export function downloadTextFile(content: string, filenamePrefix: string): void {
    try {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `${filenamePrefix}_${stamp}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
        // Nếu Blob/download bị chặn (hiếm gặp) - fallback mở tab mới hiển thị nội dung thô để
        // người dùng tự copy, còn hơn là im lặng thất bại không xuất được gì.
        try {
            const win = window.open('', '_blank');
            if (win) {
                win.document.title = 'Log xuất (chế độ dự phòng - vui lòng copy toàn bộ nội dung)';
                win.document.body.style.whiteSpace = 'pre-wrap';
                win.document.body.style.fontFamily = 'monospace';
                win.document.body.textContent = content;
            }
        } catch { /* bó tay, môi trường quá hạn chế */ }
    }
}

// Gộp 2 bước lại cho gọn: định dạng + tải xuống ngay.
export function exportSystemLogs(logs: LogEntry[], extra?: Record<string, string | number | boolean | undefined>): void {
    const content = buildLogFileContent(logs, extra);
    downloadTextFile(content, 'nhat-ky-loi');
}

// Xuất báo cáo riêng cho trường hợp app CRASH (lỗi giao diện nghiêm trọng, React ErrorBoundary
// bắt được). Khác với exportSystemLogs thông thường: gộp thêm chi tiết stack trace của chính lỗi
// crash + component stack, đặt NGAY ĐẦU báo cáo (trước cả log lịch sử), vì đây mới là thông tin
// quan trọng nhất để dev tìm ra nguyên nhân, còn log lịch sử chỉ là bối cảnh dẫn tới crash.
export function exportCrashReport(error: Error | null, componentStack: string | null | undefined, priorLogs: LogEntry[]): void {
    downloadTextFile(buildCrashReportContent(error, componentStack, priorLogs), 'bao-cao-crash');
}
