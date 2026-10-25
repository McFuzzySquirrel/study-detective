# Feature: Case Board

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| BOARD-FR-01 | This feature | owns |
| BOARD-FR-02 | This feature | owns |
| BOARD-FR-03 | This feature | owns |
| BOARD-FR-04 | This feature | owns |
| BOARD-FR-05 | This feature | owns |
| BOARD-FR-06 | This feature | owns |
| BOARD-FR-07 | This feature | owns |
| BOARD-FR-08 | This feature | owns |
| VIS-FR-02 | [Vision](../PRD.md) | participates |
| VIS-FR-04 | [Vision](../PRD.md) | participates |
| VIS-CON-15 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Case Board
**ID Prefix:** BOARD
**Summary:** Renders the infinite corkboard with PixiJS, supports pan, zoom, card placement, fit-to-view, minimap, culling, scale warnings, an accessible card list, and single-level undo for card deletion.
**Dependencies:** Local Data and Case Shelf, Evidence Capture
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| BOARD-US-01 | Exam-focused university student | Must |
| BOARD-US-02 | Returning reviser | Must |
| BOARD-US-03 | Keyboard-only student | Must |

```forge-requirement
{"id":"BOARD-US-01","kind":"story","text":"As a student, I want to arrange my evidence freely on a large board so that the layout reflects how I think about the exam."}
```

```forge-requirement
{"id":"BOARD-US-02","kind":"story","text":"As a returning reviser, I want the board to reopen where I left it so that I do not lose my spatial memory."}
```

```forge-requirement
{"id":"BOARD-US-03","kind":"story","text":"As a keyboard-only student, I want a card list that can do everything except place cards so that the board is not a wall."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"BOARD-FR-01","kind":"requirement","text":"Render cards on an infinite PixiJS canvas with pointer drag pan, pinch zoom, wheel and trackpad zoom from 0.25 to 2.5, a DOM control overlay, and a lazy-loaded board chunk that keeps PixiJS out of the initial payload."}
```

```forge-requirement
{"id":"BOARD-FR-02","kind":"requirement","text":"Place and move cards freely, persist positions with a short debounce, lift with a 500ms long press on touch and immediate drag with a mouse, and distinguish a tap that opens detail from a drag that does not."}
```

```forge-requirement
{"id":"BOARD-FR-03","kind":"requirement","text":"Provide fit-to-view, a minimap showing the viewport and cards, viewport culling, thumbnail-first textures, and on-demand loading so a 150-card case remains navigable."}
```

```forge-requirement
{"id":"BOARD-FR-04","kind":"requirement","text":"Show a dismissible soft warning at 120 cards, a persistent warning at 150 or more advising a case split, and a hard stop at 200 cards with no limit below 200."}
```

```forge-requirement
{"id":"BOARD-FR-05","kind":"requirement","text":"Provide an empty-board state that starts capture and a keyboard-operable card list and detail path that creates, edits, and deletes non-spatial card data without using the canvas."}
```

```forge-requirement
{"id":"BOARD-FR-06","kind":"requirement","text":"Persist the last viewport per case, restore it on return, and expose a reset that fits all cards without overwriting the stored viewport until the student moves the board again."}
```

```forge-requirement
{"id":"BOARD-FR-07","kind":"requirement","text":"Target 60 frames per second during pan and zoom at 150 cards, treat 45 frames per second as the floor on the target tablet, and release textures for cards that stay offscreen."}
```

```forge-requirement
{"id":"BOARD-FR-08","kind":"requirement","text":"Delete a card only after confirmation that names how many strings will be removed, then offer a single-level 8-second undo toast that restores the card, its attachments, and its connections; no redo stack."}
```

```forge-requirement
{"id":"BOARD-CON-01","kind":"constraint","text":"Spatial placement, panning, and zooming are pointer-only; the DOM card list and detail path are the accessible equivalent for non-spatial work."}
```

```forge-requirement
{"id":"BOARD-CON-02","kind":"constraint","text":"The board scene reads a plain case snapshot and emits intents; it never opens Dexie or imports feature forms directly."}
```

```forge-requirement
{"id":"BOARD-CON-03","kind":"constraint","text":"Cull offscreen cards, cap resident textures, and destroy textures, tickers, and the Pixi application on unmount or route change."}
```

---

## 4. UI / Interaction Design

