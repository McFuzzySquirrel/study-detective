# 02 — Tablet and desktop composition

Type: grilling
Status: resolved
Blocked by: —

## Question

Above 600 px, what is the frame around the board?

Phone is settled (bottom icon bar, compact title/readiness line, full-bleed board). Tablet
(600–1199) and desktop (≥ 1200) are not, and they carry the harder trade-offs:

1. **Where do the icons live?** A single translucent cluster on the board (as
   `case-board.md` §4 already describes for zoom/fit/minimap), a vertical icon rail on one
   edge, a slim icon strip under the shell topbar, or a hybrid (rail on desktop, cluster on
   tablet)?
2. **Full-bleed or centred?** `.app-frame__content` currently caps content at `72rem`
   (1152 px), so a 1440 px desktop shows a 1152 px app with margins. Does the board route
   escape that cap and run edge to edge, or keep a centred, deliberate "case file on a desk"
   gutter?
3. **Where do title and readiness sit?** Both are permanently visible (agreed). One line above
   the board? A floating label over the canvas? Integrated into the same strip as the icons?
4. **Does `ClosurePanel` survive as a permanent column?** Today it is a 15–19 rem column at
   ≥ 64 rem, which directly contradicts the gate. Options: delete the column and put readiness
   detail behind the readiness signal; a collapsible drawer; or keep the column only at ≥ some
   wider threshold.
5. **Portrait tablet** (e.g. 834×1194) — treated as the phone pattern stretched, or its own
   shape?

Answer with a concrete composition per mode, sketched in words precisely enough that a
prototype can be built from it: what is pinned where, what floats over canvas, what is left of
the stage once chrome is subtracted, and how the three modes relate to one another (one frame
that reflows, or three deliberate frames).

Constraints to hold: 44 px targets, visible focus, 4.5:1 contrast for floating chrome over the
cork, no new dependencies, and the gate from the map (≥ 75 % / ≥ 85 %, zero page scroll).

## Answer

**Resolved.** The wide frame is one composition: a 48 px identity band, a 56 px leading
icon rail, and a full-bleed stage that never reflows under selection. The permanent closure
column is deleted. The shell topbar is untouched above 600 px. Tablet and desktop resolve to
the same frame; portrait tablet does too. No height-specific exception.

### Composition

**Pinned outside the canvas** (subtracts from the stage):

1. **Shell topbar** — 61 px, unchanged (shared with every route).
2. **Identity band** — 48 px, full width, `var(--space-inline)` inline padding (16–40 px,
   matching the shell), 1 px bottom border. Leading: case title, one line, ellipsis, full title in the accessible name.
   Trailing: readiness chip — a 44 px target showing state plus loose-thread count (“8 loose
   threads”, “Ready to close”) that opens the closure surface. The focusable `Case board` h2
   stays visually hidden; the band is not a second heading.
3. **Rail** — 56 px wide on the leading edge, full height of the stage row. Icon-only slots
   (inventory in 03), 44 px targets, 6 px padding, 8 px gap. The phone bottom bar is the same
   component along the other axis.

**Floating over the canvas** (subtracts nothing):

- View cluster (zoom out, percentage, zoom in, fit, reset, minimap toggle) bottom-leading,
  inset 12 px.
- `Add evidence` bottom-trailing, the only filled primary control, inset 12 px.
- Minimap top-trailing, collapsible (default state → 03).
- Thread detail: a 320 px solid panel on the trailing edge when a string is selected; the stage
  keeps its width and pans beneath it (surface mechanics → 06).
- Toasts, hints, warnings → 05.

**Nothing sits below the stage.** The page is exactly the content height: band + stage =
`100dvh − shell`. The stage is `1fr` in a height-constrained grid, not a `clamp()` min-height.
All scrolling happens inside overlays.

