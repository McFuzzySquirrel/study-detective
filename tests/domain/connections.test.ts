import { describe, expect, it } from 'vitest';

import {
  DuplicateConnectionError,
  assertConnectionPairAvailable,
  assertDistinctConnectionEndpoints,
  buildPairKey,
  findConnectionForPair,
  findDanglingConnections,
  hasConnectionForPair,
  isAssociationEligible,
  isConnectionForPair,
  isProvenanceEligible,
  missingConnectionEndpoints,
  planConnectionCascade,
} from '../../src/domain/connections';
import type { ConnectionRef } from '../../src/domain/connections';
import { CARD_TYPES } from '../../src/domain/model';
import type { CardType } from '../../src/domain/model';
import { DomainValidationError } from '../../src/domain/validation';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_NOTE_ID = '55555555-5555-4555-8555-555555555555';
const FOREIGN_CARD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const CONNECTION_ONE = '66666666-6666-4666-8666-666666666666';
const CONNECTION_TWO = '77777777-7777-4777-8777-777777777777';
const CONNECTION_THREE = '88888888-8888-4888-8888-888888888888';
const CONNECTION_FOUR = '99999999-9999-4999-8999-999999999999';

function ref(id: string, fromCardId: string, toCardId: string): ConnectionRef {
  return { id, fromCardId, toCardId };
}

const noteToSource = ref(CONNECTION_ONE, NOTE_ID, SOURCE_ID);
const noteToTopic = ref(CONNECTION_TWO, NOTE_ID, TOPIC_ID);
const sourceToTopic = ref(CONNECTION_THREE, SOURCE_ID, TOPIC_ID);
const noteToSecondNote = ref(CONNECTION_FOUR, NOTE_ID, SECOND_NOTE_ID);

const cards = [
  { id: NOTE_ID, caseId: CASE_ID, type: 'note' as const },
  { id: SOURCE_ID, caseId: CASE_ID, type: 'source' as const },
  { id: TOPIC_ID, caseId: CASE_ID, type: 'topic' as const },
  { id: SECOND_NOTE_ID, caseId: CASE_ID, type: 'note' as const },
  { id: FOREIGN_CARD_ID, caseId: '99999999-9999-4999-8999-999999999999', type: 'source' as const },
];

describe('unordered pair identity', () => {
  it('builds the same key for A-B and B-A regardless of type', () => {
    expect(buildPairKey(NOTE_ID, SOURCE_ID)).toBe(buildPairKey(SOURCE_ID, NOTE_ID));
    expect(buildPairKey(NOTE_ID, SOURCE_ID)).not.toBe(buildPairKey(NOTE_ID, TOPIC_ID));
  });

  it('matches a stored string in either orientation and ignores other pairs', () => {
    expect(isConnectionForPair(noteToSource, NOTE_ID, SOURCE_ID)).toBe(true);
    expect(isConnectionForPair(noteToSource, SOURCE_ID, NOTE_ID)).toBe(true);
    expect(isConnectionForPair(noteToSource, NOTE_ID, TOPIC_ID)).toBe(false);
    expect(isConnectionForPair(noteToSource, NOTE_ID, NOTE_ID)).toBe(false);
  });

  it('finds the existing duplicate without creating a second identity', () => {
    const connections = [noteToSource, noteToTopic];

    expect(findConnectionForPair(connections, SOURCE_ID, NOTE_ID)?.id).toBe(CONNECTION_ONE);
    expect(findConnectionForPair(connections, TOPIC_ID, NOTE_ID)?.id).toBe(CONNECTION_TWO);
    expect(findConnectionForPair(connections, SOURCE_ID, TOPIC_ID)).toBeUndefined();
    expect(findConnectionForPair(connections, NOTE_ID, NOTE_ID)).toBeUndefined();
    expect(hasConnectionForPair(connections, SOURCE_ID, NOTE_ID)).toBe(true);
    expect(hasConnectionForPair(connections, TOPIC_ID, SOURCE_ID)).toBe(false);
  });
});

