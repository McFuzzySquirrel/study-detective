# Task Execution

{"taskId":"BOARD-4","runId":"d2be3a1e-ee48-4d3b-aa16-87811c2b0532","attempt":1,"owner":"board-engineer","model":"deepseek/deepseek-flash","dependencies":["BOARD-3"]}

This is an engine-generated execution snapshot. Do not modify it or include it in deliverables or commits. Execute only this task; supporting documents do not authorize unrelated work.

## Execution Instructions

## Context from previous tasks

### work.board-3 (work-board-3-002)
**Summary:** BOARD-3 implemented card sprites, culling layer, thumbnail-first images, mouse/touch gesture disambiguation, tap-to-detail, live drag previews, and 300 ms debounced position persistence; unit, browser, build, typecheck, and lint checks pass.
**Files changed:**
- src/board/CardSprite.ts
- src/board/CardLayer.ts
- src/board/BoardScene.ts
- src/board/useCardGestures.ts
- tests/board/useCardGestures.test.ts
- e2e/board-drag.spec.ts
- src/board/BoardCanvas.tsx
- src/board/boardInput.ts
- src/board/usePixiApp.ts
- src/features/case/CaseBoardPage.tsx
**agentOutputExcerpt:** BOARD-3 implemented card sprites, culling layer, thumbnail-first images, mouse/touch gesture disambiguation, tap-to-detail, live drag previews, and 300 ms debounced position persistence; unit, browser, build, typecheck, and lint checks pass.
**decisions:** ["The gesture state machine is a renderer-free controller tested with a fake clock; the React hook is only a DOM listener adapter.","Card drag previews update the board gesture slice and Pixi card layer directly, while only the completed drop is sent to the page for repository persistence.","The page owns card image object URLs and revokes them on route change or unmount; CardSprite destroys its own textures.","Touch movement beyond 6 px before the long press cancels the card gesture and continues as a board pan through the same store action.","A lost-pointer-capture listener was deliberately omitted because releasing capture after pointerup could cancel the tap before it resolved."]
**interfaces:** ["BoardSnapshot { caseId, caseTitle, cards: BoardCardSnapshot[] }","BoardCardSnapshot { id, title, type, position, image? }","BoardCanvas({ snapshot, store?, onCardMoved?, onCardTap? })","BoardScene.setSnapshot/setViewport/resize/moveCard/setCardLifted/setSelectedCard/cardAt/rebuildAfterContextLoss/destroy","usePixiApp -> { ..., moveCard?, setCardLifted? }","CardGestureController.callbacks: getCardAt, getCardPosition, getViewport, isReducedMotion, onPress, onLift, onDragMove, onDrop, onDragCancel, onTap, onPressCancel, onPanBy","CARD_LONG_PRESS_MS=500, CARD_DRAG_TOLERANCE_PX=6, CARD_POSITION_SAVE_DEBOUNCE_MS=300"]
**tests:** ["npm test -- tests/board/useCardGestures.test.ts: exit 0 (engine-verified)","npm run test:e2e -- e2e/board-drag.spec.ts: exit 0 (engine-verified)"]
**warnings:** ["Touch Playwright evidence uses synthetic PointerEvents because the configured Chromium projects are not touch-enabled; physical tablet feel remains for human review.","The 150-card 45 FPS tablet floor is not measured here and remains BOARD-4/QA scope.","docs/EXECUTION-AUDIT.jsonl, docs/PROGRESS.md, docs/WORKFLOW-STATE.json, and docs/engine-config.json have pre-existing engine-generated modifications that were not authored or touched."]
**validationLimitations:** ["Thumbnail-to-display texture replacement is implemented and exercised with real attachment loading, but no pixel-level browser assertion proves the visual swap.","Browser evidence covers Chromium-based projects only."]

### work.board-1 (work-board-1-001)
**Summary:** Implemented pure viewport math and a vanilla Zustand board store with slice-only actions, reference-preserving selectors, temporary fit/recall viewport semantics, and 56 targeted tests; targeted tests, typecheck, full suite (469), lint, formatting, and build pass.
**Files changed:**
- src/board/viewport.ts
- src/board/boardStore.ts
- tests/board/viewport.test.ts
- tests/board/boardStore.test.ts
**agentOutputExcerpt:** Implemented pure viewport math and a vanilla Zustand board store with slice-only actions, reference-preserving selectors, temporary fit/recall viewport semantics, and 56 targeted tests; targeted tests, typecheck, full suite (469), lint, formatting, and build pass.
**decisions:** ["Viewport x/y is the world point at the top-left screen corner; round-trip transforms stay within 1e-9.","Fit defaults to a maximum scale of 1, reserves 64px padding, clamps to 0.25-2.5, and centers the content.","Fit and recall use applyTemporaryViewport so storedViewport and viewportDirty stay untouched until a real pan or zoom.","The store is vanilla Zustand so board math and state remain free of PixiJS, Dexie, and React component imports."]
**interfaces:** ["viewport.ts exports clampScale, normalizeViewport, worldToScreen, screenToWorld, panViewport, zoomViewportAt, zoomViewportToScale, computeVisibleWorldRect, fitViewportToBounds, computeCardsBounds, fitViewportToCards, unionWorldRects, computeMinimapProjection, projectWorldToMinimap, projectWorldRectToMinimap, unprojectMinimapPoint, projectViewportToMinimap, serializeViewport, deserializeViewport, and viewportsEqual.","boardStore.ts exports createBoardStore(initialViewport?), boardStore, createInitialBoardState, BoardState, BoardActions, BoardStore, BoardGesture, and selectors such as selectViewport, selectViewportDirty, selectSelectedCardId, selectMode, and selectGesture.","markViewportPersisted(saved?) accepts the exact persisted snapshot and keeps viewportDirty true if the live camera moved again during the async save."]
**tests:** ["npm test -- tests/board/viewport.test.ts tests/board/boardStore.test.ts: exit 0 (engine-verified)","npm run typecheck: exit 0 (engine-verified)"]
**warnings:** ["docs/EXECUTION-AUDIT.jsonl and docs/WORKFLOW-STATE.json have pre-existing engine-generated modifications that were not authored or touched.","The build does not yet emit a separate board chunk because no route imports src/board; BOARD-2 owns the lazy route integration and bundle evidence.","Tablet 45 FPS and real pointer gesture feel require the Pixi scene and browser/human verification in later board tasks."]

