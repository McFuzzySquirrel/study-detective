# Project Progress

## Current State
**Phase**: FIRST-RUN-DEMO-AND-HINTS-3
**Status**: In Progress
**Validation Gaps**: 51 unverified check(s) - see "Validation Gaps"
**Last Updated**: 2026-10-26T18:36:34.248Z
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
- [x] Phase CASE-BOARD-1, Task BOARD-2: Mount the lazy Pixi canvas and case board route (@board-engineer)
  - Files: src/board/BoardCanvas.tsx, src/board/BoardScene.ts, src/board/usePixiApp.ts, src/board/textureCache.ts, src/features/case/CaseBoardPage.tsx, src/features/case/CaseBoardPage.css, src/data/caseRepository.ts, src/app/routes.tsx, tests/board/BoardCanvas.test.tsx, e2e/board.spec.ts, src/board/BoardCanvas.css, src/board/boardInput.ts, tests/board/textureCache.test.ts
- [x] Phase CASE-BOARD-1, Task BOARD-3: Implement card lift, drag, tap, and position persistence (@board-engineer)
  - Files: src/board/CardSprite.ts, src/board/CardLayer.ts, src/board/BoardScene.ts, src/board/useCardGestures.ts, tests/board/useCardGestures.test.ts, e2e/board-drag.spec.ts, src/board/BoardCanvas.tsx, src/board/boardInput.ts, src/board/usePixiApp.ts, src/features/case/CaseBoardPage.tsx
- [x] Phase CASE-BOARD-2, Task BOARD-4: Add fit-to-view, minimap, culling, texture release, and scale warnings (@board-engineer)
  - Files: src/board/Minimap.tsx, src/board/useCulling.ts, src/board/FitToViewButton.tsx, src/features/case/ScaleWarning.tsx, src/features/capture/CapturePage.tsx, src/board/textureCache.ts, src/features/case/CaseBoardPage.tsx, tests/board/Minimap.test.tsx, tests/board/culling.test.ts, tests/case/ScaleWarning.test.tsx, src/board/BoardCanvas.css, src/board/BoardCanvas.tsx, src/board/CardLayer.ts, src/board/CardSprite.ts, tests/board/BoardCanvas.test.tsx, src/board/boardCapacity.ts, src/board/fitToView.ts, src/features/case/ScaleWarning.css, tests/board/FitToViewButton.test.tsx
- [x] Phase CASE-BOARD-2, Task BOARD-5: Build the keyboard card list, empty state, and delete undo (@ui-engineer)
  - Files: src/features/case/CardListPage.tsx, src/features/case/CardListPanel.tsx, src/features/case/EmptyBoard.tsx, src/features/case/useUndoDelete.ts, src/data/deleteCard.ts, src/features/case/CaseBoardPage.tsx, src/app/routes.tsx, tests/case/CardListPanel.test.tsx, tests/case/useUndoDelete.test.tsx, e2e/keyboard-cards.spec.ts, src/data/caseRepository.ts, src/features/capture/CapturePage.tsx, src/features/case/CardListPage.css, src/features/case/CardListPanel.css, src/features/case/EmptyBoard.css
- [x] Phase CONNECTIONS-AND-PROVENANCE-1, Task LINK-1: Implement connection rules, repository, and cascade delete (@data-engineer)
  - Files: src/domain/connections.ts, src/data/connectionRepository.ts, tests/domain/connections.test.ts, tests/data/connectionRepository.test.ts
- [x] Phase CONNECTIONS-AND-PROVENANCE-1, Task LINK-2: Render sagging association and provenance strings (@board-engineer)
  - Files: src/board/stringGeometry.ts, src/board/StringLayer.ts, src/board/BoardScene.ts, tests/board/stringGeometry.test.ts, tests/board/stringGeometry.performance.test.ts, src/board/BoardCanvas.tsx, src/board/usePixiApp.ts, src/features/case/CaseBoardPage.tsx, tests/board/BoardCanvas.test.tsx
- [x] Phase CONNECTIONS-AND-PROVENANCE-2, Task LINK-3: Add thread-anchor creation, duplicate feedback, and type menu (@board-engineer)
  - Files: src/board/ThreadAnchor.ts, src/board/CardSprite.ts, src/features/connections/ConnectionTypeMenu.tsx, src/features/connections/useCreateConnection.ts, tests/connections/useCreateConnection.test.tsx, e2e/connections.spec.ts, src/board/BoardCanvas.tsx, src/board/BoardScene.ts, src/board/CardLayer.ts, src/board/boardStore.ts, src/board/useCardGestures.ts, src/board/usePixiApp.ts, src/features/case/CaseBoardPage.tsx, src/features/connections/connections.css
