// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  BOARD_CARD_HEIGHT,
  BOARD_CARD_WIDTH,
  DEFAULT_BOARD_VIEWPORT,
  DEFAULT_FIT_PADDING,
  MAX_BOARD_SCALE,
  MIN_BOARD_SCALE,
  clampScale,
  computeCardsBounds,
  computeMinimapProjection,
  computeVisibleWorldRect,
  deserializeViewport,
  fitViewportToBounds,
  fitViewportToCards,
  normalizeViewport,
  panViewport,
  projectViewportToMinimap,
  projectWorldRectToMinimap,
  projectWorldToMinimap,
  screenToWorld,
  serializeViewport,
  unionWorldRects,
  unprojectMinimapPoint,
  viewportsEqual,
  worldToScreen,
  zoomViewportAt,
  zoomViewportToScale,
  type BoardPoint,
  type BoardSize,
  type WorldRect,
} from '../../src/board/viewport';
import type { Viewport } from '../../src/domain/model';

const SCALES = [0.25, 0.4, 1, 1.75, 2.5] as const;
const POINTS: readonly BoardPoint[] = [
  { x: -1200, y: -640 },
  { x: -1, y: 3 },
  { x: 0, y: 0 },
  { x: 320, y: 240 },
  { x: 9000, y: -4000 },
];
const ORIGINS: readonly BoardPoint[] = [
  { x: 0, y: 0 },
  { x: -240, y: 96 },
  { x: 640, y: 400 },
];

function expectClosePoint(actual: BoardPoint, expected: BoardPoint, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

function frozenViewport(viewport: Viewport): Viewport {
  return Object.freeze({ ...viewport });
}

describe('scale clamp and normalization', () => {
  it('clamps numeric scales into 0.25-2.5', () => {
    expect(clampScale(MIN_BOARD_SCALE)).toBe(0.25);
    expect(clampScale(MAX_BOARD_SCALE)).toBe(2.5);
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0)).toBe(0.25);
    expect(clampScale(-4)).toBe(0.25);
    expect(clampScale(0.249)).toBe(0.25);
    expect(clampScale(10)).toBe(2.5);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampScale(Number.NEGATIVE_INFINITY, 1.75)).toBe(1.75);
  });

  it('normalizes corrupted origins and scales without mutating input', () => {
    const corrupted = frozenViewport({
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      scale: Number.NaN,
    });

    expect(normalizeViewport(corrupted)).toEqual({ x: 0, y: 0, scale: 1 });
    expect(normalizeViewport({ x: -240, y: 96, scale: 12 })).toEqual({
      x: -240,
      y: 96,
      scale: 2.5,
    });
    expect(normalizeViewport({ x: -240, y: 96, scale: 0.01 })).toEqual({
      x: -240,
      y: 96,
      scale: 0.25,
    });
  });

  it('uses the documented fallback for null, undefined, and invalid components', () => {
    expect(normalizeViewport(null)).toEqual(DEFAULT_BOARD_VIEWPORT);
    expect(normalizeViewport(undefined)).toEqual(DEFAULT_BOARD_VIEWPORT);
    expect(
      normalizeViewport(frozenViewport({ x: 12, y: 24, scale: 1.5 }), {
        x: -10,
        y: -20,
        scale: 1.25,
      }),
    ).toEqual({ x: 12, y: 24, scale: 1.5 });
    expect(
      normalizeViewport(frozenViewport({ x: Number.NaN, y: Number.NaN, scale: 2 }), {
        x: -10,
        y: -20,
        scale: 1.25,
      }),
    ).toEqual({ x: -10, y: -20, scale: 2 });
  });
});

