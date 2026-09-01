import {
    compileStoryControl,
    MILITARY_READINESS_DIMENSIONS,
    POLITICAL_DIMENSIONS,
} from '../../src/storyEngine';
import type {
    NarrativeMemoryInput,
    PoliticalActionPlan,
    StrategicActionPlan,
    RelationshipDefinition,
    StoryBlueprint,
} from '../../src/storyEngine';

export const LONG_RUN_CHAPTER_COUNT = 600;

export const LONG_RUN_CHECKPOINTS = [
    0, 32, 33, 46, 47, 96, 97, 99, 100, 101, 199, 200, 201,
    218, 219, 290, 291, 299, 300, 301, 308, 309, 399, 400, 401,
    499, 500, 501, 548, 549, 559, 560, 561, 599, 600,
] as const;

export const LONG_RUN_GATE_MATRIX = {
    character: [
        { id: 'cinder', chapter: 33 },
        { id: 'dune', chapter: 47 },
        { id: 'ember', chapter: 201 },
        { id: 'fable', chapter: 291 },
        { id: 'gale', chapter: 501 },
        { id: 'harbor', chapter: 561 },
    ],
    pov: [
        { id: 'cinder', chapter: 97 },
        { id: 'harbor', chapter: 561 },
    ],
    reveal: [
        { id: 'reveal-beta', chapter: 47 },
        { id: 'reveal-alpha', chapter: 549 },
        { id: 'reveal-omega', chapter: 561 },
    ],
    relationship: [{ id: 'professional-alliance', chapter: 309 }],
    event: [{ id: 'event-charter-vote', chapter: 219 }],
} as const;

const relationshipPolicy = {
    maxMajorMilestoneAdvancePerChapter: 1,
    maxConsecutiveProgressionChapters: 2,
    requireCanonicalBasis: true as const,
    requireMutualAgencyForMutualMilestone: true as const,
};

const relationshipProfile = {
    coreDynamicTags: ['professional-equals' as const, 'slow-earned-trust' as const],
    dominantConflictSources: ['Competing duties and incomplete information.'],
    trustBasis: ['Repeated voluntary choices.'],
    respectBasis: ['Demonstrated competence.'],
    prohibitedShortcuts: [] as const,
};

const relationships: readonly RelationshipDefinition[] = [{
    id: 'atlas-birch',
    participantIds: ['atlas', 'birch'],
    categories: ['romantic', 'professional'],
    initialRomanceMilestone: 'none',
    dynamicProfile: relationshipProfile,
    progressionPolicy: relationshipPolicy,
}, {
    id: 'atlas-cinder',
    participantIds: ['atlas', 'cinder'],
    categories: ['professional', 'rivalry'],
    initialRomanceMilestone: 'none',
    dynamicProfile: {
        ...relationshipProfile,
        coreDynamicTags: ['professional-equals', 'ideological-rivals'],
        prohibitedShortcuts: ['flirtation', 'romantic-tension', 'courtship', 'confession', 'accept-romance'],
    },
    progressionPolicy: relationshipPolicy,
}];

const arcs = Array.from({ length: 6 }, (_, index) => ({
    id: `arc-${index + 1}`,
    title: `Long Run Arc ${index + 1}`,
    startChapter: index * 100 + 1,
    endChapter: (index + 1) * 100,
    writerBrief: `Resolve the bounded work of arc ${index + 1}.`,
    authorPlan: index === 5 ? 'FUTURE_ARC_6_PRIVATE_MARKER' : `Private arc plan ${index + 1}.`,
}));

const beats = arcs.flatMap(arc => Array.from({ length: 4 }, (_, index) => ({
    id: `beat-${arc.id.slice(4)}-${index + 1}`,
    arcId: arc.id,
    order: index + 1,
    startChapter: arc.startChapter + index * 25,
    endChapter: arc.startChapter + index * 25 + 24,
    writerBrief: `Advance beat ${index + 1} without importing future truth.`,
    authorPlan: `Private beat plan ${arc.id}-${index + 1}.`,
})));

