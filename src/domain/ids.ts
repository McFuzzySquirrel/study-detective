/**
 * Identity and time helpers for the domain layer.
 *
 * IDs are UUID v4 strings produced by `crypto.randomUUID`. Timestamps are ISO
 * 8601 strings produced by an injectable clock so tests and deterministic
 * fixtures never depend on wall-clock time.
 */

export type IdFactory = () => string;
export type Clock = () => Date;

/** Wall-clock implementation used by production callers. */
export const systemClock: Clock = () => new Date();

/**
 * Create a UUID suitable for a persisted record ID.
 *
 * Throws instead of silently falling back to a weak generator: Notes Detective
 * runs in a secure context where `crypto.randomUUID` is available.
 */
export function createId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi === undefined || typeof cryptoApi.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is unavailable in this environment');
  }
  return cryptoApi.randomUUID();
}

/** Read the current time from a clock and serialize it as an ISO 8601 string. */
export function nowIso(clock: Clock = systemClock): string {
  return clock().toISOString();
}

/**
 * Build a clock that always returns the same instant. The value is copied on
 * every call so callers cannot mutate shared test state through the Date.
 */
export function fixedClock(instant: string | Date): Clock {
  const milliseconds = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  if (Number.isNaN(milliseconds)) {
    throw new RangeError(`fixedClock received an invalid date: ${String(instant)}`);
  }
  return () => new Date(milliseconds);
}

/**
 * Build a deterministic ID factory for tests and fakes. Values are returned in
 * order and never invented, so a test can assert exact IDs without mocking the
 * crypto module.
 */
export function sequenceIdFactory(ids: readonly string[]): IdFactory {
  let cursor = 0;
  return () => {
    const id = ids[cursor];
    if (id === undefined) {
      throw new RangeError('sequenceIdFactory ran out of IDs');
    }
    cursor += 1;
    return id;
  };
}