- [x] Phase CONNECTIONS-AND-PROVENANCE-2, Task LINK-4: Build connection detail, retype, delete, undo, and legend (@ui-engineer)
  - Files: src/features/connections/ConnectionDetail.tsx, src/features/connections/ConnectionLegend.tsx, src/features/connections/useUndoDeleteConnection.ts, src/features/case/CaseBoardPage.tsx, tests/connections/ConnectionDetail.test.tsx, tests/connections/ConnectionLegend.test.tsx, src/features/case/CaseBoardPage.css, src/features/connections/connections.css
- [x] Phase CONNECTIONS-AND-PROVENANCE-3, Task LINK-5: Build the keyboard connection target picker (@ui-engineer)
  - Files: src/features/connections/ConnectionPicker.tsx, src/features/cards/CardDetailPage.tsx, src/features/case/CardListPanel.tsx, tests/connections/ConnectionPicker.test.tsx, e2e/keyboard-links.spec.ts, src/features/case/CardListPage.tsx, src/features/connections/connections.css
- [x] Phase CONNECTIONS-AND-PROVENANCE-3, Task LINK-HR-1: Review board, pin, and string feel on tablet and desktop
  - Files: docs/reviews/board-feel.json
- [x] Phase CASE-CLOSURE-1, Task CLOSE-1: Implement readiness, loose-thread, and topic-status selectors (@data-engineer)
  - Files: src/domain/readiness.ts, tests/domain/readiness.test.ts
- [x] Phase CASE-CLOSURE-2, Task CLOSE-2: Build the closure panel, close, closed-with-threads, and reopen (@ui-engineer)
  - Files: src/features/closure/ClosurePanel.tsx, src/features/closure/useCaseLifecycle.ts, src/domain/caseLifecycle.ts, src/data/caseRepository.ts, src/features/case/CaseBoardPage.tsx, src/features/shelf/CaseCard.tsx, tests/features/closure/ClosurePanel.test.tsx, tests/domain/caseLifecycle.test.ts, e2e/closure.spec.ts, src/domain/model.ts, src/features/case/CaseBoardPage.css, src/features/shelf/shelf.css, tests/domain/model.test.ts, tests/domain/validation.test.ts, tests/shelf/CaseFormDialog.test.tsx, src/features/closure/closure.css
- [x] Phase CASE-CLOSURE-2, Task CLOSE-3: Show topic status in card detail and the card list (@ui-engineer)
  - Files: src/features/case/TopicStatusBadge.tsx, src/features/case/CardListPanel.tsx, src/features/cards/CardDetailPage.tsx, tests/case/TopicStatusBadge.test.tsx, tests/case/CardListPanel.test.tsx, src/features/case/TopicStatusBadge.css
- [x] Phase RECALL-MODE-1, Task RECALL-1: Implement scratch connections and recall comparison (@board-engineer)
  - Files: src/features/recall/recallStore.ts, src/features/recall/compareConnections.ts, tests/recall/compareConnections.test.ts, tests/recall/recallStore.test.ts
- [x] Phase RECALL-MODE-2, Task RECALL-2: Build the recall route, hidden strings, and scratch drawing (@board-engineer)
  - Files: src/features/recall/RecallPage.tsx, src/features/recall/RecallToolbar.tsx, src/features/recall/useScratchConnections.ts, src/features/recall/recall.css, src/board/BoardCanvas.tsx, src/app/routes.tsx, tests/recall/RecallPage.test.tsx, e2e/recall.spec.ts, src/board/BoardScene.ts, src/board/StringLayer.ts, src/features/case/CaseBoardPage.tsx
- [x] Phase RECALL-MODE-2, Task RECALL-3: Add the check overlay and accessible results summary (@ui-engineer)
  - Files: src/features/recall/RecallResults.tsx, src/features/recall/RecallSummary.tsx, src/features/recall/RecallToolbar.tsx, src/features/recall/RecallPage.tsx, tests/recall/RecallResults.test.tsx, tests/recall/compareConnections.type.test.ts, e2e/recall-results.spec.ts, src/features/recall/recall.css
