# 08 — Canvas headroom at the new stage size

Type: research
Status: resolved
Blocked by: —

Research file for ticket
[08](../issues/08-canvas-headroom-at-new-stage-size.md). Static derivation only: no
`src/` changes, no browser session. All numbers come from the pure helpers in
`src/board/` and the `seedLargeCase` fixture, replayed exactly as the canvas runs them.

## Verdict

1. **Keep `BOARD_CULL_MARGIN = 200`.** It is a screen-space pan-lead, not a fraction of the
   viewport. The larger stage makes it *relatively cheaper*: the cull window is 1.95× the stage
   area at 1 384×783 versus 2.48× at 884×564. Scaling it with the stage buys nothing and costs
   cards: 200 → 300 at the fit floor raises the worst frame from 130 to 150 cards (+15.4%).
2. **The 200-texture ceiling still holds, with at least 70 textures of headroom.** The 150-card
   fit frame renders 130 cards on the new desktop stage and 110 on tablet; the worst pan at the
   0.25 floor is 130 / 120. That is the display-derivative count. Do not raise the ceiling.
   Record that it is a *display-derivative* budget: if thumbnails and displays are counted
   together during a load storm the transient is 2× (260 at 130 cards), which the 200 constant
   cannot cover.
3. **The real regression is fit-to-view, not the margin.** Fit is clamped at
   `MIN_BOARD_SCALE = 0.25`, and a 150-card grid needs 0.111 on desktop / 0.094 on tablet. Fit
   therefore renders 130/150 cards at 1 384×783 and 110/150 at 1 224×683. `BOARD-FR-03` says
   fit-to-view keeps a 150-card case navigable; that wording is only true if "fit" is defined as
   an overview inside the zoom clamp. Amend it (exact text in §8) rather than lowering the zoom
   floor in this redesign.
4. **`BOARD-FR-07` needs a measurable worst-case clause.** The current 150-card e2e seeds a
   0.75 camera with zero connections and never gets near the 0.25 fit-floor frame. Amend it to
   measure 60/45 fps at 130 rendered cards (desktop) and 120 (tablet, worst pan at the 0.25
   floor), and at most two string draw batches.
5. **Adjacent, not part of 08:** `BOARD-FR-06` says reset "fits all cards", but Reset returns to
   100% at the world origin; Fit is a separate control. Ticket 07 should reconcile that sentence
   while it is in the same document.

### Headline table — 150-card case

| Metric | Old 884×564 | Desktop 1 384×783 | Tablet 1 224×683 |
|---|---|---|---|
| Stage area | 498 576 px² | 1 083 672 px² (**2.17×**) | 835 992 px² (**1.68×**) |
| Fit raw scale (needed) | 0.0736 | 0.1106 | 0.0938 |
| Fit applied scale | 0.25 (clamped) | 0.25 (clamped) | 0.25 (clamped) |
| Rendered cards at fit | 110 | **130** (+18.2%) | 110 (0%) |
| Drawn strings at fit | 181 | **219** (+21.0%) | 219 (+21.0%) |
| Rendered cards at default 1.0 | 6 | **10** (+66.7%) | 8 (+33.3%) |
| Drawn strings at default 1.0 | 5 | 12 | 10 |
| On-screen cards at fit (no margin) | 70 | 90 | 70 |
| Margin-only cards at fit | 40 | 40 | 40 |
| Display textures at fit frame | 110 | **130** / 200 | 110 / 200 |
| Display textures, worst pan at 0.25 | 110 | **130** / 200 | 120 / 200 |

## 1. What changed

Ticket 02 derives the stage after shell (61 px), identity band (48 px + 8 px gap) and the 56 px
rail: desktop 1 384×783, tablet landscape 1 224×683. The old measured stage was 884×564.
Visible-area multipliers are 2.17× and 1.68×, not a flat 2.2×.

Two premises in ticket 08 need correcting:

- **The minimap does not grow with the stage.** Its panel is
  `inline-size: clamp(9rem, 28vw, 14rem)` (`src/board/BoardCanvas.css:152`) over a fixed
  200×140 SVG viewBox (`src/board/Minimap.tsx:38-45`). It is already at the 224 px cap on the
  884 px stage, so it stays 224 px on the wider stages: 25.3% of the old stage width, 16.2% of
  desktop, 18.3% of tablet. Ticket 03 also settles it collapsed by default, so it does not
  affect culling at all (`issues/03-icon-and-menu-inventory.md:77`).