describe('screen and world transforms', () => {
  it('applies the documented transform at every supported scale', () => {
    for (const scale of SCALES) {
      const viewport = frozenViewport({ x: -240, y: 96, scale });

      expect(worldToScreen({ x: -140, y: 196 }, viewport)).toEqual({
        x: 100 * scale,
        y: 100 * scale,
      });
      expect(screenToWorld({ x: 100 * scale, y: 100 * scale }, viewport)).toEqual({
        x: -140,
        y: 196,
      });
    }
  });

  it('round-trips screen -> world -> screen within floating tolerance', () => {
    for (const origin of ORIGINS) {
      for (const scale of SCALES) {
        const viewport = frozenViewport({ ...origin, scale });

        for (const point of POINTS) {
          expectClosePoint(worldToScreen(screenToWorld(point, viewport), viewport), point);
          expectClosePoint(screenToWorld(worldToScreen(point, viewport), viewport), point);
        }
      }
    }
  });

  it('treats an out-of-range viewport scale as the clamped value', () => {
    expect(worldToScreen({ x: 100, y: 100 }, { x: 0, y: 0, scale: 10 })).toEqual({
      x: 250,
      y: 250,
    });
    expect(screenToWorld({ x: 250, y: 250 }, { x: 0, y: 0, scale: 10 })).toEqual({
      x: 100,
      y: 100,
    });
  });
});

describe('pan', () => {
  it('translates the origin by the screen delta divided by scale', () => {
    const viewport = frozenViewport({ x: 100, y: 50, scale: 2 });
    const panned = panViewport(viewport, { x: 80, y: -40 });

    expect(panned).toEqual({ x: 60, y: 70, scale: 2 });
    // The cork follows the pointer: the world point under the pointer before
    // the pan moves with it by the same screen delta.
    const before = screenToWorld({ x: 10, y: 10 }, viewport);
    const after = screenToWorld({ x: 90, y: -30 }, panned);
    expectClosePoint(after, before);
  });

  it('scales the world translation at the minimum and maximum zoom', () => {
    expect(panViewport({ x: 0, y: 0, scale: 0.25 }, { x: 100, y: 100 })).toEqual({
      x: -400,
      y: -400,
      scale: 0.25,
    });
    expect(panViewport({ x: 0, y: 0, scale: 2.5 }, { x: 100, y: 100 })).toEqual({
      x: -40,
      y: -40,
      scale: 2.5,
    });
  });

  it('ignores non-finite deltas and returns a normalized camera', () => {
    const panned = panViewport(
      { x: 0, y: 0, scale: 10 },
      {
        x: Number.NaN,
        y: Number.POSITIVE_INFINITY,
      },
    );

    expect(panned).toEqual({ x: 0, y: 0, scale: 2.5 });
    expect(panViewport({ x: 0, y: 0, scale: 1 }, { x: Number.NaN, y: 0 })).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    });
  });
});

