# 02 — Tablet and desktop composition

Type: grilling
Status: open
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

<!-- resolution: append the agreed composition per mode -->
