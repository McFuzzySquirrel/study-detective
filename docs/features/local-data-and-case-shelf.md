# Feature: Local Data and Case Shelf

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| DATA-FR-01 | This feature | owns |
| DATA-FR-02 | This feature | owns |
| DATA-FR-03 | This feature | owns |
| DATA-FR-04 | This feature | owns |
| DATA-FR-05 | This feature | owns |
| DATA-FR-06 | This feature | owns |
| VIS-FR-06 | [Vision](../PRD.md) | participates |
| VIS-CON-01 | [Vision](../PRD.md) | participates |
| VIS-CON-09 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Local Data and Case Shelf
**ID Prefix:** DATA
**Summary:** Establishes the versioned local database, repository boundary, case model, case shelf, storage persistence and quota reporting, multi-tab refresh, and case deletion.
**Dependencies:** App Foundation
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| DATA-US-01 | Exam-focused university student | Must |
| DATA-US-02 | Returning reviser | Must |
| DATA-US-03 | High-school student | Must |

```forge-requirement
{"id":"DATA-US-01","kind":"story","text":"As a student, I want to create a case for one exam and see it on a shelf so that I know where to start each session."}
```

```forge-requirement
{"id":"DATA-US-02","kind":"story","text":"As a returning reviser, I want my cases and photos still there after closing the browser so that weeks of preparation are not lost."}
```

```forge-requirement
{"id":"DATA-US-03","kind":"story","text":"As a student with limited device storage, I want to see how much space the app uses so that I can back up or clean up before the browser refuses another photo."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"DATA-FR-01","kind":"requirement","text":"Store cases, cards, connections, embedded tags, and image attachments in a versioned Dexie database with transactional writes, compound indexes, referential integrity, and a tested migration path from an empty database."}
```

```forge-requirement
{"id":"DATA-FR-02","kind":"requirement","text":"Create, rename, and edit cases with a required title of 1 to 80 characters, optional subject and exam date, UUID identifiers, ISO timestamps, and a shelf ordered by nearest exam date with undated cases last, then by most recently modified."}
```

```forge-requirement
{"id":"DATA-FR-03","kind":"requirement","text":"Delete a case only after confirmation that names the case, card count, connection count, and image count; cascade cards, connections, and attachment Blobs in one transaction and offer no undo for case deletion."}
```

```forge-requirement
{"id":"DATA-FR-04","kind":"requirement","text":"Request persistent storage when the first case is created, show whether storage is persistent or best-effort, display usage and quota, and warn when usage exceeds 80 percent or persistence is denied."}
```

```forge-requirement
{"id":"DATA-FR-05","kind":"requirement","text":"Keep multiple open tabs consistent by broadcasting case mutation events and invalidating derived reads without overwriting a newer persisted write or an unsaved form in another tab."}
```

```forge-requirement
{"id":"DATA-FR-06","kind":"requirement","text":"Expose a repository boundary that isolates Dexie from React and can be exercised with fake-indexeddb in unit tests, including case summaries with card and connection counts; readiness counts are added by the closure feature."}
```

```forge-requirement
{"id":"DATA-CON-01","kind":"constraint","text":"Each user action that changes the graph or its attachments commits in one IndexedDB transaction; a partial card or dangling attachment is not acceptable."}
```

```forge-requirement
{"id":"DATA-CON-02","kind":"constraint","text":"The data layer performs no network calls and does not import React or feature UI modules."}
```

```forge-requirement
{"id":"DATA-CON-03","kind":"constraint","text":"Persist UUIDs as strings and dates as ISO 8601 strings; validate every record on read and write rather than trusting IndexedDB contents."}
```

---

## 4. UI / Interaction Design

