/**
 * React binding for the in-memory recall scratch store.
 *
 * The hook is deliberately thin: it selects the scratch array, count, and
 * boolean from the vanilla store and exposes stable action wrappers. It imports
 * no repository, Dexie, localStorage, or PixiJS module, so drawing and removing
 * a scratch string cannot reach storage through this path.
 */

import { useMemo } from 'react';
import { useStore } from 'zustand';

import {
  recallStore,
  selectHasScratch,
  selectScratchConnections,
  selectScratchCount,
} from './recallStore';
import type {
  AddScratchConnectionResult,
  RecallStoreApi,
  ScratchConnection,
  ScratchConnectionInput,
} from './recallStore';

export interface UseScratchConnectionsOptions {
  /** Injected store for component tests and isolated recall screens. */
  readonly store?: RecallStoreApi | undefined;
}

export interface UseScratchConnectionsResult {
  readonly store: RecallStoreApi;
  readonly scratchConnections: readonly ScratchConnection[];
  readonly count: number;
  readonly hasScratch: boolean;
  readonly addScratch: (input: ScratchConnectionInput) => AddScratchConnectionResult;
  /** Convenience wrapper for the thread-anchor drop, which has no type. */
  readonly addScratchPair: (fromCardId: string, toCardId: string) => AddScratchConnectionResult;
  readonly removeScratch: (connectionId: string) => boolean;
  readonly removeScratchPair: (fromCardId: string, toCardId: string) => boolean;
  readonly resetScratch: () => void;
  readonly resetOnExit: () => void;
}

export function useScratchConnections(
  options: UseScratchConnectionsOptions = {},
): UseScratchConnectionsResult {
  const store = options.store ?? recallStore;
  const scratchConnections = useStore(store, selectScratchConnections);
  const count = useStore(store, selectScratchCount);
  const hasScratch = useStore(store, selectHasScratch);

  const actions = useMemo(
    () => ({
      addScratch: (input: ScratchConnectionInput): AddScratchConnectionResult =>
        store.getState().addScratchConnection(input),
      addScratchPair: (fromCardId: string, toCardId: string): AddScratchConnectionResult =>
        store.getState().addScratchConnection({ fromCardId, toCardId }),
      removeScratch: (connectionId: string): boolean =>
        store.getState().removeScratchConnection(connectionId),
      removeScratchPair: (fromCardId: string, toCardId: string): boolean =>
        store.getState().removeScratchConnectionForPair(fromCardId, toCardId),
      resetScratch: (): void => {
        store.getState().clearScratch();
      },
      resetOnExit: (): void => {
        store.getState().resetOnExit();
      },
    }),
    [store],
  );

  return {
    store,
    scratchConnections,
    count,
    hasScratch,
    ...actions,
  };
}
