/**
 * The thread anchor and its temporary drag thread.
 *
 * A card shows one small red anchor at its right edge while the card is
 * selected or hovered. Dragging from that anchor pulls a temporary red thread
 * across the cork; releasing over another card starts a connection. The anchor
 * is a real Pixi interaction target (a hit area larger than the drawn pin) so
 * the board can expose the gesture without turning the whole card into an
 * interactive sprite.
 *
 * Coordinate contract:
 *
 * - The anchor position is stored in card-local pixels and converted to screen
 *   pixels through the camera before hit testing.
 * - The 44 px touch target is measured in screen pixels, not board pixels, so
 *   it stays reachable when the student zooms out. The visible pin still scales
 *   with the card, like the pin and title strip.
 * - The temporary thread is drawn in screen space, below the world container,
 *   matching the permanent strings and keeping the endpoint tucked under the
 *   target card.
 *
 * There is no repository, storage, React, or feature-form import here.
 */

import { Circle, Container, Graphics } from 'pixi.js';

import type { CardPosition, Viewport } from '../domain/model';

import type { BoardCardSnapshot } from './CardSprite';
import { clampScale, worldToScreen, type BoardPoint } from './viewport';
import { BOARD_CARD_WIDTH } from './viewport';

/** Centre of the anchor in card-local pixels: the right edge. */
export const THREAD_ANCHOR_LOCAL = Object.freeze({
  x: BOARD_CARD_WIDTH,
  y: 104,
});

/** Radius of the visible anchor pin, in card-local pixels. */
export const THREAD_ANCHOR_RADIUS = 7;

/**
 * Screen-space radius of the anchor's touch target. The 44 px target token is
 * a 22 px radius on either side of the pin.
 */
export const THREAD_ANCHOR_HIT_RADIUS = 22;

/** The association red used for the temporary thread. */
export const THREAD_DRAFT_COLOR_FALLBACK = 0xcf3d2f;

/** The association stroke width before zoom scaling. */
export const THREAD_DRAFT_STROKE_WIDTH = 3;

/** The temporary thread's sag at 100 percent zoom. */
export const THREAD_DRAFT_SAG_AT_SCALE_ONE = 12;

export interface ThreadAnchorPalette {
  readonly color: number;
  readonly paper: number;
}

export interface DraftThreadGeometry {
  readonly start: BoardPoint;
  readonly control: BoardPoint;
  readonly end: BoardPoint;
  /** Visible sag in screen pixels (curve midpoint minus chord midpoint). */
  readonly sag: number;
  readonly strokeWidth: number;
}

const EPSILON = 1e-9;

function finitePoint(point: BoardPoint): BoardPoint {
  return {
    x: Number.isFinite(point.x) ? point.x : 0,
    y: Number.isFinite(point.y) ? point.y : 0,
  };
}

/**
 * The thread anchor's world point for one card. The anchor sits on the right
 * edge, so a thread leaves sideways before it follows its sag.
 */
export function threadAnchorWorldPoint(position: CardPosition): BoardPoint {
  return {
    x: position.x + THREAD_ANCHOR_LOCAL.x,
    y: position.y + THREAD_ANCHOR_LOCAL.y,
  };
}

/** The anchor's screen point for the current camera. */
export function threadAnchorScreenPoint(position: CardPosition, viewport: Viewport): BoardPoint {
  return worldToScreen(threadAnchorWorldPoint(position), viewport);
}

/**
 * True when a screen point lands inside the anchor's 44 px touch target. The
 * radius is expressed in screen pixels, so a zoomed-out board does not shrink
 * the target below the accessibility floor.
 */
export function isPointOnThreadAnchor(
  position: CardPosition,
  viewport: Viewport,
  point: BoardPoint,
  radius: number = THREAD_ANCHOR_HIT_RADIUS,
): boolean {
  const anchor = threadAnchorScreenPoint(position, viewport);
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : THREAD_ANCHOR_HIT_RADIUS;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;

  return dx * dx + dy * dy <= safeRadius * safeRadius;
}

/**
 * Resolve a screen point to the visible anchor of the selected/hovered card.
 * Only one anchor is ever on the board, so the caller passes that card ID; a
 * second card's hidden anchor can never steal a drag.
 */
export function findThreadAnchorAtPoint(
  cards: readonly BoardCardSnapshot[],
  viewport: Viewport,
  anchorCardId: string | null,
  point: BoardPoint,
): string | null {
  if (anchorCardId === null) {
    return null;
  }

  const card = cards.find((candidate) => candidate.id === anchorCardId);
  if (card === undefined) {
    return null;
  }

  return isPointOnThreadAnchor(card.position, viewport, point) ? card.id : null;
}

function sagNormal(start: BoardPoint, end: BoardPoint): BoardPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length <= EPSILON) {
    return { x: 0, y: 1 };
  }

  let x = -dy / length;
  let y = dx / length;

  // Prefer the downward bow so the temporary thread reads like a real string.
  if (y < -EPSILON) {
    x = -x;
    y = -y;
  } else if (Math.abs(y) <= EPSILON && x < 0) {
    x = -x;
    y = -y;
  }

  return { x, y };
}

/**
 * Geometry for the temporary thread from the anchor to the pointer. It uses
 * the same sag rule as the permanent strings but caps the bow at a quarter of
 * the pointer distance so a short pull stays close to the finger.
 */
