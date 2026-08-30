import { describe, expect, it } from 'vitest';
import {
    ANALYSIS_CHUNK_MAX_CHARS,
    FULL_ANALYSIS_CHUNK_MAX_CHARS,
    IS_LITE,
    LITE_ANALYSIS_CHUNK_MAX_CHARS,
} from '../src/constants';

describe('ngân sách ký tự cho mỗi lượt phân tích AI', () => {
    it('đồng bộ 600.000 ký tự/phần để giảm request ở mọi bản', () => {
        expect(FULL_ANALYSIS_CHUNK_MAX_CHARS).toBe(600000);
        expect(LITE_ANALYSIS_CHUNK_MAX_CHARS).toBe(600000);
        expect(ANALYSIS_CHUNK_MAX_CHARS).toBe(
            IS_LITE ? LITE_ANALYSIS_CHUNK_MAX_CHARS : FULL_ANALYSIS_CHUNK_MAX_CHARS,
        );
        expect(ANALYSIS_CHUNK_MAX_CHARS).toBe(600000);
    });
});
