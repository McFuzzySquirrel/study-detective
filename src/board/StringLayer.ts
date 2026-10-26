/**
 * The PixiJS string layer for the case board.
 *
 * `StringLayer` is a screen-space layer that sits below the world-scaled cards,
 * so card art tucks over the thread ends. It reads a plain snapshot of cards
 * and connections, computes the pure geometry from `stringGeometry.ts`, and
 * redraws on card movement or a camera change. It never opens storage, imports
 * a feature form, or writes a connection.
 *
 * Rendering contract:
 *
 * - Association strings are a solid 3 px red thread.
 * - Provenance strings are a 2 px dashed amber thread.
 * - Both sag 12 px at 100 percent zoom and scale with the board.
 * - Strings carry no text, score, arrow, colour choice, or label.
 * - The layer is static: there is no draw-in animation, so reduced motion is
 *   honored by construction and there is never an animation state to cancel.
 */

import { Color, Container, Graphics } from 'pixi.js';

import type { ConnectionType, Viewport } from '../domain/model';

import type { BoardCardSnapshot } from './CardSprite';
import {
  computeStringDashes,
  computeStringGeometry,
  distanceSquaredToString,
  STRING_COLOR_FALLBACKS,
  STRING_COLOR_TOKENS,
  stringStrokeStyle,
} from './stringGeometry';
import type { StringGeometry, StringRect } from './stringGeometry';
import { BOARD_CULL_MARGIN, rectsIntersect } from './useCulling';
import {
  BOARD_CARD_HEIGHT,
  BOARD_CARD_WIDTH,
  normalizeViewport,
  viewportsEqual,
  worldToScreen,
  type BoardPoint,
  type BoardSize,
} from './viewport';

/** One undirected string in the plain scene snapshot. */
export interface BoardStringConnection {
  readonly id: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly type: ConnectionType;
}

export interface StringPalette {
  readonly association: number;
  readonly provenance: number;
}

export const STRING_PALETTE_FALLBACK: Readonly<StringPalette> = Object.freeze({
  association: STRING_COLOR_FALLBACKS.association,
  provenance: STRING_COLOR_FALLBACKS.provenance,
});

export interface StringLayerOptions {
  readonly palette?: StringPalette;
  /** Defaults to false. Kept so the scene can pass the live OS preference. */
  readonly reducedMotion?: boolean;
  /** Card rectangle used to derive screen anchors. Defaults to 240x320. */
  readonly cardSize?: BoardSize;
  /** Screen-space culling margin. Defaults to the shared 200 px contract. */
  readonly cullMargin?: number;
}

interface VisibleString {
  readonly connection: BoardStringConnection;
  readonly geometry: StringGeometry;
}

function readColorToken(token: string, fallback: number): number {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return fallback;
  }

  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (value.length === 0) {
      return fallback;
    }
    return new Color(value).toNumber();
  } catch {
    return fallback;
  }
}

/** Read the two string tokens once per scene, with a safe fallback. */
export function readStringPalette(): StringPalette {
  return {
    association: readColorToken(
      STRING_COLOR_TOKENS.association,
      STRING_COLOR_FALLBACKS.association,
    ),
    provenance: readColorToken(STRING_COLOR_TOKENS.provenance, STRING_COLOR_FALLBACKS.provenance),
  };
}

function safeCardSize(size: BoardSize | undefined): BoardSize {
  return {
    width:
      size !== undefined && Number.isFinite(size.width) && size.width > 0
        ? size.width
        : BOARD_CARD_WIDTH,
    height:
      size !== undefined && Number.isFinite(size.height) && size.height > 0
        ? size.height
        : BOARD_CARD_HEIGHT,
  };
}

function safeViewportSize(size: BoardSize): BoardSize {
  return {
    width: Number.isFinite(size.width) ? Math.max(1, size.width) : 1,
    height: Number.isFinite(size.height) ? Math.max(1, size.height) : 1,
  };
}

function safeMargin(margin: number | undefined): number {
  return margin !== undefined && Number.isFinite(margin) && margin >= 0
    ? margin
    : BOARD_CULL_MARGIN;
}

function sameSize(first: BoardSize, second: BoardSize): boolean {
  return first.width === second.width && first.height === second.height;
}

function sameCardPositions(
  first: ReadonlyMap<string, BoardPoint>,
  second: ReadonlyMap<string, BoardPoint>,
): boolean {
  if (first.size !== second.size) {
    return false;
  }

  for (const [id, position] of first) {
    const other = second.get(id);
    if (other === undefined || other.x !== position.x || other.y !== position.y) {
      return false;
    }
  }

  return true;
}

