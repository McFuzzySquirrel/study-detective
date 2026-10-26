/**
 * The PixiJS case-board scene.
 *
 * The scene is a pure renderer of a plain snapshot: cards, their positions, and
 * the camera. It never opens Dexie, imports a feature form, or writes storage.
 * The page and board store emit camera and drag intents; this class only draws
 * them.
 *
 * Layers:
 *
 * - A screen-space tiled cork surface, whose offset follows the camera.
 * - A screen-space `StringLayer` below the cards, so thread ends tuck under
 *   card art. It redraws on a card move or a camera change.
 * - A world container whose transform is the camera.
 * - A `CardLayer` holding one card sprite per snapshot card.
 *
 * The background, strings, world, and card layer are created once and updated
 * on snapshot or viewport changes. Connection creation and labels are later
 * phases.
 */

import { Container, Texture, TilingSprite } from 'pixi.js';
import type { Application } from 'pixi.js';

import type { CardPosition, Viewport } from '../domain/model';

import { CardLayer } from './CardLayer';
import type { BoardCardSnapshot, BoardPalette } from './CardSprite';
import { readBoardPalette } from './CardSprite';
import { readStringPalette, StringLayer } from './StringLayer';
import type { BoardStringConnection } from './StringLayer';
import { normalizeViewport, type BoardSize } from './viewport';

export { BOARD_CARD_WIDTH, BOARD_CARD_HEIGHT, BOARD_CULL_MARGIN } from './CardLayer';
export type { BoardCardImage } from './CardLayer';
export type { BoardCardSnapshot } from './CardSprite';
export type { BoardStringConnection } from './StringLayer';

/**
 * The plain case snapshot consumed by the canvas. The page builds it from
 * repository records; nothing here refers to a repository or a persisted type.
 */
export interface BoardSnapshot {
  readonly caseId: string;
  readonly caseTitle: string;
  readonly cards: readonly BoardCardSnapshot[];
  /**
   * Undirected strings for the case. Optional so a card-only snapshot (or an
   * older page) still renders; an absent list means no strings.
   */
  readonly connections?: readonly BoardStringConnection[];
}

export interface BoardSceneOptions {
  readonly snapshot: BoardSnapshot;
  readonly viewport: Viewport;
  /** Initial OS motion preference. Defaults to no preference. */
  readonly reducedMotion?: boolean;
}

function cssToken(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (value.length === 0) {
    throw new Error(`The board theme is missing the ${name} token.`);
  }
  return value;
}

/**
 * Generate a small tileable cork texture from the theme tokens. It is created
 * once per scene and destroyed with the scene; no image request or object URL
 * is involved.
 */
function createCorkTexture(): Texture {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('The board cork texture needs a 2D canvas context.');
  }

  context.fillStyle = cssToken('--color-cork');
  context.fillRect(0, 0, size, size);

  const light = cssToken('--color-cork-grain-light');
  const dark = cssToken('--color-cork-grain-dark');

  // A deterministic pattern keeps repeated screenshots and tests stable.
  let seed = 0x9e3779b9;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let index = 0; index < 220; index += 1) {
    const x = Math.floor(random() * size);
    const y = Math.floor(random() * size);
    const length = random() > 0.7 ? 2 : 1;
    context.fillStyle = index % 3 === 0 ? light : dark;
    context.fillRect(x, y, length, 1);
  }

  return Texture.from(canvas);
}

function safeSize(size: BoardSize): BoardSize {
  return {
    width: Number.isFinite(size.width) ? Math.max(1, size.width) : 1,
    height: Number.isFinite(size.height) ? Math.max(1, size.height) : 1,
  };
}

function boardPalette(): BoardPalette {
  return readBoardPalette();
}

/** One Pixi scene, owned by the case-board canvas hook for one mount. */
export class BoardScene {
  private readonly stage: Container;
  private readonly background: TilingSprite;
  private readonly stringLayer: StringLayer;
  private readonly world: Container;
  private readonly cardLayer: CardLayer;

  private viewport: Viewport;
  private size: BoardSize;
  private destroyed = false;

