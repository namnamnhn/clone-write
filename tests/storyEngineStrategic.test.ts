import { describe, expect, it, vi } from 'vitest';
import {
    assessStrategicActions,
    buildPlannerContext,
    buildValidatorStrategicView,
    buildWriterContext,
    compileStoryControl,
    createInitialStoryState,
    InternalChapterPlan,
    MILITARY_READINESS_DIMENSIONS,
    parseInternalChapterPlan,
    PoliticalActionPlan,
    POLITICAL_DIMENSIONS,
    sanitizeWriterChapterPlan,
    StrategicActionPlan,
    StoryBlueprint,
    validateAndRepairWriterChapter,
    validateInternalChapterPlan,
    validateStrategicActions,
} from '../src/storyEngine';

const RAW_SECRET = 'RAW_AUTHOR_SECRET_ABC';

const blueprint = (): StoryBlueprint => ({
    id: 'strategic-story', engine: { plannedChapterCount: 600 },
    characters: [
        { id: 'a', name: 'A', availableFromChapter: 1, writerProfile: { role: 'Minister' } },
        { id: 'b', name: 'B', availableFromChapter: 1, writerProfile: { role: 'Merchant' } },
        { id: 'future', name: 'Future', availableFromChapter: 200, writerProfile: { role: 'General' } },
    ],
    arcs: [{ id: 'arc', title: 'Strategic Arc', startChapter: 1, endChapter: 600 }],
    beats: [{ id: 'beat', arcId: 'arc', order: 1, startChapter: 1, endChapter: 600 }],
    gates: {
        characters: [
            { id: 'a-character', characterId: 'a', allowedFromChapter: 1 },
            { id: 'b-character', characterId: 'b', allowedFromChapter: 1 },
            { id: 'future-character', characterId: 'future', allowedFromChapter: 200 },
        ],
        pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }],
        reveals: [], relationships: [], events: [],
    },
    authorOnlySecrets: [{ id: 'protected', value: RAW_SECRET }],
    canonRules: [
        { id: 'current-law', text: 'The council charter is active.', availableFromChapter: 1, scope: 'canon' },
        { id: 'expired-law', text: 'The regency decree expired.', availableFromChapter: 1, expiresAfterChapter: 99, scope: 'canon' },
        { id: 'future-law', text: 'The emergency charter starts later.', availableFromChapter: 200, scope: 'canon' },
    ],
});

const control = compileStoryControl(blueprint());

const stateFor = (chapter = 100) => ({
    ...createInitialStoryState(chapter),
    knownCharacterIds: ['a', 'b'], activeCharacterIds: ['a', 'b'],
    characterLocations: { a: 'Capital', b: 'Frontier' },
    characterStatuses: {
        a: { status: 'Minister', injuries: [], conditions: [] },
        b: { status: 'Merchant', injuries: [], conditions: [] },
    },
    facts: [
        { id: 'actor-fact', text: 'A knows the council schedule.', establishedChapter: 10, visibility: 'writer' as const },
        { id: 'opponent-fact', text: 'B knows the northern supplier.', establishedChapter: 10, visibility: 'internal' as const },
        { id: 'authority-fact', text: 'A was appointed minister.', establishedChapter: 5, visibility: 'writer' as const },
        { id: 'market-fact', text: 'The market accepts grain contracts.', establishedChapter: 8, visibility: 'writer' as const },
        { id: 'future-fact', text: 'A future disposition.', establishedChapter: 200, visibility: 'internal' as const },
    ],
    characterKnowledge: [
        { characterId: 'a', factIds: ['actor-fact', 'authority-fact', 'market-fact', 'future-fact'] },
        { characterId: 'b', factIds: ['opponent-fact', 'market-fact'] },
    ],
    relationships: [{ id: 'a-b', participantIds: ['a', 'b'], state: 'rivals', establishedChapter: 1 }],
    resources: {
        a: [
            { id: 'cash', name: 'Cash', quantity: 100 },
            { id: 'inventory', name: 'Grain', quantity: 20 },
            { id: 'debt', name: 'Debt', quantity: 0 },
            { id: 'supply', name: 'Supply', quantity: 100 },
            { id: 'manpower', name: 'Manpower', quantity: 500 },
            { id: 'mobility', name: 'Wagons', quantity: 10 },
        ],
        b: [{ id: 'cash', name: 'Cash', quantity: 500 }],
    },
});

