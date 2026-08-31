import type { InternalChapterPlan, PlanValidationIssue, PlannerContext } from './plannerTypes';
import { assertModelBoundaryStringsSecretSafe } from './secretTextSafety';
import {
    actionResourceEffects,
    collectActionEvidence,
    evidenceIdentity,
    resourceFor,
    resourceKey,
    strategicCharacterKnowsFact,
    validateEvidenceReference,
} from './strategicEvidence';
import {
    COMMERCE_ACTION_TYPES,
    COMMERCE_FLOW_ROLES,
    MILITARY_OPERATION_TYPES,
    POLITICAL_DIMENSIONS,
    STRATEGIC_ASSESSMENT_STATUSES,
    STRATEGIC_ISSUE_CODES,
} from './strategicTypes';
import type {
    CommerceResourceFlow,
    MilitaryLogisticsPlan,
    MilitaryMovementPlan,
    PoliticalTiming,
    StrategicActionPlan,
    StrategicEvidenceRef,
    StrategicIssueCode,
    ValidatorStrategicActionDescriptor,
    ValidatorStrategicView,
    WriterCommerceDirective,
    WriterMilitaryDirective,
    WriterPoliticalDirective,
    WriterStrategicDirective,
} from './strategicTypes';
import { orderStrategicActions, validateStrategicActions } from './strategicValidator';
import type { FullStoryControl } from './types';

export class StrategicContextCapacityError extends Error {
    constructor(message: string) { super(message); this.name = 'StrategicContextCapacityError'; }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (path: string, message: string): never => {
    throw new Error(`${path} ${message}`);
};

const strictKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string): void => {
    const allowedSet = new Set(allowed);
    if (Object.keys(value).some(key => !allowedSet.has(key))) fail(path, 'contains unsupported fields');
};

const record = (value: unknown, path: string): Record<string, unknown> => {
    return isRecord(value) ? value : fail(path, 'must be an object');
};

const nonEmptyText = (value: unknown, path: string): string => {
    return typeof value === 'string' && value.trim() ? value : fail(path, 'must be a non-empty string');
};

const stringArray = (value: unknown, path: string, options?: { readonly nonEmpty?: boolean; readonly unique?: boolean }): readonly string[] => {
    const values = Array.isArray(value) ? value : fail(path, 'must be an array');
    const result = values.map((entry, index) => nonEmptyText(entry, `${path}.${index}`));
    if (options?.nonEmpty && result.length === 0) fail(path, 'must not be empty');
    if (options?.unique && new Set(result).size !== result.length) fail(path, 'must not contain duplicates');
    return result;
};

const nonNegativeIntegerOrUnknown = (value: unknown, path: string): number | 'unknown' => {
    if (value === 'unknown') return value;
    if (!Number.isSafeInteger(value) || (value as number) < 0) fail(path, 'must be a non-negative safe integer or unknown');
    return value as number;
};

const positiveInteger = (value: unknown, path: string): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 1) fail(path, 'must be a positive safe integer');
    return value as number;
};

const finiteNumber = (value: unknown, path: string): number => {
    return typeof value === 'number' && Number.isFinite(value) ? value : fail(path, 'must be a finite number');
};

const parseResourceReference = (
    value: unknown,
    path: string,
): { readonly characterId: string; readonly resourceId: string } => {
    const source = record(value, path);
    strictKeys(source, ['characterId', 'resourceId'], path);
    return {
        characterId: nonEmptyText(source.characterId, `${path}.characterId`),
        resourceId: nonEmptyText(source.resourceId, `${path}.resourceId`),
    };
};

const parsePoliticalTiming = (value: unknown, path: string): PoliticalTiming => {
    const source = record(value, path);
    strictKeys(source, ['earliestChapter', 'deadlineChapter', 'preparationChapters'], path);
    const earliestChapter = source.earliestChapter === undefined ? undefined : positiveInteger(source.earliestChapter, `${path}.earliestChapter`);
    const deadlineChapter = source.deadlineChapter === undefined ? undefined : positiveInteger(source.deadlineChapter, `${path}.deadlineChapter`);
    const preparation = nonNegativeIntegerOrUnknown(source.preparationChapters, `${path}.preparationChapters`);
    const preparationChapters = preparation === 'unknown'
        ? fail(`${path}.preparationChapters`, 'must be a non-negative safe integer') : preparation;
    return {
        ...(earliestChapter === undefined ? {} : { earliestChapter }),
        ...(deadlineChapter === undefined ? {} : { deadlineChapter }),
        preparationChapters,
    };
};

