import type {
    StoryStudioProjectDocumentV1,
    StoryStudioRuntimeProject,
} from './storyStudioProjectTypes';
import {
    parseStoryStudioProjectDocument,
    withoutRuntimeControl,
} from './storyStudioProjectRuntime';

export const STORY_STUDIO_CONTINUATION_BACKUP_KIND = 'story-studio-continuation-backup';
export const STORY_STUDIO_CONTINUATION_BACKUP_FORMAT_VERSION = 1;
/**
 * A continuation file includes Canon, memory, history, and checkpoint artifacts. 64 MiB gives
 * long-running novels substantially more room than the 2 MiB Setup limit while bounding the
 * one-shot browser read/parse required by this deliberately simple offline format.
 */
export const STORY_STUDIO_CONTINUATION_BACKUP_MAX_BYTES = 64 * 1024 * 1024;

export interface StoryStudioContinuationBackupV1 {
    readonly kind: typeof STORY_STUDIO_CONTINUATION_BACKUP_KIND;
    readonly formatVersion: typeof STORY_STUDIO_CONTINUATION_BACKUP_FORMAT_VERSION;
    readonly exportedAt: string;
    readonly catalogDisplayName: string;
    readonly project: StoryStudioProjectDocumentV1;
}

export interface ParsedStoryStudioContinuationBackup {
    readonly backup: StoryStudioContinuationBackupV1;
    readonly project: StoryStudioRuntimeProject;
}

export type StoryStudioContinuationBackupErrorCode =
    | 'CONTINUATION_BACKUP_EMPTY'
    | 'CONTINUATION_BACKUP_TOO_LARGE'
    | 'CONTINUATION_BACKUP_MALFORMED_JSON'
    | 'CONTINUATION_BACKUP_WRONG_KIND'
    | 'CONTINUATION_BACKUP_UNSUPPORTED_VERSION'
    | 'CONTINUATION_BACKUP_INVALID'
    | 'CONTINUATION_BACKUP_WORKFLOW_NOT_EXACT'
    | 'CONTINUATION_RESTORE_NOT_ALLOWED';

export class StoryStudioContinuationBackupError extends Error {
    constructor(readonly code: StoryStudioContinuationBackupErrorCode) {
        super(code);
        this.name = 'StoryStudioContinuationBackupError';
    }
}

type UnknownRecord = Record<string, unknown>;

const exactObject = (value: unknown, keys: readonly string[]): UnknownRecord => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_INVALID');
    }
    const input = value as UnknownRecord;
    if (Object.keys(input).some(key => !keys.includes(key))) {
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_INVALID');
    }
    return input;
};

const nonEmptyText = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_INVALID');
    }
    return value;
};

const isoDate = (value: unknown): string => {
    const result = nonEmptyText(value);
    if (!Number.isFinite(Date.parse(result))) {
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_INVALID');
    }
    return result;
};

export const assertStoryStudioContinuationBackupFileSize = (size: number): void => {
    if (!Number.isSafeInteger(size) || size <= 0) {
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_EMPTY');
    }
    if (size > STORY_STUDIO_CONTINUATION_BACKUP_MAX_BYTES) {
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_TOO_LARGE');
    }
};

const exactProject = (value: unknown): ReturnType<typeof parseStoryStudioProjectDocument> => {
    try {
        const parsed = parseStoryStudioProjectDocument(value);
        if (parsed.workflowRecovered) {
            throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_WORKFLOW_NOT_EXACT');
        }
        return parsed;
    } catch (error) {
        if (error instanceof StoryStudioContinuationBackupError) throw error;
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_INVALID');
    }
};

export const createStoryStudioContinuationBackup = (
    project: StoryStudioRuntimeProject,
    catalogDisplayName: string,
    exportedAt: string,
): StoryStudioContinuationBackupV1 => {
    const parsed = exactProject(withoutRuntimeControl(project));
    return {
        kind: STORY_STUDIO_CONTINUATION_BACKUP_KIND,
        formatVersion: STORY_STUDIO_CONTINUATION_BACKUP_FORMAT_VERSION,
        exportedAt: isoDate(exportedAt),
        catalogDisplayName: nonEmptyText(catalogDisplayName),
        project: withoutRuntimeControl(parsed.project),
    };
};

export const parseStoryStudioContinuationBackup = (
    value: unknown,
): ParsedStoryStudioContinuationBackup => {
    const input = exactObject(value, ['kind', 'formatVersion', 'exportedAt', 'catalogDisplayName', 'project']);
    if (input.kind !== STORY_STUDIO_CONTINUATION_BACKUP_KIND) {
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_WRONG_KIND');
    }
    if (input.formatVersion !== STORY_STUDIO_CONTINUATION_BACKUP_FORMAT_VERSION) {
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_UNSUPPORTED_VERSION');
    }
    const parsed = exactProject(input.project);
    const backup: StoryStudioContinuationBackupV1 = {
        kind: STORY_STUDIO_CONTINUATION_BACKUP_KIND,
        formatVersion: STORY_STUDIO_CONTINUATION_BACKUP_FORMAT_VERSION,
        exportedAt: isoDate(input.exportedAt),
        catalogDisplayName: nonEmptyText(input.catalogDisplayName),
        project: withoutRuntimeControl(parsed.project),
    };
    return { backup, project: parsed.project };
};

export const serializeStoryStudioContinuationBackup = (
    backup: StoryStudioContinuationBackupV1,
): string => `${JSON.stringify(parseStoryStudioContinuationBackup(backup).backup, null, 2)}\n`;

export const parseStoryStudioContinuationBackupJson = (
    source: string,
    declaredByteSize = new TextEncoder().encode(source).byteLength,
): ParsedStoryStudioContinuationBackup => {
    assertStoryStudioContinuationBackupFileSize(declaredByteSize);
    assertStoryStudioContinuationBackupFileSize(new TextEncoder().encode(source).byteLength);
    let value: unknown;
    try {
        value = JSON.parse(source);
    } catch {
        throw new StoryStudioContinuationBackupError('CONTINUATION_BACKUP_MALFORMED_JSON');
    }
    return parseStoryStudioContinuationBackup(value);
};

export const sanitizeStoryStudioContinuationBackupFilename = (displayName: string): string => {
    const withoutControlCharacters = [...displayName]
        .map(character => character.charCodeAt(0) < 32 ? '-' : character)
        .join('');
    const stem = withoutControlCharacters
        .normalize('NFKC')
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 96) || 'story-studio-project';
    return `${stem}-continuation-backup-v1.json`;
};

export const downloadStoryStudioContinuationBackup = (filename: string, source: string): void => {
    const blob = new Blob([source], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
};
