/**
 * Fit-to-view control.
 *
 * Fit computes the padded bounds of every card and applies the result as a
 * *temporary* camera through the board store. That distinction matters: the
 * stored camera is left untouched until the student pans or zooms again, so
 * returning to the case still restores their spatial memory. The bounds math
 * lives in `fitToView` so it can be tested without React.
 */

import { useCallback } from 'react';

import Button from '../components/Button';

import { boardStore } from './boardStore';
import type { BoardStoreApi } from './boardStore';
import { computeFitToCardsViewport } from './fitToView';
import type { BoardPoint, BoardSize } from './viewport';
import type { Viewport } from '../domain/model';

export interface FitToViewButtonProps {
  /** Top-left position of each card in world space. */
  readonly positions: readonly BoardPoint[];
  /** Current canvas size in CSS pixels. */
  readonly viewportSize: BoardSize;
  /** Injected store for component tests or multi-board screens. */
  readonly store?: BoardStoreApi | undefined;
  /** Observe the chosen camera; the button has already applied it. */
  readonly onFit?: ((viewport: Viewport) => void) | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

/** A quiet control that fits the whole case without persisting the camera. */
export function FitToViewButton({
  positions,
  viewportSize,
  store,
  onFit,
  disabled = false,
  className,
}: FitToViewButtonProps) {
  const handleFit = useCallback((): void => {
    const target = store ?? boardStore;
    const next = computeFitToCardsViewport(positions, viewportSize);
    target.getState().applyTemporaryViewport(next);
    onFit?.(next);
  }, [onFit, positions, store, viewportSize]);

  return (
    <Button
      variant="quiet"
      {...(className === undefined ? {} : { className })}
      onClick={handleFit}
      disabled={disabled}
      aria-label="Fit all cards"
    >
      Fit
    </Button>
  );
}

export default FitToViewButton;
