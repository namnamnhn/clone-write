import { describe, expect, it, vi } from 'vitest';
import {
    assessStrategicActions,
    buildPlannerContext,
    buildValidatorStrategicView,
    buildWriterContext,
    compileStoryControl,
    createInitialStoryState,
    generateWriterDraft,
    InternalChapterPlan,
    MILITARY_READINESS_DIMENSIONS,
    parseInternalChapterPlan,
    PoliticalActionPlan,
    POLITICAL_DIMENSIONS,
    sanitizeWriterChapterPlan,
    StrategicActionPlan,
    StoryBlueprint,
    validateAndRepairWriterChapter,
    validateWriterChapter,
    validateInternalChapterPlan,
    validateStrategicActions,
    WriterChapterPlan,
    WriterStrategicDirective,
    isMeaningfulText,
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
    action: 'Lock the northern supplier network.', uncertainty: 'B may misread demand.',
    costOrTradeoff: 'B exposes his supplier relationships.',
} as const;

const safeCounterplay = {
    opponentCharacterId: 'b', action: 'Lock the northern supplier network.',
    uncertainty: 'B may misread demand.', costOrTradeoff: 'B exposes his supplier relationships.',
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
    strategicActions: [{
        ...action, importance: 'major' as const, countermove: counter,
        writerVisibleCounterplay: safeCounterplay, noCountermoveReason: undefined,
    }],
});

