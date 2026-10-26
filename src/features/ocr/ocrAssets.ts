/**
 * Same-origin locations for the bundled English OCR engine.
 *
 * Everything is derived from Vite's BASE_URL so the worker, wasm loader, wasm
 * binary, and traineddata resolve correctly at the domain root and under a
 * GitHub Pages project path. No absolute or protocol-relative origin is
 * accepted: a CDN fallback would silently break offline OCR.
 */

export const OCR_ASSET_DIRECTORY = 'ocr';
export const OCR_LANGUAGE = 'eng';
export const OCR_ENGINE_VERSION = 'tesseract.js 7.0.0';

export const OCR_ASSET_FILES = Object.freeze({
  worker: 'worker.min.js',
  coreLoader: 'tesseract-core-simd-lstm.wasm.js',
  coreWasm: 'tesseract-core-simd-lstm.wasm',
  trainedData: 'eng.traineddata.gz',
});

export type OcrAssetPaths = {
  /** File URL passed to tesseract.js `workerPath`. */
  readonly workerPath: string;
  /** Directory passed to tesseract.js `corePath` (trailing slash). */
  readonly corePath: string;
  /** Directory passed to tesseract.js `langPath` (no trailing slash). */
  readonly langPath: string;
  /** Explicit file URLs, useful for the asset check and diagnostics. */
  readonly coreLoaderPath: string;
  readonly coreWasmPath: string;
  readonly trainedDataPath: string;
};

/** Configuration that guarantees the worker never falls back to a CDN. */
export type OcrWorkerConfiguration = {
  readonly workerPath: string;
  readonly corePath: string;
  readonly langPath: string;
  readonly workerBlobURL: false;
  readonly gzip: true;
};

export class OcrAssetConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrAssetConfigurationError';
  }
}

const ABSOLUTE_ORIGIN_PATTERN = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * Build the asset paths for a Vite base URL.
 *
 * Accepted values are path-only bases such as `/`, `./`, or
 * `/notes-detective/`. An absolute URL, protocol-relative URL, or other scheme
 * is rejected rather than rewritten, because the engine must never fetch from
 * an external origin.
 */
export function createOcrAssetPaths(baseUrl: string = import.meta.env.BASE_URL): OcrAssetPaths {
  const trimmed = baseUrl.trim();
  if (ABSOLUTE_ORIGIN_PATTERN.test(trimmed)) {
    throw new OcrAssetConfigurationError(
      'OCR assets must be served from the same origin as the app; absolute URLs are not allowed.',
    );
  }

  const withTrailingSlash =
    trimmed.length === 0 ? './' : trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  const directory = `${withTrailingSlash}${OCR_ASSET_DIRECTORY}`;

  return Object.freeze({
    workerPath: `${directory}/${OCR_ASSET_FILES.worker}`,
    corePath: `${directory}/`,
    langPath: directory,
    coreLoaderPath: `${directory}/${OCR_ASSET_FILES.coreLoader}`,
    coreWasmPath: `${directory}/${OCR_ASSET_FILES.coreWasm}`,
    trainedDataPath: `${directory}/${OCR_ASSET_FILES.trainedData}`,
  });
}

/** Paths for the current build, computed once at module load. */
export const ocrAssets: OcrAssetPaths = createOcrAssetPaths();

/**
 * The tesseract.js worker options for these assets.
 *
 * `workerBlobURL: false` makes the browser resolve `workerPath` against the
 * document instead of creating an extra Blob URL around a relative
 * `importScripts`, which keeps teardown free of object URLs.
 */
export function toOcrWorkerConfiguration(
  assets: OcrAssetPaths = ocrAssets,
): OcrWorkerConfiguration {
  return Object.freeze({
    workerPath: assets.workerPath,
    corePath: assets.corePath,
    langPath: assets.langPath,
    workerBlobURL: false,
    gzip: true,
  });
}

/** Ready-to-spread tesseract.js options for the current build. */
export const ocrWorkerOptions: OcrWorkerConfiguration = toOcrWorkerConfiguration(ocrAssets);
