/**
 * The three layout modes the app designs for.
 *
 * CSS owns the visual breakpoints, but a few surfaces need to change their
 * *semantics* rather than only their style: a side panel on tablet becomes a
 * modal bottom sheet on a phone, so it must not be rendered twice. This hook is
 * the single JavaScript answer to "which layout is the browser in?", matching
 * the documented breakpoints:
 *
 * - phone: below 600 px
 * - tablet: 600–1199 px
 * - desktop: 1200 px and up
 *
 * The hook uses `matchMedia` when available and falls back to `innerWidth`, so
 * jsdom tests and a browser without matchMedia still resolve a sensible mode.
 */

import { useSyncExternalStore } from 'react';

/** Below 600 px: `37.4375rem === 599px`, so 600 itself belongs to tablet. */
export const PHONE_MAX_QUERY = '(max-width: 37.4375rem)';
/** Below 1200 px: `74.9375rem === 1199px`, so 1200 itself belongs to desktop. */
export const TABLET_MAX_QUERY = '(max-width: 74.9375rem)';

export const PHONE_MAX_WIDTH = 600;
export const DESKTOP_MIN_WIDTH = 1200;

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

function readLayoutMode(): LayoutMode {
  if (typeof window === 'undefined') {
    return 'desktop';
  }

  if (typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia(PHONE_MAX_QUERY).matches) {
        return 'phone';
      }
      if (window.matchMedia(TABLET_MAX_QUERY).matches) {
        return 'tablet';
      }
      return 'desktop';
    } catch {
      // A broken matchMedia implementation must not blank the app; fall back
      // to the width-based answer below.
    }
  }

  if (window.innerWidth < PHONE_MAX_WIDTH) {
    return 'phone';
  }
  if (window.innerWidth < DESKTOP_MIN_WIDTH) {
    return 'tablet';
  }
  return 'desktop';
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const mediaQueries: MediaQueryList[] = [];

  if (typeof window.matchMedia === 'function') {
    for (const query of [PHONE_MAX_QUERY, TABLET_MAX_QUERY]) {
      try {
        const media = window.matchMedia(query);
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', onChange);
        } else if (typeof media.addListener === 'function') {
          media.addListener(onChange);
        }
        mediaQueries.push(media);
      } catch {
        // Ignore one broken query; the resize listener still keeps the mode
        // current.
      }
    }
  }

  window.addEventListener('resize', onChange);

  return () => {
    window.removeEventListener('resize', onChange);

    for (const media of mediaQueries) {
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', onChange);
      } else if (typeof media.removeListener === 'function') {
        media.removeListener(onChange);
      }
    }
  };
}

/** The current layout mode, kept in sync with matchMedia and window resizes. */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, readLayoutMode, () => 'desktop');
}

/** True while the phone layout (below 600 px) is active. */
export function usePhoneLayout(): boolean {
  return useLayoutMode() === 'phone';
}

export default useLayoutMode;
