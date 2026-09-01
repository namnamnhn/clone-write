import {
    buildValidationReport,
    compileStoryControl,
    createInitialStoryState,
    createValidationIssue,
} from '../storyEngine';
import type {
    FactProvenance,
    InternalChapterPlan,
    StoryBlueprint,
    StoryState,
    WriterChapterPlan,
    WriterChapterDraft,
} from '../storyEngine';
import type { StoryStudioSession } from './storyStudioTypes';

const provenance = (chapter: number, sourceId: string): FactProvenance => ({
    sourceChapter: chapter,
    sourceType: 'chapter',
    sourceId,
});

const relationshipPolicy = {
    maxMajorMilestoneAdvancePerChapter: 1,
    maxConsecutiveProgressionChapters: 2,
    requireCanonicalBasis: true as const,
    requireMutualAgencyForMutualMilestone: true as const,
};

const relationshipProfile = {
    coreDynamicTags: ['professional-equals', 'slow-earned-trust'] as const,
    dominantConflictSources: ['Khác biệt về trách nhiệm và ưu tiên.'],
    trustBasis: ['Những lựa chọn đáng tin lặp lại qua nhiều chương.'],
    respectBasis: ['Năng lực và sự thẳng thắn trong khủng hoảng.'],
    prohibitedShortcuts: ['confession'] as const,
};

const blueprint: StoryBlueprint = {
    id: 'demo-hai-dang-phia-bac',
    engine: { plannedChapterCount: 180 },
    characters: [
        { id: 'linh', name: 'Linh An', availableFromChapter: 1, writerProfile: { role: 'Người giữ hải đăng', personality: 'Điềm tĩnh, quan sát kỹ.' } },
        { id: 'minh', name: 'Minh Kha', availableFromChapter: 1, writerProfile: { role: 'Sứ giả hội đồng', personality: 'Thực tế, kín đáo.' } },
        { id: 'tuan', name: 'Tuấn Vũ', availableFromChapter: 3, writerProfile: { role: 'Đội trưởng tuần duyên' } },
        { id: 'yen', name: 'Yên Chi', availableFromChapter: 5, writerProfile: { role: 'Chủ đoàn thuyền buôn' } },
        { id: 'future', name: 'Nhân vật bị khóa', availableFromChapter: 40, writerProfile: { role: 'Chưa được phép xuất hiện' } },
    ],
    arcs: [{ id: 'arc-bao-den', title: 'Bão Đen trên Vịnh Bắc', startChapter: 1, endChapter: 180, writerBrief: 'Một liên minh mong manh hình thành quanh tuyến hải đăng.' }],
    beats: [
        { id: 'beat-khoi-dau', arcId: 'arc-bao-den', order: 1, startChapter: 1, endChapter: 8, writerBrief: 'Những dấu hiệu đầu tiên xuất hiện quanh vịnh.' },
        { id: 'beat-phong-tuyen', arcId: 'arc-bao-den', order: 2, startChapter: 9, endChapter: 16, writerBrief: 'Giữ tuyến tiếp tế trước khi bão cập bờ.' },
        { id: 'beat-hau-bao', arcId: 'arc-bao-den', order: 3, startChapter: 17, endChapter: 180, writerBrief: 'Hệ quả của cơn bão định hình lại liên minh.' },
    ],
    reveals: [{ id: 'reveal-ban-do', writerText: 'Tấm bản đồ thủy triều có một tuyến đi an toàn bị bỏ quên.' }],
    relationshipDefinitions: [
        {
            id: 'linh-minh', participantIds: ['linh', 'minh'], categories: ['romantic', 'professional'],
            initialRomanceMilestone: 'awareness', dynamicProfile: relationshipProfile, progressionPolicy: relationshipPolicy,
        },
        {
            id: 'tuan-yen', participantIds: ['tuan', 'yen'], categories: ['professional', 'rivalry'],
            initialRomanceMilestone: 'none',
            dynamicProfile: { ...relationshipProfile, coreDynamicTags: ['ideological-rivals'] },
            progressionPolicy: relationshipPolicy,
        },
    ],
    relationshipEvents: [
        { id: 'linh-minh-trust', relationshipId: 'linh-minh', eventType: 'deepen-trust', participantIds: ['linh', 'minh'], writerText: 'Niềm tin tiến triển bằng lựa chọn tự nguyện.' },
    ],
    gates: {
        characters: [
            { id: 'gate-linh', characterId: 'linh', allowedFromChapter: 1 },
            { id: 'gate-minh', characterId: 'minh', allowedFromChapter: 1 },
            { id: 'gate-tuan', characterId: 'tuan', allowedFromChapter: 3 },
            { id: 'gate-yen', characterId: 'yen', allowedFromChapter: 5 },
            { id: 'gate-future', characterId: 'future', allowedFromChapter: 40 },
        ],
        pov: [{ id: 'pov-linh', characterId: 'linh', allowedFromChapter: 1 }],
        reveals: [{ id: 'gate-reveal-ban-do', revealId: 'reveal-ban-do', allowedFromChapter: 12 }],
        relationships: [{ id: 'gate-linh-minh-trust', eventId: 'linh-minh-trust', allowedFromChapter: 10 }],
        events: [],
    },
    canonRules: [
        { id: 'rule-bao-den', text: 'Bão Đen cắt liên lạc đường biển sau hoàng hôn.', availableFromChapter: 9, expiresAfterChapter: 18, scope: 'world' },
        { id: 'rule-hai-dang', text: 'Đèn chính chỉ còn đủ nhiên liệu cho hai đêm.', availableFromChapter: 12, expiresAfterChapter: 14, scope: 'canon' },
    ],
};

