import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { GeminiStoryEngineGenerationRuntime } from '../src/services/storyEngine';
import { createGeminiStoryEngineAdapters } from '../src/services/storyEngine';
import { createProductionStoryRuntime } from '../src/storyEngine';
import type { StoryBlueprintDocument } from '../src/storyEngine';
import { EpubPreviewModal } from '../src/components/EpubPreviewModal';
import { StoryStudioActionBar } from '../src/components/storyStudio/StoryStudioActionBar';
import { getStoryStudioSafeMessage, reduceStoryStudioEpubPublicationUiState } from '../src/hooks/pages/useStoryStudio';
import {
    createStoryStudioEpubPublication,
    describeStoryStudioEpubPublication,
    storyStudioEpubFilename,
} from '../src/storyStudio/production/storyStudioEpubPublication';
import { StoryStudioProjectController } from '../src/storyStudio/production/storyStudioProjectController';
import {
    InMemoryStoryStudioStorageAdapter,
    parseStoryStudioProjectId,
    StoryStudioProjectRepository,
} from '../src/storyStudio/production/storyStudioProjectPersistence';
import type { StoryStudioStorageWrite } from '../src/storyStudio/production/storyStudioProjectPersistence';
import type { StoryStudioRuntimeProject } from '../src/storyStudio/production/storyStudioProjectTypes';
import { parseStoryStudioContinuationBackup } from '../src/storyStudio/production/storyStudioContinuationBackup';
import { generateEpub } from '../src/utils/file/exporters';
import { DEFAULT_EPUB_DESIGN_OPTIONS, EMPTY_EPUB_DESIGN_ASSETS } from '../src/types';

const AUTHOR_SECRET = 'WORK15D_AUTHOR_ONLY_SECRET_SENTINEL';
const INTERNAL_MEMORY = 'WORK15D_INTERNAL_MEMORY_SENTINEL';
const PENDING_PROSE = 'WORK15D_PENDING_NON_CANON_PROSE_SENTINEL';

const blueprint = (id: string): StoryBlueprintDocument => ({
    kind: 'story-blueprint-document',
    formatVersion: 1,
    blueprint: {
        id,
        engine: { plannedChapterCount: 6 },
        characters: [{ id: 'hero', name: 'Hero', availableFromChapter: 1 }],
        arcs: [{ id: 'arc', title: 'Publication Arc', startChapter: 1, endChapter: 6 }],
        gates: { pov: [{ id: 'hero-pov', characterId: 'hero', allowedFromChapter: 1 }] },
        authorOnlySecrets: [{ id: 'private', value: AUTHOR_SECRET }],
        canonRules: [{ id: 'rule', text: `Private control ${INTERNAL_MEMORY}`, availableFromChapter: 1, scope: 'world' }],
    },
});

const chapterFrom = (contents: string): number => {
    const match = contents.match(/"targetChapter":(\d+)/) ?? contents.match(/"chapterNumber":(\d+)/);
    if (!match) throw new Error('missing chapter');
    return Number(match[1]);
};

const runtime = (reject = false, calls: string[] = [], prosePrefix = 'WORK15D_PUBLIC_CANON_CHAPTER') => {
    const generation: GeminiStoryEngineGenerationRuntime = {
        async run(request) {
            calls.push(request.role);
            const chapter = chapterFrom(request.contents);
            if (request.role === 'planner') return {
                value: {
                    kind: 'internal-chapter-plan', chapterNumber: chapter, arcId: 'arc',
                    primaryGoal: `Plan chapter ${chapter}.`, povCharacterId: 'hero', participantIds: ['hero'],
                    scenes: [{
                        id: `scene-${chapter}`, order: 1, goal: 'Publish only Canon.', location: 'Archive',
                        povCharacterId: 'hero', participantIds: ['hero'], conflictOrObstacle: 'A boundary.',
                        uncertainty: 'The result is pending.', expectedConsequence: 'Canon remains explicit.',
                        purposeTags: ['plot'], conflictImportance: 'minor',
                    }],
                    activeConstraintIds: ['rule'], allowedRevealIds: [], plannedRevealIds: [], relationshipEventIds: [],
                    storyEventIds: [], cluesPlantedIds: [], cluesPaidOffIds: [], expectedResourceDeltas: [],
                    expectedRelationshipDeltas: [], expectedContinuityConsequences: [], strategicActions: [],
                    relationshipActions: [], endStateIntent: INTERNAL_MEMORY,
                },
                selectedModelId: 'test-model',
            };
            if (request.role === 'writer') return {
                value: {
                    kind: 'writer-chapter-draft', chapterNumber: chapter, title: `Canon Title ${chapter}`,
                    prose: chapter === 4 ? PENDING_PROSE : `${prosePrefix}_${chapter}`,
                },
                selectedModelId: 'test-model',
            };
            if (request.role === 'semanticValidator') return {
                value: {
                    kind: 'semantic-validation-result', chapterNumber: chapter,
                    issues: reject ? [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }] : [],
                },
                selectedModelId: 'test-model',
            };
            if (request.role === 'repair') throw new Error('repair is not expected');
            return {
                value: {
                    kind: 'story-state-delta', schemaVersion: 2, chapterNumber: chapter, expectedRevision: chapter - 1,
                    factChanges: [{
                        id: `fact-${chapter}`, text: `${INTERNAL_MEMORY}-${chapter}`, establishedChapter: chapter,
                        visibility: 'writer', status: 'active',
                        provenance: { sourceChapter: chapter, sourceType: 'chapter' },
                    }],
                    epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [],
                    relationshipChanges: [], resourceChanges: [], continuityChanges: [], revealChanges: [],
                    foreshadowChanges: [], payoffChanges: [],
                },
                selectedModelId: 'test-model',
            };
        },
    };
    return createProductionStoryRuntime({
        models: createGeminiStoryEngineAdapters(generation),
        runtimePolicy: { maxRepairAttempts: reject ? 0 : 2 },
    });
};