const counter = {
    opponentCharacterId: 'b', opponentKnowledgeFactIds: ['opponent-fact'], opponentBeliefClaims: [],
    action: 'Delay the move through supplier pressure.', uncertainty: 'B may misread the timing.',
    costOrTradeoff: 'B risks exposing the supplier network.',
} as const;

const basePlan = (domain: 'politics' | 'military' | 'commerce', action?: StrategicActionPlan): InternalChapterPlan => ({
    kind: 'internal-chapter-plan', chapterNumber: 100, arcId: 'arc', beatId: 'beat',
    primaryGoal: 'Advance a strategic contest.', povCharacterId: 'a', participantIds: ['a', 'b'],
    scenes: [{
        id: `${domain}-scene`, order: 1, goal: 'Force a costly strategic choice.', location: domain === 'military' ? 'Frontier' : 'Capital',
        povCharacterId: 'a', participantIds: ['a', 'b'], conflictOrObstacle: 'B resists the move.',
        uncertainty: 'The response is uncertain.', expectedConsequence: 'Resources and leverage change.',
        purposeTags: [domain], conflictImportance: 'minor',
    }],
    activeConstraintIds: ['current-law'], allowedRevealIds: [], plannedRevealIds: [], relationshipEventIds: [], storyEventIds: [],
    cluesPlantedIds: [], cluesPaidOffIds: [], expectedResourceDeltas: [], expectedRelationshipDeltas: [],
    expectedContinuityConsequences: [], strategicActions: action ? [action] : [], endStateIntent: 'Stop before canon is updated.',
});

const politicalDimensions = () => POLITICAL_DIMENSIONS.map((dimension) => {
    if (dimension === 'authority') return { dimension, status: 'supporting' as const, evidenceRefs: [{ type: 'character-status' as const, characterId: 'a', value: 'Minister' }] };
    if (dimension === 'information') return { dimension, status: 'supporting' as const, evidenceRefs: [{ type: 'knowledge' as const, characterId: 'a', factId: 'actor-fact' }] };
    if (dimension === 'money') return { dimension, status: 'supporting' as const, evidenceRefs: [{ type: 'resource' as const, characterId: 'a', resourceId: 'cash' }] };
    if (dimension === 'law') return { dimension, status: 'supporting' as const, evidenceRefs: [{ type: 'canon-rule' as const, id: 'current-law' }] };
    return { dimension, status: dimension === 'time' ? 'neutral' as const : 'unknown' as const, evidenceRefs: [] };
});

const politicalAction = (): PoliticalActionPlan => ({
    id: 'political-action', domain: 'politics', sceneIds: ['politics-scene'], importance: 'minor', actorCharacterId: 'a',
    objective: 'Secure a lawful council decision.', uncertainty: 'The council may delay.', expectedCostOrTradeoff: 'A spends political capital.',
    writerVisibleConstraints: ['The council procedure must remain visible.'], actorKnowledgeFactIds: ['actor-fact'],
    relationshipEffects: [], noCountermoveReason: 'No organized countermove occurs in this minor setup.',
    dimensions: politicalDimensions(), timing: { earliestChapter: 90, deadlineChapter: 110, preparationChapters: 2 }, resourceEffects: [],
});

