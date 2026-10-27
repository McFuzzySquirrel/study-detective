# 05 — Interruption and overlay policy

Type: grilling
Status: open
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

<!-- resolution: append the interruption table and the persistence rules -->
