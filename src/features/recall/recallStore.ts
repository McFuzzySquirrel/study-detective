/**
 * In-memory scratch layer for recall mode.
 *
 * The store owns the student's undirected scratch connections and nothing
 * else. It is intentionally ephemeral:
 *
 * - No Zustand persist middleware, IndexedDB, localStorage, repository, or
 *   backup import. Creating, drawing, checking, clearing, or exiting recall
 *   cannot reach storage because this module has no storage dependency.
 * - `resetOnExit` (and `clearScratch`) return the store to one shared empty
 *   array. A route change unmounts the page and calls `resetOnExit`; a reload
 *   starts a fresh module instance. Neither needs a blocking confirmation.
 * - The page or board scene reads the snapshot and calls these actions. The
 *   store never opens Dexie and never writes a `ConnectionRecord`.
 *
 * Canonical pair contract: one scratch string per unordered card pair. A pair
 * is identified by the domain's canonical `pairKey`, and the stored endpoints
 * are sorted so a reversed draw produces the same row.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';

import { CONNECTION_TYPES, buildPairKey } from '../../domain/model';
import type { ConnectionType } from '../../domain/model';

export interface ScratchConnection {
  /** Canonical unordered pair key; also the scratch string's stable ID. */
  readonly id: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly type: ConnectionType;
}

export interface ScratchConnectionInput {
  readonly fromCardId: string;
  readonly toCardId: string;
  /** Scratch strings default to association; the truth type is compared later. */
  readonly type?: ConnectionType;
}

export type AddScratchConnectionResult =
  | { readonly status: 'created'; readonly connection: ScratchConnection }
  | { readonly status: 'duplicate'; readonly connection: ScratchConnection }
  | { readonly status: 'invalid' };

export interface RecallState {
  /** Scratch strings in draw order; never persisted. */
  readonly scratchConnections: readonly ScratchConnection[];
}

export interface RecallActions {
  /**
   * Add an undirected scratch string. A second draw of the same pair returns
   * the existing row as `duplicate` instead of creating a duplicate.
   */
  addScratchConnection(input: ScratchConnectionInput): AddScratchConnectionResult;
  /** Remove one scratch string by its canonical pair key. */
  removeScratchConnection(connectionId: string): boolean;
  /** Remove a scratch string by either endpoint orientation. */
  removeScratchConnectionForPair(fromCardId: string, toCardId: string): boolean;
  /** Clear the scratch layer and any results associated with it. */
  clearScratch(): void;
  /** Discard every scratch trace when recall is exited or the route changes. */
  resetOnExit(): void;
}

export type RecallStore = RecallState & RecallActions;
export type RecallStoreApi = StoreApi<RecallStore>;

const EMPTY_SCRATCH_CONNECTIONS: readonly ScratchConnection[] = Object.freeze([]);
const INVALID_RESULT: AddScratchConnectionResult = Object.freeze({ status: 'invalid' });

function isConnectionType(value: unknown): value is ConnectionType {
  return typeof value === 'string' && (CONNECTION_TYPES as readonly string[]).includes(value);
}

function isEndpoint(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidPair(fromCardId: unknown, toCardId: unknown): boolean {
  return isEndpoint(fromCardId) && isEndpoint(toCardId) && fromCardId !== toCardId;
}

function orderEndpoints(
  cardIdA: string,
  cardIdB: string,
): readonly [fromCardId: string, toCardId: string] {
  return cardIdA <= cardIdB ? [cardIdA, cardIdB] : [cardIdB, cardIdA];
}

function createInitialRecallState(): RecallState {
  return {
    scratchConnections: EMPTY_SCRATCH_CONNECTIONS,
  };
}

/**
 * Create an isolated recall store. Tests and multiple simultaneous recall
 * screens use the factory; the app route uses the `recallStore` singleton.
 */
export function createRecallStore(): RecallStoreApi {
  return createStore<RecallStore>()((set, get) => ({
    ...createInitialRecallState(),

    addScratchConnection(input) {
      const { fromCardId, toCardId } = input;
      const type = input.type ?? 'association';

      if (!isValidPair(fromCardId, toCardId) || !isConnectionType(type)) {
        return INVALID_RESULT;
      }

      const pairKey = buildPairKey(fromCardId, toCardId);
      const existing = get().scratchConnections.find((connection) => connection.id === pairKey);
      if (existing !== undefined) {
        return { status: 'duplicate', connection: existing };
      }

      const [from, to] = orderEndpoints(fromCardId, toCardId);
      const connection: ScratchConnection = {
        id: pairKey,
        fromCardId: from,
        toCardId: to,
        type,
      };

      set((state) => ({
        scratchConnections: [...state.scratchConnections, connection],
      }));

      return { status: 'created', connection };
    },

    removeScratchConnection(connectionId) {
      const current = get().scratchConnections;
      const next = current.filter((connection) => connection.id !== connectionId);

      if (next.length === current.length) {
        return false;
      }

      set({ scratchConnections: next });
      return true;
    },

    removeScratchConnectionForPair(fromCardId, toCardId) {
      if (!isValidPair(fromCardId, toCardId)) {
        return false;
      }

      return get().removeScratchConnection(buildPairKey(fromCardId, toCardId));
    },

    clearScratch() {
      set({ scratchConnections: EMPTY_SCRATCH_CONNECTIONS });
    },

    resetOnExit() {
      set(createInitialRecallState());
    },
  }));
}

/** The application's recall scratch store. Never persisted. */
export const recallStore: RecallStoreApi = createRecallStore();

/*
 * Selectors return primitives or existing references so React consumption
 * allocates no new object per render.
 */

export const selectScratchConnections = (state: RecallState): readonly ScratchConnection[] =>
  state.scratchConnections;

export const selectScratchCount = (state: RecallState): number => state.scratchConnections.length;

export const selectHasScratch = (state: RecallState): boolean =>
  state.scratchConnections.length > 0;

export const selectScratchConnection = (
  state: RecallState,
  connectionId: string,
): ScratchConnection | null =>
  state.scratchConnections.find((connection) => connection.id === connectionId) ?? null;
