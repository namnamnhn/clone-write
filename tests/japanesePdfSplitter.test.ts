import { describe, expect, it } from 'vitest';
import { splitContentByRegex } from '../src/utils/file/splitters';

const horizontalJapaneseSample = `１４７：サクリファイス
気持ちの良い夜風が吹いており、空には無数の星々が輝いている。
集合時刻は１２：３０と伝えられた。これは時刻であり、章見出しではない。
物語の本文がここからさらに続いて、十分な長さを持つ。

１４８：奪われた初代魔王の核
洞窟の入口は複数あり、迷路の奥から微かな足音が聞こえてきた。
二つ目の章にも十分な本文があり、正しく別ファイルになる。`;

describe('fix80 — PDF Nhật ngang có tiêu đề số + dấu ：', () => {
    it('Smart Regex nhận đúng hai chương và không tách nhầm dòng giờ １２：３０', () => {
        const files = splitContentByRegex(horizontalJapaneseSample, undefined, false);
        expect(files).toHaveLength(2);
        expect(files[0].content).toContain('１２：３０');
        expect(files[1].content).toContain('奪われた初代魔王の核');
    });

    it('preset Syosetu nhận cả dấu :/： nhưng loại mẫu giờ có số ngay sau dấu', () => {
        const preset = '^(?:[#＃][0-9０-９]+|第\\s*[0-9０-９]+\\s*[話章幕節]|[0-9０-９]+\\s*(?:[.．](?![\\s]*["\'“‘«「『【《])|[:：](?=\\s*[^\\s0-9０-９])))\\s*.*$';
        expect(new RegExp(preset, 'im').test('１４７：サクリファイス')).toBe(true);
        expect(new RegExp(preset, 'im').test('147: Sacrifice')).toBe(true);
        expect(new RegExp(preset, 'im').test('１２：３０')).toBe(false);
    });
});
