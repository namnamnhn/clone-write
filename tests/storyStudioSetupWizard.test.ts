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
import setupReviewUiSource from '../src/components/storyStudio/StorySetupReviewPanel.tsx?raw';

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

const fullHistoricalMilitaryDraft = (): StorySetupWizardDraftV1 => {
    const draft = createEmptyStorySetupWizardDraft(() => FIXED_TIME);
    return {
        ...draft,
        currentStep: 9,
        basic: {
            title: 'Biên Cương Mùa Gió Bắc',
            language: 'Tiếng Việt',
            primaryGenre: 'Lịch sử quân sự',
            secondaryGenres: 'Chính trị, xuyên không',
            plannedChapterCount: 12,
            scope: 'Truyện ngắn thử nghiệm',
            targetAudience: 'Người lớn',
            toneStyle: 'Nghiêm túc, chiến lược, thực tế',
            povPreference: 'Ngôi ba giới hạn',
        },
        core: {
            premise: 'Một viên quan hậu cần phải giữ biên thành qua mùa đông khi triều đình cắt viện trợ.',
            dramaticQuestion: 'Lâm Duy có thể cứu dân mà không biến mình thành kẻ độc tài hay không?',
            protagonistGoal: 'Giữ thành và mở tuyến lương thực trước đợt vây hãm cuối năm.',
            stakes: 'Thất bại khiến ba vạn dân mất nơi trú ẩn và chiến tranh lan xuống đồng bằng.',
            endingDirection: 'Thành được giữ bằng một liên minh mong manh, đổi lại Lâm Duy mất chức.',
            themes: 'Trách nhiệm, giới hạn quyền lực và cái giá của chiến thắng.',
            creativeBoundaries: 'Không thần thánh hóa chiến tranh; không dùng phép màu giải quyết hậu cần.',
        },
        characters: [
            {
                ...createEmptyWizardCharacter(() => 'draft-character-lam-duy'),
                name: 'Lâm Duy', age: '32', gender: 'Nam', role: 'Nhân vật chính / quan hậu cần',
                appearance: 'Cao gầy, tay có vết bỏng cũ.', personality: 'Điềm tĩnh, đa nghi nhưng thương dân.',
                background: 'Xuất thân thương gia đường sông, mới được bổ nhiệm ra biên ải.',
                motivations: 'Bảo vệ dân thành và chứng minh hậu cần quan trọng hơn hào quang chiến trận.',
                strengths: 'Tính toán nguồn lực và thương lượng.', weaknesses: 'Khó tin người, sợ thất bại công khai.',
                abilities: 'Mạng lưới lái buôn, bản đồ kho lương và kiến thức vận tải.',
                relationships: 'Đối đầu rồi hợp tác với Trần Minh.', introduction: 'Xuất hiện ngay chương 1.',
                povPreference: 'POV chính trong phần lớn câu chuyện.', notes: 'Học cách chia sẻ quyền quyết định.',
            },
            {
                ...createEmptyWizardCharacter(() => 'draft-character-tran-minh'),
                name: 'Trần Minh', age: '45', gender: 'Nam', role: 'Tướng giữ thành / đồng minh khó đoán',
                appearance: 'Vai rộng, tóc điểm bạc.', personality: 'Quyết đoán, trọng danh dự.',
                background: 'Lão tướng tại biên trấn, có quan hệ phức tạp với triều đình.',
                motivations: 'Giữ quân kỷ và bảo vệ gia tộc khỏi cáo buộc phản loạn.',
                strengths: 'Chỉ huy phòng thủ.', weaknesses: 'Cứng nhắc và xem nhẹ thương nhân.',
                abilities: 'Ba nghìn quân tinh nhuệ và uy tín trong thành.', relationships: 'Ban đầu nghi ngờ Lâm Duy.',
                introduction: 'Xuất hiện ở cuối chương 1.', povPreference: 'POV phụ ở các bước ngoặt quân sự.',
                notes: 'Từ đối thủ quyền lực thành người bảo chứng cho cải cách.',
            },
        ],
        world: {
            timePeriod: 'Vương triều giả tưởng ở trình độ tiền công nghiệp.',
            geography: 'Biên thành nằm giữa thảo nguyên phía bắc và tuyến sông đóng băng.',
            societyCulture: 'Quan lại, quân hộ và thương đoàn phụ thuộc lẫn nhau nhưng thiếu lòng tin.',
            institutionsFactions: 'Triều đình, quân biên trấn, Hội Thuyền và liên minh bộ tộc phương bắc.',
            technology: 'Cung nỏ, kỵ binh, thành lũy đá và tín hiệu lửa.',
            economyResources: 'Muối, ngũ cốc, ngựa và quyền kiểm soát bến sông.',
            lawsTaboos: 'Tự ý mở kho quân là trọng tội; thương lượng với địch bị xem là phản quốc.',
            powerSystem: '', ranksProgression: '',
            importantLocations: 'Kho Đông Môn, bến Hạc và đèo Phong Tuyết.',
            consistencyConstraints: 'Thời tiết, quãng đường và lượng lương phải khớp giữa các chương.',
            mysteryClues: '', hiddenTruthRevealCadence: '', socialCareerNetworks: '',
        },
        plot: {
            majorArcs: 'Arc 1: Khủng hoảng kho lương. Arc 2: Liên minh bất đắc dĩ. Arc 3: Cuộc vây hãm.',
            chapterPhases: 'Chương 1–3 điều tra thiếu hụt; 4–8 xây tuyến tiếp tế; 9–12 phòng thủ và trả giá.',
            turningPoints: 'Chương 4 phát hiện lệnh cắt viện trợ là giả; chương 9 bến Hạc bị đốt.',
            mustHappenEvents: 'Lâm Duy mở kho cứu dân; Trần Minh giao quyền bảo vệ đoàn thuyền.',
            foreshadowing: 'Con dấu lệch trên công văn và tiếng chuông kho vang sai giờ.',
            reveals: 'Kẻ làm giả lệnh là một quan trong phe chủ chiến của triều đình.',
            payoffs: 'Mạng lưới lái buôn trở thành tuyến tiếp tế quyết định ở chương 11.',
            endingDirection: 'Liên minh giữ được thành nhưng buộc phải công khai sai phạm của triều đình.',
            chapterNotes: 'Mỗi arc phải có một quyết định hậu cần gây hệ quả chính trị ở arc kế tiếp.',
        },
        relationships: [{
            ...createEmptyWizardRelationship(() => 'draft-relationship-duy-minh'),
            participants: 'Lâm Duy và Trần Minh',
            initialRelationship: 'Nghi ngờ năng lực và động cơ của nhau.',
            intendedEvolution: 'Từ đối đầu sang tôn trọng và cùng chịu trách nhiệm.',
            relationshipType: 'Phi lãng mạn; đồng minh chính trị và quân sự.',
            boundaries: 'Không biến thành phục tùng tuyệt đối hoặc chấm điểm tình cảm.',
            importantEvents: 'Trần Minh trao quyền hộ tống; Lâm Duy nhận lỗi trước quân dân.',
            structureNotes: 'Quan hệ độc lập theo cặp, không có trạng thái harem toàn cục.',
        }],
        strategy: {
            factionsObjectives: 'Triều đình muốn giữ thể diện; biên quân cần lương; thương đoàn cần hành lang an toàn.',
            relativeCapabilities: 'Biên quân mạnh phòng thủ nhưng yếu vận tải; thương đoàn linh hoạt nhưng thiếu vũ lực.',
            politicalConstraints: 'Không phe nào được công khai thừa nhận đã thương lượng với bộ tộc phương bắc.',
            militaryLogistics: 'Ba nghìn quân chỉ còn lương cho hai mươi ngày và đường bộ sắp bị tuyết khóa.',
            economicResources: 'Muối đổi ngựa; quyền thu phí bến sông là đòn bẩy thương lượng.',
            strategicRedLines: 'Không hy sinh dân thường để tạo chiến thắng nhanh; không có kết quả thắng được mô phỏng sẵn.',
        },
        authorRules: {
            secrets: 'Người làm giả lệnh cắt viện trợ là thầy cũ của Lâm Duy.',
            hiddenTruths: 'Trần Minh biết con dấu giả từ chương 2 nhưng im lặng để bảo vệ con trai.',
            futureReveals: 'Chỉ hé lộ vai trò của Trần Minh sau khi bến Hạc bị đốt.',
            canonRules: 'Nguồn lương, quân số và thời gian di chuyển phải được tính nhất quán.',
            forbiddenEvents: 'Không có viện quân xuất hiện vô cớ để giải vây.',
            forbiddenReveals: 'Không nêu danh tính kẻ làm giả trước bước ngoặt chương 9.',
            continuityRules: 'Mọi tổn thất kho lương phải được phản ánh ở các chương sau.',
            contentBoundaries: 'Không miêu tả bạo lực với trẻ em một cách trực diện.',
            styleBoundaries: 'Không dùng giọng hài nhại trong cảnh thương vong.',
        },
    };
};

