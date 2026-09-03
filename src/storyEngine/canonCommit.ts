import { applyStoryStateDelta, parseStoryState, parseStoryStateDelta } from './storyStateRuntime';
import type { StoryStateDeltaV2 } from './storyStateTypes';
import {
    type CanonCommitProposal,
    type CanonCommitReview,
    MakeCanonError,
    type MakeCanonConfirmation,
    type MakeCanonRequest,
    type PrepareCanonCommitRequest,
    type PrepareCanonCommitResult,
    type StateExtractionIssue,
} from './stateExtractorTypes';
import {
    normalizeStateExtractionIssues,
    isValidatedExtractionSource,
    validateApprovedExtractionSource,
    validateStateExtractionContract,
} from './stateExtractor';
import type { StoryState } from './types';
import { canonicalValuesEqual, createCanonProposalIdentity, createStoryControlIdentity } from './canonicalIdentity';

export const DEFAULT_MAX_CANON_REVIEW_CHANGES = 128;

class CanonReviewCapacityError extends Error {
    constructor() {
        super('canon review capacity exceeded');
        this.name = 'CanonReviewCapacityError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const blocked = (issues: readonly StateExtractionIssue[]): PrepareCanonCommitResult => ({
    status: 'blocked', issues: normalizeStateExtractionIssues(issues),
});

const statusKey = (value: StoryStateDeltaV2['statusChanges'][number]): string =>
    value.operation === 'add' ? value.record!.id : value.statusId!;
const continuityKey = (value: StoryStateDeltaV2['continuityChanges'][number]): string =>
    value.operation === 'open' ? value.entry!.id : value.continuityId!;
const foreshadowKey = (value: StoryStateDeltaV2['foreshadowChanges'][number]): string =>
    value.operation === 'open' ? value.thread.id : value.operation === 'add-cue' ? value.cue.id : value.lifecycle.id;
const payoffKey = (value: StoryStateDeltaV2['payoffChanges'][number]): string =>
    value.operation === 'open' ? value.obligation.id : value.lifecycle.id;

const by = <T>(key: (value: T) => string) => (left: T, right: T): number => key(left).localeCompare(key(right));

/** Complete typed review projection. Every V2 operation appears exactly once. */
export const buildCanonCommitReview = (
    deltaValue: StoryStateDeltaV2 | unknown,
    maxTotalChanges = DEFAULT_MAX_CANON_REVIEW_CHANGES,
): CanonCommitReview => {
    if (!Number.isSafeInteger(maxTotalChanges) || maxTotalChanges < 0) throw new CanonReviewCapacityError();
    if (!isRecord(deltaValue) || deltaValue.schemaVersion !== 2) throw new Error('Canon review requires StoryStateDelta V2');
    const delta = parseStoryStateDelta(deltaValue);
    const totalChanges = delta.factChanges.length + delta.epistemicChanges.length + delta.locationChanges.length
        + delta.statusChanges.length + delta.activationChanges.length + delta.relationshipChanges.length
        + delta.resourceChanges.length + delta.continuityChanges.length + delta.revealChanges.length
        + delta.foreshadowChanges.length + delta.payoffChanges.length;
    if (totalChanges > maxTotalChanges) throw new CanonReviewCapacityError();
    return {
        kind: 'canon-commit-review', totalChanges,
        facts: [...structuredClone(delta.factChanges)].sort(by(value => value.id)),
        epistemic: [...structuredClone(delta.epistemicChanges)].sort(by(value => value.id)),
        locations: [...structuredClone(delta.locationChanges)].sort(by(value => value.id)),
        statuses: [...structuredClone(delta.statusChanges)].sort(by(statusKey)),
        activations: [...structuredClone(delta.activationChanges)].sort(by(value => value.characterId)),
        relationships: [...structuredClone(delta.relationshipChanges)].sort(by(value => value.relationshipId)),
        resources: [...structuredClone(delta.resourceChanges)].sort(by(value => `${value.characterId}\u0000${value.resourceId}\u0000${value.id}`)),
        continuity: [...structuredClone(delta.continuityChanges)].sort(by(continuityKey)),
        reveals: [...structuredClone(delta.revealChanges)].sort(by(value => `${value.occurrence.revealId}\u0000${value.occurrence.id}`)),
        foreshadow: [...structuredClone(delta.foreshadowChanges)].sort(by(foreshadowKey)),
        payoffs: [...structuredClone(delta.payoffChanges)].sort(by(payoffKey)),
    };
};

const representabilityIssues = (source: CanonCommitProposal['source']): readonly StateExtractionIssue[] => {
    const issues: StateExtractionIssue[] = [];
    if (source.chapterPlan.storyEvents.length > 0) issues.push({
        code: 'UNREPRESENTABLE_CANON_OPERATION', path: 'approved.source.chapterPlan.storyEvents',
        detail: source.chapterPlan.storyEvents.map(value => value.id).slice().sort().join(','),
    });
    return normalizeStateExtractionIssues(issues);
};

