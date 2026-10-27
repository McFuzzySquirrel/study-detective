# 08 — Canvas headroom at the new stage size

Type: research
Status: open
Blocked by: —

## Question

Does the larger stage still fit the culling and texture budgets in `BOARD-FR-03` and
`BOARD-FR-07` — and what numbers should the spec state?

Ticket 02 replaces a 884×564 stage with 1 384×783 on desktop and 1 224×683 on tablet landscape,
roughly **2.2× the visible area**. The existing protections are fixed in screen space:

- `BOARD_CULL_MARGIN = 200` px (`src/board/useCulling.ts`), divided by the current scale to get
  a world-space margin — it does not grow with the viewport.
- `MAX_RESIDENT_TEXTURES = 200` (`src/board/textureCache.ts`), with offscreen release.
- A 150-card target for 60 fps, 45 fps floor (`BOARD-FR-03`, `BOARD-FR-07`).

A larger viewport renders more cards at the same zoom even though the margin is unchanged, and
the minimap inset grows with the stage. Determine:

1. **Visible card count** at the new stage sizes for 12, 125 and 150-card cases, at fit zoom and
   at the store's default zoom — cards are 240 px wide at 100 %.
2. **Visible string count** at the same sizes; `StringLayer` culls with the same margin.
3. **Whether the 200 px margin is still the right contract** at the new viewport, or whether it
   should scale with stage size (and what that costs in draw calls).
4. **Whether the 200 resident texture ceiling still covers the worst case**, or whether the
   larger viewport pushes past it.
5. **Whether `BOARD-FR-03`/`BOARD-FR-07` wording needs amending** in the spec's migration notes
   (ticket 07), or the existing code already satisfies it unchanged.

Method: derive the world rect from `visibleRect` + margin ÷ scale; compute counts against the
existing fixtures (`e2e/helpers/seedLargeCase.ts`) and the board tests under `tests/board/`.
Confirm the texture-cache accounting in `textureCache.ts` and the zoom defaults in the board
store. Desktop research only: no `src/` changes, no prototype, no browser session required unless
the static derivation is ambiguous.

Deliver: a table of stage × zoom → visible cards and strings, a verdict on the margin and the
texture ceiling (keep, or a specific replacement value), and the exact wording ticket 07 should
carry into the spec.

## Answer

<!-- resolution: append the measured/derived counts and the budget verdict -->
