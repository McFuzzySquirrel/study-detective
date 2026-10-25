/**
 * The PixiJS case-board scene.
 *
 * The scene is a pure renderer of a plain snapshot: cards, their positions, and
 * the camera. It never opens Dexie, imports a feature form, or writes storage.
 * The page and board store emit camera intents; this class only draws them.
 *
 * Layers:
 *
 * - A screen-space tiled cork surface, whose offset follows the camera.
 * - A world container whose transform is the camera; cards live in world space.
 *
 * The background and card containers are created once and updated on snapshot
 * or viewport changes. Card geometry is deliberately simple here; BOARD-3 owns
 * photo sprites, lift, and drag.
 */

import { Color, Container, Graphics, Text, Texture, TilingSprite } from 'pixi.js';
import type { Application } from 'pixi.js';

import type { CardPosition, CardType, Viewport } from '../domain/model';

import type { BoardTextureCache } from './textureCache';
import { BoardTextureCache as TextureCache } from './textureCache';
import {
  computeVisibleWorldRect,
  normalizeViewport,
  type BoardSize,
  type WorldRect,
} from './viewport';

/** Fixed card width at 100 percent, from the board contract. */
export const BOARD_CARD_WIDTH = 240;

/**
 * Card height used by this phase's placeholder card. It matches the viewport
 * helper's conservative fit bounds; BOARD-3 replaces the placeholder art but
 * keeps the fixed 240 px width.
 */
export const BOARD_CARD_HEIGHT = 320;

/** Extra world margin kept rendered around the viewport during pan and zoom. */
export const BOARD_CULL_MARGIN = 200;

export interface BoardCardSnapshot {
  readonly id: string;
  readonly title: string;
  readonly type: CardType;
  readonly position: CardPosition;
}

/**
 * The plain case snapshot consumed by the canvas. The page builds it from
 * repository records; nothing here refers to a repository or a persisted type.
 */
export interface BoardSnapshot {
  readonly caseId: string;
  readonly caseTitle: string;
  readonly cards: readonly BoardCardSnapshot[];
}

export interface BoardSceneOptions {
  readonly snapshot: BoardSnapshot;
  readonly viewport: Viewport;
}

interface BoardPalette {
  readonly paper: number;
  readonly paperEdge: number;
  readonly paperInk: number;
  readonly paperInkMuted: number;
  readonly pinDome: number;
  readonly surfaceSunken: number;
  readonly headingFont: string;
  readonly bodyFont: string;
}

interface CardView {
  readonly root: Container;
  readonly title: Text;
  readonly typeLabel: Text;
  titleValue: string;
  typeValue: CardType;
}

const TYPE_LABELS: Record<CardType, string> = {
  note: 'NOTE',
  source: 'SOURCE',
  topic: 'TOPIC',
};

function cssToken(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (value.length === 0) {
    throw new Error(`The board theme is missing the ${name} token.`);
  }
  return value;
}

function pixiColor(name: string): number {
  return new Color(cssToken(name)).toNumber();
}

