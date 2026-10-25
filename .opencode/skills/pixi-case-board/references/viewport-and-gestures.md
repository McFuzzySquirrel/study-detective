# Viewport and gestures

Use this reference for board math and input behavior.

## Coordinate model

World space holds card positions and string anchors. Screen space is the canvas viewport. A viewport is `{ x, y, scale }` where `x`/`y` is the world point at the top-left screen corner (or a documented equivalent) and `scale` is the zoom.

- `worldToScreen(point) = (point - viewport.origin) * scale`
- `screenToWorld(point) = point / scale + viewport.origin`
- Round-trip within floating tolerance for every scale in tests.

## Zoom

Clamp `scale` to `[0.25, 2.5]`. To zoom around pointer `p`:

1. `worldBefore = screenToWorld(p)`
2. `nextScale = clamp(scale * factor)`
3. Adjust origin so `worldBefore` maps back to `p` at `nextScale`.

Wheel delta and pinch distance both produce a factor. Ignore non-finite deltas. A zero-size canvas returns without changing state.

## Pan and fit

Pan translates the origin by the screen delta divided by scale. One-finger background drag and mouse drag both pan. Fit computes card bounds plus padding, chooses `scale = min(1, fittedScale)` clamped to the minimum, and centers the bounds. Fit is a temporary view: store it as `pendingViewport`, persist only after a student pan or zoom.

Minimap projection maps world bounds into a small rectangle, draws card rectangles and the current viewport rectangle, and supports tap and drag to move the viewport. Collapse it on phone.

## Gesture state machine

| Input | Start | Move | End |
|-------|-------|------|-----|
| Mouse on card | pointerdown selects; drag begins immediately | Move card in world coordinates | Persist final position after 300ms debounce |
| Touch on card | Start 500ms timer and record start point | Before 500ms: if movement > 6px, cancel lift and treat as pan/tap; after lift: move card | Under 500ms or under 6px: tap opens detail |
| Mouse/touch on cork | Pan | Translate viewport | Persist viewport after 500ms debounce |
| Wheel / trackpad | Zoom around pointer | — | Persist viewport after 500ms debounce |
| Drag from thread anchor | Show temporary thread | Highlight valid target | Create, reject, or select existing |
| Tap on string | — | — | Open connection detail |

The 6px value is a distance threshold from the pointerdown point, not per-event jitter. Reset the timer on pointercancel, pointerup, unmount, and route change.

## Persistence points

- Card position: 300ms debounce after drag end; never write per frame.
- Viewport: 500ms debounce after pan/zoom end.
- Selection, hover, and gesture state: never persisted.
- Recall viewport: in memory only; discard on exit, reload, or route change.

## Accessibility boundary

Spatial placement, panning, and zooming are pointer-only in v1. Provide a visible keyboard card list route that creates, edits, connects, deletes, searches, and recalls without the canvas. Label the canvas with a name and description plus an `Open card list` action; do not claim screen-reader spatial parity.
