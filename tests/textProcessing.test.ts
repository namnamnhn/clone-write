import { describe, it, expect } from 'vitest';
import { formatBookStyle } from '../src/utils/text';
import { countForeignChars } from '../src/utils/text/analysis';
import { splitLargeChapter } from '../src/utils/text/chapterSplitter';
import { detectSplitChapterGroup, mergeSplitChapterGroup } from '../src/utils/text/chapterMerger';
import { pickRepairModels } from '../src/services/api/rescueModels';
import { extractGlossaryBlocks, deduplicateDictionary } from '../src/utils/text';
import { chunkTextByFileBoundary, reconcileStaleRawCount } from '../src/utils/fileHelpers';
import { FileStatus } from '../src/types';

describe('formatBookStyle — chuẩn hoá dấu nháy (regress #7)', () => {
    it('apostrophe trong từ KHÔNG bị nuốt thành cặp nháy', () => {
        const input = "Jack's knife hit Jill's arm.";
        const out = formatBookStyle(input, input, false);
        expect(out).not.toContain('“s');
        expect(out).toContain("Jack's");
        expect(out).toContain("Jill's");
    });

    it('cặp nháy đơn trích dẫn thật vẫn được chuẩn hoá', () => {
        const input = "'Xin chào!' hắn nói.";
        const out = formatBookStyle(input, input, false);
        expect(out).toContain('“Xin chào!”');
    });

    it('nháy kép ghép cặp gần nhất (lazy), không gộp cả dòng', () => {
        const input = '"A" và "B"';
        const out = formatBookStyle(input, input, false);
        expect(out).toContain('“A”');
        expect(out).toContain('“B”');
        expect(out).not.toContain('"');
    });
});

describe('countForeignChars', () => {
    it('đếm CJK/Kana/Hangul/Cyrillic/Thai', () => {
        expect(countForeignChars('你好')).toBe(2);
        expect(countForeignChars('こんにちは')).toBe(5);
        expect(countForeignChars('tiếng Việt thuần')).toBe(0);
        expect(countForeignChars('mix 你好 text')).toBe(2);
    });
});

describe('splitLargeChapter (regress #20)', () => {
    const makeFile = (content: string): any => ({
        id: 'f1',
        name: 'Chương 1.txt',
        content,
        translatedContent: null,
        status: 'IDLE',
        remainingRawCharCount: 0,
        retryCount: 0,
    });

    it('file ngắn -> trả lại nguyên file', () => {
        const f = makeFile('ngắn');
        expect(splitLargeChapter(f, 10000)).toEqual([f]);
    });

    it('file dài -> tách thành nhiều phần tên "(1)(2)", đủ nội dung', () => {
        const para = 'Nội dung đoạn văn mẫu với vài chục ký tự ở đây.\n\n';
        const big = 'Chương Thử Nghiệm\n\n' + para.repeat(120); // ~7KB
        const parts = splitLargeChapter(makeFile(big), 2000);
        expect(parts.length).toBeGreaterThanOrEqual(2);
        expect(parts[0].name).toContain('(1)');
        expect(parts[1].name).toContain('(2)');
        const joined = parts.map(p => p.content).join('\n');
        for (const line of big.split('\n')) {
            if (!line.trim()) continue;
            expect(joined).toContain(line.trim().slice(0, 12));
        }
        // File chưa dịch: remainingRawCharCount phải là số ký tự CJK (0), KHÔNG phải tổng độ dài
        expect(parts.every(p => p.remainingRawCharCount === countForeignChars(p.content))).toBe(true);
    });

    // Regress bug "Gộp File không ghép chuẩn các file bị tách chương nữa": file gốc có phần mở
    // rộng (.txt) trong `name` — trước fix53, suffix " (N)" bị nối vào SAU phần mở rộng
    // ("Chương 1.txt (1)"), khiến chapterMerger.ts hiểu nhầm "txt (1)" là extension và không còn
    // nhận diện được đây là nhóm file tách chương -> "Gộp File" bó tay, không ghép lại được.
    it('file tách ra (name có .txt) phải được chapterMerger nhận diện lại đúng nhóm và ghép lại y hệt tên gốc', () => {
        const para = 'Nội dung đoạn văn mẫu với vài chục ký tự ở đây.\n\n';
        const big = 'Chương Thử Nghiệm\n\n' + para.repeat(120);
        const original = makeFile(big); // name: 'Chương 1.txt'
        const parts = splitLargeChapter(original, 2000);
        expect(parts.length).toBeGreaterThanOrEqual(2);

        // Tên phần tách ra phải giữ đúng đuôi .txt Ở CUỐI, suffix " (N)" chèn TRƯỚC đuôi.
        for (const p of parts) {
            expect(p.name).toMatch(/^Chương 1 \(\d+\)\.txt$/);
        }

        // chapterMerger.ts phải nhận diện đây là 1 nhóm file bị tách (cùng base "Chương 1").
        const group = detectSplitChapterGroup(parts);
        expect(group).not.toBeNull();
        expect(group!.length).toBe(parts.length);

        // Ghép lại phải cho đúng tên file gốc (đuôi .txt vẫn ở cuối, không còn hậu tố " (N)").
        const merged = mergeSplitChapterGroup(group!);
        expect(merged.name).toBe('Chương 1.txt');
    });
});

