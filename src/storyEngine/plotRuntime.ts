import type { FullStoryControl } from './types';
import { isRevealAllowed } from './gates';
import type { FactProvenance, NormalizedStoryStateDelta, StoryStateTransitionIssueCode } from './storyStateTypes';
import { StoryStateTransitionError } from './storyStateTypes';
import {
    FORESHADOW_CUE_TYPES, type ForeshadowChange, type ForeshadowCueRecord, type ForeshadowLifecycleRecord,
    type ForeshadowThreadRecord, type PayoffChange, type PayoffLifecycleRecord, type PayoffObligationRecord,
    type PlotLedgers, type RevealChange, type RevealOccurrenceRecord,
} from './plotTypes';

type UnknownRecord = Record<string, unknown>;
const fail = (code: StoryStateTransitionIssueCode, message: string, path: string): never => { throw new StoryStateTransitionError(code, message, path); };
const object = (value: unknown, path: string, allowed: readonly string[], delta: boolean): UnknownRecord => {
    const code = delta ? 'INVALID_DELTA' : 'INVALID_STATE';
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(code, 'expected object', path);
    const source = value as UnknownRecord;
    const extra = Object.keys(source).find(key => !allowed.includes(key));
    if (extra) fail(code, 'unexpected field', `${path}.${extra}`);
    return source;
};
const list = (value: unknown, path: string, delta: boolean): readonly unknown[] => {
    if (!Array.isArray(value)) fail(delta ? 'INVALID_DELTA' : 'INVALID_STATE', 'expected array', path);
    return value as readonly unknown[];
};
const text = (value: unknown, path: string, delta: boolean): string => {
    if (typeof value !== 'string' || !value.trim()) fail(delta ? 'INVALID_DELTA' : 'INVALID_STATE', 'expected non-empty string', path);
    return value as string;
};
const chapter = (value: unknown, path: string, delta: boolean): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 1) fail(delta ? 'INVALID_DELTA' : 'INVALID_STATE', 'expected positive safe integer', path);
    return value as number;
};
const optionalChapter = (source: UnknownRecord, key: string, path: string, delta: boolean) =>
    source[key] === undefined ? undefined : chapter(source[key], `${path}.${key}`, delta);
const optionalText = (source: UnknownRecord, key: string, path: string, delta: boolean) =>
    source[key] === undefined ? undefined : text(source[key], `${path}.${key}`, delta);
const literal = <T extends string>(value: unknown, values: readonly T[], path: string, delta: boolean): T => {
    if (typeof value !== 'string' || !values.includes(value as T)) fail(delta ? 'INVALID_DELTA' : 'INVALID_STATE', 'unexpected enum value', path);
    return value as T;
};
const parseProvenance = (value: unknown, path: string, delta: boolean): FactProvenance => {
    const source = object(value, path, ['sourceChapter', 'sourceType', 'sourceId'], delta);
    const sourceType = literal(source.sourceType, ['chapter', 'canon-rule', 'imported-setup', 'state-transition'] as const, `${path}.sourceType`, delta);
    const sourceId = optionalText(source, 'sourceId', path, delta);
    return { sourceChapter: chapter(source.sourceChapter, `${path}.sourceChapter`, delta), sourceType, ...(sourceId ? { sourceId } : {}) };
};
const assertProvenance = (value: FactProvenance, atChapter: number, path: string): void => {
    if (value.sourceChapter > atChapter) fail('TEMPORAL_VIOLATION', 'plot provenance is in the future', path);
};

