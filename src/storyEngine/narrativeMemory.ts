import { buildCanonCommitReview, prepareCanonCommit } from './canonCommit';
import { canonicalValuesEqual, createCanonProposalIdentity } from './canonicalIdentity';
import { NarrativeMemoryInput, RawChapterMemory, StructuredChapterMemory, LongTermMemory } from './plannerTypes';
import { assertModelBoundaryStringsSecretSafe } from './secretTextSafety';
import { CanonCommitProposal } from './stateExtractorTypes';
import { applyStoryStateDelta, parseStoryState } from './storyStateRuntime';
import { FullStoryControl, StoryState } from './types';
import { ValidationApprovedCandidate } from './validationTypes';
import { validateApprovedExtractionSource, isValidatedExtractionSource } from './stateExtractor';

export interface CanonicalChapterMemoryRecord {
    readonly kind: 'canonical-chapter-memory-record';
    readonly chapterNumber: number;
    readonly canonicalizationSourceIdentity: string;
    readonly proposalIdentity: string;
    readonly raw: RawChapterMemory;
    readonly structured: StructuredChapterMemory;
    readonly longTerm?: LongTermMemory;
}

export interface NarrativeMemoryState {
    readonly kind: 'narrative-memory-state';
    readonly records: readonly CanonicalChapterMemoryRecord[];
}

export const NARRATIVE_MEMORY_SALIENCE_WEIGHTS = {
    reveal: 8,
    payoffResolution: 7,
    relationship: 6,
    activation: 5,
    status: 4,
    continuity: 3,
    fact: 3,
    location: 2,
    resource: 2,
} as const;

export const LONG_TERM_MEMORY_MINIMUM_SALIENCE = 3;

export type NarrativeMemoryErrorCode =
    | 'INVALID_MEMORY_STATE'
    | 'INVALID_CANON_TRANSITION'
    | 'MEMORY_SOURCE_MISMATCH'
    | 'MEMORY_CHAPTER_CONFLICT'
    | 'MEMORY_SECRET_BOUNDARY';

export class NarrativeMemoryError extends Error {
    constructor(readonly code: NarrativeMemoryErrorCode, message: string) {
        super(message);
        this.name = 'NarrativeMemoryError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const createEmptyNarrativeMemoryState = (): NarrativeMemoryState => ({
    kind: 'narrative-memory-state',
    records: [],
});

const requireMemoryState = (value: NarrativeMemoryState): NarrativeMemoryState => {
    if (!value || value.kind !== 'narrative-memory-state' || !Array.isArray(value.records)) {
        throw new NarrativeMemoryError('INVALID_MEMORY_STATE', 'a narrative-memory-state is required');
    }
    let previous = 0;
    const seen = new Set<number>();
    const records = value.records.map((entry) => {
        if (!entry || entry.kind !== 'canonical-chapter-memory-record'
            || !Number.isSafeInteger(entry.chapterNumber) || entry.chapterNumber < 1
            || typeof entry.canonicalizationSourceIdentity !== 'string' || !entry.canonicalizationSourceIdentity
            || typeof entry.proposalIdentity !== 'string' || !entry.proposalIdentity
            || entry.raw?.chapterNumber !== entry.chapterNumber || typeof entry.raw.text !== 'string' || !entry.raw.text.trim()
            || entry.structured?.chapterNumber !== entry.chapterNumber || typeof entry.structured.summary !== 'string' || !entry.structured.summary.trim()
            || (entry.longTerm !== undefined && (entry.longTerm.establishedChapter !== entry.chapterNumber
                || typeof entry.longTerm.id !== 'string' || !entry.longTerm.id
                || typeof entry.longTerm.summary !== 'string' || !entry.longTerm.summary.trim()
                || (entry.longTerm.relevance !== undefined && (!Number.isFinite(entry.longTerm.relevance) || entry.longTerm.relevance < 0))))) {
            throw new NarrativeMemoryError('INVALID_MEMORY_STATE', 'memory contains a malformed record');
        }
        if (seen.has(entry.chapterNumber) || entry.chapterNumber <= previous) {
            throw new NarrativeMemoryError('INVALID_MEMORY_STATE', 'memory chapters must be unique and strictly increasing');
        }
        seen.add(entry.chapterNumber);
        previous = entry.chapterNumber;
        return structuredClone(entry);
    });
    return { kind: 'narrative-memory-state', records };
};

export const buildNarrativeMemoryInput = (memoryState: NarrativeMemoryState): NarrativeMemoryInput => {
    const state = requireMemoryState(memoryState);
    return {
        recentRawChapters: state.records.map(entry => structuredClone(entry.raw)),
        structuredRecentSummaries: state.records.map(entry => structuredClone(entry.structured)),
        selectedLongTermMemories: state.records.flatMap(entry => entry.longTerm === undefined ? [] : [structuredClone(entry.longTerm)]),
    };
};

const safeName = (control: FullStoryControl, id: string): string => control.characters[id]?.name ?? id;

