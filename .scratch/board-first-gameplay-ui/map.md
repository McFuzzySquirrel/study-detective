# Map: Board-first gameplay UI

Label: wayfinder:map
Status: open

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

## Not yet specified

<!-- in-scope fog: suspected questions not yet sharp enough to ticket -->

- **Feature-doc reconciliation.** `docs/features/case-board.md` §4 already describes a
  leaner board than the one built. Once the spec has a shape, decide whether it rewrites
  that section in place, supersedes it, or becomes a new feature document.
- **Shell ownership.** How much of the `AppShell` topbar this spec owns (it is shared with
  every other route) versus how much is deferred to a future shell pass.
- **Shared frame component.** Whether the phone bottom bar and the tablet/desktop clusters
  are one component with two presentations or two deliberate implementations.
- **Canvas performance headroom.** Whether a materially taller/wider canvas changes the
  culling margin and texture-cache assumptions in `BOARD-FR-03`/`BOARD-FR-07`.
- **Icon authoring.** Where an inline SVG icon set lives (a component module, or the theme),
  and how each glyph is proven to read at 44 px against both themes.
- **Persistent-warning conflict.** `ScaleWarning` becomes persistent at 150+ cards, and a
  persistent banner is incompatible with the dominance gate. Its home needs a decision.
- **CSS ownership.** Three files set this page's geometry (`CaseBoardPage.css`, the override
  layer in `styles/responsive.css`, `AppShell.css`). The spec must name one owner per value, or
  the same drift that produced the current stage clamp will recur.

## Out of scope

- Implementing the redesign, and the resulting e2e/component test updates.
- Icon/menu treatment for Recall, card detail, card list, and the case shelf — they adopt
  the pattern in a later effort.
- Board interaction physics: pan, zoom, drag, strings, recall scratch rendering.
- Any new gameplay or new feature surface. This effort only re-homes what already exists.
