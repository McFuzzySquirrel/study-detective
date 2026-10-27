# 08 — Canvas headroom at the new stage size

Type: research
Status: resolved
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

**Resolved.** Keep `BOARD_CULL_MARGIN = 200` and the 200-texture ceiling; do **not** scale either
with the stage. The real regression is **fit-to-view**: the 0.25 zoom floor turns fit into an
overview, so a 150-card case renders 130 cards at 1 384×783 (90 of them on screen) and 110 at
1 224×683. Both `BOARD-FR-03` and `BOARD-FR-07` need amending, plus a 0.25-floor performance
pass. Full derivation, source citations, sensitivity tables, and exact replacement wording live
in the research file.

### Headline — 150-card case, rendered cards / drawn strings

| Stage | Fit (0.25 clamped) | Default 1.0 | Fixture 0.75 |
|---|---|---|---|
| 884×564 (old) | 110 / 181 | 6 / 5 | 8 / 14 |
| **1 384×783 desktop** | **130 / 219** | **10 / 12** | 18 / 27 |
| **1 224×683 tablet** | **110 / 219** | **8 / 10** | 15 / 20 |

At fit, a 125-card case renders 125/125 on desktop and 110/125 on tablet; a 12-card case fits
12/12 on both. Default-camera counts are fixture-specific (10-column seed grid).

### Margin — keep 200 px, do not scale

- It is screen-space pan lead, not viewport proportion; the larger stage makes it relatively
  cheaper: the cull window is **1.95×** the stage at 1 384×783 and **2.10×** at 1 224×683, versus
  **2.48×** at 884×564.
- A proportional rule (`clamp(200, 0.15 × stageWidth, 240)`) changes today's card counts by
  **zero**. Raising it to 300 renders 150 instead of 130 at the desktop fit floor (+15.4%) for no
  extra pan lead.
- At the 0.25 floor the 200 px margin becomes 800 world px and renders 40 cards that are not on
  screen (90 → 130 on desktop for 150 cards). 200 is the knee, not too small.

### Textures — 200 still holds

- Worst rendered frame at the 0.25 floor: **130** desktop, **120** tablet; 70–80 textures of
  headroom.
- It is a **display-derivative** budget: thumbnails are transient and destroyed when the display
  derivative replaces them. Counting both alive at once would transiently reach 260 (300 at 150
  visible); the spec must say thumbnails are excluded, not silently raise the cap.
- `MAX_RESIDENT_TEXTURES = 200` is a contract, not an instantiated cache in the canvas path;
  `BoardTextureCache` is unused today, and the effective bound is one derivative per rendered card
  plus the 3 s offscreen grace. Do not raise the ceiling.

### Fit is the actual regression

150 cards at 10×15 need scale 0.111 on desktop and 0.094 on tablet; both are below the 0.25 floor.
Two coherent choices: keep 0.25 and define fit as an overview (recommended; the current budget
holds), or lower only the fit floor to show all 150 and re-measure the 60/45 fps floors at 150
visible. This redesign should take the first.

### Handoff to 07

1. Replace `BOARD-FR-03` with §8.1's wording (200 px screen-space margin, 130/110 fit counts,
   fit-as-overview).
2. Replace `BOARD-FR-07` with §8.2's wording (measure 60/45 fps at the 0.25 floor: 130 desktop /
   120 tablet; one display texture per rendered card; at most 200 resident; strings in two
   batches).
3. Add §8.3's culling/texture migration note and §8.4's performance-evidence note (the current
   run seeds 0.75 and never reaches the floor; it also seeds zero connections).
4. Reconcile `BOARD-FR-06`'s "reset fits all cards" with the actual behavior (Reset returns to
   100% at the origin; Fit is the control that fits).
5. No `src/` changes and no new tickets from 08.

### Research file

[08-canvas-headroom.md](../research/08-canvas-headroom.md) — derivation, stage × zoom tables,
margin sensitivity, texture accounting, exact requirement text, assumptions, and source table.
