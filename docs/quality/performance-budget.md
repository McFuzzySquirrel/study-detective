# Performance Budget

**Owner:** QA engineer (A11Y-5)
**Requirements:** A11Y-FR-07, VIS-FR-04, VIS-CON-08
**Last updated:** 2026-10-26

This document states the performance budgets, how each one is measured, and which
gates are automated versus deferred to a person. The automated checks are
regression floors; they are not a claim that the product meets the 45 FPS tablet
target.

## Budgets

| Measure | Budget | Gate | Owner |
|---|---|---|---|
| Board pan and zoom at 150 cards, target tablet | **45 FPS or better** | **Human tablet review (deferred)** | Human reviewer / REL-HR-1 |
| Board pan and zoom at 150 cards, headless CI | **30 FPS average or better** | Automated: `e2e/performance.spec.ts` | QA |
| p95 frame time during the CI pan | **66.7 ms or less** | Automated: `e2e/performance.spec.ts` | QA |
| Initial application JavaScript | **300 KiB gzip or less** (307,200 bytes) | Automated: `node scripts/perf-budget.mjs` | QA |
| Cold load, 20 Mbps tablet profile | **3 seconds or less** to an interactive shelf | **Human/field measurement (deferred)** | Human reviewer / REL-HR-1 |

### What "initial JavaScript" means

The budget covers the Vite **entry chunk plus every chunk it statically imports**
(the runtime, React, the router, and other eager code). It is measured from the
Vite manifest after `npm run build`.

Lazy route, board, and OCR chunks are **not** part of the initial graph:

- `src/board/BoardCanvas.tsx` is loaded with `React.lazy()` from the board and
  recall routes.
- OCR loads `tesseract.js` with a dynamic `import()` inside the worker.
- The case board, capture, card detail, recall, settings, and other routes are
  lazy route chunks.

`scripts/perf-budget.mjs` follows only the manifest's static `imports` field and
ignores `dynamicImports`. It reports the lazy board/OCR chunks it found
separately, with their gzip sizes, so the exclusion is visible rather than
implicit. If a future change makes a board or OCR chunk eager, it enters the
static closure and is counted like any other initial chunk.

CSS is not part of the JavaScript budget. The service-worker precache budget is
owned by the PWA/release work and is deliberately **not** checked here.

## Measurement method

### Board frame rate (`e2e/performance.spec.ts`)

1. The helper creates a case through the real shelf form, then inserts **150
   card rows** through the app's own IndexedDB `cards` store and `caseId` index.
   The case is reopened through the normal repository path; no React state or
   renderer object is stubbed.
2. The fixture is a deterministic 10-column grid with 320 x 400 world pitch and
   the fixed 240 x 320 card geometry. Its saved camera starts at **75% scale**,
   a detail camera that shows 8 of the 150 cards on the tablet/desktop projects
   and 4 on the phone. The other cards still exist as sprites and are still
   culled on every camera change; the automated floor is not measured at a dense
   zoomed-out overview. The 45 FPS human tablet review covers that overview.
3. The spec waits until `data-board-scene-status="ready"`, the board reports
   `data-board-card-count="150"`, and the visible-card count is greater than zero
   and less than 150. That is the "interactive" gate. It also checks the
   VIS-FR-04 threshold: a persistent warning at 150 cards and a still-available
   Add evidence action, not a hard cap.
4. A five-second scripted interaction dispatches real `PointerEvent`s (pan) and
   `WheelEvent`s (zoom, alternating out and in) at the board host. The driver
   uses DOM events, not the board store, so input handling, culling, the camera,
   and the Pixi render path all stay on the production path.
5. A `requestAnimationFrame` loop records each frame timestamp while the
   interaction runs. Inter-frame intervals are the measurement:
   - **Average FPS** = `1000 / mean(inter-frame interval)`.
   - **p95 frame time** = the nearest-rank 95th percentile of the sorted
     intervals, in milliseconds.
6. The spec fails if the board does not become interactive, the scripted
   duration is under five seconds, average FPS is below 30, p95 exceeds 66.7 ms,
   the camera or scale did not change, culling never reduced the visible count,
   the 150-card warning is absent, or a console error occurs.
7. Every project attaches `performance-<project>.json` with the measured values,
   viewport, browser, fixture shape, thresholds, and the explicit tablet-target
   deferral. The fixture contains no user content, OCR text, or image bytes, so
   the evidence is safe to keep as a CI artifact.

