import {
    applyStoryStateDelta,
    buildValidationReport,
    compileStoryControl,
    createInitialStoryState,
    createValidationIssue,
    POLITICAL_DIMENSIONS,
    sanitizeWriterChapterPlan,
} from '../../src/storyEngine';
import type {
    InternalChapterPlan,
    PoliticalActionPlan,
    RelationshipActionPlan,
    StoryBlueprint,
    StoryState,
    StoryStateDelta,
    WriterChapterDraft,
} from '../../src/storyEngine';
import type { StoryStudioSession } from '../../src/storyStudio/storyStudioTypes';

const provenance = (chapter: number) => ({
    sourceChapter: chapter,
    sourceType: 'chapter' as const,
    sourceId: `chapter-${chapter}`,
});

const relationshipPolicy = {
    maxMajorMilestoneAdvancePerChapter: 1,
    maxConsecutiveProgressionChapters: 2,
    requireCanonicalBasis: true as const,
    requireMutualAgencyForMutualMilestone: true as const,
};

const relationshipProfile = {
    coreDynamicTags: ['professional-equals' as const, 'slow-earned-trust' as const],
    dominantConflictSources: ['Competing public duties.'],
    trustBasis: ['Repeated reliable choices.'],
    respectBasis: ['Professional competence.'],
    prohibitedShortcuts: [] as const,
};

const blueprint: StoryBlueprint = {
    id: 'presenter-fixture-story',
    engine: { plannedChapterCount: 180 },
    characters: [
        { id: 'linh', name: 'Linh An', availableFromChapter: 1, writerProfile: { role: 'Lighthouse keeper' } },
        { id: 'minh', name: 'Minh Kha', availableFromChapter: 1, writerProfile: { role: 'Minister' } },
        { id: 'future', name: 'Future Character', availableFromChapter: 40, writerProfile: { role: 'Locked' } },
    ],
    arcs: [{ id: 'arc-bao-den', title: 'Bão Đen trên Vịnh Bắc', startChapter: 1, endChapter: 180 }],
    beats: [{ id: 'beat-phong-tuyen', arcId: 'arc-bao-den', order: 1, startChapter: 1, endChapter: 180 }],
    reveals: [{ id: 'future-reveal', writerText: 'A controlled reveal available only from chapter forty.' }],
    relationshipDefinitions: [{
        id: 'linh-minh', participantIds: ['linh', 'minh'], categories: ['romantic', 'professional'],
        initialRomanceMilestone: 'awareness', dynamicProfile: relationshipProfile, progressionPolicy: relationshipPolicy,
    }],
    gates: {
        characters: [
            { id: 'linh-character', characterId: 'linh', allowedFromChapter: 1 },
            { id: 'minh-character', characterId: 'minh', allowedFromChapter: 1 },
            { id: 'future-character', characterId: 'future', allowedFromChapter: 40 },
        ],
        pov: [{ id: 'linh-pov', characterId: 'linh', allowedFromChapter: 1 }],
        reveals: [{ id: 'future-reveal-gate', revealId: 'future-reveal', allowedFromChapter: 40 }],
        relationships: [],
        events: [],
    },
    authorOnlySecrets: [{ id: 'future-secret', value: 'PROTECTED_FIXTURE_SECRET', revealId: 'future-reveal' }],
    canonRules: [
        { id: 'current-law', text: 'The council charter is active.', availableFromChapter: 1, scope: 'canon' },
        { id: 'future-law', text: 'The emergency charter starts at chapter forty.', availableFromChapter: 40, scope: 'canon' },
    ],
};

const control = compileStoryControl(blueprint);

const delta = (chapter: number, values: Partial<StoryStateDelta> = {}): StoryStateDelta => ({
    kind: 'story-state-delta',
    schemaVersion: 1,
    chapterNumber: chapter,
    expectedRevision: chapter - 1,
    factChanges: [],
    epistemicChanges: [],
    locationChanges: [],
    statusChanges: [],
    activationChanges: [],
    relationshipChanges: [],
    resourceChanges: [],
    continuityChanges: [],
    ...values,
});

