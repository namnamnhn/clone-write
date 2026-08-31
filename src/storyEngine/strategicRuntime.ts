import type { PlanValidationIssue } from './plannerTypes';
import {
    COMMERCE_ACTION_TYPES,
    COMMERCE_FLOW_ROLES,
    CommerceActionPlan,
    CommerceResourceFlow,
    MILITARY_OPERATION_TYPES,
    MILITARY_READINESS_DIMENSIONS,
    MilitaryActionPlan,
    MilitaryLogisticsPlan,
    MilitaryMovementPlan,
    MilitaryReadinessAssessment,
    POLITICAL_DIMENSIONS,
    PoliticalActionPlan,
    PoliticalDimensionAssessment,
    STRATEGIC_ASSESSMENT_STATUSES,
    StrategicActionPlan,
    StrategicActionBase,
    StrategicCountermove,
    StrategicEvidenceRef,
    StrategicRelationshipEffect,
    StrategicResourceEffect,
    WriterVisibleCounterplay,
} from './strategicTypes';
import { evidenceIdentity } from './strategicEvidence';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const invalid = (issues: PlanValidationIssue[], path: string, message: string): void => {
    issues.push({ code: 'INVALID_STRATEGIC_ACTION', path, message, severity: 'error' });
};

const strictKeys = (value: Record<string, unknown>, keys: readonly string[], path: string, issues: PlanValidationIssue[]): void => {
    const allowed = new Set(keys);
    Object.keys(value).forEach((key) => {
        if (!allowed.has(key)) invalid(issues, `${path}.${key}`, 'unknown strategic field');
    });
};

const text = (value: unknown, path: string, issues: PlanValidationIssue[]): string | undefined => {
    if (!isText(value)) { invalid(issues, path, 'must be a non-empty string'); return undefined; }
    return value;
};

const textArray = (
    value: unknown,
    path: string,
    issues: PlanValidationIssue[],
    allowEmpty = true,
): readonly string[] | undefined => {
    if (!Array.isArray(value) || !value.every(isText) || (!allowEmpty && value.length === 0)) {
        invalid(issues, path, allowEmpty ? 'must be an array of non-empty strings' : 'must be a non-empty array of non-empty strings');
        return undefined;
    }
    if (new Set(value).size !== value.length) invalid(issues, path, 'must not contain duplicates');
    return value.map(entry => entry);
};

const parseEvidence = (value: unknown, path: string, issues: PlanValidationIssue[]): StrategicEvidenceRef | undefined => {
    if (!isRecord(value) || !isText(value.type)) { invalid(issues, path, 'must be a typed evidence reference'); return undefined; }
    if (value.type === 'fact' || value.type === 'relationship' || value.type === 'canon-rule') {
        strictKeys(value, ['type', 'id'], path, issues);
        const id = text(value.id, `${path}.id`, issues);
        return id ? { type: value.type, id } : undefined;
    }
    if (value.type === 'knowledge') {
        strictKeys(value, ['type', 'characterId', 'factId'], path, issues);
        const characterId = text(value.characterId, `${path}.characterId`, issues);
        const factId = text(value.factId, `${path}.factId`, issues);
        return characterId && factId ? { type: 'knowledge', characterId, factId } : undefined;
    }
    if (value.type === 'resource') {
        strictKeys(value, ['type', 'characterId', 'resourceId'], path, issues);
        const characterId = text(value.characterId, `${path}.characterId`, issues);
        const resourceId = text(value.resourceId, `${path}.resourceId`, issues);
        return characterId && resourceId ? { type: 'resource', characterId, resourceId } : undefined;
    }
    if (value.type === 'character-status') {
        strictKeys(value, ['type', 'characterId', 'value'], path, issues);
        const characterId = text(value.characterId, `${path}.characterId`, issues);
        const statusValue = text(value.value, `${path}.value`, issues);
        return characterId && statusValue ? { type: 'character-status', characterId, value: statusValue } : undefined;
    }
    invalid(issues, `${path}.type`, 'unsupported strategic evidence type');
    return undefined;
};

