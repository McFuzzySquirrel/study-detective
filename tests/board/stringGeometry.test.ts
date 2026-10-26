import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';

import type { BoardCardSnapshot } from '../../src/board/CardSprite';
import {
  computeStringDashes,
  computeStringGeometry,
  computeStringHitBand,
  distanceToString,
  hitTestStringGeometry,
  pointOnString,
  resolveStringAnchors,
  sampleStringCurve,
  STRING_COLOR_FALLBACKS,
  STRING_COLOR_TOKENS,
  STRING_HIT_TOLERANCE,
  STRING_SAG_AT_SCALE_ONE,
  stringStrokeStyle,
  type StringRect,
} from '../../src/board/stringGeometry';
import {
  readStringPalette,
  STRING_PALETTE_FALLBACK,
  StringLayer,
} from '../../src/board/StringLayer';

const CARD_WIDTH = 240;
const CARD_HEIGHT = 320;

function card(x: number, y: number): StringRect {
  return { x, y, width: CARD_WIDTH, height: CARD_HEIGHT };
}

function screenMidpoint(geometry: ReturnType<typeof computeStringGeometry>): {
  readonly x: number;
  readonly y: number;
} {
  return pointOnString(geometry, 0.5);
}

function cardSnapshot(id: string, x: number, y: number): BoardCardSnapshot {
  return { id, title: `Card ${id}`, type: 'note', position: { x, y } };
}

