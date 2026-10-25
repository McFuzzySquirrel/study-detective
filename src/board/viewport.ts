/**
 * Pure board viewport math.
 *
 * Coordinate contract:
 *
 * - World space holds card positions and string anchors.
 * - Screen space is the canvas rectangle, with its origin at the top-left.
 * - A viewport is `{ x, y, scale }`, where `x`/`y` is the world point shown at
 *   the top-left screen corner and `scale` is the zoom percentage as a factor.
 *
 *   `worldToScreen(point) = (point - viewport.origin) * scale`
 *   `screenToWorld(point) = point / scale + viewport.origin`
 *
 * Every helper in this module is deterministic, mutation-free, and independent
 * of PixiJS, Dexie, React, the DOM, and storage. Invalid camera values are
 * treated as a corrupted persisted viewport: non-finite components fall back to
 * the documented default and scale is clamped to 0.25-2.5 on read and write.
 *
 * This module is deliberately testable in a Node environment and is the single
 * source of truth for pan, zoom, fit, minimap projection, and serialization.
 */

import type { Viewport } from '../domain/model';

/** Zoom clamp, mirrored from the domain viewport schema. */
export const MIN_BOARD_SCALE = 0.25;
export const MAX_BOARD_SCALE = 2.5;

/** The camera used for a new case and for an empty fit. */
export const DEFAULT_BOARD_SCALE = 1;

/**
 * Default space between the fitted content and the edges of the canvas.
 * Fit always reserves this on every side before choosing a scale.
 */
export const DEFAULT_FIT_PADDING = 64;

/** Fit never magnifies past 100 percent; it may zoom out down to the clamp. */
export const DEFAULT_FIT_MAX_SCALE = 1;

/**
 * Card geometry used by fit-to-view when the caller only has positions.
 * BOARD-3 owns the real sprite layout; this 240px width is the fixed card width
 * from the feature contract and the height is a conservative title-strip size.
 * Callers that need exact bounds can use `fitViewportToBounds` directly.
 */
export const BOARD_CARD_WIDTH = 240;
export const BOARD_CARD_HEIGHT = 320;

/** Default padding around the card rectangles inside the minimap. */
export const DEFAULT_MINIMAP_PADDING = 8;

export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

export interface BoardSize {
  readonly width: number;
  readonly height: number;
}

/** An axis-aligned world rectangle. Width and height are always nonnegative. */
export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FitOptions {
  /** Screen pixels reserved on each side. Non-finite or negative values fall back. */
  readonly padding?: number;
  /** Upper zoom bound; defaults to 1 so fit never magnifies. Clamped to 2.5. */
  readonly maxScale?: number;
  /** Lower zoom bound; defaults to 0.25. Clamped to 0.25. */
  readonly minScale?: number;
  /** Card rectangle used by `fitViewportToCards`. Defaults to 240x320. */
  readonly cardSize?: BoardSize;
}

export interface MinimapProjection {
  /** World pixels to minimap pixels. */
  readonly scale: number;
  /** Minimap x of the world bounds' top-left corner (letterboxed). */
  readonly offsetX: number;
  /** Minimap y of the world bounds' top-left corner (letterboxed). */
  readonly offsetY: number;
}

export const DEFAULT_BOARD_VIEWPORT: Readonly<Viewport> = Object.freeze({
  x: 0,
  y: 0,
  scale: DEFAULT_BOARD_SCALE,
});

export const DEFAULT_FIT_CARD_SIZE: Readonly<BoardSize> = Object.freeze({
  width: BOARD_CARD_WIDTH,
  height: BOARD_CARD_HEIGHT,
});

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) >= 0 ? (value as number) : fallback;
}

/**
 * Clamp a zoom factor into the supported range. Non-finite values fall back to
 * `fallback` (1 by default) rather than producing a broken transform.
 */
export function clampScale(scale: number, fallback: number = DEFAULT_BOARD_SCALE): number {
  const safeFallback = Number.isFinite(fallback)
    ? Math.min(MAX_BOARD_SCALE, Math.max(MIN_BOARD_SCALE, fallback))
    : DEFAULT_BOARD_SCALE;

  if (!Number.isFinite(scale)) {
    return safeFallback;
  }

  return Math.min(MAX_BOARD_SCALE, Math.max(MIN_BOARD_SCALE, scale));
}

