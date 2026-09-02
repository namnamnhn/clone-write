import { assertModelBoundaryStringsSecretSafe } from './secretTextSafety';
import { parseStoryState } from './storyStateRuntime';
import type { StateExtractionContext } from './stateExtractorTypes';
import type { FullStoryControl, StoryState } from './types';
import { buildWriterContext, WriterContextError } from './writerContext';
import {
    DEFAULT_WRITER_CONTEXT_SELECTION_POLICY,
    type WriterContextSelectionPolicy,
} from './writerTypes';
import type { WriterChapterPlan } from './plannerTypes';

export interface StateExtractionContextSelectionPolicy extends WriterContextSelectionPolicy {
    readonly maxPlotItems: number;
    readonly maxStatusesPerCharacter: number;
}

export const DEFAULT_STATE_EXTRACTION_CONTEXT_SELECTION_POLICY: StateExtractionContextSelectionPolicy = {
    ...DEFAULT_WRITER_CONTEXT_SELECTION_POLICY,
    maxPlotItems: 32,
    maxStatusesPerCharacter: 16,
};

export class StateExtractionContextCapacityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StateExtractionContextCapacityError';
    }
}

const normalizePolicy = (
    value: StateExtractionContextSelectionPolicy,
): StateExtractionContextSelectionPolicy => {
    const keys = [
        'maxCharacters', 'maxRelationships', 'maxFacts', 'maxUnresolvedClues',
        'maxUnresolvedPromises', 'maxContinuityEntries', 'maxResourcesPerCharacter',
        'maxPlotItems', 'maxStatusesPerCharacter',
    ] as const;
    keys.forEach((key) => {
        if (!Number.isSafeInteger(value[key]) || value[key] < 1) {
            throw new StateExtractionContextCapacityError(`${key} must be a positive safe integer`);
        }
    });
    return { ...value };
};

const takeRequiredThenRecent = <T extends { readonly id: string }>(
    values: readonly T[],
    requiredIds: ReadonlySet<string>,
    maximum: number,
    label: string,
    chapterOf: (value: T) => number,
): readonly T[] => {
    const required = values.filter(value => requiredIds.has(value.id));
    if (required.length > maximum) {
        throw new StateExtractionContextCapacityError(`${label} requires ${required.length} items but capacity is ${maximum}`);
    }
    const requiredSet = new Set(required.map(value => value.id));
    return [...required, ...values.filter(value => !requiredSet.has(value.id))
        .slice().sort((left, right) => chapterOf(right) - chapterOf(left) || left.id.localeCompare(right.id))
        .slice(0, maximum - required.length)]
        .slice().sort((left, right) => chapterOf(left) - chapterOf(right) || left.id.localeCompare(right.id));
};

/**
 * Builds a strict, bounded, writer-safe allow-list. Neither FullStoryControl nor StoryState
 * is retained in the returned object.
 */
