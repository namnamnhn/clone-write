import {
    applyStoryStateDelta,
    buildPlannerContext,
    buildValidatorContext,
    buildWriterContext,
    createInitialStoryState,
    getArcForChapter,
    getBeatForChapter,
    sanitizeWriterChapterPlan,
} from '../../src/storyEngine';
import type {
    CharacterActivationChange,
    ContinuityChange,
    EpistemicAddition,
    FactProvenance,
    ForeshadowChange,
    InternalChapterPlan,
    PlannerContext,
    PlannerModel,
    RepairModel,
    ResourceChange,
    RevealChange,
    SemanticValidatorModel,
    StrategicActionPlan,
    StoryState,
    StoryStateDelta,
    StoryStateDeltaV2,
    WriterChapterPlan,
    WriterModel,
    PayoffChange,
    RelationshipChange,
} from '../../src/storyEngine';
import {
    LONG_RUN_CHECKPOINTS,
    LONG_RUN_CHAPTER_COUNT,
    LONG_RUN_CONTROL,
    LONG_RUN_MEMORY,
} from '../fixtures/storyEngineLongRunFixture';

const pad = (chapter: number): string => String(chapter).padStart(3, '0');

export const longRunProvenance = (chapter: number): FactProvenance => ({
    sourceChapter: chapter,
    sourceType: 'chapter',
    sourceId: `chapter-${pad(chapter)}`,
});

const romanceMilestones = new Map<number, string>([
    [60, 'awareness'], [140, 'interest'], [220, 'attraction'], [300, 'trust-building'],
    [380, 'mutual-tension'], [460, 'acknowledged-interest'], [540, 'courtship'],
    [560, 'committed-romance'],
]);

const professionalStates = new Map<number, string>([
    [100, 'cautious-cooperation'], [150, 'professional-respect'], [200, 'principled-rivalry'],
    [250, 'earned-cooperation'], [309, 'formal-alliance'], [400, 'strategic-disagreement'],
    [500, 'renewed-respect'], [600, 'durable-professional-partnership'],
]);

const activationChangesFor = (chapter: number): readonly CharacterActivationChange[] => {
    const ids = new Map<number, readonly string[]>([
        [1, ['atlas', 'birch']], [33, ['cinder']], [47, ['dune']], [201, ['cinder', 'ember']],
        [291, ['fable']], [501, ['gale']], [561, ['harbor']],
    ]);
    const changes = (ids.get(chapter) ?? []).map(characterId => ({
        characterId, active: true, lifeStatus: 'alive' as const, provenance: longRunProvenance(chapter),
    }));
    if (chapter === 180) return [...changes, {
        characterId: 'cinder', active: false, lifeStatus: 'alive', provenance: longRunProvenance(chapter),
    }];
    return changes;
};

const locationChangesFor = (chapter: number): StoryStateDelta['locationChanges'] => {
    const arrivals = new Map<number, readonly string[]>([
        [1, ['atlas', 'birch']], [33, ['cinder']], [47, ['dune']], [201, ['ember']],
        [291, ['fable']], [501, ['gale']], [561, ['harbor']],
    ]);
    const output = (arrivals.get(chapter) ?? []).map(characterId => ({
        id: `location-${characterId}-${pad(chapter)}`,
        characterId,
        location: `station-${Math.ceil(chapter / 100)}`,
        sinceChapter: chapter,
        provenance: longRunProvenance(chapter),
    }));
    if (chapter % 25 === 0) output.push({
        id: `location-atlas-${pad(chapter)}`,
        characterId: 'atlas',
        location: `route-${chapter / 25}`,
        sinceChapter: chapter,
        provenance: longRunProvenance(chapter),
    });
    return output;
};

