# 06 — Panel mechanics: modal sheet, non-modal drawer, or popover

Type: grilling
Status: resolved
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

**Resolved.** Wide panels are **non-modal**; phone surfaces stay **modal sheets**. The wide split
is one **persistent inspector** (Closure or Connection detail) plus one **transient popover**
(Search or Case menu). A new non-modal `Panel` primitive is required; `Dialog` cannot support
this without weakening its modal contract. Panel triggers use `aria-expanded`/`aria-controls` and
`aria-haspopup="dialog"`; the canvas is not a tab stop.

### Current-code correction

The ticket's premise that every wide panel is a `Dialog` is not true today. `SearchPanel`,
`ClosurePanel`, and `ConnectionDetail` render **inline** on wide, with no focus trap; only the
phone versions are wrapped in `Dialog`. `Dialog` is modal-only: body portal, `inert` siblings,
body scroll lock, focus trap and focusin redirection, dialog stack, Escape, focus return
(`src/components/Dialog.tsx`). Adding a `modal` prop would put those load-bearing invariants
behind a branch. Keep `Dialog` modal-only and add a separate primitive for wide panels.

### Surface table

| Surface | Wide (≥ 600) | Phone (< 600) |
|---|---|---|
| Search | Non-modal **transient** popover; closes on selection, outside click, Escape | Modal sheet |
| Case menu | Non-modal **transient** popover; dialog-style list of links/buttons (not `role="menu"`); closes on selection/outside/Escape | Modal sheet |
| Closure | Non-modal **persistent** popover; outside click does not close; X/Escape only | Modal sheet |
| Connection detail | Non-modal **persistent** 320 px trailing panel; outside click does not close; X/Escape; selecting another string updates it | Modal sheet |
| Thread types | Inline disclosure inside the Case menu | same |
| Backup | Modal `Dialog` | Modal `Dialog` |
| Connection type menu | Transient popover (existing) | Transient popover (existing) |
| Contextual hints | Non-modal transient `HintPopover` (existing) | Non-modal, above the bar |
| Help `?` / System status | Modal `Dialog` | Modal `Dialog` |

The persistent wide inspectors exist so a student can drag cards while Closure or Connection
detail stays open. Search and the Case menu are temporary visits and close on outside
interaction. The phone has no side-by-side room, so every icon-opened panel is a modal sheet.

### New primitive: `Panel` (non-modal)

Contract for the spec; no code in this map.

- `role="dialog"`, **no `aria-modal`**, labelled by its heading and optionally described.
- Rendered **adjacent to its trigger** in the DOM, absolutely positioned by the caller. No body
  portal on wide, so Tab order follows the visual order.
- Opening moves focus to the heading, or to the first field for Search. **No focus trap, no
  background `inert`, no body scroll lock.**
- Escape closes and returns focus to the trigger. Outside pointerdown closes **transient** panels
  only (`dismissOnOutsideClick`); persistent inspectors close via X/Escape.
- Route change or unmount: if focus was inside, restore it to the trigger when still connected,
  otherwise the board heading; remove all listeners.
- Reduced motion: no entrance animation; the final state and focus change are immediate.
- The Case menu and Search are dialog-style popovers with normal Tab order. Do **not** use
  `role="menu"`/`menuitem`: the content mixes links, buttons, and a disclosure, so a menu widget's
  arrow-key semantics would be wrong. Arrow keys may still be an optional convenience, not a
  contract.
- `Dialog` remains the only modal primitive: phone sheets, delete confirmations, backup, help,
  and System status. Do not add a `modal` prop to `Dialog`.

### Simultaneous surfaces

- **Wide:** at most **one persistent inspector** (Closure **or** Detail) and **one transient
  popover** (Search **or** Case menu).
  - Opening Detail closes Closure; opening Closure closes Detail.
  - Opening Search closes the Case menu and vice versa; both close on selection/outside/Escape.
  - A transient may coexist with a persistent inspector; the stage width never changes.
- **Phone:** exactly **one modal sheet** at a time. It covers the bar, so another cannot open
  until it closes. A backup dialog may stack on a sheet; the existing `Dialog` stack handles
  Escape and focus, and closing returns to the sheet.
- Contextual hints are suppressed while any surface is open. Toasts may coexist but never cover a
  sheet panel (05's top corridor).
- The connection type menu still takes precedence over the detail for a newly created string:
  while the type menu is open for that string, the detail does not render; once the menu is
  dismissed, the detail takes over. Keep the existing `menuCompetesWithDetail` rule.

### Trigger semantics and focus return

- Panel triggers: `aria-expanded` + `aria-controls` (when open) and `aria-haspopup="dialog"`.
  **Never `aria-pressed`** for a panel.
- The minimap is the exception: it is an on/off inset toggle, so it keeps `aria-pressed` with
  `Show minimap` / `Hide minimap`.
- Thread types is an inline disclosure: `aria-expanded` + `aria-controls`, no `aria-haspopup`.
- On close: return to the trigger. If an action moved the student — a search result, “Show on
  board” — return to the board heading instead. If the trigger is gone (detail closed after
  deleting the thread), focus the board heading. Keep the existing `sheetReturnFocusRef` pattern.
- The readiness chip's expanded state reflects Closure; the Case menu's reflects the menu;
  Search's reflects Search.
- Wide persistent panels: “Show on board” keeps Closure open and moves focus to the board
  heading. The phone closure sheet closes and moves focus to the board heading. Detail closes only
  via X/Escape or selecting another string; deleting the selected string closes it and focuses the
  board heading.

### Tab order

The canvas is **not a tab stop**. It is pointer-only; its description points to `Open card list`,
which is the keyboard path. Spatial card placement, panning, and string selection remain
pointer-only; the card list and card detail routes remain the non-spatial path for cards and
connections.

Order on the board route:

1. Skip link
2. Shell brand / nav / `System status` chip
3. Identity readiness chip
4. Rail: Search, Open card list, Case menu
5. Stage: view cluster (zoom out, percentage, zoom in, Fit, Reset), minimap toggle, Add evidence
6. An open non-modal panel (focus moves into it; its DOM follows its trigger)
7. Phone bar: Search, Add, Closure, Case menu
8. End

- Wide panel Tabs are normal: after the last control, focus continues to the next board control;
  Shift+Tab from the first control returns to the trigger. No trap.
- Phone sheets trap focus; Tab cycles inside; closing returns to the bar icon or the board heading.
- The hidden focusable `Case board` h2 is a programmatic landing target, never a tab stop.
- The panel is inserted in the tab order at its trigger, not appended to the end of the document;
  this is why wide panels must not be portalled to `body`.

### Layering and sheet corridor (joint with 05)

- Board chrome < non-modal panels < scrim < phone sheet < toast.
- Phone sheets cap their height to leave the top corridor for the identity band and the toast;
  the toast never overlaps the sheet panel.
- Toasts never move focus; dialogs keep their existing trap/inert/scroll-lock contract.

### Handed to other tickets

- **07** — the surface table, the `Panel` contract, simultaneous-surface rules, trigger semantics,
  focus return, tab order, the `Dialog`-remains-modal note, and the sheet/toast corridor.
- No new tickets.
