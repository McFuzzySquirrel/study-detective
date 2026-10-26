/**
 * Install-level motion preference.
 *
 * The OS preference is the default and the floor: a device that asks for
 * reduced motion always gets it. The in-app Appearance toggle can additionally
 * persist an explicit "reduced" choice for a device that does not ask for it.
 * The choice is stored in `localStorage` (one install-level setting, not per
 * case) and applied to the document root as `data-motion="reduced"` or
 * `data-motion="full"`, so every stylesheet can switch in the same frame.
 *
 * Why a data attribute in addition to the media query: the media query can only
 * describe the OS. The toggle needs an immediate, same-document switch that
 * works while the page is open, without a reload. `base.css` owns both the
 * media-query fallback and the `[data-motion='reduced']` rule.
 *
 * The board renderer also reads this store. `motionBehavior()` is the shared
 * policy for the five motion categories the feature contract names: pin drop,
 * string draw, auto-pan, page transition, and pulsing indicators. The v1 board
 * draws final states, but the policy keeps the reduced-motion decision explicit
 * at the call sites instead of relying on an accidental absence of animation.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** Storage key for the explicit install-level override. */
export const MOTION_STORAGE_KEY = 'notes-detective.motion';

/** Root attribute read by `base.css` and the board chrome. */
export const MOTION_ATTRIBUTE = 'data-motion';

/** Root attribute that records whether the choice is explicit or the OS default. */
export const MOTION_PREFERENCE_ATTRIBUTE = 'data-motion-preference';

/** The persisted choice. A missing value means "follow the device". */
export type MotionPreference = 'system' | 'reduced';

/** The resolved state the UI and renderers consume. */
export type MotionState = 'reduced' | 'full';

/**
 * Named motion intents. The board mount, route chrome, and status badge apply
 * these marker classes; a single reduced-motion rule in `base.css` neutralises
 * all of them. Keeping the names in one exported tuple lets the CSS contract
 * test fail if a new animation is added without a matching guard.
 */
export const MOTION_ANIMATION_CLASSES = [
  'motion-pin-drop',
  'motion-string-draw',
  'motion-auto-pan',
  'motion-page-transition',
  'motion-pulse',
] as const;

export type MotionAnimationClass = (typeof MOTION_ANIMATION_CLASSES)[number];

/** The narrow storage surface needed here, for test injection. */
export type MotionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The narrow media-query surface needed here, for test injection. */
export interface MotionMediaQuery {
  readonly matches: boolean;
  readonly media?: string;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

export interface MotionStoreOptions {
  /** `null` means storage is unavailable; the choice lasts for the page session. */
  readonly storage?: MotionStorage | null;
  /** `null` means the platform has no motion query. */
  readonly media?: MotionMediaQuery | null;
  /** Document root that receives the attributes. */
  readonly root?: HTMLElement | null;
}

export interface MotionStore {
  /** Explicit choice, or `system` when no override is stored. */
  getPreference(): MotionPreference;
  /** True when motion must be reduced, whether by OS or explicit choice. */
  isReduced(): boolean;
  /** True when the platform asks for reduced motion. */
  isSystemReduced(): boolean;
  /**
   * Persist an explicit choice. `true` stores `reduced`; `false` clears the
   * override and returns to the device setting. A device that asks for reduced
   * motion cannot be switched to full motion here.
   */
  setReduced(reduced: boolean): void;
  /** Re-read the platform and re-apply the root attributes. */
  refresh(): void;
  /** Notify when the resolved choice changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Remove the platform listener; used by tests and long-lived embedders. */
  dispose(): void;
}

function resolveStorage(): MotionStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function resolveMedia(): MotionMediaQuery | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return null;
  }
}

function resolveRoot(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.documentElement;
}

function readStoredPreference(
  storage: MotionStorage | null,
  memory: MotionPreference | null,
): MotionPreference | null {
  if (storage === null) {
    return memory;
  }

  try {
    const stored = storage.getItem(MOTION_STORAGE_KEY);
    return stored === 'reduced' ? 'reduced' : stored === null ? memory : null;
  } catch {
    return memory;
  }
}

function persistPreference(storage: MotionStorage | null, reduced: boolean): void {
  if (storage === null) {
    return;
  }

  try {
    if (reduced) {
      storage.setItem(MOTION_STORAGE_KEY, 'reduced');
    } else {
      storage.removeItem(MOTION_STORAGE_KEY);
    }
  } catch {
    // The in-memory fallback still applies the choice for this page session.
  }
}

/**
 * Build an isolated motion store. The app uses the singleton below; tests and
 * future embedded screens inject their own storage, media, and root.
 */
