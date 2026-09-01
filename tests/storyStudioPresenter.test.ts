import { describe, expect, it } from 'vitest';
import { createValidationIssue } from '../src/storyEngine';
import type { FullStoryControl, ValidationReport, ValidatorStrategicView } from '../src/storyEngine';
import { STORY_STUDIO_DEMO_SESSION } from '../src/storyStudio/storyStudioDemoSession';
import { buildStoryStudioViewModel } from '../src/storyStudio/storyStudioPresenter';
import { DEFAULT_STORY_STUDIO_DISPLAY_LIMITS } from '../src/storyStudio/storyStudioTypes';

const demo = STORY_STUDIO_DEMO_SESSION;

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
        const military = view.workflow.writerPlan?.strategicDirectives.find(item => item.domain === 'military');
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
            kind: 'validator-strategic-view',
            chapterNumber: 13,
            actions: [],
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
});
