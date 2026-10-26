/**
 * The card layer of the case board.
 *
 * `CardLayer` owns one `CardSprite` per snapshot card, applies viewport
 * culling, and offers pure geometry helpers the page can use for pointer hit
 * testing. It never opens storage, imports a feature form, or decides to
 * persist a position; the page receives a plain intent after a completed drag.
 */

import { Container } from 'pixi.js';

import type { Viewport } from '../domain/model';

import type { BoardCardSnapshot, BoardPalette } from './CardSprite';
import { CardSprite } from './CardSprite';
import {
  BOARD_CARD_HEIGHT,
  BOARD_CARD_WIDTH,
  computeVisibleWorldRect,
  normalizeViewport,
  screenToWorld,
  type BoardPoint,
  type BoardSize,
  type WorldRect,
} from './viewport';

export { BOARD_CARD_WIDTH, BOARD_CARD_HEIGHT };

/** Extra world margin rendered around the viewport to hide pan pop-in. */
export const BOARD_CULL_MARGIN = 200;

/** Optional image URLs supplied by the composition page. */
export interface BoardCardImage {
  readonly thumbnailUrl?: string;
  readonly displayUrl?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface CardLayerOptions {
  readonly palette: BoardPalette;
}

function cardRect(card: BoardCardSnapshot): WorldRect {
  return {
    x: card.position.x,
    y: card.position.y,
    width: BOARD_CARD_WIDTH,
    height: BOARD_CARD_HEIGHT,
  };
}

function intersects(first: WorldRect, second: WorldRect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

/** The world rectangle rendered at a given camera, including the pan margin. */
export function computeCullingWindow(viewport: Viewport, size: BoardSize): WorldRect {
  const visible = computeVisibleWorldRect(normalizeViewport(viewport), size);
  const margin = BOARD_CULL_MARGIN / normalizeViewport(viewport).scale;

  return {
    x: visible.x - margin,
    y: visible.y - margin,
    width: visible.width + margin * 2,
    height: visible.height + margin * 2,
  };
}

/** Cards intersecting the viewport plus the 200 px margin, in fixture order. */
export function filterVisibleCards(
  cards: readonly BoardCardSnapshot[],
  viewport: Viewport,
  size: BoardSize,
): BoardCardSnapshot[] {
  const window = computeCullingWindow(viewport, size);
  return cards.filter((card) => intersects(cardRect(card), window));
}

/**
 * Resolve a screen-space pointer to the topmost card rectangle. Cards later in
 * the snapshot paint above earlier ones, so hit testing walks backwards.
 */
export function hitTestCard(
  cards: readonly BoardCardSnapshot[],
  viewport: Viewport,
  point: BoardPoint,
): BoardCardSnapshot | null {
  const world = screenToWorld(point, normalizeViewport(viewport));

  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (card === undefined) {
      continue;
    }

    const rect = cardRect(card);
    if (
      world.x >= rect.x &&
      world.x <= rect.x + rect.width &&
      world.y >= rect.y &&
      world.y <= rect.y + rect.height
    ) {
      return card;
    }
  }

  return null;
}

/** A Pixi container holding every card sprite for one board mount. */
export class CardLayer {
  readonly root: Container;

  private readonly sprites = new Map<string, CardSprite>();
  private readonly cards = new Map<string, BoardCardSnapshot>();
  private readonly palette: BoardPalette;

  private viewport: Viewport = { x: 0, y: 0, scale: 1 };
  private size: BoardSize = { width: 1, height: 1 };
  private destroyed = false;

  constructor(options: CardLayerOptions) {
    this.palette = options.palette;
    this.root = new Container();
    this.root.label = 'board-card-layer';
    this.root.eventMode = 'none';
    this.root.sortableChildren = true;
  }

  /** Reconcile the layer with a plain card snapshot. */
  setCards(cards: readonly BoardCardSnapshot[]): void {
    if (this.destroyed) {
      return;
    }

    const next = new Map(cards.map((card) => [card.id, card]));

    for (const [id, sprite] of [...this.sprites]) {
      if (!next.has(id)) {
        this.root.removeChild(sprite.root);
        sprite.destroy();
        this.sprites.delete(id);
      }
    }

    this.cards.clear();
    for (const card of cards) {
      this.cards.set(card.id, card);
      const existing = this.sprites.get(card.id);

      if (existing === undefined) {
        const sprite = new CardSprite(card, this.palette);
        this.sprites.set(card.id, sprite);
        this.root.addChild(sprite.root);
      } else {
        existing.setCard(card);
      }
    }

    this.applyCulling();
  }

  /** Apply the camera and canvas size, then update culling. */
  setViewport(viewport: Viewport, size: BoardSize): void {
    if (this.destroyed) {
      return;
    }

    this.viewport = normalizeViewport(viewport);
    this.size = {
      width: Number.isFinite(size.width) ? Math.max(1, size.width) : 1,
      height: Number.isFinite(size.height) ? Math.max(1, size.height) : 1,
    };
    this.applyCulling();
  }

  /** Move one sprite for the live drag preview. Storage is the page's job. */
  moveCard(cardId: string, position: { readonly x: number; readonly y: number }): void {
    if (this.destroyed) {
      return;
    }

    const card = this.cards.get(cardId);
    const sprite = this.sprites.get(cardId);
    if (card === undefined || sprite === undefined) {
      return;
    }

    const next = { x: position.x, y: position.y };
    this.cards.set(cardId, { ...card, position: next });
    sprite.setPosition(next);
  }

  setLifted(cardId: string, lifted: boolean, reducedMotion: boolean): void {
    this.sprites.get(cardId)?.setLifted(lifted, reducedMotion);
  }

  setSelected(cardId: string | null): void {
    for (const [id, sprite] of this.sprites) {
      sprite.setSelected(id === cardId);
    }
  }

  /** Resolve a screen point to a card, respecting the current camera. */
  hitTest(point: BoardPoint): BoardCardSnapshot | null {
    return hitTestCard([...this.cards.values()], this.viewport, point);
  }

  rebuildAfterContextLoss(): void {
    for (const sprite of this.sprites.values()) {
      sprite.rebuildAfterContextLoss();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
    this.cards.clear();
    this.root.removeChildren();
    this.root.destroy({ context: true, style: true });
  }

  private applyCulling(): void {
    const window = computeCullingWindow(this.viewport, this.size);

    for (const [id, sprite] of this.sprites) {
      const card = this.cards.get(id);
      const visible = card !== undefined && intersects(cardRect(card), window);
      sprite.setVisible(visible);
    }
  }
}
