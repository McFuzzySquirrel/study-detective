import { useCallback, useEffect, useRef, useState } from 'react';

import type { CaseRepositoryPort } from '../../data/caseRepository';
import type { CaseRecord } from '../../domain/model';
import type { Clock } from '../../domain/ids';
import { nowIso, systemClock } from '../../domain/ids';

/**
 * The first-backup reminder.
 *
 * A case becomes worth backing up once it reaches five cards and at least one
 * connection. The reminder appears once, never blocks editing, and is dismissed
 * permanently for that case by writing `backupPromptedAt`. A successful export
 * writes the same timestamp through `complete`. The hook reads only through the
 * repository boundary and never derives readiness or counts into client state.
 */

export const BACKUP_REMINDER_MIN_CARDS = 5;
export const BACKUP_REMINDER_MIN_CONNECTIONS = 1;

export type UseBackupReminderOptions = {
  readonly repository: CaseRepositoryPort | null;
  readonly caseId: string;
  /** Defaults to true; false leaves the reminder hidden without a write. */
  readonly enabled?: boolean;
  /** Injected for deterministic timestamp assertions. */
  readonly clock?: Clock;
};

export type BackupReminder = {
  /** True only after the case was read and met every threshold. */
  readonly visible: boolean;
  /** True until the first repository read finishes. */
  readonly loading: boolean;
  /** True while a dismissal or completion write is in flight. */
  readonly saving: boolean;
  /** A recovery message when the timestamp could not be persisted. */
  readonly error: string | null;
  /** Persist the dismissal and hide the banner. */
  readonly dismiss: () => Promise<boolean>;
  /** Persist completion after a successful export and hide the banner. */
  readonly complete: () => Promise<boolean>;
  /** Re-read the case and counts, for a board that changed in place. */
  readonly refresh: () => void;
};

export async function persistBackupPromptedAt(
  repository: CaseRepositoryPort,
  caseId: string,
  clock: Clock = systemClock,
): Promise<CaseRecord> {
  return repository.updateCase(caseId, { backupPromptedAt: nowIso(clock) });
}

function reminderEligible(
  record: CaseRecord | null,
  cardCount: number,
  connectionCount: number,
): boolean {
  return (
    record !== null &&
    record.backupPromptedAt === null &&
    cardCount >= BACKUP_REMINDER_MIN_CARDS &&
    connectionCount >= BACKUP_REMINDER_MIN_CONNECTIONS
  );
}

export function useBackupReminder({
  repository,
  caseId,
  enabled = true,
  clock,
}: UseBackupReminderOptions): BackupReminder {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const writeInFlightRef = useRef(false);
  const clockRef = useRef<Clock>(clock ?? systemClock);

  useEffect(() => {
    clockRef.current = clock ?? systemClock;
  }, [clock]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      // Defer the first state update so the effect only subscribes to the
      // repository read; it never causes a synchronous cascading render.
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      if (!enabled || repository === null || caseId.length === 0) {
        setVisible(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [record, cards, connections] = await Promise.all([
          repository.getCase(caseId),
          repository.listCards(caseId),
          repository.listConnections(caseId),
        ]);

        if (cancelled) {
          return;
        }
        setVisible(reminderEligible(record, cards.length, connections.length));
        setLoading(false);
      } catch {
        if (cancelled) {
          return;
        }
        // A failed read must never invent a reminder or an error banner. The
        // board's own load/error state already reports the database problem.
        setVisible(false);
        setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [caseId, enabled, reloadToken, repository]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (repository === null || caseId.length === 0 || writeInFlightRef.current) {
      return false;
    }

    writeInFlightRef.current = true;
    setSaving(true);
    setError(null);

    try {
      await persistBackupPromptedAt(repository, caseId, clockRef.current);
      setVisible(false);
      return true;
    } catch {
      setError('The backup reminder could not be saved. The case itself is unchanged. Try again.');
      return false;
    } finally {
      writeInFlightRef.current = false;
      setSaving(false);
    }
  }, [caseId, repository]);

  const dismiss = useCallback((): Promise<boolean> => persist(), [persist]);
  const complete = useCallback((): Promise<boolean> => persist(), [persist]);

  const refresh = useCallback((): void => {
    setReloadToken((token) => token + 1);
  }, []);

  return { visible, loading, saving, error, dismiss, complete, refresh };
}

export default useBackupReminder;
