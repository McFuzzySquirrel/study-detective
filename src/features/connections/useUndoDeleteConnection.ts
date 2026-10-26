import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConnectionRepositoryPort } from '../../data/connectionRepository';
import type { ConnectionRecord, ConnectionType } from '../../domain/model';

/**
 * Connection deletion with a single-level undo.
 *
 * The board owns no repository itself: this hook receives the lazy connection
 * repository opener from the page, deletes one row, and keeps the full record
 * in memory for the contract's 8-second window. Restoring writes the same row
 * ID through `ConnectionRepository.restore`; it never creates a new connection.
 *
 * Only one slot exists. A second deletion, the timeout, or an explicit dismiss
 * clears the previous record, so an older deletion can never be undone by a
 * later one. The hook never renders a toast or moves focus; the page composes
 * the live region and the feature keeps focus recovery with the UI.
 */

/** The single-level undo window from LINK-FR-04. */
export const UNDO_DELETE_CONNECTION_TIMEOUT_MS = 8_000;

export const CONNECTION_TYPE_LABELS: Record<ConnectionType, string> = {
  association: 'Association',
  provenance: 'Provenance',
};

export function connectionTypeLabel(type: ConnectionType): string {
  return CONNECTION_TYPE_LABELS[type];
}

/** The facts the undo toast announces after a connection is removed. */
export interface ConnectionDeletionTarget {
  readonly connection: ConnectionRecord;
  readonly fromTitle: string;
  readonly toTitle: string;
}

export const CONNECTION_DELETE_ERROR =
  'The connection could not be deleted. It is still on the board; try again.';

export const CONNECTION_RESTORE_ERROR =
  'The connection could not be restored. It stays deleted; try again within the undo window.';

export interface UseUndoDeleteConnectionOptions {
  /** Direct repository for tests and composition. */
  readonly repository?: ConnectionRepositoryPort | null;
  /** Lazy opener used by the routed board; resolved on the first write. */
  readonly loadRepository?: () => Promise<ConnectionRepositoryPort | null>;
  /** Override for deterministic tests; production uses the 8-second contract. */
  readonly timeoutMs?: number;
  /** Called after a confirmed deletion, so the board can drop the string. */
  readonly onDeleted?: (connection: ConnectionRecord) => void;
  /** Called after a successful undo, so the board can put the string back. */
  readonly onRestored?: (connection: ConnectionRecord) => void;
}

export interface UseUndoDeleteConnectionResult {
  /** The current undo slot. A second delete or the timeout clears it. */
  readonly pending: ConnectionDeletionTarget | null;
  /** Polite live-region copy for the toast, or null when nothing is pending. */
  readonly message: string | null;
  readonly deleting: boolean;
  readonly undoing: boolean;
  /** A recoverable undo failure, separate from the delete confirmation error. */
  readonly error: string | null;
  /**
   * Delete one connection and open the single 8-second undo slot. Resolves
   * false when the row was already gone, in which case no undo is offered.
   */
  readonly deleteWithUndo: (target: ConnectionDeletionTarget) => Promise<boolean>;
  /** Restore the pending row with its original ID. Resolves false when empty. */
  readonly undo: () => Promise<boolean>;
  /** Close the undo window without restoring; no redo remains. */
  readonly dismiss: () => void;
  readonly clearError: () => void;
}

/** The announcement text for the undo toast. */
export function connectionDeletionMessage(target: ConnectionDeletionTarget): string {
  return `Connection deleted: “${target.fromTitle}” and “${target.toTitle}”, ${connectionTypeLabel(
    target.connection.type,
  )}. Undo within 8 seconds.`;
}

/**
 * Owns the single-level connection delete undo. State is memory-only, so a
 * reload or route change discards the slot exactly like the card undo.
 */
export function useUndoDeleteConnection(
  options: UseUndoDeleteConnectionOptions,
): UseUndoDeleteConnectionResult {
  const [pending, setPending] = useState<ConnectionDeletionTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optionsRef = useRef(options);
  const pendingRef = useRef<ConnectionDeletionTarget | null>(null);
  const timerRef = useRef<number | null>(null);
  const undoingRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const applyPending = useCallback((next: ConnectionDeletionTarget | null): void => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearSlot = useCallback((): void => {
    clearTimer();
    applyPending(null);
  }, [applyPending, clearTimer]);

  const openSlot = useCallback(
    (target: ConnectionDeletionTarget): void => {
      clearTimer();
      applyPending(target);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        // The 8-second window is the whole undo contract: after it closes the
        // record is unreachable and a later deletion starts a fresh slot.
        applyPending(null);
      }, optionsRef.current.timeoutMs ?? UNDO_DELETE_CONNECTION_TIMEOUT_MS);
    },
    [applyPending, clearTimer],
  );

  useEffect(
    () => () => {
      clearTimer();
    },
    [clearTimer],
  );

  const resolveRepository = useCallback(async (): Promise<ConnectionRepositoryPort | null> => {
    const current = optionsRef.current;
    if (current.repository !== undefined) {
      return current.repository;
    }
    if (current.loadRepository !== undefined) {
      return current.loadRepository();
    }
    return null;
  }, []);

  const deleteWithUndo = useCallback(
    async (target: ConnectionDeletionTarget): Promise<boolean> => {
      // A second deletion replaces the first slot immediately; the older row
      // cannot be restored afterwards.
      clearSlot();
      setDeleting(true);

      try {
        const repository = await resolveRepository();
        if (repository === null) {
          throw new Error('The connection repository is not open.');
        }

        const removed = await repository.delete(target.connection.id);
        if (!removed) {
          return false;
        }

        openSlot(target);
        optionsRef.current.onDeleted?.(target.connection);
        return true;
      } finally {
        setDeleting(false);
      }
    },
    [clearSlot, openSlot, resolveRepository],
  );

  const undo = useCallback(async (): Promise<boolean> => {
    const target = pendingRef.current;
    if (target === null || undoingRef.current) {
      return false;
    }

    // Close the slot before awaiting so a double activation cannot restore the
    // same record twice. A failure reopens it for one more attempt.
    undoingRef.current = true;
    clearTimer();
    applyPending(null);
    setUndoing(true);
    setError(null);

    try {
      const repository = await resolveRepository();
      if (repository === null) {
        throw new Error('The connection repository is not open.');
      }

      const restored = await repository.restore(target.connection);
      optionsRef.current.onRestored?.(restored);
      return true;
    } catch {
      openSlot(target);
      setError(CONNECTION_RESTORE_ERROR);
      return false;
    } finally {
      undoingRef.current = false;
      setUndoing(false);
    }
  }, [applyPending, clearTimer, openSlot, resolveRepository]);

  const dismiss = useCallback((): void => {
    clearSlot();
  }, [clearSlot]);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return {
    pending,
    message: pending === null ? null : connectionDeletionMessage(pending),
    deleting,
    undoing,
    error,
    deleteWithUndo,
    undo,
    dismiss,
    clearError,
  };
}