export const buildStateExtractionContext = (
    control: FullStoryControl,
    stateValue: StoryState | unknown,
    chapterPlan: WriterChapterPlan,
    suppliedPolicy: StateExtractionContextSelectionPolicy = DEFAULT_STATE_EXTRACTION_CONTEXT_SELECTION_POLICY,
): StateExtractionContext => {
    const state = parseStoryState(stateValue, control);
    const policy = normalizePolicy(suppliedPolicy);
    let writer: ReturnType<typeof buildWriterContext>;
    try {
        writer = buildWriterContext(control, state, chapterPlan, undefined, undefined, policy);
    } catch (error) {
        if (error instanceof WriterContextError && /capacity|mandatory entries|requires \d+ items/i.test(error.message)) {
            throw new StateExtractionContextCapacityError(error.message);
        }
        throw error;
    }
    const participantIds = new Set(writer.chapterPlan.participantIds);
    const participants = writer.characters.filter(character => participantIds.has(character.id)).map((character) => {
        const projection = state.projections.characters.find(value => value.characterId === character.id);
        const activeStatusIds = new Set(projection?.activeStatusIds ?? []);
        const statuses = state.ledgers.statuses.filter(status => activeStatusIds.has(status.id));
        if (statuses.length > policy.maxStatusesPerCharacter) {
            throw new StateExtractionContextCapacityError(`participant ${character.id} statuses require ${statuses.length} items but capacity is ${policy.maxStatusesPerCharacter}`);
        }
        return {
            id: character.id, name: character.name,
            active: projection?.active ?? false, lifeStatus: projection?.lifeStatus ?? 'unknown',
            ...(writer.characterLocations[character.id] === undefined ? {} : { location: writer.characterLocations[character.id] }),
            statuses: statuses
                .slice().sort((left, right) => left.id.localeCompare(right.id))
                .map(status => ({ id: status.id, kind: status.kind, state: status.state })),
        };
    }).sort((left, right) => left.id.localeCompare(right.id));

    const plannedRevealIds = new Set(writer.chapterPlan.reveals.map(value => value.id));
    const closedForeshadowIds = new Set(state.ledgers.foreshadowLifecycle.map(value => value.threadId));
    const openForeshadow = state.ledgers.foreshadowThreads.filter(value => !closedForeshadowIds.has(value.id));
    const requiredForeshadowIds = new Set(openForeshadow
        .filter(value => value.linkedRevealId !== undefined && plannedRevealIds.has(value.linkedRevealId))
        .map(value => value.id));
    const selectedForeshadow = takeRequiredThenRecent(
        openForeshadow, requiredForeshadowIds, policy.maxPlotItems, 'foreshadow context', value => value.openedChapter,
    );
    const closedPayoffIds = new Set(state.ledgers.payoffLifecycle.map(value => value.payoffId));
    const openPayoffs = state.ledgers.payoffObligations.filter(value => !closedPayoffIds.has(value.id));
    const requiredPayoffIds = new Set(openPayoffs
        .filter(value => value.linkedRevealId !== undefined && plannedRevealIds.has(value.linkedRevealId))
        .map(value => value.id));
    const selectedPayoffs = takeRequiredThenRecent(
        openPayoffs, requiredPayoffIds, policy.maxPlotItems, 'payoff context', value => value.openedChapter,
    );

    const context: StateExtractionContext = {
        kind: 'state-extraction-context', targetChapter: writer.targetChapter, baseRevision: state.revision,
        chapterPlan: structuredClone(writer.chapterPlan), participants,
        writerVisibleFacts: writer.writerVisibleFacts.map(value => ({ ...value })),
        characterKnowledge: writer.characterKnowledge
            .filter(value => participantIds.has(value.characterId))
            .map(value => ({ characterId: value.characterId, factIds: [...value.factIds] })),
        relationships: writer.relationships.map(value => ({ id: value.id, participantIds: [...value.participantIds], state: value.state })),
        resources: Object.fromEntries(Object.entries(writer.resources)
            .filter(([characterId]) => participantIds.has(characterId))
            .map(([characterId, values]) => [characterId, values.map(value => ({ ...value }))])),
        continuity: {
            pendingThreads: writer.continuity.pendingThreads.map(value => ({ text: value.text, establishedChapter: value.establishedChapter })),
            unresolvedClues: writer.unresolvedClues.map(value => ({ ...value })),
            unresolvedPromises: writer.unresolvedPromises.map(value => ({ ...value })),
        },
        controlledRevealIds: writer.controlledReveals.map(value => value.id).sort(),
        openForeshadowThreads: selectedForeshadow.map(value => ({ id: value.id, writerLabel: value.writerLabel })),
        openPayoffObligations: selectedPayoffs.map(value => ({ id: value.id, writerLabel: value.writerLabel })),
    };
    assertModelBoundaryStringsSecretSafe(control, context, 'stateExtractionContext');
    return context;
};