- The board fills the content region below the top bar. A translucent bottom-left control cluster holds zoom out, zoom percentage, zoom in, fit, and minimap toggle; a bottom-right primary action opens capture. On phone widths the cluster collapses to a single sheet trigger.
- The cork surface is a tiled texture or procedural pattern from the theme. Cards are 240px wide at 100 percent, with a pin at the top center, a photo, and a title strip. Selection adds a lifted shadow and a thin outline, not a color change.
- Pan is one-finger drag on the background; pinch zooms. Mouse drag pans; wheel and trackpad zoom around the pointer. Zoom is clamped to 0.25–2.5.
- A touch card lifts after 500ms with a short scale and shadow, then follows the finger. Movement before 500ms or under 6px is a tap. Mouse drag starts immediately. Reduced motion removes lift animation but not the gesture.
- The minimap is a small inset showing card rectangles and the viewport rectangle. Tapping or dragging it moves the viewport. It can be collapsed on phone.
- The card list route `/case/:caseId/list` is a full-screen alternative to the canvas. It groups cards by type, shows title and topic status, and offers Add, Edit, Connect, and Delete. This is the keyboard path; it does not claim to place cards.
- Empty board: a centered case-file panel with `Add note`, `Add source`, `Add topic`, and a short hint about the thread anchor. No dead canvas controls.
- Delete card: confirmation names the card and the number of strings that will be removed. After deletion, a toast offers Undo for 8 seconds. Undo restores the exact card, attachments, connections, and positions; a second delete replaces the undo slot.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| BOARD-1 | Pure viewport math and board UI state | board-engineer | Viewport, board store, tests | Unit tests | No Pixi |
| BOARD-2 | Lazy Pixi canvas with pan/zoom and case route | board-engineer | Canvas, scene, app hook, case page, route, tests | Component and browser tests | No card gestures |
| BOARD-3 | Card lift, drag, tap, and persisted positions | board-engineer | Card sprite/layer, gestures, tests | Gesture tests and browser drag | No strings |
| BOARD-4 | Fit, minimap, culling, texture release, scale warnings | board-engineer | Minimap, culling, warning, controls, tests | Unit and component tests | No keyboard list |
| BOARD-5 | Keyboard card list, empty state, delete and undo | ui-engineer | List page/panel, empty state, delete hook, tests | Component and browser keyboard journey | No connection actions on canvas |

---

## 6. Implementation Tasks

### Phase 1: Canvas and placement