export const prepareCanonCommit = (request: PrepareCanonCommitRequest): PrepareCanonCommitResult => {
    const validated = validateApprovedExtractionSource(request.approved, request.state, request.control);
    if (!isValidatedExtractionSource(validated)) return blocked(validated);
    if (!isRecord(request.extraction) || request.extraction.status !== 'extracted-not-canon'
        || typeof request.extraction.sourceIdentity !== 'string'
        || !isRecord(request.extraction.delta) || request.extraction.delta.schemaVersion !== 2) {
        return blocked([{ code: 'INVALID_EXTRACTOR_OUTPUT', path: 'extraction' }]);
    }
    if (request.extraction.sourceIdentity !== validated.source.canonicalizationSourceIdentity) {
        return blocked([{ code: 'SOURCE_IDENTITY_MISMATCH', path: 'extraction.sourceIdentity' }]);
    }
    let delta: StoryStateDeltaV2;
    try {
        delta = parseStoryStateDelta(request.extraction.delta);
    } catch {
        return blocked([{ code: 'INVALID_EXTRACTOR_OUTPUT', path: 'extraction.delta' }]);
    }
    const contractIssues = validateStateExtractionContract(delta, validated.source, validated.state);
    if (contractIssues.length > 0) return blocked(contractIssues);
    const unsupported = representabilityIssues(validated.source);
    if (unsupported.length > 0) return blocked(unsupported);
    try {
        // Deliberate dry run only. The result is discarded and never reused as a commit.
        applyStoryStateDelta(request.control, validated.state, delta);
    } catch {
        return blocked([{ code: 'CANON_PREVIEW_REJECTED', path: 'delta' }]);
    }
    let review: CanonCommitReview;
    try {
        const requestedCapacity = request.maxTotalChanges ?? DEFAULT_MAX_CANON_REVIEW_CHANGES;
        review = buildCanonCommitReview(delta, Math.min(requestedCapacity, DEFAULT_MAX_CANON_REVIEW_CHANGES));
    } catch (error) {
        if (error instanceof CanonReviewCapacityError) {
            return blocked([{ code: 'REVIEW_CAPACITY_EXCEEDED', path: 'review' }]);
        }
        return blocked([{ code: 'CANON_PREVIEW_REJECTED', path: 'review' }]);
    }
    const sourceIdentity = validated.source.canonicalizationSourceIdentity;
    const storyControlIdentity = createStoryControlIdentity(request.control);
    const proposalIdentity = createCanonProposalIdentity({
        sourceIdentity, storyControlId: request.control.id,
        storyControlIdentity,
        baseChapter: validated.source.baseChapter, baseRevision: validated.source.baseRevision,
        targetChapter: validated.source.chapterPlan.chapterNumber, delta,
    });
    return {
        kind: 'canon-commit-proposal', status: 'ready-for-review', storyControlId: request.control.id,
        storyControlIdentity,
        baseChapter: validated.source.baseChapter, baseRevision: validated.source.baseRevision,
        targetChapter: validated.source.chapterPlan.chapterNumber,
        sourceIdentity, proposalIdentity,
        source: structuredClone(validated.source), delta: structuredClone(delta), review,
    };
};

export const createMakeCanonConfirmation = (proposal: CanonCommitProposal): MakeCanonConfirmation => ({
    kind: 'make-canon-confirmation', confirmed: true, storyControlId: proposal.storyControlId,
    baseChapter: proposal.baseChapter, baseRevision: proposal.baseRevision, targetChapter: proposal.targetChapter,
    proposalIdentity: proposal.proposalIdentity,
});

const requireProposal = (value: unknown): CanonCommitProposal => {
    if (!isRecord(value) || value.kind !== 'canon-commit-proposal' || value.status !== 'ready-for-review'
        || typeof value.storyControlId !== 'string' || !Number.isSafeInteger(value.baseChapter)
        || typeof value.storyControlIdentity !== 'string'
        || !Number.isSafeInteger(value.baseRevision) || !Number.isSafeInteger(value.targetChapter)
        || typeof value.sourceIdentity !== 'string' || typeof value.proposalIdentity !== 'string'
        || !isRecord(value.source) || value.source.kind !== 'validated-chapter-source'
        || typeof value.source.storyControlId !== 'string' || !Number.isSafeInteger(value.source.baseChapter)
        || typeof value.source.storyControlIdentity !== 'string'
        || !Number.isSafeInteger(value.source.baseRevision) || !isRecord(value.source.chapterPlan)
        || typeof value.source.canonicalizationSourceIdentity !== 'string'
        || value.source.chapterPlan.kind !== 'writer-chapter-plan'
        || !isRecord(value.delta) || value.delta.kind !== 'story-state-delta'
        || !isRecord(value.review) || value.review.kind !== 'canon-commit-review') {
        throw new MakeCanonError('INVALID_PROPOSAL', 'a complete ready-for-review Canon proposal is required');
    }
    return value as unknown as CanonCommitProposal;
};

