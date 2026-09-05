import type { StoryBlueprintDocument } from '../../storyEngine';
import { clearSessionRecord, loadFromStorage, saveToStorage } from '../../utils/storage';

export const STORY_SETUP_WIZARD_DRAFT_KEY = 'story_studio_v4_setup_wizard_draft_v1';

export interface StorySetupWizardCharacter {
    readonly draftId: string;
    readonly name: string;
    readonly age: string;
    readonly gender: string;
    readonly role: string;
    readonly appearance: string;
    readonly personality: string;
    readonly background: string;
    readonly motivations: string;
    readonly strengths: string;
    readonly weaknesses: string;
    readonly abilities: string;
    readonly relationships: string;
    readonly introduction: string;
    readonly povPreference: string;
    readonly notes: string;
}

export interface StorySetupWizardRelationship {
    readonly draftId: string;
    readonly participants: string;
    readonly initialRelationship: string;
    readonly intendedEvolution: string;
    readonly relationshipType: string;
    readonly boundaries: string;
    readonly importantEvents: string;
    readonly structureNotes: string;
}

export interface StorySetupWizardDraftV1 {
    readonly kind: 'story-setup-wizard-draft';
    readonly formatVersion: 1;
    readonly currentStep: number;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly basic: {
        readonly title: string;
        readonly language: string;
        readonly primaryGenre: string;
        readonly secondaryGenres: string;
        readonly plannedChapterCount: number;
        readonly scope: string;
        readonly targetAudience: string;
        readonly toneStyle: string;
        readonly povPreference: string;
    };
    readonly core: {
        readonly premise: string;
        readonly dramaticQuestion: string;
        readonly protagonistGoal: string;
        readonly stakes: string;
        readonly endingDirection: string;
        readonly themes: string;
        readonly creativeBoundaries: string;
    };
    readonly characters: readonly StorySetupWizardCharacter[];
    readonly world: {
        readonly timePeriod: string;
        readonly geography: string;
        readonly societyCulture: string;
        readonly institutionsFactions: string;
        readonly technology: string;
        readonly economyResources: string;
        readonly lawsTaboos: string;
        readonly powerSystem: string;
        readonly ranksProgression: string;
        readonly importantLocations: string;
        readonly consistencyConstraints: string;
        readonly mysteryClues: string;
        readonly hiddenTruthRevealCadence: string;
        readonly socialCareerNetworks: string;
    };
    readonly plot: {
        readonly majorArcs: string;
        readonly chapterPhases: string;
        readonly turningPoints: string;
        readonly mustHappenEvents: string;
        readonly foreshadowing: string;
        readonly reveals: string;
        readonly payoffs: string;
        readonly endingDirection: string;
        readonly chapterNotes: string;
    };
    readonly relationships: readonly StorySetupWizardRelationship[];
    readonly strategy: {
        readonly factionsObjectives: string;
        readonly relativeCapabilities: string;
        readonly politicalConstraints: string;
        readonly militaryLogistics: string;
        readonly economicResources: string;
        readonly strategicRedLines: string;
    };
    readonly authorRules: {
        readonly secrets: string;
        readonly hiddenTruths: string;
        readonly futureReveals: string;
        readonly canonRules: string;
        readonly forbiddenEvents: string;
        readonly forbiddenReveals: string;
        readonly continuityRules: string;
        readonly contentBoundaries: string;
        readonly styleBoundaries: string;
    };
}

export type WizardDraftIdGenerator = () => string;

export const createWizardDraftId: WizardDraftIdGenerator = () => {
    const browserCrypto = typeof crypto === 'undefined' ? undefined : crypto;
    if (browserCrypto?.randomUUID) return browserCrypto.randomUUID();
    const bytes = new Uint8Array(16);
    browserCrypto?.getRandomValues?.(bytes);
    if (bytes.some(Boolean)) return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return 'draft-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
};

export const createEmptyWizardCharacter = (generateId: WizardDraftIdGenerator = createWizardDraftId): StorySetupWizardCharacter => ({
    draftId: generateId(), name: '', age: '', gender: '', role: '', appearance: '', personality: '', background: '',
    motivations: '', strengths: '', weaknesses: '', abilities: '', relationships: '', introduction: '', povPreference: '', notes: '',
});

export const createEmptyWizardRelationship = (generateId: WizardDraftIdGenerator = createWizardDraftId): StorySetupWizardRelationship => ({
    draftId: generateId(), participants: '', initialRelationship: '', intendedEvolution: '', relationshipType: '',
    boundaries: '', importantEvents: '', structureNotes: '',
});

