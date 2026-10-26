/**
 * Pure viewport culling plus a minimal React binding.
 *
 * Culling is renderer-neutral: `CardLayer` consumes the pure helpers and the
 * `useCulling` hook is available to DOM chrome that needs the same visible
 * window. The 200 px margin is screen-space, so it is divided by the current
 * scale when converted into world units. That keeps the hidden margin visually
 * constant as the student zooms.
 *
 * No PixiJS import lives here; `CardSprite` is imported as a type only.
 */

import { useMemo } from 'react';

import type { Viewport } from '../domain/model';

import type { BoardCardSnapshot } from './CardSprite';
import {
  BOARD_CARD_HEIGHT,
  BOARD_CARD_WIDTH,
  computeVisibleWorldRect,
  normalizeViewport,
  type BoardSize,
  type WorldRect,
} from './viewport';

/** Extra screen-space margin rendered around the viewport to hide pan pop-in. */
export const BOARD_CULL_MARGIN = 200;

export interface CullingOptions {
  /** Screen pixels; defaults to the 200 px contract and never goes negative. */
  readonly margin?: number;
  /** Card geometry; defaults to the fixed 240x320 card contract. */
  readonly cardSize?: BoardSize;
}

function usableMargin(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : BOARD_CULL_MARGIN;
}

function usableCardSize(size: BoardSize | undefined): BoardSize {
  const width =
    size !== undefined && Number.isFinite(size.width) && size.width > 0
      ? size.width
      : BOARD_CARD_WIDTH;
  const height =
    size !== undefined && Number.isFinite(size.height) && size.height > 0
      ? size.height
      : BOARD_CARD_HEIGHT;

  return { width, height };
}

/** The world rectangle rendered at a given camera, including the pan margin. */
export function computeCullingWindow(
  viewport: Viewport,
  size: BoardSize,
  options: CullingOptions = {},
): WorldRect {
  const current = normalizeViewport(viewport);
  const visible = computeVisibleWorldRect(current, size);
  const margin = usableMargin(options.margin) / current.scale;

  return {
    x: visible.x - margin,
    y: visible.y - margin,
    width: visible.width + margin * 2,
    height: visible.height + margin * 2,
  };
}

/** True when two axis-aligned rectangles overlap. Touching edges do not. */
export function rectsIntersect(first: WorldRect, second: WorldRect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

/** Cards intersecting the viewport plus the margin, in fixture order. */
export function filterVisibleCards(
  cards: readonly BoardCardSnapshot[],
  viewport: Viewport,
  size: BoardSize,
  options: CullingOptions = {},
): BoardCardSnapshot[] {
  const window = computeCullingWindow(viewport, size, options);
  const cardSize = usableCardSize(options.cardSize);

  return cards.filter((card) =>
    rectsIntersect(
      {
        x: card.position.x,
        y: card.position.y,
        width: cardSize.width,
        height: cardSize.height,
      },
      window,
    ),
  );
}

/** The IDs of visible cards. Preserves fixture order. */
export function cullCardIds(
  cards: readonly BoardCardSnapshot[],
  viewport: Viewport,
  size: BoardSize,
  options: CullingOptions = {},
): string[] {
  return filterVisibleCards(cards, viewport, size, options).map((card) => card.id);
}

/** True when a card rectangle intersects the current culling window. */
export function isCardVisible(
  card: BoardCardSnapshot,
  viewport: Viewport,
  size: BoardSize,
  options: CullingOptions = {},
): boolean {
  return filterVisibleCards([card], viewport, size, options).length === 1;
}

/**
 * React binding for DOM chrome that mirrors the Pixi culling result. The hook
 * caches on the camera scalars rather than the viewport object, so a parent
 * that recreates the camera object with identical values does not re-cull.
 */
export function useCulling(
  cards: readonly BoardCardSnapshot[],
  viewport: Viewport,
  size: BoardSize,
  options: CullingOptions = {},
): BoardCardSnapshot[] {
  const margin = usableMargin(options.margin);
  const cardSize = usableCardSize(options.cardSize);
  const cardWidth = cardSize.width;
  const cardHeight = cardSize.height;
  const viewportX = viewport.x;
  const viewportY = viewport.y;
  const viewportScale = viewport.scale;
  const sizeWidth = size.width;
  const sizeHeight = size.height;

  return useMemo(
    () =>
      filterVisibleCards(
        cards,
        { x: viewportX, y: viewportY, scale: viewportScale },
        { width: sizeWidth, height: sizeHeight },
        { margin, cardSize: { width: cardWidth, height: cardHeight } },
      ),
    [
      cards,
      viewportX,
      viewportY,
      viewportScale,
      sizeWidth,
      sizeHeight,
      margin,
      cardWidth,
      cardHeight,
    ],
  );
}
