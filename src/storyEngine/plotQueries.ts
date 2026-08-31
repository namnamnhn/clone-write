import { isRevealAllowed } from './gates';
import type {
    AuthorSecretStatus, ForeshadowCueRecord, ForeshadowThreadRecord, ForeshadowThreadStatus,
    PayoffObligationRecord, PayoffStatus, RevealOccurrenceRecord,
} from './plotTypes';
import type { FullStoryControl, StoryState } from './types';

const copy = <T>(value: T): T => structuredClone(value);
const byChapterId = <T extends { readonly id: string }>(chapter: (value: T) => number) =>
    (left: T, right: T): number => chapter(left) - chapter(right) || left.id.localeCompare(right.id);

const assertTarget = (state: StoryState, targetChapter: number): void => {
    if (!Number.isSafeInteger(targetChapter) || targetChapter < 1) throw new Error('invalid target chapter');
    void state;
};

export const hasRevealOccurred = (state: StoryState, revealId: string, targetChapter: number): boolean => {
    assertTarget(state, targetChapter);
    return state.ledgers.revealOccurrences.some(value => value.revealId === revealId && value.chapterNumber <= targetChapter);
};

export const getRevealOccurrence = (state: StoryState, revealId: string, targetChapter: number): RevealOccurrenceRecord | undefined => {
    assertTarget(state, targetChapter);
    const value = state.ledgers.revealOccurrences.find(entry => entry.revealId === revealId && entry.chapterNumber <= targetChapter);
    return value ? copy(value) : undefined;
};

export const getRevealsOccurredByChapter = (state: StoryState, targetChapter: number): readonly RevealOccurrenceRecord[] => {
    assertTarget(state, targetChapter);
    return state.ledgers.revealOccurrences.filter(value => value.chapterNumber <= targetChapter)
        .slice().sort(byChapterId(value => value.chapterNumber)).map(copy);
};

export const getEligibleUnrevealedReveals = (control: FullStoryControl, state: StoryState, targetChapter: number) => {
    if (!Number.isSafeInteger(targetChapter) || targetChapter < 1) throw new Error('invalid target chapter');
    return control.reveals.filter(value => isRevealAllowed(control, value.id, targetChapter)
        && !state.ledgers.revealOccurrences.some(entry => entry.revealId === value.id && entry.chapterNumber <= targetChapter))
        .slice().sort((a, b) => a.id.localeCompare(b.id)).map(value => ({ id: value.id, text: value.writerText }));
};

export const getAuthorSecretStatus = (
    control: FullStoryControl, state: StoryState, secretId: string, targetChapter: number,
): AuthorSecretStatus => {
    const secret = control.authorOnlySecrets.find(value => value.id === secretId);
    if (!secret) throw new Error('unknown author secret');
    if (!secret.revealId) return 'author-only';
    if (state.ledgers.revealOccurrences.some(value => value.revealId === secret.revealId && value.chapterNumber <= targetChapter)) return 'revealed';
    return isRevealAllowed(control, secret.revealId, targetChapter) ? 'eligible-not-revealed' : 'locked';
};

export const getForeshadowCues = (state: StoryState, threadId: string, targetChapter: number): readonly ForeshadowCueRecord[] => {
    assertTarget(state, targetChapter);
    return state.ledgers.foreshadowCues.filter(value => value.threadId === threadId && value.chapterNumber <= targetChapter)
        .slice().sort(byChapterId(value => value.chapterNumber)).map(copy);
};

export const getLastForeshadowCue = (state: StoryState, threadId: string, targetChapter: number): ForeshadowCueRecord | undefined =>
    getForeshadowCues(state, threadId, targetChapter).at(-1);

export const getForeshadowReinforcementAge = (state: StoryState, threadId: string, targetChapter: number): number | undefined => {
    const cue = getLastForeshadowCue(state, threadId, targetChapter);
    return cue ? targetChapter - cue.chapterNumber : undefined;
};