class MemoryDraftAdapter implements StorySetupWizardDraftAdapter {
    value: unknown;
    saves = 0;
    clears = 0;
    failClear = false;
    async load() { return this.value; }
    async save(value: StorySetupWizardDraftV1) { this.saves += 1; this.value = structuredClone(value); }
    async clear() {
        this.clears += 1;
        if (this.failClear) throw new Error('draft cleanup failed');
        this.value = undefined;
    }
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

    it('adds, reorders and removes relationship cards without leaking draft IDs', () => {
        const first = {
            ...createEmptyWizardRelationship(() => 'relationship-draft-first'),
            participants: 'Lâm Duy và Trần Minh',
        };
        const second = {
            ...createEmptyWizardRelationship(() => 'relationship-draft-second'),
            participants: 'Lâm Duy và Hội Thuyền',
        };
        const added = [first, second];
        const reordered = reorderWizardItem(added, 1, 0);
        const removed = reordered.filter(item => item.draftId !== first.draftId);
        expect(reordered.map(item => item.participants)).toEqual(['Lâm Duy và Hội Thuyền', 'Lâm Duy và Trần Minh']);
        expect(removed).toEqual([second]);
        expect(renderStorySetupWizardMarkdown({ ...fullHistoricalMilitaryDraft(), relationships: reordered }))
            .not.toMatch(/relationship-draft-(?:first|second)/);
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

    it('covers Steps 5–8 with deterministic author context and no invented optional data', () => {
        const draft = fullHistoricalMilitaryDraft();
        const markdown = renderStorySetupWizardMarkdown(draft);
        const realValues = [
            draft.plot.majorArcs, draft.plot.chapterPhases, draft.plot.turningPoints,
            draft.plot.mustHappenEvents, draft.plot.foreshadowing, draft.plot.reveals,
            draft.plot.payoffs, draft.plot.endingDirection, draft.plot.chapterNotes,
            draft.relationships[0].participants, draft.relationships[0].initialRelationship,
            draft.relationships[0].intendedEvolution, draft.relationships[0].relationshipType,
            draft.relationships[0].boundaries, draft.relationships[0].importantEvents,
            draft.relationships[0].structureNotes, draft.strategy.factionsObjectives,
            draft.strategy.relativeCapabilities, draft.strategy.politicalConstraints,
            draft.strategy.militaryLogistics, draft.strategy.economicResources,
            draft.strategy.strategicRedLines, draft.authorRules.canonRules,
            draft.authorRules.continuityRules, draft.authorRules.forbiddenEvents,
            draft.authorRules.forbiddenReveals, draft.authorRules.contentBoundaries,
            draft.authorRules.styleBoundaries,
        ];
        realValues.forEach(value => expect(markdown).toContain(value));
        expect(markdown).toBe(renderStorySetupWizardMarkdown(fullHistoricalMilitaryDraft()));
        expect(markdown).not.toContain('HỆ THỐNG SỨC MẠNH / TIẾN TRÌNH');
        expect(markdown).not.toContain('BÍ ẨN / MANH MỐI');
        expect(markdown).not.toContain('[CHƯA');
        expect(wizardRuntimeSource).not.toMatch(/affection(?:Score|Database)|haremWideState|winnerSimulator/i);
    });

    it('strictly parses and validates a realistic complete historical/military V1 fixture', () => {
        const fixture = fullHistoricalMilitaryDraft();
        expect(parseStorySetupWizardDraft(structuredClone(fixture))).toEqual(fixture);
        expect(validateStorySetupWizardDraft(fixture)).toEqual([]);
        expect(fixture.kind).toBe('story-setup-wizard-draft');
        expect(fixture.formatVersion).toBe(1);
        expect(getStorySetupGenreEmphasis(fixture.basic.primaryGenre)).toBe('historical-strategy');
    });

    it('marks author secrets explicitly only in the author-owned artifact', () => {
        const markdown = renderStorySetupWizardMarkdown(completeDraft());
        expect(markdown).toContain('## BÍ MẬT CHỈ DÀNH CHO TÁC GIẢ');
        expect(markdown).toContain('[AUTHOR_SECRET]: ' + SECRET);
        expect(auditAuthorSetupSource(markdown).authorSecretCount).toBe(1);
    });

    it('treats entered secret, hidden truth and future reveal as exact author-owned declarations', () => {
        const draft = fullHistoricalMilitaryDraft();
        const markdown = renderStorySetupWizardMarkdown(draft);
        const secretValues = [draft.authorRules.secrets, draft.authorRules.hiddenTruths, draft.authorRules.futureReveals];
        secretValues.forEach(value => expect(markdown).toContain('[AUTHOR_SECRET]: ' + value));
        expect(auditAuthorSetupSource(markdown).authorSecretCount).toBe(secretValues.length);
        expect(setupReviewUiSource).not.toContain('authorOnlySecrets');
        expect(setupReviewUiSource).not.toContain('setupDocument');
        expect(setupReviewUiSource).toContain('review.authorSecretCount');
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

    it('blank template explains secret syntax without declaring or inventing a secret', () => {
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).toContain('BÍ MẬT CHỈ DÀNH CHO TÁC GIẢ');
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).toContain('cú pháp [AUTHOR_SECRET]:');
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).toContain('Không tạo dòng đó nếu chưa có bí mật');
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).not.toContain(SECRET);
        expect(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN).not.toMatch(/AIza|api[_ -]?key/i);
    });