const statusChangesFor = (chapter: number): StoryStateDelta['statusChanges'] => {
    if (chapter === 1) return [{
        operation: 'add',
        record: {
            id: 'status-atlas-coordinator', characterId: 'atlas', kind: 'role', state: 'coordinator',
            establishedChapter: 1, provenance: longRunProvenance(1),
        },
        provenance: longRunProvenance(1),
    }];
    if (chapter === 100 || chapter === 250) {
        const condition = chapter === 100 ? 'injury' as const : 'condition' as const;
        return [{
            operation: 'add',
            record: {
                id: chapter === 100 ? 'status-atlas-wound' : 'status-atlas-exhaustion',
                characterId: 'atlas', kind: condition,
                state: chapter === 100 ? 'arm-wound' : 'exhaustion',
                establishedChapter: chapter, provenance: longRunProvenance(chapter),
            },
            provenance: longRunProvenance(chapter),
        }];
    }
    if (chapter === 120 || chapter === 275) return [{
        operation: 'resolve',
        statusId: chapter === 120 ? 'status-atlas-wound' : 'status-atlas-exhaustion',
        resolvedChapter: chapter,
        provenance: longRunProvenance(chapter),
    }];
    return [];
};

const epistemicChangesFor = (chapter: number): readonly EpistemicAddition[] => {
    const output: EpistemicAddition[] = [];
    if (chapter % 12 === 0) {
        const factId = `fact-${pad(chapter)}`;
        const source = chapter % 36 === 0
            ? { type: 'inference' as const, sourceChapter: chapter, basisFactIds: [`fact-${pad(chapter - 12)}`] }
            : chapter % 48 === 0
                ? { type: 'told-by-character' as const, sourceChapter: chapter, sourceCharacterId: 'birch' }
                : chapter % 24 === 0
                    ? { type: 'document' as const, sourceChapter: chapter, sourceFactId: factId }
                    : { type: 'public-information' as const, sourceChapter: chapter };
        output.push({
            id: `knowledge-atlas-${pad(chapter)}`,
            characterId: 'atlas', kind: 'known', factId, learnedChapter: chapter, source, status: 'active',
        });
    }
    if (chapter % 5 === 0) output.push({
        id: `belief-birch-${pad(chapter)}`,
        characterId: 'birch', kind: 'believed', claim: `Belief ${pad(chapter)} remains distinct from Canon.`,
        learnedChapter: chapter, source: { type: 'witnessed', sourceChapter: chapter }, status: 'active',
    });
    return output;
};

const resourceChangesFor = (chapter: number): readonly ResourceChange[] => {
    const changes: ResourceChange[] = [{
        id: `resource-money-${pad(chapter)}`, characterId: 'atlas', resourceId: 'money', name: 'Money',
        quantityDelta: chapter % 2 === 0 ? -2 : 3, provenance: longRunProvenance(chapter),
    }];
    const periodic = [
        { every: 2, id: 'grain', name: 'Grain', delta: 5 },
        { every: 3, id: 'fuel', name: 'Fuel', delta: 2 },
        { every: 5, id: 'troops', name: 'Troops', delta: 1 },
        { every: 20, id: 'ships', name: 'Ships', delta: 1 },
        { every: 7, id: 'political-capital', name: 'Political Capital', delta: 2 },
    ];
    periodic.forEach((resource) => {
        if (chapter % resource.every !== 0) return;
        changes.push({
            id: `resource-${resource.id}-${pad(chapter)}`, characterId: 'atlas',
            resourceId: resource.id, name: resource.name, quantityDelta: resource.delta,
            provenance: longRunProvenance(chapter),
        });
    });
    return changes;
};

