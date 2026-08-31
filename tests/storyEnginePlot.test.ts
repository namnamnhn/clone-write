import { describe, expect, it } from 'vitest';
import {
    applyStoryStateDelta, buildPlannerContext, buildPlannerPlotGuidance, buildValidatorPlotView, buildWriterContext, buildWriterSafeContext, createInitialStoryState,
    generateWriterDraft, getAuthorSecretStatus, getDuePayoffs, getForeshadowCues, getForeshadowReinforcementAge,
    getForeshadowThreadStatus, getOpenForeshadowThreads, getOverduePayoffs, getPayoffStatus,
    getPayoffUrgency, getRevealOccurrence, hasRevealOccurred, parseStoryState, parseStoryStateDelta, PlotGuidanceCapacityError,
    StoryState, StoryStateDelta, StoryStateDeltaV2, StoryStateTransitionError, validateFullStoryControl, type FullStoryControl, type WriterChapterPlan,
} from '../src/storyEngine';

const control: FullStoryControl = {
    kind: 'full-story-control', id: 'plot-story',
    engine: { schemaVersion: 4, plannedChapterCount: 700, failClosed: true, unknownCharacterPolicy: 'deny', missingGatePolicy: 'deny', beatPolicy: 'required-for-arcs-with-beats' },
    characters: { a: { id: 'a', name: 'A', initialStatus: 'active', availableFromChapter: 1, writerProfile: {} } },
    characterOrder: ['a'], arcs: [{ id: 'arc', title: 'Arc', startChapter: 1, endChapter: 700 }], beats: [],
    reveals: [{ id: 'r', writerText: 'LOCKED_REVEAL_WRITER_TEXT', authorNotes: 'private reveal note' }],
    relationshipEvents: [], storyEvents: [],
    gates: { characters: [{ id: 'a-gate', characterId: 'a', allowedFromChapter: 1 }], pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }], reveals: [{ id: 'r-gate', revealId: 'r', allowedFromChapter: 561 }], relationships: [], events: [] },
    forbiddenEvents: [], forbiddenRelationshipEvents: [], forbiddenReveals: [{ id: 'r-hard-lock', revealId: 'r', forbiddenThroughChapter: 560 }],
    authorOnlySecrets: [
        { id: 's', value: 'RAW_AUTHOR_SECRET_ABC', revealId: 'r', notes: 'private secret note' },
        { id: 'forever', value: 'RAW_AUTHOR_ONLY_FOREVER', notes: 'never reveal' },
    ], canonRules: [],
};

const provenance = (chapter: number, sourceId = `chapter-${chapter}`) => ({ sourceChapter: chapter, sourceType: 'chapter' as const, sourceId });
const v1 = (chapter: number, revision: number, values: Partial<StoryStateDelta> = {}): StoryStateDelta => ({
    kind: 'story-state-delta', schemaVersion: 1, chapterNumber: chapter, expectedRevision: revision,
    factChanges: [], epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [],
    relationshipChanges: [], resourceChanges: [], continuityChanges: [], ...values,
});
const v2 = (chapter: number, revision: number, values: Partial<StoryStateDeltaV2> = {}): StoryStateDeltaV2 => ({
    kind: 'story-state-delta', schemaVersion: 2, chapterNumber: chapter, expectedRevision: revision,
    factChanges: [], epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [],
    relationshipChanges: [], resourceChanges: [], continuityChanges: [], revealChanges: [], foreshadowChanges: [], payoffChanges: [], ...values,
});
const advance = (target: number, start: StoryState = createInitialStoryState(), operations: Readonly<Record<number, StoryStateDeltaV2>> = {}): StoryState => {
    let state = start;
    for (let chapter = state.currentChapter + 1; chapter <= target; chapter += 1) {
        state = applyStoryStateDelta(control, state, operations[chapter] ?? v1(chapter, chapter - 1));
    }
    return state;
};
const state560 = advance(560);
const writerPlan = (revealText = 'LOCKED_REVEAL_WRITER_TEXT'): WriterChapterPlan => ({
    kind: 'writer-chapter-plan', chapterNumber: 561, arc: { id: 'arc', title: 'Arc' }, primaryGoal: 'Advance safely.',
    povCharacterId: 'a', participantIds: ['a'], scenes: [{ id: 'scene', order: 1, goal: 'Advance.', location: 'Road', povCharacterId: 'a', participantIds: ['a'], conflictOrObstacle: 'Delay.', uncertainty: 'Timing.', expectedConsequence: 'Progress.', purposeTags: ['plot'], conflictImportance: 'minor' }],
    canonConstraints: [], reveals: [{ id: 'r', text: revealText }], relationshipEvents: [], storyEvents: [], cluesPlantedIds: [], cluesPaidOffIds: [],
    expectedResourceDeltas: [], expectedRelationshipDeltas: [], expectedContinuityConsequences: [], endStateIntent: 'Stop after progress.',
});

