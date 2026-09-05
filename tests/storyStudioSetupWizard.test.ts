import { describe, expect, it, vi } from 'vitest';
import type { StoryBlueprintDocument } from '../src/storyEngine';
import {
    getStoryStudioPageView,
    getStoryStudioPreparedImportOrigin,
} from '../src/hooks/pages/useStoryStudio';
import {
    prepareAuthorTextStorySetupImport,
    prepareJsonStorySetupImport,
    auditAuthorSetupSource,
} from '../src/storyStudio/production/storySetupImport';
import {
    STORY_SETUP_BLANK_TEMPLATE_MARKDOWN,
    STORY_SETUP_WIZARD_DRAFT_KEY,
    StorySetupWizardDraftRepository,
    completeDurableWizardCreate,
    createEmptyStorySetupWizardDraft,
    createEmptyWizardCharacter,
    createEmptyWizardRelationship,
    getStorySetupGenreEmphasis,
    parseStorySetupWizardDraft,
    renderExistingProjectSetupMarkdown,
    renderStorySetupWizardMarkdown,
    reorderWizardItem,
    sanitizeSetupFilename,
    validateStorySetupWizardDraft,
} from '../src/storyStudio/setup/storySetupWizard';
import { createStoryStudioProject } from '../src/storyStudio/production/storyStudioProjectRuntime';
import { StoryStudioProjectController } from '../src/storyStudio/production/storyStudioProjectController';
import {
    InMemoryStoryStudioStorageAdapter,
    StoryStudioProjectRepository,
} from '../src/storyStudio/production/storyStudioProjectPersistence';
import type {
    StorySetupWizardDraftAdapter,
    StorySetupWizardDraftV1,
} from '../src/storyStudio/setup/storySetupWizard';
import wizardUiSource from '../src/components/storyStudio/StorySetupWizard.tsx?raw';
import wizardRuntimeSource from '../src/storyStudio/setup/storySetupWizard.ts?raw';

const SECRET = 'WORK15B_AUTHOR_ONLY_SECRET_91F3';
const FIXED_TIME = '2026-09-05T00:00:00.000Z';

const blueprintDocument = (): StoryBlueprintDocument => ({
    kind: 'story-blueprint-document',
    formatVersion: 1,
    blueprint: {
        id: 'wizard-story',
        engine: { plannedChapterCount: 12 },
        characters: [{
            id: 'hero', name: 'An', availableFromChapter: 1,
            writerProfile: { role: 'Nhân vật chính', appearance: 'Tóc đen', personality: 'Kiên nhẫn', publicFacts: ['Sống ở bến cảng'] },
            authorNotes: 'Có một quá khứ chưa công khai.',
        }],
        arcs: [{ id: 'arc-1', title: 'Khởi hành', startChapter: 1, endChapter: 12, writerBrief: 'An rời bến cảng.' }],
        gates: { pov: [{ id: 'hero-pov', characterId: 'hero', allowedFromChapter: 1 }] },
        reveals: [{ id: 'truth', writerText: 'Nguồn gốc con tàu được phép hé lộ.' }],
        authorOnlySecrets: [{ id: 'secret', value: SECRET, revealId: 'truth', notes: 'Chỉ tác giả biết.' }],
        canonRules: [{ id: 'rule', text: 'Mọi chuyến đi đều có cái giá.', availableFromChapter: 1, scope: 'world' }],
    },
});

const completeDraft = (): StorySetupWizardDraftV1 => {
    const draft = createEmptyStorySetupWizardDraft(() => FIXED_TIME);
    return {
        ...draft,
        basic: {
            ...draft.basic,
            title: 'Hải Trình',
            language: 'Tiếng Việt',
            primaryGenre: 'Kỳ ảo',
            secondaryGenres: 'Phiêu lưu',
            plannedChapterCount: 12,
            toneStyle: 'Chậm, u hoài',
            povPreference: 'Ngôi ba giới hạn',
        },
        core: {
            ...draft.core,
            premise: 'An rời bến cảng.\nMột cơn bão thay đổi hành trình.',
            protagonistGoal: 'Tìm lại con tàu của gia đình.',
            stakes: 'Nếu thất bại, quê nhà bị cô lập.',
        },
        characters: [{ ...createEmptyWizardCharacter(() => 'character-local-only'), name: 'An', role: 'Nhân vật chính' }],
        relationships: [{ ...createEmptyWizardRelationship(() => 'relationship-local-only'), participants: 'An và Bình' }],
        authorRules: { ...draft.authorRules, secrets: SECRET },
    };
};