const continuityChangesFor = (chapter: number): readonly ContinuityChange[] => {
    const output: ContinuityChange[] = [];
    if (chapter <= 120) {
        const kinds = ['pending-thread', 'obligation', 'condition', 'clue', 'promise'] as const;
        output.push({
            operation: 'open',
            entry: {
                id: `continuity-${pad(chapter)}`,
                kind: kinds[(chapter - 1) % kinds.length],
                text: `Continuity item ${pad(chapter)} remains current until explicitly closed.`,
                visibility: chapter % 3 === 0 ? 'internal' : 'writer',
                establishedChapter: chapter,
                status: 'open',
                provenance: longRunProvenance(chapter),
            },
            provenance: longRunProvenance(chapter),
        });
    }
    if (chapter >= 151 && chapter <= 190) {
        const sequence = chapter - 150;
        output.push({
            operation: sequence % 2 === 0 ? 'supersede' : 'resolve',
            continuityId: `continuity-${pad(sequence)}`,
            chapterNumber: chapter,
            provenance: longRunProvenance(chapter),
        });
    }
    if (chapter >= 200 && chapter % 20 === 0) output.push({
        operation: 'open',
        entry: {
            id: `continuity-late-${pad(chapter)}`, kind: 'pending-thread',
            text: `Late continuity ${pad(chapter)} remains active.`, visibility: 'writer',
            establishedChapter: chapter, status: 'open', provenance: longRunProvenance(chapter),
        },
        provenance: longRunProvenance(chapter),
    });
    if (chapter === 599) output.push({
        operation: 'open',
        entry: {
            id: 'continuity-final', kind: 'obligation', text: 'The final audit remains visible.',
            visibility: 'writer', establishedChapter: 599, status: 'open', provenance: longRunProvenance(599),
        },
        provenance: longRunProvenance(599),
    });
    return output;
};

const relationshipChangesFor = (chapter: number): readonly RelationshipChange[] => {
    const output: RelationshipChange[] = [];
    const romance = romanceMilestones.get(chapter);
    if (romance) output.push({
        id: `relationship-atlas-birch-${pad(chapter)}`, relationshipId: 'atlas-birch',
        participantIds: ['atlas', 'birch'], state: romance, chapterNumber: chapter,
        provenance: longRunProvenance(chapter),
    });
    const professional = professionalStates.get(chapter);
    if (professional) output.push({
        id: `relationship-atlas-cinder-${pad(chapter)}`, relationshipId: 'atlas-cinder',
        participantIds: ['atlas', 'cinder'], state: professional, chapterNumber: chapter,
        provenance: longRunProvenance(chapter),
    });
    return output;
};

