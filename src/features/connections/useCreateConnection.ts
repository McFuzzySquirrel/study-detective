/**
 * Connection creation for the case board.
 *
 * This hook is the board-adjacent creation boundary. The canvas emits a plain
 * drop (source card, target card, and the pointer's client point); the hook
 * validates the pair, writes through `ConnectionRepository`, selects the
 * resulting string in the board store, and opens the small type menu.
 *
 * It never imports PixiJS, opens Dexie, or writes an attachment. The repository
 * is injected (or lazily resolved by the page) so a component test can prove
 * duplicate and eligibility behavior without a browser database.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { boardStore } from '../../board/boardStore';
import type { BoardStoreApi } from '../../board/boardStore';
import type { ConnectionRepositoryPort } from '../../data/connectionRepository';
import { findConnectionForPair, isProvenanceEligible } from '../../domain/connections';
import type { CardType, ConnectionRecord, ConnectionType } from '../../domain/model';

/** A client-space coordinate for the small type menu. */
export interface ConnectionMenuPoint {
  readonly x: number;
  readonly y: number;
}

/** The minimum card shape this hook needs; the page passes full records. */
export interface ConnectionCardRef {
  readonly id: string;
  readonly title: string;
  readonly type: CardType;
}

export interface ConnectionMenuState {
  readonly connectionId: string;
  readonly type: ConnectionType;
  readonly fromCardId: string;
  readonly toCardId: string;
  /** True only for one Study Note and one Source. */
  readonly provenanceEligible: boolean;
  /** The explanation shown next to the disabled provenance option. */
  readonly provenanceReason: string;
  readonly point: ConnectionMenuPoint | null;
}

export type ConnectionFeedbackTone = 'info' | 'success' | 'error';

export interface ConnectionFeedback {
  readonly message: string;
  readonly tone: ConnectionFeedbackTone;
}

export interface ConnectionDropInput {
  readonly fromCardId: string;
  /** Null when the pointer was released on empty cork. */
  readonly toCardId: string | null;
  readonly point?: ConnectionMenuPoint | null;
}

export type ConnectionRequestStatus = 'created' | 'duplicate' | 'self' | 'empty' | 'error' | 'busy';

export interface ConnectionRequestOutcome {
  readonly status: ConnectionRequestStatus;
  readonly connection?: ConnectionRecord;
}

export interface UseCreateConnectionOptions {
  readonly caseId: string;
  readonly cards: readonly ConnectionCardRef[];
  readonly connections: readonly ConnectionRecord[];
  /** Direct repository for tests and composition. */
  readonly repository?: ConnectionRepositoryPort | null;
  /** Lazy repository opener used by the routed page; resolved on first write. */
  readonly loadRepository?: () => Promise<ConnectionRepositoryPort | null>;
  /** Defaults to the application board store. */
  readonly store?: BoardStoreApi;
  readonly onConnectionCreated?: (connection: ConnectionRecord) => void;
  readonly onConnectionChanged?: (connection: ConnectionRecord) => void;
}

export interface UseCreateConnectionResult {
  readonly menu: ConnectionMenuState | null;
  readonly feedback: ConnectionFeedback | null;
  readonly busy: boolean;
  readonly requestConnection: (input: ConnectionDropInput) => Promise<ConnectionRequestOutcome>;
  readonly selectConnectionType: (type: ConnectionType) => Promise<void>;
  readonly dismissMenu: () => void;
  readonly clearFeedback: () => void;
}

export const PROVENANCE_INELIGIBLE_REASON =
  'Provenance is only available between one Study Note and one Source.';

export const PROVENANCE_ELIGIBLE_REASON =
  'Provenance is available because this pair is a Study Note and a Source.';

export const EMPTY_CONNECTION_MESSAGE =
  'Drop the thread on another card to connect them. Nothing was created.';

export const SELF_CONNECTION_MESSAGE =
  'A card cannot link to itself. Drop the thread on a different card.';

export const DUPLICATE_CONNECTION_MESSAGE =
  'These two cards already have a thread. Selected the existing connection instead of creating another.';

export const CONNECTION_SAVE_ERROR =
  'The connection could not be saved. Your cards are unchanged; try again.';

const CARD_TYPE_LABELS: Record<CardType, string> = {
  note: 'Study Note',
  source: 'Source',
  topic: 'Topic',
};

/** The reason announced beside a disabled provenance option. */
export function provenanceReasonFor(fromType?: CardType, toType?: CardType): string {
  if (fromType === undefined || toType === undefined) {
    return PROVENANCE_INELIGIBLE_REASON;
  }

  return `${PROVENANCE_INELIGIBLE_REASON} This pair is ${CARD_TYPE_LABELS[fromType]} to ${CARD_TYPE_LABELS[toType]}.`;
}

/** True only when both cards exist and form a Note/Source pair. */
export function isProvenancePair(
  fromCard: ConnectionCardRef | undefined,
  toCard: ConnectionCardRef | undefined,
): boolean {
  if (fromCard === undefined || toCard === undefined) {
    return false;
  }
  return isProvenanceEligible(fromCard.type, toCard.type);
}

/** Build the menu state from a persisted connection and the live cards. */
export function connectionMenuFor(
  connection: ConnectionRecord,
  cards: readonly ConnectionCardRef[],
  point: ConnectionMenuPoint | null,
): ConnectionMenuState {
  const fromCard = cards.find((card) => card.id === connection.fromCardId);
  const toCard = cards.find((card) => card.id === connection.toCardId);
  const eligible = isProvenancePair(fromCard, toCard);

  return {
    connectionId: connection.id,
    type: connection.type,
    fromCardId: connection.fromCardId,
    toCardId: connection.toCardId,
    provenanceEligible: eligible,
    provenanceReason: eligible
      ? PROVENANCE_ELIGIBLE_REASON
      : provenanceReasonFor(fromCard?.type, toCard?.type),
    point,
  };
}

