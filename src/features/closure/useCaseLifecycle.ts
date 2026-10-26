import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CaseRepositoryPort } from '../../data/caseRepository';
import type { CaseRecord } from '../../domain/model';
import {
  closureTimestamp,
  deriveCaseLifecycle,
  type CaseLifecycle,
} from '../../domain/caseLifecycle';
import type { CaseReadiness } from '../../domain/readiness';
import { nowIso, systemClock } from '../../domain/ids';
import type { Clock } from '../../domain/ids';

/**
 * The write boundary for case closure.
 *
 * Closing and reopening are metadata edits through `CaseRepository`; the hook
 * never opens Dexie, never derives readiness itself, and never mutates the
 * case record in place. Readiness is passed in from the page, which derives it
 * once per cards/connections change.
 *
 * A failed write leaves the caller's record unchanged and reports an inline
 * error. A successful close preserves an existing `closedAt`, so re-affirming
 * closure after a repair does not rewrite the original date.
 */

export const CLOSE_CASE_ERROR = 'The case could not be closed. Nothing changed; try again.';

export const REOPEN_CASE_ERROR = 'The case could not be reopened. Nothing changed; try again.';

export const CLOSE_CASE_NOT_READY =
  'This case still has loose threads, so it cannot be closed yet.';

export interface UseCaseLifecycleOptions {
  readonly caseRecord: CaseRecord | null;
  /** Derived once by the page from cards and connections. */
  readonly readiness: CaseReadiness;
  readonly repository: CaseRepositoryPort | null;
  /** Injectable clock for deterministic closure dates in tests. */
  readonly clock?: Clock;
  /** Receives the validated record after a successful write. */
  readonly onCaseChanged?: (record: CaseRecord) => void;
}

export interface UseCaseLifecycleResult {
  readonly lifecycle: CaseLifecycle;
  readonly busy: boolean;
  readonly error: string | null;
  /** Polite success copy for the page's toast region. */
  readonly message: string | null;
  /** Returns false when the write was rejected; state is unchanged. */
  readonly closeCase: () => Promise<boolean>;
  readonly reopenCase: () => Promise<boolean>;
  readonly clearError: () => void;
  readonly clearMessage: () => void;
}

const EMPTY_READINESS = { ready: true, looseThreadCount: 0 } as const;

export function useCaseLifecycle({
  caseRecord,
  readiness,
  repository,
  clock = systemClock,
  onCaseChanged,
}: UseCaseLifecycleOptions): UseCaseLifecycleResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const optionsRef = useRef({ caseRecord, readiness, repository, clock, onCaseChanged });

  useEffect(() => {
    optionsRef.current = { caseRecord, readiness, repository, clock, onCaseChanged };
  }, [caseRecord, clock, onCaseChanged, readiness, repository]);

  const lifecycle = useMemo(
    () => deriveCaseLifecycle(caseRecord?.closedAt ?? null, readiness ?? EMPTY_READINESS),
    [caseRecord?.closedAt, readiness],
  );

  const closeCase = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) {
      return false;
    }

    const current = optionsRef.current;
    if (current.caseRecord === null || current.repository === null) {
      setError(CLOSE_CASE_ERROR);
      return false;
    }

    if (!current.readiness.ready || current.readiness.looseThreadCount > 0) {
      setError(CLOSE_CASE_NOT_READY);
      return false;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);

    const wasClosed = current.caseRecord.closedAt !== null;

    try {
      const closedAt = closureTimestamp(current.caseRecord.closedAt, nowIso(current.clock));
      const updated = await current.repository.updateCase(current.caseRecord.id, { closedAt });
      current.onCaseChanged?.(updated);
      setMessage(
        wasClosed
          ? `Closure confirmed: ${updated.title}. The original closure date is unchanged.`
          : `Case closed: ${updated.title}. It stays editable.`,
      );
      return true;
    } catch {
      setError(CLOSE_CASE_ERROR);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const reopenCase = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) {
      return false;
    }

    const current = optionsRef.current;
    if (current.caseRecord === null || current.repository === null) {
      setError(REOPEN_CASE_ERROR);
      return false;
    }

    if (current.caseRecord.closedAt === null) {
      return true;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const updated = await current.repository.updateCase(current.caseRecord.id, {
        closedAt: null,
      });
      current.onCaseChanged?.(updated);
      setMessage(`Case reopened: ${updated.title}. Nothing was archived or deleted.`);
      return true;
    } catch {
      setError(REOPEN_CASE_ERROR);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const clearError = useCallback((): void => setError(null), []);
  const clearMessage = useCallback((): void => setMessage(null), []);

  return {
    lifecycle,
    busy,
    error,
    message,
    closeCase,
    reopenCase,
    clearError,
    clearMessage,
  };
}

export default useCaseLifecycle;
