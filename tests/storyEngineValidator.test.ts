import { describe, expect, it, vi } from 'vitest';
import {
    buildValidatorContext,
    compileStoryControl,
    createInitialStoryState,
    DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY,
    parseSemanticValidationResult,
    RepairModelRequest,
    SemanticValidatorModel,
    StoryBlueprint,
    validateAndRepairWriterChapter,
    validateWriterChapter,
    WriterChapterDraft,
    WriterChapterPlan,
} from '../src/storyEngine';

const RAW_SECRET = 'Omega keeps the obsidian duplicate key.';

const blueprint = (): StoryBlueprint => ({
    id: 'validator-story', engine: { plannedChapterCount: 600 },
    characters: [
        { id: 'a', name: 'A', availableFromChapter: 1, writerProfile: { role: 'traveler' }, authorNotes: 'hidden dossier' },
        { id: 'future', name: 'Future', availableFromChapter: 580, writerProfile: { role: 'late arrival' }, authorNotes: 'future truth' },
    ],
    arcs: [{ id: 'arc', title: 'Long Arc', startChapter: 1, endChapter: 600, writerBrief: 'Cross the guarded gate.', authorPlan: 'hidden arc outcome' }],
    beats: [{ id: 'beat', arcId: 'arc', order: 1, startChapter: 1, endChapter: 600, writerBrief: 'Gate struggle.', authorPlan: 'hidden beat truth' }],
    reveals: [{ id: 'omega-reveal', writerText: 'Omega owns a second key.', authorNotes: 'hidden reveal notes' }],
    relationshipEvents: [],
    storyEvents: [{ id: 'gate-opens', eventType: 'opening', writerText: 'The gate may open.' }],
    gates: {
        characters: [
            { id: 'a-character', characterId: 'a', allowedFromChapter: 1 },
            { id: 'future-character', characterId: 'future', allowedFromChapter: 580 },
        ],
        pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }],
        reveals: [{ id: 'omega-gate', revealId: 'omega-reveal', allowedFromChapter: 561 }],
        relationships: [], events: [{ id: 'opening-gate', eventId: 'gate-opens', allowedFromChapter: 1 }],
    },
    forbiddenEvents: [{ id: 'no-opening', eventId: 'gate-opens', forbiddenThroughChapter: 559, authorReason: 'hidden timing' }],
    authorOnlySecrets: [{ id: 'omega-secret', value: RAW_SECRET, revealId: 'omega-reveal', notes: 'vault notes' }],
    canonRules: [{ id: 'token-rule', text: 'The gate opens only with a token.', availableFromChapter: 1, scope: 'world', authorNotes: 'hidden origin' }],
});

const control = compileStoryControl(blueprint());
const stateFor = (chapter: number) => ({
    ...createInitialStoryState(chapter), knownCharacterIds: ['a'], activeCharacterIds: ['a'],
    characterLocations: { a: 'Gate district' },
    facts: [{ id: 'token-fact', text: 'A carries a token.', establishedChapter: 1, visibility: 'writer' as const }],
    extensions: { authorOnly: RAW_SECRET, futureArcTruth: 'never repair with this' },
});
const planFor = (chapter: number, reveal = false): WriterChapterPlan => ({
    kind: 'writer-chapter-plan', chapterNumber: chapter, arc: { id: 'arc', title: 'Long Arc', writerBrief: 'Cross the guarded gate.' },
    beat: { id: 'beat', order: 1, writerBrief: 'Gate struggle.' }, primaryGoal: 'Get through the guarded gate.',
    povCharacterId: 'a', participantIds: ['a'],
    scenes: [{ id: `scene-${chapter}`, order: 1, goal: 'Pass the guard.', location: 'Gate district', povCharacterId: 'a', participantIds: ['a'], conflictOrObstacle: 'The guard refuses entry.', uncertainty: 'The token may be rejected.', expectedConsequence: 'A must pay a price.', purposeTags: ['plot', 'consequence'], conflictImportance: 'major' }],
    canonConstraints: [{ id: 'token-rule', text: 'The gate opens only with a token.', scope: 'world' }],
    reveals: reveal ? [{ id: 'omega-reveal', text: 'Omega owns a second key.' }] : [], relationshipEvents: [],
    storyEvents: [], cluesPlantedIds: [], cluesPaidOffIds: [], expectedResourceDeltas: [], expectedRelationshipDeltas: [],
    expectedContinuityConsequences: [{ id: 'price', text: 'A pays a price.' }], endStateIntent: 'End after entry at a meaningful cost.',
});
const draftFor = (chapter: number, prose = 'A offers the token. The guard permits entry only after A surrenders a treasured map.'): WriterChapterDraft => ({
    kind: 'writer-chapter-draft', validationStatus: 'unvalidated', chapterNumber: chapter, prose,
});
const semanticResult = (chapterNumber: number, issues: readonly Record<string, unknown>[] = []) => ({ kind: 'semantic-validation-result', chapterNumber, issues });
const passingModel: SemanticValidatorModel = { async validate(request) { return semanticResult(request.chapterNumber); } };
const unusedRepair = { async repair() { throw new Error('repair must not be called'); } };

