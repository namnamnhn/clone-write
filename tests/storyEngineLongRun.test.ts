import { describe, expect, it } from 'vitest';
import {
    applyStoryStateDelta,
    buildPlannerContext,
    buildRepairContext,
    buildValidatorStrategicView,
    buildValidatorContext,
    buildValidatorRelationshipView,
    buildWriterContext,
    buildWriterPrompt,
    characterKnowsFact,
    CANONICAL_EVENT_TYPES,
    createStructuredPlanner,
    DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY,
    deriveCurrentRomanceMilestone,
    generateWriterDraft,
    getAuthorSecretStatus,
    getForeshadowThreadStatus,
    getOpenForeshadowThreads,
    getPayoffStatus,
    getRevealsOccurredByChapter,
    isCharacterDirectAppearanceAllowed,
    isPovAllowed,
    isRelationshipEventAllowed,
    isRevealAllowed,
    isStoryEventAllowed,
    parseStoryState,
    PlannerContextCapacityError,
    sanitizeWriterChapterPlan,
    selectNarrativeMemory,
    StoryStateTransitionError,
    validateAndRepairWriterChapter,
    validatePoliticalAction,
    validateInternalChapterPlan,
    validateWriterChapter,
    ValidatorContextCapacityError,
    WriterContextError,
} from '../src/storyEngine';
import type {
    NarrativeMemorySelectionPolicy,
    RelationshipActionPlan,
    StoryState,
    StoryStateDelta,
    StoryStateDeltaV2,
} from '../src/storyEngine';
import {
    LONG_RUN_CHECKPOINTS,
    LONG_RUN_CONTROL,
    LONG_RUN_GATE_MATRIX,
    LONG_RUN_MEMORY,
    commerceActionFor,
    militaryActionFor,
    politicalActionFor,
} from './fixtures/storyEngineLongRunFixture';
import {
    arcAndBeatAt,
    buildSampleInternalPlan,
    createLongRunDelta,
    deterministicPlannerModel,
    deterministicRepairModel,
    deterministicSemanticValidatorModel,
    deterministicWriterModel,
    expectedResourceQuantities,
    getLongRun,
    measureContextAt,
    runLongRun,
} from './helpers/storyEngineLongRunHarness';

const secretMarkers = [
    'RAW_LONG_RUN_SECRET_ALPHA', 'RAW_LONG_RUN_SECRET_OMEGA', 'RAW_LONG_RUN_SECRET_PERMANENT',
];

const expectNoRawSecret = (value: unknown): void => {
    const serialized = JSON.stringify(value);
    secretMarkers.forEach(marker => expect(serialized).not.toContain(marker));
};

const expectNoFutureCanon = (state: StoryState): void => {
    const inspect = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(inspect); return; }
        if (typeof value !== 'object' || value === null) return;
        Object.entries(value).forEach(([key, child]) => {
            if (['chapterNumber', 'sourceChapter', 'establishedChapter', 'learnedChapter', 'sinceChapter', 'resolvedChapter', 'openedChapter'].includes(key)
                && typeof child === 'number') expect(child).toBeLessThanOrEqual(state.currentChapter);
            inspect(child);
        });
    };
    inspect(state.ledgers);
};

