import {
    countConsecutiveRomanticProgressions,
    deriveCurrentRomanceMilestone,
    getArcForChapter,
    getAuthorSecretStatus,
    getBeatForChapter,
    getForeshadowThreadStatus,
    getPayoffStatus,
    getRevealOccurrence,
    isCharacterDirectAppearanceAllowed,
    isRevealAllowed,
} from '../storyEngine';
import type {
    FullStoryControl,
    StoryFact,
    StoryState,
    ValidationIssue,
    WriterChapterPlan,
    WriterStrategicDirective,
} from '../storyEngine';
import {
    DEFAULT_STORY_STUDIO_DISPLAY_LIMITS,
    type BoundedList,
    type StoryStudioCharacterView,
    type StoryStudioDisplayLimits,
    type StoryStudioDraftView,
    type StoryStudioFactView,
    type StoryStudioInternalPlanView,
    type StoryStudioIssueSeverity,
    type StoryStudioRelationshipDirectiveView,
    type StoryStudioRelationshipView,
    type StoryStudioSceneView,
    type StoryStudioSession,
    type StoryStudioStrategicDirectiveView,
    type StoryStudioValidationIssueView,
    type StoryStudioValidationView,
    type StoryStudioViewModel,
    type StoryStudioWorkflowStageView,
    type StoryStudioWriterPlanView,
    type StudioArtifactStatus,
} from './storyStudioTypes';

const bounded = <T>(items: readonly T[], capacity: number): BoundedList<T> => {
    const safeCapacity = Number.isSafeInteger(capacity) && capacity >= 0 ? capacity : 0;
    const selected = items.slice(0, safeCapacity);
    return {
        items: selected,
        displayedCount: selected.length,
        totalCount: items.length,
        truncated: items.length > selected.length,
    };
};

const characterName = (control: FullStoryControl, id: string): string => control.characters[id]?.name ?? id;

const artifactChapters = (session: StoryStudioSession): readonly number[] => [
    session.plannerContext?.targetChapter,
    session.internalPlan?.chapterNumber,
    session.writerPlan?.chapterNumber,
    session.writerContext?.targetChapter,
    session.writerDraft?.chapterNumber,
    session.validationReport?.chapterNumber,
    session.validatorStrategicView?.chapterNumber,
    session.validatorRelationshipView?.chapterNumber,
].filter((value): value is number => value !== undefined);

const validateConsistency = (session: StoryStudioSession): readonly string[] => {
    if (session.mode === 'empty') return [];
    const issues: string[] = [];
    if (!session.control || !session.state) issues.push('Phiên Studio thiếu Story Control hoặc Canon hiện tại.');
    if (session.writerDraft && !session.writerPlan) issues.push('Bản nháp không có kế hoạch Writer tương ứng.');
    if (session.validationReport && !session.writerDraft) issues.push('Báo cáo kiểm định không có bản nháp tương ứng.');
    if (session.approvalStatus && !session.validationReport) issues.push('Trạng thái duyệt không có báo cáo kiểm định.');
    if (session.approvalStatus === 'approved-not-canon' && session.validationReport?.status !== 'passed') {
        issues.push('Trạng thái đạt QA không khớp với báo cáo kiểm định.');
    }
    if (session.approvalStatus === 'rejected' && session.validationReport?.status !== 'blocked') {
        issues.push('Trạng thái bị từ chối không khớp với báo cáo kiểm định.');
    }
    const chapters = artifactChapters(session);
    if (new Set(chapters).size > 1) issues.push('Các hiện vật workflow không cùng một chương mục tiêu.');
    if (session.state && chapters[0] !== undefined && session.state.currentChapter >= chapters[0]) {
        issues.push('Chương mục tiêu phải nằm sau Canon hiện tại.');
    }
    return issues;
};

const emptyViewModel = (mode: StoryStudioSession['mode'], title = 'Story Engine V4'): StoryStudioViewModel => ({
    project: {
        privilege: 'canon-safe', mode, title, isDemo: mode === 'demo', artifactStatus: 'canon',
        artifactStatusLabel: 'Chưa kết nối pipeline',
    },
    overview: {
        privilege: 'canon-safe', plannedChapterCount: 0, activeCharacterCount: 0, relationshipCount: 0,
        activeConstraintCount: 0, factCount: 0, openForeshadowCount: 0, outstandingPayoffCount: 0,
        strategicActionCount: 0, validationIssueCount: 0,
    },
    workflow: { stages: buildWorkflowStages(undefined, undefined, undefined, undefined) },
    validation: emptyValidation(),
    intelligence: {
        canonPrivilege: 'canon-safe', characters: bounded([], 0), relationships: bounded([], 0), facts: bounded([], 0),
        beliefs: bounded([], 0), secrets: bounded([], 0), reveals: bounded([], 0), foreshadow: bounded([], 0),
        payoffs: bounded([], 0), continuity: { activeLocations: [], items: bounded([], 0) },
    },
    consistency: { status: 'ok', issues: [] },
});

