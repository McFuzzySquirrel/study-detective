# Keyboard paths and canvas alternative

Use this reference when wiring or auditing the non-spatial experience.

## Route set

The keyboard path is a first-class set of routes, not a hidden mode:

- `/` case shelf: create, open, edit, delete, import, search? (shelf search is case search only)
- `/case/:caseId` case board with an accessible description and `Open card list`
- `/case/:caseId/list` keyboard card list: add, edit, open detail, connect, delete
- `/case/:caseId/card/:cardId` card detail: title, tags, replace, crop, connect, attach source, delete, OCR
- `/case/:caseId/recall` enter, check, reset, exit
- `/settings` shortcuts, motion, hints

Every route has one `main` landmark, a visible heading, a skip link on case screens, and a recovery action for a load failure.

## Shortcuts

| Key | Action | Guard |
|-----|--------|-------|
| `?` | Open shortcut help | Not while typing in an input, textarea, select, or contenteditable |
| `/` | Focus case search | Same guard; opens the search panel |
| `[` / `]` | Previous / next card in the list | Only on a case route with a list selection |
| `c` | Connect the focused card | Only when a card is focused and no dialog is open |
| `Escape` | Close the top overlay or clear search | Always; never closes the whole app |

Every shortcut is listed in Settings with a description. Do not fire a shortcut when a modifier key is held, when the target is editable, or when an overlay already handles the key.

## Canvas alternative

The canvas has an accessible name and description, for example: `Case board with 24 cards arranged spatially. Use the card list for a keyboard-operable view.` A visible `Open card list` action sits beside the board controls on every viewport.

Do not claim keyboard placement, canvas screen-reader parity, or drag equivalence. The card list and card detail carry every non-spatial capability: create, retitle, tag, delete with undo, attach provenance, create/retype/delete connections, search, enter recall, check results, and exit.

## Connection picker

From card detail and the card list, `Connect to…` opens a dialog with a searchable target list and a type radio group. Provenance filters targets to Sources when the source card is a Note, and to Notes when the source is a Source. Association is unfiltered but excludes self. Announce the target count, validation errors, and the result; restore focus to the trigger.

## Recall

Entry, Check, Reset scratch, and Exit are keyboard reachable from the recall toolbar. Drawing scratch is pointer-only; the results summary is a normal list that can be read and navigated without the canvas. Exit with non-empty scratch may confirm; browser navigation discards silently.

## Browser capability

If IndexedDB, Web Workers, WebAssembly, or service workers are missing, show a non-blocking banner naming the reduced capability and linking to the support matrix. The shelf and available data still render. A supported browser shows no banner.

## Keyboard journey acceptance

A single Playwright keyboard-only journey must create a card, edit it, attach provenance, create and retype an association, search and select a result, enter recall, check, reset, exit, and delete a card with undo. No pointer events are allowed in that journey. If a step requires the canvas, then a non-spatial route is missing, not the test.
