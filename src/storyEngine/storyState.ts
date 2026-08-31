import { CanonicalChapterCursor, ChapterNumber, StoryState } from './types';
import { isValidChapter } from './storyControl';

/**
 * With no argument, creates the only canonical new-story state (cursor/revision 0).
 * A positive cursor is retained solely for legacy context fixtures; revision remains zero,
 * so strict canonical parsing deliberately rejects it as skipped history.
 */
export const createInitialStoryState = (currentChapter: CanonicalChapterCursor = 0): StoryState => {
    if (currentChapter !== 0 && !isValidChapter(currentChapter)) throw new Error('currentChapter must be zero or a positive integer');
    return {
        kind: 'story-state',
        schemaVersion: 4,
        revision: 0,
        currentChapter,
        knownCharacterIds: [],
        activeCharacterIds: [],
        characterLocations: {},
        characterStatuses: {},
        facts: [],
        characterKnowledge: [],
        relationships: [],
        unresolvedClues: [],
        unresolvedPromises: [],
        resources: {},
        continuity: {
            pendingThreads: [],
            notes: [],
        },
        ledgers: {
            facts: [], epistemic: [], locations: [], statuses: [], characterStates: [], relationships: [],
            resources: [], continuity: [], events: [], revealOccurrences: [], foreshadowThreads: [],
            foreshadowCues: [], foreshadowLifecycle: [], payoffObligations: [], payoffLifecycle: [],
        },
        projections: { characters: [], relationships: [], resources: [] },
        extensions: {},
    };
};

/** @deprecated Canonical chapter movement requires a runtime-validated StoryStateDelta. */
export const moveStoryStateToChapter = (state: StoryState, currentChapter: ChapterNumber): StoryState => {
    if (!isValidChapter(currentChapter)) throw new Error('currentChapter must be a positive integer');
    void state;
    throw new Error('direct chapter movement is disabled; use applyStoryStateDelta');
};
