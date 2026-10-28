# Map: Board-first gameplay UI

Label: wayfinder:map
Status: complete

## Destination

A validated redesign spec for the **case board route**: the board holds the screenspace
(≥ 75 % of the content area at 1280×800 and 1440×900, ≥ 85 % at 390×844, zero page scroll
at all three), every non-board surface lives behind an icon or menu, and the spec carries
the per-breakpoint composition, the canonical icon/name table, the interruption policy, and
the migration notes needed to implement it.

## Notes

**Domain.** Local-first React 19 + TypeScript PWA (`src/`), PixiJS 8 board (`src/board/`),
zustand board store, Dexie data layer, hash routing, design tokens in `src/styles/tokens.css`
("Cozy storybook" theme). The board route is `src/features/case/CaseBoardPage.tsx` +
`CaseBoardPage.css`; canvas chrome is `src/board/BoardCanvas.tsx` + `BoardCanvas.css`; the
frame is `src/app/AppShell.tsx` + `AppShell.css`; breakpoints are
`src/app/useLayoutMode.ts` (phone < 600, tablet 600–1199, desktop ≥ 1200).

**Canonical viewports** (from `A11Y-FR-03`): 1280×800 tablet landscape, 390×844 phone,
1440×900 desktop.

**Skills to consult each session.** `accessible-case-ui` (dialogs, sheets, focus return,
44 px targets, reduced motion), `pixi-case-board` (canvas chrome, viewport math),
`implement-visual-theme` (tokens, contrast, Cozy storybook), `write-component-tests` and
`browser-evidence-journeys` (component tests and Playwright evidence at the viewports),
`grilling` + `domain-modeling` for grilling tickets.

**Standing preferences for this effort.**

- **Spec only.** The map produces a decision-complete spec. Implementing it, and updating
  the e2e suites, happens after handoff — do not start coding the redesign inside this map.
- **No new dependencies.** No icon library; icons are inline SVG or glyphs, matching
  `src/components/IconButton.tsx`.
- **Accessibility is a gate, not a section.** WCAG 2.2 AA, 4.5:1 contrast, 44×44 px targets,
  visible focus, no keyboard traps, `prefers-reduced-motion` honoured, every icon-only
  trigger has a full accessible name and `aria-haspopup`/`aria-expanded` when it opens a
  surface.
- **Local markdown tracker.** Map and tickets live under `.scratch/board-first-gameplay-ui/`.

**Settled while charting** (not tickets — treat as agreed inputs):

1. Destination shape: a validated spec handed off; no implementation in this map.
2. Dominance gate: board ≥ 75 % of content height at 1280×800 and 1440×900, ≥ 85 % at
   390×844; zero page scroll on the board route at all three; scrolling only inside menus.
3. Permanently visible: the canvas, a slim board control cluster, one "Add evidence"
   affordance, the **case title** (one line, truncating) and a small **readiness** signal.
   Behind icons: case actions (backup, recall, card list, shelf), search and filters,
   closure/readiness detail, connection legend, connection detail, backup reminder, scale
   warning. Transient only: save errors, undo, connection feedback.
4. Phone: full-bleed board with a persistent **bottom icon bar** (Search, Add, Closure,
   Actions), compact title/readiness line, `Case board` heading visually hidden but
   focusable, descriptive summary removed from the happy path, shell topbar reduced to the
   app name with `Case shelf`/`Settings` moved into the Actions menu.
5. Accessible names may change where the design demands it; the spec must ship a canonical
   name table and every rename lands with its test update.

## Decisions so far

<!-- one line per resolved ticket: gist + link to the ticket that holds the detail -->

- [Measure the current board surface budget](issues/01-measure-current-surface-budget.md):
  the gate fails in all three modes (67.2 % / 62.8 % / 73.6 % board share), the board starts at
  60–70 % of the fold, the canvas controls are off-screen everywhere, and `ClosurePanel`'s
  loose-thread list — not the board — sets page height (2 448 px at 12 cards, 18 861 px at 150).