export function createMotionStore(options: MotionStoreOptions = {}): MotionStore {
  const storage = options.storage === undefined ? resolveStorage() : options.storage;
  const explicitMedia = options.media !== undefined;
  let media: MotionMediaQuery | null = explicitMedia ? (options.media ?? null) : resolveMedia();
  const root = options.root === undefined ? resolveRoot() : options.root;

  const listeners = new Set<() => void>();
  let memory: MotionPreference | null = null;
  let listeningMedia: MotionMediaQuery | null = null;
  let disposed = false;

  const stored = (): MotionPreference | null => readStoredPreference(storage, memory);
  const preference = (): MotionPreference => (stored() === 'reduced' ? 'reduced' : 'system');

  const handleSystemChange = (): void => {
    notify();
  };

  /**
   * Resolve the platform query lazily. The singleton is created at module load,
   * before some test harnesses (and a few embedding hosts) install their
   * `matchMedia`; re-resolving on refresh means those hosts still get the
   * device preference without recreating the store.
   */
  const ensureMedia = (attach: boolean): MotionMediaQuery | null => {
    if (media === null && !explicitMedia) {
      media = resolveMedia();
    }

    if (attach && media !== null && listeningMedia !== media) {
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', handleSystemChange);
      } else if (typeof media.addListener === 'function') {
        media.addListener(handleSystemChange);
      }
      listeningMedia = media;
    }

    return media;
  };

  const systemReduced = (): boolean => ensureMedia(false)?.matches === true;
  const reduced = (): boolean => preference() === 'reduced' || systemReduced();

  const apply = (): void => {
    if (root === null) {
      return;
    }

    root.setAttribute(MOTION_ATTRIBUTE, reduced() ? 'reduced' : 'full');
    root.setAttribute(MOTION_PREFERENCE_ATTRIBUTE, preference());
  };

  const emit = (): void => {
    listeners.forEach((listener) => {
      listener();
    });
  };

  const notify = (): void => {
    apply();
    emit();
  };

  ensureMedia(true);

  return {
    getPreference() {
      return preference();
    },
    isReduced() {
      return reduced();
    },
    isSystemReduced() {
      return systemReduced();
    },
    setReduced(next) {
      // The platform request is the floor: an explicit "on" is still useful,
      // but an explicit "off" can never override a device that asked for less
      // motion.
      memory = next ? 'reduced' : null;
      persistPreference(storage, next);
      notify();
    },
    refresh() {
      if (!disposed) {
        ensureMedia(true);
      }
      apply();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;

      if (listeningMedia !== null) {
        if (typeof listeningMedia.removeEventListener === 'function') {
          listeningMedia.removeEventListener('change', handleSystemChange);
        } else if (typeof listeningMedia.removeListener === 'function') {
          listeningMedia.removeListener(handleSystemChange);
        }
        listeningMedia = null;
      }

      listeners.clear();
    },
  };
}

/** The application store. `ensureMotionPreference()` applies it at boot. */
export const motionStore: MotionStore = createMotionStore();

/** Apply and start watching the device preference. Called once from `main.tsx`. */
export function ensureMotionPreference(store: MotionStore = motionStore): void {
  store.refresh();
}

/**
 * Subscribe a React surface to the motion store. The hook re-renders when the
 * device changes, even if an explicit "reduced" choice keeps the resolved state
 * the same (the Settings note and disabled state still need to update).
 */
export function useMotionPreference(store: MotionStore = motionStore): {
  readonly reduced: boolean;
  readonly preference: MotionPreference;
  readonly systemReduced: boolean;
  readonly setReduced: (reduced: boolean) => void;
} {
  const reduced = useSyncExternalStore(store.subscribe, store.isReduced, store.isReduced);
  const preference = useSyncExternalStore(
    store.subscribe,
    store.getPreference,
    store.getPreference,
  );
  const systemReduced = useSyncExternalStore(
    store.subscribe,
    store.isSystemReduced,
    store.isSystemReduced,
  );

  useEffect(() => {
    store.refresh();
  }, [store]);

  const setReduced = useCallback(
    (next: boolean) => {
      store.setReduced(next);
    },
    [store],
  );

  return { reduced, preference, systemReduced, setReduced };
}

/** One motion category is either suppressed or left available to the surface. */
export type MotionCategory = 'allow' | 'suppress';

export interface MotionBehavior {
  readonly reduced: boolean;
  readonly pinDrop: MotionCategory;
  readonly stringDraw: MotionCategory;
  /** Auto-pan is a camera jump; reduced motion always lands instantly. */
  readonly autoPan: 'allow' | 'instant';
  readonly pageTransition: MotionCategory;
  readonly pulse: MotionCategory;
  /** Duration for newly added motion; zero when reduced motion is active. */
  readonly durationMs: number;
}

/**
 * The single policy for the five motion categories named by A11Y-CON-02.
 * Renderers consult this instead of reading `matchMedia` themselves.
 */
export function motionBehavior(reduced: boolean): MotionBehavior {
  if (reduced) {
    return {
      reduced: true,
      pinDrop: 'suppress',
      stringDraw: 'suppress',
      autoPan: 'instant',
      pageTransition: 'suppress',
      pulse: 'suppress',
      durationMs: 0,
    };
  }

  return {
    reduced: false,
    pinDrop: 'allow',
    stringDraw: 'allow',
    autoPan: 'allow',
    pageTransition: 'allow',
    pulse: 'allow',
    durationMs: 180,
  };
}
