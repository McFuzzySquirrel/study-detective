---
name: offline-pwa-release
description: "Offline-first PWA release process for GitHub Pages: relative base paths, service-worker precache, same-origin asset audits, bundle budgets, and update prompts."
---

# Offline PWA Release

Use this skill when building or changing the Notes Detective app shell, manifest, icons, service worker, update prompt, Vite base path, GitHub Pages deployment, offline verification, bundle budgets, or release documentation. A green local dev server is not release evidence; the production build under the Pages base path is.

Load `references/pages-and-pwa.md` when configuring Vite, the manifest, icons, service-worker registration, update behavior, base paths, or the GitHub Pages workflow.

Load `references/budgets-and-gates.md` when measuring bundle or precache size, auditing runtime requests, writing CI steps, or documenting release limits.

## Process

### Step 1: Configure one base path and hash routing

Vite reads a single `VITE_BASE_PATH` input (for example `/notes-detective/`). Hash routing carries every route after `#`, so GitHub Pages needs no rewrite. The manifest's `start_url` and `scope` are relative (`./`), icons resolve under the base path, and no built asset uses an absolute `/assets/...` URL.

If a route were path-based, then a deep link would 404 on Pages; keep hash routes rather than adding a 404 shim.

### Step 2: Ship the installable shell

Provide a same-origin manifest with name, short name, standalone display, theme colors, 192px, 512px, and maskable 512px icons that exist on disk. Register the service worker in prompt mode. A waiting worker shows a non-blocking `Refresh` / `Later` prompt and activates only after explicit confirmation; never reload during an unsaved edit.

Precache the app shell and reserve entries for the OCR worker, wasm, and English traineddata. The app must load the shelf, board, recall, and search without a network after the first successful load. A blocking first load without a network is not supported and is documented as such.

### Step 3: Keep every runtime request same-origin

Collect runtime requests in the browser and fail on any non-same-origin host. No analytics, crash reporting, CDN font, external image, external OCR endpoint, or third-party script. The generated build must contain no `http://` or `https://` asset reference outside documentation links and the app's own origin.

If an asset needs to be local, then copy it into `public/` during install or prebuild and reference it through `import.meta.env.BASE_URL`; do not add a runtime fetch to a CDN.

### Step 4: Enforce the budgets and CI gates

Use Node 24 with `npm ci`. Required CI steps: lint, typecheck, unit/component tests with coverage, production build, Playwright browser install, and browser journeys. No `continue-on-error`, no unconditional success, no skipped required step.

Budgets:
- Initial app JavaScript at or below 300 KB gzip, excluding lazy board and OCR chunks.
- Service-worker precache at or below 25 MB total.
- Board target 45 FPS at 150 cards on the tablet; CI floor 30 FPS for headless software rendering.
- Cold load at or below 3 seconds on a 20 Mbps tablet profile.

```bash
VITE_BASE_PATH=/notes-detective/ npm run build
node scripts/check-pages-build.mjs
node scripts/check-bundle-budget.mjs
node scripts/perf-budget.mjs
npm run test:e2e -- e2e/pwa.spec.ts
```

If that doesn't work because a script does not exist yet, then create the named checker and its parser test as part of the task; do not drop the gate.

### Step 5: Verify the deployed build and document limits

Deploy only `main` with `pages:write`, `id-token:write`, an environment, artifact upload, and `deploy-pages`. Pull requests run CI but never deploy. Verify the deployed URL installs, reloads offline, finds OCR assets in the precache, and prompts for an update instead of activating silently.

Document setup, scripts, production preview, deployment URL pattern, base-path behavior, browser support, privacy, backup, known limitations, and the human acceptance gate. Keep automated evidence and human approval separate.

## Gotchas

- **The base path is build-time, not runtime.** Changing `VITE_BASE_PATH` after build does nothing; the deployed bundle must be built with the repository base.
- **Relative `start_url` and `scope` are not cosmetic.** Absolute values make an installed PWA launch at the domain root and break under a project-site path.
- **`skipWaiting` defeats the update prompt.** Prompt mode must leave a waiting worker waiting until the student confirms; auto-activation can swap code under an open form.
- **The update prompt must not reload a dirty form.** Check for unsaved changes and require confirmation; a silent reload loses typed titles, tags, or OCR suggestions.
- **GitHub Pages cannot set custom headers.** Do not claim a strict CSP, HSTS, or custom cache headers. Rely on same-origin assets, no inline handlers, and no third-party scripts.
- **Precache size includes OCR.** Worker, wasm, and traineddata count toward the 25 MB budget; measure the actual service-worker manifest, not the JS bundle alone.
- **Offline starts after the first successful load.** A first visit with no network cannot render; say so instead of implying full offline install from nothing.
- **A cached old service worker can mask a broken deploy.** Verify with a fresh profile or unregister the old worker before concluding the new build is live.
- **CI that installs browsers but skips the journey is not evidence.** The Playwright step must run named specs and fail on a missing file.
- **A local `vite preview` at the root hides base-path bugs.** Exercise the production build under the Pages base path before release.

## Validation

- [ ] The Pages build references only prefixed assets; no absolute `/assets` path leaks.
- [ ] Manifest `start_url`, `scope`, and icons resolve under the base path.
- [ ] A fresh install shows the manifest and icons, and a waiting worker prompts rather than activating.
- [ ] Offline reload after first load renders the shelf and demo; OCR worker, wasm, and traineddata are cached.
- [ ] No runtime request targets a different origin.
- [ ] Initial JS is at or below 300 KB gzip excluding board/OCR; precache is at or below 25 MB.
- [ ] CI runs lint, typecheck, coverage, build, and named Playwright specs with no bypass.
- [ ] The deployed URL is smoke-tested on tablet, phone, and desktop, and the human gate remains separate.

Self-check: build with the Pages base, serve `dist`, disable the network after one load, reload, and inspect both the cache and the network panel.
