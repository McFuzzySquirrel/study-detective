# OCR asset bundling

Use this reference for package pinning, copying, URLs, and precache.

## Pinned packages

```json
{
  "dependencies": {
    "tesseract.js": "7.0.0",
    "tesseract.js-core": "7.0.0",
    "@tesseract.js-data/eng": "1.0.0"
  }
}
```

Exact versions, not ranges, so a patch release cannot change worker protocol or traineddata layout.

## Files to copy

Copy from the installed packages into `public/ocr`:

| Source | Destination |
|--------|-------------|
| `node_modules/tesseract.js/dist/worker.min.js` | `public/ocr/worker.min.js` |
| `node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js` | `public/ocr/tesseract-core-simd-lstm.wasm.js` |
| `node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm` | `public/ocr/tesseract-core-simd-lstm.wasm` |
| `node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz` | `public/ocr/eng.traineddata.gz` |

Package layouts can change; resolve paths from the package root and fail loudly when a source file is missing rather than copying an empty directory.

## Script wiring

`scripts/copy-ocr-assets.mjs` is idempotent: create `public/ocr`, copy, and report file sizes. Wire it into `postinstall`, `predev`, and `prebuild`. Do not commit large generated assets unless the repository policy requires it; the `.gitignore` decision belongs in the task contract.

`scripts/check-ocr-assets.mjs` asserts:

- all four files exist and are non-empty,
- the wasm file is at least a plausible size (not an HTML error page),
- no file under `src/features/ocr` contains `http://` or `https://` for an asset origin,
- the generated `dist/ocr` contains the four files after a build when `dist` exists.

## URL construction

```ts
const base = import.meta.env.BASE_URL; // "/" or "/notes-detective/"
export const ocrAssets = {
  workerPath: `${base}ocr/worker.min.js`,
  corePath: `${base}ocr/`,
  langPath: `${base}ocr`,
};
```

`corePath` is a directory containing the wasm and its loader. `langPath` is a directory, not the gzip file. Keep the trailing slash behavior consistent with tesseract.js 7; test the generated URL in a browser, not only as a string.

## Service worker

Precache the four files. Verify cache keys after first load, then go offline and run OCR. A precache that excludes the traineddata fails only when OCR is invoked, which is why the offline check must call OCR.

## Failure behavior

If the copy script fails, the build should fail. If the assets are absent at runtime (for example a stale deployment), the OCR panel shows a retry message and the rest of the app remains usable. Never fall back to a CDN silently.

## Build check

`node scripts/check-ocr-assets.mjs` runs after `npm run build` in CI. The corresponding Vitest test exercises the checker with missing and present fixtures so the checker itself is trusted.