- **"2.2× the visible area" is the desktop figure only.** Tablet is 1.68×.

## 2. How the numbers were derived

Terminology used below, matching the code:

- **Rendered card** — intersects the culling window, i.e. the viewport *plus* the 200 px
  margin. This is what `data-board-visible-card-count` reports
  (`src/board/BoardCanvas.tsx:238,541`) and what requests a texture
  (`src/board/CardLayer.ts:236-261`; `src/board/CardSprite.ts:323-334`).
- **On-screen card** — intersects the stage rectangle with the margin set to zero.
- **Drawn string** — passes both of `StringLayer`'s tests (screen-space union rect, then the
  curve bounds).

### 2.1 Fit zoom

`fitViewportToCards` fits the cards' bounding box with 64 px padding on every side, never
magnifies past 1.0, and clamps to 0.25–2.5:

```
available  = stage - 2 * 64
rawScale   = min(availableWidth / bounds.width,
                 availableHeight / bounds.height,
                 1)
scale      = clamp(rawScale, 0.25, 1)
```

(`src/board/viewport.ts:36-39,268-301`; card geometry 240×320 at
`src/board/viewport.ts:47-48`). The 0.25 clamp is deliberate and tested
(`tests/board/viewport.test.ts:313-324`). For 125 and 150 cards every stage lands below it:

| Stage | 12 cards raw → applied | 125 cards raw → applied | 150 cards raw → applied |
|---|---|---|---|
| 884×564 | 0.2423 → 0.25 | 0.0852 → 0.25 | 0.0736 → 0.25 |
| 1 384×783 | 0.4026 → 0.4026 | 0.1279 → 0.25 | 0.1106 → 0.25 |
| 1 224×683 | 0.3513 → 0.3513 | 0.1084 → 0.25 | 0.0938 → 0.25 |

The 12-card fit is clamped *up* on the old stage and fits normally on both new stages.

### 2.2 Culling window

```
visibleWorld = { x: viewport.x, y: viewport.y,
                 width: stage.width / scale, height: stage.height / scale }
worldMargin  = 200 / scale
cullWorld    = visibleWorld expanded by worldMargin on every side
```

(`src/board/viewport.ts:234-245`; `src/board/useCulling.ts:55-70`, especially line 62). A card
is rendered when its 240×320 rectangle intersects that window; touching edges do not count
(`src/board/useCulling.ts:72-103`).

Multiplying back by `scale`, the **screen-equivalent** cull window is always
`(stage.width + 400) × (stage.height + 400)`, independent of zoom. That is the clean way to
compare margin cost across stages:

| Stage | Stage area | Screen-equivalent cull area | Cull / stage |
|---|---|---|---|
| 884×564 | 498 576 | 1 237 776 | 2.48× |
| 1 384×783 | 1 083 672 | 2 110 472 | **1.95×** |
| 1 224×683 | 835 992 | 1 758 792 | **2.10×** |

The larger stage makes the fixed margin a *smaller* relative overhead, which is the first half
of the keep-200 verdict.

### 2.3 Geometry and camera assumptions

- Cards come from `e2e/helpers/seedLargeCase.ts`: 10 columns, `COLUMN_PITCH = 320`,
  `ROW_PITCH = 400`, `ORIGIN_X = ORIGIN_Y = 300`, 240×320 cards
  (`seedLargeCase.ts:24-30,82-90,93-107`). A 125-card case is 13 rows (last row 5 cards); a
  150-card case is 15 full rows; a 12-card case is 10 + 2.
- **Fit camera** is centred on those bounds by `fitViewportToBounds`.
- **Default camera** is the store/domain default `{x: 0, y: 0, scale: 1}`
  (`src/board/viewport.ts:30,91-95`; `src/domain/model.ts:317-322`; a new case gets
  `DEFAULT_VIEWPORT` at `src/data/caseRepository.ts:198`, and the page restores the persisted
  camera at `src/features/case/CaseBoardPage.tsx:340,362`). This is the first-open camera, not
  a fitted one.
- **Fixture camera** is the e2e seed's persisted `{x: 0, y: 0, scale: 0.75}`
  (`seedLargeCase.ts:30`), included because that is what the current performance run measures.
