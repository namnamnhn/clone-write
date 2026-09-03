import {
    compileStoryControl,
    parseStoryBlueprintDocument,
    parseStoryBlueprintJson,
} from '../../storyEngine';
import type { StoryBlueprintDocument } from '../../storyEngine';
import { compileStorySetupWithGemini } from '../../services/storyEngine/geminiStorySetupCompiler';
import type { CompileStorySetupRequest, StorySetupCompilerResult } from '../../services/storyEngine/geminiStorySetupCompiler';

export const MAX_AUTHOR_SETUP_SOURCE_BYTES = 2 * 1024 * 1024;

export class StorySetupImportError extends Error {
    constructor(readonly code: 'SETUP_SOURCE_SIZE_INVALID' | 'UNSUPPORTED_SETUP_FILE') {
        super(code);
        this.name = 'StorySetupImportError';
    }
}

export type StorySetupImportIssueCode =
    | 'PLANNED_CHAPTER_COUNT_MISMATCH'
    | 'ARC_RANGE_MISSING'
    | 'AUTHOR_SECRET_COUNT_UNDERRUN';

export interface StorySetupImportIssue {
    readonly code: StorySetupImportIssueCode;
    readonly detail: string;
}

export interface StorySetupImportReview {
    readonly kind: 'story-setup-import-review';
    readonly displayName: string;
    readonly plannedChapterCount: number;
    readonly characterCount: number;
    readonly futureCharacterCount: number;
    readonly arcs: readonly { readonly id: string; readonly title: string; readonly startChapter: number; readonly endChapter: number }[];
    readonly revealCount: number;
    readonly gateCount: number;
    readonly relationshipDefinitionCount: number;
    readonly authorSecretCount: number;
    readonly canonRuleCount: number;
    readonly recognizedSpoilerMarkerCount: number;
    readonly criticalIssues: readonly StorySetupImportIssue[];
    readonly warnings: readonly string[];
    readonly compilerModelId?: string;
}

export interface PreparedStorySetupImport {
    readonly kind: 'prepared-story-setup-import';
    readonly mode: 'json' | 'author-text';
    readonly setupDocument: StoryBlueprintDocument;
    readonly review: StorySetupImportReview;
}

export interface AuthorSetupAudit {
    readonly plannedChapterCount?: number;
    readonly arcRanges: readonly { readonly startChapter: number; readonly endChapter: number }[];
    readonly authorSecretCount: number;
    readonly spoilerMarkerCount: number;
}

const fallbackName = (filename: string): string => filename.replace(/\.(?:json|txt|md)$/i, '').trim() || 'Dự án Story Engine V4';

const sourceDisplayName = (source: string, filename: string): string => {
    const first = source.split(/\r?\n/).map(line => line.trim()).find(line =>
        line.length >= 2 && line.length <= 120 && !/AUTHOR\s*SECRET/i.test(line) && !line.startsWith('{'));
    if (!first) return fallbackName(filename);
    return first.replace(/^#{1,6}\s*/, '').replace(/^\[[^\]]+\]\s*/, '').trim() || fallbackName(filename);
};

const countFromMachineSettings = (value: unknown): number | undefined => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const count = record.plannedChapterCount ?? record.totalPlannedChapters
        ?? record.totalChapters ?? record.totalChapterCount;
    return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 ? count : undefined;
};

const parseMachineSettingsCount = (source: string): number | undefined => {
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const marker = lines[index].match(/\[STORY_ENGINE_SETTINGS(?:_V\d+)?\]/i);
        if (!marker) continue;
        const sameLine = lines[index].slice((marker.index ?? 0) + marker[0].length).trim();
        const nextLine = lines.slice(index + 1).find(line => line.trim().length > 0)?.trim() ?? '';
        const candidate = sameLine.startsWith('{') ? sameLine : nextLine.startsWith('{') ? nextLine : '';
        if (!candidate) continue;
        try {
            const count = countFromMachineSettings(JSON.parse(candidate) as unknown);
            if (count !== undefined) return count;
        } catch { /* Raw setup is intentionally neither logged nor included in the safe error. */ }
    }
    return undefined;
};

const foldVietnamese = (value: string): string => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd');

const parseTextualSettingsCount = (source: string): number | undefined => {
    const folded = foldVietnamese(source);
    const match = folded.match(
        /(?:planned\s*chapter\s*count|total\s*planned\s*chapters?|total\s*chapters?|tong\s*so\s*chuong|so\s*chuong\s*du\s*kien)\s*[:=]\s*(\d+)|(?:tong\s*chieu\s*dai\s*muc\s*tieu\s*[:=]?|tong\s*truyen\s*du\s*kien(?:\s*khoang)?\s*[:=]?)\s*(\d+)\s*chuong/i,
    );
    const raw = match?.[1] ?? match?.[2];
    if (!raw) return undefined;
    const count = Number(raw);
    return Number.isSafeInteger(count) && count > 0 ? count : undefined;
};

const parseSettingsCount = (source: string): number | undefined =>
    parseMachineSettingsCount(source) ?? parseTextualSettingsCount(source);

