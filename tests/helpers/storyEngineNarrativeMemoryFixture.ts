import {
    CanonicalChapterMemoryRecord,
    FullStoryControl,
    NarrativeMemoryState,
    StoryState,
    createCanonicalChapterMemoryRecordIdentity,
    createInitialStoryState,
    createProductionCanonIdentity,
    createStoryControlIdentity,
} from '../../src/storyEngine';

/** Test-only fixture for late-start Canon snapshots; production has no bypass for missing memory. */
export const createSyntheticNarrativeMemory = (
    control: FullStoryControl,
    state: StoryState,
): NarrativeMemoryState => {
    const storyControlIdentity = createStoryControlIdentity(control);
    const records: CanonicalChapterMemoryRecord[] = [];
    let beforeCanonIdentity = createProductionCanonIdentity(createInitialStoryState());
    for (let chapterNumber = 1; chapterNumber <= state.currentChapter; chapterNumber += 1) {
        const afterCanonIdentity = chapterNumber === state.currentChapter
            ? createProductionCanonIdentity(state)
            : `test-canon-c${chapterNumber}`;
        const body: Omit<CanonicalChapterMemoryRecord, 'recordIdentity'> = {
            kind: 'canonical-chapter-memory-record', storyControlId: control.id, storyControlIdentity,
            chapterNumber, canonicalizationSourceIdentity: `test-source-c${chapterNumber}`,
            proposalIdentity: `test-proposal-c${chapterNumber}`,
            beforeCanonIdentity, afterCanonIdentity,
            raw: { chapterNumber, text: `Synthetic canonical prose for chapter ${chapterNumber}.` },
            structured: { chapterNumber, summary: `Synthetic canonical summary for chapter ${chapterNumber}.` },
            longTerm: {
                id: `test-memory-c${chapterNumber}`, establishedChapter: chapterNumber,
                summary: `Synthetic long-term memory for chapter ${chapterNumber}.`, relevance: 1,
            },
        };
        records.push({ ...body, recordIdentity: createCanonicalChapterMemoryRecordIdentity(body) });
        beforeCanonIdentity = afterCanonIdentity;
    }
    return { kind: 'narrative-memory-state', storyControlId: control.id, storyControlIdentity, records };
};