function sameConnections(
  first: readonly BoardStringConnection[],
  second: readonly BoardStringConnection[],
): boolean {
  if (first === second) {
    return true;
  }
  if (first.length !== second.length) {
    return false;
  }

  for (let index = 0; index < first.length; index += 1) {
    const left = first[index];
    const right = second[index];
    if (
      left === undefined ||
      right === undefined ||
      left.id !== right.id ||
      left.fromCardId !== right.fromCardId ||
      left.toCardId !== right.toCardId ||
      left.type !== right.type
    ) {
      return false;
    }
  }

  return true;
}

function unionRect(first: StringRect, second: StringRect): StringRect {
  const minX = Math.min(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  const maxX = Math.max(first.x + first.width, second.x + second.width);
  const maxY = Math.max(first.y + first.height, second.y + second.height);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * One string layer for one board mount. The scene adds `root` to the stage
 * below the world container and destroys the layer with the scene.
 */
export class StringLayer {
  readonly root: Container;

  private readonly palette: StringPalette;
  private readonly cardSize: BoardSize;
  private readonly cullMargin: number;
  private readonly associationGraphics: Graphics;
  private readonly provenanceGraphics: Graphics;

  private cards = new Map<string, BoardPoint>();
  private connections: readonly BoardStringConnection[] = [];
  private visibleStrings: VisibleString[] = [];
  private viewport: Viewport = { x: 0, y: 0, scale: 1 };
  private size: BoardSize = { width: 1, height: 1 };
  private prefersReducedMotion: boolean;
  private resolvedCount = 0;
  private destroyed = false;

  constructor(options: StringLayerOptions = {}) {
    this.palette = options.palette ?? STRING_PALETTE_FALLBACK;
    this.cardSize = safeCardSize(options.cardSize);
    this.cullMargin = safeMargin(options.cullMargin);
    this.prefersReducedMotion = options.reducedMotion ?? false;

    this.root = new Container();
    this.root.label = 'board-string-layer';
    this.root.eventMode = 'none';

    this.associationGraphics = new Graphics();
    this.associationGraphics.label = 'board-association-strings';
    this.associationGraphics.eventMode = 'none';

    this.provenanceGraphics = new Graphics();
    this.provenanceGraphics.label = 'board-provenance-strings';
    this.provenanceGraphics.eventMode = 'none';

    this.root.addChild(this.associationGraphics, this.provenanceGraphics);
  }

  /** Replace the card positions used to derive both string endpoints. */
  setCards(cards: readonly BoardCardSnapshot[]): void {
    if (this.destroyed) {
      return;
    }

    const next = new Map<string, BoardPoint>();
    for (const card of cards) {
      if (Number.isFinite(card.position.x) && Number.isFinite(card.position.y)) {
        next.set(card.id, { x: card.position.x, y: card.position.y });
      }
    }

    if (sameCardPositions(this.cards, next)) {
      return;
    }

    this.cards = next;
    this.redraw();
  }

  /** Replace the undirected string snapshot and redraw. */
  setConnections(connections: readonly BoardStringConnection[]): void {
    if (this.destroyed || sameConnections(this.connections, connections)) {
      return;
    }

    this.connections = connections;
    this.redraw();
  }

  /** Apply the camera and canvas size. A pan or zoom redraws the screen layer. */
  setViewport(viewport: Viewport, size: BoardSize): void {
    if (this.destroyed) {
      return;
    }

    const nextViewport = normalizeViewport(viewport);
    const nextSize = safeViewportSize(size);

    if (viewportsEqual(this.viewport, nextViewport) && sameSize(this.size, nextSize)) {
      return;
    }

    this.viewport = nextViewport;
    this.size = nextSize;
    this.redraw();
  }

  /** Update one endpoint for the live drag preview. Storage stays with the page. */
  moveCard(cardId: string, position: BoardPoint): void {
    if (this.destroyed) {
      return;
    }

    const current = this.cards.get(cardId);
    if (
      current === undefined ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      (current.x === position.x && current.y === position.y)
    ) {
      return;
    }

    this.cards.set(cardId, { x: position.x, y: position.y });
    this.redraw();
  }

  /**
   * Record the reduced-motion preference. The layer has no draw-in animation,
   * so the final string is already on the screen; this keeps the scene contract
   * explicit and makes a future animation add a single guard here.
   */
  setReducedMotion(reducedMotion: boolean): void {
    if (this.destroyed || this.prefersReducedMotion === reducedMotion) {
      return;
    }

    this.prefersReducedMotion = reducedMotion;
    this.redraw();
  }

  /** Resolve a screen point to the nearest visible string within its hit band. */
  stringAt(point: BoardPoint): BoardStringConnection | null {
    let best: BoardStringConnection | null = null;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;

    for (const item of this.visibleStrings) {
      const radius = Math.max(item.geometry.hitTolerance, item.geometry.strokeWidth / 2);
      const distanceSquared = distanceSquaredToString(item.geometry, point);

      if (distanceSquared <= radius * radius && distanceSquared < bestDistanceSquared) {
        best = item.connection;
        bestDistanceSquared = distanceSquared;
      }
    }

    return best;
  }

  /** A restored context redraws the vector strings from the plain snapshot. */
  rebuildAfterContextLoss(): void {
    this.redraw();
  }

  /** Number of strings actually drawn after culling. */
  get drawnStringCount(): number {
    return this.visibleStrings.length;
  }

  /** Number of connections whose two endpoint cards are present. */
  get totalStringCount(): number {
    return this.resolvedCount;
  }

  /** Always false: v1 strings are static, including under reduced motion. */
  get isAnimating(): boolean {
    return false;
  }

  get reducedMotion(): boolean {
    return this.prefersReducedMotion;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.cards.clear();
    this.connections = [];
    this.visibleStrings = [];
    this.resolvedCount = 0;
    this.root.destroy({ children: true, context: true, style: true });
  }

  private screenRectFor(cardId: string): StringRect | null {
    const position = this.cards.get(cardId);
    if (position === undefined) {
      return null;
    }

    const scale = this.viewport.scale;
    const topLeft = worldToScreen(position, this.viewport);

    return {
      x: topLeft.x,
      y: topLeft.y,
      width: this.cardSize.width * scale,
      height: this.cardSize.height * scale,
    };
  }

  private screenCullingWindow(): StringRect {
    return {
      x: -this.cullMargin,
      y: -this.cullMargin,
      width: this.size.width + this.cullMargin * 2,
      height: this.size.height + this.cullMargin * 2,
    };
  }

  /**
   * Rebuild both graphics from the snapshot. All solid strings share one path
   * and one stroke; all dashes share one path and one stroke. That keeps the
   * 300-string case at two draw batches instead of 300.
   */
  private redraw(): void {
    if (this.destroyed) {
      return;
    }

    this.associationGraphics.clear();
    this.provenanceGraphics.clear();

    const scale = this.viewport.scale;
    const window = this.screenCullingWindow();
    const visible: VisibleString[] = [];
    let associationCount = 0;
    let provenanceCount = 0;
    let resolvedCount = 0;

    for (const connection of this.connections) {
      const fromRect = this.screenRectFor(connection.fromCardId);
      const toRect = this.screenRectFor(connection.toCardId);

      if (fromRect === null || toRect === null) {
        continue;
      }

      resolvedCount += 1;

      if (!rectsIntersect(unionRect(fromRect, toRect), window)) {
        continue;
      }

      const geometry = computeStringGeometry(fromRect, toRect, {
        type: connection.type,
        scale,
      });

      if (!rectsIntersect(geometry.bounds, window)) {
        continue;
      }

      visible.push({ connection, geometry });

      if (geometry.dashed) {
        const dashes = computeStringDashes(geometry);
        for (const dash of dashes) {
          this.provenanceGraphics.moveTo(dash.start.x, dash.start.y);
          this.provenanceGraphics.lineTo(dash.end.x, dash.end.y);
        }
        provenanceCount += 1;
      } else {
        this.associationGraphics.moveTo(geometry.start.x, geometry.start.y);
        this.associationGraphics.quadraticCurveTo(
          geometry.control.x,
          geometry.control.y,
          geometry.end.x,
          geometry.end.y,
        );
        associationCount += 1;
      }
    }

    if (associationCount > 0) {
      const style = stringStrokeStyle('association', scale);
      this.associationGraphics.stroke({
        color: this.palette.association,
        width: style.width,
        cap: 'round',
        join: 'round',
      });
    }

    if (provenanceCount > 0) {
      const style = stringStrokeStyle('provenance', scale);
      this.provenanceGraphics.stroke({
        color: this.palette.provenance,
        width: style.width,
        cap: 'butt',
        join: 'round',
      });
    }

    this.visibleStrings = visible;
    this.resolvedCount = resolvedCount;
  }
}
