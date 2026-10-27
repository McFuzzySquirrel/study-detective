# 01 — Measure the current board surface budget

Type: task
Status: resolved
Blocked by: —

## Question

What do the competing surfaces actually cost, in pixels, at the three canonical viewports —
and how does that compare with the dominance gate?

The source-level budget is already readable from `CaseBoardPage.tsx`, `CaseBoardPage.css`,
`AppShell.css` and `BoardCanvas.css`, but a ruling needs measured numbers from the running
app: a spec that says "the header is too tall" without a figure is an opinion, and nobody can
prove afterwards that the gate was met.

Produce a **before-table** for `/#/case/<seeded case>` at 1280×800, 390×844 and 1440×900:

| Viewport | Surface | Height (px) | % of content area | Notes |
|---|---|---|---|---|

Cover at minimum: shell topbar, shell status region, page header (eyebrow / h2 / summary /
action links), `ScaleWarning`, backup reminder, `SearchPanel`, `ConnectionLegend`, phone sheet
triggers, `ClosurePanel` (width *and* its effect on stage width), `ConnectionDetail`, the stage
itself, and the canvas control cluster + minimap inset. Record total page scroll height per
viewport, and the board's measured height and width share.

Method: `npm run dev`, seed a case of at least 12 cards with one connection, then
`page.setViewportSize` + `boundingBox()` per surface (a throwaway Playwright script is fine).
Attach the script path and screenshots under `docs/artifacts/` or a scratch folder — evidence,
not a deliverable in `src/`.

Note the two surfaces whose cost is *conditional*: the backup reminder (first time only) and
`ScaleWarning` (120+ cards). Give their height too — they are the ones that will collide with
the gate later.

## Answer

**The gate fails in all three modes, and the board's own controls are off-screen before any
redesign.** Measured against production build (`npm run build && preview`), 12-card case with
one thread, three canonical viewports.

### Summary

| Viewport | Shell | Content area | Chrome above board | Board size | Board share | Page height | Controls on screen? |
|---|---|---|---|---|---|---|---|
| 1440×900 desktop | 61 | 839 | 574.5 | 884×564 | **67.2 %** | 2 448 (2.7 screens) | **no** (top 1 127.5) |
| 1280×800 tablet landscape | 61 | 739 | 574.5 | 884×464 | **62.8 %** | 2 448 (3.1 screens) | **no** (top 1 027.5) |
| 390×844 phone | 88.2 | 755.8 | 432.5 | 366×556 | **73.6 %** | 1 101 (1.3 screens) | **no** (top 964.7) |

"Board share" is board height ÷ (viewport height − shell height). Target is ≥ 75 % / ≥ 85 %.
The board also *starts* at y = 635.5 on both wide modes — 70 % of the desktop screen is consumed
before the canvas begins. On phone the board starts at y = 520.7, so only 324 of its 556 px are
above the fold.

### Permanent surfaces, measured

| Surface | Desktop 1440×900 | Tablet 1280×800 | Phone 390×844 |
|---|---|---|---|
| Shell topbar | 61 | 61 | 88.2 (title stacked over nav) |
| Main content padding | 40 + 40 | 40 + 40 | 16 + 24 |
| Page header (`__header`) | 126.6 | 126.6 | **321** |
| … eyebrow / title / summary | 19.2 / 33.6 / 44.8 | same | 19.2 / 33.6 / 67.2 |
| … `Case actions` button | — (inline links instead) | — | **160** (a full 19 % of the phone screen) |
| Search panel | **250** | **250** | — (sheet) |
| Connection legend row | **110** | **110** | — (in menu) |
| Phone sheet-trigger row | — | — | 51.6 (two buttons) |
| Scale warning (120+/150+) | 96.4 | 96.4 | not measured (not reproduced) |
| Backup reminder | **not reproduced — 0 nodes** (see finding 7) | — | — |
| Closure column | **304 wide**, 1 772 tall | 304 wide, 1 772 tall | — |
| Connection inspector column | 320 wide, 520 tall | 320 wide, 520 tall | 340 wide sheet, 687 tall (modal overlay) |
| Canvas control cluster | 54 tall (397.8 wide) | 54 tall | 102 tall, wrapping (330 wide) |
| Minimap inset | 224 × 207.8 = **9.3 %** of board | same | 175.5 × 173.8 = **15 %** of board |

Selecting one thread costs the board **316 px of width** (884 → 568, a 36 % loss) by adding the
inspector column beside it.

### Page height on larger cases (1280×800)

| Cards | Closure panel height | Document height | Board height |
|---|---|---|---|
| 12 | 1 772 | 2 448 | 464 |
| 125 | 15 238 | 16 026 (20 screens) | 464 |
| 150 | 18 073 | 18 861 (**23.6 screens**) | 464 |

Same stage height at 150 cards as at 12: the board never grows while the page grows 40×.

### Findings worth carrying into the spec

1. **Board share fails the gate everywhere**: 67.2 %, 62.8 %, 73.6 % against 75 %/85 %.
2. **The board begins below 60–70 % of the fold** in every mode; on phone more than a third of
   the board is below it.
3. **The board's own control cluster is off-screen at every viewport** (zoom, fit, reset,
   `Add evidence`, `Open card list`). Interacting with it scrolls the page — observed `scrollY`
   655–705 px mid-session on the wide modes, caused by Playwright bringing `Fit all cards` into
   view. A student has the same problem.
4. **`ClosurePanel` dictates page height.** It is a full loose-thread list rendered in a fixed
   grid column with `align-items: start`; its content (not the board) sets the document height,
   producing a 23.6-screen page at 150 cards with a 464 px board strip at the top. This is a
   layout defect independent of the redesign, and it makes "zero page scroll" unreachable while
   the column stays.
5. **The phone `Case actions` button is 160 px tall** — `.case-board-page__header` sets
   `align-items: stretch` under 40 rem and the button is a wrapped flex item with
   `flex: 1 1 10rem`, so it fills the line box instead of hugging its 44 px target.
6. **The phone minimap covers 15 % of the board** and, at the store's default zoom, hides most
   visible cards; it is open by default.
7. **The first-backup reminder never rendered** with 12 cards, 1 connection and
   `backupPromptedAt: null` in the case row, before or after reload — 0 `.backup-reminder` nodes.
   The hook's unit tests pass with an injected repository, so this is either a latent integration
   defect or a state I could not reach through the UI. **No height measured.** Ticket 05 must
   resolve its existence before deciding its new home.
8. **Two override layers govern this page.** `CaseBoardPage.css` sets the stage minimum to
   `clamp(24rem, 100dvh − 21rem, 52rem)`; `responsive.css` overrides it at ≤ 47.99 rem with
   `clamp(24rem, 100dvh − 18rem, 48rem)` (measured: 556 px on phone). Desktop content cap is
   `80rem` (1280 px measured) from `responsive.css` at ≥ 75 rem, not the `72rem` in
   `AppShell.css`. Any spec must name which file owns the new values.

### Evidence

- Raw geometry: `.scratch/board-first-gameplay-ui/evidence/raw/*.json` (one file per pass).
- Screenshots (full page): `.scratch/board-first-gameplay-ui/evidence/screenshots/*.png`.
- Throwaway script: `.scratch/board-first-gameplay-ui/evidence/script/measure-budget.spec.ts`.
  It was run from `e2e/` (Playwright's `testDir`) and archived here afterwards; copy it back to
  `e2e/` and run `npx playwright test e2e/measure-budget.spec.ts --project=desktop` to reproduce.
  Fixtures come from `e2e/helpers/seedLargeCase.ts` (12-card grid, then 125 and 150 for warnings).

