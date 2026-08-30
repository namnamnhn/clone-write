import { describe, it, expect } from 'vitest';
import { getPronounRules } from '../src/prompts';

// KIỂM CHỨNG 3 PRESET MỚI (tồn đọng từ fix17/23): Y Tế/Sức Khỏe, Mỹ Thực, Khoa Học phải được
// nạp đúng preset chuyên biệt BỔ SUNG (kèm nền MODERN) và KHÔNG bị áp nhầm xưng hô Cổ Trang.
describe('getPronounRules — định tuyến preset thể loại chuyên biệt', () => {
    it("['Y Tế'] nạp preset MEDICAL kèm nền MODERN, không dính ANCIENT", () => {
        const rules = getPronounRules(['Y Tế']);
        expect(rules).toContain('V.MEDICAL');
        expect(rules).toContain('Bác sĩ');
        // Marker nội dung đặc trưng của nền MODERN (header chung với ANCIENT nên dùng cụm riêng)
        expect(rules).toContain('Ông chủ');
        // ANCIENT có cặp "Phu quân - Nương tử" đặc trưng — không được xuất hiện
        expect(rules).not.toContain('Phu quân');
    });

    it("['Sức Khỏe'] cũng kích hoạt nhánh MEDICAL", () => {
        const rules = getPronounRules(['Sức Khỏe']);
        expect(rules).toContain('V.MEDICAL');
    });

    it("['Mỹ Thực'] nạp preset CULINARY (miêu tả vị giác)", () => {
        const rules = getPronounRules(['Mỹ Thực']);
        expect(rules).toContain('V.CULINARY');
        expect(rules).toContain('vị giác');
    });

    it("['Khoa Học'] nạp preset SCIENCE", () => {
        const rules = getPronounRules(['Khoa Học']);
        expect(rules).toContain('V.SCIENCE');
        expect(rules).toContain('thuật ngữ chuyên ngành');
    });

    it('3 preset có thể cộng hưởng cùng lúc khi truyện gắn đủ cả 3 thể loại', () => {
        const rules = getPronounRules(['Y Tế', 'Mỹ Thực', 'Khoa Học']);
        expect(rules).toContain('V.MEDICAL');
        expect(rules).toContain('V.CULINARY');
        expect(rules).toContain('V.SCIENCE');
    });

    it('regress: Y Tế + Tu Tiên vẫn có ANCIENT (không bị preset mới che mất tín hiệu cổ trang)', () => {
        const rules = getPronounRules(['Y Tế', 'Tu Tiên']);
        expect(rules).toContain('Phu quân');
        expect(rules).toContain('V.MEDICAL');
    });
});

// FIX (báo cáo người dùng): xưng hô Sư đồ cổ trang mặc định dùng "Con" khiến model có xu hướng
// kéo theo trợ từ cảm thán hiện đại "ạ" cuối câu (VD: "Con biết rồi ạ") — phá vỡ văn phong cổ
// trang/tiên hiệp trang trọng. Đổi mặc định đồ đệ tự xưng "Đệ tử" (chỉ dùng "Con" khi truyện đã
// xây dựng rõ quan hệ cha-con đặc biệt) + cấm tường minh trợ từ "ạ" trong hội thoại Cổ Trang.
describe('getPronounRules — xưng hô Sư đồ Cổ Trang không kéo theo trợ từ hiện đại "ạ"', () => {
    it('ANCIENT: đồ đệ mặc định tự xưng "Đệ tử", không còn ưu tiên "Con" làm mặc định', () => {
        const rules = getPronounRules(['Tiên Hiệp']);
        expect(rules).toContain('MẶC ĐỊNH đồ đệ tự xưng "Đệ tử"');
        expect(rules).not.toContain('Ưu tiên dùng "Con"');
    });

    it('ANCIENT: cấm tường minh trợ từ "ạ" cuối câu trong hội thoại cổ trang', () => {
        const rules = getPronounRules(['Cổ Đại']);
        expect(rules).toContain('CẤM trợ từ cảm thán hiện đại cuối câu');
        expect(rules).toContain('"ạ"');
    });
});