The 66.7 ms p95 ceiling is the tail guard paired with the 30 FPS average floor:
it allows at most 5% of frames to be slower than 15 FPS, so an occasional
scheduler or GC frame does not fail the gate while sustained jank does. It is
not a tablet-feel claim.

The Playwright config uses **one worker**. Measuring frame cadence while two
other software-WebGL boards render in parallel measures host CPU contention, not
the board. CI already used one worker; running locally the same way makes the
recorded numbers comparable.

The spec runs in the configured Chromium desktop (1440x900), tablet-landscape
(1280x800), and phone (390x844) projects. It sets `retries: 0` so a transient
frame-floor failure cannot be hidden by a retry.

### Why the 45 FPS target is not an automated gate

Playwright CI renders headless Chromium with software WebGL (SwiftShader) on a
shared runner. That is not the target tablet, and its frame cadence depends on
the host CPU, GPU availability, and scheduler load. Treating a CI number as the
45 FPS result would be a false claim.

**The 45 FPS target is explicitly deferred to the final human tablet review.**
The reviewer must:

1. Load a 150-card case on the target tablet in the deployed build.
2. Pan continuously for at least five seconds and zoom in and out, including
   zooming out far enough to bring many cards into view.
3. Record average FPS and p95 frame time (the development-only frame summary or
   a browser performance trace may be used) and state the device, browser, and
   build.
4. Pass the gate only at **45 FPS or better** with no visible stalls. The CI
   floor is not a substitute.

The human review also owns the visual feel, texture-loading appearance, and any
noticed jank; automated numbers cannot approve those.

### Cold load (deferred)

Cold load is defined as navigation start to an interactive case shelf on the
deployed build, with an empty HTTP cache, a **20 Mbps** down / representative
uplink profile, and the service worker either installing on first load or
already controlling the page on repeat load. The budget is **3 seconds or
less**.

This is not automated in the Playwright suite because the local preview server,
CI network, and headless rendering are not representative of the tablet profile.
It is measured in the final field/human review with browser network throttling
and recorded with the device and build. The same 3-second profile applies to a
cold load after install; a warm offline reload is covered by the PWA gate
instead.

## Bundle budget check

```sh
npm run build && node scripts/perf-budget.mjs
```

Options for investigation:

```sh
node scripts/perf-budget.mjs --json
node scripts/perf-budget.mjs --manifest dist/.vite/manifest.json
node scripts/perf-budget.mjs --budget-kb 300
node scripts/perf-budget.mjs --budget-bytes 307200
```

Exit codes and behavior:

- `0`: manifest read, entry found, every counted chunk file present, and total
  gzip size at or below the budget.
- `1`: missing/invalid manifest, missing entry, missing emitted chunk file, or an
  over-budget initial total. The failure names the measured total and budget;
  it never silently falls back to zero.
- Gzip sizes are measured locally with zlib level 9 over each emitted JavaScript
  file. Files are read from the build output; no network is used.

The parser has synthetic-manifest coverage in
`tests/a11y/perfBudget.test.ts`: transitive static imports, ignored dynamic
board/OCR chunks, the default 300 KiB failure, the exact-byte boundary, missing
manifest, and missing chunk file.

## Fixture limits and residual risk

- The automated floor uses a **75% detail camera** with 8 visible cards on the
  tablet/desktop projects. The 150-card graph, every card sprite, culling, the
  camera, and the Pixi render path are real, but drawing 20+ cards at a
  zoomed-out overview is intentionally left to the 45 FPS human tablet review.
- The 150-card fixture has **no images, OCR text, or strings**. Card sprites,
  titles, culling, camera transforms, and the Pixi render path are exercised;
  attachment decode, texture residency, and string-layer volume are not. The
  human tablet review should use a realistic case with images and strings.
- `requestAnimationFrame` cadence includes all main-thread work in the frame,
  not only Pixi draw calls. That is the user-visible effect the floor is meant to
  catch, but it is not a GPU profiler.
- Headless browsers often cap rAF near 60 Hz. A machine that cannot sustain the
  30 FPS floor is a real failure; a machine that runs at 58 FPS is not evidence
  of the tablet result.
- The phone project exercises a smaller stage with fewer visible cards, so its
  frame numbers are not comparable to desktop or tablet. Each project's evidence
  is reported separately.
- Do not raise the p95 ceiling, lower the FPS floor, skip a project, or add a
  retry to make this gate green. A threshold change requires a product decision
  and an updated budget here.
