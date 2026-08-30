import { WriterContext } from './writerTypes';

const section = (heading: string, value: unknown): string => `${heading}\n${JSON.stringify(value)}`;

/** Deterministic prompt built only from the bounded WriterContext allow-list. */
export const buildWriterPrompt = (context: WriterContext): string => [
    'ROLE\nYou are a novel-prose writer. Execute the supplied chapter plan only.',
    `CHAPTER TARGET\nWrite exactly one chapter: chapter ${context.targetChapter}. Do not write another chapter.`,
    section('CURRENT ARC / BEAT', { arc: context.currentArc, ...(context.currentBeat === undefined ? {} : { beat: context.currentBeat }) }),
    section('CANON CONSTRAINTS', context.activeCanonConstraints),
    section('CHARACTERS', context.characters),
    section('CURRENT STATE / CONTINUITY', {
        locations: context.characterLocations, statuses: context.characterStatuses, facts: context.writerVisibleFacts,
        characterKnowledge: context.characterKnowledge, relationships: context.relationships, resources: context.resources,
        continuity: context.continuity, unresolvedClues: context.unresolvedClues, unresolvedPromises: context.unresolvedPromises,
    }),
    section('CHAPTER PLAN', context.chapterPlan),
    section('CONTROLLED REVEALS / EVENTS', {
        reveals: context.controlledReveals, relationshipEvents: context.controlledRelationshipEvents, storyEvents: context.controlledStoryEvents,
    }),
    section('NARRATIVE MEMORY', context.narrativeMemory),
    'PROSE REQUIREMENTS\nWrite natural novel prose. Maintain the supplied POV and character agency; consequences must follow actions. Do not make opponents irrational to help the protagonist. Avoid exposition dumps unless the scene requires one, repetitive AI-summary language, metadata, planning notes, internal IDs, XML/control tags, or phrases such as "as planned" and "according to the outline". Do not reference StoryControl, StoryState, Planner, WriterPlan, gates, or IDs in prose. Do not redesign the plan, add future characters, invent reveals or major canon facts, alter POV, move to another arc or beat, resolve future plot points, or create a next-chapter plan.',
    'OUTPUT CONTRACT\nReturn one JSON object only: {"kind":"writer-chapter-draft","chapterNumber":' + context.targetChapter + ',"title":"optional non-empty title","prose":"non-empty chapter prose"}. Do not include STORY_SUMMARY, NEW_CHARACTER, chapter arrays, state updates, canon mutations, or any extra chapter.',
].join('\n\n');