const environment = (ids = ['LOCAL_PROJECT_A_SECRET', 'LOCAL_PROJECT_B_SECRET', 'LOCAL_PROJECT_C_SECRET']) => {
    const projectIds = [...ids];
    let tick = 0;
    const now = () => `2026-09-06T00:00:${String(tick++).padStart(2, '0')}.000Z`;
    const adapter = new InMemoryStoryStudioStorageAdapter();
    const repository = new StoryStudioProjectRepository(
        adapter,
        now,
        () => parseStoryStudioProjectId(projectIds.shift() ?? `LOCAL_PROJECT_${tick}_SECRET`),
    );
    return { adapter, repository, controller: new StoryStudioProjectController(repository, now) };
};

class DeferredCommitAdapter extends InMemoryStoryStudioStorageAdapter {
    blockNextCommit = false;
    private releaseBlockedCommit?: () => void;
    private markBlocked?: () => void;
    private readonly blocked = new Promise<void>(resolve => { this.markBlocked = resolve; });

    release(): void { this.releaseBlockedCommit?.(); }
    waitUntilBlocked(): Promise<void> { return this.blocked; }

    override async commit(writes: readonly StoryStudioStorageWrite[], clears: readonly string[] = []): Promise<void> {
        if (this.blockNextCommit) {
            this.blockNextCommit = false;
            this.markBlocked?.();
            await new Promise<void>(resolve => { this.releaseBlockedCommit = resolve; });
        }
        await super.commit(writes, clears);
    }
}

const advanceTo = async (
    controller: StoryStudioProjectController,
    stage: StoryStudioRuntimeProject['workflow']['stage'],
    reject = false,
    calls: string[] = [],
    prosePrefix?: string,
) => {
    const production = runtime(reject, calls, prosePrefix);
    while (controller.currentProject?.workflow.stage !== stage) await controller.runNextStage(production);
};

const createWithCanon = async (count: 1 | 2 | 3, calls: string[] = []) => {
    const result = environment();
    await result.controller.load();
    await result.controller.createProject(blueprint('work15d-publication'), 'Public Book');
    await result.controller.startBatch(count);
    for (let chapter = 1; chapter <= count; chapter += 1) {
        await advanceTo(result.controller, 'ready-for-canon-review', false, calls);
        await result.controller.makeCanonDurably(result.controller.createConfirmation());
    }
    return result;
};

const allZipText = async (blob: Blob): Promise<{ zip: JSZip; text: string }> => {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const textParts: string[] = [];
    for (const entry of Object.values(zip.files)) {
        if (!entry.dir) textParts.push(await entry.async('string'));
    }
    return { zip, text: textParts.join('\n') };
};

