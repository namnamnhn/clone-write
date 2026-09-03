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
    assertModelBoundaryStringsSecretSafe,
    writerRelationshipDirectiveMatchesValidatorAction,
    writerStrategicDirectiveMatchesValidatorAction,
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

const sameOrderedIds = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((value, index) => value === right[index]);

const structuralValuesEquivalent = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => structuralValuesEquivalent(value, right[index]));
    }
    if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
    const leftRecord = left as Readonly<Record<string, unknown>>;
    const rightRecord = right as Readonly<Record<string, unknown>>;
    const leftKeys = Object.keys(leftRecord).filter(key => leftRecord[key] !== undefined).sort();
    const rightKeys = Object.keys(rightRecord).filter(key => rightRecord[key] !== undefined).sort();
    return sameOrderedIds(leftKeys, rightKeys)
        && leftKeys.every(key => structuralValuesEquivalent(leftRecord[key], rightRecord[key]));
};

const orderedValuesEquivalent = <T>(
    left: readonly T[],
    right: readonly T[],
    equivalent: (leftValue: T, rightValue: T) => boolean = structuralValuesEquivalent,
): boolean => left.length === right.length && left.every((value, index) => equivalent(value, right[index]));

/** Complete, property-order-independent equality for the typed WriterChapterPlan contract. */
export const writerPlansEquivalent = (left: WriterChapterPlan, right: WriterChapterPlan): boolean =>
    left.kind === right.kind
    && left.chapterNumber === right.chapterNumber
    && structuralValuesEquivalent(left.arc, right.arc)
    && structuralValuesEquivalent(left.beat, right.beat)
    && left.primaryGoal === right.primaryGoal
    && left.povCharacterId === right.povCharacterId
    && sameOrderedIds(left.participantIds, right.participantIds)
    && orderedValuesEquivalent(left.scenes, right.scenes)
    && orderedValuesEquivalent(left.canonConstraints, right.canonConstraints)
    && orderedValuesEquivalent(left.reveals, right.reveals)
    && orderedValuesEquivalent(left.relationshipEvents, right.relationshipEvents)
    && orderedValuesEquivalent(left.storyEvents, right.storyEvents)
    && sameOrderedIds(left.cluesPlantedIds, right.cluesPlantedIds)
    && sameOrderedIds(left.cluesPaidOffIds, right.cluesPaidOffIds)
    && orderedValuesEquivalent(left.expectedResourceDeltas, right.expectedResourceDeltas)
    && orderedValuesEquivalent(left.expectedRelationshipDeltas, right.expectedRelationshipDeltas)
    && orderedValuesEquivalent(left.expectedContinuityConsequences, right.expectedContinuityConsequences)
    && orderedValuesEquivalent(left.strategicDirectives ?? [], right.strategicDirectives ?? [])
    && orderedValuesEquivalent(left.relationshipDirectives ?? [], right.relationshipDirectives ?? [])
    && left.endStateIntent === right.endStateIntent;

const internalAndWriterPlanIdentitiesMatch = (
    internalPlan: NonNullable<StoryStudioSession['internalPlan']>,
    writerPlan: WriterChapterPlan,
): boolean => internalPlan.chapterNumber === writerPlan.chapterNumber
    && internalPlan.arcId === writerPlan.arc.id
    && (internalPlan.beatId ?? undefined) === (writerPlan.beat?.id ?? undefined)
    && internalPlan.povCharacterId === writerPlan.povCharacterId
    && sameOrderedIds(internalPlan.participantIds, writerPlan.participantIds)
    && internalPlan.scenes.length === writerPlan.scenes.length
    && internalPlan.scenes.every((scene, index) => {
        const writerScene = writerPlan.scenes[index];
        return writerScene !== undefined
            && scene.id === writerScene.id
            && scene.order === writerScene.order
            && scene.povCharacterId === writerScene.povCharacterId
            && sameOrderedIds(scene.participantIds, writerScene.participantIds);
    });

const strategicDirectiveMatches = (
    directive: WriterStrategicDirective,
    action: NonNullable<StoryStudioSession['validatorStrategicView']>['actions'][number],
): boolean => {
    try {
        return writerStrategicDirectiveMatchesValidatorAction(directive, action);
    } catch {
        return false;
    }
};

