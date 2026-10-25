# Recall scratch layer

Use this reference when implementing or reviewing recall mode.

## Mode rules

Entering recall hides every connection string while keeping card images, titles, positions, and viewport visible. Fit the case to view in memory. The truth graph stays hidden until Check.

Scratch connections live in an in-memory store only: add, remove, clear, reset. Never call `ConnectionRepository`, Dexie, `localStorage`, or the archive exporter from recall. Exit, reload, route change, and browser back discard everything. The in-app Exit action may confirm when scratch is non-empty; browser navigation discards silently without a blocking dialog.

## Scratch rendering

Reuse the thread-anchor gesture, but render neutral gray strings with no truth styling. Allow individual removal. Respect reduced motion: strings appear immediately with no draw animation.

## Check

Canonicalize each scratch pair the same way as truth. Compare undirected pairs:

- Exact pair with matching type: `remembered`.
- Truth pair with no scratch match: `missed`.
- Scratch pair with no truth match: `extra`.
- Pair with matching endpoints but different type: appears in `remembered` and `typeMismatch` with an explanatory label such as `Association drawn / Provenance actual`.

Results are arrays of pair descriptors with stable ordering, never a score, percentage, grade, streak, or rank.

## Overlay and summary

Overlay markers on the board: check for remembered, dashed outline for missed, muted cross for extra, and a type label for mismatch. Keep the board pannable and zoomable.

Render a normal keyboard-readable summary list grouped by remembered, missed, extra, and type-mismatched pairs with card titles and counts. Announce it with `aria-live` and keep it usable without canvas interaction. The toolbar keeps Check, Reset scratch, and Exit available after results appear.

## Reset and exit

`Reset scratch` clears pairs and results but stays in recall. `Exit recall` returns to the case and discards scratch. A second Check recomputes from the current scratch. Never persist results or history.

## Verification

- A write spy fails the test if any repository or IndexedDB method is called during enter, draw, check, reset, or exit.
- Reversed pair counts as remembered.
- Wrong type is remembered and separately flagged.
- Empty scratch yields empty results without throwing.
- Exit leaves the stored case graph and viewport unchanged.
- Reduced motion removes overlay animation.