const parseMovement = (value: unknown, path: string): MilitaryMovementPlan => {
    const source = record(value, path);
    strictKeys(source, ['fromLocation', 'toLocation', 'method', 'transitChapters'], path);
    return {
        fromLocation: nonEmptyText(source.fromLocation, `${path}.fromLocation`),
        toLocation: nonEmptyText(source.toLocation, `${path}.toLocation`),
        method: nonEmptyText(source.method, `${path}.method`),
        transitChapters: nonNegativeIntegerOrUnknown(source.transitChapters, `${path}.transitChapters`),
    };
};

const parseLogistics = (value: unknown, path: string): MilitaryLogisticsPlan => {
    const source = record(value, path);
    strictKeys(source, [
        'supplyResource', 'expectedSupplyConsumption', 'mobilityResource', 'movementConstraint',
        'operationalTimeChapters', 'resupplyOrFallback',
    ], path);
    const expectedSupplyConsumption = source.expectedSupplyConsumption === 'unknown'
        ? 'unknown' : finiteNumber(source.expectedSupplyConsumption, `${path}.expectedSupplyConsumption`);
    if (typeof expectedSupplyConsumption === 'number' && expectedSupplyConsumption < 0) {
        fail(`${path}.expectedSupplyConsumption`, 'must be non-negative');
    }
    return {
        supplyResource: parseResourceReference(source.supplyResource, `${path}.supplyResource`),
        expectedSupplyConsumption,
        ...(source.mobilityResource === undefined ? {} : { mobilityResource: parseResourceReference(source.mobilityResource, `${path}.mobilityResource`) }),
        movementConstraint: nonEmptyText(source.movementConstraint, `${path}.movementConstraint`),
        operationalTimeChapters: nonNegativeIntegerOrUnknown(source.operationalTimeChapters, `${path}.operationalTimeChapters`),
        resupplyOrFallback: nonEmptyText(source.resupplyOrFallback, `${path}.resupplyOrFallback`),
    };
};

const parseCommerceTiming = (value: unknown, path: string): WriterCommerceDirective['timing'] => {
    const source = record(value, path);
    strictKeys(source, ['settlementChapters', 'deadlineChapter'], path);
    return {
        settlementChapters: nonNegativeIntegerOrUnknown(source.settlementChapters, `${path}.settlementChapters`),
        ...(source.deadlineChapter === undefined ? {} : { deadlineChapter: positiveInteger(source.deadlineChapter, `${path}.deadlineChapter`) }),
    };
};

const parseResourceFlows = (value: unknown, path: string): readonly CommerceResourceFlow[] => {
    const values = Array.isArray(value) ? value : fail(path, 'must be an array');
    return values.map((entry, index) => {
        const entryPath = `${path}.${index}`;
        const source = record(entry, entryPath);
        strictKeys(source, ['characterId', 'resourceId', 'quantityDelta', 'role'], entryPath);
        if (!COMMERCE_FLOW_ROLES.includes(source.role as CommerceResourceFlow['role'])) fail(`${entryPath}.role`, 'is unsupported');
        return {
            characterId: nonEmptyText(source.characterId, `${entryPath}.characterId`),
            resourceId: nonEmptyText(source.resourceId, `${entryPath}.resourceId`),
            quantityDelta: finiteNumber(source.quantityDelta, `${entryPath}.quantityDelta`),
            role: source.role as CommerceResourceFlow['role'],
        };
    });
};