const militaryAction = (): Extract<StrategicActionPlan, { domain: 'military' }> => ({
    id: 'military-action', domain: 'military', sceneIds: ['military-scene'], importance: 'major', actorCharacterId: 'a',
    objective: 'Take the frontier fort.', uncertainty: 'The defense may hold.', expectedCostOrTradeoff: 'The operation consumes supply and time.',
    writerVisibleConstraints: ['The army must arrive before fighting.'], actorKnowledgeFactIds: ['actor-fact'], relationshipEffects: [],
    countermove: counter, writerVisibleCounterplay: safeCounterplay,
    operationType: 'assault', location: 'Frontier', intelligenceFactIds: ['actor-fact'],
    readiness: MILITARY_READINESS_DIMENSIONS.map(dimension => ({ dimension, status: 'unknown', evidenceRefs: [] })),
    resourceEffects: [{ characterId: 'a', resourceId: 'supply', quantityDelta: -20 }],
    logistics: {
        supplyResource: { characterId: 'a', resourceId: 'supply' }, expectedSupplyConsumption: 20,
        mobilityResource: { characterId: 'a', resourceId: 'mobility' }, movementConstraint: 'Wagons use the northern pass.',
        operationalTimeChapters: 2, resupplyOrFallback: 'Withdraw to the river depot.',
    },
    movement: { fromLocation: 'Capital', toLocation: 'Frontier', method: 'march', transitChapters: 0 },
    expectedLossOrCost: 'The vanguard may be depleted.', retreatOrFailurePlan: 'Withdraw to the river depot.',
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

const directWriterPlan = (
    domain: 'politics' | 'military' | 'commerce',
    directive: WriterStrategicDirective,
    expectedResourceDeltas: WriterChapterPlan['expectedResourceDeltas'] = [],
    major = false,
): WriterChapterPlan => ({
    kind: 'writer-chapter-plan', chapterNumber: 100,
    arc: { id: 'arc', title: 'Strategic Arc' }, beat: { id: 'beat', order: 1 },
    primaryGoal: 'Execute a bounded strategic plan.', povCharacterId: 'a', participantIds: ['a', 'b'],
    scenes: [{
        id: `${domain}-scene`, order: 1, goal: 'Execute the strategic action.',
        location: domain === 'military' ? 'Frontier' : 'Capital', povCharacterId: 'a',
        participantIds: ['a', 'b'], conflictOrObstacle: 'B resists.', uncertainty: 'The result remains uncertain.',
        expectedConsequence: 'The plan incurs its stated cost.', purposeTags: [domain],
        conflictImportance: major ? 'major' : 'minor',
    }],
    canonConstraints: [{ id: 'current-law', text: 'The council charter is active.', scope: 'canon' }],
    reveals: [], relationshipEvents: [], storyEvents: [], cluesPlantedIds: [], cluesPaidOffIds: [],
    expectedResourceDeltas, expectedRelationshipDeltas: [], expectedContinuityConsequences: [],
    strategicDirectives: [directive], endStateIntent: 'Remain approved but not canon.',
});

const directPoliticalDirective = (): Extract<WriterStrategicDirective, { domain: 'politics' }> => ({
    id: 'direct-politics', domain: 'politics', sceneIds: ['politics-scene'], actorCharacterId: 'a',
    visibleObjective: 'Secure a lawful council decision.', visibleConstraints: ['Respect council procedure.'],
    expectedCostOrTradeoff: 'A spends political capital.',
    dimensionStatuses: POLITICAL_DIMENSIONS.map(dimension => ({ dimension, status: 'unknown' })),
    timing: { earliestChapter: 90, deadlineChapter: 110, preparationChapters: 2 },
});

const directMilitaryDirective = (): Extract<WriterStrategicDirective, { domain: 'military' }> => ({
    id: 'direct-military', domain: 'military', sceneIds: ['military-scene'], actorCharacterId: 'a',
    visibleObjective: 'Take the frontier fort.', visibleConstraints: ['The army must arrive before fighting.'],
    expectedCostOrTradeoff: 'The operation consumes supply and time.', writerVisibleCounterplay: safeCounterplay,
    operationType: 'assault', location: 'Frontier',
    movement: { fromLocation: 'Capital', toLocation: 'Frontier', method: 'march', transitChapters: 0 },
    logistics: {
        supplyResource: { characterId: 'a', resourceId: 'supply' }, expectedSupplyConsumption: 20,
        mobilityResource: { characterId: 'a', resourceId: 'mobility' },
        movementConstraint: 'Wagons use the northern pass.', operationalTimeChapters: 2,
        resupplyOrFallback: 'Withdraw to the river depot.',
    },
    expectedLossOrCost: 'The vanguard may be depleted.', retreatOrFailurePlan: 'Withdraw to the river depot.',
});

const directCommerceDirective = (): Extract<WriterStrategicDirective, { domain: 'commerce' }> => ({
    id: 'direct-commerce', domain: 'commerce', sceneIds: ['commerce-scene'], actorCharacterId: 'a',
    visibleObjective: 'Purchase grain.', visibleConstraints: ['Show payment and delivery.'],
    expectedCostOrTradeoff: 'A spends cash.', actionType: 'purchase',
    resourceFlows: [
        { characterId: 'a', resourceId: 'inventory', quantityDelta: 10, role: 'inventory' },
        { characterId: 'a', resourceId: 'cash', quantityDelta: -100, role: 'cash' },
    ],
    counterpartyCharacterId: 'b', logistics: 'B delivers grain by cart.',
    timing: { settlementChapters: 1, deadlineChapter: 101 }, risk: 'The carts may be delayed.',
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

    it('defines transitChapters as later transitions and only permits inline current-chapter arrival at zero', () => {
        const action = militaryAction();
        for (const transitChapters of [2, 'unknown'] as const) {
            expect(codesFor(militaryPlan({
                ...action, movement: { ...action.movement!, transitChapters },
            }))).toContain('MILITARY_LOCATION_VIOLATION');
        }
        expect(codesFor(militaryPlan({
            ...action, movement: { ...action.movement!, transitChapters: 0 },
        }))).not.toContain('MILITARY_LOCATION_VIOLATION');
        expect(codesFor(militaryPlan({ ...action, movement: undefined }), {
            ...stateFor(), characterLocations: { ...stateFor().characterLocations, a: 'Frontier' },
        })).not.toContain('MILITARY_LOCATION_VIOLATION');
    });

    it('replays only completed movement from strictly earlier scenes', () => {
        const assault = { ...militaryAction(), movement: undefined, sceneIds: ['assault-scene'] };
        const march = (transitChapters: number) => ({
            ...militaryAction(), id: 'march-action', sceneIds: ['march-scene'], importance: 'minor' as const,
            operationType: 'march' as const, resourceEffects: [], logistics: undefined,
            movement: { fromLocation: 'Capital', toLocation: 'Frontier', method: 'march', transitChapters },
            expectedCostOrTradeoff: 'The march consumes time.', expectedLossOrCost: 'The column risks fatigue.',
            retreatOrFailurePlan: 'Return to the capital.', countermove: undefined,
            writerVisibleCounterplay: undefined,
            noCountermoveReason: 'No organized response occurs during the march.',
        });
        const twoScenePlan = (transitChapters: number): InternalChapterPlan => {
            const original = militaryPlan();
            const conflict = original.scenes[0].intelligentConflict;
            return {
                ...original,
                scenes: [
                    { ...original.scenes[0], id: 'march-scene', order: 1, conflictImportance: 'minor', intelligentConflict: undefined },
                    { ...original.scenes[0], id: 'assault-scene', order: 2, intelligentConflict: conflict },
                ],
                strategicActions: [march(transitChapters), assault],
                expectedResourceDeltas: assault.resourceEffects.map(effect => ({ ...effect })),
            };
        };
        expect(codesFor(twoScenePlan(0))).not.toContain('MILITARY_LOCATION_VIOLATION');
        expect(codesFor(twoScenePlan(2))).toContain('MILITARY_LOCATION_VIOLATION');

        const sameScene = militaryPlan();
        const sameSceneMarch = { ...march(0), sceneIds: ['military-scene'] };
        expect(codesFor({ ...sameScene, strategicActions: [sameSceneMarch, { ...militaryAction(), movement: undefined }] }))
            .toContain('MILITARY_LOCATION_VIOLATION');
    });

    it('rejects punctuation-only variants of fake costs and fallback text', () => {
        const action = militaryAction();
        const fake = {
            ...action,
            expectedCostOrTradeoff: 'none.', expectedLossOrCost: 'no cost.', retreatOrFailurePlan: 'N/A.',
            resourceEffects: [],
            logistics: {
                ...action.logistics!, expectedSupplyConsumption: 'unknown' as const,
                operationalTimeChapters: 'unknown' as const, resupplyOrFallback: 'no tradeoff!',
            },
        };
        const codes = codesFor({ ...militaryPlan(fake), expectedResourceDeltas: [] });
        expect(codes).toContain('MILITARY_COST_MISSING');
        expect(codes).toContain('MILITARY_LOGISTICS_VIOLATION');
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
            competitorCharacterId: 'b', fundingResource: { characterId: 'a', resourceId: 'cash' },
            countermove: counter, writerVisibleCounterplay: safeCounterplay, noCountermoveReason: undefined,
        };
        const plan = asMajor(commercePlan(priceWar), priceWar);
        expect(codesFor(plan)).toEqual([]);
        const invalid = { ...priceWar, competitorCharacterId: undefined, fundingResource: undefined, countermove: undefined, expectedCostOrTradeoff: 'none' };
        expect(codesFor({ ...commercePlan(invalid), scenes: plan.scenes })).toContain('COMMERCE_FINANCING_VIOLATION');
    });
});

describe('WORK 07 shared contracts and boundaries', () => {
    it('rejects fabricated WriterChapterPlan strategic bypasses before Writer and Repair models', async () => {
        const validCommerce = directCommerceDirective();
        const freePurchase = directWriterPlan('commerce', {
            ...validCommerce,
            resourceFlows: [
                { characterId: 'a', resourceId: 'inventory', quantityDelta: 10, role: 'inventory' },
                { characterId: 'a', resourceId: 'cash', quantityDelta: 0, role: 'cash' },
            ],
        }, [
            { characterId: 'a', resourceId: 'inventory', quantityDelta: 10 },
            { characterId: 'a', resourceId: 'cash', quantityDelta: 0 },
        ]);
        const loanWithoutLiability = directWriterPlan('commerce', {
            ...validCommerce, actionType: 'loan', visibleObjective: 'Borrow cash.',
            resourceFlows: [{ characterId: 'a', resourceId: 'cash', quantityDelta: 100, role: 'cash' }],
        }, [{ characterId: 'a', resourceId: 'cash', quantityDelta: 100 }]);
        const saleWithoutBasis = directWriterPlan('commerce', {
            ...validCommerce, actionType: 'sale', visibleObjective: 'Sell a service.',
            resourceFlows: [{ characterId: 'a', resourceId: 'cash', quantityDelta: 100, role: 'cash' }],
            serviceOrContractBasis: undefined,
        }, [{ characterId: 'a', resourceId: 'cash', quantityDelta: 100 }]);
        const priceWarWithoutSpend = directWriterPlan('commerce', {
            ...validCommerce, actionType: 'price-war', visibleObjective: 'Defend market share.',
            expectedCostOrTradeoff: 'A risks exhausting cash.', writerVisibleCounterplay: safeCounterplay,
            resourceFlows: [{ characterId: 'a', resourceId: 'cash', quantityDelta: 0, role: 'cash' }],
            competitorCharacterId: 'b', fundingResource: { characterId: 'a', resourceId: 'cash' },
        }, [{ characterId: 'a', resourceId: 'cash', quantityDelta: 0 }], true);
        const military = directMilitaryDirective();
        const missingLogistics = directWriterPlan('military', { ...military, logistics: undefined }, [], true);
        const lateArrival = (transitChapters: number | 'unknown') => directWriterPlan('military', {
            ...military, movement: { ...military.movement!, transitChapters },
        }, [{ characterId: 'a', resourceId: 'supply', quantityDelta: -20 }], true);
        const futurePolitics = directWriterPlan('politics', {
            ...directPoliticalDirective(), timing: { earliestChapter: 101, deadlineChapter: 110, preparationChapters: 1 },
        });
        const placeholderMilitary = directWriterPlan('military', {
            ...military, expectedCostOrTradeoff: '!!!', retreatOrFailurePlan: '...',
            logistics: { ...military.logistics!, resupplyOrFallback: '---' },
        }, [{ characterId: 'a', resourceId: 'supply', quantityDelta: -20 }], true);
        const missingCounterplay = directWriterPlan('military', {
            ...military, writerVisibleCounterplay: undefined,
        }, [{ characterId: 'a', resourceId: 'supply', quantityDelta: -20 }], true);
        const tamperedCounterplay = directWriterPlan('military', {
            ...military, writerVisibleCounterplay: { ...safeCounterplay, opponentCharacterId: 'future' },
        }, [{ characterId: 'a', resourceId: 'supply', quantityDelta: -20 }], true);
        const sameSceneMarch = {
            ...military, id: 'direct-march', operationType: 'march' as const, logistics: undefined,
            expectedCostOrTradeoff: 'The march consumes time.', expectedLossOrCost: 'The column risks fatigue.',
            retreatOrFailurePlan: 'Return to the capital.',
        };
        const sameSceneMovement: WriterChapterPlan = {
            ...directWriterPlan('military', { ...military, movement: undefined }, [
                { characterId: 'a', resourceId: 'supply', quantityDelta: -20 },
            ], true),
            strategicDirectives: [sameSceneMarch, { ...military, movement: undefined }],
        };

        const fabricated = [
            freePurchase, loanWithoutLiability, saleWithoutBasis, priceWarWithoutSpend,
            missingLogistics, lateArrival(2), lateArrival('unknown'), futurePolitics,
            placeholderMilitary, missingCounterplay, tamperedCounterplay,
            sameSceneMovement,
        ];
        fabricated.forEach(plan => expect(() => buildWriterContext(control, stateFor(), plan)).toThrow());

        const writerModel = vi.fn(async () => ({
            kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'This must not be written.',
        }));
        await expect(generateWriterDraft({
            control, state: stateFor(), plan: freePurchase, model: { write: writerModel },
        })).rejects.toThrow();
        expect(writerModel).not.toHaveBeenCalled();

        const semantic = vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 100, issues: [] }));
        const repair = vi.fn(async () => ({ kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'repair' }));
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(), plan: freePurchase,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'Fabricated purchase.' },
            semanticModel: { validate: semantic }, repairModel: { repair }, maxRepairAttempts: 2,
        });
        expect(result.report.issues.map(issue => issue.code)).toContain('INVALID_SOURCE_PLAN');
        expect(semantic).not.toHaveBeenCalled();
        expect(repair).not.toHaveBeenCalled();

        expect(() => buildWriterContext(control, stateFor(), directWriterPlan(
            'commerce', validCommerce, commercePlan().expectedResourceDeltas,
        ))).not.toThrow();
        expect(() => buildWriterContext(control, stateFor(), directWriterPlan(
            'military', military, [{ characterId: 'a', resourceId: 'supply', quantityDelta: -20 }], true,
        ))).not.toThrow();
        const earlierMovementPlan: WriterChapterPlan = {
            ...directWriterPlan('military', { ...military, sceneIds: ['assault-scene'], movement: undefined }, [
                { characterId: 'a', resourceId: 'supply', quantityDelta: -20 },
            ], true),
            scenes: [
                { ...directWriterPlan('military', military).scenes[0], id: 'march-scene', order: 1, conflictImportance: 'minor' },
                { ...directWriterPlan('military', military).scenes[0], id: 'assault-scene', order: 2, conflictImportance: 'major' },
            ],
            strategicDirectives: [
                { ...sameSceneMarch, sceneIds: ['march-scene'], writerVisibleCounterplay: undefined },
                { ...military, sceneIds: ['assault-scene'], movement: undefined },
            ],
        };
        expect(() => buildWriterContext(control, stateFor(), earlierMovementPlan)).not.toThrow();
        expect(() => buildWriterContext(control, stateFor(), directWriterPlan(
            'politics', directPoliticalDirective(), [], false,
        ))).not.toThrow();
    });

    it('requires compatible meaningful writer-visible counterplay on major source actions', () => {
        const internal = militaryPlan();
        const action = internal.strategicActions![0];
        expect(codesFor({
            ...internal, strategicActions: [{ ...action, writerVisibleCounterplay: undefined }],
        })).toContain('STRATEGIC_REFERENCE_INVALID');
        expect(codesFor({
            ...internal,
            strategicActions: [{
                ...action,
                writerVisibleCounterplay: { ...safeCounterplay, opponentCharacterId: 'a' },
            }],
        })).toContain('STRATEGIC_REFERENCE_INVALID');
        expect(codesFor({
            ...internal,
            strategicActions: [{
                ...action,
                writerVisibleCounterplay: { ...safeCounterplay, action: '!!!' },
            }],
        })).toContain('STRATEGIC_REFERENCE_INVALID');
    });

    it('preserves concrete writer-safe domain contracts through WriterModelRequest', async () => {
        const requests: unknown[] = [];
        const model = {
            async write(request: unknown) {
                requests.push(request);
                return { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A executes the supplied plan.' };
            },
        };
        for (const plan of [militaryPlan(), commercePlan(), basePlan('politics', politicalAction())]) {
            await generateWriterDraft({ control, state: stateFor(), plan: sanitizeWriterChapterPlan(plan, control, stateFor()), model });
        }
        const [militaryRequest, commerceRequest, politicsRequest] = requests.map(request => JSON.stringify(request));
        expect(militaryRequest).toContain('Wagons use the northern pass.');
        expect(militaryRequest).toContain('Withdraw to the river depot.');
        expect(militaryRequest).toContain('The vanguard may be depleted.');
        expect(militaryRequest).toContain('Lock the northern supplier network.');
        expect(militaryRequest).toContain('"transitChapters":0');
        expect(commerceRequest).toContain('"counterpartyCharacterId":"b"');
        expect(commerceRequest).toContain('B delivers grain by cart.');
        expect(commerceRequest).toContain('"settlementChapters":1');
        expect(commerceRequest).toContain('The carts may be delayed.');
        expect(politicsRequest).toContain('"preparationChapters":2');
        expect(politicsRequest).toContain('"dimensionStatuses"');
        requests.forEach((request) => {
            const payload = JSON.stringify(request);
            expect(payload).not.toContain('evidenceRefs');
            expect(payload).not.toContain('opponentKnowledgeFactIds');
            expect(payload).not.toContain('opponent-fact');
        });
    });

    it('projects safe rational counterplay for major politics, military, and commerce without epistemics', async () => {
        const commerceBase = purchaseAction();
        const priceWar = {
            ...commerceBase, actionType: 'price-war' as const, importance: 'major' as const,
            objective: 'Defend market share.', expectedCostOrTradeoff: 'A burns cash to hold customers.',
            resourceFlows: [{ characterId: 'a', resourceId: 'cash', quantityDelta: -50, role: 'cash' as const }],
            competitorCharacterId: 'b', fundingResource: { characterId: 'a', resourceId: 'cash' },
            countermove: counter, writerVisibleCounterplay: safeCounterplay, noCountermoveReason: undefined,
        };
        const internalPlans = [
            asMajor(basePlan('politics', politicalAction()), politicalAction()),
            militaryPlan(),
            asMajor(commercePlan(priceWar), priceWar),
        ];
        for (const internal of internalPlans) {
            let payload = '';
            await generateWriterDraft({
                control, state: stateFor(), plan: sanitizeWriterChapterPlan(internal, control, stateFor()),
                model: { async write(request) {
                    payload = JSON.stringify(request);
                    return { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'Execute rational opposition.' };
                } },
            });
            expect(payload).toContain('"writerVisibleCounterplay"');
            expect(payload).toContain('Lock the northern supplier network.');
            expect(payload).not.toContain('opponentKnowledgeFactIds');
            expect(payload).not.toContain('opponentBeliefClaims');
            expect(payload).not.toContain('evidenceRefs');

            const validatorPayload = JSON.stringify(buildValidatorStrategicView(
                internal, buildPlannerContext(control, stateFor(), 100),
            ));
            expect(validatorPayload).toContain('"privilegedCountermove"');
            expect(validatorPayload).toContain('"opponentKnowledgeFactIds":["opponent-fact"]');
            expect(validatorPayload).toContain('Lock the northern supplier network.');
            expect(validatorPayload).toContain('B may misread demand.');
            expect(validatorPayload).toContain('B exposes his supplier relationships.');
        }
    });

    it('runtime-revalidates every discriminated Writer strategic directive field', () => {
        const militaryWriterPlan = sanitizeWriterChapterPlan(militaryPlan(), control, stateFor());
        const directive = militaryWriterPlan.strategicDirectives![0];
        if (directive.domain !== 'military') throw new Error('expected military fixture');
        const malformed: readonly unknown[] = [
            { ...directive, unsupported: { hidden: true } },
            { ...directive, domain: 'politics' },
            { ...directive, movement: { ...directive.movement!, transitChapters: Number.NaN } },
            { ...directive, logistics: { ...directive.logistics!, expectedSupplyConsumption: Number.POSITIVE_INFINITY } },
            { ...directive, sceneIds: ['unknown-scene'] },
            { ...directive, actorCharacterId: 'future' },
        ];
        malformed.forEach((entry) => {
            const runtimePlan = { ...militaryWriterPlan, strategicDirectives: [entry] } as unknown as typeof militaryWriterPlan;
            expect(() => buildWriterContext(control, stateFor(), runtimePlan)).toThrow();
        });

        const commerceWriterPlan = sanitizeWriterChapterPlan(commercePlan(), control, stateFor());
        const commerceDirective = commerceWriterPlan.strategicDirectives![0];
        if (commerceDirective.domain !== 'commerce') throw new Error('expected commerce fixture');
        const inconsistent = {
            ...commerceDirective,
            resourceFlows: commerceDirective.resourceFlows.map((flow, index) => index === 0 ? { ...flow, quantityDelta: 999 } : flow),
        };
        expect(() => buildWriterContext(control, stateFor(), {
            ...commerceWriterPlan, strategicDirectives: [inconsistent],
        })).toThrow('do not match expectedResourceDeltas');
    });

    it('retains the same operational contract in ValidatorStrategicView', () => {
        const plannerContext = buildPlannerContext(control, stateFor(), 100);
        const militaryView = JSON.stringify(buildValidatorStrategicView(militaryPlan(), plannerContext));
        const commerceView = JSON.stringify(buildValidatorStrategicView(commercePlan(), plannerContext));
        expect(militaryView).toContain('Wagons use the northern pass.');
        expect(militaryView).toContain('Withdraw to the river depot.');
        expect(militaryView).toContain('The vanguard may be depleted.');
        expect(commerceView).toContain('"counterpartyCharacterId":"b"');
        expect(commerceView).toContain('B delivers grain by cart.');
        expect(commerceView).toContain('The carts may be delayed.');
    });

    it('rejects a stale same-identity strategic view before SemanticValidatorModel', async () => {
        const source = militaryPlan();
        const strategicView = buildValidatorStrategicView(source, buildPlannerContext(control, stateFor(), 100));
        const changedAction = {
            ...militaryAction(),
            logistics: { ...militaryAction().logistics!, resupplyOrFallback: 'Withdraw to the eastern depot.' },
        };
        const changedPlan = militaryPlan(changedAction);
        const semantic = vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 100, issues: [] }));
        const result = await validateWriterChapter({
            control, state: stateFor(), plan: sanitizeWriterChapterPlan(changedPlan, control, stateFor()), strategicView,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A attacks.' },
            semanticModel: { validate: semantic },
        });
        expect(result.report.issues.map(issue => issue.code)).toContain('INVALID_SOURCE_PLAN');
        expect(semantic).not.toHaveBeenCalled();

        const originalWriterPlan = sanitizeWriterChapterPlan(source, control, stateFor());
        const originalDirective = originalWriterPlan.strategicDirectives![0];
        if (originalDirective.writerVisibleCounterplay === undefined) throw new Error('expected counterplay');
        const counterplayTamperedPlan: WriterChapterPlan = {
            ...originalWriterPlan,
            strategicDirectives: [{
                ...originalDirective,
                writerVisibleCounterplay: {
                    ...originalDirective.writerVisibleCounterplay,
                    action: 'Invent a different strategic response.',
                },
            }],
        };
        expect(() => buildWriterContext(control, stateFor(), counterplayTamperedPlan)).not.toThrow();
        const tamperedSemantic = vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 100, issues: [] }));
        const tampered = await validateWriterChapter({
            control, state: stateFor(), plan: counterplayTamperedPlan, strategicView,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A attacks.' },
            semanticModel: { validate: tamperedSemantic },
        });
        expect(tampered.report.issues.map(issue => issue.code)).toContain('INVALID_SOURCE_PLAN');
        expect(tamperedSemantic).not.toHaveBeenCalled();
    });

    it('strictly rejects malformed privileged strategic views before Validator or Repair models', async () => {
        const internal = commercePlan();
        const valid = buildValidatorStrategicView(internal, buildPlannerContext(control, stateFor(), 100));
        const firstAction = valid.actions[0];
        const firstEvidence = firstAction.evidenceRefs[0];
        const firstResource = valid.resourceEvidence[0];
        const firstEpistemic = valid.epistemicEvidence[0];
        const malformed: readonly unknown[] = [
            { ...valid, unsupportedTopLevel: true },
            { ...valid, actions: [{ ...firstAction, evidenceRefs: [{ ...firstEvidence, extra: 'blocked' }] }] },
            { ...valid, actions: [{ ...firstAction, evidenceRefs: [{ ...firstEvidence, hiddenPayload: { nested: { arbitrary: 'blocked' } } }] }] },
            { ...valid, actions: [{ ...firstAction, evidenceRefs: [{ type: 'fake-evidence', id: 'x' }] }] },
            { ...valid, resourceEvidence: [{ ...firstResource, quantity: Number.NaN }] },
            { ...valid, resourceEvidence: [{ ...firstResource, quantity: Number.POSITIVE_INFINITY }] },
            { ...valid, resourceEvidence: [{ characterId: 'a', resourceId: 'invented', quantity: 999 }] },
            { ...valid, epistemicEvidence: [{ characterId: 'b', factId: 'actor-fact' }] },
            { ...valid, actions: [{ ...firstAction, evidenceRefs: [firstEvidence, firstEvidence] }] },
            { ...valid, actions: [{ ...firstAction, resourceKeys: [firstAction.resourceKeys[0], firstAction.resourceKeys[0]] }] },
            { ...valid, resourceEvidence: [firstResource, firstResource] },
            { ...valid, epistemicEvidence: [firstEpistemic, firstEpistemic] },
            { ...valid, deterministicIssues: [{ code: 'ARBITRARY_ISSUE', path: 'x', severity: 'error' }] },
        ];
        for (const strategicView of malformed) {
            const semantic = vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 100, issues: [] }));
            const result = await validateWriterChapter({
                control, state: stateFor(), plan: sanitizeWriterChapterPlan(internal, control, stateFor()), strategicView,
                draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A purchases grain.' },
                semanticModel: { validate: semantic },
            });
            expect(result.report.issues.map(issue => issue.code)).toContain('INVALID_SOURCE_PLAN');
            expect(semantic).not.toHaveBeenCalled();
        }

        const semantic = vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 100, issues: [] }));
        const repair = vi.fn(async () => ({ kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'repaired' }));
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(), plan: sanitizeWriterChapterPlan(internal, control, stateFor()), strategicView: malformed[1],
            draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A purchases grain.' },
            semanticModel: { validate: semantic }, repairModel: { repair }, maxRepairAttempts: 2,
        });
        expect(result.report.issues.map(issue => issue.code)).toContain('INVALID_SOURCE_PLAN');
        expect(semantic).not.toHaveBeenCalled();
        expect(repair).not.toHaveBeenCalled();
    });

    it('classifies sanitized strategic-view overflow as validator capacity failure', async () => {
        const internal = commercePlan();
        const strategicView = buildValidatorStrategicView(internal, buildPlannerContext(control, stateFor(), 100));
        const semantic = vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 100, issues: [] }));
        const repair = vi.fn(async () => ({ kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'repaired' }));
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(), plan: sanitizeWriterChapterPlan(internal, control, stateFor()), strategicView,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A purchases grain.' },
            semanticModel: { validate: semantic }, repairModel: { repair }, maxRepairAttempts: 2,
            validatorContextSelectionPolicy: {
                maxLockedCharacters: 64, maxLockedReveals: 128, maxLockedRelationshipEvents: 128,
                maxLockedStoryEvents: 128, maxSecretValidationItems: 128, maxPlotItems: 256, maxStrategicItems: 1,
            },
        });
        expect(result.report.issues.map(issue => issue.code)).toContain('VALIDATOR_CONTEXT_CAPACITY_EXCEEDED');
        expect(semantic).not.toHaveBeenCalled();
        expect(repair).not.toHaveBeenCalled();
    });

    it('blocks raw Author Secret strings in strategicView while preserving the deliberate secretValidation channel', async () => {
        const militaryInternal = militaryPlan();
        const militaryWriterPlan = sanitizeWriterChapterPlan(militaryInternal, control, stateFor());
        const militaryView = buildValidatorStrategicView(
            militaryInternal, buildPlannerContext(control, stateFor(), 100),
        );
        const militaryDescriptor = militaryView.actions[0];
        if (militaryDescriptor.domain !== 'military' || militaryDescriptor.logistics === undefined
            || militaryDescriptor.writerVisibleCounterplay === undefined) throw new Error('expected military descriptor');
        const commerceInternal = commercePlan();
        const commerceWriterPlan = sanitizeWriterChapterPlan(commerceInternal, control, stateFor());
        const commerceView = buildValidatorStrategicView(
            commerceInternal, buildPlannerContext(control, stateFor(), 100),
        );
        const commerceDescriptor = commerceView.actions[0];
        if (commerceDescriptor.domain !== 'commerce') throw new Error('expected commerce descriptor');
        const secretViews: readonly { readonly plan: WriterChapterPlan; readonly view: unknown }[] = [
            { plan: militaryWriterPlan, view: { ...militaryView, actions: [{ ...militaryDescriptor, visibleObjective: RAW_SECRET }] } },
            { plan: militaryWriterPlan, view: { ...militaryView, actions: [{
                ...militaryDescriptor,
                logistics: { ...militaryDescriptor.logistics, movementConstraint: RAW_SECRET },
            }] } },
            { plan: militaryWriterPlan, view: { ...militaryView, actions: [{
                ...militaryDescriptor,
                logistics: { ...militaryDescriptor.logistics, resupplyOrFallback: RAW_SECRET },
            }] } },
            { plan: commerceWriterPlan, view: { ...commerceView, actions: [{ ...commerceDescriptor, logistics: RAW_SECRET }] } },
            { plan: commerceWriterPlan, view: { ...commerceView, actions: [{ ...commerceDescriptor, risk: RAW_SECRET }] } },
            { plan: militaryWriterPlan, view: { ...militaryView, actions: [{
                ...militaryDescriptor,
                writerVisibleCounterplay: { ...militaryDescriptor.writerVisibleCounterplay, action: RAW_SECRET },
            }] } },
        ];
        for (const entry of secretViews) {
            const semantic = vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 100, issues: [] }));
            const result = await validateWriterChapter({
                control, state: stateFor(), plan: entry.plan, strategicView: entry.view,
                draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A safe candidate.' },
                semanticModel: { validate: semantic },
            });
            expect(result.report.issues.map(issue => issue.code)).toContain('INVALID_SOURCE_PLAN');
            expect(JSON.stringify(result.report)).not.toContain(RAW_SECRET);
            expect(semantic).not.toHaveBeenCalled();
        }

        const semantic = vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 100, issues: [] }));
        const repair = vi.fn(async () => ({ kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'repair' }));
        const blocked = await validateAndRepairWriterChapter({
            control, state: stateFor(), plan: secretViews[0].plan, strategicView: secretViews[0].view,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: 'A safe candidate.' },
            semanticModel: { validate: semantic }, repairModel: { repair }, maxRepairAttempts: 2,
        });
        expect(JSON.stringify(blocked.report)).not.toContain(RAW_SECRET);
        expect(semantic).not.toHaveBeenCalled();
        expect(repair).not.toHaveBeenCalled();

        const safeSemantic = vi.fn(async () => ({ kind: 'semantic-validation-result', chapterNumber: 100, issues: [] }));
        const leakResult = await validateWriterChapter({
            control, state: stateFor(), plan: militaryWriterPlan, strategicView: militaryView,
            draft: { kind: 'writer-chapter-draft', chapterNumber: 100, prose: `The prose leaks ${RAW_SECRET}.` },
            semanticModel: { validate: safeSemantic },
        });
        expect(leakResult.report.issues.map(issue => issue.code)).toContain('AUTHOR_SECRET_LEAK');
        expect(leakResult.context?.secretValidation.some(entry => entry.rawValue === RAW_SECRET)).toBe(true);
    });

    it('treats punctuation-only and normalized placeholder text as non-meaningful', () => {
        for (const value of ['!!!', '...', '---', ' N/A. ', 'NO COST!!!', 'none...']) {
            expect(isMeaningfulText(value)).toBe(false);
        }
        expect(isMeaningfulText('The retreat abandons the northern depot.')).toBe(true);
    });

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
        expect(validatorPayload).toContain('privilegedCountermove');
        expect(validatorPayload).toContain('Lock the northern supplier network.');
        expect(repairPayload).toContain('writerVisibleCounterplay');
        expect(repairPayload).toContain('Lock the northern supplier network.');
        expect(repairPayload).not.toContain('opponent-fact');
        expect(repairPayload).not.toContain('privilegedCountermove');
        expect(repairPayload).not.toContain('opponentKnowledgeFactIds');
        expect(repairPayload).not.toContain('opponentBeliefClaims');
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