- The unit fixture in `tests/board/culling.test.ts:23-32` is a *different* 15-column grid, so
  it is not used here; the ticket specifically points at the e2e seed.

The only repo geometry for multi-card cases is this fixture. A real case's density and origin
differ, so the default-camera counts are fixture-specific; the fit counts are geometry-shape
specific but not origin specific.

### 2.4 Worked example (desktop, 150 cards, fit)

```
bounds        = 3120 × 5920   (10 cols * 320 + 240; 15 rows * 400 + 320)
raw fit       = min((1384-128)/3120, (783-128)/5920, 1)
              = min(0.4026, 0.1106, 1) = 0.1106 -> clamp 0.25
camera.x      = 1860 - 1384/(2*0.25) = -908
camera.y      = 3260 - 783/(2*0.25)  = 1694
worldMargin   = 200/0.25 = 800
cull window   = x -1708 .. 5428, y 894 .. 5626   (7136 × 4732 world)
columns       = 300 + 320c < 5428, x+240 > -1708 -> c = 0..9      (10)
rows          = 300 + 400r < 5626, y+320 > 894   -> r = 1..13     (13)
rendered      = 10 * 13 = 130 cards
on-screen     = same test with margin 0 (y 1694..4826) -> r = 3..11 -> 9 * 10 = 90
```

The 40-card gap between rendered and on-screen is the margin cost at the fit floor.

## 3. Results — stage × zoom → rendered cards / drawn strings

Cell format: **cards / strings**. Strings use the adjacency model in §3.1.

| Stage | Zoom (scale) | 12-card | 125-card | 150-card |
|---|---|---|---|---|
| **884×564** (old) | fit (0.25) | 12 / 12 | 110 / 181 | 110 / 181 |
| | default (1.0) | 5 / 4 | 6 / 5 | 6 / 5 |
| | fixture (0.75) | 6 / 6 | 8 / 14 | 8 / 14 |
| **1 384×783** (desktop) | fit (0.25, 12-card 0.4026) | 12 / 12 | **125 / 214** | **130 / 219** |
| | default (1.0) | 7 / 7 | 10 / 12 | 10 / 12 |
| | fixture (0.75) | 8 / 8 | 18 / 27 | 18 / 27 |
| **1 224×683** (tablet) | fit (0.25, 12-card 0.3513) | 12 / 12 | 110 / 214 | 110 / 219 |
| | default (1.0) | 6 / 6 | 8 / 10 | 8 / 10 |
| | fixture (0.75) | 7 / 8 | 15 / 20 | 15 / 20 |

Percentages of the complete case:

| Case | Old fit | Desktop fit | Tablet fit |
|---|---|---|---|
| 12 | 12/12 (100%) | 12/12 (100%) | 12/12 (100%) |
| 125 cards | 110/125 (88.0%) | **125/125 (100%)** | 110/125 (88.0%) |
| 125 strings | 181/227 (79.7%) | 214/227 (94.3%) | 214/227 (94.3%) |
| 150 cards | 110/150 (73.3%) | **130/150 (86.7%)** | 110/150 (73.3%) |
| 150 strings | 181/275 (65.8%) | 219/275 (79.6%) | 219/275 (79.6%) |

Default zoom rises the most in relative terms — 6 → 10 rendered cards for a 150-card case on
desktop, +66.7% — but the absolute numbers are small (10 cards, 12 strings). The fit floor is
where the budget pressure is.

### 3.1 String model and why the counts are not simply "visible cards × 2"

`StringLayer` builds a screen rect for every card in the snapshot, not only the culled set,
then draws a connection when the union of its two endpoint rects overlaps the window
`(-200, -200, stage + 400)` and its curve bounds overlap it too
(`src/board/StringLayer.ts:395-419,441-462`). Consequences:

- A string can be drawn while both endpoint cards are culled, if the thread crosses the
  viewport. That is why desktop fit renders 130 cards but 219 strings.
- The 200 px margin applies in screen space to strings exactly as it does to cards
  (`StringLayer.ts:143-147,412-419`), so no second margin derivation is needed.
- The repo does not seed large-case strings: `seedLargeCase` writes cards only
  (`seedLargeCase.ts:93-107,333-334`) and the performance evidence records
  `connectionCount: 0` (`e2e/performance.spec.ts:303`).