const directiveBase = (source: Record<string, unknown>, path: string) => ({
    id: nonEmptyText(source.id, `${path}.id`),
    sceneIds: stringArray(source.sceneIds, `${path}.sceneIds`, { nonEmpty: true, unique: true }),
    actorCharacterId: nonEmptyText(source.actorCharacterId, `${path}.actorCharacterId`),
    visibleObjective: nonEmptyText(source.visibleObjective, `${path}.visibleObjective`),
    visibleConstraints: stringArray(source.visibleConstraints, `${path}.visibleConstraints`),
    expectedCostOrTradeoff: nonEmptyText(source.expectedCostOrTradeoff, `${path}.expectedCostOrTradeoff`),
});

const commonDirectiveKeys = [
    'id', 'domain', 'sceneIds', 'actorCharacterId', 'visibleObjective', 'visibleConstraints', 'expectedCostOrTradeoff',
] as const;
const validatorEvidenceKeys = [
    'opponentCharacterId', 'evidenceRefs', 'resourceKeys', 'actorKnowledgeFactIds', 'opponentKnowledgeFactIds',
] as const;

const parseWriterDirectiveRecord = (
    source: Record<string, unknown>,
    path: string,
    includeValidatorEvidence: boolean,
): WriterStrategicDirective => {
    const evidenceKeys = includeValidatorEvidence ? validatorEvidenceKeys : [];
    const base = directiveBase(source, path);
    if (source.domain === 'politics') {
        strictKeys(source, [...commonDirectiveKeys, 'dimensionStatuses', 'timing', ...evidenceKeys], path);
        const statusValues = Array.isArray(source.dimensionStatuses)
            ? source.dimensionStatuses : fail(`${path}.dimensionStatuses`, 'must be an array');
        const dimensionStatuses = statusValues.map((entry, index) => {
            const entryPath = `${path}.dimensionStatuses.${index}`;
            const assessment = record(entry, entryPath);
            strictKeys(assessment, ['dimension', 'status'], entryPath);
            if (!POLITICAL_DIMENSIONS.includes(assessment.dimension as typeof POLITICAL_DIMENSIONS[number])) fail(`${entryPath}.dimension`, 'is unsupported');
            if (!STRATEGIC_ASSESSMENT_STATUSES.includes(assessment.status as typeof STRATEGIC_ASSESSMENT_STATUSES[number])) fail(`${entryPath}.status`, 'is unsupported');
            return {
                dimension: assessment.dimension as WriterPoliticalDirective['dimensionStatuses'][number]['dimension'],
                status: assessment.status as WriterPoliticalDirective['dimensionStatuses'][number]['status'],
            };
        });
        const dimensions = dimensionStatuses.map(entry => entry.dimension);
        if (dimensions.length !== POLITICAL_DIMENSIONS.length || new Set(dimensions).size !== dimensions.length
            || POLITICAL_DIMENSIONS.some(dimension => !dimensions.includes(dimension))) {
            fail(`${path}.dimensionStatuses`, 'must contain every political dimension exactly once');
        }
        return { ...base, domain: 'politics', dimensionStatuses, timing: parsePoliticalTiming(source.timing, `${path}.timing`) };
    }
    if (source.domain === 'military') {
        strictKeys(source, [
            ...commonDirectiveKeys, 'operationType', 'location', 'movement', 'logistics',
            'expectedLossOrCost', 'retreatOrFailurePlan', ...evidenceKeys,
        ], path);
        if (!MILITARY_OPERATION_TYPES.includes(source.operationType as WriterMilitaryDirective['operationType'])) fail(`${path}.operationType`, 'is unsupported');
        return {
            ...base,
            domain: 'military',
            operationType: source.operationType as WriterMilitaryDirective['operationType'],
            location: nonEmptyText(source.location, `${path}.location`),
            ...(source.movement === undefined ? {} : { movement: parseMovement(source.movement, `${path}.movement`) }),
            ...(source.logistics === undefined ? {} : { logistics: parseLogistics(source.logistics, `${path}.logistics`) }),
            expectedLossOrCost: nonEmptyText(source.expectedLossOrCost, `${path}.expectedLossOrCost`),
            retreatOrFailurePlan: nonEmptyText(source.retreatOrFailurePlan, `${path}.retreatOrFailurePlan`),
        };
    }
    if (source.domain === 'commerce') {
        strictKeys(source, [
            ...commonDirectiveKeys, 'actionType', 'resourceFlows', 'counterpartyCharacterId', 'marketSource',
            'serviceOrContractBasis', 'logistics', 'timing', 'risk', 'competitorCharacterId', 'fundingResource',
            ...evidenceKeys,
        ], path);
        if (!COMMERCE_ACTION_TYPES.includes(source.actionType as WriterCommerceDirective['actionType'])) fail(`${path}.actionType`, 'is unsupported');
        return {
            ...base,
            domain: 'commerce',
            actionType: source.actionType as WriterCommerceDirective['actionType'],
            resourceFlows: parseResourceFlows(source.resourceFlows, `${path}.resourceFlows`),
            ...(source.counterpartyCharacterId === undefined ? {} : { counterpartyCharacterId: nonEmptyText(source.counterpartyCharacterId, `${path}.counterpartyCharacterId`) }),
            ...(source.marketSource === undefined ? {} : { marketSource: nonEmptyText(source.marketSource, `${path}.marketSource`) }),
            ...(source.serviceOrContractBasis === undefined ? {} : { serviceOrContractBasis: nonEmptyText(source.serviceOrContractBasis, `${path}.serviceOrContractBasis`) }),
            logistics: nonEmptyText(source.logistics, `${path}.logistics`),
            timing: parseCommerceTiming(source.timing, `${path}.timing`),
            risk: nonEmptyText(source.risk, `${path}.risk`),
            ...(source.competitorCharacterId === undefined ? {} : { competitorCharacterId: nonEmptyText(source.competitorCharacterId, `${path}.competitorCharacterId`) }),
            ...(source.fundingResource === undefined ? {} : { fundingResource: parseResourceReference(source.fundingResource, `${path}.fundingResource`) }),
        };
    }
    fail(`${path}.domain`, 'is unsupported');
};

