# Feature: Backup and Restore

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| BACKUP-FR-01 | This feature | owns |
| BACKUP-FR-02 | This feature | owns |
| BACKUP-FR-03 | This feature | owns |
| BACKUP-FR-04 | This feature | owns |
| BACKUP-FR-05 | This feature | owns |
| BACKUP-FR-06 | This feature | owns |
| VIS-FR-06 | [Vision](../PRD.md) | participates |
| VIS-CON-09 | [Vision](../PRD.md) | participates |
| VIS-CON-11 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Backup and Restore
**ID Prefix:** BACKUP
**Summary:** Exports exactly one case to a versioned `.ndcase` ZIP, validates and restores it as a copy or an explicit replacement, and prompts once per case when the board is worth losing.
**Dependencies:** Local Data and Case Shelf, Evidence Capture
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| BACKUP-US-01 | Exam-focused university student | Must |
| BACKUP-US-02 | Returning reviser | Must |

```forge-requirement
{"id":"BACKUP-US-01","kind":"story","text":"As a student, I want to save one case to a file so that a browser cleanup cannot erase a week of exam preparation."}
```

```forge-requirement
{"id":"BACKUP-US-02","kind":"story","text":"As a reviser, I want to restore a case from a file without accidentally overwriting the copy on my device so that recovery is safe."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"BACKUP-FR-01","kind":"requirement","text":"Export exactly one case as a .ndcase ZIP containing a versioned manifest and all case, card, connection, tag, closure, viewport, OCR, and image attachment data, with no other case included."}
```

```forge-requirement
{"id":"BACKUP-FR-02","kind":"requirement","text":"Validate an imported archive before writing: ZIP structure, manifest schema and version, SHA-256 checksums, path safety, entry count, total size, per-entry size, unique entries, and required image references."}
```

```forge-requirement
{"id":"BACKUP-FR-03","kind":"requirement","text":"Restore an imported case as a fresh copy with new case, card, connection, and attachment IDs by default; allow an explicit replace of an existing case by ID only after confirmation, and make replacement transactional."}
```

```forge-requirement
{"id":"BACKUP-FR-04","kind":"requirement","text":"Show stage progress and actionable errors for export and import, and offer an Open case action on successful import."}
```

```forge-requirement
{"id":"BACKUP-FR-05","kind":"requirement","text":"Prompt once per case after it reaches 5 cards and 1 connection through the Case menu First backup section, one attention dot, and one session toast; persist dismissal or completion on the case, and never show the same prompt again for that case."}
```

```forge-requirement
{"id":"BACKUP-FR-06","kind":"requirement","text":"Operate entirely on-device using the File System Access API when available and a download/file-input fallback otherwise; never upload the archive."}
```

```forge-requirement
{"id":"BACKUP-CON-01","kind":"constraint","text":"The backup path performs no network request and does not use a cloud file picker."}
```

```forge-requirement
{"id":"BACKUP-CON-02","kind":"constraint","text":"Import never overwrites an existing case unless the user explicitly chooses Replace and confirms with the case title."}
```

```forge-requirement
{"id":"BACKUP-CON-03","kind":"constraint","text":"Reject archive paths containing traversal, absolute roots, backslashes, duplicate names, or entries outside manifest.json and images/."}
```

---

## 4. UI / Interaction Design

- Export is available from a case and from the shelf row menu. It opens a save dialog or triggers a download named `<case-slug>-<yyyy-mm-dd>.ndcase`.
- Import is available from the shelf. The file picker accepts `.ndcase`. After validation, a summary shows case title, card count, connection count, image count, and exported date.
- Default action is `Restore as a copy`. If an archived case ID already exists, a secondary `Replace existing case` option appears with the existing title and requires a typed confirmation.
- Progress is stage-based: Reading archive, Checking integrity, Restoring images, Restoring cards, Done. Errors name the failed stage and keep the existing data untouched.
- Success shows `Open case` and `Back to shelf`.
- The backup reminder is the Case menu `First backup` section plus one attention dot and one toast per case per page session. `Back up now` opens export; `Not now` dismisses for that case permanently. It never adds page height or blocks editing.
- The archive contains private notes. The UI states that the file is not encrypted and should be stored somewhere trusted.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| BACKUP-1 | Deterministic single-case archive with checksums | data-engineer | Format, export builder, tests | Round-trip unit test | No UI |
| BACKUP-2 | Validated copy/replace restore with atomic failure | data-engineer | Validation, import transaction, tests | Unit and failure tests | No UI |
| BACKUP-3 | Export/import dialog, progress, reminder | ui-engineer | Dialog, reminder hook, shelf/case wiring, tests | Component tests | No browser journey |
| BACKUP-4 | End-to-end export, delete, restore, replace | qa-engineer | Playwright backup spec | Playwright | No new product code |

