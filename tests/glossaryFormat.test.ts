import { describe, it, expect } from 'vitest';
import { parseGlossary, serializeGlossary } from '../src/utils/text/glossaryFormat';

describe('parseGlossary', () => {
    it('parse dòng chuẩn "[key] = value"', () => {
        const rows = parseGlossary('[Lâm Phàm] = Lam Pham');
        expect(rows).toHaveLength(1);
        expect(rows[0].key).toBe('Lâm Phàm');
        expect(rows[0].value).toBe('Lam Pham');
        expect(rows[0].isComment).toBe(false);
    });

    it('giữ value chứa dấu "=" (split chỉ lấy phần key đầu)', () => {
        const rows = parseGlossary('[a] = b=c=d');
        expect(rows[0].value).toBe('b=c=d');
    });

    it('dòng # và // là comment, giữ nguyên text', () => {
        const rows = parseGlossary('# ghi chú\n// chú thích 2');
        expect(rows[0].isComment).toBe(true);
        expect(rows[0].key).toBe('# ghi chú');
        expect(rows[1].key).toBe('// chú thích 2');
    });

    it('dòng không có dấu "=" coi như comment', () => {
        const rows = parseGlossary('đoạn lạc lõng');
        expect(rows[0].isComment).toBe(true);
    });

    it('mỗi dòng có ID duy nhất', () => {
        const rows = parseGlossary('[a]=1\n[b]=2');
        expect(rows[0].id).not.toBe(rows[1].id);
    });
});

describe('serializeGlossary', () => {
    it('round-trip giữ nguyên dữ liệu hợp lệ', () => {
        const src = '[Lâm Phàm] = Lam Pham\n[Hàn Lập] = Han Lap';
        const back = serializeGlossary(parseGlossary(src));
        expect(back).toBe(src);
    });

    it('comment được nối lại nguyên văn', () => {
        const src = '# tiêu đề\n[a] = b';
        const back = serializeGlossary(parseGlossary(src));
        expect(back).toBe(src);
    });
});
