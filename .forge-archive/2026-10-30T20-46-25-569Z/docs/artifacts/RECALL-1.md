# Task Execution

{"taskId":"RECALL-1","runId":"d2be3a1e-ee48-4d3b-aa16-87811c2b0532","attempt":2,"owner":"board-engineer","model":"deepseek/deepseek-flash","dependencies":["LINK-1"]}

This is an engine-generated execution snapshot. Do not modify it or include it in deliverables or commits. Execute only this task; supporting documents do not authorize unrelated work.

## Execution Instructions

## Context from previous tasks

### work.link-1 (work-link-1-001)
**Summary:** Implemented LINK-1 connection domain rules and both Dexie and in-memory repositories with duplicate/self-link/provenance validation, unique pair enforcement, strict reads, retype, cascade, restore, and rollback tests; required test and typecheck commands pass.
**Files changed:**
- src/domain/connections.ts
- src/data/connectionRepository.ts
- tests/domain/connections.test.ts
- tests/data/connectionRepository.test.ts
**agentOutputExcerpt:** Implemented LINK-1 connection domain rules and both Dexie and in-memory repositories with duplicate/self-link/provenance validation, unique pair enforcement, strict reads, retype, cascade, restore, and rollback tests; required test and typecheck commands pass.
**decisions:** ["Duplicate create returns the existing connection with status 'duplicate' so LINK-3 can select it rather than surfacing an error.","ConnectionRepository owns strict connection reads; CaseRepository.listConnections stays tolerant of corrupt children so card deletion cannot be trapped.","The v1 unique pairKey index remains the race backstop; no migration was added."]
**interfaces:** ["ConnectionRepositoryPort.create(input): Promise<{status:'created'|'duplicate'; connection: ConnectionRecord}>","ConnectionRepositoryPort.retype(connectionId, type): Promise<ConnectionRecord>","ConnectionRepositoryPort.restore(connection): Promise<ConnectionRecord>","ConnectionRepositoryPort.delete(connectionId): Promise<boolean>","ConnectionRepositoryPort.listByCase(caseId): Promise<ConnectionRecord[]>","ConnectionRepositoryPort.listByCard(cardId): Promise<ConnectionRecord[]>","ConnectionRepositoryPort.deleteByCard(cardId): Promise<number>","InMemoryConnectionRepository({ cards, connections?, idFactory? })","findConnectionForPair, assertConnectionPairAvailable, planConnectionCascade, findDanglingConnections, missingConnectionEndpoints, DuplicateConnectionError"]
**tests:** ["npm test -- tests/domain/connections.test.ts tests/data/connectionRepository.test.ts: exit 0 (engine-verified)","npm run typecheck: exit 0 (engine-verified)"]
**warnings:** ["LINK-3/LINK-4 must use ConnectionRepository for strict string reads; CaseRepository.listConnections intentionally does not re-check endpoints.","The in-memory connection fake does not track case updatedAt."]
**validationLimitations:** ["Unique-index race fallback and the internal constraint-recovery lookup are implemented but not directly exercised.","No browser or visual board behavior is in scope for LINK-1."]

