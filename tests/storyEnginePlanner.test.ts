import { describe, expect, it } from 'vitest';
import {
    buildPlannerContext,
    buildPlannerPrompt,
    buildPlannerValidationAffordances,
    ChapterPlanValidationError,
    compileStoryControl,
    createInitialStoryState,
    createStructuredPlanner,
    InternalChapterPlan,
    NarrativeMemoryInput,
    PlannerContext,
    parseInternalChapterPlan,
    sanitizeWriterChapterPlan,
    selectNarrativeMemory,
    StoryBlueprint,
    validateInternalChapterPlan,
} from '../src/storyEngine';

const makeBlueprint = (): StoryBlueprint => ({
    id: 'planner-test-story',
    engine: { plannedChapterCount: 600 },
    characters: [
        { id: 'character-a', name: 'Character A', lockedThroughChapter: 32, writerProfile: { role: 'traveler' }, authorNotes: 'A future secret' },
        { id: 'character-b', name: 'Character B', availableFromChapter: 1, writerProfile: { role: 'scholar' }, authorNotes: 'B author notes' },
    ],
    arcs: [
        { id: 'arc-current', title: 'Current arc', startChapter: 1, endChapter: 300, authorPlan: 'hidden current arc plan' },
        { id: 'arc-future', title: 'Future arc', startChapter: 301, endChapter: 600, authorPlan: 'future antagonist truth' },
    ],
    beats: [
        { id: 'beat-current', arcId: 'arc-current', order: 1, startChapter: 1, endChapter: 300, authorPlan: 'hidden beat plan' },
        { id: 'beat-future', arcId: 'arc-future', order: 1, startChapter: 301, endChapter: 600, authorPlan: 'future beat plan' },
    ],
    reveals: [{ id: 'mastermind-reveal', writerText: 'The mastermind is Character Omega.', authorNotes: 'do not expose backup identity' }],
    relationshipEvents: [{ id: 'first-meeting', relationshipId: 'a-b', eventType: 'meeting', participantIds: ['character-a', 'character-b'], writerText: 'Character A and Character B may meet.', authorNotes: 'author-only relationship motive' }],
    storyEvents: [{ id: 'palace-civil-war', eventType: 'civil-war', writerText: 'The palace civil war may begin.', authorNotes: 'hidden political design' }],
    gates: {
        characters: [{ id: 'a-character-gate', characterId: 'character-a', lockedThroughChapter: 32 }],
        pov: [
            { id: 'a-pov-gate', characterId: 'character-a', lockedThroughChapter: 32 },
            { id: 'b-pov-gate', characterId: 'character-b', allowedFromChapter: 1 },
        ],
        reveals: [{ id: 'mastermind-gate', revealId: 'mastermind-reveal', allowedFromChapter: 500 }],
        relationships: [{ id: 'meeting-gate', eventId: 'first-meeting', allowedFromChapter: 200 }],
        events: [{ id: 'civil-war-gate', eventId: 'palace-civil-war', allowedFromChapter: 400 }],
    },
    forbiddenRelationshipEvents: [{ id: 'meeting-lock', eventId: 'first-meeting', forbiddenThroughChapter: 218, authorReason: 'not yet' }],
    forbiddenEvents: [{ id: 'civil-war-lock', eventId: 'palace-civil-war', forbiddenThroughChapter: 500, authorReason: 'not yet' }],
    forbiddenReveals: [{ id: 'mastermind-lock', revealId: 'mastermind-reveal', forbiddenThroughChapter: 560, authorReason: 'not yet' }],
    authorOnlySecrets: [{ id: 'mastermind-secret', value: 'INTERNAL DOSSIER: Omega backup identity is classified.', revealId: 'mastermind-reveal', notes: 'never give raw truth to writer' }],
    canonRules: [{ id: 'travel-rule', text: 'Travel requires a gate token.', availableFromChapter: 1, scope: 'world', authorNotes: 'hidden token origin' }],
});

const control = compileStoryControl(makeBlueprint());

