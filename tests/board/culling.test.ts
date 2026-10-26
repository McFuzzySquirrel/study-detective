import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BoardCardSnapshot } from '../../src/board/CardSprite';
import {
  BOARD_CULL_MARGIN,
  computeCullingWindow,
  cullCardIds,
  filterVisibleCards,
  isCardVisible,
  rectsIntersect,
  useCulling,
} from '../../src/board/useCulling';
import {
  BOARD_CARD_HEIGHT,
  BOARD_CARD_WIDTH,
  computeVisibleWorldRect,
} from '../../src/board/viewport';

const VIEWPORT = { x: 0, y: 0, scale: 1 };
const SIZE = { width: 1000, height: 800 };

/** 150 synthetic cards on a 15 x 10 grid with gaps between the cards. */
function makeCards(count = 150): BoardCardSnapshot[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: `card-${index}`,
    title: `Card ${index}`,
    type: 'note',
    position: {
      x: (index % 15) * (BOARD_CARD_WIDTH + 60),
      y: Math.floor(index / 15) * (BOARD_CARD_HEIGHT + 60),
    },
  }));
}

describe('board culling', () => {
  it('uses the 200 px margin by contract', () => {
    expect(BOARD_CULL_MARGIN).toBe(200);

    const window = computeCullingWindow(VIEWPORT, SIZE);

    expect(window.x).toBe(-200);
    expect(window.y).toBe(-200);
    expect(window.width).toBe(1400);
    expect(window.height).toBe(1200);
  });

  it('keeps the margin visually constant by dividing it by zoom', () => {
    const window = computeCullingWindow({ x: 100, y: 50, scale: 0.5 }, SIZE);

    expect(window.x).toBe(100 - 400);
    expect(window.y).toBe(50 - 400);
    expect(window.width).toBe(2000 + 800);
    expect(window.height).toBe(1600 + 800);
  });

  it('returns only cards intersecting the viewport plus 200 px for a 150-card fixture', () => {
    const cards = makeCards();
    const visible = filterVisibleCards(cards, VIEWPORT, SIZE);
    const window = computeCullingWindow(VIEWPORT, SIZE);

    // The full fixture is far larger than a 1000 x 800 window.
    expect(cards).toHaveLength(150);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(cards.length / 2);

    for (const card of visible) {
      expect(
        rectsIntersect(
          {
            x: card.position.x,
            y: card.position.y,
            width: BOARD_CARD_WIDTH,
            height: BOARD_CARD_HEIGHT,
          },
          window,
        ),
      ).toBe(true);
    }

    for (const card of cards) {
      const intersects = rectsIntersect(
        {
          x: card.position.x,
          y: card.position.y,
          width: BOARD_CARD_WIDTH,
          height: BOARD_CARD_HEIGHT,
        },
        window,
      );
      expect(visible.includes(card)).toBe(intersects);
    }

    // Cards on the far side of the fixture are never returned.
    expect(visible.some((card) => card.id === 'card-149')).toBe(false);
  });

  it('preserves fixture order in the id list', () => {
    const cards = makeCards(20);
    const visible = filterVisibleCards(cards, VIEWPORT, SIZE);
    const ids = cullCardIds(cards, VIEWPORT, SIZE);

    expect(ids).toEqual(visible.map((card) => card.id));
  });

  it('recomputes when the camera moves', () => {
    const cards = makeCards();

    expect(isCardVisible(cards[0]!, VIEWPORT, SIZE)).toBe(true);
    expect(filterVisibleCards(cards, VIEWPORT, SIZE).some((card) => card.id === 'card-0')).toBe(
      true,
    );

    const moved = { x: 1_500, y: 0, scale: 1 };
    const farVisible = filterVisibleCards(cards, moved, SIZE);

    expect(farVisible.some((card) => card.id === 'card-0')).toBe(false);
    expect(farVisible.length).toBeGreaterThan(0);
  });

  it('returns an empty set for an empty board', () => {
    expect(filterVisibleCards([], VIEWPORT, SIZE)).toEqual([]);
    expect(cullCardIds([], VIEWPORT, SIZE)).toEqual([]);
    expect(computeVisibleWorldRect(VIEWPORT, SIZE)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
    });
  });

  it('exposes the same result through the React hook', () => {
    const cards = makeCards();
    const { result } = renderHook(() => useCulling(cards, VIEWPORT, SIZE));

    expect(result.current.map((card) => card.id)).toEqual(cullCardIds(cards, VIEWPORT, SIZE));
  });
});