const parseEvidenceArray = (value: unknown, path: string, issues: PlanValidationIssue[]): readonly StrategicEvidenceRef[] | undefined => {
    if (!Array.isArray(value)) { invalid(issues, path, 'must be an evidence-reference array'); return undefined; }
    const result = value.map((entry, index) => parseEvidence(entry, `${path}.${index}`, issues));
    if (result.some(entry => entry === undefined)) return undefined;
    const identities = (result as readonly StrategicEvidenceRef[]).map(evidenceIdentity);
    if (new Set(identities).size !== identities.length) invalid(issues, path, 'must not contain duplicate evidence references');
    return result as readonly StrategicEvidenceRef[];
};

const parseResourceEffect = (value: unknown, path: string, issues: PlanValidationIssue[]): StrategicResourceEffect | undefined => {
    if (!isRecord(value)) { invalid(issues, path, 'must be a resource effect'); return undefined; }
    strictKeys(value, ['characterId', 'resourceId', 'quantityDelta'], path, issues);
    const characterId = text(value.characterId, `${path}.characterId`, issues);
    const resourceId = text(value.resourceId, `${path}.resourceId`, issues);
    if (!isFiniteNumber(value.quantityDelta)) invalid(issues, `${path}.quantityDelta`, 'must be a finite number');
    return characterId && resourceId && isFiniteNumber(value.quantityDelta)
        ? { characterId, resourceId, quantityDelta: value.quantityDelta } : undefined;
};

const parseResourceEffects = (value: unknown, path: string, issues: PlanValidationIssue[]): readonly StrategicResourceEffect[] | undefined => {
    if (!Array.isArray(value)) { invalid(issues, path, 'must be a resource-effect array'); return undefined; }
    const result = value.map((entry, index) => parseResourceEffect(entry, `${path}.${index}`, issues));
    return result.some(entry => entry === undefined) ? undefined : result as readonly StrategicResourceEffect[];
};

const parseRelationshipEffects = (value: unknown, path: string, issues: PlanValidationIssue[]): readonly StrategicRelationshipEffect[] | undefined => {
    if (!Array.isArray(value)) { invalid(issues, path, 'must be a relationship-effect array'); return undefined; }
    const result = value.map((entry, index) => {
        const entryPath = `${path}.${index}`;
        if (!isRecord(entry)) { invalid(issues, entryPath, 'must be a relationship effect'); return undefined; }
        strictKeys(entry, ['relationshipId', 'expectedState'], entryPath, issues);
        const relationshipId = text(entry.relationshipId, `${entryPath}.relationshipId`, issues);
        const expectedState = text(entry.expectedState, `${entryPath}.expectedState`, issues);
        return relationshipId && expectedState ? { relationshipId, expectedState } : undefined;
    });
    return result.some(entry => entry === undefined) ? undefined : result as readonly StrategicRelationshipEffect[];
};

const parseCountermove = (value: unknown, path: string, issues: PlanValidationIssue[]): StrategicCountermove | undefined => {
    if (value === undefined) return undefined;
    if (!isRecord(value)) { invalid(issues, path, 'must be a structured countermove'); return undefined; }
    strictKeys(value, ['opponentCharacterId', 'opponentKnowledgeFactIds', 'opponentBeliefClaims', 'action', 'uncertainty', 'costOrTradeoff'], path, issues);
    const opponentCharacterId = text(value.opponentCharacterId, `${path}.opponentCharacterId`, issues);
    const opponentKnowledgeFactIds = textArray(value.opponentKnowledgeFactIds, `${path}.opponentKnowledgeFactIds`, issues);
    const opponentBeliefClaims = textArray(value.opponentBeliefClaims, `${path}.opponentBeliefClaims`, issues);
    const action = text(value.action, `${path}.action`, issues);
    const uncertainty = text(value.uncertainty, `${path}.uncertainty`, issues);
    const costOrTradeoff = text(value.costOrTradeoff, `${path}.costOrTradeoff`, issues);
    return opponentCharacterId && opponentKnowledgeFactIds && opponentBeliefClaims && action && uncertainty && costOrTradeoff
        ? { opponentCharacterId, opponentKnowledgeFactIds, opponentBeliefClaims, action, uncertainty, costOrTradeoff }
        : undefined;
};