/**
 * Return a defensive, clamped viewport. Non-finite origins take the fallback
 * origin; a non-finite scale takes the fallback scale. Out-of-range numeric
 * scales are clamped rather than discarded so a hand-edited 10 becomes 2.5.
 */
export function normalizeViewport(
  viewport: Viewport | null | undefined,
  fallback: Viewport = DEFAULT_BOARD_VIEWPORT,
): Viewport {
  const fallbackX = finiteNumber(fallback.x, 0);
  const fallbackY = finiteNumber(fallback.y, 0);
  const fallbackScale = clampScale(fallback.scale);

  return {
    x: finiteNumber(viewport?.x, fallbackX),
    y: finiteNumber(viewport?.y, fallbackY),
    scale: clampScale(viewport?.scale ?? fallbackScale, fallbackScale),
  };
}

/**
 * Convert a world point to screen pixels. The result is not rounded: rendering
 * benefits from subpixel positions during pinch and trackpad zoom.
 */
export function worldToScreen(point: BoardPoint, viewport: Viewport): BoardPoint {
  const scale = clampScale(viewport.scale);

  return {
    x: (point.x - viewport.x) * scale,
    y: (point.y - viewport.y) * scale,
  };
}

/** Convert a screen pixel to world coordinates. */
export function screenToWorld(point: BoardPoint, viewport: Viewport): BoardPoint {
  const scale = clampScale(viewport.scale);

  return {
    x: point.x / scale + viewport.x,
    y: point.y / scale + viewport.y,
  };
}

/**
 * Pan by a screen-space pointer delta. Moving the pointer to the right drags
 * the cork to the right, so the camera origin moves left by `delta / scale`.
 */
export function panViewport(viewport: Viewport, delta: BoardPoint): Viewport {
  const current = normalizeViewport(viewport);

  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return current;
  }

  return {
    x: current.x - delta.x / current.scale,
    y: current.y - delta.y / current.scale,
    scale: current.scale,
  };
}

/**
 * Zoom so the world point currently under `anchor` stays under that same screen
 * point. Factors are multiplicative (`1.1` zooms in, `0.9` zooms out) and the
 * resulting scale is clamped to 0.25-2.5.
 */
export function zoomViewportAt(viewport: Viewport, anchor: BoardPoint, factor: number): Viewport {
  if (!Number.isFinite(factor) || factor <= 0) {
    return normalizeViewport(viewport);
  }

  const current = normalizeViewport(viewport);
  return zoomViewportToScale(current, current.scale * factor, anchor);
}

/**
 * Zoom to an absolute scale while keeping the pointer anchor fixed. Used by
 * wheel, pinch, and the overlay's zoom controls.
 */
export function zoomViewportToScale(
  viewport: Viewport,
  targetScale: number,
  anchor: BoardPoint,
): Viewport {
  const current = normalizeViewport(viewport);

  if (!Number.isFinite(targetScale) || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return current;
  }

  const scale = clampScale(targetScale);
  const worldAnchor = screenToWorld(anchor, current);

  return {
    x: worldAnchor.x - anchor.x / scale,
    y: worldAnchor.y - anchor.y / scale,
    scale,
  };
}

/**
 * The rectangle of world space currently visible on a screen of `viewportSize`.
 * Used by culling, the minimap viewport rectangle, and fit padding decisions.
 */
export function computeVisibleWorldRect(viewport: Viewport, viewportSize: BoardSize): WorldRect {
  const current = normalizeViewport(viewport);
  const width = positiveNumber(viewportSize.width, 1);
  const height = positiveNumber(viewportSize.height, 1);

  return {
    x: current.x,
    y: current.y,
    width: width / current.scale,
    height: height / current.scale,
  };
}

