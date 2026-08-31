import type { ExpectedResourceDelta, WriterPlanScene } from './plannerTypes';
import { isMeaningfulText } from './strategicEvidence';
import type {
    WriterCommerceDirective,
    WriterMilitaryDirective,
    WriterStrategicDirective,
} from './strategicTypes';
import type { WriterSafeContext } from './types';

export class WriterStrategicValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WriterStrategicValidationError';
    }
}

export interface WriterStrategicValidationInput {
    readonly targetChapter: number;
    readonly participantIds: readonly string[];
    readonly scenes: readonly WriterPlanScene[];
    readonly expectedResourceDeltas: readonly ExpectedResourceDelta[];
    readonly directives: readonly WriterStrategicDirective[];
}

const fail = (message: string): never => {
    throw new WriterStrategicValidationError(message);
};

const majorOffensiveTypes = new Set<WriterMilitaryDirective['operationType']>([
    'raid', 'siege', 'assault', 'ambush', 'blockade',
]);

const firstSceneOrder = (
    directive: WriterStrategicDirective,
    scenes: readonly WriterPlanScene[],
): number => Math.min(...directive.sceneIds.map(id =>
    scenes.find(scene => scene.id === id)?.order ?? Number.MAX_SAFE_INTEGER));

const roleTotal = (
    directive: WriterCommerceDirective,
    role: WriterCommerceDirective['resourceFlows'][number]['role'],
): number => directive.resourceFlows
    .filter(flow => flow.characterId === directive.actorCharacterId && flow.role === role)
    .reduce((total, flow) => total + flow.quantityDelta, 0);

const validateCounterplay = (
    directive: WriterStrategicDirective,
    major: boolean,
    availableCharacters: ReadonlySet<string>,
    participants: ReadonlySet<string>,
): void => {
    const counterplay = directive.writerVisibleCounterplay;
    if (major && counterplay === undefined) fail(`strategic directive ${directive.id} requires writer-visible counterplay`);
    if (counterplay === undefined) return;
    if (!availableCharacters.has(counterplay.opponentCharacterId) || !participants.has(counterplay.opponentCharacterId)) {
        fail(`strategic directive ${directive.id} counterplay opponent is unavailable or undeclared`);
    }
    if (!isMeaningfulText(counterplay.action) || !isMeaningfulText(counterplay.uncertainty)
        || !isMeaningfulText(counterplay.costOrTradeoff)) {
        fail(`strategic directive ${directive.id} counterplay must be meaningful`);
    }
};

const resolvedLocationBefore = (
    action: WriterMilitaryDirective,
    directives: readonly WriterStrategicDirective[],
    scenes: readonly WriterPlanScene[],
    canonicalLocation: string,
): string => directives
    .map((candidate, index) => ({ candidate, index }))
    .filter((entry): entry is { readonly candidate: WriterMilitaryDirective; readonly index: number } =>
        entry.candidate.domain === 'military'
        && entry.candidate.id !== action.id
        && entry.candidate.actorCharacterId === action.actorCharacterId
        && firstSceneOrder(entry.candidate, scenes) < firstSceneOrder(action, scenes))
    .sort((left, right) => firstSceneOrder(left.candidate, scenes) - firstSceneOrder(right.candidate, scenes)
        || left.index - right.index)
    .reduce((location, entry) => {
        const movement = entry.candidate.movement;
        return movement?.transitChapters === 0 && movement.fromLocation === location
            ? movement.toLocation : location;
    }, canonicalLocation);

/**
 * Revalidates every deterministic strategic invariant expressible with Writer-safe data.
 * It is pure and never receives privileged evidence, opponent knowledge, or mutable StoryState.
 */
