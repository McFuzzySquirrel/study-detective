import { describe, expect, it, vi } from 'vitest';

import {
  formatStorageBytes,
  readStorageEstimate,
  summarizeStorageEstimate,
  UNKNOWN_STORAGE_ESTIMATE,
} from '../../src/data/storageEstimate';

describe('storageEstimate', () => {
  it('derives usage, quota, and percentage from an estimate', () => {
    const snapshot = summarizeStorageEstimate({ usage: 50, quota: 200 });

    expect(snapshot).toEqual({
      supported: true,
      usageBytes: 50,
      quotaBytes: 200,
      ratio: 0.25,
      percent: 25,
      warning: false,
    });
  });

  it('warns only when usage is above 80 percent', () => {
    expect(summarizeStorageEstimate({ usage: 80, quota: 100 }).warning).toBe(false);
    expect(summarizeStorageEstimate({ usage: 800, quota: 1000 }).warning).toBe(false);

    const high = summarizeStorageEstimate({ usage: 850, quota: 1000 });
    expect(high.warning).toBe(true);
    expect(high.percent).toBe(85);
  });

  it('handles exactly-full and over-quota values without NaN', () => {
    const full = summarizeStorageEstimate({ usage: 100, quota: 100 });
    expect(full.ratio).toBe(1);
    expect(full.percent).toBe(100);
    expect(full.warning).toBe(true);

    const over = summarizeStorageEstimate({ usage: 120, quota: 100 });
    expect(over.percent).toBe(120);
    expect(over.warning).toBe(true);
  });

  it('turns invalid, negative, and zero-quota values into nulls', () => {
    expect(summarizeStorageEstimate({ usage: -1, quota: 100 })).toMatchObject({
      supported: true,
      usageBytes: null,
      quotaBytes: 100,
      ratio: null,
      percent: null,
      warning: false,
    });

    expect(summarizeStorageEstimate({ usage: Number.NaN, quota: 100 }).usageBytes).toBeNull();
    expect(summarizeStorageEstimate({ usage: 10, quota: 0 })).toMatchObject({
      ratio: null,
      percent: null,
      warning: false,
    });

    expect(summarizeStorageEstimate({})).toMatchObject({
      supported: true,
      usageBytes: null,
      quotaBytes: null,
      warning: false,
    });
  });

  it('reports a missing estimate API as unsupported', async () => {
    expect(summarizeStorageEstimate(null)).toEqual(UNKNOWN_STORAGE_ESTIMATE);
    expect(summarizeStorageEstimate(undefined)).toEqual(UNKNOWN_STORAGE_ESTIMATE);
    expect(await readStorageEstimate(null)).toEqual(UNKNOWN_STORAGE_ESTIMATE);
    expect(await readStorageEstimate({})).toEqual(UNKNOWN_STORAGE_ESTIMATE);
  });

  it('reads a real estimator and turns a rejected estimate into unsupported', async () => {
    const estimate = vi.fn().mockResolvedValue({ usage: 512, quota: 1024 });
    const snapshot = await readStorageEstimate({ estimate });

    expect(snapshot).toMatchObject({ supported: true, usageBytes: 512, quotaBytes: 1024 });
    expect(snapshot.percent).toBe(50);
    expect(estimate).toHaveBeenCalledTimes(1);

    const failing = vi.fn().mockRejectedValue(new Error('estimate unavailable'));
    expect(await readStorageEstimate({ estimate: failing })).toEqual(UNKNOWN_STORAGE_ESTIMATE);
  });

  it('formats byte counts with binary units and unknown values safely', () => {
    expect(formatStorageBytes(null)).toBe('Unknown');
    expect(formatStorageBytes(undefined)).toBe('Unknown');
    expect(formatStorageBytes(Number.NaN)).toBe('Unknown');
    expect(formatStorageBytes(-1)).toBe('Unknown');
    expect(formatStorageBytes(0)).toBe('0 B');
    expect(formatStorageBytes(512)).toBe('512 B');
    expect(formatStorageBytes(1024)).toBe('1 KB');
    expect(formatStorageBytes(1536)).toBe('1.5 KB');
    expect(formatStorageBytes(1024 * 1024)).toBe('1 MB');
    expect(formatStorageBytes(100 * 1024 * 1024)).toBe('100 MB');
    expect(formatStorageBytes(1024 * 1024 * 1024 * 1.5)).toBe('1.5 GB');
  });
});
