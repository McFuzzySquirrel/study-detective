import type { ZodIssue } from 'zod';

import type { CardRecord, ConnectionRecord } from './model';
import { DomainValidationError } from './validation';

/**
 * Connection domain rules.
 *
 * This module is the shared vocabulary for the graph rules that both the
 * Dexie repository and the in-memory fake enforce. The canonical pair key and
 * the eligibility primitives live with the schemas; this module re-exports
 * them so board, data, and feature code has one connection-owned import path,
 * and adds the duplicate, cascade, and dangling-endpoint rules that are not
 * expressible inside a single record schema.
 */

export { CONNECTION_PAIR_SEPARATOR, buildPairKey } from './model';
export {
  assertCanonicalPairKey,
  assertConnectionEligible,
  assertConnectionInCase,
  isAssociationEligible,
  isCanonicalPairKey,
  isProvenanceEligible,
} from './validation';
export type { ConnectionCandidate, ConnectionEndpointCard } from './validation';

/** The minimum shape needed for pair, cascade, and dangling rules. */
export type ConnectionRef = Pick<ConnectionRecord, 'id' | 'fromCardId' | 'toCardId'>;

const DUPLICATE_PAIR_MESSAGE = 'Exactly one connection may exist per unordered card pair';

function connectionIssue(path: PropertyKey[], message: string): ZodIssue {
  return { code: 'custom', path, message };
}

/**
 * Raised when a second string would be written for a pair that already has
 * one. The existing connection ID lets a caller select the duplicate instead of
 * creating another row.
 */
export class DuplicateConnectionError extends DomainValidationError {
  readonly existingConnectionId: string;

  constructor(existingConnectionId: string) {
    super('A connection already exists for this card pair', [
      connectionIssue(['pairKey'], DUPLICATE_PAIR_MESSAGE),
    ]);
    this.name = 'DuplicateConnectionError';
    this.existingConnectionId = existingConnectionId;
  }
}

/**
 * Self-links are not a pair at all: they are rejected before any duplicate
 * lookup or write. The repository repeats this check against the stored card
 * types because a hand-edited row must not bypass it.
 */
export function assertDistinctConnectionEndpoints(cardIdA: string, cardIdB: string): void {
  if (cardIdA === cardIdB) {
    throw new DomainValidationError('Invalid connection: a card cannot link to itself', [
      connectionIssue(['toCardId'], 'A connection cannot link a card to itself'),
    ]);
  }
}

/**
 * True when the stored endpoints are the same unordered pair regardless of
 * which card was dragged from and which type the connection currently has.
 * Deliberately ignores `pairKey`: a row with a stale key must still count as
 * the duplicate of its endpoints.
 */
export function isConnectionForPair(
  connection: ConnectionRef,
  cardIdA: string,
  cardIdB: string,
): boolean {
  if (cardIdA === cardIdB) {
    return false;
  }

  return (
    (connection.fromCardId === cardIdA && connection.toCardId === cardIdB) ||
    (connection.fromCardId === cardIdB && connection.toCardId === cardIdA)
  );
}

/** Find the existing string for a pair, in either orientation. */
export function findConnectionForPair<T extends ConnectionRef>(
  connections: readonly T[],
  cardIdA: string,
  cardIdB: string,
): T | undefined {
  return connections.find((connection) => isConnectionForPair(connection, cardIdA, cardIdB));
}

export function hasConnectionForPair(
  connections: readonly ConnectionRef[],
  cardIdA: string,
  cardIdB: string,
): boolean {
  return findConnectionForPair(connections, cardIdA, cardIdB) !== undefined;
}

/**
 * Reject a duplicate before a write. `ConnectionRepository.create` returns the
 * existing row instead of throwing so the UI can select it; this assertion is
 * for callers that must fail hard.
 */
export function assertConnectionPairAvailable(
  connections: readonly ConnectionRef[],
  cardIdA: string,
  cardIdB: string,
): void {
  const existing = findConnectionForPair(connections, cardIdA, cardIdB);
  if (existing !== undefined) {
    throw new DuplicateConnectionError(existing.id);
  }
}

/**
 * The endpoints of one string that are not present in the supplied card set.
 * Used when a repository read or import must reject a dangling row instead of
 * returning it to the board.
 */
export function missingConnectionEndpoints(
  connection: ConnectionRef,
  cards: readonly Pick<CardRecord, 'id'>[],
): string[] {
  const present = new Set(cards.map((card) => card.id));
  const missing: string[] = [];

  if (!present.has(connection.fromCardId)) {
    missing.push(connection.fromCardId);
  }
  if (!present.has(connection.toCardId) && connection.toCardId !== connection.fromCardId) {
    missing.push(connection.toCardId);
  }

  return missing;
}

/** Every connection with at least one endpoint outside the card set, stable. */
export function findDanglingConnections<T extends ConnectionRef>(
  connections: readonly T[],
  cards: readonly Pick<CardRecord, 'id'>[],
): T[] {
  return connections.filter(
    (connection) => missingConnectionEndpoints(connection, cards).length > 0,
  );
}

/** The deterministic set of strings a card deletion must remove. */
export type ConnectionCascadePlan = {
  readonly removedCardIds: readonly string[];
  readonly connectionIds: readonly string[];
};

/**
 * Plan the connection half of a card cascade. A connection is removed when
 * either endpoint is in `removedCardIds`; unrelated strings are untouched.
 * Card IDs and connection IDs are deduplicated and sorted so an undo snapshot,
 * confirmation count, and transaction delete all see the same order.
 */
export function planConnectionCascade(
  connections: readonly ConnectionRef[],
  removedCardIds: readonly string[],
): ConnectionCascadePlan {
  const cardIds = [...new Set(removedCardIds)].sort();
  const removed = new Set(cardIds);
  const connectionIds = new Set<string>();

  for (const connection of connections) {
    if (removed.has(connection.fromCardId) || removed.has(connection.toCardId)) {
      connectionIds.add(connection.id);
    }
  }

  return {
    removedCardIds: cardIds,
    connectionIds: [...connectionIds].sort(),
  };
}