- [x] Phase SEARCH-TAGS-AND-FILTERS-1, Task SEARCH-1: Add normalized tags to cards and card forms (@ui-engineer)
  - Files: src/domain/tags.ts, src/features/search/TagInput.tsx, src/features/search/TagInput.css, src/features/capture/NoteSourceForm.tsx, src/features/capture/TopicForm.tsx, src/features/cards/CardDetailPage.tsx, tests/domain/tags.test.ts, tests/search/TagInput.test.tsx, src/features/capture/CapturePage.tsx, src/features/cards/CardDetail.css, tests/capture/CaptureFlow.test.tsx, tests/capture/TopicForm.test.tsx
- [x] Phase SEARCH-TAGS-AND-FILTERS-2, Task SEARCH-2: Implement live search, filters, and the results panel (@ui-engineer)
  - Files: src/features/search/searchCards.ts, src/features/search/SearchPanel.tsx, src/features/search/SearchPanel.css, src/features/case/CaseBoardPage.tsx, src/features/case/CardListPanel.tsx, tests/search/searchCards.test.ts, tests/search/SearchPanel.test.tsx, src/features/case/CardListPanel.css, src/features/case/CaseBoardPage.css
- [x] Phase SEARCH-TAGS-AND-FILTERS-3, Task SEARCH-3: Verify keyboard and phone search journeys (@qa-engineer)
  - Files: e2e/search.spec.ts
- [x] Phase BACKUP-AND-RESTORE-1, Task BACKUP-1: Implement the single-case archive format and exporter (@data-engineer)
  - Files: src/features/backup/archiveFormat.ts, src/features/backup/exportCase.ts, tests/backup/exportCase.test.ts, src/data/caseRepository.ts
- [x] Phase BACKUP-AND-RESTORE-2, Task BACKUP-2: Implement validated copy and replace restore (@data-engineer)
  - Files: src/features/backup/importValidation.ts, src/features/backup/importCase.ts, tests/backup/importCase.test.ts
- [x] Phase BACKUP-AND-RESTORE-3, Task BACKUP-3: Build the backup dialog, progress, and once-per-case reminder (@ui-engineer)
  - Files: src/features/backup/BackupDialog.tsx, src/features/backup/BackupDialog.css, src/features/backup/useBackupReminder.ts, src/features/shelf/CaseShelf.tsx, src/features/case/CaseBoardPage.tsx, tests/backup/BackupDialog.test.tsx, tests/backup/useBackupReminder.test.tsx, src/features/case/CaseBoardPage.css, src/features/shelf/CaseCard.tsx, src/features/shelf/CaseShelfPage.tsx, src/features/shelf/shelf.css, src/features/backup/backupOperations.ts
- [x] Phase BACKUP-AND-RESTORE-3, Task BACKUP-4: Verify export, delete, copy restore, and replace in a browser (@qa-engineer)
  - Files: e2e/backup.spec.ts
- [x] Phase OPTIONAL-OCR-1, Task OCR-1: Bundle tesseract.js assets and implement the OCR worker lifecycle (@capture-engineer)
  - Files: package.json, scripts/copy-ocr-assets.mjs, scripts/check-ocr-assets.mjs, src/features/ocr/ocrAssets.ts, src/features/ocr/ocrWorker.ts, src/features/ocr/useOcr.ts, src/domain/model.ts, src/data/mappers.ts, vite.config.ts, .gitignore, public/ocr/eng.traineddata.gz, public/ocr/worker.min.js, public/ocr/tesseract-core-simd-lstm.wasm, public/ocr/tesseract-core-simd-lstm.wasm.js, tests/ocr/ocrAssets.test.ts, tests/ocr/useOcr.test.tsx, eslint.config.js
- [x] Phase OPTIONAL-OCR-2, Task OCR-2: Build the OCR panel and title suggestion flow (@ui-engineer)
  - Files: src/features/ocr/OcrPanel.tsx, src/features/ocr/OcrPanel.css, src/features/capture/NoteSourceForm.tsx, src/features/cards/CardDetailPage.tsx, tests/ocr/OcrPanel.test.tsx, e2e/ocr.spec.ts, e2e/fixtures/ocr-note.png, src/data/caseRepository.ts, src/features/capture/CapturePage.tsx, src/features/capture/cardImport.ts, src/features/ocr/ocrWorker.ts, src/features/ocr/ocrTitle.ts, tests/ocr/CardDetailOcr.test.tsx