const asMajor = (plan: InternalChapterPlan, action: StrategicActionPlan): InternalChapterPlan => ({
    ...plan,
    scenes: plan.scenes.map(scene => ({
        ...scene, conflictImportance: 'major' as const,
        intelligentConflict: {
            opponentCharacterId: 'b', protagonistObjective: action.objective, opponentObjective: 'Prevent the move.',
            opponentKnowledge: ['opponent-fact'], opponentBeliefs: [], rationalCountermove: counter.action,
            uncertainty: counter.uncertainty, expectedCostOrTradeoff: counter.costOrTradeoff,
        },
    })),
    strategicActions: [{ ...action, importance: 'major' as const, countermove: counter, noCountermoveReason: undefined }],
});

const militaryAction = (): Extract<StrategicActionPlan, { domain: 'military' }> => ({
    id: 'military-action', domain: 'military', sceneIds: ['military-scene'], importance: 'major', actorCharacterId: 'a',
    objective: 'Take the frontier fort.', uncertainty: 'The defense may hold.', expectedCostOrTradeoff: 'The operation consumes supply and time.',
    writerVisibleConstraints: ['The army must arrive before fighting.'], actorKnowledgeFactIds: ['actor-fact'], relationshipEffects: [],
    countermove: counter, operationType: 'assault', location: 'Frontier', intelligenceFactIds: ['actor-fact'],
    readiness: MILITARY_READINESS_DIMENSIONS.map(dimension => ({ dimension, status: 'unknown', evidenceRefs: [] })),
    resourceEffects: [{ characterId: 'a', resourceId: 'supply', quantityDelta: -20 }],
    logistics: {
        supplyResource: { characterId: 'a', resourceId: 'supply' }, expectedSupplyConsumption: 20,
        mobilityResource: { characterId: 'a', resourceId: 'mobility' }, movementConstraint: 'Wagons use the pass.',
        operationalTimeChapters: 2, resupplyOrFallback: 'Withdraw to the depot if supply fails.',
    },
    movement: { fromLocation: 'Capital', toLocation: 'Frontier', method: 'march', transitChapters: 2 },
    expectedLossOrCost: 'The assault risks casualties.', retreatOrFailurePlan: 'Withdraw to the depot.',
});

const militaryPlan = (action = militaryAction()): InternalChapterPlan => ({
    ...asMajor(basePlan('military', action), action),
    expectedResourceDeltas: action.resourceEffects.map(effect => ({ ...effect })),
});

const purchaseAction = (): Extract<StrategicActionPlan, { domain: 'commerce' }> => ({
    id: 'commerce-action', domain: 'commerce', sceneIds: ['commerce-scene'], importance: 'minor', actorCharacterId: 'a',
    objective: 'Purchase grain.', uncertainty: 'Delivery may be late.', expectedCostOrTradeoff: 'A spends cash.',
    writerVisibleConstraints: ['Show payment and delivery.'], actorKnowledgeFactIds: ['market-fact'], relationshipEffects: [],
    noCountermoveReason: 'This small spot purchase does not trigger organized competition.', actionType: 'purchase',
    resourceFlows: [
        { characterId: 'a', resourceId: 'inventory', quantityDelta: 10, role: 'inventory' },
        { characterId: 'a', resourceId: 'cash', quantityDelta: -100, role: 'cash' },
    ],
    counterpartyCharacterId: 'b', sourceEvidenceRefs: [{ type: 'character-status', characterId: 'b', value: 'Merchant' }],
    logistics: 'B delivers grain by cart.', timing: { settlementChapters: 1, deadlineChapter: 101 }, risk: 'The carts may be delayed.',
});

const commercePlan = (action = purchaseAction()): InternalChapterPlan => ({
    ...basePlan('commerce', action),
    expectedResourceDeltas: action.resourceFlows.map(flow => ({ characterId: flow.characterId, resourceId: flow.resourceId, quantityDelta: flow.quantityDelta })),
});

const codesFor = (plan: InternalChapterPlan, state = stateFor()) => validateInternalChapterPlan(
    plan, buildPlannerContext(control, state, plan.chapterNumber),
).map(issue => issue.code);

