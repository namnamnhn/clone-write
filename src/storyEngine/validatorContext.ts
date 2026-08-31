import { getArcForChapter, getBeatForChapter, isCharacterDirectAppearanceAllowed, isRelationshipEventAllowed, isRevealAllowed, isStoryEventAllowed } from './gates';
import { WriterChapterPlan } from './plannerTypes';
import { FullStoryControl, StoryState } from './types';
import { buildWriterContext } from './writerContext';
import { WriterContext } from './writerTypes';
import { buildValidatorPlotView, PlotGuidanceCapacityError, ValidatorPlotView } from './plotContext';
import { cloneValidatorStrategicView, StrategicContextCapacityError } from './strategicContext';
import type { ValidatorStrategicView } from './strategicTypes';

export interface ValidatorContextSelectionPolicy {
    readonly maxLockedCharacters: number;
    readonly maxLockedReveals: number;
    readonly maxLockedRelationshipEvents: number;
    readonly maxLockedStoryEvents: number;
    readonly maxSecretValidationItems: number;
    readonly maxPlotItems?: number;
    readonly maxStrategicItems?: number;
}

export const DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY: ValidatorContextSelectionPolicy = {
    maxLockedCharacters: 64,
    maxLockedReveals: 128,
    maxLockedRelationshipEvents: 128,
    maxLockedStoryEvents: 128,
    maxSecretValidationItems: 128,
    maxPlotItems: 256,
    maxStrategicItems: 256,
};

export class ValidatorContextCapacityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidatorContextCapacityError';
    }
}

export interface LockedCharacterDescriptor { readonly id: string; readonly name: string; }
export interface LockedRevealDescriptor { readonly id: string; readonly validationText: string; }
export interface LockedRelationshipEventDescriptor {
    readonly id: string;
    readonly eventType: string;
    readonly participantIds: readonly string[];
    readonly validationText?: string;
}
export interface LockedStoryEventDescriptor { readonly id: string; readonly eventType: string; readonly validationText?: string; }

export interface ValidatorSecretDatum {
    readonly id: string;
    readonly revealId?: string;
    readonly revealAllowed: boolean;
    /** Privileged validator-only material. Never copy this object into reports or repair requests. */
    readonly rawValue: string;
}

export interface ValidatorContext {
    readonly kind: 'validator-context';
    readonly targetChapter: number;
    readonly currentArc: { readonly id: string; readonly title: string };
    readonly currentBeat?: { readonly id: string; readonly order: number };
    readonly chapterPlan: WriterChapterPlan;
    readonly writerContext: WriterContext;
    readonly gates: {
        readonly lockedCharacters: readonly LockedCharacterDescriptor[];
        readonly lockedReveals: readonly LockedRevealDescriptor[];
        readonly lockedRelationshipEvents: readonly LockedRelationshipEventDescriptor[];
        readonly lockedStoryEvents: readonly LockedStoryEventDescriptor[];
    };
    readonly secretValidation: readonly ValidatorSecretDatum[];
    readonly plotView: ValidatorPlotView;
    readonly strategicView?: ValidatorStrategicView;
}

/** Builds a target-scoped allow-list. It never spreads either source object or includes future arc prose. */
const compareIds = (left: { readonly id: string }, right: { readonly id: string }): number => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const normalizeSelectionPolicy = (policy: ValidatorContextSelectionPolicy): ValidatorContextSelectionPolicy => {
    const normalized = {
        ...policy,
        maxPlotItems: policy.maxPlotItems ?? DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY.maxPlotItems,
        maxStrategicItems: policy.maxStrategicItems ?? DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY.maxStrategicItems,
    };
    const keys: readonly (keyof ValidatorContextSelectionPolicy)[] = [
        'maxLockedCharacters', 'maxLockedReveals', 'maxLockedRelationshipEvents',
        'maxLockedStoryEvents', 'maxSecretValidationItems', 'maxPlotItems', 'maxStrategicItems',
    ];
    keys.forEach((key) => {
        const value = normalized[key];
        if (!Number.isSafeInteger(value) || (value as number) < 0) {
            throw new ValidatorContextCapacityError(`validator context selection policy ${key} must be a non-negative safe integer`);
        }
    });
    return normalized;
};

const requireCapacity = (label: string, count: number, maximum: number): void => {
    if (count > maximum) throw new ValidatorContextCapacityError(`${label} requires ${count} items but capacity is ${maximum}`);
};

