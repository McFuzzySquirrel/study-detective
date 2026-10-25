---
name: local-first-backup-archive
description: "Versioned .ndcase ZIP export and hardened import validation with checksums, path-safety, ID remapping, copy-versus-replace semantics, and rollback."
---

# Local-First Backup Archive

Use this skill for the Notes Detective `.ndcase` path: exporting exactly one case, validating an untrusted archive before any write, restoring as a copy or an explicit replacement, and prompting for backup once per case. The archive is the product's main data-loss mitigation, so it must be deterministic, checksummed, local-only, and transactional.

Load `references/archive-format.md` when defining or changing the manifest, image entries, export naming, checksums, or round-trip fields.

Load `references/import-hardening.md` when implementing ZIP parsing, path safety, size limits, schema/version checks, ID remapping, copy/replace, rollback, or the import UI contract.

## Process

### Step 1: Freeze the single-case shape

Export exactly one case and only its attachments. The archive contains `manifest.json` plus `images/<attachmentId>.<ext>`. The manifest carries `format: "notes-detective-case"`, `formatVersion: 1`, `exportedAt`, `appVersion`, `dbSchemaVersion`, the case record, cards, connections, and attachment metadata with SHA-256 and relative image paths.

Include tags, positions, viewport, closure metadata, OCR text and metadata, `isDemo`, and `backupPromptedAt`. Exclude every other case, card, connection, and Blob. Name the file `<case-slug>-<yyyy-mm-dd>.ndcase`.

### Step 2: Build the export deterministically

Load the case and its attachments through the repository, hash each Blob with SHA-256, and build the ZIP with `fflate`. Preserve the same JSON key order and stable entry order for identical input so a round-trip test can compare. Save through the File System Access API when available and a Blob download fallback otherwise. Never touch the network, a cloud picker, or a server.

If the user cancels the save dialog, then report cancellation, keep the case untouched, and do not mark the backup prompt as completed.

### Step 3: Validate everything before writing

Parse the ZIP and reject absolute paths, traversal (`..`), backslashes, duplicate entry names, entries outside `manifest.json` and `images/`, more than 500 entries, more than 250 MB total, or more than 50 MB per entry.

Validate the manifest with Zod. Check `format`, `formatVersion`, `dbSchemaVersion`, every checksum, every referenced image, and every graph endpoint before opening the write transaction. If any check fails, then show the failed stage, leave existing data untouched, and name an actionable reason.

### Step 4: Choose copy or explicit replace

Default to copy: generate a new case ID and remap every card, connection, and attachment ID consistently, including `fromCardId`, `toCardId`, `cardId`, and `pairKey`. An imported pair key must be recomputed from remapped IDs, not copied.

Replace is available only when the archived case ID already exists. It requires an explicit choice plus typed confirmation of the existing case title, deletes the existing case and its dependents, and writes the archive in one transaction. If the write fails, then leave the prior database state intact.

### Step 5: Prompt and verify

Trigger the backup reminder once when a case reaches at least 5 cards and 1 connection. Persist `backupPromptedAt` on dismissal or successful export and never show it again for that case. It is non-blocking and never prevents editing.

```bash
npm test -- tests/backup/exportCase.test.ts tests/backup/importCase.test.ts
npm test -- tests/backup/BackupDialog.test.tsx tests/backup/useBackupReminder.test.tsx
npm run test:e2e -- e2e/backup.spec.ts
npm run typecheck
```

If that doesn't work because the browser download path differs in CI, then keep the real archive bytes in the test and adapt only the download capture, not the archive format.

## Gotchas

- **Path checks are not prefix checks.** Reject `../x`, `/abs`, `C:\x`, `images\\..\\x`, and a duplicate `manifest.json` before extraction. A normalized path that still escapes `images/` is an attack.
- **Checksums must be verified on the exact bytes written.** Hashing the decoded image or the manifest's claimed size misses a corrupt or swapped entry.
- **Copy mode must recompute pair keys.** Copying `pairKey` from the archive leaves keys pointing at old card IDs and breaks uniqueness or produces dangling links.
- **Replace must be one transaction after validation.** Deleting the old case before validation turns one bad entry into permanent data loss.
- **A missing image is not a warning.** Every attachment referenced by a card must have an entry; a restored card with a broken image is a failed import.
- **`formatVersion` and `dbSchemaVersion` are different promises.** A newer app can read an older archive only through an explicit migration; reject unsupported versions instead of guessing.
- **The archive is private and unencrypted.** State that clearly and never auto-export, auto-share, or upload it.
- **The prompt is once per case, not once per session.** Persist `backupPromptedAt` on the case so a reload does not nag again.
- **Cancelling a save is not a successful backup.** Do not set the prompt marker when the save dialog is dismissed.
- **Exporting from the shelf row must not export the whole shelf.** Exactly one case per archive in v1; whole-library export is out of scope.

## Validation

- [ ] The archive contains `manifest.json` and only the selected case's images.
- [ ] Every attachment checksum matches its bytes and every path is relative and safe.
- [ ] Tags, positions, viewport, closure, OCR, `isDemo`, and `backupPromptedAt` survive round-trip.
- [ ] Copy restore creates new IDs and remaps cards, connections, attachments, and pair keys.
- [ ] Replace refuses without explicit mode plus typed title confirmation, and rolls back on failure.
- [ ] Traversal, absolute path, backslash, duplicate entry, missing image, bad checksum, 501 entries, 250 MB total, 50 MB entry, and unsupported version all fail before a write.
- [ ] The Playwright journey exports real bytes, deletes, restores a copy, then replaces and verifies one case.
- [ ] The reminder fires once at 5 cards plus 1 connection and never repeats.
- [ ] No network request occurs during export or import.

Self-check: open a produced archive in a ZIP inspector and confirm there is no second case, no absolute path, and no entry outside the two allowed locations.
