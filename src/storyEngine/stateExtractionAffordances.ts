import type { StateExtractionContext } from './stateExtractorTypes';

export class StateExtractionAffordanceError extends Error {
    readonly code = 'INVALID_EXTRACTION_AFFORDANCES';

    constructor() {
        super('INVALID_EXTRACTION_AFFORDANCES');
        this.name = 'StateExtractionAffordanceError';
    }
}

export interface StateExtractionAffordances {
    readonly kind: 'state-extraction-affordances';
    readonly targetChapter: number;
    readonly participantIds: readonly string[];
    readonly existingFactIds: readonly string[];
    readonly knownFactIdsByCharacter: Readonly<Record<string, readonly string[]>>;
    readonly existingStatusIdsByParticipant: Readonly<Record<string, readonly string[]>>;
    readonly expectedResourceDeltas: readonly {
        readonly characterId: string;
        readonly resourceId: string;
        readonly name: string;
        readonly quantityDelta?: number;
        readonly nextState?: string;
    }[];
    readonly allowedResourceRefs: readonly {
        readonly characterId: string;
        readonly resourceId: string;
        readonly name: string;
    }[];
    readonly expectedRelationshipDeltas: readonly {
        readonly relationshipId: string;
        readonly participantIds: readonly string[];
        readonly expectedState: string;
    }[];
    readonly allowedRelationshipIds: readonly string[];
    readonly plannedRevealIds: readonly string[];
    readonly cluesPlantedIds: readonly string[];
    readonly cluesPaidOffIds: readonly string[];
    readonly expectedContinuityConsequences: readonly { readonly id: string; readonly text: string }[];
    readonly existingContinuityEntriesNeededForPlan: readonly {
        readonly id: string;
        readonly kind: 'pending-thread' | 'obligation' | 'condition' | 'clue' | 'promise';
        readonly text: string;
        readonly status: 'open' | 'resolved' | 'superseded';
        readonly establishedChapter: number;
    }[];
    readonly continuityTargets: readonly {
        readonly id: string;
        readonly allowedOperations: readonly ('open' | 'resolve' | 'supersede')[];
        readonly requiredKind?: 'clue';
        readonly exactText?: string;
    }[];
    readonly openForeshadowThreadIds: readonly string[];
    readonly openPayoffObligationIds: readonly string[];
}

const fail = (): never => { throw new StateExtractionAffordanceError(); };
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const requireUniqueIds = (values: readonly string[]): void => {
    if (values.some(value => !validId(value)) || new Set(values).size !== values.length) fail();
};
const sameSet = (left: readonly string[], right: readonly string[]): boolean => {
    const orderedLeft = [...left].sort();
    const orderedRight = [...right].sort();
    return orderedLeft.length === orderedRight.length
        && orderedLeft.every((value, index) => value === orderedRight[index]);
};

/**
 * Deterministic, bounded extraction allow-lists derived only from validated Writer-safe
 * context. It introduces no story truth and retains no Author Secret data.
 */
