import React, { useMemo, useState } from 'react';
import {
    Activity, BadgeInfo, BookOpen, Brain, CircleDot, Coins, Compass, GitBranch,
    HeartHandshake, Landmark, MapPin, Search, Shield, Swords, Users,
} from 'lucide-react';
import type {
    StoryStudioIntelligenceView,
    StoryStudioStrategicDirectiveView,
    StoryStudioWriterPlanView,
} from '../../storyStudio/storyStudioTypes';

type IntelligenceTab = 'overview' | 'characters' | 'relationships' | 'plot' | 'strategy' | 'knowledge' | 'continuity';

const tabs: readonly { id: IntelligenceTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Tổng quan', icon: Compass },
    { id: 'characters', label: 'Nhân vật', icon: Users },
    { id: 'relationships', label: 'Quan hệ', icon: HeartHandshake },
    { id: 'plot', label: 'Mạch truyện', icon: GitBranch },
    { id: 'strategy', label: 'Chiến lược', icon: Swords },
    { id: 'knowledge', label: 'Tri thức', icon: Brain },
    { id: 'continuity', label: 'Liên tục', icon: Activity },
];

export const StoryIntelligencePanel: React.FC<{
    intelligence: StoryStudioIntelligenceView;
    writerPlan?: StoryStudioWriterPlanView;
}> = ({ intelligence, writerPlan }) => {
    const [activeTab, setActiveTab] = useState<IntelligenceTab>('overview');
    return (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="intelligence-title">
            <div className="border-b border-slate-200 px-5 pt-5 dark:border-slate-800">
                <h2 id="intelligence-title" className="text-lg font-black text-slate-900 dark:text-white">Story Intelligence</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Dữ liệu hiện tại được giới hạn, phân loại và không chứa Author Secret thô.</p>
                <div className="mt-4 flex gap-1 overflow-x-auto pb-3 no-scrollbar" role="tablist" aria-label="Các phần Story Intelligence">
                    {tabs.map(({ id, label, icon: Icon }) => (
                        <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)} className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${activeTab === id ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
                            <Icon className="h-4 w-4" /> {label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="p-5 sm:p-6">
                {activeTab === 'overview' && <IntelligenceOverview intelligence={intelligence} writerPlan={writerPlan} />}
                {activeTab === 'characters' && <Characters intelligence={intelligence} />}
                {activeTab === 'relationships' && <Relationships intelligence={intelligence} />}
                {activeTab === 'plot' && <Plot intelligence={intelligence} />}
                {activeTab === 'strategy' && <Strategy directives={writerPlan?.strategicDirectives.items ?? []} />}
                {activeTab === 'knowledge' && <Knowledge intelligence={intelligence} />}
                {activeTab === 'continuity' && <Continuity intelligence={intelligence} />}
            </div>
        </section>
    );
};

const IntelligenceOverview: React.FC<{ intelligence: StoryStudioIntelligenceView; writerPlan?: StoryStudioWriterPlanView }> = ({ intelligence, writerPlan }) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={Users} label="Nhân vật khả dụng" value={intelligence.characters.totalCount} detail={`${intelligence.characters.items.filter(item => item.active).length} đang hoạt động`} />
        <SummaryCard icon={HeartHandshake} label="Quan hệ pairwise" value={intelligence.relationships.totalCount} detail="Không xếp hạng, không điểm tình cảm" />
        <SummaryCard icon={Brain} label="Sự thật & niềm tin" value={intelligence.facts.totalCount + intelligence.beliefs.totalCount} detail="Global fact tách khỏi tri thức nhân vật" />
        <SummaryCard icon={GitBranch} label="Plot đang theo dõi" value={intelligence.foreshadow.totalCount + intelligence.payoffs.totalCount} detail={`${intelligence.secrets.totalCount} bí mật được bảo vệ bằng metadata`} />
        <div className="sm:col-span-2 lg:col-span-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
            <div className="flex items-start gap-3"><BadgeInfo className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" /><div><div className="text-sm font-black text-slate-800 dark:text-slate-100">Ranh giới hiển thị đang hoạt động</div><p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Canon-safe, Writer-safe, Planner nội bộ và Validator-only là các bề mặt riêng. {writerPlan ? `${writerPlan.strategicDirectives.totalCount} chỉ thị chiến lược đang được lấy từ kế hoạch Writer-safe.` : 'Chưa có chỉ thị Writer-safe.'}</p></div></div>
        </div>
    </div>
);

const Characters: React.FC<{ intelligence: StoryStudioIntelligenceView }> = ({ intelligence }) => {
    const [query, setQuery] = useState('');
    const items = useMemo(() => filterByQuery(intelligence.characters.items, query, item => `${item.name} ${item.role ?? ''} ${item.location ?? ''} ${item.status ?? ''}`), [intelligence.characters.items, query]);
    return <ListSection title="Nhân vật hiện tại" query={query} setQuery={setQuery} placeholder="Tìm tên, vai trò, vị trí…" empty="Không có nhân vật khả dụng ở chương mục tiêu." bounded={intelligence.characters}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map(item => (
                <article key={item.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-3"><div><h3 className="font-black text-slate-800 dark:text-slate-100">{item.name}</h3><p className="mt-0.5 text-xs text-slate-500">{item.role ?? item.id}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${item.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{item.active ? 'Đang hoạt động' : 'Khả dụng'}</span></div>
                    <div className="mt-4 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                        <InfoLine icon={MapPin} value={item.location ?? 'Chưa có vị trí'} />
                        <InfoLine icon={Activity} value={item.status ?? lifeStatusLabel(item.lifeStatus)} />
                        {(item.injuries.length > 0 || item.conditions.length > 0) && <InfoLine icon={Shield} value={[...item.injuries, ...item.conditions].join(' · ')} />}
                    </div>
                </article>
            ))}
        </div>
    </ListSection>;
};

const Relationships: React.FC<{ intelligence: StoryStudioIntelligenceView }> = ({ intelligence }) => {
    const [query, setQuery] = useState('');
    const items = useMemo(() => filterByQuery(intelligence.relationships.items, query, item => `${item.participantNames.join(' ')} ${item.categories.join(' ')} ${item.currentState ?? ''} ${item.currentRomanceMilestone}`), [intelligence.relationships.items, query]);
    return <ListSection title="Quan hệ độc lập theo cặp" query={query} setQuery={setQuery} placeholder="Tìm người tham gia, loại quan hệ…" empty="Chưa có quan hệ khả dụng." bounded={intelligence.relationships}>
        <div className="grid gap-3 lg:grid-cols-2">
            {items.map(item => (
                <article key={item.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-black text-slate-800 dark:text-slate-100">{item.participantNames.join(' ↔ ')}</h3><div className="mt-1 flex flex-wrap gap-1">{item.categories.map(category => <span key={category} className="rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-bold text-pink-600 dark:bg-pink-950/30 dark:text-pink-300">{category}</span>)}</div></div><span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-black text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">Mốc: {item.currentRomanceMilestone}</span></div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2"><SmallFact label="Trạng thái Canon" value={item.currentState ?? 'Chưa thiết lập'} /><SmallFact label="Slow-burn" value={item.slowBurnStatus === 'progressing' ? 'Đang tiến triển có kiểm soát' : item.slowBurnStatus === 'stable' ? 'Ổn định' : 'Không áp dụng'} /></div>
                    {item.dynamicTags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{item.dynamicTags.map(tag => <span key={tag} className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{tag}</span>)}</div>}
                    {item.recentChanges.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">Gần nhất: {item.recentChanges.map(change => `C${change.chapterNumber} · ${change.state}`).join(' → ')}</div>}
                </article>
            ))}
        </div>
    </ListSection>;
};

const Knowledge: React.FC<{ intelligence: StoryStudioIntelligenceView }> = ({ intelligence }) => (
    <div className="grid gap-4 lg:grid-cols-2">
        <div>
            <SectionTitle icon={BookOpen} title="Global Fact" subtitle="Sự thật Canon tồn tại độc lập với người biết nó." />
            <div className="space-y-3">
                {intelligence.facts.items.map(fact => (
                    <article key={fact.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                        <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold leading-relaxed text-slate-800 dark:text-slate-100">{fact.text}</p><span className="shrink-0 text-[10px] font-bold text-slate-400">C{fact.establishedChapter}</span></div>
                        <div className="mt-3 text-xs"><span className="font-bold text-slate-500">Được biết bởi: </span>{fact.knownBy.length ? fact.knownBy.map(item => item.name).join(', ') : <span className="text-slate-400">chưa có holder khả dụng</span>}</div>
                    </article>
                ))}
                {intelligence.facts.items.length === 0 && <Empty text="Chưa có Global Fact hiện tại." />}
                <BoundNotice bounded={intelligence.facts} noun="sự thật" />
            </div>
        </div>
        <div>
            <SectionTitle icon={Brain} title="Tri thức / Niềm tin nhân vật" subtitle="Niềm tin có thể không phải sự thật Canon." />
            <div className="space-y-3">
                {intelligence.beliefs.items.map(belief => (
                    <article key={belief.id} className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/50 dark:bg-violet-950/20"><div className="text-xs font-black text-violet-600 dark:text-violet-300">{belief.characterName} tin rằng</div><p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{belief.claim}</p><div className="mt-2 text-[10px] font-bold text-slate-400">Ghi nhận tại chương {belief.learnedChapter}</div></article>
                ))}
                {intelligence.beliefs.items.length === 0 && <Empty text="Chưa có niềm tin Canon đang hoạt động." />}
                <BoundNotice bounded={intelligence.beliefs} noun="niềm tin" />
            </div>
        </div>
    </div>
);

const Plot: React.FC<{ intelligence: StoryStudioIntelligenceView }> = ({ intelligence }) => (
    <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-3">
            <PlotGroup title="Reveal gates" count={intelligence.reveals.totalCount}>
                {intelligence.reveals.items.map(item => <PlotRow key={item.id} title={item.id} detail={`${plotStatus(item.status)}${item.occurrenceChapter ? ` · C${item.occurrenceChapter}` : ''}`} />)}
            </PlotGroup>
            <PlotGroup title="Foreshadow" count={intelligence.foreshadow.totalCount}>
                {intelligence.foreshadow.items.map(item => <PlotRow key={item.id} title={item.label} detail={`${plotStatus(item.status)} · ${item.cueCount} cue`} />)}
            </PlotGroup>
            <PlotGroup title="Payoff obligations" count={intelligence.payoffs.totalCount}>
                {intelligence.payoffs.items.map(item => <PlotRow key={item.id} title={item.label} detail={`${plotStatus(item.status)}${item.targetChapter ? ` · mục tiêu C${item.targetChapter}` : ''}`} />)}
            </PlotGroup>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/50"><div className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200"><Shield className="h-4 w-4 text-emerald-500" /> Author Secret được bảo vệ</div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{intelligence.secrets.totalCount} mục metadata. Studio chỉ nhận ID, reveal ID và trạng thái; giá trị bí mật thô không đi vào view model.</p></div>
    </div>
);

const Strategy: React.FC<{ directives: readonly StoryStudioStrategicDirectiveView[] }> = ({ directives }) => (
    <div className="grid gap-4 lg:grid-cols-3">
        <StrategyDomain icon={Landmark} title="Chính trị" tone="violet" items={directives.filter((item): item is Extract<StoryStudioStrategicDirectiveView, { domain: 'politics' }> => item.domain === 'politics')} />
        <StrategyDomain icon={Swords} title="Quân sự" tone="rose" items={directives.filter((item): item is Extract<StoryStudioStrategicDirectiveView, { domain: 'military' }> => item.domain === 'military')} />
        <StrategyDomain icon={Coins} title="Thương mại" tone="amber" items={directives.filter((item): item is Extract<StoryStudioStrategicDirectiveView, { domain: 'commerce' }> => item.domain === 'commerce')} />
    </div>
);

const Continuity: React.FC<{ intelligence: StoryStudioIntelligenceView }> = ({ intelligence }) => {
    const continuity = intelligence.continuity;
    return <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3"><SmallFact label="Vị trí thời gian" value={continuity.timelinePosition ?? 'Chưa có'} /><SmallFact label="Cảnh gần nhất" value={continuity.lastScene ?? 'Chưa có'} /><SmallFact label="POV Canon" value={continuity.povName ?? 'Chưa có'} /></div>
        <div><SectionTitle icon={MapPin} title="Vị trí hiện tại" subtitle="Chỉ nhân vật khả dụng ở chương mục tiêu." /><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{continuity.activeLocations.map(item => <div key={item.characterId} className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800"><div className="font-black text-slate-700 dark:text-slate-200">{item.characterName}</div><div className="mt-1 text-slate-500">{item.location}</div></div>)}</div></div>
        <div><SectionTitle icon={Activity} title="Mục liên tục" subtitle="Không hiển thị extension bag hoặc dữ liệu tương lai." /><div className="space-y-2">{continuity.items.items.map(item => <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-950/60"><div className="flex justify-between gap-2"><span className="font-bold text-slate-700 dark:text-slate-200">{item.text}</span><span className="shrink-0 text-slate-400">C{item.establishedChapter}</span></div><div className="mt-1 uppercase text-[9px] font-bold tracking-wider text-slate-400">{item.kind} · {item.status}</div></div>)}</div><BoundNotice bounded={continuity.items} noun="mục liên tục" /></div>
    </div>;
};

const StrategyDomain = <T extends StoryStudioStrategicDirectiveView>({ icon: Icon, title, tone, items }: { icon: React.ComponentType<{ className?: string }>; title: string; tone: 'violet' | 'rose' | 'amber'; items: readonly T[] }) => {
    const tones = { violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300', rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300', amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' };
    return <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><div className={`mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black ${tones[tone]}`}><Icon className="h-4 w-4" /> {title}</div><div className="space-y-3">{items.map(item => <StrategyCard key={item.id} item={item} />)}{items.length === 0 && <Empty text="Chưa có chỉ thị Writer-safe." />}</div></div>;
};

const StrategyCard: React.FC<{ item: StoryStudioStrategicDirectiveView }> = ({ item }) => (
    <article className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><div className="text-xs font-black text-slate-800 dark:text-slate-100">{item.objective}</div><div className="mt-1 text-[10px] font-semibold text-slate-400">Chủ thể: {item.actorName}</div><div className="mt-3 space-y-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
        {item.domain === 'politics' && <><p><b>Chiều:</b> {item.dimensions.map(value => `${value.dimension}: ${value.status}`).join(' · ')}</p><p><b>Thời điểm:</b> {item.timing}</p></>}
        {item.domain === 'military' && <><p><b>Hoạt động:</b> {item.operationType} tại {item.location}</p>{item.movement && <p><b>Di chuyển:</b> {item.movement}</p>}{item.logistics && <p><b>Hậu cần:</b> {item.logistics}</p>}<p><b>Dự phòng:</b> {item.fallback}</p></>}
        {item.domain === 'commerce' && <><p><b>Hành động:</b> {item.actionType}</p><p><b>Luồng:</b> {item.flows.join(' · ') || 'Chưa có'}</p><p><b>Logistics:</b> {item.logistics}</p><p><b>Rủi ro:</b> {item.risk}</p>{item.funding && <p><b>Nguồn vốn:</b> {item.funding}</p>}</>}
        <p><b>Đánh đổi:</b> {item.cost}</p>
    </div></article>
);

const ListSection: React.FC<{ title: string; query: string; setQuery: (value: string) => void; placeholder: string; empty: string; bounded: { displayedCount: number; totalCount: number; truncated: boolean }; children: React.ReactNode }> = ({ title, query, setQuery, placeholder, empty, bounded: list, children }) => (
    <div><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h3 className="font-black text-slate-800 dark:text-slate-100">{title}</h3><label className="relative block sm:w-72"><span className="sr-only">{placeholder}</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950/60 dark:focus:ring-indigo-950" /></label></div>{list.totalCount ? children : <Empty text={empty} />}<BoundNotice bounded={list} noun="mục" /></div>
);

const SummaryCard: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string; value: number; detail: string }> = ({ icon: Icon, label, value, detail }) => <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><div className="flex items-center justify-between"><Icon className="h-5 w-5 text-indigo-500" /><span className="text-2xl font-black text-slate-900 dark:text-white">{value}</span></div><div className="mt-4 text-sm font-black text-slate-700 dark:text-slate-200">{label}</div><p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{detail}</p></div>;
const SectionTitle: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string }> = ({ icon: Icon, title, subtitle }) => <div className="mb-3"><div className="flex items-center gap-2 font-black text-slate-800 dark:text-slate-100"><Icon className="h-4 w-4 text-indigo-500" /> {title}</div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p></div>;
const SmallFact: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div><div className="mt-1.5 text-xs font-bold leading-relaxed text-slate-700 dark:text-slate-200">{value}</div></div>;
const InfoLine: React.FC<{ icon: React.ComponentType<{ className?: string }>; value: string }> = ({ icon: Icon, value }) => <div className="flex items-start gap-2"><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{value}</span></div>;
const PlotGroup: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({ title, count, children }) => <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black text-slate-800 dark:text-slate-100">{title}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">{count}</span></div><div className="space-y-2">{children || <Empty text="Chưa có dữ liệu." />}</div></div>;
const PlotRow: React.FC<{ title: string; detail: string }> = ({ title, detail }) => <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/60"><div className="flex items-start gap-2"><CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" /><div><div className="text-xs font-bold text-slate-700 dark:text-slate-200">{title}</div><div className="mt-1 text-[10px] font-semibold text-slate-400">{detail}</div></div></div></div>;
const Empty: React.FC<{ text: string }> = ({ text }) => <div className="rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400 dark:border-slate-800">{text}</div>;
const BoundNotice: React.FC<{ bounded: { displayedCount: number; totalCount: number; truncated: boolean }; noun: string }> = ({ bounded: list, noun }) => list.truncated ? <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Hiển thị {list.displayedCount} / {list.totalCount} {noun}.</div> : null;

const filterByQuery = <T,>(items: readonly T[], query: string, text: (item: T) => string): readonly T[] => {
    const normalized = query.trim().toLocaleLowerCase('vi-VN');
    return normalized ? items.filter(item => text(item).toLocaleLowerCase('vi-VN').includes(normalized)) : items;
};

const lifeStatusLabel = (value: 'unknown' | 'alive' | 'dead') => value === 'alive' ? 'Còn sống' : value === 'dead' ? 'Đã chết' : 'Chưa rõ sinh trạng';
const plotStatus = (value: string) => ({ locked: 'Đang khóa', 'eligible-not-revealed': 'Đủ điều kiện, chưa reveal', revealed: 'Đã reveal', open: 'Đang mở', paid: 'Đã payoff', superseded: 'Đã thay thế', 'not-due': 'Chưa đến hạn', due: 'Đến hạn', overdue: 'Quá hạn', 'paid-late': 'Đã trả muộn' }[value] ?? value);