- The shelf is the home route. It shows a responsive grid of case cards, an empty state with a single primary action, and a compact storage status strip.
- A case card shows title, subject, exam date, card count, connection count, readiness/closure badge, and last modified. The whole card is a link; edit and delete are separate buttons with 44px targets that do not nest inside the link.
- Create and edit use a dialog with title, subject, and optional exam date. Title validation is inline and announced. Escape cancels; focus returns to the trigger.
- Delete uses a destructive confirmation dialog that states exactly how many cards, strings, and images will be removed. There is no undo for case deletion; the dialog says so.
- Storage status shows `Persistent` or `Best effort`, a usage bar, and a warning above 80 percent. When persistence is denied, the backup prompt is more prominent on the shelf and case screen.
- Multi-tab refresh is silent: another tab's mutation invalidates the shelf and current case summary. A form being edited is never overwritten by a background refresh.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| DATA-1 | Validated domain records with stable IDs and dates | data-engineer | Model, validation, IDs, unit tests | Domain tests | No Dexie calls |
| DATA-2 | Dexie schema and repositories with Blob storage | data-engineer | DB, mappers, repositories, attachment store, tests | fake-indexeddb tests | No UI |
| DATA-3 | Working shelf with create and edit | ui-engineer | Shelf page, cards, form dialog, route, tests | Shelf tests | No delete or storage warnings |
| DATA-4 | Persistence, usage, warnings, multi-tab refresh | data-engineer | Persistence, estimate, broadcast hook, status, tests | Storage tests | No backup UI |
| DATA-5 | Confirmed cascade delete of a case | data-engineer | Delete dialog, transaction, tests | Delete tests | No undo |

---

## 6. Implementation Tasks

### Phase 1: Domain and persistence foundation