describe('Story Engine V4 canonical plot control', () => {
    it('blocks exact and embedded raw secrets in writer-facing control text at validation and runtime boundaries', async () => {
        const unsafe = (writerText: string): FullStoryControl => ({ ...control, reveals: [{ ...control.reveals[0], writerText }] });
        ['RAW_AUTHOR_SECRET_ABC', 'Public phrasing: RAW_AUTHOR_SECRET_ABC'].forEach((writerText) => {
            const fabricated = unsafe(writerText);
            const issues = validateFullStoryControl(fabricated);
            expect(issues).toContainEqual(expect.objectContaining({ path: 'reveals.0.writerText' }));
            expect(JSON.stringify(issues)).not.toContain('RAW_AUTHOR_SECRET_ABC');
            for (const projection of [
                () => buildPlannerContext(fabricated, state560, 561),
                () => buildPlannerPlotGuidance(fabricated, state560, 561),
                () => buildWriterSafeContext(fabricated, state560, 561),
            ]) {
                try { projection(); throw new Error('expected secret boundary rejection'); } catch (error) { expect((error as Error).message).not.toContain('RAW_AUTHOR_SECRET_ABC'); }
            }
        });
        expect(validateFullStoryControl(control).filter(issue => issue.path.includes('writerText'))).toEqual([]);
        expect(JSON.stringify(buildPlannerContext(control, state560, 560))).not.toContain('RAW_AUTHOR_SECRET_ABC');
        expect(JSON.stringify(buildPlannerContext(control, state560, 561))).not.toContain('RAW_AUTHOR_SECRET_ABC');
        expect(JSON.stringify(buildWriterContext(control, state560, writerPlan()))).not.toContain('RAW_AUTHOR_SECRET_ABC');
        expect(() => buildWriterContext(control, state560, writerPlan('Public phrasing: RAW_AUTHOR_SECRET_ABC'))).toThrowError(expect.objectContaining({ name: 'WriterFacingSecretBoundaryError' }));
        let writerRequest = '';
        await generateWriterDraft({ control, state: state560, plan: writerPlan(), model: { async write(request) { writerRequest = JSON.stringify(request); return { kind: 'writer-chapter-draft', chapterNumber: 561, prose: 'Safe prose.' }; } } });
        expect(writerRequest).not.toContain('RAW_AUTHOR_SECRET_ABC');
    });

    it('applies the same direct-secret guard to other writer-facing control fields', () => {
        const marker = 'Public phrasing: RAW_AUTHOR_SECRET_ABC';
        const variants: readonly [FullStoryControl, string][] = [
            [{ ...control, arcs: [{ ...control.arcs[0], writerBrief: marker }] }, 'arcs.0.writerBrief'],
            [{ ...control, beats: [{ id: 'beat', arcId: 'arc', order: 1, startChapter: 1, endChapter: 700, writerBrief: marker }] }, 'beats.0.writerBrief'],
            [{ ...control, canonRules: [{ id: 'rule', text: marker, availableFromChapter: 1, scope: 'canon' }] }, 'canonRules.0.text'],
            [{ ...control, characters: { a: { ...control.characters.a, writerProfile: { role: marker } } } }, 'characters.0.writerProfile.role'],
            [{ ...control, relationshipEvents: [{ id: 'rel-event', relationshipId: 'rel', eventType: 'meeting', participantIds: ['a', 'a'], writerText: marker }], gates: { ...control.gates, relationships: [{ id: 'rel-gate', eventId: 'rel-event', allowedFromChapter: 1 }] } }, 'relationshipEvents.0.writerText'],
            [{ ...control, storyEvents: [{ id: 'story-event', eventType: 'event', writerText: marker }], gates: { ...control.gates, events: [{ id: 'event-gate', eventId: 'story-event', allowedFromChapter: 1 }] } }, 'storyEvents.0.writerText'],
        ];
        variants.forEach(([variant, path]) => {
            const issues = validateFullStoryControl(variant);
            expect(issues).toContainEqual(expect.objectContaining({ path }));
            expect(JSON.stringify(issues)).not.toContain('RAW_AUTHOR_SECRET_ABC');
        });
    });

    it('normalizes explicit Delta V1 compatibility and strictly parses V2', () => {
        expect(parseStoryStateDelta(v1(1, 0))).toMatchObject({ schemaVersion: 2, revealChanges: [], foreshadowChanges: [], payoffChanges: [] });
        expect(parseStoryStateDelta(v2(1, 0))).toMatchObject({ schemaVersion: 2 });
        expect(() => parseStoryStateDelta({ ...v2(1, 0), unknownPlotPayload: [] })).toThrowError(expect.objectContaining({ code: 'INVALID_DELTA' }));
        expect(() => parseStoryStateDelta({ ...v2(1, 0), schemaVersion: 3 })).toThrowError(expect.objectContaining({ code: 'INVALID_DELTA' }));
        expect(() => parseStoryStateDelta({ ...v1(1, 0), revealChanges: [] })).toThrowError(expect.objectContaining({ code: 'INVALID_DELTA' }));
    });

    it('fails closed at the reveal boundary atomically, succeeds at 561, and rejects duplicates', () => {
        const before = advance(559);
        const serialized = JSON.stringify(before);
        const premature = v2(560, 559, {
            factChanges: [{ id: 'fact-560', text: 'safe fact', establishedChapter: 560, visibility: 'writer', status: 'active', provenance: provenance(560) }],
            resourceChanges: [{ id: 'resource-560', characterId: 'a', resourceId: 'coin', name: 'Coin', quantityDelta: 1, provenance: provenance(560) }],
            revealChanges: [{ operation: 'record', occurrence: { id: 'reveal-occurrence', revealId: 'r', chapterNumber: 560, provenance: provenance(560) } }],
        });
        expect(() => applyStoryStateDelta(control, before, premature)).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        expect(JSON.stringify(before)).toBe(serialized);
        const revealed = applyStoryStateDelta(control, state560, v2(561, 560, { revealChanges: [{ operation: 'record', occurrence: { id: 'reveal-occurrence', revealId: 'r', chapterNumber: 561, provenance: provenance(561) } }] }));
        expect(hasRevealOccurred(revealed, 'r', 561)).toBe(true);
        expect(getRevealOccurrence(revealed, 'r', 561)?.chapterNumber).toBe(561);
        expect(JSON.stringify(revealed)).not.toContain('RAW_AUTHOR_SECRET_ABC');
        expect(() => applyStoryStateDelta(control, revealed, v2(562, 561, { revealChanges: [{ operation: 'record', occurrence: { id: 'reveal-again', revealId: 'r', chapterNumber: 562, provenance: provenance(562) } }] }))).toThrowError(expect.objectContaining({ code: 'CONFLICTING_OPERATION' }));
    });

    it('derives secret lifecycle without ever returning secret values', () => {
        expect(getAuthorSecretStatus(control, advance(559), 's', 560)).toBe('locked');
        expect(getAuthorSecretStatus(control, state560, 's', 561)).toBe('eligible-not-revealed');
        const revealed = applyStoryStateDelta(control, state560, v2(561, 560, { revealChanges: [{ operation: 'record', occurrence: { id: 'r-561', revealId: 'r', chapterNumber: 561, provenance: provenance(561) } }] }));
        expect(getAuthorSecretStatus(control, revealed, 's', 561)).toBe('revealed');
        expect(getAuthorSecretStatus(control, revealed, 'forever', 600)).toBe('author-only');
        expect(JSON.stringify([getAuthorSecretStatus(control, revealed, 's', 561), buildValidatorPlotView(control, revealed, 561)])).not.toContain('RAW_AUTHOR');
    });

    it('retains seed and reinforcement history and derives open-thread age', () => {
        const state = advance(25, createInitialStoryState(), {
            10: v2(10, 9, { foreshadowChanges: [
                { operation: 'open', thread: { id: 'f', writerLabel: 'Tax-record discrepancy', openedChapter: 10, linkedPayoffId: 'p', provenance: provenance(10) } },
                { operation: 'add-cue', cue: { id: 'f-seed', threadId: 'f', chapterNumber: 10, cueType: 'seed', writerText: 'A discrepancy in the tax records remains noticeable.', provenance: provenance(10) } },
            ], payoffChanges: [{ operation: 'open', obligation: { id: 'p', writerLabel: 'Resolve the tax discrepancy', openedChapter: 10, linkedForeshadowThreadId: 'f', requiresForeshadowSeed: true, provenance: provenance(10) } }] }),
            20: v2(20, 19, { foreshadowChanges: [{ operation: 'add-cue', cue: { id: 'f-reinforce', threadId: 'f', chapterNumber: 20, cueType: 'reinforcement', writerText: 'The altered totals draw attention again.', provenance: provenance(20) } }] }),
        });
        expect(getForeshadowCues(state, 'f', 25).map(value => value.id)).toEqual(['f-seed', 'f-reinforce']);
        expect(getForeshadowReinforcementAge(state, 'f', 25)).toBe(5);
        expect(getOpenForeshadowThreads(state, 25).map(value => value.id)).toEqual(['f']);
        expect(getForeshadowThreadStatus(state, 'f', 25)).toBe('open');
    });

    it('derives payoff windows and records explicit paid versus paid-late history', () => {
        const open = v2(10, 9, { payoffChanges: [
            { operation: 'open', obligation: { id: 'p', writerLabel: 'Pay the promise', openedChapter: 10, earliestPayoffChapter: 20, targetPayoffChapter: 25, latestPayoffChapter: 30, provenance: provenance(10) } },
            { operation: 'open', obligation: { id: 'late', writerLabel: 'Late promise', openedChapter: 10, earliestPayoffChapter: 20, targetPayoffChapter: 25, latestPayoffChapter: 30, provenance: provenance(10) } },
        ] });
        const state18 = advance(18, createInitialStoryState(), { 10: open });
        expect(() => applyStoryStateDelta(control, state18, v2(19, 18, { payoffChanges: [{ operation: 'resolve', lifecycle: { id: 'p-too-soon', payoffId: 'p', chapterNumber: 19, status: 'paid', provenance: provenance(19) } }] }))).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        const state19 = advance(19, state18);
        const obligation = state19.ledgers.payoffObligations.find(value => value.id === 'p')!;
        expect(getPayoffStatus(state19, obligation, 19)).toBe('not-due');
        expect(getPayoffUrgency(state19, obligation, 19)).toBe('dormant');
        expect(getPayoffUrgency(state19, obligation, 21)).toBe('approaching');
        expect(getPayoffStatus(state19, obligation, 25)).toBe('due');
        expect(getPayoffStatus(state19, obligation, 31)).toBe('overdue');
        const state31 = advance(31, state19);
        expect(getOverduePayoffs(state31, 31).map(value => value.id)).toEqual(['late', 'p']);
        const state32 = applyStoryStateDelta(control, state31, v2(32, 31, { payoffChanges: [{ operation: 'resolve', lifecycle: { id: 'late-paid', payoffId: 'late', chapterNumber: 32, status: 'paid', provenance: provenance(32) } }] }));
        expect(getPayoffStatus(state32, state32.ledgers.payoffObligations.find(value => value.id === 'late')!, 32)).toBe('paid-late');
    });

    it('requires atomic same-chapter occurrence when the reveal is the payoff', () => {
        const state = advance(560, createInitialStoryState(), {
            10: v2(10, 9, { payoffChanges: [{ operation: 'open', obligation: { id: 'reveal-payoff', writerLabel: 'Resolve the concealed identity', openedChapter: 10, earliestPayoffChapter: 561, linkedRevealId: 'r', revealIsPayoff: true, provenance: provenance(10) } }] }),
        });
        expect(() => applyStoryStateDelta(control, state, v2(561, 560, { payoffChanges: [{ operation: 'resolve', lifecycle: { id: 'payoff-only', payoffId: 'reveal-payoff', chapterNumber: 561, status: 'paid', provenance: provenance(561) } }] }))).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        const next = applyStoryStateDelta(control, state, v2(561, 560, {
            revealChanges: [{ operation: 'record', occurrence: { id: 'r-occurs', revealId: 'r', chapterNumber: 561, provenance: provenance(561) } }],
            payoffChanges: [{ operation: 'resolve', lifecycle: { id: 'payoff-paid', payoffId: 'reveal-payoff', chapterNumber: 561, status: 'paid', provenance: provenance(561) } }],
        }));
        expect(hasRevealOccurred(next, 'r', 561)).toBe(true);
        expect(getPayoffStatus(next, next.ledgers.payoffObligations[0], 561)).toBe('paid');
    });

    it('rejects direct raw-secret plot text without echoing the protected value', () => {
        try {
            applyStoryStateDelta(control, createInitialStoryState(), v2(1, 0, { foreshadowChanges: [
                { operation: 'open', thread: { id: 'unsafe', writerLabel: 'Safe-looking label', openedChapter: 1, provenance: provenance(1) } },
                { operation: 'add-cue', cue: { id: 'unsafe-cue', threadId: 'unsafe', chapterNumber: 1, cueType: 'seed', writerText: 'Notice RAW_AUTHOR_SECRET_ABC now.', provenance: provenance(1) } },
            ] }));
            throw new Error('expected protected text rejection');
        } catch (error) {
            expect(error).toBeInstanceOf(StoryStateTransitionError);
            expect((error as Error).message).not.toContain('RAW_AUTHOR_SECRET_ABC');
        }
        expect(() => applyStoryStateDelta(control, createInitialStoryState(), v1(1, 0, {
            factChanges: [{ id: 'unsafe-fact', text: 'RAW_AUTHOR_SECRET_ABC', establishedChapter: 1, visibility: 'internal', status: 'active', provenance: provenance(1) }],
        }))).toThrowError(expect.objectContaining({ code: 'CONFLICTING_OPERATION' }));
    });

    it('builds bounded planner-safe guidance and validator descriptors without privileged text', () => {
        const state = advance(25, createInitialStoryState(), { 10: v2(10, 9, {
            foreshadowChanges: [{ operation: 'open', thread: { id: 'f', writerLabel: 'Safe discrepancy', openedChapter: 10, linkedRevealId: 'r', provenance: provenance(10) } }, { operation: 'add-cue', cue: { id: 'seed', threadId: 'f', chapterNumber: 10, cueType: 'seed', writerText: 'A harmless discrepancy remains.', provenance: provenance(10) } }],
            payoffChanges: [{ operation: 'open', obligation: { id: 'due', writerLabel: 'Resolve safe discrepancy', openedChapter: 10, targetPayoffChapter: 25, linkedRevealId: 'r', provenance: provenance(10) } }],
        }) });
        const guidance = buildPlannerPlotGuidance(control, state, 25);
        const serialized = JSON.stringify(guidance);
        expect(guidance.duePayoffs.map(value => value.id)).toEqual(['due']);
        expect(serialized).not.toContain('RAW_AUTHOR_SECRET_ABC');
        expect(serialized).not.toContain('LOCKED_REVEAL_WRITER_TEXT');
        expect(serialized).not.toContain('authorNotes');
        expect(JSON.stringify(buildValidatorPlotView(control, state, 25))).not.toContain('RAW_AUTHOR');
        expect(() => buildPlannerPlotGuidance(control, state, 25, { maxOpenForeshadowThreads: 1, maxReinforcementCandidates: 1, maxDuePayoffs: 0, maxOverduePayoffs: 1, maxEligibleReveals: 1, reinforcementAfterChapters: 1 })).toThrow(PlotGuidanceCapacityError);
    });

    it('enforces global IDs and rejects future canonical plot data', () => {
        const chapter1 = applyStoryStateDelta(control, createInitialStoryState(), v1(1, 0, { factChanges: [{ id: 'collision', text: 'Fact', establishedChapter: 1, visibility: 'writer', status: 'active', provenance: provenance(1) }] }));
        expect(() => applyStoryStateDelta(control, chapter1, v2(2, 1, { foreshadowChanges: [{ operation: 'open', thread: { id: 'collision', writerLabel: 'Thread', openedChapter: 2, provenance: provenance(2) } }] }))).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));
        const revealed = applyStoryStateDelta(control, state560, v2(561, 560, { revealChanges: [{ operation: 'record', occurrence: { id: 'occ', revealId: 'r', chapterNumber: 561, provenance: provenance(561) } }] }));
        const malformed = { ...revealed, ledgers: { ...revealed.ledgers, revealOccurrences: [{ ...revealed.ledgers.revealOccurrences[0], chapterNumber: 562 }] } };
        expect(() => parseStoryState(malformed, control)).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
    });

    it('rejects impossible persisted foreshadow/payoff history and accepts legal link chronology', () => {
        const base = advance(25);
        const parsePlot = (values: Partial<StoryState['ledgers']>) => parseStoryState({ ...base, ledgers: { ...base.ledgers, ...values } }, control);
        const thread = (id: string, openedChapter: number, linkedPayoffId?: string) => ({ id, writerLabel: `Thread ${id}`, openedChapter, ...(linkedPayoffId ? { linkedPayoffId } : {}), provenance: provenance(openedChapter) });
        const cue = (id: string, threadId: string, chapterNumber: number) => ({ id, threadId, chapterNumber, cueType: 'seed' as const, writerText: `Seed ${id}`, provenance: provenance(chapterNumber) });
        const payoff = (id: string, openedChapter: number, linkedForeshadowThreadId?: string, requiresForeshadowSeed?: true) => ({ id, writerLabel: `Payoff ${id}`, openedChapter, ...(linkedForeshadowThreadId ? { linkedForeshadowThreadId } : {}), ...(requiresForeshadowSeed ? { requiresForeshadowSeed } : {}), provenance: provenance(openedChapter) });
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10)], foreshadowCues: [cue('s1', 'f', 10), cue('s2', 'f', 11)] })).toThrowError(expect.objectContaining({ code: 'CONFLICTING_OPERATION' }));
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10)], foreshadowLifecycle: [{ id: 'f-paid', threadId: 'f', chapterNumber: 20, status: 'paid', provenance: provenance(20) }] })).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10)], foreshadowCues: [cue('late-seed', 'f', 21)], foreshadowLifecycle: [{ id: 'f-paid', threadId: 'f', chapterNumber: 20, status: 'paid', provenance: provenance(20) }] })).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10)], payoffObligations: [payoff('p', 10, 'f', true)], payoffLifecycle: [{ id: 'p-paid', payoffId: 'p', chapterNumber: 20, status: 'paid', provenance: provenance(20) }] })).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10)], foreshadowCues: [cue('late-seed', 'f', 21)], payoffObligations: [payoff('p', 10, 'f', true)], payoffLifecycle: [{ id: 'p-paid', payoffId: 'p', chapterNumber: 20, status: 'paid', provenance: provenance(20) }] })).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10, 'p')], payoffObligations: [payoff('p', 20)] })).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 20)], payoffObligations: [payoff('p', 10, 'f')] })).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10, 'p'), thread('other', 10)], payoffObligations: [payoff('p', 10, 'other')] })).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10, 'p')], payoffObligations: [payoff('p', 10, 'f')] })).not.toThrow();
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10)], payoffObligations: [payoff('p', 20, 'f')] })).not.toThrow();
        expect(() => parsePlot({ foreshadowThreads: [thread('f', 10)], foreshadowCues: [cue('seed', 'f', 10)], payoffObligations: [payoff('p', 10, 'f', true)], payoffLifecycle: [{ id: 'p-paid', payoffId: 'p', chapterNumber: 20, status: 'paid', provenance: provenance(20) }] })).not.toThrow();
    });

    it('rejects state-independent plot conflicts during V2 parsing', () => {
        const reveal = (id: string) => ({ operation: 'record' as const, occurrence: { id, revealId: 'r', chapterNumber: 1, provenance: provenance(1) } });
        const closeThread = (id: string) => ({ operation: 'pay' as const, lifecycle: { id, threadId: 'f', chapterNumber: 1, status: 'paid' as const, provenance: provenance(1) } });
        const closePayoff = (id: string) => ({ operation: 'resolve' as const, lifecycle: { id, payoffId: 'p', chapterNumber: 1, status: 'paid' as const, provenance: provenance(1) } });
        const seed = (id: string) => ({ operation: 'add-cue' as const, cue: { id, threadId: 'f', chapterNumber: 1, cueType: 'seed' as const, writerText: `Seed ${id}`, provenance: provenance(1) } });
        [
            v2(1, 0, { revealChanges: [reveal('r1'), reveal('r2')] }),
            v2(1, 0, { foreshadowChanges: [closeThread('f1'), closeThread('f2')] }),
            v2(1, 0, { payoffChanges: [closePayoff('p1'), closePayoff('p2')] }),
            v2(1, 0, { foreshadowChanges: [seed('s1'), seed('s2')] }),
        ].forEach(value => expect(() => parseStoryStateDelta(value)).toThrowError(expect.objectContaining({ code: 'CONFLICTING_OPERATION' })));
    });

    it('remains deterministic and bounded across 300 chapters with many plot records', () => {
        const operations: Record<number, StoryStateDeltaV2> = {};
        for (let chapter = 10; chapter <= 290; chapter += 20) {
            const suffix = String(chapter);
            operations[chapter] = v2(chapter, chapter - 1, {
                foreshadowChanges: [
                    { operation: 'open', thread: { id: `f-${suffix}`, writerLabel: `Thread ${suffix}`, openedChapter: chapter, provenance: provenance(chapter) } },
                    { operation: 'add-cue', cue: { id: `seed-${suffix}`, threadId: `f-${suffix}`, chapterNumber: chapter, cueType: 'seed', writerText: `Safe cue ${suffix}`, provenance: provenance(chapter) } },
                ],
                payoffChanges: [{ operation: 'open', obligation: { id: `p-${suffix}`, writerLabel: `Payoff ${suffix}`, openedChapter: chapter, earliestPayoffChapter: 400, targetPayoffChapter: 450, latestPayoffChapter: 500, linkedForeshadowThreadId: `f-${suffix}`, provenance: provenance(chapter) } }],
            });
        }
        const state = advance(300, createInitialStoryState(), operations);
        const first = buildPlannerPlotGuidance(control, state, 300);
        const second = buildPlannerPlotGuidance(control, state, 300);
        expect(first).toEqual(second);
        expect(first.openForeshadowThreads.length).toBeLessThanOrEqual(24);
        expect(getDuePayoffs(state, 300)).toHaveLength(0);
        expect(JSON.stringify(first)).not.toContain('RAW_AUTHOR');
        expect(parseStoryState(state, control)).toEqual(state);
    });
});