const artifactStatusFor = (session: StoryStudioSession): StudioArtifactStatus => {
    if (session.approvalStatus) return session.approvalStatus;
    if (session.validationReport) return session.validationReport.status === 'passed' ? 'validated' : 'rejected';
    if (session.writerDraft) return 'draft';
    if (session.writerPlan || session.internalPlan || session.plannerContext) return 'planned';
    return 'canon';
};

const artifactStatusLabel: Readonly<Record<StudioArtifactStatus, string>> = {
    canon: 'Canon hiện tại',
    planned: 'Kế hoạch chương',
    draft: 'Bản nháp — Chưa Canon',
    validated: 'Đã kiểm định — Chưa Canon',
    'approved-not-canon': 'Đạt QA — Chưa Canon',
    rejected: 'Bị từ chối — Chưa Canon',
};

const buildWorkflowStages = (
    session?: StoryStudioSession,
    status?: StudioArtifactStatus,
    targetChapter?: number,
    consistencyOk = true,
): readonly StoryStudioWorkflowStageView[] => {
    if (!session) {
        return [
            stage('canon', 'Canon Context', 'waiting', 'Chưa có Canon', 'Canon là trạng thái truyện đã được xác nhận.'),
            stage('planner', 'Planner', 'waiting', 'Chưa có kế hoạch', 'Planner dựng kế hoạch nội bộ cho chương kế tiếp.'),
            stage('writer', 'Writer', 'waiting', 'Chưa có bản nháp', 'Writer chỉ nhận kế hoạch và ngữ cảnh an toàn.'),
            stage('validator', 'Validator', 'waiting', 'Chưa kiểm định', 'Validator kiểm tra bản nháp với Canon và kế hoạch.'),
            stage('repair', 'Repair', 'waiting', 'Chưa cần sửa', 'Repair chỉ chạy khi pipeline thật được kết nối.'),
            stage('approved', 'Đạt QA', 'waiting', 'Chưa duyệt', 'Đạt QA vẫn chưa trở thành Canon.'),
            stage('make-canon', 'Make Canon', 'unavailable', 'Chưa khả dụng', 'State Extractor / Make Canon chưa được triển khai.'),
        ];
    }
    if (!consistencyOk) {
        return [
            stage('canon', 'Canon Context', session.state ? 'complete' : 'blocked', session.state ? `Canon chương ${session.state.currentChapter}` : 'Thiếu Canon', 'Canon là trạng thái truyện đã được xác nhận.'),
            stage('planner', 'Planner', 'blocked', 'Phiên không nhất quán', 'Các hiện vật workflow không được trộn khi sai chương.'),
            stage('writer', 'Writer', 'blocked', 'Phiên không nhất quán', 'Bản nháp bị đóng để tránh hiển thị sai ngữ cảnh.'),
            stage('validator', 'Validator', 'blocked', 'Phiên không nhất quán', 'Kiểm định chỉ hiển thị khi cùng chương với bản nháp.'),
            stage('repair', 'Repair', 'blocked', 'Phiên không nhất quán', 'Không thể đánh giá sửa chữa.'),
            stage('approved', 'Đạt QA', 'blocked', 'Không thể xác nhận', 'Đạt QA vẫn chưa trở thành Canon.'),
            stage('make-canon', 'Make Canon', 'unavailable', 'Chưa khả dụng', 'State Extractor / Make Canon chưa được triển khai.'),
        ];
    }
    const report = session.validationReport;
    const hasPlan = Boolean(session.writerPlan || session.internalPlan);
    const hasPlannerContext = Boolean(session.plannerContext);
    const hasDraft = Boolean(session.writerDraft);
    const repairAttempted = (report?.validationPass ?? 1) > 1;
    return [
        stage('canon', 'Canon Context', session.state ? 'complete' : 'blocked', session.state ? `Canon chương ${session.state.currentChapter}` : 'Thiếu Canon', 'Canon là trạng thái truyện đã được xác nhận.'),
        stage('planner', 'Planner', hasPlan ? 'complete' : hasPlannerContext ? 'ready' : 'waiting', hasPlan ? `Đã lập chương ${targetChapter}` : hasPlannerContext ? 'Sẵn sàng lập kế hoạch' : 'Đang chờ', 'Planner dựng kế hoạch nội bộ cho chương kế tiếp.'),
        stage('writer', 'Writer', hasDraft ? 'complete' : session.writerPlan ? 'ready' : 'waiting', hasDraft ? `Đã có bản nháp chương ${targetChapter}` : session.writerPlan ? 'Sẵn sàng viết' : 'Đang chờ kế hoạch', 'Writer chỉ nhận kế hoạch và ngữ cảnh an toàn.'),
        stage('validator', 'Validator', report ? (report.status === 'passed' ? 'complete' : 'failed') : hasDraft ? 'ready' : 'waiting', report ? (report.status === 'passed' ? 'Đã vượt kiểm định' : 'Có lỗi chặn') : hasDraft ? 'Sẵn sàng kiểm định' : 'Đang chờ bản nháp', 'Validator kiểm tra bản nháp với Canon và kế hoạch.'),
        stage('repair', 'Repair', repairAttempted ? (report?.status === 'passed' ? 'complete' : 'failed') : report?.status === 'blocked' ? 'ready' : 'unavailable', repairAttempted ? `Đã chạy lượt ${report?.validationPass}` : report?.status === 'blocked' ? 'Có thể cần sửa' : 'Chưa được gọi', 'Repair chỉ chạy khi pipeline thật được kết nối.'),
        stage('approved', 'Đạt QA', status === 'approved-not-canon' ? 'complete' : status === 'rejected' ? 'failed' : report?.status === 'passed' ? 'ready' : 'waiting', status === 'approved-not-canon' ? 'Đạt QA — Chưa Canon' : status === 'rejected' ? 'Bị từ chối' : report?.status === 'passed' ? 'Chờ xác nhận pipeline' : 'Chưa duyệt', 'Đạt QA vẫn chưa trở thành Canon.'),
        stage('make-canon', 'Make Canon', 'unavailable', 'Chưa khả dụng', 'State Extractor / Make Canon chưa được triển khai.'),
    ];
};

