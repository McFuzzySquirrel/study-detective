# 07 — Write the redesign spec

Type: task
Status: open
Blocked by: 02, 03, 04, 05, 06

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
8. **Explicit non-goals.** The Out-of-scope list from the map, restated so implementers do not
   absorb nearby routes into the change.

Placement: decide where it lives — `docs/features/` as a new feature document,
`docs/research/`, or a rewrite of `case-board.md` §4 — and record why (that is the fog item
"feature-doc reconciliation"). Link it from this ticket and append the pointer to the map's
Decisions so far.

Do not implement. Do not edit `src/`.

## Answer

<!-- resolution: append the spec path and a one-line summary of what it decides -->