export const parseWriterStrategicDirectives = (value: unknown, path = 'strategicDirectives'): readonly WriterStrategicDirective[] => {
    const values = Array.isArray(value) ? value : fail(path, 'must be an array');
    const directives = values.map((entry, index) => parseWriterDirectiveRecord(record(entry, `${path}.${index}`), `${path}.${index}`, false));
    const ids = directives.map(entry => entry.id);
    if (new Set(ids).size !== ids.length) fail(path, 'must not contain duplicate IDs');
    return directives;
};

const writerDirectiveFromAction = (action: StrategicActionPlan): WriterStrategicDirective => {
    const base = {
        id: action.id,
        sceneIds: action.sceneIds.map(id => id),
        actorCharacterId: action.actorCharacterId,
        visibleObjective: action.objective,
        visibleConstraints: action.writerVisibleConstraints.map(value => value),
        expectedCostOrTradeoff: action.expectedCostOrTradeoff,
    };
    if (action.domain === 'politics') {
        return {
            ...base,
            domain: 'politics',
            dimensionStatuses: action.dimensions.map(entry => ({ dimension: entry.dimension, status: entry.status })),
            timing: {
                ...(action.timing.earliestChapter === undefined ? {} : { earliestChapter: action.timing.earliestChapter }),
                ...(action.timing.deadlineChapter === undefined ? {} : { deadlineChapter: action.timing.deadlineChapter }),
                preparationChapters: action.timing.preparationChapters,
            },
        };
    }
    if (action.domain === 'military') {
        return {
            ...base,
            domain: 'military', operationType: action.operationType, location: action.location,
            ...(action.movement === undefined ? {} : { movement: {
                fromLocation: action.movement.fromLocation, toLocation: action.movement.toLocation,
                method: action.movement.method, transitChapters: action.movement.transitChapters,
            } }),
            ...(action.logistics === undefined ? {} : { logistics: {
                supplyResource: { characterId: action.logistics.supplyResource.characterId, resourceId: action.logistics.supplyResource.resourceId },
                expectedSupplyConsumption: action.logistics.expectedSupplyConsumption,
                ...(action.logistics.mobilityResource === undefined ? {} : { mobilityResource: {
                    characterId: action.logistics.mobilityResource.characterId, resourceId: action.logistics.mobilityResource.resourceId,
                } }),
                movementConstraint: action.logistics.movementConstraint,
                operationalTimeChapters: action.logistics.operationalTimeChapters,
                resupplyOrFallback: action.logistics.resupplyOrFallback,
            } }),
            expectedLossOrCost: action.expectedLossOrCost,
            retreatOrFailurePlan: action.retreatOrFailurePlan,
        };
    }
    return {
        ...base,
        domain: 'commerce', actionType: action.actionType,
        resourceFlows: action.resourceFlows.map(flow => ({
            characterId: flow.characterId, resourceId: flow.resourceId, quantityDelta: flow.quantityDelta, role: flow.role,
        })),
        ...(action.counterpartyCharacterId === undefined ? {} : { counterpartyCharacterId: action.counterpartyCharacterId }),
        ...(action.marketSource === undefined ? {} : { marketSource: action.marketSource }),
        ...(action.serviceOrContractBasis === undefined ? {} : { serviceOrContractBasis: action.serviceOrContractBasis }),
        logistics: action.logistics,
        timing: {
            settlementChapters: action.timing.settlementChapters,
            ...(action.timing.deadlineChapter === undefined ? {} : { deadlineChapter: action.timing.deadlineChapter }),
        },
        risk: action.risk,
        ...(action.competitorCharacterId === undefined ? {} : { competitorCharacterId: action.competitorCharacterId }),
        ...(action.fundingResource === undefined ? {} : { fundingResource: {
            characterId: action.fundingResource.characterId, resourceId: action.fundingResource.resourceId,
        } }),
    };
};

