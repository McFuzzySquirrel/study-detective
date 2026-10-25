---
name: ocr-worker-lifecycle
description: "Bundled tesseract.js worker lifecycle with same-origin assets, a single job at a time, timeout and cancel cleanup, and non-destructive title suggestions."
---

# OCR Worker Lifecycle

Use this skill for the optional on-device OCR path: copying and precaching tesseract.js assets, building same-origin URLs, running one job at a time, handling timeout and cancel, storing OCR text safely, and suggesting a title without overwriting a student's edit. OCR is off by default and always user-triggered.

Load `references/asset-bundling.md` when pinning packages, copying worker/wasm/traineddata, configuring URLs, precaching, or writing the asset check.

Load `references/worker-state-machine.md` when implementing the worker hook, job queue, timeout, cancellation, status states, storage fields, or title-suggestion behavior.

## Process

### Step 1: Pin and bundle the four assets

Pin `tesseract.js` 7.0.0, `tesseract.js-core` 7.0.0, and `@tesseract.js-data/eng` 1.0.0. Copy these into `public/ocr`:

- `worker.min.js`
- `tesseract-core-simd-lstm.wasm.js`
- `tesseract-core-simd-lstm.wasm`
- `4.0.0_best_int/eng.traineddata.gz`

Wire the copy script into `postinstall`, `predev`, and `prebuild`. Build every URL from `import.meta.env.BASE_URL` so the worker resolves under the GitHub Pages base path. No CDN, no `unpkg`, no remote language download.

If an asset is missing, then `scripts/check-ocr-assets.mjs` fails the build; the UI still loads and OCR shows a retry message rather than crashing the app.

### Step 2: Allow one job at a time

Create one worker per job and terminate it when the job settles, or maintain a single shared worker with an explicit busy guard. Either way, a second request while one runs is rejected with a visible "OCR is already running" message and creates no second worker.

States: `idle`, `loading-engine`, `reading`, `done`, `failed`, `timed-out`, `cancelled`. Transitions are explicit; a late worker message after cancel is ignored. The progress indicator is indeterminate; Cancel is available while running.

### Step 3: Bound time and cancel cleanly

Time out at 60 seconds. On timeout, cancel, unmount, route change, or completion, terminate the worker and revoke any object URL. Cancellation and failure leave the card exactly as it was: no text, no confidence, no title change.

Use an abort flag and a generation token so a stale promise cannot write after a new job starts. Always clear the timer and event listeners in `finally`.

### Step 4: Store and suggest without overwriting

On success, persist `text`, `confidence`, `engineVersion`, and `updatedAt` with the card. Never create tags, connections, or card types from OCR, and never run OCR at import, on a timer, or in bulk.

If the title is empty, then fill it from the first meaningful OCR line and announce the change. If the title is non-empty, then show `Suggested title` with `Apply` and `Dismiss`; the field stays untouched until Apply. A student-edited title is never overwritten.

### Step 5: Prove offline and non-destructive behavior

```bash
node scripts/copy-ocr-assets.mjs
node scripts/check-ocr-assets.mjs
npm test -- tests/ocr/ocrAssets.test.ts tests/ocr/useOcr.test.tsx
npm test -- tests/ocr/OcrPanel.test.tsx tests/search/ocrSearch.test.ts tests/backup/ocrRoundTrip.test.ts
npm run test:e2e -- e2e/ocr.spec.ts
npm run build
```

If that doesn't work because the built asset path differs, then inspect `dist/ocr` and the service-worker precache manifest; fix the copy or base URL rather than falling back to a remote URL.

## Gotchas

- **Three tesseract assets are not enough.** The worker script, the wasm JS loader, the wasm binary, and English traineddata are four distinct files; omitting the `.wasm.js` loader fails only in the browser.
- **`langPath` must point at the directory, not the gzip file.** Pointing it at `eng.traineddata.gz` makes the worker append a name and request a double path.
- **A CDN default is a silent offline failure.** tesseract.js defaults to remote paths in some configurations; set `workerPath`, `corePath`, and `langPath` explicitly from the base URL and assert no external origin in source.
- **Two workers mean two wasm heaps.** A second concurrent job can exhaust tablet memory; reject it instead of queueing silently.
- **Cancel must terminate, not just ignore.** An orphaned worker keeps the CPU busy and can write a late result; terminate and use a generation token.
- **A timeout that only rejects the promise leaks the worker.** Both the timeout path and the unmount path must call `terminate()` and clear state.
- **OCR text is searchable but not authoritative.** A low-confidence guess must not become a title without the student's action, and OCR must not create tags or connections.
- **Clearing OCR must be confirmed.** Removing stored text is destructive to search and backup; ask before clearing.
- **The panel needs a recoverable failure state.** Assets missing or a failed read must leave the rest of the app usable and offer retry, not a blank screen.
- **English only in v1.** Do not add a language picker or download additional traineddata.

## Validation

- [ ] The four OCR assets exist under `public/ocr` after install and are emitted into `dist`.
- [ ] All worker, core, and language URLs are same-origin and respect the base path.
- [ ] A source scan and a build check fail on an external OCR origin.
- [ ] Only one job runs; a second request is rejected without creating a worker.
- [ ] Timeout, cancel, unmount, and route change terminate the worker within one second and leave the card unchanged.
- [ ] Empty title fills and is announced; non-empty title requires Apply; edited text is never overwritten.
- [ ] Text, confidence, engine version, and timestamp persist and survive reload, search, and export/import.
- [ ] The Playwright journey runs real OCR on a fixture, searches the text, reloads, and verifies persistence.
- [ ] The service-worker precache contains the OCR assets and an offline run degrades gracefully.

Self-check: throttle the network to offline after first load, invoke OCR, and confirm the worker starts from cache with no external request in the network panel.