**Assumption stated:** every card is connected to its right and lower neighbour. That yields
12 strings for 12 cards, 227 for 125, and 275 for 150 (~1.83 per card) — the density implied
by `StringLayer`'s own "300-string case" comment (`StringLayer.ts:421-425`). Visibility was
computed with both cull gates, including the 12 px·scale sag and stroke padding. A different
topology changes the string count but **not** the draw-call count: all association strings share
one Graphics, all provenance strings a second, so the layer costs at most **two draw batches**
regardless of how many strings are drawn (`StringLayer.ts:421-425,485-503`).

## 4. Margin verdict: keep 200 px

**Recommendation: keep `BOARD_CULL_MARGIN = 200` unchanged. Do not scale it with the stage.**

Why:

1. **The contract is screen-space pan lead, not viewport proportion.** The margin exists to
   start a card's texture decode before the card enters the viewport
   (`src/board/useCulling.ts:27-28`). The lead is 200 px of pointer travel at any zoom and any
   stage size. A larger stage does not make a pan gesture faster in px/s, so it does not need a
   larger lead.
2. **The larger stage makes the margin relatively cheaper.** 1.95× / 2.10× the stage area vs
   2.48× on the old stage (§2.2). Scaling the margin up would move those ratios back toward the
   old cost for no benefit.
3. **The margin is already generous at low zoom.** At the 0.25 fit floor it becomes 800 world
   px — 2.5 row pitches — and renders 40 cards that are not on screen (90 → 130 at desktop for
   150 cards). 200 is not too small; at the fit extreme it is the single biggest discretionary
   cost in the frame.

### 4.1 What scaling would cost

If a proportional rule is ever wanted, the least disruptive form is
`margin = clamp(200, round(0.15 × stageWidth), 240)`:

- old 884 → 133 → clamped 200
- tablet 1 224 → 184 → clamped 200
- desktop 1 384 → 208

That changes the desktop count from 130 to 130 at fit (the extra 8 px does not reach another
row/column) and 10 to 10 at default. Cost: zero cards today. It is still not recommended,
because it adds a stage dependency to a pure helper for no measured benefit.

The margin sensitivity of the 150-card case shows where the knee is:

| Stage / zoom | m=0 | m=100 | **m=200** | m=300 | m=400 |
|---|---|---|---|---|---|
| old fit (0.25) | 70 / 105 | 90 / 143 | **110 / 181** | 130 / 219 | 150 / 257 |
| desktop fit (0.25) | 90 / 143 | 110 / 181 | **130 / 219** | 150 / 257 | 150 / 275 |
| tablet fit (0.25) | 70 / 143 | 90 / 181 | **110 / 219** | 130 / 257 | 150 / 275 |
| desktop default (1.0) | 8 / 7 | 8 / 10 | **10 / 12** | 10 / 16 | 15 / 18 |

(cards / strings). At `m=300` the desktop fit renders the entire 150-card case: +20 cards
(+15.4%) and +38 strings (+17.4%) over 200, with no additional draw batches. At `m=100` it saves
20 cards but halves the pan lead. 200 is the knee.

### 4.2 Draw-call accounting

- **Strings:** at most 2 draw batches at any count (`StringLayer.ts:421-425,485-503`). The
  margin's +38 strings at fit (200 → 300) cost geometry, not draw calls.
- **Cards:** each rendered card is one `CardSprite` with its paper/pin/frame Graphics and two
  `Text` objects (`CardSprite.ts:152-245`). Pixi batches the Graphics; the two Texts carry their
  own textures. The honest budget unit is therefore **rendered cards** (130 worst case), not a
  per-card draw-call multiplier. A static derivation cannot produce a reliable GPU draw-call
  count without the renderer, and none is needed: the cull delta is 0–40 cards depending on
  zoom, with the fit floor the only case where it is material.

## 5. Texture accounting: 200 is enough for the new stage

The worst rendered frame at any pan/zoom is the lowest supported zoom, 0.25:

| Stage | Max rendered cards at 0.25 (any pan) | 200-cap headroom | Transient if thumbnail + display coexist |
|---|---|---|---|
| 884×564 | 110 | 90 | 220 |
| **1 384×783** | **130** | **70** | 260 |
| **1 224×683** | **120** | **80** | 240 |
| Desktop fit if the floor were lowered to 0.111 | 150 (whole case) | 50 | 300 |