/** Create and retype the board's strings through the injected repository. */
export function useCreateConnection(
  options: UseCreateConnectionOptions,
): UseCreateConnectionResult {
  const [menu, setMenu] = useState<ConnectionMenuState | null>(null);
  const [feedback, setFeedback] = useState<ConnectionFeedback | null>(null);
  const [busy, setBusy] = useState(false);

  const optionsRef = useRef(options);
  const menuRef = useRef<ConnectionMenuState | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const applyMenu = useCallback((next: ConnectionMenuState | null): void => {
    menuRef.current = next;
    setMenu(next);
  }, []);

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

  const store = useCallback((): BoardStoreApi => {
    return optionsRef.current.store ?? boardStore;
  }, []);

  const requestConnection = useCallback(
    async (input: ConnectionDropInput): Promise<ConnectionRequestOutcome> => {
      if (busyRef.current) {
        return { status: 'busy' };
      }

      busyRef.current = true;
      setBusy(true);
      setFeedback(null);
      // A new pull replaces any menu left open for a previous string.
      applyMenu(null);

      try {
        const current = optionsRef.current;

        if (input.toCardId === null) {
          setFeedback({ message: EMPTY_CONNECTION_MESSAGE, tone: 'info' });
          return { status: 'empty' };
        }

        if (input.toCardId === input.fromCardId) {
          setFeedback({ message: SELF_CONNECTION_MESSAGE, tone: 'info' });
          return { status: 'self' };
        }

        const fromCard = current.cards.find((card) => card.id === input.fromCardId);
        const toCard = current.cards.find((card) => card.id === input.toCardId);
        if (fromCard === undefined || toCard === undefined) {
          setFeedback({ message: CONNECTION_SAVE_ERROR, tone: 'error' });
          return { status: 'error' };
        }

        // Check the live snapshot first so a duplicate never reaches storage.
        const existing = findConnectionForPair(
          current.connections,
          input.fromCardId,
          input.toCardId,
        );
        if (existing !== undefined) {
          store().getState().selectConnection(existing.id);
          setFeedback({ message: DUPLICATE_CONNECTION_MESSAGE, tone: 'info' });
          return { status: 'duplicate', connection: existing };
        }

        const repository = await resolveRepository();
        if (repository === null) {
          setFeedback({ message: CONNECTION_SAVE_ERROR, tone: 'error' });
          return { status: 'error' };
        }

        const result = await repository.create({
          caseId: current.caseId,
          fromCardId: input.fromCardId,
          toCardId: input.toCardId,
          type: 'association',
        });

        if (result.status === 'duplicate') {
          // The page's snapshot was stale (for example another tab created the
          // string); teaching it the existing row keeps the board in sync.
          current.onConnectionChanged?.(result.connection);
          store().getState().selectConnection(result.connection.id);
          setFeedback({ message: DUPLICATE_CONNECTION_MESSAGE, tone: 'info' });
          return { status: 'duplicate', connection: result.connection };
        }

        current.onConnectionCreated?.(result.connection);
        store().getState().selectConnection(result.connection.id);
        applyMenu(connectionMenuFor(result.connection, current.cards, input.point ?? null));

        return { status: 'created', connection: result.connection };
      } catch {
        setFeedback({ message: CONNECTION_SAVE_ERROR, tone: 'error' });
        return { status: 'error' };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applyMenu, resolveRepository, store],
  );

  const selectConnectionType = useCallback(
    async (type: ConnectionType): Promise<void> => {
      const currentMenu = menuRef.current;
      if (currentMenu === null || type === currentMenu.type) {
        return;
      }

      if (type === 'provenance' && !currentMenu.provenanceEligible) {
        setFeedback({ message: currentMenu.provenanceReason, tone: 'info' });
        return;
      }

      if (busyRef.current) {
        return;
      }

      busyRef.current = true;
      setBusy(true);
      setFeedback(null);

      // The radio changes immediately so a pointer or keyboard check is not
      // waiting on IndexedDB. A failed write reverts to the stored type.
      applyMenu({ ...currentMenu, type });

      try {
        const repository = await resolveRepository();
        if (repository === null) {
          applyMenu(currentMenu);
          setFeedback({ message: CONNECTION_SAVE_ERROR, tone: 'error' });
          return;
        }

        const updated = await repository.retype(currentMenu.connectionId, type);
        optionsRef.current.onConnectionChanged?.(updated);

        // The menu may have been dismissed while the write was in flight; only
        // update the menu that still represents this connection.
        const latest = menuRef.current;
        if (latest !== null && latest.connectionId === currentMenu.connectionId) {
          applyMenu({ ...latest, type: updated.type });
        }
      } catch {
        const latest = menuRef.current;
        if (latest !== null && latest.connectionId === currentMenu.connectionId) {
          applyMenu({ ...latest, type: currentMenu.type });
        }
        setFeedback({ message: CONNECTION_SAVE_ERROR, tone: 'error' });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applyMenu, resolveRepository],
  );

  const dismissMenu = useCallback((): void => {
    applyMenu(null);
  }, [applyMenu]);

  const clearFeedback = useCallback((): void => {
    setFeedback(null);
  }, []);

  return {
    menu,
    feedback,
    busy,
    requestConnection,
    selectConnectionType,
    dismissMenu,
    clearFeedback,
  };
}
