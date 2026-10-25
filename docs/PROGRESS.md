# Project Progress

## Current State
**Phase**: BACKUP-AND-RESTORE-1
**Status**: In Progress
**Validation Gaps**: 11 unverified check(s) - see "Validation Gaps"
**Last Updated**: 2026-10-25T21:44:24.183Z
**Run ID**: d2be3a1e-ee48-4d3b-aa16-87811c2b0532
**Harness**: opencode
**Execution Mode**: auto

## Completed Tasks
- [x] Phase APP-FOUNDATION-1, Task FND-1: Scaffold the React and TypeScript PWA toolchain (@foundation-engineer)
  - Files: package.json, package-lock.json, .nvmrc, index.html, vite.config.ts, tsconfig.json, tsconfig.app.json, tsconfig.node.json, eslint.config.js, vitest.config.ts, playwright.config.ts, src/main.tsx, src/App.tsx, src/vite-env.d.ts, src/styles/base.css, tests/setup.ts, tests/app/smoke.test.tsx, .gitignore, .prettierignore, e2e/smoke.spec.ts
- [x] Phase APP-FOUNDATION-1, Task FND-2: Add installable PWA manifest, icons, and update prompt (@foundation-engineer)
  - Files: vite.config.ts, src/pwaManifest.ts, src/pwa.ts, src/main.tsx, src/App.tsx, src/app/UpdatePrompt.tsx, src/app/UpdatePrompt.css, public/icons/icon.svg, public/icons/icon-192.png, public/icons/icon-512.png, public/icons/maskable-512.png, scripts/generate-icons.mjs, tests/pwa/manifest.test.ts, tests/pwa/UpdatePrompt.test.tsx, src/vite-env.d.ts, vitest.config.ts, tests/stubs/pwa-register.ts
- [x] Phase APP-FOUNDATION-1, Task FND-3: Build the hash-routed shell with error and offline states (@foundation-engineer)
  - Files: src/App.tsx, src/app/AppShell.tsx, src/app/AppShell.css, src/app/routes.tsx, src/app/placeholders.tsx, src/app/ErrorBoundary.tsx, src/app/OfflineNotice.tsx, tests/app/routing.test.tsx, tests/app/ErrorBoundary.test.tsx, tests/app/OfflineNotice.test.tsx, tests/app/smoke.test.tsx
- [x] Phase APP-FOUNDATION-2, Task FND-4: Build the standalone visual-direction style tile (@ui-engineer)
  - Files: prototype/style-tile.html, prototype/style-tile.css, e2e/style-tile.spec.ts, tsconfig.node.json
- [x] Phase APP-FOUNDATION-2, Task FND-HR-1: Review and record the visual direction
  - Files: docs/reviews/style-direction.json
- [x] Phase APP-FOUNDATION-3, Task FND-5: Implement theme tokens and accessible shared primitives (@ui-engineer)
  - Files: src/styles/tokens.css, src/styles/base.css, src/components/Button.tsx, src/components/IconButton.tsx, src/components/Dialog.tsx, src/components/Toast.tsx, src/components/Field.tsx, src/components/EmptyState.tsx, src/components/components.css, tests/components/primitives.test.tsx, tests/styles/tokens.test.ts, package-lock.json, package.json, src/app/AppShell.css, src/app/UpdatePrompt.css, tests/helpers/css-contract.ts
- [x] Phase LOCAL-DATA-AND-CASE-SHELF-1, Task DATA-1: Define validated case domain records (@data-engineer)
  - Files: src/domain/model.ts, src/domain/validation.ts, src/domain/ids.ts, tests/domain/model.test.ts, tests/domain/validation.test.ts
- [x] Phase LOCAL-DATA-AND-CASE-SHELF-1, Task DATA-2: Implement the Dexie schema and repositories (@data-engineer)
  - Files: src/data/db.ts, src/data/mappers.ts, src/data/caseRepository.ts, src/data/attachmentStore.ts, tests/data/dbMigration.test.ts, tests/data/caseRepository.test.ts, tests/data/attachmentStore.test.ts, package-lock.json, package.json, src/data/errors.ts, src/data/transactions.ts, tests/data/testDatabase.ts