describe('pointer-anchored zoom', () => {
  it('keeps the world point under the anchor fixed across factors', () => {
    const viewport = frozenViewport({ x: 100, y: -50, scale: 1 });
    const anchor = { x: 640, y: 400 };
    const worldBefore = screenToWorld(anchor, viewport);

    for (const factor of [0.5, 0.9, 1.1, 1.4, 2]) {
      const zoomed = zoomViewportAt(viewport, anchor, factor);
      expect(zoomed.scale).toBeCloseTo(viewport.scale * factor, 12);
      expectClosePoint(screenToWorld(anchor, zoomed), worldBefore);
    }
  });

  it('keeps corner anchors fixed at the zoom clamps', () => {
    const viewport = frozenViewport({ x: -240, y: 96, scale: 1 });

    for (const anchor of [
      { x: 0, y: 0 },
      { x: 1280, y: 0 },
      { x: 0, y: 800 },
      { x: 1280, y: 800 },
    ]) {
      const worldBefore = screenToWorld(anchor, viewport);
      const maximum = zoomViewportAt(viewport, anchor, 1000);
      const minimum = zoomViewportAt(viewport, anchor, 0.0001);

      expect(maximum.scale).toBe(2.5);
      expect(minimum.scale).toBe(0.25);
      expectClosePoint(screenToWorld(anchor, maximum), worldBefore);
      expectClosePoint(screenToWorld(anchor, minimum), worldBefore);
    }
  });

  it('supports absolute zoom and clamps it', () => {
    const viewport = frozenViewport({ x: 40, y: -20, scale: 1 });
    const anchor = { x: 320, y: 240 };
    const worldBefore = screenToWorld(anchor, viewport);

    const zoomed = zoomViewportToScale(viewport, 1.75, anchor);
    expect(zoomed.scale).toBe(1.75);
    expectClosePoint(screenToWorld(anchor, zoomed), worldBefore);

    expect(zoomViewportToScale(viewport, 40, anchor).scale).toBe(2.5);
    expect(zoomViewportToScale(viewport, 0.001, anchor).scale).toBe(0.25);
  });

  it('ignores invalid factors, anchors, and target scales', () => {
    const viewport = frozenViewport({ x: 10, y: 20, scale: 1.5 });

    expect(zoomViewportAt(viewport, { x: 0, y: 0 }, Number.NaN)).toEqual(viewport);
    expect(zoomViewportAt(viewport, { x: 0, y: 0 }, 0)).toEqual(viewport);
    expect(zoomViewportAt(viewport, { x: 0, y: 0 }, -2)).toEqual(viewport);
    expect(zoomViewportAt(viewport, { x: Number.NaN, y: 0 }, 2)).toEqual(viewport);
    expect(zoomViewportToScale(viewport, Number.NaN, { x: 0, y: 0 })).toEqual(viewport);
    expect(zoomViewportToScale(viewport, 2, { x: 0, y: Number.POSITIVE_INFINITY })).toEqual(
      viewport,
    );
  });
});

describe('fit to cards', () => {
  const viewportSize: BoardSize = { width: 1280, height: 800 };

  it('returns the default camera for zero cards', () => {
    expect(fitViewportToCards([], viewportSize)).toEqual(DEFAULT_BOARD_VIEWPORT);
    expect(computeCardsBounds([])).toBeNull();
  });

  it('centres one card without magnifying past 100 percent', () => {
    const fitted = fitViewportToCards([{ x: 100, y: 200 }], viewportSize);

    expect(fitted.scale).toBe(1);
    const cardCenter = {
      x: 100 + BOARD_CARD_WIDTH / 2,
      y: 200 + BOARD_CARD_HEIGHT / 2,
    };
    expectClosePoint(worldToScreen(cardCenter, fitted), { x: 640, y: 400 });
  });

  it('fits many cards with padding and never exceeds the clamp', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 2000, y: 1200 },
      { x: 900, y: -300 },
    ];
    const bounds = computeCardsBounds(positions);
    expect(bounds).not.toBeNull();

    const fitted = fitViewportToCards(positions, viewportSize);
    expect(fitted.scale).toBeGreaterThan(0.25);
    expect(fitted.scale).toBeLessThan(1);
    expect(fitted.scale).toBeLessThanOrEqual(MAX_BOARD_SCALE);
    expect(fitted.scale).toBeGreaterThanOrEqual(MIN_BOARD_SCALE);

    const topLeft = worldToScreen({ x: bounds?.x ?? 0, y: bounds?.y ?? 0 }, fitted);
    const bottomRight = worldToScreen(
      {
        x: (bounds?.x ?? 0) + (bounds?.width ?? 0),
        y: (bounds?.y ?? 0) + (bounds?.height ?? 0),
      },
      fitted,
    );

    expect(topLeft.x).toBeGreaterThanOrEqual(DEFAULT_FIT_PADDING - 1e-6);
    expect(topLeft.y).toBeGreaterThanOrEqual(DEFAULT_FIT_PADDING - 1e-6);
    expect(bottomRight.x).toBeLessThanOrEqual(viewportSize.width - DEFAULT_FIT_PADDING + 1e-6);
    expect(bottomRight.y).toBeLessThanOrEqual(viewportSize.height - DEFAULT_FIT_PADDING + 1e-6);
    expectClosePoint(
      worldToScreen(
        {
          x: (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
          y: (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2,
        },
        fitted,
      ),
      { x: 640, y: 400 },
    );
  });

  it('clamps a very large case to 0.25 and still centres it', () => {
    const fitted = fitViewportToCards(
      [
        { x: 0, y: 0 },
        { x: 100_000, y: 100_000 },
      ],
      viewportSize,
    );

    expect(fitted.scale).toBe(0.25);
    expectClosePoint(worldToScreen({ x: 50_120, y: 50_160 }, fitted), { x: 640, y: 400 });
  });

  it('honours custom padding, card size, and scale bounds', () => {
    const positions = [{ x: 0, y: 0 }];
    const padded = fitViewportToCards(positions, viewportSize, { padding: 200 });
    expect(padded.scale).toBe(1);

    const small = fitViewportToBounds({ x: 0, y: 0, width: 1, height: 1 }, viewportSize, {
      padding: 0,
      maxScale: 99,
    });
    expect(small.scale).toBe(2.5);

    const withBounds = fitViewportToCards(positions, viewportSize, {
      cardSize: { width: 1000, height: 1000 },
      maxScale: 0.8,
    });
    expect(withBounds.scale).toBeLessThanOrEqual(0.8);
  });

  it('falls back to the default camera for invalid bounds or viewport sizes', () => {
    expect(fitViewportToBounds(null, viewportSize)).toEqual(DEFAULT_BOARD_VIEWPORT);
    expect(fitViewportToBounds({ x: 0, y: 0, width: 0, height: 100 }, viewportSize)).toEqual(
      DEFAULT_BOARD_VIEWPORT,
    );
    expect(
      fitViewportToBounds({ x: 0, y: 0, width: 100, height: 100 }, { width: 0, height: 0 }),
    ).toEqual(DEFAULT_BOARD_VIEWPORT);
    expect(
      fitViewportToBounds(
        { x: Number.NaN, y: 0, width: 100, height: 100 },
        { width: 1280, height: 800 },
      ),
    ).toEqual(DEFAULT_BOARD_VIEWPORT);
  });
});