```forge-task
{
  "id": "DATA-1",
  "title": "Define validated case domain records",
  "description": "Create Zod schemas and TypeScript types for CaseRecord, CardRecord, ConnectionRecord, AttachmentRecord, Viewport, and CaseSummary. Enforce UUID strings, ISO timestamps, title lengths, subject and exam-date rules, card types note/source/topic, connection types association/provenance, canonical unordered connection pair keys, 0.25 to 2.5 viewport scale, and nonnegative card positions. Include optional isDemo defaulting to false and nullable backupPromptedAt on the case so later demo and backup features can use them. Add ID and clock helpers that use crypto.randomUUID and a test-injectable clock. Reject unknown fields and invalid tag arrays. Do not add Dexie or UI code.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "FND-1"
  ],
  "expectedOutputs": [
    "src/domain/model.ts",
    "src/domain/validation.ts",
    "src/domain/ids.ts",
    "tests/domain/model.test.ts",
    "tests/domain/validation.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/domain/model.test.ts tests/domain/validation.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/local-data-and-case-shelf.md#DATA-FR-01",
      "docs/features/local-data-and-case-shelf.md#DATA-FR-06",
      "docs/PRD.md#VIS-FR-06"
    ],
    "acceptanceCriteria": [
      "Valid records parse and invalid titles, dates, card types, connection types, viewport scales, and unknown fields are rejected",
      "Connection pair keys are identical for A-B and B-A",
      "IDs are UUID strings and dates round-trip as ISO strings",
      "isDemo defaults to false and backupPromptedAt is nullable and round-trips",
      "Tests cover every schema boundary and failure mode"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/local-data-and-case-shelf.md#DATA-CON-03"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture",
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

```forge-task
{
  "id": "DATA-2",
  "title": "Implement the Dexie schema and repositories",
  "description": "Create a Dexie v1 database with cases, cards, connections, and attachments tables and the indexes needed by the shelf and board: cases by updatedAt and examDate, cards by caseId and caseId+type, connections by caseId and a unique pairKey, attachments by cardId and cardId+kind. Implement mappers between persisted rows and domain records, a CaseRepository for case and card CRUD and case summaries with card and connection counts, and an AttachmentStore for original/display/thumbnail Blobs. Preserve isDemo, backupPromptedAt, tags, OCR fields when present, viewport, and closure metadata. Use one read-write transaction per mutation, validate on read and write, and expose an in-memory fake for tests. Do not import React, fetch, or feature modules.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "DATA-1"
  ],
  "expectedOutputs": [
    "src/data/db.ts",
    "src/data/mappers.ts",
    "src/data/caseRepository.ts",
    "src/data/attachmentStore.ts",
    "tests/data/dbMigration.test.ts",
    "tests/data/caseRepository.test.ts",
    "tests/data/attachmentStore.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/data/dbMigration.test.ts tests/data/caseRepository.test.ts tests/data/attachmentStore.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/local-data-and-case-shelf.md#DATA-FR-01",
      "docs/features/local-data-and-case-shelf.md#DATA-FR-06",
      "docs/PRD.md#VIS-FR-06"
    ],
    "acceptanceCriteria": [
      "A fresh fake-indexeddb database opens at schema version 1 with all four tables and indexes",
      "Case and card CRUD round-trip validated domain records; malformed stored rows are rejected",
      "isDemo, backupPromptedAt, tags, viewport, and closure metadata survive a repository round-trip",
      "Attachment Blobs round-trip with mime type, dimensions, byte size, and SHA-256 metadata",
      "A failed mutation leaves no partial rows or orphan attachments",
      "The data layer source imports neither React nor fetch"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/local-data-and-case-shelf.md#DATA-CON-01",
      "docs/features/local-data-and-case-shelf.md#DATA-CON-02"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

### Phase 2: Shelf and storage safety

```forge-task
{
  "id": "DATA-3",
  "title": "Build the case shelf with create and edit",
  "description": "Replace the shelf placeholder with CaseShelfPage, CaseShelf, CaseCard, and CaseFormDialog. Load case summaries from the repository, sort by nearest exam date with undated cases last and then by updatedAt descending, and render title, subject, exam date, counts, a closure badge when closedAt is present, and last modified. Add create and edit flows with inline title validation, optional subject and exam date, 44px actions, empty state, route wiring in src/app/routes.tsx, and a recoverable database-error state with Retry and import guidance. Do not implement case deletion, storage warnings, readiness counts, or backup actions.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "DATA-2",
    "FND-5"
  ],
  "expectedOutputs": [
    "src/features/shelf/CaseShelfPage.tsx",
    "src/features/shelf/CaseShelf.tsx",
    "src/features/shelf/CaseCard.tsx",
    "src/features/shelf/CaseFormDialog.tsx",
    "src/features/shelf/shelf.css",
    "src/app/routes.tsx",
    "tests/shelf/CaseShelf.test.tsx",
    "tests/shelf/CaseFormDialog.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/shelf/CaseShelf.test.tsx tests/shelf/CaseFormDialog.test.tsx",
    "npm run typecheck",
    "npm run build"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/local-data-and-case-shelf.md#DATA-FR-02"
    ],
    "acceptanceCriteria": [
      "The shelf route replaces the placeholder and renders persisted cases in the specified sort order",
      "Creating a case with a valid title persists it and opens or selects it; an empty title shows an announced error and does not write",
      "Editing subject or exam date updates the card and ordering",
      "The empty state exposes one primary create action and no dead controls",
      "An IndexedDB open or read failure shows a recoverable error with Retry and import guidance, not a silent empty shelf",
      "Case cards and action buttons are keyboard reachable with visible focus and 44px targets"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/PRD.md#VIS-CON-14",
      "docs/PRD.md#VIS-CON-08"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

```forge-task
{
  "id": "DATA-4",
  "title": "Add persistent storage, quota display, and multi-tab refresh",
  "description": "Implement persistence helpers that call navigator.storage.persist() on first case creation, report persistent or best-effort, and read navigator.storage.estimate(). Add a StorageStatus component to the shelf showing state, usage, quota, and an 80 percent warning. Add a BroadcastChannel-based useBroadcastSync hook that broadcasts case mutation events and invalidates shelf and case reads in other tabs without replacing an open unsaved form. Handle unsupported APIs with a clear best-effort state. Do not add backup export or import.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "DATA-3"
  ],
  "expectedOutputs": [
    "src/data/persistence.ts",
    "src/data/storageEstimate.ts",
    "src/data/useBroadcastSync.ts",
    "src/features/shelf/StorageStatus.tsx",
    "src/features/shelf/CaseFormDialog.tsx",
    "src/features/shelf/CaseShelf.tsx",
    "tests/data/persistence.test.ts",
    "tests/data/storageEstimate.test.ts",
    "tests/data/useBroadcastSync.test.tsx",
    "tests/shelf/StorageStatus.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/data/persistence.test.ts tests/data/storageEstimate.test.ts tests/data/useBroadcastSync.test.tsx tests/shelf/StorageStatus.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/local-data-and-case-shelf.md#DATA-FR-04",
      "docs/features/local-data-and-case-shelf.md#DATA-FR-05"
    ],
    "acceptanceCriteria": [
      "First case creation calls persist once and displays persistent or best-effort accurately",
      "Usage, quota, and percentage render from estimate; above 80 percent shows a warning with a backup call to action slot",
      "Unsupported storage APIs render best-effort with no crash",
      "A BroadcastChannel mutation event invalidates another tab's reads, while an open form retains its draft",
      "Tests cover granted, denied, unsupported, high-usage, and cross-tab invalidation paths"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/PRD.md#VIS-CON-09",
      "docs/features/local-data-and-case-shelf.md#DATA-CON-02"
    ],
    "references": [
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

```forge-task
{
  "id": "DATA-5",
  "title": "Implement confirmed cascade deletion of a case",
  "description": "Add DeleteCaseDialog and a deleteCase transaction that removes the case, its cards, its connections, and all attachment Blobs in one read-write transaction. The dialog names the case, card count, connection count, and image count, warns that deletion cannot be undone, focuses Cancel by default, and restores focus on close. Wire delete actions into CaseCard and CaseShelf. Do not add an undo path or archive behavior.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "DATA-4"
  ],
  "expectedOutputs": [
    "src/features/shelf/DeleteCaseDialog.tsx",
    "src/data/deleteCase.ts",
    "src/features/shelf/CaseShelf.tsx",
    "src/features/shelf/CaseCard.tsx",
    "tests/shelf/DeleteCaseDialog.test.tsx",
    "tests/data/deleteCase.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/shelf/DeleteCaseDialog.test.tsx tests/data/deleteCase.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/local-data-and-case-shelf.md#DATA-FR-03"
    ],
    "acceptanceCriteria": [
      "The confirmation displays the exact card, connection, and image counts and states that deletion is permanent",
      "Confirming removes the case and every dependent row and Blob in one transaction",
      "Cancelling or pressing Escape leaves all data unchanged and restores focus to the delete trigger",
      "A simulated failure mid-delete leaves the case and all dependents intact",
      "No undo action is offered for case deletion"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/local-data-and-case-shelf.md#DATA-CON-01"
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
| Unit | Domain schemas, IDs, sorting, pair keys, persistence helpers | Vitest with injected clocks and fake APIs |
| Data | Dexie migrations, repositories, attachment Blobs, cascade delete | fake-indexeddb with transaction-failure tests |
| Component | Shelf, form, storage status, delete dialog, cross-tab refresh | React Testing Library with user-event |
| Browser | Shelf persistence across reload and route reachability | Playwright smoke added by later feature journeys |

Key scenarios:

1. Create a case, reload, and see the same case with the same timestamps.
2. An invalid title never writes and announces the error.
3. A denied persistence request shows best-effort and a backup warning.
4. A failed delete transaction leaves no partial data.
5. A second tab receives an invalidation without losing a draft.

---

## 8. Acceptance Criteria

1. A case persists across reload and appears in the correct shelf order.
2. Every write is transactional; no partial card, orphan attachment, or dangling case row survives a failure.
3. The shelf shows storage state and warns above 80 percent or when persistence is denied.
4. Deleting a case requires a count-aware confirmation and removes all dependents with no undo.
5. Multi-tab changes refresh derived reads without overwriting a draft.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should exam dates drive a countdown? | No; display and sort only. |
| 2 | Should the shelf group by subject? | No grouping in v1; a flat sorted grid is enough. |
| 3 | Should case deletion be undoable? | No; the destructive confirmation is explicit and names the counts. |