describe('WORK 07 political engine', () => {
    it('accepts canonical actor knowledge and rejects protagonist-only knowledge assigned to another actor', () => {
        const valid = basePlan('politics', politicalAction());
        expect(codesFor(valid)).toEqual([]);
        const action = politicalAction();
        const dimensions = action.dimensions.map(value => value.dimension === 'information'
            ? { ...value, evidenceRefs: [{ type: 'knowledge' as const, characterId: 'b', factId: 'actor-fact' }] }
            : value);
        expect(codesFor(basePlan('politics', { ...action, actorCharacterId: 'b', actorKnowledgeFactIds: ['actor-fact'], dimensions }))).toContain('POLITICAL_INFORMATION_VIOLATION');
    });

    it('enforces authority evidence and target-safe current law', () => {
        const action = politicalAction();
        const noAuthority = action.dimensions.map(value => value.dimension === 'authority' ? { ...value, evidenceRefs: [] } : value);
        expect(codesFor(basePlan('politics', { ...action, dimensions: noAuthority }))).toContain('POLITICAL_AUTHORITY_VIOLATION');
        for (const id of ['future-law', 'expired-law', 'unknown-law']) {
            const law = action.dimensions.map(value => value.dimension === 'law'
                ? { ...value, evidenceRefs: [{ type: 'canon-rule' as const, id }] } : value);
            expect(codesFor(basePlan('politics', { ...action, dimensions: law }))).toContain('STRATEGIC_REFERENCE_INVALID');
        }
        expect(codesFor(basePlan('politics', action))).toEqual([]);
    });

    it('requires all seven dimensions, valid time windows, and rational major counterplay', () => {
        const action = politicalAction();
        expect(codesFor(basePlan('politics', { ...action, dimensions: action.dimensions.slice(1) }))).toContain('POLITICAL_DIMENSION_VIOLATION');
        expect(codesFor(basePlan('politics', { ...action, timing: { earliestChapter: 120, deadlineChapter: 110, preparationChapters: 1 } }))).toContain('POLITICAL_TIMING_VIOLATION');
        const majorMissing = { ...action, importance: 'major' as const };
        expect(codesFor({ ...basePlan('politics', majorMissing), scenes: [{ ...basePlan('politics').scenes[0], conflictImportance: 'major' }] })).toContain('POLITICAL_COUNTERMOVE_MISSING');
        expect(codesFor(asMajor(basePlan('politics', action), action))).toEqual([]);
        const stolen = asMajor(basePlan('politics', action), action);
        const badCounter = { ...counter, opponentKnowledgeFactIds: ['actor-fact'] };
        expect(codesFor({ ...stolen, strategicActions: [{ ...stolen.strategicActions![0], countermove: badCounter }] })).toContain('OPPONENT_KNOWLEDGE_VIOLATION');
    });
});

describe('WORK 07 military logistics engine', () => {
    it('rejects missing logistics/fallback and accepts a structured major assault', () => {
        const valid = militaryPlan();
        expect(codesFor(valid)).toEqual([]);
        const action = militaryAction();
        const missing = { ...action, logistics: undefined, retreatOrFailurePlan: '' };
        expect(codesFor({ ...militaryPlan(missing), strategicActions: [missing] })).toContain('MILITARY_LOGISTICS_VIOLATION');
    });

    it('prevents finite supply overdraw while allowing exact exhaustion', () => {
        const operation = (quantity: number) => {
            const action = militaryAction();
            return militaryPlan({
                ...action,
                resourceEffects: [{ characterId: 'a', resourceId: 'supply', quantityDelta: -quantity }],
                logistics: { ...action.logistics!, expectedSupplyConsumption: quantity },
            });
        };
        expect(codesFor(operation(150))).toContain('STRATEGIC_RESOURCE_CAPACITY_VIOLATION');
        expect(codesFor(operation(100))).toEqual([]);
    });

    it('rejects teleportation, omniscient intelligence, and consequence-free major war', () => {
        const action = militaryAction();
        expect(codesFor(militaryPlan({ ...action, movement: undefined }))).toContain('MILITARY_LOCATION_VIOLATION');
        expect(codesFor(militaryPlan({ ...action, intelligenceFactIds: ['opponent-fact'] }))).toContain('MILITARY_INTELLIGENCE_VIOLATION');
        const free = {
            ...action, expectedCostOrTradeoff: 'none', expectedLossOrCost: 'none', resourceEffects: [],
            logistics: { ...action.logistics!, expectedSupplyConsumption: 'unknown' as const, operationalTimeChapters: 'unknown' as const },
        };
        expect(codesFor({ ...militaryPlan(free), expectedResourceDeltas: [] })).toContain('MILITARY_COST_MISSING');
    });
});