const requireConfirmation = (value: unknown, proposal: CanonCommitProposal): void => {
    if (!isRecord(value) || value.kind !== 'make-canon-confirmation' || value.confirmed !== true) {
        throw new MakeCanonError('CONFIRMATION_REQUIRED', 'structured explicit Make Canon confirmation is required');
    }
    const fields = ['kind', 'confirmed', 'storyControlId', 'baseChapter', 'baseRevision', 'targetChapter', 'proposalIdentity'];
    if (Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) {
        throw new MakeCanonError('CONFIRMATION_MISMATCH', 'Make Canon confirmation contains an unexpected field');
    }
    if (value.storyControlId !== proposal.storyControlId || value.baseChapter !== proposal.baseChapter
        || value.baseRevision !== proposal.baseRevision || value.targetChapter !== proposal.targetChapter
        || value.proposalIdentity !== proposal.proposalIdentity) {
        throw new MakeCanonError('CONFIRMATION_MISMATCH', 'Make Canon confirmation does not match the proposal');
    }
};

/** Pure explicit commit: strict current Canon is checked and the delta is applied again. */
export const makeCanon = (request: MakeCanonRequest): StoryState => {
    let current: StoryState;
    try {
        current = parseStoryState(request.state, request.control);
    } catch {
        throw new MakeCanonError('INVALID_CURRENT_CANON', 'strict current StoryState is required');
    }
    const validated = validateApprovedExtractionSource(request.approved, current, request.control);
    if (!isValidatedExtractionSource(validated)) {
        if (validated.some(value => value.code === 'SOURCE_CONTROL_MISMATCH')) {
            throw new MakeCanonError('WRONG_STORY', 'approved source belongs to another StoryControl');
        }
        if (validated.some(value => value.code === 'SOURCE_CHAPTER_MISMATCH' || value.code === 'SOURCE_REVISION_MISMATCH')) {
            throw new MakeCanonError('STALE_PROPOSAL', 'approved source base no longer matches current Canon');
        }
        throw new MakeCanonError('INVALID_PROPOSAL', 'original approved source is invalid or has changed');
    }
    const proposal = requireProposal(request.proposal);
    const storyControlIdentity = createStoryControlIdentity(request.control);
    if (proposal.storyControlId !== request.control.id || proposal.source.storyControlId !== request.control.id
        || proposal.storyControlIdentity !== storyControlIdentity
        || proposal.source.storyControlIdentity !== storyControlIdentity) {
        throw new MakeCanonError('WRONG_STORY', 'proposal belongs to another StoryControl');
    }
    if (current.currentChapter !== proposal.baseChapter || current.revision !== proposal.baseRevision) {
        throw new MakeCanonError('STALE_PROPOSAL', 'proposal base no longer matches current Canon');
    }
    let delta: StoryStateDeltaV2;
    try {
        if (proposal.targetChapter !== proposal.baseChapter + 1
            || proposal.source.baseChapter !== proposal.baseChapter
            || proposal.source.baseRevision !== proposal.baseRevision
            || proposal.source.chapterPlan.chapterNumber !== proposal.targetChapter
            || proposal.sourceIdentity !== validated.source.canonicalizationSourceIdentity
            || proposal.source.canonicalizationSourceIdentity !== validated.source.canonicalizationSourceIdentity
            || proposal.source.storyControlId !== validated.source.storyControlId
            || proposal.source.storyControlIdentity !== validated.source.storyControlIdentity
            || !canonicalValuesEqual(proposal.source.chapterPlan, validated.source.chapterPlan)
            || proposal.delta.schemaVersion !== 2) throw new Error('proposal cursor mismatch');
        delta = parseStoryStateDelta(proposal.delta);
        if (delta.chapterNumber !== proposal.targetChapter || delta.expectedRevision !== proposal.baseRevision) {
            throw new Error('delta cursor mismatch');
        }
        const recomputedIdentity = createCanonProposalIdentity({
            sourceIdentity: proposal.sourceIdentity, storyControlId: proposal.storyControlId,
            storyControlIdentity: proposal.storyControlIdentity,
            baseChapter: proposal.baseChapter, baseRevision: proposal.baseRevision,
            targetChapter: proposal.targetChapter, delta,
        });
        if (recomputedIdentity !== proposal.proposalIdentity) throw new Error('proposal identity mismatch');
        const contractIssues = validateStateExtractionContract(delta, validated.source, current);
        if (contractIssues.length > 0 || representabilityIssues(validated.source).length > 0) throw new Error('proposal contract mismatch');
        const rebuiltReview = buildCanonCommitReview(delta, DEFAULT_MAX_CANON_REVIEW_CHANGES);
        if (!canonicalValuesEqual(rebuiltReview, proposal.review)) throw new Error('review mismatch');
    } catch {
        throw new MakeCanonError('INVALID_PROPOSAL', 'proposal and delta are inconsistent');
    }
    requireConfirmation(request.confirmation, proposal);
    try {
        return applyStoryStateDelta(request.control, current, delta);
    } catch {
        throw new MakeCanonError('CANON_TRANSITION_REJECTED', 'current Canon rejected the proposed transition');
    }
};
