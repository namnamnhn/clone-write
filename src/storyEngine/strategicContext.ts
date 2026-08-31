import type { InternalChapterPlan, PlanValidationIssue, PlannerContext } from './plannerTypes';
import { assertModelBoundaryStringsSecretSafe } from './secretTextSafety';
import {
    actionResourceEffects,
    collectActionEvidence,
    evidenceIdentity,
    resourceFor,
    resourceKey,
} from './strategicEvidence';
import type {
    StrategicActionPlan,
    ValidatorStrategicActionDescriptor,
    ValidatorStrategicView,
    WriterStrategicDirective,
} from './strategicTypes';
import { orderStrategicActions, validateStrategicActions } from './strategicValidator';
import type { FullStoryControl } from './types';

export class StrategicContextCapacityError extends Error {
    constructor(message: string) { super(message); this.name = 'StrategicContextCapacityError'; }
}

const operationalRequirements = (action: StrategicActionPlan): readonly string[] => {
    if (action.domain === 'politics') {
        return [
            'Show the authority, information, personnel, money, law, reputation, and time constraints that matter.',
            `Preparation requires ${action.timing.preparationChapters} chapter(s).`,
        ];
    }
    if (action.domain === 'military') {
        return [
            `Depict a ${action.operationType} operation at ${action.location}.`,
            'Show logistics, mobility/time limits, command uncertainty, and a credible retreat or failure path.',
        ];
    }
    return [
        `Depict the ${action.actionType} resource flow without creating money or inventory from nowhere.`,
        'Show source/counterparty, logistics, settlement time, risk, and competitive response where applicable.',
    ];
};

/** Builds a new Writer-only allow-list and applies the centralized raw-secret boundary guard. */
export const buildWriterStrategicDirectives = (
    control: FullStoryControl,
    plan: InternalChapterPlan,
): readonly WriterStrategicDirective[] => {
    const directives = orderStrategicActions(plan.strategicActions ?? [], plan).map(action => ({
        id: action.id,
        domain: action.domain,
        sceneIds: action.sceneIds.map(id => id),
        actorCharacterId: action.actorCharacterId,
        visibleObjective: action.objective,
        visibleConstraints: action.writerVisibleConstraints.map(value => value),
        expectedCostOrTradeoff: action.expectedCostOrTradeoff,
        visibleOperationalRequirements: operationalRequirements(action),
    }));
    assertModelBoundaryStringsSecretSafe(control, directives, 'writerStrategicDirectives');
    return directives;
};

const actionDescriptor = (action: StrategicActionPlan): ValidatorStrategicActionDescriptor => {
    const evidence = collectActionEvidence(action)
        .map(reference => ({ reference, identity: evidenceIdentity(reference) }))
        .sort((left, right) => left.identity.localeCompare(right.identity))
        .map(entry => entry.reference);
    const resources = [...new Set(actionResourceEffects(action)
        .map(effect => resourceKey(effect.characterId, effect.resourceId)))].sort();
    return {
        id: action.id,
        domain: action.domain,
        sceneIds: action.sceneIds.map(id => id),
        actorCharacterId: action.actorCharacterId,
        ...(action.countermove === undefined ? {} : { opponentCharacterId: action.countermove.opponentCharacterId }),
        evidenceRefs: evidence,
        resourceKeys: resources,
        actorKnowledgeFactIds: [...new Set(action.actorKnowledgeFactIds)].sort(),
        opponentKnowledgeFactIds: [...new Set(action.countermove?.opponentKnowledgeFactIds ?? [])].sort(),
    };
};

/** Bounded privileged view for Semantic Validator only. Repair and Writer projections never use it. */
export const buildValidatorStrategicView = (
    plan: InternalChapterPlan,
    context: PlannerContext,
    maximumItems = 256,
): ValidatorStrategicView => {
    if (!Number.isSafeInteger(maximumItems) || maximumItems < 0) throw new StrategicContextCapacityError('invalid validator strategic capacity');
    const actions = orderStrategicActions(plan.strategicActions ?? [], plan);
    const descriptors = actions.map(actionDescriptor);
    const issues = validateStrategicActions(plan, context)
        .map(entry => ({ code: entry.code, path: entry.path, severity: entry.severity } as const));
    const resourceKeys = [...new Set(actions.flatMap(action => actionResourceEffects(action)
        .map(effect => resourceKey(effect.characterId, effect.resourceId))))].sort();
    const resourceEvidence = resourceKeys.map((key) => {
        const [characterId, resourceId] = key.split('\u0000');
        const resource = resourceFor(context, characterId, resourceId);
        return { characterId, resourceId, ...(resource?.quantity === undefined ? {} : { quantity: resource.quantity }) };
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
    const itemCount = descriptors.length + descriptors.reduce((total, descriptor) => total + descriptor.evidenceRefs.length, 0)
        + resourceEvidence.length + epistemicEvidence.length + issues.length;
    if (itemCount > maximumItems) throw new StrategicContextCapacityError('complete validator strategic evidence exceeds capacity');
    return {
        kind: 'validator-strategic-view', chapterNumber: context.targetChapter,
        actions: descriptors, deterministicIssues: issues, resourceEvidence, epistemicEvidence,
    };
};

export const cloneValidatorStrategicView = (
    view: ValidatorStrategicView,
    chapterNumber: number,
    maximumItems: number,
): ValidatorStrategicView => {
    if (view.kind !== 'validator-strategic-view' || view.chapterNumber !== chapterNumber) throw new Error('validator strategic view target mismatch');
    const itemCount = view.actions.length + view.actions.reduce((total, action) => total + action.evidenceRefs.length, 0)
        + view.resourceEvidence.length + view.epistemicEvidence.length + view.deterministicIssues.length;
    if (itemCount > maximumItems) throw new StrategicContextCapacityError('validator strategic view exceeds capacity');
    return {
        kind: 'validator-strategic-view', chapterNumber,
        actions: view.actions.map(action => ({
            id: action.id, domain: action.domain, sceneIds: action.sceneIds.map(id => id), actorCharacterId: action.actorCharacterId,
            ...(action.opponentCharacterId === undefined ? {} : { opponentCharacterId: action.opponentCharacterId }),
            evidenceRefs: action.evidenceRefs.map(reference => ({ ...reference })), resourceKeys: action.resourceKeys.map(value => value),
            actorKnowledgeFactIds: action.actorKnowledgeFactIds.map(id => id), opponentKnowledgeFactIds: action.opponentKnowledgeFactIds.map(id => id),
        })),
        deterministicIssues: view.deterministicIssues.map(issue => ({ code: issue.code, path: issue.path, severity: issue.severity })),
        resourceEvidence: view.resourceEvidence.map(resource => ({ characterId: resource.characterId, resourceId: resource.resourceId, ...(resource.quantity === undefined ? {} : { quantity: resource.quantity }) })),
        epistemicEvidence: view.epistemicEvidence.map(entry => ({ characterId: entry.characterId, factId: entry.factId })),
    };
};

export const strategicViewIssueSummary = (
    issues: readonly PlanValidationIssue[],
): readonly Pick<PlanValidationIssue, 'code' | 'path' | 'severity'>[] =>
    issues.map(issue => ({ code: issue.code, path: issue.path, severity: issue.severity }));
