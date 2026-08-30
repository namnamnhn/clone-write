import { ComponentType, lazy, LazyExoticComponent } from 'react';
import { appendPersistedLog } from './logStore';

const CHUNK_RELOAD_WINDOW_MS = 2 * 60 * 1000;
const CACHE_BUST_PARAM = '__app_reload';

const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error ?? 'Unknown error');

/** Nhận diện lỗi tải chunk động do preview/deployment đã thay hash asset. */
export const isLazyChunkLoadError = (error: unknown): boolean => {
    const message = errorMessage(error).toLowerCase();
    return message.includes('failed to fetch dynamically imported module')
        || message.includes('importing a module script failed')
        || message.includes('error loading dynamically imported module')
        || message.includes('chunkloaderror')
        || /loading chunk\s+\S+\s+failed/.test(message);
};

/** Thêm query mới để buộc trình duyệt lấy index.html hiện tại, vẫn giữ hash điều hướng. */
export const buildCacheBustUrl = (href: string, timestamp: number = Date.now()): string => {
    const url = new URL(href);
    url.searchParams.set(CACHE_BUST_PARAM, String(timestamp));
    return url.toString();
};

export const reloadAppWithCacheBust = (): void => {
    window.location.replace(buildCacheBustUrl(window.location.href));
};

/**
 * React.lazy có phục hồi một lần khi index cũ còn trỏ tới chunk hash đã bị deployment thay thế.
 * Marker nằm trong sessionStorage để lần reload thứ hai không lặp vô hạn. Nếu storage bị chặn,
 * không tự reload mà để ErrorBoundary hiện nút phục hồi thủ công.
 */
export const lazyWithRecovery = <T extends ComponentType<any>>(
    loader: () => Promise<{ default: T }>,
    chunkName: string,
): LazyExoticComponent<T> => lazy(async () => {
    const reloadMarker = `lazy_chunk_reload_v1:${chunkName}`;
    try {
        const module = await loader();
        try { sessionStorage.removeItem(reloadMarker); } catch { /* storage có thể bị chặn */ }
        return module;
    } catch (error) {
        if (!isLazyChunkLoadError(error)) throw error;

        let canReload = false;
        try {
            const previousAttempt = Number(sessionStorage.getItem(reloadMarker) || 0);
            const now = Date.now();
            canReload = previousAttempt <= 0 || now - previousAttempt > CHUNK_RELOAD_WINDOW_MS;
            if (canReload) sessionStorage.setItem(reloadMarker, String(now));
        } catch {
            canReload = false;
        }

        appendPersistedLog(
            `Không tải được chunk ${chunkName}: ${errorMessage(error)}${canReload ? '. Tự tải lại ứng dụng một lần.' : '. Đã chặn tự tải lại lặp; chuyển sang màn hình phục hồi.'}`,
            'error'
        );

        if (canReload) {
            reloadAppWithCacheBust();
            return await new Promise<never>(() => { /* trang đang chuyển sang build mới */ });
        }
        throw error;
    }
});