const plotChangesFor = (chapter: number): {
    readonly revealChanges: readonly RevealChange[];
    readonly foreshadowChanges: readonly ForeshadowChange[];
    readonly payoffChanges: readonly PayoffChange[];
} => {
    const provenance = longRunProvenance(chapter);
    const revealChanges: RevealChange[] = [];
    const foreshadowChanges: ForeshadowChange[] = [];
    const payoffChanges: PayoffChange[] = [];
    if (chapter === 10) {
        foreshadowChanges.push(
            { operation: 'open', thread: { id: 'foreshadow-early', writerLabel: 'The altered route ledger', openedChapter: 10, linkedPayoffId: 'payoff-early', provenance } },
            { operation: 'add-cue', cue: { id: 'cue-early-seed', threadId: 'foreshadow-early', chapterNumber: 10, cueType: 'seed', writerText: 'A route total does not balance.', provenance } },
        );
        payoffChanges.push(
            { operation: 'open', obligation: { id: 'payoff-early', writerLabel: 'Resolve the altered route ledger', openedChapter: 10, earliestPayoffChapter: 250, targetPayoffChapter: 300, latestPayoffChapter: 320, linkedForeshadowThreadId: 'foreshadow-early', requiresForeshadowSeed: true, provenance } },
            { operation: 'open', obligation: { id: 'payoff-paid-late', writerLabel: 'Settle the delayed convoy promise', openedChapter: 10, earliestPayoffChapter: 200, targetPayoffChapter: 250, latestPayoffChapter: 275, provenance } },
        );
    }
    if (chapter === 33) {
        foreshadowChanges.push(
            { operation: 'open', thread: { id: 'foreshadow-long', writerLabel: 'The unnamed final witness', openedChapter: 33, linkedRevealId: 'reveal-omega', linkedPayoffId: 'payoff-reveal', provenance } },
            { operation: 'add-cue', cue: { id: 'cue-long-seed', threadId: 'foreshadow-long', chapterNumber: 33, cueType: 'seed', writerText: 'A witness line remains blank.', provenance } },
        );
        payoffChanges.push({ operation: 'open', obligation: {
            id: 'payoff-reveal', writerLabel: 'Identify the final witness', openedChapter: 33,
            earliestPayoffChapter: 561, targetPayoffChapter: 575, latestPayoffChapter: 590,
            linkedForeshadowThreadId: 'foreshadow-long', linkedRevealId: 'reveal-omega',
            revealIsPayoff: true, requiresForeshadowSeed: true, provenance,
        } });
    }
    if (chapter === 47) revealChanges.push({ operation: 'record', occurrence: {
        id: 'occurrence-beta', revealId: 'reveal-beta', chapterNumber: 47, provenance,
    } });
    if (chapter === 100) foreshadowChanges.push({ operation: 'add-cue', cue: {
        id: 'cue-early-reinforcement', threadId: 'foreshadow-early', chapterNumber: 100,
        cueType: 'reinforcement', writerText: 'The route discrepancy appears again.', provenance,
    } });
    if (chapter === 200) {
        foreshadowChanges.push(
            { operation: 'open', thread: { id: 'foreshadow-middle', writerLabel: 'The contested seal', openedChapter: 200, linkedPayoffId: 'payoff-superseded', provenance } },
            { operation: 'add-cue', cue: { id: 'cue-middle-seed', threadId: 'foreshadow-middle', chapterNumber: 200, cueType: 'seed', writerText: 'Two seals carry the same notch.', provenance } },
        );
        payoffChanges.push({ operation: 'open', obligation: {
            id: 'payoff-superseded', writerLabel: 'Resolve the contested seal', openedChapter: 200,
            targetPayoffChapter: 430, latestPayoffChapter: 470, linkedForeshadowThreadId: 'foreshadow-middle',
            requiresForeshadowSeed: true, provenance,
        } });
    }
    if (chapter === 250) foreshadowChanges.push({ operation: 'add-cue', cue: {
        id: 'cue-early-final', threadId: 'foreshadow-early', chapterNumber: 250,
        cueType: 'reinforcement', writerText: 'The altered route points to a deliberate hand.', provenance,
    } });
    if (chapter === 291) foreshadowChanges.push({ operation: 'add-cue', cue: {
        id: 'cue-long-reinforcement', threadId: 'foreshadow-long', chapterNumber: 291,
        cueType: 'reinforcement', writerText: 'The blank witness line survives another audit.', provenance,
    } });
    if (chapter === 300) {
        foreshadowChanges.push({ operation: 'pay', lifecycle: {
            id: 'foreshadow-early-paid', threadId: 'foreshadow-early', chapterNumber: 300, status: 'paid', provenance,
        } });
        payoffChanges.push(
            { operation: 'resolve', lifecycle: { id: 'payoff-early-paid', payoffId: 'payoff-early', chapterNumber: 300, status: 'paid', provenance } },
            { operation: 'resolve', lifecycle: { id: 'payoff-late-paid', payoffId: 'payoff-paid-late', chapterNumber: 300, status: 'paid', provenance } },
        );
    }
    if (chapter === 350) foreshadowChanges.push({ operation: 'add-cue', cue: {
        id: 'cue-middle-reinforcement', threadId: 'foreshadow-middle', chapterNumber: 350,
        cueType: 'reinforcement', writerText: 'The duplicate seal is challenged.', provenance,
    } });
    if (chapter === 400) payoffChanges.push({ operation: 'open', obligation: {
        id: 'payoff-overdue', writerLabel: 'Close the northern supply liability', openedChapter: 400,
        earliestPayoffChapter: 480, targetPayoffChapter: 500, latestPayoffChapter: 550, provenance,
    } });
    if (chapter === 450) {
        foreshadowChanges.push({ operation: 'supersede', lifecycle: {
            id: 'foreshadow-middle-superseded', threadId: 'foreshadow-middle', chapterNumber: 450,
            status: 'superseded', provenance,
        } });
        payoffChanges.push({ operation: 'supersede', lifecycle: {
            id: 'payoff-middle-superseded', payoffId: 'payoff-superseded', chapterNumber: 450,
            status: 'superseded', provenance,
        } });
    }
    if (chapter === 550) revealChanges.push({ operation: 'record', occurrence: {
        id: 'occurrence-alpha', revealId: 'reveal-alpha', chapterNumber: 550, provenance,
    } });
    if (chapter === 575) {
        revealChanges.push({ operation: 'record', occurrence: {
            id: 'occurrence-omega', revealId: 'reveal-omega', chapterNumber: 575, provenance,
        } });
        foreshadowChanges.push({ operation: 'pay', lifecycle: {
            id: 'foreshadow-long-paid', threadId: 'foreshadow-long', chapterNumber: 575, status: 'paid', provenance,
        } });
        payoffChanges.push({ operation: 'resolve', lifecycle: {
            id: 'payoff-reveal-paid', payoffId: 'payoff-reveal', chapterNumber: 575, status: 'paid', provenance,
        } });
    }
    if (chapter === 590) payoffChanges.push({ operation: 'open', obligation: {
        id: 'payoff-due-final', writerLabel: 'Complete the final ledger audit', openedChapter: 590,
        earliestPayoffChapter: 600, targetPayoffChapter: 600, latestPayoffChapter: 600, provenance,
    } });
    return { revealChanges, foreshadowChanges, payoffChanges };
};

