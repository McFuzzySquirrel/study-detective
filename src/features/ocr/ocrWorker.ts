import type { OcrAssetPaths } from './ocrAssets';
import { OCR_ENGINE_VERSION, OCR_LANGUAGE, ocrAssets, toOcrWorkerConfiguration } from './ocrAssets';

/** The user-visible timeout in the product contract. */
export const OCR_TIMEOUT_MS = 60_000;

export type OcrImage = Blob | string;

export type OcrJobPhase = 'loading-engine' | 'reading';

export type OcrResult = {
  readonly text: string;
  readonly confidence: number;
  readonly engineVersion: string;
  readonly updatedAt: string;
};

/**
 * Minimal worker surface used by the job runner. Production supplies the real
 * tesseract.js worker; tests inject a fake so no wasm or browser worker is
 * required for the lifecycle assertions.
 */
export type OcrWorkerLike = {
  recognize(image: OcrImage): Promise<{
    data?: {
      text?: unknown;
      confidence?: unknown;
      version?: unknown;
    } | null;
  }>;
  terminate(): Promise<unknown>;
};

export type OcrWorkerFactoryConfig = {
  readonly assets: OcrAssetPaths;
  readonly onProgress: (progress: number, message: string) => void;
};

export type OcrWorkerFactory = (config: OcrWorkerFactoryConfig) => Promise<OcrWorkerLike>;

export type OcrJobOptions = {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly assets?: OcrAssetPaths;
  readonly createWorker?: OcrWorkerFactory;
  readonly onPhase?: (phase: OcrJobPhase) => void;
  readonly onProgress?: (progress: number, message: string) => void;
  readonly now?: () => string;
};

export type OcrJobErrorCode = 'busy' | 'cancelled' | 'timeout' | 'engine' | 'read';

/** Expected lifecycle failure. UI maps `code` to a status and retry action. */
export class OcrJobError extends Error {
  readonly code: OcrJobErrorCode;

  constructor(code: OcrJobErrorCode, message: string) {
    super(message);
    this.name = 'OcrJobError';
    this.code = code;
  }
}

export class OcrBusyError extends OcrJobError {
  constructor() {
    super('busy', 'OCR is already running. Finish or cancel the current job first.');
    this.name = 'OcrBusyError';
  }
}

export class OcrCancelledError extends OcrJobError {
  constructor() {
    super('cancelled', 'OCR was cancelled.');
    this.name = 'OcrCancelledError';
  }
}

