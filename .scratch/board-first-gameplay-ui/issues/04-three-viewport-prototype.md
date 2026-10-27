# 04 — Three-viewport prototype

Type: prototype
Status: resolved
Blocked by: 02, 03

## Question

What does the composed frame actually look and feel like — does it hold up when you can see it?

Grey-area decisions (icon prominence, float vs rail, how much cork is visible, whether the
readiness signal reads without a label, whether a floating cluster hides cards) are cheap to
argue about in prose and obvious in front of you. Build a **throwaway** prototype to react to
before the spec freezes.

Shape:

- One static page, importable from a scratch folder — **not** wired into `src/`, no store, no
  Dexie, no Pixi board. Fake cork background, ~10 fake cards, 2 fake strings.
- Uses the real `src/styles/tokens.css` values and the Cozy storybook palette, so contrast and
  spacing judgements transfer.
- Renders the agreed composition for all three modes at 390×844, 1280×800 and 1440×900 (CSS
  media queries are fine; a row of three fixed-size frames is also fine if that is clearer).
- Includes one open state per menu/surface type from the inventory, so "menus behind icons" is
  visible rather than imagined.
- Real 44 px targets and focus rings — the point is to judge reachability, not just aesthetics.

Deliver: the prototype path plus three screenshots, linked from this ticket. It is a sketch: no
tests, no accessibility audit, delete it when the spec is written.

Then react to it — record what changes and why, because those reactions are the spec's
evidence.

## Prototype

**Path:** [prototype/index.html](../prototype/index.html) — one static page, no `src/` wiring,
no store, no Dexie, no Pixi. It links the real `src/styles/tokens.css` and uses a faux cork
surface, ten fake cards, and two fake strings. Open it directly in a browser, or serve the repo
root (`python3 -m http.server 8000`) and open
`http://localhost:8000/.scratch/board-first-gameplay-ui/prototype/index.html`.

The floating toolbar switches viewport (Fill / 390 / 1280 / 1440), surface (Board / Search /
Menu / Closure / Detail), minimap, rail treatment, and the readiness dot. Query params are
shareable: `view`, `surface`, `threadtypes=1`, `minimap=1`, `rail=quiet`, `readiness=text`,
`toolbar=0`. `Escape` closes a surface; double-clicking the canvas restores a hidden toolbar.

### Required viewports

- [Phone 390×844](../evidence/screenshots/04-phone-390x844.png)
- [Tablet 1280×800](../evidence/screenshots/04-tablet-1280x800.png)
- [Desktop 1440×900](../evidence/screenshots/04-desktop-1440x900.png)

### Open states

- [Search popover, wide](../evidence/screenshots/04-desktop-search.png)
- [Case menu with Thread types expanded, wide](../evidence/screenshots/04-desktop-menu-thread-types.png)
- [Closure popover, wide](../evidence/screenshots/04-desktop-closure.png)
- [Connection detail panel, wide](../evidence/screenshots/04-desktop-detail.png)
- [Minimap open, wide](../evidence/screenshots/04-desktop-minimap.png)
- [Case menu sheet, phone](../evidence/screenshots/04-phone-menu-sheet.png)
- [Closure sheet, phone](../evidence/screenshots/04-phone-closure-sheet.png)

### Variants

- [Boxed rail (rejected)](../evidence/screenshots/04-desktop-rail-boxed.png)
- [Readiness without the dot](../evidence/screenshots/04-desktop-readiness-no-dot.png)
- [Toolbar visible](../evidence/screenshots/04-desktop-toolbar.png)

### Reactions

Walkthrough of the live prototype, 2026-10-27. Verdict: **the frame holds**; go with the
recommendations below. The reference screenshots above were re-captured with the quiet rail as
the default after this decision.

| Grey area | Decision | Why |
|---|---|---|
| Rail treatment | **Quiet rail above 600**; the phone bar keeps boxed icons and the filled Add | Boxed made the rail read as a second toolbar and pulled focus from the cards. Quiet keeps the 44 px targets, with surface and border on hover/focus. |
| Detail panel vs Add | **Full-height trailing panel; Add is covered while detail is open** | The inspector is a focused mode; an inset panel dodging the Add looked contrived. The permanent Add returns on close. |
| Readiness dot | **Keep** | Text carries the state; the dot adds glanceability without being the only signal. |
| Phone sheet modality | **Modal sheets that cover the bar and scrim the shell** | A bar tappable behind a scrim would be wrong. 06 owns focus, trap, and restore. |
| Phone board density | **Keep the restored-camera density** (edge cards crop) | Honest panning; a fit-on-open would fight the stored viewport. |
| Case menu anchor | **Under the third rail icon**, top-left | The earlier bottom-left popover was disconnected from its trigger. |
| Other | No changes | Title truncation, cluster size, bar spacing, and menu contents all held. |

Two prototype-only fixes landed before the walkthrough: the readiness chip was rendering twice,
and the surfaces were stage-scoped so phone sheets left the bar visible. Both are corrected; neither
is a design change.

## Answer

**Resolved.** The composed frame from 02 and the inventory from 03 holds at all three canonical
viewports. No composition change is needed. The walkthrough locked six visual decisions for the
spec:

1. **Quiet rail above 600.** The three 44 px slots are transparent at rest; surface, border, and
   hover/focus reveal on interaction. The phone bar keeps the boxed treatment and the filled Add.
2. **Full-height trailing detail panel.** A selected string opens the 320 px panel on the trailing
   edge; it covers the floating Add while open. This is the one documented exception to "Add
   evidence is permanently visible" — the inspector is a focused mode and Add returns on close.
3. **Readiness dot retained.** The chip/line always states the readiness in words; the dot is a
   secondary cue, never the only one.
4. **Phone sheets are modal.** They cover the bottom bar and scrim the shell; 06 owns focus, trap,
   and restore.
5. **Phone density follows the restored camera.** Edge cards crop at the stored viewport; no
   fit-on-open. The board-first gate is about board area, not card count.
6. **Case menu popover anchors under the third rail icon** at top-left; phone opens the sheet.
   The earlier bottom-left popover was a prototype mistake, not a design option.

**Handed to:** 06 — modal sheet mechanics, popover anchoring, focus return. 07 — encode the six
decisions, the Add exception, and the quiet-rail treatment in the spec. 05 and 08 unchanged. No new
tickets. The prototype and screenshots remain as evidence under `prototype/` and
`evidence/screenshots/`; the prototype is throwaway once 07 is written.
