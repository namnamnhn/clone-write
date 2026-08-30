import { describe, it, expect } from 'vitest';
import { collapseDuplicateWords, fixKnownTypos, cleanupAiTextArtifacts } from '../src/utils/text/format/dedupeWords';

describe('collapseDuplicateWords — sửa lỗi lặp từ liền kề do AI dịch (bug report ảnh 2)', () => {
    it('xoá lặp từ đơn liền kề — các case thực tế từ báo cáo lỗi', () => {
        expect(collapseDuplicateWords('cấp dưới dưới quyền nó')).toBe('cấp dưới quyền nó');
        expect(collapseDuplicateWords('quen biết biết bao nhiêu')).toBe('quen biết bao nhiêu');
        expect(collapseDuplicateWords('ngả nghiêng ngả ngả')).toBe('ngả nghiêng ngả');
        expect(collapseDuplicateWords('biến mất mất thôi')).toBe('biến mất thôi');
        expect(collapseDuplicateWords('đồ ăn ăn được')).toBe('đồ ăn được');
        expect(collapseDuplicateWords('hơn cả cả nhà chúng tôi')).toBe('hơn cả nhà chúng tôi');
        expect(collapseDuplicateWords('quan quan bao che')).toBe('quan bao che');
        expect(collapseDuplicateWords('phụ cấp cấp quốc gia')).toBe('phụ cấp quốc gia');
        expect(collapseDuplicateWords('cháu cháu dâu')).toBe('cháu dâu');
        expect(collapseDuplicateWords('thèm thèm thuồng')).toBe('thèm thuồng');
    });

    it('KHÔNG xoá từ láy hợp lệ (danh sách trắng)', () => {
        expect(collapseDuplicateWords('đi từ từ thôi')).toBe('đi từ từ thôi');
        expect(collapseDuplicateWords('người người nhà nhà đều biết')).toBe('người người nhà nhà đều biết');
        expect(collapseDuplicateWords('chờ mãi mãi cũng không thấy')).toBe('chờ mãi mãi cũng không thấy');
        expect(collapseDuplicateWords('ngày ngày trôi qua')).toBe('ngày ngày trôi qua');
    });

    it('KHÔNG phá cụm giao nhau hoặc chuỗi từ láy hợp lệ', () => {
        expect(collapseDuplicateWords('đả thông thông đạo')).toBe('đả thông thông đạo');
        expect(collapseDuplicateWords('tầng tầng lớp lớp')).toBe('tầng tầng lớp lớp');
        expect(collapseDuplicateWords('Đả thông thông đạo rồi tiến vào.')).toBe('Đả thông thông đạo rồi tiến vào.');
    });

    it('giữ cặp lặp chưa được xác nhận thay vì đoán và làm sai nghĩa', () => {
        expect(collapseDuplicateWords('anh nhìn nhìn rồi im lặng')).toBe('anh nhìn nhìn rồi im lặng');
    });

    it('xoá lặp 3 lần trở lên về còn 1', () => {
        expect(collapseDuplicateWords('quan quan quan bao che')).toBe('quan bao che');
    });

    it('không đụng tới từ ghép 2 âm tiết trùng lặp không liền kề nhau theo nghĩa khác', () => {
        expect(collapseDuplicateWords('con mèo con')).toBe('con mèo con'); // không liền kề -> giữ nguyên
    });

    it('giữ nguyên văn bản không có lỗi', () => {
        const clean = 'Giang Vân Mộng vẫn đang sốt nhẹ, uể oải nuốt tạm hai miếng rồi thôi.';
        expect(collapseDuplicateWords(clean)).toBe(clean);
    });
});

describe('fixKnownTypos — sửa lỗi chính tả AI hay mắc (bug report ảnh 1: uể ủai -> uể oải)', () => {
    it('sửa đúng case trong báo cáo lỗi', () => {
        const input = 'Hứa Dục Thành không có cảm giác thèm ăn, uể ủai nuốt tạm hai miếng rồi thôi.';
        const out = fixKnownTypos(input);
        expect(out).toContain('uể oải');
        expect(out).not.toContain('uể ủai');
    });

    it('không đụng vào văn bản đã đúng', () => {
        const clean = 'uể oải bước đi trong đêm tối.';
        expect(fixKnownTypos(clean)).toBe(clean);
    });
});

describe('cleanupAiTextArtifacts — gộp cả 2 bước, dùng trong pipeline dịch', () => {
    it('sửa đồng thời lặp từ + chính tả trong 1 đoạn văn thực tế', () => {
        const input = 'Giang Vân Mộng vẫn đang sốt nhẹ. Hứa Dục Thành không có cảm giác thèm ăn, uể ủai nuốt tạm hai miếng rồi thôi. Kiều Vệ Quốc lo cho Giang Vân Mộng, trong lòng cũng không yên yên.';
        const out = cleanupAiTextArtifacts(input);
        expect(out).toContain('uể oải');
        expect(out).toContain('không yên.');
        expect(out).not.toContain('yên yên');
    });

    it('không thay đổi gì với input rỗng/undefined', () => {
        expect(cleanupAiTextArtifacts('')).toBe('');
    });
});
