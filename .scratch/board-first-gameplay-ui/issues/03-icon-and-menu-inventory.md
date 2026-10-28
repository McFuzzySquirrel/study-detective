# 03 — Icon and menu inventory

Type: grilling
Status: resolved
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

**Resolved.** Wide modes get a **three-slot rail** — Search, Open card list, Case menu. Phone
keeps its agreed four-slot bottom bar — Search, Add evidence, Case closure, Case menu. There is
**one closure surface per mode** (band readiness chip above 600, phone Closure icon), **one Search
surface** (filters stay inside it), and the legend lives in the **Case menu as a collapsed
`Thread types` disclosure**. Icons come from a single six-glyph module, the rail never scrolls,
and the minimap starts collapsed in every mode. No badges are introduced.

### Inventory

| Slot / position | Glyph | Accessible name | Opens | Contents | Shown when |
|---|---|---|---|---|---|
| Rail 1 (top) · bar 1 | magnifier | `Search` — `Search, filters active` when a query or filter is live | Popover anchored to the rail (wide) · full-height sheet (phone) | Query field, Filters disclosure (default closed), active-filter chips, result list, per-result detail links | Ready with ≥ 1 card |
| Rail 2 · — | bulleted list | `Open card list` | Route `/case/:id/list` | — | A case route exists |
| Rail 3 (bottom) · bar 4 | three vertical dots (kebab) | `Case menu` | Popover (wide) · sheet (phone) | Wide: Back up case, Recall, Thread types. Phone adds Open card list, Case shelf, Settings (order below) | Ready |
| — · bar 2 | plus | `Add evidence` | Route `/case/:id/capture` | — | Canvas mounted (≥ 1 card); hidden at the 200-card cap; the empty case owns Add instead |
| — · bar 3 | flag (not a check) | `Case closure` | Sheet | `ClosurePanel`: readiness, loose threads, Close/Reopen | Ready with a case record |
| Band trailing (wide only) | status dot + text | `Readiness: 8 loose threads` · `Readiness: ready to close` · `Readiness: closed` | Popover | `ClosurePanel` | Ready |
| Stage bottom-leading | `−`, `%`, `+`, `Fit`, `Reset` as text; map glyph for the minimap | Existing names unchanged | Actions; minimap toggle | — | Ready with ≥ 1 card |
| Case menu → Thread types | chevron | `Thread types` | Inline disclosure, default collapsed | Association / provenance key | Ready |
| On string selection | none | `Connection details` | Trailing panel (wide) · sheet (phone) | Type, endpoints, retype, delete | A string is selected |
| Contextual thread drop | none | `Connection type menu` | Popover | Type choice for a new string | A thread is dropped |

**Not icons, but still permanent:** the canvas, the case title (one line, truncating), the
readiness chip/label, the view cluster (text controls plus the minimap glyph), the Add evidence
affordance, and the visually hidden focusable `Case board` h2. **No persistent icon** exists for
connection detail, closure above 600, the legend, Recall, or Settings.

### Canonical accessible names

This table is the seed the spec must ship, including renames. Every rename lands with its test
update.

| Element | Canonical name | Replaces | Kind |
|---|---|---|---|
| Search trigger | `Search` / `Search, filters active` | `Search and filters` | Button → overlay |
| Search surface | `Search this case` | unchanged | Popover (wide) / sheet (phone) |
| Card list trigger | `Open card list` | unchanged | Link → route |
| Case menu trigger | `Case menu` | `Case actions` | Button → popover / sheet |
| Case menu surface | `Case menu` | `Case actions` | Popover (wide) / sheet (phone) |
| Add evidence | `Add evidence` | unchanged | Link → capture (primary) |
| Closure trigger (phone) | `Case closure` | unchanged | Button → sheet |
| Readiness chip (wide) | `Readiness: <readinessLabel>` / `Readiness: closed` | new | Button → closure popover |
| Readiness line (phone) | Visible text only, same wording | new | Static label, not a control |
| Closure surface | `Case closure` | unchanged | Popover (wide) / sheet (phone) |
| Thread types disclosure | `Thread types` | `Connection legend` | Disclosure inside Case menu |
| Minimap toggle | `Show minimap` / `Hide minimap` | unchanged | Toggle |
| View cluster | `Zoom out`, `Board zoom`, `Zoom in`, `Fit all cards`, `Reset view` | unchanged | Controls |
| Menu items | `Back up case`, `Recall`, `Open card list`, `Case shelf`, `Settings` | `Back to case shelf` → `Case shelf` | Links / buttons |

