import { describe, expect, it } from 'vitest';
import { createValidationIssue } from '../src/storyEngine';
import type {
    FullStoryControl,
    ValidationReport,
    ValidatorRelationshipView,
    ValidatorStrategicView,
    WriterContext,
} from '../src/storyEngine';
import { STORY_STUDIO_DEMO_VIEW_MODEL } from '../src/storyStudio/storyStudioDemoViewModel';
import { STORY_STUDIO_PRESENTER_FIXTURE } from './fixtures/storyStudioPresenterFixture';
import { buildStoryStudioViewModel } from '../src/storyStudio/storyStudioPresenter';
import { DEFAULT_STORY_STUDIO_DISPLAY_LIMITS } from '../src/storyStudio/storyStudioTypes';

const demo = STORY_STUDIO_PRESENTER_FIXTURE;

const matchingStrategicView = (): ValidatorStrategicView => ({
    kind: 'validator-strategic-view',
    chapterNumber: demo.writerPlan!.chapterNumber,
    actions: (demo.writerPlan!.strategicDirectives ?? []).map(directive => ({
        ...directive,
        evidenceRefs: [],
        resourceKeys: [],
        actorKnowledgeFactIds: [],
        opponentKnowledgeFactIds: [],
    })),
    deterministicIssues: [],
    resourceEvidence: [],
    epistemicEvidence: [],
});

const matchingRelationshipView = (): ValidatorRelationshipView => ({
    kind: 'validator-relationship-view',
    chapterNumber: demo.writerPlan!.chapterNumber,
    actions: (demo.writerPlan!.relationshipDirectives ?? []).map(directive => ({
        ...directive,
        evidenceRefs: [],
        participantKnowledgeRefs: [],
        privilegedConstraints: [],
    })),
    canonicalRelationships: [],
    deterministicIssues: [],
});