/** Builds a new Writer-only allow-list and applies the centralized raw-secret boundary guard. */
export const buildWriterStrategicDirectives = (
    control: FullStoryControl,
    plan: InternalChapterPlan,
): readonly WriterStrategicDirective[] => {
    const directives = orderStrategicActions(plan.strategicActions ?? [], plan).map(writerDirectiveFromAction);
    assertModelBoundaryStringsSecretSafe(control, directives, 'writerStrategicDirectives');
    return directives;
};

const evidenceFields = (action: StrategicActionPlan) => {
    const evidenceRefs = collectActionEvidence(action)
        .map(reference => ({ reference, identity: evidenceIdentity(reference) }))
        .sort((left, right) => left.identity.localeCompare(right.identity))
        .map(entry => entry.reference);
    const resourceKeys = [...new Set(actionResourceEffects(action)
        .map(effect => resourceKey(effect.characterId, effect.resourceId)))].sort();
    return {
        ...(action.countermove === undefined ? {} : { opponentCharacterId: action.countermove.opponentCharacterId }),
        evidenceRefs,
        resourceKeys,
        actorKnowledgeFactIds: [...new Set(action.actorKnowledgeFactIds)].sort(),
        opponentKnowledgeFactIds: [...new Set(action.countermove?.opponentKnowledgeFactIds ?? [])].sort(),
    };
};

const actionDescriptor = (action: StrategicActionPlan): ValidatorStrategicActionDescriptor => {
    const directive = writerDirectiveFromAction(action);
    const privileged = evidenceFields(action);
    return { ...directive, ...privileged } as ValidatorStrategicActionDescriptor;
};

const strategicItemCount = (view: ValidatorStrategicView): number => view.actions.reduce((total, action) => {
    const contractItems = action.sceneIds.length + action.visibleConstraints.length
        + (action.domain === 'politics' ? action.dimensionStatuses.length + 1
            : action.domain === 'military' ? Number(action.movement !== undefined) + Number(action.logistics !== undefined)
                : action.resourceFlows.length + 1);
    return total + 1 + contractItems + action.evidenceRefs.length + action.resourceKeys.length
        + action.actorKnowledgeFactIds.length + action.opponentKnowledgeFactIds.length;
}, 0) + view.resourceEvidence.length + view.epistemicEvidence.length + view.deterministicIssues.length;