describe('WORK 07 commerce engine', () => {
    it('requires purchase financing and reconciles valid cash/inventory flow', () => {
        expect(codesFor(commercePlan())).toEqual([]);
        const action = purchaseAction();
        const free = { ...action, resourceFlows: [action.resourceFlows[0], { ...action.resourceFlows[1], quantityDelta: 0 }] };
        expect(codesFor(commercePlan(free))).toContain('COMMERCE_FINANCING_VIOLATION');
    });

    it('requires a loan liability and sale inventory/service plus a source', () => {
        const purchase = purchaseAction();
        const loan = {
            ...purchase, actionType: 'loan' as const, objective: 'Borrow operating cash.',
            resourceFlows: [
                { characterId: 'a', resourceId: 'cash', quantityDelta: 100, role: 'cash' as const },
                { characterId: 'a', resourceId: 'debt', quantityDelta: 100, role: 'debt' as const },
            ],
        };
        expect(codesFor(commercePlan(loan))).toEqual([]);
        expect(codesFor(commercePlan({ ...loan, resourceFlows: [loan.resourceFlows[0], { ...loan.resourceFlows[1], quantityDelta: 0 }] }))).toContain('COMMERCE_FINANCING_VIOLATION');

        const sale = {
            ...purchase, actionType: 'sale' as const, objective: 'Sell grain.',
            resourceFlows: [
                { characterId: 'a', resourceId: 'cash', quantityDelta: 100, role: 'cash' as const },
                { characterId: 'a', resourceId: 'inventory', quantityDelta: -10, role: 'inventory' as const },
            ],
        };
        expect(codesFor(commercePlan(sale))).toEqual([]);
        const invalidSale = { ...sale, counterpartyCharacterId: undefined, marketSource: undefined, sourceEvidenceRefs: [], resourceFlows: [sale.resourceFlows[0]] };
        const invalidCodes = codesFor(commercePlan(invalidSale));
        expect(invalidCodes).toContain('COMMERCE_COUNTERPARTY_VIOLATION');
        expect(invalidCodes).toContain('COMMERCE_FLOW_VIOLATION');
    });

    it('requires funded price-war counterplay and permits a coherent major plan', () => {
        const base = purchaseAction();
        const priceWar = {
            ...base, actionType: 'price-war' as const, importance: 'major' as const, objective: 'Defend market share.',
            expectedCostOrTradeoff: 'A burns cash to hold customers.', resourceFlows: [{ characterId: 'a', resourceId: 'cash', quantityDelta: -50, role: 'cash' as const }],
            competitorCharacterId: 'b', fundingResource: { characterId: 'a', resourceId: 'cash' }, countermove: counter, noCountermoveReason: undefined,
        };
        const plan = asMajor(commercePlan(priceWar), priceWar);
        expect(codesFor(plan)).toEqual([]);
        const invalid = { ...priceWar, competitorCharacterId: undefined, fundingResource: undefined, countermove: undefined, expectedCostOrTradeoff: 'none' };
        expect(codesFor({ ...commercePlan(invalid), scenes: plan.scenes })).toContain('COMMERCE_FINANCING_VIOLATION');
    });
});

