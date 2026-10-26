import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OCR_ENGINE_VERSION } from '../../src/features/ocr/ocrAssets';
import {
  OCR_TIMEOUT_MS,
  OcrBusyError,
  OcrCancelledError,
  runOcrJob,
} from '../../src/features/ocr/ocrWorker';
import type { OcrResult, OcrWorkerLike } from '../../src/features/ocr/ocrWorker';
import { useOcr } from '../../src/features/ocr/useOcr';

const image = new Blob(['fixture'], { type: 'image/png' });

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeWorker({
  recognize = vi.fn(async () => ({
    data: { text: '  Cell membrane  \n', confidence: 91.5 },
  })),
  terminate = vi.fn(async () => undefined),
}: {
  recognize?: OcrWorkerLike['recognize'];
  terminate?: OcrWorkerLike['terminate'];
} = {}) {
  const worker: OcrWorkerLike = { recognize, terminate };
  return { worker, recognize, terminate };
}

describe('useOcr', () => {
  it('runs one user-triggered job and returns stored OCR metadata', async () => {
    const { worker, terminate } = makeWorker();
    const createWorker = vi.fn(async () => worker);
    const { result } = renderHook(() => useOcr({ createWorker }));

    let output: OcrResult | null = null;
    await act(async () => {
      output = await result.current.start(image);
    });

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('done');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBe(1);
    expect(output).toMatchObject({
      text: 'Cell membrane',
      confidence: 91.5,
      engineVersion: OCR_ENGINE_VERSION,
    });
    const storedResult = result.current.result;
    if (storedResult === null) {
      throw new Error('expected an OCR result');
    }
    expect(new Date(storedResult.updatedAt).toISOString()).toBe(storedResult.updatedAt);
    expect(storedResult).toEqual(output);
  });

  it('rejects a second request without creating a second worker', async () => {
    const gate = deferred<OcrWorkerLike>();
    const { worker } = makeWorker();
    const createWorker = vi.fn(() => gate.promise);
    const { result } = renderHook(() => useOcr({ createWorker }));

    let first: Promise<OcrResult | null> = Promise.resolve(null);
    act(() => {
      first = result.current.start(image);
    });
    await waitFor(() => expect(result.current.status).toBe('loading-engine'));

    let second: OcrResult | null | undefined;
    await act(async () => {
      second = await result.current.start(image);
    });

    expect(second).toBeNull();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('loading-engine');

    gate.resolve(worker);
    await act(async () => {
      await first;
    });
    expect(result.current.status).toBe('done');
  });

  it('holds the global slot so two runners cannot start together', async () => {
    const gate = deferred<OcrWorkerLike>();
    const { worker } = makeWorker();
    const first = runOcrJob(image, { createWorker: () => gate.promise });

    await expect(
      runOcrJob(image, { createWorker: vi.fn(async () => makeWorker().worker) }),
    ).rejects.toBeInstanceOf(OcrBusyError);

    gate.resolve(worker);
    await expect(first).resolves.toMatchObject({ text: 'Cell membrane' });
  });

  it('does not create a worker for an already-aborted signal', async () => {
    const createWorker = vi.fn(async () => makeWorker().worker);
    const controller = new AbortController();
    controller.abort();

    await expect(
      runOcrJob(image, { signal: controller.signal, createWorker }),
    ).rejects.toBeInstanceOf(OcrCancelledError);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('cancels promptly, terminates the worker, and drops a late result', async () => {
    const recognizeGate = deferred<{
      data: { text: string; confidence: number };
    }>();
    const recognize = vi.fn(() => recognizeGate.promise);
    const { worker, terminate } = makeWorker({ recognize });
    const { result } = renderHook(() => useOcr({ createWorker: async () => worker }));

    let job: Promise<OcrResult | null> = Promise.resolve(null);
    act(() => {
      job = result.current.start(image);
    });
    await waitFor(() => expect(result.current.status).toBe('reading'));

    const cancelledAt = Date.now();
    await act(async () => {
      result.current.cancel();
      await job;
    });

    expect(Date.now() - cancelledAt).toBeLessThan(1000);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('cancelled');
    expect(result.current.error?.code).toBe('cancelled');
    expect(result.current.result).toBeNull();

    recognizeGate.resolve({ data: { text: 'late text', confidence: 99 } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe('cancelled');
    expect(result.current.result).toBeNull();
  });

  it('times out at the configured bound and terminates the worker', async () => {
    expect(OCR_TIMEOUT_MS).toBe(60_000);

    const recognize = vi.fn(() => new Promise<never>(() => {}));
    const { worker, terminate } = makeWorker({ recognize });
    const { result } = renderHook(() =>
      useOcr({ timeoutMs: 40, createWorker: async () => worker }),
    );

    let job: Promise<OcrResult | null> = Promise.resolve(null);
    act(() => {
      job = result.current.start(image);
    });
    const timedOutAt = Date.now();
    await act(async () => {
      await job;
    });

    expect(Date.now() - timedOutAt).toBeLessThan(1000);
    expect(result.current.status).toBe('timed-out');
    expect(result.current.error?.code).toBe('timeout');
    expect(result.current.result).toBeNull();
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('leaves state unchanged on failure and allows a retry', async () => {
    const { worker, terminate } = makeWorker();
    let attempts = 0;
    const createWorker = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('worker asset missing');
      }
      return worker;
    });
    const { result } = renderHook(() => useOcr({ createWorker }));

    let failed: OcrResult | null = null;
    await act(async () => {
      failed = await result.current.start(image);
    });

    expect(failed).toBeNull();
    expect(result.current.status).toBe('failed');
    expect(result.current.error?.code).toBe('engine');
    expect(result.current.result).toBeNull();
    expect(terminate).not.toHaveBeenCalled();

    let retried: OcrResult | null = null;
    await act(async () => {
      retried = await result.current.start(image);
    });

    expect(retried).toMatchObject({ text: 'Cell membrane' });
    expect(result.current.status).toBe('done');
    expect(result.current.error).toBeNull();
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('terminates an in-flight worker when the hook unmounts', async () => {
    const recognizeGate = deferred<{
      data: { text: string; confidence: number };
    }>();
    const recognize = vi.fn(() => recognizeGate.promise);
    const { worker, terminate } = makeWorker({ recognize });
    const { result, unmount } = renderHook(() => useOcr({ createWorker: async () => worker }));

    let job: Promise<OcrResult | null> = Promise.resolve(null);
    act(() => {
      job = result.current.start(image);
    });
    await waitFor(() => expect(result.current.status).toBe('reading'));

    act(() => {
      unmount();
    });

    expect(terminate).toHaveBeenCalledTimes(1);
    await act(async () => {
      await job;
    });

    recognizeGate.resolve({ data: { text: 'late text', confidence: 99 } });
  });

  it('resets to idle and ignores a result from the abandoned run', async () => {
    const recognizeGate = deferred<{
      data: { text: string; confidence: number };
    }>();
    const recognize = vi.fn(() => recognizeGate.promise);
    const { worker, terminate } = makeWorker({ recognize });
    const { result } = renderHook(() => useOcr({ createWorker: async () => worker }));

    let job: Promise<OcrResult | null> = Promise.resolve(null);
    act(() => {
      job = result.current.start(image);
    });
    await waitFor(() => expect(result.current.status).toBe('reading'));

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(terminate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await job;
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
  });
});