function isUsableRect(rect: WorldRect | null | undefined): rect is WorldRect {
  return (
    rect !== null &&
    rect !== undefined &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * Fit an explicit world rectangle into the canvas with padding, centring the
 * content and never exceeding the zoom clamp or the optional max scale.
 *
 * A missing or degenerate rectangle returns the default camera, which is the
 * safe empty-board state. A very large rectangle is clamped to 0.25 and remains
 * centred even though it cannot fully fit at the minimum zoom.
 */
export function fitViewportToBounds(
  bounds: WorldRect | null | undefined,
  viewportSize: BoardSize,
  options: FitOptions = {},
): Viewport {
  const width = positiveNumber(viewportSize.width, 0);
  const height = positiveNumber(viewportSize.height, 0);

  if (!isUsableRect(bounds) || width <= 0 || height <= 0) {
    return { ...DEFAULT_BOARD_VIEWPORT };
  }

  const padding = nonNegativeNumber(options.padding, DEFAULT_FIT_PADDING);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);

  const requestedMax = finiteNumber(options.maxScale, DEFAULT_FIT_MAX_SCALE);
  const maxScale = Math.min(MAX_BOARD_SCALE, Math.max(MIN_BOARD_SCALE, requestedMax));
  const requestedMin = finiteNumber(options.minScale, MIN_BOARD_SCALE);
  const minScale = Math.min(maxScale, Math.max(MIN_BOARD_SCALE, requestedMin));

  const fittedScale = Math.min(
    availableWidth / bounds.width,
    availableHeight / bounds.height,
    maxScale,
  );
  const scale = Math.min(maxScale, Math.max(minScale, fittedScale));

  return {
    x: bounds.x + bounds.width / 2 - width / (2 * scale),
    y: bounds.y + bounds.height / 2 - height / (2 * scale),
    scale,
  };
}

/**
 * Bounding rectangle for card rectangles. Non-finite positions are ignored so a
 * corrupted card row cannot poison the whole fit. Returns null for no cards.
 */
export function computeCardsBounds(
  positions: readonly BoardPoint[],
  cardSize: BoardSize = DEFAULT_FIT_CARD_SIZE,
): WorldRect | null {
  const cardWidth = positiveNumber(cardSize.width, BOARD_CARD_WIDTH);
  const cardHeight = positiveNumber(cardSize.height, BOARD_CARD_HEIGHT);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const position of positions) {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      continue;
    }

    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + cardWidth);
    maxY = Math.max(maxY, position.y + cardHeight);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Fit all card rectangles. Zero cards returns the default camera; one or many
 * cards are centred with the same padding and clamp rules as
 * `fitViewportToBounds`.
 */
export function fitViewportToCards(
  positions: readonly BoardPoint[],
  viewportSize: BoardSize,
  options: FitOptions = {},
): Viewport {
  const bounds = computeCardsBounds(positions, options.cardSize ?? DEFAULT_FIT_CARD_SIZE);
  return fitViewportToBounds(bounds, viewportSize, options);
}

/**
 * Union of any number of world rectangles, ignoring null and unusable entries.
 * The minimap passes the card bounds and the current visible rectangle so both
 * the case and the viewport remain on the inset.
 */