const buildStructuredMemory = (
    control: FullStoryControl,
    approved: ValidationApprovedCandidate,
    proposal: CanonCommitProposal,
): StructuredChapterMemory => {
    const plan = approved.source.chapterPlan;
    const review = buildCanonCommitReview(proposal.delta);
    const participants = plan.participantIds.map(id => safeName(control, id));
    const parts: string[] = [];
    if (approved.draft.title !== undefined) parts.push(`Chapter title: ${approved.draft.title}.`);
    parts.push(`Goal: ${plan.primaryGoal}.`);
    if (participants.length > 0) parts.push(`Participants: ${participants.join(', ')}.`);
    parts.push(`End state: ${plan.endStateIntent}.`);
    review.facts.forEach(entry => parts.push(`Canon fact: ${entry.text}.`));
    review.locations.forEach(entry => parts.push(`${safeName(control, entry.characterId)} moved to ${entry.location}.`));
    review.statuses.forEach((entry) => {
        if (entry.operation === 'add' && entry.record !== undefined) {
            parts.push(`${safeName(control, entry.record.characterId)} status: ${entry.record.state}.`);
        } else if (entry.operation === 'resolve' && entry.statusId !== undefined) {
            parts.push(`A prior character status was resolved.`);
        }
    });
    review.activations.forEach(entry => parts.push(`${safeName(control, entry.characterId)} became ${entry.active ? 'active' : 'inactive'}${entry.lifeStatus === undefined ? '' : ` (${entry.lifeStatus})`}.`));
    review.relationships.forEach(entry => parts.push(`Relationship among ${entry.participantIds.map(id => safeName(control, id)).join(', ')} became ${entry.state}.`));
    review.resources.forEach((entry) => {
        const quantity = entry.quantityDelta === undefined ? '' : ` changed by ${entry.quantityDelta}`;
        const state = entry.nextState === undefined ? '' : ` and became ${entry.nextState}`;
        parts.push(`${safeName(control, entry.characterId)} resource ${entry.name}${quantity}${state}.`);
    });
    review.continuity.forEach((entry) => {
        if (entry.operation === 'open' && entry.entry !== undefined) parts.push(`Continuity opened: ${entry.entry.text}.`);
        else parts.push(`A prior continuity obligation was ${entry.operation === 'resolve' ? 'resolved' : 'superseded'}.`);
    });
    review.reveals.forEach((entry) => {
        const reveal = plan.reveals.find(value => value.id === entry.occurrence.revealId);
        if (reveal !== undefined) parts.push(`Canonical reveal: ${reveal.text}.`);
    });
    review.foreshadow.forEach((entry) => {
        if (entry.operation === 'open') parts.push(`Foreshadow opened: ${entry.thread.writerLabel}.`);
        if (entry.operation === 'add-cue') parts.push(`Foreshadow cue: ${entry.cue.writerText}.`);
        if (entry.operation === 'pay') parts.push('A foreshadow thread paid off.');
        if (entry.operation === 'supersede') parts.push('A foreshadow thread was superseded.');
    });
    review.payoffs.forEach((entry) => {
        if (entry.operation === 'open') parts.push(`Payoff obligation opened: ${entry.obligation.writerLabel}.`);
        if (entry.operation === 'resolve') parts.push('A payoff obligation was resolved.');
        if (entry.operation === 'supersede') parts.push('A payoff obligation was superseded.');
    });
    const factIds = [...new Set([
        ...review.facts.map(value => value.id),
        ...review.epistemic.flatMap(value => value.factId === undefined ? [] : [value.factId]),
    ])].sort();
    return {
        chapterNumber: proposal.targetChapter,
        summary: parts.join(' '),
        ...(factIds.length === 0 ? {} : { factIds }),
    };
};

const salienceFor = (proposal: CanonCommitProposal): number => {
    const review = buildCanonCommitReview(proposal.delta);
    return review.reveals.length * NARRATIVE_MEMORY_SALIENCE_WEIGHTS.reveal
        + review.payoffs.filter(entry => entry.operation === 'resolve').length * NARRATIVE_MEMORY_SALIENCE_WEIGHTS.payoffResolution
        + review.relationships.length * NARRATIVE_MEMORY_SALIENCE_WEIGHTS.relationship
        + review.activations.length * NARRATIVE_MEMORY_SALIENCE_WEIGHTS.activation
        + review.statuses.length * NARRATIVE_MEMORY_SALIENCE_WEIGHTS.status
        + review.continuity.length * NARRATIVE_MEMORY_SALIENCE_WEIGHTS.continuity
        + review.facts.length * NARRATIVE_MEMORY_SALIENCE_WEIGHTS.fact
        + review.locations.length * NARRATIVE_MEMORY_SALIENCE_WEIGHTS.location
        + review.resources.length * NARRATIVE_MEMORY_SALIENCE_WEIGHTS.resource;
};

export interface RecordCanonicalChapterMemoryRequest {
    readonly control: FullStoryControl;
    readonly beforeState: StoryState | unknown;
    readonly afterState: StoryState | unknown;
    readonly approved: ValidationApprovedCandidate | unknown;
    readonly proposal: CanonCommitProposal | unknown;
    readonly memoryState: NarrativeMemoryState;
}