export const createEmptyStorySetupWizardDraft = (
    now: () => string = () => new Date().toISOString(),
): StorySetupWizardDraftV1 => {
    const timestamp = now();
    return {
        kind: 'story-setup-wizard-draft', formatVersion: 1, currentStep: 1, createdAt: timestamp, updatedAt: timestamp,
        basic: { title: '', language: '', primaryGenre: '', secondaryGenres: '', plannedChapterCount: 0, scope: '', targetAudience: '', toneStyle: '', povPreference: '' },
        core: { premise: '', dramaticQuestion: '', protagonistGoal: '', stakes: '', endingDirection: '', themes: '', creativeBoundaries: '' },
        characters: [],
        world: { timePeriod: '', geography: '', societyCulture: '', institutionsFactions: '', technology: '', economyResources: '', lawsTaboos: '', powerSystem: '', ranksProgression: '', importantLocations: '', consistencyConstraints: '', mysteryClues: '', hiddenTruthRevealCadence: '', socialCareerNetworks: '' },
        plot: { majorArcs: '', chapterPhases: '', turningPoints: '', mustHappenEvents: '', foreshadowing: '', reveals: '', payoffs: '', endingDirection: '', chapterNotes: '' },
        relationships: [],
        strategy: { factionsObjectives: '', relativeCapabilities: '', politicalConstraints: '', militaryLogistics: '', economicResources: '', strategicRedLines: '' },
        authorRules: { secrets: '', hiddenTruths: '', futureReveals: '', canonRules: '', forbiddenEvents: '', forbiddenReveals: '', continuityRules: '', contentBoundaries: '', styleBoundaries: '' },
    };
};

export const reorderWizardItem = <T>(items: readonly T[], from: number, to: number): readonly T[] => {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
    const next = [...items];
    const item = next.splice(from, 1)[0];
    next.splice(to, 0, item);
    return next;
};

const object = (value: unknown, path: string, keys: readonly string[]): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(path + ': invalid object');
    const record = value as Record<string, unknown>;
    const unknown = Object.keys(record).find(key => !keys.includes(key));
    if (unknown) throw new Error(path + '.' + unknown + ': unsupported');
    if (keys.some(key => !(key in record))) throw new Error(path + ': missing field');
    return record;
};
const stringValue = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || value.length > 262144) throw new Error(path + ': invalid string');
    return value;
};
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(path + ': invalid integer');
    return value;
};
const isoTimestamp = (value: unknown, path: string): string => {
    const result = stringValue(value, path);
    if (!result.trim() || !Number.isFinite(Date.parse(result))) throw new Error(path + ': invalid timestamp');
    return result;
};
const stringRecord = <K extends string>(value: unknown, path: string, keys: readonly K[]): Record<K, string> => {
    const record = object(value, path, keys);
    return Object.fromEntries(keys.map(key => [key, stringValue(record[key], path + '.' + key)])) as Record<K, string>;
};

const CHARACTER_KEYS: readonly (keyof StorySetupWizardCharacter)[] = ['draftId', 'name', 'age', 'gender', 'role', 'appearance', 'personality', 'background', 'motivations', 'strengths', 'weaknesses', 'abilities', 'relationships', 'introduction', 'povPreference', 'notes'];
const RELATIONSHIP_KEYS: readonly (keyof StorySetupWizardRelationship)[] = ['draftId', 'participants', 'initialRelationship', 'intendedEvolution', 'relationshipType', 'boundaries', 'importantEvents', 'structureNotes'];
const BASIC_KEYS = ['title', 'language', 'primaryGenre', 'secondaryGenres', 'plannedChapterCount', 'scope', 'targetAudience', 'toneStyle', 'povPreference'] as const;
const CORE_KEYS = ['premise', 'dramaticQuestion', 'protagonistGoal', 'stakes', 'endingDirection', 'themes', 'creativeBoundaries'] as const;
const WORLD_KEYS = ['timePeriod', 'geography', 'societyCulture', 'institutionsFactions', 'technology', 'economyResources', 'lawsTaboos', 'powerSystem', 'ranksProgression', 'importantLocations', 'consistencyConstraints', 'mysteryClues', 'hiddenTruthRevealCadence', 'socialCareerNetworks'] as const;
const PLOT_KEYS = ['majorArcs', 'chapterPhases', 'turningPoints', 'mustHappenEvents', 'foreshadowing', 'reveals', 'payoffs', 'endingDirection', 'chapterNotes'] as const;
const STRATEGY_KEYS = ['factionsObjectives', 'relativeCapabilities', 'politicalConstraints', 'militaryLogistics', 'economicResources', 'strategicRedLines'] as const;
const AUTHOR_RULE_KEYS = ['secrets', 'hiddenTruths', 'futureReveals', 'canonRules', 'forbiddenEvents', 'forbiddenReveals', 'continuityRules', 'contentBoundaries', 'styleBoundaries'] as const;