```
┌ Notes Detective                         Case shelf  Settings ┐  61
├ Budget fixture: 12 cards                  [ 8 loose threads ]┤  48
│ ┌──┐ ┌────────────────────────────────────────────────────┐ │
│ │⌕ │ │                                                    │ │
│ │▤ │ │                    cork / cards                    │ │
│ │☰ │ │                                                    │ │
│ └──┘ │ [− 75 % + Fit Reset ▣]        [+ Add evidence]     │ │
│  56  └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Budget

Shell is 61 px above 600 px (ticket 01). Band 48 + 8 gap = 56. Stage = content height − 56.

| Mode / viewport | Content h | Stage h | Board share | Stage w | Change in width |
|---|---|---|---|---|---|
| Desktop 1440×900 | 839 | 783 | **93.3 %** | 1 384 | 884 → +56.6 % |
| Tablet landscape 1280×800 | 739 | 683 | **92.4 %** | 1 224 | 884 → +38.5 % |
| Portrait tablet 834×1194 | 1 133 | 1 077 | **95.1 %** | 778 | — |
| Short laptop 1280×600 | 539 | 483 | **89.6 %** | 1 224 | — |
| Landscape phone 844×390 | 329 | 273 | **83.0 %** | 788 | — |

Gate: ≥ 75 % at 1280×800 and 1440×900. Both clear with 17–18 points to spare. Phone keeps its
settled 85 % gate; this ticket does not restate it.

### What moved

| Surface | Today | After | Owner |
|---|---|---|---|
| Page header (eyebrow / title / summary / links) | 126.6 px in flow | 48 px band | 02 |
| Search panel | 250 px in flow | rail slot + overlay | 03 / 06 |
| Connection legend | 110 px in flow | inside a menu | 03 |
| Closure column | 304 px wide, 1 772–18 073 px tall | readiness chip + closure surface | 03 / 06 |
| Thread detail | 320 px grid column | floating trailing panel | 06 |
| Board controls | page flow, off-screen | bottom-leading inside stage | 02 / 03 |
| `Add evidence` | page flow, off-screen | bottom-trailing inside stage | 02 |
| Scale warning | 96.4 px banner | → 05 | 05 |
| Backup reminder | full card | → 05 | 05 |
| Inline case actions | header links | rail Actions menu | 03 |
| Document height | 2 448 px at 12 cards, 18 861 at 150 | exactly one viewport | 02 / 07 |

### Invariants the spec must hold

1. **Stage width is invariant.** Selecting a string, opening search, opening closure, or opening
   a menu never resizes the stage. No grid column is added beside it.
2. **Stage height = content height − 56 px.** No min-height clamp, no below-stage siblings.
3. **Zero page scroll.** The route’s main element is height-constrained; overlays are the only
   scroll containers.
4. **Full-bleed, no width cap.** The board route drops the 72 rem / 80 rem content cap and its
   horizontal padding; the stage runs edge to edge. Band and rail keep safe-area insets; the
   band’s `var(--space-inline)` padding aligns the case title with the shell title.
5. **Band never wraps.** Title truncates, chip stays whole. Band is `min-height: 48px`, so text
   zoom can grow it without clipping; the gate is measured at 100 % text.
6. **Rail fits the shortest stage.** At 844×390 the stage is 273 px; the inventory either fits
   in 273 px or defines an overflow strategy (03).
7. **Floating chrome clears 4.5:1 over cork**; 44 px targets and visible focus everywhere.
8. **Three modes, two compositions.** Phone is the settled bottom-bar composition; tablet and
   desktop are the same rail + band composition, differing only in width. Portrait tablet is
   tablet, not stretched phone. No height-based fourth mode.

### Handed to other tickets

- **03** — rail slot count and order, names, readiness-chip wording, authoring home for glyphs,
  rail fit, minimap default state.
- **05** — `ScaleWarning`, backup reminder, toasts, hints, shell notices.
- **06** — closure / search / actions / detail surface types, focus return, simultaneous surfaces.
- **07** — CSS ownership, migration, feature-doc reconciliation, text-zoom rule, no-cap statement.
- **08** — canvas headroom at the larger stage.
