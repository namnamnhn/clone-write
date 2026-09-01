import type { BoundedList, StoryStudioViewModel } from './storyStudioTypes';

const complete = <T>(items: readonly T[]): BoundedList<T> => ({
    items,
    displayedCount: items.length,
    totalCount: items.length,
    truncated: false,
});

/**
 * Deterministic presenter view data for exploring the UI. These values are deliberately not
 * StoryState, Planner, Writer, or Validator artifacts and make no engine-truth claim.
 */
export const STORY_STUDIO_DEMO_VIEW_MODEL: StoryStudioViewModel = {
    project: {
        privilege: 'canon-safe',
        mode: 'demo',
        id: 'studio-ui-demo',
        title: 'Hải Đăng Phía Bắc · Demo giao diện',
        isDemo: true,
        canonChapter: 12,
        targetChapter: 13,
        currentArc: { id: 'demo-arc', title: 'Bão Đen trên Vịnh Bắc' },
        currentBeat: { id: 'demo-beat', label: 'Beat minh họa' },
        artifactStatus: 'draft',
        artifactStatusLabel: 'Bản nháp minh họa · Không phải kết quả engine',
    },
    overview: {
        privilege: 'canon-safe',
        plannedChapterCount: 180,
        activeCharacterCount: 2,
        relationshipCount: 1,
        activeConstraintCount: 2,
        factCount: 1,
        openForeshadowCount: 1,
        outstandingPayoffCount: 1,
        strategicActionCount: 0,
        validationIssueCount: 0,
    },
    workflow: {
        stages: [
            { id: 'canon', label: 'Canon Context', status: 'unavailable', detail: 'Dữ liệu minh họa', help: 'Demo UI không kết nối StoryState.' },
            { id: 'planner', label: 'Planner', status: 'unavailable', detail: 'Dữ liệu minh họa', help: 'Demo UI không chạy Planner.' },
            { id: 'writer', label: 'Writer', status: 'unavailable', detail: 'Dữ liệu minh họa', help: 'Demo UI không chạy Writer.' },
            { id: 'validator', label: 'Validator', status: 'unavailable', detail: 'Dữ liệu minh họa', help: 'Demo UI không chạy Validator.' },
            { id: 'repair', label: 'Repair', status: 'unavailable', detail: 'Chưa khả dụng', help: 'Demo UI không chạy Repair.' },
            { id: 'approved', label: 'Đạt QA', status: 'unavailable', detail: 'Không phải hiện vật thật', help: 'Demo không tuyên bố đã đạt QA.' },
            { id: 'make-canon', label: 'Make Canon', status: 'unavailable', detail: 'Chưa khả dụng', help: 'State Extractor / Make Canon chưa được triển khai.' },
        ],
        writerPlan: {
            privilege: 'writer-safe',
            chapterNumber: 13,
            primaryGoal: 'Minh họa cách Story Studio trình bày một mục tiêu chương.',
            arcTitle: 'Bão Đen trên Vịnh Bắc',
            beatLabel: 'Beat minh họa',
            povName: 'Linh An',
            participantNames: ['Linh An', 'Minh Kha'],
            scenes: complete([
                {
                    id: 'demo-scene', order: 1, goal: 'Thống nhất tuyến tiếp tế.', location: 'Phòng tín hiệu',
                    povName: 'Linh An', participantNames: ['Linh An', 'Minh Kha'], conflict: 'Ưu tiên nguồn lực khác nhau.',
                    uncertainty: 'Thỏa thuận có thể đổ vỡ.', expectedConsequence: 'Một nghĩa vụ mới được ghi nhận.', purposeTags: ['demo'],
                },
            ]),
            constraints: complete([{ id: 'demo-constraint', text: 'Ràng buộc minh họa cho bố cục.', scope: 'demo' }]),
            strategicDirectives: complete([]),
            relationshipDirectives: complete([]),
            expectedConsequences: complete(['Hệ quả minh họa, không phải Canon.']),
            endStateIntent: 'Kết thúc phần minh họa ở trạng thái chưa Canon.',
        },
        draft: {
            privilege: 'writer-safe', chapterNumber: 13, title: 'Bản nháp minh họa',
            prose: 'Đây là văn bản trình diễn giao diện, không được tạo bởi Planner hoặc Writer và không phải Canon.',
            status: 'draft', statusLabel: 'Bản nháp minh họa · Không phải kết quả engine',
        },
    },
    validation: {
        privilege: 'validator-only', status: 'not-run', blockingIssueCount: 0,
        counts: { critical: 0, error: 0, warning: 0 }, issues: complete([]),
    },
    intelligence: {
        canonPrivilege: 'canon-safe',
        characters: complete([
            { id: 'linh', name: 'Linh An', active: true, lifeStatus: 'alive', role: 'Người giữ hải đăng', injuries: [], conditions: [] },
            { id: 'minh', name: 'Minh Kha', active: true, lifeStatus: 'alive', role: 'Sứ giả hội đồng', injuries: [], conditions: [] },
        ]),
        relationships: complete([
            {
                id: 'demo-relationship', participantIds: ['linh', 'minh'], participantNames: ['Linh An', 'Minh Kha'],
                categories: ['professional'], currentState: 'minh họa', dynamicTags: [], recentChanges: [],
            },
        ]),
        facts: complete([{ id: 'demo-fact', text: 'Sự thật minh họa, không phải Canon.', establishedChapter: 12, visibility: 'writer', status: 'active', knownBy: [] }]),
        beliefs: complete([]),
        secrets: complete([]),
        reveals: complete([]),
        foreshadow: complete([]),
        payoffs: complete([]),
        continuity: { activeLocations: [], items: complete([]) },
    },
    consistency: { status: 'ok', issues: [] },
};

export const EMPTY_STORY_STUDIO_SESSION = { mode: 'empty' } as const;
