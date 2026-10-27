# Board-first case frame — redesign spec

**Status:** accepted for handoff · **Date:** 2026-10-27
**Effort:** `.scratch/board-first-gameplay-ui/`
**Sources:** tickets 01–06 and 08, the prototype, and the evidence screenshots.

**Placement.** This spec lives in the effort folder, not `docs/features/`, because it is the
decision artifact the map exists to produce and not yet a shipped feature document. The
implementation phase folds the accepted values into `docs/features/case-board.md` §4 and the
requirements listed in §11. That keeps the forge/feature pipeline from treating a scratch spec as
a new product feature and keeps the decision history next to the map. The local tracker convention
(`.scratch/<feature>/spec.md`) is also where an implementer will look first.

**Scope.** The `/case/:caseId` board route only. It re-homes what already exists; it adds no
gameplay or feature surface. It does not implement the redesign or edit `src/`.

---

## 1. Problem and gate

### 1.1 What is wrong today

Ticket 01 measured the production build at the three canonical viewports with a 12-card case and
one thread:

| Viewport | Shell | Content area | Chrome above the board | Board size | Board share | Page height |
|---|---|---|---|---|---|---|
| 1440×900 desktop | 61 | 839 | 574.5 | 884×564 | **67.2 %** | 2 448 |
| 1280×800 tablet landscape | 61 | 739 | 574.5 | 884×464 | **62.8 %** | 2 448 |
| 390×844 phone | 88.2 | 755.8 | 432.5 | 366×556 | **73.6 %** | 1 101 |

The board starts below 60–70 % of the fold on wide screens, more than a third of the phone board
is below it, and the canvas controls are off-screen at every viewport. `ClosurePanel`'s
loose-thread list, not the board, sets the document height: 2 448 px at 12 cards and 18 861 px at
150. The phone `Case actions` button is 160 px tall because `.case-board-page__header` stretches
it. Two override layers (`CaseBoardPage.css` and `styles/responsive.css`) own the stage clamp and
the content cap, so the current values cannot be reasoned about from one file.

### 1.2 The gate

The redesign has to prove, not claim:

1. **Board dominance** — the board stage is at least **75 %** of the content area at 1280×800 and
   1440×900, and at least **85 %** at 390×844. The content area is `100dvh − shell height`.
2. **Zero page scroll** on the board route at all three viewports: `scrollHeight` equals the
   visual viewport height, `scrollY` is 0, and only overlays scroll internally.
3. **No horizontal page scroll** at any canonical viewport.
4. **Stage width is invariant** under every selection: opening Search, the Case menu, the Case
   closure surface, or a connection detail never resizes the stage.
5. **The board is the page** — no surface below the stage, no page-height sibling, no in-flow
   banner above it.

The gate is measured at **100 % text**, default zoom, and a case with at least one card, with all
panels closed. Overlays are measured separately. The three canonical viewports come from
`A11Y-FR-03`: 390×844 phone, 1280×800 tablet landscape, 1440×900 desktop.

### 1.3 How to verify it

A repeatable Playwright check (new `e2e/board-gate.spec.ts` or an extension of
`e2e/responsive.spec.ts`) at each canonical viewport:

```ts
const shell = await page.locator('.app-frame__topbar').boundingBox();
const stage = await page.getByTestId('board-canvas').boundingBox();
const contentHeight = page.viewportSize().height - shell.height;
const share = stage.height / contentHeight;
const minimum = viewport.width < 600 ? 0.85 : 0.75;
expect(share).toBeGreaterThanOrEqual(minimum);
expect(await page.evaluate(() => document.scrollingElement.scrollHeight))
  .toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
expect(await page.evaluate(() => window.scrollY)).toBe(0);
expect(await page.evaluate(() => document.documentElement.scrollWidth))
  .toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
```

Then repeat the stage-width assertion with each panel open, and capture screenshots. The check is
the acceptance step, not a postscript.

### 1.4 The measured budget after the redesign

| Mode / viewport | Shell | Content h | Band/line + gap | Phone bar | Stage h | Board share | Stage w |
|---|---|---|---|---|---|---|---|
| Desktop 1440×900 | 61 | 839 | 56 | — | **783** | **93.3 %** | 1 384 |
| Tablet 1280×800 | 61 | 739 | 56 | — | **683** | **92.4 %** | 1 224 |
| Phone 390×844 | 56 | 788 | 48 | 56 | **684** | **86.8 %** | 390 |
| Portrait tablet 834×1194 | 61 | 1 133 | 56 | — | 1 077 | 95.1 % | 778 |
| Short laptop 1280×600 | 61 | 539 | 56 | — | 483 | 89.6 % | 1 224 |
| Landscape phone 844×390 (tablet mode) | 61 | 329 | 56 | — | 273 | 83.0 % | 788 |

The phone gate is deliberately tight: 86.8 % leaves 1.8 points. Any growth in the shell, the
compact line, the gap, or the bar must re-run the gate. The phone bar is at its floor: 44 px
targets plus 6 px top and bottom. Safe-area insets are additive and do not count against the
canonical 85 % target; see §10.3.

The wide formula is `stage height = 100dvh − shell − 48 band − 8 gap`. The phone formula is
`100dvh − 56 shell − 44 line − 4 gap − 56 bar − safe-area-bottom`. These are **minimum** heights
that may grow with text zoom; the stage is the `1fr` remainder, never a `clamp()` with a hard-coded
shell.

---

## 2. Composition per mode

One wide frame for tablet and desktop; one phone frame. No height-specific third mode. The phone
bar and the wide rail are the same component family with different orientation and item sets.

### 2.1 Wide — tablet and desktop (≥ 600 px)

```
┌ Notes Detective                              Case shelf  Settings  [status] ┐ 61
├ Biology Midterm — Cells and Energy                       [● 8 loose threads] ┤ 48
│ ┌──┐ ┌────────────────────────────────────────────────────────────────────┐ │
│ │⌕ │ │                                                                    │ │
│ │▤ │ │                              cork / cards                          │ │
│ │⋮ │ │                                                                    │ │
│ └──┘ │ [−  75 %  +  Fit  Reset  ▣]                    [+ Add evidence]    │ │
│  56  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
  8 px gap between the band and the stage row.
```

- **Pinned outside the canvas:** shell 61 px; identity band 48 px (full width, 1 px bottom border);
  8 px gap; 56 px leading rail; stage fills the rest.
- **Floating over the canvas:** view cluster bottom-leading 12 px; `Add evidence` bottom-trailing
  12 px; minimap top-trailing 12 px when open; connection detail trailing 320 px when a string is
  selected.
- **Rail:** Search, Open card list, Case menu, top to bottom, 6 px padding, 8 px gap, 44 px
  targets, quiet treatment. The Case menu is the overflow and can carry the attention dot.
- **No width cap:** the board route drops the 72 rem / 80 rem content cap and its inline padding.
  The stage runs edge to edge; the band and rail keep their inline/safe-area insets.
- **Nothing below the stage.** The page is exactly the content height.

### 2.2 Phone (< 600 px)

```
┌ Notes Detective ──────────────────────────────────────┐ 56
├ Biology Midterm — Cells an…        ● 8 loose threads ─┤ 44
│ ┌───────────────────────────────────────────────────┐ │
│ │                                                   │ │
│ │                    cork / cards                   │ │
│ │                                                   │ │
│ │ [−  75 %  +  Fit  Reset  ▣]                       │ │
│ └───────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────┤
│      ⌕              +              ⚑              ⋮   │ 56
└───────────────────────────────────────────────────────┘
```

