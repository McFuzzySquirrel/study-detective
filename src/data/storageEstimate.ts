/**
 * Storage-usage reporting.
 *
 * `navigator.storage.estimate()` returns byte figures that vary by browser and
 * by how the origin's quota is shared. The shelf only needs a percentage and a
 * warning threshold; everything here is derived from the estimate at read time
 * and never persisted.
 *
 * This module performs no network calls and imports no React.
 */

/** Warn when usage is above, not equal to, 80 percent of the reported quota. */
export const STORAGE_WARNING_RATIO = 0.8;

export interface StorageEstimateLike {
  readonly usage?: number;
  readonly quota?: number;
}

export interface StorageEstimateSnapshot {
  /** True when the browser exposed an estimate API and answered. */
  readonly supported: boolean;
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  readonly ratio: number | null;
  readonly percent: number | null;
  /** True only when usage is strictly above the warning ratio. */
  readonly warning: boolean;
}

export const UNKNOWN_STORAGE_ESTIMATE: StorageEstimateSnapshot = Object.freeze({
  supported: false,
  usageBytes: null,
  quotaBytes: null,
  ratio: null,
  percent: null,
  warning: false,
});

/** The subset of `StorageManager` this module needs. */
export interface StorageEstimatorLike {
  readonly estimate?: () => Promise<StorageEstimateLike>;
}

function nonNegativeBytes(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Turn a raw estimate into display-safe values. Invalid, negative, or missing
 * numbers become null rather than NaN or Infinity leaking into the UI.
 */
export function summarizeStorageEstimate(
  estimate: StorageEstimateLike | null | undefined,
): StorageEstimateSnapshot {
  if (estimate === null || estimate === undefined) {
    return UNKNOWN_STORAGE_ESTIMATE;
  }

  const usageBytes = nonNegativeBytes(estimate.usage);
  const quotaBytes = nonNegativeBytes(estimate.quota);
  const ratio =
    usageBytes !== null && quotaBytes !== null && quotaBytes > 0 ? usageBytes / quotaBytes : null;
  const percent = ratio === null ? null : Math.round(ratio * 100);

  return {
    supported: true,
    usageBytes,
    quotaBytes,
    ratio,
    percent,
    warning: ratio !== null && ratio > STORAGE_WARNING_RATIO,
  };
}

/**
 * Resolve the real StorageManager, or null when the browser does not expose
 * one. Access itself can throw in a privacy-restricted context.
 */
export function getStorageEstimator(): StorageEstimatorLike | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  try {
    const storage = navigator.storage as StorageEstimatorLike | undefined;
    return storage ?? null;
  } catch {
    return null;
  }
}

/**
 * Read usage and quota. An absent API, a synchronous throw, or a rejected
 * estimate resolves to the unsupported snapshot so the shelf renders a clear
 * best-effort state instead of crashing.
 */
export async function readStorageEstimate(
  storage: StorageEstimatorLike | null = getStorageEstimator(),
): Promise<StorageEstimateSnapshot> {
  if (storage === null || typeof storage.estimate !== 'function') {
    return UNKNOWN_STORAGE_ESTIMATE;
  }

  try {
    return summarizeStorageEstimate(await storage.estimate());
  } catch {
    return UNKNOWN_STORAGE_ESTIMATE;
  }
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Format a byte count with binary (1024) units and at most one decimal place.
 * Unknown values render as "Unknown" so the component never prints NaN.
 */
export function formatStorageBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return 'Unknown';
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  let value = bytes / 1024;
  let unitIndex = 1;

  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
  const unit = BYTE_UNITS[unitIndex] ?? 'B';
  return `${rounded} ${unit}`;
}