const stage = (
    id: StoryStudioWorkflowStageView['id'],
    label: string,
    status: StoryStudioWorkflowStageView['status'],
    detail: string,
    help: string,
): StoryStudioWorkflowStageView => ({ id, label, status, detail, help });

const buildCharacters = (
    control: FullStoryControl,
    state: StoryState,
    targetChapter: number,
    limit: number,
): BoundedList<StoryStudioCharacterView> => {
    const projectionById = new Map(state.projections.characters.map(value => [value.characterId, value]));
    const items = control.characterOrder
        .filter(id => isCharacterDirectAppearanceAllowed(control, id, targetChapter))
        .map((id): StoryStudioCharacterView => {
            const character = control.characters[id];
            const runtime = state.characterStatuses[id];
            const projection = projectionById.get(id);
            return {
                id,
                name: character.name,
                active: state.activeCharacterIds.includes(id) || projection?.active === true,
                lifeStatus: projection?.lifeStatus ?? 'unknown',
                ...(state.characterLocations[id] === undefined ? {} : { location: state.characterLocations[id] }),
                ...(character.writerProfile.role === undefined ? {} : { role: character.writerProfile.role }),
                ...(runtime?.status === undefined ? {} : { status: runtime.status }),
                injuries: runtime?.injuries.slice() ?? [],
                conditions: runtime?.conditions.slice() ?? [],
            };
        })
        .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    return bounded(items, limit);
};

const buildRelationships = (
    control: FullStoryControl,
    state: StoryState,
    targetChapter: number,
    limit: number,
): BoundedList<StoryStudioRelationshipView> => {
    const available = new Set(control.characterOrder.filter(id => isCharacterDirectAppearanceAllowed(control, id, targetChapter)));
    const canonicalById = new Map(state.relationships.filter(item => item.establishedChapter <= state.currentChapter).map(item => [item.id, item]));
    const items = control.relationshipDefinitions
        .filter(definition => definition.participantIds.every(id => available.has(id)))
        .map((definition): StoryStudioRelationshipView => {
            const history = state.ledgers.relationships
                .filter(item => item.relationshipId === definition.id && item.chapterNumber <= state.currentChapter)
                .slice()
                .sort((left, right) => left.chapterNumber - right.chapterNumber || left.id.localeCompare(right.id));
            const milestone = deriveCurrentRomanceMilestone(definition, state, state.currentChapter || targetChapter);
            const romantic = definition.categories.includes('romantic');
            const consecutive = countConsecutiveRomanticProgressions(history, targetChapter);
            return {
                id: definition.id,
                participantIds: definition.participantIds.slice(),
                participantNames: definition.participantIds.map(id => characterName(control, id)),
                categories: definition.categories.slice(),
                ...(canonicalById.get(definition.id)?.state === undefined ? {} : { currentState: canonicalById.get(definition.id)!.state }),
                currentRomanceMilestone: milestone,
                slowBurnStatus: romantic ? (consecutive > 0 ? 'progressing' : 'stable') : 'not-applicable',
                dynamicTags: definition.dynamicProfile.coreDynamicTags.slice(),
                recentChanges: history.slice(-3).map(item => ({ id: item.id, chapterNumber: item.chapterNumber, state: item.state })),
            };
        })
        .sort((left, right) => left.id.localeCompare(right.id));
    return bounded(items, limit);
};