describe('WORK15D strict Canon publication adapter', () => {
    it('rejects C0 and returns a safe Vietnamese error without creating a fake book', async () => {
        const { controller } = environment();
        await controller.load();
        await controller.createProject(blueprint('c0'), 'Empty Canon');
        expect(() => controller.createCanonEpubPublication()).toThrowError(/STORY_STUDIO_EPUB_NO_CANON/);
        expect(getStoryStudioSafeMessage({ code: 'STORY_STUDIO_EPUB_NO_CANON' }))
            .toBe('Chưa có chương Canon để xuất EPUB.');
    });

    it('creates one exact public chapter with metadata title and blank author default', async () => {
        const { controller } = await createWithCanon(1);
        const publication = controller.createCanonEpubPublication();
        expect(publication.chapters).toEqual([{
            chapterNumber: 1,
            displayTitle: 'Chương 1: Canon Title 1',
            text: 'WORK15D_PUBLIC_CANON_CHAPTER_1',
        }]);
        expect(publication.storyInfo).toMatchObject({ title: 'Public Book', author: '', epubAllowBlankAuthor: true });
        expect(storyStudioEpubFilename('A:/Book?', 'fallback')).toBe('A Book.epub');
    });

    it('blocks publication snapshot creation during a durability transition', async () => {
        const adapter = new DeferredCommitAdapter();
        let tick = 0;
        const now = () => `2026-09-06T01:00:${String(tick++).padStart(2, '0')}.000Z`;
        const repository = new StoryStudioProjectRepository(adapter, now, () => parseStoryStudioProjectId('deferred-project'));
        const controller = new StoryStudioProjectController(repository, now);
        await controller.load();
        await controller.createProject(blueprint('deferred'), 'Before');
        adapter.blockNextCommit = true;
        const rename = controller.updateDisplayName('After');
        await adapter.waitUntilBlocked();
        expect(() => controller.createCanonEpubPublication()).toThrowError(/PROJECT_OPERATION_BLOCKED/);
        adapter.release();
        await rename;
    });

    it.each([
        ['missing memory', (p: StoryStudioRuntimeProject) => ({ ...p, memory: { ...p.memory, records: p.memory.records.slice(0, 2) } })],
        ['missing metadata', (p: StoryStudioRuntimeProject) => ({ ...p, chapterMetadata: p.chapterMetadata.slice(0, 2) })],
        ['wrong record number', (p: StoryStudioRuntimeProject) => ({ ...p, memory: { ...p.memory, records: [{ ...p.memory.records[0], chapterNumber: 2 }, ...p.memory.records.slice(1)] } })],
        ['wrong metadata number', (p: StoryStudioRuntimeProject) => ({ ...p, chapterMetadata: [{ ...p.chapterMetadata[0], chapterNumber: 2 }, ...p.chapterMetadata.slice(1)] })],
        ['out-of-order history', (p: StoryStudioRuntimeProject) => ({ ...p, memory: { ...p.memory, records: [p.memory.records[1], p.memory.records[0], p.memory.records[2]] } })],
    ])('fails closed for %s', async (_label, corrupt) => {
        const { controller } = await createWithCanon(3);
        expect(() => createStoryStudioEpubPublication(
            corrupt(controller.currentProject!) as StoryStudioRuntimeProject,
            'Book',
        )).toThrowError(/STORY_STUDIO_EPUB_CANON_INCONSISTENT/);
    });
});