export const parseStorySetupWizardDraft = (value: unknown): StorySetupWizardDraftV1 => {
    const rootKeys = ['kind', 'formatVersion', 'currentStep', 'createdAt', 'updatedAt', 'basic', 'core', 'characters', 'world', 'plot', 'relationships', 'strategy', 'authorRules'] as const;
    const root = object(value, 'wizardDraft', rootKeys);
    if (root.kind !== 'story-setup-wizard-draft' || root.formatVersion !== 1) throw new Error('wizardDraft: unsupported version');
    const basicRecord = object(root.basic, 'wizardDraft.basic', BASIC_KEYS);
    const plannedChapterCount = integer(basicRecord.plannedChapterCount, 'wizardDraft.basic.plannedChapterCount', 0, 100000);
    if (!Array.isArray(root.characters) || !Array.isArray(root.relationships)) throw new Error('wizardDraft: invalid list');
    if (root.characters.length > 200 || root.relationships.length > 500) throw new Error('wizardDraft: list too large');
    const characters = root.characters.map((entry, index) => stringRecord(entry, 'wizardDraft.characters.' + index, CHARACTER_KEYS));
    const relationships = root.relationships.map((entry, index) => stringRecord(entry, 'wizardDraft.relationships.' + index, RELATIONSHIP_KEYS));
    if (characters.some(item => !item.draftId.trim()) || new Set(characters.map(item => item.draftId)).size !== characters.length) throw new Error('wizardDraft.characters: invalid IDs');
    if (relationships.some(item => !item.draftId.trim()) || new Set(relationships.map(item => item.draftId)).size !== relationships.length) throw new Error('wizardDraft.relationships: invalid IDs');
    const basicStrings = Object.fromEntries(BASIC_KEYS.filter(key => key !== 'plannedChapterCount').map(key => [key, stringValue(basicRecord[key], 'wizardDraft.basic.' + key)]));
    const createdAt = isoTimestamp(root.createdAt, 'wizardDraft.createdAt');
    const updatedAt = isoTimestamp(root.updatedAt, 'wizardDraft.updatedAt');
    if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error('wizardDraft: invalid timestamp order');
    return {
        kind: 'story-setup-wizard-draft', formatVersion: 1,
        currentStep: integer(root.currentStep, 'wizardDraft.currentStep', 1, 9),
        createdAt, updatedAt,
        basic: { ...(basicStrings as Omit<StorySetupWizardDraftV1['basic'], 'plannedChapterCount'>), plannedChapterCount },
        core: stringRecord(root.core, 'wizardDraft.core', CORE_KEYS), characters,
        world: stringRecord(root.world, 'wizardDraft.world', WORLD_KEYS),
        plot: stringRecord(root.plot, 'wizardDraft.plot', PLOT_KEYS), relationships,
        strategy: stringRecord(root.strategy, 'wizardDraft.strategy', STRATEGY_KEYS),
        authorRules: stringRecord(root.authorRules, 'wizardDraft.authorRules', AUTHOR_RULE_KEYS),
    };
};

export interface StorySetupWizardValidationIssue { readonly field: string; readonly message: string; }
export const validateStorySetupWizardDraft = (draft: StorySetupWizardDraftV1): readonly StorySetupWizardValidationIssue[] => {
    const issues: StorySetupWizardValidationIssue[] = [];
    const required = (field: string, value: string, label: string) => { if (!value.trim()) issues.push({ field, message: 'Vui lòng nhập ' + label + '.' }); };
    required('basic.title', draft.basic.title, 'tên truyện');
    required('basic.language', draft.basic.language, 'ngôn ngữ sáng tác');
    required('basic.primaryGenre', draft.basic.primaryGenre, 'thể loại chính');
    if (!Number.isSafeInteger(draft.basic.plannedChapterCount) || draft.basic.plannedChapterCount < 1) issues.push({ field: 'basic.plannedChapterCount', message: 'Số chương dự kiến phải lớn hơn 0.' });
    required('core.premise', draft.core.premise, 'premise / ý tưởng cốt lõi');
    required('core.protagonistGoal', draft.core.protagonistGoal, 'mục tiêu nhân vật chính');
    if (draft.characters.length === 0) issues.push({ field: 'characters', message: 'Cần ít nhất một nhân vật.' });
    draft.characters.forEach((character, index) => required('characters.' + index + '.name', character.name, 'tên nhân vật ' + (index + 1)));
    return issues;
};

export type StorySetupGenreEmphasis = 'generic' | 'historical-strategy' | 'fantasy-progression' | 'mystery' | 'social-relationship';
export const getStorySetupGenreEmphasis = (genre: string): StorySetupGenreEmphasis => {
    const folded = genre.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd');
    if (/(lich su|quan su|chinh tri|military|histor)/.test(folded)) return 'historical-strategy';
    if (/(fantasy|huyen|tien hiep|tu tien|cultivation|magic)/.test(folded)) return 'fantasy-progression';
    if (/(trinh tham|bi an|thriller|mystery)/.test(folded)) return 'mystery';
    if (/(do thi|kinh doanh|romance|ngon tinh|tinh cam)/.test(folded)) return 'social-relationship';
    return 'generic';
};