const canonicalFacts = (state: StoryState): readonly StoryFact[] => {
    const source = state.ledgers.facts.length > 0 ? state.ledgers.facts : state.facts;
    return source
        .filter(fact => fact.establishedChapter <= state.currentChapter && (fact.status ?? 'active') === 'active')
        .slice()
        .sort((left, right) => left.establishedChapter - right.establishedChapter || left.id.localeCompare(right.id));
};

const buildFacts = (
    control: FullStoryControl,
    state: StoryState,
    targetChapter: number,
    limit: number,
): BoundedList<StoryStudioFactView> => {
    const available = new Set(control.characterOrder.filter(id => isCharacterDirectAppearanceAllowed(control, id, targetChapter)));
    const epistemicKnown = state.ledgers.epistemic.filter(item => item.kind === 'known' && item.status === 'active' && item.factId && item.learnedChapter <= state.currentChapter);
    const items = canonicalFacts(state).map((fact): StoryStudioFactView => {
        const holderIds = new Set<string>();
        state.characterKnowledge.forEach(entry => {
            if (available.has(entry.characterId) && entry.factIds.includes(fact.id)) holderIds.add(entry.characterId);
        });
        epistemicKnown.forEach(entry => {
            if (entry.factId === fact.id && available.has(entry.characterId)) holderIds.add(entry.characterId);
        });
        return {
            id: fact.id,
            text: fact.text,
            establishedChapter: fact.establishedChapter,
            visibility: fact.visibility,
            status: fact.status ?? 'active',
            knownBy: [...holderIds].sort().map(id => ({ id, name: characterName(control, id) })),
        };
    });
    return bounded(items, limit);
};

const mapStrategicDirective = (control: FullStoryControl, directive: WriterStrategicDirective): StoryStudioStrategicDirectiveView => {
    const shared = {
        id: directive.id,
        objective: directive.visibleObjective,
        actorName: characterName(control, directive.actorCharacterId),
        constraints: directive.visibleConstraints.slice(),
        cost: directive.expectedCostOrTradeoff,
        ...(directive.writerVisibleCounterplay === undefined ? {} : { counterplay: directive.writerVisibleCounterplay.action }),
    };
    if (directive.domain === 'politics') {
        const timing = [
            directive.timing.earliestChapter === undefined ? undefined : `sớm nhất C${directive.timing.earliestChapter}`,
            directive.timing.deadlineChapter === undefined ? undefined : `hạn C${directive.timing.deadlineChapter}`,
            `${directive.timing.preparationChapters} chương chuẩn bị`,
        ].filter(Boolean).join(' · ');
        return { ...shared, domain: 'politics', dimensions: directive.dimensionStatuses.map(value => ({ ...value })), timing };
    }
    if (directive.domain === 'military') {
        return {
            ...shared,
            cost: `${directive.expectedCostOrTradeoff} · ${directive.expectedLossOrCost}`,
            domain: 'military',
            operationType: directive.operationType,
            location: directive.location,
            ...(directive.movement === undefined ? {} : { movement: `${directive.movement.fromLocation} → ${directive.movement.toLocation} · ${directive.movement.method}` }),
            ...(directive.logistics === undefined ? {} : { logistics: `${directive.logistics.movementConstraint} · tiếp tế/dự phòng: ${directive.logistics.resupplyOrFallback}` }),
            fallback: directive.retreatOrFailurePlan,
        };
    }
    return {
        ...shared,
        domain: 'commerce',
        actionType: directive.actionType,
        flows: directive.resourceFlows.map(flow => `${flow.role}: ${flow.quantityDelta > 0 ? '+' : ''}${flow.quantityDelta} ${flow.resourceId}`),
        ...(directive.counterpartyCharacterId === undefined ? {} : { counterparty: characterName(control, directive.counterpartyCharacterId) }),
        logistics: directive.logistics,
        risk: directive.risk,
        ...(directive.fundingResource === undefined ? {} : { funding: directive.fundingResource.resourceId }),
    };
};

