# 04 — Three-viewport prototype

Type: prototype
Status: open
Blocked by: 02, 03

## Question

What does the composed frame actually look and feel like — does it hold up when you can see it?

Grey-area decisions (icon prominence, float vs rail, how much cork is visible, whether the
readiness signal reads without a label, whether a floating cluster hides cards) are cheap to
argue about in prose and obvious in front of you. Build a **throwaway** prototype to react to
before the spec freezes.

Shape:

- One static page, importable from a scratch folder — **not** wired into `src/`, no store, no
  Dexie, no Pixi board. Fake cork background, ~10 fake cards, 2 fake strings.
- Uses the real `src/styles/tokens.css` values and the Cozy storybook palette, so contrast and
  spacing judgements transfer.
- Renders the agreed composition for all three modes at 390×844, 1280×800 and 1440×900 (CSS
  media queries are fine; a row of three fixed-size frames is also fine if that is clearer).
- Includes one open state per menu/surface type from the inventory, so "menus behind icons" is
  visible rather than imagined.
- Real 44 px targets and focus rings — the point is to judge reachability, not just aesthetics.

Deliver: the prototype path plus three screenshots, linked from this ticket. It is a sketch: no
tests, no accessibility audit, delete it when the spec is written.

Then react to it — record what changes and why, because those reactions are the spec's
evidence.

## Answer

<!-- resolution: append prototype path, screenshots, and the reactions that changed the design -->
