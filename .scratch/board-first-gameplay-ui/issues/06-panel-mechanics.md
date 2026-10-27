# 06 — Panel mechanics: modal sheet, non-modal drawer, or popover

Type: grilling
Status: open
Blocked by: 03

## Question

When an icon opens a panel, what kind of surface is it — and what does that cost in focus
behaviour?

Today every panel on the board route is a `Dialog`: phone sheets and the desktop inspector both
trap focus, close on Escape, and return focus to a trigger (with the `sheetReturnFocusRef`
special case when an action inside moves the student). That works because the surfaces are
*temporary visits*.

A board-first design changes the shape of the visit: a student may want a closure panel or a
connection inspector **open while still dragging cards**. A focus trap makes that impossible.
So decide, per surface from ticket 03's inventory:

1. **Modal** (focus trapped, background inert, Escape closes) — right for destructive or
   blocking flows like delete confirmation.
2. **Non-modal drawer / side panel** (focusable, background *not* inert, Escape closes, closes
   on outside click or explicitly) — right for inspecting or reference panels.
3. **Popover / menu** (transient, dismisses on selection or outside click, arrow-key navigation
   if it is a `menu` role).
4. **Full-bleed sheet on phone** — presumably still modal-below-600 px, since there is no room
   for a side-by-side panel; confirm.

Also settle:

- **Simultaneous surfaces.** May Search and Connection detail be open together? Can two drawers
  stack? Rule for "opening X closes Y".
- **Trigger semantics.** A bottom-bar icon that opens a panel is a *toggle*: `aria-expanded` +
  `aria-pressed`? Which one, and what happens to focus on close — back to the icon (default) or
  to the board heading (when the action moved the student, as today)?
- **Read `src/components/Dialog.tsx` and `src/features/case/CaseBoardPage.tsx` first** and state
  honestly what the current primitive can and cannot support. If a non-modal drawer needs a new
  primitive, say so and describe its contract (focus entry, boundary, Escape, background
  interaction, reduced motion) — that becomes a spec section, not code.
- **Tab order.** With icons floating over a canvas, where does the board sit in the tab sequence,
  and does a canvas-focused student tab into the chrome or out of it?

## Answer

<!-- resolution: append the surface-type decision per panel, the new primitive contract if any, and the tab/focus rules -->