export function computeDraftThreadGeometry(
  from: BoardPoint,
  to: BoardPoint,
  scale: number = 1,
): DraftThreadGeometry {
  const start = finitePoint(from);
  const end = finitePoint(to);
  const zoom = clampScale(Number.isFinite(scale) ? scale : 1, 1);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const sag = Math.min(THREAD_DRAFT_SAG_AT_SCALE_ONE * zoom, length * 0.25);
  const normal = sagNormal(start, end);
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };

  return {
    start,
    end,
    control: {
      x: midpoint.x + normal.x * sag * 2,
      y: midpoint.y + normal.y * sag * 2,
    },
    sag,
    strokeWidth: Math.max(1, THREAD_DRAFT_STROKE_WIDTH * zoom),
  };
}

/**
 * The Pixi interaction target mounted through `CardSprite`.
 *
 * The hit area is deliberately much larger than the drawn pin. Board pointer
 * routing still lives on the DOM host so touch long-press, pan, and card drag
 * share one gesture state machine; this object is the renderer-side target and
 * keeps the visible affordance next to the card edge.
 */
export class ThreadAnchor {
  readonly root: Container;

  private destroyed = false;

  constructor(options: ThreadAnchorPalette) {
    this.root = new Container();
    this.root.label = 'board-thread-anchor';
    this.root.position.set(THREAD_ANCHOR_LOCAL.x, THREAD_ANCHOR_LOCAL.y);
    this.root.eventMode = 'static';
    this.root.cursor = 'pointer';
    this.root.hitArea = new Circle(0, 0, THREAD_ANCHOR_HIT_RADIUS);
    this.root.visible = false;

    const tail = new Graphics()
      .moveTo(-18, 0)
      .lineTo(-8, 0)
      .stroke({ color: options.color, width: 2, alpha: 0.85 });

    const halo = new Graphics()
      .circle(0, 0, THREAD_ANCHOR_RADIUS + 4)
      .fill({ color: options.paper, alpha: 0.92 })
      .stroke({ color: options.color, width: 2, alpha: 0.9 });

    const dome = new Graphics()
      .circle(0, 0, THREAD_ANCHOR_RADIUS)
      .fill({ color: options.color })
      .stroke({ color: options.paper, width: 1 });
    dome.circle(-2, -2, 2).fill({ color: 0xffffff, alpha: 0.45 });

    this.root.addChild(tail, halo, dome);
  }

  setVisible(visible: boolean): void {
    if (this.destroyed) {
      return;
    }
    this.root.visible = visible;
  }

  /** A slightly larger pin while the thread is being pulled. */
  setActive(active: boolean): void {
    if (this.destroyed) {
      return;
    }
    this.root.scale.set(active ? 1.18 : 1);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.root.destroy({ children: true, context: true, style: true });
  }
}

/**
 * The temporary thread layer. It is screen-space and sits below the card world
 * so the line tucks under the target card. The layer has no animation state:
 * reduced motion shows the same final line.
 */
export class ThreadAnchorLayer {
  readonly root: Container;

  private readonly graphics: Graphics;
  private readonly color: number;
  private start: BoardPoint | null = null;
  private endPoint: BoardPoint | null = null;
  private scale = 1;
  private destroyed = false;

  constructor(color: number = THREAD_DRAFT_COLOR_FALLBACK) {
    this.color = color;

    this.root = new Container();
    this.root.label = 'board-thread-draft';
    this.root.eventMode = 'none';

    this.graphics = new Graphics();
    this.graphics.label = 'board-thread-draft-line';
    this.graphics.eventMode = 'none';
    this.root.addChild(this.graphics);
  }

  get isActive(): boolean {
    return this.start !== null && this.endPoint !== null;
  }

  begin(start: BoardPoint, scale: number): void {
    if (this.destroyed) {
      return;
    }

    this.start = finitePoint(start);
    this.endPoint = finitePoint(start);
    this.scale = Number.isFinite(scale) ? scale : 1;
    this.draw();
  }

  update(end: BoardPoint): void {
    if (this.destroyed || this.start === null) {
      return;
    }

    this.endPoint = finitePoint(end);
    this.draw();
  }

  end(): void {
    this.start = null;
    this.endPoint = null;
    if (!this.destroyed) {
      this.graphics.clear();
    }
  }

  /** A restored context redraws the in-flight line from its plain points. */
  rebuildAfterContextLoss(): void {
    if (!this.destroyed && this.isActive) {
      this.draw();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.start = null;
    this.endPoint = null;
    this.root.destroy({ children: true, context: true, style: true });
  }

  private draw(): void {
    if (this.start === null || this.endPoint === null) {
      return;
    }

    const geometry = computeDraftThreadGeometry(this.start, this.endPoint, this.scale);
    this.graphics.clear();
    this.graphics
      .moveTo(geometry.start.x, geometry.start.y)
      .quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.end.x, geometry.end.y)
      .stroke({
        color: this.color,
        width: geometry.strokeWidth,
        cap: 'round',
        join: 'round',
        alpha: 0.92,
      });
    this.graphics.circle(geometry.end.x, geometry.end.y, 4).fill({ color: this.color });
  }
}
