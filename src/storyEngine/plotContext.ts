import { isRevealAllowed } from './gates';
import {
    getDuePayoffs, getEligibleUnrevealedReveals, getForeshadowCues, getForeshadowReinforcementAge,
    getOpenForeshadowThreads, getOverduePayoffs, getPayoffStatus,
} from './plotQueries';
import type { FullStoryControl, StoryState } from './types';
import { assertModelBoundaryStringsSecretSafe } from './secretTextSafety';

export interface PlotGuidanceSelectionPolicy {
    readonly maxOpenForeshadowThreads: number;
    readonly maxReinforcementCandidates: number;
    readonly maxDuePayoffs: number;
    readonly maxOverduePayoffs: number;
    readonly maxEligibleReveals: number;
    readonly reinforcementAfterChapters: number;
}

export const DEFAULT_PLOT_GUIDANCE_SELECTION_POLICY: PlotGuidanceSelectionPolicy = {
    maxOpenForeshadowThreads: 24,
    maxReinforcementCandidates: 12,
    maxDuePayoffs: 16,
    maxOverduePayoffs: 16,
    maxEligibleReveals: 16,
    reinforcementAfterChapters: 12,
};
export class PlotGuidanceCapacityError extends Error {
    constructor(message: string) { super(message); this.name = 'PlotGuidanceCapacityError'; }
}

export interface PlannerPlotGuidance {
    readonly targetChapter: number;
    readonly eligibleReveals: readonly { readonly id: string; readonly text: string }[];
    readonly openForeshadowThreads: readonly {
        readonly id: string; readonly writerLabel: string; readonly openedChapter: number;
        readonly lastCueChapter?: number; readonly reinforcementCount: number;
    }[];
    readonly reinforcementCandidates: readonly {
        readonly threadId: string; readonly writerLabel: string; readonly chaptersSinceLastCue: number;
    }[];
    readonly duePayoffs: readonly { readonly id: string; readonly writerLabel: string; readonly urgency: 'due' }[];
    readonly overduePayoffs: readonly { readonly id: string; readonly writerLabel: string; readonly urgency: 'overdue' }[];
}

const normalize = (value: PlotGuidanceSelectionPolicy): PlotGuidanceSelectionPolicy => {
    (Object.keys(value) as (keyof PlotGuidanceSelectionPolicy)[]).forEach((key) => {
        if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new PlotGuidanceCapacityError(`invalid plot guidance policy ${key}`);
    });
    return { ...value };
};

export const buildPlannerPlotGuidance = (
    control: FullStoryControl,
    state: StoryState,
    targetChapter: number,
    selectionPolicy: PlotGuidanceSelectionPolicy = DEFAULT_PLOT_GUIDANCE_SELECTION_POLICY,
): PlannerPlotGuidance => {
    const policy = normalize(selectionPolicy);
    const due = getDuePayoffs(state, targetChapter);
    const overdue = getOverduePayoffs(state, targetChapter);
    if (due.length > policy.maxDuePayoffs) throw new PlotGuidanceCapacityError('complete due payoff set exceeds capacity');
    if (overdue.length > policy.maxOverduePayoffs) throw new PlotGuidanceCapacityError('complete overdue payoff set exceeds capacity');
    const open = getOpenForeshadowThreads(state, targetChapter);
    const openProjection = open.map((thread) => {
        const cues = getForeshadowCues(state, thread.id, targetChapter);
        const last = cues.at(-1);
        return {
            id: thread.id, writerLabel: thread.writerLabel, openedChapter: thread.openedChapter,
            ...(last ? { lastCueChapter: last.chapterNumber } : {}),
            reinforcementCount: cues.filter(value => value.cueType === 'reinforcement').length,
        };
    });
    const reinforcementCandidates = open.map((thread) => ({
        threadId: thread.id, writerLabel: thread.writerLabel,
        chaptersSinceLastCue: getForeshadowReinforcementAge(state, thread.id, targetChapter) ?? targetChapter - thread.openedChapter,
    })).filter(value => value.chaptersSinceLastCue >= policy.reinforcementAfterChapters)
        .sort((a, b) => b.chaptersSinceLastCue - a.chaptersSinceLastCue || a.threadId.localeCompare(b.threadId))
        .slice(0, policy.maxReinforcementCandidates);
    const guidance: PlannerPlotGuidance = {
        targetChapter,
        eligibleReveals: getEligibleUnrevealedReveals(control, state, targetChapter).slice(0, policy.maxEligibleReveals),
        openForeshadowThreads: openProjection.slice(0, policy.maxOpenForeshadowThreads),
        reinforcementCandidates,
        duePayoffs: due.map(value => ({ id: value.id, writerLabel: value.writerLabel, urgency: 'due' as const })),
        overduePayoffs: overdue.map(value => ({ id: value.id, writerLabel: value.writerLabel, urgency: 'overdue' as const })),
    };
    assertModelBoundaryStringsSecretSafe(control, guidance, 'plannerPlotGuidance');
    return guidance;
};

