# 05 — Interruption and overlay policy

Type: grilling
Status: resolved
Blocked by: 02

## Question

Now that the board owns the screen, what is allowed to interrupt it — and what happens to the
things that interrupt it today?

The board route currently raises five kinds of interruption, each with different persistence:

| Surface | Today | Frequency |
|---|---|---|
| Backup reminder | full card above the board, two buttons | once per case, until dismissed |
| `ScaleWarning` | banner above the board | dismissible at 120, **persistent at 150+** |
| Save errors | error toast | rare |
| Undo | 8-second toast with action | per delete |
| Contextual hints | popover over the board | until dismissed, once each |

Plus shell-level interruptions shared with every route: offline notice, update prompt, browser
capability notice.

**Carried in from ticket 01:** the backup reminder never rendered during measurement — 12 cards,
one connection, `backupPromptedAt: null`, before and after reload, zero `.backup-reminder` nodes,
while `tests/backup/useBackupReminder.test.tsx` passes with an injected repository. Settle first
whether the banner still exists in the product; do not design a home for a surface that may be
dead code (or fix it and then decide).

Decide:

1. **Which of these may occupy board space** (pushing/cropping the canvas) versus **overlay it**
   (floating, dismissible, pointer-transparent outside its own bounds)?
2. **The persistent-warning conflict.** A 150+ card case must warn *and* must not permanently
   shrink the board. Where does that warning live — a badge on an icon, a dismissible-until-reload
   strip, a toast on entry, or a state inside the readiness signal? What does "persistent" mean
   under the new gate?