- Shell 56 px, app name only; Case shelf and Settings move into the Case menu.
- Compact title/readiness line 44 px, 4 px gap, full-bleed stage, bottom bar 56 px + safe area.
- **Bottom bar:** Search, Add evidence, Case closure, Case menu. Add is the only filled primary.
  The bar is boxed icons; the wide rail is quiet.
- No rail, no floating Add. The view cluster floats bottom-leading above the bar; the minimap is
  top-trailing and collapsed.
- The phone bar's four slots are the ready-case set. On an empty case, Search and Add are hidden
  and the empty state owns Add; Closure and Case menu remain. At 200 cards, Add remains visible and
  disabled.

### 2.3 What is pinned, what floats, what overlays

| Element | Wide | Phone |
|---|---|---|
| Shell topbar | Pinned 61 px | Pinned 56 px |
| Case title | Identity band, pinned 48 px, one line, truncating | Compact line, 44 px, one line, truncating |
| Readiness | Band chip (button), 44 px | Compact line, static label |
| Rail | Pinned 56 px | — |
| Stage | Full-bleed remainder | Full-bleed remainder |
| View cluster | Floating bottom-leading | Floating bottom-leading above the bar |
| Add evidence | Floating bottom-trailing primary | Bar slot 2, filled |
| Minimap | Floating top-trailing, collapsed | Floating top-trailing, collapsed |
| Search / Case menu / Closure | Non-modal wide panels | Modal bottom sheets |
| Connection detail | Non-modal 320 px trailing panel | Modal bottom sheet |
| Toasts | Top-centre, below the band | Top-centre, in the sheet corridor |
| Hints | Bottom-centre above the cluster | Bottom-centre above the bar |

### 2.4 Invariants the implementation must hold

1. **Stage width is invariant.** Selecting a string, opening Search, the Case menu, or Closure
   never resizes the stage. No grid column is added beside it.
2. **The stage is the `1fr` remainder**, never a clamp. No min-height that forces page scroll.
3. **Zero page scroll at 100 % text**, at all three canonical viewports. Overlays are the only
   scroll containers.
4. **Full-bleed, no width cap above 600 px.** The board route escapes the content wrapper's cap and
   padding; the shell's nav and the route's band/rail insets remain.
5. **The band never wraps in a way that clips.** The title truncates; the readiness chip stays
   whole. The band is `min-height: 48px` and may grow under text zoom (§10).
6. **The rail fits the shortest supported stage.** At 844×390 the stage is 273 px; three slots cost
   160 px. The rail caps at five visible slots (264 px); overflow moves into the Case menu. It never
   scrolls.
7. **Floating chrome clears 4.5:1 over cork;** every target is at least 44×44; focus is visible
   everywhere.
8. **Three modes, two compositions.** Phone is the bottom-bar composition; tablet and desktop are
   the same rail + band composition, differing only in width. Portrait tablet is tablet. There is no
   height-based fourth mode.

---

## 3. Frame elements

### 3.1 Shell topbar

- 61 px above 600; 56 px on phone. Brand `Notes Detective` in the heading face.
- Above 600: primary nav `Case shelf`, `Settings` at the trailing edge, then the conditional
  `System status` chip (§8.5). The nav is unchanged.
- Phone: brand only; nav items move into the Case menu. The status chip may sit at the trailing
  edge.
- The topbar stays sticky and keeps its safe-area top inset. It is the only shell value; no board
  surface may render a full-width strip above the stage.

### 3.2 Identity band / compact line

- **Wide:** 48 px min-height, full width, `var(--space-inline)` inline padding, 1 px bottom border.
  Leading: case title, one line, ellipsis, full title as the text node. Trailing: readiness chip.
- **Phone:** 44 px min-height, 16 px inline padding, title and readiness on one line; title
  `--font-size-md`, readiness `--font-size-xs`. The title truncates; the readiness label stays whole.
- The visible case title is not a second heading. The single page heading is the visually hidden,
  focusable `Case board` h2 (`tabIndex="-1"`), used as the programmatic landing target.
- The band is `min-height`, not `height`; at 200 % text it grows and the stage shrinks (§10).
- The wide readiness chip is a 44 px button with a state dot, the readiness text, and a small
  chevron. The phone readiness line is static text; the bar's Closure icon is the trigger.
- The chip's text and dot mapping is in §6.1.

### 3.3 Rail (≥ 600)

- 56 px wide, full height of the stage row; 6 px padding, 8 px gap; 44×44 targets.
- Three slots, top to bottom: **Search**, **Open card list**, **Case menu**. Search is a button;
  Open card list is a link; Case menu is a button. The Case menu is the overflow/attention slot.
- **Quiet treatment:** transparent surface and border at rest; `currentColor` glyphs; hover and
  focus reveal the control surface and border. The target is still 44×44.
- Five-slot cap; overflow moves into the Case menu. No scrolling rail, no collapse button.
- `Open card list` is a direct route because it is the keyboard alternative to the pointer-only
  canvas. It is never buried on wide.

### 3.4 Stage

- Full-bleed; fills the remainder. Background is cork from tokens; a 2 px `--color-cork-edge` inset
  keeps the boundary deliberate. No rounded outer corners on the route.
- `overflow: hidden`, `min-block-size: 0`; the canvas host fills it. The stage never scrolls; the
  page never scrolls.
- The stage's top is the band bottom + 8 px (wide) or the compact line + 4 px (phone). Its leading
  edge is the rail's trailing edge (wide) or the viewport edge (phone).
- The stage is the only surface that owns the full-bleed permission; the band/rail keep their
  insets.

### 3.5 Phone bar

- 56 px min-height + `env(safe-area-inset-bottom)`; top border; canvas background.
- Four equal slots, `justify-content: space-around`: **Search**, **Add evidence**, **Case closure**,
  **Case menu**. All 44×44 targets.
- Add is the only filled primary (`--color-accent`, `--color-accent-ink`, plus glyph). The others
  use the default boxed `IconButton` treatment.
- The bar is hidden above 600. It covers no content; it is a normal flow sibling below the stage.
- At 200 cards Add stays visible and disabled. On an empty case Search and Add are hidden; the
  empty state owns Add.

### 3.6 Floating chrome

- **View cluster:** bottom-leading 12 px (8 px phone), translucent scrim pill, 2 px gap. Quiet
  controls: zoom out, zoom percentage output, zoom in, `Fit`, `Reset`, minimap toggle (map glyph).
  Every target 44×44; the percentage is a 64 px output. It wraps within the stage if needed and
  never causes horizontal page scroll.
- **Add evidence:** bottom-trailing 12 px, primary, 44 px, plus glyph + text on wide. Phone uses the
  bar slot. At 200 cards the interactive link becomes a disabled affordance (it stays visible); while
  the canvas is not mounted (empty case) the chrome Add is suppressed and the empty state owns it.
- **Minimap:** top-trailing 12 px, 224 px max width, fixed 200×140 SVG viewBox, collapsed by
  default in every mode. The toggle is the map glyph; `aria-pressed`, `Show minimap` /
  `Hide minimap`. The open state is remembered in memory for the tab session, never persisted. The
  minimap is user-invoked and may cover cards; it never affects culling or the gate.
- **Connection detail:** trailing 320 px panel from the stage top to the bottom, non-modal and
  persistent. It covers the floating Add while a string is selected; the Add returns on close. This
  is the documented exception to "Add is permanently visible" (04).