describe('WORK 07 shared contracts and boundaries', () => {
    it('normalizes legacy plans to no actions and requires exact domain scene coverage', () => {
        const legacy = { ...basePlan('politics') } as Record<string, unknown>;
        delete legacy.strategicActions;
        legacy.scenes = [{ ...(legacy.scenes as InternalChapterPlan['scenes'])[0], purposeTags: ['plot'] }];
        const parsed = parseInternalChapterPlan(legacy);
        expect(parsed.issues).toEqual([]);
        expect(parsed.plan?.strategicActions).toEqual([]);
        expect(codesFor(basePlan('politics'))).toContain('STRATEGIC_SCENE_COVERAGE_VIOLATION');
        const action = politicalAction();
        expect(codesFor(basePlan('politics', { ...action, sceneIds: ['unknown-scene'] }))).toContain('STRATEGIC_SCENE_COVERAGE_VIOLATION');
        const writerPlan = sanitizeWriterChapterPlan(basePlan('politics', action), control, stateFor());
        expect(() => buildWriterContext(control, stateFor(), { ...writerPlan, strategicDirectives: [] })).toThrow('lacks a matching strategic directive');
    });

    it('rejects mismatched strategic and plan resource/relationship consequences', () => {
        const plan = commercePlan();
        const mismatched = { ...plan, expectedResourceDeltas: plan.expectedResourceDeltas.map(delta => delta.resourceId === 'cash' ? { ...delta, quantityDelta: -10 } : delta) };
        expect(codesFor(mismatched)).toContain('STRATEGIC_RESOURCE_RECONCILIATION_VIOLATION');
        const action = { ...politicalAction(), relationshipEffects: [{ relationshipId: 'a-b', expectedState: 'allies' }] };
        expect(codesFor(basePlan('politics', action))).toContain('STRATEGIC_RELATIONSHIP_RECONCILIATION_VIOLATION');
        expect(codesFor({ ...basePlan('politics', action), expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'allies' }] })).toEqual([]);
    });

    it('strictly rejects malformed runtime strategic output and non-finite values', () => {
        const action = politicalAction();
        const malformed: unknown[] = [
            { ...action, arbitraryNestedField: {} },
            { ...action, resourceEffects: [{ characterId: 'a', resourceId: 'cash', quantityDelta: Number.POSITIVE_INFINITY }] },
            { ...action, dimensions: action.dimensions.slice(1) },
            { ...action, dimensions: action.dimensions.map(value => value.dimension === 'law' ? { ...value, evidenceRefs: [{ type: 'fake', id: 'x' }] } : value) },
            { ...action, dimensions: action.dimensions.map(value => value.dimension === 'law' ? { ...value, evidenceRefs: [value.evidenceRefs[0], value.evidenceRefs[0]] } : value) },
        ];
        malformed.forEach((entry) => {
            const result = parseInternalChapterPlan({ ...basePlan('politics', action), strategicActions: [entry] });
            expect(result.plan).toBeUndefined();
            expect(result.issues.map(issue => issue.code)).toContain('INVALID_STRATEGIC_ACTION');
        });
        const duplicate = parseInternalChapterPlan({ ...basePlan('politics', action), strategicActions: [action, action] });
        expect(duplicate.plan).toBeUndefined();
        const military = militaryPlan();
        const commerce = commercePlan();
        expect(parseInternalChapterPlan(military).plan?.strategicActions?.[0]?.domain).toBe('military');
        expect(parseInternalChapterPlan(commerce).plan?.strategicActions?.[0]?.domain).toBe('commerce');
        const invalidMilitary = parseInternalChapterPlan({
            ...military, strategicActions: [{ ...military.strategicActions![0], operationType: 'teleport-and-win' }],
        });
        const invalidCommerce = parseInternalChapterPlan({
            ...commerce, strategicActions: [{ ...commerce.strategicActions![0], resourceFlows: [{ characterId: 'a', resourceId: 'cash', quantityDelta: 1, role: 'magic-money' }] }],
        });
        expect(invalidMilitary.plan).toBeUndefined();
        expect(invalidCommerce.plan).toBeUndefined();
    });

    it('keeps raw secrets out of Writer directives and does not echo them in errors', () => {
        const action = { ...politicalAction(), objective: RAW_SECRET };
        const plan = basePlan('politics', action);
        let message = '';
        try { sanitizeWriterChapterPlan(plan, control, stateFor()); } catch (error) { message = (error as Error).message; }
        expect(message).toBeTruthy();
        expect(message).not.toContain(RAW_SECRET);
    });

    it('gives Validator bounded evidence while Repair remains Writer-like', async () => {
        const internal = asMajor(basePlan('politics', politicalAction()), politicalAction());
        const plannerContext = buildPlannerContext(control, stateFor(), 100);
        const writerPlan = sanitizeWriterChapterPlan(internal, control, stateFor());
        const strategicView = buildValidatorStrategicView(internal, plannerContext);
        let validatorPayload = '';
        let repairPayload = '';
        const semantic = vi.fn(async (request: { readonly chapterNumber: number }) => {
            validatorPayload = JSON.stringify(request);
            return { kind: 'semantic-validation-result', chapterNumber: request.chapterNumber, issues: [{ code: 'OPPONENT_IRRATIONALITY', severity: 'error', scope: 'chapter' }] };
        });
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(), plan: writerPlan, strategicView,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A opens the council session.' },
            semanticModel: { validate: semantic }, maxRepairAttempts: 1,
            repairModel: { async repair(request) { repairPayload = JSON.stringify(request); return { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A opens the council session after visible resistance.' }; } },
        });
        expect(result.status).toBe('rejected');
        expect(validatorPayload).toContain('opponent-fact');
        expect(repairPayload).not.toContain('opponent-fact');
        expect(repairPayload).not.toContain('evidenceRefs');
        expect(repairPayload).not.toContain('validator-strategic-view');
        expect(buildWriterContext(control, stateFor(), writerPlan).chapterPlan.strategicDirectives).toHaveLength(1);
    });

    it('is deterministic, pure, target-safe, and bounded in a synthetic long run', () => {
        const action = { ...politicalAction(), timing: { earliestChapter: 390, deadlineChapter: 410, preparationChapters: 2 } };
        const plan = { ...basePlan('politics', action), chapterNumber: 400, activeConstraintIds: ['current-law', 'future-law'] };
        const longState = {
            ...stateFor(400),
            facts: [
                ...stateFor(400).facts,
                ...Array.from({ length: 500 }, (_, index) => ({ id: `historical-${index}`, text: `History ${index}`, establishedChapter: index + 1, visibility: 'internal' as const })),
            ],
            resources: {
                ...stateFor(400).resources,
                a: [...stateFor(400).resources.a, ...Array.from({ length: 500 }, (_, index) => ({ id: `resource-${index}`, name: `Resource ${index}`, quantity: index }))],
            },
        };
        const context = buildPlannerContext(control, longState, 400);
        const before = [control, longState, plan, context].map(value => JSON.stringify(value));
        const frozenBefore = [control, longState, plan, context].map(value => Object.isFrozen(value));
        const first = assessStrategicActions(plan, context);
        const second = assessStrategicActions(plan, context);
        const view = buildValidatorStrategicView(plan, context, 32);
        expect(first).toEqual(second);
        expect(view.actions).toHaveLength(1);
        expect(JSON.stringify(view)).not.toContain('historical-499');
        expect(JSON.stringify(view)).not.toContain('resource-499');
        expect([control, longState, plan, context].map(value => JSON.stringify(value))).toEqual(before);
        expect([control, longState, plan, context].map(value => Object.isFrozen(value))).toEqual(frozenBefore);

        const target100Context = buildPlannerContext(control, stateFor(100), 100);
        const futureAction = { ...politicalAction(), actorKnowledgeFactIds: ['future-fact'] };
        expect(validateStrategicActions(basePlan('politics', futureAction), target100Context).map(issue => issue.code)).toContain('POLITICAL_INFORMATION_VIOLATION');
    });
});
