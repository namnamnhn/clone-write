import { ROMANCE_MILESTONES } from './relationshipTypes';
import type { RelationshipDefinition, RomanceMilestone } from './relationshipTypes';
import type { StoryState } from './types';

const romanceMilestones = new Set<string>(ROMANCE_MILESTONES);
const romanceMilestoneIndexes = new Map<string, number>(ROMANCE_MILESTONES.map((value, index) => [value, index]));
export const isRomanceMilestone = (value: string): value is RomanceMilestone => romanceMilestones.has(value);

export interface RelationshipMilestoneHistoryEntry {
    readonly id: string;
    readonly state: string;
    readonly chapterNumber: number;
}

/** Counts the immediately preceding run of chapter-by-chapter milestone advances. */
export const countConsecutiveRomanticProgressions = (
    history: readonly RelationshipMilestoneHistoryEntry[],
    targetChapter: number,
): number => {
    const milestones = history
        .filter(entry => isRomanceMilestone(entry.state))
        .slice()
        .sort((left, right) => left.chapterNumber - right.chapterNumber || left.id.localeCompare(right.id));
    if (milestones.at(-1)?.chapterNumber !== targetChapter - 1) return 0;
    let count = 0;
    for (let index = milestones.length - 1; index > 0; index -= 1) {
        const current = milestones[index];
        const prior = milestones[index - 1];
        if (current.chapterNumber !== prior.chapterNumber + 1
            || (romanceMilestoneIndexes.get(current.state) ?? -1) <= (romanceMilestoneIndexes.get(prior.state) ?? -1)) break;
        count += 1;
    }
    return count;
};

/**
 * Derives the current romantic milestone only from canonical relationship state.
 * Free-form ledger states remain valid, but cannot erase the latest literal milestone.
 */
export const deriveCurrentRomanceMilestone = (
    definition: RelationshipDefinition,
    state: StoryState,
    targetChapter: number,
): RomanceMilestone => {
    const states = state.ledgers.relationships
        .filter(entry => entry.relationshipId === definition.id && entry.chapterNumber <= targetChapter)
        .slice()
        .sort((left, right) => left.chapterNumber - right.chapterNumber || left.id.localeCompare(right.id))
        .map(entry => entry.state);
    const projection = state.relationships.find(entry => entry.id === definition.id && entry.establishedChapter <= targetChapter);
    if (projection !== undefined) states.push(projection.state);
    for (let index = states.length - 1; index >= 0; index -= 1) {
        const candidate = states[index];
        if (isRomanceMilestone(candidate)) return candidate;
    }
    return definition.initialRomanceMilestone;
};