describe('string geometry', () => {
  it('uses the documented sag, stroke, dash, and hit-band constants', () => {
    expect(STRING_SAG_AT_SCALE_ONE).toBe(12);
    expect(STRING_HIT_TOLERANCE).toBe(22);
    expect(STRING_COLOR_TOKENS.association).toBe('--color-string-association');
    expect(STRING_COLOR_TOKENS.provenance).toBe('--color-string-provenance');
    expect(STRING_COLOR_FALLBACKS).toEqual({ association: 0xcf3d2f, provenance: 0xe8aa3c });

    expect(stringStrokeStyle('association', 1)).toEqual({
      width: 3,
      dashed: false,
      dashLength: 0,
      dashGap: 0,
    });
    expect(stringStrokeStyle('provenance', 1)).toEqual({
      width: 2,
      dashed: true,
      dashLength: 8,
      dashGap: 6,
    });
  });

  it('anchors cards on the right of each other at their facing edge midpoints', () => {
    const geometry = computeStringGeometry(card(0, 0), card(500, 0));
    const anchors = resolveStringAnchors(card(0, 0), card(500, 0));

    expect(anchors.orientation).toBe('horizontal');
    expect(anchors.direction).toBe('right');
    expect(anchors.gap).toBe(260);
    expect(anchors.from).toEqual({ x: 240, y: 160 });
    expect(anchors.to).toEqual({ x: 500, y: 160 });
    expect(geometry.start).toEqual({ x: 240, y: 160 });
    expect(geometry.end).toEqual({ x: 500, y: 160 });
    expect(geometry.start.x).toBe(CARD_WIDTH);
    expect(geometry.end.x).toBe(500);
  });

  it('anchors cards on the left of each other at their facing edge midpoints', () => {
    const anchors = resolveStringAnchors(card(500, 0), card(0, 0));

    expect(anchors.orientation).toBe('horizontal');
    expect(anchors.direction).toBe('left');
    expect(anchors.from).toEqual({ x: 500, y: 160 });
    expect(anchors.to).toEqual({ x: 240, y: 160 });
    expect(anchors.gap).toBe(260);
  });

  it('anchors cards below each other at their facing edge midpoints', () => {
    const geometry = computeStringGeometry(card(0, 0), card(0, 500));
    const anchors = geometry.anchors;

    expect(anchors.orientation).toBe('vertical');
    expect(anchors.direction).toBe('below');
    expect(anchors.gap).toBe(180);
    expect(anchors.from).toEqual({ x: 120, y: 320 });
    expect(anchors.to).toEqual({ x: 120, y: 500 });
    expect(geometry.start.y).toBe(CARD_HEIGHT);
    expect(geometry.end.y).toBe(500);
  });

  it('anchors cards above each other at their facing edge midpoints', () => {
    const anchors = resolveStringAnchors(card(0, 500), card(0, 0));

    expect(anchors.orientation).toBe('vertical');
    expect(anchors.direction).toBe('above');
    expect(anchors.from).toEqual({ x: 120, y: 500 });
    expect(anchors.to).toEqual({ x: 120, y: 320 });
    expect(anchors.gap).toBe(180);
  });

  it('clamps the anchor to the nearest point on an offset facing edge', () => {
    // The second card is to the right and lower. Its centre is below the first
    // card's bottom edge, so the right-edge anchor clamps to that corner.
    const anchors = resolveStringAnchors(card(0, 0), card(500, 300));

    expect(anchors.orientation).toBe('horizontal');
    expect(anchors.direction).toBe('right');
    expect(anchors.from).toEqual({ x: 240, y: 320 });
    expect(anchors.to).toEqual({ x: 500, y: 300 });
  });

  it('sags 12 px at 100 percent and keeps the curve midpoint below the chord', () => {
    const geometry = computeStringGeometry(card(0, 0), card(500, 0));
    const midpoint = screenMidpoint(geometry);

    expect(geometry.sag).toBe(12);
    expect(geometry.midpoint).toEqual({ x: 370, y: 160 });
    expect(geometry.control).toEqual({ x: 370, y: 184 });
    expect(midpoint.x).toBeCloseTo(370, 9);
    expect(midpoint.y).toBeCloseTo(172, 9);
    expect(midpoint.y - geometry.midpoint.y).toBeCloseTo(12, 9);
  });

  it('sags to one consistent side for vertical strings and their reverse', () => {
    const below = computeStringGeometry(card(0, 0), card(0, 500));
    const above = computeStringGeometry(card(0, 500), card(0, 0));
    const belowMidpoint = screenMidpoint(below);
    const aboveMidpoint = screenMidpoint(above);

    expect(below.sag).toBe(12);
    expect(below.control).toEqual({ x: 144, y: 410 });
    expect(belowMidpoint.x).toBeCloseTo(132, 9);
    expect(belowMidpoint.y).toBeCloseTo(410, 9);
    expect(above.control).toEqual(below.control);
    expect(aboveMidpoint).toEqual(belowMidpoint);
  });

  it('scales sag and stroke with zoom', () => {
    const cases = [
      { scale: 0.25, sag: 3, width: 1 },
      { scale: 0.5, sag: 6, width: 1.5 },
      { scale: 1, sag: 12, width: 3 },
      { scale: 2, sag: 24, width: 6 },
      { scale: 2.5, sag: 30, width: 7.5 },
    ] as const;

    for (const entry of cases) {
      const geometry = computeStringGeometry(card(0, 0), card(500, 0), {
        scale: entry.scale,
      });
      const midpoint = screenMidpoint(geometry);

      expect(geometry.sag).toBeCloseTo(entry.sag, 9);
      expect(geometry.strokeWidth).toBeCloseTo(entry.width, 9);
      expect(geometry.control.y - geometry.midpoint.y).toBeCloseTo(entry.sag * 2, 9);
      expect(midpoint.y - geometry.midpoint.y).toBeCloseTo(entry.sag, 9);
      expect(geometry.dashLength).toBe(0);
      expect(geometry.dashGap).toBe(0);
    }

    const provenance = computeStringGeometry(card(0, 0), card(500, 0), {
      type: 'provenance',
      scale: 0.5,
    });
    expect(provenance.strokeWidth).toBe(1);
    expect(provenance.dashLength).toBe(4);
    expect(provenance.dashGap).toBe(3);

    const zoomedProvenance = computeStringGeometry(card(0, 0), card(500, 0), {
      type: 'provenance',
      scale: 2,
    });
    expect(zoomedProvenance.strokeWidth).toBe(4);
    expect(zoomedProvenance.dashLength).toBe(16);
    expect(zoomedProvenance.dashGap).toBe(12);
  });

  it('never sags past half of a close card gap', () => {
    const cases = [
      { gap: 260, expected: 12 },
      { gap: 20, expected: 8 },
      { gap: 10, expected: 4 },
      { gap: 2, expected: 0.8 },
      { gap: 0, expected: 0 },
    ] as const;

    for (const entry of cases) {
      const geometry = computeStringGeometry(card(0, 0), card(CARD_WIDTH + entry.gap, 0));

      expect(geometry.anchors.gap).toBe(entry.gap);
      expect(geometry.sag).toBeCloseTo(entry.expected, 9);
      expect(geometry.sag).toBeLessThanOrEqual(Math.max(0, entry.gap));
    }

    const zoomed = computeStringGeometry(card(0, 0), card(CARD_WIDTH + 20, 0), { scale: 2 });
    expect(zoomed.sag).toBeCloseTo(8, 9);
    expect(zoomed.sag).toBeLessThanOrEqual(zoomed.anchors.gap);
  });

  it('handles zero distance and overlapping rectangles without NaN', () => {
    const identical = computeStringGeometry(card(100, 100), card(100, 100));
    const touching = computeStringGeometry(card(0, 0), card(CARD_WIDTH, 0));

    for (const geometry of [identical, touching]) {
      expect(geometry.anchors.gap).toBe(0);
      expect(geometry.sag).toBe(0);
      expect(geometry.control).toEqual(geometry.midpoint);
      expect(Number.isFinite(geometry.start.x)).toBe(true);
      expect(Number.isFinite(geometry.start.y)).toBe(true);
      expect(Number.isFinite(geometry.end.x)).toBe(true);
      expect(Number.isFinite(geometry.end.y)).toBe(true);
      expect(hitTestStringGeometry(geometry, geometry.start)).toBe(true);
    }

    expect(screenMidpoint(identical)).toEqual(identical.midpoint);
  });

  it('is deterministic and symmetric when the two cards are swapped', () => {
    const first = computeStringGeometry(card(0, 0), card(500, 260));
    const second = computeStringGeometry(card(500, 260), card(0, 0));
    const repeated = computeStringGeometry(card(0, 0), card(500, 260));

    expect(repeated).toEqual(first);
    expect(second.start).toEqual(first.end);
    expect(second.end).toEqual(first.start);
    expect(second.control).toEqual(first.control);
    expect(second.sag).toBe(first.sag);
    expect(second.bounds).toEqual(first.bounds);
  });

  it('builds a provenance dash pattern along the curve with no labels', () => {
    const geometry = computeStringGeometry(card(0, 0), card(500, 0), {
      type: 'provenance',
    });
    const dashes = computeStringDashes(geometry);

    expect(geometry.dashed).toBe(true);
    expect(geometry.type).toBe('provenance');
    expect(dashes.length).toBeGreaterThan(10);
    expect(dashes[0]?.start).toEqual(geometry.start);
    expect(dashes[0]?.start).toEqual({ x: 240, y: 160 });

    for (const dash of dashes) {
      const length = Math.hypot(dash.end.x - dash.start.x, dash.end.y - dash.start.y);
      expect(length).toBeGreaterThan(0);
      expect(length).toBeLessThanOrEqual(geometry.dashLength + 1e-6);
    }

    // No string carries text, a label, a direction arrow, or a custom colour.
    expect('label' in geometry).toBe(false);
    expect('text' in geometry).toBe(false);
    expect('arrow' in geometry).toBe(false);
    expect('color' in geometry).toBe(false);
  });

  it('returns no dash segments for a solid association string', () => {
    const geometry = computeStringGeometry(card(0, 0), card(500, 0));

    expect(geometry.dashed).toBe(false);
    expect(computeStringDashes(geometry)).toEqual([]);
  });

  it('hit-tests a 44 px band around the curve', () => {
    const geometry = computeStringGeometry(card(0, 0), card(500, 0));
    const midpoint = screenMidpoint(geometry);

    expect(hitTestStringGeometry(geometry, midpoint)).toBe(true);
    expect(hitTestStringGeometry(geometry, { x: midpoint.x, y: midpoint.y + 20 })).toBe(true);
    expect(hitTestStringGeometry(geometry, { x: midpoint.x, y: midpoint.y + 30 })).toBe(false);
    expect(hitTestStringGeometry(geometry, { x: geometry.start.x, y: geometry.start.y })).toBe(
      true,
    );
    expect(hitTestStringGeometry(geometry, { x: midpoint.x, y: 600 })).toBe(false);

    const band = computeStringHitBand(geometry);
    expect(band.tolerance).toBe(STRING_HIT_TOLERANCE);
    expect(band.outline).toHaveLength((24 + 1) * 2);
    expect(distanceToString(geometry, midpoint)).toBeLessThan(1e-6);
    expect(distanceToString(geometry, { x: midpoint.x, y: midpoint.y + 23 })).toBeGreaterThan(
      STRING_HIT_TOLERANCE,
    );
  });

  it('samples both anchors and the sagging curve', () => {
    const geometry = computeStringGeometry(card(0, 0), card(500, 0));
    const samples = sampleStringCurve(geometry, 8);

    expect(samples).toHaveLength(9);
    expect(samples[0]).toEqual(geometry.start);
    expect(samples[8]).toEqual(geometry.end);
    expect(samples[4]?.y).toBeCloseTo(172, 9);
  });

  it('exposes the fallback palette and reads the theme tokens when present', () => {
    expect(STRING_PALETTE_FALLBACK).toEqual({
      association: 0xcf3d2f,
      provenance: 0xe8aa3c,
    });
    expect(readStringPalette()).toEqual(STRING_PALETTE_FALLBACK);
  });
});

