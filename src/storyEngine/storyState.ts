import { ChapterNumber, StoryState } from './types';
import { isValidChapter } from './storyControl';

export const createInitialStoryState = (currentChapter: ChapterNumber = 1): StoryState => {
    if (!isValidChapter(currentChapter)) throw new Error('currentChapter must be a positive integer');
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
            facts: [], epistemic: [], locations: [], statuses: [], relationships: [],
            resources: [], continuity: [], events: [],
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