export const buildStateExtractionAffordances = (
    context: StateExtractionContext,
): StateExtractionAffordances => {
    if (!Number.isSafeInteger(context.targetChapter) || context.targetChapter < 1
        || context.chapterPlan.chapterNumber !== context.targetChapter) fail();

    const participantIds = [...context.chapterPlan.participantIds];
    const contextParticipantIds = context.participants.map(value => value.id);
    requireUniqueIds(participantIds);
    requireUniqueIds(contextParticipantIds);
    if (participantIds.length < 1 || !sameSet(participantIds, contextParticipantIds)) fail();
    const participants = new Set(participantIds);

    const existingFactIds = context.writerVisibleFacts.map(value => value.id);
    requireUniqueIds(existingFactIds);
    const knownFactIdsByCharacter = Object.fromEntries(context.characterKnowledge.map((entry) => {
        if (!participants.has(entry.characterId)) fail();
        requireUniqueIds(entry.factIds);
        return [entry.characterId, [...entry.factIds]];
    }));
    const existingStatusIdsByParticipant = Object.fromEntries(context.participants.map((participant) => {
        const statusIds = participant.statuses.map(status => status.id);
        requireUniqueIds(statusIds);
        return [participant.id, statusIds];
    }));

    const resourceKeys = new Set<string>();
    const expectedResourceDeltas = context.chapterPlan.expectedResourceDeltas.map((expected) => {
        const key = `${expected.characterId}\u0000${expected.resourceId}`;
        if (!participants.has(expected.characterId) || resourceKeys.has(key)
            || (expected.quantityDelta === undefined && expected.nextState === undefined)
            || (expected.quantityDelta !== undefined && !Number.isFinite(expected.quantityDelta))
            || (expected.nextState !== undefined && !validId(expected.nextState))) fail();
        resourceKeys.add(key);
        const canonical = context.resources[expected.characterId]?.find(value => value.id === expected.resourceId);
        if (!canonical || !validId(canonical.name)) fail();
        return {
            characterId: expected.characterId, resourceId: expected.resourceId, name: canonical.name,
            ...(expected.quantityDelta === undefined ? {} : { quantityDelta: expected.quantityDelta }),
            ...(expected.nextState === undefined ? {} : { nextState: expected.nextState }),
        };
    });

    const relationshipIds = new Set<string>();
    const expectedRelationshipDeltas = context.chapterPlan.expectedRelationshipDeltas.map((expected) => {
        requireUniqueIds(expected.participantIds);
        if (!validId(expected.relationshipId) || relationshipIds.has(expected.relationshipId)
            || expected.participantIds.length < 2 || !expected.participantIds.every(id => participants.has(id))
            || !validId(expected.expectedState)) fail();
        relationshipIds.add(expected.relationshipId);
        const canonical = context.relationships.find(value => value.id === expected.relationshipId);
        if (canonical && !sameSet(canonical.participantIds, expected.participantIds)) fail();
        return {
            relationshipId: expected.relationshipId,
            participantIds: [...expected.participantIds],
            expectedState: expected.expectedState,
        };
    });

    const plannedRevealIds = context.chapterPlan.reveals.map(value => value.id);
    requireUniqueIds(plannedRevealIds);
    requireUniqueIds(context.controlledRevealIds);
    if (!sameSet(plannedRevealIds, context.controlledRevealIds)) fail();

    const cluesPlantedIds = [...context.chapterPlan.cluesPlantedIds];
    const cluesPaidOffIds = [...context.chapterPlan.cluesPaidOffIds];
    requireUniqueIds(cluesPlantedIds);
    requireUniqueIds(cluesPaidOffIds);
    if (cluesPlantedIds.some(id => cluesPaidOffIds.includes(id))) fail();

    const expectedContinuityConsequences = context.chapterPlan.expectedContinuityConsequences
        .map(value => ({ id: value.id, text: value.text }));
    requireUniqueIds(expectedContinuityConsequences.map(value => value.id));
    if (expectedContinuityConsequences.some(value => !validId(value.text))) fail();

    const continuityTargetIds = [...new Set([
        ...expectedContinuityConsequences.map(value => value.id), ...cluesPlantedIds, ...cluesPaidOffIds,
    ])];
    const existingContinuity = context.existingContinuityEntriesNeededForPlan;
    requireUniqueIds(existingContinuity.map(value => value.id));
    if (existingContinuity.some(value => !continuityTargetIds.includes(value.id)
        || value.status !== 'open' || !validId(value.text))) fail();
    const existingById = new Map(existingContinuity.map(value => [value.id, value]));
    if (cluesPlantedIds.some(id => existingById.has(id))) fail();
    if (cluesPaidOffIds.some((id) => {
        const existing = existingById.get(id);
        return !existing || existing.kind !== 'clue';
    })) fail();
    expectedContinuityConsequences.forEach((expected) => {
        const existing = existingById.get(expected.id);
        if (existing && existing.text !== expected.text) fail();
    });
    const expectedContinuityById = new Map(expectedContinuityConsequences.map(value => [value.id, value]));
    const continuityTargets = continuityTargetIds.map((id) => {
        const existing = existingById.get(id);
        const expected = expectedContinuityById.get(id);
        const planted = cluesPlantedIds.includes(id);
        return {
            id,
            allowedOperations: existing
                ? (cluesPaidOffIds.includes(id) ? ['resolve'] as const : ['resolve', 'supersede'] as const)
                : ['open'] as const,
            ...(planted ? { requiredKind: 'clue' as const } : {}),
            ...(expected === undefined ? {} : { exactText: expected.text }),
        };
    });

    requireUniqueIds(context.openForeshadowThreads.map(value => value.id));
    requireUniqueIds(context.openPayoffObligations.map(value => value.id));
    return {
        kind: 'state-extraction-affordances', targetChapter: context.targetChapter,
        participantIds,
        existingFactIds,
        knownFactIdsByCharacter,
        existingStatusIdsByParticipant,
        expectedResourceDeltas,
        allowedResourceRefs: expectedResourceDeltas.map(value => ({
            characterId: value.characterId, resourceId: value.resourceId, name: value.name,
        })),
        expectedRelationshipDeltas,
        allowedRelationshipIds: expectedRelationshipDeltas.map(value => value.relationshipId),
        plannedRevealIds,
        cluesPlantedIds,
        cluesPaidOffIds,
        expectedContinuityConsequences,
        existingContinuityEntriesNeededForPlan: existingContinuity.map(value => ({ ...value })),
        continuityTargets,
        openForeshadowThreadIds: context.openForeshadowThreads.map(value => value.id),
        openPayoffObligationIds: context.openPayoffObligations.map(value => value.id),
    };
};
