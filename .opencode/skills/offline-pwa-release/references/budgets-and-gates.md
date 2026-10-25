# Budgets and gates

Use this reference when measuring, enforcing, or documenting release quality.

## Hard budgets

| Budget | Limit | Measurement |
|--------|-------|-------------|
| Initial app JavaScript | 300 KB gzip | Vite manifest entry plus shared chunks, excluding lazy board and OCR chunks |
| Service-worker precache | 25 MB | Workbox precache manifest total, including OCR worker/wasm/traineddata |
| Board performance | 45 FPS target on target tablet; 30 FPS CI floor | 150-card fixture, five-second scripted pan, average FPS and p95 frame time |
| Cold load | 3 seconds | 20 Mbps tablet profile |
| Coverage | 85 percent lines | `src/domain` and `src/data` |
| Accessibility | Zero serious/critical | axe on shelf, board, card detail, recall, search, settings, including open dialogs/sheets |

A budget script fails the command; it does not print a warning and exit zero.

## Bundle budget parser

Read `dist/.vite/manifest.json` (or the emitted manifest path). Sum the gzip size of the entry and shared chunks that load on first paint. Exclude chunks reachable only through the lazy board route and the lazy OCR feature. Fail when the sum exceeds 300 KB. Keep a unit test with a synthetic manifest covering board-only, OCR-only, shared, and over-budget cases.

## Precache budget parser

Read the generated service-worker precache manifest (or the Workbox `self.__WB_MANIFEST` output). Sum entry sizes. Fail above 25 MB. Assert the four OCR assets are present; a smaller precache that omitted them is not a pass.

## CI gate

`.github/workflows/ci.yml` runs on push and pull_request:

1. Node 24 with `npm ci`.
2. `npm run lint`.
3. `npm run typecheck`.
4. `npm run test:coverage` with domain/data thresholds.
5. `npm run build`.
6. `npx playwright install --with-deps chromium firefox webkit`.
7. `npm run test:e2e`.

Every required step fails the job. The workflow validator rejects a missing step, a renamed job that skips it, `continue-on-error: true`, or a command that always exits zero.

## Same-origin audit

Collect `page.on("request")` in Playwright. Allowed origins: the preview origin and `data:`/`blob:` URLs created by the app. Fail on any `http(s)` request to another host, including fonts, images, analytics, source maps, or OCR CDNs. Also inspect the built HTML for remote preconnect/dns-prefetch hints.

## Offline verification

1. Load the production preview and wait for `navigator.serviceWorker.ready` and controller.
2. Assert the manifest and three icons.
3. Inspect the cache keys for OCR worker, wasm, and traineddata.
4. Set the browser context offline.
5. Reload the app shell and the demo case.
6. Assert the shelf, board, recall, and search render; OCR reports a graceful failure if invoked without cached assets.
7. Set the network back online; a waiting update prompts and does not auto-reload.

## Human gate

Automated green is not field acceptance. The final human journey runs on the deployed URL on a 10-inch tablet landscape, a phone, and desktop: install, demo, capture, pin, strings, close, recall, OCR, export, import, reopen, offline reload, and keyboard path. It records device, browser, URL, per-step pass/fail, and whether the reviewer would choose the board over re-reading notes. Never mark that gate passed from a CI result.

## Documentation checker

`scripts/check-release-docs.mjs` asserts required headings, local links, commands, and the absence of `TODO`, `TBD`, `example.com`, and placeholder tokens. Required claims to avoid: encryption, cloud sync, screen-reader spatial parity, and strict CSP on GitHub Pages.
