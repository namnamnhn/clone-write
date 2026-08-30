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
});