- All floating chrome sits above the cork, uses the token scrim/surface, and clears 4.5:1.

---

## 4. Icon and menu inventory

| Slot / position | Glyph | Accessible name | Opens | Contents | Shown when |
|---|---|---|---|---|---|
| Rail 1 · bar 1 | magnifier | `Search` / `Search, filters active` | Non-modal popover (wide) · modal sheet (phone) | Query field, Filters disclosure (default closed), active chips, result count, results, Open detail | Ready with ≥ 1 card |
| Rail 2 · — | bulleted list | `Open card list` | Route `/case/:id/list` | — | A case route exists |
| Rail 3 · bar 4 | three vertical dots (kebab) | `Case menu` plus active attention reasons | Non-modal popover (wide) · modal sheet (phone) | Attention sections, Back up case / First backup, Case capacity, Recall, phone-only card list/shelf/settings, Thread types | Ready; reduced safe menu on loading/missing/error |
| — · bar 2 | plus | `Add evidence` | Route `/case/:id/capture` | — | Canvas mounted (≥ 1 card); disabled at 200; empty state owns Add |
| — · bar 3 | flag | `Case closure` | Modal sheet (phone) | ClosurePanel: readiness, loose threads, Close/Reopen, date | Ready with a case |
| Band trailing (wide) | status dot + text | `Readiness: <state>` | Non-modal persistent Closure panel | ClosurePanel | Ready |
| Stage bottom-leading | `−`, `%`, `+`, `Fit`, `Reset`; map glyph | Existing view names | Actions; minimap toggle | — | Ready with ≥ 1 card |
| Case menu → Thread types | chevron | `Thread types` | Inline disclosure | Association / provenance key | Ready |
| String selection | none | `Connection details` | Non-modal trailing panel (wide) · modal sheet (phone) | Type, endpoints, retype, delete | A string is selected |
| Thread drop | none | `Connection type menu` | Transient popover | Type choice | A thread is dropped |

**Not icons but permanent:** the canvas, the case title, the readiness chip/line, the view cluster,
Add evidence, and the hidden focusable `Case board` h2. **No persistent icon** exists for connection
detail, closure above 600, the legend, Recall, or Settings.

### 4.1 Markup rules

- Icon-only controls use `aria-label`; **do not** also set a `title` tooltip. Never both. If a
  tooltip is ever added, it must be the accessible name, not a duplicate.
- Every glyph is decorative: `aria-hidden="true"` and `focusable="false"`; the button/link carries
  the name. The hit area is at least 44×44; the visual glyph is 24×24.
- Visible focus: `:focus-visible` with the shared focus ring; no focus removal.
- Contrast: glyphs and text clear the surface contrast requirements; the rail/bar glyphs are tested
  over the rail/canvas surfaces; floating chrome clears 4.5:1 over cork.
- The `Case menu` trigger may carry one 8 px attention dot with a 2 px canvas ring at its
  top-trailing corner. The dot is decorative; the reasons are in the accessible name and the menu
  sections.
- The `System status` chip is a text chip, not an icon; it is the only shell notice affordance.

### 4.2 Glyph authoring and proof

- One module: `src/components/Glyph.tsx`, typed union of exactly six names: `search`, `card-list`,
  `case-menu`, `add`, `closure`, `map`.
- Geometry: 24×24 viewBox, `fill="none"`, `stroke="currentColor"`, 2 px stroke, round caps and
  joins. No icon library, icon font, CSS mask, or new dependency.
- Proof: a component test renders every union member as one decorative SVG with a 24×24 viewBox;
  an evidence pass captures the glyphs in situ at 1280×800 and 390×844, 2× DPR, checks silhouette
  distinctness at 24 px, and checks ≥ 3:1 non-text contrast against the rail, bar, band, and cork.
  The app ships one dark theme; "both themes" means both surfaces, not a light theme (out of scope).
- Fit, Reset, zoom ±, and the zoom percentage keep textual/typographic treatment. Only the minimap
  toggle becomes a glyph in the cluster.

### 4.3 Case menu contents and order

| Mode | Order |
|---|---|
| Wide | **First backup** (when visible; otherwise **Back up case**) · **Case capacity** (≥ 120) · **Recall** — divider — **Thread types** |
| Phone | **First backup** (when visible; otherwise **Back up case**) · **Case capacity** (≥ 120) · **Recall** — divider — **Open card list** · **Case shelf** · **Settings** — divider — **Thread types** |

- First backup, when visible, **replaces** the normal Back up case item while it is active; the
  section carries the safety copy and `Back up now` / `Not now`. When it is dismissed or completed,
  the normal Back up case item returns.
- Case capacity appears at 120+; see §6.2.
- Recall only when ready with at least one card. Open card list whenever a case route exists; it is
  not duplicated in the wide menu because the rail owns it. Case shelf and Settings are phone-only;
  above 600 the shell nav keeps them. Thread types always.
- Loading/missing/error render a reduced Case menu with only safe destinations (Case shelf,
  Settings) and no case actions; their recovery actions own the stage. This is required on phone,
  where the shell nav is hidden.
- Menu items are text-only; the only decorative glyph is the Thread types chevron. The menu is a
  dialog-style list, not a `role="menu"` widget.

---

## 5. Canonical accessible names

This is the contract the implementation and the e2e suites use. Every rename lands with its test
update.

| Element | Canonical name | Replaces | Kind |
|---|---|---|---|
| Search trigger | `Search` / `Search, filters active` | `Search and filters` | Button → panel |
| Search surface | `Search this case` | unchanged | Panel/sheet |
| Card list trigger | `Open card list` | unchanged | Link → route |
| Case menu trigger | `Case menu` + active reasons, e.g. `Case menu, first backup recommended` / `Case menu, 150 cards, split recommended` / `Case menu, case full` | `Case actions` | Button → panel/sheet |
| Case menu surface | `Case menu` | `Case actions` | Panel/sheet |
| Add evidence | `Add evidence` | unchanged | Link/button → capture; disabled at 200 |
| Case closure trigger (phone) | `Case closure` | unchanged | Button → sheet |
| Readiness trigger (wide) | `Readiness: ready to close` / `Readiness: 8 loose threads` / `Readiness: closed` / `Readiness: closed, loose threads` | new | Button → Closure panel |
| Readiness line (phone) | Same visible wording; static text | new | Label |
| Closure surface | `Case closure` | unchanged | Panel/sheet |
| Thread types disclosure | `Thread types` | `Connection legend` | Inline disclosure |
| Minimap toggle | `Show minimap` / `Hide minimap` | unchanged | Toggle (`aria-pressed`) |
| View cluster | `Zoom out`, `Board zoom`, `Zoom in`, `Fit all cards`, `Reset view` | unchanged | Controls |
| Menu items | `Back up case`, `Back up now`, `Not now`, `Recall`, `Open card list`, `Case shelf`, `Settings`, `Create a new case` | `Back to case shelf` → `Case shelf` | Links/buttons |
| Case capacity section | `Case capacity` | new | Menu section |
| First backup section | `First backup` | new | Menu section |
| System status chip | `System status: offline` / `System status: update ready` / `System status: limited support` / combined reasons | new | Button → dialog |
| System status dialog | `System status` | new | Modal dialog |
| Board gestures section | `Board gestures` | new | Section in `?` help |
| Close controls | `Close search`, `Close case menu`, `Close case closure`, `Close connection details`, `Close system status` | existing pattern | Buttons |

Untouched: `Case board` h2, `Connection details`, `Connection type menu`, the card list/detail
routes, `Filters`, `Clear all`, `Search cards`, `Active filters`, `Search results`.

