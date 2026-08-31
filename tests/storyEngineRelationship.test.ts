import { describe, expect, it, vi } from 'vitest';
import {
    buildPlannerContext,
    buildValidatorRelationshipView,
    buildWriterContext,
    compileStoryControl,
    createInitialStoryState,
    InternalChapterPlan,
    parseInternalChapterPlan,
    RelationshipActionPlan,
    sanitizeWriterChapterPlan,
    StoryBlueprint,
    validateInternalChapterPlan,
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
    intendedProgression: { direction: 'strengthening', romanticMilestone: 'interest', expectedState: 'earned-interest', mutual: false, intermediate: false },
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
    validateRelationshipActions(plan, buildPlannerContext(control, state, plan.chapterNumber));

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
        const factAction = actionFor({ evidenceRefs: [{ type: 'fact', id: 'secret-protection' }] });
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
        const jealousy = actionFor({ actionType: 'jealousy', currentRomanceMilestone: 'none', currentStateAssessment: assessment({ trust: 'low', dependency: 'low' }), intendedProgression: { direction: 'conflicted', romanticMilestone: 'none', expectedState: 'jealous-conflict', mutual: false, intermediate: false }, participantAgency: actionFor().participantAgency.map(value => ({ ...value, knowledgeBasisFactIds: [] })) });
        expect(issuesFor(planFor(jealousy), stateFor(20, 'none')).map(value => value.code)).toContain('RELATIONSHIP_PROGRESSION_VIOLATION');
        const grounded = { ...jealousy, currentRomanceMilestone: 'interest' as const, currentStateAssessment: assessment({ trust: 'moderate' }), participantAgency: jealousy.participantAgency.map(value => value.characterId === 'b' ? { ...value, knowledgeBasisFactIds: ['secret-protection'] } : value), evidenceRefs: [{ type: 'knowledge' as const, characterId: 'b', factId: 'secret-protection' }] };
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
            actionType: 'jealousy', currentRomanceMilestone: 'interest',
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
        expect(validateInternalChapterPlan(plan, context)).toEqual(validateInternalChapterPlan(plan, context));
        expect(JSON.stringify(plan)).toBe(beforePlan);
        expect(JSON.stringify(context)).toBe(beforeContext);
    });
});
