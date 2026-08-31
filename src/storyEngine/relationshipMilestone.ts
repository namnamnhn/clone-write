import { ROMANCE_MILESTONES } from './relationshipTypes';
import type { RelationshipDefinition, RomanceMilestone } from './relationshipTypes';
import type { StoryState } from './types';

const romanceMilestones = new Set<string>(ROMANCE_MILESTONES);
export const isRomanceMilestone = (value: string): value is RomanceMilestone => romanceMilestones.has(value);

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
