# Import hardening

Use this reference for parsing, validating, restoring, and rollback.

## Validation order

1. **Container:** readable ZIP; not encrypted; at most 500 entries.
2. **Sizes:** total at most 250 MB; each entry at most 50 MB; no zero-byte manifest.
3. **Names:** exactly `manifest.json`; all other entries match `images/<safe-name>.<ext>`; no absolute roots, `..`, backslashes, duplicate names, control characters, or nested directories.
4. **Manifest schema:** Zod parse with unknown-field rejection; `format`, `formatVersion`, `appVersion`, `dbSchemaVersion`, `case`, `cards`, `connections`, `attachments` present.
5. **Version:** supported `formatVersion` and `dbSchemaVersion`; otherwise fail with the supported range.
6. **Graph:** case ID consistent; every card belongs to the case; every connection endpoint exists; every pair key canonical and unique; provenance endpoints legal; no duplicate pair.
7. **Attachments:** every referenced image exists, no unreferenced image is required, kind set is complete for image cards, MIME is allowed, bytes match.
8. **Checksums:** SHA-256 over exact bytes for every image; manifest size agrees.
9. **Write:** only after all of the above.

Fail with a stage name (`Reading archive`, `Checking integrity`, `Restoring images`, `Restoring cards`) and an actionable reason. Existing data stays untouched.

## Copy restore

Generate a fresh case ID. Build maps `oldCaseId → newCaseId`, `oldCardId → newCardId`, `oldAttachmentId → newAttachmentId`. Remap every reference:

- card `caseId`,
- connection `caseId`, `fromCardId`, `toCardId`,
- attachment `cardId`,
- recompute `pairKey` from the new endpoint IDs (sort + join).

Preserve titles, types, tags, positions, viewport, closure state, OCR text/metadata, `isDemo`, and `backupPromptedAt` unless the copy should reset the prompt. Copy is the default and never overwrites existing data.

## Replace restore

Allowed only when `archive.case.id` already exists and the caller passes replace mode. Require typed confirmation of the existing case title in the UI and pass that confirmation into the import boundary; the repository does not trust a boolean alone.

In one transaction:

1. Delete the existing case, its cards, connections, and attachment Blobs.
2. Write the archive's case, cards, connections, and attachments.
3. Recompute pair keys and validate endpoints inside the transaction.

If any step throws, roll back to the prior state. Do not delete first and validate later.

## Rollback

Validate and verify everything outside the transaction, but still validate endpoint existence and uniqueness inside it. A failure at image write, card write, or connection write must leave the previous case byte-for-byte equivalent. Test with an injected throw after the delete and after the first card write.

## UI contract

The import summary shows case title, card count, connection count, image count, and exported date. Default action is `Restore as a copy`. If the ID exists, show `Replace existing case` with the existing title and a typed confirmation. Stage progress is visible; errors name the stage; success offers `Open case` and `Back to shelf`.

Accept only `.ndcase` in the file picker, but never trust the extension inside validation.

## Size and denial-of-service limits

- 500 entries total.
- 250 MB archive total.
- 50 MB per entry.
- Reject a compression ratio that expands beyond the total limit before allocating the full output if the library supports streaming; at minimum check declared sizes.

## Test matrix

Valid copy; ID remapping; missing image; corrupt image; bad checksum; traversal; absolute path; backslash; duplicate entry; 501 entries; oversized total; oversized entry; unsupported format; unsupported schema; duplicate pair after remap collision; replace without confirmation; replace title mismatch; failure after delete; failure after first card write.

Every failure asserts: case count unchanged, attachment count unchanged, and a retry can still succeed.
