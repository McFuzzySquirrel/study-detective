# Rendering, culling, and teardown

Use this reference for Pixi scene composition, strings, textures, performance, and cleanup.

## Scene composition

`BoardScene` owns a background layer, a string layer, a card layer, and an interaction overlay. Keep a plain snapshot of cards and connections as the input; rebuild only the changed layer when the snapshot changes. Do not recreate the whole scene on every selection.

Cards: 240px wide at scale 1, pin at top center, photo with a title strip, type indicator, and a thread anchor at the right edge when selected or hovered. Use a thumbnail texture first and upgrade to display; never load originals for board rendering.

Strings: draw below cards so the endpoints tuck under the card edge. Association is 3px red, provenance is 2px dashed amber, both with 12px sag at scale 1 scaled by zoom. No labels, arrows, scores, or custom colors.

## Culling

Render cards whose world bounds intersect the viewport expanded by a 200px margin. Cull strings when both endpoint cards are outside the same expanded viewport, or when the segment itself is outside. Recompute on pan, zoom, resize, card move, and card add/delete.

The margin exists to avoid a visible pop at the viewport edge during fast pans. A 150-card fixture with a narrow viewport should return a small visible set, not all 150.

## Texture cache

Key by attachment ID and derivative kind. Keep at most 200 resident textures. On insert above the cap, evict the least-recently-visible offscreen entry and call `texture.destroy(true)` only when no visible sprite references it. Do not evict a texture for a card that is currently in the viewport.

Destroy card textures, pin/graphics geometry, string graphics, and cached assets on scene teardown. A `Graphics` object reused across frames should be cleared and redrawn, not reallocated per frame.

## Performance targets

- 60 FPS during pan and zoom at 150 cards on the target tablet; 45 FPS is the floor.
- Culling and thumbnail-first loading are the primary levers; avoid text re-rendering per frame.
- Use `BitmapText` or cached text for repeated titles if text updates dominate.
- Batch policy: keep cards and strings in as few containers as the interaction model allows; avoid per-frame filter changes.
- The automated perf harness runs 150 synthetic cards, pans for five seconds, and records average FPS and p95 frame time with a documented CI floor.

## Context loss and fallback

Listen for `webglcontextlost` and `webglcontextrestored` on the canvas. On loss, stop the ticker and show a recoverable overlay; on restore, rebuild textures and resume. If restore fails twice, offer the card list as the fallback rather than a blank canvas.

## Teardown checklist

- Remove pointer, wheel, resize, visibility, and context listeners.
- Stop and destroy the ticker.
- Destroy sprites, graphics, text, and all cached textures.
- Destroy the renderer/application and remove the canvas.
- Revoke any object URLs created for board textures.
- Clear stores or subscriptions created by the board hook.
- Confirm no duplicate canvas remains after route away and back.

## Scale guard

- 119 cards and below: no warning.
- 120 cards: dismissible soft warning.
- 150 cards or more: persistent warning advising a case split.
- 200 cards: hard stop for new cards with a split-case message; no lower cap.
- The capture route shares the same guard so a direct URL cannot bypass it.
