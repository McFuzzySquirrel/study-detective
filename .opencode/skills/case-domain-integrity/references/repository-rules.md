# Repository rules

Use this reference when implementing or reviewing Dexie schema, repositories, attachment storage, persistence, and cross-tab behavior.

## Schema and indexes

The v1 database has `cases`, `cards`, `connections`, and `attachments` tables. Minimum indexes:

- `cases`: `id`, `updatedAt`, `examDate`
- `cards`: `id`, `caseId`, `[caseId+type]`
- `connections`: `id`, `caseId`, unique `[caseId+pairKey]`, `fromCardId`, `toCardId`
- `attachments`: `id`, `cardId`, `[cardId+kind]`

A schema version bump ships with a migration test from the previous version, not only from an empty database. Mappers convert persisted rows to domain records and back; do not expose Dexie row types to React.

## Transaction rules

- One read-write transaction per user action that changes the graph or its attachments.
- Case delete: cases + cards + connections + attachment Blobs in one transaction.
- Card delete: card + its connections + its Blobs in one transaction.
- Card create with media: card + original + display + thumbnail in one transaction.
- Attachment replace: write the new Blobs and update metadata first, then delete the old Blobs after the transaction commits.
- Connection create/retype/delete: one transaction, endpoint validation inside it.
- Import restore: validate and verify everything, then write the whole case in one transaction; a failure rolls back the prior state.

Never open a transaction from a component, a Pixi scene, or a store action. Components call repository methods and render the returned result.

## Read validation

Parse every row with the Zod schema on read. If a row is malformed, then return a typed storage error with a retry path; do not drop the row silently or return a partially built case. Case summaries include card and connection counts, and closure adds readiness/loose-thread counts from the pure selectors.

## Attachment storage

`AttachmentStore` owns Blob reads and writes by attachment ID and kind. Store MIME type, width, height, byte size, and SHA-256 alongside the Blob. Never keep an attachment row without bytes, or bytes without a row. Revoke object URLs in the view that created them when it unmounts or a replacement succeeds.

## Persistence and quota

Request `navigator.storage.persist()` when the first case is created. Read `navigator.storage.estimate()` for usage and quota. Surface four states: `persistent`, `best-effort`, `warning` above 80 percent usage, and `error` when IndexedDB cannot open or a read fails. A denied persistence request is not a crash; it promotes the backup reminder.

## Multi-tab consistency

Broadcast a small mutation event after a successful commit. Other tabs invalidate the shelf and current case summary and re-read. Never overwrite a newer persisted write, and never replace an unsaved form draft. If a tab receives an event while a dialog is dirty, then defer the refresh until the dialog closes or the draft is saved.

## Testing contract

Use `fake-indexeddb` for real schema, transaction, and failure behavior. Inject a transaction failure to prove rollback. Assert zero orphan rows and zero dangling endpoints after every cascade. Keep the in-memory fake only for pure UI tests; it is not evidence that the Dexie path works.

## Boundaries

`src/domain` and `src/data` import no React, no feature UI, and no network API. Only `CaseRepository`, `ConnectionRepository`, and `AttachmentStore` write. A UI module that imports Dexie directly is a defect even if it passes its test.