const parseWriterVisibleCounterplay = (
    value: unknown,
    path: string,
    issues: PlanValidationIssue[],
): WriterVisibleCounterplay | undefined => {
    if (value === undefined) return undefined;
    if (!isRecord(value)) { invalid(issues, path, 'must be a writer-visible counterplay contract'); return undefined; }
    strictKeys(value, ['opponentCharacterId', 'action', 'uncertainty', 'costOrTradeoff'], path, issues);
    const opponentCharacterId = text(value.opponentCharacterId, `${path}.opponentCharacterId`, issues);
    const action = text(value.action, `${path}.action`, issues);
    const uncertainty = text(value.uncertainty, `${path}.uncertainty`, issues);
    const costOrTradeoff = text(value.costOrTradeoff, `${path}.costOrTradeoff`, issues);
    return opponentCharacterId && action && uncertainty && costOrTradeoff
        ? { opponentCharacterId, action, uncertainty, costOrTradeoff } : undefined;
};

interface ParsedCommon extends Omit<StrategicActionBase, 'domain'> {
    readonly domain: StrategicActionPlan['domain'];
}

const commonKeys = [
    'id', 'domain', 'sceneIds', 'importance', 'actorCharacterId', 'objective', 'uncertainty',
    'expectedCostOrTradeoff', 'writerVisibleConstraints', 'actorKnowledgeFactIds', 'relationshipEffects',
    'countermove', 'writerVisibleCounterplay', 'noCountermoveReason',
] as const;

const parseCommon = (value: Record<string, unknown>, path: string, issues: PlanValidationIssue[]): ParsedCommon | undefined => {
    const id = text(value.id, `${path}.id`, issues);
    const sceneIds = textArray(value.sceneIds, `${path}.sceneIds`, issues, false);
    const actorCharacterId = text(value.actorCharacterId, `${path}.actorCharacterId`, issues);
    const objective = text(value.objective, `${path}.objective`, issues);
    const uncertainty = text(value.uncertainty, `${path}.uncertainty`, issues);
    const expectedCostOrTradeoff = text(value.expectedCostOrTradeoff, `${path}.expectedCostOrTradeoff`, issues);
    const writerVisibleConstraints = textArray(value.writerVisibleConstraints, `${path}.writerVisibleConstraints`, issues);
    const actorKnowledgeFactIds = textArray(value.actorKnowledgeFactIds, `${path}.actorKnowledgeFactIds`, issues);
    const relationshipEffects = parseRelationshipEffects(value.relationshipEffects, `${path}.relationshipEffects`, issues);
    const countermove = parseCountermove(value.countermove, `${path}.countermove`, issues);
    const writerVisibleCounterplay = parseWriterVisibleCounterplay(
        value.writerVisibleCounterplay, `${path}.writerVisibleCounterplay`, issues,
    );
    const noCountermoveReason = value.noCountermoveReason === undefined ? undefined
        : text(value.noCountermoveReason, `${path}.noCountermoveReason`, issues);
    const domain = value.domain;
    if (domain !== 'politics' && domain !== 'military' && domain !== 'commerce') invalid(issues, `${path}.domain`, 'unsupported strategic domain');
    const importance = value.importance;
    if (importance !== 'minor' && importance !== 'major') invalid(issues, `${path}.importance`, 'must be minor or major');
    if (!id || !sceneIds || !actorCharacterId || !objective || !uncertainty || !expectedCostOrTradeoff
        || !writerVisibleConstraints || !actorKnowledgeFactIds || !relationshipEffects
        || (domain !== 'politics' && domain !== 'military' && domain !== 'commerce')
        || (importance !== 'minor' && importance !== 'major')
        || (value.countermove !== undefined && countermove === undefined)
        || (value.writerVisibleCounterplay !== undefined && writerVisibleCounterplay === undefined)
        || (value.noCountermoveReason !== undefined && noCountermoveReason === undefined)) return undefined;
    return {
        id, domain, sceneIds, importance, actorCharacterId, objective, uncertainty,
        expectedCostOrTradeoff, writerVisibleConstraints, actorKnowledgeFactIds, relationshipEffects,
        ...(countermove === undefined ? {} : { countermove }),
        ...(writerVisibleCounterplay === undefined ? {} : { writerVisibleCounterplay }),
        ...(noCountermoveReason === undefined ? {} : { noCountermoveReason }),
    };
};