const buildCanonicalState = (): StoryState => {
    let state = createInitialStoryState();
    for (let chapter = 1; chapter <= 12; chapter += 1) {
        const changes: Partial<StoryStateDelta> = chapter === 1 ? {
            activationChanges: [
                { characterId: 'linh', active: true, lifeStatus: 'alive', provenance: provenance(1) },
                { characterId: 'minh', active: true, lifeStatus: 'alive', provenance: provenance(1) },
            ],
            locationChanges: [
                { id: 'location-linh-1', characterId: 'linh', location: 'North Lighthouse', sinceChapter: 1, provenance: provenance(1) },
                { id: 'location-minh-1', characterId: 'minh', location: 'Council Hall', sinceChapter: 1, provenance: provenance(1) },
            ],
            statusChanges: [{
                operation: 'add',
                record: { id: 'status-minh-minister', characterId: 'minh', kind: 'status', state: 'Minister', establishedChapter: 1, provenance: provenance(1) },
                provenance: provenance(1),
            }],
            relationshipChanges: [{
                id: 'relationship-linh-minh-1', relationshipId: 'linh-minh', participantIds: ['linh', 'minh'],
                state: 'awareness', chapterNumber: 1, provenance: provenance(1),
            }],
        } : chapter === 2 ? {
            factChanges: [{
                id: 'actor-fact', text: 'Minh knows the council schedule.', establishedChapter: 2,
                visibility: 'writer', status: 'active', provenance: provenance(2),
            }],
            epistemicChanges: [{
                id: 'knowledge-minh-schedule', characterId: 'minh', kind: 'known', factId: 'actor-fact',
                learnedChapter: 2, source: { type: 'witnessed', sourceChapter: 2 }, status: 'active',
            }, {
                id: 'belief-linh-weather', characterId: 'linh', kind: 'believed', claim: 'The storm may arrive early.',
                learnedChapter: 2, source: { type: 'witnessed', sourceChapter: 2 }, status: 'active',
            }],
        } : chapter === 12 ? {
            continuityChanges: [{
                operation: 'open',
                entry: {
                    id: 'continuity-supply-route', kind: 'obligation', text: 'The supply route remains open.',
                    visibility: 'writer', establishedChapter: 12, status: 'open', provenance: provenance(12),
                },
                provenance: provenance(12),
            }],
        } : {};
        state = applyStoryStateDelta(control, state, delta(chapter, changes));
    }
    return state;
};

const politicalAction: PoliticalActionPlan = {
    id: 'political-council', domain: 'politics', sceneIds: ['politics-scene'], importance: 'minor',
    actorCharacterId: 'minh', objective: 'Secure a lawful council decision.', uncertainty: 'The council may delay.',
    expectedCostOrTradeoff: 'Minh spends political capital.',
    writerVisibleConstraints: ['Council procedure must remain visible.'], actorKnowledgeFactIds: ['actor-fact'],
    relationshipEffects: [], noCountermoveReason: 'No organized countermove occurs in this minor setup.',
    dimensions: POLITICAL_DIMENSIONS.map((dimension) => {
        if (dimension === 'authority') return { dimension, status: 'supporting' as const, evidenceRefs: [{ type: 'character-status' as const, characterId: 'minh', value: 'Minister' }] };
        if (dimension === 'information') return { dimension, status: 'supporting' as const, evidenceRefs: [{ type: 'knowledge' as const, characterId: 'minh', factId: 'actor-fact' }] };
        if (dimension === 'law') return { dimension, status: 'supporting' as const, evidenceRefs: [{ type: 'canon-rule' as const, id: 'current-law' }] };
        return { dimension, status: dimension === 'time' ? 'neutral' as const : 'unknown' as const, evidenceRefs: [] };
    }),
    timing: { earliestChapter: 13, deadlineChapter: 13, preparationChapters: 1 },
    resourceEffects: [],
};