---

## 6. Implementation Tasks

### Phase 1: Archive format and export

```forge-task
{
  "id": "BACKUP-1",
  "title": "Implement the single-case archive format and exporter",
  "description": "Create archiveFormat.ts with a Zod-validated manifest for format notes-detective-case, formatVersion 1, exportedAt, appVersion, dbSchemaVersion, the case record, cards, connections, and attachment metadata with SHA-256 and relative image paths. The case record includes isDemo and backupPromptedAt. Create exportCase.ts to load exactly one case and its attachments, hash each Blob, and build a ZIP with manifest.json plus images/<attachmentId>.<ext> using fflate. Include tags, positions, viewport, closure state, OCR fields, and the demo marker. Expose save via File System Access when available and a Blob download fallback. Add tests that unzip the result, validate the manifest, verify checksums, and prove no other case is included.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "CAP-4",
    "DATA-4"
  ],
  "expectedOutputs": [
    "src/features/backup/archiveFormat.ts",
    "src/features/backup/exportCase.ts",
    "tests/backup/exportCase.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/backup/exportCase.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/backup-and-restore.md#BACKUP-FR-01",
      "docs/features/backup-and-restore.md#BACKUP-FR-06",
      "docs/PRD.md#VIS-FR-06"
    ],
    "acceptanceCriteria": [
      "The archive contains manifest.json and only images belonging to the selected case",
      "Every attachment entry has a SHA-256 that matches its bytes and a safe relative path",
      "Tags, positions, viewport, closure, OCR, isDemo, and backupPromptedAt survive the manifest round-trip",
      "The saved file has the .ndcase extension and a dated case-slug name",
      "No network API is called during export"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/backup-and-restore.md#BACKUP-CON-01",
      "docs/PRD.md#VIS-CON-13"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

### Phase 2: Import and restore

```forge-task
{
  "id": "BACKUP-2",
  "title": "Implement validated copy and replace restore",
  "description": "Create importValidation.ts to parse a ZIP, reject unsafe or duplicate paths, enforce at most 500 entries, 250 MB total, 50 MB per entry, require manifest.json, validate the manifest with Zod, check formatVersion and dbSchemaVersion, verify every SHA-256, and require every referenced image. Create importCase.ts with copy mode remapping every case, card, connection, and attachment ID, and replace mode that deletes the existing case and writes the archive in one transaction. Validate and verify everything before the write. Add tests for valid copy, ID remapping, missing/corrupt image, bad checksum, traversal, absolute path, duplicate entry, too many entries, oversized entry, unsupported version, and mid-write rollback.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "BACKUP-1"
  ],
  "expectedOutputs": [
    "src/features/backup/importValidation.ts",
    "src/features/backup/importCase.ts",
    "tests/backup/importCase.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/backup/importCase.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/backup-and-restore.md#BACKUP-FR-02",
      "docs/features/backup-and-restore.md#BACKUP-FR-03"
    ],
    "acceptanceCriteria": [
      "Copy restore creates a new case ID and remaps every card and connection reference consistently",
      "Replace restore is rejected unless replace mode and the existing case title are confirmed by the caller",
      "Every unsafe path, duplicate entry, checksum mismatch, missing image, size violation, and unsupported version fails before a write",
      "A failure during the write leaves the prior database state intact",
      "The restored graph has no dangling endpoints or missing attachments"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/backup-and-restore.md#BACKUP-CON-02",
      "docs/features/backup-and-restore.md#BACKUP-CON-03",
      "docs/PRD.md#VIS-CON-11"
    ],
    "references": [
      "docs/PRD.md#8. Security and Privacy"
    ]
  }
}
```

### Phase 3: UI and browser journey

```forge-task
{
  "id": "BACKUP-3",
  "title": "Build the backup dialog, progress, and once-per-case reminder",
  "description": "Create BackupDialog with export, import, archive summary, copy/replace choice, typed replace confirmation, stage progress, actionable errors, and Open case on success. Add useBackupReminder that triggers once when a case has at least 5 cards and 1 connection, writes backupPromptedAt on dismiss or successful export, and never shows again for that case. Wire export and import actions into CaseShelf and CaseBoardPage and render the reminder banner there. Use File System Access when available and a file input/download fallback otherwise. Add component tests for copy, replace, cancel, errors, reminder trigger, dismissal, and no repeat. Do not add the browser journey.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "BACKUP-2"
  ],
  "expectedOutputs": [
    "src/features/backup/BackupDialog.tsx",
    "src/features/backup/BackupDialog.css",
    "src/features/backup/useBackupReminder.ts",
    "src/features/shelf/CaseShelf.tsx",
    "src/features/case/CaseBoardPage.tsx",
    "tests/backup/BackupDialog.test.tsx",
    "tests/backup/useBackupReminder.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/backup/BackupDialog.test.tsx tests/backup/useBackupReminder.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/backup-and-restore.md#BACKUP-FR-04",
      "docs/features/backup-and-restore.md#BACKUP-FR-05"
    ],
    "acceptanceCriteria": [
      "The archive summary shows title, card, connection, and image counts plus exported date",
      "Copy is the default and replace requires an explicit choice plus typed title confirmation",
      "Progress shows each stage and an error names the failed stage without clearing existing data",
      "Success offers Open case; the reminder appears once at 5 cards plus 1 connection and never repeats after dismiss or export",
      "Dismissal or successful export persists backupPromptedAt on the case",
      "The fallback download and file input work when File System Access is unavailable",
      "No archive is uploaded"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/backup-and-restore.md#BACKUP-CON-01",
      "docs/features/backup-and-restore.md#BACKUP-CON-02"
    ],
    "references": [
      "docs/PRD.md#8. Security and Privacy"
    ]
  }
}
```

```forge-task
{
  "id": "BACKUP-4",
  "title": "Verify export, delete, copy restore, and replace in a browser",
  "description": "Add a Playwright journey that creates a case with at least two images, tags, and two strings, exports it through the dialog, captures the downloaded file, deletes the case, imports the archive as a copy, and verifies every card, string, tag, position, and image. Then import the same archive in replace mode against the restored case, confirm the title, and verify there is exactly one case with the expected data. Use the generated archive bytes, not a mock. Do not add product code.",
  "ownerAgent": "qa-engineer",
  "dependencies": [
    "BACKUP-3"
  ],
  "expectedOutputs": [
    "e2e/backup.spec.ts"
  ],
  "validationCommands": [
    "npm run test:e2e -- e2e/backup.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/backup-and-restore.md#BACKUP-FR-01",
      "docs/features/backup-and-restore.md#BACKUP-FR-02",
      "docs/features/backup-and-restore.md#BACKUP-FR-03",
      "docs/features/backup-and-restore.md#BACKUP-FR-06"
    ],
    "acceptanceCriteria": [
      "The exported download is a non-empty .ndcase file that the app imports without mocks",
      "Copy restore recreates cards, strings, tags, positions, closure, and images with new IDs",
      "Replace restore leaves exactly one matching case and removes the old copy",
      "The test fails on any missing card, string, tag, position, or image"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/backup-and-restore.md#BACKUP-CON-01",
      "docs/features/backup-and-restore.md#BACKUP-CON-02"
    ],
    "references": [
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Manifest schema, checksums, ZIP paths, copy remapping, replace transaction | Vitest with real fflate archives and fake-indexeddb |
| Component | Dialog states, replace confirmation, progress, reminder | React Testing Library |
| Browser | Real export/download, delete, import copy, replace | Playwright with download handling |
| Manual | Store the archive somewhere trusted and reopen on a tablet | Final acceptance review |

Key scenarios:

1. Export one case and prove no other case leaked into the archive.
2. Reject a traversal path and a checksum mismatch before write.
3. Copy restore remaps every reference.
4. Replace restores transactionally and removes the old copy.
5. Reminder fires once and never repeats for that case.

---

## 8. Acceptance Criteria

1. Any case exports to a `.ndcase` ZIP with a versioned manifest and checksummed images.
2. Import validates everything before writing and rejects unsafe or corrupt archives.
3. Copy is the default restore; replace requires explicit title confirmation.
4. Export and import are fully local and show actionable progress and errors.
5. The backup reminder appears once per case and never blocks editing.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should archives be encrypted? | Not in v1; the UI warns and encryption is future work. |
| 2 | Should whole-library export exist? | No; one case per archive. |
| 3 | What is the archive size limit? | 250 MB total and 50 MB per entry. |