const stateFor = (chapter: number) => ({
    ...createInitialStoryState(chapter),
    knownCharacterIds: ['character-a', 'character-b'],
    activeCharacterIds: ['character-a', 'character-b'],
    extensions: { authorPlan: 'DO NOT LEAK', mastermind: 'INTERNAL DOSSIER' },
});

const planFor = (chapter: number, participants?: readonly string[]): InternalChapterPlan => {
    const context = buildPlannerContext(control, stateFor(chapter), chapter);
    const pov = participants?.[0] ?? context.povEligibility.find(entry => entry.allowed)!.id;
    const ids = participants ?? [pov];
    return {
        kind: 'internal-chapter-plan',
        chapterNumber: chapter,
        arcId: context.currentArc.id,
        ...(context.currentBeat === undefined ? {} : { beatId: context.currentBeat.id }),
        primaryGoal: 'Advance the immediate chapter problem.',
        povCharacterId: pov,
        participantIds: [...ids],
        scenes: [{
            id: `scene-${chapter}`,
            order: 1,
            goal: 'Force a meaningful choice.',
            location: 'Gate district',
            povCharacterId: pov,
            participantIds: [...ids],
            conflictOrObstacle: 'The route is blocked.',
            uncertainty: 'The cost of a detour is unclear.',
            expectedConsequence: 'The next move becomes constrained.',
            purposeTags: ['plot'],
            conflictImportance: 'minor',
        }],
        activeConstraintIds: ['travel-rule'],
        allowedRevealIds: [...context.allowedRevealIds],
        plannedRevealIds: [],
        relationshipEventIds: [],
        storyEventIds: [],
        cluesPlantedIds: [],
        cluesPaidOffIds: [],
        expectedResourceDeltas: [],
        expectedRelationshipDeltas: [],
        expectedContinuityConsequences: [],
        endStateIntent: 'End with a concrete unresolved choice.',
    };
};

const validationCodes = (plan: InternalChapterPlan) =>
    validateInternalChapterPlan(plan, buildPlannerContext(control, stateFor(plan.chapterNumber), plan.chapterNumber)).map(issue => issue.code);

