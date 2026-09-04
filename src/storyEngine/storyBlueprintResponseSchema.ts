import {
    RELATIONSHIP_ACTION_TYPES,
    RELATIONSHIP_CATEGORIES,
    RELATIONSHIP_DYNAMIC_TAGS,
    ROMANCE_MILESTONES,
} from './relationshipTypes';

/**
 * Provider-neutral JSON Schema guidance for StoryBlueprintDocument output.
 * parseStoryBlueprintDocument remains the final authority; keep this contract
 * beside the runtime parser so private setup-schema drift is reviewable.
 */
export const STORY_BLUEPRINT_DOCUMENT_RESPONSE_JSON_SCHEMA = {
    $id: 'story-blueprint-document-v1',
    title: 'StoryBlueprintDocument',
    description: 'Strict Story Engine V4 author-control document. Private author fields never become Writer context directly.',
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'formatVersion', 'blueprint'],
    properties: {
        kind: { type: 'string', enum: ['story-blueprint-document'] },
        formatVersion: { type: 'integer', enum: [1] },
        blueprint: { $ref: '#/$defs/blueprint' },
    },
    $defs: {
        // Gemini responseJsonSchema does not support minLength. The strict
        // runtime parser remains responsible for rejecting empty strings.
        nonEmptyString: { type: 'string' },
        positiveInteger: { type: 'integer', minimum: 1 },
        nonNegativeInteger: { type: 'integer', minimum: 0 },
        stringArray: { type: 'array', items: { $ref: '#/$defs/nonEmptyString' } },
        writerProfile: {
            type: 'object', additionalProperties: false,
            properties: {
                role: { $ref: '#/$defs/nonEmptyString' }, appearance: { $ref: '#/$defs/nonEmptyString' },
                personality: { $ref: '#/$defs/nonEmptyString' }, publicFacts: { $ref: '#/$defs/stringArray' },
            },
        },
        character: {
            type: 'object', additionalProperties: false,
            required: ['id', 'name'],
            anyOf: [
                { required: ['availableFromChapter'] },
                { required: ['allowedFromChapter'] },
                { required: ['lockedThroughChapter'] },
            ],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, name: { $ref: '#/$defs/nonEmptyString' },
                availableFromChapter: { $ref: '#/$defs/positiveInteger' },
                allowedFromChapter: { $ref: '#/$defs/positiveInteger' },
                lockedThroughChapter: { $ref: '#/$defs/nonNegativeInteger' },
                writerProfile: { $ref: '#/$defs/writerProfile' }, authorNotes: { $ref: '#/$defs/nonEmptyString' },
            },
        },
        arc: {
            type: 'object', additionalProperties: false,
            required: ['id', 'title', 'startChapter', 'endChapter'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, title: { $ref: '#/$defs/nonEmptyString' },
                startChapter: { $ref: '#/$defs/positiveInteger' }, endChapter: { $ref: '#/$defs/positiveInteger' },
                writerBrief: { $ref: '#/$defs/nonEmptyString' }, authorPlan: { $ref: '#/$defs/nonEmptyString' },
            },
        },
        beat: {
            type: 'object', additionalProperties: false,
            required: ['id', 'arcId', 'order', 'startChapter', 'endChapter'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, arcId: { $ref: '#/$defs/nonEmptyString' },
                order: { $ref: '#/$defs/positiveInteger' }, startChapter: { $ref: '#/$defs/positiveInteger' },
                endChapter: { $ref: '#/$defs/positiveInteger' }, writerBrief: { $ref: '#/$defs/nonEmptyString' },
                authorPlan: { $ref: '#/$defs/nonEmptyString' },
            },
        },
        reveal: {
            type: 'object', additionalProperties: false, required: ['id', 'writerText'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, writerText: { $ref: '#/$defs/nonEmptyString' },
                authorNotes: { $ref: '#/$defs/nonEmptyString' },
            },
        },
        relationshipDefinition: {
            type: 'object', additionalProperties: false,
            required: ['id', 'participantIds', 'categories', 'initialRomanceMilestone', 'dynamicProfile', 'progressionPolicy'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' },
                participantIds: { type: 'array', minItems: 2, maxItems: 2, items: { $ref: '#/$defs/nonEmptyString' } },
                categories: { type: 'array', minItems: 1, items: { type: 'string', enum: [...RELATIONSHIP_CATEGORIES] } },
                initialRomanceMilestone: { type: 'string', enum: [...ROMANCE_MILESTONES] },
                dynamicProfile: {
                    type: 'object', additionalProperties: false,
                    required: ['coreDynamicTags', 'dominantConflictSources', 'trustBasis', 'respectBasis', 'prohibitedShortcuts'],
                    properties: {
                        coreDynamicTags: { type: 'array', items: { type: 'string', enum: [...RELATIONSHIP_DYNAMIC_TAGS] } },
                        dominantConflictSources: { $ref: '#/$defs/stringArray' }, trustBasis: { $ref: '#/$defs/stringArray' },
                        respectBasis: { $ref: '#/$defs/stringArray' },
                        prohibitedShortcuts: { type: 'array', items: { type: 'string', enum: [...RELATIONSHIP_ACTION_TYPES] } },
                    },
                },
                progressionPolicy: {
                    type: 'object', additionalProperties: false,
                    required: ['maxMajorMilestoneAdvancePerChapter', 'maxConsecutiveProgressionChapters', 'requireCanonicalBasis', 'requireMutualAgencyForMutualMilestone'],
                    properties: {
                        maxMajorMilestoneAdvancePerChapter: { $ref: '#/$defs/positiveInteger' },
                        maxConsecutiveProgressionChapters: { $ref: '#/$defs/positiveInteger' },
                        // Gemini supports enum values only for strings/numbers.
                        // The prompt requires true and the strict parser enforces it.
                        requireCanonicalBasis: { type: 'boolean' },
                        requireMutualAgencyForMutualMilestone: { type: 'boolean' },
                    },
                },
            },
        },
        relationshipEvent: {
            type: 'object', additionalProperties: false,
            required: ['id', 'relationshipId', 'eventType', 'participantIds'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, relationshipId: { $ref: '#/$defs/nonEmptyString' },
                eventType: { $ref: '#/$defs/nonEmptyString' }, participantIds: { $ref: '#/$defs/stringArray' },
                writerText: { $ref: '#/$defs/nonEmptyString' }, authorNotes: { $ref: '#/$defs/nonEmptyString' },
                authorizedRomanceMilestone: { type: 'string', enum: [...ROMANCE_MILESTONES] },
            },
        },
        storyEvent: {
            type: 'object', additionalProperties: false, required: ['id', 'eventType'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, eventType: { $ref: '#/$defs/nonEmptyString' },
                writerText: { $ref: '#/$defs/nonEmptyString' }, authorNotes: { $ref: '#/$defs/nonEmptyString' },
            },
        },
        characterGate: {
            type: 'object', additionalProperties: false, required: ['id', 'characterId'],
            anyOf: [{ required: ['allowedFromChapter'] }, { required: ['lockedThroughChapter'] }],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, characterId: { $ref: '#/$defs/nonEmptyString' },
                allowedFromChapter: { $ref: '#/$defs/positiveInteger' }, lockedThroughChapter: { $ref: '#/$defs/nonNegativeInteger' },
            },
        },
        revealGate: {
            type: 'object', additionalProperties: false, required: ['id', 'revealId'],
            anyOf: [{ required: ['allowedFromChapter'] }, { required: ['lockedThroughChapter'] }],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, revealId: { $ref: '#/$defs/nonEmptyString' },
                allowedFromChapter: { $ref: '#/$defs/positiveInteger' }, lockedThroughChapter: { $ref: '#/$defs/nonNegativeInteger' },
            },
        },
        eventGate: {
            type: 'object', additionalProperties: false, required: ['id', 'eventId'],
            anyOf: [{ required: ['allowedFromChapter'] }, { required: ['lockedThroughChapter'] }],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, eventId: { $ref: '#/$defs/nonEmptyString' },
                allowedFromChapter: { $ref: '#/$defs/positiveInteger' }, lockedThroughChapter: { $ref: '#/$defs/nonNegativeInteger' },
            },
        },
        forbiddenEvent: {
            type: 'object', additionalProperties: false, required: ['id', 'eventId', 'forbiddenThroughChapter'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, eventId: { $ref: '#/$defs/nonEmptyString' },
                forbiddenThroughChapter: { $ref: '#/$defs/nonNegativeInteger' }, authorReason: { $ref: '#/$defs/nonEmptyString' },
            },
        },
        forbiddenReveal: {
            type: 'object', additionalProperties: false, required: ['id', 'revealId', 'forbiddenThroughChapter'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, revealId: { $ref: '#/$defs/nonEmptyString' },
                forbiddenThroughChapter: { $ref: '#/$defs/nonNegativeInteger' }, authorReason: { $ref: '#/$defs/nonEmptyString' },
            },
        },
        authorOnlySecret: {
            type: 'object', additionalProperties: false, required: ['id', 'value'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, value: { $ref: '#/$defs/nonEmptyString' },
                revealId: { $ref: '#/$defs/nonEmptyString' }, notes: { $ref: '#/$defs/nonEmptyString' },
            },
        },
        canonRule: {
            type: 'object', additionalProperties: false, required: ['id', 'text', 'availableFromChapter', 'scope'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' }, text: { $ref: '#/$defs/nonEmptyString' },
                availableFromChapter: { $ref: '#/$defs/positiveInteger' }, expiresAfterChapter: { $ref: '#/$defs/positiveInteger' },
                scope: { type: 'string', enum: ['world', 'canon'] }, authorNotes: { $ref: '#/$defs/nonEmptyString' },
            },
        },
        blueprint: {
            type: 'object', additionalProperties: false, required: ['id', 'engine', 'characters'],
            properties: {
                id: { $ref: '#/$defs/nonEmptyString' },
                engine: {
                    type: 'object', additionalProperties: false, required: ['plannedChapterCount'],
                    properties: { plannedChapterCount: { $ref: '#/$defs/positiveInteger' } },
                },
                characters: { type: 'array', minItems: 1, items: { $ref: '#/$defs/character' } },
                arcs: { type: 'array', items: { $ref: '#/$defs/arc' } }, beats: { type: 'array', items: { $ref: '#/$defs/beat' } },
                reveals: { type: 'array', items: { $ref: '#/$defs/reveal' } },
                relationshipDefinitions: { type: 'array', items: { $ref: '#/$defs/relationshipDefinition' } },
                relationshipEvents: { type: 'array', items: { $ref: '#/$defs/relationshipEvent' } },
                storyEvents: { type: 'array', items: { $ref: '#/$defs/storyEvent' } },
                gates: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        characters: { type: 'array', items: { $ref: '#/$defs/characterGate' } },
                        pov: { type: 'array', items: { $ref: '#/$defs/characterGate' } },
                        reveals: { type: 'array', items: { $ref: '#/$defs/revealGate' } },
                        relationships: { type: 'array', items: { $ref: '#/$defs/eventGate' } },
                        events: { type: 'array', items: { $ref: '#/$defs/eventGate' } },
                    },
                },
                forbiddenEvents: { type: 'array', items: { $ref: '#/$defs/forbiddenEvent' } },
                forbiddenRelationshipEvents: { type: 'array', items: { $ref: '#/$defs/forbiddenEvent' } },
                forbiddenReveals: { type: 'array', items: { $ref: '#/$defs/forbiddenReveal' } },
                authorOnlySecrets: { type: 'array', items: { $ref: '#/$defs/authorOnlySecret' } },
                canonRules: { type: 'array', items: { $ref: '#/$defs/canonRule' } },
            },
        },
    },
} as const;