export function unionWorldRects(
  rects: readonly (WorldRect | null | undefined)[],
): WorldRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rect of rects) {
    if (
      rect === null ||
      rect === undefined ||
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width < 0 ||
      rect.height < 0
    ) {
      continue;
    }

    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Build the aspect-preserving, letterboxed mapping from world bounds into a
 * minimap rectangle. The minimap is an overview, not a camera: this transform
 * stays linear and unclamped.
 */
export function computeMinimapProjection(
  worldBounds: WorldRect | null | undefined,
  minimapSize: BoardSize,
  padding: number = DEFAULT_MINIMAP_PADDING,
): MinimapProjection {
  const width = positiveNumber(minimapSize.width, 1);
  const height = positiveNumber(minimapSize.height, 1);
  const inset = nonNegativeNumber(padding, DEFAULT_MINIMAP_PADDING);
  const contentWidth = Math.max(1, width - inset * 2);
  const contentHeight = Math.max(1, height - inset * 2);

  const boundsWidth = isUsableRect(worldBounds) ? worldBounds.width : 1;
  const boundsHeight = isUsableRect(worldBounds) ? worldBounds.height : 1;

  const rawScale = Math.min(contentWidth / boundsWidth, contentHeight / boundsHeight);
  const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;

  return {
    scale,
    offsetX: inset + (contentWidth - boundsWidth * scale) / 2,
    offsetY: inset + (contentHeight - boundsHeight * scale) / 2,
  };
}

function minimapOrigin(worldBounds: WorldRect | null | undefined): BoardPoint {
  return isUsableRect(worldBounds) ? { x: worldBounds.x, y: worldBounds.y } : { x: 0, y: 0 };
}

/** Project one world point into minimap pixel space. */
export function projectWorldToMinimap(
  point: BoardPoint,
  worldBounds: WorldRect | null | undefined,
  minimapSize: BoardSize,
  padding: number = DEFAULT_MINIMAP_PADDING,
): BoardPoint {
  const projection = computeMinimapProjection(worldBounds, minimapSize, padding);
  const origin = minimapOrigin(worldBounds);

  return {
    x: projection.offsetX + (point.x - origin.x) * projection.scale,
    y: projection.offsetY + (point.y - origin.y) * projection.scale,
  };
}

/** Project one world rectangle into minimap pixel space. */
export function projectWorldRectToMinimap(
  rect: WorldRect,
  worldBounds: WorldRect | null | undefined,
  minimapSize: BoardSize,
  padding: number = DEFAULT_MINIMAP_PADDING,
): WorldRect {
  const projection = computeMinimapProjection(worldBounds, minimapSize, padding);
  const origin = minimapOrigin(worldBounds);

  return {
    x: projection.offsetX + (rect.x - origin.x) * projection.scale,
    y: projection.offsetY + (rect.y - origin.y) * projection.scale,
    width: rect.width * projection.scale,
    height: rect.height * projection.scale,
  };
}

/**
 * Convert a minimap pixel back to world space. Callers clamp the point to the
 * inset themselves when a drag leaves the minimap.
 */
export function unprojectMinimapPoint(
  point: BoardPoint,
  worldBounds: WorldRect | null | undefined,
  minimapSize: BoardSize,
  padding: number = DEFAULT_MINIMAP_PADDING,
): BoardPoint {
  const projection = computeMinimapProjection(worldBounds, minimapSize, padding);
  const origin = minimapOrigin(worldBounds);
  const scale = projection.scale;

  return {
    x: (point.x - projection.offsetX) / scale + origin.x,
    y: (point.y - projection.offsetY) / scale + origin.y,
  };
}

/**
 * Project the current camera's visible world rectangle onto the minimap.
 * `worldBounds` should be the union of the card bounds and this visible rect.
 */
export function projectViewportToMinimap(
  viewport: Viewport,
  viewportSize: BoardSize,
  worldBounds: WorldRect | null | undefined,
  minimapSize: BoardSize,
  padding: number = DEFAULT_MINIMAP_PADDING,
): WorldRect {
  return projectWorldRectToMinimap(
    computeVisibleWorldRect(viewport, viewportSize),
    worldBounds,
    minimapSize,
    padding,
  );
}

/**
 * Produce a clamped, JSON-safe viewport for persistence. The shape matches the
 * domain `Viewport`, so it can be handed to `CaseRepository.saveViewport`.
 */
export function serializeViewport(viewport: Viewport): Viewport {
  return normalizeViewport(viewport);
}

/**
 * Restore a persisted viewport from an unknown value. Accepts either a plain
 * object or a JSON string. Missing, malformed, or non-finite components take
 * the fallback; an out-of-range numeric scale is clamped into 0.25-2.5.
 */
export function deserializeViewport(
  value: unknown,
  fallback: Viewport = DEFAULT_BOARD_VIEWPORT,
): Viewport {
  let candidate = value;

  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return normalizeViewport(fallback);
    }
  }

  if (typeof candidate !== 'object' || candidate === null) {
    return normalizeViewport(fallback);
  }

  const record = candidate as Record<string, unknown>;
  const fallbackViewport = normalizeViewport(fallback);
  const readNumber = (key: 'x' | 'y' | 'scale', defaultValue: number): number => {
    const component = record[key];
    return typeof component === 'number' && Number.isFinite(component) ? component : defaultValue;
  };

  return normalizeViewport(
    {
      x: readNumber('x', fallbackViewport.x),
      y: readNumber('y', fallbackViewport.y),
      scale: readNumber('scale', fallbackViewport.scale),
    },
    fallbackViewport,
  );
}

/** Floating-point comparison used by persistence and viewport dirty checks. */
export function viewportsEqual(first: Viewport, second: Viewport, epsilon: number = 1e-9): boolean {
  const tolerance = Number.isFinite(epsilon) && epsilon >= 0 ? epsilon : 1e-9;
  const a = normalizeViewport(first);
  const b = normalizeViewport(second);

  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.scale - b.scale) <= tolerance
  );
}