- [x] Phase OPTIONAL-OCR-3, Task OCR-3: Include OCR text in search and case archives (@data-engineer)
  - Files: src/features/search/searchCards.ts, src/features/backup/archiveFormat.ts, src/features/backup/exportCase.ts, src/features/backup/importCase.ts, tests/search/ocrSearch.test.ts, tests/backup/ocrRoundTrip.test.ts
- [x] Phase FIRST-RUN-DEMO-AND-HINTS-1, Task DEMO-1: Generate the demo case and implement one-time seeding (@data-engineer)
  - Files: src/features/demo/demoImages.ts, src/features/demo/demoCase.ts, src/features/demo/seedDemoCase.ts, tests/demo/seedDemoCase.test.ts, tests/demo/demoCase.test.ts, tests/demo/demoBackup.test.ts, tests/demo/demoFixtures.ts
- [x] Phase FIRST-RUN-DEMO-AND-HINTS-2, Task DEMO-2: Implement persistent hints, the hint popover, and replay settings (@ui-engineer)
  - Files: src/features/onboarding/hints.ts, src/features/onboarding/HintPopover.tsx, src/features/onboarding/hints.css, src/features/settings/SettingsPage.tsx, src/app/routes.tsx, tests/onboarding/hints.test.ts, tests/onboarding/HintPopover.test.tsx, tests/settings/SettingsPage.test.tsx
- [x] Phase FIRST-RUN-DEMO-AND-HINTS-3, Task DEMO-3: Wire first-run seeding, demo removal, and contextual hint triggers (@ui-engineer)
  - Files: src/app/AppBootstrap.tsx, src/App.tsx, src/features/shelf/CaseShelf.tsx, src/features/shelf/CaseCard.tsx, src/features/case/CaseBoardPage.tsx, src/features/recall/RecallPage.tsx, tests/demo/firstRun.test.tsx, e2e/demo.spec.ts, playwright.config.ts, src/features/onboarding/hints.css, src/features/shelf/CaseShelfPage.tsx, src/features/shelf/DeleteCaseDialog.tsx, src/features/shelf/shelf.css, tests/pwa/UpdatePrompt.test.tsx, tests/recall/RecallPage.test.tsx, e2e/fixtures/no-demo-storage.json

## Current Task
- None currently running