const control = compileStoryControl(blueprint);
const baseState = createInitialStoryState(12);

const facts = [
    { id: 'fact-bao', text: 'Bão Đen đang dịch chuyển nhanh hơn dự báo.', establishedChapter: 11, visibility: 'writer' as const, status: 'active' as const, provenance: provenance(11, 'chapter-11') },
    { id: 'fact-kho-dau', text: 'Kho dầu phía đông chỉ đủ thắp đèn trong hai đêm.', establishedChapter: 12, visibility: 'writer' as const, status: 'active' as const, provenance: provenance(12, 'chapter-12') },
    { id: 'fact-hoi-dong', text: 'Hội đồng đang tranh luận quyền điều động tuần duyên.', establishedChapter: 12, visibility: 'internal' as const, status: 'active' as const, provenance: provenance(12, 'chapter-12') },
];

const state: StoryState = {
    ...baseState,
    currentArcId: 'arc-bao-den',
    currentBeatId: 'beat-phong-tuyen',
    knownCharacterIds: ['linh', 'minh', 'tuan', 'yen', 'future'],
    activeCharacterIds: ['linh', 'minh', 'tuan', 'yen', 'future'],
    characterLocations: { linh: 'Hải đăng Bắc', minh: 'Phòng tín hiệu', tuan: 'Cầu cảng', yen: 'Kho hàng số 3', future: 'Không được hiển thị' },
    characterStatuses: {
        linh: { status: 'Trực đèn', injuries: [], conditions: ['Thiếu ngủ'] },
        minh: { status: 'Đang thương lượng', injuries: [], conditions: [] },
        tuan: { status: 'Sẵn sàng xuất phát', injuries: ['Vai trái băng bó'], conditions: [] },
        yen: { status: 'Bảo vệ đoàn hàng', injuries: [], conditions: [] },
    },
    facts,
    characterKnowledge: [
        { characterId: 'linh', factIds: ['fact-bao', 'fact-kho-dau'] },
        { characterId: 'minh', factIds: ['fact-bao', 'fact-hoi-dong'] },
        { characterId: 'tuan', factIds: ['fact-bao'] },
        { characterId: 'yen', factIds: ['fact-kho-dau'] },
    ],
    relationships: [
        { id: 'linh-minh', participantIds: ['linh', 'minh'], state: 'interest', establishedChapter: 12 },
        { id: 'tuan-yen', participantIds: ['tuan', 'yen'], state: 'cạnh tranh nhưng hợp tác', establishedChapter: 10 },
    ],
    unresolvedClues: [{ id: 'clue-tide', text: 'Vệt mực nhạt trên bản đồ thủy triều.', openedChapter: 8, visibility: 'writer' }],
    unresolvedPromises: [{ id: 'promise-lamp', text: 'Linh An đã hứa giữ đèn sáng đến khi đoàn thuyền trở về.', openedChapter: 10, visibility: 'writer' }],
    resources: {
        linh: [{ id: 'lamp-oil', name: 'Dầu đèn', quantity: 2, state: 'nguy cấp' }],
        tuan: [{ id: 'patrol-boats', name: 'Thuyền tuần duyên', quantity: 3, state: 'sẵn sàng' }],
        yen: [{ id: 'grain', name: 'Lương thực', quantity: 80, state: 'đang chờ vận chuyển' }],
    },
    continuity: {
        timelinePosition: 'Đêm thứ hai trước khi Bão Đen cập bờ',
        lastScene: 'Phòng tín hiệu của hải đăng Bắc',
        povCharacterId: 'linh',
        pendingThreads: [{ text: 'Đoàn thuyền tiếp tế phải rời cảng trước nửa đêm.', visibility: 'writer', establishedChapter: 12 }],
        notes: [{ text: 'Tuấn Vũ vẫn bị thương ở vai trái.', visibility: 'writer', establishedChapter: 11 }],
    },
    ledgers: {
        ...baseState.ledgers,
        facts,
        epistemic: [
            { id: 'know-linh-bao', characterId: 'linh', kind: 'known', factId: 'fact-bao', learnedChapter: 11, source: { type: 'witnessed', sourceChapter: 11 }, status: 'active' },
            { id: 'know-minh-hoi-dong', characterId: 'minh', kind: 'known', factId: 'fact-hoi-dong', learnedChapter: 12, source: { type: 'told-by-character', sourceChapter: 12, sourceCharacterId: 'tuan' }, status: 'active' },
            { id: 'belief-yen-cang', characterId: 'yen', kind: 'believed', claim: 'Hội đồng sẽ ưu tiên bảo vệ cảng hơn hải đăng.', learnedChapter: 12, source: { type: 'inference', sourceChapter: 12, basisFactIds: ['fact-hoi-dong'] }, status: 'active' },
        ],
        relationships: [
            { id: 'rel-linh-minh-9', relationshipId: 'linh-minh', participantIds: ['linh', 'minh'], state: 'awareness', chapterNumber: 9, provenance: provenance(9, 'chapter-9') },
            { id: 'rel-linh-minh-12', relationshipId: 'linh-minh', participantIds: ['linh', 'minh'], state: 'interest', chapterNumber: 12, provenance: provenance(12, 'chapter-12') },
            { id: 'rel-tuan-yen-10', relationshipId: 'tuan-yen', participantIds: ['tuan', 'yen'], state: 'cạnh tranh nhưng hợp tác', chapterNumber: 10, provenance: provenance(10, 'chapter-10') },
        ],
        continuity: [
            { id: 'continuity-boats', kind: 'obligation', text: 'Đưa đoàn tiếp tế qua cửa vịnh trước nửa đêm.', visibility: 'writer', establishedChapter: 12, status: 'open', provenance: provenance(12, 'chapter-12') },
            { id: 'continuity-shoulder', kind: 'condition', text: 'Vai trái của Tuấn Vũ vẫn bị thương.', visibility: 'writer', establishedChapter: 11, status: 'open', provenance: provenance(11, 'chapter-11') },
        ],
        revealOccurrences: [{ id: 'reveal-occurrence-map', revealId: 'reveal-ban-do', chapterNumber: 12, provenance: provenance(12, 'chapter-12') }],
        foreshadowThreads: [{ id: 'thread-bell', writerLabel: 'Tiếng chuông dưới vách đá', openedChapter: 7, linkedPayoffId: 'payoff-bell', provenance: provenance(7, 'chapter-7') }],
        foreshadowCues: [
            { id: 'cue-bell-7', threadId: 'thread-bell', chapterNumber: 7, cueType: 'seed', writerText: 'Một tiếng chuông vọng lên dù biển hoàn toàn lặng.', provenance: provenance(7, 'chapter-7') },
            { id: 'cue-bell-11', threadId: 'thread-bell', chapterNumber: 11, cueType: 'reinforcement', writerText: 'Dây chuông rung khi thủy triều đổi hướng.', provenance: provenance(11, 'chapter-11') },
        ],
        payoffObligations: [{ id: 'payoff-bell', writerLabel: 'Giải thích nguồn tiếng chuông dưới vách đá', openedChapter: 7, earliestPayoffChapter: 15, targetPayoffChapter: 18, latestPayoffChapter: 22, linkedForeshadowThreadId: 'thread-bell', requiresForeshadowSeed: true, provenance: provenance(7, 'chapter-7') }],
    },
    projections: {
        ...baseState.projections,
        characters: [
            { characterId: 'linh', active: true, lifeStatus: 'alive', activeStatusIds: [] },
            { characterId: 'minh', active: true, lifeStatus: 'alive', activeStatusIds: [] },
            { characterId: 'tuan', active: true, lifeStatus: 'alive', activeStatusIds: [] },
            { characterId: 'yen', active: true, lifeStatus: 'alive', activeStatusIds: [] },
            { characterId: 'future', active: true, lifeStatus: 'alive', activeStatusIds: [] },
        ],
        relationships: [
            { id: 'linh-minh', participantIds: ['linh', 'minh'], currentState: 'interest', lastChangedChapter: 12, currentHistoryId: 'rel-linh-minh-12' },
            { id: 'tuan-yen', participantIds: ['tuan', 'yen'], currentState: 'cạnh tranh nhưng hợp tác', lastChangedChapter: 10, currentHistoryId: 'rel-tuan-yen-10' },
        ],
    },
};

