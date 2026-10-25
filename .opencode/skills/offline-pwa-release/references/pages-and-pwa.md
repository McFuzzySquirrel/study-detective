# Pages and PWA configuration

Use this reference for Vite, manifest, icons, service worker, update flow, and deployment.

## Vite and base path

```ts
// vite.config.ts (shape, not a full config)
const base = process.env.VITE_BASE_PATH ?? "/";
export default defineConfig({
  base,
  build: { manifest: true },
  plugins: [react(), VitePWA({ registerType: "prompt" /* ... */ })],
});
```

Rules:

- One base input. No second hard-coded `/notes-detective/` in components.
- Assets referenced through imports or `import.meta.env.BASE_URL`; no hand-written `/assets/...`.
- Hash routing so no server rewrite is needed.
- Board and OCR stay in lazy chunks.
- Build with `VITE_BASE_PATH=/notes-detective/` for the Pages check.

## Manifest

```json
{
  "name": "Notes Detective",
  "short_name": "Notes Detective",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "...",
  "theme_color": "...",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

All three PNGs exist on disk and are generated from `public/icons/icon.svg` by `scripts/generate-icons.mjs`. No third-party manifest URL.

## Service worker

Use Workbox through `vite-plugin-pwa`:

- `registerType: "prompt"`; no `skipWaiting` and no `clientsClaim` that bypasses confirmation.
- Precache the app shell, built assets, icons, and OCR assets under `public/ocr`.
- Navigation fallback to `index.html` for hash routes.
- A waiting worker surfaces the `UpdatePrompt` toast with `Refresh` and `Later`.
- `Refresh` calls `updateServiceWorker(true)` only after confirmation and only when no form is dirty.
- Do not claim offline for a first-ever load; the service worker needs one successful install.

## OCR assets

The four files are copied by `scripts/copy-ocr-assets.mjs` into `public/ocr` before dev/build. `scripts/check-ocr-assets.mjs` fails when one is missing. The service worker precache must include them, and `ocrAssets.ts` builds URLs from `import.meta.env.BASE_URL`, never a CDN.

## Icons script

`scripts/generate-icons.mjs` reads the SVG and writes 192, 512, and maskable 512 PNGs with `sharp`. Run it before a build that depends on the icons; a manifest test asserts the files exist and are non-empty.

## GitHub Pages workflow

```yaml
# .github/workflows/deploy-pages.yml (required shape)
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run build
        env:
          VITE_BASE_PATH: /notes-detective/
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    environment: github-pages
    runs-on: ubuntu-latest
    steps:
      - uses: actions/deploy-pages@v4
```

Pull requests run CI only. Deployment never runs from a pull request. Add no secrets or placeholder tokens.

## Verification scripts

- `scripts/check-pages-build.mjs`: asserts prefixed assets, no absolute `/assets`, manifest and icons present, `start_url`/`scope` relative, and OCR files emitted.
- `scripts/validate-workflows.mjs`: asserts required jobs, Node 24, `npm ci`, required steps, and no `continue-on-error` or unconditional success.
- `scripts/check-ocr-assets.mjs`: asserts the four assets exist and no OCR source references an external origin.

## Local production preview

```bash
VITE_BASE_PATH=/notes-detective/ npm run build
npx vite preview --base /notes-detective/
```

Then open the preview URL with the hash route. The dev server does not exercise base-path behavior.