const opaqueControl = () => compileStoryControl({
    ...blueprint(),
    characters: [
        blueprint().characters[0],
        { id: 'char-opaque-99', name: 'Thẩm Dao', availableFromChapter: 291, writerProfile: { role: 'late witness' }, authorNotes: 'private identity note' },
    ],
    reveals: [{ id: 'reveal-opaque-77', writerText: 'Vương miện giấu một bản đồ bí mật.', authorNotes: 'private reveal note' }],
    relationshipEvents: [{
        id: 'relationship-opaque-77', relationshipId: 'relationship-a-dao', eventType: 'first-meeting',
        participantIds: ['a', 'char-opaque-99'], writerText: 'A và Thẩm Dao gặp nhau lần đầu.', authorNotes: 'private relationship plan',
    }],
    storyEvents: [{ id: 'event-opaque-77', eventType: 'palace-coup', writerText: 'Cuộc chính biến trong đại điện bắt đầu.', authorNotes: 'private event plan' }],
    gates: {
        characters: [
            { id: 'a-character', characterId: 'a', allowedFromChapter: 1 },
            { id: 'opaque-character-gate', characterId: 'char-opaque-99', allowedFromChapter: 291 },
        ],
        pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }],
        reveals: [{ id: 'opaque-reveal-gate', revealId: 'reveal-opaque-77', allowedFromChapter: 291 }],
        relationships: [{ id: 'opaque-relationship-gate', eventId: 'relationship-opaque-77', allowedFromChapter: 291 }],
        events: [{ id: 'opaque-event-gate', eventId: 'event-opaque-77', allowedFromChapter: 291 }],
    },
    forbiddenEvents: [{ id: 'opaque-event-forbidden', eventId: 'event-opaque-77', forbiddenThroughChapter: 290, authorReason: 'private timing' }],
    authorOnlySecrets: [{ id: 'opaque-secret', value: RAW_SECRET, revealId: 'reveal-opaque-77', notes: 'private secret note' }],
});

const oversizedControl = () => {
    const source = blueprint();
    const indexes = [0, 1, 2];
    return compileStoryControl({
        ...source,
        characters: [
            ...source.characters,
            ...indexes.map(index => ({ id: `capacity-character-${index}`, name: `Capacity Character ${index}`, availableFromChapter: 590, writerProfile: { role: 'future' } })),
        ],
        reveals: [
            ...(source.reveals ?? []),
            ...indexes.map(index => ({ id: `capacity-reveal-${index}`, writerText: `Capacity reveal ${index}.` })),
        ],
        relationshipEvents: indexes.map(index => ({
            id: `capacity-relationship-${index}`, relationshipId: `capacity-pair-${index}`, eventType: 'meeting',
            participantIds: ['a', `capacity-character-${index}`], writerText: `Capacity relationship ${index}.`,
        })),
        storyEvents: [
            ...(source.storyEvents ?? []),
            ...indexes.map(index => ({ id: `capacity-event-${index}`, eventType: 'future-event', writerText: `Capacity event ${index}.` })),
        ],
        gates: {
            characters: [
                ...(source.gates?.characters ?? []),
                ...indexes.map(index => ({ id: `capacity-character-gate-${index}`, characterId: `capacity-character-${index}`, allowedFromChapter: 590 })),
            ],
            pov: source.gates?.pov,
            reveals: [
                ...(source.gates?.reveals ?? []),
                ...indexes.map(index => ({ id: `capacity-reveal-gate-${index}`, revealId: `capacity-reveal-${index}`, allowedFromChapter: 590 })),
            ],
            relationships: indexes.map(index => ({ id: `capacity-relationship-gate-${index}`, eventId: `capacity-relationship-${index}`, allowedFromChapter: 590 })),
            events: [
                ...(source.gates?.events ?? []),
                ...indexes.map(index => ({ id: `capacity-event-gate-${index}`, eventId: `capacity-event-${index}`, allowedFromChapter: 590 })),
            ],
        },
        authorOnlySecrets: [
            ...(source.authorOnlySecrets ?? []),
            ...indexes.map(index => ({ id: `capacity-secret-${index}`, value: `Capacity secret ${index}.`, revealId: `capacity-reveal-${index}` })),
        ],
    });
};