const internalPlan: InternalChapterPlan = {
    kind: 'internal-chapter-plan', chapterNumber: 13, arcId: 'arc-bao-den', beatId: 'beat-phong-tuyen',
    primaryGoal: 'Buộc bốn bên thống nhất một tuyến tiếp tế có cái giá rõ ràng.', povCharacterId: 'linh', participantIds: ['linh', 'minh', 'tuan', 'yen'],
    scenes: [
        { id: 'scene-council', order: 1, goal: 'Đạt thỏa thuận tạm thời.', location: 'Phòng tín hiệu', povCharacterId: 'linh', participantIds: ['linh', 'minh', 'tuan', 'yen'], conflictOrObstacle: 'Mỗi người muốn ưu tiên một nguồn lực khác nhau.', uncertainty: 'Yên Chi có thể rút đoàn thuyền.', expectedConsequence: 'Một liên minh tạm thời hình thành với nghĩa vụ cụ thể.', purposeTags: ['politics', 'relationship'], conflictImportance: 'major' },
        { id: 'scene-harbor', order: 2, goal: 'Đưa đoàn thuyền rời cảng.', location: 'Cầu cảng Bắc', povCharacterId: 'linh', participantIds: ['linh', 'tuan', 'yen'], conflictOrObstacle: 'Gió đổi hướng sớm hơn dự báo.', uncertainty: 'Một thuyền có thể phải quay lại.', expectedConsequence: 'Nguồn tiếp tế bị tiêu hao và phương án rút lui được kích hoạt.', purposeTags: ['military', 'commerce', 'consequence'], conflictImportance: 'major' },
    ],
    activeConstraintIds: ['rule-bao-den', 'rule-hai-dang'], allowedRevealIds: ['reveal-ban-do'], plannedRevealIds: [],
    relationshipEventIds: ['linh-minh-trust'], storyEventIds: [], cluesPlantedIds: [], cluesPaidOffIds: [],
    expectedResourceDeltas: [{ characterId: 'linh', resourceId: 'lamp-oil', quantityDelta: -1 }],
    expectedRelationshipDeltas: [{ relationshipId: 'linh-minh', participantIds: ['linh', 'minh'], expectedState: 'interest' }],
    expectedContinuityConsequences: [{ id: 'continuity-departure', text: 'Đoàn tiếp tế đã rời cảng trước nửa đêm.' }],
    strategicActions: [], relationshipActions: [], endStateIntent: 'Khóa chương ở thời điểm đoàn thuyền đi vào vùng nước tối.',
};