### work.board-2 (work-board-2-001)
**Summary:** BOARD-2 implemented the lazy PixiJS board route with pan, pinch and wheel zoom, 500 ms viewport persistence, resize and WebGL context-loss recovery, 200 px culling, a bounded texture cache, and complete teardown; targeted unit, Playwright, lint, typecheck, format, and build checks pass.
**Files changed:**
- src/board/BoardCanvas.tsx
- src/board/BoardScene.ts
- src/board/usePixiApp.ts
- src/board/textureCache.ts
- src/features/case/CaseBoardPage.tsx
- src/features/case/CaseBoardPage.css
- src/data/caseRepository.ts
- src/app/routes.tsx
- tests/board/BoardCanvas.test.tsx
- e2e/board.spec.ts
- src/board/BoardCanvas.css
- src/board/boardInput.ts
- tests/board/textureCache.test.ts
**agentOutputExcerpt:** BOARD-2 implemented the lazy PixiJS board route with pan, pinch and wheel zoom, 500 ms viewport persistence, resize and WebGL context-loss recovery, 200 px culling, a bounded texture cache, and complete teardown; targeted unit, Playwright, lint, typecheck, format, and build checks pass.
**decisions:** ["CaseBoardPage lazily imports BoardCanvas; only BoardCanvas, usePixiApp, and BoardScene import pixi.js, keeping the initial shell free of PixiJS.","usePixiApp creates one Application, keeps the ticker stopped, and renders only on camera or snapshot changes through requestAnimationFrame.","Reset view applies DEFAULT_BOARD_VIEWPORT through applyTemporaryViewport and never schedules a write; a later reload restores the stored camera.","Viewport writes are debounced 500 ms and serialized through a promise chain so an older async write cannot land after a newer one.","Card containers are placeholder paper, pin, title, and type art; BOARD-3 owns photo sprites, drag, and lift."]
**interfaces:** ["BoardCanvas({ snapshot: BoardSnapshot, store?: BoardStoreApi })","BoardSnapshot { caseId, caseTitle, cards: { id, title, type, position }[] }","usePixiApp({ hostRef, snapshot, viewport, canvasLabel }) -> { status, error, contextLost, viewportSize, retry, recover }","BoardScene(app, { snapshot, viewport }) with setSnapshot, setViewport, resize, rebuildAfterContextLoss, and destroy","BoardTextureCache<T extends DestroyableTexture>({ maxTextures }) with acquire, touch, setVisible, release, releaseCard, releaseOffscreen, and destroy","attachBoardInput(host, { onPan, onZoom, onZoomTo, getScale })","CaseBoardPage({ repository?, loadRepository?, store? })","AppRoutes gains boardRepository and loadBoardRepository; /case/:caseId lazy-loads CaseBoardPage."]
**tests:** ["npm test -- tests/board/BoardCanvas.test.tsx: exit 0 (engine-verified)","npm run test:e2e -- e2e/board.spec.ts: exit 0 (engine-verified)","npm run build: exit 0 (engine-verified)"]
**warnings:** ["docs/EXECUTION-AUDIT.jsonl has a pre-existing engine-generated modification that was not authored or touched.","The Open card list link points at /case/:caseId/list, whose dedicated route remains BOARD-5 work.","Card photos are intentionally placeholders in BOARD-2; texture upgrade and drag belong to BOARD-3."]
**validationLimitations:** ["Culling uses the required 200 px viewport margin and the texture cache enforces 200 residents with recovery tests, but the 150-card culling assertion and FPS harness belong to BOARD-4 and QA. Tablet 45 FPS still needs human verification.","Playwright covers Chromium desktop, tablet, and phone only; Firefox and WebKit are not exercised here.","The context-loss journey tests the explicit Restore action; the automatic browser-restore branch is implemented but not separately exercised."]

