import { isRelationshipEventAllowed } from './gates';
import type { RomanceMilestone } from './relationshipTypes';
import type { FullStoryControl } from './types';

export interface RelationshipGateValidationEvent {
    readonly id: string;
    readonly relationshipId: string;
    readonly eventType: string;
    readonly participantIds: readonly string[];
    readonly allowed: boolean;
    readonly authorizedRomanceMilestone?: RomanceMilestone;
}

/** Trusted control-side gate data. This object must never be added to Planner model context. */
export interface RelationshipGateValidationView {
    readonly targetChapter: number;
    readonly relationships: readonly { readonly id: string; readonly participantIds: readonly string[] }[];
    readonly events: readonly RelationshipGateValidationEvent[];
}

export const buildRelationshipGateValidationView = (
    control: FullStoryControl,
    targetChapter: number,
): RelationshipGateValidationView => ({
    targetChapter,
    relationships: control.relationshipDefinitions.map(definition => ({
        id: definition.id,
        participantIds: [...definition.participantIds],
    })),
    events: control.relationshipEvents.map(event => ({
        id: event.id,
        relationshipId: event.relationshipId,
        eventType: event.eventType,
        participantIds: [...event.participantIds],
        allowed: isRelationshipEventAllowed(control, event.id, targetChapter),
        ...(event.authorizedRomanceMilestone === undefined ? {} : { authorizedRomanceMilestone: event.authorizedRomanceMilestone }),
    })),
});