export const countAuthorSecretDeclarations = (source: string): number => source.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => {
        const withoutMarkdownPrefix = line.replace(/^(?:[-*+]\s+|#{1,6}\s+)/, '');
        return /^\[\s*AUTHOR[\s_-]+SECRET\s*\]\s*(?::.*)?$/i.test(withoutMarkdownPrefix)
            || /^AUTHOR[\s_-]+SECRET\s*(?::|[–—])\s*\S.*$/i.test(withoutMarkdownPrefix);
    }).length;

const countSpoilerMarkers = (source: string): number => {
    const folded = foldVietnamese(source);
    return [...folded.matchAll(
        /(?:\b(?:khong\s+)?truoc\s+(?:ch\.?|chuong)\s*\d+\b|\b(?:spoiler|reveal|gate)\b[^\r\n]{0,100}?(?:chapter|chuong|ch\.?)\s*\d+\b)/giu,
    )].length;
};

export const auditAuthorSetupSource = (source: string): AuthorSetupAudit => {
    const folded = foldVietnamese(source);
    const plannedChapterCount = parseSettingsCount(source);
    const arcRanges = [...folded.matchAll(/(?:\bARC\b|\bHOI\b)[^\r\n]{0,160}?[\[(]\s*(\d+)\s*[–—-]\s*(\d+)\s*[\])]/giu)]
        .map(match => ({ startChapter: Number(match[1]), endChapter: Number(match[2]) }))
        .filter(range => Number.isSafeInteger(range.startChapter) && range.startChapter > 0 && range.endChapter >= range.startChapter);
    const uniqueRanges = [...new Map(arcRanges.map(range => [`${range.startChapter}:${range.endChapter}`, range])).values()];
    return {
        ...(plannedChapterCount === undefined ? {} : { plannedChapterCount }),
        arcRanges: uniqueRanges,
        authorSecretCount: countAuthorSecretDeclarations(source),
        spoilerMarkerCount: countSpoilerMarkers(source),
    };
};

const buildReview = (
    document: StoryBlueprintDocument,
    displayName: string,
    audit?: AuthorSetupAudit,
    compilerModelId?: string,
): StorySetupImportReview => {
    const control = compileStoryControl(document.blueprint);
    const criticalIssues: StorySetupImportIssue[] = [];
    if (audit?.plannedChapterCount !== undefined && audit.plannedChapterCount !== control.engine.plannedChapterCount) {
        criticalIssues.push({ code: 'PLANNED_CHAPTER_COUNT_MISMATCH', detail: `Setup khai báo ${audit.plannedChapterCount} chương nhưng bản biên dịch có ${control.engine.plannedChapterCount}.` });
    }
    audit?.arcRanges.forEach((range) => {
        if (!control.arcs.some(arc => arc.startChapter === range.startChapter && arc.endChapter === range.endChapter)) {
            criticalIssues.push({ code: 'ARC_RANGE_MISSING', detail: `Thiếu dải chương ${range.startChapter}–${range.endChapter}.` });
        }
    });
    if (audit && control.authorOnlySecrets.length < audit.authorSecretCount) {
        criticalIssues.push({
            code: 'AUTHOR_SECRET_COUNT_UNDERRUN',
            detail: `Setup có ${audit.authorSecretCount} mục Author Secret nhưng bản biên dịch chỉ giữ ${control.authorOnlySecrets.length}.`,
        });
    }
    const warnings = audit === undefined ? [] : [
        'Nội dung spoiler và hướng dẫn phong cách tự do cần được tác giả kiểm tra lại trong cấu trúc đã biên dịch.',
        'Việc chuyển TXT/MD sang Blueprint có AI hỗ trợ; parser V4 và bước review mới là ranh giới an toàn.',
    ];
    return {
        kind: 'story-setup-import-review', displayName, plannedChapterCount: control.engine.plannedChapterCount,
        characterCount: control.characterOrder.length,
        futureCharacterCount: control.characterOrder.map(id => control.characters[id]).filter(character => character.availableFromChapter > 1).length,
        arcs: control.arcs.map(arc => ({ id: arc.id, title: arc.title, startChapter: arc.startChapter, endChapter: arc.endChapter })),
        revealCount: control.reveals.length,
        gateCount: Object.values(control.gates).reduce((total, values) => total + values.length, 0),
        relationshipDefinitionCount: control.relationshipDefinitions.length,
        authorSecretCount: control.authorOnlySecrets.length,
        canonRuleCount: control.canonRules.length,
        recognizedSpoilerMarkerCount: audit?.spoilerMarkerCount ?? 0,
        criticalIssues, warnings,
        ...(compilerModelId === undefined ? {} : { compilerModelId }),
    };
};

export const prepareJsonStorySetupImport = (source: string, filename: string): PreparedStorySetupImport => {
    const setupDocument = parseStoryBlueprintJson(source);
    return {
        kind: 'prepared-story-setup-import', mode: 'json', setupDocument,
        review: buildReview(setupDocument, fallbackName(filename)),
    };
};

export type StorySetupCompiler = (request: CompileStorySetupRequest) => Promise<StorySetupCompilerResult>;

export const prepareAuthorTextStorySetupImport = async (
    source: string,
    filename: string,
    options: { readonly availableModelIds?: readonly string[]; readonly signal?: AbortSignal; readonly compiler?: StorySetupCompiler } = {},
): Promise<PreparedStorySetupImport> => {
    const bytes = new TextEncoder().encode(source).byteLength;
    if (!source.trim() || bytes > MAX_AUTHOR_SETUP_SOURCE_BYTES) throw new StorySetupImportError('SETUP_SOURCE_SIZE_INVALID');
    const audit = auditAuthorSetupSource(source);
    const compiler = options.compiler ?? compileStorySetupWithGemini;
    const compiled = await compiler({
        source,
        ...(options.availableModelIds === undefined ? {} : { availableModelIds: options.availableModelIds }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const setupDocument = parseStoryBlueprintDocument(compiled.value);
    return {
        kind: 'prepared-story-setup-import', mode: 'author-text', setupDocument,
        review: buildReview(setupDocument, sourceDisplayName(source, filename), audit, compiled.selectedModelId),
    };
};
