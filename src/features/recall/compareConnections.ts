/**
 * Pure comparison for recall mode.
 *
 * Recall practice is undirected: a scratch string drawn B-to-A is the same
 * relationship as a truth string stored A-to-B. This module canonicalizes both
 * sides by sorted card IDs, matches each truth pair against the scratch layer,
 * and returns four separate lists:
 *
 * - `remembered`: truth pairs the student reproduced.
 * - `missed`: truth pairs with no scratch string.
 * - `extra`: scratch strings that do not correspond to any truth pair.
 * - `typeMismatch`: remembered pairs whose relationship type differs.
 *
 * There is deliberately no score, percentage, grade, streak, or rank in the
 * result. Counts are the lengths of the lists. Ordering is stable: every list
 * is sorted by canonical pair key, and a pair appears at most once in a list.
 *
 * Boundary rules:
 *
 * - No Dexie, IndexedDB, localStorage, repository, React, or PixiJS import.
 * - No mutation of the supplied arrays or records.
 * - Invalid rows (empty IDs, self-links, unknown types) are ignored rather
 *   than crashing a recall check on a hand-edited snapshot.
 */

import { CONNECTION_TYPES, buildPairKey } from '../../domain/model';
import type { ConnectionType } from '../../domain/model';

/** The minimum truth or scratch shape needed to compare two endpoints. */
export interface ComparableConnection {
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly type: ConnectionType;
}

/**
 * One canonical, undirected pair. `fromCardId` is always the lexicographically
 * smaller card ID and `pairKey` is the domain's canonical unordered key.
 */
export interface RecallPair {
  readonly pairKey: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly type: ConnectionType;
}

/**
 * A remembered pair whose scratch type does not match the truth type.
 * `type` is the truth type; the explicit expected/actual fields let the
 * results UI label the pair without re-reading either source list.
 */
export interface RecallTypeMismatch extends RecallPair {
  readonly expectedType: ConnectionType;
  readonly actualType: ConnectionType;
}

export interface RecallComparison {
  readonly remembered: readonly RecallPair[];
  readonly missed: readonly RecallPair[];
  readonly extra: readonly RecallPair[];
  readonly typeMismatch: readonly RecallTypeMismatch[];
}

/**
 * A deterministic type preference for duplicate inputs. A real case has one
 * string per pair, but a stale snapshot may briefly contain two. Choosing by
 * this fixed order keeps the result independent of input order.
 */
const TYPE_PREFERENCE: Readonly<Record<ConnectionType, number>> = Object.freeze({
  association: 0,
  provenance: 1,
});

interface CanonicalBucket {
  readonly pair: RecallPair;
  readonly types: readonly ConnectionType[];
}

function isConnectionType(value: unknown): value is ConnectionType {
  return typeof value === 'string' && (CONNECTION_TYPES as readonly string[]).includes(value);
}

function isEndpoint(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function orderEndpoints(
  cardIdA: string,
  cardIdB: string,
): readonly [fromCardId: string, toCardId: string] {
  return cardIdA <= cardIdB ? [cardIdA, cardIdB] : [cardIdB, cardIdA];
}

function comparePairKeys(
  first: Pick<RecallPair, 'pairKey'>,
  second: Pick<RecallPair, 'pairKey'>,
): number {
  if (first.pairKey === second.pairKey) {
    return 0;
  }
  return first.pairKey < second.pairKey ? -1 : 1;
}

function compareTypes(first: ConnectionType, second: ConnectionType): number {
  return TYPE_PREFERENCE[first] - TYPE_PREFERENCE[second];
}

/**
 * Canonicalize one connection. Returns null for a row that cannot describe a
 * real undirected pair: empty endpoints, a self-link, or an unknown type.
 */
export function canonicalizeConnection(connection: ComparableConnection): RecallPair | null {
  const { fromCardId, toCardId, type } = connection;

  if (!isEndpoint(fromCardId) || !isEndpoint(toCardId) || fromCardId === toCardId) {
    return null;
  }
  if (!isConnectionType(type)) {
    return null;
  }

  const [from, to] = orderEndpoints(fromCardId, toCardId);

  return {
    pairKey: buildPairKey(from, to),
    fromCardId: from,
    toCardId: to,
    type,
  };
}

/**
 * Group connections by canonical pair, recording every type present for the
 * pair. Duplicate rows collapse to one bucket; the representative type is the
 * preferred type present so the result does not depend on input order.
 */
function groupConnections(
  connections: readonly ComparableConnection[],
): readonly CanonicalBucket[] {
  const buckets = new Map<string, { pair: RecallPair; types: Set<ConnectionType> }>();

  for (const connection of connections) {
    const pair = canonicalizeConnection(connection);
    if (pair === null) {
      continue;
    }

    const existing = buckets.get(pair.pairKey);
    if (existing === undefined) {
      buckets.set(pair.pairKey, {
        pair,
        types: new Set([pair.type]),
      });
      continue;
    }

    existing.types.add(pair.type);
  }

  return [...buckets.values()]
    .map(({ pair, types }) => {
      const sortedTypes = [...types].sort(compareTypes);
      const representativeType = sortedTypes[0] ?? pair.type;

      return {
        pair: { ...pair, type: representativeType },
        types: sortedTypes,
      };
    })
    .sort((first, second) => comparePairKeys(first.pair, second.pair));
}

/**
 * Canonicalize a list of connections to one sorted pair per unordered card
 * pair. This is exported for result presentation and for tests that need the
 * same ordering rules as the comparison.
 */
export function canonicalizeConnections(
  connections: readonly ComparableConnection[],
): readonly RecallPair[] {
  return groupConnections(connections).map((bucket) => bucket.pair);
}

/**
 * Compare the hidden truth graph with the student's scratch layer.
 *
 * Matching ignores orientation. A pair with the right endpoints but the wrong
 * type is both remembered and type-mismatched; it is not missed. A duplicate
 * input row never produces a duplicate output entry.
 */
export function compareConnections(
  truth: readonly ComparableConnection[],
  scratch: readonly ComparableConnection[],
): RecallComparison {
  const truthBuckets = groupConnections(truth);
  const scratchBuckets = groupConnections(scratch);

  const scratchByPair = new Map<string, CanonicalBucket>(
    scratchBuckets.map((bucket) => [bucket.pair.pairKey, bucket] as const),
  );
  const truthPairKeys = new Set<string>(truthBuckets.map((bucket) => bucket.pair.pairKey));

  const remembered: RecallPair[] = [];
  const missed: RecallPair[] = [];
  const extra: RecallPair[] = [];
  const typeMismatch: RecallTypeMismatch[] = [];

  for (const truthBucket of truthBuckets) {
    const truthPair = truthBucket.pair;
    const scratchBucket = scratchByPair.get(truthPair.pairKey);

    if (scratchBucket === undefined) {
      missed.push(truthPair);
      continue;
    }

    remembered.push(truthPair);

    // Any exact-type scratch row satisfies the pair. Only when no exact match
    // exists is the first deterministic scratch type reported as the mismatch.
    if (!scratchBucket.types.includes(truthPair.type)) {
      typeMismatch.push({
        ...truthPair,
        expectedType: truthPair.type,
        actualType: scratchBucket.pair.type,
      });
    }
  }

  for (const scratchBucket of scratchBuckets) {
    if (!truthPairKeys.has(scratchBucket.pair.pairKey)) {
      extra.push(scratchBucket.pair);
    }
  }

  return {
    remembered,
    missed,
    extra,
    typeMismatch,
  };
}
