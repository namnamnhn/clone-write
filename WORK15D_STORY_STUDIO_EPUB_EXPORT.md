# WORK15D — Story Studio Canon → EPUB

## Publication source

Story Studio EPUB publishing reads only durable Canon. For chapter `N`, public prose is
`memory.records[N - 1].raw.text` and the optional public title is
`chapterMetadata[N - 1].title`. The exported range is exactly `1..state.currentChapter`.

Plans, drafts, validation results, extraction proposals, Setup/StoryControl data, structured
Narrative Memory, workflow state, batch queues, identities, local project IDs, and Author Secrets
are never projected into the publication model.

## Adapter and EPUB reuse

`storyStudioEpubPublication.ts` performs an O(number of Canon chapters) validation/copy into a
small publication snapshot and compatible `FileItem` projection. It requires exact, contiguous
record and metadata numbering and fails closed if any canonical chapter is missing, empty,
duplicated, or out of order.

The projection supplies each Canon metadata title separately through `epubDisplayTitle`. The
existing EPUB generator uses that title exactly once and removes an already-present prose heading,
while legacy EPUB inputs without this optional field keep their prior title-detection behavior.

Story Studio opens the existing `EpubPreviewModal`, including manual cover, font, title-page,
divider, drop-cap, and design controls. It does not expose the AI cover callback. The default title
is the current catalog display name; author is deliberately blank until the user enters public
publication metadata.

## Pending chapters and read-only behavior

Only explicit Make Canon results are included. A planned, drafted, validated, rejected, extracted,
or ready-for-canon-review next chapter is excluded. Publishing never calls Make Canon, changes a
workflow, pauses/resumes a batch, or writes project timestamps or identities.

The controller refuses to create a publication snapshot during model or durability transitions.
The UI also blocks opening or confirming publication while saving, after a save error, or while an
operation is active. Generation uses the copied snapshot and performs no project persistence.

## Privacy and offline operation

EPUB generation is local and calls neither Gemini nor DeepSeek. The EPUB ZIP can contain only
canonical prose, canonical public chapter titles, publication metadata entered in the modal, and
user-selected design assets. Errors are generic and never include project JSON or story content.

## Backup/restore semantics

A WORK15C continuation clone receives a new browser-local project ID but retains the same durable
Canon. Consequently, source and restored clone produce equivalent publication chapters. The local
ID and continuation envelope are not EPUB content.

## Limitations

WORK15D exports one active Story Studio project as EPUB. It does not provide publishing history,
whole-library export, cloud upload, DRM, PDF, MOBI, AZW3, or AI cover generation.
