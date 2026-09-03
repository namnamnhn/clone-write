import type { StoryStudioSession } from '../storyStudioTypes';
import type { StoryStudioRuntimeProject } from './storyStudioProjectTypes';

export const buildConnectedStoryStudioSession = (project: StoryStudioRuntimeProject): StoryStudioSession => {
    const workflow = project.workflow;
    const plan = workflow.stage === 'idle' ? undefined : workflow.plan;
    const draft = workflow.stage === 'drafted' || workflow.stage === 'validated' || workflow.stage === 'rejected'
        || workflow.stage === 'extracted' || workflow.stage === 'ready-for-canon-review' ? workflow.draft : undefined;
    const validation = workflow.stage === 'validated' || workflow.stage === 'rejected'
        || workflow.stage === 'extracted' || workflow.stage === 'ready-for-canon-review' ? workflow.validation : undefined;
    return {
        mode: 'connected', projectTitle: project.displayName, control: project.control, state: project.state,
        ...(plan === undefined ? {} : {
            internalPlan: plan.privileged.internalPlan,
            writerPlan: plan.writerPlan,
            validatorStrategicView: plan.privileged.strategicView,
            validatorRelationshipView: plan.privileged.relationshipView,
        }),
        ...(draft === undefined ? {} : { writerDraft: draft.draft }),
        ...(validation === undefined ? {} : {
            validationReport: validation.result.report,
            approvalStatus: validation.result.status === 'approved-not-canon' ? 'approved-not-canon' as const : 'rejected' as const,
        }),
        canonReviewReady: workflow.stage === 'ready-for-canon-review',
    };
};

export interface CanonicalChapterHistoryEntry {
    readonly chapterNumber: number;
    readonly title?: string;
    readonly text: string;
}

export const getCanonicalChapterHistoryEntry = (
    project: StoryStudioRuntimeProject,
    chapterNumber: number,
): CanonicalChapterHistoryEntry | undefined => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) return undefined;
    const record = project.memory.records[chapterNumber - 1];
    const metadata = project.chapterMetadata[chapterNumber - 1];
    if (!record || !metadata || record.chapterNumber !== chapterNumber || metadata.chapterNumber !== chapterNumber) return undefined;
    return {
        chapterNumber,
        ...(metadata.title === undefined ? {} : { title: metadata.title }),
        text: record.raw.text,
    };
};

export const buildMergedCanonicalChapterText = (project: StoryStudioRuntimeProject): string =>
    project.memory.records.map((record, index) => {
        const title = project.chapterMetadata[index]?.title;
        return [`Chương ${record.chapterNumber}${title ? `: ${title}` : ''}`, '', record.raw.text].join('\n');
    }).join('\n\n\n');
