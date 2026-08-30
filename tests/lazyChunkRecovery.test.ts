import { describe, expect, it } from 'vitest';
import { buildCacheBustUrl, isLazyChunkLoadError } from '../src/utils/lazyWithRecovery';

describe('fix80 — phục hồi lazy chunk sau khi Share Preview đổi deployment', () => {
    it('nhận diện đúng lỗi dynamic import và không nuốt lỗi nghiệp vụ thường', () => {
        expect(isLazyChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://preview/assets/KnowledgePage-old.js'))).toBe(true);
        expect(isLazyChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true);
        expect(isLazyChunkLoadError(new Error('Dữ liệu chương không hợp lệ'))).toBe(false);
    });

    it('tạo URL chống cache nhưng vẫn giữ query và hash hiện có', () => {
        const result = new URL(buildCacheBustUrl('https://preview.test/app/?mode=lite#knowledge', 12345));
        expect(result.searchParams.get('mode')).toBe('lite');
        expect(result.searchParams.get('__app_reload')).toBe('12345');
        expect(result.hash).toBe('#knowledge');
    });
});