Untouched: the `Case board` h2, `Connection details`, `Connection type menu`, the card-detail and
card-list routes.

### Case menu contents and order

| Mode | Order |
|---|---|
| Wide (≥ 600) | **Back up case** · **Recall** — divider — **Thread types** |
| Phone | **Back up case** · **Recall** — divider — **Open card list** · **Case shelf** · **Settings** — divider — **Thread types** |

- Back up case: disabled until ready and a repository is open.
- Recall: only when ready with at least one card.
- Open card list: whenever a case route exists; wide mode has it as a rail slot, so it is not
  duplicated in the wide menu.
- Case shelf / Settings: phone only; above 600 the shell topbar keeps them.
- Thread types: always.
- Loading, missing, and error states render no menu; their recovery actions own the screen.
- Menu items are **text-only**; the only decorative glyph is the disclosure chevron.

> **Amended by 05:** when active, a **First backup** section and a **Case capacity** section
> appear at the top of the Case menu, and the Case menu trigger may carry one attention dot whose
> accessible name lists every active reason. The “no badges” rule still applies to Search and
> Closure counts; this dot is the interruption channel 03 handed to 05.

### Glyph authoring and proof

- **Home:** one module, `src/components/Glyph.tsx`, exporting a typed union of exactly six names:
  `search`, `card-list`, `case-menu`, `add`, `closure`, `map`, plus one `<Glyph name=… />`
  component.
- **Geometry:** 24×24 viewBox, `fill="none"`, `stroke="currentColor"`, 2 px stroke, round caps and
  joins, `aria-hidden="true"`, `focusable="false"`. The existing `IconButton` supplies the 44×44
  target and the accessible name; every glyph must be distinguishable by silhouette.
- **No new dependency**, no icon library, no icon font, no CSS masks.
- **Proof:** a component test asserting every union member renders exactly one decorative SVG with
  a 24×24 viewBox; an evidence pass with in-situ Playwright captures at 1280×800 and 390×844 at
  2× DPR, checking silhouette distinctness at 24 px and ≥ 3:1 non-text contrast against the rail,
  band, and cork surfaces; axe scans unchanged.
- **Theme caveat:** the app ships a single dark theme (`color-scheme: dark`), so "both themes"
  means both **surfaces** (rail/band over cork) unless a light theme enters scope.
- Fit, Reset, zoom ±, and the zoom percentage keep their textual treatment; only the minimap toggle
  becomes a glyph.

### Rail fit and minimap default

- Three rail slots cost `6 + 44 + 8 + 44 + 8 + 44 + 6 = 160 px`, inside the 273 px shortest stage
  at 844×390.
- The rail **never scrolls**. It caps at five visible slots (264 px); anything beyond moves into
  the Case menu. No collapse/hamburger strategy.
- The minimap starts **collapsed in every mode** on first mount, with the toggle in the view
  cluster and the open/closed choice remembered in memory for the tab session (never persisted).
- Ticket 01 observed the phone minimap open at 15 % because the viewport was resized after mount;
  `Minimap.tsx` already initialises collapsed below 640 px. The spec states the default as a
  mode rule so it no longer depends on mount timing.

### Flags and handoffs

1. **Empty-case Add.** While `cards.length === 0`, suppress the chrome/bar Add; `EmptyBoard`'s
   three CTAs (`Add note` / `Add source` / `Add topic`) are the Add affordance. The permanent Add
   returns with the first card. "Permanently visible" therefore means "whenever the canvas is
   mounted".
2. **Surface mechanics → 06.** This ticket names the surface *kind* (popover wide, sheet phone,
   trailing panel, inline disclosure); focus trap, restore, stacking, and simultaneous-surface
   rules belong to 06.
3. **Search state → 07.** Lift query/filter state out of `SearchPanel` into the page so closing and
   reopening the overlay does not reset it, and so the trigger can expose `Search, filters active`.
   Filtering affects only the overlay, so there is no visual badge.
4. **Single owner for chrome links → 07.** `BoardCanvas` currently renders its own `Add evidence`
   and `Open card list`; after the move, the frame owns Add and the rail owns the card list. Remove
   the in-canvas duplicates rather than leave two routes to the same place.
5. **No badges.** The readiness dot belongs to the chip, not a second control; the Closure icon
   carries no count because the readiness line states it; a backup-due indicator is an
   interruption decision for 05.
6. **Phone readiness is not a live region.** Adding a connection must not chatter; the closure
   surface's own status region remains the announcer.
7. **Backup reminder, scale warning, toasts, hints → 05.** Unchanged by this inventory.