export const parseRevealOccurrence = (value: unknown, path: string, delta = false): RevealOccurrenceRecord => {
    const source = object(value, path, ['id', 'revealId', 'chapterNumber', 'provenance'], delta);
    const chapterNumber = chapter(source.chapterNumber, `${path}.chapterNumber`, delta);
    const result = { id: text(source.id, `${path}.id`, delta), revealId: text(source.revealId, `${path}.revealId`, delta), chapterNumber, provenance: parseProvenance(source.provenance, `${path}.provenance`, delta) };
    assertProvenance(result.provenance, chapterNumber, `${path}.provenance`); return result;
};
export const parseForeshadowThread = (value: unknown, path: string, delta = false): ForeshadowThreadRecord => {
    const source = object(value, path, ['id', 'writerLabel', 'openedChapter', 'linkedRevealId', 'linkedPayoffId', 'provenance'], delta);
    const openedChapter = chapter(source.openedChapter, `${path}.openedChapter`, delta);
    const linkedRevealId = optionalText(source, 'linkedRevealId', path, delta); const linkedPayoffId = optionalText(source, 'linkedPayoffId', path, delta);
    const result = { id: text(source.id, `${path}.id`, delta), writerLabel: text(source.writerLabel, `${path}.writerLabel`, delta), openedChapter,
        ...(linkedRevealId ? { linkedRevealId } : {}), ...(linkedPayoffId ? { linkedPayoffId } : {}), provenance: parseProvenance(source.provenance, `${path}.provenance`, delta) };
    assertProvenance(result.provenance, openedChapter, `${path}.provenance`); return result;
};
export const parseForeshadowCue = (value: unknown, path: string, delta = false): ForeshadowCueRecord => {
    const source = object(value, path, ['id', 'threadId', 'chapterNumber', 'cueType', 'writerText', 'provenance'], delta);
    const chapterNumber = chapter(source.chapterNumber, `${path}.chapterNumber`, delta);
    const result = { id: text(source.id, `${path}.id`, delta), threadId: text(source.threadId, `${path}.threadId`, delta), chapterNumber,
        cueType: literal(source.cueType, FORESHADOW_CUE_TYPES, `${path}.cueType`, delta), writerText: text(source.writerText, `${path}.writerText`, delta), provenance: parseProvenance(source.provenance, `${path}.provenance`, delta) };
    assertProvenance(result.provenance, chapterNumber, `${path}.provenance`); return result;
};
export const parseForeshadowLifecycle = (value: unknown, path: string, delta = false): ForeshadowLifecycleRecord => {
    const source = object(value, path, ['id', 'threadId', 'chapterNumber', 'status', 'provenance'], delta);
    const chapterNumber = chapter(source.chapterNumber, `${path}.chapterNumber`, delta);
    const result = { id: text(source.id, `${path}.id`, delta), threadId: text(source.threadId, `${path}.threadId`, delta), chapterNumber,
        status: literal(source.status, ['paid', 'superseded'] as const, `${path}.status`, delta), provenance: parseProvenance(source.provenance, `${path}.provenance`, delta) };
    assertProvenance(result.provenance, chapterNumber, `${path}.provenance`); return result;
};
const validateWindow = (value: PayoffObligationRecord, path: string): void => {
    const ordered = [value.openedChapter, value.earliestPayoffChapter, value.targetPayoffChapter, value.latestPayoffChapter].filter((entry): entry is number => entry !== undefined);
    if (ordered.some((entry, index) => index > 0 && entry < ordered[index - 1])) fail('TEMPORAL_VIOLATION', 'contradictory payoff window', path);
    if (value.revealIsPayoff && !value.linkedRevealId) fail('REFERENTIAL_INTEGRITY_FAILURE', 'reveal payoff requires linked reveal', `${path}.revealIsPayoff`);
    if (value.requiresForeshadowSeed && !value.linkedForeshadowThreadId) fail('REFERENTIAL_INTEGRITY_FAILURE', 'seed requirement needs linked thread', `${path}.requiresForeshadowSeed`);
};
export const parsePayoffObligation = (value: unknown, path: string, delta = false): PayoffObligationRecord => {
    const source = object(value, path, ['id', 'writerLabel', 'openedChapter', 'earliestPayoffChapter', 'targetPayoffChapter', 'latestPayoffChapter', 'linkedForeshadowThreadId', 'linkedRevealId', 'revealIsPayoff', 'requiresForeshadowSeed', 'provenance'], delta);
    if (source.revealIsPayoff !== undefined && source.revealIsPayoff !== true) fail(delta ? 'INVALID_DELTA' : 'INVALID_STATE', 'flag may only be true', `${path}.revealIsPayoff`);
    if (source.requiresForeshadowSeed !== undefined && source.requiresForeshadowSeed !== true) fail(delta ? 'INVALID_DELTA' : 'INVALID_STATE', 'flag may only be true', `${path}.requiresForeshadowSeed`);
    const openedChapter = chapter(source.openedChapter, `${path}.openedChapter`, delta); const earliestPayoffChapter = optionalChapter(source, 'earliestPayoffChapter', path, delta);
    const targetPayoffChapter = optionalChapter(source, 'targetPayoffChapter', path, delta); const latestPayoffChapter = optionalChapter(source, 'latestPayoffChapter', path, delta);
    const linkedForeshadowThreadId = optionalText(source, 'linkedForeshadowThreadId', path, delta); const linkedRevealId = optionalText(source, 'linkedRevealId', path, delta);
    const result: PayoffObligationRecord = { id: text(source.id, `${path}.id`, delta), writerLabel: text(source.writerLabel, `${path}.writerLabel`, delta), openedChapter,
        ...(earliestPayoffChapter === undefined ? {} : { earliestPayoffChapter }), ...(targetPayoffChapter === undefined ? {} : { targetPayoffChapter }),
        ...(latestPayoffChapter === undefined ? {} : { latestPayoffChapter }), ...(linkedForeshadowThreadId ? { linkedForeshadowThreadId } : {}),
        ...(linkedRevealId ? { linkedRevealId } : {}), ...(source.revealIsPayoff === true ? { revealIsPayoff: true as const } : {}),
        ...(source.requiresForeshadowSeed === true ? { requiresForeshadowSeed: true as const } : {}), provenance: parseProvenance(source.provenance, `${path}.provenance`, delta) };
    assertProvenance(result.provenance, openedChapter, `${path}.provenance`); validateWindow(result, path); return result;
};
export const parsePayoffLifecycle = (value: unknown, path: string, delta = false): PayoffLifecycleRecord => {
    const source = object(value, path, ['id', 'payoffId', 'chapterNumber', 'status', 'provenance'], delta); const chapterNumber = chapter(source.chapterNumber, `${path}.chapterNumber`, delta);
    const result = { id: text(source.id, `${path}.id`, delta), payoffId: text(source.payoffId, `${path}.payoffId`, delta), chapterNumber,
        status: literal(source.status, ['paid', 'superseded'] as const, `${path}.status`, delta), provenance: parseProvenance(source.provenance, `${path}.provenance`, delta) };
    assertProvenance(result.provenance, chapterNumber, `${path}.provenance`); return result;
};