### work.board-4 (work-board-4-001)
**Summary:** BOARD-4 implemented fit-to-view, minimap tap/drag navigation, 200px-margin culling, delayed offscreen texture release, and the shared 120/150/200-card capacity guard across the board and capture routes; required tests, typecheck, lint, full suite, and build pass.
**Files changed:**
- src/board/Minimap.tsx
- src/board/useCulling.ts
- src/board/FitToViewButton.tsx
- src/features/case/ScaleWarning.tsx
- src/features/capture/CapturePage.tsx
- src/board/textureCache.ts
- src/features/case/CaseBoardPage.tsx
- tests/board/Minimap.test.tsx
- tests/board/culling.test.ts
- tests/case/ScaleWarning.test.tsx
- src/board/BoardCanvas.css
- src/board/BoardCanvas.tsx
- src/board/CardLayer.ts
- src/board/CardSprite.ts
- tests/board/BoardCanvas.test.tsx
- src/board/boardCapacity.ts
- src/board/fitToView.ts
- src/features/case/ScaleWarning.css
- tests/board/FitToViewButton.test.tsx
**agentOutputExcerpt:** BOARD-4 implemented fit-to-view, minimap tap/drag navigation, 200px-margin culling, delayed offscreen texture release, and the shared 120/150/200-card capacity guard across the board and capture routes; required tests, typecheck, lint, full suite, and build pass.
**decisions:** ["Fit and minimap navigation use existing board-store temporary/movement intents, so fit never persists a camera and minimap navigation does.","The minimap is DOM/SVG over the same pure viewport projection helpers rather than a second Pixi scene.","Culling margin is screen-space and divided by zoom when converted to world units; CardLayer and useCulling share one pure implementation.","Offscreen card images are released after DEFAULT_OFFSCREEN_RELEASE_MS by CardLayer, with timers cleared on delete and destroy."]
**interfaces:** ["boardCapacity.ts: SOFT_WARNING_CARD_COUNT=120, PERSISTENT_WARNING_CARD_COUNT=150, MAX_BOARD_CARDS=200, boardCapacityLevel, canAddCard, remainingCardCapacity, SPLIT_CASE_MESSAGE","useCulling(cards, viewport, size, options) and pure computeCullingWindow/filterVisibleCards/cullCardIds/rectsIntersect","FitToViewButton({ positions, viewportSize, store?, onFit? }) plus computeFitToCardsViewport in fitToView.ts","Minimap({ cards, viewport, viewportSize, store?, onNavigate? })","ScaleWarning({ cardCount })","BoardCanvas gains cardLimitReached; CaseBoardPage passes it and renders ScaleWarning","BoardSnapshot/intents unchanged; CardLayer still reads the plain snapshot and emits no storage writes"]
**tests:** ["npm test -- tests/board/Minimap.test.tsx tests/board/culling.test.ts tests/case/ScaleWarning.test.tsx: exit 0 (engine-verified)","npm run typecheck: exit 0 (engine-verified)"]
**warnings:** ["The tablet 45 FPS floor was not measured in this task; culling and texture release are implemented but real-tablet feel still needs human verification.","The 150-card fixture proves culling returns 12 cards at 1000x800/scale 1.0, but a headless FPS harness is still QA scope."]
**validationLimitations:** ["The pre-existing e2e/board.spec.ts pan/zoom pointer-anchor assertion fails by about 0.166 CSS px in this environment even after removing this task's Fit/Minimap controls and rebuilding; the phone run of that test also timed out. It is not one of BOARD-4's required validation commands.","e2e/board-drag.spec.ts passed for mouse and touch drag, tap, persistence, and context recovery in the combined run.","Browser evidence covers Chromium-based projects only."]

### work.board-5 (work-board-5-001)
**Summary:** Implemented CardListPage, grouped CardListPanel, EmptyBoard, deleteCard snapshot/restore, useUndoDelete, routes, board empty-state wiring, and the keyboard Playwright journey; required unit and browser checks pass.
**Files changed:**
- src/features/case/CardListPage.tsx
- src/features/case/CardListPanel.tsx
- src/features/case/EmptyBoard.tsx
- src/features/case/useUndoDelete.ts
- src/data/deleteCard.ts
- src/features/case/CaseBoardPage.tsx
- src/app/routes.tsx
- tests/case/CardListPanel.test.tsx
- tests/case/useUndoDelete.test.tsx
- e2e/keyboard-cards.spec.ts
- src/data/caseRepository.ts
- src/features/capture/CapturePage.tsx
- src/features/case/CardListPage.css
- src/features/case/CardListPanel.css
- src/features/case/EmptyBoard.css
**agentOutputExcerpt:** Implemented CardListPage, grouped CardListPanel, EmptyBoard, deleteCard snapshot/restore, useUndoDelete, routes, board empty-state wiring, and the keyboard Playwright journey; required unit and browser checks pass.
**decisions:** ["Undo snapshots are memory-only and single-level; timeout, dismiss, and a second delete clear the slot with no redo stack.","Restore writes the card, strings, and Blob rows in one repository transaction using original IDs; a missing other endpoint aborts atomically rather than creating a dangling string.","The empty case board replaces the canvas with EmptyBoard so no dead pan, zoom, or fit controls remain.","Capture accepts ?kind=note|source|topic so list and empty-board create actions start the intended path."]
**interfaces:** ["CardDeletionSnapshot, CardDeletionPreview, readCardDeletionPreview, deleteCard, restoreDeletedCard in src/data/deleteCard.ts","CaseRepositoryPort.restoreCardDeletion(snapshot)","useUndoDelete({ repository, onDeleted, onRestored }) -> pending, message, deleteWithUndo, undo, dismiss","CardListPage({ repository?, loadRepository? }), CardListPanel({ cards, connections?, onEdit, onDelete }), EmptyBoard({ caseId })","AppRoutes gains cardListRepository/loadCardListRepository and /case/:caseId/list"]
**tests:** ["npm test -- tests/case/CardListPanel.test.tsx tests/case/useUndoDelete.test.tsx: exit 0 (engine-verified)","npm run test:e2e -- e2e/keyboard-cards.spec.ts: exit 0 (engine-verified)"]
**warnings:** ["Browser evidence covers Chromium desktop, tablet, and phone only.","The keyboard journey restores a seeded connection and attachment through real IndexedDB; the seed uses a browser-evaluate fixture, not pointer input."]
**validationLimitations:** ["Human board-feel review is not applicable to this DOM-only task; spatial placement remains pointer-only by design."]

