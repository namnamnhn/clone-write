import { getArcForChapter, getBeatForChapter, isCharacterDirectAppearanceAllowed, isPovAllowed, isRelationshipEventAllowed, isRevealAllowed, isStoryEventAllowed } from './gates';
import { WriterChapterPlan } from './plannerTypes';
import { FullStoryControl, StoryState } from './types';
import { buildWriterContext } from './writerContext';
import { WriterContext } from './writerTypes';

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
        readonly allowedCharacterIds: readonly string[];
        readonly lockedCharacterIds: readonly string[];
        readonly allowedPovIds: readonly string[];
        readonly lockedRevealIds: readonly string[];
        readonly lockedRelationshipEventIds: readonly string[];
        readonly lockedStoryEventIds: readonly string[];
    };
    readonly secretValidation: readonly ValidatorSecretDatum[];
}

/** Builds a target-scoped allow-list. It never spreads either source object or includes future arc prose. */
export const buildValidatorContext = (control: FullStoryControl, state: StoryState, plan: WriterChapterPlan): ValidatorContext => {
    const writerContext = buildWriterContext(control, state, plan);
    const chapter = writerContext.targetChapter;
    const arc = getArcForChapter(control, chapter);
    const beat = getBeatForChapter(control, chapter);
    if (!arc) throw new Error('target chapter has no unambiguous source arc');
    const characterIds = control.characterOrder.slice();
    const allowedCharacterIds = characterIds.filter(id => isCharacterDirectAppearanceAllowed(control, id, chapter));
    return {
        kind: 'validator-context', targetChapter: chapter, currentArc: { id: arc.id, title: arc.title },
        ...(beat === undefined ? {} : { currentBeat: { id: beat.id, order: beat.order } }),
        chapterPlan: writerContext.chapterPlan, writerContext,
        gates: {
            allowedCharacterIds, lockedCharacterIds: characterIds.filter(id => !isCharacterDirectAppearanceAllowed(control, id, chapter)),
            allowedPovIds: characterIds.filter(id => isPovAllowed(control, id, chapter)),
            lockedRevealIds: control.reveals.filter(value => !isRevealAllowed(control, value.id, chapter)).map(value => value.id),
            lockedRelationshipEventIds: control.relationshipEvents.filter(value => !isRelationshipEventAllowed(control, value.id, chapter)).map(value => value.id),
            lockedStoryEventIds: control.storyEvents.filter(value => !isStoryEventAllowed(control, value.id, chapter)).map(value => value.id),
        },
        secretValidation: control.authorOnlySecrets
            .filter(secret => secret.revealId === undefined || !isRevealAllowed(control, secret.revealId, chapter))
            .map(secret => ({
            id: secret.id, ...(secret.revealId === undefined ? {} : { revealId: secret.revealId }),
            revealAllowed: false, rawValue: secret.value,
        })),
    };
};