describe('Story Engine V4 deterministic 600-chapter torture run', () => {
    it('advances exactly C1 through C600 with strict checkpoints, growing ledgers, and exact projections', () => {
        const run = getLongRun();
        const state = run.finalState;
        expect(state).toMatchObject({ currentChapter: 600, revision: 600, currentArcId: 'arc-6', currentBeatId: 'beat-6-4' });
        expect(run.v1ChapterCount + run.v2ChapterCount).toBe(600);
        expect(run.v1ChapterCount).toBeGreaterThan(0);
        expect(run.v2ChapterCount).toBeGreaterThan(0);
        LONG_RUN_CHECKPOINTS.forEach((chapter) => {
            const checkpoint = run.checkpoints.get(chapter);
            expect(checkpoint, `checkpoint C${chapter}`).toBeDefined();
            expect(parseStoryState(checkpoint, LONG_RUN_CONTROL)).toEqual(checkpoint);
            expect(checkpoint).toMatchObject({ currentChapter: chapter, revision: chapter });
        });

        expect(state.ledgers.facts).toHaveLength(600);
        expect(state.ledgers.epistemic).toHaveLength(170);
        expect(state.ledgers.relationships).toHaveLength(16);
        expect(state.ledgers.resources).toHaveLength(1335);
        expect(state.ledgers.continuity).toHaveLength(142);
        expect(state.ledgers.events).toHaveLength(2376);
        expect(new Set(state.ledgers.events.map(value => value.id)).size).toBe(state.ledgers.events.length);
        expect(state.ledgers.events.every(value => value.chapterNumber <= 600 && CANONICAL_EVENT_TYPES.includes(value.type))).toBe(true);
        const canonicalIds = new Set(Object.entries(state.ledgers)
            .filter(([key]) => key !== 'events')
            .flatMap(([, values]) => values.map(value => value.id)));
        const resolvableIds = new Set([
            ...canonicalIds,
            ...Object.keys(LONG_RUN_CONTROL.characters),
            ...LONG_RUN_CONTROL.relationshipDefinitions.map(value => value.id),
            ...state.projections.resources.map(value => value.resourceId),
        ]);
        const eventsWithoutResolvableAffectedIds = state.ledgers.events
            .filter(value => !value.affectedIds.some(id => resolvableIds.has(id)))
            .map(value => ({ id: value.id, type: value.type, affectedIds: value.affectedIds }));
        expect(eventsWithoutResolvableAffectedIds).toEqual([]);
        expect(state.ledgers.epistemic.every(entry => entry.learnedChapter <= 600 && entry.source.sourceChapter <= entry.learnedChapter)).toBe(true);
        expect(state.ledgers.epistemic.filter(entry => entry.kind === 'believed').every(entry => !state.ledgers.facts.some(fact => fact.text === entry.claim))).toBe(true);

        const expectedResources = expectedResourceQuantities();
        expect(Object.fromEntries(state.projections.resources.map(value => [value.resourceId, value.quantity]))).toEqual(expectedResources);
        expect(state.projections.resources.every(value => Number.isFinite(value.quantity))).toBe(true);
        expect(state.projections.resources.find(value => value.resourceId === 'money')?.currentHistoryId).toBe('resource-money-600');
        expect(state.projections.characters.find(value => value.characterId === 'atlas')?.currentLocationRecordId).toBe('location-atlas-600');
        expect(state.projections.characters.find(value => value.characterId === 'atlas')?.activeStatusIds).toEqual(['status-atlas-coordinator']);
        expect(state.projections.relationships.find(value => value.id === 'atlas-birch')?.currentHistoryId).toBe('relationship-atlas-birch-560');
        expect(state.projections.relationships.find(value => value.id === 'atlas-cinder')?.currentHistoryId).toBe('relationship-atlas-cinder-600');
        expectNoFutureCanon(state);
        expectNoRawSecret(state);
    }, 120_000);

    it('does not mutate compiled control and keeps plot/relationship queries deterministic', () => {
        const before = JSON.stringify(LONG_RUN_CONTROL);
        const state = getLongRun().finalState;
        expect(getRevealsOccurredByChapter(state, 600)).toEqual(getRevealsOccurredByChapter(state, 600));
        expect(getOpenForeshadowThreads(state, 600)).toEqual(getOpenForeshadowThreads(state, 600));
        const romantic = LONG_RUN_CONTROL.relationshipDefinitions.find(value => value.id === 'atlas-birch')!;
        expect(deriveCurrentRomanceMilestone(romantic, state, 600)).toBe(deriveCurrentRomanceMilestone(romantic, state, 600));
        expect(JSON.stringify(LONG_RUN_CONTROL)).toBe(before);
    });

    it('resolves every arc and beat boundary without early or stale drift', () => {
        const boundaries = [99, 100, 101, 199, 200, 201, 299, 300, 301, 399, 400, 401, 499, 500, 501, 599, 600];
        boundaries.forEach((chapter) => {
            const { arc, beat } = arcAndBeatAt(chapter);
            expect(arc?.id).toBe(`arc-${Math.ceil(chapter / 100)}`);
            const withinArc = (chapter - 1) % 100;
            expect(beat?.id).toBe(`beat-${Math.ceil(chapter / 100)}-${Math.floor(withinArc / 25) + 1}`);
        });
    });

    it('keeps every inclusive hard gate locked at N-1 and allowed at N and N+1', () => {
        LONG_RUN_GATE_MATRIX.character.forEach(({ id, chapter }) => {
            expect(isCharacterDirectAppearanceAllowed(LONG_RUN_CONTROL, id, chapter - 1)).toBe(false);
            expect(isCharacterDirectAppearanceAllowed(LONG_RUN_CONTROL, id, chapter)).toBe(true);
            expect(isCharacterDirectAppearanceAllowed(LONG_RUN_CONTROL, id, chapter + 1)).toBe(true);
        });
        LONG_RUN_GATE_MATRIX.pov.forEach(({ id, chapter }) => {
            expect(isPovAllowed(LONG_RUN_CONTROL, id, chapter - 1)).toBe(false);
            expect(isPovAllowed(LONG_RUN_CONTROL, id, chapter)).toBe(true);
            expect(isPovAllowed(LONG_RUN_CONTROL, id, chapter + 1)).toBe(true);
        });
        LONG_RUN_GATE_MATRIX.reveal.forEach(({ id, chapter }) => {
            expect(isRevealAllowed(LONG_RUN_CONTROL, id, chapter - 1)).toBe(false);
            expect(isRevealAllowed(LONG_RUN_CONTROL, id, chapter)).toBe(true);
            expect(isRevealAllowed(LONG_RUN_CONTROL, id, chapter + 1)).toBe(true);
        });
        LONG_RUN_GATE_MATRIX.relationship.forEach(({ id, chapter }) => {
            expect(isRelationshipEventAllowed(LONG_RUN_CONTROL, id, chapter - 1)).toBe(false);
            expect(isRelationshipEventAllowed(LONG_RUN_CONTROL, id, chapter)).toBe(true);
            expect(isRelationshipEventAllowed(LONG_RUN_CONTROL, id, chapter + 1)).toBe(true);
        });
        LONG_RUN_GATE_MATRIX.event.forEach(({ id, chapter }) => {
            expect(isStoryEventAllowed(LONG_RUN_CONTROL, id, chapter - 1)).toBe(false);
            expect(isStoryEventAllowed(LONG_RUN_CONTROL, id, chapter)).toBe(true);
            expect(isStoryEventAllowed(LONG_RUN_CONTROL, id, chapter + 1)).toBe(true);
        });
    });

    it('keeps narrative memory target-safe, bounded, deterministic, and zero-window safe', () => {
        const first = selectNarrativeMemory(LONG_RUN_MEMORY, 600);
        const second = selectNarrativeMemory(LONG_RUN_MEMORY, 600);
        expect(first).toEqual(second);
        expect(first.recentRawChapters).toHaveLength(4);
        expect(first.structuredRecentSummaries).toHaveLength(12);
        expect(first.selectedLongTermMemories).toHaveLength(8);
        expect(first.recentRawChapters.map(value => value.chapterNumber)).toEqual([596, 597, 598, 599]);
        expect(first.structuredRecentSummaries.map(value => value.chapterNumber)).toEqual(Array.from({ length: 12 }, (_, index) => 588 + index));
        expect([...first.recentRawChapters, ...first.structuredRecentSummaries].every(value => value.chapterNumber < 600)).toBe(true);
        expect(first.selectedLongTermMemories.every(value => value.establishedChapter < 600)).toBe(true);
        expect(JSON.stringify(first)).not.toContain('FUTURE_');

        const zero: NarrativeMemorySelectionPolicy = { recentRawChapters: 0, structuredSummaryWindow: 0, selectedLongTermMemories: 0 };
        expect(selectNarrativeMemory(LONG_RUN_MEMORY, 600, zero)).toEqual({ recentRawChapters: [], structuredRecentSummaries: [], selectedLongTermMemories: [] });
        const custom: NarrativeMemorySelectionPolicy = { recentRawChapters: 2, structuredSummaryWindow: 3, selectedLongTermMemories: 1 };
        expect(selectNarrativeMemory(LONG_RUN_MEMORY, 600, custom)).toMatchObject({
            recentRawChapters: [{ chapterNumber: 598 }, { chapterNumber: 599 }],
            structuredRecentSummaries: [{ chapterNumber: 597 }, { chapterNumber: 598 }, { chapterNumber: 599 }],
        });
    });

    it('allows Canon to grow while default Planner and Writer collection counts plateau', () => {
        const metrics = [measureContextAt(100), measureContextAt(300), measureContextAt(600)];
        expect(metrics.map(value => value.canon.facts)).toEqual([100, 300, 600]);
        expect(metrics.map(value => value.planner.writerFacts)).toEqual([49, 64, 64]);
        expect(metrics.map(value => value.planner.internalFacts)).toEqual([50, 64, 64]);
        metrics.forEach(({ planner, writer }) => {
            expect(planner.characters).toBeLessThanOrEqual(64);
            expect(planner.writerFacts).toBeLessThanOrEqual(64);
            expect(planner.internalFacts).toBeLessThanOrEqual(64);
            expect(planner.knowledgeFactRefs).toBeLessThanOrEqual(64);
            expect(planner.relationships).toBeLessThanOrEqual(64);
            expect(planner.continuity).toBeLessThanOrEqual(24);
            expect(planner.rawMemory).toBeLessThanOrEqual(4);
            expect(planner.summaries).toBeLessThanOrEqual(12);
            expect(planner.longTerm).toBeLessThanOrEqual(8);
            expect(writer.characters).toBeLessThanOrEqual(24);
            expect(writer.facts).toBeLessThanOrEqual(64);
            expect(writer.continuity).toBeLessThanOrEqual(24);
        });
    }, 120_000);

    it('applies deterministic custom Planner limits, removes dangling knowledge, and fails closed for mandatory overflow', () => {
        const state99 = getLongRun().checkpoints.get(99)!;
        const custom = {
            ...DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY,
            maxCharacters: 4,
            maxWriterVisibleFacts: 3,
            maxInternalFacts: 2,
            maxKnowledgeFactRefs: 2,
            maxRelationships: 1,
            maxUnresolvedClues: 1,
            maxUnresolvedPromises: 1,
            maxContinuityEntries: 2,
            maxResourcesPerCharacter: 2,
        };
        const first = buildPlannerContext(LONG_RUN_CONTROL, state99, 100, LONG_RUN_MEMORY, undefined, undefined, custom);
        const second = buildPlannerContext(LONG_RUN_CONTROL, state99, 100, LONG_RUN_MEMORY, undefined, undefined, custom);
        expect(first).toEqual(second);
        expect(first.availableCharacters).toHaveLength(4);
        expect(first.writerVisibleFacts).toHaveLength(3);
        expect(first.internalFacts).toHaveLength(2);
        expect(first.relationships.length).toBeLessThanOrEqual(1);
        expect(first.continuity.pendingThreads.length + first.continuity.notes.length).toBeLessThanOrEqual(2);
        expect(Object.values(first.resources).every(values => values.length <= 2)).toBe(true);
        const selectedCharacters = new Set(first.availableCharacters.map(value => value.id));
        const selectedFacts = new Set([...first.writerVisibleFacts, ...first.internalFacts].map(value => value.id));
        expect(first.characterKnowledge.every(value => selectedCharacters.has(value.characterId)
            && value.factIds.every(id => selectedFacts.has(id)))).toBe(true);
        expect(first.characterKnowledge.reduce((sum, value) => sum + value.factIds.length, 0)).toBeLessThanOrEqual(2);
        expect(() => buildPlannerContext(LONG_RUN_CONTROL, state99, 100, undefined, undefined, undefined, {
            ...DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY, maxCharacters: 0,
        })).toThrow(PlannerContextCapacityError);
        expect(() => buildPlannerContext(LONG_RUN_CONTROL, state99, 100, undefined, undefined, undefined, {
            ...DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY, maxActiveHardConstraints: 0,
        })).toThrow(PlannerContextCapacityError);
        expect(() => buildPlannerContext(LONG_RUN_CONTROL, state99, 100, undefined, undefined, undefined, {
            ...DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY, maxGateIdsPerCategory: 0,
        })).toThrow(PlannerContextCapacityError);
        expect(() => buildPlannerContext(LONG_RUN_CONTROL, state99, 100, undefined, undefined, undefined, {
            ...DEFAULT_PLANNER_CONTEXT_SELECTION_POLICY, maxAuthorSecretReferences: 0,
        })).toThrow(PlannerContextCapacityError);
    });

    it('builds Planner and Writer contexts deeply equal on repeated C100, C300, and C600 calls', () => {
        ([100, 300, 600] as const).forEach((target) => {
            const prior = getLongRun().checkpoints.get(target - 1)!;
            const plannerA = buildPlannerContext(LONG_RUN_CONTROL, prior, target, LONG_RUN_MEMORY);
            const plannerB = buildPlannerContext(LONG_RUN_CONTROL, prior, target, LONG_RUN_MEMORY);
            expect(plannerA).toEqual(plannerB);
            const writerPlan = sanitizeWriterChapterPlan(buildSampleInternalPlan(plannerA), LONG_RUN_CONTROL, prior);
            expect(buildWriterContext(LONG_RUN_CONTROL, prior, writerPlan, LONG_RUN_MEMORY))
                .toEqual(buildWriterContext(LONG_RUN_CONTROL, prior, writerPlan, LONG_RUN_MEMORY));
        });
    });
});

