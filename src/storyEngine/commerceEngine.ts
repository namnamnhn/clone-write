import type { PlanValidationIssue, PlannerContext } from './plannerTypes';
import {
    isMeaningfulText,
    resourceFor,
    strategicIssue,
} from './strategicEvidence';
import type { CommerceActionPlan, CommerceResourceFlow } from './strategicTypes';

const sumRole = (flows: readonly CommerceResourceFlow[], role: CommerceResourceFlow['role']): number =>
    flows.filter(flow => flow.role === role).reduce((total, flow) => total + flow.quantityDelta, 0);

const hasDeclaredSource = (action: CommerceActionPlan): boolean =>
    action.counterpartyCharacterId !== undefined || action.marketSource !== undefined;

/** Pure accounting/competition checks. It never prices a market or selects a commercial winner. */
export const validateCommerceAction = (
    action: CommerceActionPlan,
    context: PlannerContext,
    path: string,
): readonly PlanValidationIssue[] => {
    const issues: PlanValidationIssue[] = [];
    const availableCharacters = new Set(context.availableCharacters.map(character => character.id));
    if (action.counterpartyCharacterId !== undefined && !availableCharacters.has(action.counterpartyCharacterId)) {
        issues.push(strategicIssue('COMMERCE_COUNTERPARTY_VIOLATION', `${path}.counterpartyCharacterId`, 'commercial counterparty is unavailable at the target chapter'));
    }
    if (action.competitorCharacterId !== undefined && !availableCharacters.has(action.competitorCharacterId)) {
        issues.push(strategicIssue('COMMERCE_COUNTERPARTY_VIOLATION', `${path}.competitorCharacterId`, 'commercial competitor is unavailable at the target chapter'));
    }
    if (action.fundingResource !== undefined
        && !resourceFor(context, action.fundingResource.characterId, action.fundingResource.resourceId)) {
        issues.push(strategicIssue('COMMERCE_RESOURCE_VIOLATION', `${path}.fundingResource`, 'commercial funding must reference canonical current capacity'));
    }
    action.resourceFlows.forEach((flow, index) => {
        if (!Number.isFinite(flow.quantityDelta) || !resourceFor(context, flow.characterId, flow.resourceId)) {
            issues.push(strategicIssue('COMMERCE_RESOURCE_VIOLATION', `${path}.resourceFlows.${index}`, 'commercial flow must be finite and reference a canonical current resource'));
        }
    });
    const actorFlows = action.resourceFlows.filter(flow => flow.characterId === action.actorCharacterId);
    const cash = sumRole(actorFlows, 'cash');
    const inventory = sumRole(actorFlows, 'inventory');
    const debt = sumRole(actorFlows, 'debt');
    const credit = sumRole(actorFlows, 'credit');
    const barterOut = actorFlows.some(flow => flow.role === 'barter' && flow.quantityDelta < 0);
    const anyPositiveCash = action.resourceFlows.some(flow => flow.role === 'cash' && flow.quantityDelta > 0);

    if (anyPositiveCash && (!hasDeclaredSource(action) || action.sourceEvidenceRefs.length === 0)) {
        issues.push(strategicIssue('COMMERCE_COUNTERPARTY_VIOLATION', path, 'positive cash flow requires an explicit source and canonical evidence'));
    }
    if (action.actionType === 'purchase' && inventory > 0
        && cash >= 0 && debt <= 0 && credit <= 0 && !barterOut) {
        issues.push(strategicIssue('COMMERCE_FINANCING_VIOLATION', `${path}.resourceFlows`, 'purchase acquisition requires cash payment, debt/credit liability, or barter'));
    }
    if (action.actionType === 'sale' && cash > 0) {
        if (!hasDeclaredSource(action)) {
            issues.push(strategicIssue('COMMERCE_COUNTERPARTY_VIOLATION', path, 'sale requires a counterparty or market source'));
        }
        if (inventory >= 0 && action.serviceOrContractBasis === undefined) {
            issues.push(strategicIssue('COMMERCE_FLOW_VIOLATION', `${path}.resourceFlows`, 'sale requires transferred inventory or an explicit service/contract basis'));
        }
    }
    if (action.actionType === 'loan' && cash > 0 && debt <= 0 && credit <= 0) {
        issues.push(strategicIssue('COMMERCE_FINANCING_VIOLATION', `${path}.resourceFlows`, 'loan proceeds require an explicit debt or credit liability'));
    }
    if (action.actionType === 'repayment' && (cash >= 0 || (debt >= 0 && credit >= 0))) {
        issues.push(strategicIssue('COMMERCE_FINANCING_VIOLATION', `${path}.resourceFlows`, 'repayment must reduce cash and a debt or credit liability'));
    }
    if (action.actionType === 'price-war') {
        const funding = action.fundingResource;
        const fundingSpent = funding !== undefined && action.resourceFlows.some(flow =>
            flow.characterId === funding.characterId && flow.resourceId === funding.resourceId && flow.quantityDelta < 0);
        if (!funding || !fundingSpent || !action.competitorCharacterId
            || !isMeaningfulText(action.expectedCostOrTradeoff) || action.countermove === undefined) {
            issues.push(strategicIssue('COMMERCE_FINANCING_VIOLATION', path, 'price war requires spent funding, a competitor, cost/tradeoff, and structured counterplay'));
        }
    }
    if (action.importance === 'major' && action.countermove === undefined) {
        issues.push(strategicIssue('COMMERCE_COUNTERMOVE_MISSING', `${path}.countermove`, 'major commercial action requires structured competitor response'));
    }
    if (action.timing.deadlineChapter !== undefined && action.timing.deadlineChapter < context.targetChapter) {
        issues.push(strategicIssue('COMMERCE_FLOW_VIOLATION', `${path}.timing.deadlineChapter`, 'commercial deadline cannot precede the target chapter'));
    }
    if (action.timing.settlementChapters !== 'unknown'
        && (!Number.isSafeInteger(action.timing.settlementChapters) || action.timing.settlementChapters < 0)) {
        issues.push(strategicIssue('COMMERCE_FLOW_VIOLATION', `${path}.timing.settlementChapters`, 'settlement time must be a non-negative safe integer or unknown'));
    }
    return issues;
};
