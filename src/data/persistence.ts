/**
 * Storage-persistence helpers.
 *
 * `navigator.storage.persist()` is the browser's best-effort promise not to
 * evict the origin's data under storage pressure. It is never a guarantee: the
 * browser can still clear site data, so the shelf shows the result honestly and
 * keeps the backup reminder visible when the state is only best effort.
 *
 * This module performs no network calls, imports no React, and keeps every
 * browser API behind an injectable structural type so tests can prove the
 * granted, denied, unsupported, and thrown paths without a real browser.
 */

export type PersistenceState = 'persistent' | 'best-effort';

export interface PersistenceResult {
  /** What the shelf displays: persistent or best effort. */
  readonly state: PersistenceState;
  /** False when the browser exposes no persistence API at all. */
  readonly supported: boolean;
  /** True once `persist()` has actually been called for this result. */
  readonly requested: boolean;
  /** True when the browser answered the persistence request with `true`. */
  readonly granted: boolean;
}

/** The subset of `StorageManager` this module needs. */
export interface StorageManagerLike {
  readonly persist?: () => Promise<boolean>;
  readonly persisted?: () => Promise<boolean>;
}

export const UNSUPPORTED_PERSISTENCE: PersistenceResult = Object.freeze({
  state: 'best-effort',
  supported: false,
  requested: false,
  granted: false,
});

/**
 * Resolve the real StorageManager, or null when the browser does not expose
 * one. Access itself can throw in a privacy-restricted context.
 */
export function getStorageManager(): StorageManagerLike | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  try {
    const storage = navigator.storage as StorageManagerLike | undefined;
    return storage ?? null;
  } catch {
    return null;
  }
}

function bestEffort(supported: boolean, requested: boolean): PersistenceResult {
  return {
    state: 'best-effort',
    supported,
    requested,
    granted: false,
  };
}

/**
 * Read the current state without asking for anything. Call this on mount so
 * the shelf tells the truth before the first case exists.
 */
export async function readPersistenceState(
  storage: StorageManagerLike | null = getStorageManager(),
): Promise<PersistenceResult> {
  if (storage === null || typeof storage.persisted !== 'function') {
    return UNSUPPORTED_PERSISTENCE;
  }

  try {
    const granted = await storage.persisted();
    return granted
      ? { state: 'persistent', supported: true, requested: false, granted: true }
      : bestEffort(true, false);
  } catch {
    // The API exists but could not report. Surfacing this as best effort keeps
    // the backup reminder visible rather than claiming persistence.
    return bestEffort(true, false);
  }
}

/**
 * Ask for persistent storage. A missing API is unsupported, a rejected promise
 * is best effort, and a denial is reported as best effort with `supported`
 * still true so the UI can distinguish "denied" from "cannot ask".
 */
export async function requestPersistentStorage(
  storage: StorageManagerLike | null = getStorageManager(),
): Promise<PersistenceResult> {
  if (storage === null || typeof storage.persist !== 'function') {
    return UNSUPPORTED_PERSISTENCE;
  }

  try {
    const granted = await storage.persist();
    return granted
      ? { state: 'persistent', supported: true, requested: true, granted: true }
      : bestEffort(true, true);
  } catch {
    return bestEffort(true, true);
  }
}

/**
 * One persistence request per client.
 *
 * The first case creation calls `request()`; later creates and edits reuse the
 * same promise so the browser is asked exactly once per app install instead of
 * on every write. Callers that need a fresh answer can construct a new client.
 */
export class PersistenceClient {
  private readonly storage: StorageManagerLike | null;
  private requestPromise: Promise<PersistenceResult> | null = null;
  private latest: PersistenceResult | null = null;

  constructor(storage: StorageManagerLike | null = getStorageManager()) {
    this.storage = storage;
  }

  async read(): Promise<PersistenceResult> {
    const result = await readPersistenceState(this.storage);
    this.latest = result;
    return result;
  }

  request(): Promise<PersistenceResult> {
    if (this.requestPromise === null) {
      this.requestPromise = requestPersistentStorage(this.storage).then((result) => {
        this.latest = result;
        return result;
      });
    }

    return this.requestPromise;
  }

  /** The most recent answer, or null before the first read or request. */
  snapshot(): PersistenceResult | null {
    return this.latest;
  }
}

export function createPersistenceClient(
  storage: StorageManagerLike | null = getStorageManager(),
): PersistenceClient {
  return new PersistenceClient(storage);
}