/** Bounded privileged view for Semantic Validator only. Repair and Writer projections never use it. */
export const buildValidatorStrategicView = (
    plan: InternalChapterPlan,
    context: PlannerContext,
    maximumItems = 256,
): ValidatorStrategicView => {
    if (!Number.isSafeInteger(maximumItems) || maximumItems < 0) throw new StrategicContextCapacityError('invalid validator strategic capacity');
    const actions = orderStrategicActions(plan.strategicActions ?? [], plan);
    const descriptors = actions.map(actionDescriptor);
    const deterministicIssues = validateStrategicActions(plan, context)
        .map(entry => ({ code: entry.code, path: entry.path, severity: entry.severity }));
    const resourceKeys = [...new Set(actions.flatMap(action => actionResourceEffects(action)
        .map(effect => resourceKey(effect.characterId, effect.resourceId))))].sort();
    const resourceEvidence = resourceKeys.map((key) => {
        const [characterId, resourceId] = key.split('\u0000');
        const quantity = resourceFor(context, characterId, resourceId)?.quantity;
        return {
            characterId, resourceId,
            ...(typeof quantity === 'number' && Number.isFinite(quantity) ? { quantity } : {}),
        };
    });
    const epistemicKeys = [...new Set(actions.flatMap((action) => {
        const opponent = action.countermove;
        return [
            ...action.actorKnowledgeFactIds.map(factId => `${action.actorCharacterId}\u0000${factId}`),
            ...(opponent === undefined ? [] : opponent.opponentKnowledgeFactIds
                .map(factId => `${opponent.opponentCharacterId}\u0000${factId}`)),
        ];
    }))].sort();
    const epistemicEvidence = epistemicKeys.map((key) => {
        const [characterId, factId] = key.split('\u0000');
        return { characterId, factId };
    });
    const view: ValidatorStrategicView = {
        kind: 'validator-strategic-view', chapterNumber: context.targetChapter,
        actions: descriptors, deterministicIssues, resourceEvidence, epistemicEvidence,
    };
    if (strategicItemCount(view) > maximumItems) throw new StrategicContextCapacityError('complete validator strategic evidence exceeds capacity');
    return view;
};

const parseEvidenceRef = (value: unknown, path: string): StrategicEvidenceRef => {
    const source = record(value, path);
    if (source.type === 'fact' || source.type === 'relationship' || source.type === 'canon-rule') {
        strictKeys(source, ['type', 'id'], path);
        return { type: source.type, id: nonEmptyText(source.id, `${path}.id`) };
    }
    if (source.type === 'knowledge') {
        strictKeys(source, ['type', 'characterId', 'factId'], path);
        return {
            type: 'knowledge',
            characterId: nonEmptyText(source.characterId, `${path}.characterId`),
            factId: nonEmptyText(source.factId, `${path}.factId`),
        };
    }
    if (source.type === 'resource') {
        strictKeys(source, ['type', 'characterId', 'resourceId'], path);
        return {
            type: 'resource',
            characterId: nonEmptyText(source.characterId, `${path}.characterId`),
            resourceId: nonEmptyText(source.resourceId, `${path}.resourceId`),
        };
    }
    if (source.type === 'character-status') {
        strictKeys(source, ['type', 'characterId', 'value'], path);
        return {
            type: 'character-status',
            characterId: nonEmptyText(source.characterId, `${path}.characterId`),
            value: nonEmptyText(source.value, `${path}.value`),
        };
    }
    fail(`${path}.type`, 'is unsupported');
};