Renames that require test churn: `Search and filters` → `Search`, `Case actions` → `Case menu`,
`Connection legend` → `Thread types`, `Back to case shelf` → `Case shelf`. `Case closure` and
`Open card list` stay.

---

## 6. States and derived values

### 6.1 Readiness

Use `deriveCaseLifecycle(closedAt, readiness)` for the labels and `deriveReadiness` for the counts.
The chip/line never stores a count.

| State | Visible text | Dot | Wide trigger name | Phone |
|---|---|---|---|---|
| Open, 0 loose | `Ready to close` | success | `Readiness: ready to close` | static text |
| Open, N loose | `8 loose threads` | warning | `Readiness: 8 loose threads` | static text |
| Closed, 0 loose | `Closed` | neutral | `Readiness: closed` | static text |
| Closed, N loose | `Closed · loose threads` | warning | `Readiness: closed, loose threads` | static text |

The closure surface shows the same readiness line, the loose-thread rows with missing requirements,
the closure date when closed, and Close/Reopen. Closing and reopening remain confirmed dialogs.
The chip is not a live region; the closure surface's own `role="status"` is the announcer. Adding a
connection therefore does not chatter while the surface is closed.

### 6.2 Capacity and backup

- `boardCapacityLevel(cardCount)` remains the source: normal / soft (120–149) / persistent
  (150–199) / blocked (200).
- **120–149:** a one-line Case capacity section at the top of the case menu and a one-time toast on
  entry per page session. The section has a session-only Dismiss; no attention dot.
- **150–199:** the full warning and remaining count in the section, plus the persistent amber
  attention dot. No dismiss. The dot and section persist until the count drops below 150.
- **200:** the section becomes an alert with the split message and `Create a new case`; the dot is
  danger; Add remains visible but disabled with `aria-disabled` and a description. The phone bar Add
  is disabled too. No new cards can be created on the board or capture route; the existing guard is
  unchanged.
- **Backup:** visible at 5 cards + 1 connection + `backupPromptedAt: null`. The reminder is live;
  05 reproduced the full card on the demo case, so ticket 01's zero-node reading was a
  fixture/measurement artifact, not dead code. A First backup section at the top of the case menu
  carries the copy and `Back up now` / `Not now`; Not now writes `backupPromptedAt` permanently. A
  one-time toast per case per page session has `Back up now` and a session-only dismiss ×; the dot
  remains if the toast is ignored. A successful export writes the timestamp and clears the section
  and dot.
- **Attention dot:** one dot on the Case menu trigger for any active reason. Amber for backup or
  150+ capacity; danger for 200. The accessible name lists all active reasons. The dot is the only
  badge introduced; Search and Closure counts remain unbadged.

### 6.3 Route and data states

| State | Band | Rail / bar | Stage | Add |
|---|---|---|---|---|
| Loading | Title placeholder/known title; readiness hidden | Search/Add/Closure hidden; Card list if the case ID exists; reduced Case menu with safe items | `Opening the case…` status | Hidden |
| Missing | `Case file` | Search/Add/Closure hidden; reduced Case menu (shelf/settings); card list unavailable | `Case not found` + Back to case shelf | Hidden |
| Error | Known title or `Case file` | Search/Add/Closure hidden; reduced Case menu (shelf/settings); card list if known | Recoverable error + Retry + Back to case shelf | Hidden |
| Empty | Title + readiness | Wide: Card list + Case menu; Search hidden. Phone: Closure + Case menu | `EmptyBoard` with Add note/source/topic | Chrome Add suppressed; empty state owns it |
| Ready | Title + readiness | Full inventory | Canvas / cards | Shown |
| 200 cards | Title + readiness | Full; Case menu danger dot | Canvas; Add disabled | Disabled |
| Closed | `Closed` / `Closed · loose threads` | Full | Canvas remains editable | Shown |
| Offline | Unchanged | Unchanged | Unchanged | Shown |
| Update ready | Unchanged | Unchanged | Unchanged | Shown |

The empty case's readiness is derived like any other case. The empty state's three CTAs are the
Add affordance; the chrome Add appears with the first card.

### 6.4 Surface and hint states

- Search: trigger name reflects active criteria; the committed query/type/tags live in the page (or
  a UI store) for the open case, so closing and reopening does not reset them. Selecting a result
  closes the surface, centers/selects the card, and focuses the board heading.
- Connection detail: selecting a different string updates the open panel; the type menu takes
  precedence for a newly created string; deleting the selected string closes the panel.
- Minimap: collapsed by default; open state remembered in memory for the tab session.
- Hints: suppressed while any panel/sheet is open; opening a surface hides the current hint without
  marking it seen.

---

## 7. Panel mechanics

### 7.1 Surface types

| Surface | Wide (≥ 600) | Phone (< 600) |
|---|---|---|
| Search | Non-modal **transient** popover; closes on selection, outside click, Escape | Modal sheet |
| Case menu | Non-modal **transient** popover; dialog-style list; closes on selection/outside/Escape | Modal sheet |
| Closure | Non-modal **persistent** popover; outside click does not close; X/Escape | Modal sheet |
| Connection detail | Non-modal **persistent** 320 px trailing panel; outside click does not close; X/Escape | Modal sheet |
| Thread types | Inline disclosure inside the Case menu | same |
| Backup | Modal `Dialog` | Modal `Dialog` |
| Connection type menu | Transient popover (existing) | Transient popover |
| Hints | Non-modal transient `HintPopover` | Non-modal, above the bar |
| Help `?` / System status | Modal `Dialog` | Modal `Dialog` |

The current code does not match the old premise: wide Search, Closure, and Detail are inline today,
not focus-trapped dialogs. Only the phone sheets use `Dialog`. `Dialog` is modal-only (body portal,
`inert` siblings, scroll lock, focus trap, stack); do not add a `modal` prop to it.

### 7.2 New `Panel` primitive (wide, non-modal)

- `role="dialog"`, no `aria-modal`, labelled by its heading, optionally described.
- Rendered as a sibling **immediately after its trigger's slot** in the DOM; absolutely positioned
  by the page. No body portal on wide, so Tab order follows the visual order.
- Opening moves focus to the heading, or the first field for Search. **No focus trap, no background
  `inert`, no body scroll lock.**
- Escape closes and returns focus to the trigger. Outside pointerdown closes **transient** panels
  only; persistent inspectors close via X/Escape.
- Route change/unmount: if focus was inside, restore to the trigger when connected, otherwise the
  board heading; remove listeners. Reduced motion: no entrance animation.
- The case menu is a dialog-style list with normal Tab order; not a `role="menu"` widget. Arrow keys
  may be a convenience, not a contract.
- Panel content scrolls internally. Floating panels (Search, Case menu, Closure) are clamped to the
  stage with 12 px insets and flip or scroll when they would overflow; the Detail panel is
  edge-to-edge trailing at 320 px. Widths: Search 380 px, Case menu 300 px, Closure 370 px, Detail
  320 px.
- The panel never adds a grid column or changes the stage width.

### 7.3 `Dialog` (modal)

- Phone sheets, delete confirmations, backup, `?` help, and System status use the existing
  `Dialog` unchanged: portal, `aria-modal`, labelled/described, focus trap, `inert` background,
  body scroll lock, Escape, focus return, stack.
- Phone sheets cover the bar. Their max height leaves a **176 px top corridor** for the shell,
  compact line, and toast; the sheet scrolls internally. The bar is not reachable behind the sheet.