class MemoryDraftAdapter implements StorySetupWizardDraftAdapter {
    value: unknown;
    saves = 0;
    clears = 0;
    async load() { return this.value; }
    async save(value: StorySetupWizardDraftV1) { this.saves += 1; this.value = structuredClone(value); }
    async clear() { this.clears += 1; this.value = undefined; }
}

describe('WORK15B human-friendly Story Setup wizard', () => {
    it('starts without fake story facts', () => {
        const draft = createEmptyStorySetupWizardDraft(() => FIXED_TIME);
        expect(draft.kind).toBe('story-setup-wizard-draft');
        expect(draft.formatVersion).toBe(1);
        expect(draft.basic.title).toBe('');
        expect(draft.basic.language).toBe('');
        expect(draft.basic.plannedChapterCount).toBe(0);
        expect(draft.characters).toEqual([]);
        expect(draft.authorRules.secrets).toBe('');
    });

    it('creates opaque draft-only card IDs through an injected generator', () => {
        expect(createEmptyWizardCharacter(() => 'opaque-character').draftId).toBe('opaque-character');
        expect(createEmptyWizardRelationship(() => 'opaque-relationship').draftId).toBe('opaque-relationship');
    });

    it('reorders character cards without mutating the original list', () => {
        const original = ['a', 'b', 'c'];
        expect(reorderWizardItem(original, 2, 0)).toEqual(['c', 'a', 'b']);
        expect(original).toEqual(['a', 'b', 'c']);
    });

    it('keeps invalid reorder requests unchanged', () => {
        const original = ['a'];
        expect(reorderWizardItem(original, 0, 2)).toBe(original);
    });

    it.each([
        ['lịch sử quân sự', 'historical-strategy'],
        ['tiên hiệp tu tiên', 'fantasy-progression'],
        ['trinh thám bí ẩn', 'mystery'],
        ['đô thị kinh doanh', 'social-relationship'],
        ['phiêu lưu', 'generic'],
    ] as const)('derives %s presentation without changing persisted schema', (genre, expected) => {
        const before = completeDraft();
        expect(getStorySetupGenreEmphasis(genre)).toBe(expected);
        expect(before.formatVersion).toBe(1);
        expect(before).toEqual(completeDraft());
    });

    it('requires only human-facing minimum fields', () => {
        const empty = createEmptyStorySetupWizardDraft(() => FIXED_TIME);
        expect(validateStorySetupWizardDraft(empty).map(issue => issue.field)).toEqual(expect.arrayContaining([
            'basic.title', 'basic.primaryGenre', 'basic.plannedChapterCount', 'core.premise', 'core.protagonistGoal', 'characters',
        ]));
        expect(validateStorySetupWizardDraft(completeDraft())).toEqual([]);
    });

    it('renders deterministic human-readable Markdown', () => {
        expect(renderStorySetupWizardMarkdown(completeDraft())).toBe(renderStorySetupWizardMarkdown(completeDraft()));
        expect(renderStorySetupWizardMarkdown(completeDraft())).toContain('# Hải Trình');
        expect(renderStorySetupWizardMarkdown(completeDraft())).toContain('Số chương dự kiến: 12');
        expect(auditAuthorSetupSource(renderStorySetupWizardMarkdown(completeDraft())).plannedChapterCount).toBe(12);
    });

    it('preserves multiline author content', () => {
        const markdown = renderStorySetupWizardMarkdown(completeDraft());
        expect(markdown).toContain('An rời bến cảng.\n  Một cơn bão thay đổi hành trình.');
    });

    it('marks author secrets explicitly only in the author-owned artifact', () => {
        const markdown = renderStorySetupWizardMarkdown(completeDraft());
        expect(markdown).toContain('## BÍ MẬT CHỈ DÀNH CHO TÁC GIẢ');
        expect(markdown).toContain('[AUTHOR_SECRET]: ' + SECRET);
    });

    it('does not put draft card IDs into generated Setup', () => {
        const markdown = renderStorySetupWizardMarkdown(completeDraft());
        expect(markdown).not.toContain('character-local-only');
        expect(markdown).not.toContain('relationship-local-only');
    });

    it('keeps internal engine jargon out of normal wizard UI and template', () => {
        expect(wizardUiSource).not.toMatch(/\bStoryControl\b/);
        expect(wizardUiSource).not.toMatch(/\bGate\b/);
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).not.toMatch(/\bStoryControl\b|\bGate\b|identity/i);
    });

    it('contains no logging path for author-owned wizard or export contents', () => {
        expect(wizardUiSource).not.toContain('console.');
        expect(wizardRuntimeSource).not.toContain('console.');
    });

    it('strictly round-trips a valid V1 draft', () => {
        expect(parseStorySetupWizardDraft(structuredClone(completeDraft()))).toEqual(completeDraft());
    });

    it('rejects wrong versions, unknown fields, missing fields and duplicate card IDs', () => {
        expect(() => parseStorySetupWizardDraft({ ...completeDraft(), formatVersion: 2 })).toThrow();
        expect(() => parseStorySetupWizardDraft({ ...completeDraft(), surprise: true })).toThrow();
        const missing = structuredClone(completeDraft()) as unknown as Record<string, unknown>;
        delete missing.plot;
        expect(() => parseStorySetupWizardDraft(missing)).toThrow();
        const character = createEmptyWizardCharacter(() => 'duplicate');
        expect(() => parseStorySetupWizardDraft({ ...completeDraft(), characters: [character, character] })).toThrow();
        expect(() => parseStorySetupWizardDraft({ ...completeDraft(), updatedAt: 'not-a-date' })).toThrow();
    });

    it('saves and restores a draft using its separate storage boundary', async () => {
        const adapter = new MemoryDraftAdapter();
        const repository = new StorySetupWizardDraftRepository(adapter);
        await repository.save(completeDraft());
        expect(adapter.saves).toBe(1);
        expect(await repository.load()).toEqual({ status: 'loaded', draft: completeDraft() });
        expect(STORY_SETUP_WIZARD_DRAFT_KEY).not.toMatch(/project_library|project_v1:/);
    });

    it('fails closed on a corrupt stored draft', async () => {
        const adapter = new MemoryDraftAdapter();
        adapter.value = { kind: 'story-setup-wizard-draft', formatVersion: 99 };
        expect(await new StorySetupWizardDraftRepository(adapter).load()).toEqual({ status: 'corrupt' });
        expect(adapter.value).toBeDefined();
    });

    it('discards only the wizard draft when explicitly cleared', async () => {
        const adapter = new MemoryDraftAdapter();
        adapter.value = completeDraft();
        const repository = new StorySetupWizardDraftRepository(adapter);
        await repository.clear();
        expect(adapter.clears).toBe(1);
        expect(await repository.load()).toEqual({ status: 'empty' });
    });

    it('serializes draft saves so the newest snapshot wins', async () => {
        const writes: string[] = [];
        const adapter: StorySetupWizardDraftAdapter = {
            load: async () => undefined,
            save: async draft => { await Promise.resolve(); writes.push(draft.basic.title); },
            clear: async () => undefined,
        };
        const repository = new StorySetupWizardDraftRepository(adapter);
        await Promise.all([
            repository.save({ ...completeDraft(), basic: { ...completeDraft().basic, title: 'A' } }),
            repository.save({ ...completeDraft(), basic: { ...completeDraft().basic, title: 'B' } }),
        ]);
        expect(writes).toEqual(['A', 'B']);
    });

    it('keeps a draft when human Setup compilation fails', async () => {
        const adapter = new MemoryDraftAdapter();
        const repository = new StorySetupWizardDraftRepository(adapter);
        await repository.save(completeDraft());
        await expect(prepareAuthorTextStorySetupImport(
            renderStorySetupWizardMarkdown(completeDraft()),
            'wizard.md',
            { compiler: vi.fn().mockRejectedValue(new Error('provider detail must stay private')) },
        )).rejects.toMatchObject({ code: 'SETUP_COMPILER_FAILED' });
        expect((await repository.load()).status).toBe('loaded');
        expect(adapter.clears).toBe(0);
    });

    it('clears a wizard draft only after durable create and healthy publish succeed', async () => {
        const events: string[] = [];
        const result = await completeDurableWizardCreate(
            async () => { events.push('create'); return 'project-c'; },
            value => events.push('publish:' + value),
            async () => { events.push('clear'); },
        );
        expect(events).toEqual(['create', 'publish:project-c', 'clear']);
        expect(result).toEqual({ value: 'project-c', draftCleared: true });
    });

    it('preserves the draft when durable create fails', async () => {
        const publish = vi.fn();
        const clear = vi.fn();
        await expect(completeDurableWizardCreate(
            async () => { throw new Error('durable create failed'); }, publish, clear,
        )).rejects.toThrow('durable create failed');
        expect(publish).not.toHaveBeenCalled();
        expect(clear).not.toHaveBeenCalled();
    });

    it('keeps the new durable project published if post-create draft cleanup fails', async () => {
        const publish = vi.fn();
        const result = await completeDurableWizardCreate(
            async () => 'project-c',
            publish,
            async () => { throw new Error('draft cleanup failed'); },
        );
        expect(publish).toHaveBeenCalledWith('project-c');
        expect(result.draftCleared).toBe(false);
    });

    it('blank template includes every production design section and external-AI instruction', () => {
        [
            'THÔNG TIN CƠ BẢN', 'PREMISE / Ý TƯỞNG CỐT LÕI', 'PHONG CÁCH / TONE / POV', 'NHÂN VẬT',
            'THẾ GIỚI', 'HỆ THỐNG SỨC MẠNH', 'THẾ LỰC / CHÍNH TRỊ / QUÂN SỰ / KINH TẾ',
            'CÁC ARC CHÍNH', 'SỰ KIỆN / TURNING POINTS', 'QUAN HỆ / TÌNH CẢM',
            'FORESHADOW / REVEAL / PAYOFF', 'LUẬT CANON', 'ĐIỀU CẤM / RANH GIỚI',
            'BÍ MẬT CHỈ DÀNH CHO TÁC GIẢ',
        ].forEach(section => expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).toContain(section));
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).toContain('giữ nguyên các tiêu đề');
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).toContain('không xóa phần bí mật');
    });

    it('blank template contains placeholders but no real secret, API key or private value', () => {
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).toContain('[AUTHOR_SECRET]: [');
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).not.toContain(SECRET);
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).not.toMatch(/AIza|api[_ -]?key/i);
    });

    it('exports existing setup deterministically without mutating it or invoking a provider', () => {
        const setup = blueprintDocument();
        const before = structuredClone(setup);
        const provider = vi.fn();
        const first = renderExistingProjectSetupMarkdown(setup, 'Hải Trình');
        const second = renderExistingProjectSetupMarkdown(setup, 'Hải Trình');
        expect(first).toBe(second);
        expect(setup).toEqual(before);
        expect(provider).not.toHaveBeenCalled();
    });

    it('leaves project core, workflow and StoryControl identities unchanged after export', () => {
        const project = createStoryStudioProject(blueprintDocument(), 'Hải Trình', FIXED_TIME);
        const identities = {
            coreIdentity: project.coreIdentity,
            workflowIdentity: project.workflowIdentity,
            storyControlIdentity: project.storyControlIdentity,
        };
        renderExistingProjectSetupMarkdown(project.setupDocument, project.displayName);
        expect({
            coreIdentity: project.coreIdentity,
            workflowIdentity: project.workflowIdentity,
            storyControlIdentity: project.storyControlIdentity,
        }).toEqual(identities);
    });

    it('explicit design export contains author secret and the C0/non-backup warning', () => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const exported = renderExistingProjectSetupMarkdown(blueprintDocument(), 'Hải Trình');
        expect(exported).toContain(SECRET);
        expect(exported).toContain('DỰ ÁN MỚI');
        expect(exported).toContain('Canon C0');
        expect(exported).toContain('KHÔNG chứa Canon hiện tại');
        expect(exported).toContain('Narrative Memory');
        expect(errorLog).not.toHaveBeenCalled();
        errorLog.mockRestore();
    });

    it('does not add a catalog project ID to setup export', () => {
        expect(renderExistingProjectSetupMarkdown(blueprintDocument(), 'Tên hiển thị')).not.toContain('library-project-id-123');
    });

    it('sanitizes downloaded Markdown filenames', () => {
        expect(sanitizeSetupFilename('Truyện: A/B')).toBe('Truyện- A-B.md');
        expect(sanitizeSetupFilename('')).toBe('story-setup.md');
    });

    it('feeds wizard Markdown through the existing compiler and strict review path', async () => {
        const compiler = vi.fn(async (request: { readonly source: string }) => {
            expect(request.source).toContain('# Hải Trình');
            return { value: blueprintDocument(), modelId: 'injected', selectedModelId: 'injected' };
        });
        const prepared = await prepareAuthorTextStorySetupImport(
            renderStorySetupWizardMarkdown(completeDraft()), 'wizard.md', { compiler },
        );
        expect(compiler).toHaveBeenCalledOnce();
        expect(prepared.mode).toBe('author-text');
        expect(prepared.setupDocument.formatVersion).toBe(1);
        expect(prepared.review.plannedChapterCount).toBe(12);
        expect(prepared.review.authorSecretCount).toBe(1);
    });

    it('adds a wizard-created project without deleting the existing project or injecting library IDs', async () => {
        const ids = ['library-a', 'library-b'];
        const repository = new StoryStudioProjectRepository(
            new InMemoryStoryStudioStorageAdapter(),
            () => FIXED_TIME,
            () => ids.shift() ?? 'unexpected-id',
        );
        const controller = new StoryStudioProjectController(repository, () => FIXED_TIME);
        await controller.load();
        await controller.createProject(blueprintDocument(), 'A');
        const setupB = blueprintDocument();
        const projectB = await controller.createProject(setupB, 'B');
        expect(controller.projectLibrary.map(entry => entry.displayName)).toEqual(['A', 'B']);
        expect(controller.projectLibrary).toHaveLength(2);
        expect(controller.activeProjectId).toBe('library-b');
        expect(JSON.stringify(projectB.setupDocument)).not.toContain('library-a');
        expect(JSON.stringify(projectB.setupDocument)).not.toContain('library-b');
        expect(projectB.state.currentChapter).toBe(0);
        expect(projectB.state.revision).toBe(0);
    });

    it('retains the advanced V4 JSON offline path', () => {
        const prepared = prepareJsonStorySetupImport(JSON.stringify(blueprintDocument()), 'advanced.json');
        expect(prepared.mode).toBe('json');
        expect(prepared.setupDocument).toEqual(blueprintDocument());
    });

    it('allows wizard view over core-corrupt only for a verified valid library', () => {
        expect(getStoryStudioPreparedImportOrigin('core-corrupt', true)).toBe('verified-core-corrupt-library');
        expect(getStoryStudioPageView({
            loadStatus: 'core-corrupt', hasValidProjectLibrary: true, hasPreparedImport: false,
            hasOpenWizard: true, wizardOrigin: 'verified-core-corrupt-library',
            hasProject: false, showDemo: false,
        })).toBe('wizard');
    });

    it('does not let corrupt legacy or invalid index bypass fail-closed state through wizard', () => {
        expect(getStoryStudioPreparedImportOrigin('core-corrupt', false)).toBeUndefined();
        expect(getStoryStudioPageView({
            loadStatus: 'core-corrupt', hasValidProjectLibrary: false, hasPreparedImport: false,
            hasOpenWizard: true, wizardOrigin: undefined, hasProject: false, showDemo: false,
        })).toBe('core-corrupt');
    });

    it('keeps setup review above wizard and both above verified core-corrupt recovery', () => {
        expect(getStoryStudioPageView({
            loadStatus: 'core-corrupt', hasValidProjectLibrary: true, hasPreparedImport: true,
            preparedImportOrigin: 'verified-core-corrupt-library', hasOpenWizard: true,
            wizardOrigin: 'verified-core-corrupt-library', hasProject: false, showDemo: false,
        })).toBe('setup-review');
    });

    it('preserves Story Engine V4 and project document V1 compatibility markers', () => {
        const setup = blueprintDocument();
        expect(setup.formatVersion).toBe(1);
        const prepared = prepareJsonStorySetupImport(JSON.stringify(setup), 'setup.json');
        expect(prepared.setupDocument.formatVersion).toBe(1);
    });
});