3. **The backup reminder.** It is a genuine safety nudge ("five cards and a connection is a good
   moment"). Does it become a badge on the Actions icon, a menu item, a one-line strip, or a
   toast? What is the cadence rule so it does not nag and does not get lost?
4. **Hints.** Do the first-run thread-anchor and long-press hints still land, given the board is
   no longer surrounded by explanatory chrome? Where does the summary paragraph's teaching copy
   go (it is being removed from the happy path)?
5. **Toasts vs the bottom icon bar on phone.** Undo and error toasts must not cover the bar or
   the cards the student is about to touch. Where is the toast layer, on which edge, and what
   happens when a menu is open?
6. **Offline / update / browser notices.** Do they still appear as a full-width region above the
   board (which would break the gate on the route), or move to a compact shell affordance?

Deliver a table: surface · home · persistence · does it shrink the board? · accessible
announcement (`role="alert"` / `role="status"` / none). Cite the existing components
(`Toast`, `HintPopover`, `UpdatePrompt`, `OfflineNotice`, `BrowserNotice`) where the answer is
"reuse as is".

## Answer

**Resolved.** No interruption enters the board route's flow. The board's height budget is
untouched: every interruption is either a floating overlay or a shell affordance. Capacity and
backup live in the Case menu behind a single attention dot; toasts move to a top-centre layer;
the contextual hints stay and the removed summary's teaching copy moves to the help dialog and
the empty state; the three shell notices collapse into one status chip and dialog.

**The backup reminder is live.** I reproduced the full `.backup-reminder` card on the demo case
(6 cards, 5 connections, `backupPromptedAt: null`). Ticket 01's zero-node reading was a
fixture/measurement artifact, most likely a measurement case with no connection row, so the
5-cards-plus-1-connection threshold never fired. It is not dead code.

**One attention dot.** The Case menu trigger can carry a single status dot. Amber for “first
backup recommended” or 150+ cards; danger for 200 cards. The dot is never the only signal: the
trigger's accessible name lists every active reason, and the menu sections carry the full copy.
The dot is the interruption channel 03 reserved for this ticket; the “no badges” rule still holds
for Search and Closure counts.

### Interruption table

| Surface | Home | Persistence | Shrinks the board? | Accessible announcement |
|---|---|---|---|---|
| Backup reminder | Case menu “First backup” section + Case menu attention dot + one-time toast | Dot and section until backed up or “Not now”; toast once per case per page session | No | `Toast` polite `role="status"`; section heading; dot reason in the Case menu name |
| Capacity 120–149 | Case menu “Case capacity” section + one-time toast | Section while ≥ 120; toast once per page session; no dot | No | `role="status"` in the menu and toast |
| Capacity 150–199 | Same section + persistent amber attention dot | Until the count drops below 150 | No | `role="status"`; dot reason in the Case menu name |
| Capacity 200 | Same section as an alert + danger attention dot + disabled `Add evidence` + “Create a new case” | Until the case is split | No | `role="alert"` on the menu section; `aria-disabled` plus description on Add |
| Save errors | Top-centre toast | Until dismissed | No | Existing `Toast` polite `role="status"` |
| Undo (connection delete) | Top-centre toast with Undo | 8 seconds, reachable until it expires | No | Existing `Toast` polite `role="status"`; action button |
| Connection feedback | Top-centre toast | Transient | No | Existing `Toast` polite `role="status"` |
| Closure success | Top-centre toast | Transient | No | Existing `Toast` polite `role="status"` |
| Contextual hints (`thread-anchor`, `long-press`) | Bottom-centre hint layer above the bar/cluster | Once each until dismissed; seen store unchanged | No | Existing `HintPopover` non-modal `role="dialog"`; focus moves in; no trap |
| Offline | Shell `System status` chip → status dialog | While offline; clears automatically | No | `role="status"` live region; chip name includes `Offline` |
| Update ready | Shell `System status` chip → status dialog | Until **Refresh** or **Later** | No | `role="status"`; explicit Refresh/Later buttons |
| Browser support | Shell `System status` chip → status dialog | Until dismissed for the page session | No | `role="status"`; capability list |

### Persistence and cadence rules

- **Backup:** eligible at 5 cards and 1 connection with `backupPromptedAt: null`. The one-time
  toast uses a page-session set keyed by case ID. Its × hides the toast for the session without
  writing anything; **Not now** in the menu calls `dismiss()` and writes `backupPromptedAt`
  permanently. A successful export calls `complete()` and writes the same timestamp. The dot and
  menu section remain until one of those writes.
- **Capacity:** derives from the live card count via `boardCapacityLevel`; no new persistence. The
  120/150 toasts use the same page-session set. At 200 the disabled Add and the menu alert are the
  persistent state.
- **Hints:** `hintSeenStore` is unchanged. A hint is suppressed while any panel or sheet is open;
  opening a surface hides the current hint without marking it seen, so it can return later.
- **Shell notices:** the update “Later” action keeps the existing behaviour; the browser notice's
  dismiss is session-scoped; offline derives from connectivity and needs no dismissal.

### Toast layer

- **Top-centre, just below the identity band.** Max 32 rem; 12 px inline inset on phone. This
  clears the phone bar, the view cluster, Add evidence, and the hint layer.
- The `Toast` primitive is retained: polite live region, no focus movement, errors and undo remain
  reachable until dismissed (the existing 8-second undo timer).
- `z-index` is the top layer. Phone sheets cap their height to leave a **top corridor** for the
  band and the toast; the toast therefore never covers a sheet panel. On a short landscape
  viewport the sheet shrinks and scrolls rather than covering the toast.
- On wide, the toast may briefly overlap a top-left or top-right popover at narrower tablet
  widths. It never takes focus and is dismissible; this is accepted rather than adding dynamic
  repositioning.

### Hints and teaching copy

- `HintPopover` stays non-modal and click-through except its actions.
- Phone: hint layer above the bottom bar. Wide: bottom-centre above the view cluster. It never
  covers the bar, cluster, or Add.
- The summary paragraph's teaching copy is removed from the happy path. Its content moves to the
  empty-state copy and a new **Board gestures** section in the `?` help dialog: pan, zoom, drag a
  card, long-press on touch, and draw a thread. No new board surface.

### Shell notices

- One conditional **`System status`** chip in the shell topbar, trailing. Visible only when at
  least one notice is active; its label reflects the highest-priority state (`Offline`,
  `Update ready`, `Limited support`) and its accessible name lists every active reason.
- The chip opens a modal **System status** dialog with sections for the active notices, reusing
  the existing `OfflineNotice`, `UpdatePrompt`, and `BrowserNotice` copy and actions. Update still
  requires explicit Refresh; Browser support remains dismissible; Offline clears itself.
- The topbar stays 60 px and no content height is consumed. This amends 02's “topbar untouched
  above 600” only by allowing the trailing chip; the Case shelf / Settings nav remains. On phone
  the brand + chip fit on one line.

### Reuse notes

- `Toast` as-is for all transient feedback; only the board-route region position changes.
- `HintPopover` as-is for the two contextual hints; only its board-route layer position changes.
- `Dialog` for the System status panel, backup, help, and confirmations (06 owns the modal
  contract).
- `useBackupReminder`, `persistBackupPromptedAt`, `boardCapacityLevel`, and the `ScaleWarning`
  copy are reused; the in-flow `ScaleWarning` and `.backup-reminder` card stop rendering.
- `OfflineNotice`, `UpdatePrompt`, and `BrowserNotice` are reused inside the status dialog rather
  than in the shell status region.

### Handed to other tickets

- **06** — toast and hint layers, the sheet top corridor, the status dialog as a modal, and the
  non-modal panel contract.
- **07** — the interruption table, attention-dot semantics and names, backup/capacity cadence,
  toast/hint placement, the Board gestures help section, and the shell status chip amendment to
  02.
- No new tickets.