- Closing returns focus to the bar icon, or to the board heading when an action moved the student
  (search result, Show on board, deleted trigger). Keep the `sheetReturnFocusRef` pattern.

### 7.4 Simultaneous surfaces

- **Wide:** at most one persistent inspector (Closure **or** Detail) and one transient popover
  (Search **or** Case menu).
  - Opening Detail closes Closure; opening Closure closes Detail.
  - Opening Search closes the Case menu and vice versa; both close on selection/outside/Escape.
  - A transient may coexist with a persistent inspector; the stage width never changes.
- **Phone:** exactly one modal sheet at a time. The sheet covers the bar. A backup dialog may stack
  on a sheet; the `Dialog` stack handles Escape/focus, and closing returns to the sheet.
- Hints are suppressed while any surface is open. Toasts may coexist but never cover a sheet panel.

### 7.5 Triggers, focus return, and tab order

- Panel triggers: `aria-expanded` + `aria-controls` + `aria-haspopup="dialog"`. Never
  `aria-pressed` for a panel. The minimap is the exception (`aria-pressed`, Show/Hide).
- Thread types: `aria-expanded` + `aria-controls`, no `aria-haspopup`.
- Close: return to the trigger; if an action moved the student, to the board heading; if the trigger
  is gone, the board heading.

| Surface | Focus on close |
|---|---|
| Search | Search trigger; a chosen result goes to the board heading |
| Case menu | Case menu trigger; a route item unmounts the board |
| Closure | Readiness chip (wide) / Closure bar icon (phone); Show on board goes to the board heading |
| Connection detail | Board heading (the string trigger is not focusable); deleting the string also goes to the board heading |
| Backup / System status / `?` help | The trigger (Back up case/now, status chip, or the element focused on open) |

- The canvas is **not a tab stop**. It is pointer-only; its description points to `Open card list`.
- Tab order: skip link → shell brand/nav/status chip → identity readiness → rail (Search, Card list,
  Case menu) → stage controls (view cluster, minimap toggle, Add) → an open panel at its trigger
  slot → phone bar → end.
- Wide panel Tabs are normal; after the last control focus continues to the next board control;
  Shift+Tab from the first returns to the trigger. Phone sheets trap focus.
- The hidden `Case board` h2 is a programmatic target, never a tab stop. SVG strings are not
  focusable; the card list/detail route remains the non-spatial path.

### 7.6 Layering

- Board chrome < hints < non-modal panels < scrim < phone sheet < toast.
- Use tokens: `--z-dialog` for modal, a new `--z-panel` below it for wide panels, `--z-toast` above;
  no arbitrary z-index in feature CSS.
- Hints sit above board chrome but below dialogs; they are non-modal and click-through except their
  actions. Toasts never move focus; dialogs keep the existing trap/inert/scroll-lock contract.

---

## 8. Interruption and overlay policy

### 8.1 The rule

No interruption enters the board route's flow. Every interruption is a floating overlay or a shell
affordance. The old full-width backup card and `ScaleWarning` banner are deleted.

### 8.2 Interruption table

| Surface | Home | Persistence | Shrinks board? | Announcement |
|---|---|---|---|---|
| Backup reminder | Case menu First backup section + attention dot + one-time toast | Dot/section until backed up or Not now; toast once per case per page session | No | Toast polite `role="status"`; section heading; dot reasons in the menu name |
| Capacity 120–149 | Case menu Case capacity section + one-time toast | Section while ≥ 120; toast once per page session; session Dismiss; no dot | No | `role="status"` |
| Capacity 150–199 | Section + persistent amber dot | Until below 150 | No | `role="status"`; dot reasons |
| Capacity 200 | Alert section + danger dot + disabled Add + Create a new case | Until split | No | `role="alert"`; `aria-disabled` + description on Add |
| Save errors | Top-centre toast | Until dismissed | No | Existing `Toast` polite |
| Undo | Top-centre toast with Undo | 8 seconds, reachable | No | Existing `Toast` polite |
| Connection feedback | Top-centre toast | Transient | No | Existing `Toast` polite |
| Closure success | Top-centre toast | Transient | No | Existing `Toast` polite |
| Hints | Bottom-centre hint layer above the bar/cluster | Once each; seen store unchanged | No | `HintPopover` non-modal `role="dialog"` |
| Offline | System status chip → dialog | While offline | No | `role="status"` live; chip name |
| Update ready | System status chip → dialog | Until Refresh/Later | No | `role="status"`; buttons |
| Browser support | System status chip → dialog | Until dismissed for session | No | `role="status"`; list |

### 8.3 Toast layer

- Top-centre, directly below the identity band; max 32 rem; 12 px inline inset on phone.
- Clears the phone bar, view cluster, Add, and hint layer. On wide it sits between the Search and
  Closure panels at 1280/1440; at narrower tablets it may briefly overlap a popover, but it never
  steals focus and is dismissible.
- `z-index` is the top layer. Phone sheets cap their height to leave the 176 px corridor, so the
  toast never covers the sheet panel.
- Reuse `Toast`; the board route passes the top placement variant. Other routes keep the existing
  bottom placement. Errors and undo remain reachable until dismissed (the existing 8-second undo
  timer).

### 8.4 Hints and teaching copy

- `HintPopover` stays non-modal and click-through except its actions.
- Phone: bottom-centre above the bar. Wide: bottom-centre above the view cluster. It never covers
  the bar, cluster, or Add.
- The summary paragraph's teaching copy is removed from the happy path. Its content moves to the
  empty-state copy and a new **Board gestures** section in the `?` help dialog: pan, zoom, drag a
  card, long-press on touch, draw a thread. No new board surface.
- Hints are suppressed while a surface is open; opening a surface hides the hint without marking it
  seen.

### 8.5 Shell notices — `System status`

- One conditional text chip in the shell topbar, trailing. Visible only when a notice is active.
  Label: the highest-priority short state (`Offline`, `Update ready`, `Limited support`); with more
  than one active notice, `Status · 2` (the count). Accessible name lists every active reason.
- The chip opens a modal `System status` dialog with sections for the active notices, reusing the
  `OfflineNotice`, `UpdatePrompt`, and `BrowserNotice` copy/actions. Update still requires explicit
  Refresh; Browser support is dismissible for the session; Offline clears itself.
- A visually hidden shell live region announces the state change; the dialog provides the actions.
- The shell topbar stays 61 px tall above 600 and 56 px tall on phone; no content height is consumed.
  Remove the old full-width `app-frame__status` notices; keep the shelf's own storage status where
  it is.
- This amends 02's “topbar untouched above 600” only by allowing the trailing chip; the Case shelf /
  Settings nav is unchanged. On phone the brand + chip fit on one line.

---

## 9. Layout ownership and tokens

### 9.1 One owner per value

| Area / value | Owner | Must not be overridden by |
|---|---|---|
| Palette, type, spacing, radii, targets, z-index, shadows | `src/styles/tokens.css` | any component/feature CSS |
| Shell height (61/56), topbar padding/nav, content cap for non-board routes, full-bleed exception | `src/app/AppShell.css` | `styles/responsive.css`, feature CSS |
| Board frame: band/line, rail, stage, phone bar, compact line, Add placement, panel anchors, sheet corridor, board geometry constants | `src/features/case/CaseBoardPage.css` | `styles/responsive.css`, `BoardCanvas.css` |
| In-stage chrome: canvas host, view cluster, minimap, renderer fallbacks | `src/board/BoardCanvas.css` | `CaseBoardPage.css` |
| Non-modal panel base surface/header/scroll/focus | `src/components/Panel.css` (new) | feature CSS |
| Modal dialog base surface/header/actions | `src/components/components.css` (`Dialog`) | feature CSS |
| Search content | `src/features/search/SearchPanel.css` | page files |
| Closure content | `src/features/closure/closure.css` | page files |
| Connection detail/legend content | `src/features/connections/connections.css` | page files |
| Hint popover content | `src/features/onboarding/hints.css` | page files |
| Other-route responsive rules | `src/styles/responsive.css` | — |