- [x] Phase LOCAL-DATA-AND-CASE-SHELF-2, Task DATA-3: Build the case shelf with create and edit (@ui-engineer)
  - Files: src/features/shelf/CaseShelfPage.tsx, src/features/shelf/CaseShelf.tsx, src/features/shelf/CaseCard.tsx, src/features/shelf/CaseFormDialog.tsx, src/features/shelf/shelf.css, src/app/routes.tsx, tests/shelf/CaseShelf.test.tsx, tests/shelf/CaseFormDialog.test.tsx
- [x] Phase LOCAL-DATA-AND-CASE-SHELF-2, Task DATA-4: Add persistent storage, quota display, and multi-tab refresh (@data-engineer)
  - Files: src/data/persistence.ts, src/data/storageEstimate.ts, src/data/useBroadcastSync.ts, src/features/shelf/StorageStatus.tsx, src/features/shelf/CaseFormDialog.tsx, src/features/shelf/CaseShelf.tsx, tests/data/persistence.test.ts, tests/data/storageEstimate.test.ts, tests/data/useBroadcastSync.test.tsx, tests/shelf/StorageStatus.test.tsx, src/features/shelf/CaseShelfPage.tsx, src/features/shelf/shelf.css, src/features/shelf/useBroadcastSync.ts
- [x] Phase LOCAL-DATA-AND-CASE-SHELF-2, Task DATA-5: Implement confirmed cascade deletion of a case (@data-engineer)
  - Files: src/features/shelf/DeleteCaseDialog.tsx, src/data/deleteCase.ts, src/features/shelf/CaseShelf.tsx, src/features/shelf/CaseCard.tsx, tests/shelf/DeleteCaseDialog.test.tsx, tests/data/deleteCase.test.ts, src/data/caseRepository.ts, src/features/shelf/CaseShelfPage.tsx, src/features/shelf/shelf.css
- [x] Phase EVIDENCE-CAPTURE-1, Task CAP-1: Implement validated image import and atomic card creation (@capture-engineer)
  - Files: src/features/capture/imageValidation.ts, src/features/capture/imagePipeline.ts, src/features/capture/cardImport.ts, src/data/caseRepository.ts, tests/capture/imageValidation.test.ts, tests/capture/imagePipeline.test.ts, tests/capture/cardImport.test.ts
- [x] Phase EVIDENCE-CAPTURE-1, Task CAP-2: Build the touch and keyboard crop/rotate editor (@capture-engineer)
  - Files: src/features/capture/cropMath.ts, src/features/capture/CropRotateEditor.tsx, src/features/capture/crop.css, tests/capture/cropMath.test.ts, tests/capture/CropRotateEditor.test.tsx
- [x] Phase EVIDENCE-CAPTURE-2, Task CAP-3: Build the capture route for notes, sources, and topics (@ui-engineer)
  - Files: src/features/capture/CapturePage.tsx, src/features/capture/CaptureSourcePicker.tsx, src/features/capture/NoteSourceForm.tsx, src/features/capture/TopicForm.tsx, src/features/capture/capture.css, src/app/routes.tsx, tests/capture/CaptureFlow.test.tsx, tests/capture/TopicForm.test.tsx, src/features/capture/capturePosition.ts
- [x] Phase EVIDENCE-CAPTURE-2, Task CAP-4: Build card detail with replace, re-crop, and a real browser import journey (@ui-engineer)
  - Files: src/features/cards/CardDetailPage.tsx, src/features/cards/CardDetail.css, src/app/routes.tsx, tests/cards/CardDetailPage.test.tsx, e2e/capture.spec.ts, e2e/fixtures/note.png, e2e/fixtures/source.png, src/data/caseRepository.ts, src/domain/model.ts, src/features/capture/cardImport.ts, src/features/cards/cardReplace.ts, tests/data/caseRepositoryReplace.test.ts
- [x] Phase CASE-BOARD-1, Task BOARD-1: Implement viewport math and board state (@board-engineer)
  - Files: src/board/viewport.ts, src/board/boardStore.ts, tests/board/viewport.test.ts, tests/board/boardStore.test.ts
- [x] Phase BACKUP-AND-RESTORE-1, Task BACKUP-1: Implement the single-case archive format and exporter (@data-engineer)
  - Files: src/features/backup/archiveFormat.ts, src/features/backup/exportCase.ts, tests/backup/exportCase.test.ts, src/data/caseRepository.ts

