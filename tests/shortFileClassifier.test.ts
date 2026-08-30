import { describe, expect, it } from 'vitest';
import { isConfirmedNonStoryFile, parseShortFileClassifications } from '../src/services/workflows/translate/shortFileClassifier';
import { fingerprintShortRawContent, isClearlyEditorialNoiseLine } from '../src/utils/text/nonStoryPolicy';
import type { FileItem } from '../src/types';

describe('AI xác minh file raw ngắn', () => {
    it('chỉ chấp nhận non_story khi độ tin cậy từ 90%', () => {
        const parsed = parseShortFileClassifications(JSON.stringify({ files: [{ id: 'a', kind: 'non_story', confidence: 0.95, reason: 'xin nghỉ' }, { id: 'b', kind: 'non_story', confidence: 0.72, reason: 'không chắc' }] }), ['a', 'b']);
        expect(parsed.get('a')?.kind).toBe('non_story'); expect(parsed.get('b')?.kind).toBe('uncertain');
    });
    it('fingerprint đổi thì kết luận cũ không còn được phép bỏ qua', () => {
        const content = 'Thông báo: tác giả xin nghỉ đăng một ngày.';
        const file = { content, shortContentKind: 'non_story', shortContentConfidence: 0.98, shortContentFingerprint: fingerprintShortRawContent(content) } as FileItem;
        expect(isConfirmedNonStoryFile(file)).toBe(true);
        expect(isConfirmedNonStoryFile({ ...file, content: `${content}\nNhân vật mở cửa bước vào.` })).toBe(false);
    });
});

describe('lọc cục bộ lời ngoài truyện phải bảo thủ', () => {
    it('nhận tín hiệu quảng bá/xin phiếu rõ ràng', () => { expect(isClearlyEditorialNoiseLine('Cầu nguyệt phiếu, xin mọi người ủng hộ!')).toBe(true); expect(isClearlyEditorialNoiseLine('Converter: ABC')).toBe(true); });
    it('không xóa chú thích thật hoặc câu truyện chỉ vì trúng từ khóa', () => {
        expect(isClearlyEditorialNoiseLine('[1]: Linh lực là năng lượng của thế giới này.')).toBe(false);
        expect(isClearlyEditorialNoiseLine('Tác giả dùng khái niệm này để giải thích cảnh giới.')).toBe(false);
        expect(isClearlyEditorialNoiseLine('“Chúc mừng ngươi đã đột phá!”')).toBe(false);
        expect(isClearlyEditorialNoiseLine('Hắn nhận được một phiếu triệu hồi.')).toBe(false);
    });
});
