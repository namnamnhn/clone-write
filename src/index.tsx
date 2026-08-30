import React, { ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { appendPersistedLog, loadPersistedLogs } from './utils/logStore';
import { exportCrashReport } from './utils/logExport';
import { isLazyChunkLoadError, reloadAppWithCacheBust } from './utils/lazyWithRecovery';

// Bắt lỗi JS ném ra NGOÀI mọi try/catch (vd lỗi trong event handler, setTimeout, code bên thứ
// 3...) — đây là những lỗi React ErrorBoundary KHÔNG bắt được (ErrorBoundary chỉ bắt lỗi trong
// quá trình render/lifecycle của cây component bên dưới nó). Ghi thẳng vào localStorage để dù
// người dùng không nhận ra gì bất thường (lỗi âm thầm), log vẫn được giữ lại để xuất báo cáo sau.
window.addEventListener('error', (event) => {
    const detail = event.error?.stack || `${event.message} (tại ${event.filename}:${event.lineno}:${event.colno})`;
    appendPersistedLog(`Lỗi JS không bắt được: ${detail}`, 'error');
});

// Bắt Promise bị reject mà không có .catch() — nguồn lỗi "âm thầm" rất phổ biến trong các luồng
// dịch/gọi API bất đồng bộ, thường không hiện gì trên UI nhưng khiến 1 thao tác lặng lẽ thất bại.
window.addEventListener('unhandledrejection', (event) => {
    const reason: any = event.reason;
    const detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    appendPersistedLog(`Promise bị từ chối không xử lý: ${detail}`, 'error');
});

interface ErrorBoundaryProps { children: ReactNode; }
interface ErrorBoundaryState { hasError: boolean; error: Error | null; errorInfo: ErrorInfo | null; }

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
    // Ghi lại crash vào localStorage ngay lập tức — tại thời điểm này toàn bộ state React của
    // App (bao gồm systemLogs trong useUIState) coi như đã mất vì cây component đã bị unmount,
    // nên phải dựa vào bản ghi độc lập này để còn thứ mà xuất báo cáo.
    appendPersistedLog(`CRASH: ${error.toString()}\n${errorInfo.componentStack}`, 'error');
  }

  handleExportCrashLog = () => {
    exportCrashReport(this.state.error, this.state.errorInfo?.componentStack, loadPersistedLogs());
  };

  handleReloadApp = () => {
    reloadAppWithCacheBust();
  };

  render() {
    if (this.state.hasError) {
      const isChunkCrash = isLazyChunkLoadError(this.state.error);
      return (
        <div style={{ padding: '20px', color: 'red', fontFamily: 'monospace' }}>
          <h2>{isChunkCrash ? 'Không tải được thành phần của bản ứng dụng hiện tại.' : 'Ứng dụng vừa gặp lỗi.'}</h2>
          <p style={{ color: '#475569', fontFamily: 'sans-serif' }}>
            {isChunkCrash
              ? 'Phiên Preview có thể vừa được cập nhật. Hãy tải lại để lấy đúng bộ tệp mới nhất.'
              : 'Bạn có thể tải lại ứng dụng hoặc xuất báo cáo lỗi để gửi kiểm tra.'}
          </p>
          <button
            onClick={this.handleReloadApp}
            style={{ padding: '10px 16px', margin: '12px 8px 12px 0', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'sans-serif', fontWeight: 600 }}
          >
            ↻ Tải lại ứng dụng
          </button>
          <button
            onClick={this.handleExportCrashLog}
            style={{ padding: '10px 16px', margin: '12px 0', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'sans-serif', fontWeight: 600 }}
          >
            📄 Xuất Log Lỗi (gửi cho dev kiểm tra)
          </button>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo?.componentStack}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
