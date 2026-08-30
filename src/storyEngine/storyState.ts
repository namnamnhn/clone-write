import { ChapterNumber, StoryState } from './types';
import { isValidChapter } from './storyControl';

export const createInitialStoryState = (currentChapter: ChapterNumber = 1): StoryState => {
    if (!isValidChapter(currentChapter)) throw new Error('currentChapter must be a positive integer');
    return {
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
        extensions: {},
    };
};

/** Immutable chapter transition primitive; advanced reducers intentionally belong to later work. */
export const moveStoryStateToChapter = (state: StoryState, currentChapter: ChapterNumber): StoryState => {
    if (!isValidChapter(currentChapter)) throw new Error('currentChapter must be a positive integer');
    return { ...state, currentChapter };
};