const longRunControl = () => {
    const source = blueprint();
    const historical = Array.from({ length: 150 }, (_, index) => ({
        id: `historical-character-${index}`, name: `Historical Character ${index}`, availableFromChapter: 1,
        writerProfile: { role: 'historical cast member' },
    }));
    const future = [0, 1].map(index => ({
        id: `future-character-${index}`, name: `Future Character ${index}`, availableFromChapter: 590,
        writerProfile: { role: 'future cast member' },
    }));
    return compileStoryControl({
        ...source,
        characters: [source.characters[0], ...historical, ...future],
        gates: {
            characters: [
                { id: 'a-character', characterId: 'a', allowedFromChapter: 1 },
                ...historical.map((character, index) => ({ id: `historical-gate-${index}`, characterId: character.id, allowedFromChapter: 1 })),
                ...future.map((character, index) => ({ id: `future-gate-${index}`, characterId: character.id, allowedFromChapter: 590 })),
            ],
            pov: [{ id: 'a-pov', characterId: 'a', allowedFromChapter: 1 }],
            reveals: source.gates?.reveals,
            relationships: source.gates?.relationships,
            events: source.gates?.events,
        },
    });
};

describe('Validator context and deterministic safety net', () => {
    it('builds a bounded privileged context without future arc prose or whole source objects', () => {
        const context = buildValidatorContext(control, stateFor(560), planFor(560));
        const serialized = JSON.stringify(context);
        expect(context.secretValidation).toEqual([{ id: 'omega-secret', revealId: 'omega-reveal', revealAllowed: false, rawValue: RAW_SECRET }]);
        expect(context.gates.lockedReveals).toContainEqual({ id: 'omega-reveal', validationText: 'Omega owns a second key.' });
        expect(context.gates.lockedCharacters).toContainEqual({ id: 'future', name: 'Future' });
        expect(context.gates.lockedCharacters.length).toBeLessThanOrEqual(DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY.maxLockedCharacters);
        expect(serialized).not.toContain('hidden arc outcome');
        expect(serialized).not.toContain('hidden dossier');
        expect(serialized).not.toContain('authorOnlySecrets');
        expect(serialized).not.toContain('extensions');
    });

    it('keeps a 150-character historical cast out of validator context while retaining verified plan references', async () => {
        const compiled = longRunControl();
        const sourceControl = structuredClone(compiled);
        const state = stateFor(500);
        const plan = planFor(500);
        const before = [sourceControl, state].map(value => JSON.stringify(value));
        const context = buildValidatorContext(sourceControl, state, plan);
        expect(context.chapterPlan.povCharacterId).toBe('a');
        expect(context.chapterPlan.participantIds).toEqual(['a']);
        expect(context.writerContext.characters.map(character => character.id)).toContain('a');
        expect(context.writerContext.characters.length).toBeLessThanOrEqual(24);
        expect(context.gates.lockedCharacters.map(character => character.id)).toEqual(['future-character-0', 'future-character-1']);
        expect(JSON.stringify(context)).not.toContain('historical-character-149');
        expect(JSON.stringify(context)).not.toContain('allowedCharacterIds');
        expect(JSON.stringify(context)).not.toContain('allowedPovIds');
        let captured = '';
        const result = await validateWriterChapter({
            control: sourceControl, state, plan, draft: draftFor(500),
            semanticModel: { async validate(request) { captured = JSON.stringify(request); return semanticResult(request.chapterNumber); } },
        });
        expect(result.candidateStatus).toBe('parsed');
        expect(captured).not.toContain('historical-character-149');
        expect(captured).not.toContain('allowedCharacterIds');
        expect(captured).not.toContain('allowedPovIds');
        expect([sourceControl, state].map(value => JSON.stringify(value))).toEqual(before);
        expect(Object.isFrozen(sourceControl)).toBe(false);
        expect(Object.isFrozen(state)).toBe(false);
    });

    it('gives semantic validation bounded opaque-ID descriptors that never cross into repair', async () => {
        const sourceControl = opaqueControl();
        let repairRequest: RepairModelRequest | undefined;
        let validationPass = 0;
        const validate = vi.fn(async (request: Parameters<SemanticValidatorModel['validate']>[0]) => {
            validationPass += 1;
            if (validationPass === 1) {
                expect(request.context.gates.lockedCharacters).toContainEqual({ id: 'char-opaque-99', name: 'Thẩm Dao' });
                expect(request.context.gates.lockedReveals).toContainEqual({ id: 'reveal-opaque-77', validationText: 'Vương miện giấu một bản đồ bí mật.' });
                expect(request.context.gates.lockedRelationshipEvents).toContainEqual({
                    id: 'relationship-opaque-77', eventType: 'first-meeting', participantIds: ['a', 'char-opaque-99'],
                    validationText: 'A và Thẩm Dao gặp nhau lần đầu.',
                });
                expect(request.context.gates.lockedStoryEvents).toContainEqual({ id: 'event-opaque-77', eventType: 'palace-coup', validationText: 'Cuộc chính biến trong đại điện bắt đầu.' });
                return semanticResult(request.chapterNumber, [{ code: 'CHARACTER_GATE_VIOLATION', severity: 'critical', scope: 'chapter' }]);
            }
            return semanticResult(request.chapterNumber);
        });
        const result = await validateAndRepairWriterChapter({
            control: sourceControl, state: stateFor(290), plan: planFor(290), draft: draftFor(290, 'Thẩm Dao bước vào phòng.'),
            semanticModel: { validate }, repairModel: { async repair(request) { repairRequest = request; return draftFor(290); } },
        });
        expect(result.status).toBe('approved-not-canon');
        expect(repairRequest?.context.candidate.prose).toContain('Thẩm Dao');
        const serializedRepair = JSON.stringify(repairRequest === undefined ? undefined : {
            ...repairRequest,
            context: { ...repairRequest.context, candidate: { ...repairRequest.context.candidate, prose: '[candidate prose removed]' } },
        });
        ['Thẩm Dao', 'Vương miện giấu', 'A và Thẩm Dao', 'Cuộc chính biến', 'lockedCharacters', 'lockedReveals', 'lockedRelationshipEvents', 'lockedStoryEvents', 'secretValidation']
            .forEach(value => expect(serializedRepair).not.toContain(value));
    });

    it.each([
        ['locked characters', { maxLockedCharacters: 3, maxLockedReveals: 10, maxLockedRelationshipEvents: 10, maxLockedStoryEvents: 10, maxSecretValidationItems: 10 }],
        ['locked reveals', { maxLockedCharacters: 10, maxLockedReveals: 3, maxLockedRelationshipEvents: 10, maxLockedStoryEvents: 10, maxSecretValidationItems: 10 }],
        ['locked relationship events', { maxLockedCharacters: 10, maxLockedReveals: 10, maxLockedRelationshipEvents: 2, maxLockedStoryEvents: 10, maxSecretValidationItems: 10 }],
        ['locked story events', { maxLockedCharacters: 10, maxLockedReveals: 10, maxLockedRelationshipEvents: 10, maxLockedStoryEvents: 2, maxSecretValidationItems: 10 }],
        ['secret validation', { maxLockedCharacters: 10, maxLockedReveals: 10, maxLockedRelationshipEvents: 10, maxLockedStoryEvents: 10, maxSecretValidationItems: 3 }],
    ])('fails closed before semantic validation or repair when %s exceed capacity', async (_label, validatorContextSelectionPolicy) => {
        const compiled = oversizedControl();
        const sourceControl = structuredClone(compiled);
        const state = stateFor(560);
        const before = [sourceControl, state].map(value => JSON.stringify(value));
        const validate = vi.fn();
        const repair = vi.fn();
        const result = await validateAndRepairWriterChapter({
            control: sourceControl, state, plan: planFor(560), draft: draftFor(560), semanticModel: { validate }, repairModel: { repair },
            validatorContextSelectionPolicy,
        });
        expect(result.status).toBe('rejected');
        expect(result.report.issues).toEqual([expect.objectContaining({
            code: 'VALIDATOR_CONTEXT_CAPACITY_EXCEEDED', severity: 'critical', repairable: false,
        })]);
        expect(validate).not.toHaveBeenCalled();
        expect(repair).not.toHaveBeenCalled();
        expect([sourceControl, state].map(value => JSON.stringify(value))).toEqual(before);
        expect(Object.isFrozen(sourceControl)).toBe(false);
        expect(Object.isFrozen(state)).toBe(false);
    });

    it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid validator capacities without calling either model: %s', async (invalidCapacity) => {
        const validate = vi.fn();
        const repair = vi.fn();
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: draftFor(560), semanticModel: { validate }, repairModel: { repair },
            validatorContextSelectionPolicy: {
                ...DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY,
                maxLockedCharacters: invalidCapacity,
            },
        });
        expect(result.report.issues).toEqual([expect.objectContaining({ code: 'VALIDATOR_CONTEXT_CAPACITY_EXCEEDED', repairable: false })]);
        expect(validate).not.toHaveBeenCalled();
        expect(repair).not.toHaveBeenCalled();
    });

    it('classifies validator plot-view overflow as context capacity infrastructure failure', async () => {
        const sourceControl = structuredClone(control);
        const state = stateFor(560);
        const before = [sourceControl, state].map(value => JSON.stringify(value));
        const validate = vi.fn();
        const repair = vi.fn();
        const result = await validateAndRepairWriterChapter({
            control: sourceControl, state, plan: planFor(560), draft: draftFor(560), semanticModel: { validate }, repairModel: { repair },
            validatorContextSelectionPolicy: { ...DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY, maxPlotItems: 0 },
        });
        expect(result.status).toBe('rejected');
        expect(result.report.issues).toEqual([expect.objectContaining({
            code: 'VALIDATOR_CONTEXT_CAPACITY_EXCEEDED', severity: 'critical', source: 'infrastructure', repairable: false,
        })]);
        expect(result.report.issues.map(issue => issue.code)).not.toContain('INVALID_SOURCE_PLAN');
        expect(validate).not.toHaveBeenCalled();
        expect(repair).not.toHaveBeenCalled();
        expect([sourceControl, state].map(value => JSON.stringify(value))).toEqual(before);
        expect(Object.isFrozen(sourceControl)).toBe(false);
        expect(Object.isFrozen(state)).toBe(false);
    });

    it('blocks a chapter 560 raw secret leak without echoing the secret in its report', async () => {
        const result = await validateWriterChapter({ control, state: stateFor(560), plan: planFor(560), draft: draftFor(560, `A realizes: ${RAW_SECRET}`), semanticModel: passingModel });
        expect(result.report.status).toBe('blocked');
        expect(result.report.issues).toContainEqual(expect.objectContaining({ code: 'AUTHOR_SECRET_LEAK', severity: 'critical', blocking: true }));
        expect(JSON.stringify(result.report)).not.toContain(RAW_SECRET);
        expect(JSON.stringify(result.report)).not.toContain('omega-secret');
    });

    it('allows the planned writer-facing reveal at chapter 561 without exposing the raw source secret', async () => {
        expect(buildValidatorContext(control, stateFor(561), planFor(561, true)).secretValidation).toEqual([]);
        const result = await validateWriterChapter({ control, state: stateFor(561), plan: planFor(561, true), draft: draftFor(561, 'At the price of the map, A learns that Omega owns a second key.'), semanticModel: passingModel });
        expect(result.report.status).toBe('passed');
        expect(result.report.issues.map(issue => issue.code)).not.toContain('AUTHOR_SECRET_LEAK');
        expect(JSON.stringify(result.report)).not.toContain(RAW_SECRET);
    });

    it('re-parses runtime drafts and blocks wrong chapter and control metadata', async () => {
        const wrong = { ...draftFor(560), chapterNumber: 559 } as WriterChapterDraft;
        const wrongResult = await validateWriterChapter({ control, state: stateFor(560), plan: planFor(560), draft: wrong, semanticModel: passingModel });
        expect(wrongResult.report.issues.map(issue => issue.code)).toContain('WRONG_CHAPTER');
        const metadata = draftFor(560, '<STORY_SUMMARY>engine data</STORY_SUMMARY>');
        const metadataResult = await validateWriterChapter({ control, state: stateFor(560), plan: planFor(560), draft: metadata, semanticModel: passingModel });
        expect(metadataResult.report.issues.map(issue => issue.code)).toContain('CONTROL_PROTOCOL_LEAK');
    });

    it('fails closed when the source plan no longer matches its arc or gates', async () => {
        const invalid = { ...planFor(560), arc: { id: 'wrong', title: 'Wrong' } };
        const result = await validateWriterChapter({ control, state: stateFor(560), plan: invalid, draft: draftFor(560), semanticModel: passingModel });
        expect(result.report.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_SOURCE_PLAN', repairable: false }));
    });
});