/**
 * TEST HARNESS CANON ADVANCEMENT ONLY. This deterministic delta is predefined from the fixture;
 * it is never extracted from a Writer draft and does not represent a production Make Canon flow.
 */
export const createLongRunDelta = (chapter: number): StoryStateDelta | StoryStateDeltaV2 => {
    const plot = plotChangesFor(chapter);
    const common = {
        kind: 'story-state-delta' as const,
        chapterNumber: chapter,
        expectedRevision: chapter - 1,
        factChanges: [{
            id: `fact-${pad(chapter)}`,
            text: `Canonical fact ${pad(chapter)}.`,
            establishedChapter: chapter,
            visibility: chapter % 2 === 0 ? 'writer' as const : 'internal' as const,
            status: 'active' as const,
            provenance: longRunProvenance(chapter),
        }],
        epistemicChanges: epistemicChangesFor(chapter),
        locationChanges: locationChangesFor(chapter),
        statusChanges: statusChangesFor(chapter),
        activationChanges: activationChangesFor(chapter),
        relationshipChanges: relationshipChangesFor(chapter),
        resourceChanges: resourceChangesFor(chapter),
        continuityChanges: continuityChangesFor(chapter),
    };
    const usesV2 = plot.revealChanges.length + plot.foreshadowChanges.length + plot.payoffChanges.length > 0;
    return usesV2 ? { ...common, schemaVersion: 2, ...plot } : { ...common, schemaVersion: 1 };
};

export interface LongRunResult {
    readonly finalState: StoryState;
    readonly checkpoints: ReadonlyMap<number, StoryState>;
    readonly v1ChapterCount: number;
    readonly v2ChapterCount: number;
}

export const runLongRun = (
    startState: StoryState = createInitialStoryState(),
    targetChapter = LONG_RUN_CHAPTER_COUNT,
): LongRunResult => {
    let state = startState;
    const checkpoints = new Map<number, StoryState>();
    if (LONG_RUN_CHECKPOINTS.includes(state.currentChapter as typeof LONG_RUN_CHECKPOINTS[number])) {
        checkpoints.set(state.currentChapter, state);
    }
    let v1ChapterCount = 0;
    let v2ChapterCount = 0;
    for (let chapter = state.currentChapter + 1; chapter <= targetChapter; chapter += 1) {
        const delta = createLongRunDelta(chapter);
        if (delta.schemaVersion === 1) v1ChapterCount += 1;
        else v2ChapterCount += 1;
        state = applyStoryStateDelta(LONG_RUN_CONTROL, state, delta);
        if (LONG_RUN_CHECKPOINTS.includes(chapter as typeof LONG_RUN_CHECKPOINTS[number])) checkpoints.set(chapter, state);
    }
    return { finalState: state, checkpoints, v1ChapterCount, v2ChapterCount };
};

let cachedLongRun: LongRunResult | undefined;
export const getLongRun = (): LongRunResult => {
    cachedLongRun ??= runLongRun();
    return cachedLongRun;
};

