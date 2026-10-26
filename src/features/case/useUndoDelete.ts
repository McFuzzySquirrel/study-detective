import { useCallback, useEffect, useRef, useState } from 'react';

import type { CaseRepositoryPort } from '../../data/caseRepository';
import { deleteCard as deleteCardRecord, restoreDeletedCard } from '../../data/deleteCard';
import type { CardDeletionSnapshot } from '../../data/deleteCard';

/** The single-level undo window from BOARD-FR-08. */
export const UNDO_DELETE_TIMEOUT_MS = 8_000;

/** The facts the undo toast announces after a card is removed. */
export type PendingCardDeletion = {
  readonly cardId: string;
  readonly title: string;
  readonly stringCount: number;
  readonly attachmentCount: number;
};

type PendingState = {
  readonly snapshot: CardDeletionSnapshot;
  readonly info: PendingCardDeletion;
};

export interface UseUndoDeleteOptions {
  /** The open repository, or null while the route is still loading. */
  readonly repository: CaseRepositoryPort | null;
  /** Override for deterministic tests; production uses the 8-second contract. */
  readonly timeoutMs?: number;
  /** Called after a confirmed deletion, so the list can drop the row. */
  readonly onDeleted?: (snapshot: CardDeletionSnapshot) => void;
  /** Called after a successful undo, so the list can put the row back. */
  readonly onRestored?: (snapshot: CardDeletionSnapshot) => void;
}

export interface UseUndoDeleteResult {
  /** The current undo slot. A second delete or the timeout clears it. */
  readonly pending: PendingCardDeletion | null;
  /** Polite live-region copy for the toast, or null when nothing is pending. */
  readonly message: string | null;
  readonly deleting: boolean;
  readonly undoing: boolean;
  /**
   * Read a snapshot, delete the card, and open one 8-second undo slot. A
   * previous slot is discarded before the new deletion starts. Resolves to null
   * when the card was already gone.
   */
  readonly deleteWithUndo: (cardId: string) => Promise<CardDeletionSnapshot | null>;
  /** Restore the pending snapshot. Resolves false when there is nothing to undo. */
  readonly undo: () => Promise<boolean>;
  /** Close the undo window without restoring; no redo remains. */
  readonly dismiss: () => void;
}

function deletionMessage(info: PendingCardDeletion): string {
  const strings = `${info.stringCount} ${info.stringCount === 1 ? 'string' : 'strings'}`;
  return `Card deleted: “${info.title}”. ${strings} removed. Undo within 8 seconds.`;
}

/**
 * Owns the single-level delete undo.
 *
 * State is memory-only: the snapshot disappears on timeout, on dismiss, and
 * before a second deletion. There is deliberately no redo stack, and a failed
 * restore keeps the snapshot reachable for one more attempt instead of claiming
 * the card came back.
 */
export function useUndoDelete({
  repository,
  timeoutMs = UNDO_DELETE_TIMEOUT_MS,
  onDeleted,
  onRestored,
}: UseUndoDeleteOptions): UseUndoDeleteResult {
  const [pendingState, setPendingState] = useState<PendingState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearSlot = useCallback((): void => {
    clearTimer();
    setPendingState(null);
  }, [clearTimer]);

  const openSlot = useCallback(
    (next: PendingState): void => {
      clearTimer();
      setPendingState(next);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        // The 8-second window is the whole undo contract. Once it closes the
        // snapshot is unreachable; a later deletion starts a new slot.
        setPendingState(null);
      }, timeoutMs);
    },
    [clearTimer, timeoutMs],
  );

  useEffect(
    () => () => {
      clearTimer();
    },
    [clearTimer],
  );

  const deleteWithUndo = useCallback(
    async (cardId: string): Promise<CardDeletionSnapshot | null> => {
      const target = repository;
      if (target === null) {
        throw new Error('The case repository is not open.');
      }

      // A second delete replaces the first slot immediately; the older card
      // cannot be restored afterwards.
      clearSlot();
      setDeleting(true);

      try {
        const snapshot = await deleteCardRecord(target, cardId);
        if (snapshot === null) {
          return null;
        }

        openSlot({
          snapshot,
          info: {
            cardId: snapshot.card.id,
            title: snapshot.card.title,
            stringCount: snapshot.connections.length,
            attachmentCount: snapshot.attachments.length,
          },
        });
        onDeleted?.(snapshot);
        return snapshot;
      } finally {
        setDeleting(false);
      }
    },
    [clearSlot, onDeleted, openSlot, repository],
  );

  const undo = useCallback(async (): Promise<boolean> => {
    const target = repository;
    const current = pendingState;

    if (target === null || current === null) {
      return false;
    }

    // Close the slot before awaiting so a double activation cannot restore the
    // same snapshot twice. A failure reopens it for one more attempt.
    clearTimer();
    setPendingState(null);
    setUndoing(true);

    try {
      await restoreDeletedCard(target, current.snapshot);
      onRestored?.(current.snapshot);
      return true;
    } catch (error) {
      openSlot(current);
      throw error;
    } finally {
      setUndoing(false);
    }
  }, [clearTimer, onRestored, openSlot, pendingState, repository]);

  const dismiss = useCallback((): void => {
    clearSlot();
  }, [clearSlot]);

  return {
    pending: pendingState?.info ?? null,
    message: pendingState === null ? null : deletionMessage(pendingState.info),
    deleting,
    undoing,
    deleteWithUndo,
    undo,
    dismiss,
  };
}