export class OcrTimeoutError extends OcrJobError {
  constructor(timeoutMs: number = OCR_TIMEOUT_MS) {
    super('timeout', `OCR timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = 'OcrTimeoutError';
  }
}

export class OcrEngineError extends OcrJobError {
  constructor(message = 'The OCR engine failed to start.') {
    super('engine', message);
    this.name = 'OcrEngineError';
  }
}

export class OcrReadError extends OcrJobError {
  constructor(message = 'The image could not be read.') {
    super('read', message);
    this.name = 'OcrReadError';
  }
}

let activeJob: symbol | null = null;

/** True while any component or runner owns the single OCR slot. */
export function isOcrJobActive(): boolean {
  return activeJob !== null;
}

/**
 * Convert a bundled asset path to a same-origin absolute URL.
 *
 * tesseract.js resolves `corePath` and `langPath` inside the worker, where a
 * document-relative path would be resolved against `/ocr/worker.min.js` and
 * produce `/ocr/ocr/…`. The absolute URL keeps the same file, origin, and base
 * path while making worker-side resolution unambiguous.
 */
function resolveSameOriginAsset(path: string): string {
  if (typeof document === 'undefined') {
    return path;
  }

  try {
    return new URL(path, document.baseURI).href;
  } catch {
    return path;
  }
}

/**
 * Production worker factory. Tesseract's own defaults point at a CDN, so every
 * path is passed explicitly from the same-origin asset bundle.
 */
export async function createTesseractWorker({
  assets,
  onProgress,
}: OcrWorkerFactoryConfig): Promise<OcrWorkerLike> {
  const tesseract = await import('tesseract.js');
  const createWorker = tesseract.createWorker as
    ((langs: string, oem: number, options: object) => Promise<OcrWorkerLike>) | undefined;

  if (typeof createWorker !== 'function') {
    throw new OcrEngineError('The bundled OCR engine could not be loaded.');
  }

  const configuration = toOcrWorkerConfiguration(assets);
  // OEM.LSTM_ONLY is 1; passing the number avoids importing a second runtime
  // enum while still selecting the simd-lstm core copied into public/ocr.
  return createWorker(OCR_LANGUAGE, 1, {
    ...configuration,
    workerPath: resolveSameOriginAsset(configuration.workerPath),
    // The bundle carries only the SIMD LSTM core. Passing the loader file (not
    // the directory) stops tesseract.js from probing for a relaxed-SIMD build
    // that was never copied, which would otherwise 404 on current Chromium.
    corePath: resolveSameOriginAsset(assets.coreLoaderPath),
    langPath: resolveSameOriginAsset(configuration.langPath),
    logger: (message: { progress: number; status: string }) => {
      onProgress(message.progress, message.status);
    },
  });
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(100, Math.max(0, numeric));
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

/**
 * Run one OCR job. The module owns a single global slot: a second call while a
 * job is active is rejected before any worker is created.
 *
 * Cancellation (AbortSignal), the 60-second timeout, worker failure, and
 * component unmount all terminate the worker and settle the returned promise
 * without writing anything. A late result after cancellation is ignored.
 */
export async function runOcrJob(image: OcrImage, options: OcrJobOptions = {}): Promise<OcrResult> {
  if (activeJob !== null) {
    throw new OcrBusyError();
  }

  const token = Symbol('ocr-job');
  activeJob = token;

  const timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS;
  const factory = options.createWorker ?? createTesseractWorker;
  const assets = options.assets ?? ocrAssets;
  const now = options.now ?? (() => new Date().toISOString());
  const signal = options.signal;

  let worker: OcrWorkerLike | null = null;
  let workerPromise: Promise<OcrWorkerLike> | null = null;
  let settled = false;
  const terminated = new WeakSet<OcrWorkerLike>();
  let cancelReason: OcrJobError | null = null;
  let rejectCancellation!: (reason: OcrJobError) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });
  // The race below observes this rejection; this handler only prevents an
  // unhandled rejection if cancellation fires in the tiny window before a race.
  cancellation.catch(() => {});

  const terminate = (target: OcrWorkerLike | null): void => {
    if (target === null || terminated.has(target)) {
      return;
    }
    terminated.add(target);
    try {
      void Promise.resolve(target.terminate()).catch(() => {});
    } catch {
      // Termination is best-effort; the job has already failed or been cancelled.
    }
  };

  const cancel = (reason: OcrJobError): void => {
    if (settled || cancelReason !== null) {
      return;
    }
    cancelReason = reason;
    terminate(worker);
    worker = null;
    rejectCancellation(reason);
  };

  const onAbort = (): void => {
    cancel(new OcrCancelledError());
  };

  try {
    if (signal?.aborted === true) {
      cancel(new OcrCancelledError());
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      cancel(new OcrTimeoutError(timeoutMs));
    }, timeoutMs);

    // An already-aborted signal (for example an immediate unmount) must not
    // create a worker at all.
    if (cancelReason !== null) {
      throw cancelReason;
    }

    options.onPhase?.('loading-engine');
    workerPromise = Promise.resolve().then(() =>
      factory({
        assets,
        onProgress: (progress, message) => {
          if (cancelReason === null) {
            options.onProgress?.(progress, message);
          }
        },
      }),
    );

    // If cancellation wins while the worker is still loading, terminate the
    // worker as soon as its factory resolves; it never gains a second owner.
    workerPromise
      .then((created) => {
        if (cancelReason !== null && worker !== created) {
          terminate(created);
        }
      })
      .catch(() => {});

    worker = await Promise.race([workerPromise, cancellation]);
    if (cancelReason !== null) {
      terminate(worker);
      worker = null;
      throw cancelReason;
    }

    options.onPhase?.('reading');
    const recognition = await Promise.race([worker.recognize(image), cancellation]);
    if (cancelReason !== null) {
      throw cancelReason;
    }

    const data = recognition?.data;
    if (data === null || data === undefined || typeof data.text !== 'string') {
      throw new OcrReadError('The OCR engine returned no text result.');
    }

    return {
      text: normalizeText(data.text),
      confidence: clampConfidence(data.confidence),
      engineVersion: OCR_ENGINE_VERSION,
      updatedAt: now(),
    };
  } catch (error) {
    if (error instanceof OcrJobError) {
      throw error;
    }
    if (cancelReason !== null) {
      throw cancelReason;
    }
    if (worker === null) {
      throw new OcrEngineError();
    }
    throw new OcrReadError();
  } finally {
    settled = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    signal?.removeEventListener('abort', onAbort);

    if (worker !== null) {
      const current = worker;
      worker = null;
      terminate(current);
    }
    if (workerPromise !== null) {
      // A factory that resolves after a failed/cancelled job must not leak its
      // worker. This is a no-op for the normal successful path.
      workerPromise
        .then((created) => {
          if (worker !== created) {
            terminate(created);
          }
        })
        .catch(() => {});
    }

    if (activeJob === token) {
      activeJob = null;
    }
  }
}