    it('keeps every untouched blank-template audit signal neutral', () => {
        expect(auditAuthorSetupSource(STORY_SETUP_BLANK_TEMPLATE_MARKDOWN)).toEqual({
            arcRanges: [],
            authorSecretCount: 0,
            spoilerMarkerCount: 0,
            recognizedV3CharacterTimings: [],
        });
    });

    it('retains secret-underrun protection for a genuine declaration', async () => {
        const documentWithoutSecrets = blueprintDocument();
        const compiledWithoutSecrets: StoryBlueprintDocument = {
            ...documentWithoutSecrets,
            blueprint: { ...documentWithoutSecrets.blueprint, authorOnlySecrets: [] },
        };
        const prepared = await prepareAuthorTextStorySetupImport(
            '# Truyện kiểm thử\n\n## BÍ MẬT CHỈ DÀNH CHO TÁC GIẢ\n[AUTHOR_SECRET]: bí mật thật do tác giả nhập',
            'genuine-secret.md',
            { compiler: async () => ({ value: compiledWithoutSecrets, selectedModelId: 'injected' }) },
        );
        expect(prepared.review.criticalIssues.map(issue => issue.code)).toContain('AUTHOR_SECRET_COUNT_UNDERRUN');
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

    it('completes the full-wizard Markdown -> strict review -> isolated C0 project roundtrip', async () => {
        const draft = fullHistoricalMilitaryDraft();
        const markdown = renderStorySetupWizardMarkdown(draft);
        const allAuthorText = [
            ...Object.values(draft.basic).filter((value): value is string => typeof value === 'string'),
            ...Object.values(draft.core),
            ...draft.characters.flatMap(character => Object.entries(character)
                .filter(([key]) => key !== 'draftId').map(([, value]) => value)),
            ...Object.values(draft.world), ...Object.values(draft.plot),
            ...draft.relationships.flatMap(relationship => Object.entries(relationship)
                .filter(([key]) => key !== 'draftId').map(([, value]) => value)),
            ...Object.values(draft.strategy), ...Object.values(draft.authorRules),
        ].filter(value => value.trim());
        allAuthorText.forEach(value => expect(markdown).toContain(value));
        const sourceAudit = auditAuthorSetupSource(markdown);
        expect(sourceAudit.plannedChapterCount).toBe(12);
        expect(sourceAudit.authorSecretCount).toBe(3);
        expect(markdown).not.toMatch(/draft-character-|draft-relationship-/);

        const compiledDocument = blueprintDocument();
        const compiledWithAllSecrets: StoryBlueprintDocument = {
            ...compiledDocument,
            blueprint: {
                ...compiledDocument.blueprint,
                authorOnlySecrets: [draft.authorRules.secrets, draft.authorRules.hiddenTruths, draft.authorRules.futureReveals]
                    .map((value, index) => ({ id: 'secret-' + (index + 1), value, revealId: 'truth' })),
            },
        };
        const compiler = vi.fn(async (request: { readonly source: string }) => {
            expect(request.source).toBe(markdown);
            return { value: compiledWithAllSecrets, modelId: 'injected', selectedModelId: 'injected' };
        });
        const projectIds = ['existing-project-id', 'wizard-project-id'];
        const controller = new StoryStudioProjectController(
            new StoryStudioProjectRepository(
                new InMemoryStoryStudioStorageAdapter(),
                () => FIXED_TIME,
                () => projectIds.shift() ?? 'unexpected-project-id',
            ),
            () => FIXED_TIME,
        );
        await controller.load();
        const existing = await controller.createProject(blueprintDocument(), 'Dự án đang viết');
        const existingIdentity = existing.coreIdentity;
        const prepared = await prepareAuthorTextStorySetupImport(markdown, 'full-wizard.md', { compiler });

        expect(compiler).toHaveBeenCalledOnce();
        expect(prepared.mode).toBe('author-text');
        expect(prepared.setupDocument.formatVersion).toBe(1);
        expect(prepared.review.criticalIssues).toEqual([]);
        expect(JSON.stringify(prepared.review)).not.toContain(draft.authorRules.secrets);
        expect(controller.projectLibrary).toHaveLength(1);
        expect(controller.currentProject?.coreIdentity).toBe(existingIdentity);

        const draftAdapter = new MemoryDraftAdapter();
        const draftRepository = new StorySetupWizardDraftRepository(draftAdapter);
        await draftRepository.save(draft);
        let publishedProject = controller.currentProject;
        const completion = await completeDurableWizardCreate(
            () => controller.createProject(prepared.setupDocument, draft.basic.title),
            project => { publishedProject = project; },
            () => draftRepository.clear(),
        );

        expect(completion.draftCleared).toBe(true);
        expect(await draftRepository.load()).toEqual({ status: 'empty' });
        expect(controller.projectLibrary.map(entry => entry.projectId)).toEqual(['existing-project-id', 'wizard-project-id']);
        expect(controller.projectLibrary.map(entry => entry.displayName)).toEqual(['Dự án đang viết', draft.basic.title]);
        expect(publishedProject?.state.currentChapter).toBe(0);
        expect(publishedProject?.state.revision).toBe(0);
        expect(existing.coreIdentity).toBe(existingIdentity);
        expect(JSON.stringify({
            setupDocument: publishedProject?.setupDocument,
            coreIdentity: publishedProject?.coreIdentity,
            workflowIdentity: publishedProject?.workflowIdentity,
            storyControlIdentity: publishedProject?.storyControlIdentity,
        })).not.toMatch(/existing-project-id|wizard-project-id/);
    });

    it('preserves the wizard draft and current project/library when compilation fails', async () => {
        const controller = new StoryStudioProjectController(
            new StoryStudioProjectRepository(new InMemoryStoryStudioStorageAdapter(), () => FIXED_TIME, () => 'existing-project-id'),
            () => FIXED_TIME,
        );
        await controller.load();
        await controller.createProject(blueprintDocument(), 'Dự án đang viết');
        const projectBefore = structuredClone(controller.currentProject);
        const libraryBefore = structuredClone(controller.projectLibrary);
        const adapter = new MemoryDraftAdapter();
        const drafts = new StorySetupWizardDraftRepository(adapter);
        await drafts.save(fullHistoricalMilitaryDraft());

        await expect(prepareAuthorTextStorySetupImport(
            renderStorySetupWizardMarkdown(fullHistoricalMilitaryDraft()),
            'failed-wizard.md',
            { compiler: vi.fn().mockRejectedValue(new Error('private provider failure')) },
        )).rejects.toMatchObject({ code: 'SETUP_COMPILER_FAILED' });

        expect(controller.currentProject).toEqual(projectBefore);
        expect(controller.projectLibrary).toEqual(libraryBefore);
        expect(await drafts.load()).toEqual({ status: 'loaded', draft: fullHistoricalMilitaryDraft() });
    });

    it('keeps a durably created project and retryable draft when cleanup fails', async () => {
        const projectIds = ['existing-project-id', 'wizard-project-id'];
        const controller = new StoryStudioProjectController(
            new StoryStudioProjectRepository(
                new InMemoryStoryStudioStorageAdapter(), () => FIXED_TIME,
                () => projectIds.shift() ?? 'unexpected-project-id',
            ),
            () => FIXED_TIME,
        );
        await controller.load();
        await controller.createProject(blueprintDocument(), 'Dự án đang viết');
        const adapter = new MemoryDraftAdapter();
        const drafts = new StorySetupWizardDraftRepository(adapter);
        await drafts.save(fullHistoricalMilitaryDraft());
        adapter.failClear = true;

        let published = controller.currentProject;
        const result = await completeDurableWizardCreate(
            () => controller.createProject(blueprintDocument(), 'Dự án từ wizard'),
            project => { published = project; },
            () => drafts.clear(),
        );

        expect(result.draftCleared).toBe(false);
        expect(published?.state.currentChapter).toBe(0);
        expect(controller.projectLibrary).toHaveLength(2);
        expect(controller.activeProjectId).toBe('wizard-project-id');
        expect(await drafts.load()).toEqual({ status: 'loaded', draft: fullHistoricalMilitaryDraft() });
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