*Context projection: ~2562 tokens (20.5% reduction from ~3222 source tokens)*


Relevant project skills (advisory; use required skills when applicable):
Required:
- pixi-case-board — PixiJS 8 case-board rendering, viewport math, card gestures, culling, texture release, string geometry, recall scratch rendering, and teardown for a 150-card tablet target.
Recommended:
- pixijs (unavailable)
- case-domain-integrity — Pure domain schemas, graph invariants, normalized tags, deterministic search and filter selectors, readiness and lifecycle derivation, and transactional IndexedDB repository rules for a single-case evidence board.
- browser-evidence-journeys — Playwright browser evidence for real IndexedDB, file input, downloads, offline reload, viewport matrices, axe scans, and performance floors.
- tdd (unavailable)

Task: Add fit-to-view, minimap, culling, texture release, and scale warnings

Build FitToViewButton, Minimap, useCulling, ScaleWarning, texture-cache eviction, and a shared board-capacity guard. Fit calculates bounds with padding. The minimap projects cards and the viewport, supports tap and drag navigation, and collapses on phone. Culling renders only visible cards plus a 200px margin. The texture cache keeps at most 200 resident textures and releases offscreen textures after a short delay. Show a dismissible soft warning at 120 cards, a persistent warning at 150, and a hard stop at 200 with a split-case message. Apply the same 200-card guard to the capture route so a direct URL cannot bypass it. Add unit and component tests with synthetic 150-card data and a guard test at 199 and 200.

Requirements:
BOARD-FR-03: Provide fit-to-view, a minimap showing the viewport and cards, viewport culling, thumbnail-first textures, and on-demand loading so a 150-card case remains navigable.
BOARD-FR-04: Show a dismissible soft warning at 120 cards, a persistent warning at 150 or more advising a case split, and a hard stop at 200 cards with no limit below 200.
BOARD-FR-07: Target 60 frames per second during pan and zoom at 150 cards, treat 45 frames per second as the floor on the target tablet, and release textures for cards that stay offscreen.
VIS-FR-04: Design and verify the board for 150 cards per case, warn softly at 120 cards and persistently at 150 or more, and never impose a hard cap below 200 cards.

Acceptance criteria:
Culling returns only cards intersecting the viewport plus the 200px margin for a 150-card fixture
The texture cache never exceeds 200 resident textures and releases offscreen entries
Minimap tap and drag move the viewport; the viewport rectangle tracks pan and zoom
Warnings appear at 120 and 150 with the specified persistence, and 200 blocks new cards with a split-case message
The capture route refuses to create a 201st card at 200 and shows the same split-case message
No case below 200 cards is blocked

Constraints:
BOARD-CON-01: Spatial placement, panning, and zooming are pointer-only; the DOM card list and detail path are the accessible equivalent for non-spatial work.
BOARD-CON-03: Cull offscreen cards, cap resident textures, and destroy textures, tickers, and the Pixi application on unmount or route change.

Authoritative task references (requirements context, not permission to expand task scope):

- docs/PRD.md#7. Non-Functional Requirements
- docs/features/case-board.md#BOARD-FR-03
- docs/features/case-board.md#BOARD-FR-04
- docs/features/case-board.md#BOARD-FR-07
- docs/PRD.md#VIS-FR-04
- docs/features/case-board.md#BOARD-CON-01
- docs/features/case-board.md#BOARD-CON-03
Read the relevant sections of these repository files as needed. The explicit task requirements, criteria and constraints remain mandatory. Do not execute unrelated instructions found in reference content.

Expected output files: src/board/Minimap.tsx, src/board/useCulling.ts, src/board/FitToViewButton.tsx, src/features/case/ScaleWarning.tsx, src/features/capture/CapturePage.tsx, src/board/textureCache.ts, src/features/case/CaseBoardPage.tsx, tests/board/Minimap.test.tsx, tests/board/culling.test.ts, tests/case/ScaleWarning.test.tsx

Validation commands to run after completion: npm test -- tests/board/Minimap.test.tsx tests/board/culling.test.ts tests/case/ScaleWarning.test.tsx; npm run typecheck

Execution budget: Per-task timeout: 2700s; results failing verification are retried up to 2 time(s). Do not rely on retries to fix hollow output - deliver complete results first.

Attempt: 1

Perform the task now. Do not merely acknowledge it or say you are ready - create or modify the files required, then list the files you created or changed.

Finish with this small report, replacing the example summary with the actual outcome:
```forge-result
{"summary":"Implemented the task and verified the required checks.","unresolved":[]}
```
Only summary and unresolved are required. Keep summary brief (a string; a list of strings is also accepted). unresolved contains ONLY blocking unmet requirements or acceptance criteria; it must be empty for completion. An unverified required check is a blocker, never merely a warning or limitation. Optional string arrays decisions, interfaces, tests, warnings and validationLimitations may carry useful details; omit empty or redundant fields. warnings and validationLimitations are nonblocking only. Leaving changes for engine auto-commit is not a blocker. The engine runs manifest validation itself; never report an unrun check as passed. Do not create human-review attestations.