- [Tablet and desktop composition](issues/02-tablet-and-desktop-composition.md): one wide frame —
  a 48 px identity band, a 56 px leading icon rail, and a full-bleed stage whose width is
  invariant under selection; the closure column is deleted and detail floats. Board share becomes
  92.4 % at 1280×800, 93.3 % at 1440×900, 95.1 % on portrait tablet, with zero page scroll.
- [Icon and menu inventory](issues/03-icon-and-menu-inventory.md): wide rail is three slots
  (Search, Open card list, Case menu); phone bar stays four (Search, Add, Closure, Case menu). One
  closure surface per mode (band readiness chip wide, Closure icon on phone), one Search surface
  with filters inside, and `Thread types` inside the Case menu. Six-glyph module, text-only menu
  items, no badges, rail caps at five slots, minimap collapsed everywhere. Canonical names rename
  `Case actions` → `Case menu`, `Connection legend` → `Thread types`, `Back to case shelf` →
  `Case shelf`.
- [Three-viewport prototype](issues/04-three-viewport-prototype.md): the frame holds at 390×844,
  1280×800 and 1440×900. The walkthrough locked a **quiet rail**, a full-height trailing detail
  panel (Add is covered while inspecting), the retained readiness dot, **modal phone sheets that
  cover the bar**, restored-camera density on phone, and the Case menu anchored under its rail
  trigger. Evidence: `prototype/index.html` plus `evidence/screenshots/04-*`.
- [Interruption and overlay policy](issues/05-interruption-and-overlay-policy.md): nothing enters
  the board's flow. Capacity and backup live in Case menu attention sections behind one trigger
  dot; the backup reminder is live (01's zero reading was a fixture artifact); toasts move
  top-centre; hints stay and teaching moves to the `?` help dialog; offline/update/browser
  notices become one shell `System status` chip + dialog.
- [Panel mechanics](issues/06-panel-mechanics.md): wide panels are non-modal — Search/Menu
  transient, Closure/Detail persistent — and phone surfaces stay modal sheets. A new non-modal
  `Panel` primitive carries focus entry, Escape, outside-click rules, and focus return without a
  trap, `inert`, or scroll lock; `Dialog` stays modal-only. One persistent + one transient on
  wide, one sheet on phone; `aria-expanded`/`aria-haspopup`; the canvas is not a tab stop.
- [Write the redesign spec](issues/07-write-the-redesign-spec.md): [spec.md](spec.md) is the
  decision-complete handoff. It fixes the gate (93.3 % / 92.4 % / 86.8 %, zero page scroll, invariant
  stage width), the wide/phone compositions and inventory, the canonical name table, non-modal wide
  panels vs modal phone sheets with the new `Panel` contract, the interruption/attention policy and
  `System status` chip, one-owner CSS, and the exact `BOARD-FR-03`/`06`/`07`/`09` and doc/test
  migration. No `src/` changes; no open design questions.
- [Canvas headroom at the new stage size](issues/08-canvas-headroom-at-new-stage-size.md): keep the
  200 px screen-space cull margin (1.95×/2.10× of the stage vs 2.48× on the old stage) and the
  200-texture ceiling (130 worst rendered desktop, 70 headroom). Fit is the real regression: the
  0.25 floor renders 130/150 cards on desktop and 110/150 on tablet. Amend `BOARD-FR-03`/`FR-07`
  and add a 0.25-floor perf pass; research file linked.

## Not yet specified

<!-- in-scope fog: suspected questions not yet sharp enough to ticket -->

None. The destination is reached: every decision ticket is resolved and
[spec.md](spec.md) is the handoff document. Implementation is out of scope for this map.

<!--
  Graduated by 02: shell ownership (topbar untouched above 600), shared frame component (one
  component set, rail ↔ bottom bar), persistent-warning conflict (05), icon authoring (03),
  CSS ownership (07), feature-doc reconciliation (07), canvas headroom (08).
-->

## Out of scope

- Implementing the redesign, and the resulting e2e/component test updates.
- Icon/menu treatment for Recall, card detail, card list, and the case shelf — they adopt
  the pattern in a later effort.
- Board interaction physics: pan, zoom, drag, strings, recall scratch rendering.
- Any new gameplay or new feature surface. This effort only re-homes what already exists.