const normalized = (value: string): string => value.replace(/\r\n?/g, '\n').trim();
const labeled = (label: string, value: string): string => {
    const text = normalized(value);
    return text ? '- **' + label + ':** ' + text.replace(/\n/g, '\n  ') : '';
};
const joinLabeled = (values: readonly string[]): string => values.filter(Boolean).join('\n');
const appendSection = (lines: string[], heading: string, value: string): void => {
    const text = normalized(value);
    if (text) lines.push('', '## ' + heading, '', text);
};

export const renderStorySetupWizardMarkdown = (draft: StorySetupWizardDraftV1): string => {
    const lines = ['# ' + (normalized(draft.basic.title) || '[CHƯA NHẬP TÊN TRUYỆN]')];
    appendSection(lines, 'THÔNG TIN CƠ BẢN', joinLabeled([
        labeled('Ngôn ngữ sáng tác', draft.basic.language), labeled('Thể loại chính', draft.basic.primaryGenre),
        labeled('Thể loại / phong vị phụ', draft.basic.secondaryGenres),
        draft.basic.plannedChapterCount > 0 ? '- Số chương dự kiến: ' + draft.basic.plannedChapterCount : '',
        labeled('Độ dài / tầm vóc', draft.basic.scope), labeled('Độc giả mục tiêu', draft.basic.targetAudience),
    ]));
    appendSection(lines, 'PREMISE / Ý TƯỞNG CỐT LÕI', joinLabeled([
        labeled('Premise', draft.core.premise), labeled('Câu hỏi kịch tính trung tâm', draft.core.dramaticQuestion),
        labeled('Mục tiêu nhân vật chính', draft.core.protagonistGoal), labeled('Cái giá / nguy cơ', draft.core.stakes),
        labeled('Hướng kết', draft.core.endingDirection), labeled('Chủ đề', draft.core.themes),
        labeled('Điều truyện không được trở thành', draft.core.creativeBoundaries),
    ]));
    appendSection(lines, 'PHONG CÁCH / TONE / POV', joinLabeled([
        labeled('Tone, không khí, phong cách', draft.basic.toneStyle),
        labeled('Góc nhìn / ngôi kể mong muốn', draft.basic.povPreference),
    ]));
    if (draft.characters.length > 0) appendSection(lines, 'NHÂN VẬT', draft.characters.map((character, index) => [
        '### ' + (index + 1) + '. ' + (normalized(character.name) || '[CHƯA NHẬP TÊN NHÂN VẬT]'),
        joinLabeled([
            labeled('Tuổi / mô tả tuổi', character.age), labeled('Giới tính', character.gender), labeled('Vai trò', character.role),
            labeled('Ngoại hình', character.appearance), labeled('Tính cách', character.personality), labeled('Xuất thân', character.background),
            labeled('Động lực / mục tiêu', character.motivations), labeled('Điểm mạnh', character.strengths),
            labeled('Điểm yếu / khuyết điểm', character.weaknesses), labeled('Kỹ năng / sức mạnh / nguồn lực', character.abilities),
            labeled('Quan hệ quan trọng', character.relationships), labeled('Dự kiến xuất hiện', character.introduction),
            labeled('Khả năng là nhân vật góc nhìn', character.povPreference), labeled('Ghi chú / hướng phát triển', character.notes),
        ]),
    ].filter(Boolean).join('\n')).join('\n\n'));
    appendSection(lines, 'THẾ GIỚI', joinLabeled([
        labeled('Thời kỳ', draft.world.timePeriod), labeled('Không gian / địa lý', draft.world.geography),
        labeled('Xã hội / văn hóa', draft.world.societyCulture), labeled('Tổ chức / phe phái', draft.world.institutionsFactions),
        labeled('Trình độ công nghệ', draft.world.technology), labeled('Kinh tế / tài nguyên', draft.world.economyResources),
        labeled('Luật lệ / cấm kỵ', draft.world.lawsTaboos), labeled('Địa điểm quan trọng', draft.world.importantLocations),
        labeled('Ràng buộc nhất quán', draft.world.consistencyConstraints),
        labeled('Môi trường xã hội / nghề nghiệp / gia đình', draft.world.socialCareerNetworks),
    ]));
    appendSection(lines, 'HỆ THỐNG SỨC MẠNH / TIẾN TRÌNH (NẾU CÓ)', joinLabeled([
        labeled('Hệ thống', draft.world.powerSystem), labeled('Cấp bậc / tiến trình', draft.world.ranksProgression),
    ]));
    appendSection(lines, 'BÍ ẨN / MANH MỐI (NẾU CÓ)', joinLabeled([
        labeled('Nhóm manh mối', draft.world.mysteryClues),
        labeled('Sự thật ẩn và nhịp hé lộ', draft.world.hiddenTruthRevealCadence),
    ]));
    appendSection(lines, 'CÁC ARC CHÍNH & NHỊP DÀI', joinLabeled([
        labeled('Arc chính', draft.plot.majorArcs), labeled('Khoảng chương / giai đoạn dự kiến', draft.plot.chapterPhases),
        labeled('Ghi chú chương / arc', draft.plot.chapterNotes),
    ]));
    appendSection(lines, 'SỰ KIỆN / TURNING POINTS', joinLabeled([
        labeled('Bước ngoặt lớn', draft.plot.turningPoints), labeled('Sự kiện bắt buộc phải xảy ra', draft.plot.mustHappenEvents),
        labeled('Hướng kết', draft.plot.endingDirection),
    ]));
    appendSection(lines, 'FORESHADOW / REVEAL / PAYOFF', joinLabeled([
        labeled('Gieo báo', draft.plot.foreshadowing), labeled('Hé lộ', draft.plot.reveals), labeled('Thu hoạch / payoff', draft.plot.payoffs),
    ]));
    if (draft.relationships.length > 0) appendSection(lines, 'QUAN HỆ / TÌNH CẢM', draft.relationships.map((relationship, index) => [
        '### Quan hệ ' + (index + 1) + ': ' + (normalized(relationship.participants) || '[CHƯA CHỈ ĐỊNH]'),
        joinLabeled([
            labeled('Ban đầu', relationship.initialRelationship), labeled('Tiến triển mong muốn', relationship.intendedEvolution),
            labeled('Lãng mạn / phi lãng mạn', relationship.relationshipType), labeled('Ranh giới', relationship.boundaries),
            labeled('Sự kiện quan hệ quan trọng', relationship.importantEvents), labeled('Cấu trúc tình cảm', relationship.structureNotes),
        ]),
    ].filter(Boolean).join('\n')).join('\n\n'));
    appendSection(lines, 'THẾ LỰC / CHÍNH TRỊ / QUÂN SỰ / KINH TẾ (NẾU CÓ)', joinLabeled([
        labeled('Phe phái và mục tiêu', draft.strategy.factionsObjectives), labeled('Năng lực tương đối', draft.strategy.relativeCapabilities),
        labeled('Ràng buộc chính trị', draft.strategy.politicalConstraints), labeled('Quân sự / hậu cần', draft.strategy.militaryLogistics),
        labeled('Kinh tế / thương nghiệp / nguồn lực', draft.strategy.economicResources), labeled('Lằn ranh chiến lược', draft.strategy.strategicRedLines),
    ]));
    appendSection(lines, 'LUẬT CANON', joinLabeled([
        labeled('Quy tắc Canon', draft.authorRules.canonRules), labeled('Quy tắc liên tục', draft.authorRules.continuityRules),
    ]));
    appendSection(lines, 'ĐIỀU CẤM / RANH GIỚI', joinLabeled([
        labeled('Sự kiện cấm', draft.authorRules.forbiddenEvents), labeled('Hé lộ cấm', draft.authorRules.forbiddenReveals),
        labeled('Ranh giới nội dung', draft.authorRules.contentBoundaries), labeled('Ranh giới phong cách', draft.authorRules.styleBoundaries),
    ]));
    const secretLines = [draft.authorRules.secrets, draft.authorRules.hiddenTruths, draft.authorRules.futureReveals]
        .map(normalized).filter(Boolean)
        .map(value => '[AUTHOR_SECRET]: ' + value.replace(/\n/g, '\n  '));
    if (secretLines.length > 0) appendSection(lines, 'BÍ MẬT CHỈ DÀNH CHO TÁC GIẢ', secretLines.join('\n'));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
};