export const validateWriterStrategicDirectives = (
    input: WriterStrategicValidationInput,
    safe: WriterSafeContext,
): void => {
    const participants = new Set(input.participantIds);
    const availableCharacters = new Set(safe.characters.map(character => character.id));
    const resourceExists = (characterId: string, resourceId: string): boolean =>
        safe.state.resources[characterId]?.some(resource => resource.id === resourceId) ?? false;
    const expectedTotals = new Map<string, number>();
    input.expectedResourceDeltas.forEach((delta) => {
        if (delta.quantityDelta === undefined) return;
        const key = `${delta.characterId}\u0000${delta.resourceId}`;
        expectedTotals.set(key, (expectedTotals.get(key) ?? 0) + delta.quantityDelta);
    });
    const writerVisibleTotals = new Map<string, number>();
    const addWriterVisibleTotal = (characterId: string, resourceId: string, quantity: number): void => {
        const key = `${characterId}\u0000${resourceId}`;
        writerVisibleTotals.set(key, (writerVisibleTotals.get(key) ?? 0) + quantity);
    };

    input.directives.forEach((directive) => {
        const linkedScenes = directive.sceneIds.map(id => input.scenes.find(scene => scene.id === id));
        const major = linkedScenes.some(scene => scene?.conflictImportance === 'major');
        if (!participants.has(directive.actorCharacterId) || !availableCharacters.has(directive.actorCharacterId)) {
            fail(`strategic directive ${directive.id} actor is unavailable or undeclared`);
        }
        if (linkedScenes.some(scene => scene === undefined || !scene.purposeTags.includes(directive.domain))) {
            fail(`strategic directive ${directive.id} has an unknown or mismatched scene`);
        }
        if (!isMeaningfulText(directive.expectedCostOrTradeoff)) {
            fail(`strategic directive ${directive.id} cost or tradeoff must be meaningful`);
        }
        validateCounterplay(directive, major, availableCharacters, participants);

        if (directive.domain === 'politics') {
            const dimensions = directive.dimensionStatuses.map(entry => entry.dimension);
            if (dimensions.length !== 7 || new Set(dimensions).size !== 7) {
                fail(`political directive ${directive.id} must contain exactly seven dimensions`);
            }
            const { earliestChapter, deadlineChapter, preparationChapters } = directive.timing;
            if (!Number.isSafeInteger(preparationChapters) || preparationChapters < 0
                || (earliestChapter !== undefined && earliestChapter > input.targetChapter)
                || (deadlineChapter !== undefined && deadlineChapter < input.targetChapter)
                || (earliestChapter !== undefined && deadlineChapter !== undefined && deadlineChapter < earliestChapter)) {
                fail(`political directive ${directive.id} timing is infeasible for the target chapter`);
            }
            return;
        }

        if (directive.domain === 'military') {
            if (major && majorOffensiveTypes.has(directive.operationType) && directive.logistics === undefined) {
                fail(`military directive ${directive.id} requires logistics`);
            }
            if (!isMeaningfulText(directive.retreatOrFailurePlan)) {
                fail(`military directive ${directive.id} retreat or failure plan must be meaningful`);
            }
            if (directive.logistics !== undefined) {
                const logistics = directive.logistics;
                const refs = [
                    logistics.supplyResource,
                    ...(logistics.mobilityResource === undefined ? [] : [logistics.mobilityResource]),
                ];
                if (refs.some(ref => !participants.has(ref.characterId) || !resourceExists(ref.characterId, ref.resourceId))) {
                    fail(`military directive ${directive.id} logistics resource is unavailable or undeclared`);
                }
                if (!isMeaningfulText(logistics.resupplyOrFallback)) {
                    fail(`military directive ${directive.id} resupply or fallback must be meaningful`);
                }
                if (typeof logistics.expectedSupplyConsumption === 'number') {
                    addWriterVisibleTotal(
                        logistics.supplyResource.characterId,
                        logistics.supplyResource.resourceId,
                        -logistics.expectedSupplyConsumption,
                    );
                }
            }
            const canonicalLocation = safe.state.characterLocations[directive.actorCharacterId];
            if (canonicalLocation !== undefined) {
                const resolved = resolvedLocationBefore(directive, input.directives, input.scenes, canonicalLocation);
                const startsAtResolved = directive.movement?.fromLocation === resolved;
                const targetsOperation = directive.movement?.toLocation === directive.location;
                const arrivesThisChapter = directive.movement?.transitChapters === 0;
                const validJourneyStart = directive.operationType === 'march' && startsAtResolved && targetsOperation;
                const validInlineArrival = startsAtResolved && targetsOperation && arrivesThisChapter;
                if (resolved !== directive.location && !validJourneyStart && !validInlineArrival) {
                    fail(`military directive ${directive.id} cannot establish its operation location this chapter`);
                }
                if (resolved === directive.location && directive.movement !== undefined
                    && directive.movement.fromLocation !== resolved) {
                    fail(`military directive ${directive.id} movement does not start at the resolved location`);
                }
            }
            return;
        }

        const referencedCharacters = [directive.counterpartyCharacterId, directive.competitorCharacterId]
            .filter((id): id is string => id !== undefined);
        if (referencedCharacters.some(id => !participants.has(id) || !availableCharacters.has(id))) {
            fail(`commerce directive ${directive.id} references an unavailable or undeclared character`);
        }
        directive.resourceFlows.forEach((flow) => {
            if (!Number.isFinite(flow.quantityDelta) || !participants.has(flow.characterId)
                || !resourceExists(flow.characterId, flow.resourceId)) {
                fail(`commerce directive ${directive.id} contains an invalid resource flow`);
            }
            addWriterVisibleTotal(flow.characterId, flow.resourceId, flow.quantityDelta);
        });
        const cash = roleTotal(directive, 'cash');
        const inventory = roleTotal(directive, 'inventory');
        const debt = roleTotal(directive, 'debt');
        const credit = roleTotal(directive, 'credit');
        const barterOutflow = directive.resourceFlows.some(flow =>
            flow.characterId === directive.actorCharacterId && flow.role === 'barter' && flow.quantityDelta < 0);
        if (cash > 0 && directive.counterpartyCharacterId === undefined && directive.marketSource === undefined) {
            fail(`commerce directive ${directive.id} positive cash flow has no source`);
        }
        if (directive.actionType === 'purchase' && inventory > 0
            && cash >= 0 && debt <= 0 && credit <= 0 && !barterOutflow) {
            fail(`commerce directive ${directive.id} creates an unfunded purchase`);
        }
        if (directive.actionType === 'sale' && cash > 0) {
            if (directive.counterpartyCharacterId === undefined && directive.marketSource === undefined) {
                fail(`commerce directive ${directive.id} sale has no source`);
            }
            if (inventory >= 0 && directive.serviceOrContractBasis === undefined) {
                fail(`commerce directive ${directive.id} sale has no inventory or service basis`);
            }
        }
        if (directive.actionType === 'loan' && cash > 0 && debt <= 0 && credit <= 0) {
            fail(`commerce directive ${directive.id} loan has no liability`);
        }
        if (directive.actionType === 'repayment' && (cash >= 0 || (debt >= 0 && credit >= 0))) {
            fail(`commerce directive ${directive.id} repayment does not reduce cash and liability`);
        }
        if (directive.fundingResource !== undefined
            && (!participants.has(directive.fundingResource.characterId)
                || !resourceExists(directive.fundingResource.characterId, directive.fundingResource.resourceId))) {
            fail(`commerce directive ${directive.id} funding resource is unavailable or undeclared`);
        }
        if (directive.actionType === 'price-war') {
            const funding = directive.fundingResource;
            const fundingSpent = funding !== undefined && directive.resourceFlows.some(flow =>
                flow.characterId === funding.characterId && flow.resourceId === funding.resourceId && flow.quantityDelta < 0);
            if (!fundingSpent || directive.competitorCharacterId === undefined
                || !isMeaningfulText(directive.expectedCostOrTradeoff)
                || directive.writerVisibleCounterplay === undefined) {
                fail(`commerce directive ${directive.id} price war lacks funding, competitor, cost, or counterplay`);
            }
        }
    });

    if ([...writerVisibleTotals].some(([key, quantity]) => expectedTotals.get(key) !== quantity)) {
        fail('writer-visible strategic resource quantities do not match expectedResourceDeltas');
    }
};