export const recordCanonicalChapterMemory = (request: RecordCanonicalChapterMemoryRequest): NarrativeMemoryState => {
    const memory = requireMemoryState(request.memoryState);
    try {
        assertModelBoundaryStringsSecretSafe(request.control, memory, 'narrativeMemoryState');
    } catch {
        throw new NarrativeMemoryError('MEMORY_SECRET_BOUNDARY', 'existing narrative memory failed the protected-text boundary');
    }
    let before: StoryState;
    let after: StoryState;
    try {
        before = parseStoryState(request.beforeState, request.control);
        after = parseStoryState(request.afterState, request.control);
    } catch {
        throw new NarrativeMemoryError('INVALID_CANON_TRANSITION', 'strict before and after Canon states are required');
    }
    const validated = validateApprovedExtractionSource(request.approved, before, request.control);
    if (!isValidatedExtractionSource(validated)) {
        throw new NarrativeMemoryError('MEMORY_SOURCE_MISMATCH', 'approved source does not match the Canon transition');
    }
    const approved = validated.approved;
    const proposalValue = request.proposal;
    if (!isRecord(proposalValue) || proposalValue.kind !== 'canon-commit-proposal' || proposalValue.status !== 'ready-for-review') {
        throw new NarrativeMemoryError('MEMORY_SOURCE_MISMATCH', 'a ready-for-review proposal is required');
    }
    const proposal = proposalValue as unknown as CanonCommitProposal;
    if (proposal.storyControlId !== request.control.id || proposal.baseChapter !== before.currentChapter
        || proposal.baseRevision !== before.revision || proposal.targetChapter !== before.currentChapter + 1
        || proposal.targetChapter !== after.currentChapter || after.revision !== before.revision + 1
        || proposal.sourceIdentity !== validated.source.canonicalizationSourceIdentity
        || proposal.source.canonicalizationSourceIdentity !== validated.source.canonicalizationSourceIdentity
        || !canonicalValuesEqual(proposal.source, validated.source)) {
        throw new NarrativeMemoryError('MEMORY_SOURCE_MISMATCH', 'proposal lineage does not match the committed approved source');
    }
    const recomputedProposalIdentity = createCanonProposalIdentity({
        sourceIdentity: proposal.sourceIdentity, storyControlId: proposal.storyControlId,
        baseChapter: proposal.baseChapter, baseRevision: proposal.baseRevision,
        targetChapter: proposal.targetChapter, delta: proposal.delta,
    });
    if (recomputedProposalIdentity !== proposal.proposalIdentity) {
        throw new NarrativeMemoryError('MEMORY_SOURCE_MISMATCH', 'proposal identity is invalid');
    }
    const prepared = prepareCanonCommit({
        approved, state: before, control: request.control,
        extraction: { status: 'extracted-not-canon', sourceIdentity: proposal.sourceIdentity, delta: proposal.delta },
    });
    if (prepared.status !== 'ready-for-review' || prepared.proposalIdentity !== proposal.proposalIdentity) {
        throw new NarrativeMemoryError('MEMORY_SOURCE_MISMATCH', 'proposal cannot be reproduced from the approved source');
    }
    let expected: StoryState;
    try {
        expected = applyStoryStateDelta(request.control, before, proposal.delta);
    } catch {
        throw new NarrativeMemoryError('INVALID_CANON_TRANSITION', 'proposal delta cannot produce the committed state');
    }
    if (!canonicalValuesEqual(expected, after)) {
        throw new NarrativeMemoryError('INVALID_CANON_TRANSITION', 'afterState is not the exact committed proposal result');
    }
    const existing = memory.records.find(entry => entry.chapterNumber === proposal.targetChapter);
    if (existing !== undefined) {
        if (existing.canonicalizationSourceIdentity === proposal.sourceIdentity && existing.proposalIdentity === proposal.proposalIdentity) {
            return request.memoryState;
        }
        throw new NarrativeMemoryError('MEMORY_CHAPTER_CONFLICT', 'a different canonical source is already recorded for this chapter');
    }
    const structured = buildStructuredMemory(request.control, approved, proposal);
    const relevance = salienceFor(proposal);
    const record: CanonicalChapterMemoryRecord = {
        kind: 'canonical-chapter-memory-record', chapterNumber: proposal.targetChapter,
        canonicalizationSourceIdentity: proposal.sourceIdentity, proposalIdentity: proposal.proposalIdentity,
        raw: { chapterNumber: proposal.targetChapter, text: approved.draft.prose },
        structured,
        ...(relevance < LONG_TERM_MEMORY_MINIMUM_SALIENCE ? {} : {
            longTerm: {
                id: `canonical-memory:${proposal.targetChapter}:${proposal.proposalIdentity}`,
                establishedChapter: proposal.targetChapter,
                summary: structured.summary,
                relevance,
            },
        }),
    };
    try {
        assertModelBoundaryStringsSecretSafe(request.control, record, 'canonicalChapterMemory');
    } catch {
        throw new NarrativeMemoryError('MEMORY_SECRET_BOUNDARY', 'canonical memory failed the protected-text boundary');
    }
    return { kind: 'narrative-memory-state', records: [...memory.records, record] };
};
