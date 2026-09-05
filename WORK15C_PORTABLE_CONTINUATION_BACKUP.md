# WORK15C — Portable Story Studio continuation backup

## Purpose

`Sao lưu để tiếp tục` exports one Story Studio V4 project's last durable state so it can be restored on another browser or computer. It is distinct from `Xuất Setup`: Setup is editable story design and creates a new C0 project after Setup Review, while a continuation backup carries the current Canon, Narrative Memory, chapter metadata/history, durable workflow checkpoint, and batch queue.

WORK15C does not implement whole-library backup, project merge/overwrite, cloud sync, encryption, EPUB/publishing, or WORK15D.

## Format

The portable file is strict JSON with this independent envelope:

- `kind: "story-studio-continuation-backup"`
- `formatVersion: 1`
- `exportedAt`: ISO timestamp for the file operation
- `catalogDisplayName`: the library label, outside semantic project identity
- `project`: an exact `StoryStudioProjectDocumentV1`

Unknown envelope fields, missing fields, wrong kinds, and unsupported versions are rejected. `StoryStudioProjectDocumentV1.formatVersion` remains 1 and Story Engine state remains schema V4. `FullStoryControl` is not serialized; the existing strict project parser reconstructs it from `setupDocument` and verifies StoryControl, core, Canon/Memory, chapter metadata, workflow, and artifact identities.

No browser-local project ID, storage key, wizard ID, filename, or library index is included. The JSON serializer has deterministic property order for the same normalized envelope.

## Export

Export is offline and reads the controller's last successfully persisted active project snapshot. It performs no save, timestamp mutation, model call, pause, or Canon operation. The UI requires explicit confirmation that the file contains private author data, including possible Author Secrets, spoilers, Canon, Memory, drafts, plans, and unpublished artifacts. The exact serialized UTF-8 export is checked against the same 64 MiB limit used by import before the browser download side effect; an oversized export downloads nothing and leaves the project untouched.

The backup preserves private data because redaction would make exact continuation impossible. Its raw JSON is never logged or shown in ordinary UI diagnostics.

## Restore and isolation

Restore is a separate offline file path. The browser checks a dedicated size bound before reading, then strictly parses the envelope and project. Only a verified library authority may accept restore; an invalid/untrusted index remains fail-closed.

Successful parsing first creates an in-memory, secret-safe preview containing only the catalog name, current/planned chapter numbers, workflow stage, backup version, and exact-validation status. It shows no Setup, Canon, Memory, plan, draft, extraction, proposal, secret, or raw JSON content and performs no storage write. Cancel discards only this volatile prepared state. The repository/controller restore is called only after the author explicitly confirms that a new local clone will be created and activated without overwriting existing projects.

After all validation succeeds, the repository generates a fresh local project ID and atomically commits:

1. one new namespaced project record;
2. the updated library index selecting that new project.

The active project changes in the controller/UI only after the atomic commit succeeds. A failed parse, validation, quota write, or library transaction leaves every existing project and the prior visible active project unchanged. Restoring beside the source—or restoring the same file twice—therefore creates independent local entries without key collisions or overwrites.

The catalog display name is restored as library metadata. It does not alter `coreIdentity`, `workflowIdentity`, StoryControl, Canon, Memory, artifacts, or other semantic identities.

## Exact-checkpoint policy

The existing local load path may preserve valid Canon by discarding a stale workflow and returning `workflowRecovered`. Portable restore is stricter: any backup whose project parse reports workflow recovery is rejected. A continuation file is never reported as successful after silently degrading its checkpoint to idle.

The controller also retains that recovery provenance while a locally recovered project is active. It refuses to export that reconstructed idle runtime as an “exact” continuation backup; export becomes available only after the author performs a normal operation that successfully persists a new valid checkpoint.

All valid durable stages are retained: `idle`, `planned`, `drafted`, `validated`, `rejected`, `extracted`, and `ready-for-canon-review`. Batch `requestedSize`, `remaining`, and `paused` are retained. Ephemeral network requests and AbortControllers are not serialized.

A `ready-for-canon-review` restore remains approved but non-canonical. Restore does not Make Canon; the author must explicitly confirm, and one confirmation advances exactly one chapter.

## File-size bound

Continuation files use a 64 MiB hard limit rather than the Setup importer’s 2 MiB limit. Existing C600 fixtures demonstrate hundreds of Canon/state ledger and memory records, and a checkpoint may additionally contain plan, prose, validation, and extraction artifacts. Sixty-four MiB gives substantial headroom for these long projects while bounding the current one-shot browser `File.text()` and `JSON.parse()` design. The limit is enforced by actual UTF-8 bytes for both generated exports and imported/restored files. Files are rejected when empty or above the limit; streaming and encrypted archives are intentionally out of scope.

## Compatibility and privacy

- Existing Wizard, TXT/MD Setup import, offline V4 JSON import, and Setup export are unchanged.
- WORK15A migration, typed recovery, availability caching, switching, rename, and delete semantics remain in place.
- No Gemini/provider call or new dependency is used for backup/restore.
- No raw backup, secret, Canon, Memory, or artifact is logged in errors.
- Legacy `Sáng Tác / Creative` storage and behavior are untouched.
