# Domain contracts

Use this reference when defining or reviewing persisted records and pure derivation rules.

## Record shapes

| Record | Required fields | Rules |
|--------|-----------------|-------|
| `CaseRecord` | `id`, `title`, `createdAt`, `updatedAt`, `viewport`, `isDemo`, `backupPromptedAt` | UUID id; title 1-80 trimmed; optional `subject` and `examDate`; nullable `closedAt`; optional `subject`; viewport scale 0.25-2.5 |
| `CardRecord` | `id`, `caseId`, `type`, `title`, `position`, `tags` | type `note`/`source`/`topic`; title 1-80; nonnegative x/y; tags at most 10, each at most 24 trimmed characters |
| `ConnectionRecord` | `id`, `caseId`, `fromCardId`, `toCardId`, `pairKey`, `type` | type `association`/`provenance`; endpoints must exist in the same case; one row per unordered pair |
| `AttachmentRecord` | `id`, `cardId`, `kind`, `mime`, `width`, `height`, `bytes`, `sha256`, `blob` | kind `original`/`display`/`thumbnail`; exactly one of each for an image card |
| `Viewport` | `x`, `y`, `scale` | scale clamped 0.25-2.5; serializable plain object |

Case title, subject, and exam date are the only case metadata a student edits. `closedAt` and `backupPromptedAt` are nullable ISO timestamps written only by their owning flows. `isDemo` defaults to `false` and survives export and import.

## Canonical connection key

Sort the two card UUID strings lexicographically and join them with a delimiter that cannot occur in a UUID, for example `a1b2...::c3d4...`. The key must be identical for A-B and B-A. Store it, index it uniquely per case, and reject a second row even when the requested type differs.

Association eligibility: two distinct cards in the same case, any types.
Provenance eligibility: exactly one Study Note and one Source. A note-to-note, source-to-source, note-to-topic, or topic-to-topic provenance is invalid.

## Readiness

Inputs: all cards in the case plus all connections in the case. No stored counters.

- **Study Note ready** when it has at least one provenance connection to a Source and at least one association connection to a Topic.
- **Study Note loose** with reason `no-source-link`, `no-topic-connection`, or both when duplicated.
- **Topic loose** with reason `no-connections` only when its total connection count is zero.
- **Topic status** from distinct linked notes: `orphan` = 0, `developing` = 1, `solved` = 2 or more. A topic with one connection to a Source and no note connections is not loose and is still `orphan`.
- **Source** never appears in a loose-thread list and never carries a topic badge.

Return stable ordering (for example case order or title) so lists and tests do not reshuffle between reads.

## Lifecycle

`open` is the absence of `closedAt`. Closing is allowed only when the loose-thread count is zero and writes `closedAt`. A closed case stays fully editable, recallable, and exportable.

If an edit creates a loose thread in a closed case, then keep `closedAt` and expose `Closed · loose threads`. Repairing the graph re-enables Close without a reopen. Manual Reopen requires confirmation and clears `closedAt`. Never auto-reopen, archive, or delete a case because of its exam date.

## Tags

Normalize by trimming surrounding whitespace. Reject empty tags and tags over 24 characters. Reject an eleventh tag. Deduplicate case-insensitively, preserving the first display casing. Tags live on cards inside one case, not in a global dictionary.

## Search and filters

Search title, tags, and stored OCR text case-insensitively. Never search image pixels, connection types, or provenance labels. Missing OCR text is no match, not an error and not an empty string that throws.

Combine query AND type AND tag group. Inside the tag group, selected tags match with OR. Debounce query changes at 150ms and apply type/tag changes immediately. Search is read-only and allocates no repository writes.

## Ordering

Shelf order: nearest exam date first, undated last, then most recently modified. Never reorder by readiness or closed state; the badge is display metadata.