const relationshipDirectiveMatches = (
    directive: NonNullable<WriterChapterPlan['relationshipDirectives']>[number],
    action: NonNullable<StoryStudioSession['validatorRelationshipView']>['actions'][number],
): boolean => {
    try {
        return writerRelationshipDirectiveMatchesValidatorAction(directive, action);
    } catch {
        return false;
    }
};

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
    if (session.writerContext && !session.writerPlan) issues.push('Writer Context requires a Writer plan artifact.');
    if (session.validatorStrategicView && !session.writerPlan) issues.push('Validator strategic view requires a Writer plan artifact.');
    if (session.validatorRelationshipView && !session.writerPlan) issues.push('Validator relationship view requires a Writer plan artifact.');
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
    if (session.writerContext && session.writerPlan
        && !writerPlansEquivalent(session.writerContext.chapterPlan, session.writerPlan)) {
        issues.push('Writer Context contains a stale same-chapter Writer plan.');
    }
    if (session.internalPlan && session.writerPlan
        && !internalAndWriterPlanIdentitiesMatch(session.internalPlan, session.writerPlan)) {
        issues.push('Internal and Writer plans do not share stable chapter identities.');
    }
    if (session.validatorStrategicView && session.writerPlan) {
        const directives = session.writerPlan.strategicDirectives ?? [];
        if (directives.length !== session.validatorStrategicView.actions.length
            || session.validatorStrategicView.actions.some((action) => {
                const directive = directives.find(candidate => candidate.id === action.id);
                return directive === undefined || !strategicDirectiveMatches(directive, action);
            })) issues.push('Validator strategic view is stale relative to the Writer plan.');
    }
    if (session.validatorRelationshipView && session.writerPlan) {
        const directives = session.writerPlan.relationshipDirectives ?? [];
        if (directives.length !== session.validatorRelationshipView.actions.length
            || session.validatorRelationshipView.actions.some((action) => {
                const directive = directives.find(candidate => candidate.id === action.id);
                return directive === undefined || !relationshipDirectiveMatches(directive, action);
            })) issues.push('Validator relationship view is stale relative to the Writer plan.');
    }
    // Technical debt: ValidationReport has no trusted draft identity/content digest yet, so
    // chapter parity is the strongest report-to-draft relationship that can be proven here.
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

const secretBoundaryFailure = (mode: StoryStudioSession['mode']): StoryStudioViewModel => ({
    ...emptyViewModel(mode),
    consistency: { status: 'error', issues: ['Story Studio cannot safely display this session.'] },
});