const parseMany = <T>(value: unknown, path: string, parser: (entry: unknown, path: string) => T): readonly T[] =>
    list(value, path, false).map((entry, index) => parser(entry, `${path}[${index}]`));
export const parsePlotLedgers = (source: UnknownRecord, path: string): PlotLedgers => ({
    revealOccurrences: parseMany(source.revealOccurrences, `${path}.revealOccurrences`, parseRevealOccurrence),
    foreshadowThreads: parseMany(source.foreshadowThreads, `${path}.foreshadowThreads`, parseForeshadowThread),
    foreshadowCues: parseMany(source.foreshadowCues, `${path}.foreshadowCues`, parseForeshadowCue),
    foreshadowLifecycle: parseMany(source.foreshadowLifecycle, `${path}.foreshadowLifecycle`, parseForeshadowLifecycle),
    payoffObligations: parseMany(source.payoffObligations, `${path}.payoffObligations`, parsePayoffObligation),
    payoffLifecycle: parseMany(source.payoffLifecycle, `${path}.payoffLifecycle`, parsePayoffLifecycle),
});

export const parsePlotDelta = (source: UnknownRecord, deltaChapter: number): Pick<NormalizedStoryStateDelta, 'revealChanges' | 'foreshadowChanges' | 'payoffChanges'> => {
    const revealChanges: RevealChange[] = list(source.revealChanges, 'delta.revealChanges', true).map((entry, index) => {
        const path = `delta.revealChanges[${index}]`; const item = object(entry, path, ['operation', 'occurrence'], true);
        const operation = literal(item.operation, ['record'] as const, `${path}.operation`, true); const occurrence = parseRevealOccurrence(item.occurrence, `${path}.occurrence`, true);
        if (occurrence.chapterNumber !== deltaChapter) fail('TEMPORAL_VIOLATION', 'reveal occurrence must be in delta chapter', path); return { operation, occurrence };
    });
    const foreshadowChanges: ForeshadowChange[] = list(source.foreshadowChanges, 'delta.foreshadowChanges', true).map((entry, index) => {
        const path = `delta.foreshadowChanges[${index}]`; const base = object(entry, path, ['operation', 'thread', 'cue', 'lifecycle'], true);
        const operation = literal(base.operation, ['open', 'add-cue', 'pay', 'supersede'] as const, `${path}.operation`, true);
        if (operation === 'open') { if (base.cue !== undefined || base.lifecycle !== undefined) fail('INVALID_DELTA', 'invalid foreshadow open shape', path); const thread = parseForeshadowThread(base.thread, `${path}.thread`, true); if (thread.openedChapter !== deltaChapter) fail('TEMPORAL_VIOLATION', 'thread must open in delta chapter', path); return { operation, thread }; }
        if (operation === 'add-cue') { if (base.thread !== undefined || base.lifecycle !== undefined) fail('INVALID_DELTA', 'invalid foreshadow cue shape', path); const cue = parseForeshadowCue(base.cue, `${path}.cue`, true); if (cue.chapterNumber !== deltaChapter) fail('TEMPORAL_VIOLATION', 'cue must occur in delta chapter', path); return { operation, cue }; }
        if (base.thread !== undefined || base.cue !== undefined) fail('INVALID_DELTA', 'invalid foreshadow lifecycle shape', path);
        const lifecycle = parseForeshadowLifecycle(base.lifecycle, `${path}.lifecycle`, true); if (lifecycle.chapterNumber !== deltaChapter || lifecycle.status !== (operation === 'pay' ? 'paid' : 'superseded')) fail('TEMPORAL_VIOLATION', 'foreshadow lifecycle must match delta operation and chapter', path);
        return { operation, lifecycle };
    });
    const payoffChanges: PayoffChange[] = list(source.payoffChanges, 'delta.payoffChanges', true).map((entry, index) => {
        const path = `delta.payoffChanges[${index}]`; const base = object(entry, path, ['operation', 'obligation', 'lifecycle'], true);
        const operation = literal(base.operation, ['open', 'resolve', 'supersede'] as const, `${path}.operation`, true);
        if (operation === 'open') { if (base.lifecycle !== undefined) fail('INVALID_DELTA', 'invalid payoff open shape', path); const obligation = parsePayoffObligation(base.obligation, `${path}.obligation`, true); if (obligation.openedChapter !== deltaChapter) fail('TEMPORAL_VIOLATION', 'payoff must open in delta chapter', path); return { operation, obligation }; }
        if (base.obligation !== undefined) fail('INVALID_DELTA', 'invalid payoff lifecycle shape', path);
        const lifecycle = parsePayoffLifecycle(base.lifecycle, `${path}.lifecycle`, true); if (lifecycle.chapterNumber !== deltaChapter || lifecycle.status !== (operation === 'resolve' ? 'paid' : 'superseded')) fail('TEMPORAL_VIOLATION', 'payoff lifecycle must match delta operation and chapter', path);
        return { operation, lifecycle };
    });
    return { revealChanges, foreshadowChanges, payoffChanges };
};