export const expectedResourceQuantities = (): Readonly<Record<string, number>> => {
    const totals: Record<string, number> = {
        money: 0, grain: 0, fuel: 0, troops: 0, ships: 0, 'political-capital': 0,
    };
    for (let chapter = 1; chapter <= LONG_RUN_CHAPTER_COUNT; chapter += 1) {
        totals.money += chapter % 2 === 0 ? -2 : 3;
        if (chapter % 2 === 0) totals.grain += 5;
        if (chapter % 3 === 0) totals.fuel += 2;
        if (chapter % 5 === 0) totals.troops += 1;
        if (chapter % 20 === 0) totals.ships += 1;
        if (chapter % 7 === 0) totals['political-capital'] += 2;
    }
    return totals;
};

export const buildSampleInternalPlan = (
    context: PlannerContext,
    strategicActions: readonly StrategicActionPlan[] = [],
): InternalChapterPlan => {
    const povCharacterId = strategicActions.length > 0 ? 'atlas' : context.targetChapter >= 561 ? 'harbor' : 'atlas';
    const participantIds = new Set<string>([povCharacterId]);
    strategicActions.forEach((action) => {
        participantIds.add(action.actorCharacterId);
        if (action.domain === 'commerce') {
            if (action.counterpartyCharacterId) participantIds.add(action.counterpartyCharacterId);
            if (action.competitorCharacterId) participantIds.add(action.competitorCharacterId);
        }
    });
    const expectedResourceDeltas = strategicActions.flatMap(action => action.domain === 'commerce'
        ? action.resourceFlows.map(flow => ({
            characterId: flow.characterId, resourceId: flow.resourceId, quantityDelta: flow.quantityDelta,
        }))
        : action.resourceEffects.map(effect => ({ ...effect })));
    return {
        kind: 'internal-chapter-plan',
        chapterNumber: context.targetChapter,
        arcId: context.currentArc.id,
        ...(context.currentBeat === undefined ? {} : { beatId: context.currentBeat.id }),
        primaryGoal: 'Advance the bounded structural sample.',
        povCharacterId,
        participantIds: [...participantIds],
        scenes: [{
            id: `scene-${context.targetChapter}`, order: 1, goal: 'Complete the sampled chapter action.',
            location: `sample-location-${context.targetChapter}`, povCharacterId, participantIds: [...participantIds],
            conflictOrObstacle: 'Time remains limited.', uncertainty: 'The audit may expose a mismatch.',
            expectedConsequence: 'The sampled action ends without mutating Canon.',
            purposeTags: strategicActions.length > 0 ? [strategicActions[0].domain] : ['plot'], conflictImportance: 'minor',
        }],
        activeConstraintIds: context.activeHardConstraints.map(value => value.id),
        allowedRevealIds: context.allowedRevealIds,
        plannedRevealIds: [], relationshipEventIds: [], storyEventIds: [],
        cluesPlantedIds: [], cluesPaidOffIds: [], expectedResourceDeltas,
        expectedRelationshipDeltas: [], expectedContinuityConsequences: [],
        strategicActions, relationshipActions: [],
        endStateIntent: 'Stop before TEST HARNESS CANON ADVANCEMENT.',
    };
};

export const buildSampleWriterPlan = (state: StoryState, targetChapter: number): WriterChapterPlan => {
    const context = buildPlannerContext(LONG_RUN_CONTROL, state, targetChapter, LONG_RUN_MEMORY);
    return sanitizeWriterChapterPlan(buildSampleInternalPlan(context), LONG_RUN_CONTROL, state);
};

export interface LongRunContextMetrics {
    readonly chapter: number;
    readonly planner: {
        readonly characters: number;
        readonly writerFacts: number;
        readonly internalFacts: number;
        readonly knowledgeFactRefs: number;
        readonly relationships: number;
        readonly clues: number;
        readonly promises: number;
        readonly continuity: number;
        readonly resources: number;
        readonly rawMemory: number;
        readonly summaries: number;
        readonly longTerm: number;
    };
    readonly writer: {
        readonly characters: number;
        readonly facts: number;
        readonly relationships: number;
        readonly continuity: number;
        readonly resources: number;
    };
    readonly validator: {
        readonly lockedCharacters: number;
        readonly lockedReveals: number;
        readonly plotItems: number;
    };
    readonly canon: {
        readonly facts: number;
        readonly epistemic: number;
        readonly relationships: number;
        readonly resources: number;
        readonly continuity: number;
        readonly events: number;
    };
}

