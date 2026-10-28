# 07 — Write the redesign spec

Type: task
Status: resolved
Blocked by: 02, 03, 04, 05, 06, 08

## Question

Assemble the decisions into the artifact the map exists to produce.

Inputs: the agreed inputs in the map's Notes, ticket 01's measurement table, and the answers on
02 (composition), 03 (inventory + names), 04 (prototype reactions), 05 (interruptions), 06
(panel mechanics).

The spec must be decision-complete enough that an implementer never has to ask a design question
again. Contents:

1. **Problem and gate.** The measured before-table (01), the dominance numbers, and the
   verification method — how to prove ≥ 75 % / ≥ 85 % and zero page scroll at each viewport, as a
   repeatable check rather than a claim.
2. **Composition per mode.** Phone / tablet / desktop, with the prototype's screenshots as
   reference. What is pinned, what floats, what the stage measures once chrome is subtracted.
3. **Icon and menu inventory.** The table from 03, plus markup rules: glyph only, 44 px target,
   tooltip or `aria-label` only (never both), visible focus, contrast against cork.
4. **Canonical accessible-name table.** One row per icon and menu, plus the surfaces that keep
   their current names. This is the contract the e2e suites will be updated against.
5. **Panel mechanics.** Surface type per panel, new primitive contract if any, tab order, focus
   return, simultaneous-surface rules (06).
6. **Interruption policy.** The table from 05, including the resolution of the persistent
   `ScaleWarning` conflict.
7. **Migration notes.** Files to change (`CaseBoardPage.tsx/.css`, `BoardCanvas.tsx/.css`,
   `AppShell.tsx/.css`, `IconButton` usage, `useLayoutMode` if breakpoints change), which
   documented requirements are amended (`BOARD-FR-01` UI paragraph, `A11Y-FR-03` viewports,
   `case-board.md` §4), the e2e specs that need renamed selectors (`a11y`, `responsive`,
   `keyboard-journey`, `closure`, `demo`, `board`), and a suggested order of work with the
   gate check as the acceptance step.
8. **CSS ownership** (graduated from the map’s fog). One owner per value is mandatory: the spec
   must state which file owns band/rail/stage geometry, which owns in-stage floating chrome, and
   which owns shell values. `styles/responsive.css` currently overrides the stage at two
   breakpoints and the content cap at a third; the spec must say what it loses, or the same drift
   that produced the current clamp recurs.
9. **Text zoom and no-cap rule.** The band is `min-height: 48px`, so 200 % text may grow it; state
   that the gate is measured at 100 % text and how 200 % text is verified without clipping or
   overlap. State that the board route has no width cap above 600 px and the stage simply grows.
10. **Explicit non-goals.** The Out-of-scope list from the map, restated so implementers do not
    absorb nearby routes into the change.

Placement: decide where it lives — `docs/features/` as a new feature document,
`docs/research/`, or a rewrite of `case-board.md` §4 — and record why (that is the fog item
"feature-doc reconciliation"). Link it from this ticket and append the pointer to the map's
Decisions so far.

Do not implement. Do not edit `src/`.

## Answer

**Spec:** [spec.md](../spec.md) — the decision-complete handoff for the board-first case frame.

Placement: the spec lives in the effort folder (`.scratch/board-first-gameplay-ui/spec.md`) because
it is the map's decision artifact, not a shipped feature document; the implementation phase folds
the accepted values into `docs/features/case-board.md` §4 and the requirement amendments listed in
§11. That keeps the forge pipeline from treating a scratch spec as a new product feature and keeps
the history next to the map.

It decides: the measured gate and verification script (93.3 % / 92.4 % / 86.8 %; zero page scroll;
stage-width invariance); the wide and phone compositions; the quiet three-slot rail and four-slot
phone bar; the canonical icon/name table including the renames; the wide non-modal / phone modal
panel mechanics and the new `Panel` contract; the interruption table, attention dot, toast/hint
layers, and `System status` chip; CSS ownership and the values `responsive.css` loses; text-zoom and
no-cap rules; the requirement text for `BOARD-FR-03`/`06`/`07`/`09` and the doc amendments; and the
migration/test order with the gate as the acceptance step. No `src/` changes were made.

There are no open design questions. The risks that remain are listed in spec §13 (phone gate margin,
safe-area interpretation, 200 % text, the new primitive, search-state lift, selector churn, the
texture transient, fit wording, and the topbar amendment).