export const validatePlotReferences = (plot: PlotLedgers, currentChapter: number, control?: FullStoryControl): void => {
    const threads = new Map(plot.foreshadowThreads.map(value => [value.id, value])); const payoffs = new Map(plot.payoffObligations.map(value => [value.id, value]));
    const all = [...plot.revealOccurrences, ...plot.foreshadowThreads, ...plot.foreshadowCues, ...plot.foreshadowLifecycle, ...plot.payoffObligations, ...plot.payoffLifecycle];
    const ids = new Set<string>(); all.forEach((value) => { if (ids.has(value.id)) fail('DUPLICATE_ID', 'plot ledger IDs must be globally unique', 'state.ledgers'); ids.add(value.id); });
    plot.revealOccurrences.forEach((value, index) => { if (value.chapterNumber > currentChapter) fail('TEMPORAL_VIOLATION', 'future reveal occurrence', `state.ledgers.revealOccurrences[${index}]`); if (control && !control.reveals.some(reveal => reveal.id === value.revealId)) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown reveal', `state.ledgers.revealOccurrences[${index}].revealId`); if (control && !isRevealAllowed(control, value.revealId, value.chapterNumber)) fail('TEMPORAL_VIOLATION', 'canonical reveal predates its gate', `state.ledgers.revealOccurrences[${index}]`); });
    const revealIds = plot.revealOccurrences.map(value => value.revealId); if (new Set(revealIds).size !== revealIds.length) fail('CONFLICTING_OPERATION', 'duplicate canonical first reveal', 'state.ledgers.revealOccurrences');
    plot.foreshadowThreads.forEach((value, index) => { if (value.openedChapter > currentChapter) fail('TEMPORAL_VIOLATION', 'future foreshadow thread', `state.ledgers.foreshadowThreads[${index}]`); if (control && value.linkedRevealId && !control.reveals.some(reveal => reveal.id === value.linkedRevealId)) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown linked reveal', `state.ledgers.foreshadowThreads[${index}].linkedRevealId`); if (value.linkedPayoffId && !payoffs.has(value.linkedPayoffId)) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown linked payoff', `state.ledgers.foreshadowThreads[${index}].linkedPayoffId`); });
    plot.foreshadowCues.forEach((value, index) => { const thread = threads.get(value.threadId); if (!thread) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown foreshadow thread', `state.ledgers.foreshadowCues[${index}].threadId`); if (value.chapterNumber > currentChapter || value.chapterNumber < thread.openedChapter) fail('TEMPORAL_VIOLATION', 'invalid cue chapter', `state.ledgers.foreshadowCues[${index}]`); });
    plot.foreshadowLifecycle.forEach((value, index) => { const thread = threads.get(value.threadId); if (!thread) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown foreshadow thread', `state.ledgers.foreshadowLifecycle[${index}].threadId`); if (value.chapterNumber > currentChapter || value.chapterNumber < thread.openedChapter) fail('TEMPORAL_VIOLATION', 'invalid foreshadow lifecycle chapter', `state.ledgers.foreshadowLifecycle[${index}]`); });
    const lifecycleThreadIds = plot.foreshadowLifecycle.map(value => value.threadId); if (new Set(lifecycleThreadIds).size !== lifecycleThreadIds.length) fail('CONFLICTING_OPERATION', 'foreshadow thread already closed', 'state.ledgers.foreshadowLifecycle');
    plot.payoffObligations.forEach((value, index) => { if (value.openedChapter > currentChapter) fail('TEMPORAL_VIOLATION', 'future payoff opening', `state.ledgers.payoffObligations[${index}]`); if (value.linkedForeshadowThreadId && !threads.has(value.linkedForeshadowThreadId)) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown linked foreshadow thread', `state.ledgers.payoffObligations[${index}].linkedForeshadowThreadId`); if (control && value.linkedRevealId && !control.reveals.some(reveal => reveal.id === value.linkedRevealId)) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown linked reveal', `state.ledgers.payoffObligations[${index}].linkedRevealId`); });
    plot.payoffLifecycle.forEach((value, index) => { const payoff = payoffs.get(value.payoffId); if (!payoff) fail('REFERENTIAL_INTEGRITY_FAILURE', 'unknown payoff', `state.ledgers.payoffLifecycle[${index}].payoffId`); if (value.chapterNumber > currentChapter || value.chapterNumber < payoff.openedChapter) fail('TEMPORAL_VIOLATION', 'invalid payoff lifecycle chapter', `state.ledgers.payoffLifecycle[${index}]`); if (value.status === 'paid' && payoff.earliestPayoffChapter !== undefined && value.chapterNumber < payoff.earliestPayoffChapter) fail('TEMPORAL_VIOLATION', 'payoff resolved before earliest chapter', `state.ledgers.payoffLifecycle[${index}]`); if (control && value.status === 'paid' && payoff.linkedRevealId && !isRevealAllowed(control, payoff.linkedRevealId, value.chapterNumber)) fail('TEMPORAL_VIOLATION', 'payoff predates linked reveal gate', `state.ledgers.payoffLifecycle[${index}]`); if (value.status === 'paid' && payoff.revealIsPayoff && !plot.revealOccurrences.some(reveal => reveal.revealId === payoff.linkedRevealId && reveal.chapterNumber === value.chapterNumber)) fail('REFERENTIAL_INTEGRITY_FAILURE', 'reveal payoff lacks same-chapter reveal occurrence', `state.ledgers.payoffLifecycle[${index}]`); });
    const lifecyclePayoffIds = plot.payoffLifecycle.map(value => value.payoffId); if (new Set(lifecyclePayoffIds).size !== lifecyclePayoffIds.length) fail('CONFLICTING_OPERATION', 'payoff already closed', 'state.ledgers.payoffLifecycle');
};
