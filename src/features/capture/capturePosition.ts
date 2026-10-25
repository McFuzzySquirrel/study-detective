/**
 * Initial card placement for a new capture.
 *
 * The case board's persisted viewport names the world coordinate of the
 * visible top-left corner at the saved scale. A new card therefore lands in the
 * middle of what the student could see, with a small diagonal stagger so two
 * saves in a row do not stack exactly on top of each other.
 *
 * This helper is deliberately pure: it has no DOM, storage, or Pixi dependency
 * and can be exercised without a browser.
 */

import type { CardPosition, Viewport } from '../../domain/model';

export type CaptureViewportSize = {
  readonly width: number;
  readonly height: number;
};

/** Distance between staggered card saves, in world pixels. */
export const INITIAL_CARD_STAGGER_PX = 16;

/** Repeat the stagger after this many cards so it never drifts far away. */
export const INITIAL_CARD_STAGGER_CYCLE = 6;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Convert the saved viewport plus the current visible size into a world
 * position near the middle of the screen. Coordinates stay nonnegative because
 * that is the domain contract for a card position.
 */
export function computeInitialCardPosition(
  viewport: Viewport,
  viewportSize: CaptureViewportSize,
  existingCardCount: number,
): CardPosition {
  const scale = finitePositive(viewport.scale, 1);
  const width = finitePositive(viewportSize.width, 1);
  const height = finitePositive(viewportSize.height, 1);
  const count = Number.isFinite(existingCardCount) ? Math.max(0, Math.trunc(existingCardCount)) : 0;
  const stagger = (count % INITIAL_CARD_STAGGER_CYCLE) * INITIAL_CARD_STAGGER_PX;

  return {
    x: Math.max(0, Math.round(viewport.x + width / (2 * scale) + stagger)),
    y: Math.max(0, Math.round(viewport.y + height / (2 * scale) + stagger)),
  };
}

/**
 * Read the browser's visible content area. The capture route fills the main
 * landmark, so its measured box is the closest honest equivalent of the board's
 * visible region; window dimensions are the fallback when it is not mounted.
 * Tests inject their own reader to keep placement deterministic.
 */
export function readBrowserViewportSize(): CaptureViewportSize {
  if (typeof window === 'undefined') {
    return { width: 1, height: 1 };
  }

  if (typeof document !== 'undefined') {
    const main = document.getElementById('main-content');
    const rect = main?.getBoundingClientRect();
    if (rect !== undefined && rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
  }

  return {
    width: finitePositive(window.innerWidth, 1),
    height: finitePositive(window.innerHeight, 1),
  };
}