const finalizeViewModel = (
    control: FullStoryControl,
    mode: StoryStudioSession['mode'],
    viewModel: StoryStudioViewModel,
): StoryStudioViewModel => {
    try {
        assertModelBoundaryStringsSecretSafe(control, viewModel, 'storyStudioViewModel');
        return viewModel;
    } catch {
        return secretBoundaryFailure(mode);
    }
};

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
        stage(
            'make-canon',
            'Make Canon',
            session.canonReviewReady === undefined
                ? 'unavailable'
                : session.canonReviewReady
                    ? 'ready'
                    : status === 'rejected' ? 'blocked' : 'waiting',
            session.canonReviewReady === undefined
                ? 'Chưa khả dụng'
                : session.canonReviewReady
                ? 'Sẵn sàng Review Canon'
                : status === 'rejected'
                    ? 'Bị chặn bởi kiểm định'
                    : status === 'approved-not-canon'
                        ? 'Đang hoàn tất đề xuất Canon'
                        : 'Đang chờ QA',
            session.canonReviewReady === undefined
                ? 'Session chỉ-đọc không có quyền Make Canon.'
                : 'Make Canon chỉ chạy sau khi State Extractor hoàn tất và người dùng xác nhận rõ ràng trong Review Canon.',
        ),
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
    const definitionsById = new Map(control.relationshipDefinitions.map(definition => [definition.id, definition]));
    const canonicalById = new Map(state.relationships
        .filter(relationship => relationship.establishedChapter <= state.currentChapter)
        .map(relationship => [relationship.id, relationship]));
    const historyByRelationship = new Map<string, typeof state.ledgers.relationships>();
    state.ledgers.relationships
        .filter(item => item.chapterNumber <= state.currentChapter)
        .forEach((item) => historyByRelationship.set(item.relationshipId, [
            ...(historyByRelationship.get(item.relationshipId) ?? []), item,
        ]));
    historyByRelationship.forEach((history, relationshipId) => {
        const ordered = history.slice().sort((left, right) => left.chapterNumber - right.chapterNumber || left.id.localeCompare(right.id));
        const first = ordered[0];
        const latest = ordered.at(-1);
        if (first && latest) canonicalById.set(relationshipId, {
            id: relationshipId,
            participantIds: latest.participantIds.slice(),
            state: latest.state,
            establishedChapter: first.chapterNumber,
        });
    });
    const items = [...canonicalById.values()]
        .filter(relationship => relationship.establishedChapter <= state.currentChapter
            && relationship.participantIds.every(id => available.has(id)))
        .map((canonical): StoryStudioRelationshipView => {
            const candidate = definitionsById.get(canonical.id);
            const definition = candidate && sameOrderedIds(candidate.participantIds, canonical.participantIds)
                ? candidate : undefined;
            const history = state.ledgers.relationships
                .filter(item => item.relationshipId === canonical.id && item.chapterNumber <= state.currentChapter)
                .slice()
                .sort((left, right) => left.chapterNumber - right.chapterNumber || left.id.localeCompare(right.id));
            const milestone = definition
                ? deriveCurrentRomanceMilestone(definition, state, state.currentChapter || targetChapter)
                : undefined;
            const romantic = definition?.categories.includes('romantic') === true;
            const consecutive = romantic ? countConsecutiveRomanticProgressions(history, targetChapter) : 0;
            return {
                id: canonical.id,
                participantIds: canonical.participantIds.slice(),
                participantNames: canonical.participantIds.map(id => characterName(control, id)),
                categories: definition?.categories.slice() ?? [],
                currentState: canonical.state,
                ...(milestone === undefined ? {} : { currentRomanceMilestone: milestone }),
                ...(definition === undefined ? {} : {
                    slowBurnStatus: romantic ? (consecutive > 0 ? 'progressing' as const : 'stable' as const) : 'not-applicable' as const,
                }),
                dynamicTags: definition?.dynamicProfile.coreDynamicTags.slice() ?? [],
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
        constraints: bounded(plan.canonConstraints.map(item => ({ ...item })), limits.maxWriterConstraints),
        strategicDirectives: bounded((plan.strategicDirectives ?? []).map(item => mapStrategicDirective(control, item)), limits.maxStrategicDirectives),
        relationshipDirectives: bounded((plan.relationshipDirectives ?? []).map(item => mapRelationshipDirective(control, item)), limits.maxRelationshipDirectives),
        expectedConsequences: bounded(plan.expectedContinuityConsequences.map(item => item.text), limits.maxConsequences),
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
    activeConstraintIds: bounded(plan.activeConstraintIds.slice(), limits.maxInternalIds),
    plannedRevealIds: bounded(plan.plannedRevealIds.slice(), limits.maxInternalIds),
    strategicActions: bounded((plan.strategicActions ?? []).map(action => ({ id: action.id, domain: action.domain, objective: action.objective })), limits.maxInternalActions),
    relationshipActions: bounded((plan.relationshipActions ?? []).map(action => ({ id: action.id, relationshipId: action.relationshipId, actionType: action.actionType })), limits.maxInternalActions),
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
    return {
        privilege: 'validator-only',
        status: report?.status ?? 'not-run',
        ...(report === undefined ? {} : { chapterNumber: report.chapterNumber, validationPass: report.validationPass }),
        blockingIssueCount: issues.filter(issue => issue.blocking).length,
        counts,
        issues: bounded(issues, limit),
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
        const result = { ...empty, consistency: { status: 'error' as const, issues: consistencyIssues } };
        return session.control ? finalizeViewModel(session.control, session.mode, result) : result;
    }

    const control = session.control;
    const state = session.state;
    const chapters = artifactChapters(session);
    const canonicalNextChapter = Math.min(state.currentChapter + 1, control.engine.plannedChapterCount);
    const consistencyOk = consistencyIssues.length === 0;
    const targetChapter = consistencyOk ? (chapters[0] ?? canonicalNextChapter) : canonicalNextChapter;
    const safeSession: StoryStudioSession = consistencyOk ? session : { mode: session.mode, projectTitle: session.projectTitle, control, state };
    const artifactStatus = artifactStatusFor(safeSession);
    const characters = buildCharacters(control, state, targetChapter, suppliedLimits.maxCharacters);
    const projectionById = new Map(state.projections.characters.map(value => [value.characterId, value]));
    const activeCharacterCount = control.characterOrder
        .filter(id => isCharacterDirectAppearanceAllowed(control, id, targetChapter))
        .filter(id => state.activeCharacterIds.includes(id) || projectionById.get(id)?.active === true).length;
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

    const viewModel: StoryStudioViewModel = {
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
            activeCharacterCount,
            relationshipCount: relationships.totalCount,
            activeConstraintCount,
            factCount: facts.totalCount,
            openForeshadowCount: foreshadow.filter(item => item.status === 'open').length,
            outstandingPayoffCount: payoffs.filter(item => ['not-due', 'due', 'overdue'].includes(item.status)).length,
            strategicActionCount: writerPlan?.strategicDirectives.totalCount ?? 0,
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
    return finalizeViewModel(control, session.mode, viewModel);
};