export const STORY_SETUP_BLANK_TEMPLATE_MARKDOWN = [
    '# [TÊN TRUYỆN — thay phần trong ngoặc vuông]',
    '',
    '> Đây là mẫu thiết kế truyện dành cho tác giả. Hãy thay hoặc xóa mọi nội dung trong ngoặc vuông; chúng chỉ là chỉ dẫn, không phải sự thật của truyện.',
    '> Có thể mở rộng, thu gọn hoặc bỏ qua mục không phù hợp.',
    '> Khi nhờ AI hỗ trợ: “Hãy điền mẫu này, giữ nguyên các tiêu đề và không xóa phần bí mật chỉ dành cho tác giả.”',
    '',
    '## THÔNG TIN CƠ BẢN',
    '- **Ngôn ngữ sáng tác:** [ví dụ: Tiếng Việt]',
    '- **Thể loại chính:** [điền thể loại]',
    '- **Thể loại / phong vị phụ:** [tùy chọn]',
        '- Số chương dự kiến: [số nguyên dương]',
    '- **Độc giả / tầm vóc:** [tùy chọn]',
    '',
    '## PREMISE / Ý TƯỞNG CỐT LÕI',
    '[Premise, vấn đề trung tâm, mục tiêu nhân vật chính, stakes, chủ đề, hướng kết.]',
    '',
    '## PHONG CÁCH / TONE / POV',
    '[Không khí, nhịp, phong cách và ngôi kể/góc nhìn bằng ngôn ngữ tự nhiên.]',
    '',
    '## NHÂN VẬT',
    '[Mỗi nhân vật: tên, tuổi, giới tính, vai trò, ngoại hình, tính cách, xuất thân, động lực, điểm mạnh/yếu, kỹ năng/nguồn lực, quan hệ, dự kiến xuất hiện, khả năng là góc nhìn, hướng phát triển.]',
    '',
    '## THẾ GIỚI',
    '[Thời kỳ, địa lý, xã hội/văn hóa, tổ chức/phe phái, công nghệ, kinh tế/tài nguyên, luật lệ/cấm kỵ, địa điểm, ràng buộc nhất quán.]',
    '',
    '## HỆ THỐNG SỨC MẠNH / TIẾN TRÌNH (NẾU CÓ)',
    '[Quy tắc, giới hạn, cái giá, cấp bậc, tài nguyên và ràng buộc tiến triển.]',
    '',
    '## THẾ LỰC / CHÍNH TRỊ / QUÂN SỰ / KINH TẾ (NẾU CÓ)',
    '[Phe phái, mục tiêu, năng lực tương đối, hậu cần, ngoại giao, nguồn lực, ranh giới chiến lược.]',
    '',
    '## CÁC ARC CHÍNH',
    '[Tên arc, khoảng chương hoặc giai đoạn tương đối, mục tiêu và chuyển biến.]',
    '',
    '## SỰ KIỆN / TURNING POINTS',
    '[Sự kiện bắt buộc, bước ngoặt, ghi chú chương/arc và hướng kết.]',
    '',
    '## QUAN HỆ / TÌNH CẢM',
    '[Từng cặp/nhóm: quan hệ ban đầu, tiến triển, lãng mạn hay không, ranh giới, sự kiện quan trọng, cấu trúc tình cảm nếu có.]',
    '',
    '## FORESHADOW / REVEAL / PAYOFF',
    '[Những gì cần gieo, thời điểm hé lộ xấp xỉ và cách thu hoạch.]',
    '',
    '## LUẬT CANON',
    '[Sự thật/ràng buộc luôn phải nhất quán.]',
    '',
    '## ĐIỀU CẤM / RANH GIỚI',
    '[Sự kiện/hé lộ bị cấm, giới hạn nội dung và phong cách.]',
    '',
    '## BÍ MẬT CHỈ DÀNH CHO TÁC GIẢ',
    '- Giữ nguyên tiêu đề này. Khi có bí mật thật, hãy thêm một dòng riêng bắt đầu bằng cú pháp [AUTHOR_SECRET]: rồi viết nội dung thật sau dấu hai chấm. Không tạo dòng đó nếu chưa có bí mật.',
    '',
].join('\n');

