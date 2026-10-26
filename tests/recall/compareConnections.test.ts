import { describe, expect, it } from 'vitest';

import {
  canonicalizeConnection,
  canonicalizeConnections,
  compareConnections,
  type ComparableConnection,
  type RecallPair,
} from '../../src/features/recall/compareConnections';
import { buildPairKey } from '../../src/domain/model';
import type { ConnectionType } from '../../src/domain/model';

const CARD_A = '11111111-1111-4111-8111-111111111111';
const CARD_B = '22222222-2222-4222-8222-222222222222';
const CARD_C = '33333333-3333-4333-8333-333333333333';
const CARD_D = '44444444-4444-4444-8444-444444444444';
const CARD_E = '55555555-5555-4555-8555-555555555555';

function connection(
  fromCardId: string,
  toCardId: string,
  type: ConnectionType = 'association',
): ComparableConnection {
  return { fromCardId, toCardId, type };
}

function pairKey(cardIdA: string, cardIdB: string): string {
  return buildPairKey(cardIdA, cardIdB);
}

function keysOf(pairs: readonly RecallPair[]): string[] {
  return pairs.map((pair) => pair.pairKey);
}

describe('compareConnections', () => {
  it('returns four empty groups for an empty truth graph and scratch layer', () => {
    expect(compareConnections([], [])).toEqual({
      remembered: [],
      missed: [],
      extra: [],
      typeMismatch: [],
    });
  });

  it('marks an exact pair as remembered only', () => {
    const result = compareConnections([connection(CARD_A, CARD_B)], [connection(CARD_A, CARD_B)]);

    expect(result.remembered).toEqual([
      {
        pairKey: pairKey(CARD_A, CARD_B),
        fromCardId: CARD_A,
        toCardId: CARD_B,
        type: 'association',
      },
    ]);
    expect(result.missed).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.typeMismatch).toEqual([]);
  });

  it('marks a reversed scratch pair as remembered', () => {
    const result = compareConnections([connection(CARD_A, CARD_B)], [connection(CARD_B, CARD_A)]);

    expect(result.remembered).toHaveLength(1);
    expect(result.remembered[0]?.pairKey).toBe(pairKey(CARD_A, CARD_B));
    expect(result.missed).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.typeMismatch).toEqual([]);
  });

  it('collapses duplicate truth and scratch rows to one remembered pair', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B), connection(CARD_B, CARD_A)],
      [
        connection(CARD_A, CARD_B),
        connection(CARD_B, CARD_A),
        connection(CARD_A, CARD_B, 'association'),
      ],
    );

    expect(result.remembered).toHaveLength(1);
    expect(result.missed).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.typeMismatch).toEqual([]);
    expect(new Set(keysOf(result.remembered)).size).toBe(1);
  });

  it('lists a truth pair with no scratch match as missed', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B), connection(CARD_B, CARD_C)],
      [connection(CARD_A, CARD_B)],
    );

    expect(keysOf(result.remembered)).toEqual([pairKey(CARD_A, CARD_B)]);
    expect(result.missed).toEqual([
      {
        pairKey: pairKey(CARD_B, CARD_C),
        fromCardId: CARD_B,
        toCardId: CARD_C,
        type: 'association',
      },
    ]);
    expect(result.extra).toEqual([]);
    expect(result.typeMismatch).toEqual([]);
  });

  it('lists a scratch pair with no truth match as extra', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B)],
      [connection(CARD_A, CARD_B), connection(CARD_B, CARD_C)],
    );

    expect(keysOf(result.remembered)).toEqual([pairKey(CARD_A, CARD_B)]);
    expect(keysOf(result.extra)).toEqual([pairKey(CARD_B, CARD_C)]);
    expect(result.missed).toEqual([]);
    expect(result.typeMismatch).toEqual([]);
  });

  it('reports a relationship-type mismatch separately from a missed pair', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B, 'provenance')],
      [connection(CARD_B, CARD_A, 'association')],
    );

    expect(result.remembered).toEqual([
      {
        pairKey: pairKey(CARD_A, CARD_B),
        fromCardId: CARD_A,
        toCardId: CARD_B,
        type: 'provenance',
      },
    ]);
    expect(result.missed).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.typeMismatch).toEqual([
      {
        pairKey: pairKey(CARD_A, CARD_B),
        fromCardId: CARD_A,
        toCardId: CARD_B,
        type: 'provenance',
        expectedType: 'provenance',
        actualType: 'association',
      },
    ]);
  });

  it('does not flag a mismatch when an exact-type scratch row also exists', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B, 'provenance')],
      [connection(CARD_B, CARD_A, 'association'), connection(CARD_A, CARD_B, 'provenance')],
    );

    expect(result.remembered).toHaveLength(1);
    expect(result.typeMismatch).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.missed).toEqual([]);
  });

  it('sorts every group by canonical pair key and keeps the groups disjoint', () => {
    const result = compareConnections(
      [
        connection(CARD_D, CARD_C, 'provenance'),
        connection(CARD_A, CARD_B),
        connection(CARD_A, CARD_C),
      ],
      [
        connection(CARD_D, CARD_C, 'association'),
        connection(CARD_B, CARD_A),
        connection(CARD_C, CARD_E),
      ],
    );

    expect(keysOf(result.remembered)).toEqual([pairKey(CARD_A, CARD_B), pairKey(CARD_C, CARD_D)]);
    expect(keysOf(result.missed)).toEqual([pairKey(CARD_A, CARD_C)]);
    expect(keysOf(result.extra)).toEqual([pairKey(CARD_C, CARD_E)]);
    expect(keysOf(result.typeMismatch)).toEqual([pairKey(CARD_C, CARD_D)]);

    // Missed, extra, and type-mismatched are separate outputs. A mismatched
    // pair is also remembered, matching the results contract, but it must not
    // be repeated inside any one group.
    const separate = [
      ...keysOf(result.missed),
      ...keysOf(result.extra),
      ...keysOf(result.typeMismatch),
    ];
    expect(new Set(separate).size).toBe(separate.length);

    const rememberedKeys = new Set(keysOf(result.remembered));
    for (const key of [...keysOf(result.missed), ...keysOf(result.extra)]) {
      expect(rememberedKeys.has(key)).toBe(false);
    }
  });

  it('canonicalizes stored orientation to sorted endpoints', () => {
    const result = compareConnections(
      [connection(CARD_B, CARD_A)],
      [connection(CARD_B, CARD_A, 'provenance')],
    );

    expect(result.remembered[0]).toMatchObject({
      pairKey: pairKey(CARD_A, CARD_B),
      fromCardId: CARD_A,
      toCardId: CARD_B,
    });
    expect(result.typeMismatch[0]).toMatchObject({
      expectedType: 'association',
      actualType: 'provenance',
    });
  });

  it('ignores invalid rows instead of crashing a recall check', () => {
    const invalid = [
      connection(CARD_A, CARD_A),
      connection('', CARD_B),
      connection(CARD_A, '', 'association'),
      { fromCardId: CARD_A, toCardId: CARD_B, type: 'unknown' as ConnectionType },
    ];

    expect(compareConnections(invalid, invalid)).toEqual({
      remembered: [],
      missed: [],
      extra: [],
      typeMismatch: [],
    });
  });

  it('does not mutate the supplied arrays or records', () => {
    const truth = Object.freeze([Object.freeze(connection(CARD_B, CARD_A))]);
    const scratch = Object.freeze([Object.freeze(connection(CARD_A, CARD_B, 'provenance'))]);

    expect(() => compareConnections(truth, scratch)).not.toThrow();
    expect(truth[0]?.fromCardId).toBe(CARD_B);
    expect(scratch[0]?.type).toBe('provenance');
  });

  it('contains no score, percentage, grade, streak, or ranking text', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B, 'provenance'), connection(CARD_C, CARD_D)],
      [connection(CARD_B, CARD_A), connection(CARD_C, CARD_E), connection(CARD_A, CARD_D)],
    );
    const payload = JSON.stringify(result).toLowerCase();

    expect(Object.keys(result).sort()).toEqual(['extra', 'missed', 'remembered', 'typeMismatch']);

    for (const forbidden of ['score', 'percentage', 'percent', 'grade', 'streak', 'rank']) {
      expect(payload).not.toContain(forbidden);
    }
  });
});

