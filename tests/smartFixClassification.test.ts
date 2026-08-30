import { describe, expect, it } from 'vitest';
import { isPendingTriageVerification, isSafetyOrSuspiciousError, shouldExcludeFromSmartFix } from '../src/hooks/smartFix/smartFixClassification';

describe('phân loại đầu vào Smart Fix', () => {
    it('giữ nguyên tệp hậu kiểm lỗi mạng/API thay vì xóa bản dịch', () => {
        const file = { translatedContent: 'Bản dịch đang có', errorMessage: 'Chưa xác định được (lỗi gọi API/mạng lúc hậu kiểm, không phải lỗi thật) - giữ nguyên bản dịch, sẽ tự kiểm tra lại ở lượt hậu kiểm kế tiếp.', isRescueLocked: false };
        expect(isPendingTriageVerification(file)).toBe(true); expect(shouldExcludeFromSmartFix(file)).toBe(true);
    });
    it('không đưa tệp đã xác nhận chờ cứu hộ trở lại Gemini Smart Fix', () => { expect(shouldExcludeFromSmartFix({ translatedContent: 'Bản dịch nghi vấn', errorMessage: 'Cứu hộ: hậu kiểm khởi động xác nhận lỗi thật, chỉ dịch lại qua DeepSeek.', isRescueLocked: true })).toBe(true); });
    it('nhận diện đồng nhất thông báo Safety tiếng Anh và tiếng Việt', () => { expect(isSafetyOrSuspiciousError({ errorMessage: 'Safety filter blocked' })).toBe(true); expect(isSafetyOrSuspiciousError({ errorMessage: 'Nghi vấn lỗi nội dung' })).toBe(true); expect(isSafetyOrSuspiciousError({ errorMessage: 'Lỗi timeout thông thường' })).toBe(false); });
});