const item = (title: string, fields: readonly string[]): string =>
    '### ' + title + '\n' + fields.filter(Boolean).join('\n');

/** Author-owned design export. It intentionally reads setupDocument only, never continuation state. */
export const renderExistingProjectSetupMarkdown = (
    setupDocument: StoryBlueprintDocument,
    displayName: string,
): string => {
    const blueprint = setupDocument.blueprint;
    const lines = [
        '# ' + (normalized(displayName) || normalized(blueprint.id)), '',
        '> STORY DESIGN / SETUP — Nhập tệp này sẽ tạo MỘT DỰ ÁN MỚI từ Canon C0 sau bước review.',
        '> Tệp này KHÔNG chứa Canon hiện tại, lịch sử chương, checkpoint quy trình hay Narrative Memory. Sao lưu tiếp tục đầy đủ thuộc một tính năng backup riêng.',
        '', '## THÔNG TIN CƠ BẢN',
        '- **Mã thiết kế gốc:** ' + blueprint.id,
        '- Số chương dự kiến: ' + blueprint.engine.plannedChapterCount,
    ];
    appendSection(lines, 'NHÂN VẬT', blueprint.characters.map(character => joinLabeled([
        labeled('Tên', character.name), labeled('Vai trò', character.writerProfile?.role ?? ''),
        labeled('Ngoại hình', character.writerProfile?.appearance ?? ''), labeled('Tính cách', character.writerProfile?.personality ?? ''),
        labeled('Thông tin công khai', character.writerProfile?.publicFacts?.join('; ') ?? ''),
        '- **Dự kiến có thể xuất hiện từ chương:** ' + (character.availableFromChapter ?? character.allowedFromChapter ?? 1),
        labeled('Ghi chú tác giả', character.authorNotes ?? ''),
    ])).join('\n\n'));
    appendSection(lines, 'CÁC ARC CHÍNH', blueprint.arcs?.map(arc => item(arc.title, [
        '- **Khoảng chương:** ' + arc.startChapter + '–' + arc.endChapter,
        labeled('Định hướng dành cho bản thảo', arc.writerBrief ?? ''),
        labeled('Kế hoạch riêng của tác giả', arc.authorPlan ?? ''),
    ])).join('\n\n') ?? '');
    appendSection(lines, 'SỰ KIỆN / TURNING POINTS', [
        ...(blueprint.beats?.map(beat => item('Nhịp ' + beat.order + ' của arc ' + beat.arcId, [
            '- **Khoảng chương:** ' + beat.startChapter + '–' + beat.endChapter,
            labeled('Định hướng dành cho bản thảo', beat.writerBrief ?? ''),
            labeled('Kế hoạch riêng của tác giả', beat.authorPlan ?? ''),
        ])) ?? []),
        ...(blueprint.storyEvents?.map(event => item('Sự kiện ' + event.id, [
            labeled('Loại sự kiện', event.eventType), labeled('Mô tả có thể dùng khi viết', event.writerText ?? ''),
            labeled('Ghi chú riêng của tác giả', event.authorNotes ?? ''),
        ])) ?? []),
    ].join('\n\n'));
    appendSection(lines, 'QUAN HỆ / TÌNH CẢM', [
        ...(blueprint.relationshipDefinitions?.map(relationship => item('Quan hệ ' + relationship.id, [
            labeled('Những người tham gia', relationship.participantIds.join(', ')),
            labeled('Tính chất', relationship.categories.join(', ')),
            labeled('Mốc lãng mạn ban đầu', relationship.initialRomanceMilestone),
            labeled('Động lực cốt lõi', relationship.dynamicProfile.coreDynamicTags.join(', ')),
            labeled('Nguồn xung đột', relationship.dynamicProfile.dominantConflictSources.join('; ')),
            labeled('Cơ sở niềm tin', relationship.dynamicProfile.trustBasis.join('; ')),
            labeled('Cơ sở tôn trọng', relationship.dynamicProfile.respectBasis.join('; ')),
            labeled('Lối tắt bị cấm', relationship.dynamicProfile.prohibitedShortcuts.join(', ')),
            '- **Tối đa số mốc lớn mỗi chương:** ' + relationship.progressionPolicy.maxMajorMilestoneAdvancePerChapter,
            '- **Tối đa số chương tiến triển liên tiếp:** ' + relationship.progressionPolicy.maxConsecutiveProgressionChapters,
        ])) ?? []),
        ...(blueprint.relationshipEvents?.map(event => item('Sự kiện quan hệ ' + event.id, [
            labeled('Quan hệ liên quan', event.relationshipId), labeled('Loại sự kiện', event.eventType),
            labeled('Những người tham gia', event.participantIds.join(', ')),
            labeled('Mô tả có thể dùng khi viết', event.writerText ?? ''),
            labeled('Ghi chú riêng của tác giả', event.authorNotes ?? ''),
            labeled('Mốc lãng mạn được chủ ý cho phép', event.authorizedRomanceMilestone ?? ''),
        ])) ?? []),
    ].join('\n\n'));
    appendSection(lines, 'FORESHADOW / REVEAL / PAYOFF', blueprint.reveals?.map(reveal => item('Hé lộ ' + reveal.id, [
        labeled('Nội dung được phép dùng khi viết', reveal.writerText), labeled('Ghi chú riêng của tác giả', reveal.authorNotes ?? ''),
    ])).join('\n\n') ?? '');
    const timingLines = [
        ...(blueprint.gates?.characters?.map(timing => '- Nhân vật **' + timing.characterId + '** có thể xuất hiện trực tiếp từ chương ' + (timing.allowedFromChapter ?? ((timing.lockedThroughChapter ?? 0) + 1)) + '.') ?? []),
        ...(blueprint.gates?.pov?.map(timing => '- Nhân vật **' + timing.characterId + '** có thể là góc nhìn từ chương ' + (timing.allowedFromChapter ?? ((timing.lockedThroughChapter ?? 0) + 1)) + '.') ?? []),
        ...(blueprint.gates?.reveals?.map(timing => '- Hé lộ **' + timing.revealId + '** được phép từ chương ' + (timing.allowedFromChapter ?? ((timing.lockedThroughChapter ?? 0) + 1)) + '.') ?? []),
        ...(blueprint.gates?.relationships?.map(timing => '- Sự kiện quan hệ **' + timing.eventId + '** được phép từ chương ' + (timing.allowedFromChapter ?? ((timing.lockedThroughChapter ?? 0) + 1)) + '.') ?? []),
        ...(blueprint.gates?.events?.map(timing => '- Sự kiện **' + timing.eventId + '** được phép từ chương ' + (timing.allowedFromChapter ?? ((timing.lockedThroughChapter ?? 0) + 1)) + '.') ?? []),
    ];
    appendSection(lines, 'THỜI ĐIỂM XUẤT HIỆN / GÓC NHÌN / HÉ LỘ', timingLines.join('\n'));
    appendSection(lines, 'LUẬT CANON', blueprint.canonRules?.map(rule => item('Quy tắc ' + rule.id, [
        labeled('Nội dung', rule.text), '- **Có hiệu lực từ chương:** ' + rule.availableFromChapter,
        rule.expiresAfterChapter === undefined ? '' : '- **Hết hiệu lực sau chương:** ' + rule.expiresAfterChapter,
        labeled('Phạm vi', rule.scope), labeled('Ghi chú riêng của tác giả', rule.authorNotes ?? ''),
    ])).join('\n\n') ?? '');
    appendSection(lines, 'ĐIỀU CẤM / RANH GIỚI', [
        ...(blueprint.forbiddenEvents?.map(value => '- Cấm sự kiện **' + value.eventId + '** đến hết chương ' + value.forbiddenThroughChapter + (value.authorReason ? ': ' + value.authorReason : '.')) ?? []),
        ...(blueprint.forbiddenRelationshipEvents?.map(value => '- Cấm sự kiện quan hệ **' + value.eventId + '** đến hết chương ' + value.forbiddenThroughChapter + (value.authorReason ? ': ' + value.authorReason : '.')) ?? []),
        ...(blueprint.forbiddenReveals?.map(value => '- Cấm hé lộ **' + value.revealId + '** đến hết chương ' + value.forbiddenThroughChapter + (value.authorReason ? ': ' + value.authorReason : '.')) ?? []),
    ].join('\n'));
    if (blueprint.authorOnlySecrets?.length) appendSection(lines, 'BÍ MẬT CHỈ DÀNH CHO TÁC GIẢ', blueprint.authorOnlySecrets.map(secret =>
        '[AUTHOR_SECRET]: ' + secret.value
        + (secret.notes ? '\n  Ghi chú: ' + secret.notes : '')
        + (secret.revealId ? '\n  Hé lộ liên quan: ' + secret.revealId : '')
    ).join('\n'));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
};

