import { describe, expect, it } from 'vitest';
import {
    InternalChapterPlan,
    RelationshipActionPlan,
    StoryBlueprint,
    StoryEngineModelBundle,
    StoryState,
    applyStoryStateDelta,
    compileStoryControl,
    createEmptyNarrativeMemoryState,
    createInitialStoryState,
    createProductionStoryRuntime,
} from '../src/storyEngine';
import { LONG_RUN_CONTROL, politicalActionFor } from './fixtures/storyEngineLongRunFixture';
import { buildSampleInternalPlan, runLongRun } from './helpers/storyEngineLongRunHarness';
import { createSyntheticNarrativeMemory } from './helpers/storyEngineNarrativeMemoryFixture';

const emptyDelta = (chapter: number, changes: Partial<Record<string, readonly unknown[]>> = {}) => ({
    kind: 'story-state-delta' as const, schemaVersion: 2 as const, chapterNumber: chapter, expectedRevision: chapter - 1,
    factChanges: [], epistemicChanges: [], locationChanges: [], statusChanges: [], activationChanges: [],
    relationshipChanges: [], resourceChanges: [], continuityChanges: [], revealChanges: [], foreshadowChanges: [], payoffChanges: [],
    ...changes,
});

describe('WORK 12 privileged domain orchestration', () => {
    it('threads a real political plan through Writer-safe and privileged Validator views to Canon review', async () => {
        const state = runLongRun(createInitialStoryState(), 588).finalState;
        let writerPlan: unknown;
        let validatorView: unknown;
        let plannerCalls = 0;
        const models: StoryEngineModelBundle = {
            planner: { async plan(context) { plannerCalls += 1; return buildSampleInternalPlan(context, [politicalActionFor(589)]); } },
            writer: { async write(request) {
                writerPlan = request.context.chapterPlan;
                return { kind: 'writer-chapter-draft', chapterNumber: 589, prose: 'Atlas follows the charter procedure and accepts the delay risk.' };
            } },
            semanticValidator: { async validate(request) {
                validatorView = request.context.strategicView;
                return { kind: 'semantic-validation-result', chapterNumber: 589, issues: [] };
            } },
            repair: { async repair() { throw new Error('repair should not run'); } },
            stateExtractor: { async extract() {
                return {
                    ...emptyDelta(589),
                    factChanges: [{
                        id: 'fact-runtime-589', text: 'The bounded council decision was attempted.', establishedChapter: 589,
                        visibility: 'writer', status: 'active', provenance: { sourceChapter: 589, sourceType: 'chapter' },
                    }],
                };
            } },
        };
        const runtime = createProductionStoryRuntime({ models });
        const missingMemory = await runtime.runChapterToCanonReview({
            control: LONG_RUN_CONTROL, state, memoryState: createEmptyNarrativeMemoryState(LONG_RUN_CONTROL),
        });
        expect(missingMemory).toMatchObject({ status: 'blocked', stage: 'planning', code: 'MEMORY_CANON_MISMATCH' });
        expect(plannerCalls).toBe(0);
        const result = await runtime.runChapterToCanonReview({
            control: LONG_RUN_CONTROL, state, memoryState: createSyntheticNarrativeMemory(LONG_RUN_CONTROL, state),
        });
        expect(result.status).toBe('ready-for-canon-review');
        expect(writerPlan).toMatchObject({ strategicDirectives: [{ domain: 'politics' }] });
        expect(JSON.stringify(writerPlan)).not.toContain('evidenceRefs');
        expect(validatorView).toMatchObject({ kind: 'validator-strategic-view', actions: [{ domain: 'politics' }] });
        expect(state).toMatchObject({ currentChapter: 588, revision: 588 });
    }, 15_000);

    it('threads exact pairwise relationship semantics and expected delta to Canon review', async () => {
        const policy = {
            maxMajorMilestoneAdvancePerChapter: 1, maxConsecutiveProgressionChapters: 2,
            requireCanonicalBasis: true as const, requireMutualAgencyForMutualMilestone: true as const,
        };
        const profile = {
            coreDynamicTags: ['professional-equals'] as const, dominantConflictSources: ['Duty'],
            trustBasis: ['Evidence'], respectBasis: ['Competence'], prohibitedShortcuts: [] as const,
        };
        const blueprint: StoryBlueprint = {
            id: 'relationship-production', engine: { plannedChapterCount: 20 },
            characters: [{ id: 'a', name: 'A', availableFromChapter: 1 }, { id: 'b', name: 'B', availableFromChapter: 1 }],
            arcs: [{ id: 'arc', title: 'Arc', startChapter: 1, endChapter: 20 }],
            relationshipDefinitions: [{ id: 'a-b', participantIds: ['a', 'b'], categories: ['romantic'], initialRomanceMilestone: 'awareness', dynamicProfile: profile, progressionPolicy: policy }],
            gates: { pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }] },
        };
        const control = compileStoryControl(blueprint);
        let state: StoryState = createInitialStoryState();
        for (let chapter = 1; chapter <= 19; chapter += 1) {
            state = applyStoryStateDelta(control, state, {
                ...emptyDelta(chapter),
                relationshipChanges: chapter === 1 ? [{
                    id: 'a-b-history-1', relationshipId: 'a-b', participantIds: ['a', 'b'], state: 'awareness', chapterNumber: 1,
                    provenance: { sourceChapter: 1, sourceType: 'chapter' },
                }] : [],
            });
        }
        const action: RelationshipActionPlan = {
            id: 'relationship-action', sceneIds: ['relationship-scene'], relationshipId: 'a-b', participantIds: ['a', 'b'],
            category: 'romantic', actionType: 'deepen-trust', importance: 'minor',
            currentStateAssessment: {
                trust: 'moderate', respect: 'moderate', attraction: 'emerging', emotionalOpenness: 'emerging',
                dependency: 'low', conflict: 'moderate', sharedInterest: 'moderate', powerBalance: 'balanced',
            },
            currentRomanceMilestone: 'awareness',
            intendedProgression: { direction: 'strengthening', romanticMilestone: 'interest', expectedState: 'interest', mutual: false, intermediate: false },
            participantAgency: [
                { characterId: 'a', currentGoal: 'Offer help.', desiredOutcome: 'Earn trust.', boundary: 'No pressure.', choice: 'Help.', willingness: 'yes', uncertainty: 'B may refuse.', costOrRisk: 'Time.', knowledgeBasisFactIds: [] },
                { characterId: 'b', currentGoal: 'Stay independent.', desiredOutcome: 'Judge conduct.', boundary: 'No promise.', choice: 'Acknowledge help.', willingness: 'uncertain', uncertainty: 'A may leave.', costOrRisk: 'Trust.', knowledgeBasisFactIds: [] },
            ],
            boundaries: [], evidenceRefs: [{ type: 'relationship', id: 'a-b' }], counterpressure: 'Duty limits trust.',
            uncertainty: 'The bond may remain cautious.', expectedCostOrTradeoff: 'Both accept risk.', powerImbalanceAddressed: true,
            writerVisibleContract: { currentDynamic: 'Cautious equals.', objective: 'Earn trust through choice.', visibleConflict: 'Both protect independence.', visibleUncertainty: 'Either may withdraw.' },
        };
        const planFor = (chapter: number): InternalChapterPlan => ({
            kind: 'internal-chapter-plan', chapterNumber: chapter, arcId: 'arc', primaryGoal: 'Advance one earned relationship beat.',
            povCharacterId: 'a', participantIds: ['a', 'b'],
            scenes: [{ id: 'relationship-scene', order: 1, goal: 'Force a voluntary choice.', location: 'Office', povCharacterId: 'a', participantIds: ['a', 'b'], conflictOrObstacle: 'Goals diverge.', uncertainty: 'Cooperation may fail.', expectedConsequence: 'Trust changes only if earned.', purposeTags: ['relationship'], conflictImportance: 'minor' }],
            activeConstraintIds: [], allowedRevealIds: [], plannedRevealIds: [], relationshipEventIds: [], storyEventIds: [], cluesPlantedIds: [], cluesPaidOffIds: [],
            expectedResourceDeltas: [], expectedRelationshipDeltas: [{ relationshipId: 'a-b', participantIds: ['a', 'b'], expectedState: 'interest' }],
            expectedContinuityConsequences: [], strategicActions: [], relationshipActions: [action], endStateIntent: 'Stop with earned cautious interest.',
        });
        let writerDirective: unknown;
        let validatorRelationshipView: unknown;
        const models: StoryEngineModelBundle = {
            planner: { async plan(context) { expect(context.relationshipContext.relationships).toHaveLength(1); return planFor(20); } },
            writer: { async write(request) { writerDirective = request.context.chapterPlan.relationshipDirectives; return { kind: 'writer-chapter-draft', chapterNumber: 20, prose: 'A offers help; B chooses cautious acknowledgment without a promise.' }; } },
            semanticValidator: { async validate(request) { validatorRelationshipView = request.context.relationshipView; return { kind: 'semantic-validation-result', chapterNumber: 20, issues: [] }; } },
            repair: { async repair() { throw new Error('repair should not run'); } },
            stateExtractor: { async extract() { return {
                ...emptyDelta(20), relationshipChanges: [{
                    id: 'a-b-history-20', relationshipId: 'a-b', participantIds: ['a', 'b'], state: 'interest', chapterNumber: 20,
                    provenance: { sourceChapter: 20, sourceType: 'chapter' },
                }],
            }; } },
        };
        const runtime = createProductionStoryRuntime({ models });
        const result = await runtime.runChapterToCanonReview({ control, state, memoryState: createSyntheticNarrativeMemory(control, state) });
        expect(result.status).toBe('ready-for-canon-review');
        expect(writerDirective).toMatchObject([{ relationshipId: 'a-b', intendedProgression: { romanticMilestone: 'interest', expectedState: 'interest' } }]);
        expect(validatorRelationshipView).toMatchObject({ kind: 'validator-relationship-view', actions: [{ relationshipId: 'a-b' }] });
        expect(JSON.stringify(writerDirective)).not.toContain('evidenceRefs');
        expect(state.projections.relationships[0].currentState).toBe('awareness');
    });
});
