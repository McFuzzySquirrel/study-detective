---
name: pixi-case-board
description: "PixiJS 8 case-board rendering, viewport math, card gestures, culling, texture release, string geometry, recall scratch rendering, and teardown for a 150-card tablet target."
---

# Pixi Case Board

Use this skill for the Notes Detective board surface: the lazy PixiJS canvas, viewport transforms, pan and zoom, card lift and drag, string rendering, minimap, culling, texture lifecycle, scale warnings, and the non-persistent recall scratch layer. The board consumes a plain snapshot and emits intents; it never opens Dexie or owns feature forms.

Load `references/viewport-and-gestures.md` when implementing screen/world math, zoom anchoring, fit, pan, minimap projection, or touch and mouse gesture disambiguation.

Load `references/rendering-and-culling.md` when implementing cards, strings, hit testing, texture caching, culling, context-loss recovery, or scene teardown.

Load `references/recall-scratch.md` when adding or reviewing recall mode's hidden truth layer, scratch strings, check overlay, or exit cleanup.

## Process

### Step 1: Keep the boundary lazy and one-way

All `pixi.js` imports stay inside `src/board` and the board is a route-level lazy chunk. The initial app shell must contain no PixiJS, OCR assets, or feature chunks. `BoardScene` reads a plain case snapshot (cards, connections, viewport) and emits intents such as select, move, create-connection, or delete; the page or store performs the write.

If a feature form wants board state, then pass a selector or a callback, not a repository or Dexie instance.

### Step 2: Build the math before the scene

Implement screen-to-world and world-to-screen conversion, pointer-anchored zoom, clamp 0.25-2.5, fit-to-cards with padding, minimap projection, and viewport serialization as pure functions. Test round-trips, clamp edges, zero/one/many cards, and reset paths without a browser.

Persist viewport changes with a 500ms debounce. A fit or recall entry computes an in-memory viewport and must not overwrite the stored viewport until the student actually pans or zooms; otherwise returning to the case loses spatial memory.

### Step 3: Disambiguate gestures explicitly

Mouse drag starts immediately. Touch requires a 500ms long press, then follows the finger; movement before the press or under 6px is a tap that opens card detail. A drag must not open detail. Reduced motion removes lift scaling but keeps the gesture.

Pan is a one-finger background drag; pinch zooms; wheel and trackpad zoom around the pointer. The same anchor gesture creates a connection: show a temporary red thread, highlight a valid target, and reject self-links, empty cork, and duplicates with feedback.

### Step 4: Render within the scale budget

Cards are 240px wide at 100 percent, thumbnail-first, upgrading to the display derivative. Cull cards outside the viewport plus a 200px margin. Keep at most 200 resident textures and release offscreen entries after a short delay. Strings anchor at card edges, sag 12px at 100 percent scaled by zoom, use 3px red for association and 2px dashed amber for provenance, and must handle 300 strings without labels.

Show a dismissible soft warning at 120 cards, a persistent warning at 150, and a hard stop at 200 with a split-case message. Apply the same guard on the capture route so a direct URL cannot create card 201.

### Step 5: Tear down and prove it

On unmount or route change, destroy sprites, textures, ticker, renderer/application, resize and pointer listeners, and object URLs. Recover from WebGL context loss or show a recoverable fallback. Verify with unit tests for math and culling, component tests with a mocked Pixi boundary, and Playwright for pan, zoom, drag, reload, and the keyboard card list.

```bash
npm test -- tests/board/viewport.test.ts tests/board/boardStore.test.ts tests/board/culling.test.ts
npm test -- tests/board/stringGeometry.test.ts tests/board/useCardGestures.test.ts
npm run test:e2e -- e2e/board.spec.ts e2e/board-drag.spec.ts e2e/recall.spec.ts
npm run build
```

If that doesn't work because a test asserts against the wrong chunk, then inspect the Vite manifest and fix the lazy import boundary rather than loosening the test.

## Gotchas

- **The 6px tolerance is measured before lift, not after.** Touch movement under 500ms or under 6px is a tap; applying the tolerance only after the long press makes taps open nothing.
- **Fit-to-view must not persist.** Recall and Fit compute a temporary viewport; writing it immediately overwrites the stored viewport and breaks return-to-place.
- **Zoom must anchor at the pointer.** Scaling around the canvas origin makes wheel and pinch feel like the board jumps away from the cursor.
- **A stored scale outside 0.25-2.5 is a corrupted viewport.** Clamp on read and write, and ignore non-finite values rather than passing them to Pixi.
- **Culling margin and texture cap are different limits.** Culling decides what is drawn; the 200-texture cache decides what stays resident. Releasing a visible texture causes a flash on pan-back.
- **Strings need edge anchors, not card centers.** Center-to-center lines run under card art and break the physical corkboard illusion; recompute anchors for above, below, left, and right relative positions.
- **Recall must never touch the repository.** Scratch pairs live in memory only; a shared create-connection helper that writes is the defect to catch with a write spy.
- **Stale textures outlive a deleted card.** Destroy the card's texture and remove it from the cache on delete and on unmount; otherwise repeated case switching grows GPU memory.
- **Context loss is not unmount.** Restore the scene and textures on `webglcontextrestored`; destroying and recreating the app on the same canvas without cleanup leaks listeners.
- **Pixi in the shell defeats the budget.** A static import from a component or store pulls the library into the initial chunk even if the route is lazy.

## Validation

- [ ] Viewport tests prove round-trip conversion, clamp at 0.25/2.5, pointer anchoring, fit for 0/1/many cards, and minimap projection.
- [ ] Gesture tests prove 500ms lift, 6px tap tolerance, immediate mouse drag, and no detail-open on drag.
- [ ] Culling returns only visible cards plus 200px for a 150-card fixture; the texture cache never exceeds 200.
- [ ] String geometry covers all relative positions, zero distance, zoom levels, reduced motion, and a 300-string batch.
- [ ] The production build emits a separate board chunk with no PixiJS in the initial shell.
- [ ] Unmount destroys the app, ticker, textures, listeners, and URLs; context loss has a tested path.
- [ ] Recall entry hides truth strings and a write spy proves no IndexedDB mutation.
- [ ] Scale warnings appear at 120 and 150; card 201 is blocked on both board and capture routes.

Self-check: open the built app, unmount the board route twice, and confirm no duplicate canvas, listener warning, or retained texture remains.