export const sanitizeSetupFilename = (name: string): string => {
    const withoutControls = Array.from(normalized(name), character =>
        character.charCodeAt(0) < 32 ? '-' : character).join('');
    const safe = withoutControls.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').slice(0, 100).trim();
    return (safe || 'story-setup') + '.md';
};

export const downloadStorySetupMarkdown = (filename: string, contents: string): void => {
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizeSetupFilename(filename.replace(/\.md$/i, ''));
    anchor.click();
    URL.revokeObjectURL(url);
};

export interface StorySetupWizardDraftAdapter {
    load(): Promise<unknown>;
    save(value: StorySetupWizardDraftV1): Promise<void>;
    clear(): Promise<void>;
}

export const createBrowserStorySetupWizardDraftAdapter = (): StorySetupWizardDraftAdapter => ({
    load: () => loadFromStorage(STORY_SETUP_WIZARD_DRAFT_KEY),
    save: value => saveToStorage(STORY_SETUP_WIZARD_DRAFT_KEY, value),
    clear: () => clearSessionRecord(STORY_SETUP_WIZARD_DRAFT_KEY),
});

export type StorySetupWizardDraftLoadResult =
    | { readonly status: 'empty' }
    | { readonly status: 'loaded'; readonly draft: StorySetupWizardDraftV1 }
    | { readonly status: 'corrupt' };