const writerPlan: WriterChapterPlan = {
    kind: 'writer-chapter-plan', chapterNumber: 13,
    arc: { id: 'arc-bao-den', title: 'Bão Đen trên Vịnh Bắc', writerBrief: 'Một liên minh mong manh hình thành quanh tuyến hải đăng.' },
    beat: { id: 'beat-phong-tuyen', order: 2, writerBrief: 'Giữ tuyến tiếp tế trước khi bão cập bờ.' },
    primaryGoal: internalPlan.primaryGoal, povCharacterId: 'linh', participantIds: ['linh', 'minh', 'tuan', 'yen'],
    scenes: internalPlan.scenes.map(scene => ({
        id: scene.id, order: scene.order, goal: scene.goal, location: scene.location,
        povCharacterId: scene.povCharacterId, participantIds: scene.participantIds,
        conflictOrObstacle: scene.conflictOrObstacle, uncertainty: scene.uncertainty,
        expectedConsequence: scene.expectedConsequence, purposeTags: scene.purposeTags,
        conflictImportance: scene.conflictImportance,
    })),
    canonConstraints: [
        { id: 'rule-bao-den', text: 'Bão Đen cắt liên lạc đường biển sau hoàng hôn.', scope: 'world' },
        { id: 'rule-hai-dang', text: 'Đèn chính chỉ còn đủ nhiên liệu cho hai đêm.', scope: 'canon' },
    ],
    reveals: [{ id: 'reveal-ban-do', text: 'Tấm bản đồ thủy triều có một tuyến đi an toàn bị bỏ quên.' }],
    relationshipEvents: [{ id: 'linh-minh-trust', relationshipId: 'linh-minh', eventType: 'deepen-trust', participantIds: ['linh', 'minh'], text: 'Niềm tin tiến triển bằng lựa chọn tự nguyện.' }],
    storyEvents: [], cluesPlantedIds: [], cluesPaidOffIds: [],
    expectedResourceDeltas: internalPlan.expectedResourceDeltas,
    expectedRelationshipDeltas: internalPlan.expectedRelationshipDeltas,
    expectedContinuityConsequences: internalPlan.expectedContinuityConsequences,
    strategicDirectives: [
        {
            id: 'strategy-council', domain: 'politics', sceneIds: ['scene-council'], actorCharacterId: 'minh',
            visibleObjective: 'Đạt quyền điều động ba thuyền tuần duyên.', visibleConstraints: ['Quyền biểu quyết của hội đồng phải được tôn trọng.'],
            expectedCostOrTradeoff: 'Minh Kha phải công khai cam kết chịu trách nhiệm.',
            dimensionStatuses: [{ dimension: 'authority', status: 'constraining' }, { dimension: 'time', status: 'constraining' }, { dimension: 'reputation', status: 'supporting' }],
            timing: { earliestChapter: 13, deadlineChapter: 13, preparationChapters: 1 },
        },
        {
            id: 'strategy-escort', domain: 'military', sceneIds: ['scene-harbor'], actorCharacterId: 'tuan',
            visibleObjective: 'Hộ tống đoàn tiếp tế qua cửa vịnh.', visibleConstraints: ['Không giao chiến khi chưa bảo đảm đường rút.'],
            expectedCostOrTradeoff: 'Một thuyền tuần duyên phải ở lại làm dự bị.', operationType: 'escort', location: 'Cửa vịnh Bắc',
            movement: { fromLocation: 'Cầu cảng Bắc', toLocation: 'Hải đăng Bắc', method: 'đội hình hàng dọc', transitChapters: 0 },
            logistics: { supplyResource: { characterId: 'linh', resourceId: 'lamp-oil' }, expectedSupplyConsumption: 1, movementConstraint: 'Chỉ đi theo luồng nước trên bản đồ.', operationalTimeChapters: 1, resupplyOrFallback: 'Quay về vịnh nhỏ phía tây.' },
            expectedLossOrCost: 'Đội hộ tống tiêu hao một phần nhiên liệu và sức chiến đấu.', retreatOrFailurePlan: 'Rút về vịnh nhỏ phía tây và phát tín hiệu đỏ.',
        },
        {
            id: 'strategy-grain', domain: 'commerce', sceneIds: ['scene-council', 'scene-harbor'], actorCharacterId: 'yen',
            visibleObjective: 'Đổi lương thực lấy quyền ưu tiên cập cảng.', visibleConstraints: ['Giá và nghĩa vụ vận chuyển phải được nêu rõ.'],
            expectedCostOrTradeoff: 'Yên Chi chịu rủi ro mất một phần hàng trong bão.', actionType: 'contract',
            resourceFlows: [{ characterId: 'yen', resourceId: 'grain', quantityDelta: -20, role: 'inventory' }],
            counterpartyCharacterId: 'minh', serviceOrContractBasis: 'Hai mươi thùng lương thực đổi lấy quyền ưu tiên cập cảng trong ba ngày.',
            logistics: 'Chuyển hàng bằng hai thuyền đáy nông trước nửa đêm.', timing: { settlementChapters: 1, deadlineChapter: 13 },
            risk: 'Bão có thể làm chậm giao hàng.', fundingResource: { characterId: 'yen', resourceId: 'grain' },
        },
    ],
    relationshipDirectives: [
        {
            id: 'relationship-trust', relationshipId: 'linh-minh', relationshipEventId: 'linh-minh-trust', sceneIds: ['scene-council'],
            participantIds: ['linh', 'minh'], category: 'romantic', actionType: 'deepen-trust', importance: 'minor',
            currentRomanceMilestone: 'interest', intendedProgression: { direction: 'stable', romanticMilestone: 'interest', mutual: false, intermediate: false },
            participantChoices: [
                { characterId: 'linh', choice: 'Chia sẻ tuyến đi nhưng không hứa hẹn tình cảm.', willingness: 'yes' },
                { characterId: 'minh', choice: 'Nhận sự giúp đỡ và tôn trọng khoảng cách.', willingness: 'yes' },
            ],
            visibleBoundaries: [{ characterId: 'linh', type: 'emotional', constraint: 'no-romance', stance: 'maintain', instruction: 'Không biến hợp tác thành lời tỏ tình.' }],
            visibleCurrentDynamic: 'Tin cậy đang hình thành qua hành động.', visibleObjective: 'Giữ sự quan tâm ở mốc interest.',
            visibleConflict: 'Trách nhiệm công việc khiến cả hai giữ khoảng cách.', expectedCostOrTradeoff: 'Cả hai phải chấp nhận chưa có câu trả lời tình cảm.',
            visibleUncertainty: 'Niềm tin có thể không tiến xa hơn trong chương này.', visiblePowerBalance: 'balanced', powerImbalanceAddressed: true,
        },
    ],
    endStateIntent: internalPlan.endStateIntent,
};

