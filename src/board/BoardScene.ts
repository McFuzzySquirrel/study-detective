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
 * - A screen-space temporary thread layer for an in-flight anchor drag.
 * - A world container whose transform is the camera.
 * - A `CardLayer` holding one card sprite per snapshot card, including the one
 *   visible thread anchor.
 *
 * The background, strings, thread draft, world, and card layer are created once
 * and updated on snapshot or viewport changes. The scene never writes a
 * connection; it emits the drop through the canvas/page boundary.
 */

import { Container, Texture, TilingSprite } from 'pixi.js';
import type { Application } from 'pixi.js';

import type { CardPosition, Viewport } from '../domain/model';

import { CardLayer } from './CardLayer';
import type { BoardCardSnapshot, BoardPalette } from './CardSprite';
import { readBoardPalette } from './CardSprite';
import { readScratchStringPalette, readStringPalette, StringLayer } from './StringLayer';
import type { BoardStringConnection } from './StringLayer';
import { ThreadAnchorLayer, threadAnchorScreenPoint } from './ThreadAnchor';
import { normalizeViewport, type BoardPoint, type BoardSize } from './viewport';

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
  /**
   * Recall's non-persistent scratch strings. They are rendered in a separate
   * neutral layer and are never mixed with the truth layer, so entering recall
   * cannot reveal an association or provenance colour by accident.
   */
  readonly scratchConnections?: readonly BoardStringConnection[];
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

/**
 * Scratch strings have no relationship type. Mapping every pair to the solid
 * association geometry keeps the layer simple; its separate neutral palette is
 * what prevents the truth colours from leaking into recall.
 */
function neutralScratchStrings(
  connections: readonly BoardStringConnection[] | undefined,
): readonly BoardStringConnection[] {
  if (connections === undefined || connections.length === 0) {
    return [];
  }

  return connections.map((connection) => ({
    id: connection.id,
    fromCardId: connection.fromCardId,
    toCardId: connection.toCardId,
    type: 'association',
  }));
}

/** One Pixi scene, owned by the case-board canvas hook for one mount. */
export class BoardScene {
  private readonly stage: Container;
  private readonly background: TilingSprite;
  private readonly stringLayer: StringLayer;
  private readonly scratchLayer: StringLayer;
  private readonly threadLayer: ThreadAnchorLayer;
  private readonly world: Container;
  private readonly cardLayer: CardLayer;

  private viewport: Viewport;
  private size: BoardSize;
  private anchorCardId: string | null = null;
  private connectSourceId: string | null = null;
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
    // Passive so the card layer's thread anchor can be hit-tested by Pixi.
    this.world.eventMode = 'passive';

    const stringPalette = readStringPalette();
    this.stringLayer = new StringLayer({
      palette: stringPalette,
      reducedMotion: options.reducedMotion ?? false,
    });
    this.scratchLayer = new StringLayer({
      palette: readScratchStringPalette(),
      reducedMotion: options.reducedMotion ?? false,
    });
    this.threadLayer = new ThreadAnchorLayer(stringPalette.association);
    this.cardLayer = new CardLayer({ palette: boardPalette() });

    this.world.addChild(this.cardLayer.root);
    // The temporary thread sits below the cards, like the permanent strings.
    // Scratch strings sit above truth strings but below the draft thread; in
    // recall the truth layer is empty, so only the neutral layer is visible.
    this.stage.addChild(
      this.background,
      this.stringLayer.root,
      this.scratchLayer.root,
      this.threadLayer.root,
      this.world,
    );

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
    this.scratchLayer.setCards(snapshot.cards);
    this.scratchLayer.setConnections(neutralScratchStrings(snapshot.scratchConnections));
    this.cardLayer.setAnchorCard(this.anchorCardId);
    this.cardLayer.setViewport(this.viewport, this.size);
    this.stringLayer.setViewport(this.viewport, this.size);
    this.scratchLayer.setViewport(this.viewport, this.size);
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
    this.scratchLayer.setViewport(this.viewport, this.size);
  }

  /** Resize the cork surface without changing the camera. */
  resize(size: BoardSize): void {
    this.setViewport(this.viewport, size);
  }

  /** The live drag preview. The page persists only the final position. */
  moveCard(cardId: string, position: CardPosition): void {
    this.cardLayer.moveCard(cardId, position);
    this.stringLayer.moveCard(cardId, position);
    this.scratchLayer.moveCard(cardId, position);
  }

  setCardLifted(cardId: string, lifted: boolean, reducedMotion: boolean): void {
    this.cardLayer.setLifted(cardId, lifted, reducedMotion);
  }

  setSelectedCard(cardId: string | null): void {
    this.cardLayer.setSelected(cardId);
  }

  /** Move the single visible thread anchor to the selected/hovered card. */
  setAnchorCard(cardId: string | null): void {
    this.anchorCardId = cardId;
    this.cardLayer.setAnchorCard(cardId);
  }

  /**
   * Start the temporary thread at the source card's edge anchor. `screenPoint`
   * is host-local screen space, matching the pointer events.
   */
  beginThread(cardId: string, screenPoint: BoardPoint): void {
    if (this.destroyed) {
      return;
    }

    const card = this.cardLayer.getCard(cardId);
    if (card === null) {
      return;
    }

    this.connectSourceId = cardId;
    this.threadLayer.begin(
      threadAnchorScreenPoint(card.position, this.viewport),
      this.viewport.scale,
    );
    this.threadLayer.update(screenPoint);
  }

  /**
   * Follow the pointer and highlight only a *different* card. Self-drops are
   * rejected by the page, but they should never look like a valid target.
   */
  updateThread(screenPoint: BoardPoint, targetCardId: string | null): void {
    if (this.destroyed || this.connectSourceId === null) {
      return;
    }

    this.threadLayer.update(screenPoint);
    const target =
      targetCardId !== null && targetCardId !== this.connectSourceId ? targetCardId : null;
    this.cardLayer.setConnectTarget(target);
  }

  /** Cancel or complete the temporary thread and clear target highlighting. */
  endThread(): void {
    this.connectSourceId = null;
    this.threadLayer.end();
    this.cardLayer.setConnectTarget(null);
  }

  /** Record a mid-session motion preference for the static string layer. */
  setReducedMotion(reducedMotion: boolean): void {
    this.stringLayer.setReducedMotion(reducedMotion);
    this.scratchLayer.setReducedMotion(reducedMotion);
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
    this.scratchLayer.rebuildAfterContextLoss();
    this.threadLayer.rebuildAfterContextLoss();
    this.setViewport(this.viewport, this.size);
  }

  /** Destroy card art, string geometry, the cork texture, and every card image. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.anchorCardId = null;
    this.connectSourceId = null;

    this.stage.removeChild(
      this.world,
      this.background,
      this.stringLayer.root,
      this.scratchLayer.root,
      this.threadLayer.root,
    );
    this.cardLayer.destroy();
    this.stringLayer.destroy();
    this.scratchLayer.destroy();
    this.threadLayer.destroy();
    this.world.destroy({ children: true, context: true, style: true });
    this.background.destroy({ texture: true, textureSource: true });
  }
}