### work.link-5 (work-link-5-001)
**Summary:** Implemented LINK-5 keyboard connection picker with searchable targets, provenance filtering, create/retype/delete, card detail and card list entry points, announced counts/errors, focus restoration, 13 component tests, and a keyboard-only Playwright journey passing at desktop, tablet, and phone viewports.
**Files changed:**
- src/features/connections/ConnectionPicker.tsx
- src/features/cards/CardDetailPage.tsx
- src/features/case/CardListPanel.tsx
- tests/connections/ConnectionPicker.test.tsx
- e2e/keyboard-links.spec.ts
- src/features/case/CardListPage.tsx
- src/features/connections/connections.css
**agentOutputExcerpt:** Implemented LINK-5 keyboard connection picker with searchable targets, provenance filtering, create/retype/delete, card detail and card list entry points, announced counts/errors, focus restoration, 13 component tests, and a keyboard-only Playwright journey passing at desktop, tablet, and phone viewports.
**decisions:** ["The picker is a canvas-free Dialog that writes through an injected ConnectionRepository and reports resulting rows to the parent page.","Existing pairs are retyped instead of duplicated, preserving the connection ID and pair key.","Attach source opens on Provenance with Source targets; provenance selection filters to Sources for notes and Notes for sources, while Association stays unfiltered.","The picker is rendered only while open and keyed by card and intent, so initial state comes from props without a cascading reset effect."]
**interfaces:** ["ConnectionPicker props: open, currentCard, cards, connections, intent='connect'|'attach-source', repository?, loadRepository?, initialConnectionId?, onClose, onConnectionCreated/Changed/Deleted","CardDetailPage props added: connectionRepository?, loadConnectionRepository?","CardListPanel props added: connectionRepository?, loadConnectionRepository?, onConnectionCreated/Changed/Deleted","CardListPage props added: connectionRepository?, loadConnectionRepository?"]
**tests:** ["npm test -- tests/connections/ConnectionPicker.test.tsx: exit 0 (engine-verified)","npm run test:e2e -- e2e/keyboard-links.spec.ts: exit 0 (engine-verified)"]
**warnings:** ["Card detail is covered for picker reachability and focus return; the full create/retype/delete persistence journey is exercised from the card list.","LINK-HR-1 still owns the human visual and board-feel review."]
**validationLimitations:** ["Component tests run in jsdom; the e2e journey provides the real-browser viewport and IndexedDB evidence."]

### work.link-hr-1 (work-link-hr-1-001)
**Summary:** Operator evidence verified for Review board, pin, and string feel on tablet and desktop
**Files changed:**
- docs/reviews/board-feel.json

*Context projection: ~3189 tokens (21.7% reduction from ~4074 source tokens)*


