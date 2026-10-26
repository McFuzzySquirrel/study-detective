import { useCallback, useEffect, useRef, useState } from 'react';

import {
  OcrBusyError,
  OcrCancelledError,
  OcrJobError,
  OcrTimeoutError,
  runOcrJob,
} from './ocrWorker';
import type { OcrImage, OcrJobOptions, OcrResult } from './ocrWorker';

export const OCR_STATUSES = [
  'idle',
  'loading-engine',
  'reading',
  'done',
  'failed',
  'timed-out',
  'cancelled',
] as const;

export type OcrStatus = (typeof OCR_STATUSES)[number];

export type OcrFailureCode = 'busy' | 'cancelled' | 'timeout' | 'engine' | 'read' | 'unknown';

export type OcrFailure = {
  readonly code: OcrFailureCode;
  readonly message: string;
};

export type UseOcrState = {
  readonly status: OcrStatus;
  readonly result: OcrResult | null;
  readonly error: OcrFailure | null;
  readonly progress: number | null;
};

export type UseOcrOptions = Pick<OcrJobOptions, 'timeoutMs' | 'assets' | 'createWorker' | 'now'>;

export type UseOcrApi = UseOcrState & {
  readonly isRunning: boolean;
  /**
   * Start one user-triggered read. Resolves with the result on success and
   * `null` on failure, timeout, cancellation, or a rejected second job. The
   * hook never persists anything; the caller decides when to write the card.
   */
  readonly start: (image: OcrImage) => Promise<OcrResult | null>;
  /** Abort the active job. The worker is terminated and no result is written. */
  readonly cancel: () => void;
  /** Return to idle and ignore any in-flight result. */
  readonly reset: () => void;
};

const INITIAL_STATE: UseOcrState = Object.freeze({
  status: 'idle',
  result: null,
  error: null,
  progress: null,
});

function toFailure(error: unknown): { status: OcrStatus; error: OcrFailure } {
  if (error instanceof OcrTimeoutError) {
    return {
      status: 'timed-out',
      error: { code: 'timeout', message: error.message },
    };
  }
  if (error instanceof OcrCancelledError) {
    return {
      status: 'cancelled',
      error: { code: 'cancelled', message: error.message },
    };
  }
  if (error instanceof OcrBusyError) {
    return {
      status: 'failed',
      error: { code: 'busy', message: error.message },
    };
  }
  if (error instanceof OcrJobError) {
    const code: OcrFailureCode =
      error.code === 'engine' || error.code === 'read' ? error.code : 'unknown';
    return {
      status: 'failed',
      error: { code, message: error.message },
    };
  }
  if (error instanceof Error) {
    return {
      status: 'failed',
      error: { code: 'unknown', message: error.message },
    };
  }
  return {
    status: 'failed',
    error: { code: 'unknown', message: 'OCR failed. You can retry.' },
  };
}

/**
 * React lifecycle around the single-job OCR runner.
 *
 * The hook owns the abort controller, status transitions, and unmount cleanup.
 * It deliberately does not write OCR fields to a card: the caller previews the
 * result and decides whether to fill a title or persist the text.
 */
export function useOcr(options: UseOcrOptions = {}): UseOcrApi {
  const [state, setState] = useState<UseOcrState>(INITIAL_STATE);

  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const start = useCallback(async (image: OcrImage): Promise<OcrResult | null> => {
    // A second request must not create a worker or disturb the running status.
    if (runningRef.current) {
      return null;
    }

    runningRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    abortRef.current = controller;

    if (mountedRef.current) {
      setState({ status: 'loading-engine', result: null, error: null, progress: 0 });
    }

    try {
      const result = await runOcrJob(image, {
        ...optionsRef.current,
        signal: controller.signal,
        onPhase: (phase) => {
          if (mountedRef.current && generationRef.current === generation) {
            setState((current) => ({
              ...current,
              status: phase,
              error: null,
              progress: phase === 'loading-engine' ? current.progress : null,
            }));
          }
        },
        onProgress: (progress) => {
          if (mountedRef.current && generationRef.current === generation) {
            setState((current) => ({ ...current, progress }));
          }
        },
      });

      if (mountedRef.current && generationRef.current === generation) {
        setState({ status: 'done', result, error: null, progress: 1 });
      }
      return result;
    } catch (error) {
      if (mountedRef.current && generationRef.current === generation) {
        const failure = toFailure(error);
        setState({
          status: failure.status,
          result: null,
          error: failure.error,
          progress: null,
        });
      }
      return null;
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      runningRef.current = false;
    }
  }, []);

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback((): void => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (mountedRef.current) {
      setState(INITIAL_STATE);
    }
  }, []);

  return {
    ...state,
    isRunning: state.status === 'loading-engine' || state.status === 'reading',
    start,
    cancel,
    reset,
  };
}
