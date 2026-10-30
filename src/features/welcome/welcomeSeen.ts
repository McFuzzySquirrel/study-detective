/**
 * Install-local "welcome seen" state.
 *
 * The welcome screen is a first-run landing surface, not a route the student
 * has to keep dismissing. A single flag lives in `localStorage`; when storage
 * is blocked the store keeps the flag in memory so Enter still takes the
 * student into the app for the rest of the page session.
 *
 * The store is injectable for component tests and for composition. Reads
 * consult storage on every call rather than caching at module load, so a click
 * on Enter is visible to the redirect gate in the same render pass.
 */

export const WELCOME_SEEN_STORAGE_KEY = 'notes-detective.welcome.seen';

/** The narrow storage surface the welcome store needs, for test injection. */
export type WelcomeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface WelcomeSeenStore {
  hasSeen(): boolean;
  markSeen(): void;
  /** Test and Settings support: make the first-run welcome eligible again. */
  reset(): void;
}

function resolveWelcomeStorage(): WelcomeStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createWelcomeSeenStore(
  storage: WelcomeStorage | null = resolveWelcomeStorage(),
): WelcomeSeenStore {
  // A blocked or removed storage implementation must not make Enter a no-op;
  // the in-memory flag keeps the current page session moving.
  let seenInMemory = false;

  return {
    hasSeen() {
      if (storage === null) {
        return seenInMemory;
      }

      try {
        const stored = storage.getItem(WELCOME_SEEN_STORAGE_KEY) === '1';
        return stored || seenInMemory;
      } catch {
        return seenInMemory;
      }
    },
    markSeen() {
      seenInMemory = true;

      if (storage === null) {
        return;
      }

      try {
        storage.setItem(WELCOME_SEEN_STORAGE_KEY, '1');
      } catch {
        // The in-memory flag still prevents a redirect loop in this session.
      }
    },
    reset() {
      seenInMemory = false;

      if (storage === null) {
        return;
      }

      try {
        storage.removeItem(WELCOME_SEEN_STORAGE_KEY);
      } catch {
        // Nothing else can be done; the next reload starts from the flag.
      }
    },
  };
}

/** Shared install-level store used by the gate and the welcome route. */
export const welcomeSeenStore: WelcomeSeenStore = createWelcomeSeenStore();
