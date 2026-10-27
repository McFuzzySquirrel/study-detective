# 03 — Icon and menu inventory

Type: grilling
Status: open
Blocked by: 02

## Question

Given the frame from ticket 02, exactly which icons exist, what is inside each, and what kind of
surface does each open?

The visible set is agreed (canvas, slim board controls, "Add evidence", case title, readiness
signal; everything else behind an icon). What is not agreed is the *inventory*: how many
persistent slots, and how the evicted surfaces are grouped.

Work through:

1. **Slot count and order.** Phone is agreed at four (Search, Add, Closure, Actions). Do tablet
   and desktop use the same four, a superset, or fewer (relying on the board cluster for zoom
   and fit)? Which slot is leftmost/most prominent, and does `Add evidence` keep primary
   emphasis in every mode?
2. **Case actions**: today's header holds Back up case, Recall, Open card list, Back to case
   shelf, Settings (the last three only on phone per the agreed shell change). One `Case menu`
   listing them all, or split (e.g. Recall promoted to its own slot because it is a *gameplay*
   mode, not a utility)?
3. **Closure**: does the readiness signal open the full `ClosurePanel` (readiness derivation,
   loose threads, close/reopen) as one surface, or does closure get an icon separate from the
   readiness label? What is the readiness signal itself — a word, a dot, a fraction
   ("3 loose threads"), and is it a button or a label?
4. **Search and filters**: unchanged from today's `SearchPanel` content, or does the menu split
   search from filters now that it has its own home?
5. **Connection legend and connection detail**: legend becomes an item inside a menu (which
   one?); detail appears on string selection as today. Confirm the detail does not also need a
   persistent icon.
6. **Naming.** Propose the canonical accessible name for every icon and every menu — this is
   the seed of the name table the spec must ship (`Case actions` → `Case menu`?, `Search and
   filters` → `Search`?).
7. **Authoring home and proof** (graduated from the map’s fog). Where the inline SVG glyph set
   lives — a component module or the theme — and how each glyph is proven to read at 44 px
   against both themes, with no new dependency and no icon library.
8. **Rail fit and minimap default.** The rail must fit the shortest supported stage (~273 px at
   844×390) or define an overflow/collapse strategy. Also settle the minimap’s default state per
   mode: ticket 01 found it open by default on phone, covering 15 % of the board and hiding most
   visible cards.

Deliver an inventory table: slot · icon/glyph idea · accessible name · opens (popover / sheet /
drawer / modal) · contents. Flag anything that is *not* an icon but still earns permanent space,
and anything that turns out to need two surfaces (e.g. a badge plus a menu).

Do not decide interruption placement (ticket 05) or focus-trap mechanics (ticket 06) here; note
where they are needed and move on.

## Answer

<!-- resolution: append the inventory table and the canonical names -->