describe('Story Studio presenter', () => {
    it('is deterministic for the same engine artifacts', () => {
        expect(buildStoryStudioViewModel(demo)).toEqual(buildStoryStudioViewModel(demo));
    });

    it('keeps approved draft distinct from Canon', () => {
        const view = buildStoryStudioViewModel(demo);
        expect(view.project.canonChapter).toBe(12);
        expect(view.project.targetChapter).toBe(13);
        expect(view.project.artifactStatus).toBe('approved-not-canon');
        expect(view.project.artifactStatusLabel).toBe('Đạt QA — Chưa Canon');
        expect(view.workflow.draft?.chapterNumber).toBe(13);
        expect(view.workflow.draft?.status).toBe('approved-not-canon');
    });

    it('omits raw Author Secret values from the entire view model', () => {
        const marker = 'RAW_AUTHOR_SECRET_ABC';
        const control: FullStoryControl = {
            ...demo.control!,
            authorOnlySecrets: [{ id: 'protected-secret', value: marker, revealId: 'reveal-ban-do' }],
        };
        const view = buildStoryStudioViewModel({ ...demo, control });
        expect(JSON.stringify(view)).not.toContain(marker);
        expect(view.intelligence.secrets.items).toEqual([
            expect.objectContaining({ id: 'protected-secret', revealId: 'reveal-ban-do' }),
        ]);
    });

    it('fails closed for a future-gated character even when state marks it active', () => {
        const view = buildStoryStudioViewModel(demo);
        expect(view.project.targetChapter).toBe(13);
        expect(view.intelligence.characters.items.some(character => character.id === 'future')).toBe(false);
        expect(JSON.stringify(view.intelligence.characters)).not.toContain('Không được hiển thị');
    });

    it('keeps global facts separate from character knowledge and belief', () => {
        const view = buildStoryStudioViewModel(demo);
        const fuelFact = view.intelligence.facts.items.find(fact => fact.id === 'fact-kho-dau');
        expect(fuelFact?.knownBy.map(holder => holder.id)).toEqual(['linh', 'yen']);
        expect(fuelFact?.knownBy.some(holder => holder.id === 'minh')).toBe(false);
        expect(view.intelligence.beliefs.items).toEqual([
            expect.objectContaining({ characterId: 'yen', id: 'belief-yen-cang' }),
        ]);
    });

    it('projects pairwise relationship milestones without scores or group harem state', () => {
        const view = buildStoryStudioViewModel(demo);
        const relationship = view.intelligence.relationships.items.find(item => item.id === 'linh-minh');
        expect(relationship?.participantIds).toEqual(['linh', 'minh']);
        expect(relationship?.currentRomanceMilestone).toBe('interest');
        expect(JSON.stringify(relationship)).not.toMatch(/affection|harem|score/i);
    });

    it('preserves Writer-safe military logistics, fallback, and cost only', () => {
        const view = buildStoryStudioViewModel(demo);
        const military = view.workflow.writerPlan?.strategicDirectives.items.find(item => item.domain === 'military');
        expect(military).toEqual(expect.objectContaining({
            domain: 'military',
            logistics: expect.stringContaining('tiếp tế/dự phòng'),
            fallback: expect.stringContaining('vịnh nhỏ phía tây'),
            cost: expect.stringContaining('tiêu hao'),
        }));
        expect(JSON.stringify(view.workflow.writerPlan)).not.toMatch(/opponentKnowledgeFactIds|privilegedCountermove|evidenceRefs/);
    });

    it('keeps Validator-only evidence out of Writer and Draft projections', () => {
        const validatorStrategicView: ValidatorStrategicView = {
            ...matchingStrategicView(),
            deterministicIssues: [{ code: 'MILITARY_LOGISTICS_VIOLATION', path: '$.strategicActions[0].logistics', severity: 'warning' }],
            resourceEvidence: [{ characterId: 'linh', resourceId: 'lamp-oil', quantity: 2 }],
            epistemicEvidence: [{ characterId: 'linh', factId: 'fact-bao' }],
        };
        const view = buildStoryStudioViewModel({ ...demo, validatorStrategicView });
        expect(view.validation.issues.items).toContainEqual(expect.objectContaining({ source: 'strategic-validator' }));
        expect(JSON.stringify(view.workflow.writerPlan)).not.toContain('resourceEvidence');
        expect(JSON.stringify(view.workflow.draft)).not.toContain('epistemicEvidence');
    });

    it('renders a stable empty view when no session is connected', () => {
        const view = buildStoryStudioViewModel({ mode: 'empty' });
        expect(view.project.mode).toBe('empty');
        expect(view.project.artifactStatusLabel).toBe('Chưa kết nối pipeline');
        expect(view.validation.status).toBe('not-run');
        expect(view.workflow.draft).toBeUndefined();
    });

    it('caps validation issues, reports truncation, and prioritizes critical blockers', () => {
        const warnings = Array.from({ length: 149 }, (_, index) => createValidationIssue('FILLER_SCENE', 'warning', 'semantic-validator', 'scene', `scene-${index}`));
        const critical = createValidationIssue('AUTHOR_SECRET_LEAK', 'critical', 'deterministic');
        const validationReport: ValidationReport = {
            kind: 'validation-report', chapterNumber: 13, status: 'blocked', validationPass: 1,
            issues: [...warnings, critical], blockingIssueCount: 1, warningCount: 149,
        };
        const view = buildStoryStudioViewModel({ ...demo, approvalStatus: 'rejected', validationReport }, {
            ...DEFAULT_STORY_STUDIO_DISPLAY_LIMITS,
            maxValidationIssues: 100,
        });
        expect(view.validation.issues.displayedCount).toBe(100);
        expect(view.validation.issues.totalCount).toBe(150);
        expect(view.validation.issues.truncated).toBe(true);
        expect(view.validation.issues.items[0].severity).toBe('critical');
    });

    it('fails closed when a draft has no Writer plan', () => {
        const view = buildStoryStudioViewModel({ ...demo, writerPlan: undefined });
        expect(view.consistency.status).toBe('error');
        expect(view.consistency.issues).toContain('Bản nháp không có kế hoạch Writer tương ứng.');
        expect(view.workflow.draft).toBeUndefined();
        expect(view.workflow.stages.find(stage => stage.id === 'writer')?.status).toBe('blocked');
    });

    it('fails closed when workflow artifacts belong to different chapters', () => {
        const validationReport: ValidationReport = { ...demo.validationReport!, chapterNumber: 14 };
        const view = buildStoryStudioViewModel({ ...demo, validationReport });
        expect(view.consistency.status).toBe('error');
        expect(view.consistency.issues).toContain('Các hiện vật workflow không cùng một chương mục tiêu.');
        expect(view.validation.status).toBe('not-run');
    });

    it('marks demo data visibly in the project projection', () => {
        const view = buildStoryStudioViewModel(demo);
        expect(view.project.mode).toBe('demo');
        expect(view.project.isDemo).toBe(true);
    });

    it('always exposes Make Canon as unavailable without a mutation callback', () => {
        const view = buildStoryStudioViewModel(demo);
        const makeCanon = view.workflow.stages.find(stage => stage.id === 'make-canon');
        expect(makeCanon).toEqual(expect.objectContaining({ status: 'unavailable', detail: 'Chưa khả dụng' }));
        expect(JSON.stringify(makeCanon)).not.toContain('callback');
    });

    it('does not mutate engine artifacts while presenting them', () => {
        const before = JSON.stringify(demo);
        buildStoryStudioViewModel(demo);
        expect(JSON.stringify(demo)).toBe(before);
    });

    it('uses presenter-specific demo data without fake engine artifacts', () => {
        const serialized = JSON.stringify(STORY_STUDIO_DEMO_VIEW_MODEL);
        expect(STORY_STUDIO_DEMO_VIEW_MODEL.project.isDemo).toBe(true);
        expect(STORY_STUDIO_DEMO_VIEW_MODEL.workflow.stages.every(stage => stage.status === 'unavailable')).toBe(true);
        expect(serialized).not.toContain('story-state');
        expect(serialized).not.toContain('internal-chapter-plan');
        expect(serialized).not.toContain('writer-chapter-plan');
        expect(serialized).toContain('không được tạo bởi Planner hoặc Writer');
    });

    it.each([
        ['draft prose', (marker: string) => ({ writerDraft: { ...demo.writerDraft!, prose: marker } })],
        ['Writer plan text', (marker: string) => ({ writerPlan: { ...demo.writerPlan!, primaryGoal: marker } })],
        ['internal-plan text', (marker: string) => ({ internalPlan: { ...demo.internalPlan!, primaryGoal: marker } })],
    ])('fails closed when protected material reaches %s', (_name, mutate) => {
        const marker = 'RAW_AUTHOR_SECRET_FINAL_BOUNDARY';
        const control: FullStoryControl = { ...demo.control!, authorOnlySecrets: [{ id: 'secret-id', value: marker }] };
        const view = buildStoryStudioViewModel({ ...demo, control, ...mutate(marker) });
        expect(JSON.stringify(view)).not.toContain(marker);
        expect(view.consistency).toEqual({ status: 'error', issues: ['Story Studio cannot safely display this session.'] });
        expect(view.workflow.draft).toBeUndefined();
    });

    it('fails closed when protected material reaches canonical fact or continuity text', () => {
        const marker = 'RAW_AUTHOR_SECRET_CANON_BOUNDARY';
        const control: FullStoryControl = { ...demo.control!, authorOnlySecrets: [{ id: 'secret-id', value: marker }] };
        const originalState = structuredClone(demo.state!);
        const state = {
            ...originalState,
            facts: originalState.facts.map((fact, index) => index === 0 ? { ...fact, text: marker } : fact),
            ledgers: {
                ...originalState.ledgers,
                facts: originalState.ledgers.facts.map((fact, index) => index === 0 ? { ...fact, text: marker } : fact),
                continuity: originalState.ledgers.continuity.map((item, index) => index === 0 ? { ...item, text: marker } : item),
            },
        };
        const view = buildStoryStudioViewModel({ ...demo, control, state });
        expect(JSON.stringify(view)).not.toContain(marker);
        expect(view.consistency.issues).toEqual(['Story Studio cannot safely display this session.']);
    });

    it('rejects a stale WriterContext plan even in the same chapter', () => {
        const writerContext = {
            kind: 'writer-context',
            targetChapter: 13,
            chapterPlan: { ...demo.writerPlan!, primaryGoal: 'stale same-chapter goal' },
        } as WriterContext;
        const view = buildStoryStudioViewModel({ ...demo, writerContext });
        expect(view.consistency.issues).toContain('Writer Context contains a stale same-chapter Writer plan.');
        expect(view.workflow.writerPlan).toBeUndefined();
    });

    it('rejects Internal and Writer plans with stale stable identities', () => {
        const internalPlan = { ...demo.internalPlan!, povCharacterId: 'minh' };
        const view = buildStoryStudioViewModel({ ...demo, internalPlan });
        expect(view.consistency.issues).toContain('Internal and Writer plans do not share stable chapter identities.');
        expect(view.workflow.internalPlan).toBeUndefined();
        expect(view.workflow.writerPlan).toBeUndefined();
    });

    it('rejects a stale ValidatorStrategicView in the same chapter', () => {
        const matching = matchingStrategicView();
        const validatorStrategicView: ValidatorStrategicView = {
            ...matching,
            actions: matching.actions.map((action, index) => index === 0
                ? { ...action, visibleObjective: 'stale objective' } : action),
        };
        const view = buildStoryStudioViewModel({ ...demo, validatorStrategicView });
        expect(view.consistency.issues).toContain('Validator strategic view is stale relative to the Writer plan.');
        expect(view.validation.status).toBe('not-run');
    });

    it('rejects a stale ValidatorRelationshipView in the same chapter', () => {
        const matching = matchingRelationshipView();
        const validatorRelationshipView: ValidatorRelationshipView = {
            ...matching,
            actions: matching.actions.map((action, index) => index === 0
                ? { ...action, visibleObjective: 'stale objective' } : action),
        };
        const view = buildStoryStudioViewModel({ ...demo, validatorRelationshipView });
        expect(view.consistency.issues).toContain('Validator relationship view is stale relative to the Writer plan.');
        expect(view.validation.status).toBe('not-run');
    });

    it('accepts exactly matching Writer and Validator artifact projections', () => {
        const view = buildStoryStudioViewModel({
            ...demo,
            validatorStrategicView: matchingStrategicView(),
            validatorRelationshipView: matchingRelationshipView(),
        });
        expect(view.consistency).toEqual({ status: 'ok', issues: [] });
        expect(view.workflow.writerPlan).toBeDefined();
    });

    it('hides unestablished control relationship definitions', () => {
        const template = demo.control!.relationshipDefinitions[0];
        const control: FullStoryControl = {
            ...demo.control!,
            relationshipDefinitions: [...demo.control!.relationshipDefinitions, { ...template, id: 'unestablished-romance' }],
        };
        const view = buildStoryStudioViewModel({ ...demo, control });
        expect(view.intelligence.relationships.items.some(item => item.id === 'unestablished-romance')).toBe(false);
        expect(view.overview.relationshipCount).toBe(demo.state!.relationships.length);
    });

    it('shows an established canonical relationship with matching definition metadata', () => {
        const view = buildStoryStudioViewModel(demo);
        expect(view.intelligence.relationships.items).toContainEqual(expect.objectContaining({
            id: 'linh-minh',
            categories: expect.arrayContaining(['romantic']),
            currentState: 'interest',
        }));
    });

    it('keeps a legacy canonical relationship without inventing romance metadata', () => {
        const state = {
            ...demo.state!,
            ledgers: {
                ...demo.state!.ledgers,
                relationships: [...demo.state!.ledgers.relationships, {
                    id: 'legacy-history-12', relationshipId: 'legacy-canonical', participantIds: ['linh', 'tuan'],
                    state: 'allies', chapterNumber: 12,
                    provenance: { sourceChapter: 12, sourceType: 'chapter' as const, sourceId: 'chapter-12' },
                }],
            },
        };
        const view = buildStoryStudioViewModel({ ...demo, state });
        expect(view.intelligence.relationships.items).toContainEqual(expect.objectContaining({
            id: 'legacy-canonical', categories: [], currentState: 'allies', currentRomanceMilestone: 'none', dynamicTags: [],
        }));
    });

    it('counts active characters before presentation truncation', () => {
        const ids = Array.from({ length: 80 }, (_, index) => `active-${index}`);
        const template = demo.control!.characters.linh;
        const characters = Object.fromEntries(ids.map((id, index) => [id, { ...template, id, name: `Active ${index}` }]));
        const control: FullStoryControl = {
            ...demo.control!,
            characters,
            characterOrder: ids,
            gates: { ...demo.control!.gates, characters: ids.map(id => ({ id: `gate-${id}`, characterId: id, allowedFromChapter: 1 })) },
        };
        const state = { ...demo.state!, activeCharacterIds: ids, knownCharacterIds: ids };
        const view = buildStoryStudioViewModel({ ...demo, control, state }, {
            ...DEFAULT_STORY_STUDIO_DISPLAY_LIMITS,
            maxCharacters: 50,
        });
        expect(view.intelligence.characters.displayedCount).toBe(50);
        expect(view.intelligence.characters.totalCount).toBe(80);
        expect(view.overview.activeCharacterCount).toBe(80);
    });

    it('bounds all remaining plan collections and removes unused privileged evidence IDs', () => {
        const writerPlan = {
            ...demo.writerPlan!,
            canonConstraints: Array.from({ length: 3 }, (_, index) => ({ id: `constraint-${index}`, text: `Constraint ${index}`, scope: 'canon' as const })),
            strategicDirectives: Array.from({ length: 3 }, (_, index) => ({ ...demo.writerPlan!.strategicDirectives![0], id: `strategy-${index}` })),
            relationshipDirectives: Array.from({ length: 3 }, (_, index) => ({ ...demo.writerPlan!.relationshipDirectives![0], id: `relationship-${index}` })),
            expectedContinuityConsequences: Array.from({ length: 3 }, (_, index) => ({ id: `consequence-${index}`, text: `Consequence ${index}` })),
        };
        const internalPlan = {
            ...demo.internalPlan!,
            activeConstraintIds: ['one', 'two', 'three'],
            plannedRevealIds: ['one', 'two', 'three'],
            strategicActions: Array.from({ length: 3 }, (_, index) => ({ ...demo.internalPlan!.strategicActions![0], id: `internal-strategy-${index}` })),
            relationshipActions: Array.from({ length: 3 }, (_, index) => ({ ...demo.internalPlan!.relationshipActions![0], id: `internal-relationship-${index}` })),
        };
        const view = buildStoryStudioViewModel({ ...demo, writerPlan, internalPlan }, {
            ...DEFAULT_STORY_STUDIO_DISPLAY_LIMITS,
            maxWriterConstraints: 1,
            maxStrategicDirectives: 1,
            maxRelationshipDirectives: 1,
            maxConsequences: 1,
            maxInternalIds: 1,
            maxInternalActions: 1,
        });
        const projectedWriter = view.workflow.writerPlan!;
        const projectedInternal = view.workflow.internalPlan!;
        [projectedWriter.constraints, projectedWriter.strategicDirectives, projectedWriter.relationshipDirectives,
            projectedWriter.expectedConsequences, projectedInternal.activeConstraintIds, projectedInternal.plannedRevealIds,
            projectedInternal.strategicActions, projectedInternal.relationshipActions]
            .forEach(collection => expect(collection).toEqual(expect.objectContaining({ displayedCount: 1, totalCount: 3, truncated: true })));
        expect(view.validation).not.toHaveProperty('strategicEvidenceIds');
        expect(view.validation).not.toHaveProperty('relationshipEvidenceIds');
    });
});