  constructor(app: Application, options: BoardSceneOptions) {
    this.stage = app.stage;
    this.viewport = normalizeViewport(options.viewport);
    this.size = { width: 1, height: 1 };

    this.background = new TilingSprite({
      texture: createCorkTexture(),
      width: 1,
      height: 1,
    });
    this.background.label = 'board-cork';
    this.background.eventMode = 'none';

    this.world = new Container();
    this.world.label = 'board-world';
    this.world.eventMode = 'none';

    this.stringLayer = new StringLayer({
      palette: readStringPalette(),
      reducedMotion: options.reducedMotion ?? false,
    });
    this.cardLayer = new CardLayer({ palette: boardPalette() });

    this.world.addChild(this.cardLayer.root);
    this.stage.addChild(this.background, this.stringLayer.root, this.world);

    this.setSnapshot(options.snapshot);
  }

  /** Replace the card and connection snapshot, reusing unchanged card sprites. */
  setSnapshot(snapshot: BoardSnapshot): void {
    if (this.destroyed) {
      return;
    }

    this.cardLayer.setCards(snapshot.cards);
    this.stringLayer.setCards(snapshot.cards);
    this.stringLayer.setConnections(snapshot.connections ?? []);
    this.cardLayer.setViewport(this.viewport, this.size);
    this.stringLayer.setViewport(this.viewport, this.size);
  }

  /** Apply the camera and canvas size, then redraw the visible window. */
  setViewport(viewport: Viewport, size: BoardSize): void {
    if (this.destroyed) {
      return;
    }

    this.viewport = normalizeViewport(viewport);
    this.size = safeSize(size);

    const scale = this.viewport.scale;
    this.background.width = this.size.width;
    this.background.height = this.size.height;
    this.background.tileScale.set(scale);
    this.background.tilePosition.set(-this.viewport.x * scale, -this.viewport.y * scale);

    this.world.position.set(-this.viewport.x * scale, -this.viewport.y * scale);
    this.world.scale.set(scale);
    this.cardLayer.setViewport(this.viewport, this.size);
    this.stringLayer.setViewport(this.viewport, this.size);
  }

  /** Resize the cork surface without changing the camera. */
  resize(size: BoardSize): void {
    this.setViewport(this.viewport, size);
  }

  /** The live drag preview. The page persists only the final position. */
  moveCard(cardId: string, position: CardPosition): void {
    this.cardLayer.moveCard(cardId, position);
    this.stringLayer.moveCard(cardId, position);
  }

  setCardLifted(cardId: string, lifted: boolean, reducedMotion: boolean): void {
    this.cardLayer.setLifted(cardId, lifted, reducedMotion);
  }

  setSelectedCard(cardId: string | null): void {
    this.cardLayer.setSelected(cardId);
  }

  /** Record a mid-session motion preference for the static string layer. */
  setReducedMotion(reducedMotion: boolean): void {
    this.stringLayer.setReducedMotion(reducedMotion);
  }

  /** Resolve a screen-space point to a card, respecting the live camera. */
  cardAt(point: { readonly x: number; readonly y: number }): BoardCardSnapshot | null {
    return this.cardLayer.hitTest(point);
  }

  /** Resolve a screen-space point to the nearest visible string, if any. */
  stringAt(point: { readonly x: number; readonly y: number }): BoardStringConnection | null {
    return this.stringLayer.stringAt(point);
  }

  /**
   * A restored WebGL context re-uploads the procedural source and card images
   * before the current snapshot renders again.
   */
  rebuildAfterContextLoss(): void {
    if (this.destroyed) {
      return;
    }

    this.background.texture.source.update();
    this.cardLayer.rebuildAfterContextLoss();
    this.stringLayer.rebuildAfterContextLoss();
    this.setViewport(this.viewport, this.size);
  }

  /** Destroy card art, string geometry, the cork texture, and every card image. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    this.stage.removeChild(this.world, this.background, this.stringLayer.root);
    this.cardLayer.destroy();
    this.stringLayer.destroy();
    this.world.destroy({ children: true, context: true, style: true });
    this.background.destroy({ texture: true, textureSource: true });
  }
}