describe('pickRepairModels (tái cấu trúc R2)', () => {
    const cfg = {
        enabledModels: ['gemini-3.5-flash'],
        deepseekKey: 'd',
        deepseekModel: 'deepseek-v4-flash',
    };

    it('không có file vệ tinh -> giữ nguyên enabledModels', () => {
        expect(pickRepairModels([{ usedModel: 'gemini-3.5-flash' }], cfg)).toEqual(['gemini-3.5-flash']);
    });

    it('có file DeepSeek -> map toàn bộ model deepseek đã chọn', () => {
        const r = pickRepairModels([{ usedModel: 'deepseek:deepseek-v4-flash' }], cfg);
        expect(r).toEqual(['deepseek:deepseek-v4-flash']);
    });
});

describe('chunkTextByFileBoundary (fix55 — tránh cắt ngang thân 1 chương giữa 2 batch)', () => {
    it('gộp nhiều file nhỏ vào chung 1 chunk nếu chưa vượt giới hạn', () => {
        const files = [{ text: 'A'.repeat(100) }, { text: 'B'.repeat(100) }, { text: 'C'.repeat(100) }];
        const chunks = chunkTextByFileBoundary(files, 1000);
        expect(chunks.length).toBe(1);
        expect(chunks[0]).toContain('A'.repeat(100));
        expect(chunks[0]).toContain('C'.repeat(100));
    });

    it('KHÔNG bao giờ cắt ngang thân 1 file khi tổng vượt giới hạn — chỉ tách ở ranh giới giữa 2 file', () => {
        // 3 "chương" mỗi chương 400 ký tự, giới hạn 500 -> mỗi chunk chỉ chứa nguyên vẹn 1 chương,
        // không có chunk nào chứa nửa chương này + nửa chương kia.
        const chap1 = 'Chương Một: ' + 'x'.repeat(390);
        const chap2 = 'Chương Hai: ' + 'y'.repeat(390);
        const chap3 = 'Chương Ba: ' + 'z'.repeat(390);
        const chunks = chunkTextByFileBoundary([{ text: chap1 }, { text: chap2 }, { text: chap3 }], 500);

        expect(chunks.length).toBe(3);
        // Mỗi chunk chứa TRỌN VẸN đúng 1 chương, không bị xé đôi giữa 2 chunk.
        expect(chunks[0]).toBe(chap1);
        expect(chunks[1]).toBe(chap2);
        expect(chunks[2]).toBe(chap3);
    });

    it('file đơn lẻ lớn hơn cả giới hạn: buộc phải cắt nội bộ, nhưng ưu tiên ranh giới đoạn văn (\\n\\n) thay vì cắt cứng giữa câu', () => {
        const paragraph = 'Đoạn văn dài. '.repeat(50); // ~700 ký tự, không có \n\n bên trong
        const hugeFile = paragraph + '\n\n' + paragraph; // 1 file gồm 2 đoạn văn, tổng > giới hạn
        const chunks = chunkTextByFileBoundary([{ text: hugeFile }], paragraph.length + 100);

        expect(chunks.length).toBe(2);
        // Điểm cắt phải rơi đúng vào ranh giới đoạn văn (\n\n), không cắt giữa câu.
        expect(chunks[0]).toBe(paragraph);
        expect(chunks[1]).toBe(paragraph);
    });

    it('bỏ qua file rỗng, không tạo chunk thừa', () => {
        const chunks = chunkTextByFileBoundary([{ text: '' }, { text: 'Nội dung thật' }, { text: '' }], 1000);
        expect(chunks).toEqual(['Nội dung thật']);
    });
});