const mapRelationshipDirective = (control: FullStoryControl, directive: NonNullable<WriterChapterPlan['relationshipDirectives']>[number]): StoryStudioRelationshipDirectiveView => ({
    id: directive.id,
    relationshipId: directive.relationshipId,
    participants: directive.participantIds.map(id => characterName(control, id)),
    category: directive.category,
    actionType: directive.actionType,
    milestone: directive.intendedProgression.romanticMilestone,
    objective: directive.visibleObjective,
    conflict: directive.visibleConflict,
    uncertainty: directive.visibleUncertainty,
    cost: directive.expectedCostOrTradeoff,
    choices: directive.participantChoices.map(choice => ({ characterName: characterName(control, choice.characterId), choice: choice.choice, willingness: choice.willingness })),
    boundaries: directive.visibleBoundaries.map(boundary => ({ characterName: characterName(control, boundary.characterId), instruction: boundary.instruction, stance: boundary.stance })),
});

const buildWriterPlan = (
    control: FullStoryControl,
    plan: WriterChapterPlan,
    limits: StoryStudioDisplayLimits,
): StoryStudioWriterPlanView => {
    const scenes: StoryStudioSceneView[] = plan.scenes.map(scene => ({
        id: scene.id,
        order: scene.order,
        goal: scene.goal,
        location: scene.location,
        povName: characterName(control, scene.povCharacterId),
        participantNames: scene.participantIds.map(id => characterName(control, id)),
        conflict: scene.conflictOrObstacle,
        uncertainty: scene.uncertainty,
        expectedConsequence: scene.expectedConsequence,
        purposeTags: scene.purposeTags.slice(),
    }));
    return {
        privilege: 'writer-safe',
        chapterNumber: plan.chapterNumber,
        primaryGoal: plan.primaryGoal,
        arcTitle: plan.arc.title,
        ...(plan.beat === undefined ? {} : { beatLabel: `Beat ${plan.beat.order}` }),
        povName: characterName(control, plan.povCharacterId),
        participantNames: plan.participantIds.map(id => characterName(control, id)),
        scenes: bounded(scenes, limits.maxScenes),
        constraints: plan.canonConstraints.map(item => ({ ...item })),
        strategicDirectives: (plan.strategicDirectives ?? []).map(item => mapStrategicDirective(control, item)),
        relationshipDirectives: (plan.relationshipDirectives ?? []).map(item => mapRelationshipDirective(control, item)),
        expectedConsequences: plan.expectedContinuityConsequences.map(item => item.text),
        endStateIntent: plan.endStateIntent,
    };
};

const buildInternalPlan = (
    control: FullStoryControl,
    plan: NonNullable<StoryStudioSession['internalPlan']>,
    limits: StoryStudioDisplayLimits,
): StoryStudioInternalPlanView => ({
    privilege: 'planner-internal',
    chapterNumber: plan.chapterNumber,
    primaryGoal: plan.primaryGoal,
    participantNames: plan.participantIds.map(id => characterName(control, id)),
    scenes: bounded(plan.scenes.map(scene => ({
        id: scene.id,
        order: scene.order,
        goal: scene.goal,
        expectedConsequence: scene.expectedConsequence,
        purposeTags: scene.purposeTags.slice(),
    })), limits.maxScenes),
    activeConstraintIds: plan.activeConstraintIds.slice(),
    plannedRevealIds: plan.plannedRevealIds.slice(),
    strategicActions: (plan.strategicActions ?? []).map(action => ({ id: action.id, domain: action.domain, objective: action.objective })),
    relationshipActions: (plan.relationshipActions ?? []).map(action => ({ id: action.id, relationshipId: action.relationshipId, actionType: action.actionType })),
});

const draftStatus = (session: StoryStudioSession): StoryStudioDraftView['status'] => {
    if (session.approvalStatus) return session.approvalStatus;
    if (session.validationReport) return session.validationReport.status === 'passed' ? 'validated' : 'rejected';
    return 'draft';
};

const draftStatusLabel: Readonly<Record<StoryStudioDraftView['status'], string>> = {
    draft: 'Bản nháp — Chưa Canon',
    validated: 'Đã kiểm định — Chưa Canon',
    'approved-not-canon': 'Đạt QA — Chưa Canon',
    rejected: 'Bị từ chối — Chưa Canon',
};