## Current Task
- None currently running

## Remaining
- [ ] Phase CASE-BOARD-1: Phase 1: Canvas and placement
- [ ] Phase CASE-BOARD-2: Phase 2: Scale and non-spatial path
- [ ] Phase CONNECTIONS-AND-PROVENANCE-1: Phase 1: Graph rules and rendering
- [ ] Phase CONNECTIONS-AND-PROVENANCE-2: Phase 2: Drawing and editing
- [ ] Phase CONNECTIONS-AND-PROVENANCE-3: Phase 3: Keyboard path and feel review
- [ ] Phase CASE-CLOSURE-1: Phase 1: Derived rules
- [ ] Phase CASE-CLOSURE-2: Phase 2: Closure UI and lifecycle
- [ ] Phase RECALL-MODE-1: Phase 1: Non-persistent recall logic
- [ ] Phase RECALL-MODE-2: Phase 2: Recall experience
- [ ] Phase SEARCH-TAGS-AND-FILTERS-1: Phase 1: Tags
- [ ] Phase SEARCH-TAGS-AND-FILTERS-2: Phase 2: Search and filters
- [ ] Phase SEARCH-TAGS-AND-FILTERS-3: Phase 3: Browser verification
- [ ] Phase BACKUP-AND-RESTORE-2: Phase 2: Import and restore
- [ ] Phase BACKUP-AND-RESTORE-3: Phase 3: UI and browser journey
- [ ] Phase OPTIONAL-OCR-1: Phase 1: Engine and assets
- [ ] Phase OPTIONAL-OCR-2: Phase 2: OCR experience
- [ ] Phase OPTIONAL-OCR-3: Phase 3: Search and backup integration
- [ ] Phase FIRST-RUN-DEMO-AND-HINTS-1: Phase 1: Demo content and seeding
- [ ] Phase FIRST-RUN-DEMO-AND-HINTS-2: Phase 2: Hints
- [ ] Phase FIRST-RUN-DEMO-AND-HINTS-3: Phase 3: First-run integration
- [ ] Phase RESPONSIVE-AND-ACCESSIBILITY-HARDENING-1: Phase 1: Layout, keyboard, and motion
- [ ] Phase RESPONSIVE-AND-ACCESSIBILITY-HARDENING-2: Phase 2: Automated audits
- [ ] Phase RELEASE-AND-FIELD-REVIEW-1: Phase 1: CI and deployment
- [ ] Phase RELEASE-AND-FIELD-REVIEW-2: Phase 2: Offline release verification
- [ ] Phase RELEASE-AND-FIELD-REVIEW-3: Phase 3: Documentation and human gate

## Blockers
- None

## Validation Gaps
- Task CAP-1: No real-browser image decode or EXIF fixture journey was run in CAP-1; the capture route/UI is out of scope.
- Task CAP-1: Cancellation cannot interrupt an IndexedDB transaction once saving begins; the UI should disable cancel at the saving stage.
- Task CAP-1: UI-created preview object URLs must be revoked by the UI on unmount/cancel; the pipeline owns only its internal fallback URL.
- Task CAP-2: No real-browser or Playwright crop exercise was run because CAP-2 is not wired into a route; CAP-3/CAP-4 own that integration.
- Task CAP-2: The editor's live summary updates during selection changes; screen-reader nudge and rotation paths were tested with keyboard events in jsdom.
- Task CAP-3: The case board does not exist yet, so viewport placement is validated against an injected 1000x800 visible size rather than a live Pixi board viewport.
- Task CAP-3: Real EXIF, canvas, and file-input camera behavior remain for CAP-4/QA browser verification.
- Task CAP-4: Browser rotation/crop behavior was verified in Chromium only.
- Task CAP-4: The replacement cleanupPending failure branch is handled and typed but not exercised in the browser journey.
- Task BACKUP-1: Tests run under Node with fake-indexeddb because jsdom Blobs are not structurally cloneable by fake-indexeddb.
- Task BACKUP-1: No real-browser File System Access or download behavior was exercised; BACKUP-4 owns that journey.

## Notes
- Workflow engine run d2be3a1e-ee48-4d3b-aa16-87811c2b0532
- Harness: opencode