`CaseBoardPage.css` may consume `--shell-height` defined by `AppShell.css`, but must not redefine
it. `BoardCanvas.css` must not own stage width/height; it fills the stage. Feature content CSS must
not position panels; the page owns anchors and widths.

### 9.2 What `responsive.css` loses

- All `.case-board-page__stage` min-height clamps, including the ≤ 47.99 rem and 600–1199 px
  overrides.
- The `.case-board-page__workspace` grid-area overrides (the workspace is deleted).
- The `.app-frame__content` `max-inline-size` override at ≥ 75 rem. The cap moves into
  `AppShell.css`, which owns it for non-board routes. The board route sets the full-bleed
  exception.
- The `.case-board-page__sheet-trigger`/`__header` phone rules for the deleted header.
- It keeps global `max-inline-size: 100%`, `min-inline-size: 0`, safe-area rules, and other-route
  adjustments.

**Current values removed (do not carry forward):**

| File | Selector / query | Current value |
|---|---|---|
| `CaseBoardPage.css` | `.case-board-page__stage` | `min-block-size: clamp(24rem, calc(100dvh - 21rem), 52rem)` |
| `CaseBoardPage.css` | `@media (max-width: 40rem)` `.case-board-page__stage` | `min-block-size: clamp(22rem, calc(100dvh - 18rem), 44rem)` |
| `responsive.css` | `@media (max-width: 37.4375rem)` `.case-board-page__stage` | `min-block-size: clamp(20rem, calc(100dvh - 20rem), 40rem)` |
| `responsive.css` | `@media (min-width: 37.5rem) and (max-width: 74.9375rem)` `.case-board-page__stage` | `min-block-size: clamp(24rem, calc(100dvh - 18rem), 48rem)` |
| `responsive.css` | `@media (min-width: 75rem)` `.app-frame__content` | `max-inline-size: 80rem` (overrides the 72 rem in `AppShell.css`) |
| `responsive.css` | phone/tablet `.app-frame__content` padding | inline padding on the board route; the board route must own its own insets |
| `CaseBoardPage.css` | `.case-board-page__workspace` | `grid-template-areas` / `grid-template-columns` for closure/detail; deleted |

### 9.3 Constants (owned by `CaseBoardPage.css` unless noted)

| Constant | Value |
|---|---|
| `--shell-height` | 61 px wide / 56 px phone (owned by `AppShell.css`) |
| `--band-height` | 48 px wide / 44 px phone |
| `--band-gap` | 8 px wide / 4 px phone |
| `--rail-width` | 56 px |
| `--rail-slot` / gap / padding | 44 px / 8 px / 6 px |
| `--phone-bar-height` | 56 px + safe-area bottom |
| `--stage-inset` | 12 px (8 px phone) |
| `--detail-width` | 320 px |
| `--search-width` / `--menu-width` / `--closure-width` | 380 / 300 / 370 px |
| `--sheet-corridor` | 176 px |
| `--toast-max` / `--hint-max` | 32 rem / 27 rem |
| `--attention-dot` | 8 px + 2 px ring |

These are layout constants, not palette values. They may live as custom properties in the owning
file; they may not be duplicated in another file. Any change re-runs the gate.

### 9.4 Breakpoints and z-index

- Breakpoints stay `< 600`, `600–1199`, `≥ 1200` (`useLayoutMode` and CSS media queries align).
- `phone < 600`: bar composition. `tablet/desktop ≥ 600`: rail + band composition. No height-based
  mode. Landscape phone 844×390 is tablet by width; its stage is 273 px and the rail fits.
- Z-index: board chrome below panels; panels below scrim/sheets; sheets below toasts; skip link
  above all. Use `--z-panel`, `--z-dialog`, `--z-toast`, `--z-skip-link`.

---

## 10. Text zoom, no-cap, and accessibility

### 10.1 Text zoom

- The gate is measured at **100 % text**, default browser zoom.
- At **200 % text**, the shell/band/bar are `min-height` and grow; the stage shrinks. A vertical
  page scroll is allowed at 200 % text (the zero-page-scroll gate is a 100 % gate), but there is no
  horizontal scroll, no clipped text, and no overlapping controls. The stage keeps a 240 px minimum;
  panels scroll internally.
- Verify by setting `html { font-size: 200% }` (or browser text-only zoom) at 390×844, 1280×800,
  and 1440×900; screenshot the band, rail/bar, and an open panel; assert
  `scrollWidth <= innerWidth` and every control's box is visible and non-overlapping.
- The title truncates; the readiness chip/line stays whole; the band may wrap the chip to a second
  line only at 200 % if needed, never clip it.

### 10.2 No width cap

- The board route has `max-inline-size: none` and no inline padding above 600. The stage grows with
  the viewport; the band/rail keep their insets.
- No screen may horizontally scroll at 390, 768, 1280, 1440, or wider. Long titles/tags wrap or
  truncate; imported text stays text (no `dangerouslySetInnerHTML`).
- The non-board routes keep the existing 72/80 rem cap, owned by `AppShell.css`.

### 10.3 Accessibility contract

- WCAG 2.2 AA: 4.5:1 body/control text, 3:1 large headings and non-text affordances, 44×44 targets,
  visible focus, semantic landmarks, no keyboard traps.
- Safe-area insets on the shell, phone bar, and sheets. The 85 % phone gate is measured at
  390×844 with zero insets; on a notched device the bar grows and the stage shrinks, still without
  page scroll. Verify a simulated 34 px bottom inset separately.
- Reduced motion: no pin drop, string draw, auto-pan, panel entrance, or pulsing; final states and
  focus changes remain.
- Every icon-only control has a name; every surface has a labelled heading; errors and counts are
  announced; toasts are polite; the canvas has a title and description and points to the card list.
- Focus order as §7.5. The canvas is not a tab stop. The hidden `Case board` h2 is the programmatic
  landing target.
- Overlay text is readable over cork: the scrim/surface tokens and contrast tests cover the cluster,
  toast, hint, and panels.

---

## 11. Migration notes

### 11.1 Files to change

