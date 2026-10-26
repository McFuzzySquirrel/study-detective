import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createBoardStore } from '../../src/board/boardStore';
import { computeFitToCardsViewport } from '../../src/board/fitToView';
import { FitToViewButton } from '../../src/board/FitToViewButton';
import { BOARD_CARD_HEIGHT, BOARD_CARD_WIDTH } from '../../src/board/viewport';

afterEach(() => {
  cleanup();
});

describe('FitToViewButton', () => {
  it('fits every card with padding and never magnifies past 100 percent', () => {
    const viewport = computeFitToCardsViewport(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 800 },
      ],
      { width: 1000, height: 800 },
    );

    expect(viewport.scale).toBeLessThan(1);
    expect(viewport.scale).toBeGreaterThanOrEqual(0.25);

    // The fitted card bounds remain inside the 64 px padding.
    const boundsWidth = 1000 + BOARD_CARD_WIDTH;
    const boundsHeight = 800 + BOARD_CARD_HEIGHT;
    const screenLeft = (0 - viewport.x) * viewport.scale;
    const screenTop = (0 - viewport.y) * viewport.scale;
    const screenRight = (boundsWidth - viewport.x) * viewport.scale;
    const screenBottom = (boundsHeight - viewport.y) * viewport.scale;

    expect(screenLeft).toBeGreaterThanOrEqual(63.9);
    expect(screenTop).toBeGreaterThanOrEqual(63.9);
    expect(screenRight).toBeLessThanOrEqual(1000 - 63.9);
    expect(screenBottom).toBeLessThanOrEqual(800 - 63.9);
  });

  it('falls back to the default camera for an empty board', () => {
    expect(computeFitToCardsViewport([], { width: 1000, height: 800 })).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    });
  });

  it('applies fit as a temporary camera without persisting it', () => {
    const store = createBoardStore({ x: 250, y: 120, scale: 1.5 });
    const { rerender } = render(
      <MemoryRouter>
        <FitToViewButton
          positions={[
            { x: 0, y: 0 },
            { x: 900, y: 700 },
          ]}
          viewportSize={{ width: 1000, height: 800 }}
          store={store}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fit all cards' }));

    expect(store.getState().viewportDirty).toBe(false);
    expect(store.getState().storedViewport).toEqual({ x: 250, y: 120, scale: 1.5 });
    expect(store.getState().pendingViewport).toEqual(store.getState().viewport);

    // Re-rendering with fresh props does not stray from the fitted camera.
    rerender(
      <MemoryRouter>
        <FitToViewButton
          positions={[
            { x: 0, y: 0 },
            { x: 900, y: 700 },
          ]}
          viewportSize={{ width: 1000, height: 800 }}
          store={store}
        />
      </MemoryRouter>,
    );

    expect(store.getState().viewportDirty).toBe(false);
  });
});
