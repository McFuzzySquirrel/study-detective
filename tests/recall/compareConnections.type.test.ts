import { describe, expect, it } from 'vitest';

import { buildPairKey } from '../../src/domain/model';
import {
  compareConnections,
  type ComparableConnection,
} from '../../src/features/recall/compareConnections';

const CARD_A = '11111111-1111-4111-8111-111111111111';
const CARD_B = '22222222-2222-4222-8222-222222222222';
const CARD_C = '33333333-3333-4333-8333-333333333333';
const CARD_D = '44444444-4444-4444-8444-444444444444';

function connection(
  fromCardId: string,
  toCardId: string,
  type: ComparableConnection['type'],
): ComparableConnection {
  return { fromCardId, toCardId, type };
}

describe('compareConnections relationship types', () => {
  it('remembers a reversed pair and reports no type mismatch for the same type', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B, 'association')],
      [connection(CARD_B, CARD_A, 'association')],
    );

    expect(result.remembered).toHaveLength(1);
    expect(result.remembered[0]?.pairKey).toBe(buildPairKey(CARD_A, CARD_B));
    expect(result.missed).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.typeMismatch).toEqual([]);
  });

  it('keeps a wrong-type pair in remembered and type-mismatch, never missed or extra', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B, 'provenance')],
      [connection(CARD_B, CARD_A, 'association')],
    );

    expect(result.remembered).toHaveLength(1);
    expect(result.remembered[0]).toMatchObject({
      pairKey: buildPairKey(CARD_A, CARD_B),
      fromCardId: CARD_A,
      toCardId: CARD_B,
      type: 'provenance',
    });
    expect(result.missed).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.typeMismatch).toHaveLength(1);
    expect(result.typeMismatch[0]).toEqual({
      pairKey: buildPairKey(CARD_A, CARD_B),
      fromCardId: CARD_A,
      toCardId: CARD_B,
      type: 'provenance',
      expectedType: 'provenance',
      actualType: 'association',
    });
  });

  it('records the reverse mismatch direction with expected and actual types', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B, 'association')],
      [connection(CARD_B, CARD_A, 'provenance')],
    );

    expect(result.remembered).toHaveLength(1);
    expect(result.typeMismatch[0]?.expectedType).toBe('association');
    expect(result.typeMismatch[0]?.actualType).toBe('provenance');
    expect(result.missed).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('does not flag a mismatch when any exact-type duplicate satisfies the pair', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B, 'provenance')],
      [connection(CARD_B, CARD_A, 'association'), connection(CARD_A, CARD_B, 'provenance')],
    );

    expect(result.remembered).toHaveLength(1);
    expect(result.typeMismatch).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.missed).toEqual([]);
  });

  it('keeps multiple mismatches stable by canonical pair key', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B, 'provenance'), connection(CARD_C, CARD_D, 'association')],
      [connection(CARD_B, CARD_A, 'association'), connection(CARD_C, CARD_D, 'provenance')],
    );

    expect(result.remembered).toHaveLength(2);
    expect(result.typeMismatch.map((pair) => pair.pairKey)).toEqual([
      buildPairKey(CARD_A, CARD_B),
      buildPairKey(CARD_C, CARD_D),
    ]);
    expect(result.typeMismatch.map((pair) => pair.actualType)).toEqual([
      'association',
      'provenance',
    ]);
    expect(result.missed).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('returns only the four pair groups, with no score-like field', () => {
    const result = compareConnections(
      [connection(CARD_A, CARD_B, 'association')],
      [connection(CARD_A, CARD_B, 'association')],
    );

    expect(Object.keys(result).sort()).toEqual(['extra', 'missed', 'remembered', 'typeMismatch']);
    expect(JSON.stringify(result)).not.toMatch(/score|percentage|grade|streak|rank/i);
  });
});