const relationshipAction: RelationshipActionPlan = {
    id: 'relationship-trust', sceneIds: ['relationship-scene'], relationshipId: 'linh-minh',
    participantIds: ['linh', 'minh'], category: 'romantic', actionType: 'deepen-trust', importance: 'minor',
    currentStateAssessment: {
        trust: 'moderate', respect: 'moderate', attraction: 'emerging', emotionalOpenness: 'emerging',
        dependency: 'low', conflict: 'moderate', sharedInterest: 'moderate', powerBalance: 'balanced',
    },
    currentRomanceMilestone: 'awareness',
    intendedProgression: {
        direction: 'strengthening', romanticMilestone: 'interest', expectedState: 'interest', mutual: false, intermediate: false,
    },
    participantAgency: [
        {
            characterId: 'linh', currentGoal: 'Protect the lighthouse.', desiredOutcome: 'Earn cautious trust.',
            boundary: 'No pressure.', choice: 'Share the route and accept uncertainty.', willingness: 'yes',
            uncertainty: 'Minh may refuse.', costOrRisk: 'Linh exposes limited vulnerability.', knowledgeBasisFactIds: [],
        },
        {
            characterId: 'minh', currentGoal: 'Protect council authority.', desiredOutcome: 'Judge Linh by conduct.',
            boundary: 'No romantic promise.', choice: 'Acknowledge help without commitment.', willingness: 'uncertain',
            uncertainty: 'Linh may withdraw.', costOrRisk: 'Minh risks limited trust.', knowledgeBasisFactIds: [],
        },
    ],
    boundaries: [],
    evidenceRefs: [{ type: 'relationship', id: 'linh-minh' }],
    counterpressure: 'Competing duties limit trust.', uncertainty: 'The bond may remain cautious.',
    expectedCostOrTradeoff: 'Both expose limited vulnerability.', powerImbalanceAddressed: true,
    writerVisibleContract: {
        currentDynamic: 'Cautious professional equals.', objective: 'Let trust emerge through choice.',
        visibleConflict: 'Both protect their duties.', visibleUncertainty: 'Either may keep distance.',
    },
};

const internalPlan: InternalChapterPlan = {
    kind: 'internal-chapter-plan', chapterNumber: 13, arcId: 'arc-bao-den', beatId: 'beat-phong-tuyen',
    primaryGoal: 'Advance a lawful decision and one earned relationship beat.',
    povCharacterId: 'linh', participantIds: ['linh', 'minh'],
    scenes: [{
        id: 'politics-scene', order: 1, goal: 'Force a lawful council choice.', location: 'Council Hall',
        povCharacterId: 'linh', participantIds: ['linh', 'minh'], conflictOrObstacle: 'The council may delay.',
        uncertainty: 'The vote may fail.', expectedConsequence: 'Political capital is spent.',
        purposeTags: ['politics'], conflictImportance: 'minor',
    }, {
        id: 'relationship-scene', order: 2, goal: 'Force a voluntary trust choice.', location: 'North Lighthouse',
        povCharacterId: 'linh', participantIds: ['linh', 'minh'], conflictOrObstacle: 'Their duties diverge.',
        uncertainty: 'Cooperation may fail.', expectedConsequence: 'Trust changes only if earned.',
        purposeTags: ['relationship'], conflictImportance: 'minor',
    }],
    activeConstraintIds: ['current-law'], allowedRevealIds: [], plannedRevealIds: [],
    relationshipEventIds: [], storyEventIds: [], cluesPlantedIds: [], cluesPaidOffIds: [],
    expectedResourceDeltas: [],
    expectedRelationshipDeltas: [{ relationshipId: 'linh-minh', participantIds: ['linh', 'minh'], expectedState: 'interest' }],
    expectedContinuityConsequences: [],
    strategicActions: [politicalAction], relationshipActions: [relationshipAction],
    endStateIntent: 'Stop before Canon is updated.',
};

const state = buildCanonicalState();
const writerPlan = sanitizeWriterChapterPlan(internalPlan, control, state);

const writerDraft: WriterChapterDraft = {
    kind: 'writer-chapter-draft', validationStatus: 'unvalidated', chapterNumber: 13,
    title: 'The Council Route', prose: 'Linh and Minh make a bounded, voluntary choice while the council follows procedure.',
};

const validationReport = buildValidationReport(13, 1, [
    createValidationIssue('FILLER_SCENE', 'warning', 'semantic-validator', 'scene', 'politics-scene'),
]);

export const STORY_STUDIO_PRESENTER_FIXTURE: StoryStudioSession = {
    mode: 'connected',
    projectTitle: 'Presenter Fixture Story',
    control,
    state,
    internalPlan,
    writerPlan,
    writerDraft,
    validationReport,
    approvalStatus: 'approved-not-canon',
};