## Remaining
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
- Task BOARD-2: Culling uses the required 200 px viewport margin and the texture cache enforces 200 residents with recovery tests, but the 150-card culling assertion and FPS harness belong to BOARD-4 and QA. Tablet 45 FPS still needs human verification.
- Task BOARD-2: Playwright covers Chromium desktop, tablet, and phone only; Firefox and WebKit are not exercised here.
- Task BOARD-2: The context-loss journey tests the explicit Restore action; the automatic browser-restore branch is implemented but not separately exercised.
- Task BOARD-3: Thumbnail-to-display texture replacement is implemented and exercised with real attachment loading, but no pixel-level browser assertion proves the visual swap.
- Task BOARD-3: Browser evidence covers Chromium-based projects only.
- Task BOARD-4: The pre-existing e2e/board.spec.ts pan/zoom pointer-anchor assertion fails by about 0.166 CSS px in this environment even after removing this task's Fit/Minimap controls and rebuilding; the phone run of that test also timed out. It is not one of BOARD-4's required validation commands.
- Task BOARD-4: e2e/board-drag.spec.ts passed for mouse and touch drag, tap, persistence, and context recovery in the combined run.
- Task BOARD-4: Browser evidence covers Chromium-based projects only.
- Task BOARD-5: Human board-feel review is not applicable to this DOM-only task; spatial placement remains pointer-only by design.
- Task LINK-1: Unique-index race fallback and the internal constraint-recovery lookup are implemented but not directly exercised.
- Task LINK-1: No browser or visual board behavior is in scope for LINK-1.
- Task LINK-2: No permanent BoardScene unit test; scene integration was verified by the temporary real-browser pixel journey and the committed board-drag Playwright journey.
- Task LINK-2: Human board-feel review of string sag still needs a real tablet/desktop pass.
- Task LINK-3: Phone projects skip the pointer thread journeys; the canvas remains pointer-only and the accessible non-spatial path is LINK-5.
- Task LINK-3: Pixel-level string color/pixel verification is covered by LINK-2 geometry tests and browser behavior, not a pixel assertion in this LINK-3 journey.
- Task LINK-4: Component tests run in jsdom at its default 1024x768 viewport; the CSS breakpoints are not browser-exercised.
- Task LINK-4: No Playwright journey was required or run for this task.
- Task LINK-5: Component tests run in jsdom; the e2e journey provides the real-browser viewport and IndexedDB evidence.
- Task CLOSE-1: No UI or persistence was exercised; CLOSE-1 is intentionally domain-only.
- Task CLOSE-1: Topic linked-note semantics use association connections; an invalid provenance row between a note and topic clears topic looseness but does not make the note ready or count as a linked note.
- Task CLOSE-2: Spatial board placement and canvas gestures were not exercised; the closure journey uses the keyboard card list and capture route for graph repair.
- Task CLOSE-3: Responsive visual behavior at 390x844/768x1024/1280x800 was not exercised in a real browser for this task; the CSS uses wrapping and tokens only, and the browser matrix remains with A11Y hardening.
- Task RECALL-1: Write-spy evidence is unit-level and does not prove future UI wiring cannot introduce a repository call.
- Task RECALL-1: No browser journey applies to this unit-only task.
- Task RECALL-2: 45 FPS at 150 cards on the target tablet was not measured; board-feel and FPS still require human review.
- Task RECALL-2: Culling and texture-cap behavior were not re-measured because these layers were not changed; existing board tests remain green.
- Task RECALL-2: A component test with a mocked Pixi boundary is supplemented by the real-browser recall journey for scratch drawing and route teardown.
- Task SEARCH-1: The required validation commands do not include a browser journey; viewport behavior at 390x844, 768x1024, and desktop sizes remains unverified in a real browser for this task.
- Task SEARCH-2: Browser keyboard and phone-sheet behavior remains for SEARCH-3/QA Playwright evidence.
- Task BACKUP-1: Tests run under Node with fake-indexeddb because jsdom Blobs are not structurally cloneable by fake-indexeddb.
- Task BACKUP-1: No real-browser File System Access or download behavior was exercised; BACKUP-4 owns that journey.
- Task BACKUP-2: Tests use Node with fake-indexeddb and real fflate archives; no browser File System Access or real File input journey was run (BACKUP-4 owns that).
- Task BACKUP-3: File System Access and download behaviour is component-tested with injected fakes; real browser picker behaviour is deferred to BACKUP-4.
- Task BACKUP-4: The literal in-task instruction to import the same first archive in replace mode against the restored case is not achievable without product changes; the replace path is proven with real generated archive bytes from the restored case.
- Task OCR-1: Unit worker tests use injected fake workers; the default tesseract.js integration path is typechecked and bundled as assets but not executed in a browser.
- Task OCR-1: tesseract.js JS is tree-shaken from this build because no screen imports useOcr yet; assets are emitted and precached.
- Task OCR-2: Playwright activated OCR with pointer/file input; keyboard reachability and focus behavior are covered by component tests rather than a keyboard-only browser OCR journey.
- Task OCR-3: No new browser journey was run; search/archive behavior is validated with pure selectors and real fflate archives over fake-indexeddb, while OCR-2 already covers the visible OCR flow.
- Task DEMO-1: No real browser canvas raster output or Playwright seed/remove journey was run in DEMO-1; those belong to DEMO-3 and browser acceptance. Image generation was validated through an injected canvas contract plus real Blob byte counts and SHA-256 digests.
- Task DEMO-2: No Playwright/browser reload or viewport matrix was run for DEMO-2 because the task's required validation is unit/component plus typecheck; the browser first-run journey belongs to DEMO-3. Persistence across reload is covered by reconstructing the store over the same injected storage.
- Task DEMO-3: Long-press hint behavior is component-tested with a mocked coarse-pointer matchMedia; Playwright's configured projects do not emulate touch, so the browser journey exercises the thread-anchor hint instead.
- Task DEMO-3: Contextual hints are fixed near the viewport bottom rather than geometrically anchored to their trigger; their click-through body avoids blocking the board, but final placement is a human style-review matter.

## Notes
- Workflow engine run d2be3a1e-ee48-4d3b-aa16-87811c2b0532
- Harness: opencode