| File | Change |
|---|---|
| `src/app/AppShell.tsx/.css` | Route-aware full-bleed for the board; shell height/status chip; remove the old full-width status notices; own the content cap for other routes. |
| `src/features/case/CaseBoardPage.tsx/.css` | Delete the page header, search panel, backup card, scale banner, closure column, and workspace grid. Add band/rail/phone bar/stage frame, Add, attention dot, surface orchestration, panel anchors, sheet corridor. Lift search criteria. Keep the readiness/lifecycle logic. |
| `src/board/BoardCanvas.tsx/.css` | Fill the stage; keep view cluster/minimap; remove the in-canvas Add and Open card list links; update the canvas description to the new controls; no stage sizing. |
| `src/components/Glyph.tsx` (new) | Six-glyph module. |
| `src/components/Panel.tsx` + `Panel.css` (new) | Non-modal wide panel primitive. |
| `src/components/IconButton.tsx` usage | Quiet rail variant, 44 px, labels; no `title` duplication. |
| `src/styles/responsive.css` | Remove board-route stage/workspace/content-cap overrides; keep global resets and other routes. |
| `src/features/search/SearchPanel.tsx/.css` | Controlled/committed criteria; popover and sheet variants; filter state survives close/reopen. |
| `src/features/closure/ClosurePanel.tsx/.css` | Render inside the Panel/sheet; remove the permanent right column; keep content and confirmation. |
| `src/features/connections/ConnectionDetail.tsx` | Render inside the Panel/sheet; remove the grid column; keep the confirmation/undo. |
| `src/features/connections/ConnectionLegend.tsx` | Rename to `Thread types`; use as an inline disclosure inside the Case menu. |
| `src/features/case/ScaleWarning.tsx` | Split the copy/level into the Case capacity menu section; remove the in-flow aside. |
| `src/features/backup/useBackupReminder.ts` | Keep; the page adds the session toast and menu section; remove the full card. |
| `src/features/onboarding/HintPopover.tsx/.css` | Board placement variant above the bar/cluster; suppression while a surface is open. |
| `src/app/OfflineNotice.tsx`, `UpdatePrompt.tsx`, `BrowserNotice.tsx` | Render inside the System status dialog; add the shell live region/chip. |
| `src/app/KeyboardShortcuts.tsx` / `ShortcutList` | Add the Board gestures section; keep `?` and the existing shortcuts. |
| `src/app/useLayoutMode.ts` | No breakpoint change; keep `< 600 / 600–1199 / ≥ 1200`. |
| `src/styles/tokens.css` | Add `--z-panel` (and any shared layer token) only; palette stays locked. |

### 11.2 Documented requirements to amend

| Document / section | Amendment |
|---|---|
| `docs/features/case-board.md` `BOARD-FR-01` and §4 UI paragraph | Replace the in-flow board description with the band/rail/stage/full-bleed composition, the quiet rail, the phone bar, the floating cluster/Add/minimap, and the zero-page-scroll gate. Keep the pointer-only canvas and lazy chunk. |
| `docs/features/case-board.md` `BOARD-FR-03` | Replace with the §11.4 wording: 200 px screen-space margin, 130/110 fit counts, fit-as-overview. |
| `docs/features/case-board.md` `BOARD-FR-06` | Replace the “reset that fits all cards” sentence: Reset returns to 100 % at the world origin; Fit is the separate fit-to-cards control; neither overwrites the stored viewport until the student moves the board. |
| `docs/features/case-board.md` `BOARD-FR-07` | Replace with the §11.4 wording: measure 60/45 fps at the 0.25 floor (130 desktop / 120 tablet), one display texture per rendered card, ≤ 200 resident, strings in two batches. |
| `docs/features/case-board.md` `BOARD-FR-04` and §4 | Keep the levels; move the UI to the Case menu attention section/dot, remove the in-flow banner. |
| `docs/features/case-board.md` new `BOARD-FR-09` | Add the board dominance/zero-scroll gate (§11.4). |
| `docs/features/responsive-and-accessibility-hardening.md` `A11Y-FR-03` | Name the three canonical viewports and the full-bleed/zero-page-scroll board route; safe-area insets; phone sheets; no horizontal scroll. |
| `docs/features/search-tags-and-filters.md` §4 and `SEARCH-FR-04` | Search is a rail/bar icon opening a popover/sheet; filters live inside it; criteria survive close/reopen; selection closes the surface and centers the card. |
| `docs/features/case-closure.md` §4 | The closure panel is the readiness chip/Closure icon surface, not a permanent right column; wide is persistent non-modal, phone is a modal sheet. |
| `docs/features/connections-and-provenance.md` §4 | The legend is `Thread types` inside the Case menu; detail is a non-modal trailing panel on wide and a sheet on phone; no persistent detail icon. |
| `docs/features/first-run-demo-and-hints.md` §4 | Hints sit above the bar/cluster; the summary teaching copy moves to empty state + Board gestures help; no tour. |
| `docs/features/backup-and-restore.md` §4 | The reminder is the Case menu First backup section + attention dot + one-time toast, not a banner; same 5-card/1-connection cadence and permanent Not now. |
| `docs/features/app-foundation.md` §4 | The shell may carry the conditional System status chip; the full-width status strip is removed. |
| `docs/features/responsive-and-accessibility-hardening.md` `A11Y-FR-01/06/08` | Add the new tab order, the non-modal Panel contract, the canvas-to-card-list path, and the System status dialog to the existing a11y/browser-notice wording. |

### 11.3 Tests and e2e suites to update

**Renamed selectors (39 references across the repo at the time of writing):**

- `Search and filters` → `Search` (trigger); the surface stays `Search this case`.
- `Case actions` → `Case menu`.
- `Connection legend` → `Thread types`.
- `Back to case shelf` → `Case shelf` (menu item); the route/link text updates.

**Suites:**

- `e2e/a11y.spec.ts` — rename triggers/sheets; open the new wide panels; scan the panel and the
  System status dialog; assert Tab leaves a wide panel and stays trapped in a phone sheet.
- `e2e/responsive.spec.ts` — replace the old header/sheet-trigger flows with the rail/bar inventory;
  add the gate assertions, stage-width invariance with each panel open, the sheet corridor, and the
  empty/200-card states.
- `e2e/keyboard-journey.spec.ts` — `Case menu`; tab order; Escape/outside click; focus return;
  search result → board heading; Show on board.
- `e2e/closure.spec.ts` — readiness chip/Closure icon; persistent wide panel; phone sheet; Show on
  board focus; `Case shelf` link.
- `e2e/demo.spec.ts` — `Case shelf`; empty/ready frame; demo case still opens.
- `e2e/board.spec.ts` / `board-drag.spec.ts` — remove the in-canvas Add/card-list link expectations;
  assert the stage still fills and the cluster/minimap work.
- `e2e/search.spec.ts` — Search trigger/panel; criteria persistence; filter-active name.
- `e2e/backup.spec.ts` — First backup section/dot/toast; Not now writes; success clears; dialog.
- `e2e/performance.spec.ts` — add the 0.25-floor pass at **1 384×783** / **1 224×683** (130/120
  rendered; strings in two batches); do not rely on the 0.75 seed. Keep the existing 768×1024
  regression in the viewport matrix even though the gate uses the three canonical viewports.
- `tests/a11y/responsive.test.tsx`, `tests/connections/ConnectionLegend.test.tsx`,
  `tests/connections/ConnectionDetail.test.tsx`, `tests/case/ScaleWarning.test.tsx`,
  `tests/search/SearchPanel.test.tsx`, `tests/onboarding/HintPopover.test.tsx`,
  `tests/backup/useBackupReminder.test.tsx`, `tests/app/routing.test.tsx` — names, new sections,
  controlled search, panel placement, attention dot.
- New tests: `Panel` contract (no trap/inert/scroll lock; Escape; outside click; focus return),
  `Glyph` union, the gate spec, the System status chip/dialog, the Case menu attention sections.

### 11.4 Exact requirement text for the feature docs

**`BOARD-FR-03` replacement:**

> Provide fit-to-view, a minimap showing the viewport and cards, viewport culling, thumbnail-first
> textures, and on-demand loading so a 150-card case remains navigable. Cull the visible world
> rectangle plus a constant 200 px screen-space margin at every stage size; the margin is divided by
> the zoom and never scales with the viewport. At the 0.25 fit floor a 150-card case renders 130
> cards at 1 384×783 (90 of them on screen) and 110 at 1 224×683. Fit-to-view is clamped to the 0.25
> floor, so when the fitted scale would fall below 0.25 it is an overview, not a whole-case fit: a
> 125-card case renders 125 cards at 1 384×783 and 110 at 1 224×683, and a 150-card case 130 and 110.

