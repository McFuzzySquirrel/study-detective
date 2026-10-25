# Feature: Optional OCR

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| OCR-FR-01 | This feature | owns |
| OCR-FR-02 | This feature | owns |
| OCR-FR-03 | This feature | owns |
| OCR-FR-04 | This feature | owns |
| OCR-FR-05 | This feature | owns |
| VIS-CON-01 | [Vision](../PRD.md) | participates |
| VIS-CON-07 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Optional OCR
**ID Prefix:** OCR
**Summary:** Adds on-device, user-triggered English OCR with bundled tesseract.js assets, explicit title suggestions, searchable text, and backup inclusion.
**Dependencies:** Evidence Capture, Search Tags and Filters, Backup and Restore
**Priority:** Should

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| OCR-US-01 | Exam-focused university student | Should |
| OCR-US-02 | Returning reviser | Should |

```forge-requirement
{"id":"OCR-US-01","kind":"story","text":"As a student, I want the app to read the first line of a clear note so that I do not have to type a title on a tablet."}
```

```forge-requirement
{"id":"OCR-US-02","kind":"story","text":"As a reviser, I want OCR text to be searchable so that I can find a card by a phrase I remember from the page."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"OCR-FR-01","kind":"requirement","text":"Keep OCR off by default and run it only when the user triggers it for one image or card; never run OCR automatically at import, on a timer, or in bulk."}
```

```forge-requirement
{"id":"OCR-FR-02","kind":"requirement","text":"Run tesseract.js in a Web Worker with bundled English traineddata, worker script, and wasm core; make no upload and no runtime download, and precache the assets for offline use."}
```

```forge-requirement
{"id":"OCR-FR-03","kind":"requirement","text":"Fill the card title automatically only when it is empty; otherwise show the suggested title with an explicit Apply action and never overwrite an edited title. Store OCR text, confidence, engine version, and timestamp with the card."}
```

```forge-requirement
{"id":"OCR-FR-04","kind":"requirement","text":"Show OCR text, confidence, and status in card detail and allow rerun or clear; time out at 60 seconds with a retry action, and leave the card unchanged on failure or cancellation."}
```

```forge-requirement
{"id":"OCR-FR-05","kind":"requirement","text":"Include stored OCR text in title/tag search and in case export, and abort and clean up the worker when the user cancels or leaves the screen."}
```

```forge-requirement
{"id":"OCR-CON-01","kind":"constraint","text":"Support English only in v1; do not download additional languages or call a cloud OCR service."}
```

```forge-requirement
{"id":"OCR-CON-02","kind":"constraint","text":"OCR never creates tags, connections, or card types, and never replaces a non-empty title without explicit user action."}
```

```forge-requirement
{"id":"OCR-CON-03","kind":"constraint","text":"Terminate the worker and revoke any object URL on cancel, unmount, timeout, or completion; only one OCR job may run at a time."}
```

---

## 4. UI / Interaction Design

- In the capture form and card detail, a `Read text` action opens an OCR panel. It explains that OCR runs on the device and may take several seconds on a tablet.
- The panel shows status: Idle, Loading engine, Reading text, Done, Failed, Timed out. A progress indicator is indeterminate; Cancel is always available while running.
- When the title is empty, the first meaningful OCR line becomes the title and is announced. When the title is non-empty, the panel shows `Suggested title` with Apply and Dismiss; it never changes the field by itself.
- Extracted text is shown in a scrollable, selectable text area with confidence and engine version. `Run again` replaces the stored result; `Clear OCR` removes text and suggestion after confirmation.
- OCR text is searchable through the existing search panel and appears in the result snippet. It is included in the case archive.
- OCR assets are copied from pinned packages into `public/ocr` by a script and precached by the service worker. The UI never fetches a CDN.
- The feature is optional: if the assets fail to load, the app remains fully usable and the panel shows a retry message.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| OCR-1 | Bundled OCR assets, worker lifecycle, timeout and storage fields | capture-engineer | Asset script, worker, hook, model/mappers, tests | Unit tests and build asset check | No UI |
| OCR-2 | OCR panel in capture and detail with title suggestion | ui-engineer | Panel, form/detail wiring, browser journey | Component and Playwright tests | No search/backup integration |
| OCR-3 | OCR text in search and archive round-trip | data-engineer | Search/backup wiring, tests | Unit round-trip tests | No new OCR engine work |