const validationMessage = (code: string): string => {
    const messages: Readonly<Record<string, string>> = {
        AUTHOR_SECRET_LEAK: 'Bản nháp có dấu hiệu làm lộ dữ liệu bí mật của tác giả.',
        CANON_CONTRADICTION: 'Nội dung mâu thuẫn với Canon hiện tại.',
        CONTINUITY_CONTRADICTION: 'Chi tiết liên tục không khớp với trạng thái truyện.',
        PLAN_DRIFT: 'Bản nháp đi lệch kế hoạch chương đã duyệt.',
        POV_VIOLATION: 'Góc nhìn kể chuyện không đúng kế hoạch.',
        CHARACTER_GATE_VIOLATION: 'Nhân vật xuất hiện trước thời điểm được phép.',
        PREMATURE_REVEAL: 'Thông tin được tiết lộ quá sớm.',
        FILLER_SCENE: 'Cảnh có dấu hiệu chưa đóng góp đủ cho chương.',
        CONSEQUENCE_MISSING: 'Hành động chưa tạo ra hệ quả cần thiết.',
        RELATIONSHIP_CONTRACT_VIOLATION: 'Diễn biến quan hệ không tuân thủ hợp đồng Writer-safe.',
        MILITARY_LOGISTICS_VIOLATION: 'Kế hoạch quân sự thiếu hoặc sai logic hậu cần.',
        RELATIONSHIP_BOUNDARY_VIOLATION: 'Diễn biến quan hệ vượt qua ranh giới đã đặt.',
    };
    return messages[code] ?? `Vấn đề kiểm định: ${code.replaceAll('_', ' ').toLocaleLowerCase('vi-VN')}.`;
};

const severityOrder: Readonly<Record<StoryStudioIssueSeverity, number>> = { critical: 0, error: 1, warning: 2 };

const reportIssue = (issue: ValidationIssue, index: number): StoryStudioValidationIssueView => ({
    id: `report:${issue.code}:${issue.sceneId ?? issue.scope}:${index}`,
    code: issue.code,
    severity: issue.severity,
    domain: issue.category,
    message: validationMessage(issue.code),
    path: issue.sceneId ? `scene:${issue.sceneId}` : issue.scope,
    blocking: issue.blocking,
    source: 'validation-report',
});

const emptyValidation = (): StoryStudioValidationView => ({
    privilege: 'validator-only', status: 'not-run', blockingIssueCount: 0,
    counts: { critical: 0, error: 0, warning: 0 }, issues: bounded([], 0),
    strategicEvidenceIds: [], relationshipEvidenceIds: [],
});

const buildValidation = (session: StoryStudioSession, limit: number): StoryStudioValidationView => {
    const report = session.validationReport;
    const issues: StoryStudioValidationIssueView[] = report?.issues.map(reportIssue) ?? [];
    session.validatorStrategicView?.deterministicIssues.forEach((issue, index) => {
        issues.push({
            id: `strategic:${issue.code}:${issue.path}:${index}`, code: issue.code, severity: issue.severity,
            domain: 'strategy', message: validationMessage(issue.code), path: issue.path, blocking: issue.severity === 'error',
            source: 'strategic-validator',
        });
    });
    session.validatorRelationshipView?.deterministicIssues.forEach((issue, index) => {
        issues.push({
            id: `relationship:${issue.code}:${issue.path}:${index}`, code: issue.code, severity: issue.severity,
            domain: 'relationship', message: validationMessage(issue.code), path: issue.path, blocking: issue.severity === 'error',
            source: 'relationship-validator',
        });
    });
    issues.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
        || left.domain.localeCompare(right.domain) || left.code.localeCompare(right.code)
        || left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
    const counts = issues.reduce((total, issue) => ({ ...total, [issue.severity]: total[issue.severity] + 1 }), { critical: 0, error: 0, warning: 0 });
    const strategicEvidenceIds = session.validatorStrategicView?.actions
        .flatMap(action => action.evidenceRefs.map(ref => {
            if ('id' in ref) return ref.id;
            if ('factId' in ref) return `${ref.characterId}:${ref.factId}`;
            if ('resourceId' in ref) return `${ref.characterId}:${ref.resourceId}`;
            return `${ref.characterId}:${ref.value}`;
        }))
        .slice().sort() ?? [];
    const relationshipEvidenceIds = session.validatorRelationshipView?.actions
        .flatMap(action => action.evidenceRefs.map(ref => {
            if ('id' in ref) return ref.id;
            if ('factId' in ref) return `${ref.characterId}:${ref.factId}`;
            if ('epistemicId' in ref) return `${ref.characterId}:${ref.epistemicId}`;
            return `${ref.characterId}:${ref.value}`;
        }))
        .slice().sort() ?? [];
    return {
        privilege: 'validator-only',
        status: report?.status ?? 'not-run',
        ...(report === undefined ? {} : { chapterNumber: report.chapterNumber, validationPass: report.validationPass }),
        blockingIssueCount: issues.filter(issue => issue.blocking).length,
        counts,
        issues: bounded(issues, limit),
        strategicEvidenceIds,
        relationshipEvidenceIds,
    };
};

