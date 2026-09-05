import { FileStatus } from '../../types';
import type { FileItem, StoryInfo } from '../../types';
import type { StoryStudioRuntimeProject } from './storyStudioProjectTypes';
import { getCanonicalChapterHistoryEntry } from './storyStudioSession';
import { sanitizeFilename } from '../../utils/file/shared';

export type StoryStudioEpubPublicationErrorCode =
    | 'STORY_STUDIO_EPUB_NO_CANON'
    | 'STORY_STUDIO_EPUB_CANON_INCONSISTENT'
    | 'STORY_STUDIO_EPUB_NOT_DURABLE'
    | 'STORY_STUDIO_EPUB_GENERATION_FAILED';

export class StoryStudioEpubPublicationError extends Error {
    constructor(readonly code: StoryStudioEpubPublicationErrorCode) {
        super(code);
        this.name = 'StoryStudioEpubPublicationError';
    }
}

export interface StoryStudioEpubPublicationChapter {
    readonly chapterNumber: number;
    readonly displayTitle: string;
    readonly text: string;
}

export interface StoryStudioEpubPublicationSnapshot {
    readonly kind: 'story-studio-canon-epub-publication';
    readonly catalogDisplayName: string;
    readonly canonicalChapterCount: number;
    readonly plannedChapterCount: number;
    readonly pendingChapterNumber?: number;
    readonly pendingReadyForCanonReview: boolean;
    readonly chapters: readonly StoryStudioEpubPublicationChapter[];
    readonly files: readonly FileItem[];
    readonly storyInfo: StoryInfo;
}

const publicStoryInfo = (title: string): StoryInfo => ({
    title,
    author: '',
    languages: [],
    genres: [],
    mcPersonality: [],
    worldSetting: [],
    sectFlow: [],
    summary: '',
    enableTitleFormatting: true,
    enableAutoFormat: true,
    epubAllowBlankAuthor: true,
});

const publicationFile = (chapter: StoryStudioEpubPublicationChapter): FileItem => ({
    id: `story-studio-canon-${chapter.chapterNumber}`,
    name: `${String(chapter.chapterNumber).padStart(8, '0')}.txt`,
    content: chapter.text,
    translatedContent: chapter.text,
    epubDisplayTitle: chapter.displayTitle,
    status: FileStatus.COMPLETED,
    retryCount: 0,
    originalCharCount: chapter.text.length,
    remainingRawCharCount: 0,
});

/** Copies only durable public Canon prose/title fields into the legacy EPUB input model. */
export const createStoryStudioEpubPublication = (
    project: StoryStudioRuntimeProject,
    catalogDisplayName: string,
): StoryStudioEpubPublicationSnapshot => {
    const count = project.state.currentChapter;
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new StoryStudioEpubPublicationError('STORY_STUDIO_EPUB_CANON_INCONSISTENT');
    }
    if (count === 0) throw new StoryStudioEpubPublicationError('STORY_STUDIO_EPUB_NO_CANON');
    if (project.memory.records.length !== count || project.chapterMetadata.length !== count) {
        throw new StoryStudioEpubPublicationError('STORY_STUDIO_EPUB_CANON_INCONSISTENT');
    }

    const chapters: StoryStudioEpubPublicationChapter[] = [];
    for (let chapterNumber = 1; chapterNumber <= count; chapterNumber += 1) {
        const entry = getCanonicalChapterHistoryEntry(project, chapterNumber);
        if (!entry || !entry.text.trim()) {
            throw new StoryStudioEpubPublicationError('STORY_STUDIO_EPUB_CANON_INCONSISTENT');
        }
        const title = entry.title?.trim();
        chapters.push({
            chapterNumber,
            displayTitle: `Chương ${chapterNumber}${title ? `: ${title}` : ''}`,
            text: entry.text,
        });
    }

    const pending = project.workflow.stage === 'idle' ? undefined : count + 1;
    return {
        kind: 'story-studio-canon-epub-publication',
        catalogDisplayName,
        canonicalChapterCount: count,
        plannedChapterCount: project.control.engine.plannedChapterCount,
        ...(pending === undefined ? {} : { pendingChapterNumber: pending }),
        pendingReadyForCanonReview: project.workflow.stage === 'ready-for-canon-review',
        chapters,
        files: chapters.map(publicationFile),
        storyInfo: publicStoryInfo(catalogDisplayName),
    };
};

export const storyStudioEpubFilename = (publicTitle: string, catalogDisplayName: string): string => {
    const stem = sanitizeFilename(publicTitle.trim()) || sanitizeFilename(catalogDisplayName) || 'Story Studio Canon';
    return `${stem}.epub`;
};

export const describeStoryStudioEpubPublication = (
    publication: StoryStudioEpubPublicationSnapshot,
): string => {
    const canon = `${publication.canonicalChapterCount} chương Canon sẽ được xuất.`;
    if (publication.pendingChapterNumber === undefined) return `${canon} Chỉ các chương đã Make Canon được đưa vào EPUB.`;
    return publication.pendingReadyForCanonReview
        ? `${canon} Chương ${publication.pendingChapterNumber} đang chờ Make Canon và chưa được đưa vào EPUB.`
        : `${canon} Chương ${publication.pendingChapterNumber} chưa Make Canon và chưa được đưa vào EPUB.`;
};
