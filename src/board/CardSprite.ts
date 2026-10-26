/**
 * One pinned evidence card on the case board.
 *
 * A card is deliberately a leaf renderer: it owns its paper, pin, title strip,
 * type indicator, and the thumbnail/display texture pair, but it never reads a
 * repository and never decides where it is allowed to move. `CardLayer` owns
 * those decisions and the scene consumes a plain snapshot.
 *
 * Image policy:
 *
 * - A thumbnail is requested first so a card becomes legible before a larger
 *   derivative decodes.
 * - The display derivative replaces the thumbnail as soon as it is ready; the
 *   thumbnail texture is destroyed at the swap.
 * - Only cards inside the culling window request an image. Offscreen cards keep
 *   their lightweight paper geometry.
 */

import { Color, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';

import type { CardPosition, CardType } from '../domain/model';

import type { BoardCardImage } from './CardLayer';
import { BOARD_CARD_HEIGHT, BOARD_CARD_WIDTH } from './viewport';
import { liftScaleFor } from './useCardGestures';

/** The photo window inside the card, in card-local pixels. */
const PHOTO = Object.freeze({ x: 16, y: 92, width: BOARD_CARD_WIDTH - 32, height: 174 });

/** Padding used by the title strip and type indicator. */
const CARD_INSET = 16;

export interface BoardCardSnapshot {
  readonly id: string;
  readonly title: string;
  readonly type: CardType;
  readonly position: CardPosition;
  readonly image?: BoardCardImage;
}

export interface BoardPalette {
  readonly paper: number;
  readonly paperEdge: number;
  readonly paperInk: number;
  readonly paperInkMuted: number;
  readonly pinDome: number;
  readonly surfaceSunken: number;
  readonly selection: number;
  readonly headingFont: string;
  readonly bodyFont: string;
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

/** Read the board palette once per scene, not once per card. */
export function readBoardPalette(): BoardPalette {
  return {
    paper: pixiColor('--color-paper'),
    paperEdge: pixiColor('--color-paper-edge'),
    paperInk: pixiColor('--color-paper-ink'),
    paperInkMuted: pixiColor('--color-paper-ink-muted'),
    pinDome: pixiColor('--color-pin-dome'),
    surfaceSunken: pixiColor('--color-surface-sunken'),
    selection: pixiColor('--color-focus-ring'),
    headingFont: cssToken('--font-family-heading'),
    bodyFont: cssToken('--font-family-body'),
  };
}

function urlsEqual(first: BoardCardImage | undefined, second: BoardCardImage | undefined): boolean {
  return (
    first?.thumbnailUrl === second?.thumbnailUrl &&
    first?.displayUrl === second?.displayUrl &&
    first?.width === second?.width &&
    first?.height === second?.height
  );
}

/**
 * A card root whose pivot is its centre. Keeping the pivot centred means a
 * lift scale grows away from the pin rather than sliding the card's top-left
 * corner under the pointer.
 */
export class CardSprite {
  readonly root: Container;

  private readonly shadow: Graphics;
  private readonly paper: Graphics;
  private readonly selectionOutline: Graphics;
  private readonly photoFrame: Graphics;
  private readonly photoMask: Graphics;
  private readonly photo: Sprite;
  private readonly title: Text;
  private readonly typeLabel: Text;
  private readonly pin: Container;

  private cardId: string;
  private titleValue: string;
  private typeValue: CardType;
  private positionValue: CardPosition;
  private imageValue: BoardCardImage | undefined;

  private thumbnailTexture: Texture | null = null;
  private displayTexture: Texture | null = null;
  private visible = false;
  private imageGeneration = 0;
  private destroyed = false;

  constructor(card: BoardCardSnapshot, palette: BoardPalette) {
    this.cardId = card.id;
    this.titleValue = card.title;
    this.typeValue = card.type;
    this.positionValue = { ...card.position };
    this.imageValue = card.image;

    this.root = new Container();
    this.root.label = `board-card-${card.id}`;
    this.root.eventMode = 'none';
    // Cards are hidden until the first viewport cull marks them visible. This
    // prevents a large case from requesting every image on mount.
    this.root.visible = false;
    this.root.pivot.set(BOARD_CARD_WIDTH / 2, BOARD_CARD_HEIGHT / 2);
    this.root.position.set(
      card.position.x + BOARD_CARD_WIDTH / 2,
      card.position.y + BOARD_CARD_HEIGHT / 2,
    );

    this.shadow = new Graphics()
      .roundRect(5, 7, BOARD_CARD_WIDTH, BOARD_CARD_HEIGHT, 12)
      .fill({ color: 0x000000, alpha: 0.3 });

    this.paper = new Graphics()
      .roundRect(0, 0, BOARD_CARD_WIDTH, BOARD_CARD_HEIGHT, 10)
      .fill({ color: palette.paper })
      .stroke({ color: palette.paperEdge, width: 1 });

    this.selectionOutline = new Graphics()
      .roundRect(-2, -2, BOARD_CARD_WIDTH + 4, BOARD_CARD_HEIGHT + 4, 12)
      .stroke({ color: palette.selection, width: 2, alpha: 0.9 });
    this.selectionOutline.visible = false;

    this.photoFrame = new Graphics()
      .roundRect(PHOTO.x, PHOTO.y, PHOTO.width, PHOTO.height, 4)
      .fill({ color: palette.surfaceSunken, alpha: 0.55 })
      .stroke({ color: palette.paperEdge, width: 1, alpha: 0.7 });

    this.photoMask = new Graphics()
      .roundRect(PHOTO.x, PHOTO.y, PHOTO.width, PHOTO.height, 4)
      .fill({ color: 0xffffff });

    this.photo = new Sprite();
    this.photo.anchor.set(0.5);
    this.photo.position.set(PHOTO.x + PHOTO.width / 2, PHOTO.y + PHOTO.height / 2);
    this.photo.visible = false;
    this.photo.mask = this.photoMask;

    this.pin = new Container();
    this.pin.position.set(BOARD_CARD_WIDTH / 2, 12);
    const needle = new Graphics()
      .moveTo(0, 0)
      .lineTo(0, 14)
      .stroke({ color: palette.pinDome, width: 2, alpha: 0.7 });
    const dome = new Graphics()
      .circle(0, 0, 8)
      .fill({ color: palette.pinDome })
      .stroke({ color: 0x000000, width: 1, alpha: 0.35 });
    dome.circle(-2.5, -2.5, 2).fill({ color: 0xffffff, alpha: 0.45 });
    this.pin.addChild(needle, dome);

    this.title = new Text({
      text: card.title,
      style: {
        fontFamily: palette.headingFont,
        fontSize: 16,
        fontWeight: '600',
        fill: palette.paperInk,
        wordWrap: true,
        wordWrapWidth: BOARD_CARD_WIDTH - CARD_INSET * 2,
        breakWords: true,
        lineHeight: 20,
      },
    });
    this.title.label = 'board-card-title';
    this.title.position.set(CARD_INSET, 30);

    this.typeLabel = new Text({
      text: TYPE_LABELS[card.type],
      style: {
        fontFamily: palette.bodyFont,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1,
        fill: palette.paperInkMuted,
      },
    });
    this.typeLabel.label = 'board-card-type';
    this.typeLabel.position.set(CARD_INSET, BOARD_CARD_HEIGHT - 30);

    this.root.addChild(
      this.shadow,
      this.paper,
      this.selectionOutline,
      this.photoFrame,
      this.photo,
      this.photoMask,
      this.pin,
      this.title,
      this.typeLabel,
    );
  }

  get id(): string {
    return this.cardId;
  }

  get position(): CardPosition {
    return this.positionValue;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Apply a snapshot card without rebuilding the display list. */
  setCard(card: BoardCardSnapshot): void {
    if (this.destroyed) {
      return;
    }

    this.cardId = card.id;

    if (card.title !== this.titleValue) {
      this.titleValue = card.title;
      this.title.text = card.title;
    }

    if (card.type !== this.typeValue) {
      this.typeValue = card.type;
      this.typeLabel.text = TYPE_LABELS[card.type];
    }

    this.setPosition(card.position);

    if (!urlsEqual(card.image, this.imageValue)) {
      this.imageValue = card.image;
      this.releaseImages();
      if (this.visible) {
        this.loadImages();
      }
    }
  }

  setPosition(position: CardPosition): void {
    this.positionValue = { x: position.x, y: position.y };
    this.root.position.set(position.x + BOARD_CARD_WIDTH / 2, position.y + BOARD_CARD_HEIGHT / 2);
  }

  setSelected(selected: boolean): void {
    this.selectionOutline.visible = selected;
  }

  /**
   * Show or hide the card through culling. An offscreen card never starts a
   * texture request; panning it back into view starts the thumbnail/display
   * pair then.
   */
  setVisible(visible: boolean): void {
    if (this.destroyed || this.visible === visible) {
      return;
    }

    this.visible = visible;
    this.root.visible = visible;

    if (visible) {
      this.loadImages();
    }
  }

  /** The short lift used after a long press or an immediate mouse drag. */
  setLifted(lifted: boolean, reducedMotion: boolean): void {
    if (this.destroyed) {
      return;
    }

    const scale = liftScaleFor(lifted, reducedMotion);
    this.root.scale.set(scale);
    this.root.zIndex = lifted ? 10 : 0;
    this.shadow.alpha = lifted ? 0.46 : 0.3;
    this.shadow.position.set(lifted && !reducedMotion ? 9 : 5, lifted && !reducedMotion ? 13 : 7);
  }

  /** Re-upload the current image after a lost WebGL context. */
  rebuildAfterContextLoss(): void {
    this.thumbnailTexture?.source.update();
    this.displayTexture?.source.update();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.imageGeneration += 1;
    this.releaseImages();
    this.root.destroy({ children: true, context: true, style: true });
  }

  private loadImages(): void {
    const image = this.imageValue;
    if (this.destroyed || image === undefined) {
      return;
    }

    const generation = this.imageGeneration + 1;
    this.imageGeneration = generation;

    if (image.thumbnailUrl !== undefined) {
      this.loadTexture(image.thumbnailUrl, 'thumbnail', generation);
    }

    if (image.displayUrl !== undefined && image.displayUrl !== image.thumbnailUrl) {
      this.loadTexture(image.displayUrl, 'display', generation);
    }
  }

  /**
   * Load one derivative. The display wins whenever it is ready; a late
   * thumbnail never replaces a sharper display texture.
   */
  private loadTexture(url: string, kind: 'thumbnail' | 'display', generation: number): void {
    if (typeof Image === 'undefined') {
      return;
    }

    const image = new Image();
    image.decoding = 'async';

    image.onload = () => {
      if (this.destroyed || generation !== this.imageGeneration) {
        return;
      }

      let texture: Texture;
      try {
        texture = Texture.from(image);
      } catch {
        return;
      }

      if (kind === 'display') {
        this.displayTexture = texture;
        this.applyTexture(texture);
        this.destroyThumbnail();
        return;
      }

      if (this.displayTexture !== null) {
        texture.destroy(true);
        return;
      }

      this.thumbnailTexture = texture;
      this.applyTexture(texture);
    };

    image.onerror = () => {
      // A missing derivative is a placeholder, not a board failure.
    };

    image.src = url;
  }

  private applyTexture(texture: Texture): void {
    this.photo.texture = texture;
    this.photo.visible = true;
    this.photoFrame.alpha = 0.25;

    const image = this.imageValue;
    const sourceWidth = image?.width ?? texture.width;
    const sourceHeight = image?.height ?? texture.height;

    if (sourceWidth > 0 && sourceHeight > 0) {
      // Cover the photo window without distorting the source.
      const scale = Math.max(PHOTO.width / sourceWidth, PHOTO.height / sourceHeight);
      this.photo.scale.set(scale);
    } else {
      this.photo.scale.set(1);
    }
  }

  private destroyThumbnail(): void {
    if (this.thumbnailTexture === null) {
      return;
    }

    const texture = this.thumbnailTexture;
    this.thumbnailTexture = null;
    try {
      texture.destroy(true);
    } catch {
      // A renderer teardown may already have destroyed it.
    }
  }

  private releaseImages(): void {
    this.imageGeneration += 1;
    this.photo.visible = false;
    this.photo.texture = Texture.EMPTY;
    this.photoFrame.alpha = 1;

    const thumbnail = this.thumbnailTexture;
    const display = this.displayTexture;
    this.thumbnailTexture = null;
    this.displayTexture = null;

    for (const texture of [thumbnail, display]) {
      if (texture === null) {
        continue;
      }
      try {
        texture.destroy(true);
      } catch {
        // Idempotent teardown.
      }
    }
  }
}