describe('visible world bounds and minimap projection', () => {
  const minimapSize: BoardSize = { width: 200, height: 200 };
  const worldBounds: WorldRect = { x: 0, y: 0, width: 1000, height: 500 };

  it('computes the visible world rectangle from the camera', () => {
    expect(
      computeVisibleWorldRect({ x: 100, y: -50, scale: 2 }, { width: 800, height: 600 }),
    ).toEqual({ x: 100, y: -50, width: 400, height: 300 });
  });

  it('projects world bounds into the minimap with aspect-preserving letterboxing', () => {
    const projection = computeMinimapProjection(worldBounds, minimapSize, 10);

    expect(projection.scale).toBeCloseTo(0.18, 12);
    expect(projection.offsetX).toBeCloseTo(10, 12);
    expect(projection.offsetY).toBeCloseTo(55, 12);
    expectClosePoint(projectWorldToMinimap({ x: 0, y: 0 }, worldBounds, minimapSize, 10), {
      x: 10,
      y: 55,
    });
    expectClosePoint(projectWorldToMinimap({ x: 1000, y: 500 }, worldBounds, minimapSize, 10), {
      x: 190,
      y: 145,
    });
  });

  it('round-trips world points through the minimap', () => {
    for (const point of POINTS) {
      const minimapPoint = projectWorldToMinimap(point, worldBounds, minimapSize, 10);
      expectClosePoint(unprojectMinimapPoint(minimapPoint, worldBounds, minimapSize, 10), point);
    }
  });

  it('projects card rectangles and the viewport rectangle', () => {
    const rect: WorldRect = { x: 100, y: 100, width: 240, height: 320 };
    const projected = projectWorldRectToMinimap(rect, worldBounds, minimapSize, 10);

    expect(projected.x).toBeCloseTo(28, 12);
    expect(projected.y).toBeCloseTo(73, 12);
    expect(projected.width).toBeCloseTo(43.2, 12);
    expect(projected.height).toBeCloseTo(57.6, 12);

    const viewportRect = projectViewportToMinimap(
      { x: 100, y: 50, scale: 1 },
      { width: 800, height: 400 },
      worldBounds,
      minimapSize,
      10,
    );
    expect(viewportRect.x).toBeCloseTo(28, 12);
    expect(viewportRect.y).toBeCloseTo(64, 12);
    expect(viewportRect.width).toBeCloseTo(144, 12);
    expect(viewportRect.height).toBeCloseTo(72, 12);
  });

  it('unions card and viewport bounds and tolerates empty input', () => {
    expect(
      unionWorldRects([
        { x: 0, y: 0, width: 240, height: 320 },
        { x: -100, y: 100, width: 50, height: 50 },
        null,
        undefined,
      ]),
    ).toEqual({ x: -100, y: 0, width: 340, height: 320 });
    expect(unionWorldRects([null, undefined])).toBeNull();
  });

  it('returns a stable projection for an empty board', () => {
    const projection = computeMinimapProjection(null, minimapSize, 10);

    expect(projection.scale).toBe(180);
    expect(projection.offsetX).toBe(10);
    expect(projection.offsetY).toBe(10);
  });
});