export const LONG_RUN_BLUEPRINT: StoryBlueprint = {
    id: 'story-engine-v4-long-run-fixture',
    engine: { plannedChapterCount: LONG_RUN_CHAPTER_COUNT },
    characters: [
        { id: 'atlas', name: 'Atlas Vale', availableFromChapter: 1, writerProfile: { role: 'Coordinator' } },
        { id: 'birch', name: 'Birch Rowan', availableFromChapter: 1, writerProfile: { role: 'Archivist' } },
        { id: 'cinder', name: 'Cinder Ash', availableFromChapter: 33, writerProfile: { role: 'Mediator' } },
        { id: 'dune', name: 'Dune Reed', availableFromChapter: 47, writerProfile: { role: 'Navigator' } },
        { id: 'ember', name: 'Ember Stone', availableFromChapter: 201, writerProfile: { role: 'Quartermaster' } },
        { id: 'fable', name: 'Fable Moss', availableFromChapter: 291, writerProfile: { role: 'Envoy' } },
        { id: 'gale', name: 'Gale Brook', availableFromChapter: 501, writerProfile: { role: 'Commander' } },
        {
            id: 'harbor', name: 'Harbor Fen', availableFromChapter: 561,
            writerProfile: { role: 'Late-story witness' }, authorNotes: 'FUTURE_CHARACTER_561_MARKER',
        },
    ],
    arcs,
    beats,
    reveals: [
        { id: 'reveal-beta', writerText: 'The early signal can now be interpreted.' },
        { id: 'reveal-alpha', writerText: 'The sealed charter has a public provenance.', authorNotes: 'FUTURE_REVEAL_549_MARKER' },
        { id: 'reveal-omega', writerText: 'The final witness may state the controlled conclusion.' },
    ],
    relationshipDefinitions: relationships,
    relationshipEvents: [{
        id: 'professional-alliance', relationshipId: 'atlas-cinder', eventType: 'alliance',
        participantIds: ['atlas', 'cinder'], writerText: 'They may formalize a professional alliance.',
    }, {
        id: 'romance-acceptance', relationshipId: 'atlas-birch', eventType: 'accept-romance',
        participantIds: ['atlas', 'birch'], writerText: 'They may mutually accept the established courtship.',
        authorizedRomanceMilestone: 'committed-romance',
    }],
    storyEvents: [{
        id: 'event-charter-vote', eventType: 'charter-vote',
        writerText: 'The council may hold the charter vote.',
    }],
    gates: {
        pov: [
            { id: 'pov-atlas', characterId: 'atlas', allowedFromChapter: 1 },
            { id: 'pov-birch', characterId: 'birch', allowedFromChapter: 1 },
            { id: 'pov-cinder', characterId: 'cinder', allowedFromChapter: 97 },
            { id: 'pov-dune', characterId: 'dune', allowedFromChapter: 47 },
            { id: 'pov-ember', characterId: 'ember', allowedFromChapter: 201 },
            { id: 'pov-fable', characterId: 'fable', allowedFromChapter: 291 },
            { id: 'pov-gale', characterId: 'gale', allowedFromChapter: 501 },
            { id: 'pov-harbor', characterId: 'harbor', allowedFromChapter: 561 },
        ],
        reveals: [
            { id: 'gate-reveal-beta', revealId: 'reveal-beta', allowedFromChapter: 47 },
            { id: 'gate-reveal-alpha', revealId: 'reveal-alpha', allowedFromChapter: 549 },
            { id: 'gate-reveal-omega', revealId: 'reveal-omega', allowedFromChapter: 561 },
        ],
        relationships: [
            { id: 'gate-professional-alliance', eventId: 'professional-alliance', allowedFromChapter: 309 },
            { id: 'gate-romance-acceptance', eventId: 'romance-acceptance', allowedFromChapter: 549 },
        ],
        events: [{ id: 'gate-charter-vote', eventId: 'event-charter-vote', allowedFromChapter: 219 }],
    },
    authorOnlySecrets: [
        { id: 'secret-alpha', value: 'RAW_LONG_RUN_SECRET_ALPHA', revealId: 'reveal-alpha' },
        { id: 'secret-omega', value: 'RAW_LONG_RUN_SECRET_OMEGA', revealId: 'reveal-omega' },
        { id: 'secret-permanent', value: 'RAW_LONG_RUN_SECRET_PERMANENT' },
    ],
    canonRules: [{
        id: 'rule-ledger-integrity', text: 'Canonical ledgers are authoritative.',
        availableFromChapter: 1, scope: 'canon',
    }],
};

export const LONG_RUN_CONTROL = compileStoryControl(LONG_RUN_BLUEPRINT);

export const LONG_RUN_MEMORY: NarrativeMemoryInput = {
    recentRawChapters: Array.from({ length: 601 }, (_, index) => ({
        chapterNumber: index + 1,
        text: index + 1 >= 600 ? `FUTURE_RAW_MEMORY_${index + 1}` : `Raw memory ${index + 1}`,
    })).concat([{ chapterNumber: 700, text: 'FUTURE_RAW_MEMORY_700' }]),
    structuredRecentSummaries: Array.from({ length: 601 }, (_, index) => ({
        chapterNumber: index + 1,
        summary: index + 1 >= 600 ? `FUTURE_SUMMARY_${index + 1}` : `Summary ${index + 1}`,
        factIds: [`fact-${String(index + 1).padStart(3, '0')}`],
    })).concat([{ chapterNumber: 700, summary: 'FUTURE_SUMMARY_700', factIds: ['fact-700'] }]),
    selectedLongTermMemories: Array.from({ length: 601 }, (_, index) => ({
        id: `memory-${String(index + 1).padStart(3, '0')}`,
        establishedChapter: index + 1,
        summary: index + 1 >= 600 ? `FUTURE_LONG_TERM_${index + 1}` : `Long-term memory ${index + 1}`,
        relevance: (index + 1) % 17,
    })).concat([{ id: 'memory-700', establishedChapter: 700, summary: 'FUTURE_LONG_TERM_700', relevance: 999 }]),
};