The sliding maximum is `cols = min(10, floor((stageW/scale + 2·200/scale + 240)/320) + 1)`,
`rows = floor((stageH/scale + 2·200/scale + 320)/400) + 1`, capped by the case size. At
0.25 that is 10×13 = 130 on desktop and 10×12 = 120 on tablet; the 150-card fit frame (130) is
already at the desktop maximum.

Steady-state texture ownership:

- `CardSprite` requests a thumbnail and a display derivative per rendered card
  (`CardSprite.ts:366-382`).
- The display wins and the thumbnail is destroyed at the swap; a late thumbnail is destroyed
  immediately (`CardSprite.ts:408-421,449-461`).
- Offscreen cards keep their paper geometry but release both textures after 3 s
  (`CardLayer.ts:268-279`; `textureCache.ts:22`).
- So steady state is **one display texture per rendered card** (plus recently offscreen still
  inside the 3 s grace). For a 150-card case that is ≤ 150, and at the new desktop worst frame
  130. The 200 ceiling covers it with 70 spare.

Two caveats the spec must not paper over:

1. **`MAX_RESIDENT_TEXTURES = 200` is a contract, not an enforced runtime bound in the canvas
   path.** `BoardTextureCache` is never instantiated in `src/`; `CardLayer` imports only
   `DEFAULT_OFFSCREEN_RELEASE_MS` (`CardLayer.ts:16`), and `CardSprite` owns its own pair.
   The effective bound today is "one derivative per rendered card + the 3 s grace". At 150
   cards that is ≤ 150, so the 200 number is still true in effect.
2. **Do not count thumbnails against 200 as a hard cap.** If both derivatives for every rendered
   card are alive at once, the peak is 2×: 260 at 130 cards, 300 at 150. Either exclude
   thumbnails from the resident budget (they are transient and destroyed at the swap) or raise
   the cap to 300. The current design does the former implicitly; the spec should say it.

Do **not** raise the ceiling for the new stage. The larger viewport does not push past 200 even
at the floor; lowering the floor to fit all 150 still stays under it in steady state.

## 6. Fit-to-view is the actual regression

The new desktop stage renders 130 cards at fit where the old stage rendered 110 (+18.2%).
That is not a margin problem; it is the 0.25 clamp meeting a taller case:

- 150 cards at 10×15 occupies 3 120×5 920 world px. Fitting 5 920 px into 655 available px needs
  0.111 on desktop and 0.094 on tablet, both below 0.25.
- Fit therefore renders 130/150 desktop and 110/150 tablet. At desktop, 90 of the 130 are
  actually on screen; 40 are only inside the 200 px margin.
- At 125 cards, desktop fit happens to render all 125 because the 0.25 window plus margin
  covers the 13th row, but only 90 are on screen.

Two coherent choices, only one of which preserves the existing performance budget:

| Choice | Consequence | Recommendation |
|---|---|---|
| Keep 0.25, define fit as an overview | 130 / 110 rendered at fit; 130 textures; current budget holds | **Adopt** |
| Lower the floor (e.g. 0.09) so fit truly shows all 150 | 150 rendered, 150 textures, 300 transient; 60/45 fps unmeasured at 150 | Only with a new perf gate |

If the redesign wants a true whole-case overview, lower **only the fit floor**, not the user
zoom range, and treat the 150-visible frame as a new measured budget. Otherwise update the
requirement wording (below).

Related mismatch: `BOARD-FR-06` says reset "fits all cards"
(`docs/features/case-board.md:78`), but `resetView` applies `DEFAULT_BOARD_VIEWPORT` — 100% at
the origin — while `FitToViewButton` is the control that fits
(`src/board/BoardCanvas.tsx:491-498,582-586`). Ticket 07 should fix that sentence or the
behavior; ticket 08 does not decide it.

## 7. Does `BOARD-FR-03` / `BOARD-FR-07` need amending?

**Yes, both.**

Current text:

- `BOARD-FR-03`: "Provide fit-to-view, a minimap showing the viewport and cards, viewport
  culling, thumbnail-first textures, and on-demand loading so a 150-card case remains
  navigable." (`docs/features/case-board.md:66`)
- `BOARD-FR-07`: "Target 60 frames per second during pan and zoom at 150 cards, treat 45 frames
  per second as the floor on the target tablet, and release textures for cards that stay
  offscreen." (`docs/features/case-board.md:82`)