describe('Untrusted semantic validator protocol', () => {
    it.each([
        ['no issues', [], 'passed'],
        ['warning only', [{ code: 'FILLER_SCENE', severity: 'warning', scope: 'chapter' }], 'passed'],
        ['plan drift', [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }], 'blocked'],
        ['premature reveal', [{ code: 'PREMATURE_REVEAL', severity: 'critical', scope: 'chapter' }], 'blocked'],
    ])('handles %s with explicit approval semantics', async (_label, issues, expected) => {
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: draftFor(560), maxRepairAttempts: 0,
            semanticModel: { async validate(request) { return semanticResult(request.chapterNumber, issues); } }, repairModel: unusedRepair,
        });
        expect(result.status).toBe(expected === 'passed' ? 'approved-not-canon' : 'rejected');
        expect(result.report.status).toBe(expected);
    });

    it.each([
        ['unknown code', (chapter: number) => semanticResult(chapter, [{ code: 'MODEL_INVENTED_CODE', severity: 'error', scope: 'chapter' }])],
        ['infrastructure-only code', (chapter: number) => semanticResult(chapter, [{ code: 'VALIDATOR_CONTEXT_CAPACITY_EXCEEDED', severity: 'critical', scope: 'chapter' }])],
        ['malformed envelope', () => ({ kind: 'wrong', issues: [] })],
        ['duplicate issue', (chapter: number) => semanticResult(chapter, [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }, { code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }])],
        ['unsafe evidence field', (chapter: number) => semanticResult(chapter, [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter', evidence: RAW_SECRET }])],
        ['invalid scene', (chapter: number) => semanticResult(chapter, [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'scene', sceneId: 'not-in-plan' }])],
        ['understated severity', (chapter: number) => semanticResult(chapter, [{ code: 'PREMATURE_REVEAL', severity: 'warning', scope: 'chapter' }])],
    ])('fails closed for %s', async (_label, output) => {
        const repair = vi.fn();
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: draftFor(560),
            semanticModel: { async validate(request) { return output(request.chapterNumber); } }, repairModel: { repair },
        });
        expect(result.status).toBe('rejected');
        expect(result.report.issues).toContainEqual(expect.objectContaining({ code: 'VALIDATOR_PROTOCOL_FAILURE', repairable: false }));
        expect(repair).not.toHaveBeenCalled();
    });

    it('fails closed when the validator throws', async () => {
        const repair = vi.fn();
        const result = await validateAndRepairWriterChapter({ control, state: stateFor(560), plan: planFor(560), draft: draftFor(560), semanticModel: { async validate() { throw new Error('offline'); } }, repairModel: { repair } });
        expect(result.status).toBe('rejected');
        expect(result.report.issues.map(issue => issue.code)).toContain('VALIDATOR_PROTOCOL_FAILURE');
        expect(repair).not.toHaveBeenCalled();
    });

    it('parses only registered semantic fields and derives repairability from trusted policy', () => {
        const context = buildValidatorContext(control, stateFor(560), planFor(560));
        const parsed = parseSemanticValidationResult(semanticResult(560, [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'scene', sceneId: 'scene-560' }]), context);
        expect(parsed).toEqual([expect.objectContaining({ code: 'PLAN_DRIFT', repairable: true, source: 'semantic-validator' })]);
    });

    it('orders normalized reports deterministically by trusted severity and category', async () => {
        const issues = [
            { code: 'FILLER_SCENE', severity: 'warning', scope: 'chapter' },
            { code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' },
            { code: 'PREMATURE_REVEAL', severity: 'critical', scope: 'chapter' },
        ];
        const first = await validateWriterChapter({ control, state: stateFor(560), plan: planFor(560), draft: draftFor(560), semanticModel: { async validate(request) { return semanticResult(request.chapterNumber, issues); } } });
        const second = await validateWriterChapter({ control, state: stateFor(560), plan: planFor(560), draft: draftFor(560), semanticModel: { async validate(request) { return semanticResult(request.chapterNumber, issues.slice().reverse()); } } });
        expect(first.report).toEqual(second.report);
        expect(first.report.issues.map(issue => issue.code)).toEqual(['PREMATURE_REVEAL', 'PLAN_DRIFT', 'FILLER_SCENE']);
    });
});