const parsePolitical = (value: Record<string, unknown>, common: ParsedCommon, path: string, issues: PlanValidationIssue[]): PoliticalActionPlan | undefined => {
    strictKeys(value, [...commonKeys, 'dimensions', 'timing', 'resourceEffects'], path, issues);
    if (!Array.isArray(value.dimensions)) { invalid(issues, `${path}.dimensions`, 'must contain all political dimensions'); return undefined; }
    const dimensions = value.dimensions.map((entry, index): PoliticalDimensionAssessment | undefined => {
        const entryPath = `${path}.dimensions.${index}`;
        if (!isRecord(entry)) { invalid(issues, entryPath, 'must be a political dimension assessment'); return undefined; }
        strictKeys(entry, ['dimension', 'status', 'evidenceRefs'], entryPath, issues);
        if (!POLITICAL_DIMENSIONS.includes(entry.dimension as typeof POLITICAL_DIMENSIONS[number])) invalid(issues, `${entryPath}.dimension`, 'unsupported political dimension');
        if (!STRATEGIC_ASSESSMENT_STATUSES.includes(entry.status as typeof STRATEGIC_ASSESSMENT_STATUSES[number])) invalid(issues, `${entryPath}.status`, 'unsupported assessment status');
        const evidenceRefs = parseEvidenceArray(entry.evidenceRefs, `${entryPath}.evidenceRefs`, issues);
        if (!POLITICAL_DIMENSIONS.includes(entry.dimension as typeof POLITICAL_DIMENSIONS[number])
            || !STRATEGIC_ASSESSMENT_STATUSES.includes(entry.status as typeof STRATEGIC_ASSESSMENT_STATUSES[number]) || !evidenceRefs) return undefined;
        return { dimension: entry.dimension as PoliticalDimensionAssessment['dimension'], status: entry.status as PoliticalDimensionAssessment['status'], evidenceRefs };
    });
    if (dimensions.some(entry => entry === undefined)) return undefined;
    const dimensionNames = dimensions.map(entry => entry!.dimension);
    if (dimensionNames.length !== POLITICAL_DIMENSIONS.length || new Set(dimensionNames).size !== dimensionNames.length
        || POLITICAL_DIMENSIONS.some(dimension => !dimensionNames.includes(dimension))) {
        invalid(issues, `${path}.dimensions`, 'must contain each political dimension exactly once');
    }
    if (!isRecord(value.timing)) { invalid(issues, `${path}.timing`, 'must be political timing'); return undefined; }
    strictKeys(value.timing, ['earliestChapter', 'deadlineChapter', 'preparationChapters'], `${path}.timing`, issues);
    const preparationChapters = value.timing.preparationChapters;
    if (!Number.isSafeInteger(preparationChapters) || (preparationChapters as number) < 0) invalid(issues, `${path}.timing.preparationChapters`, 'must be a non-negative safe integer');
    for (const key of ['earliestChapter', 'deadlineChapter'] as const) {
        const entry = value.timing[key];
        if (entry !== undefined && (!Number.isSafeInteger(entry) || (entry as number) < 1)) invalid(issues, `${path}.timing.${key}`, 'must be a positive safe integer');
    }
    const resourceEffects = parseResourceEffects(value.resourceEffects, `${path}.resourceEffects`, issues);
    if (!resourceEffects || !Number.isSafeInteger(preparationChapters) || (preparationChapters as number) < 0) return undefined;
    return {
        ...common, domain: 'politics', dimensions: dimensions as readonly PoliticalDimensionAssessment[],
        timing: {
            ...(value.timing.earliestChapter === undefined ? {} : { earliestChapter: value.timing.earliestChapter as number }),
            ...(value.timing.deadlineChapter === undefined ? {} : { deadlineChapter: value.timing.deadlineChapter as number }),
            preparationChapters: preparationChapters as number,
        },
        resourceEffects,
    };
};