/** A small valid action used to exercise late-run political evidence against real PlannerContext. */
export const politicalActionFor = (chapter: number, actorCharacterId = 'atlas', knowledgeFactId = 'fact-588'): PoliticalActionPlan => ({
    id: `politics-${chapter}`,
    domain: 'politics',
    sceneIds: [`scene-${chapter}`],
    importance: 'minor',
    actorCharacterId,
    objective: 'Secure a bounded council decision.',
    uncertainty: 'The council may delay.',
    expectedCostOrTradeoff: 'Political capital is spent.',
    writerVisibleConstraints: ['Use the current charter procedure.'],
    actorKnowledgeFactIds: [knowledgeFactId],
    relationshipEffects: [],
    noCountermoveReason: 'This sampled administrative action is minor.',
    dimensions: POLITICAL_DIMENSIONS.map((dimension) => ({
        dimension,
        status: dimension === 'information' ? 'supporting' as const : 'unknown' as const,
        evidenceRefs: dimension === 'information'
            ? [{ type: 'knowledge' as const, characterId: actorCharacterId, factId: knowledgeFactId }]
            : [],
    })),
    timing: { earliestChapter: chapter, deadlineChapter: chapter, preparationChapters: 1 },
    resourceEffects: [],
});

export const militaryActionFor = (chapter: number, knowledgeFactId: string): Extract<StrategicActionPlan, { domain: 'military' }> => ({
    id: `military-${chapter}`, domain: 'military', sceneIds: [`scene-${chapter}`], importance: 'minor',
    actorCharacterId: 'atlas', objective: 'Move supplies to the forward station.',
    uncertainty: 'The route may close.', expectedCostOrTradeoff: 'Fuel and operational time are consumed.',
    writerVisibleConstraints: ['Movement and supply consumption remain explicit.'],
    actorKnowledgeFactIds: [knowledgeFactId], relationshipEffects: [],
    noCountermoveReason: 'This sampled logistical movement is minor.',
    operationType: 'march', location: `forward-${chapter}`, intelligenceFactIds: [knowledgeFactId],
    readiness: MILITARY_READINESS_DIMENSIONS.map(dimension => ({ dimension, status: 'unknown', evidenceRefs: [] })),
    resourceEffects: [{ characterId: 'atlas', resourceId: 'fuel', quantityDelta: -2 }],
    logistics: {
        supplyResource: { characterId: 'atlas', resourceId: 'fuel' }, expectedSupplyConsumption: 2,
        mobilityResource: { characterId: 'atlas', resourceId: 'ships' }, movementConstraint: 'Use the mapped channel.',
        operationalTimeChapters: 1, resupplyOrFallback: 'Return to the prior route station.',
    },
    movement: { fromLocation: `route-${(chapter - 25) / 25}`, toLocation: `forward-${chapter}`, method: 'convoy', transitChapters: 0 },
    expectedLossOrCost: 'One day of readiness is spent.', retreatOrFailurePlan: 'Return to the prior route station.',
});

export const commerceActionFor = (chapter: number): Extract<StrategicActionPlan, { domain: 'commerce' }> => ({
    id: `commerce-${chapter}`, domain: 'commerce', sceneIds: [`scene-${chapter}`], importance: 'minor',
    actorCharacterId: 'atlas', objective: 'Purchase a bounded grain shipment.',
    uncertainty: 'Delivery may be delayed.', expectedCostOrTradeoff: 'Money is exchanged for grain.',
    writerVisibleConstraints: ['Show payment, source, timing, and delivery risk.'],
    actorKnowledgeFactIds: ['fact-588'], relationshipEffects: [],
    noCountermoveReason: 'The sampled spot purchase is too small for organized counterplay.',
    actionType: 'purchase',
    resourceFlows: [
        { characterId: 'atlas', resourceId: 'grain', quantityDelta: 5, role: 'inventory' },
        { characterId: 'atlas', resourceId: 'money', quantityDelta: -3, role: 'cash' },
    ],
    counterpartyCharacterId: 'birch',
    sourceEvidenceRefs: [{ type: 'fact', id: 'fact-598' }],
    fundingResource: { characterId: 'atlas', resourceId: 'money' },
    logistics: 'Birch releases the shipment from the current depot.',
    timing: { settlementChapters: 0, deadlineChapter: chapter },
    risk: 'The final route audit may delay settlement.',
});