describe('canonicalizeConnections', () => {
  it('returns one pair per unordered pair in stable order', () => {
    const pairs = canonicalizeConnections([
      connection(CARD_B, CARD_C),
      connection(CARD_B, CARD_A),
      connection(CARD_A, CARD_B),
    ]);

    expect(pairs.map((pair) => pair.pairKey)).toEqual([
      pairKey(CARD_A, CARD_B),
      pairKey(CARD_B, CARD_C),
    ]);
    expect(pairs[0]).toEqual({
      pairKey: pairKey(CARD_A, CARD_B),
      fromCardId: CARD_A,
      toCardId: CARD_B,
      type: 'association',
    });
  });

  it('chooses the same representative type regardless of duplicate order', () => {
    const first = canonicalizeConnections([
      connection(CARD_A, CARD_B, 'provenance'),
      connection(CARD_B, CARD_A, 'association'),
    ]);
    const second = canonicalizeConnections([
      connection(CARD_B, CARD_A, 'association'),
      connection(CARD_A, CARD_B, 'provenance'),
    ]);

    expect(first).toEqual(second);
    expect(first[0]?.type).toBe('association');
  });

  it('returns null for a connection that cannot describe a pair', () => {
    expect(canonicalizeConnection(connection(CARD_A, CARD_A))).toBeNull();
    expect(canonicalizeConnection(connection('', CARD_B))).toBeNull();
  });
});
