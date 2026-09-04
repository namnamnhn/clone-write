# WORK15A Project Library and Legacy Migration

## Scope

WORK15A adds a local multi-project catalog around the unchanged `StoryStudioProjectDocumentV1` format. It does not change Story Engine schema version 4 or the production Planner → Writer → Validator → Extractor → Canon Review → explicit Make Canon pipeline.

## Pre-flight and architecture audit

The implementation started from clean, synchronized `main` at `d5d6ff99b15c132629725ecfb1a644499012c5c4` (the WORK14 squash merge). The complete project types, persistence, controller, runtime reconstruction, Story Studio session/hook/page/action bar, and WORK13 production test file were reviewed before editing.

Project-library IDs and catalog fields remain outside every existing identity:

- `coreIdentity` covers `displayName`, `setupDocument`, `storyControlIdentity`, `state`, `memory`, `chapterMetadata`, and `createdAt`.
- `workflowIdentity` covers only `workflow` and `batchQueue`.
- `storyControlIdentity` covers the complete compiled `FullStoryControl`.
- the current Canon identity covers the complete parsed `StoryState`.
- canonicalization-source identity covers `storyControlId`, `storyControlIdentity`, `baseChapter`, `baseRevision`, `chapterPlan`, and the approved draft.
- proposal identity covers `sourceIdentity`, `storyControlId`, `storyControlIdentity`, `baseChapter`, `baseRevision`, `targetChapter`, and the proposed delta.
- production plan/draft/validation/extraction artifact identities retain their existing stage cursor and parent-artifact bindings; the plan also binds narrative-memory identity.
- narrative-memory identity covers the complete validated `NarrativeMemoryState`.
- each canonical memory `recordIdentity` covers `kind`, StoryControl ID/identity, chapter number, canonicalization/proposal/before-Canon/after-Canon identities, raw prose, structured memory, and optional long-term memory.
- canonical chapter `metadataIdentity` covers chapter number, optional title, and canonicalization/proposal/before-Canon/after-Canon identities.

The library ID never enters the serialized project, StoryState, StoryControl, memory, workflow artifacts, Canon proposal, or any identity input. `StoryStudioProjectDocumentV1.formatVersion` remains `1`.

## Storage model

- Legacy single-project key: `story_studio_v4_current_project_v1`
- Library index key: `story_studio_v4_project_library_v1`
- Per-project key: `story_studio_v4_project_v1:<projectId>`

The strict version-1 index contains one active ID, when available, and compact entries with project ID, catalog display name, timestamps, chapter progress, planned chapter count, and workflow stage. It contains no setup document, chapter text, Author Secret text, API key, StoryState, memory, or runtime `FullStoryControl`.

Normal project mutations atomically write the isolated project record and matching index metadata in one IndexedDB transaction. All repository mutations also share one serialized request lane, so a later requested snapshot cannot be overtaken by an older write.

Rename is deliberately catalog-only. It changes the index display name and catalog update time without rewriting the project document or changing `coreIdentity`, StoryControl identity, Canon identity, memory identities, or workflow identity.

## Legacy migration order

When a valid new index exists it is authoritative; the legacy key is not migrated again.

When no new index exists:

1. Read and strictly parse the legacy project first, including core, memory, metadata, StoryControl, workflow, and identity validation.
2. Generate an opaque local project ID through the injectable ID generator.
3. Save the unchanged validated `StoryStudioProjectDocumentV1` to its namespaced project key.
4. Save a one-entry index that points to that record and makes it active.
5. Only after both saves succeed, clear the legacy key.

An empty legacy key creates an empty version-1 index. Migration does not call a model, Make Canon, advance a chapter, regenerate memory, or recompute a valid legacy project identity.

### Failure behavior

- A project-record or index write failure returns `MIGRATION_FAILED`, preserves the legacy key, and remains retryable. A project record left before an index-write failure is an unreachable orphan and is never exposed as active.
- A legacy cleanup failure returns `LEGACY_CLEANUP_FAILED`. The complete new record and index remain durable. On reload, the valid new index wins, so migration is idempotent and no duplicate entry is created.
- Corrupt legacy core is left byte-for-byte untouched and no index is created over it.
- Existing WORK13 workflow recovery remains per-project. It discards only a corrupt/stale workflow checkpoint, pauses the queue, and preserves validated Canon core.

## Active-project and recovery rules

- Creating/importing a reviewed TXT, MD, or V4 JSON setup always creates a new isolated project and makes it active. It never replaces or deletes the prior project.
- Switching first loads and validates the target project; only then is the active ID durably changed. Failure leaves the prior active project selected and usable.
- Switching, creating, and deleting are blocked while a model stage or durability transition is active.
- A corrupt or missing active record fails closed. WORK15A does not silently select a different Canon.
- A corrupt non-active record is marked unavailable; valid projects remain loadable and switchable.
- Deleting a non-active project leaves the active project untouched.
- Deleting the active project selects the valid remaining entry with the newest catalog `updatedAt`. Ties use ascending project ID. Corrupt/missing candidates are skipped rather than invented or repaired.
- Deleting the last project leaves an empty library.

## Compatibility and intentional omissions

- Legacy **Sáng Tác / Creative** storage and behavior are not changed.
- No new provider, paid API, Gemini call, publishing, or EPUB behavior is added.
- WORK15B New Story Wizard/Template is not started. The existing reviewed setup import remains the creation path.
- WORK15C portable backup/restore is not started. The per-project records plus compact index provide the storage boundary it can use later.
- WORK15A does not merge, export, import, or repair Canon records across projects.