describe('WORK15D EPUB generation, pending exclusion, and privacy', () => {
    it('publishes C1-C3 in numeric TOC order with each canonical title exactly once', async () => {
        const { controller } = await createWithCanon(3);
        const publication = controller.createCanonEpubPublication();
        const blob = await generateEpub([...publication.files], publication.storyInfo, null, '');
        const { zip, text } = await allZipText(blob);
        const nav = await zip.file('OEBPS/Text/nav.xhtml')!.async('string');
        for (let chapter = 1; chapter <= 3; chapter += 1) {
            expect(text.toLowerCase()).toContain(`work15d_public_canon_chapter_${chapter}`);
            const xhtml = await zip.file(`OEBPS/Text/ch${chapter}.xhtml`)!.async('string');
            expect(xhtml.match(new RegExp(`<h2>Chương ${chapter}: Canon Title ${chapter}</h2>`, 'g'))).toHaveLength(1);
        }
        expect(nav.indexOf('Canon Title 1')).toBeLessThan(nav.indexOf('Canon Title 2'));
        expect(nav.indexOf('Canon Title 2')).toBeLessThan(nav.indexOf('Canon Title 3'));
        expect(text).not.toContain('Unknown Author');
    });

    it('uses Canon metadata title once even if canonical prose starts with an old chapter heading', async () => {
        const { controller } = await createWithCanon(1);
        const project = controller.currentProject!;
        const withHeading = {
            ...project,
            memory: {
                ...project.memory,
                records: [{
                    ...project.memory.records[0],
                    raw: { ...project.memory.records[0].raw, text: 'Chương 1: Old Draft Heading\nCanonical body.' },
                }],
            },
        } as StoryStudioRuntimeProject;
        const publication = createStoryStudioEpubPublication(withHeading, 'Book');
        const { zip } = await allZipText(await generateEpub([...publication.files], publication.storyInfo, null, ''));
        const xhtml = await zip.file('OEBPS/Text/ch1.xhtml')!.async('string');
        expect(xhtml.match(/<h2>Chương 1: Canon Title 1<\/h2>/g)).toHaveLength(1);
        expect(xhtml).not.toContain('Old Draft Heading');
        expect(xhtml).toContain('Canonical body.');
    });

    it.each(['planned', 'drafted', 'validated', 'rejected', 'extracted', 'ready-for-canon-review'] as const)(
        'excludes non-Canon chapter prose at pending %s stage',
        async (stage) => {
            const { controller } = await createWithCanon(3);
            await controller.startBatch(1);
            await advanceTo(controller, stage, stage === 'rejected');
            const before = structuredClone(controller.currentProject!);
            const calls: string[] = [];
            const publication = controller.createCanonEpubPublication();
            const { text } = await allZipText(await generateEpub([...publication.files], publication.storyInfo, null, ''));
            expect(publication.canonicalChapterCount).toBe(3);
            expect(publication.pendingChapterNumber).toBe(4);
            expect(text).not.toContain(PENDING_PROSE);
            expect(controller.currentProject).toEqual(before);
            expect(calls).toEqual([]);
        },
    );

    it('keeps ready-for-review C4 out, then includes it exactly once only after explicit Make Canon', async () => {
        const { controller } = await createWithCanon(3);
        await controller.startBatch(1);
        await advanceTo(controller, 'ready-for-canon-review');
        const before = structuredClone(controller.currentProject!);
        const pendingPublication = controller.createCanonEpubPublication();
        const pendingZip = await allZipText(await generateEpub([...pendingPublication.files], pendingPublication.storyInfo, null, ''));
        expect(pendingZip.text).not.toContain(PENDING_PROSE);
        expect(controller.currentProject).toEqual(before);
        expect(describeStoryStudioEpubPublication(pendingPublication))
            .toContain('Chương 4 đang chờ Make Canon và chưa được đưa vào EPUB.');

        await controller.makeCanonDurably(controller.createConfirmation());
        const canonPublication = controller.createCanonEpubPublication();
        const canonZip = await allZipText(await generateEpub([...canonPublication.files], canonPublication.storyInfo, null, ''));
        expect(canonPublication.canonicalChapterCount).toBe(4);
        expect(canonZip.text.match(new RegExp(PENDING_PROSE, 'gi'))).toHaveLength(1);
    });

    it('never leaks private control, memory, workflow, identities, or local project IDs and never mutates project state', async () => {
        const modelCalls: string[] = [];
        const { controller } = await createWithCanon(3, modelCalls);
        await controller.startBatch(1);
        await advanceTo(controller, 'ready-for-canon-review', false, modelCalls);
        modelCalls.length = 0;
        const before = structuredClone(controller.currentProject!);
        const publication = controller.createCanonEpubPublication();
        const { text } = await allZipText(await generateEpub(
            [...publication.files], publication.storyInfo, null, '', undefined, null,
            DEFAULT_EPUB_DESIGN_OPTIONS, EMPTY_EPUB_DESIGN_ASSETS,
        ));
        expect(text.toLowerCase()).toContain('work15d_public_canon_chapter_1');
        const lowerText = text.toLowerCase();
        for (const forbidden of [
            AUTHOR_SECRET, INTERNAL_MEMORY, PENDING_PROSE, before.coreIdentity, before.workflowIdentity,
            before.storyControlIdentity, 'LOCAL_PROJECT_A_SECRET', 'story_studio_v4_project_v1',
            'story-studio-continuation-backup',
        ]) expect(lowerText).not.toContain(forbidden.toLowerCase());
        expect(controller.currentProject).toEqual(before);
        expect(modelCalls).toEqual([]);
    });
});

