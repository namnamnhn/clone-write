import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateEpub } from '../src/utils/file/exporters';
import { DEFAULT_EPUB_DESIGN_OPTIONS, EMPTY_EPUB_DESIGN_ASSETS, FileStatus } from '../src/types';

describe('EPUB cover isolation', () => {
    it('uses one unique cover asset and does not repeat it in the intro page', async () => {
        const cover = new File([new Uint8Array([137, 80, 78, 71])], 'new-cover.png', { type: 'image/png' });
        const blob = await generateEpub(
            [{
                id: 'chapter-1', name: '00001 Chương 1', content: '原文',
                translatedContent: 'Chương 1\n\nNội dung đã dịch.',
                status: FileStatus.COMPLETED, retryCount: 0,
                originalCharCount: 2, remainingRawCharCount: 0,
            }],
            {
                title: 'Truyện mới', author: 'Tác giả', languages: ['Chinese'], genres: ['Đô thị'],
                mcPersonality: [], worldSetting: [], sectFlow: [],
            },
            cover,
            'Tóm tắt mới',
            undefined,
            null,
            { ...DEFAULT_EPUB_DESIGN_OPTIONS, enableCoverPage: true },
            EMPTY_EPUB_DESIGN_ASSETS,
        );
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        const coverAssets = Object.keys(zip.files).filter(name => /^OEBPS\/Images\/cover-[a-f0-9]{12}\./.test(name));
        expect(coverAssets).toHaveLength(1);
        expect(zip.file('OEBPS/Images/cover.jpg')).toBeNull();
        const relativeCover = coverAssets[0].replace('OEBPS/', '');
        const intro = await zip.file('OEBPS/Text/intro.xhtml')!.async('string');
        const coverPage = await zip.file('OEBPS/Text/cover.xhtml')!.async('string');
        expect(intro).not.toContain('<img');
        expect(coverPage).toContain(relativeCover);
    });

    it('preserves legacy title/TOC behavior and embeds fonts, divider, and footnotes in valid EPUB entries', async () => {
        const titleFont = new File([new Uint8Array([0, 1, 2])], 'title.ttf', { type: 'font/ttf' });
        const contentFont = new File([new Uint8Array([3, 4, 5])], 'content.woff2', { type: 'font/woff2' });
        const dividerIcon = new File([new Uint8Array([137, 80, 78, 71])], 'divider.png', { type: 'image/png' });
        const blob = await generateEpub(
            [{
                id: 'legacy-chapter-10', name: '00010.txt', content: '原文',
                translatedContent: 'Chương 10: Tiêu đề cũ\nĐoạn có chú thích [1].\n☆★☆\n[1]: Nội dung chú thích.',
                status: FileStatus.COMPLETED, retryCount: 0,
                originalCharCount: 2, remainingRawCharCount: 0,
            }],
            {
                title: 'Truyện EPUB cũ', author: 'Tác giả cũ', languages: ['Chinese'], genres: ['Lịch sử'],
                mcPersonality: [], worldSetting: [], sectFlow: [],
            },
            null,
            'Tóm tắt',
            undefined,
            null,
            { ...DEFAULT_EPUB_DESIGN_OPTIONS, enableDropCaps: true, enableTitlePage: true },
            { ...EMPTY_EPUB_DESIGN_ASSETS, titleFont, contentFont, dividerIcon },
        );
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        const chapter = await zip.file('OEBPS/Text/ch1.xhtml')!.async('string');
        const nav = await zip.file('OEBPS/Text/nav.xhtml')!.async('string');
        const opf = await zip.file('OEBPS/content.opf')!.async('string');
        const css = await zip.file('OEBPS/Styles/style.css')!.async('string');

        expect(chapter.match(/<h2>Chương 10: Tiêu đề cũ<\/h2>/gi)).toHaveLength(1);
        expect(nav.toLocaleLowerCase('vi')).toContain('chương 10: tiêu đề cũ');
        expect(chapter).toContain('class="noteref"');
        expect(chapter).toContain('epub:type="footnote"');
        expect(chapter).toContain('Nội dung chú thích.');
        expect(chapter).toContain('Images/divider-icon.png');
        expect(zip.file('OEBPS/fonts/title-font.ttf')).not.toBeNull();
        expect(zip.file('OEBPS/fonts/content-font.woff2')).not.toBeNull();
        expect(zip.file('OEBPS/Images/divider-icon.png')).not.toBeNull();
        expect(css).toContain("font-family: 'EpubTitleFont'");
        expect(css).toContain("font-family: 'EpubContentFont'");
        expect(opf).toContain('<dc:creator>Tác giả cũ</dc:creator>');
        expect(opf).toContain('media-type="font/ttf"');
        expect(opf).toContain('media-type="font/woff2"');
    });
});