describe('Story Engine V4 planner gates', () => {
    it('derives exact closed-world beat, POV, character, event, and reveal affordances', () => {
        const context = buildPlannerContext(control, stateFor(561), 561);
        const affordances = buildPlannerValidationAffordances(context);

        expect(affordances.targetChapter).toBe(561);
        expect(affordances.currentArcId).toBe(context.currentArc.id);
        expect(affordances.currentBeatId).toBe(context.currentBeat!.id);
        expect(affordances.allowedPovIds).toEqual(
            context.povEligibility.filter(entry => entry.allowed).map(entry => entry.id),
        );
        expect(affordances.availableCharacterIds).toEqual(context.availableCharacters.map(character => character.id));
        expect(affordances.allowedRevealIds).toEqual(['mastermind-reveal']);
        expect(affordances.allowedStoryEventIds).toEqual(['palace-civil-war']);
        expect(affordances.allowedRelationshipEventIds).toEqual(['first-meeting']);
        expect(affordances.strategicDomainTags).toEqual(['politics', 'military', 'commerce']);
        expect(affordances.relationshipSceneTag).toBe('relationship');
    });

    it('uses null currentBeatId and explicitly requires beatId omission when the arc has no beats', () => {
        const blueprint = makeBlueprint();
        const noCurrentBeatControl = compileStoryControl({
            ...blueprint,
            beats: blueprint.beats!.filter(beat => beat.arcId !== 'arc-current'),
        });
        const context = buildPlannerContext(noCurrentBeatControl, stateFor(33), 33);
        const affordances = buildPlannerValidationAffordances(context);
        const prompt = buildPlannerPrompt(context);

        expect(affordances.currentBeatId).toBeNull();
        expect(prompt).toContain('If currentBeatId is null, OMIT beatId entirely; never invent one.');
        expect(validateInternalChapterPlan(
            { ...planFor(33, ['character-a']), beatId: 'invented-beat' },
            context,
        ).map(issue => issue.code)).toContain('FUTURE_BEAT');
    });

    it('exposes only allowed POVs and keeps canonical knowledge isolated per available character', () => {
        const lockedContext = buildPlannerContext(control, stateFor(32), 32);
        const knowledgeContext: PlannerContext = {
            ...buildPlannerContext(control, stateFor(33), 33),
            characterKnowledge: [
                { characterId: 'character-a', factIds: ['fact-only-a'] },
                { characterId: 'character-b', factIds: ['fact-only-b'] },
            ],
        };
        const lockedAffordances = buildPlannerValidationAffordances(lockedContext);
        const knowledgeAffordances = buildPlannerValidationAffordances(knowledgeContext);

        expect(lockedAffordances.allowedPovIds).toEqual(['character-b']);
        expect(lockedAffordances.allowedPovIds).not.toContain('character-a');
        expect(knowledgeAffordances.characterKnowledgeFactIdsByCharacter).toEqual({
            'character-a': ['fact-only-a'],
            'character-b': ['fact-only-b'],
        });
        expect(knowledgeAffordances.characterKnowledgeFactIdsByCharacter['character-a']).not.toContain('fact-only-b');
        expect(knowledgeAffordances.characterKnowledgeFactIdsByCharacter['character-b']).not.toContain('fact-only-a');
    });

    it('projects exact relationship IDs and participants without copying Author Secret values', () => {
        const base = buildPlannerContext(control, stateFor(561), 561);
        const context: PlannerContext = {
            ...base,
            characterKnowledge: [
                { characterId: 'character-a', factIds: ['fact-a'] },
                { characterId: 'character-b', factIds: [] },
            ],
            relationships: [{ id: 'canonical-a-b', participantIds: ['character-a', 'character-b'], state: 'allies' }],
            relationshipContext: {
                ...base.relationshipContext,
                relationships: [{
                    id: 'declared-a-b',
                    participantIds: ['character-a', 'character-b'],
                    categories: ['professional'],
                    currentRomanceMilestone: 'none',
                    dynamicProfile: {
                        coreDynamicTags: ['professional-equals'],
                        dominantConflictSources: [],
                        trustBasis: [],
                        respectBasis: [],
                        prohibitedShortcuts: [],
                    },
                    progressionPolicy: {
                        maxMajorMilestoneAdvancePerChapter: 1,
                        maxConsecutiveProgressionChapters: 1,
                        requireCanonicalBasis: true,
                        requireMutualAgencyForMutualMilestone: true,
                    },
                    slowBurnHistoryComplete: true,
                    consecutiveProgressionCount: 0,
                    recentHistory: [],
                }],
            },
            authorOnlySecretReferences: [{
                id: 'secret-reference',
                value: 'RAW_AUTHOR_SECRET_SENTINEL',
            } as unknown as { readonly id: string }],
        };
        const serialized = JSON.stringify(buildPlannerValidationAffordances(context));

        expect(buildPlannerValidationAffordances(context).relationshipDefinitions).toEqual([{
            id: 'declared-a-b',
            participantIds: ['character-a', 'character-b'],
        }]);
        expect(buildPlannerValidationAffordances(context).canonicalRelationshipIds).toEqual(['canonical-a-b']);
        expect(buildPlannerValidationAffordances(context).characterKnowledgeFactIdsByCharacter).toEqual({
            'character-a': ['fact-a'],
            'character-b': [],
        });
        expect(serialized).not.toContain('RAW_AUTHOR_SECRET_SENTINEL');
    });

    it('states the exact nested scene contract without exposing raw Author Secret values', () => {
        const prompt = buildPlannerPrompt(buildPlannerContext(control, stateFor(33), 33));
        expect(prompt).toContain('Every scenes[] object must include exactly these required fields: id, order, goal, location, povCharacterId, participantIds, conflictOrObstacle, uncertainty, expectedConsequence, purposeTags, conflictImportance');
        expect(prompt).toContain('every order is a positive integer, orders are unique and consecutive, and the first scene order is 1');
        expect(prompt).toContain('plot, character, resource, clue, relationship, consequence, world, politics, military, commerce');
        expect(prompt).toContain('conflictImportance must be exactly minor or major');
        expect(prompt).toContain('A major conflict must include a complete intelligentConflict object');
        expect(prompt).toContain('Every strategicActions and relationshipActions entry must still follow its complete documented runtime contract');
        expect(prompt).toContain('Never emit markdown, explanatory prose, comments, prefixes, suffixes, or alternative field names');
        expect(prompt).toContain('arcId MUST equal currentArcId exactly');
        expect(prompt).toContain('chapter povCharacterId and every scene.povCharacterId MUST be selected only from allowedPovIds');
        expect(prompt).toContain('Every opponentKnowledge fact ID MUST come only from characterKnowledgeFactIdsByCharacter[opponentCharacterId]');
        expect(prompt).toContain('each scene tagged politics, military, or commerce MUST have a strategicAction of the same domain');
        expect(prompt).toContain('Every strategicAction.sceneIds entry MUST identify a real scene carrying that same domain tag');
        expect(prompt).toContain('do not use that strategic domain tag and emit no such action');
        expect(prompt).toContain('relationshipActions.relationshipId may use only an ID in relationshipDefinitions');
        expect(prompt).toContain('emit exactly one matching FINAL RelationshipAction');
        expect(prompt).toContain('If no valid final action is planned, omit that relationship delta');
        expect(prompt).toContain('plannedRevealIds MUST be a subset of allowedRevealIds');
        expect(prompt).toContain('storyEventIds MUST be a subset of allowedStoryEventIds');
        expect(prompt).toContain('relationshipEventIds MUST be a subset of allowedRelationshipEventIds');
        expect(prompt.indexOf('VALIDATION_AFFORDANCES:')).toBeLessThan(prompt.indexOf('CONTEXT:'));
        expect(prompt).not.toContain('Omega backup identity is classified');
    });

    it('accepts a realistic closed-world plan through the structured planner with no active beat', async () => {
        const blueprint = makeBlueprint();
        const noCurrentBeatControl = compileStoryControl({
            ...blueprint,
            beats: blueprint.beats!.filter(beat => beat.arcId !== 'arc-current'),
        });
        const context = buildPlannerContext(noCurrentBeatControl, stateFor(33), 33);
        const withBeat = planFor(33, ['character-a', 'character-b']);
        const { beatId: _omittedBeat, ...withoutBeat } = withBeat;
        expect(_omittedBeat).toBe('beat-current');
        const output: InternalChapterPlan = {
            ...withoutBeat,
            scenes: [{
                ...withoutBeat.scenes[0],
                participantIds: ['character-a', 'character-b'],
                conflictImportance: 'major',
                intelligentConflict: {
                    opponentCharacterId: 'character-b',
                    protagonistObjective: 'Cross the gate district.',
                    opponentObjective: 'Keep the route closed.',
                    opponentKnowledge: [],
                    opponentBeliefs: ['The traveler may lack a gate token.'],
                    rationalCountermove: 'Close the visible route.',
                    uncertainty: 'A lawful alternative may exist.',
                    expectedCostOrTradeoff: 'The closure reveals the patrol schedule.',
                },
            }],
            strategicActions: [],
            relationshipActions: [],
            expectedRelationshipDeltas: [],
        };

        await expect(createStructuredPlanner({ async plan() { return output; } }, noCurrentBeatControl).plan(context))
            .resolves.toEqual(output);
    });

    it('strictly parses and validates a complete provider-shaped scene without normalization', () => {
        const raw = { ...planFor(33, ['character-a']), strategicActions: [], relationshipActions: [] };
        const parsed = parseInternalChapterPlan(raw);
        expect(parsed.issues).toEqual([]);
        expect(parsed.plan).toEqual(raw);
        expect(validateInternalChapterPlan(parsed.plan!, buildPlannerContext(control, stateFor(33), 33))).toEqual([]);
    });

    it('still fails closed for missing scene fields, invalid order, and unsupported purpose tags', () => {
        const base = { ...planFor(33, ['character-a']), strategicActions: [], relationshipActions: [] };
        const missingLocation: Record<string, unknown> = { ...base.scenes[0] };
        delete missingLocation.location;
        const missing = parseInternalChapterPlan({ ...base, scenes: [missingLocation] });
        expect(missing.plan).toBeUndefined();
        expect(missing.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'INVALID_SHAPE', path: 'scenes.0.location' }),
        ]));

        const invalidOrder = parseInternalChapterPlan({ ...base, scenes: [{ ...base.scenes[0], order: 0 }] });
        expect(invalidOrder.plan).toBeUndefined();
        expect(invalidOrder.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'INVALID_SCENE_ORDER', path: 'scenes.0.order' }),
        ]));

        const invalidTags = parseInternalChapterPlan({ ...base, scenes: [{ ...base.scenes[0], purposeTags: ['summary'] }] });
        expect(invalidTags.plan).toBeUndefined();
        expect(invalidTags.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'INVALID_PURPOSE_TAGS', path: 'scenes.0.purposeTags' }),
        ]));

        const incoherentOrder = parseInternalChapterPlan({ ...base, scenes: [{ ...base.scenes[0], order: 2 }] });
        expect(incoherentOrder.issues).toEqual([]);
        expect(validateInternalChapterPlan(
            incoherentOrder.plan!, buildPlannerContext(control, stateFor(33), 33),
        ).map(issue => issue.code)).toContain('SCENE_ORDER_INVALID');
    });

    it('keeps deep strategic and relationship action parsing strict behind generic provider arrays', () => {
        const base = { ...planFor(33, ['character-a']), strategicActions: [], relationshipActions: [] };
        const malformedStrategic = parseInternalChapterPlan({ ...base, strategicActions: [{}] });
        expect(malformedStrategic.plan).toBeUndefined();
        expect(malformedStrategic.issues.map(issue => issue.code)).toContain('INVALID_STRATEGIC_ACTION');

        const malformedRelationship = parseInternalChapterPlan({ ...base, relationshipActions: [{}] });
        expect(malformedRelationship.plan).toBeUndefined();
        expect(malformedRelationship.issues.map(issue => issue.code)).toContain('INVALID_RELATIONSHIP_ACTION');
    });

    it('rejects Character A at chapter 32 and accepts it at chapter 33', () => {
        const locked = planFor(32, ['character-a']);
        expect(validationCodes(locked)).toContain('POV_LOCKED');
        expect(validationCodes(locked)).toContain('CHARACTER_LOCKED');
        expect(validationCodes(planFor(33, ['character-a']))).toEqual([]);
    });

    it('enforces relationship, generic-event, and reveal gates at their exact boundaries', () => {
        const meeting218 = { ...planFor(218, ['character-a', 'character-b']), relationshipEventIds: ['first-meeting'] };
        const meeting219 = { ...planFor(219, ['character-a', 'character-b']), relationshipEventIds: ['first-meeting'] };
        expect(validationCodes(meeting218)).toContain('RELATIONSHIP_EVENT_LOCKED');
        expect(validationCodes(meeting219)).toEqual([]);

        const event500 = { ...planFor(500, ['character-a']), storyEventIds: ['palace-civil-war'] };
        const event501 = { ...planFor(501, ['character-a']), storyEventIds: ['palace-civil-war'] };
        expect(validationCodes(event500)).toContain('STORY_EVENT_LOCKED');
        expect(validationCodes(event501)).toEqual([]);

        const reveal560 = { ...planFor(560, ['character-a']), plannedRevealIds: ['mastermind-reveal'] };
        const reveal561 = { ...planFor(561, ['character-a']), plannedRevealIds: ['mastermind-reveal'], allowedRevealIds: ['mastermind-reveal'] };
        expect(validationCodes(reveal560)).toContain('REVEAL_LOCKED');
        expect(validationCodes(reveal561)).toEqual([]);
    });

    it('rejects locked POVs, future arcs, and wrong beats', () => {
        expect(validationCodes(planFor(32, ['character-a']))).toContain('POV_LOCKED');
        const futureArc = { ...planFor(33, ['character-a']), arcId: 'arc-future' };
        const wrongBeat = { ...planFor(33, ['character-a']), beatId: 'beat-future' };
        expect(validationCodes(futureArc)).toContain('ARC_MISMATCH');
        expect(validationCodes(wrongBeat)).toContain('BEAT_MISMATCH');
    });

    it('rejects filler scenes and enforces the major-conflict contract at runtime', async () => {
        const filler = { ...planFor(33, ['character-a']), scenes: [{ ...planFor(33, ['character-a']).scenes[0], purposeTags: [] }] };
        expect(validationCodes(filler)).toContain('SCENE_PURPOSE_MISSING');
        const majorWithoutDetails = { ...planFor(33, ['character-a']), scenes: [{ ...planFor(33, ['character-a']).scenes[0], conflictImportance: 'major' }] };
        const partialMajor = { ...planFor(33, ['character-a']), scenes: [{ ...planFor(33, ['character-a']).scenes[0], conflictImportance: 'major', intelligentConflict: {} }] };
        const context = buildPlannerContext(control, stateFor(33), 33);
        await expect(createStructuredPlanner({ async plan() { return majorWithoutDetails; } }).plan(context)).rejects.toBeInstanceOf(ChapterPlanValidationError);
        await expect(createStructuredPlanner({ async plan() { return partialMajor; } }).plan(context)).rejects.toBeInstanceOf(ChapterPlanValidationError);

        const completeMajor = {
            ...planFor(33, ['character-a']),
            scenes: [{
                ...planFor(33, ['character-a']).scenes[0],
                conflictImportance: 'major' as const,
                intelligentConflict: {
                    protagonistObjective: 'Cross the gate district.',
                    opponentObjective: 'Keep the protagonist away from the gate.',
                    opponentKnowledge: ['gate-token'],
                    opponentBeliefs: ['The protagonist lacks a token.'],
                    rationalCountermove: 'Block the official route.',
                    uncertainty: 'A hidden passage may exist.',
                    expectedCostOrTradeoff: 'The opponent exposes a patrol pattern.',
                },
            }],
        };
        expect(validationCodes(completeMajor)).toEqual([]);
        expect(validationCodes(planFor(33, ['character-a']))).toEqual([]);
    });

    it('requires the exact active hard-constraint set and projects each constraint once', () => {
        const context = buildPlannerContext(control, stateFor(100), 100);
        const missingConstraintPlan = { ...planFor(100, ['character-a']), activeConstraintIds: [] };
        expect(validationCodes(missingConstraintPlan)).toContain('MISSING_ACTIVE_CONSTRAINT');
        expect(() => sanitizeWriterChapterPlan(missingConstraintPlan, control, stateFor(100))).toThrow(ChapterPlanValidationError);
        const futureRevealConstraint = { ...planFor(100, ['character-a']), activeConstraintIds: ['mastermind-gate'] };
        const futureEventConstraint = { ...planFor(100, ['character-a']), activeConstraintIds: ['civil-war-gate'] };
        expect(validationCodes(futureRevealConstraint)).toContain('UNKNOWN_CONSTRAINT');
        expect(validationCodes(futureEventConstraint)).toContain('UNKNOWN_CONSTRAINT');
        expect(validationCodes({ ...planFor(100, ['character-a']), activeConstraintIds: ['travel-rule', 'travel-rule'] })).toContain('DUPLICATE_ACTIVE_CONSTRAINT');

        const plan = planFor(100, ['character-a']);
        expect(validationCodes(plan)).toEqual([]);
        const writerPlan = sanitizeWriterChapterPlan(plan, control, stateFor(100));
        expect(writerPlan.canonConstraints).toEqual([
            { id: 'travel-rule', text: 'Travel requires a gate token.', scope: 'world' },
        ]);
        expect(writerPlan.canonConstraints.map(constraint => constraint.id)).toEqual(context.activeHardConstraints.map(constraint => constraint.id));

        const blueprint = makeBlueprint();
        const twoRuleControl = compileStoryControl({
            ...blueprint,
            canonRules: [
                ...blueprint.canonRules!,
                { id: 'oath-rule', text: 'An oath must be honored.', availableFromChapter: 1, scope: 'canon' },
            ],
        });
        const twoRuleContext = buildPlannerContext(twoRuleControl, stateFor(100), 100);
        const partialPlan = { ...planFor(100, ['character-a']), activeConstraintIds: ['travel-rule'] };
        expect(validateInternalChapterPlan(partialPlan, twoRuleContext).map(issue => issue.code)).toContain('MISSING_ACTIVE_CONSTRAINT');
        const completePlan = { ...partialPlan, activeConstraintIds: ['oath-rule', 'travel-rule'] };
        expect(validateInternalChapterPlan(completePlan, twoRuleContext)).toEqual([]);
        expect(sanitizeWriterChapterPlan(completePlan, twoRuleControl, stateFor(100)).canonConstraints.map(constraint => constraint.id).sort()).toEqual(['oath-rule', 'travel-rule']);
    });
});