export const getForeshadowThreadStatus = (state: StoryState, threadId: string, targetChapter: number): ForeshadowThreadStatus => {
    assertTarget(state, targetChapter);
    const lifecycle = state.ledgers.foreshadowLifecycle.filter(value => value.threadId === threadId && value.chapterNumber <= targetChapter)
        .slice().sort(byChapterId(value => value.chapterNumber)).at(-1);
    return lifecycle?.status ?? 'open';
};

export const getOpenForeshadowThreads = (state: StoryState, targetChapter: number): readonly ForeshadowThreadRecord[] => {
    assertTarget(state, targetChapter);
    return state.ledgers.foreshadowThreads.filter(value => value.openedChapter <= targetChapter
        && getForeshadowThreadStatus(state, value.id, targetChapter) === 'open')
        .slice().sort(byChapterId(value => value.openedChapter)).map(copy);
};

export const getPayoffStatus = (state: StoryState, obligation: PayoffObligationRecord, targetChapter: number): PayoffStatus => {
    assertTarget(state, targetChapter);
    const lifecycle = state.ledgers.payoffLifecycle.filter(value => value.payoffId === obligation.id && value.chapterNumber <= targetChapter)
        .slice().sort(byChapterId(value => value.chapterNumber)).at(-1);
    if (lifecycle?.status === 'superseded') return 'superseded';
    if (lifecycle?.status === 'paid') return obligation.latestPayoffChapter !== undefined && lifecycle.chapterNumber > obligation.latestPayoffChapter ? 'paid-late' : 'paid';
    if (obligation.latestPayoffChapter !== undefined && targetChapter > obligation.latestPayoffChapter) return 'overdue';
    const dueFrom = obligation.targetPayoffChapter ?? obligation.earliestPayoffChapter;
    return dueFrom !== undefined && targetChapter >= dueFrom ? 'due' : 'not-due';
};

export const PAYOFF_APPROACHING_CHAPTERS = 5;
export type PayoffUrgency = 'dormant' | 'approaching' | 'due' | 'overdue' | 'resolved';
export const getPayoffUrgency = (state: StoryState, obligation: PayoffObligationRecord, targetChapter: number, approachingChapters: number = PAYOFF_APPROACHING_CHAPTERS): PayoffUrgency => {
    if (!Number.isSafeInteger(approachingChapters) || approachingChapters < 0) throw new Error('approaching payoff threshold must be a non-negative safe integer');
    const status = getPayoffStatus(state, obligation, targetChapter);
    if (status === 'overdue') return 'overdue';
    if (status === 'due') return 'due';
    if (status === 'paid' || status === 'paid-late' || status === 'superseded') return 'resolved';
    const dueChapter = obligation.targetPayoffChapter ?? obligation.earliestPayoffChapter;
    return dueChapter !== undefined && dueChapter - targetChapter <= approachingChapters ? 'approaching' : 'dormant';
};

export const getOpenPayoffs = (state: StoryState, targetChapter: number) => state.ledgers.payoffObligations
    .filter(value => value.openedChapter <= targetChapter && ['not-due', 'due', 'overdue'].includes(getPayoffStatus(state, value, targetChapter)))
    .slice().sort(byChapterId(value => value.openedChapter)).map(copy);
export const getDuePayoffs = (state: StoryState, targetChapter: number) => getOpenPayoffs(state, targetChapter)
    .filter(value => getPayoffStatus(state, value, targetChapter) === 'due');
export const getOverduePayoffs = (state: StoryState, targetChapter: number) => getOpenPayoffs(state, targetChapter)
    .filter(value => getPayoffStatus(state, value, targetChapter) === 'overdue');
export const getPayoffsLinkedToReveal = (state: StoryState, revealId: string) => state.ledgers.payoffObligations
    .filter(value => value.linkedRevealId === revealId).slice().sort(byChapterId(value => value.openedChapter)).map(copy);
export const getPayoffsLinkedToForeshadow = (state: StoryState, threadId: string) => state.ledgers.payoffObligations
    .filter(value => value.linkedForeshadowThreadId === threadId).slice().sort(byChapterId(value => value.openedChapter)).map(copy);
