import { describe, it, expect } from 'vitest';
import { optimizeContext, dedupeContextAgainstDictionary } from '../src/utils/text/optimization';

// FIX61: bộ test cho lọc ngữ cảnh thông minh theo batch — chống "batch nhỏ mà kèm cả
// chục nghìn ký tự mục từ điển không liên quan (trùng [DICT])" gây loạn model -> MAX_TOKENS.
describe('optimizeContext — lọc dòng kiểu từ điển bên trong khối được giữ', () => {
    const bible = `Giới thiệu chung về Series Bible.

# === [1. NHÂN VẬT] ===
[林墨] = Lâm Mặc (Nam chính)
[宁曦] = Ninh Hi (Nữ chính)
[赵灵韵] / [赵灵儿] = Triệu Linh Vận / Triệu Linh Nhi

# 3. NGỮ CẢNH & SỰ KIỆN
1. **Sự kiện khởi đầu:** 林墨 cào trúng vé số đặc biệt, từ vô danh trở thành người chơi ẩn danh mạnh nhất server.`;

    it('giữ mục có Key xuất hiện trong batch, xoá mục Key không xuất hiện', () => {
        const batchContent = '林墨 nhìn xuống tay mình.';
        const out = optimizeContext(bible, batchContent);
        expect(out).toContain('[林墨] = Lâm Mặc (Nam chính)');
        expect(out).not.toContain('Ninh Hi');
        // dòng đa khóa: chỉ cần 1 trong các Key xuất hiện là giữ
        expect(out).not.toContain('Triệu Linh Vận');
    });

    it('không đụng tới dòng prose có keyword khớp (chỉ dòng kiểu từ điển mới bị lọc theo key)', () => {
        const ctx = `Quy tắc dịch bắt buộc.

1. **Sự kiện khởi đầu:** 林墨 nhặt được kiếm thần. Câu này dài hơn hai trăm ký tự để vượt ngưỡng giữ khối: hệ thống phải luôn coi đây là nội dung mô tả cốt truyện, tuyệt đối không bị xoá bỏ khi lọc ngữ cảnh theo batch vì đây là phần prose mô tả diễn biến chính của chương hiện tại đang cần dịch.`;
        const out = optimizeContext(ctx, '林墨 đi vào rừng');
        expect(out).toContain('Sự kiện khởi đầu');
    });

    it('luôn giữ khối đầu tiên (hướng dẫn chung) kể cả khi không có keyword', () => {
        const ctx = `Đây là phần mở đầu tổng quan của tài liệu ngữ cảnh luôn phải được giữ lại.`;
        const out = optimizeContext(ctx, 'batch content');
        expect(out).toContain('luôn phải được giữ lại');
    });

    it('giữ ma trận xưng hô dùng tên Việt khi raw batch chỉ chứa key gốc', () => {
        const ctx = `Tổng quan bắt buộc cho mọi batch.

# MA TRẬN XƯNG HÔ
Lâm Mặc → Ninh Hi: anh/em khi riêng tư; tôi/cô trước người lạ.`;
        const raw = '林墨 nhìn về phía cánh cửa rồi lên tiếng.';
        const relevantDictionary = '林墨=Lâm Mặc (Nam chính)';

        expect(optimizeContext(ctx, raw)).not.toContain('MA TRẬN XƯNG HÔ');
        expect(optimizeContext(ctx, raw, relevantDictionary)).toContain('MA TRẬN XƯNG HÔ');
    });

    it('xoá hẳn khối chỉ toàn mục từ điển không liên quan tới batch', () => {
        const ctx = `Mở đầu.

# VẬT PHẨM
[碎世·流光剑] = Toái Thế Lưu Quang Kiếm
[勇者风衣] = Áo Khoác Dũng Giả`;
        const out = optimizeContext(ctx, '林墨 đi vào rừng.');
        expect(out).not.toContain('Lưu Quang Kiếm');
        expect(out).not.toContain('Áo Khoác Dũng Giả');
    });

    it('trần ngân sách ký tự: cắt bớt khối điểm thấp khi ngữ cảnh phình to, giữ thứ tự gốc', () => {
        // content ~2.2k chars -> ngân sách = max(16000, ...) = 16000; 10 khối prose ~2.4k chars
        // mỗi khối (đều chứa "Lâm Mặc" nên đều relevant), tổng ~24k vượt trần -> phải cắt.
        const blocks: string[] = ['Khối tổng quan mở đầu luôn giữ.'];
        for (let i = 0; i < 10; i++) {
            blocks.push(`Mô tả số ${i} về hành trình của Lâm Mặc xuyên qua khu rừng ${'rậm '.repeat(400)}`);
        }
        const ctx = blocks.join('\n\n');
        const content = 'Lâm Mặc chiến đấu.'.repeat(120);
        const out = optimizeContext(ctx, content);
        expect(out.length).toBeLessThanOrEqual(16000);
        expect(out).toContain('Khối tổng quan mở đầu luôn giữ.');
        expect(out).toContain('Mô tả số 0');
        // khối cuối điểm bằng khối đầu nhưng không vừa ngân sách -> bị bỏ
        expect(out).not.toContain('Mô tả số 9');
        // các khối được chọn vẫn giữ thứ tự gốc
        expect(out.indexOf('số 0')).toBeLessThan(out.indexOf('số 5'));
    });
});

describe('dedupeContextAgainstDictionary — đừng gửi 1 thông tin 2 lần ([DICT] + [CTX])', () => {
    const dict = '林墨=Lâm Mặc (Nam chính)\n灵魂之火=Ngọn Lửa Linh Hồn';

    it('xoá dòng ngữ cảnh TRÙNG ĐÚC giá trị từ điển (kể cả có markdown bold)', () => {
        const ctx = `# NHÂN VẬT
**[林墨]** = Lâm Mặc (Nam chính)
[灵魂之火] = Ngọn Lửa Linh Hồn`;
        const out = dedupeContextAgainstDictionary(ctx, dict);
        expect(out).not.toContain('Lâm Mặc');
        expect(out).not.toContain('Ngọn Lửa Linh Hồn');
    });

    it('giữ dòng có thông tin riêng (|| vai trò bổ sung) và dòng không có trong từ điển', () => {
        const ctx = `# QUAN HỆ
**[林墨]** = Lâm Mặc || (Minh chủ Đại Hạ - chỉ có ở đây)
[新术语] = Thuật Ngữ Mới`;
        const out = dedupeContextAgainstDictionary(ctx, dict);
        expect(out).toContain('Minh chủ Đại Hạ');
        expect(out).toContain('Thuật Ngữ Mới');
    });

    it('giữ nguyên khối prose không phải dạng key=value', () => {
        const ctx = 'Ghi chú xưng hô: dùng "ta" khi nói chuyện với kẻ địch.';
        const out = dedupeContextAgainstDictionary(ctx, dict);
        expect(out).toBe(ctx);
    });
});
