import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WELCOME_SEEN_STORAGE_KEY,
  createWelcomeSeenStore,
  welcomeSeenStore,
} from '../../src/features/welcome/welcomeSeen';
import type { WelcomeStorage } from '../../src/features/welcome/welcomeSeen';

class MemoryWelcomeStorage implements WelcomeStorage {
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

function blockedStorage(): WelcomeStorage {
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

describe('welcome seen state', () => {
  it('starts unseen, persists after Enter, and resets', () => {
    const storage = new MemoryWelcomeStorage();
    const store = createWelcomeSeenStore(storage);

    expect(store.hasSeen()).toBe(false);

    store.markSeen();
    expect(store.hasSeen()).toBe(true);
    expect(storage.getItem(WELCOME_SEEN_STORAGE_KEY)).toBe('1');

    // A second store over the same storage sees the persisted flag, which is
    // the path a reload takes.
    expect(createWelcomeSeenStore(storage).hasSeen()).toBe(true);

    store.reset();
    expect(store.hasSeen()).toBe(false);
    expect(storage.getItem(WELCOME_SEEN_STORAGE_KEY)).toBeNull();
  });

  it('treats only the explicit stored value as seen', () => {
    const storage = new MemoryWelcomeStorage();
    storage.setItem(WELCOME_SEEN_STORAGE_KEY, 'true');

    expect(createWelcomeSeenStore(storage).hasSeen()).toBe(false);
  });

  it('keeps Enter working for the page session when storage is blocked', () => {
    const store = createWelcomeSeenStore(blockedStorage());

    expect(store.hasSeen()).toBe(false);
    store.markSeen();
    expect(store.hasSeen()).toBe(true);
    store.reset();
    expect(store.hasSeen()).toBe(false);
  });

  it('supports an in-memory store with no storage at all', () => {
    const store = createWelcomeSeenStore(null);

    expect(store.hasSeen()).toBe(false);
    store.markSeen();
    expect(store.hasSeen()).toBe(true);
    store.reset();
    expect(store.hasSeen()).toBe(false);
  });

  it('exposes the shared install-level store', () => {
    expect(welcomeSeenStore.hasSeen()).toBe(false);

    welcomeSeenStore.markSeen();
    expect(window.localStorage.getItem(WELCOME_SEEN_STORAGE_KEY)).toBe('1');

    welcomeSeenStore.reset();
    expect(window.localStorage.getItem(WELCOME_SEEN_STORAGE_KEY)).toBeNull();
  });
});