describe('rolling dictionary (fix55 — phần phân tích sau "thấy" được phần trước)', () => {
    it('extractGlossaryBlocks lấy đúng các mục [Key] = Value từ kết quả phân tích thô', () => {
        const raw = `# === [1. NHÂN VẬT / CHARACTERS] ===\n[Trần Phong] = Trần Phong\n[Lâm Y Nhi] = Lâm Y Nhi\nMột dòng mô tả không phải mục từ điển.`;
        const dict = extractGlossaryBlocks(raw);
        expect(dict).toContain('Trần Phong=Trần Phong');
        expect(dict).toContain('Lâm Y Nhi=Lâm Y Nhi');
    });

    it('gộp từ điển cũ + từ điển rút ra từ phần vừa phân tích, loại trùng theo Key, giữ bản ghi đầu', () => {
        const oldDict = 'Trần Phong=Trần Phong (nhân vật chính)';
        const newlyAnalyzed = `[Trần Phong] = Trần Phong (bản mới, không nên ghi đè)\n[Lâm Y Nhi] = Lâm Y Nhi`;
        const merged = deduplicateDictionary(`${oldDict}\n${extractGlossaryBlocks(newlyAnalyzed)}`);

        // Key trùng (Trần Phong) -> giữ bản ghi ĐẦU TIÊN (từ điển cũ), không bị bản phân tích
        // phần sau ghi đè mất mô tả đã có.
        expect(merged).toContain('Trần Phong=Trần Phong (nhân vật chính)');
        expect(merged).not.toContain('bản mới, không nên ghi đè');
        // Nhân vật MỚI (chỉ xuất hiện ở phần sau) vẫn được thêm vào.
        expect(merged).toContain('Lâm Y Nhi=Lâm Y Nhi');
    });
});

describe('reconcileStaleRawCount (fix56 — bug "app bê nguyên raw file gốc lên badge Sót Raw")', () => {
    const baseFile = (overrides: Partial<import('../src/types').FileItem>) => ({
        id: 'f1', name: 'test.txt', content: '第一章 你好世界', originalCharCount: 8,
        translatedContent: null, status: FileStatus.IDLE, retryCount: 0, remainingRawCharCount: 0,
        ...overrides,
    }) as import('../src/types').FileItem;

    it('sửa lại remainingRawCharCount khi nó bị kẹt bằng nguyên độ dài raw dù bản dịch đã sạch', () => {
        const cleanVietnamese = 'Xin chào thế giới, đây là bản dịch hoàn chỉnh và sạch sẽ.';
        const files = [baseFile({
            status: FileStatus.COMPLETED,
            translatedContent: cleanVietnamese,
            // Giá trị SAI kẹt lại: bằng đúng originalCharCount (độ dài raw gốc), y hệt bug thật.
            remainingRawCharCount: 8,
        })];
        const fixed = reconcileStaleRawCount(files);
        expect(fixed[0].remainingRawCharCount).toBe(countForeignChars(cleanVietnamese));
        expect(fixed[0].remainingRawCharCount).toBe(0); // Vietnamese thuần -> sạch hoàn toàn.
    });

    it('không đổi gì nếu remainingRawCharCount đã đúng (idempotent, tránh re-render thừa)', () => {
        const cleanVietnamese = 'Bản dịch đã đúng từ trước.';
        const files = [baseFile({
            status: FileStatus.COMPLETED,
            translatedContent: cleanVietnamese,
            remainingRawCharCount: countForeignChars(cleanVietnamese),
        })];
        const result = reconcileStaleRawCount(files);
        expect(result).toBe(files); // Trả lại chính mảng cũ, không tạo mảng/object mới.
    });

    it('bỏ qua file chưa dịch xong (IDLE/ERROR) hoặc không có translatedContent', () => {
        const files = [
            baseFile({ status: FileStatus.IDLE, translatedContent: null, remainingRawCharCount: 999 }),
            baseFile({ id: 'f2', status: FileStatus.ERROR, translatedContent: null, remainingRawCharCount: 999 }),
        ];
        const result = reconcileStaleRawCount(files);
        expect(result).toBe(files);
        expect(result[0].remainingRawCharCount).toBe(999);
    });

    it('vẫn phát hiện đúng file thật sự còn sót raw (không "sửa" nhầm về 0)', () => {
        const mixedContent = 'Đoạn văn có sót 一些 chữ Hán chưa dịch hết.';
        const files = [baseFile({
            status: FileStatus.COMPLETED,
            translatedContent: mixedContent,
            remainingRawCharCount: 0, // giá trị cũ sai (đáng ra phải > 0)
        })];
        const fixed = reconcileStaleRawCount(files);
        expect(fixed[0].remainingRawCharCount).toBeGreaterThan(0);
        expect(fixed[0].remainingRawCharCount).toBe(countForeignChars(mixedContent));
    });
});
