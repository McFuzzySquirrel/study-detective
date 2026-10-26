import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HINTS,
  HINT_DEFINITIONS,
  HINT_IDS,
  HINT_SEEN_STORAGE_KEY,
  createHintSeenStore,
  getHint,
  hintSeenStore,
  isSeen,
  markSeen,
  resetAll,
  resetHint,
  useSeenHints,
} from '../../src/features/onboarding/hints';
import type { HintId, HintStorage } from '../../src/features/onboarding/hints';

class MemoryHintStorage implements HintStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function blockedStorage(): HintStorage {
  const fail = (): never => {
    throw new Error('Storage is blocked');
  };

  return { getItem: fail, setItem: fail, removeItem: fail };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('hint definitions', () => {
  it('defines exactly the three independent board hints', () => {
    expect(HINT_IDS).toEqual(['thread-anchor', 'long-press', 'recall']);
    expect(HINTS.map((hint) => hint.id)).toEqual([...HINT_IDS]);
    expect(Object.keys(HINT_DEFINITIONS)).toEqual([...HINT_IDS]);
    expect(getHint('recall')).toBe(HINT_DEFINITIONS.recall);

    HINTS.forEach((hint) => {
      expect(hint.title.trim().length).toBeGreaterThan(0);
      // Each popover sentence is exactly one sentence.
      expect(hint.description.match(/[.!?]/g)).toHaveLength(1);
      expect(hint.description.trim().endsWith('.')).toBe(true);
    });
  });

  it('has no ordering, next-step, or auto-advance metadata', () => {
    HINTS.forEach((hint) => {
      expect(hint).not.toHaveProperty('next');
      expect(hint).not.toHaveProperty('step');
      expect(hint).not.toHaveProperty('sequence');
      expect(hint).not.toHaveProperty('duration');
    });
  });
});

describe('install-local seen state', () => {
  it('starts unseen and persists a marked hint across reload', () => {
    const storage = new MemoryHintStorage();
    const firstLoad = createHintSeenStore(storage);

    expect(firstLoad.isSeen('thread-anchor')).toBe(false);
    expect(firstLoad.getSeenHints()).toEqual([]);

    firstLoad.markSeen('thread-anchor');

    expect(storage.values.get(HINT_SEEN_STORAGE_KEY)).toBe(JSON.stringify(['thread-anchor']));

    const reloaded = createHintSeenStore(storage);
    expect(reloaded.isSeen('thread-anchor')).toBe(true);
    expect(reloaded.isSeen('long-press')).toBe(false);
    expect(reloaded.isSeen('recall')).toBe(false);
    expect(reloaded.getSeenHints()).toEqual(['thread-anchor']);
  });

  it('keeps seen state separate for a different install', () => {
    const firstInstall = createHintSeenStore(new MemoryHintStorage());
    const secondInstall = createHintSeenStore(new MemoryHintStorage());

    firstInstall.markSeen('recall');

    expect(firstInstall.isSeen('recall')).toBe(true);
    expect(secondInstall.isSeen('recall')).toBe(false);
  });

  it('marks each hint once and resets one hint without touching the others', () => {
    const storage = new MemoryHintStorage();
    const store = createHintSeenStore(storage);

    store.markSeen('thread-anchor');
    store.markSeen('long-press');
    store.markSeen('recall');
    store.markSeen('long-press');

    expect(store.getSeenHints()).toEqual(['thread-anchor', 'long-press', 'recall']);
    expect(storage.values.get(HINT_SEEN_STORAGE_KEY)).toBe(
      JSON.stringify(['thread-anchor', 'long-press', 'recall']),
    );

    store.resetHint('long-press');

    expect(store.getSeenHints()).toEqual(['thread-anchor', 'recall']);
    expect(store.isSeen('long-press')).toBe(false);
    expect(createHintSeenStore(storage).getSeenHints()).toEqual(['thread-anchor', 'recall']);
  });

  it('resets all seen hints and removes the storage marker', () => {
    const storage = new MemoryHintStorage();
    const store = createHintSeenStore(storage);

    HINT_IDS.forEach((hintId) => store.markSeen(hintId));
    expect(storage.values.has(HINT_SEEN_STORAGE_KEY)).toBe(true);

    store.resetAll();

    expect(store.getSeenHints()).toEqual([]);
    expect(storage.values.has(HINT_SEEN_STORAGE_KEY)).toBe(false);
    expect(createHintSeenStore(storage).getSeenHints()).toEqual([]);
  });

  it('notifies subscribers only when the seen set changes', () => {
    const store = createHintSeenStore(new MemoryHintStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.markSeen('thread-anchor');
    expect(listener).toHaveBeenCalledTimes(1);

    store.markSeen('thread-anchor');
    expect(listener).toHaveBeenCalledTimes(1);

    store.resetHint('thread-anchor');
    expect(listener).toHaveBeenCalledTimes(2);

    store.resetAll();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    store.markSeen('recall');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('ignores malformed or foreign storage values', () => {
    const storage = new MemoryHintStorage();

    storage.setItem(HINT_SEEN_STORAGE_KEY, '{not json');
    expect(createHintSeenStore(storage).getSeenHints()).toEqual([]);

    storage.setItem(HINT_SEEN_STORAGE_KEY, JSON.stringify({ recall: true }));
    expect(createHintSeenStore(storage).getSeenHints()).toEqual([]);

    storage.setItem(HINT_SEEN_STORAGE_KEY, JSON.stringify(['recall', 'unknown', 7]));
    expect(createHintSeenStore(storage).getSeenHints()).toEqual(['recall']);
  });

  it('keeps working for the page session when storage is blocked', () => {
    const store = createHintSeenStore(blockedStorage());

    expect(store.isSeen('recall')).toBe(false);

    store.markSeen('recall');
    expect(store.isSeen('recall')).toBe(true);

    store.resetHint('recall');
    expect(store.isSeen('recall')).toBe(false);

    store.markSeen('thread-anchor');
    store.markSeen('recall');
    store.resetAll();
    expect(store.getSeenHints()).toEqual([]);
  });

  it('supports an explicit memory-only store for isolated composition', () => {
    const store = createHintSeenStore(null);

    store.markSeen('long-press');

    expect(store.isSeen('long-press')).toBe(true);
    expect(store.getSeenHints()).toEqual(['long-press']);
  });
});

describe('named production API', () => {
  it('persists through localStorage and resets through the shared store', () => {
    expect(isSeen('thread-anchor')).toBe(false);

    HINT_IDS.forEach((hintId: HintId) => markSeen(hintId));

    expect(isSeen('thread-anchor')).toBe(true);
    expect(isSeen('long-press')).toBe(true);
    expect(isSeen('recall')).toBe(true);
    expect(hintSeenStore.getSeenHints()).toEqual([...HINT_IDS]);

    resetHint('long-press');
    expect(isSeen('long-press')).toBe(false);
    expect(hintSeenStore.getSeenHints()).toEqual(['thread-anchor', 'recall']);

    resetAll();
    expect(isSeen('thread-anchor')).toBe(false);
    expect(window.localStorage.getItem(HINT_SEEN_STORAGE_KEY)).toBeNull();
  });
});

describe('useSeenHints', () => {
  it('tracks marks and resets through the store subscription', () => {
    const store = createHintSeenStore(null);
    const { result } = renderHook(() => useSeenHints(store));

    expect(result.current.size).toBe(0);

    act(() => {
      store.markSeen('long-press');
    });

    expect(result.current.has('long-press')).toBe(true);
    expect(result.current.has('recall')).toBe(false);

    act(() => {
      store.resetAll();
    });

    expect(result.current.size).toBe(0);
  });
});