const parseValidatorAction = (
    value: unknown,
    path: string,
    context: PlannerContext,
): ValidatorStrategicActionDescriptor => {
    const source = record(value, path);
    const directive = parseWriterDirectiveRecord(source, path, true);
    const evidenceValue = Array.isArray(source.evidenceRefs)
        ? source.evidenceRefs : fail(`${path}.evidenceRefs`, 'must be an array');
    const evidenceRefs = evidenceValue.map((entry, index) => parseEvidenceRef(entry, `${path}.evidenceRefs.${index}`));
    const evidenceIdentities = evidenceRefs.map(evidenceIdentity);
    if (new Set(evidenceIdentities).size !== evidenceIdentities.length) fail(`${path}.evidenceRefs`, 'must not contain duplicate evidence identities');
    evidenceRefs.forEach((reference, index) => {
        if (validateEvidenceReference(reference, context, `${path}.evidenceRefs.${index}`).length > 0) {
            fail(`${path}.evidenceRefs.${index}`, 'does not resolve in the target context');
        }
    });
    const resourceKeys = stringArray(source.resourceKeys, `${path}.resourceKeys`, { unique: true });
    resourceKeys.forEach((key, index) => {
        const parts = key.split('\u0000');
        if (parts.length !== 2 || !parts[0] || !parts[1] || resourceFor(context, parts[0], parts[1]) === undefined) {
            fail(`${path}.resourceKeys.${index}`, 'does not resolve in the target context');
        }
    });
    const actorKnowledgeFactIds = stringArray(source.actorKnowledgeFactIds, `${path}.actorKnowledgeFactIds`, { unique: true });
    actorKnowledgeFactIds.forEach((factId, index) => {
        if (!strategicCharacterKnowsFact(context, directive.actorCharacterId, factId)) {
            fail(`${path}.actorKnowledgeFactIds.${index}`, 'is not canonical actor knowledge');
        }
    });
    const opponentCharacterId = source.opponentCharacterId === undefined ? undefined
        : nonEmptyText(source.opponentCharacterId, `${path}.opponentCharacterId`);
    const opponentKnowledgeFactIds = stringArray(source.opponentKnowledgeFactIds, `${path}.opponentKnowledgeFactIds`, { unique: true });
    if ((opponentCharacterId === undefined && opponentKnowledgeFactIds.length > 0)
        || (opponentCharacterId !== undefined && !context.availableCharacters.some(character => character.id === opponentCharacterId))) {
        fail(`${path}.opponentCharacterId`, 'does not identify an available opponent');
    }
    opponentKnowledgeFactIds.forEach((factId, index) => {
        if (opponentCharacterId === undefined || !strategicCharacterKnowsFact(context, opponentCharacterId, factId)) {
            fail(`${path}.opponentKnowledgeFactIds.${index}`, 'is not canonical opponent knowledge');
        }
    });
    if (!context.availableCharacters.some(character => character.id === directive.actorCharacterId)) {
        fail(`${path}.actorCharacterId`, 'does not identify an available actor');
    }
    return {
        ...directive,
        ...(opponentCharacterId === undefined ? {} : { opponentCharacterId }),
        evidenceRefs, resourceKeys, actorKnowledgeFactIds, opponentKnowledgeFactIds,
    } as ValidatorStrategicActionDescriptor;
};