**`BOARD-FR-07` replacement:**

> Target 60 frames per second during pan and zoom at 150 cards, treat 45 frames per second as the
> floor on the target tablet, and release textures for cards that stay offscreen. Measure both
> floors against the worst rendered frame at the 0.25 zoom floor — 130 cards at 1 384×783 and 120 at
> 1 224×683 — not only at a detail zoom. Keep at most one display texture per rendered card and at
> most 200 resident textures across rendered and recently offscreen cards; association and
> provenance strings draw in at most two batches regardless of how many are visible.

**New `BOARD-FR-09`:**

> Fill the board route with the canvas: at 100 % text the stage is at least 75 % of the content area
> at 1280×800 and 1440×900 and at least 85 % at 390×844. At 100 % text the page does not scroll
> vertically or horizontally, and opening Search, the case menu, closure, or connection detail does
> not change the stage width. No interruption or status surface may add page height above or below
> the stage.

**`BOARD-FR-06` correction:**

> Persist the last viewport per case, restore it on return, and expose `Reset view` (100 % at the
> world origin) and `Fit all cards` (fit-to-cards) without overwriting the stored viewport until the
> student moves the board again.

**`BOARD-FR-01` / §4 UI paragraph:** replace the old “board fills the content region below the top
bar / bottom-left cluster / phone single trigger” sentence with the composition in §2, the quiet
rail, the phone bar, the floating cluster/Add/minimap, and the no-cap/zero-scroll rule.

**`A11Y-FR-03` addition:** name 390×844, 1280×800 and 1440×900 as the gate viewports; the board route
is full-bleed with no page scroll; phone panels are sheets; safe-area insets apply; no page-level
horizontal scroll.

### 11.5 Suggested order of work

1. **Frame + ownership.** Introduce the route-aware full-bleed, `CaseBoardPage` frame, band/rail/
   phone bar, and remove the `responsive.css` board overrides. Remove the in-flow header, search,
   closure column, backup card, and scale banner; keep the canvas inside the new stage and run the
   gate with the stage empty/filled. The surfaces return in step 2.
2. **Surfaces.** Add `Panel`, move Search/Closure/Detail/menu/legend into the new surface types,
   delete the in-flow panels, implement phone sheets, focus/tab rules, simultaneous surfaces.
3. **Interruptions.** Move capacity/backup into the Case menu attention sections and dot, add the
   top toast/hint layers, remove the banners, add the System status chip/dialog.
4. **Names + glyphs.** Add `Glyph`, quiet rail, exact names; update every test/e2e selector.
5. **Docs + budget.** Amend the feature docs/FRs and add the 0.25-floor performance pass.
6. **Evidence.** Run the gate, axe, keyboard, text-zoom, reduced-motion, performance, and screenshot
   matrix; the gate check is the acceptance step.

Do not start step 2 before the stage fill is stable; do not start step 4 before the surface DOM
placement is final (the tab order depends on it).

---

## 12. Explicit non-goals

- Implementing this spec or updating the e2e/component tests in this effort; the map is spec-only.
- Icon/menu treatment for Recall, card detail, card list, and the case shelf beyond the names above;
  they adopt the pattern in a later effort.
- Board interaction physics: pan, zoom, drag, strings, recall scratch rendering.
- Any new gameplay or feature surface; this effort only re-homes what already exists.
- New dependencies, icon libraries, icon fonts, CSS masks, or a light theme.
- Changing the 44 px target, the breakpoints, the domain readiness/capacity logic, card size, or the
  0.25–2.5 zoom range.
- Reworking the shelf, capture, card detail, recall, or settings routes beyond the shell status chip
  and the names that move with the board.

---

## 13. Risks to watch

1. **Phone gate margin.** 86.8 % leaves 1.8 points; any added chrome breaks 85 %. Treat the phone
   bar as 56 px + safe area and the 44 px line as a floor, not an invitation to grow.
2. **Safe-area insets.** The 85 % target is measured at 390×844 with zero insets. A notched device
   grows the bar; verify no scroll and no control clipping, but do not re-interpret the gate as a
   notched-device measurement.
3. **200 % text.** The vertical page may scroll at 200 %; the stage keeps 240 px; no horizontal
   scroll, clipping, or overlap. The zero-scroll gate stays a 100 % gate.
4. **Panel primitive.** It is new; its no-trap/no-inert/no-scroll-lock contract and focus return
   need dedicated tests. Do not “simplify” it by reusing `Dialog`.
5. **Search state.** Lifting criteria out of `SearchPanel` changes its API and tests; keep the
   controlled/committed distinction explicit so closing/reopening is stable.
6. **Selector churn.** Four renames touch ~39 references; do them in one pass with the docs and
   tests so the suites do not drift.
7. **Texture transient.** 200 is a display-derivative budget; thumbnails are transient. Do not count
   both alive at once or silently raise the ceiling.
8. **Fit wording.** 150 cards cannot fit at 0.25; the requirement must say “overview”, or the
   performance gate moves to 150 rendered cards.
9. **Topbar amendment.** The System status chip is the one change above 600 to 02's “untouched”
   topbar; keep the nav and height stable.

---

## 14. Provenance

| Decision area | Source |
|---|---|
| Measured before-table, defects, CSS overrides | 01 |
| Wide frame, stage budget, no-cap, band/rail | 02 |
| Inventory, names, glyphs, rail fit, minimap default | 03 |
| Prototype reactions: quiet rail, detail/Add, modal sheets, density, menu anchor | 04 |
| Interruption table, backup existence/cadence, toasts, hints, shell status | 05 |
| Surface types, `Panel` contract, simultaneous surfaces, triggers, tab order | 06 |
| Gate, composition, placement, migration | map Notes + 01/02 |
| Cull margin, textures, fit-floor, FR wording | 08 |
| Visual reference | `prototype/index.html`, `evidence/screenshots/04-*` |

---

## 15. Reference evidence

- Prototype: [prototype/index.html](prototype/index.html)
- Required viewports: [phone 390×844](evidence/screenshots/04-phone-390x844.png),
  [tablet 1280×800](evidence/screenshots/04-tablet-1280x800.png),
  [desktop 1440×900](evidence/screenshots/04-desktop-1440x900.png)
- Open states: [Search](evidence/screenshots/04-desktop-search.png),
  [Case menu + Thread types](evidence/screenshots/04-desktop-menu-thread-types.png),
  [Closure](evidence/screenshots/04-desktop-closure.png),
  [Detail](evidence/screenshots/04-desktop-detail.png),
  [Minimap](evidence/screenshots/04-desktop-minimap.png),
  [phone menu sheet](evidence/screenshots/04-phone-menu-sheet.png),
  [phone closure sheet](evidence/screenshots/04-phone-closure-sheet.png)
- Variants: [boxed rail (rejected)](evidence/screenshots/04-desktop-rail-boxed.png),
  [readiness without dot](evidence/screenshots/04-desktop-readiness-no-dot.png)
- Canvas research: [08-canvas-headroom.md](research/08-canvas-headroom.md)

The floating prototype toolbar is deliberately not part of the design; the toolbar and the
prototype are throwaway. Only the screenshots and the decisions above are inputs to implementation.