export const buildStoryStudioViewModel = (
    session: StoryStudioSession,
    suppliedLimits: StoryStudioDisplayLimits = DEFAULT_STORY_STUDIO_DISPLAY_LIMITS,
): StoryStudioViewModel => {
    if (session.mode === 'empty') return emptyViewModel('empty', session.projectTitle ?? 'Story Engine V4');
    const consistencyIssues = validateConsistency(session);
    if (!session.control || !session.state) {
        const empty = emptyViewModel(session.mode, session.projectTitle ?? 'Story Engine V4');
        return { ...empty, consistency: { status: 'error', issues: consistencyIssues } };
    }

    const control = session.control;
    const state = session.state;
    const chapters = artifactChapters(session);
    const targetChapter = chapters[0] ?? Math.min(state.currentChapter + 1, control.engine.plannedChapterCount);
    const consistencyOk = consistencyIssues.length === 0;
    const safeSession: StoryStudioSession = consistencyOk ? session : { mode: session.mode, projectTitle: session.projectTitle, control, state };
    const artifactStatus = artifactStatusFor(safeSession);
    const characters = buildCharacters(control, state, targetChapter, suppliedLimits.maxCharacters);
    const relationships = buildRelationships(control, state, targetChapter, suppliedLimits.maxRelationships);
    const facts = buildFacts(control, state, targetChapter, suppliedLimits.maxFacts);
    const available = new Set(control.characterOrder.filter(id => isCharacterDirectAppearanceAllowed(control, id, targetChapter)));
    const beliefs = state.ledgers.epistemic
        .filter(item => item.kind === 'believed' && item.status === 'active' && item.claim !== undefined
            && item.learnedChapter <= state.currentChapter && available.has(item.characterId))
        .slice()
        .sort((left, right) => left.learnedChapter - right.learnedChapter || left.id.localeCompare(right.id))
        .map(item => ({ id: item.id, characterId: item.characterId, characterName: characterName(control, item.characterId), claim: item.claim!, learnedChapter: item.learnedChapter }));

    const secrets = control.authorOnlySecrets.slice().sort((left, right) => left.id.localeCompare(right.id)).map(secret => ({
        privilege: 'author-secret-metadata' as const,
        id: secret.id,
        ...(secret.revealId === undefined ? {} : { revealId: secret.revealId }),
        status: getAuthorSecretStatus(control, state, secret.id, targetChapter),
    }));
    const reveals = control.reveals.slice().sort((left, right) => left.id.localeCompare(right.id)).map(reveal => {
        const occurrence = getRevealOccurrence(state, reveal.id, targetChapter);
        return {
            id: reveal.id,
            gateIds: control.gates.reveals.filter(gate => gate.revealId === reveal.id).map(gate => gate.id).sort(),
            status: occurrence ? 'revealed' as const : isRevealAllowed(control, reveal.id, targetChapter) ? 'eligible-not-revealed' as const : 'locked' as const,
            ...(occurrence === undefined ? {} : { occurrenceChapter: occurrence.chapterNumber }),
        };
    });
    const foreshadow = state.ledgers.foreshadowThreads
        .filter(item => item.openedChapter <= state.currentChapter)
        .slice().sort((left, right) => left.openedChapter - right.openedChapter || left.id.localeCompare(right.id))
        .map(thread => {
            const cues = state.ledgers.foreshadowCues.filter(cue => cue.threadId === thread.id && cue.chapterNumber <= state.currentChapter)
                .slice().sort((left, right) => left.chapterNumber - right.chapterNumber || left.id.localeCompare(right.id));
            return {
                id: thread.id, label: thread.writerLabel, openedChapter: thread.openedChapter,
                status: getForeshadowThreadStatus(state, thread.id, targetChapter), cueCount: cues.length,
                ...(cues.at(-1)?.writerText === undefined ? {} : { latestCue: cues.at(-1)!.writerText }),
            };
        });
    const payoffs = state.ledgers.payoffObligations
        .filter(item => item.openedChapter <= state.currentChapter)
        .slice().sort((left, right) => left.openedChapter - right.openedChapter || left.id.localeCompare(right.id))
        .map(item => ({
            id: item.id, label: item.writerLabel, openedChapter: item.openedChapter,
            ...(item.targetPayoffChapter === undefined ? {} : { targetChapter: item.targetPayoffChapter }),
            status: getPayoffStatus(state, item, targetChapter),
        }));
    const continuityItems = state.ledgers.continuity
        .filter(item => item.visibility === 'writer' && item.establishedChapter <= state.currentChapter)
        .slice().sort((left, right) => left.establishedChapter - right.establishedChapter || left.id.localeCompare(right.id))
        .map(item => ({ id: item.id, kind: item.kind, text: item.text, establishedChapter: item.establishedChapter, status: item.status }));
    const validation = consistencyOk ? buildValidation(safeSession, suppliedLimits.maxValidationIssues) : emptyValidation();
    const currentArc = state.currentArcId ? control.arcs.find(arc => arc.id === state.currentArcId) : getArcForChapter(control, Math.max(1, state.currentChapter || targetChapter));
    const currentBeat = state.currentBeatId ? control.beats.find(beat => beat.id === state.currentBeatId) : getBeatForChapter(control, Math.max(1, state.currentChapter || targetChapter));
    const activeConstraintCount = control.canonRules.filter(rule => rule.availableFromChapter <= targetChapter
        && (rule.expiresAfterChapter === undefined || targetChapter <= rule.expiresAfterChapter)).length;
    const writerPlan = safeSession.writerPlan ? buildWriterPlan(control, safeSession.writerPlan, suppliedLimits) : undefined;
    const internalPlan = safeSession.internalPlan ? buildInternalPlan(control, safeSession.internalPlan, suppliedLimits) : undefined;
    const draft = safeSession.writerDraft ? {
        privilege: 'writer-safe' as const,
        chapterNumber: safeSession.writerDraft.chapterNumber,
        ...(safeSession.writerDraft.title === undefined ? {} : { title: safeSession.writerDraft.title }),
        prose: safeSession.writerDraft.prose,
        status: draftStatus(safeSession),
        statusLabel: draftStatusLabel[draftStatus(safeSession)],
    } : undefined;

    return {
        project: {
            privilege: 'canon-safe', mode: session.mode, id: control.id,
            title: session.projectTitle ?? control.id, isDemo: session.mode === 'demo',
            canonChapter: state.currentChapter, targetChapter,
            ...(currentArc === undefined ? {} : { currentArc: { id: currentArc.id, title: currentArc.title } }),
            ...(currentBeat === undefined ? {} : { currentBeat: { id: currentBeat.id, label: `Beat ${currentBeat.order}` } }),
            artifactStatus, artifactStatusLabel: artifactStatusLabel[artifactStatus],
        },
        overview: {
            privilege: 'canon-safe', plannedChapterCount: control.engine.plannedChapterCount,
            activeCharacterCount: characters.items.filter(item => item.active).length,
            relationshipCount: relationships.totalCount,
            activeConstraintCount,
            factCount: facts.totalCount,
            openForeshadowCount: foreshadow.filter(item => item.status === 'open').length,
            outstandingPayoffCount: payoffs.filter(item => ['not-due', 'due', 'overdue'].includes(item.status)).length,
            strategicActionCount: writerPlan?.strategicDirectives.length ?? 0,
            validationIssueCount: validation.issues.totalCount,
        },
        workflow: {
            stages: buildWorkflowStages(session, artifactStatus, targetChapter, consistencyOk),
            ...(writerPlan === undefined ? {} : { writerPlan }),
            ...(internalPlan === undefined ? {} : { internalPlan }),
            ...(draft === undefined ? {} : { draft }),
        },
        validation,
        intelligence: {
            canonPrivilege: 'canon-safe', characters, relationships, facts,
            beliefs: bounded(beliefs, suppliedLimits.maxKnowledgeEntries),
            secrets: bounded(secrets, suppliedLimits.maxPlotItems),
            reveals: bounded(reveals, suppliedLimits.maxPlotItems),
            foreshadow: bounded(foreshadow, suppliedLimits.maxPlotItems),
            payoffs: bounded(payoffs, suppliedLimits.maxPlotItems),
            continuity: {
                ...(state.continuity.timelinePosition === undefined ? {} : { timelinePosition: state.continuity.timelinePosition }),
                ...(state.continuity.lastScene === undefined ? {} : { lastScene: state.continuity.lastScene }),
                ...(state.continuity.povCharacterId === undefined ? {} : { povName: characterName(control, state.continuity.povCharacterId) }),
                activeLocations: Object.entries(state.characterLocations)
                    .filter(([id]) => available.has(id)).sort(([left], [right]) => left.localeCompare(right))
                    .map(([characterId, location]) => ({ characterId, characterName: characterName(control, characterId), location })),
                items: bounded(continuityItems, suppliedLimits.maxContinuityItems),
            },
        },
        consistency: { status: consistencyOk ? 'ok' : 'error', issues: consistencyIssues },
    };
};