const parseResourceReference = (value: unknown, path: string, issues: PlanValidationIssue[]): { readonly characterId: string; readonly resourceId: string } | undefined => {
    if (!isRecord(value)) { invalid(issues, path, 'must be a resource reference'); return undefined; }
    strictKeys(value, ['characterId', 'resourceId'], path, issues);
    const characterId = text(value.characterId, `${path}.characterId`, issues);
    const resourceId = text(value.resourceId, `${path}.resourceId`, issues);
    return characterId && resourceId ? { characterId, resourceId } : undefined;
};

const parseMilitary = (value: Record<string, unknown>, common: ParsedCommon, path: string, issues: PlanValidationIssue[]): MilitaryActionPlan | undefined => {
    strictKeys(value, [...commonKeys, 'operationType', 'location', 'intelligenceFactIds', 'readiness', 'resourceEffects', 'logistics', 'movement', 'expectedLossOrCost', 'retreatOrFailurePlan'], path, issues);
    if (!MILITARY_OPERATION_TYPES.includes(value.operationType as typeof MILITARY_OPERATION_TYPES[number])) invalid(issues, `${path}.operationType`, 'unsupported military operation type');
    const location = text(value.location, `${path}.location`, issues);
    const intelligenceFactIds = textArray(value.intelligenceFactIds, `${path}.intelligenceFactIds`, issues);
    const resourceEffects = parseResourceEffects(value.resourceEffects, `${path}.resourceEffects`, issues);
    const expectedLossOrCost = text(value.expectedLossOrCost, `${path}.expectedLossOrCost`, issues);
    const retreatOrFailurePlan = text(value.retreatOrFailurePlan, `${path}.retreatOrFailurePlan`, issues);
    if (!Array.isArray(value.readiness)) { invalid(issues, `${path}.readiness`, 'must contain all military readiness dimensions'); return undefined; }
    const readiness = value.readiness.map((entry, index): MilitaryReadinessAssessment | undefined => {
        const entryPath = `${path}.readiness.${index}`;
        if (!isRecord(entry)) { invalid(issues, entryPath, 'must be a readiness assessment'); return undefined; }
        strictKeys(entry, ['dimension', 'status', 'evidenceRefs'], entryPath, issues);
        if (!MILITARY_READINESS_DIMENSIONS.includes(entry.dimension as typeof MILITARY_READINESS_DIMENSIONS[number])) invalid(issues, `${entryPath}.dimension`, 'unsupported readiness dimension');
        if (!STRATEGIC_ASSESSMENT_STATUSES.includes(entry.status as typeof STRATEGIC_ASSESSMENT_STATUSES[number])) invalid(issues, `${entryPath}.status`, 'unsupported assessment status');
        const evidenceRefs = parseEvidenceArray(entry.evidenceRefs, `${entryPath}.evidenceRefs`, issues);
        if (!MILITARY_READINESS_DIMENSIONS.includes(entry.dimension as typeof MILITARY_READINESS_DIMENSIONS[number])
            || !STRATEGIC_ASSESSMENT_STATUSES.includes(entry.status as typeof STRATEGIC_ASSESSMENT_STATUSES[number]) || !evidenceRefs) return undefined;
        return { dimension: entry.dimension as MilitaryReadinessAssessment['dimension'], status: entry.status as MilitaryReadinessAssessment['status'], evidenceRefs };
    });
    const readinessNames = readiness.filter((entry): entry is MilitaryReadinessAssessment => entry !== undefined).map(entry => entry.dimension);
    if (readinessNames.length !== MILITARY_READINESS_DIMENSIONS.length || new Set(readinessNames).size !== readinessNames.length
        || MILITARY_READINESS_DIMENSIONS.some(dimension => !readinessNames.includes(dimension))) invalid(issues, `${path}.readiness`, 'must contain each readiness dimension exactly once');

    let logistics: MilitaryLogisticsPlan | undefined;
    if (value.logistics !== undefined) {
        if (!isRecord(value.logistics)) invalid(issues, `${path}.logistics`, 'must be a logistics plan');
        else {
            strictKeys(value.logistics, ['supplyResource', 'expectedSupplyConsumption', 'mobilityResource', 'movementConstraint', 'operationalTimeChapters', 'resupplyOrFallback'], `${path}.logistics`, issues);
            const supplyResource = parseResourceReference(value.logistics.supplyResource, `${path}.logistics.supplyResource`, issues);
            const mobilityResource = value.logistics.mobilityResource === undefined ? undefined : parseResourceReference(value.logistics.mobilityResource, `${path}.logistics.mobilityResource`, issues);
            const movementConstraint = text(value.logistics.movementConstraint, `${path}.logistics.movementConstraint`, issues);
            const resupplyOrFallback = text(value.logistics.resupplyOrFallback, `${path}.logistics.resupplyOrFallback`, issues);
            const consumption = value.logistics.expectedSupplyConsumption;
            const time = value.logistics.operationalTimeChapters;
            if (consumption !== 'unknown' && !isFiniteNumber(consumption)) invalid(issues, `${path}.logistics.expectedSupplyConsumption`, 'must be finite or unknown');
            if (time !== 'unknown' && (!Number.isSafeInteger(time) || (time as number) < 0)) invalid(issues, `${path}.logistics.operationalTimeChapters`, 'must be a non-negative safe integer or unknown');
            if (supplyResource && movementConstraint && resupplyOrFallback
                && (value.logistics.mobilityResource === undefined || mobilityResource)
                && (consumption === 'unknown' || isFiniteNumber(consumption))
                && (time === 'unknown' || (Number.isSafeInteger(time) && (time as number) >= 0))) {
                logistics = { supplyResource, expectedSupplyConsumption: consumption as number | 'unknown', ...(mobilityResource ? { mobilityResource } : {}), movementConstraint, operationalTimeChapters: time as number | 'unknown', resupplyOrFallback };
            }
        }
    }
    let movement: MilitaryMovementPlan | undefined;
    if (value.movement !== undefined) {
        if (!isRecord(value.movement)) invalid(issues, `${path}.movement`, 'must be a movement plan');
        else {
            strictKeys(value.movement, ['fromLocation', 'toLocation', 'method', 'transitChapters'], `${path}.movement`, issues);
            const fromLocation = text(value.movement.fromLocation, `${path}.movement.fromLocation`, issues);
            const toLocation = text(value.movement.toLocation, `${path}.movement.toLocation`, issues);
            const method = text(value.movement.method, `${path}.movement.method`, issues);
            const transit = value.movement.transitChapters;
            if (transit !== 'unknown' && (!Number.isSafeInteger(transit) || (transit as number) < 0)) invalid(issues, `${path}.movement.transitChapters`, 'must be a non-negative safe integer or unknown');
            if (fromLocation && toLocation && method && (transit === 'unknown' || (Number.isSafeInteger(transit) && (transit as number) >= 0))) {
                movement = { fromLocation, toLocation, method, transitChapters: transit as number | 'unknown' };
            }
        }
    }
    if (!MILITARY_OPERATION_TYPES.includes(value.operationType as typeof MILITARY_OPERATION_TYPES[number]) || !location
        || !intelligenceFactIds || !resourceEffects || !expectedLossOrCost || !retreatOrFailurePlan
        || readiness.some(entry => entry === undefined) || (value.logistics !== undefined && !logistics)
        || (value.movement !== undefined && !movement)) return undefined;
    return {
        ...common, domain: 'military', operationType: value.operationType as MilitaryActionPlan['operationType'],
        location, intelligenceFactIds, readiness: readiness as readonly MilitaryReadinessAssessment[], resourceEffects,
        ...(logistics ? { logistics } : {}), ...(movement ? { movement } : {}), expectedLossOrCost, retreatOrFailurePlan,
    };
};