```forge-task
{
  "id": "BOARD-1",
  "title": "Implement viewport math and board state",
  "description": "Create pure viewport helpers for screen/world conversion, pan, zoom around a pointer, clamp 0.25 to 2.5, fit-to-cards with padding, minimap projection, and viewport serialization. Create a Zustand board store for viewport, selected card, hovered card, mode, and gesture state. The store must expose actions and selectors without importing PixiJS, Dexie, or React components. Add unit tests for every transform, clamp, fit, and reset path.",
  "ownerAgent": "board-engineer",
  "dependencies": [
    "CAP-2"
  ],
  "expectedOutputs": [
    "src/board/viewport.ts",
    "src/board/boardStore.ts",
    "tests/board/viewport.test.ts",
    "tests/board/boardStore.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/board/viewport.test.ts tests/board/boardStore.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/case-board.md#BOARD-FR-01",
      "docs/features/case-board.md#BOARD-FR-02",
      "docs/features/case-board.md#BOARD-FR-06"
    ],
    "acceptanceCriteria": [
      "Screen-to-world and world-to-screen round-trip within floating tolerance",
      "Zoom clamps at 0.25 and 2.5 and keeps the pointer anchored",
      "Fit-to-cards handles zero, one, and many cards with padding and never exceeds the clamp",
      "Store actions update only their slice and selectors do not allocate new objects per render",
      "No Pixi, Dexie, or React component import appears in the board math or store"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/case-board.md#BOARD-CON-02"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

```forge-task
{
  "id": "BOARD-2",
  "title": "Mount the lazy Pixi canvas and case board route",
  "description": "Build BoardCanvas, usePixiApp, BoardScene, and textureCache. The case page loads the case and cards, mounts the canvas, renders the cork background and card containers, wires pan/pinch/wheel zoom to the board store, handles resize, WebGL context loss and restore, and destroys the app, ticker, textures, and listeners on unmount. Keep the Pixi import confined to src/board and lazy-load BoardCanvas from CaseBoardPage. Replace the case placeholder in routes and add links to capture and the card list route. Persist viewport changes with a 500ms debounce through CaseRepository; restore the stored viewport on load. Do not implement card drag, fit, minimap, or strings yet.",
  "ownerAgent": "board-engineer",
  "dependencies": [
    "BOARD-1",
    "CAP-3"
  ],
  "expectedOutputs": [
    "src/board/BoardCanvas.tsx",
    "src/board/BoardScene.ts",
    "src/board/usePixiApp.ts",
    "src/board/textureCache.ts",
    "src/features/case/CaseBoardPage.tsx",
    "src/features/case/CaseBoardPage.css",
    "src/data/caseRepository.ts",
    "src/app/routes.tsx",
    "tests/board/BoardCanvas.test.tsx",
    "e2e/board.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/board/BoardCanvas.test.tsx",
    "npm run test:e2e -- e2e/board.spec.ts",
    "npm run build"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/case-board.md#BOARD-FR-01",
      "docs/features/case-board.md#BOARD-FR-07"
    ],
    "acceptanceCriteria": [
      "The board route replaces its placeholder, shows a canvas with an accessible label, and exposes pan and zoom controls",
      "A scripted pan changes the rendered viewport; zoom stays within 0.25 to 2.5",
      "The stored viewport reloads and a fit/reset action does not persist until the student moves the board",
      "Unmount destroys the Pixi app, ticker, textures, and listeners with no console error",
      "The initial app shell chunk does not contain pixi.js; the build emits a separate board chunk",
      "A lost WebGL context is restored or the board shows a recoverable fallback"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/case-board.md#BOARD-CON-02",
      "docs/features/case-board.md#BOARD-CON-03",
      "docs/features/app-foundation.md#FND-CON-01"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

```forge-task
{
  "id": "BOARD-3",
  "title": "Implement card lift, drag, tap, and position persistence",
  "description": "Create CardSprite, CardLayer, and useCardGestures. Render a thumbnail-first texture that upgrades to the display derivative, a pin, a title strip, and a type indicator. Mouse drag starts immediately; touch requires a 500ms long press with a 6px movement tolerance. Taps open the card detail route. Dragging updates the board store at frame rate and persists the final position with a 300ms debounce. Reduced motion removes lift scaling. Mount CardLayer in BoardScene. Do not render strings or selection menus.",
  "ownerAgent": "board-engineer",
  "dependencies": [
    "BOARD-2"
  ],
  "expectedOutputs": [
    "src/board/CardSprite.ts",
    "src/board/CardLayer.ts",
    "src/board/BoardScene.ts",
    "src/board/useCardGestures.ts",
    "tests/board/useCardGestures.test.ts",
    "e2e/board-drag.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/board/useCardGestures.test.ts",
    "npm run test:e2e -- e2e/board-drag.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/case-board.md#BOARD-FR-02"
    ],
    "acceptanceCriteria": [
      "A touch under 500ms or under 6px opens detail; a long press lifts and drags",
      "BoardScene mounts CardLayer so cards are visible and interactive through the case route",
      "A mouse drag moves a card immediately and a click without movement opens detail",
      "The final position persists and survives reload; intermediate drag positions do not write",
      "Reduced motion removes the lift scale while preserving drag behavior",
      "The Playwright drag journey moves a card and verifies its stored position after reload"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/case-board.md#BOARD-CON-01",
      "docs/features/case-board.md#BOARD-CON-02"
    ],
    "references": [
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

### Phase 2: Scale and non-spatial path

```forge-task
{
  "id": "BOARD-4",
  "title": "Add fit-to-view, minimap, culling, texture release, and scale warnings",
  "description": "Build FitToViewButton, Minimap, useCulling, ScaleWarning, texture-cache eviction, and a shared board-capacity guard. Fit calculates bounds with padding. The minimap projects cards and the viewport, supports tap and drag navigation, and collapses on phone. Culling renders only visible cards plus a 200px margin. The texture cache keeps at most 200 resident textures and releases offscreen textures after a short delay. Show a dismissible soft warning at 120 cards, a persistent warning at 150, and a hard stop at 200 with a split-case message. Apply the same 200-card guard to the capture route so a direct URL cannot bypass it. Add unit and component tests with synthetic 150-card data and a guard test at 199 and 200.",
  "ownerAgent": "board-engineer",
  "dependencies": [
    "BOARD-3"
  ],
  "expectedOutputs": [
    "src/board/Minimap.tsx",
    "src/board/useCulling.ts",
    "src/board/FitToViewButton.tsx",
    "src/features/case/ScaleWarning.tsx",
    "src/features/capture/CapturePage.tsx",
    "src/board/textureCache.ts",
    "src/features/case/CaseBoardPage.tsx",
    "tests/board/Minimap.test.tsx",
    "tests/board/culling.test.ts",
    "tests/case/ScaleWarning.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/board/Minimap.test.tsx tests/board/culling.test.ts tests/case/ScaleWarning.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/case-board.md#BOARD-FR-03",
      "docs/features/case-board.md#BOARD-FR-04",
      "docs/features/case-board.md#BOARD-FR-07",
      "docs/PRD.md#VIS-FR-04"
    ],
    "acceptanceCriteria": [
      "Culling returns only cards intersecting the viewport plus the 200px margin for a 150-card fixture",
      "The texture cache never exceeds 200 resident textures and releases offscreen entries",
      "Minimap tap and drag move the viewport; the viewport rectangle tracks pan and zoom",
      "Warnings appear at 120 and 150 with the specified persistence, and 200 blocks new cards with a split-case message",
      "The capture route refuses to create a 201st card at 200 and shows the same split-case message",
      "No case below 200 cards is blocked"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/case-board.md#BOARD-CON-01",
      "docs/features/case-board.md#BOARD-CON-03"
    ],
    "references": [
      "docs/PRD.md#7. Non-Functional Requirements"
    ]
  }
}
```

```forge-task
{
  "id": "BOARD-5",
  "title": "Build the keyboard card list, empty state, and delete undo",
  "description": "Create CardListPage at /case/:caseId/list and CardListPanel with grouped cards, title, type, and topic-status slot. Add Add, Edit, Open detail, and Delete actions. Replace the case placeholder's empty state with EmptyBoard offering note, source, and topic capture. Implement deleteCard and a useUndoDelete hook: confirmation names the affected string count, deletion removes the card, connections, and attachments immediately, and an 8-second toast can restore the snapshot including attachments. Clear the snapshot on timeout or a second delete; no redo. Wire routes and links from the board. Do not add connection creation here.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "BOARD-4"
  ],
  "expectedOutputs": [
    "src/features/case/CardListPage.tsx",
    "src/features/case/CardListPanel.tsx",
    "src/features/case/EmptyBoard.tsx",
    "src/features/case/useUndoDelete.ts",
    "src/data/deleteCard.ts",
    "src/features/case/CaseBoardPage.tsx",
    "src/app/routes.tsx",
    "tests/case/CardListPanel.test.tsx",
    "tests/case/useUndoDelete.test.tsx",
    "e2e/keyboard-cards.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/case/CardListPanel.test.tsx tests/case/useUndoDelete.test.tsx",
    "npm run test:e2e -- e2e/keyboard-cards.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/case-board.md#BOARD-FR-05",
      "docs/features/case-board.md#BOARD-FR-08"
    ],
    "acceptanceCriteria": [
      "The card list route is keyboard reachable and groups notes, sources, and topics without using the canvas",
      "Create, edit, and delete work from the list with visible focus and announced changes",
      "Delete confirmation names the number of strings removed and offers Undo for 8 seconds",
      "Undo restores the card, attachments, connections, and positions; a second delete or timeout clears the snapshot",
      "The empty board offers note, source, and topic capture and no dead canvas control",
      "The Playwright keyboard journey completes card deletion and undo without pointer input"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/case-board.md#BOARD-CON-01",
      "docs/PRD.md#VIS-CON-14"
    ],
    "references": [
      "docs/PRD.md#9. Accessibility",
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Viewport transforms, fit, culling, texture cache, delete snapshot | Vitest with deterministic geometry and synthetic cards |
| Component | Canvas wrapper, minimap, scale warning, card list, empty state, undo toast | React Testing Library with mocked Pixi boundary |
| Browser | Pan, zoom, drag, reload position, keyboard card journey | Playwright at tablet and desktop viewports |
| Human | Pin and board feel | LINK-HR-1 after connections are available |

Key scenarios:

1. Pan and zoom stay clamped and pointer-anchored.
2. A touch long press moves a card; a tap opens detail.
3. 150 synthetic cards cull to the viewport and the texture cache stays bounded.
4. The empty state starts capture; the list path creates and deletes without a pointer.
5. Undo restores strings and attachments within 8 seconds.

---

## 8. Acceptance Criteria

1. A case opens on a pannable, zoomable Pixi board with persisted viewport and no Pixi in the initial shell chunk.
2. Cards lift, drag, tap, and persist positions on touch and mouse.
3. Fit, minimap, culling, and texture release keep a 150-card case navigable.
4. Scale warnings appear at 120 and 150; new cards stop at 200.
5. The keyboard card list supports create, edit, delete, and 8-second undo without the canvas.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should the board use a real cork texture asset? | Start procedural; add a CC0 texture only if the visual review asks for it. |
| 2 | Should card size be adjustable? | No; fixed 240px card width in v1. |
| 3 | Should viewport restore override a fit-to-view from recall? | No; recall fits in memory and leaves the stored viewport intact. |