export const measureContextAt = (targetChapter: 100 | 300 | 600): LongRunContextMetrics => {
    const run = getLongRun();
    const prior = run.checkpoints.get(targetChapter - 1);
    const canonical = run.checkpoints.get(targetChapter);
    if (!prior || !canonical) throw new Error(`missing long-run checkpoint for chapter ${targetChapter}`);
    const planner = buildPlannerContext(LONG_RUN_CONTROL, prior, targetChapter, LONG_RUN_MEMORY);
    const writerPlan = sanitizeWriterChapterPlan(buildSampleInternalPlan(planner), LONG_RUN_CONTROL, prior);
    const writer = buildWriterContext(LONG_RUN_CONTROL, prior, writerPlan, LONG_RUN_MEMORY);
    const validator = buildValidatorContext(LONG_RUN_CONTROL, prior, writerPlan);
    return {
        chapter: targetChapter,
        planner: {
            characters: planner.availableCharacters.length,
            writerFacts: planner.writerVisibleFacts.length,
            internalFacts: planner.internalFacts.length,
            knowledgeFactRefs: planner.characterKnowledge.reduce((sum, value) => sum + value.factIds.length, 0),
            relationships: planner.relationships.length,
            clues: planner.unresolvedClues.length,
            promises: planner.unresolvedPromises.length,
            continuity: planner.continuity.pendingThreads.length + planner.continuity.notes.length,
            resources: Object.values(planner.resources).reduce((sum, values) => sum + values.length, 0),
            rawMemory: planner.narrativeMemory.recentRawChapters.length,
            summaries: planner.narrativeMemory.structuredRecentSummaries.length,
            longTerm: planner.narrativeMemory.selectedLongTermMemories.length,
        },
        writer: {
            characters: writer.characters.length,
            facts: writer.writerVisibleFacts.length,
            relationships: writer.relationships.length,
            continuity: writer.continuity.pendingThreads.length + writer.continuity.notes.length,
            resources: Object.values(writer.resources).reduce((sum, values) => sum + values.length, 0),
        },
        validator: {
            lockedCharacters: validator.gates.lockedCharacters.length,
            lockedReveals: validator.gates.lockedReveals.length,
            plotItems: validator.plotView.revealDescriptors.length
                + validator.plotView.payoffDescriptors.length + validator.plotView.openForeshadowThreadIds.length,
        },
        canon: {
            facts: canonical.ledgers.facts.length,
            epistemic: canonical.ledgers.epistemic.length,
            relationships: canonical.ledgers.relationships.length,
            resources: canonical.ledgers.resources.length,
            continuity: canonical.ledgers.continuity.length,
            events: canonical.ledgers.events.length,
        },
    };
};

export const deterministicPlannerModel: PlannerModel = {
    async plan(context) { return buildSampleInternalPlan(context); },
};

export const deterministicWriterModel: WriterModel = {
    async write(request) {
        return {
            kind: 'writer-chapter-draft', chapterNumber: request.context.targetChapter,
            prose: `A compact offline draft for chapter ${request.context.targetChapter}.`,
        };
    },
};

export const deterministicSemanticValidatorModel: SemanticValidatorModel = {
    async validate(request) {
        return { kind: 'semantic-validation-result', chapterNumber: request.chapterNumber, issues: [] };
    },
};

export const deterministicRepairModel: RepairModel = {
    async repair(request) {
        return {
            kind: 'writer-chapter-draft', chapterNumber: request.context.targetChapter,
            prose: `A corrected compact offline draft for chapter ${request.context.targetChapter}.`,
        };
    },
};

export const arcAndBeatAt = (chapter: number) => ({
    arc: getArcForChapter(LONG_RUN_CONTROL, chapter),
    beat: getBeatForChapter(LONG_RUN_CONTROL, chapter),
});