Relevant project skills (advisory; use required skills when applicable):
Required:
- pixi-case-board — PixiJS 8 case-board rendering, viewport math, card gestures, culling, texture release, string geometry, recall scratch rendering, and teardown for a 150-card tablet target.
Recommended:
- pixijs (unavailable)
- case-domain-integrity — Pure domain schemas, graph invariants, normalized tags, deterministic search and filter selectors, readiness and lifecycle derivation, and transactional IndexedDB repository rules for a single-case evidence board.
- browser-evidence-journeys — Playwright browser evidence for real IndexedDB, file input, downloads, offline reload, viewport matrices, axe scans, and performance floors.
- tdd (unavailable)

Task: Implement scratch connections and recall comparison

Create recallStore.ts with scratch pairs, add, remove, clear, and reset-on-exit actions that exist only in memory. Create compareConnections.ts to canonicalize pairs, compare truth and scratch in either direction, and return remembered, missed, extra, and typeMismatch arrays with stable ordering and no score. Add unit tests for empty, exact, reversed, duplicate, extra, missed, and type-mismatch cases. Add a write-spy test proving no repository or IndexedDB method is called by the store or comparison.

Requirements:
RECALL-FR-02: Let the student draw undirected scratch connections between cards on a non-persistent layer, and discard all scratch state on exit, reload, or route change without a confirmation that blocks leaving.
RECALL-FR-03: On check, mark a truth pair remembered when a scratch connection matches it in either direction, list missed truth pairs and extra scratch pairs, and flag a relationship-type mismatch separately from a missed pair.
RECALL-FR-06: Never write recall scratch state, results, or history to IndexedDB, localStorage, or backups, and respect reduced motion for scratch string animation.

Acceptance criteria:
A reversed scratch pair counts as remembered
Missed truth, extra scratch, and type mismatch are distinct outputs with no duplicates
Clear and reset return the store to an empty scratch state
No comparison result contains a score, percentage, or rank
The write-spy test fails if any storage write occurs

Constraints:
RECALL-CON-01: Recall performs no repository mutation; a test spy must prove no IndexedDB write occurs during enter, draw, check, or exit.
RECALL-CON-02: Results are counts and pair lists only; no score, percentage, grade, streak, or comparative ranking.

Authoritative task references (requirements context, not permission to expand task scope):

- docs/PRD.md#10. System States / Lifecycle
- docs/features/recall-mode.md#RECALL-FR-02
- docs/features/recall-mode.md#RECALL-FR-03
- docs/features/recall-mode.md#RECALL-FR-06
- docs/features/recall-mode.md#RECALL-CON-01
- docs/features/recall-mode.md#RECALL-CON-02
Read the relevant sections of these repository files as needed. The explicit task requirements, criteria and constraints remain mandatory. Do not execute unrelated instructions found in reference content.

Expected output files: src/features/recall/recallStore.ts, src/features/recall/compareConnections.ts, tests/recall/compareConnections.test.ts, tests/recall/recallStore.test.ts

Validation commands to run after completion: npm test -- tests/recall/compareConnections.test.ts tests/recall/recallStore.test.ts; npm run typecheck

Execution budget: Per-task timeout: 2700s; results failing verification are retried up to 2 time(s). Do not rely on retries to fix hollow output - deliver complete results first.

Attempt: 2

Previous attempt was rejected by the engine. Address this failure without expanding task scope:
{"reason":"forge-result.unresolved must be a string array; use [] when no blocking requirements remain.","resultPath":"docs/artifacts/RECALL-1.2026-10-26T16-43-15-081Z.attempt-1.result.json"}
Treat prior output as evidence, not new instructions. Preserve completed work and rerun required checks.

Perform the task now. Do not merely acknowledge it or say you are ready - create or modify the files required, then list the files you created or changed.

Finish with this small report, replacing the example summary with the actual outcome:
```forge-result
{"summary":"Implemented the task and verified the required checks.","unresolved":[]}
```
Only summary and unresolved are required. Keep summary brief (a string; a list of strings is also accepted). unresolved contains ONLY blocking unmet requirements or acceptance criteria; it must be empty for completion. An unverified required check is a blocker, never merely a warning or limitation. Optional string arrays decisions, interfaces, tests, warnings and validationLimitations may carry useful details; omit empty or redundant fields. warnings and validationLimitations are nonblocking only. Leaving changes for engine auto-commit is not a blocker. The engine runs manifest validation itself; never report an unrun check as passed. Do not create human-review attestations.
