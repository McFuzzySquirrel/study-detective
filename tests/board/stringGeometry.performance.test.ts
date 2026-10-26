import { describe, expect, it } from 'vitest';

import {
  computeStringDashes,
  computeStringGeometry,
  type StringGeometry,
  type StringRect,
} from '../../src/board/stringGeometry';

const CARD_WIDTH = 240;
const CARD_HEIGHT = 320;
const STRING_COUNT = 300;
const COLUMNS = 20;
const COLUMN_PITCH = 320;
const ROW_PITCH = 400;

interface Fixture {
  readonly pairs: readonly {
    readonly from: StringRect;
    readonly to: StringRect;
    readonly type: 'association' | 'provenance';
  }[];
}

/**
 * A deterministic 300-string board: 301 cards on a 20-column grid, with one
 * string between each consecutive pair. Half the strings are provenance so the
 * dashed pattern is included in the batch, not just the bare curve.
 */
function makeFixture(): Fixture {
  const cards: StringRect[] = Array.from({ length: STRING_COUNT + 1 }, (_value, index) => ({
    x: (index % COLUMNS) * COLUMN_PITCH,
    y: Math.floor(index / COLUMNS) * ROW_PITCH,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  }));

  const pairs = Array.from({ length: STRING_COUNT }, (_value, index) => {
    const from = cards[index];
    const to = cards[index + 1];
    if (from === undefined || to === undefined) {
      throw new Error('The performance fixture is missing a card.');
    }

    return {
      from,
      to,
      type: (index % 2 === 0 ? 'association' : 'provenance') as 'association' | 'provenance',
    };
  });

  return { pairs };
}

function computeBatch(fixture: Fixture): StringGeometry[] {
  const geometries: StringGeometry[] = new Array<StringGeometry>(fixture.pairs.length);

  for (let index = 0; index < fixture.pairs.length; index += 1) {
    const pair = fixture.pairs[index];
    if (pair === undefined) {
      continue;
    }

    const geometry = computeStringGeometry(pair.from, pair.to, {
      type: pair.type,
      scale: 1,
    });
    if (pair.type === 'provenance') {
      computeStringDashes(geometry);
    }
    geometries[index] = geometry;
  }

  return geometries;
}

describe('string geometry performance', () => {
  it('computes a 300-string batch in under 16 ms', () => {
    const fixture = makeFixture();

    // Warm the JIT; the fixture and the allocation shape are reused.
    for (let pass = 0; pass < 3; pass += 1) {
      computeBatch(fixture);
    }

    let best = Number.POSITIVE_INFINITY;
    let bestGeometries: StringGeometry[] = [];

    for (let pass = 0; pass < 5; pass += 1) {
      const start = performance.now();
      const geometries = computeBatch(fixture);
      const elapsed = performance.now() - start;

      if (elapsed < best) {
        best = elapsed;
        bestGeometries = geometries;
      }
    }

    expect(bestGeometries).toHaveLength(STRING_COUNT);
    expect(best).toBeLessThan(16);
    console.info(`[stringGeometry] 300-string batch best of 5: ${best.toFixed(2)} ms`);

    for (const geometry of bestGeometries) {
      expect(Number.isFinite(geometry.start.x)).toBe(true);
      expect(Number.isFinite(geometry.end.y)).toBe(true);
      expect(Number.isFinite(geometry.control.x)).toBe(true);
      expect(geometry.sag).toBeGreaterThanOrEqual(0);
    }
  });
});