describe('Writer plan sanitizer and secret isolation', () => {
    it('fails closed instead of repairing a locked plan', () => {
        const locked = { ...planFor(560, ['character-a']), plannedRevealIds: ['mastermind-reveal'], allowedRevealIds: ['mastermind-reveal'] };
        expect(() => sanitizeWriterChapterPlan(locked, control, stateFor(560))).toThrow(ChapterPlanValidationError);
    });

    it('serializes no mastermind secret at chapter 560, and only controlled reveal text at 561', () => {
        const at560 = sanitizeWriterChapterPlan(planFor(560, ['character-a']), control, stateFor(560));
        const at561 = sanitizeWriterChapterPlan({ ...planFor(561, ['character-a']), plannedRevealIds: ['mastermind-reveal'], allowedRevealIds: ['mastermind-reveal'] }, control, stateFor(561));
        const blocked = JSON.stringify(at560);
        const revealed = JSON.stringify(at561);
        expect(blocked).not.toContain('Omega backup identity');
        expect(blocked).not.toContain('INTERNAL DOSSIER');
        expect(revealed).toContain('The mastermind is Character Omega.');
        expect(revealed).not.toContain('Omega backup identity');
        ['authorOnlySecrets', 'authorNotes', 'authorPlan', 'extensions'].forEach(key => expect(revealed).not.toContain(key));
    });

    it('does not mutate or freeze caller state, plan, or memory input', () => {
        const state = stateFor(561);
        const plan = { ...planFor(561, ['character-a']), plannedRevealIds: ['mastermind-reveal'], allowedRevealIds: ['mastermind-reveal'] };
        const memory: NarrativeMemoryInput = { recentRawChapters: Array.from({ length: 20 }, (_, index) => ({ chapterNumber: index + 1, text: `raw-${index + 1}` })) };
        const stateJson = JSON.stringify(state);
        const planJson = JSON.stringify(plan);
        const memoryJson = JSON.stringify(memory);
        buildPlannerContext(control, state, 561, memory);
        sanitizeWriterChapterPlan(plan, control, state);
        expect(JSON.stringify(state)).toBe(stateJson);
        expect(JSON.stringify(plan)).toBe(planJson);
        expect(JSON.stringify(memory)).toBe(memoryJson);
        expect(Object.isFrozen(state)).toBe(false);
        expect(Object.isFrozen(plan)).toBe(false);
        expect(Object.isFrozen(memory)).toBe(false);
    });
});