describe('viewport serialization and comparison', () => {
  it('serializes a clamped, JSON-safe viewport', () => {
    expect(serializeViewport({ x: -240, y: 96, scale: 1.75 })).toEqual({
      x: -240,
      y: 96,
      scale: 1.75,
    });
    expect(serializeViewport({ x: 10, y: 20, scale: 10 })).toEqual({
      x: 10,
      y: 20,
      scale: 2.5,
    });
    expect(
      serializeViewport({ x: Number.NaN, y: Number.POSITIVE_INFINITY, scale: Number.NaN }),
    ).toEqual(DEFAULT_BOARD_VIEWPORT);
  });

  it('deserializes objects and JSON strings', () => {
    const saved = { x: -240, y: 96, scale: 1.75 };

    expect(deserializeViewport(saved)).toEqual(saved);
    expect(deserializeViewport(JSON.stringify(saved))).toEqual(saved);
    expect(deserializeViewport(serializeViewport(saved))).toEqual(saved);
  });

  it('falls back per component and clamps out-of-range scales', () => {
    expect(
      deserializeViewport({ x: 'not-a-number', y: 5, scale: 0.1 }, { x: -10, y: -20, scale: 1.25 }),
    ).toEqual({ x: -10, y: 5, scale: 0.25 });
    expect(deserializeViewport('{broken', savedFallback())).toEqual(savedFallback());
    expect(deserializeViewport(null, savedFallback())).toEqual(savedFallback());
    expect(deserializeViewport(42, savedFallback())).toEqual(savedFallback());
  });

  it('compares viewports within an epsilon', () => {
    expect(viewportsEqual({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0, scale: 1 })).toBe(true);
    expect(viewportsEqual({ x: 0.1, y: 0, scale: 1 }, { x: 0.1 + 1e-12, y: 0, scale: 1 })).toBe(
      true,
    );
    expect(viewportsEqual({ x: 0, y: 0, scale: 1 }, { x: 0.01, y: 0, scale: 1 })).toBe(false);
    expect(viewportsEqual({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0, scale: 1.25 })).toBe(false);
  });

  it('round-trips through JSON without extra fields', () => {
    const saved = { x: 12.5, y: -7.25, scale: 1.3 };
    const parsed = JSON.parse(JSON.stringify(serializeViewport(saved))) as unknown;

    expect(deserializeViewport(parsed)).toEqual(saved);
  });
});

function savedFallback(): Viewport {
  return { x: 10, y: 20, scale: 1.5 };
}