const writerDraft: WriterChapterDraft = {
    kind: 'writer-chapter-draft', validationStatus: 'unvalidated', chapterNumber: 13,
    title: 'Luồng Nước Không Tên',
    prose: `Gió quất vào kính phòng tín hiệu như một bàn tay muốn giật tung cả khung cửa. Linh An giữ tấm bản đồ phẳng dưới ngọn đèn dầu, ngón tay dừng trên vệt mực đã nhạt gần hết.

“Có một luồng nước khác,” cô nói. “Hẹp hơn, nhưng tránh được bãi đá phía đông.”

Minh Kha không chạm vào bản đồ. Anh nhìn Tuấn Vũ, rồi nhìn Yên Chi, để lựa chọn ở lại với từng người. Ngoài kia, tiếng chuông dưới vách đá ngân lên một lần, trầm và xa.

Yên Chi khép sổ hàng. “Hai mươi thùng lương thực. Đổi lại, đoàn của tôi được ưu tiên cập cảng trong ba ngày.”

Tuấn Vũ siết lại dải băng trên vai trái. “Tôi hộ tống. Nhưng một thuyền ở lại làm dự bị, và khi tín hiệu đỏ bật lên, tất cả quay đầu.”

Minh Kha gật đầu. Cam kết của anh ngắn gọn, đủ để mọi người hiểu cái giá nếu kế hoạch thất bại. Linh An trao bản đồ cho anh, nhưng vẫn giữ một góc giấy giữa hai ngón tay.

“Chỉ là tuyến đi,” cô nói.

“Chỉ là tuyến đi,” anh đáp, và buông tay trước.

Nửa giờ sau, những chiếc đèn mũi thuyền lần lượt rời cầu cảng, đi vào vùng nước tối trước khi cơn bão khóa kín đường về.`,
};

const validationReport = buildValidationReport(13, 2, [
    createValidationIssue('FILLER_SCENE', 'warning', 'semantic-validator', 'scene', 'scene-council'),
    createValidationIssue('CONSEQUENCE_MISSING', 'warning', 'semantic-validator', 'scene', 'scene-harbor'),
]);

export const STORY_STUDIO_DEMO_SESSION: StoryStudioSession = {
    mode: 'demo',
    projectTitle: 'Hải Đăng Phía Bắc',
    control,
    state,
    internalPlan,
    writerPlan,
    writerDraft,
    validationReport,
    approvalStatus: 'approved-not-canon',
};

export const EMPTY_STORY_STUDIO_SESSION: StoryStudioSession = { mode: 'empty' };
