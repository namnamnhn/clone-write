import { describe, expect, it, vi } from 'vitest';
import {
    buildPlannerContext,
    buildPlannerRelationshipContext,
    buildValidatorRelationshipView,
    buildRelationshipGateValidationView,
    buildWriterSafeContext,
    buildWriterContext,
    compileStoryControl,
    createInitialStoryState,
    DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY,
    InternalChapterPlan,
    parseInternalChapterPlan,
    RelationshipHistoryCapacityError,
    RelationshipActionPlan,
    sanitizeWriterChapterPlan,
    StoryBlueprint,
    validateInternalChapterPlan,
    validateAndRepairWriterChapter,
    validateRelationshipActions,
    validateWriterChapter,
    WriterContextError,
} from '../src/storyEngine';

const RAW_SECRET = 'RAW_AUTHOR_SECRET_ABC';
const policy = {
    maxMajorMilestoneAdvancePerChapter: 1,
    maxConsecutiveProgressionChapters: 2,
    requireCanonicalBasis: true as const,
    requireMutualAgencyForMutualMilestone: true as const,
};
const profile = {
    coreDynamicTags: ['professional-equals' as const, 'slow-earned-trust' as const],
    dominantConflictSources: ['Competing duties.'],
    trustBasis: ['Repeated reliable choices.'],
    respectBasis: ['Professional competence.'],
    prohibitedShortcuts: [],
};

const blueprint = (): StoryBlueprint => ({
    id: 'relationship-story', engine: { plannedChapterCount: 500 },
    characters: [
        { id: 'a', name: 'A', availableFromChapter: 1 },
        { id: 'b', name: 'B', availableFromChapter: 1 },
        { id: 'c', name: 'C', availableFromChapter: 1 },
        { id: 'd', name: 'D', availableFromChapter: 47 },
    ],
    arcs: [{ id: 'arc', title: 'Arc', startChapter: 1, endChapter: 500 }],
    relationshipDefinitions: [
        { id: 'a-b', participantIds: ['a', 'b'], categories: ['romantic', 'professional'], initialRomanceMilestone: 'awareness', dynamicProfile: profile, progressionPolicy: policy },
        { id: 'a-c', participantIds: ['a', 'c'], categories: ['professional', 'rivalry'], initialRomanceMilestone: 'none', dynamicProfile: { ...profile, coreDynamicTags: ['ideological-rivals'] }, progressionPolicy: policy },
        { id: 'a-d', participantIds: ['a', 'd'], categories: ['romantic'], initialRomanceMilestone: 'none', dynamicProfile: { ...profile, coreDynamicTags: ['political-alliance'] }, progressionPolicy: policy },
    ],
    relationshipEvents: [
        { id: 'a-b-confession', relationshipId: 'a-b', eventType: 'confession', participantIds: ['a', 'b'], writerText: 'A may confess; B still chooses freely.' },
        { id: 'a-b-commit', relationshipId: 'a-b', eventType: 'accept-romance', participantIds: ['a', 'b'], authorizedRomanceMilestone: 'committed-romance' },
        { id: 'a-d-contact', relationshipId: 'a-d', eventType: 'establish-contact', participantIds: ['a', 'd'] },
    ],
    gates: {
        characters: [
            { id: 'a-gate', characterId: 'a', allowedFromChapter: 1 },
            { id: 'b-gate', characterId: 'b', allowedFromChapter: 1 },
            { id: 'c-gate', characterId: 'c', allowedFromChapter: 1 },
            { id: 'd-gate', characterId: 'd', allowedFromChapter: 47 },
        ],
        pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }],
        reveals: [],
        relationships: [
            { id: 'confession-gate', eventId: 'a-b-confession', allowedFromChapter: 20 },
            { id: 'commit-gate', eventId: 'a-b-commit', allowedFromChapter: 100 },
            { id: 'contact-gate', eventId: 'a-d-contact', allowedFromChapter: 47 },
        ],
        events: [],
    },
    authorOnlySecrets: [{ id: 'secret', value: RAW_SECRET }],
});

const control = compileStoryControl(blueprint());

const stateFor = (
    chapter = 20,
    stage = 'awareness',
    options: { readonly bKnows?: boolean; readonly history?: readonly { readonly id: string; readonly state: string; readonly chapterNumber: number }[] } = {},
) => {
    const base = createInitialStoryState(chapter);
    const history = (options.history ?? []).map(value => ({
        ...value, relationshipId: 'a-b', participantIds: ['a', 'b'],
        provenance: { sourceChapter: value.chapterNumber, sourceType: 'chapter' as const, sourceId: `chapter-${value.chapterNumber}` },
    }));
    return {
        ...base,
        knownCharacterIds: ['a', 'b', 'c', 'd'], activeCharacterIds: ['a', 'b', 'c', 'd'],
        facts: [{ id: 'secret-protection', text: 'A protected B without public credit.', establishedChapter: 2, visibility: 'internal' as const }],
        characterKnowledge: [
            { characterId: 'a', factIds: ['secret-protection'] },
            { characterId: 'b', factIds: options.bKnows ? ['secret-protection'] : [] },
        ],
        relationships: [
            { id: 'a-b', participantIds: ['a', 'b'], state: stage, establishedChapter: 1 },
            { id: 'a-c', participantIds: ['a', 'c'], state: 'commercial-rivals', establishedChapter: 1 },
            { id: 'a-d', participantIds: ['a', 'd'], state: 'unmet', establishedChapter: 1 },
        ],
        ledgers: { ...base.ledgers, relationships: history },
    };
};

const assessment = (overrides: Partial<RelationshipActionPlan['currentStateAssessment']> = {}) => ({
    trust: 'moderate' as const, respect: 'moderate' as const, attraction: 'emerging' as const,
    emotionalOpenness: 'emerging' as const, dependency: 'low' as const, conflict: 'moderate' as const,
    sharedInterest: 'moderate' as const, powerBalance: 'balanced' as const, ...overrides,
});

const actionFor = (values: Partial<RelationshipActionPlan> = {}): RelationshipActionPlan => ({
    id: 'relationship-action', sceneIds: ['relationship-scene'], relationshipId: 'a-b', participantIds: ['a', 'b'],
    category: 'romantic', actionType: 'deepen-trust', importance: 'minor', currentStateAssessment: assessment(),
    currentRomanceMilestone: 'awareness',
    intendedProgression: { direction: 'strengthening', romanticMilestone: 'interest', expectedState: 'interest', mutual: false, intermediate: false },
    participantAgency: [
        { characterId: 'a', currentGoal: 'Offer reliable help.', desiredOutcome: 'Earn cautious trust.', boundary: 'No pressure.', choice: 'Help and accept uncertainty.', willingness: 'yes', uncertainty: 'B may refuse.', costOrRisk: 'A loses time.', knowledgeBasisFactIds: [] },
        { characterId: 'b', currentGoal: 'Protect independence.', desiredOutcome: 'Judge A by conduct.', boundary: 'No romantic promise.', choice: 'Acknowledge the help without commitment.', willingness: 'uncertain', uncertainty: 'A may have another motive.', costOrRisk: 'B risks limited trust.', knowledgeBasisFactIds: [] },
    ],
    boundaries: [], evidenceRefs: [{ type: 'relationship', id: 'a-b' }], counterpressure: 'Competing duties limit trust.',
    uncertainty: 'The bond may remain cautious.', expectedCostOrTradeoff: 'Both expose limited vulnerability.', powerImbalanceAddressed: true,
    writerVisibleContract: { currentDynamic: 'Cautious professional equals.', objective: 'Let trust emerge through choice.', visibleConflict: 'Both protect their independence.', visibleUncertainty: 'Either may keep distance.' },
    ...values,
});

const planFor = (action: RelationshipActionPlan, relationshipEventIds: readonly string[] = []): InternalChapterPlan => ({
    kind: 'internal-chapter-plan', chapterNumber: 20, arcId: 'arc', primaryGoal: 'Advance one earned relationship beat.',
    povCharacterId: 'a', participantIds: [...action.participantIds],
    scenes: [{ id: 'relationship-scene', order: 1, goal: 'Force a voluntary choice.', location: 'Office', povCharacterId: 'a', participantIds: [...action.participantIds], conflictOrObstacle: 'Their goals diverge.', uncertainty: 'Cooperation may fail.', expectedConsequence: 'The relationship changes only if earned.', purposeTags: ['relationship'], conflictImportance: 'minor' }],
    activeConstraintIds: [], allowedRevealIds: [], plannedRevealIds: [], relationshipEventIds, storyEventIds: [], cluesPlantedIds: [], cluesPaidOffIds: [],
    expectedResourceDeltas: [], expectedRelationshipDeltas: action.intendedProgression.expectedState === undefined ? [] : [{ relationshipId: action.relationshipId, participantIds: [...action.participantIds], expectedState: action.intendedProgression.expectedState }],
    expectedContinuityConsequences: [], strategicActions: [], relationshipActions: [action], endStateIntent: 'Stop before canon is updated.',
});

