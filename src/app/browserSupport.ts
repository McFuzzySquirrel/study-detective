/**
 * A11Y-FR-08 browser capability detection.
 *
 * The four checks are feature detection only. They never write storage,
 * register a worker, or load a runtime asset, so they are safe to call before
 * the first render.
 */

export type CoreApiKey = 'indexedDB' | 'webWorkers' | 'webAssembly' | 'serviceWorkers';

export interface CoreApiSupport {
  readonly indexedDB: boolean;
  readonly webWorkers: boolean;
  readonly webAssembly: boolean;
  readonly serviceWorkers: boolean;
}

/**
 * The subset of the global object the capability check reads. Tests pass a
 * literal so each missing API can be exercised without mutating real globals.
 */
export interface CoreApiEnvironment {
  readonly indexedDB?: unknown;
  readonly Worker?: unknown;
  readonly WebAssembly?: { readonly instantiate?: unknown; readonly compile?: unknown } | undefined;
  readonly navigator?: { readonly serviceWorker?: unknown } | undefined;
}

export interface CoreApiNotice {
  readonly key: CoreApiKey;
  /** The missing API, named in the visible notice. */
  readonly api: string;
  /** The product capability that is reduced. */
  readonly capability: string;
  readonly message: string;
}

/**
 * The support matrix lives in the repository README. The deployed site does
 * not serve markdown, so the notice links to the canonical GitHub location
 * rather than a runtime asset.
 */
export const SUPPORT_MATRIX_URL =
  'https://github.com/McFuzzySquirrel/study-detective/blob/main/README.md#browser-support';

export const CORE_API_NOTICES: readonly CoreApiNotice[] = Object.freeze([
  {
    key: 'indexedDB',
    api: 'IndexedDB',
    capability: 'local case storage',
    message:
      'Local case storage is reduced: this browser does not provide IndexedDB, so cases and cards cannot be saved on this device.',
  },
  {
    key: 'webWorkers',
    api: 'Web Workers',
    capability: 'on-device OCR',
    message:
      'On-device text recognition is reduced: this browser does not provide Web Workers, so OCR is unavailable.',
  },
  {
    key: 'webAssembly',
    api: 'WebAssembly',
    capability: 'on-device OCR',
    message:
      'On-device text recognition is reduced: this browser does not provide WebAssembly, so OCR is unavailable.',
  },
  {
    key: 'serviceWorkers',
    api: 'service workers',
    capability: 'offline use',
    message:
      'Offline use is reduced: this browser does not provide service workers, so the app shell cannot be cached for offline use.',
  },
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read the four browser APIs the install depends on. */
export function supportsCoreApis(environment?: CoreApiEnvironment): CoreApiSupport {
  const scope: CoreApiEnvironment = environment ?? (globalThis as unknown as CoreApiEnvironment);

  return {
    indexedDB: isObject(scope.indexedDB),
    webWorkers: typeof scope.Worker === 'function',
    webAssembly: isObject(scope.WebAssembly) && typeof scope.WebAssembly.instantiate === 'function',
    serviceWorkers: isObject(scope.navigator?.serviceWorker),
  };
}
