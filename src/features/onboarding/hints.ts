/**
 * One-time hint state for the three board gestures that are easiest to miss.
 *
 * Seen state is install-local and lives in `localStorage`, so a dismissed hint
 * stays dismissed across reloads and browser restarts. The store is injectable
 * for component tests; `isSeen`, `markSeen`, `resetHint`, and `resetAll` are
 * bound to the shared production store and remain the simple API for the
 * contextual triggers wired in DEMO-3.
 *
 * A hint is not a step in a tour: the definitions are independent, unordered
 * by anything except their Settings listing, and nothing here advances from
 * one hint to the next.
 */

import { useEffect, useState } from 'react';

export const HINT_IDS = ['thread-anchor', 'long-press', 'recall'] as const;

export type HintId = (typeof HINT_IDS)[number];

export interface HintDefinition {
  readonly id: HintId;
  /** Short Settings and popover heading. */
  readonly title: string;
  /** Exactly one sentence of guidance. */
  readonly description: string;
}

export const HINT_DEFINITIONS: Record<HintId, HintDefinition> = {
  'thread-anchor': {
    id: 'thread-anchor',
    title: 'Thread anchor',
    description:
      'Drag from the pin on a card to another card to tie the two pieces of evidence together.',
  },
  'long-press': {
    id: 'long-press',
    title: 'Touch long-press',
    description:
      'On a touch screen, press and hold a card to lift it before you drag it into place.',
  },
  recall: {
    id: 'recall',
    title: 'Recall mode',
    description:
      'Open Recall to rebuild the board from memory, then check your strings against the case.',
  },
};

/** Settings order. It is a presentation order, not a tour sequence. */
export const HINTS: readonly HintDefinition[] = HINT_IDS.map((id) => HINT_DEFINITIONS[id]);

export function getHint(hintId: HintId): HintDefinition {
  return HINT_DEFINITIONS[hintId];
}

export const HINT_SEEN_STORAGE_KEY = 'notes-detective.hints.seen';

/** The narrow storage surface needed by the seen store, for test injection. */
export type HintStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface HintSeenStore {
  isSeen(hintId: HintId): boolean;
  markSeen(hintId: HintId): void;
  resetHint(hintId: HintId): void;
  resetAll(): void;
  /** Seen hints in `HINT_IDS` order, for Settings and status text. */
  getSeenHints(): readonly HintId[];
  /** Notify when this store changes its seen set. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

function resolveHintStorage(): HintStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function parseSeenHints(raw: string | null): Set<HintId> {
  if (raw === null) {
    return new Set();
  }

  try {
    const value: unknown = JSON.parse(raw);

    if (!Array.isArray(value)) {
      return new Set();
    }

    const seen = new Set<HintId>();

    HINT_IDS.forEach((hintId) => {
      if (value.includes(hintId)) {
        seen.add(hintId);
      }
    });

    return seen;
  } catch {
    return new Set();
  }
}

function orderedSeen(seen: ReadonlySet<HintId>): HintId[] {
  return HINT_IDS.filter((hintId) => seen.has(hintId));
}

/**
 * Build a seen-state store over any storage implementation.
 *
 * `null` means storage is unavailable: the store still works for the current
 * page session but cannot persist across reloads. Reads go back to storage on
 * every call, so a reset in one store is visible to another store sharing the
 * same storage (for example Settings and a later contextual trigger).
 */
export function createHintSeenStore(
  storage: HintStorage | null = resolveHintStorage(),
): HintSeenStore {
  const memory = new Set<HintId>();
  const listeners = new Set<() => void>();

  const read = (): Set<HintId> => {
    if (storage === null) {
      return new Set(memory);
    }

    try {
      const stored = parseSeenHints(storage.getItem(HINT_SEEN_STORAGE_KEY));
      // Keep hints marked while a write was failing in this page session.
      memory.forEach((hintId) => {
        stored.add(hintId);
      });
      return stored;
    } catch {
      return new Set(memory);
    }
  };

  const persist = (seen: ReadonlySet<HintId>): void => {
    if (storage === null) {
      return;
    }

    try {
      const ordered = orderedSeen(seen);

      if (ordered.length === 0) {
        storage.removeItem(HINT_SEEN_STORAGE_KEY);
      } else {
        storage.setItem(HINT_SEEN_STORAGE_KEY, JSON.stringify(ordered));
      }
    } catch {
      // The in-memory set still prevents a repeat hint in this page session.
    }
  };

  const emit = (): void => {
    listeners.forEach((listener) => {
      listener();
    });
  };

  return {
    isSeen(hintId) {
      return read().has(hintId);
    },
    markSeen(hintId) {
      const seen = read();

      if (seen.has(hintId)) {
        memory.add(hintId);
        return;
      }

      seen.add(hintId);
      memory.add(hintId);
      persist(seen);
      emit();
    },
    resetHint(hintId) {
      const seen = read();
      const changed = seen.delete(hintId);

      memory.delete(hintId);

      if (changed) {
        persist(seen);
      }
      emit();
    },
    resetAll() {
      memory.clear();
      persist(new Set());
      emit();
    },
    getSeenHints() {
      return orderedSeen(read());
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Shared install-level store. The storage reference is resolved once at module
 * load; reads still consult `localStorage` each time.
 */
export const hintSeenStore: HintSeenStore = createHintSeenStore();

export function isSeen(hintId: HintId): boolean {
  return hintSeenStore.isSeen(hintId);
}

export function markSeen(hintId: HintId): void {
  hintSeenStore.markSeen(hintId);
}

export function resetHint(hintId: HintId): void {
  hintSeenStore.resetHint(hintId);
}

export function resetAll(): void {
  hintSeenStore.resetAll();
}

/**
 * Subscribe a screen to the seen set. The returned set is replaced on every
 * store notification so React re-renders status text after mark/reset.
 */
export function useSeenHints(store: HintSeenStore = hintSeenStore): ReadonlySet<HintId> {
  const [seen, setSeen] = useState<ReadonlySet<HintId>>(() => new Set(store.getSeenHints()));

  useEffect(() => {
    const sync = (): void => {
      setSeen(new Set(store.getSeenHints()));
    };

    sync();

    return store.subscribe(sync);
  }, [store]);

  return seen;
}
