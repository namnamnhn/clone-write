import type { InternalChapterPlan, PlannerContext } from './plannerTypes';
import { parseRelationshipEvidenceRef, parseWriterRelationshipDirectives } from './relationshipRuntime';
import { RELATIONSHIP_ISSUE_CODES } from './relationshipTypes';
import type {
    RelationshipEvidenceRef,
    RelationshipIssueCode,
    ValidatorRelationshipActionDescriptor,
    ValidatorRelationshipView,
    WriterRelationshipDirective,
} from './relationshipTypes';
import { orderRelationshipActions, validateRelationshipActions } from './relationshipValidator';
import { buildWriterRelationshipDirectives } from './relationshipContext';
import type { FullStoryControl } from './types';
import { assertModelBoundaryStringsSecretSafe } from './secretTextSafety';
import { buildRelationshipGateValidationView } from './relationshipGateValidation';
import { relationshipEvidenceAdequacyProblems } from './relationshipEvidence';

export class RelationshipContextCapacityError extends Error {
    constructor(message: string) { super(message); this.name = 'RelationshipContextCapacityError'; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fail = (path: string, message: string): never => { throw new Error(`${path} ${message}`); };
const record = (value: unknown, path: string): Record<string, unknown> => isRecord(value) ? value : fail(path, 'must be an object');
const strictKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string): void => {
    const set = new Set(allowed);
    if (Object.keys(value).some(key => !set.has(key))) fail(path, 'contains unsupported fields');
};
const text = (value: unknown, path: string): string => typeof value === 'string' && value.trim() ? value : fail(path, 'must be non-empty text');
const strings = (value: unknown, path: string): readonly string[] => {
    const values = Array.isArray(value) ? value : fail(path, 'must be an array');
    const output = values.map((entry, index) => text(entry, `${path}.${index}`));
    if (new Set(output).size !== output.length) fail(path, 'must not contain duplicates');
    return output;
};

const directiveKeys = [
    'id', 'relationshipId', 'relationshipEventId', 'sceneIds', 'participantIds', 'category', 'actionType', 'importance',
    'jealousCharacterId',
    'currentRomanceMilestone', 'intendedProgression', 'participantChoices', 'visibleBoundaries', 'visibleCurrentDynamic',
    'visibleObjective', 'visibleConflict', 'expectedCostOrTradeoff', 'visibleUncertainty', 'visiblePowerBalance', 'powerImbalanceAddressed', 'dependsOnActionId',
] as const;
const evidenceKeys = ['evidenceRefs', 'participantKnowledgeRefs', 'privilegedConstraints'] as const;

const evidenceIdentity = (reference: RelationshipEvidenceRef): string => reference.type === 'knowledge'
    ? `${reference.type}\u0000${reference.characterId}\u0000${reference.factId}`
    : reference.type === 'belief' ? `${reference.type}\u0000${reference.characterId}\u0000${reference.epistemicId}`
    : reference.type === 'character-status' ? `${reference.type}\u0000${reference.characterId}\u0000${reference.value}`
        : `${reference.type}\u0000${reference.id}`;

const stableUniqueStrings = (values: readonly string[]): readonly string[] => {
    const seen = new Set<string>();
    return values.filter((value) => {
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
    });
};

const evidenceResolves = (reference: RelationshipEvidenceRef, context: PlannerContext, actionIds: ReadonlySet<string>): boolean => {
    if (reference.type === 'fact') return [...context.writerVisibleFacts, ...context.internalFacts].some(value => value.id === reference.id);
    if (reference.type === 'knowledge') return context.characterKnowledge.some(value => value.characterId === reference.characterId && value.factIds.includes(reference.factId));
    if (reference.type === 'belief') return context.relationshipContext.participantBeliefs.some(value => value.id === reference.epistemicId && value.characterId === reference.characterId);
    if (reference.type === 'relationship') return context.relationships.some(value => value.id === reference.id);
    if (reference.type === 'relationship-history') return context.relationshipContext.relationships.some(value => value.recentHistory.some(history => history.id === reference.id));
    if (reference.type === 'strategic-action') return actionIds.has(reference.id);
    const character = context.availableCharacters.find(value => value.id === reference.characterId);
    return character !== undefined && [character.status?.status, ...(character.status?.injuries ?? []), ...(character.status?.conditions ?? [])].includes(reference.value);
};

const descriptorFrom = (
    directive: WriterRelationshipDirective,
    evidenceRefs: readonly RelationshipEvidenceRef[],
    participantKnowledgeRefs: readonly { readonly characterId: string; readonly factId: string }[],
    privilegedConstraints: readonly string[],
): ValidatorRelationshipActionDescriptor => ({
    ...directive,
    evidenceRefs: evidenceRefs.map(reference => ({ ...reference })),
    participantKnowledgeRefs: participantKnowledgeRefs.map(value => ({ ...value })),
    privilegedConstraints: privilegedConstraints.map(value => value),
});

const itemCount = (view: ValidatorRelationshipView): number => view.actions.reduce((total, action) => total
    + 1 + action.sceneIds.length + action.participantIds.length + action.participantChoices.length
    + action.visibleBoundaries.length + action.evidenceRefs.length + action.participantKnowledgeRefs.length
    + action.privilegedConstraints.length, 0) + view.canonicalRelationships.length + view.deterministicIssues.length;

/** Bounded privileged relationship evidence for Semantic Validator only. */
export const buildValidatorRelationshipView = (
    control: FullStoryControl,
    plan: InternalChapterPlan,
    context: PlannerContext,
    maximumItems = 256,
): ValidatorRelationshipView => {
    if (!Number.isSafeInteger(maximumItems) || maximumItems < 0) throw new RelationshipContextCapacityError('invalid validator relationship capacity');
    const actions = orderRelationshipActions(plan.relationshipActions ?? [], plan);
    const directives = buildWriterRelationshipDirectives(control, plan);
    const descriptors = actions.map((action, index) => descriptorFrom(
        directives[index],
        action.evidenceRefs.slice().sort((left, right) => evidenceIdentity(left).localeCompare(evidenceIdentity(right))),
        [...new Map(action.participantAgency.flatMap(agency => agency.knowledgeBasisFactIds.map(factId => ({ characterId: agency.characterId, factId })))
            .map(value => [`${value.characterId}\u0000${value.factId}`, value])).values()]
            .sort((left, right) => left.characterId.localeCompare(right.characterId) || left.factId.localeCompare(right.factId)),
        stableUniqueStrings([
            action.counterpressure,
            ...action.participantAgency.flatMap(agency => [
                agency.currentGoal, agency.desiredOutcome, agency.boundary, agency.uncertainty, agency.costOrRisk,
            ]),
        ]),
    ));
    const relationshipIds = [...new Set(actions.map(value => value.relationshipId))].sort();
    const canonicalRelationships = relationshipIds.map((id) => {
        const value = context.relationshipContext.relationships.find(entry => entry.id === id);
        if (!value) fail('relationshipView.canonicalRelationships', 'action relationship does not resolve in the target context');
        return {
            id: value.id,
            participantIds: value.participantIds.map(participantId => participantId),
            ...(value.currentState === undefined ? {} : { currentState: value.currentState }),
            currentRomanceMilestone: value.currentRomanceMilestone,
        };
    });
    const deterministicIssues = validateRelationshipActions(plan, context, buildRelationshipGateValidationView(control, context.targetChapter))
        .map(value => ({ code: value.code, path: value.path, severity: value.severity }));
    const view: ValidatorRelationshipView = {
        kind: 'validator-relationship-view', chapterNumber: context.targetChapter,
        actions: descriptors, canonicalRelationships, deterministicIssues,
    };
    if (itemCount(view) > maximumItems) throw new RelationshipContextCapacityError('complete validator relationship evidence exceeds capacity');
    assertModelBoundaryStringsSecretSafe(control, view, 'validatorRelationshipView');
    return view;
};

const parseAction = (
    value: unknown,
    path: string,
    context: PlannerContext,
    strategicActionIds: ReadonlySet<string>,
): ValidatorRelationshipActionDescriptor => {
    const source = record(value, path);
    strictKeys(source, [...directiveKeys, ...evidenceKeys], path);
    const writerSource: Record<string, unknown> = {};
    directiveKeys.forEach((key) => { if (source[key] !== undefined) writerSource[key] = source[key]; });
    const directive = parseWriterRelationshipDirectives([writerSource], path)[0];
    const evidenceValues = Array.isArray(source.evidenceRefs) ? source.evidenceRefs : fail(path, 'contains malformed evidenceRefs');
    const knowledgeValues = Array.isArray(source.participantKnowledgeRefs) ? source.participantKnowledgeRefs : fail(path, 'contains malformed participantKnowledgeRefs');
    const evidenceRefs = evidenceValues.map((entry, index) => parseRelationshipEvidenceRef(entry, `${path}.evidenceRefs.${index}`));
    if (new Set(evidenceRefs.map(evidenceIdentity)).size !== evidenceRefs.length
        || evidenceRefs.some(reference => !evidenceResolves(reference, context, strategicActionIds))) fail(`${path}.evidenceRefs`, 'contains unresolved or duplicate evidence');
    const participantKnowledgeRefs = knowledgeValues.map((entry, index) => {
        const entryPath = `${path}.participantKnowledgeRefs.${index}`;
        const knowledge = record(entry, entryPath);
        strictKeys(knowledge, ['characterId', 'factId'], entryPath);
        const characterId = text(knowledge.characterId, `${entryPath}.characterId`);
        const factId = text(knowledge.factId, `${entryPath}.factId`);
        if (!context.characterKnowledge.some(value => value.characterId === characterId && value.factIds.includes(factId))) fail(entryPath, 'is not canonical participant knowledge');
        return { characterId, factId };
    });
    const knowledgeIdentities = participantKnowledgeRefs.map(value => `${value.characterId}\u0000${value.factId}`);
    if (new Set(knowledgeIdentities).size !== knowledgeIdentities.length) fail(`${path}.participantKnowledgeRefs`, 'must not contain duplicates');
    const adequacyProblems = relationshipEvidenceAdequacyProblems({
        actionType: directive.actionType,
        importance: directive.importance,
        participantIds: directive.participantIds,
        participantActorIds: directive.participantChoices.map(choice => choice.characterId),
        ...(directive.jealousCharacterId === undefined ? {} : { jealousCharacterId: directive.jealousCharacterId }),
        direction: directive.intendedProgression.direction,
        evidenceRefs,
    });
    if (adequacyProblems.length > 0) fail(`${path}.evidenceRefs`, adequacyProblems[0]);
    return descriptorFrom(directive, evidenceRefs, participantKnowledgeRefs, strings(source.privilegedConstraints, `${path}.privilegedConstraints`));
};

/** Strict runtime reconstruction for untrusted supplied Validator relationship context. */
export const parseValidatorRelationshipView = (
    value: unknown,
    targetChapter: number,
    maximumItems: number,
    context: PlannerContext,
    strategicActionIds: ReadonlySet<string> = new Set(),
): ValidatorRelationshipView => {
    if (!Number.isSafeInteger(maximumItems) || maximumItems < 0) throw new RelationshipContextCapacityError('invalid validator relationship capacity');
    const source = record(value, 'relationshipView');
    strictKeys(source, ['kind', 'chapterNumber', 'actions', 'canonicalRelationships', 'deterministicIssues'], 'relationshipView');
    if (source.kind !== 'validator-relationship-view' || source.chapterNumber !== targetChapter) fail('relationshipView', 'target identity mismatch');
    const actionValues = Array.isArray(source.actions) ? source.actions : fail('relationshipView.actions', 'must be an array');
    const canonicalValues = Array.isArray(source.canonicalRelationships) ? source.canonicalRelationships : fail('relationshipView.canonicalRelationships', 'must be an array');
    const issueValues = Array.isArray(source.deterministicIssues) ? source.deterministicIssues : fail('relationshipView.deterministicIssues', 'must be an array');
    const actions = actionValues.map((entry, index) => parseAction(entry, `relationshipView.actions.${index}`, context, strategicActionIds));
    if (new Set(actions.map(value => value.id)).size !== actions.length) fail('relationshipView.actions', 'must not contain duplicate IDs');
    const canonicalRelationships = canonicalValues.map((entry, index) => {
        const path = `relationshipView.canonicalRelationships.${index}`;
        const descriptor = record(entry, path);
        strictKeys(descriptor, ['id', 'participantIds', 'currentState', 'currentRomanceMilestone'], path);
        const id = text(descriptor.id, `${path}.id`);
        const canonical = context.relationshipContext.relationships.find(value => value.id === id) ?? fail(path, 'does not resolve in the target relationship context');
        const participantIds = strings(descriptor.participantIds, `${path}.participantIds`);
        if (participantIds.join('\u0000') !== canonical.participantIds.join('\u0000')
            || descriptor.currentState !== canonical.currentState
            || descriptor.currentRomanceMilestone !== canonical.currentRomanceMilestone) fail(path, 'does not match canonical relationship projection');
        return { id, participantIds, ...(canonical.currentState === undefined ? {} : { currentState: canonical.currentState }), currentRomanceMilestone: canonical.currentRomanceMilestone };
    });
    const requiredIds = [...new Set(actions.map(value => value.relationshipId))].sort();
    if (canonicalRelationships.map(value => value.id).sort().join('\u0000') !== requiredIds.join('\u0000')) fail('relationshipView.canonicalRelationships', 'must exactly cover action relationships');
    const deterministicIssues = issueValues.map((entry, index) => {
        const path = `relationshipView.deterministicIssues.${index}`;
        const parsed = record(entry, path);
        strictKeys(parsed, ['code', 'path', 'severity'], path);
        if (!RELATIONSHIP_ISSUE_CODES.includes(parsed.code as RelationshipIssueCode) || parsed.severity !== 'error') fail(path, 'is not an owned relationship error');
        return { code: parsed.code as RelationshipIssueCode, path: text(parsed.path, `${path}.path`), severity: 'error' as const };
    });
    const view: ValidatorRelationshipView = { kind: 'validator-relationship-view', chapterNumber: targetChapter, actions, canonicalRelationships, deterministicIssues };
    if (itemCount(view) > maximumItems) throw new RelationshipContextCapacityError('validator relationship view exceeds capacity');
    return view;
};

export const projectValidatorRelationshipActionToWriterDirective = (
    action: ValidatorRelationshipActionDescriptor,
): WriterRelationshipDirective => {
    const source: Record<string, unknown> = {};
    directiveKeys.forEach((key) => { if (action[key] !== undefined) source[key] = action[key]; });
    return parseWriterRelationshipDirectives([source], 'validatorRelationshipActionProjection')[0];
};

export const writerRelationshipDirectiveMatchesValidatorAction = (
    directive: WriterRelationshipDirective,
    action: ValidatorRelationshipActionDescriptor,
): boolean => JSON.stringify(directive) === JSON.stringify(projectValidatorRelationshipActionToWriterDirective(action));