describe('rejection helpers', () => {
  it('rejects a self-link before any pair lookup', () => {
    expect(() => assertDistinctConnectionEndpoints(NOTE_ID, NOTE_ID)).toThrow(
      DomainValidationError,
    );
    expect(() => assertDistinctConnectionEndpoints(NOTE_ID, TOPIC_ID)).not.toThrow();
  });

  it('rejects a duplicate pair and names the existing connection', () => {
    try {
      assertConnectionPairAvailable([noteToSource], SOURCE_ID, NOTE_ID);
      expect.unreachable('expected the second string to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateConnectionError);
      const duplicate = error as DuplicateConnectionError;
      expect(duplicate.existingConnectionId).toBe(CONNECTION_ONE);
      expect(duplicate.issues[0]?.message).toContain('unordered card pair');
    }
  });

  it('allows a pair that has no stored string', () => {
    expect(() => assertConnectionPairAvailable([noteToSource], NOTE_ID, TOPIC_ID)).not.toThrow();
    expect(() => assertConnectionPairAvailable([], NOTE_ID, TOPIC_ID)).not.toThrow();
  });

  it('allows association between any two distinct cards', () => {
    expect(isAssociationEligible(NOTE_ID, TOPIC_ID)).toBe(true);
    expect(isAssociationEligible(NOTE_ID, SECOND_NOTE_ID)).toBe(true);
    expect(isAssociationEligible(SOURCE_ID, TOPIC_ID)).toBe(true);
    expect(isAssociationEligible(NOTE_ID, NOTE_ID)).toBe(false);
  });

  it('allows provenance only between a note and a source in either orientation', () => {
    for (const fromType of CARD_TYPES) {
      for (const toType of CARD_TYPES) {
        const expected =
          (fromType === 'note' && toType === 'source') ||
          (fromType === 'source' && toType === 'note');
        expect(isProvenanceEligible(fromType, toType), `${fromType} -> ${toType}`).toBe(expected);
      }
    }

    const invalidPairs: Array<[CardType, CardType]> = [
      ['note', 'note'],
      ['note', 'topic'],
      ['source', 'source'],
      ['source', 'topic'],
      ['topic', 'topic'],
      ['topic', 'source'],
    ];
    for (const [fromType, toType] of invalidPairs) {
      expect(isProvenanceEligible(fromType, toType), `${fromType} -> ${toType}`).toBe(false);
    }
  });
});

describe('cascade plans', () => {
  it('removes every string touching a deleted card in both orientations', () => {
    const plan = planConnectionCascade(
      [noteToSource, noteToTopic, sourceToTopic, noteToSecondNote],
      [NOTE_ID],
    );

    expect(plan.removedCardIds).toEqual([NOTE_ID]);
    expect(plan.connectionIds).toEqual([CONNECTION_ONE, CONNECTION_TWO, CONNECTION_FOUR].sort());
    expect(plan.connectionIds).not.toContain(CONNECTION_THREE);
  });

  it('deduplicates cards and connection IDs while keeping a stable order', () => {
    const plan = planConnectionCascade(
      [sourceToTopic, noteToSource, noteToTopic],
      [SOURCE_ID, NOTE_ID, SOURCE_ID],
    );

    expect(plan.removedCardIds).toEqual([NOTE_ID, SOURCE_ID].sort());
    expect(plan.connectionIds).toEqual([CONNECTION_ONE, CONNECTION_TWO, CONNECTION_THREE].sort());
    expect(plan.connectionIds).toEqual([...plan.connectionIds].sort());
  });

  it('leaves the graph untouched when no card is removed', () => {
    const plan = planConnectionCascade([noteToSource, noteToTopic], []);

    expect(plan.removedCardIds).toEqual([]);
    expect(plan.connectionIds).toEqual([]);
  });
});

describe('dangling endpoints', () => {
  it('reports each missing endpoint once, including a missing self-link', () => {
    expect(missingConnectionEndpoints(noteToSource, cards)).toEqual([]);
    expect(missingConnectionEndpoints(noteToTopic, [cards[0]!])).toEqual([TOPIC_ID]);
    expect(missingConnectionEndpoints(ref('x', NOTE_ID, FOREIGN_CARD_ID), [cards[0]!])).toEqual([
      FOREIGN_CARD_ID,
    ]);

    const missingSelf = ref(
      'y',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
    expect(missingConnectionEndpoints(missingSelf, cards)).toEqual([
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ]);
  });

  it('finds every dangling string in stable input order', () => {
    const dangling = findDanglingConnections(
      [noteToSource, noteToTopic, sourceToTopic],
      [cards[0]!, cards[1]!],
    );

    expect(dangling.map((connection) => connection.id)).toEqual([CONNECTION_TWO, CONNECTION_THREE]);
  });

  it('returns no dangling rows when both endpoints are present', () => {
    expect(findDanglingConnections([noteToSource, noteToTopic], cards)).toEqual([]);
  });
});