describe('WORK15D isolation, continuation equivalence, and UI semantics', () => {
    it('keeps two local projects publication-isolated', async () => {
        const { controller } = await createWithCanon(1);
        const aId = controller.activeProjectId!;
        const a = controller.createCanonEpubPublication();
        await controller.createProject(blueprint('project-b'), 'Project B');
        await controller.startBatch(1);
        await advanceTo(controller, 'ready-for-canon-review', false, [], 'WORK15D_PROJECT_B_CANON');
        await controller.makeCanonDurably(controller.createConfirmation());
        const b = controller.createCanonEpubPublication();
        await controller.switchProject(aId);
        expect(controller.createCanonEpubPublication().chapters).toEqual(a.chapters);
        expect(JSON.stringify(a)).toContain('WORK15D_PUBLIC_CANON_CHAPTER_1');
        expect(JSON.stringify(a)).not.toContain('WORK15D_PROJECT_B_CANON_1');
        expect(JSON.stringify(b)).toContain('WORK15D_PROJECT_B_CANON_1');
        expect(JSON.stringify(b)).not.toContain('WORK15D_PUBLIC_CANON_CHAPTER_1');
    });

    it('produces equivalent public Canon after WORK15C continuation restore despite a fresh local ID', async () => {
        const { controller } = await createWithCanon(3);
        const sourceId = controller.activeProjectId;
        const source = controller.createCanonEpubPublication();
        const parsed = parseStoryStudioContinuationBackup(controller.createContinuationBackup());
        await controller.restoreContinuationBackup(parsed);
        expect(controller.activeProjectId).not.toBe(sourceId);
        const clone = controller.createCanonEpubPublication();
        expect(clone.chapters).toEqual(source.chapters);
        expect(clone.files.map(file => [file.epubDisplayTitle, file.translatedContent]))
            .toEqual(source.files.map(file => [file.epubDisplayTitle, file.translatedContent]));
    });

    it('renders an obvious disabled C0 action and accurate pending Canon count', async () => {
        const { controller } = await createWithCanon(3);
        await controller.startBatch(1);
        await advanceTo(controller, 'ready-for-canon-review');
        const project = controller.currentProject!;
        const markup = renderToStaticMarkup(React.createElement(StoryStudioActionBar, {
            project, batchSize: 1, saveStatus: 'saved', disabled: false,
            onBatchSize() {}, onStart() {}, onResume() {}, onStop() {}, onRewrite() {}, onReplan() {},
            onImport() {}, onOpenSettings() {}, onExportSetup() {}, onBackupContinuation() {},
            onPublishEpub() {}, onDelete() {},
        }));
        expect(markup).toContain('Xuất EPUB từ Canon');
        expect(markup).toContain('3 chương Canon sẽ được xuất. Chương 4 đang chờ Make Canon');

        const empty = environment();
        await empty.controller.load();
        await empty.controller.createProject(blueprint('empty-ui'), 'Empty');
        const emptyMarkup = renderToStaticMarkup(React.createElement(StoryStudioActionBar, {
            project: empty.controller.currentProject!, batchSize: 1, saveStatus: 'saved', disabled: false,
            onBatchSize() {}, onStart() {}, onResume() {}, onStop() {}, onRewrite() {}, onReplan() {},
            onImport() {}, onOpenSettings() {}, onExportSetup() {}, onBackupContinuation() {},
            onPublishEpub() {}, onDelete() {},
        }));
        expect(emptyMarkup).toContain('Chưa có chương Canon để xuất EPUB');
        expect(emptyMarkup).toMatch(/disabled=""[^>]*title="Chưa có chương Canon để xuất EPUB\./);
    });

    it('reuses the existing preview with blank author, safe notice, and no AI cover action', async () => {
        const { controller } = await createWithCanon(1);
        const publication = controller.createCanonEpubPublication();
        const markup = renderToStaticMarkup(React.createElement(EpubPreviewModal, {
            isOpen: true,
            onClose() {},
            onConfirm() {},
            storyInfo: publication.storyInfo,
            coverImage: null,
            totalFiles: publication.canonicalChapterCount,
            publicationNotice: describeStoryStudioEpubPublication(publication),
        }));
        expect(markup).toContain('1 chương Canon sẽ được xuất');
        expect(markup).toContain('value=""');
        expect(markup).not.toContain('Tạo Ảnh Bìa (AI)');
    });

    it('cancels volatile EPUB preview without retaining or mutating its publication snapshot', async () => {
        const { controller } = await createWithCanon(1);
        const publication = controller.createCanonEpubPublication();
        const projectBefore = structuredClone(controller.currentProject!);
        const prepared = reduceStoryStudioEpubPublicationUiState({}, { type: 'prepared', publication });
        expect(prepared.publication).toBe(publication);
        expect(reduceStoryStudioEpubPublicationUiState(prepared, { type: 'cancelled' })).toEqual({});
        expect(controller.currentProject).toEqual(projectBefore);
    });
});