const parseCommerce = (value: Record<string, unknown>, common: ParsedCommon, path: string, issues: PlanValidationIssue[]): CommerceActionPlan | undefined => {
    strictKeys(value, [...commonKeys, 'actionType', 'resourceFlows', 'counterpartyCharacterId', 'marketSource', 'sourceEvidenceRefs', 'serviceOrContractBasis', 'logistics', 'timing', 'risk', 'competitorCharacterId', 'fundingResource'], path, issues);
    if (!COMMERCE_ACTION_TYPES.includes(value.actionType as typeof COMMERCE_ACTION_TYPES[number])) invalid(issues, `${path}.actionType`, 'unsupported commerce action type');
    if (!Array.isArray(value.resourceFlows)) { invalid(issues, `${path}.resourceFlows`, 'must be a commercial flow array'); return undefined; }
    const resourceFlows = value.resourceFlows.map((entry, index): CommerceResourceFlow | undefined => {
        const entryPath = `${path}.resourceFlows.${index}`;
        if (!isRecord(entry)) { invalid(issues, entryPath, 'must be a commercial resource flow'); return undefined; }
        strictKeys(entry, ['characterId', 'resourceId', 'quantityDelta', 'role'], entryPath, issues);
        const characterId = text(entry.characterId, `${entryPath}.characterId`, issues);
        const resourceId = text(entry.resourceId, `${entryPath}.resourceId`, issues);
        if (!isFiniteNumber(entry.quantityDelta)) invalid(issues, `${entryPath}.quantityDelta`, 'must be a finite number');
        if (!COMMERCE_FLOW_ROLES.includes(entry.role as typeof COMMERCE_FLOW_ROLES[number])) invalid(issues, `${entryPath}.role`, 'unsupported commerce flow role');
        return characterId && resourceId && isFiniteNumber(entry.quantityDelta)
            && COMMERCE_FLOW_ROLES.includes(entry.role as typeof COMMERCE_FLOW_ROLES[number])
            ? { characterId, resourceId, quantityDelta: entry.quantityDelta, role: entry.role as CommerceResourceFlow['role'] } : undefined;
    });
    const sourceEvidenceRefs = parseEvidenceArray(value.sourceEvidenceRefs, `${path}.sourceEvidenceRefs`, issues);
    const counterpartyCharacterId = value.counterpartyCharacterId === undefined ? undefined : text(value.counterpartyCharacterId, `${path}.counterpartyCharacterId`, issues);
    const marketSource = value.marketSource === undefined ? undefined : text(value.marketSource, `${path}.marketSource`, issues);
    const serviceOrContractBasis = value.serviceOrContractBasis === undefined ? undefined : text(value.serviceOrContractBasis, `${path}.serviceOrContractBasis`, issues);
    const logistics = text(value.logistics, `${path}.logistics`, issues);
    const risk = text(value.risk, `${path}.risk`, issues);
    const competitorCharacterId = value.competitorCharacterId === undefined ? undefined : text(value.competitorCharacterId, `${path}.competitorCharacterId`, issues);
    const fundingResource = value.fundingResource === undefined ? undefined : parseResourceReference(value.fundingResource, `${path}.fundingResource`, issues);
    if (!isRecord(value.timing)) { invalid(issues, `${path}.timing`, 'must be commercial timing'); return undefined; }
    strictKeys(value.timing, ['settlementChapters', 'deadlineChapter'], `${path}.timing`, issues);
    const settlement = value.timing.settlementChapters;
    if (settlement !== 'unknown' && (!Number.isSafeInteger(settlement) || (settlement as number) < 0)) invalid(issues, `${path}.timing.settlementChapters`, 'must be a non-negative safe integer or unknown');
    const deadline = value.timing.deadlineChapter;
    if (deadline !== undefined && (!Number.isSafeInteger(deadline) || (deadline as number) < 1)) invalid(issues, `${path}.timing.deadlineChapter`, 'must be a positive safe integer');
    if (!COMMERCE_ACTION_TYPES.includes(value.actionType as typeof COMMERCE_ACTION_TYPES[number])
        || resourceFlows.some(entry => entry === undefined) || !sourceEvidenceRefs || !logistics || !risk
        || (value.counterpartyCharacterId !== undefined && !counterpartyCharacterId)
        || (value.marketSource !== undefined && !marketSource) || (value.serviceOrContractBasis !== undefined && !serviceOrContractBasis)
        || (value.competitorCharacterId !== undefined && !competitorCharacterId)
        || (value.fundingResource !== undefined && !fundingResource)
        || (settlement !== 'unknown' && (!Number.isSafeInteger(settlement) || (settlement as number) < 0))
        || (deadline !== undefined && (!Number.isSafeInteger(deadline) || (deadline as number) < 1))) return undefined;
    return {
        ...common, domain: 'commerce', actionType: value.actionType as CommerceActionPlan['actionType'],
        resourceFlows: resourceFlows as readonly CommerceResourceFlow[],
        ...(counterpartyCharacterId ? { counterpartyCharacterId } : {}), ...(marketSource ? { marketSource } : {}),
        sourceEvidenceRefs, ...(serviceOrContractBasis ? { serviceOrContractBasis } : {}), logistics,
        timing: { settlementChapters: settlement as number | 'unknown', ...(deadline === undefined ? {} : { deadlineChapter: deadline as number }) },
        risk, ...(competitorCharacterId ? { competitorCharacterId } : {}), ...(fundingResource ? { fundingResource } : {}),
    };
};

/** Strict parser for planner-controlled strategicActions; omission alone is legacy-compatible. */
export const parseStrategicActions = (
    value: unknown,
    path: string,
    issues: PlanValidationIssue[],
): readonly StrategicActionPlan[] | undefined => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) { invalid(issues, path, 'must be an array when supplied'); return undefined; }
    const actions = value.map((entry, index): StrategicActionPlan | undefined => {
        const entryPath = `${path}.${index}`;
        if (!isRecord(entry)) { invalid(issues, entryPath, 'must be a strategic action object'); return undefined; }
        const common = parseCommon(entry, entryPath, issues);
        if (!common) return undefined;
        if (common.domain === 'politics') return parsePolitical(entry, common, entryPath, issues);
        if (common.domain === 'military') return parseMilitary(entry, common, entryPath, issues);
        return parseCommerce(entry, common, entryPath, issues);
    });
    const actionIds = actions.filter((entry): entry is StrategicActionPlan => entry !== undefined).map(entry => entry.id);
    if (new Set(actionIds).size !== actionIds.length) invalid(issues, path, 'strategic action IDs must be unique');
    return actions.some(entry => entry === undefined) ? undefined : actions as readonly StrategicActionPlan[];
};