export interface ValidatorPlotView {
    readonly targetChapter: number;
    readonly revealDescriptors: readonly {
        readonly id: string; readonly allowed: boolean; readonly occurred: boolean; readonly occurrenceChapter?: number;
    }[];
    readonly payoffDescriptors: readonly {
        readonly id: string; readonly status: ReturnType<typeof getPayoffStatus>;
        readonly earliestPayoffChapter?: number; readonly targetPayoffChapter?: number; readonly latestPayoffChapter?: number;
        readonly linkedRevealId?: string; readonly linkedForeshadowThreadId?: string;
    }[];
    readonly openForeshadowThreadIds: readonly string[];
}

export const buildValidatorPlotView = (
    control: FullStoryControl, state: StoryState, targetChapter: number, maximumItems = 256,
): ValidatorPlotView => {
    if (!Number.isSafeInteger(maximumItems) || maximumItems < 0) throw new PlotGuidanceCapacityError('invalid validator plot capacity');
    const occurrences = new Map(state.ledgers.revealOccurrences.filter(value => value.chapterNumber <= targetChapter)
        .map(value => [value.revealId, value]));
    const revealDescriptors = control.reveals.slice().sort((a, b) => a.id.localeCompare(b.id)).map((value) => {
        const occurrence = occurrences.get(value.id);
        return { id: value.id, allowed: isRevealAllowed(control, value.id, targetChapter), occurred: occurrence !== undefined,
            ...(occurrence ? { occurrenceChapter: occurrence.chapterNumber } : {}) };
    });
    const payoffDescriptors = state.ledgers.payoffObligations.filter(value => value.openedChapter <= targetChapter)
        .slice().sort((a, b) => a.openedChapter - b.openedChapter || a.id.localeCompare(b.id)).map(value => ({
            id: value.id, status: getPayoffStatus(state, value, targetChapter),
            ...(value.earliestPayoffChapter === undefined ? {} : { earliestPayoffChapter: value.earliestPayoffChapter }),
            ...(value.targetPayoffChapter === undefined ? {} : { targetPayoffChapter: value.targetPayoffChapter }),
            ...(value.latestPayoffChapter === undefined ? {} : { latestPayoffChapter: value.latestPayoffChapter }),
            ...(value.linkedRevealId === undefined ? {} : { linkedRevealId: value.linkedRevealId }),
            ...(value.linkedForeshadowThreadId === undefined ? {} : { linkedForeshadowThreadId: value.linkedForeshadowThreadId }),
        }));
    const openForeshadowThreadIds = getOpenForeshadowThreads(state, targetChapter).map(value => value.id);
    if (revealDescriptors.length + payoffDescriptors.length + openForeshadowThreadIds.length > maximumItems) {
        throw new PlotGuidanceCapacityError('validator plot view exceeds capacity');
    }
    return { targetChapter, revealDescriptors, payoffDescriptors, openForeshadowThreadIds };
};