describe('Narrative memory selection', () => {
    it('keeps only the newest configured windows in chronological order without mutating input', () => {
        const input: NarrativeMemoryInput = {
            recentRawChapters: Array.from({ length: 20 }, (_, index) => ({ chapterNumber: 20 - index, text: `raw-${20 - index}` })),
            structuredRecentSummaries: Array.from({ length: 20 }, (_, index) => ({ chapterNumber: 20 - index, summary: `summary-${20 - index}` })),
            selectedLongTermMemories: Array.from({ length: 10 }, (_, index) => ({ id: `memory-${index + 1}`, establishedChapter: index + 1, summary: `memory-${index + 1}`, relevance: index + 1 })),
        };
        const original = JSON.stringify(input);
        const selected = selectNarrativeMemory(input, 21);
        expect(selected.recentRawChapters.map(value => value.chapterNumber)).toEqual([17, 18, 19, 20]);
        expect(selected.structuredRecentSummaries.map(value => value.chapterNumber)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
        expect(selected.selectedLongTermMemories.map(value => value.establishedChapter)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
        expect(JSON.stringify(input)).toBe(original);
    });

    it('filters target and future material before selecting windows without mutating input', () => {
        const input: NarrativeMemoryInput = {
            recentRawChapters: [
                { chapterNumber: 99, text: 'raw-past' },
                { chapterNumber: 100, text: 'raw-target' },
                { chapterNumber: 580, text: 'raw-future' },
            ],
            structuredRecentSummaries: [
                { chapterNumber: 99, summary: 'summary-past' },
                { chapterNumber: 100, summary: 'summary-target' },
                { chapterNumber: 580, summary: 'summary-future' },
            ],
            selectedLongTermMemories: [
                { id: 'past-memory', establishedChapter: 99, summary: 'long-past', relevance: 1 },
                { id: 'target-memory', establishedChapter: 100, summary: 'long-target', relevance: 99 },
                { id: 'future-memory', establishedChapter: 580, summary: 'long-future', relevance: 100 },
            ],
        };
        const original = JSON.stringify(input);
        const selected = buildPlannerContext(control, stateFor(100), 100, input).narrativeMemory;
        expect(selected.recentRawChapters.map(memory => memory.chapterNumber)).toEqual([99]);
        expect(selected.structuredRecentSummaries.map(memory => memory.chapterNumber)).toEqual([99]);
        expect(selected.selectedLongTermMemories.map(memory => memory.id)).toEqual(['past-memory']);
        expect(JSON.stringify(input)).toBe(original);
    });

    it('returns no memory when every configured window is zero', () => {
        const input: NarrativeMemoryInput = {
            recentRawChapters: [{ chapterNumber: 99, text: 'raw' }],
            structuredRecentSummaries: [{ chapterNumber: 99, summary: 'summary' }],
            selectedLongTermMemories: [{ id: 'memory', establishedChapter: 99, summary: 'long' }],
        };
        const selected = selectNarrativeMemory(input, 100, {
            recentRawChapters: 0,
            structuredSummaryWindow: 0,
            selectedLongTermMemories: 0,
        });
        expect(selected).toEqual({ recentRawChapters: [], structuredRecentSummaries: [], selectedLongTermMemories: [] });
    });
});

describe('StoryState temporal context safety', () => {
    it('fails closed for a future state snapshot', () => {
        expect(() => buildPlannerContext(control, stateFor(500), 100)).toThrow('state current chapter must not be later');
    });

    it('filters future continuity and fact knowledge without mutating the input state', () => {
        const state = {
            ...stateFor(100),
            facts: [
                { id: 'past-fact', text: 'Past fact.', establishedChapter: 99, visibility: 'writer' as const },
                { id: 'future-fact', text: 'Future fact.', establishedChapter: 200, visibility: 'writer' as const },
            ],
            characterKnowledge: [{ characterId: 'character-a', factIds: ['past-fact', 'future-fact', 'unknown-fact'] }],
            continuity: {
                pendingThreads: [
                    { text: 'Past continuity.', visibility: 'writer' as const, establishedChapter: 99 },
                    { text: 'Future continuity.', visibility: 'writer' as const, establishedChapter: 200 },
                ],
                notes: [
                    { text: 'Past note.', visibility: 'writer' as const, establishedChapter: 100 },
                    { text: 'Future note.', visibility: 'writer' as const, establishedChapter: 200 },
                ],
            },
        };
        const original = JSON.stringify(state);
        const context = buildPlannerContext(control, state, 100);
        expect(context.continuity.pendingThreads.map(entry => entry.text)).toEqual(['Past continuity.']);
        expect(context.continuity.notes.map(entry => entry.text)).toEqual(['Past note.']);
        expect(context.characterKnowledge).toEqual([{ characterId: 'character-a', factIds: ['past-fact'] }]);
        expect(JSON.stringify(state)).toBe(original);
        expect(Object.isFrozen(state)).toBe(false);
    });
});