Why they are insufficient:

1. FR-03 promises fit-to-view for 150 cards, but the 0.25 clamp makes fit an overview. It needs
   the visible share or a redefinition.
2. Neither requirement names the worst-case rendered set. At the new stage the desktop default
   frame is 1.67× denser and the fit frame 1.18× denser; "at 150 cards" alone no longer tells an
   implementer or a test what to measure.
3. The 200 px margin and 200 textures appear only in implementation task text
   (`docs/features/case-board.md:288,320-321`), not in the requirements. The margin verdict
   (keep, do not scale) should be in the spec so it is not "fixed" later.
4. The current perf evidence starts at 0.75 and alternates wheel zoom in/out
   (`seedLargeCase.ts:30`; `e2e/performance.spec.ts:232-258`), so it never goes below the seeded
   0.75 — whose sliding maximum is 45 cards — let alone the 0.25 floor (130). It also seeds zero
   connections (`e2e/performance.spec.ts:303,370-376` only checks `> 0` and `< 150`). The
   requirement must say where the floor is measured.

## 8. Exact wording for ticket 07

### 8.1 Replace `BOARD-FR-03` with

> Provide fit-to-view, a minimap showing the viewport and cards, viewport culling,
> thumbnail-first textures, and on-demand loading so a 150-card case remains navigable. Cull the
> visible world rectangle plus a constant 200 px screen-space margin at every stage size; the
> margin is divided by the zoom and never scales with the viewport. At the 0.25 fit floor a
> 150-card case renders 130 cards at 1 384×783 (90 of them on screen) and 110 at 1 224×683.
> Fit-to-view is clamped to the 0.25 floor, so when the fitted scale would fall below
> 0.25 it is an overview, not a whole-case fit: a 125-card case renders 125 cards at 1 384×783
> and 110 at 1 224×683, and a 150-card case 130 and 110.

### 8.2 Replace `BOARD-FR-07` with

> Target 60 frames per second during pan and zoom at 150 cards, treat 45 frames per second as
> the floor on the target tablet, and release textures for cards that stay offscreen. Measure
> both floors against the worst rendered frame at the 0.25 zoom floor — 130 cards at 1 384×783
> and 120 at 1 224×683 — not only at a detail zoom. Keep at most one display texture per
> rendered card and at most 200 resident textures across rendered and recently offscreen cards;
> association and provenance strings draw in at most two batches regardless of how many are
> visible.

### 8.3 Add to `case-board.md` §4 (implementation notes) and ticket 07's migration notes

> **Culling and texture budget at the wide stage.** `BOARD_CULL_MARGIN` stays 200 px in screen
> space; it is divided by zoom, not scaled by the stage. The screen-equivalent cull window is
> 1 784×1 183 at 1 384×783 (1.95× the stage area) and 1 624×1 083 at 1 224×683 (2.10×), versus
> 2.48× on the old 884×564 stage. Against the `seedLargeCase` grid (10 columns, 320×400 pitch,
> 240×320 cards), a 150-card case renders 130 cards at the 0.25 fit floor on desktop and 110 on
> tablet; the worst pan at that floor is 130 / 120. At the default camera (scale 1, origin 0,0)
> it renders 10 and 8. A 125-card case renders 125 / 110 at fit and 10 / 8 at default. The
> 200-texture ceiling is a display-derivative budget: 130 worst case on desktop leaves 70;
> thumbnails are transient and are destroyed when the display derivative replaces them.
> Fit-to-view cannot show a 150-card case at 0.25; the requirement above defines it as an
> overview. If a whole-case overview is later required, lower only the fit floor, expect 150
> rendered cards, and re-measure the 60/45 fps floors before changing the ceiling.

### 8.4 Add to the test/evidence migration note

> The 150-card performance run must add a 0.25 fit-floor pass at 1 384×783 and 1 224×683
> (130 / 120 rendered cards at the worst pan; 110 at the tablet fit camera). The current run
> seeds `{x: 0, y: 0, scale: 0.75}` and alternates wheel zoom in/out, so it never reaches the
> 0.25 floor and cannot exceed the 0.75 camera's sliding maximum of 45 cards on desktop or 40
> on tablet. Seed at least the adjacency-density connection set (≈275 strings for 150 cards) or
> record the string budget as unmeasured; string draw batches stay at two.

## 9. Assumptions and limits