export const buildValidatorContext = (
    control: FullStoryControl,
    state: StoryState,
    plan: WriterChapterPlan,
    selectionPolicy: ValidatorContextSelectionPolicy = DEFAULT_VALIDATOR_CONTEXT_SELECTION_POLICY,
    suppliedStrategicView?: ValidatorStrategicView,
): ValidatorContext => {
    const policy = normalizeSelectionPolicy(selectionPolicy);
    const writerContext = buildWriterContext(control, state, plan);
    const chapter = writerContext.targetChapter;
    const arc = getArcForChapter(control, chapter);
    const beat = getBeatForChapter(control, chapter);
    if (!arc) throw new Error('target chapter has no unambiguous source arc');
    const characterIds = control.characterOrder.slice();
    const lockedCharacters = characterIds
        .filter(id => !isCharacterDirectAppearanceAllowed(control, id, chapter))
        .map(id => ({ id, name: control.characters[id].name }))
        .sort(compareIds);
    const lockedReveals = control.reveals
        .filter(value => !isRevealAllowed(control, value.id, chapter))
        .map(value => ({ id: value.id, validationText: value.writerText }))
        .sort(compareIds);
    const lockedRelationshipEvents = control.relationshipEvents
        .filter(value => !isRelationshipEventAllowed(control, value.id, chapter))
        .map(value => ({
            id: value.id, eventType: value.eventType, participantIds: value.participantIds.slice(),
            ...(value.writerText === undefined ? {} : { validationText: value.writerText }),
        }))
        .sort(compareIds);
    const lockedStoryEvents = control.storyEvents
        .filter(value => !isStoryEventAllowed(control, value.id, chapter))
        .map(value => ({ id: value.id, eventType: value.eventType, ...(value.writerText === undefined ? {} : { validationText: value.writerText }) }))
        .sort(compareIds);
    const secretValidation = control.authorOnlySecrets
        .filter(secret => secret.revealId === undefined || !isRevealAllowed(control, secret.revealId, chapter))
        .map(secret => ({
            id: secret.id, ...(secret.revealId === undefined ? {} : { revealId: secret.revealId }),
            revealAllowed: false as const, rawValue: secret.value,
        }))
        .sort(compareIds);
    requireCapacity('locked characters', lockedCharacters.length, policy.maxLockedCharacters);
    requireCapacity('locked reveals', lockedReveals.length, policy.maxLockedReveals);
    requireCapacity('locked relationship events', lockedRelationshipEvents.length, policy.maxLockedRelationshipEvents);
    requireCapacity('locked story events', lockedStoryEvents.length, policy.maxLockedStoryEvents);
    requireCapacity('secret validation', secretValidation.length, policy.maxSecretValidationItems);
    let plotView: ValidatorPlotView;
    try {
        plotView = buildValidatorPlotView(control, state, chapter, policy.maxPlotItems ?? 256);
    } catch (error) {
        if (error instanceof PlotGuidanceCapacityError) throw new ValidatorContextCapacityError(error.message);
        throw error;
    }
    let strategicView: ValidatorStrategicView | undefined;
    try {
        strategicView = suppliedStrategicView === undefined ? undefined
            : cloneValidatorStrategicView(suppliedStrategicView, chapter, policy.maxStrategicItems ?? 256);
    } catch (error) {
        if (error instanceof StrategicContextCapacityError) throw new ValidatorContextCapacityError(error.message);
        throw error;
    }
    if (strategicView?.deterministicIssues.length) throw new Error('strategic plan contains deterministic blockers');
    if (strategicView !== undefined) {
        const directives = writerContext.chapterPlan.strategicDirectives ?? [];
        if (directives.length !== strategicView.actions.length || strategicView.actions.some((action) => {
            const directive = directives.find(candidate => candidate.id === action.id);
            return !directive || directive.domain !== action.domain || directive.actorCharacterId !== action.actorCharacterId
                || directive.sceneIds.join('\u0000') !== action.sceneIds.join('\u0000');
        })) throw new Error('validator strategic view does not match the writer-safe plan projection');
    }
    return {
        kind: 'validator-context', targetChapter: chapter, currentArc: { id: arc.id, title: arc.title },
        ...(beat === undefined ? {} : { currentBeat: { id: beat.id, order: beat.order } }),
        chapterPlan: writerContext.chapterPlan, writerContext,
        gates: {
            lockedCharacters,
            lockedReveals, lockedRelationshipEvents, lockedStoryEvents,
        },
        secretValidation,
        plotView,
        ...(strategicView === undefined ? {} : { strategicView }),
    };
};