/** Strict runtime allow-list for supplied privileged context. Every nested field is reconstructed. */
export const parseValidatorStrategicView = (
    value: unknown,
    targetChapter: number,
    maximumItems: number,
    context: PlannerContext,
): ValidatorStrategicView => {
    if (!Number.isSafeInteger(maximumItems) || maximumItems < 0) throw new StrategicContextCapacityError('invalid validator strategic capacity');
    const source = record(value, 'strategicView');
    strictKeys(source, ['kind', 'chapterNumber', 'actions', 'deterministicIssues', 'resourceEvidence', 'epistemicEvidence'], 'strategicView');
    if (source.kind !== 'validator-strategic-view' || source.chapterNumber !== targetChapter) fail('strategicView', 'target identity mismatch');
    const actionValues = Array.isArray(source.actions) ? source.actions : fail('strategicView.actions', 'must be an array');
    const actions = actionValues.map((entry, index) => parseValidatorAction(entry, `strategicView.actions.${index}`, context));
    if (new Set(actions.map(action => action.id)).size !== actions.length) fail('strategicView.actions', 'must not contain duplicate action IDs');

    const issueValues = Array.isArray(source.deterministicIssues)
        ? source.deterministicIssues : fail('strategicView.deterministicIssues', 'must be an array');
    const deterministicIssues = issueValues.map((entry, index) => {
        const path = `strategicView.deterministicIssues.${index}`;
        const issue = record(entry, path);
        strictKeys(issue, ['code', 'path', 'severity'], path);
        if (!STRATEGIC_ISSUE_CODES.includes(issue.code as StrategicIssueCode)) fail(`${path}.code`, 'is not owned by the strategic validator');
        if (issue.severity !== 'error') fail(`${path}.severity`, 'must be error');
        return { code: issue.code as StrategicIssueCode, path: nonEmptyText(issue.path, `${path}.path`), severity: 'error' as const };
    });

    const resourceValues = Array.isArray(source.resourceEvidence)
        ? source.resourceEvidence : fail('strategicView.resourceEvidence', 'must be an array');
    const resourceEvidence = resourceValues.map((entry, index) => {
        const path = `strategicView.resourceEvidence.${index}`;
        const evidence = record(entry, path);
        strictKeys(evidence, ['characterId', 'resourceId', 'quantity'], path);
        const characterId = nonEmptyText(evidence.characterId, `${path}.characterId`);
        const resourceId = nonEmptyText(evidence.resourceId, `${path}.resourceId`);
        const canonical = resourceFor(context, characterId, resourceId);
        if (canonical === undefined) fail(path, 'does not resolve in the target context');
        const quantity = evidence.quantity === undefined ? undefined : finiteNumber(evidence.quantity, `${path}.quantity`);
        if (quantity !== undefined && (typeof canonical.quantity !== 'number' || !Number.isFinite(canonical.quantity) || quantity !== canonical.quantity)) {
            fail(`${path}.quantity`, 'does not equal the current finite projected quantity');
        }
        return { characterId, resourceId, ...(quantity === undefined ? {} : { quantity }) };
    });
    const resourceIdentities = resourceEvidence.map(entry => resourceKey(entry.characterId, entry.resourceId));
    if (new Set(resourceIdentities).size !== resourceIdentities.length) fail('strategicView.resourceEvidence', 'must not contain duplicate resource keys');

    const epistemicValues = Array.isArray(source.epistemicEvidence)
        ? source.epistemicEvidence : fail('strategicView.epistemicEvidence', 'must be an array');
    const epistemicEvidence = epistemicValues.map((entry, index) => {
        const path = `strategicView.epistemicEvidence.${index}`;
        const evidence = record(entry, path);
        strictKeys(evidence, ['characterId', 'factId'], path);
        const characterId = nonEmptyText(evidence.characterId, `${path}.characterId`);
        const factId = nonEmptyText(evidence.factId, `${path}.factId`);
        if (!strategicCharacterKnowsFact(context, characterId, factId)) fail(path, 'is not canonical character knowledge');
        return { characterId, factId };
    });
    const epistemicIdentities = epistemicEvidence.map(entry => `${entry.characterId}\u0000${entry.factId}`);
    if (new Set(epistemicIdentities).size !== epistemicIdentities.length) fail('strategicView.epistemicEvidence', 'must not contain duplicate entries');

    const parsed: ValidatorStrategicView = {
        kind: 'validator-strategic-view', chapterNumber: targetChapter,
        actions, deterministicIssues, resourceEvidence, epistemicEvidence,
    };
    if (strategicItemCount(parsed) > maximumItems) throw new StrategicContextCapacityError('validator strategic view exceeds capacity');
    return parsed;
};

export const projectValidatorActionToWriterDirective = (
    action: ValidatorStrategicActionDescriptor,
): WriterStrategicDirective => {
    const source: Record<string, unknown> = {};
    const directive = action as WriterStrategicDirective;
    Object.entries(directive).forEach(([key, value]) => {
        if (!validatorEvidenceKeys.includes(key as typeof validatorEvidenceKeys[number])) source[key] = value;
    });
    return parseWriterDirectiveRecord(source, 'validatorStrategicActionProjection', false);
};

export const writerStrategicDirectiveMatchesValidatorAction = (
    directive: WriterStrategicDirective,
    action: ValidatorStrategicActionDescriptor,
): boolean => JSON.stringify(directive) === JSON.stringify(projectValidatorActionToWriterDirective(action));

export const strategicViewIssueSummary = (
    issues: readonly PlanValidationIssue[],
): readonly Pick<PlanValidationIssue, 'code' | 'path' | 'severity'>[] =>
    issues.map(issue => ({ code: issue.code, path: issue.path, severity: issue.severity }));
