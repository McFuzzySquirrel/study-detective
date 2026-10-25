---
name: browser-evidence-journeys
description: "Playwright browser evidence for real IndexedDB, file input, downloads, offline reload, viewport matrices, axe scans, and performance floors."
---

# Browser Evidence Journeys

Use this skill whenever a Notes Detective claim needs browser evidence: a saved card, a restored archive, an offline reload, an installed PWA, a phone sheet, a keyboard journey, an axe scan, or a 150-card frame budget. A mocked unit test, a successful build, or an exit-zero command is not acceptance evidence for these claims.

Load `references/journey-matrix.md` when choosing or extending the named Playwright specs and their required assertions.

Load `references/browser-harness.md` when configuring projects, fixtures, downloads, offline contexts, axe, performance measurement, or evidence cleanup.

## Process

### Step 1: State the claim and the failure that would disprove it

Write one sentence: “A student can import a real PNG, reload, and see the same card.” Then name the assertion that fails if persistence, the file input, or the image path breaks. If the claim is “the phone layout works,” the assertion is no page-level horizontal scroll and every primary action reachable at 390x844, not a screenshot.

If no assertion can fail, then the test is documentation, not evidence.

### Step 2: Use a fresh, real browser context

Each spec starts from a clean storage state unless the scenario depends on prior state. Use the production preview (`vite preview`) for PWA, offline, and base-path claims; use the dev server only for fast interaction checks that do not claim deployment behavior.

Prefer real IndexedDB, real service workers, real files, and real downloads. If a unit-level fake is unavoidable inside a browser journey, then do not claim that journey proves storage, offline, or archive behavior.

### Step 3: Drive the native path

Use `setInputFiles` on the actual `input[type=file]` for imports, or handle `filechooser` if the app opens one. Wait for the download event for export and read the produced bytes. Reload the page to prove persistence instead of asserting an in-memory store. For offline, wait for service-worker control, switch the context offline, then reload.

If a control is custom, then interact with its accessible role and name, not a CSS class or a test-only ID.

### Step 4: Cover the required matrix

- Desktop 1440x900, tablet landscape 1280x800, phone 390x844; add 768x1024 for responsive hardening.
- Chromium runs the full journeys; Firefox and WebKit run smoke routes.
- Axe scans shelf, board, card detail, recall, search, and settings, including open dialogs and sheets. Zero serious or critical.
- Performance seeds 150 cards, pans for five seconds, records average FPS and p95 frame time, and fails below the documented CI floor.
- Runtime request collection fails on any non-same-origin request.

```bash
npm run test:e2e -- e2e/capture.spec.ts e2e/backup.spec.ts e2e/board.spec.ts
npm run test:e2e -- e2e/a11y.spec.ts e2e/responsive.spec.ts e2e/keyboard-journey.spec.ts
npm run test:e2e -- e2e/pwa.spec.ts e2e/performance.spec.ts
```

If that doesn't work because a spec is flaky, then fix the wait condition or seed determinism; never add a sleep long enough to hide the race.

### Step 5: Report behavioral evidence separately from heuristics

Record the command, spec, browser project, viewport, fixture, and observed result. Do not present an axe score, a bundle score, or an FPS sample as a substitute for a human review. A defect found in a journey goes back to the owning specialist; a test is not rewritten to accept the defect.

## Gotchas

- **A mocked IndexedDB proves the mock, not persistence.** Use `fake-indexeddb` for repository unit tests and a real browser reload for the acceptance claim.
- **`setInputFiles` needs the element, not a click on a styled label.** If the input is visually hidden, target it directly; clicking the label may open the OS picker and hang the test.
- **Downloads are asynchronous and named by the server/app.** Wait for the `download` event, read the bytes with `saveAs`/`path`, and validate the ZIP or file content; a click alone proves nothing.
- **Offline reload before service-worker control fails for the wrong reason.** Wait for `navigator.serviceWorker.ready` and a controller, load once, then go offline and reload.
- **`scrollWidth > clientWidth` on `body` misses inner overflow.** Check the document element and the screen container; the board's own pan surface is intentionally wider and must be excluded.
- **Axe on the base page misses open overlays.** Scan after opening dialogs, sheets, and the search panel; document exclusions and never exclude interactive controls.
- **Counting wall-clock time is not frame measurement.** Use `requestAnimationFrame` sampling and record p95 frame time plus average FPS; headless software rendering uses the documented 30 FPS floor.
- **A test that seeds through the UI at 150 cards is too slow and flaky.** Seed through the app's IndexedDB schema in a helper, then assert the board becomes interactive.
- **Reload after navigation is not persistence proof if the write was never awaited.** Wait for the repository write or an observable saved state before reloading.
- **Fresh context per spec avoids order dependence.** Shared storage state hides a seed/cleanup bug and makes failures non-reproducible.
- **Screenshots are artifacts, not assertions.** Attach them as evidence after a concrete DOM, storage, network, or timing assertion fails or passes.

## Validation

- [ ] Every journey states the claim and an assertion that fails if the behavior is removed.
- [ ] Imports use a real fixture file through the native input; exports read real downloaded bytes.
- [ ] Persistence is proven by reload, not by an in-memory assertion.
- [ ] Offline tests wait for service-worker control, then reload offline and assert the shell and cached assets.
- [ ] Viewport tests cover 390x844, 768x1024, 1280x800, and 1440x900 with no page-level horizontal scroll.
- [ ] Axe covers six screens plus open dialogs/sheets with zero serious or critical findings.
- [ ] The 150-card performance spec records average FPS and p95 frame time and enforces the CI floor.
- [ ] No runtime request targets a non-same-origin host.
- [ ] Evidence lists command, project, viewport, fixture, and observed result; human gates stay separate.

Self-check: run the spec twice from a clean context, then once with the behavior intentionally removed; the second run must fail for the stated reason.