const issuesFor = (plan: InternalChapterPlan, state = stateFor(plan.chapterNumber, plan.relationshipActions?.[0]?.currentRomanceMilestone ?? 'awareness')) =>
    validateRelationshipActions(plan, buildPlannerContext(control, state, plan.chapterNumber), buildRelationshipGateValidationView(control, plan.chapterNumber));

const planWithActions = (actions: readonly RelationshipActionPlan[], expectedState?: string): InternalChapterPlan => ({
    ...planFor(actions[0]),
    relationshipActions: actions,
    expectedRelationshipDeltas: expectedState === undefined ? [] : [{ relationshipId: actions[0].relationshipId, participantIds: [...actions[0].participantIds], expectedState }],
});

describe('Story Engine V4 relationship engine', () => {
    it('strictly parses the closed action protocol and rejects unsupported fields', () => {
        const plan = planFor(actionFor());
        expect(parseInternalChapterPlan(plan).plan?.relationshipActions).toHaveLength(1);
        const raw = structuredClone(plan) as unknown as { relationshipActions: Record<string, unknown>[] };
        raw.relationshipActions[0].lovePoints = 10;
        expect(parseInternalChapterPlan(raw).issues.map(value => value.code)).toContain('INVALID_RELATIONSHIP_ACTION');
    });

    it('rejects non-canon romance and future-gated candidates, then permits the candidate at the gate', () => {
        const invented = planFor(actionFor({ relationshipId: 'a-c', participantIds: ['a', 'c'] }));
        expect(issuesFor(invented, stateFor()).map(value => value.code)).toContain('RELATIONSHIP_REFERENCE_INVALID');

        const gatedAction = actionFor({ relationshipId: 'a-d', participantIds: ['a', 'd'], category: 'romantic', actionType: 'establish-contact', currentRomanceMilestone: 'none', relationshipEventId: 'a-d-contact', intendedProgression: { direction: 'strengthening', romanticMilestone: 'awareness', expectedState: 'awareness', mutual: false, intermediate: false }, evidenceRefs: [{ type: 'relationship', id: 'a-d' }], participantAgency: actionFor().participantAgency.map((value, index) => ({ ...value, characterId: index === 0 ? 'a' : 'd' })) });
        const chapter46 = { ...planFor(gatedAction, ['a-d-contact']), chapterNumber: 46 };
        expect(issuesFor(chapter46, stateFor(46, 'awareness')).map(value => value.code)).toContain('RELATIONSHIP_REFERENCE_INVALID');
        const chapter47 = { ...planFor(gatedAction, ['a-d-contact']), chapterNumber: 47 };
        expect(issuesFor(chapter47, stateFor(47, 'awareness'))).toEqual([]);
    });

    it('keeps professional respect separate from romance and allows equal-rival respect', () => {
        const professional = actionFor({ relationshipId: 'a-c', participantIds: ['a', 'c'], category: 'professional', actionType: 'professional-respect', currentRomanceMilestone: 'none', currentStateAssessment: assessment({ attraction: 'low', trust: 'low', respect: 'moderate' }), intendedProgression: { direction: 'strengthening', romanticMilestone: 'none', expectedState: 'cautious-respect', mutual: false, intermediate: false }, participantAgency: actionFor().participantAgency.map((value, index) => ({ ...value, characterId: index === 0 ? 'a' : 'c' })), evidenceRefs: [{ type: 'relationship', id: 'a-c' }] });
        expect(issuesFor(planFor(professional), stateFor())).toEqual([]);
        const accidentalRomance = { ...professional, intendedProgression: { ...professional.intendedProgression, romanticMilestone: 'awareness' as const } };
        expect(issuesFor(planFor(accidentalRomance), stateFor()).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
    });

    it('requires canonical participant knowledge before secret help can change trust', () => {
        const factAction = actionFor({ evidenceRefs: [
            { type: 'fact', id: 'secret-protection' },
            { type: 'knowledge', characterId: 'a', factId: 'secret-protection' },
            { type: 'knowledge', characterId: 'b', factId: 'secret-protection' },
        ] });
        expect(issuesFor(planFor(factAction), stateFor(20, 'awareness', { bKnows: false })).map(value => value.code)).toContain('RELATIONSHIP_KNOWLEDGE_VIOLATION');
        const informed = { ...factAction, participantAgency: factAction.participantAgency.map(value => value.characterId === 'b' ? { ...value, knowledgeBasisFactIds: ['secret-protection'] } : value) };
        expect(issuesFor(planFor(informed), stateFor(20, 'awareness', { bKnows: true }))).toEqual([]);
    });

    it('rejects non-mutual commitment, multi-stage jumps, and boundary contradictions', () => {
        const currentCourtship = actionFor({ currentRomanceMilestone: 'courtship', actionType: 'accept-romance', relationshipEventId: 'a-b-commit', intendedProgression: { direction: 'strengthening', romanticMilestone: 'committed-romance', expectedState: 'committed-romance', mutual: true, intermediate: false }, participantAgency: actionFor().participantAgency.map(value => ({ ...value, willingness: value.characterId === 'b' ? 'uncertain' : 'yes' })) });
        expect(issuesFor({ ...planFor(currentCourtship, ['a-b-commit']), chapterNumber: 100 }, stateFor(100, 'courtship')).map(value => value.code)).toContain('RELATIONSHIP_MUTUALITY_VIOLATION');
        const jump = actionFor({ intendedProgression: { direction: 'strengthening', romanticMilestone: 'committed-romance', expectedState: 'committed-romance', mutual: true, intermediate: false } });
        expect(issuesFor(planFor(jump), stateFor()).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        const bounded = actionFor({ boundaries: [{ characterId: 'b', type: 'professional', constraint: 'professional-only', stance: 'maintain', instruction: 'Keep the bond professional.' }] });
        expect(issuesFor(planFor(bounded), stateFor()).map(value => value.code)).toContain('RELATIONSHIP_BOUNDARY_VIOLATION');
    });

    it('requires attachment and a known trigger for jealousy', () => {
        const jealousy = actionFor({ actionType: 'jealousy', jealousCharacterId: 'b', currentRomanceMilestone: 'none', currentStateAssessment: assessment({ trust: 'low', dependency: 'low' }), intendedProgression: { direction: 'conflicted', romanticMilestone: 'none', expectedState: 'jealous-conflict', mutual: false, intermediate: false }, participantAgency: actionFor().participantAgency.map(value => ({ ...value, knowledgeBasisFactIds: [] })) });
        expect(issuesFor(planFor(jealousy), stateFor(20, 'none')).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        const grounded = { ...jealousy, currentRomanceMilestone: 'interest' as const, currentStateAssessment: assessment({ trust: 'moderate' }), intendedProgression: { ...jealousy.intendedProgression, romanticMilestone: 'interest' as const }, participantAgency: jealousy.participantAgency.map(value => value.characterId === 'b' ? { ...value, knowledgeBasisFactIds: ['secret-protection'] } : value), evidenceRefs: [{ type: 'knowledge' as const, characterId: 'b', factId: 'secret-protection' }] };
        expect(issuesFor(planFor(grounded), stateFor(20, 'interest', { bKnows: true }))).toEqual([]);
    });

    it('accepts a canonical active belief as a jealousy trigger without converting it into fact', () => {
        const base = stateFor(20, 'interest');
        const believedState = {
            ...base,
            ledgers: { ...base.ledgers, epistemic: [{
                id: 'belief-trigger', characterId: 'b', kind: 'believed' as const,
                claim: 'A may prefer another alliance.', learnedChapter: 19,
                source: { type: 'inference' as const, sourceChapter: 19, basisFactIds: [] }, status: 'active' as const,
            }] },
        };
        const jealousy = actionFor({
            actionType: 'jealousy', jealousCharacterId: 'b', currentRomanceMilestone: 'interest',
            intendedProgression: { direction: 'conflicted', romanticMilestone: 'interest', expectedState: 'jealous-conflict', mutual: false, intermediate: false },
            evidenceRefs: [{ type: 'belief', characterId: 'b', epistemicId: 'belief-trigger' }],
        });
        expect(issuesFor(planFor(jealousy), believedState)).toEqual([]);
        expect(believedState.facts.some(value => value.id === 'belief-trigger')).toBe(false);
    });

    it('detects compressed consecutive progression under the explicit slow-burn policy', () => {
        const history = [
            { id: 'h10', state: 'awareness', chapterNumber: 10 },
            { id: 'h11', state: 'interest', chapterNumber: 11 },
            { id: 'h12', state: 'attraction', chapterNumber: 12 },
        ];
        const action = actionFor({ currentRomanceMilestone: 'attraction', intendedProgression: { direction: 'strengthening', romanticMilestone: 'trust-building', expectedState: 'trust-building', mutual: false, intermediate: false } });
        const plan = { ...planFor(action), chapterNumber: 13 };
        expect(issuesFor(plan, stateFor(13, 'attraction', { history })).map(value => value.code)).toContain('RELATIONSHIP_REPETITION_VIOLATION');
    });

    it('reconciles final relationship deltas and rejects unexplained contradictory final actions', () => {
        const mismatch = { ...planFor(actionFor()), expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'deep-romance' }] };
        expect(issuesFor(mismatch, stateFor()).map(value => value.code)).toContain('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION');
        const rupture = actionFor({ id: 'rupture', actionType: 'rupture', intendedProgression: { direction: 'weakening', romanticMilestone: 'awareness', expectedState: 'ruptured', mutual: false, intermediate: false } });
        const conflicting = { ...planFor(actionFor()), relationshipActions: [actionFor(), rupture], expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'ruptured' }] };
        expect(issuesFor(conflicting, stateFor()).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
    });

    it('preserves the exact Writer-safe contract while excluding privileged evidence and goals', () => {
        const internal = planFor(actionFor());
        const writerPlan = sanitizeWriterChapterPlan(internal, control, stateFor());
        const directive = writerPlan.relationshipDirectives?.[0];
        expect(directive).toMatchObject({ visibleObjective: 'Let trust emerge through choice.', visibleConflict: 'Both protect their independence.', participantChoices: [{ characterId: 'a' }, { characterId: 'b' }] });
        expect(JSON.stringify(directive)).not.toContain('evidenceRefs');
        expect(JSON.stringify(directive)).not.toContain('Offer reliable help');
        const writerContext = buildWriterContext(control, stateFor(), writerPlan);
        expect(writerContext.chapterPlan.relationshipDirectives).toEqual(writerPlan.relationshipDirectives);
    });

    it('rejects fabricated Writer directives before WriterModel', () => {
        const writerPlan = sanitizeWriterChapterPlan(planFor(actionFor()), control, stateFor());
        const rejects = (plan: typeof writerPlan) => expect(() => buildWriterContext(control, stateFor(), plan)).toThrow(WriterContextError);
        const directive = writerPlan.relationshipDirectives![0];
        rejects({ ...writerPlan, relationshipDirectives: [{ ...directive, relationshipId: 'unknown' }] });
        rejects({ ...writerPlan, relationshipDirectives: [{ ...directive, intendedProgression: { ...directive.intendedProgression, romanticMilestone: 'committed-romance' } }] });
        rejects({ ...writerPlan, relationshipDirectives: [{ ...directive, participantChoices: directive.participantChoices.slice(0, 1), intendedProgression: { ...directive.intendedProgression, romanticMilestone: 'mutual-tension', mutual: true } }] });
        rejects({ ...writerPlan, expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'wrong' }] });
    });

    it('requires a matching privileged relationship view and rejects stale participant choice', async () => {
        const internal = planFor(actionFor());
        const state = stateFor();
        const plannerContext = buildPlannerContext(control, state, 20);
        const writerPlan = sanitizeWriterChapterPlan(internal, control, state);
        const relationshipView = buildValidatorRelationshipView(control, internal, plannerContext);
        const semanticModel = { validate: vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 20, issues: [] })) };
        const draft = { kind: 'writer-chapter-draft', chapterNumber: 20, prose: 'They make a cautious voluntary choice.' };
        const missing = await validateWriterChapter({ control, state, plan: writerPlan, draft, semanticModel });
        expect(missing.report.issues.map(value => value.code)).toContain('INVALID_SOURCE_PLAN');
        expect(semanticModel.validate).not.toHaveBeenCalled();
        const stale = {
            ...structuredClone(relationshipView),
            actions: relationshipView.actions.map((value, index) => index === 0 ? {
                ...value,
                participantChoices: value.participantChoices.map((choice, choiceIndex) => choiceIndex === 1 ? { ...choice, choice: 'Accept immediate romance.' } : choice),
            } : value),
        };
        const rejected = await validateWriterChapter({ control, state, plan: writerPlan, draft, semanticModel, relationshipView: stale });
        expect(rejected.report.issues.map(value => value.code)).toContain('INVALID_SOURCE_PLAN');
        expect(semanticModel.validate).not.toHaveBeenCalled();
        const accepted = await validateWriterChapter({ control, state, plan: writerPlan, draft, semanticModel, relationshipView });
        expect(accepted.report.blockingIssueCount).toBe(0);
        expect(semanticModel.validate).toHaveBeenCalledTimes(1);
    });

    it('blocks raw author secrets at Writer and Validator relationship boundaries without echoing them', () => {
        const unsafe = actionFor({ writerVisibleContract: { ...actionFor().writerVisibleContract, objective: RAW_SECRET } });
        expect(() => sanitizeWriterChapterPlan(planFor(unsafe), control, stateFor())).toThrowError(/protected author material/i);
        try { sanitizeWriterChapterPlan(planFor(unsafe), control, stateFor()); }
        catch (error) { expect(String(error)).not.toContain(RAW_SECRET); }
    });

    it('keeps long histories bounded, independent, deterministic, immutable, and future-safe', () => {
        const manyBlueprint = blueprint();
        const definitions = Array.from({ length: 100 }, (_, index) => ({ ...manyBlueprint.relationshipDefinitions![0], id: `pair-${index}` }));
        const manyControl = compileStoryControl({ ...manyBlueprint, relationshipDefinitions: definitions, relationshipEvents: [], gates: { ...manyBlueprint.gates, relationships: [] } });
        const base = createInitialStoryState(400);
        const manyState = {
            ...base, knownCharacterIds: ['a', 'b', 'c', 'd'], activeCharacterIds: ['a', 'b', 'c', 'd'],
            relationships: definitions.map((value, index) => ({ id: value.id, participantIds: ['a', 'b'], state: index % 2 ? 'interest' : 'awareness', establishedChapter: index + 1 })),
            ledgers: { ...base.ledgers, relationships: Array.from({ length: 500 }, (_, index) => ({ id: `history-${index}`, relationshipId: `pair-${index % 100}`, participantIds: ['a', 'b'], state: index % 2 ? 'interest' : 'awareness', chapterNumber: index + 1, provenance: { sourceChapter: index + 1, sourceType: 'chapter' as const, sourceId: `chapter-${index + 1}` } })) },
        };
        const beforeControl = JSON.stringify(manyControl);
        const beforeState = JSON.stringify(manyState);
        const first = buildPlannerContext(manyControl, manyState, 400).relationshipContext;
        const second = buildPlannerContext(manyControl, manyState, 400).relationshipContext;
        expect(first).toEqual(second);
        expect(first.relationships).toHaveLength(64);
        expect(first.relationships.every(value => value.recentHistory.length <= 6)).toBe(true);
        expect(JSON.stringify(first)).not.toContain(RAW_SECRET);
        expect(JSON.stringify(manyControl)).toBe(beforeControl);
        expect(JSON.stringify(manyState)).toBe(beforeState);
    });

    it('returns deterministic issue ordering and never mutates source inputs', () => {
        const plan = planFor(actionFor({ intendedProgression: { direction: 'strengthening', romanticMilestone: 'committed-romance', expectedState: 'wrong', mutual: true, intermediate: false } }));
        const state = stateFor();
        const context = buildPlannerContext(control, state, 20);
        const beforePlan = JSON.stringify(plan);
        const beforeContext = JSON.stringify(context);
        const gateView = buildRelationshipGateValidationView(control, plan.chapterNumber);
        expect(validateInternalChapterPlan(plan, context, gateView)).toEqual(validateInternalChapterPlan(plan, context, gateView));
        expect(JSON.stringify(plan)).toBe(beforePlan);
        expect(JSON.stringify(context)).toBe(beforeContext);
    });

    it('round-trips one history-derived milestone through every Planner, Writer, and Validator boundary', async () => {
        const history = [
            { id: 'h10-interest', state: 'interest', chapterNumber: 10 },
            { id: 'h20-cautious', state: 'cautious-respect', chapterNumber: 20 },
        ];
        const state = stateFor(21, 'cautious-respect', { history });
        const plannerContext = buildPlannerContext(control, state, 21);
        expect(plannerContext.relationshipContext.relationships.find(value => value.id === 'a-b')?.currentRomanceMilestone).toBe('interest');
        expect(buildWriterSafeContext(control, state, 21).state.relationshipMilestones.find(value => value.relationshipId === 'a-b')?.currentRomanceMilestone).toBe('interest');
        const action = actionFor({
            currentRomanceMilestone: 'interest',
            intendedProgression: { direction: 'strengthening', romanticMilestone: 'attraction', expectedState: 'attraction', mutual: false, intermediate: false },
        });
        const internal = { ...planFor(action), chapterNumber: 21 };
        expect(validateInternalChapterPlan(internal, plannerContext, buildRelationshipGateValidationView(control, 21))).toEqual([]);
        const writerPlan = sanitizeWriterChapterPlan(internal, control, state);
        const writerContext = buildWriterContext(control, state, writerPlan);
        expect(writerContext.chapterPlan.relationshipDirectives?.[0].currentRomanceMilestone).toBe('interest');
        const relationshipView = buildValidatorRelationshipView(control, internal, plannerContext);
        expect(relationshipView.canonicalRelationships[0].currentRomanceMilestone).toBe('interest');
        const result = await validateWriterChapter({
            control, state, plan: writerPlan,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 21, prose: 'They choose a cautious step closer.' },
            semanticModel: { async validate() { return { kind: 'semantic-validation-result' as const, chapterNumber: 21, issues: [] }; } },
            relationshipView,
        });
        expect(result.report.blockingIssueCount).toBe(0);
    });

    it('requires literal milestone persistence and a matching final relationship delta', () => {
        const absent = actionFor({ intendedProgression: { direction: 'strengthening', romanticMilestone: 'interest', mutual: false, intermediate: false } });
        expect(issuesFor(planFor(absent)).map(value => value.code)).toContain('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION');
        const freeForm = actionFor({ intendedProgression: { direction: 'strengthening', romanticMilestone: 'interest', expectedState: 'earned-interest', mutual: false, intermediate: false } });
        expect(issuesFor(planFor(freeForm)).map(value => value.code)).toContain('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION');
        expect(issuesFor(planFor(actionFor()))).toEqual([]);
        const stableButCanonical = actionFor({
            currentRomanceMilestone: 'awareness', actionType: 'boundary-setting',
            intendedProgression: { direction: 'conflicted', romanticMilestone: 'awareness', mutual: false, intermediate: false },
        });
        expect(issuesFor(planFor(stableButCanonical)).map(value => value.code)).toContain('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION');
    });

    it('rejects orphan intermediate progression and accepts a causally linked final consequence', () => {
        const intermediate = actionFor({
            id: 'a-intermediate',
            intendedProgression: { direction: 'strengthening', romanticMilestone: 'interest', mutual: false, intermediate: true },
        });
        expect(issuesFor(planWithActions([intermediate])).map(value => value.code)).toContain('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION');
        const final = actionFor({
            id: 'z-final', sceneIds: ['relationship-final-scene'], actionType: 'reveal-vulnerability', dependsOnActionId: 'a-intermediate',
            intendedProgression: { direction: 'strengthening', romanticMilestone: 'interest', expectedState: 'interest', mutual: false, intermediate: false },
        });
        const sequenced = planWithActions([intermediate, final], 'interest');
        const laterFinal = {
            ...sequenced,
            scenes: [
                sequenced.scenes[0],
                { ...sequenced.scenes[0], id: 'relationship-final-scene', order: 2 },
            ],
        };
        expect(issuesFor(planWithActions([intermediate, { ...final, sceneIds: ['relationship-scene'] }], 'interest')).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        expect(issuesFor(laterFinal)).toEqual([]);
        const writerPlan = sanitizeWriterChapterPlan(laterFinal, control, stateFor());
        const sameSceneWriterPlan = {
            ...writerPlan,
            scenes: writerPlan.scenes.map(scene => scene.id === 'relationship-final-scene' ? { ...scene, purposeTags: ['plot' as const] } : scene),
            relationshipDirectives: writerPlan.relationshipDirectives!.map(directive => directive.id === 'z-final'
                ? { ...directive, sceneIds: ['relationship-scene'] } : directive),
        };
        expect(() => buildWriterContext(control, stateFor(), sameSceneWriterPlan)).toThrow(WriterContextError);
    });

    it('separates trusted relationship gates from canonical occurrence evidence', () => {
        const context = buildPlannerContext(control, stateFor(20), 20);
        expect(JSON.stringify(context)).not.toContain('committed-romance');
        expect('relationshipEvents' in context.relationshipContext).toBe(false);

        const relationshipEvidence = structuredClone(planFor(actionFor())) as unknown as { relationshipActions: { evidenceRefs: unknown[] }[] };
        relationshipEvidence.relationshipActions[0].evidenceRefs = [{ type: 'relationship-event', id: 'a-b-commit' }];
        expect(parseInternalChapterPlan(relationshipEvidence).issues.map(value => value.code)).toContain('INVALID_RELATIONSHIP_ACTION');
        relationshipEvidence.relationshipActions[0].evidenceRefs = [{ type: 'relationship-event', id: 'a-b-confession' }];
        expect(parseInternalChapterPlan(relationshipEvidence).issues.map(value => value.code)).toContain('INVALID_RELATIONSHIP_ACTION');
        relationshipEvidence.relationshipActions[0].evidenceRefs = [{ type: 'story-event', id: 'locked-story-event' }];
        expect(parseInternalChapterPlan(relationshipEvidence).issues.map(value => value.code)).toContain('INVALID_RELATIONSHIP_ACTION');

        const confession = actionFor({
            actionType: 'confession', importance: 'major', relationshipEventId: 'a-b-confession',
            intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false },
        });
        expect(issuesFor(planFor(confession, ['a-b-confession']), stateFor(20))).toEqual([]);
        const early = { ...planFor(confession, ['a-b-confession']), chapterNumber: 19 };
        expect(issuesFor(early, stateFor(19)).map(value => value.code)).toContain('RELATIONSHIP_GATE_VIOLATION');
    });

    it('requires participant-specific epistemic causality for strengthening facts', () => {
        const action = actionFor({
            evidenceRefs: [{ type: 'fact', id: 'secret-protection' }],
            participantAgency: actionFor().participantAgency.map(value => value.characterId === 'a'
                ? { ...value, knowledgeBasisFactIds: ['secret-protection'] } : value),
        });
        expect(issuesFor(planFor(action), stateFor(20, 'awareness', { bKnows: false })).map(value => value.code)).toContain('RELATIONSHIP_KNOWLEDGE_VIOLATION');
        const grounded = { ...action, evidenceRefs: [
            { type: 'fact' as const, id: 'secret-protection' },
            { type: 'knowledge' as const, characterId: 'a', factId: 'secret-protection' },
            { type: 'knowledge' as const, characterId: 'b', factId: 'secret-protection' },
        ] };
        expect(issuesFor(planFor(grounded), stateFor(20, 'awareness', { bKnows: true }))).toEqual([]);
    });

    it('does not let Planner-authored trust fabricate jealousy attachment', () => {
        const jealousy = actionFor({
            actionType: 'jealousy', jealousCharacterId: 'b', currentRomanceMilestone: 'none', currentStateAssessment: assessment({ trust: 'high', dependency: 'high' }),
            intendedProgression: { direction: 'conflicted', romanticMilestone: 'none', expectedState: 'jealous-conflict', mutual: false, intermediate: false },
            participantAgency: actionFor().participantAgency.map(value => value.characterId === 'b' ? { ...value, knowledgeBasisFactIds: ['secret-protection'] } : value),
            evidenceRefs: [{ type: 'knowledge', characterId: 'b', factId: 'secret-protection' }],
        });
        expect(issuesFor(planFor(jealousy), stateFor(20, 'none', { bKnows: true })).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        expect(issuesFor(planFor({ ...jealousy, currentRomanceMilestone: 'interest', intendedProgression: { ...jealousy.intendedProgression, romanticMilestone: 'interest' } }), stateFor(20, 'interest', { bKnows: true }))).toEqual([]);
    });

    it('enforces pairwise romance while preserving valid multi-party non-romantic definitions', () => {
        const groupRomance = { ...blueprint(), relationshipDefinitions: [
            ...blueprint().relationshipDefinitions!,
            { ...blueprint().relationshipDefinitions![0], id: 'a-b-c-romance', participantIds: ['a', 'b', 'c'] },
        ] };
        expect(() => compileStoryControl(groupRomance)).toThrow(/exactly two participants/i);
        const groupProfessional = { ...blueprint(), relationshipDefinitions: [
            ...blueprint().relationshipDefinitions!,
            { ...blueprint().relationshipDefinitions![1], id: 'a-b-c-professional', participantIds: ['a', 'b', 'c'] },
        ] };
        expect(() => compileStoryControl(groupProfessional)).not.toThrow();
    });

    it('handles zero and undersized relationship-history windows fail-closed', () => {
        const freeFormHistory = Array.from({ length: 500 }, (_, index) => ({ id: `free-${index}`, state: index % 2 === 0 ? 'awareness' : 'interest', chapterNumber: index + 1 }));
        const freeFormState = stateFor(500, 'interest', { history: freeFormHistory });
        const zero = buildPlannerRelationshipContext(control, freeFormState, 500, { maxRelationships: 64, maxRecentHistoryPerRelationship: 0, maxParticipantBeliefs: 64 });
        expect(zero.relationships.find(value => value.id === 'a-b')?.recentHistory).toEqual([]);
        expect(zero.relationships.find(value => value.id === 'a-b')?.slowBurnHistoryComplete).toBe(false);
        const oneState = stateFor(500, 'free-form', { history: Array.from({ length: 500 }, (_, index) => ({ id: `state-${index}`, state: `state-${index}`, chapterNumber: index + 1 })) });
        const one = buildPlannerRelationshipContext(control, oneState, 500, { maxRelationships: 64, maxRecentHistoryPerRelationship: 1, maxParticipantBeliefs: 64 });
        expect(one.relationships.find(value => value.id === 'a-b')?.recentHistory).toHaveLength(1);
        const milestoneState = stateFor(20, 'attraction', { history: [
            { id: 'm1', state: 'awareness', chapterNumber: 1 },
            { id: 'm2', state: 'interest', chapterNumber: 2 },
            { id: 'm3', state: 'attraction', chapterNumber: 3 },
        ] });
        expect(() => buildPlannerRelationshipContext(control, milestoneState, 20, { maxRelationships: 64, maxRecentHistoryPerRelationship: 1, maxParticipantBeliefs: 64 })).toThrow(RelationshipHistoryCapacityError);
    });

    it('enforces active romantic boundaries and closed action/progression compatibility at both runtimes', () => {
        const boundary = [{ characterId: 'b', type: 'professional' as const, constraint: 'no-romance' as const, stance: 'maintain' as const, instruction: 'No romantic action.' }];
        const confession = actionFor({
            currentRomanceMilestone: 'interest', actionType: 'confession', boundaries: boundary,
            intendedProgression: { direction: 'stable', romanticMilestone: 'interest', mutual: false, intermediate: false },
        });
        expect(issuesFor(planFor(confession), stateFor(20, 'interest')).map(value => value.code)).toContain('RELATIONSHIP_BOUNDARY_VIOLATION');
        const rejection = actionFor({
            currentRomanceMilestone: 'interest', actionType: 'reject-romance', importance: 'major', boundaries: boundary,
            intendedProgression: { direction: 'weakening', romanticMilestone: 'interest', expectedState: 'rejected', mutual: false, intermediate: false },
        });
        expect(issuesFor(planFor(rejection), stateFor(20, 'interest'))).toEqual([]);
        const contradictoryReject = actionFor({ actionType: 'reject-romance', intendedProgression: { direction: 'strengthening', romanticMilestone: 'committed-romance', expectedState: 'committed-romance', mutual: true, intermediate: false } });
        expect(issuesFor(planFor(contradictoryReject)).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        const nonMutualAccept = actionFor({ actionType: 'accept-romance', intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false } });
        expect(issuesFor(planFor(nonMutualAccept)).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        const strengtheningRupture = actionFor({ actionType: 'rupture', intendedProgression: { direction: 'strengthening', romanticMilestone: 'interest', expectedState: 'interest', mutual: false, intermediate: false } });
        expect(issuesFor(planFor(strengtheningRupture)).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');

        const writerPlan = sanitizeWriterChapterPlan(planFor(actionFor()), control, stateFor());
        const directive = writerPlan.relationshipDirectives![0];
        expect(() => buildWriterContext(control, stateFor(), {
            ...writerPlan,
            relationshipDirectives: [{ ...directive, actionType: 'accept-romance', intendedProgression: { ...directive.intendedProgression, mutual: false } }],
        })).toThrow(WriterContextError);
        expect(() => buildWriterContext(control, stateFor(), {
            ...writerPlan,
            expectedRelationshipDeltas: [],
            relationshipDirectives: [{ ...directive, intendedProgression: { ...directive.intendedProgression, expectedState: undefined, intermediate: true } }],
        })).toThrow(WriterContextError);
    });

    it('enforces intrinsic major/outcome semantics and direction coherence at source validation', () => {
        const downgraded = [
            actionFor({ actionType: 'rupture', participantAgency: [], evidenceRefs: [], intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false } }),
            actionFor({ actionType: 'reconciliation', participantAgency: [], evidenceRefs: [], intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false } }),
            actionFor({ actionType: 'reject-romance', participantAgency: [], evidenceRefs: [], intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false } }),
            actionFor({ actionType: 'accept-romance', participantAgency: [], evidenceRefs: [], intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: true, intermediate: false } }),
        ];
        downgraded.forEach((action) => {
            const codes = issuesFor(planFor(action)).map(value => value.code);
            expect(codes).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
            if (action.actionType !== 'confession') expect(codes).toContain('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION');
        });
        expect(issuesFor(planFor(actionFor({ intendedProgression: { direction: 'stable', romanticMilestone: 'interest', expectedState: 'interest', mutual: false, intermediate: false } }))).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        expect(issuesFor(planFor(actionFor({ currentRomanceMilestone: 'interest', intendedProgression: { direction: 'strengthening', romanticMilestone: 'awareness', expectedState: 'awareness', mutual: false, intermediate: false } })), stateFor(20, 'interest')).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        expect(issuesFor(planFor(actionFor({ intendedProgression: { direction: 'weakening', romanticMilestone: 'interest', expectedState: 'interest', mutual: false, intermediate: false } }))).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        const intermediateOutcome = actionFor({
            actionType: 'rupture', importance: 'major',
            intendedProgression: { direction: 'weakening', romanticMilestone: 'awareness', expectedState: 'ruptured', mutual: false, intermediate: true },
        });
        expect(issuesFor(planFor(intermediateOutcome)).map(value => value.code)).toEqual(expect.arrayContaining([
            'RELATIONSHIP_PROGRESSION_VIOLATION', 'RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION',
        ]));

        const validOutcomes = [
            actionFor({ actionType: 'rupture', importance: 'major', intendedProgression: { direction: 'weakening', romanticMilestone: 'awareness', expectedState: 'ruptured', mutual: false, intermediate: false } }),
            actionFor({ actionType: 'reconciliation', importance: 'major', intendedProgression: { direction: 'strengthening', romanticMilestone: 'awareness', expectedState: 'reconciled', mutual: false, intermediate: false } }),
            actionFor({ actionType: 'reject-romance', importance: 'major', intendedProgression: { direction: 'weakening', romanticMilestone: 'awareness', expectedState: 'rejected', mutual: false, intermediate: false } }),
        ];
        validOutcomes.forEach(action => expect(issuesFor(planFor(action))).toEqual([]));
        const confession = actionFor({
            actionType: 'confession', importance: 'major', relationshipEventId: 'a-b-confession',
            intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false },
        });
        expect(issuesFor(planFor(confession, ['a-b-confession']))).toEqual([]);
        const acceptance = actionFor({
            actionType: 'accept-romance', importance: 'major', relationshipEventId: 'a-b-commit', currentRomanceMilestone: 'courtship',
            intendedProgression: { direction: 'strengthening', romanticMilestone: 'committed-romance', expectedState: 'committed-romance', mutual: true, intermediate: false },
            participantAgency: actionFor().participantAgency.map(value => ({ ...value, willingness: 'yes' as const })),
        });
        expect(issuesFor({ ...planFor(acceptance, ['a-b-commit']), chapterNumber: 100 }, stateFor(100, 'courtship'))).toEqual([]);
    });

    it('rejects downgraded outcome actions and incoherent directions in fabricated Writer plans', () => {
        const validOutcomes = [
            actionFor({ actionType: 'rupture', importance: 'major', intendedProgression: { direction: 'weakening', romanticMilestone: 'awareness', expectedState: 'ruptured', mutual: false, intermediate: false } }),
            actionFor({ actionType: 'reconciliation', importance: 'major', intendedProgression: { direction: 'strengthening', romanticMilestone: 'awareness', expectedState: 'reconciled', mutual: false, intermediate: false } }),
            actionFor({ actionType: 'reject-romance', importance: 'major', intendedProgression: { direction: 'weakening', romanticMilestone: 'awareness', expectedState: 'rejected', mutual: false, intermediate: false } }),
        ];
        validOutcomes.forEach((action) => {
            const writerPlan = sanitizeWriterChapterPlan(planFor(action), control, stateFor());
            const directive = writerPlan.relationshipDirectives![0];
            expect(() => buildWriterContext(control, stateFor(), { ...writerPlan, relationshipDirectives: [{ ...directive, importance: 'minor' }] })).toThrow(WriterContextError);
            expect(() => buildWriterContext(control, stateFor(), {
                ...writerPlan, relationshipDirectives: [{ ...directive, intendedProgression: { ...directive.intendedProgression, intermediate: true } }],
            })).toThrow(WriterContextError);
            expect(() => buildWriterContext(control, stateFor(), writerPlan)).not.toThrow();
        });
        const acceptance = actionFor({
            actionType: 'accept-romance', importance: 'major', relationshipEventId: 'a-b-commit', currentRomanceMilestone: 'courtship',
            intendedProgression: { direction: 'strengthening', romanticMilestone: 'committed-romance', expectedState: 'committed-romance', mutual: true, intermediate: false },
            participantAgency: actionFor().participantAgency.map(value => ({ ...value, willingness: 'yes' as const })),
        });
        const acceptedPlan = sanitizeWriterChapterPlan({ ...planFor(acceptance, ['a-b-commit']), chapterNumber: 100 }, control, stateFor(100, 'courtship'));
        expect(() => buildWriterContext(control, stateFor(100, 'courtship'), {
            ...acceptedPlan,
            relationshipDirectives: acceptedPlan.relationshipDirectives!.map(value => ({ ...value, importance: 'minor' as const })),
        })).toThrow(WriterContextError);
        expect(() => buildWriterContext(control, stateFor(100, 'courtship'), acceptedPlan)).not.toThrow();
        const writerPlan = sanitizeWriterChapterPlan(planFor(actionFor()), control, stateFor());
        const directive = writerPlan.relationshipDirectives![0];
        expect(() => buildWriterContext(control, stateFor(), {
            ...writerPlan, relationshipDirectives: [{ ...directive, intendedProgression: { ...directive.intendedProgression, direction: 'stable' } }],
        })).toThrow(WriterContextError);
        expect(() => buildWriterContext(control, stateFor(), {
            ...writerPlan, relationshipDirectives: [{ ...directive, intendedProgression: { ...directive.intendedProgression, direction: 'weakening' } }],
        })).toThrow(WriterContextError);
        const interestAction = actionFor({
            currentRomanceMilestone: 'interest',
            intendedProgression: { direction: 'strengthening', romanticMilestone: 'attraction', expectedState: 'attraction', mutual: false, intermediate: false },
        });
        const interestPlan = sanitizeWriterChapterPlan(planFor(interestAction), control, stateFor(20, 'interest'));
        const interestDirective = interestPlan.relationshipDirectives![0];
        expect(() => buildWriterContext(control, stateFor(20, 'interest'), {
            ...interestPlan,
            expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'awareness' }],
            relationshipDirectives: [{ ...interestDirective, intendedProgression: { direction: 'strengthening', romanticMilestone: 'awareness', expectedState: 'awareness', mutual: false, intermediate: false } }],
        })).toThrow(WriterContextError);
    });

    it('replays same-chapter boundaries and fails closed on same-scene ambiguity at source and Writer boundaries', () => {
        const boundary = { characterId: 'b', type: 'commitment' as const, constraint: 'no-romance' as const, stance: 'set' as const, instruction: 'No romance.' };
        const release = { ...boundary, stance: 'release' as const, instruction: 'B freely releases the boundary.' };
        const setAction = actionFor({
            id: 'set-boundary', sceneIds: ['scene-1'], actionType: 'boundary-setting', currentRomanceMilestone: 'interest',
            intendedProgression: { direction: 'stable', romanticMilestone: 'interest', mutual: false, intermediate: false }, boundaries: [boundary],
        });
        const releaseAction = actionFor({
            id: 'release-boundary', sceneIds: ['scene-2'], actionType: 'boundary-setting', currentRomanceMilestone: 'interest',
            intendedProgression: { direction: 'stable', romanticMilestone: 'interest', mutual: false, intermediate: false }, boundaries: [release],
            participantAgency: actionFor().participantAgency.map(value => value.characterId === 'b' ? { ...value, willingness: 'yes' as const } : value),
        });
        const confession = actionFor({
            id: 'confession', sceneIds: ['scene-3'], actionType: 'confession', importance: 'major', relationshipEventId: 'a-b-confession', currentRomanceMilestone: 'interest',
            intendedProgression: { direction: 'stable', romanticMilestone: 'interest', mutual: false, intermediate: false },
        });
        const sceneTemplate = planFor(setAction).scenes[0];
        const scenes = ['scene-1', 'scene-2', 'scene-3'].map((id, index) => ({ ...sceneTemplate, id, order: index + 1 }));
        const withoutRelease = { ...planWithActions([setAction, { ...confession, sceneIds: ['scene-2'] }]), scenes: scenes.slice(0, 2), relationshipEventIds: ['a-b-confession'] };
        expect(issuesFor(withoutRelease, stateFor(20, 'interest')).map(value => value.code)).toContain('RELATIONSHIP_BOUNDARY_VIOLATION');
        const coherentSameActionRelease = {
            ...withoutRelease,
            relationshipActions: [setAction, {
                ...confession, sceneIds: ['scene-2'], boundaries: [release],
                participantAgency: confession.participantAgency.map(value => value.characterId === 'b' ? { ...value, willingness: 'yes' as const } : value),
            }],
        };
        expect(issuesFor(coherentSameActionRelease, stateFor(20, 'interest'))).toEqual([]);

        const released = { ...planWithActions([setAction, releaseAction, confession]), scenes, relationshipEventIds: ['a-b-confession'] };
        expect(issuesFor(released, stateFor(20, 'interest'))).toEqual([]);
        const ambiguous = {
            ...released,
            scenes: scenes.slice(0, 2),
            relationshipActions: [setAction, releaseAction, { ...confession, sceneIds: ['scene-2'] }],
        };
        expect(issuesFor(ambiguous, stateFor(20, 'interest')).map(value => value.code)).toContain('RELATIONSHIP_BOUNDARY_VIOLATION');

        const writerPlan = sanitizeWriterChapterPlan(released, control, stateFor(20, 'interest'));
        const fabricated = {
            ...writerPlan,
            scenes: writerPlan.scenes.map(scene => scene.id === 'scene-3' ? { ...scene, purposeTags: ['plot' as const] } : scene),
            relationshipDirectives: writerPlan.relationshipDirectives!.map(directive => directive.id === 'confession' ? { ...directive, sceneIds: ['scene-2'] } : directive),
        };
        expect(() => buildWriterContext(control, stateFor(20, 'interest'), fabricated)).toThrow(WriterContextError);
    });

    it('rejects duplicate source relationshipEventIds before sanitization', () => {
        const confession = actionFor({
            actionType: 'confession', importance: 'major', relationshipEventId: 'a-b-confession',
            intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false },
        });
        const parsed = parseInternalChapterPlan(planFor(confession, ['a-b-confession', 'a-b-confession']));
        expect(parsed.plan).toBeUndefined();
        expect(parsed.issues.some(value => value.path === 'relationshipEventIds' && /duplicate/i.test(value.message))).toBe(true);
    });

    it('requires reverse action coverage for WORK 08 deltas and controlled events', () => {
        const orphanDelta = {
            ...planFor(actionFor()),
            scenes: [{ ...planFor(actionFor()).scenes[0], purposeTags: ['plot' as const] }],
            relationshipActions: [],
            expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'committed-romance' }],
        };
        expect(issuesFor(orphanDelta).map(value => value.code)).toContain('RELATIONSHIP_DELTA_RECONCILIATION_VIOLATION');

        const confession = actionFor({
            actionType: 'confession', importance: 'major', relationshipEventId: 'a-b-confession',
            intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false },
        });
        const orphanEvent = {
            ...planFor(confession, ['a-b-confession']),
            scenes: [{ ...planFor(confession).scenes[0], purposeTags: ['plot' as const] }],
            relationshipActions: [],
        };
        expect(issuesFor(orphanEvent).map(value => value.code)).toContain('RELATIONSHIP_GATE_VIOLATION');

        const duplicate = {
            ...structuredClone(planFor(actionFor())),
            expectedRelationshipDeltas: [
                ...planFor(actionFor()).expectedRelationshipDeltas,
                { relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'interest' },
            ],
        };
        expect(parseInternalChapterPlan(duplicate).issues.map(value => value.code)).toContain('INVALID_RELATIONSHIP_DELTA');
        expect(issuesFor(planFor(actionFor()))).toEqual([]);
    });

    it('preserves documented legacy delta compatibility outside WORK 08 definitions', () => {
        const source = blueprint();
        const legacyControl = compileStoryControl({
            ...source, relationshipDefinitions: [], relationshipEvents: [],
            gates: { ...source.gates, relationships: [] },
        });
        const legacyPlan = {
            ...planFor(actionFor()),
            scenes: [{ ...planFor(actionFor()).scenes[0], purposeTags: ['plot' as const] }],
            relationshipActions: [], relationshipEventIds: [],
            expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'legacy-state' }],
        };
        expect(validateInternalChapterPlan(legacyPlan, buildPlannerContext(legacyControl, stateFor(), 20))).toEqual([]);
    });

    it('rejects orphan deltas and controlled events in fabricated Writer plans', () => {
        const writerPlan = sanitizeWriterChapterPlan(planFor(actionFor()), control, stateFor());
        expect(() => buildWriterContext(control, stateFor(), { ...writerPlan, relationshipDirectives: [] })).toThrow(WriterContextError);

        const confession = actionFor({
            actionType: 'confession', importance: 'major', relationshipEventId: 'a-b-confession',
            intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false },
        });
        const confessionWriterPlan = sanitizeWriterChapterPlan(planFor(confession, ['a-b-confession']), control, stateFor());
        expect(() => buildWriterContext(control, stateFor(), { ...confessionWriterPlan, relationshipDirectives: [] })).toThrow(WriterContextError);
    });

    it('revalidates prohibited shortcuts, full participant choices, and power imbalance at Writer runtime', () => {
        const writerPlan = sanitizeWriterChapterPlan(planFor(actionFor()), control, stateFor());
        const directive = writerPlan.relationshipDirectives![0];
        const oneChoice = [{ ...directive.participantChoices[0] }];
        expect(() => buildWriterContext(control, stateFor(), {
            ...writerPlan, relationshipDirectives: [{ ...directive, participantChoices: oneChoice }],
        })).toThrow(WriterContextError);
        expect(() => buildWriterContext(control, stateFor(), {
            ...writerPlan,
            expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'cautious-respect' }],
            relationshipDirectives: [{
                ...directive, importance: 'major', participantChoices: oneChoice,
                intendedProgression: { direction: 'strengthening', romanticMilestone: 'awareness', expectedState: 'cautious-respect', mutual: false, intermediate: false },
            }],
        })).toThrow(WriterContextError);
        expect(() => buildWriterContext(control, stateFor(), {
            ...writerPlan,
            relationshipDirectives: [{ ...directive, importance: 'major', visiblePowerBalance: 'unequal', powerImbalanceAddressed: false }],
        })).toThrow(WriterContextError);

        const prohibitedBlueprint = blueprint();
        const prohibitedControl = compileStoryControl({
            ...prohibitedBlueprint,
            relationshipDefinitions: prohibitedBlueprint.relationshipDefinitions!.map(value => value.id === 'a-b'
                ? { ...value, dynamicProfile: { ...value.dynamicProfile, prohibitedShortcuts: ['deepen-trust'] } } : value),
        });
        expect(() => buildWriterContext(prohibitedControl, stateFor(), writerPlan)).toThrow(WriterContextError);
        expect(() => buildWriterContext(control, stateFor(), writerPlan)).not.toThrow();
    });

    it('enforces the compact canonical slow-burn guard at Writer runtime', () => {
        const baseWriterPlan = sanitizeWriterChapterPlan(planFor(actionFor()), control, stateFor());
        const directive = baseWriterPlan.relationshipDirectives![0];
        const atLimit = stateFor(20, 'attraction', { history: [
            { id: 'slow-17', state: 'awareness', chapterNumber: 17 },
            { id: 'slow-18', state: 'interest', chapterNumber: 18 },
            { id: 'slow-19', state: 'attraction', chapterNumber: 19 },
        ] });
        const nextPlan = {
            ...baseWriterPlan,
            expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'trust-building' }],
            relationshipDirectives: [{
                ...directive, currentRomanceMilestone: 'attraction' as const,
                intendedProgression: { direction: 'strengthening' as const, romanticMilestone: 'trust-building' as const, expectedState: 'trust-building', mutual: false, intermediate: false },
            }],
        };
        expect(() => buildWriterContext(control, atLimit, nextPlan)).toThrow(WriterContextError);

        const insideLimit = stateFor(20, 'interest', { history: [
            { id: 'slow-18', state: 'awareness', chapterNumber: 18 },
            { id: 'slow-19', state: 'interest', chapterNumber: 19 },
        ] });
        expect(() => buildWriterContext(control, insideLimit, {
            ...nextPlan,
            expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'attraction' }],
            relationshipDirectives: [{
                ...directive, currentRomanceMilestone: 'interest',
                intendedProgression: { direction: 'strengthening', romanticMilestone: 'attraction', expectedState: 'attraction', mutual: false, intermediate: false },
            }],
        })).not.toThrow();
    });

    it('does not let an unrelated belief substitute for exact fact knowledge', () => {
        const base = stateFor(20, 'awareness', { bKnows: false });
        const state = { ...base, ledgers: { ...base.ledgers, epistemic: [{
            id: 'market-belief', characterId: 'b', kind: 'believed' as const, claim: 'The market may collapse.', learnedChapter: 19,
            source: { type: 'inference' as const, sourceChapter: 19, basisFactIds: [] }, status: 'active' as const,
        }] } };
        const action = actionFor({ evidenceRefs: [
            { type: 'fact', id: 'secret-protection' },
            { type: 'knowledge', characterId: 'a', factId: 'secret-protection' },
            { type: 'belief', characterId: 'b', epistemicId: 'market-belief' },
        ] });
        expect(issuesFor(planFor(action), state).map(value => value.code)).toContain('RELATIONSHIP_KNOWLEDGE_VIOLATION');
        const exact = { ...action, evidenceRefs: [
            { type: 'fact' as const, id: 'secret-protection' },
            { type: 'knowledge' as const, characterId: 'a', factId: 'secret-protection' },
            { type: 'knowledge' as const, characterId: 'b', factId: 'secret-protection' },
        ] };
        expect(issuesFor(planFor(exact), stateFor(20, 'awareness', { bKnows: true }))).toEqual([]);
    });

    it('requires the jealousy subject to own the exact fact or belief trigger', () => {
        const onlyAKnows = actionFor({
            actionType: 'jealousy', jealousCharacterId: 'b', currentRomanceMilestone: 'interest',
            intendedProgression: { direction: 'conflicted', romanticMilestone: 'interest', expectedState: 'jealous-conflict', mutual: false, intermediate: false },
            evidenceRefs: [{ type: 'fact', id: 'secret-protection' }, { type: 'knowledge', characterId: 'a', factId: 'secret-protection' }],
        });
        const missingSubject = structuredClone(planFor(onlyAKnows)) as unknown as { relationshipActions: { jealousCharacterId?: string }[] };
        delete missingSubject.relationshipActions[0].jealousCharacterId;
        expect(parseInternalChapterPlan(missingSubject).issues.map(value => value.code)).toContain('INVALID_RELATIONSHIP_ACTION');
        expect(issuesFor(planFor(onlyAKnows), stateFor(20, 'interest')).map(value => value.code)).toContain('RELATIONSHIP_KNOWLEDGE_VIOLATION');
        const bKnows = { ...onlyAKnows, evidenceRefs: [{ type: 'fact' as const, id: 'secret-protection' }, { type: 'knowledge' as const, characterId: 'b', factId: 'secret-protection' }] };
        expect(issuesFor(planFor(bKnows), stateFor(20, 'interest', { bKnows: true }))).toEqual([]);

        const base = stateFor(20, 'interest');
        const beliefs = { ...base, ledgers: { ...base.ledgers, epistemic: [
            { id: 'a-belief', characterId: 'a', kind: 'believed' as const, claim: 'A rival may interfere.', learnedChapter: 19, source: { type: 'inference' as const, sourceChapter: 19, basisFactIds: [] }, status: 'active' as const },
            { id: 'b-belief', characterId: 'b', kind: 'believed' as const, claim: 'A rival may interfere.', learnedChapter: 19, source: { type: 'inference' as const, sourceChapter: 19, basisFactIds: [] }, status: 'active' as const },
        ] } };
        expect(issuesFor(planFor({ ...onlyAKnows, evidenceRefs: [{ type: 'belief', characterId: 'a', epistemicId: 'a-belief' }] }), beliefs).map(value => value.code)).toContain('RELATIONSHIP_KNOWLEDGE_VIOLATION');
        expect(issuesFor(planFor({ ...onlyAKnows, evidenceRefs: [{ type: 'belief', characterId: 'b', epistemicId: 'b-belief' }] }), beliefs)).toEqual([]);
        expect(sanitizeWriterChapterPlan(planFor({ ...onlyAKnows, evidenceRefs: [{ type: 'belief', characterId: 'b', epistemicId: 'b-belief' }] }), control, beliefs).relationshipDirectives?.[0].jealousCharacterId).toBe('b');
    });

    it('revalidates privileged Validator evidence adequacy instead of trusting supplied issues', async () => {
        const factAction = actionFor({ evidenceRefs: [
            { type: 'fact', id: 'secret-protection' },
            { type: 'knowledge', characterId: 'a', factId: 'secret-protection' },
            { type: 'knowledge', characterId: 'b', factId: 'secret-protection' },
        ] });
        const state = stateFor(20, 'awareness', { bKnows: true });
        const internal = planFor(factAction);
        const writerPlan = sanitizeWriterChapterPlan(internal, control, state);
        const view = buildValidatorRelationshipView(control, internal, buildPlannerContext(control, state, 20));
        const semanticModel = { validate: vi.fn(async () => ({ kind: 'semantic-validation-result' as const, chapterNumber: 20, issues: [] })) };
        const draft = { kind: 'writer-chapter-draft', chapterNumber: 20, prose: 'They acknowledge the choice.' };
        const noEvidence = { ...structuredClone(view), actions: view.actions.map(action => ({ ...action, evidenceRefs: [] })), deterministicIssues: [] };
        expect((await validateWriterChapter({ control, state, plan: writerPlan, draft, semanticModel, relationshipView: noEvidence })).report.issues.map(value => value.code)).toContain('INVALID_SOURCE_PLAN');
        expect(semanticModel).toMatchObject({ validate: expect.any(Function) });
        expect(semanticModel.validate).not.toHaveBeenCalled();

        const base = stateFor(20, 'awareness');
        const beliefState = { ...base, ledgers: { ...base.ledgers, epistemic: [{
            id: 'market-belief', characterId: 'b', kind: 'believed' as const, claim: 'The market may collapse.', learnedChapter: 19,
            source: { type: 'inference' as const, sourceChapter: 19, basisFactIds: [] }, status: 'active' as const,
        }] } };
        const unrelated = { ...structuredClone(view), actions: view.actions.map(action => ({ ...action, evidenceRefs: [
            { type: 'fact' as const, id: 'secret-protection' },
            { type: 'knowledge' as const, characterId: 'a', factId: 'secret-protection' },
            { type: 'belief' as const, characterId: 'b', epistemicId: 'market-belief' },
        ] })), deterministicIssues: [] };
        expect((await validateWriterChapter({ control, state: beliefState, plan: writerPlan, draft, semanticModel, relationshipView: unrelated })).report.issues.map(value => value.code)).toContain('INVALID_SOURCE_PLAN');
    });

    it('threads custom relationship history policy through Planner, Sanitizer, Validator, and repair', async () => {
        const source = blueprint();
        const longControl = compileStoryControl({
            ...source,
            relationshipDefinitions: source.relationshipDefinitions!.map(value => value.id === 'a-b'
                ? { ...value, progressionPolicy: { ...value.progressionPolicy, maxConsecutiveProgressionChapters: 10 } } : value),
        });
        const longState = stateFor(20, 'committed-romance', { history: [
            'awareness', 'interest', 'attraction', 'trust-building', 'mutual-tension', 'acknowledged-interest', 'courtship', 'committed-romance',
        ].map((state, index) => ({ id: `long-${index}`, state, chapterNumber: index + 1 })) });
        expect(() => buildPlannerContext(longControl, longState, 20)).toThrow(RelationshipHistoryCapacityError);
        const relationshipContextPolicy = {
            maxRelationships: 64, maxRecentHistoryPerRelationship: 8, maxParticipantBeliefs: 64,
        };
        const context = buildPlannerContext(longControl, longState, 20, undefined, undefined, relationshipContextPolicy);
        expect(context.relationshipContext.relationships.find(value => value.id === 'a-b')?.recentHistory).toHaveLength(8);
        const action = actionFor({
            currentRomanceMilestone: 'committed-romance',
            intendedProgression: { direction: 'stable', romanticMilestone: 'committed-romance', mutual: true, intermediate: false },
            participantAgency: actionFor().participantAgency.map(value => ({ ...value, willingness: 'yes' as const })),
        });
        const internal = planFor(action);
        expect(validateInternalChapterPlan(internal, context, buildRelationshipGateValidationView(longControl, 20))).toEqual([]);
        expect(() => sanitizeWriterChapterPlan(internal, longControl, longState)).toThrow(RelationshipHistoryCapacityError);
        const writerPlan = sanitizeWriterChapterPlan(internal, longControl, longState, relationshipContextPolicy);
        expect(() => buildWriterContext(longControl, longState, writerPlan)).not.toThrow();
        const relationshipView = buildValidatorRelationshipView(longControl, internal, context);
        const validatorContextSelectionPolicy = {
            ...DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY,
            relationshipContextPolicy,
        };
        const draft = { kind: 'writer-chapter-draft', chapterNumber: 20, prose: 'They preserve the commitment through a deliberate choice.' };
        const passingSemantic = { validate: vi.fn(async () => ({ kind: 'semantic-validation-result' as const, chapterNumber: 20, issues: [] })) };
        const accepted = await validateWriterChapter({
            control: longControl, state: longState, plan: writerPlan, draft,
            semanticModel: passingSemantic, relationshipView, validatorContextSelectionPolicy,
        });
        expect(accepted.report.blockingIssueCount).toBe(0);
        const defaultRejected = await validateWriterChapter({
            control: longControl, state: longState, plan: writerPlan, draft,
            semanticModel: passingSemantic, relationshipView,
        });
        expect(defaultRejected.report.issues.map(value => value.code)).toContain('INVALID_SOURCE_PLAN');

        let validationPass = 0;
        const repaired = await validateAndRepairWriterChapter({
            control: longControl, state: longState, plan: writerPlan, draft,
            semanticModel: { async validate() {
                validationPass += 1;
                return {
                    kind: 'semantic-validation-result' as const, chapterNumber: 20,
                    issues: validationPass === 1 ? [{ code: 'PLAN_DRIFT' as const, severity: 'error' as const, scope: 'chapter' as const }] : [],
                };
            } },
            repairModel: { async repair() { return { ...draft, prose: 'They deliberately preserve the supplied relationship choice.' }; } },
            relationshipView, validatorContextSelectionPolicy, maxRepairAttempts: 1,
        });
        expect(repaired.status).toBe('approved-not-canon');
        expect(validationPass).toBe(2);
    });

    it('preserves relationships selected only by custom maxRelationships through Sanitizer and Validator reconstruction', async () => {
        const source = blueprint();
        const relationshipDefinitions = [
            ...Array.from({ length: 64 }, (_, index) => ({ ...source.relationshipDefinitions![0], id: `pair-${String(index).padStart(2, '0')}` })),
            { ...source.relationshipDefinitions![0], id: 'zz-target' },
        ];
        const manyControl = compileStoryControl({
            ...source, relationshipDefinitions, relationshipEvents: [],
            gates: { ...source.gates, relationships: [] },
        });
        const baseState = stateFor();
        const manyState = { ...baseState, relationships: [], ledgers: { ...baseState.ledgers, relationships: [] } };
        const selectedOnlyByCustomPolicy = actionFor({
            relationshipId: 'zz-target', actionType: 'support', evidenceRefs: [],
            intendedProgression: { direction: 'stable', romanticMilestone: 'awareness', mutual: false, intermediate: false },
        });
        const internal = planFor(selectedOnlyByCustomPolicy);
        const relationshipContextPolicy = { maxRelationships: 65, maxRecentHistoryPerRelationship: 6, maxParticipantBeliefs: 64 };
        const context = buildPlannerContext(manyControl, manyState, 20, undefined, undefined, relationshipContextPolicy);
        expect(context.relationshipContext.relationships.some(value => value.id === 'zz-target')).toBe(true);
        expect(() => sanitizeWriterChapterPlan(internal, manyControl, manyState)).toThrow();
        const writerPlan = sanitizeWriterChapterPlan(internal, manyControl, manyState, relationshipContextPolicy);
        const relationshipView = buildValidatorRelationshipView(manyControl, internal, context);
        const semanticModel = { validate: vi.fn(async () => ({ kind: 'semantic-validation-result' as const, chapterNumber: 20, issues: [] })) };
        const result = await validateWriterChapter({
            control: manyControl, state: manyState, plan: writerPlan,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 20, prose: 'They offer support without changing the relationship state.' },
            semanticModel, relationshipView,
            validatorContextSelectionPolicy: { ...DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY, relationshipContextPolicy },
        });
        expect(result.report.blockingIssueCount).toBe(0);
        expect(semanticModel.validate).toHaveBeenCalledOnce();
    });
});