- **Derived, not measured.** No browser session was run. The numbers replay the pure
  `viewport.ts`, `useCulling.ts` and `stringGeometry.ts` formulas; the card counts also match
  the contract tested in `tests/board/culling.test.ts:34-90`. A future browser run should
  confirm `data-board-visible-card-count` at the three cameras.
- **Fixture geometry only.** The e2e seed's 10-column grid and 300/300 origin are the only
  concrete multi-card geometry in the repo. A hand-arranged case can beat these counts at
  default zoom; the fit-floor maxima (130 / 110) are bounded by grid pitch and are the right
  budget numbers.
- **String topology is assumed** (§3.1). The two-batch claim is code-true and independent of
  the topology; the 219 / 275 counts are density-dependent.
- **Card size 240×320** (`viewport.ts:47-48`). A card with a taller title strip or a different
  photo does not change the culling rectangle in v1.
- **No minimap occlusion adjustment.** It is a fixed 224 px overlay and is collapsed by
  default; culling does not subtract it. If ticket 03 reverses "collapsed everywhere", the
  top-trailing 224×~208 px corner is visually covered but still rendered and counted.
- **The old baseline is 884×564**, per ticket 08 and ticket 02. Ticket 01 measured 884×464 for
  the old tablet stage; the 884×564 comparison is the one ticket 08 asks for.

## 10. Sources

| Claim | Source |
|---|---|
| 200 px margin constant and screen-space intent | `src/board/useCulling.ts:6-8,27-28` |
| Margin divided by scale; world cull window | `src/board/useCulling.ts:55-70` (line 62) |
| Card intersection test, touching edges excluded | `src/board/useCulling.ts:72-103` |
| Visible world rect = stage / scale | `src/board/viewport.ts:234-245` |
| Card 240×320, fit padding 64, fit max 1 | `src/board/viewport.ts:36-48` |
| Zoom clamp 0.25–2.5 | `src/board/viewport.ts:26-27` |
| Fit centring and min clamp | `src/board/viewport.ts:268-301` |
| Large case clamps to 0.25 (tested) | `tests/board/viewport.test.ts:313-324` |
| Store default camera `{0,0,1}` | `src/board/viewport.ts:30,91-95`; `src/board/boardStore.ts:183-186,294-310` |
| Domain default camera | `src/domain/model.ts:317-322` |
| New case viewport default / restore saved camera | `src/data/caseRepository.ts:198`; `src/features/case/CaseBoardPage.tsx:340,362` |
| Canvas passes stage size to culling; visible-count attribute | `src/board/BoardCanvas.tsx:238,541` |
| Card layer applies culling and releases after 3 s | `src/board/CardLayer.ts:236-261,268-279` |
| Texture cap 200 and 3 s release constant | `src/board/textureCache.ts:19,22,111-119,177-192` |
| Cache not instantiated in src; only constant imported | `src/board/CardLayer.ts:16` |
| Thumbnail/display lifecycle | `src/board/CardSprite.ts:323-334,366-382,408-421,449-461,468-489` |
| String screen window uses same 200 px | `src/board/StringLayer.ts:34,143-147,412-419` |
| String two-gate cull and two batches | `src/board/StringLayer.ts:421-425,441-462,485-503` |
| Fixture geometry and 0.75 seeded camera | `e2e/helpers/seedLargeCase.ts:24-30,82-90,93-107` |
| Perf run wheel range and zero connections | `e2e/performance.spec.ts:232-258,303,370-376`; `src/board/boardInput.ts:24,232-241` |
| Canonical e2e viewports 1440×900 / 1280×800 | `playwright.config.ts:36-49` |
| Minimap fixed size / cap | `src/board/Minimap.tsx:38-45`; `src/board/BoardCanvas.css:152` |
| Minimap collapsed by default | `.scratch/board-first-gameplay-ui/issues/03-icon-and-menu-inventory.md:77` |
| `BOARD-FR-03` / `BOARD-FR-06` / `BOARD-FR-07` text | `docs/features/case-board.md:66,78,82` |
| 200 px / 200 textures in implementation task text | `docs/features/case-board.md:288,320-321` |
| Existing unit cull fixture is 15 columns | `tests/board/culling.test.ts:23-32,34-44` |
| Reset returns to 100% at origin, not fit | `src/board/BoardCanvas.tsx:491-498,582-586` |