describe('StringLayer', () => {
  const cards: BoardCardSnapshot[] = [cardSnapshot('a', 0, 0), cardSnapshot('b', 500, 0)];
  const connections = [
    {
      id: 'conn-1',
      fromCardId: 'a',
      toCardId: 'b',
      type: 'association' as const,
    },
  ];

  function makeLayer(reducedMotion = true): StringLayer {
    const layer = new StringLayer({
      palette: STRING_PALETTE_FALLBACK,
      reducedMotion,
    });
    layer.setCards(cards);
    layer.setConnections(connections);
    layer.setViewport({ x: 0, y: 0, scale: 1 }, { width: 1000, height: 800 });
    return layer;
  }

  it('draws an undirected association string and hit-tests the sagging curve', () => {
    const layer = makeLayer();

    expect(layer.totalStringCount).toBe(1);
    expect(layer.drawnStringCount).toBe(1);
    expect(layer.stringAt({ x: 370, y: 172 })?.id).toBe('conn-1');
    expect(layer.stringAt({ x: 370, y: 260 })).toBeNull();

    layer.destroy();
  });

  it('redraws when a card moves and culls strings far offscreen', () => {
    const layer = makeLayer();

    layer.moveCard('b', { x: 500, y: 400 });
    const moved = computeStringGeometry(card(0, 0), card(500, 400));
    const movedMidpoint = screenMidpoint(moved);

    expect(layer.drawnStringCount).toBe(1);
    expect(layer.stringAt(movedMidpoint)?.id).toBe('conn-1');

    layer.setViewport({ x: 10_000, y: 10_000, scale: 1 }, { width: 1000, height: 800 });
    expect(layer.totalStringCount).toBe(1);
    expect(layer.drawnStringCount).toBe(0);
    expect(layer.stringAt(movedMidpoint)).toBeNull();

    layer.setViewport({ x: 0, y: 0, scale: 1 }, { width: 1000, height: 800 });
    expect(layer.drawnStringCount).toBe(1);

    layer.destroy();
  });

  it('redraws when the camera pans or zooms', () => {
    const layer = makeLayer();

    layer.setViewport({ x: -100, y: 0, scale: 1 }, { width: 1000, height: 800 });
    // The whole curve shifts 100 px to the right on the screen.
    expect(layer.stringAt({ x: 470, y: 172 })?.id).toBe('conn-1');
    expect(layer.stringAt({ x: 200, y: 172 })).toBeNull();

    layer.setViewport({ x: 0, y: 0, scale: 2 }, { width: 1000, height: 800 });
    const zoomed = computeStringGeometry(
      { x: 0, y: 0, width: 480, height: 640 },
      { x: 1000, y: 0, width: 480, height: 640 },
      { scale: 2 },
    );
    const zoomedMidpoint = screenMidpoint(zoomed);
    expect(layer.stringAt(zoomedMidpoint)?.id).toBe('conn-1');

    layer.destroy();
  });

  it('has no animation state under reduced motion or normal motion', () => {
    const reduced = makeLayer(true);
    const normal = makeLayer(false);

    expect(reduced.reducedMotion).toBe(true);
    expect(reduced.isAnimating).toBe(false);
    expect(reduced.drawnStringCount).toBe(1);

    expect(normal.reducedMotion).toBe(false);
    expect(normal.isAnimating).toBe(false);
    expect(normal.drawnStringCount).toBe(1);

    reduced.setReducedMotion(false);
    expect(reduced.isAnimating).toBe(false);

    reduced.destroy();
    normal.destroy();
  });

  it('batches every solid and dashed string into one stroke per type', () => {
    const layer = new StringLayer({ palette: STRING_PALETTE_FALLBACK });
    layer.setCards([
      cardSnapshot('a', 0, 0),
      cardSnapshot('b', 500, 0),
      cardSnapshot('c', 1000, 0),
    ]);
    layer.setConnections([
      { id: 'assoc', fromCardId: 'a', toCardId: 'b', type: 'association' },
      { id: 'prov', fromCardId: 'b', toCardId: 'c', type: 'provenance' },
    ]);
    layer.setViewport({ x: 0, y: 0, scale: 1 }, { width: 1600, height: 900 });

    const [association, provenance] = layer.root.children;
    expect(association).toBeInstanceOf(Graphics);
    expect(provenance).toBeInstanceOf(Graphics);

    if (!(association instanceof Graphics) || !(provenance instanceof Graphics)) {
      throw new Error('The string layer did not create both graphics.');
    }

    const associationStrokes = association.context.instructions.filter(
      (instruction) => instruction.action === 'stroke',
    );
    const provenanceStrokes = provenance.context.instructions.filter(
      (instruction) => instruction.action === 'stroke',
    );

    expect(associationStrokes).toHaveLength(1);
    expect(provenanceStrokes).toHaveLength(1);
    expect(association.getLocalBounds().width).toBeGreaterThan(0);
    expect(provenance.getLocalBounds().width).toBeGreaterThan(0);
    expect(association.getLocalBounds().height).toBeGreaterThan(0);
    expect(provenance.getLocalBounds().height).toBeGreaterThan(0);

    layer.destroy();
  });

  it('destroys idempotently and ignores late updates', () => {
    const layer = makeLayer();

    layer.destroy();
    layer.destroy();
    layer.setCards(cards);
    layer.setConnections(connections);
    layer.moveCard('a', { x: 50, y: 50 });

    expect(layer.drawnStringCount).toBe(0);
    expect(layer.totalStringCount).toBe(0);
    expect(layer.stringAt({ x: 370, y: 172 })).toBeNull();
  });
});
