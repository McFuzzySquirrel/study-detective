/**
 * Pure fit-to-view calculation for the board control.
 *
 * Kept separate from the button component so the padding and clamp rules can
 * be unit tested and the component file only exports a React component.
 */

import type { Viewport } from '../domain/model';

import {
  DEFAULT_FIT_MAX_SCALE,
  DEFAULT_FIT_PADDING,
  fitViewportToCards,
  type BoardPoint,
  type BoardSize,
} from './viewport';

/** The camera that fits every card with the documented 64 px padding. */
export function computeFitToCardsViewport(
  positions: readonly BoardPoint[],
  viewportSize: BoardSize,
): Viewport {
  return fitViewportToCards(positions, viewportSize, {
    padding: DEFAULT_FIT_PADDING,
    maxScale: DEFAULT_FIT_MAX_SCALE,
  });
}