---

## 6. Implementation Tasks

### Phase 1: Engine and assets

```forge-task
{
  "id": "OCR-1",
  "title": "Bundle tesseract.js assets and implement the OCR worker lifecycle",
  "description": "Pin tesseract.js 7.0.0, tesseract.js-core 7.0.0, and @tesseract.js-data/eng 1.0.0. Add scripts/copy-ocr-assets.mjs to copy worker.min.js, tesseract-core-simd-lstm.wasm.js, tesseract-core-simd-lstm.wasm, and 4.0.0_best_int/eng.traineddata.gz into public/ocr, and wire postinstall, predev, and prebuild so the assets always exist. Create ocrAssets.ts to build same-origin URLs from import.meta.env.BASE_URL and configure workerPath, corePath, and langPath. Create ocrWorker.ts and useOcr.ts with one job at a time, 60-second timeout, cancel, terminate, and cleanup. Add OCR text, confidence, engineVersion, and updatedAt to the card model and mappers. Add scripts/check-ocr-assets.mjs and a test that fails if the four built assets are missing or the OCR module uses an external origin. Do not add UI.",
  "ownerAgent": "capture-engineer",
  "dependencies": [
    "CAP-3",
    "FND-2"
  ],
  "expectedOutputs": [
    "package.json",
    "scripts/copy-ocr-assets.mjs",
    "scripts/check-ocr-assets.mjs",
    "src/features/ocr/ocrAssets.ts",
    "src/features/ocr/ocrWorker.ts",
    "src/features/ocr/useOcr.ts",
    "src/domain/model.ts",
    "src/data/mappers.ts",
    "vite.config.ts",
    ".gitignore",
    "public/ocr/eng.traineddata.gz",
    "public/ocr/worker.min.js",
    "public/ocr/tesseract-core-simd-lstm.wasm",
    "public/ocr/tesseract-core-simd-lstm.wasm.js",
    "tests/ocr/ocrAssets.test.ts",
    "tests/ocr/useOcr.test.tsx"
  ],
  "validationCommands": [
    "node scripts/copy-ocr-assets.mjs",
    "npm test -- tests/ocr/ocrAssets.test.ts tests/ocr/useOcr.test.tsx",
    "npm run build",
    "node scripts/check-ocr-assets.mjs"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/optional-ocr.md#OCR-FR-01",
      "docs/features/optional-ocr.md#OCR-FR-02",
      "docs/features/optional-ocr.md#OCR-FR-05"
    ],
    "acceptanceCriteria": [
      "The four OCR assets exist under public/ocr after install and are emitted into dist by the build",
      "All worker, core, and language URLs are same-origin and use the configured base path",
      "Only one OCR job runs at a time; cancel and timeout terminate the worker within one second",
      "A failed job leaves the card unchanged and can be retried",
      "The asset check fails if a required file is missing or an OCR source file references an external http origin"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/optional-ocr.md#OCR-CON-01",
      "docs/features/optional-ocr.md#OCR-CON-03",
      "docs/PRD.md#VIS-CON-07"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

### Phase 2: OCR experience

```forge-task
{
  "id": "OCR-2",
  "title": "Build the OCR panel and title suggestion flow",
  "description": "Create OcrPanel with idle, loading, reading, done, failed, and timed-out states; a progress indicator; Cancel; Run again; Clear OCR; text; confidence; and engine version. Wire it into NoteSourceForm for a pending image and CardDetailPage for a saved card. When the title is empty, apply the first meaningful OCR line and announce it. When the title is non-empty, show Suggested title with Apply and Dismiss and never change the field automatically. Persist text and metadata on success; clearing removes it after confirmation. Add component tests and a Playwright journey that reads a clear fixture, accepts a title, searches the text, reloads, and verifies persistence. Do not add search or backup code.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "OCR-1",
    "SEARCH-2"
  ],
  "expectedOutputs": [
    "src/features/ocr/OcrPanel.tsx",
    "src/features/ocr/OcrPanel.css",
    "src/features/capture/NoteSourceForm.tsx",
    "src/features/cards/CardDetailPage.tsx",
    "tests/ocr/OcrPanel.test.tsx",
    "e2e/ocr.spec.ts",
    "e2e/fixtures/ocr-note.png"
  ],
  "validationCommands": [
    "npm test -- tests/ocr/OcrPanel.test.tsx",
    "npm run test:e2e -- e2e/ocr.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/optional-ocr.md#OCR-FR-01",
      "docs/features/optional-ocr.md#OCR-FR-03",
      "docs/features/optional-ocr.md#OCR-FR-04",
      "docs/features/optional-ocr.md#OCR-FR-05"
    ],
    "acceptanceCriteria": [
      "OCR runs only after the user activates Read text for the current image or card",
      "An empty title is filled and announced; a non-empty title is unchanged until Apply",
      "Text, confidence, engine version, and timestamp persist and survive reload",
      "Failure and timeout show retry and leave the card unchanged; Cancel terminates the worker",
      "The Playwright journey completes real OCR on the fixture and finds the text through search"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/optional-ocr.md#OCR-CON-02",
      "docs/features/optional-ocr.md#OCR-CON-03"
    ],
    "references": [
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

### Phase 3: Search and backup integration

```forge-task
{
  "id": "OCR-3",
  "title": "Include OCR text in search and case archives",
  "description": "Update searchCards to match stored OCR text and return a snippet, and update the archive manifest and export/import paths to include OCR text, confidence, engineVersion, and updatedAt. Add tests proving OCR text is searchable without changing card data, survives export/import in both copy and replace modes, and is absent safely when no OCR has run. Do not add new OCR engine behavior or UI.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "OCR-2",
    "BACKUP-2"
  ],
  "expectedOutputs": [
    "src/features/search/searchCards.ts",
    "src/features/backup/archiveFormat.ts",
    "src/features/backup/exportCase.ts",
    "src/features/backup/importCase.ts",
    "tests/search/ocrSearch.test.ts",
    "tests/backup/ocrRoundTrip.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/search/ocrSearch.test.ts tests/backup/ocrRoundTrip.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/optional-ocr.md#OCR-FR-05",
      "docs/features/optional-ocr.md#OCR-FR-04"
    ],
    "acceptanceCriteria": [
      "Search matches OCR text and shows a bounded snippet; a card without OCR does not throw",
      "OCR metadata round-trips through export and import in copy and replace modes",
      "Search and import do not create tags, connections, or card types",
      "The tests fail if OCR fields are dropped from the manifest or search index"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/optional-ocr.md#OCR-CON-02",
      "docs/features/search-tags-and-filters.md#SEARCH-CON-03"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Asset URLs, timeout, cancel, one-job guard, model fields, search, archive round-trip | Vitest with mocked worker and real fflate |
| Component | OCR panel states, title suggestion, apply/dismiss, clear | React Testing Library |
| Browser | Real OCR on a clear fixture, search, reload | Playwright with a bundled PNG and generous timeout |
| Manual | Handwriting usefulness | Final review, recorded as a product observation |

Key scenarios:

1. The build contains local worker, wasm, and English traineddata assets.
2. A second OCR request while one runs is rejected.
3. Timeout and cancel terminate the worker and leave the card unchanged.
4. An empty title is filled; an edited title is never overwritten.
5. OCR text is searchable and survives backup.

---

## 8. Acceptance Criteria

1. OCR is off by default and user-triggered for one image or card.
2. The engine, wasm, and English assets are bundled and work offline.
3. Title autofill respects edits and requires Apply when a title exists.
4. The panel shows text, confidence, status, retry, and clear behavior.
5. OCR text is searchable and included in export.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Is handwriting OCR accurate enough? | Unknown; keep it optional, title-first, and never auto-tag. |
| 2 | Should more languages ship? | No; English only in v1. |
| 3 | Should OCR run on all cards at once? | No; one job at a time, one card at a time. |
