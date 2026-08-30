import { describe, it, expect } from 'vitest';
import { extractLatestStreamUpdate, getRatioMultiplier, parseFinalResults } from '../src/services/workflows/translate/streamTranslate';

// Test hồi quy cho parser stream dùng chung (tái cấu trúc R3): đảm bảo mọi nhánh
// DeepSeek/Gemini nhận hành vi parse THỐNG NHẤT và đúng như bản gốc.
const files = [
    { id: 'file-a', content: 'AAAA' },
    { id: 'file-b', content: 'BBBB' },
    { id: 'file-c', content: 'CCCC' },
];
const idMap = new Map([['part_1', 'file-a'], ['part_2', 'file-b'], ['part_3', 'file-c']]);

describe('extractLatestStreamUpdate', () => {
    it('trích nội dung của thẻ part mới nhất, bỏ end-tag', () => {
        const acc = '[[[part_1]]]\nNội dung chương một [[[/part_1]]]';
        const r = extractLatestStreamUpdate(acc, files, idMap);
        expect(r).not.toBeNull();
        expect(r!.realId).toBe('file-a');
        expect(r!.content.trim()).toBe('Nội dung chương một');
    });

    it('ưu tiên SỐ THỰC trong tag thay vì vị trí xuất hiện (tag part_3 -> file thứ 3)', () => {
        const acc = '[[[part_1]]]\nx [[[/part_1]]]\n[[[part_3]]]\nnội dung c';
        const r = extractLatestStreamUpdate(acc, files, idMap);
        expect(r!.realId).toBe('file-c');
    });

    it('nội dung bị cắt tại start-tag kế tiếp khi AI quên end-tag', () => {
        const acc = '[[[part_1]]]\nphần đầu\n[[[part_2]]]\nphần sau';
        const r = extractLatestStreamUpdate(acc, files, idMap);
        expect(r!.realId).toBe('file-b');
        expect(r!.content.trim()).toBe('phần sau');
    });

    it('hỗ trợ tag dạng XML <part_1>', () => {
        const acc = '<part_1>\nhello</part_1>';
        const r = extractLatestStreamUpdate(acc, files, idMap);
        expect(r!.realId).toBe('file-a');
        expect(r!.content.trim()).toBe('hello');
    });

    it('tag hỏng không đọc được số -> fallback theo vị trí xuất hiện', () => {
        // part_x không khớp regex số -> tag này không được tính; dùng accumulator có 2 tag hợp lệ
        const acc2 = '[[[part_9]]]\na\n[[[part_2]]]\nb';
        // part_9 vượt số file (chỉ 3) -> numeric fail -> idMap miss -> fallback vị trí thứ 2
        const r = extractLatestStreamUpdate(acc2, files, idMap);
        expect(r!.realId).toBe('file-b');
    });

    it('trả null khi chưa có tag nào', () => {
        expect(extractLatestStreamUpdate('chưa có gì', files, idMap)).toBeNull();
    });
});

describe('getRatioMultiplier', () => {
    it('mặc định 5 khi không có ratioLimits', () => {
        expect(getRatioMultiplier(undefined)).toBe(5);
        expect(getRatioMultiplier({} as any)).toBe(5);
    });
    it('dùng cn.max + 1 khi hợp lệ', () => {
        expect(getRatioMultiplier({ cn: { max: 6.2 } } as any)).toBeCloseTo(7.2);
    });
    it('số không hợp lệ -> fallback 6.2 + 1', () => {
        expect(getRatioMultiplier({ cn: { max: NaN } } as any)).toBeCloseTo(7.2);
    });
});


describe('parseFinalResults (R-B)', () => {
    const files = [{ id: 'a', content: 'AAAA' }, { id: 'b', content: 'BBBB' }];
    const idMap = new Map([['part_1', 'a'], ['part_2', 'b']]);
    const noopUpdate = () => {};

    it('2 part hoàn chỉnh -> đủ results + completedFileIds', () => {
        const acc = '[[[part_1]]]\nBản A [[[/part_1]]]\n[[[part_2]]]\nBản B [[[/part_2]]]';
        const out = parseFinalResults(acc, files, idMap, undefined, true, false, noopUpdate);
        expect(out.results.get('a')).toContain('Bản A');
        expect(out.completedFileIds.has('a')).toBe(true);
        expect(out.completedFileIds.has('b')).toBe(true);
        expect(out.hybridRecoveredIds.size).toBe(0);
    });

    it('file cuối quên end-tag + stream kết thúc tự nhiên -> coi là hoàn chỉnh', () => {
        const acc = '[[[part_1]]]\nA1 [[[/part_1]]]\n[[[part_2]]]\nB1';
        const out = parseFinalResults(acc, files, idMap, undefined, true, false, noopUpdate);
        expect(out.results.has('b')).toBe(true);
        expect(out.completedFileIds.has('b')).toBe(true);
    });

    it('hitMaxTokensCutoff=true: file cuối có nội dung nhưng KHÔNG hoàn chỉnh', () => {
        const acc = '[[[part_1]]]\nA1 [[[/part_1]]]\n[[[part_2]]]\nB1';
        const out = parseFinalResults(acc, files, idMap, undefined, true, true, noopUpdate);
        expect(out.results.has('b')).toBe(true);
        expect(out.completedFileIds.has('b')).toBe(false);
    });

    it('AI gộp nhầm không tag nào -> Hybrid split khôi phục + warning header + log RECOVERY', () => {
        const acc = 'Đoạn một của truyện.\n\nĐoạn hai tiếp theo.\n\nĐoạn ba kết thúc.';
        const logs = [];
        const out = parseFinalResults(acc, files, idMap, undefined, true, true, noopUpdate, (m) => logs.push(m));
        expect(out.results.size).toBe(2);
        expect(out.hybridRecoveredIds.has('a')).toBe(true);
        expect(out.hybridRecoveredIds.has('b')).toBe(true);
        expect(out.results.get('a')).toContain('[CẢNH BÁO BỞI AI STUDIO');
        expect(logs.some(l => l.includes('BATCH RECOVERY'))).toBe(true);
    });

    it('tag trùng số -> giữ bản đầu, bỏ bản sau + log cảnh báo trùng', () => {
        const acc = '[[[part_1]]]\nBẢN ĐẦU [[[/part_1]]]\n[[[part_1]]]\nBẢN SAU [[[/part_1]]]';
        const logs = [];
        const out = parseFinalResults(acc, files, idMap, undefined, true, false, noopUpdate, (m) => logs.push(m));
        expect(out.results.get('a')).toContain('BẢN ĐẦU');
        expect(out.results.get('a')).not.toContain('BẢN SAU');
        expect(logs.some(l => l.includes('trùng tag'))).toBe(true);
    });
});