function readPalette(): BoardPalette {
  return {
    paper: pixiColor('--color-paper'),
    paperEdge: pixiColor('--color-paper-edge'),
    paperInk: pixiColor('--color-paper-ink'),
    paperInkMuted: pixiColor('--color-paper-ink-muted'),
    pinDome: pixiColor('--color-pin-dome'),
    surfaceSunken: pixiColor('--color-surface-sunken'),
    headingFont: cssToken('--font-family-heading'),
    bodyFont: cssToken('--font-family-body'),
  };
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

function cardBounds(card: BoardCardSnapshot): WorldRect {
  return {
    x: card.position.x,
    y: card.position.y,
    width: BOARD_CARD_WIDTH,
    height: BOARD_CARD_HEIGHT,
  };
}

function rectanglesIntersect(first: WorldRect, second: WorldRect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

/** One Pixi scene, owned by the case-board canvas hook for one mount. */
export class BoardScene {
  private readonly stage: Container;
  private readonly background: TilingSprite;
  private readonly world: Container;
  private readonly cardLayer: Container;
  private readonly cardViews = new Map<string, CardView>();
  private readonly palette: BoardPalette;
  private readonly textures: BoardTextureCache<Texture>;
  private cardsById = new Map<string, BoardCardSnapshot>();

  private viewport: Viewport;
  private size: BoardSize;
  private destroyed = false;

  constructor(app: Application, options: BoardSceneOptions) {
    this.stage = app.stage;
    this.palette = readPalette();
    this.viewport = normalizeViewport(options.viewport);
    this.size = { width: 1, height: 1 };
    this.textures = new TextureCache<Texture>({ maxTextures: 200 });

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

    this.cardLayer = new Container();
    this.cardLayer.label = 'board-card-layer';
    this.cardLayer.eventMode = 'none';

    this.world.addChild(this.cardLayer);
    this.stage.addChild(this.background, this.world);

    this.setSnapshot(options.snapshot);
  }

  /** Replace the card snapshot, reusing unchanged card containers. */
  setSnapshot(snapshot: BoardSnapshot): void {
    if (this.destroyed) {
      return;
    }

    this.cardsById = new Map(snapshot.cards.map((card) => [card.id, card]));
    const nextIds = new Set(this.cardsById.keys());

    for (const [id, view] of [...this.cardViews]) {
      if (!nextIds.has(id)) {
        this.cardLayer.removeChild(view.root);
        view.root.destroy({ children: true, context: true, style: true });
        this.cardViews.delete(id);
        this.textures.releaseCard(id);
      }
    }

    for (const card of snapshot.cards) {
      const existing = this.cardViews.get(card.id);

      if (existing === undefined) {
        const view = this.createCardView(card);
        this.cardViews.set(card.id, view);
        this.cardLayer.addChild(view.root);
        continue;
      }

      if (existing.titleValue !== card.title) {
        existing.titleValue = card.title;
        existing.title.text = card.title;
      }

      if (existing.typeValue !== card.type) {
        existing.typeValue = card.type;
        existing.typeLabel.text = TYPE_LABELS[card.type];
      }

      existing.root.position.set(card.position.x, card.position.y);
    }

    this.updateCulling();
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
    this.updateCulling();
  }

  /** Resize the cork surface without changing the camera. */
  resize(size: BoardSize): void {
    this.setViewport(this.viewport, size);
  }

  /**
   * A restored WebGL context re-uploads the procedural source and renders the
   * current snapshot again. PixiJS owns the renderer/context restoration.
   */
  rebuildAfterContextLoss(): void {
    if (this.destroyed) {
      return;
    }

    const source = this.background.texture.source;
    source.update();
    this.setViewport(this.viewport, this.size);
  }

  /** Destroy card art, the cork texture, and every cached derivative. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    this.cardViews.clear();
    this.textures.destroy();

    this.stage.removeChild(this.world, this.background);
    this.world.destroy({ children: true, context: true, style: true });
    this.background.destroy({ texture: true, textureSource: true });
  }

  /** Cards intersecting the viewport plus the 200 px screen-space margin. */
  private updateCulling(): void {
    const visible = computeVisibleWorldRect(this.viewport, this.size);
    const margin = BOARD_CULL_MARGIN / this.viewport.scale;
    const cullWindow: WorldRect = {
      x: visible.x - margin,
      y: visible.y - margin,
      width: visible.width + margin * 2,
      height: visible.height + margin * 2,
    };
    const cards = this.cardsById;

    for (const [id, view] of this.cardViews) {
      const card = cards.get(id);
      if (card === undefined) {
        view.root.visible = false;
        continue;
      }

      view.root.visible = rectanglesIntersect(cardBounds(card), cullWindow);
    }
  }

  private createCardView(card: BoardCardSnapshot): CardView {
    const root = new Container();
    root.label = `board-card-${card.id}`;
    root.position.set(card.position.x, card.position.y);
    root.eventMode = 'none';

    const width = BOARD_CARD_WIDTH;
    const height = BOARD_CARD_HEIGHT;

    const shadow = new Graphics();
    shadow.roundRect(5, 7, width, height, 12).fill({ color: 0x000000, alpha: 0.3 });

    const paper = new Graphics();
    paper
      .roundRect(0, 0, width, height, 10)
      .fill({ color: this.palette.paper })
      .stroke({ color: this.palette.paperEdge, width: 1 });

    const photo = new Graphics();
    photo
      .roundRect(16, 92, width - 32, 174, 4)
      .fill({ color: this.palette.surfaceSunken, alpha: 0.55 })
      .stroke({ color: this.palette.paperEdge, width: 1, alpha: 0.7 });

    const pin = new Graphics();
    pin
      .circle(width / 2, 12, 8)
      .fill({ color: this.palette.pinDome })
      .stroke({ color: 0x000000, width: 1, alpha: 0.35 });
    pin.circle(width / 2 - 2.5, 9.5, 2).fill({ color: 0xffffff, alpha: 0.45 });

    const title = new Text({
      text: card.title,
      style: {
        fontFamily: this.palette.headingFont,
        fontSize: 16,
        fontWeight: '600',
        fill: this.palette.paperInk,
        wordWrap: true,
        wordWrapWidth: width - 32,
        breakWords: true,
        lineHeight: 20,
      },
    });
    title.label = 'board-card-title';
    title.position.set(16, 28);

    const typeLabel = new Text({
      text: TYPE_LABELS[card.type],
      style: {
        fontFamily: this.palette.bodyFont,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1,
        fill: this.palette.paperInkMuted,
      },
    });
    typeLabel.label = 'board-card-type';
    typeLabel.position.set(16, height - 30);

    root.addChild(shadow, paper, photo, pin, title, typeLabel);

    return {
      root,
      title,
      typeLabel,
      titleValue: card.title,
      typeValue: card.type,
    };
  }
}
