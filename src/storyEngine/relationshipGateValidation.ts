import { isRelationshipEventAllowed } from './gates';
import type { RomanceMilestone } from './relationshipTypes';
import type { FullStoryControl } from './types';

export interface RelationshipGateValidationEvent {
    readonly id: string;
    readonly relationshipId: string;
    readonly eventType: string;
    readonly allowed: boolean;
    readonly authorizedRomanceMilestone?: RomanceMilestone;
}

/** Trusted control-side gate data. This object must never be added to Planner model context. */
export interface RelationshipGateValidationView {
    readonly targetChapter: number;
    readonly events: readonly RelationshipGateValidationEvent[];
}

export const buildRelationshipGateValidationView = (
    control: FullStoryControl,
    targetChapter: number,
): RelationshipGateValidationView => ({
    targetChapter,
    events: control.relationshipEvents.map(event => ({
        id: event.id,
        relationshipId: event.relationshipId,
        eventType: event.eventType,
        allowed: isRelationshipEventAllowed(control, event.id, targetChapter),
        ...(event.authorizedRomanceMilestone === undefined ? {} : { authorizedRomanceMilestone: event.authorizedRomanceMilestone }),
    })),
});