export class StorySetupWizardDraftRepository {
    private queue: Promise<void> = Promise.resolve();
    constructor(private readonly adapter: StorySetupWizardDraftAdapter = createBrowserStorySetupWizardDraftAdapter()) {}
    async load(): Promise<StorySetupWizardDraftLoadResult> {
        let value: unknown;
        try { value = await this.adapter.load(); } catch { return { status: 'corrupt' }; }
        if (value === undefined || value === null) return { status: 'empty' };
        try { return { status: 'loaded', draft: parseStorySetupWizardDraft(value) }; } catch { return { status: 'corrupt' }; }
    }
    save(draft: StorySetupWizardDraftV1): Promise<void> {
        const strict = parseStorySetupWizardDraft(draft);
        const work = this.queue.then(() => this.adapter.save(strict));
        this.queue = work.catch(() => undefined);
        return work;
    }
    clear(): Promise<void> {
        const work = this.queue.then(() => this.adapter.clear());
        this.queue = work.catch(() => undefined);
        return work;
    }
}

export interface DurableWizardCreateResult<T> {
    readonly value: T;
    readonly draftCleared: boolean;
}

/** The draft-clear callback cannot run before durable creation and healthy publication succeed. */
export const completeDurableWizardCreate = async <T>(
    create: () => Promise<T>,
    publish: (value: T) => void,
    clearDraft: () => Promise<void>,
): Promise<DurableWizardCreateResult<T>> => {
    const value = await create();
    publish(value);
    try {
        await clearDraft();
        return { value, draftCleared: true };
    } catch {
        return { value, draftCleared: false };
    }
};
