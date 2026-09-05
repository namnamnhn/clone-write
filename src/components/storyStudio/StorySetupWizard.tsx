import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, Eye, FileCheck2, Plus, Save, Trash2, X } from 'lucide-react';
import {
    createEmptyWizardCharacter,
    createEmptyWizardRelationship,
    getStorySetupGenreEmphasis,
    renderStorySetupWizardMarkdown,
    reorderWizardItem,
    validateStorySetupWizardDraft,
} from '../../storyStudio/setup/storySetupWizard';
import type {
    StorySetupWizardCharacter,
    StorySetupWizardDraftV1,
    StorySetupWizardRelationship,
} from '../../storyStudio/setup/storySetupWizard';

const STEP_NAMES = [
    'Thông tin cơ bản', 'Ý tưởng cốt lõi', 'Nhân vật', 'Thế giới & hệ thống',
    'Cốt truyện & nhịp dài', 'Quan hệ / tình cảm', 'Chiến lược (tùy chọn)',
    'Bí mật & luật Canon', 'Xem lại Setup',
] as const;

type TextField = { readonly key: string; readonly label: string; readonly hint?: string; readonly long?: boolean };

const Field: React.FC<{
    label: string; value: string; hint?: string; long?: boolean; required?: boolean; onChange: (value: string) => void;
}> = ({ label, value, hint, long, required, onChange }) => (
    <label className="block">
        <span className="text-sm font-black text-slate-700 dark:text-slate-200">{label}{required ? ' *' : ''}</span>
        {hint && <span className="ml-2 text-xs text-slate-400">{hint}</span>}
        {long
            ? <textarea value={value} onChange={event => onChange(event.target.value)} rows={4} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
            : <input value={value} onChange={event => onChange(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />}
    </label>
);

export const StorySetupWizard: React.FC<{
    draft: StorySetupWizardDraftV1;
    compiling: boolean;
    draftStatus: 'saved' | 'saving' | 'error';
    onChange: (draft: StorySetupWizardDraftV1) => void;
    onCancel: () => void;
    onDiscard: () => void;
    onCompile: () => void;
    onDownloadMarkdown: () => void;
    onDownloadTemplate: () => void;
}> = ({ draft, compiling, draftStatus, onChange, onCancel, onDiscard, onCompile, onDownloadMarkdown, onDownloadTemplate }) => {
    const [preview, setPreview] = useState(false);
    const step = draft.currentStep;
    const validation = useMemo(() => validateStorySetupWizardDraft(draft), [draft]);
    const touch = (update: Partial<StorySetupWizardDraftV1>): StorySetupWizardDraftV1 => ({
        ...draft, ...update, updatedAt: new Date().toISOString(),
    });
    const updateGroup = <K extends 'basic' | 'core' | 'world' | 'plot' | 'strategy' | 'authorRules'>(
        group: K, key: keyof StorySetupWizardDraftV1[K], value: string | number,
    ) => onChange(touch({ [group]: { ...draft[group], [key]: value } } as unknown as Partial<StorySetupWizardDraftV1>));
    const setStep = (next: number) => onChange(touch({ currentStep: Math.max(1, Math.min(9, next)) }));
    const updateCharacter = (id: string, key: keyof StorySetupWizardCharacter, value: string) =>
        onChange(touch({ characters: draft.characters.map(character => character.draftId === id ? { ...character, [key]: value } : character) }));
    const updateRelationship = (id: string, key: keyof StorySetupWizardRelationship, value: string) =>
        onChange(touch({ relationships: draft.relationships.map(relationship => relationship.draftId === id ? { ...relationship, [key]: value } : relationship) }));

    const sectionFields = (
        group: 'core' | 'world' | 'plot' | 'strategy' | 'authorRules',
        fields: readonly TextField[],
    ) => <div className="grid gap-4 md:grid-cols-2">{fields.map(field =>
        <Field key={field.key} label={field.label} hint={field.hint} long={field.long ?? true}
            value={String(draft[group][field.key as keyof typeof draft[typeof group]] ?? '')}
            onChange={value => updateGroup(group, field.key as never, value)} />
    )}</div>;

    return (
        <div className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-slate-50 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <header className="border-b border-slate-200 p-5 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-black text-slate-900 dark:text-white">Tạo truyện mới</h1>
                        <p className="mt-1 text-xs text-slate-500">Bản nháp lưu riêng trên trình duyệt; chưa phải Canon và chưa gọi Gemini.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={'text-xs font-bold ' + (draftStatus === 'error' ? 'text-rose-600' : 'text-emerald-600')}>
                            {draftStatus === 'saving' ? 'Đang lưu nháp…' : draftStatus === 'saved' ? 'Đã lưu nháp' : 'Chưa thể lưu nháp'}
                        </span>
                        <button type="button" onClick={onDownloadTemplate} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700">Tải mẫu Setup</button>
                        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 p-2 dark:border-slate-700" title="Đóng wizard"><X className="h-4 w-4" /></button>
                    </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-1 sm:grid-cols-9">
                    {STEP_NAMES.map((name, index) => <button type="button" key={name} onClick={() => setStep(index + 1)}
                        className={'rounded-lg px-2 py-2 text-[10px] font-black ' + (step === index + 1 ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 dark:bg-slate-900')}>
                        {index + 1}. <span className="hidden lg:inline">{name}</span>
                    </button>)}
                </div>
            </header>

            <main className="min-h-[430px] p-5 sm:p-7">
                <h2 className="mb-5 text-lg font-black text-slate-900 dark:text-white">Bước {step}: {STEP_NAMES[step - 1]}</h2>
                {step === 1 && <div className="grid gap-4 md:grid-cols-2">
                    <Field required label="Tên truyện" value={draft.basic.title} onChange={value => updateGroup('basic', 'title', value)} />
                    <Field required label="Ngôn ngữ sáng tác" value={draft.basic.language} onChange={value => updateGroup('basic', 'language', value)} />
                    <Field required label="Thể loại chính" value={draft.basic.primaryGenre} onChange={value => updateGroup('basic', 'primaryGenre', value)} />
                    <Field label="Thể loại / phong vị phụ" value={draft.basic.secondaryGenres} onChange={value => updateGroup('basic', 'secondaryGenres', value)} />
                    <label className="block"><span className="text-sm font-black">Số chương dự kiến *</span><input type="number" min={1} value={draft.basic.plannedChapterCount || ''} onChange={event => updateGroup('basic', 'plannedChapterCount', Number(event.target.value) || 0)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
                    <Field label="Độ dài / tầm vóc" value={draft.basic.scope} onChange={value => updateGroup('basic', 'scope', value)} />
                    <Field label="Độc giả mục tiêu" value={draft.basic.targetAudience} onChange={value => updateGroup('basic', 'targetAudience', value)} />
                    <Field label="Tone / không khí / phong cách" value={draft.basic.toneStyle} onChange={value => updateGroup('basic', 'toneStyle', value)} />
                    <Field label="Ngôi kể / góc nhìn mong muốn" value={draft.basic.povPreference} onChange={value => updateGroup('basic', 'povPreference', value)} />
                </div>}
                {step === 2 && sectionFields('core', [
                    { key: 'premise', label: 'Premise', long: true }, { key: 'dramaticQuestion', label: 'Câu hỏi kịch tính / vấn đề trung tâm' },
                    { key: 'protagonistGoal', label: 'Mục tiêu nhân vật chính' }, { key: 'stakes', label: 'Cái giá / nguy cơ' },
                    { key: 'endingDirection', label: 'Hướng kết mong muốn (tùy chọn)' }, { key: 'themes', label: 'Chủ đề' },
                    { key: 'creativeBoundaries', label: 'Điều truyện không được trở thành / ranh giới sáng tạo' },
                ])}
                {step === 3 && <div className="space-y-4">
                    {draft.characters.map((character, index) => <div key={character.draftId} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-4 flex items-center justify-between"><strong>Nhân vật {index + 1}</strong><div className="flex gap-1">
                            <button type="button" disabled={index === 0} onClick={() => onChange(touch({ characters: reorderWizardItem(draft.characters, index, index - 1) }))} className="p-2 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                            <button type="button" disabled={index === draft.characters.length - 1} onClick={() => onChange(touch({ characters: reorderWizardItem(draft.characters, index, index + 1) }))} className="p-2 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                            <button type="button" onClick={() => onChange(touch({ characters: draft.characters.filter(item => item.draftId !== character.draftId) }))} className="p-2 text-rose-600"><Trash2 className="h-4 w-4" /></button>
                        </div></div>
                        <div className="grid gap-3 md:grid-cols-2">
                            {([
                                ['name', 'Tên *'], ['age', 'Tuổi / mô tả tuổi'], ['gender', 'Giới tính'], ['role', 'Vai trò'],
                                ['appearance', 'Ngoại hình'], ['personality', 'Tính cách'], ['background', 'Xuất thân'],
                                ['motivations', 'Động lực / mục tiêu'], ['strengths', 'Điểm mạnh'], ['weaknesses', 'Điểm yếu / khuyết điểm'],
                                ['abilities', 'Kỹ năng / sức mạnh / nguồn lực'], ['relationships', 'Quan hệ quan trọng'],
                                ['introduction', 'Dự kiến xuất hiện sớm hay muộn'], ['povPreference', 'Có thể là nhân vật góc nhìn?'],
                                ['notes', 'Ghi chú / hướng phát triển'],
                            ] as const).map(([key, label]) => <Field key={key} label={label} long={!['name', 'age', 'gender', 'role'].includes(key)} value={character[key]} onChange={value => updateCharacter(character.draftId, key, value)} />)}
                        </div>
                    </div>)}
                    <button type="button" onClick={() => onChange(touch({ characters: [...draft.characters, createEmptyWizardCharacter()] }))} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white"><Plus className="h-4 w-4" /> Thêm nhân vật</button>
                </div>}
                {step === 4 && <div>
                    <div className="mb-4 rounded-xl bg-indigo-50 p-3 text-xs font-bold text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
                        Gợi ý theo thể loại: {{
                            generic: 'Mô tả thế giới bằng mô hình tổng quát.',
                            'historical-strategy': 'Ưu tiên phe phái, chức vụ, quân đội, hậu cần, kinh tế và ngoại giao.',
                            'fantasy-progression': 'Ưu tiên hệ thống sức mạnh, cấp bậc, tài nguyên, môn phái và giới hạn tiến triển.',
                            mystery: 'Ưu tiên bí ẩn, nhóm manh mối, sự thật ẩn và nhịp hé lộ.',
                            'social-relationship': 'Ưu tiên môi trường xã hội, nghề nghiệp/kinh doanh, gia đình, bạn bè và ràng buộc quan hệ.',
                        }[getStorySetupGenreEmphasis(draft.basic.primaryGenre)]}
                    </div>
                    {sectionFields('world', [
                        { key: 'timePeriod', label: 'Thời kỳ' }, { key: 'geography', label: 'Địa lý / bối cảnh' },
                        { key: 'societyCulture', label: 'Xã hội / văn hóa' }, { key: 'institutionsFactions', label: 'Tổ chức / phe phái' },
                        { key: 'technology', label: 'Trình độ công nghệ' }, { key: 'economyResources', label: 'Kinh tế / tài nguyên' },
                        { key: 'lawsTaboos', label: 'Luật lệ / cấm kỵ' }, { key: 'powerSystem', label: 'Hệ thống sức mạnh / phép thuật / tu luyện' },
                        { key: 'ranksProgression', label: 'Cấp bậc / tiến trình' }, { key: 'importantLocations', label: 'Địa điểm quan trọng' },
                        { key: 'consistencyConstraints', label: 'Ràng buộc thế giới phải nhất quán' }, { key: 'mysteryClues', label: 'Nhóm manh mối (nếu có)' },
                        { key: 'hiddenTruthRevealCadence', label: 'Sự thật ẩn / nhịp hé lộ (nếu có)' }, { key: 'socialCareerNetworks', label: 'Môi trường xã hội / nghề nghiệp / gia đình' },
                    ])}
                </div>}
                {step === 5 && sectionFields('plot', [
                    { key: 'majorArcs', label: 'Các arc chính' }, { key: 'chapterPhases', label: 'Khoảng chương / giai đoạn tương đối' },
                    { key: 'turningPoints', label: 'Bước ngoặt lớn' }, { key: 'mustHappenEvents', label: 'Sự kiện bắt buộc phải xảy ra' },
                    { key: 'foreshadowing', label: 'Ý định gieo báo' }, { key: 'reveals', label: 'Hé lộ' },
                    { key: 'payoffs', label: 'Payoff / thu hoạch' }, { key: 'endingDirection', label: 'Hướng kết' },
                    { key: 'chapterNotes', label: 'Ghi chú chương / arc (tùy chọn)' },
                ])}
                {step === 6 && <div className="space-y-4">
                    {draft.relationships.map((relationship, index) => <div key={relationship.draftId} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-4 flex items-center justify-between"><strong>Quan hệ {index + 1}</strong><div className="flex gap-1">
                            <button type="button" disabled={index === 0} onClick={() => onChange(touch({ relationships: reorderWizardItem(draft.relationships, index, index - 1) }))} className="p-2 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                            <button type="button" disabled={index === draft.relationships.length - 1} onClick={() => onChange(touch({ relationships: reorderWizardItem(draft.relationships, index, index + 1) }))} className="p-2 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                            <button type="button" onClick={() => onChange(touch({ relationships: draft.relationships.filter(item => item.draftId !== relationship.draftId) }))} className="p-2 text-rose-600"><Trash2 className="h-4 w-4" /></button>
                        </div></div>
                        <div className="grid gap-3 md:grid-cols-2">{([
                            ['participants', 'Những người liên quan'], ['initialRelationship', 'Quan hệ ban đầu'],
                            ['intendedEvolution', 'Tiến triển mong muốn'], ['relationshipType', 'Lãng mạn / phi lãng mạn'],
                            ['boundaries', 'Ranh giới'], ['importantEvents', 'Sự kiện quan hệ quan trọng'],
                            ['structureNotes', 'Cấu trúc romance/harem (nếu có)'],
                        ] as const).map(([key, label]) => <Field key={key} label={label} long value={relationship[key]} onChange={value => updateRelationship(relationship.draftId, key, value)} />)}</div>
                    </div>)}
                    <button type="button" onClick={() => onChange(touch({ relationships: [...draft.relationships, createEmptyWizardRelationship()] }))} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white"><Plus className="h-4 w-4" /> Thêm quan hệ</button>
                </div>}
                {step === 7 && sectionFields('strategy', [
                    { key: 'factionsObjectives', label: 'Phe phái và mục tiêu' }, { key: 'relativeCapabilities', label: 'Năng lực tương đối' },
                    { key: 'politicalConstraints', label: 'Ràng buộc chính trị / ngoại giao' }, { key: 'militaryLogistics', label: 'Ràng buộc quân sự / hậu cần' },
                    { key: 'economicResources', label: 'Kinh tế / thương nghiệp / nguồn lực' }, { key: 'strategicRedLines', label: 'Lằn ranh chiến lược' },
                ])}
                {step === 8 && <div>
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        Bí mật hiển thị ở đây vì bạn đang trực tiếp nhập bản thiết kế tác giả. Sau khi biên dịch, Review Setup thông thường chỉ hiện số lượng, không hiện nội dung bí mật.
                    </div>
                    {sectionFields('authorRules', [
                        { key: 'secrets', label: 'Bí mật chỉ dành cho tác giả' }, { key: 'hiddenTruths', label: 'Sự thật ẩn / twist' },
                        { key: 'futureReveals', label: 'Hé lộ tương lai' }, { key: 'canonRules', label: 'Luật Canon' },
                        { key: 'forbiddenEvents', label: 'Sự kiện cấm' }, { key: 'forbiddenReveals', label: 'Hé lộ cấm' },
                        { key: 'continuityRules', label: 'Quy tắc liên tục' }, { key: 'contentBoundaries', label: 'Ranh giới nội dung' },
                        { key: 'styleBoundaries', label: 'Ranh giới phong cách' },
                    ])}
                </div>}
                {step === 9 && <div className="space-y-5">
                    {validation.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>Cần bổ sung:</strong><ul className="mt-2 list-disc pl-5">{validation.map(issue => <li key={issue.field}>{issue.message}</li>)}</ul></div>}
                    <div className="grid gap-3 sm:grid-cols-3">
                        <ReviewCard title="Cơ bản" text={(draft.basic.title || 'Chưa đặt tên') + ' · ' + (draft.basic.primaryGenre || 'Chưa chọn thể loại') + ' · ' + draft.basic.plannedChapterCount + ' chương'} />
                        <ReviewCard title="Nhân vật & quan hệ" text={draft.characters.length + ' nhân vật · ' + draft.relationships.length + ' quan hệ'} />
                        <ReviewCard title="Bí mật tác giả" text={[draft.authorRules.secrets, draft.authorRules.hiddenTruths, draft.authorRules.futureReveals].filter(value => value.trim()).length + ' nhóm nội dung riêng tư'} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={onCancel} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold dark:border-slate-700"><Save className="h-4 w-4" /> Giữ bản nháp & đóng</button>
                        <button type="button" onClick={() => setPreview(!preview)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold dark:border-slate-700"><Eye className="h-4 w-4" /> {preview ? 'Ẩn bản xem trước' : 'Xem Setup Markdown'}</button>
                        <button type="button" onClick={onDownloadMarkdown} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold dark:border-slate-700"><Download className="h-4 w-4" /> Tải Setup Markdown</button>
                        <button type="button" disabled={compiling || validation.length > 0} onClick={onCompile} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-black text-white disabled:opacity-40"><FileCheck2 className="h-4 w-4" /> {compiling ? 'Đang biên dịch…' : 'Biên dịch & kiểm tra Setup'}</button>
                    </div>
                    {preview && <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-4 text-xs text-slate-100">{renderStorySetupWizardMarkdown(draft)}</pre>}
                </div>}
            </main>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-5 dark:border-slate-800">
                <button type="button" onClick={onDiscard} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600"><Trash2 className="h-4 w-4" /> Bỏ bản nháp</button>
                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Save className="h-3.5 w-3.5" /> Tự động lưu cục bộ</span>
                    {step > 1 && <button type="button" onClick={() => setStep(step - 1)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold dark:border-slate-700"><ArrowLeft className="h-4 w-4" /> Quay lại</button>}
                    {step < 9 && <button type="button" onClick={() => setStep(step + 1)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white">Tiếp tục <ArrowRight className="h-4 w-4" /></button>}
                </div>
            </footer>
        </div>
    );
};

const ReviewCard: React.FC<{ title: string; text: string }> = ({ title, text }) => <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><div className="text-xs font-black uppercase text-slate-400">{title}</div><div className="mt-2 text-sm font-bold">{text}</div></div>;