describe('Story Engine V4 long-run plot, relationships, security, and replay', () => {
    it('keeps reveal eligibility distinct from occurrence and reports complete plot lifecycles', () => {
        const state = getLongRun().finalState;
        expect(getAuthorSecretStatus(LONG_RUN_CONTROL, state, 'secret-alpha', 548)).toBe('locked');
        expect(getAuthorSecretStatus(LONG_RUN_CONTROL, state, 'secret-alpha', 549)).toBe('eligible-not-revealed');
        expect(getAuthorSecretStatus(LONG_RUN_CONTROL, state, 'secret-alpha', 550)).toBe('revealed');
        expect(getAuthorSecretStatus(LONG_RUN_CONTROL, state, 'secret-omega', 560)).toBe('locked');
        expect(getAuthorSecretStatus(LONG_RUN_CONTROL, state, 'secret-omega', 561)).toBe('eligible-not-revealed');
        expect(getAuthorSecretStatus(LONG_RUN_CONTROL, state, 'secret-omega', 575)).toBe('revealed');
        expect(getAuthorSecretStatus(LONG_RUN_CONTROL, state, 'secret-permanent', 600)).toBe('author-only');
        expect(getForeshadowThreadStatus(state, 'foreshadow-early', 600)).toBe('paid');
        expect(getForeshadowThreadStatus(state, 'foreshadow-middle', 600)).toBe('superseded');
        expect(getForeshadowThreadStatus(state, 'foreshadow-long', 600)).toBe('paid');
        const statuses = Object.fromEntries(state.ledgers.payoffObligations.map(value => [value.id, getPayoffStatus(state, value, 600)]));
        expect(statuses).toEqual({
            'payoff-early': 'paid', 'payoff-paid-late': 'paid-late', 'payoff-reveal': 'paid',
            'payoff-superseded': 'superseded', 'payoff-overdue': 'overdue', 'payoff-due-final': 'due',
        });
    });

    it('preserves pairwise slow burn and never turns the professional relationship romantic', () => {
        const state = getLongRun().finalState;
        const romantic = LONG_RUN_CONTROL.relationshipDefinitions.find(value => value.id === 'atlas-birch')!;
        const professional = LONG_RUN_CONTROL.relationshipDefinitions.find(value => value.id === 'atlas-cinder')!;
        expect(deriveCurrentRomanceMilestone(romantic, state, 600)).toBe('committed-romance');
        expect(deriveCurrentRomanceMilestone(professional, state, 600)).toBe('none');
        expect(state.ledgers.relationships.filter(value => value.relationshipId === 'atlas-birch').map(value => value.chapterNumber)).toEqual([60, 140, 220, 300, 380, 460, 540, 560]);
        expect(JSON.stringify(state.projections.relationships)).not.toMatch(/affection|heroine|harem|winner/i);
    });

    it('accepts the final mutual romance contract through the real relationship view and rejects professional romance drift', async () => {
        const state559 = getLongRun().checkpoints.get(560 - 1)!;
        const context = buildPlannerContext(LONG_RUN_CONTROL, state559, 560, LONG_RUN_MEMORY);
        const acceptance: RelationshipActionPlan = {
            id: 'relationship-accept-560', sceneIds: ['scene-560'], relationshipId: 'atlas-birch',
            relationshipEventId: 'romance-acceptance', participantIds: ['atlas', 'birch'], category: 'romantic',
            actionType: 'accept-romance', importance: 'major',
            currentStateAssessment: {
                trust: 'high', respect: 'high', attraction: 'high', emotionalOpenness: 'high',
                dependency: 'moderate', conflict: 'low', sharedInterest: 'high', powerBalance: 'balanced',
            },
            currentRomanceMilestone: 'courtship',
            intendedProgression: {
                direction: 'strengthening', romanticMilestone: 'committed-romance',
                expectedState: 'committed-romance', mutual: true, intermediate: false,
            },
            participantAgency: ['atlas', 'birch'].map(characterId => ({
                characterId, currentGoal: 'Choose the relationship freely.', desiredOutcome: 'Mutual commitment.',
                boundary: 'No coerced commitment.', choice: 'Accept the established courtship.', willingness: 'yes' as const,
                uncertainty: 'The future remains difficult.', costOrRisk: 'Commitment creates shared obligations.',
                knowledgeBasisFactIds: [],
            })),
            boundaries: [], evidenceRefs: [{ type: 'relationship', id: 'atlas-birch' }],
            counterpressure: 'Their public duties remain in tension.', uncertainty: 'Duty may still separate them.',
            expectedCostOrTradeoff: 'Both accept durable obligations.', powerImbalanceAddressed: true,
            writerVisibleContract: {
                currentDynamic: 'An earned courtship between equals.', objective: 'Make a mutual final choice.',
                visibleConflict: 'Duty competes with commitment.', visibleUncertainty: 'Either may still refuse.',
            },
        };
        const base = buildSampleInternalPlan(context);
        const plan = {
            ...base,
            participantIds: ['atlas', 'birch'],
            scenes: base.scenes.map(scene => ({ ...scene, povCharacterId: 'atlas', participantIds: ['atlas', 'birch'], purposeTags: ['relationship' as const] })),
            povCharacterId: 'atlas',
            relationshipEventIds: ['romance-acceptance'],
            expectedRelationshipDeltas: [{ relationshipId: 'atlas-birch', participantIds: ['atlas', 'birch'], expectedState: 'committed-romance' }],
            relationshipActions: [acceptance],
        };
        const relationshipView = buildValidatorRelationshipView(LONG_RUN_CONTROL, plan, context);
        expect(relationshipView.deterministicIssues).toEqual([]);
        const writerPlan = sanitizeWriterChapterPlan(plan, LONG_RUN_CONTROL, state559);
        expect(() => buildValidatorContext(LONG_RUN_CONTROL, state559, writerPlan, undefined, undefined, relationshipView)).not.toThrow();
        const draft = await generateWriterDraft({ control: LONG_RUN_CONTROL, state: state559, plan: writerPlan, model: deterministicWriterModel });
        const validation = await validateWriterChapter({
            control: LONG_RUN_CONTROL, state: state559, plan: writerPlan, draft,
            semanticModel: deterministicSemanticValidatorModel, relationshipView,
        });
        expect(validation.report.status, JSON.stringify(validation.report)).toBe('passed');
        expect(state559).toMatchObject({ currentChapter: 559, revision: 559 });

        const professionalDrift: RelationshipActionPlan = {
            ...acceptance,
            id: 'professional-romance-drift', relationshipId: 'atlas-cinder', relationshipEventId: undefined,
            participantIds: ['atlas', 'cinder'], category: 'professional', actionType: 'professional-respect',
            currentRomanceMilestone: 'none', participantAgency: acceptance.participantAgency.map((value, index) => ({
                ...value, characterId: index === 0 ? 'atlas' : 'cinder', willingness: 'uncertain' as const,
            })), evidenceRefs: [{ type: 'relationship', id: 'atlas-cinder' }],
            intendedProgression: { direction: 'strengthening', romanticMilestone: 'awareness', expectedState: 'awareness', mutual: false, intermediate: false },
        };
        const invalid = {
            ...plan, relationshipEventIds: [], relationshipActions: [professionalDrift],
            expectedRelationshipDeltas: [{ relationshipId: 'atlas-cinder', participantIds: ['atlas', 'cinder'], expectedState: 'awareness' }],
            participantIds: ['atlas', 'cinder'], scenes: plan.scenes.map(scene => ({ ...scene, participantIds: ['atlas', 'cinder'] })),
        };
        expect(() => sanitizeWriterChapterPlan(invalid, LONG_RUN_CONTROL, state559)).toThrow();
    });

    it('keeps beliefs separate from strategic knowledge and fails political causality closed', () => {
        const state599 = getLongRun().checkpoints.get(599)!;
        const context = buildPlannerContext(LONG_RUN_CONTROL, state599, 600, LONG_RUN_MEMORY);
        expect(characterKnowsFact(state599, 'atlas', 'fact-588', 599)).toBe(true);
        expect(characterKnowsFact(state599, 'birch', 'fact-588', 599)).toBe(false);
        expect(validatePoliticalAction(politicalActionFor(600), context, 'action')).toEqual([]);
        expect(validatePoliticalAction(politicalActionFor(600, 'birch'), context, 'action')
            .some(issue => issue.code === 'POLITICAL_INFORMATION_VIOLATION')).toBe(true);
    });

    it('exercises real Politics, Military, and Commerce strategic views across early, middle, and late checkpoints', async () => {
        const samples = [
            { target: 100 as const, action: politicalActionFor(100, 'atlas', 'fact-096') },
            { target: 300 as const, action: militaryActionFor(300, 'fact-288') },
            { target: 600 as const, action: commerceActionFor(600) },
        ];
        for (const { target, action } of samples) {
            const prior = getLongRun().checkpoints.get(target - 1)!;
            const planner = buildPlannerContext(LONG_RUN_CONTROL, prior, target, LONG_RUN_MEMORY);
            const internal = buildSampleInternalPlan(planner, [action]);
            expect(validateInternalChapterPlan(internal, planner)).toEqual([]);
            const strategicView = buildValidatorStrategicView(internal, planner);
            expect(strategicView.deterministicIssues).toEqual([]);
            const writerPlan = sanitizeWriterChapterPlan(internal, LONG_RUN_CONTROL, prior);
            const draft = await generateWriterDraft({
                control: LONG_RUN_CONTROL, state: prior, plan: writerPlan, model: deterministicWriterModel,
            });
            const validation = await validateWriterChapter({
                control: LONG_RUN_CONTROL, state: prior, plan: writerPlan, draft,
                semanticModel: deterministicSemanticValidatorModel, strategicView,
            });
            expect(validation.report.status).toBe('passed');
            expectNoRawSecret(strategicView);
        }
    });

    it('runs Planner, Writer, Validator, and finite Repair offline without making Canon', async () => {
        const state599 = getLongRun().checkpoints.get(599)!;
        const stateBefore = structuredClone(state599);
        const plannerContext = buildPlannerContext(LONG_RUN_CONTROL, state599, 600, LONG_RUN_MEMORY);
        const internalPlan = await createStructuredPlanner(deterministicPlannerModel, LONG_RUN_CONTROL).plan(plannerContext);
        const writerPlan = sanitizeWriterChapterPlan(internalPlan, LONG_RUN_CONTROL, state599);
        const writerContext = buildWriterContext(LONG_RUN_CONTROL, state599, writerPlan, LONG_RUN_MEMORY);
        const draft = await generateWriterDraft({
            control: LONG_RUN_CONTROL, state: state599, plan: writerPlan, memoryInput: LONG_RUN_MEMORY,
            model: deterministicWriterModel,
        });
        const validation = await validateWriterChapter({
            control: LONG_RUN_CONTROL, state: state599, plan: writerPlan, draft,
            semanticModel: deterministicSemanticValidatorModel,
        });
        expect(validation.report.status).toBe('passed');
        expectNoRawSecret(plannerContext);
        expectNoRawSecret(writerPlan);
        expectNoRawSecret(writerContext);
        expectNoRawSecret(buildWriterPrompt(writerContext));
        expectNoRawSecret(validation.report);

        const repaired = await validateAndRepairWriterChapter({
            control: LONG_RUN_CONTROL, state: state599, plan: writerPlan,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 600, prose: '<STORY_STATE>unsafe wrapper</STORY_STATE>' },
            semanticModel: deterministicSemanticValidatorModel, repairModel: deterministicRepairModel,
        });
        expect(repaired).toMatchObject({ status: 'approved-not-canon', repairAttempts: 1 });
        expect(state599).toEqual(stateBefore);
        expect(state599).toMatchObject({ currentChapter: 599, revision: 599 });
        if (validation.candidateStatus === 'parsed' && validation.context && validation.repairCandidate) {
            expectNoRawSecret(buildRepairContext(validation.context.writerContext, validation.repairCandidate, validation.report));
        }
    });

    it('keeps late author secrets and future-only control markers out of every model-bound boundary', () => {
        const samples = [
            { state: getLongRun().checkpoints.get(548)!, target: 549 },
            { state: getLongRun().checkpoints.get(560)!, target: 561 },
            { state: getLongRun().checkpoints.get(599)!, target: 600 },
        ];
        samples.forEach(({ state, target }) => {
            const planner = buildPlannerContext(LONG_RUN_CONTROL, state, target, LONG_RUN_MEMORY);
            const writerPlan = sanitizeWriterChapterPlan(buildSampleInternalPlan(planner), LONG_RUN_CONTROL, state);
            const writer = buildWriterContext(LONG_RUN_CONTROL, state, writerPlan, LONG_RUN_MEMORY);
            [planner, writerPlan, writer, buildWriterPrompt(writer)].forEach(expectNoRawSecret);
            const serialized = JSON.stringify([planner, writerPlan, writer]);
            expect(serialized).not.toContain('FUTURE_ARC_6_PRIVATE_MARKER');
            if (target < 561) {
                expect(serialized).not.toContain('FUTURE_CHARACTER_561_MARKER');
                expect(planner.availableCharacters.some(value => value.id === 'harbor')).toBe(false);
            }
        });
    });

    it('retains old mandatory Writer facts and continuity, then fails closed when mandatory continuity exceeds capacity', () => {
        const state599 = getLongRun().checkpoints.get(599)!;
        const planner = buildPlannerContext(LONG_RUN_CONTROL, state599, 600, LONG_RUN_MEMORY);
        const base = buildSampleInternalPlan(planner);
        const requiredText = 'Continuity item 041 remains current until explicitly closed.';
        const requiredPlan = sanitizeWriterChapterPlan({
            ...base,
            expectedContinuityConsequences: [{ id: 'require-old-continuity', text: requiredText }],
        }, LONG_RUN_CONTROL, state599);
        const writer = buildWriterContext(LONG_RUN_CONTROL, state599, requiredPlan, LONG_RUN_MEMORY);
        expect(writer.writerVisibleFacts.some(value => value.id === 'fact-012')).toBe(true);
        expect(writer.continuity.pendingThreads.some(value => value.text === requiredText)).toBe(true);
        expect(writer.writerVisibleFacts).toHaveLength(64);
        expect(writer.continuity.pendingThreads.length + writer.continuity.notes.length).toBeLessThanOrEqual(24);

        const mandatory = state599.continuity.pendingThreads.filter(value => value.visibility === 'writer').slice(0, 25);
        expect(mandatory).toHaveLength(25);
        const overflowPlan = sanitizeWriterChapterPlan({
            ...base,
            expectedContinuityConsequences: mandatory.map((value, index) => ({ id: `mandatory-${index}`, text: value.text })),
        }, LONG_RUN_CONTROL, state599);
        expect(() => buildWriterContext(LONG_RUN_CONTROL, state599, overflowPlan)).toThrow(WriterContextError);
    });

    it('replays deterministically and resumes a JSON-parsed C300 snapshot to the same C600 state', () => {
        const baseline = getLongRun();
        const replay = runLongRun();
        expect(replay.finalState).toEqual(baseline.finalState);
        LONG_RUN_CHECKPOINTS.forEach(chapter => expect(replay.checkpoints.get(chapter)).toEqual(baseline.checkpoints.get(chapter)));
        const serialized300: unknown = JSON.parse(JSON.stringify(baseline.checkpoints.get(300)));
        const parsed300 = parseStoryState(serialized300, LONG_RUN_CONTROL);
        const resumed = runLongRun(parsed300);
        expect(resumed.finalState).toEqual(baseline.finalState);
        expect(() => applyStoryStateDelta(LONG_RUN_CONTROL, parsed300, createLongRunDelta(300))).toThrowError(expect.objectContaining({ code: 'CHAPTER_SEQUENCE_VIOLATION' }));
    }, 120_000);

    it('fails closed on revision, future source, premature reveal, plot lifecycle, and planned-story-end injection', () => {
        const state599 = getLongRun().checkpoints.get(599)!;
        const next = createLongRunDelta(600);
        expect(() => applyStoryStateDelta(LONG_RUN_CONTROL, state599, { ...next, expectedRevision: 598 })).toThrowError(expect.objectContaining({ code: 'REVISION_MISMATCH' }));
        const invalidFact = (createLongRunDelta(600) as StoryStateDelta).factChanges[0];
        expect(() => applyStoryStateDelta(LONG_RUN_CONTROL, state599, {
            ...(createLongRunDelta(600) as StoryStateDelta),
            factChanges: [{ ...invalidFact, provenance: { ...invalidFact.provenance, sourceChapter: 601 } }],
        })).toThrowError(StoryStateTransitionError);

        const state548 = getLongRun().checkpoints.get(548)!;
        const delta549 = createLongRunDelta(549) as StoryStateDelta;
        const premature: StoryStateDeltaV2 = {
            ...delta549, schemaVersion: 2, revealChanges: [{ operation: 'record', occurrence: {
                id: 'premature-omega', revealId: 'reveal-omega', chapterNumber: 549,
                provenance: { sourceChapter: 549, sourceType: 'chapter', sourceId: 'chapter-549' },
            } }], foreshadowChanges: [], payoffChanges: [],
        };
        expect(() => applyStoryStateDelta(LONG_RUN_CONTROL, state548, premature)).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        expect(() => buildPlannerContext(LONG_RUN_CONTROL, getLongRun().finalState, 601)).toThrow('planned story range');
    });

    it('rejects future characters, locked POVs, strategic resource mismatch, raw secret input, and repair protocol failure', async () => {
        const state559 = getLongRun().checkpoints.get(559)!;
        const planner560 = buildPlannerContext(LONG_RUN_CONTROL, state559, 560);
        const base560 = buildSampleInternalPlan(planner560);
        expect(() => sanitizeWriterChapterPlan({
            ...base560, povCharacterId: 'harbor', participantIds: ['harbor'],
            scenes: base560.scenes.map(scene => ({ ...scene, povCharacterId: 'harbor', participantIds: ['harbor'] })),
        }, LONG_RUN_CONTROL, state559)).toThrow();

        const state96 = getLongRun().checkpoints.get(96)!;
        const planner96 = buildPlannerContext(LONG_RUN_CONTROL, state96, 96);
        const base96 = buildSampleInternalPlan(planner96);
        expect(() => sanitizeWriterChapterPlan({
            ...base96, povCharacterId: 'cinder', participantIds: ['cinder'],
            scenes: base96.scenes.map(scene => ({ ...scene, povCharacterId: 'cinder', participantIds: ['cinder'] })),
        }, LONG_RUN_CONTROL, state96)).toThrow();

        const state299 = getLongRun().checkpoints.get(299)!;
        const planner300 = buildPlannerContext(LONG_RUN_CONTROL, state299, 300);
        const military = militaryActionFor(300, 'fact-288');
        const mismatched = { ...buildSampleInternalPlan(planner300, [military]), expectedResourceDeltas: [] };
        expect(validateInternalChapterPlan(mismatched, planner300).some(value => value.code === 'STRATEGIC_RESOURCE_RECONCILIATION_VIOLATION')).toBe(true);

        const safePlan = sanitizeWriterChapterPlan(base560, LONG_RUN_CONTROL, state559);
        expect(() => buildWriterContext(LONG_RUN_CONTROL, state559, {
            ...safePlan, primaryGoal: 'RAW_LONG_RUN_SECRET_ALPHA',
        })).toThrow();
        const failedRepair = await validateAndRepairWriterChapter({
            control: LONG_RUN_CONTROL, state: state559, plan: safePlan,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 560, prose: '<STORY_STATE>bad</STORY_STATE>' },
            semanticModel: deterministicSemanticValidatorModel,
            repairModel: { async repair() { return { invalid: true }; } },
        });
        expect(failedRepair).toMatchObject({ status: 'rejected', repairAttempts: 1 });
        expect(failedRepair.report.issues.map(value => value.code)).toContain('REPAIR_PROTOCOL_FAILURE');
    });

    it('rejects duplicate IDs, cues after close, invalid thread references, and impossible plot chronology atomically', () => {
        const state300 = getLongRun().checkpoints.get(300)!;
        const base = createLongRunDelta(301) as StoryStateDelta;
        expect(() => applyStoryStateDelta(LONG_RUN_CONTROL, state300, {
            ...base,
            factChanges: [{ ...base.factChanges[0], id: 'fact-300' }],
        })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_ID' }));

        const plotDelta = (foreshadowChanges: StoryStateDeltaV2['foreshadowChanges']): StoryStateDeltaV2 => ({
            ...base, schemaVersion: 2, revealChanges: [], payoffChanges: [], foreshadowChanges,
        });
        expect(() => applyStoryStateDelta(LONG_RUN_CONTROL, state300, plotDelta([{ operation: 'add-cue', cue: {
            id: 'cue-after-close', threadId: 'foreshadow-early', chapterNumber: 301,
            cueType: 'reinforcement', writerText: 'This cue must be rejected.',
            provenance: { sourceChapter: 301, sourceType: 'chapter', sourceId: 'chapter-301' },
        } }]))).toThrowError(expect.objectContaining({ code: 'CONFLICTING_OPERATION' }));
        expect(() => applyStoryStateDelta(LONG_RUN_CONTROL, state300, plotDelta([{ operation: 'add-cue', cue: {
            id: 'cue-missing-thread', threadId: 'missing-thread', chapterNumber: 301,
            cueType: 'seed', writerText: 'This cue has no canonical thread.',
            provenance: { sourceChapter: 301, sourceType: 'chapter', sourceId: 'chapter-301' },
        } }]))).toThrowError(expect.objectContaining({ code: 'REFERENTIAL_INTEGRITY_FAILURE' }));
        expect(() => applyStoryStateDelta(LONG_RUN_CONTROL, state300, plotDelta([{ operation: 'add-cue', cue: {
            id: 'cue-wrong-time', threadId: 'foreshadow-long', chapterNumber: 300,
            cueType: 'reinforcement', writerText: 'This cue has impossible chronology.',
            provenance: { sourceChapter: 300, sourceType: 'chapter', sourceId: 'chapter-300' },
        } }]))).toThrowError(expect.objectContaining({ code: 'TEMPORAL_VIOLATION' }));
        expect(state300).toEqual(getLongRun().checkpoints.get(300));
    });

    it('makes Validator overflow explicit instead of truncating privileged evidence', () => {
        const state599 = getLongRun().checkpoints.get(599)!;
        const planner = buildPlannerContext(LONG_RUN_CONTROL, state599, 600);
        const writerPlan = sanitizeWriterChapterPlan(buildSampleInternalPlan(planner), LONG_RUN_CONTROL, state599);
        expect(() => buildValidatorContext(LONG_RUN_CONTROL, state599, writerPlan, {
            maxLockedCharacters: 0, maxLockedReveals: 0, maxLockedRelationshipEvents: 0,
            maxLockedStoryEvents: 0, maxSecretValidationItems: 0, maxPlotItems: 0,
            maxStrategicItems: 0, maxRelationshipItems: 0,
        })).toThrow(ValidatorContextCapacityError);
    });
});