describe('Bounded auto repair and non-canon result', () => {
    it('returns no WriterChapterDraft for a malformed wrong-kind runtime candidate', async () => {
        const runtimeDraft = { kind: 'wrong', chapterNumber: 999, prose: 'x', hiddenTruth: 'MUST NOT RETURN' };
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: runtimeDraft, maxRepairAttempts: 0,
            semanticModel: passingModel, repairModel: unusedRepair,
        });
        expect(result.status).toBe('rejected');
        expect(result).not.toHaveProperty('draft');
        expect(result).toHaveProperty('candidate');
        expect(JSON.stringify(result)).not.toContain('hiddenTruth');
        expect(JSON.stringify(result)).not.toContain('MUST NOT RETURN');
    });

    it('returns only a safe snapshot for malformed wrong-chapter objects with arbitrary fields', async () => {
        const runtimeDraft = {
            kind: 'writer-chapter-draft', validationStatus: 'unvalidated', chapterNumber: 559, title: 'Safe title', prose: 'Repairable prose.',
            hiddenTruth: 'EXTRA_FIELD_SECRET', arbitraryObject: { nested: 'NESTED_FIELD_SECRET' },
        };
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: runtimeDraft, maxRepairAttempts: 0,
            semanticModel: passingModel, repairModel: unusedRepair,
        });
        expect(result.status).toBe('rejected');
        expect(result).not.toHaveProperty('draft');
        expect(result).toMatchObject({ candidate: {
            kind: 'repair-candidate-snapshot', chapterNumber: 560, title: 'Safe title', prose: 'Repairable prose.',
        } });
        const serialized = JSON.stringify(result);
        ['hiddenTruth', 'EXTRA_FIELD_SECRET', 'arbitraryObject', 'NESTED_FIELD_SECRET'].forEach(value => expect(serialized).not.toContain(value));
    });

    it('keeps capacity failures runtime-safe before parsing malformed input', async () => {
        const runtimeDraft = { kind: 'wrong', chapterNumber: 999, prose: 'Safe prose only.', hiddenTruth: 'CAPACITY_SECRET' };
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: runtimeDraft, semanticModel: passingModel, repairModel: unusedRepair,
            validatorContextSelectionPolicy: {
                maxLockedCharacters: 0, maxLockedReveals: 10, maxLockedRelationshipEvents: 10,
                maxLockedStoryEvents: 10, maxSecretValidationItems: 10,
            },
        });
        expect(result.status).toBe('rejected');
        expect(result.report.issues).toContainEqual(expect.objectContaining({ code: 'VALIDATOR_CONTEXT_CAPACITY_EXCEEDED' }));
        expect(result).not.toHaveProperty('draft');
        expect(result).toMatchObject({ candidate: { kind: 'repair-candidate-snapshot', chapterNumber: 560, prose: 'Safe prose only.' } });
        expect(JSON.stringify(result)).not.toContain('CAPACITY_SECRET');
    });

    it('retains a parsed WriterChapterDraft on a valid rejected candidate', async () => {
        const draft = draftFor(560);
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft, maxRepairAttempts: 0,
            semanticModel: { async validate(request) { return semanticResult(request.chapterNumber, [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }]); } },
            repairModel: unusedRepair,
        });
        expect(result.status).toBe('rejected');
        expect(result).toMatchObject({ draft });
        expect(result).not.toHaveProperty('candidate');
    });

    it('returns a parsed WriterChapterDraft for every approved-not-canon result', async () => {
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: draftFor(560), semanticModel: passingModel, repairModel: unusedRepair,
        });
        expect(result.status).toBe('approved-not-canon');
        expect(result.draft).toEqual(draftFor(560));
        expect(result.draft.validationStatus).toBe('unvalidated');
    });

    it.each([
        ['flat hidden field', { hiddenTruth: 'EXTRA_FIELD_SECRET' }, 'hiddenTruth', 'EXTRA_FIELD_SECRET'],
        ['nested arbitrary object', { arbitraryInternalPayload: { secret: 'NESTED_FIELD_SECRET' } }, 'arbitraryInternalPayload', 'NESTED_FIELD_SECRET'],
        ['author secret field name', { authorOnlySecrets: 'AUTHOR_ONLY_FIELD_SECRET' }, 'authorOnlySecrets', 'AUTHOR_ONLY_FIELD_SECRET'],
    ])('projects a malformed wrong-chapter candidate through the repair allow-list: %s', async (_label, extra, forbiddenKey, forbiddenValue) => {
        let captured: RepairModelRequest | undefined;
        const runtimeDraft = {
            kind: 'writer-chapter-draft', validationStatus: 'unvalidated', chapterNumber: 559,
            prose: 'Candidate prose remains available for rewriting.', ...extra,
        } as unknown as WriterChapterDraft;
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: runtimeDraft, semanticModel: passingModel,
            repairModel: { async repair(request) { captured = request; return draftFor(560); } },
        });
        expect(result.status).toBe('approved-not-canon');
        expect(captured?.context.candidate).toEqual({
            kind: 'repair-candidate-snapshot', chapterNumber: 560,
            prose: 'Candidate prose remains available for rewriting.',
        });
        const serialized = JSON.stringify(captured);
        expect(serialized).not.toContain(forbiddenKey);
        expect(serialized).not.toContain(forbiddenValue);
    });

    it('repairs once, fully revalidates, and returns approved-not-canon without state mutation', async () => {
        const state = stateFor(560);
        const before = JSON.stringify(state);
        const validate = vi.fn(async (request: { chapterNumber: number; candidate: WriterChapterDraft }) => semanticResult(request.chapterNumber,
            request.candidate.prose.includes('drifts away') ? [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }] : []));
        const repaired = draftFor(560, 'A pays with the map and crosses the gate.');
        const repair = vi.fn(async () => repaired);
        const result = await validateAndRepairWriterChapter({ control, state, plan: planFor(560), draft: draftFor(560, 'A drifts away from the gate.'), semanticModel: { validate }, repairModel: { repair } });
        expect(result.status).toBe('approved-not-canon');
        expect(result.repairAttempts).toBe(1);
        expect(result.draft).toEqual(repaired);
        expect(validate).toHaveBeenCalledTimes(2);
        expect(repair).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(state)).toBe(before);
        expect(state.currentChapter).toBe(560);
        expect(result.status).not.toBe('canon');
    });

    it('uses exactly two repair calls and three validations at the default maximum', async () => {
        const validate = vi.fn(async (request: { chapterNumber: number }) => semanticResult(request.chapterNumber, [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }]));
        const repair = vi.fn(async () => draftFor(560, 'Still drifting.'));
        const result = await validateAndRepairWriterChapter({ control, state: stateFor(560), plan: planFor(560), draft: draftFor(560), semanticModel: { validate }, repairModel: { repair } });
        expect(result.status).toBe('rejected');
        expect(result.repairAttempts).toBe(2);
        expect(repair).toHaveBeenCalledTimes(2);
        expect(validate).toHaveBeenCalledTimes(3);
    });

    it('makes zero repair calls when the configured maximum is zero', async () => {
        const repair = vi.fn();
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: draftFor(560), maxRepairAttempts: 0,
            semanticModel: { async validate(request) { return semanticResult(request.chapterNumber, [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }]); } }, repairModel: { repair },
        });
        expect(result.status).toBe('rejected');
        expect(result.repairAttempts).toBe(0);
        expect(repair).not.toHaveBeenCalled();
    });

    it('keeps unrelated author secrets and privileged source fields out of repair requests', async () => {
        let captured: RepairModelRequest | undefined;
        let validation = 0;
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: draftFor(560, 'A walks away from the plan.'),
            semanticModel: { async validate(request) { validation += 1; return semanticResult(request.chapterNumber, validation === 1 ? [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }] : []); } },
            repairModel: { async repair(request) { captured = request; return draftFor(560); } },
        });
        expect(result.status).toBe('approved-not-canon');
        const serialized = JSON.stringify(captured);
        [RAW_SECRET, 'authorOnlySecrets', 'authorOnlySecretReferences', 'authorNotes', 'authorPlan', 'futureArcTruth', 'secretValidation'].forEach(value => expect(serialized).not.toContain(value));
        expect(serialized).toContain('Return to the supplied chapter plan');
    });

    it('passes a leaked secret only once as candidate data, removes it, and revalidates from scratch', async () => {
        let captured = '';
        const repair = vi.fn(async (request: RepairModelRequest) => {
            captured = JSON.stringify(request);
            expect(request.context.issues).toEqual([expect.objectContaining({ code: 'AUTHOR_SECRET_LEAK', instruction: expect.not.stringContaining(RAW_SECRET) })]);
            expect(request.context.candidate.prose).toContain(RAW_SECRET);
            const withoutCandidateProse = JSON.stringify({
                ...request,
                context: { ...request.context, candidate: { ...request.context.candidate, prose: '[candidate prose removed]' } },
            });
            expect(withoutCandidateProse).not.toContain(RAW_SECRET);
            return draftFor(560, 'A pays with the map and crosses the gate.');
        });
        const validate = vi.fn(async (request: { chapterNumber: number }) => semanticResult(request.chapterNumber));
        const result = await validateAndRepairWriterChapter({ control, state: stateFor(560), plan: planFor(560), draft: draftFor(560, `A thinks ${RAW_SECRET}`), semanticModel: { validate }, repairModel: { repair } });
        expect(result.status).toBe('approved-not-canon');
        expect(captured.split(RAW_SECRET)).toHaveLength(2);
        expect(JSON.stringify(result.draft)).not.toContain(RAW_SECRET);
        expect(repair).toHaveBeenCalledTimes(1);
        expect(validate).toHaveBeenCalledTimes(2);
    });

    it('rejects malformed repair output and counts the attempted repair call', async () => {
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: draftFor(560),
            semanticModel: { async validate(request) { return semanticResult(request.chapterNumber, [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }]); } },
            repairModel: { async repair() { return { kind: 'wrong', chapterNumber: 560, prose: '' }; } },
        });
        expect(result.status).toBe('rejected');
        expect(result.repairAttempts).toBe(1);
        expect(result.report.issues).toContainEqual(expect.objectContaining({ code: 'REPAIR_PROTOCOL_FAILURE', repairable: false }));
    });

    it('fails closed when the repair model throws and never approves the original draft', async () => {
        const repair = vi.fn(async () => { throw new Error('repair provider unavailable'); });
        const result = await validateAndRepairWriterChapter({
            control, state: stateFor(560), plan: planFor(560), draft: draftFor(560),
            semanticModel: { async validate(request) { return semanticResult(request.chapterNumber, [{ code: 'PLAN_DRIFT', severity: 'error', scope: 'chapter' }]); } },
            repairModel: { repair },
        });
        expect(result.status).toBe('rejected');
        expect(result.repairAttempts).toBe(1);
        expect(result.report.issues.map(issue => issue.code)).toContain('REPAIR_PROTOCOL_FAILURE');
        expect(repair).toHaveBeenCalledTimes(1);
    });

    it('does not mutate or freeze any caller-owned source', async () => {
        const mutableControl = compileStoryControl(blueprint());
        const state = stateFor(560);
        const plan = planFor(560);
        const draft = draftFor(560);
        const before = [mutableControl, state, plan, draft].map(value => JSON.stringify(value));
        const result = await validateAndRepairWriterChapter({ control: mutableControl, state, plan, draft, semanticModel: passingModel, repairModel: unusedRepair });
        expect(result.status).toBe('approved-not-canon');
        expect([mutableControl, state, plan, draft].map(value => JSON.stringify(value))).toEqual(before);
        expect(Object.isFrozen(state)).toBe(false);
        expect(Object.isFrozen(plan)).toBe(false);
        expect(Object.isFrozen(draft)).toBe(false);
    });
});
