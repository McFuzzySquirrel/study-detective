import type { CardRecord, ConnectionRecord, ConnectionType } from './model';

/**
 * Pure readiness, loose-thread, and topic-status derivation.
 *
 * The case graph is the only source of truth. Nothing in this module reads a
 * stored `ready`, `solved`, `looseThreadCount`, score, or level: every value is
 * recomputed from the cards and connections passed in, so a connection edit is
 * visible on the next read without a migration or cache invalidation.
 *
 * Rules:
 *
 * - A Study Note is ready with at least one provenance connection to a Source
 *   and at least one association connection to a Topic.
 * - A Topic is ready with at least one connection of any type to another card.
 * - Sources never appear as loose threads and never carry a topic status.
 * - A Topic's status counts distinct linked Study Notes: `orphan` at zero,
 *   `developing` at one, and `solved` at two or more.
 *
 * The selectors are defensive about corrupt rows: a connection with a missing
 * or identical endpoint is ignored, a duplicate connection row cannot inflate a
 * count, and duplicate card rows collapse to the first occurrence. Offenders are
 * returned once per card with every missing requirement in `reasons`, and the
 * result order is deterministic (title, then id) regardless of input order.
 */

/** The card fields readiness needs. Full `CardRecord`s satisfy this shape. */
export type ReadinessCard = Pick<CardRecord, 'id' | 'caseId' | 'type' | 'title'>;

/** The connection fields readiness needs. Full `ConnectionRecord`s satisfy this. */
export type ReadinessConnection = Pick<ConnectionRecord, 'fromCardId' | 'toCardId' | 'type'>;

export type LooseNoteReason = 'no-source-link' | 'no-topic-connection';
export type LooseThreadReason = LooseNoteReason | 'no-connections';
export type TopicStatus = 'orphan' | 'developing' | 'solved';

/**
 * Readiness for one Study Note. `reason` on a loose thread is the primary
 * missing requirement; `reasons` always contains every missing requirement.
 */
export interface NoteReadiness {
  readonly card: ReadinessCard;
  readonly cardId: string;
  readonly ready: boolean;
  readonly sourceLinkCount: number;
  readonly topicLinkCount: number;
  readonly reasons: readonly LooseNoteReason[];
}

/** A loose Study Note, ready to be listed in the closure panel. */
export interface LooseNoteThread {
  readonly kind: 'note';
  readonly card: ReadinessCard;
  readonly cardId: string;
  readonly reason: LooseNoteReason;
  readonly reasons: readonly LooseNoteReason[];
  readonly sourceLinkCount: number;
  readonly topicLinkCount: number;
}

/** A Topic with no connections at all. */
export interface LooseTopicThread {
  readonly kind: 'topic';
  readonly card: ReadinessCard;
  readonly cardId: string;
  readonly reason: 'no-connections';
  readonly reasons: readonly ['no-connections'];
  readonly status: TopicStatus;
  readonly connectionCount: number;
}

export type LooseThread = LooseNoteThread | LooseTopicThread;

/** Derived status for every Topic, including topics that are not loose. */
export interface TopicReadiness {
  readonly card: ReadinessCard;
  readonly cardId: string;
  readonly status: TopicStatus;
  readonly linkedNoteCount: number;
  /** Distinct neighbouring cards of any type; duplicate rows count once. */
  readonly connectionCount: number;
  /** True only when the topic has zero connections. */
  readonly loose: boolean;
}

/** The complete derived view of one case graph. */
export interface CaseReadiness {
  readonly ready: boolean;
  readonly looseThreadCount: number;
  readonly looseNoteCount: number;
  readonly looseTopicCount: number;
  /** Loose notes first, then loose topics; each group in title order. */
  readonly looseThreads: readonly LooseThread[];
  readonly looseNotes: readonly LooseNoteThread[];
  readonly looseTopics: readonly LooseTopicThread[];
  readonly notes: readonly NoteReadiness[];
  readonly topics: readonly TopicReadiness[];
}

interface NeighbourLink {
  readonly card: ReadinessCard;
  readonly type: ConnectionType;
}

interface IndexedGraph {
  readonly cards: readonly ReadinessCard[];
  readonly neighbours: ReadonlyMap<string, readonly NeighbourLink[]>;
}

/**
 * Locale-independent card order: display title (case-insensitive), then the
 * exact title, then the id. Keeping this in the domain means a list cannot
 * reshuffle just because IndexedDB returned rows in a different order.
 */
function compareCards(a: ReadinessCard, b: ReadinessCard): number {
  const aTitle = a.title.trim().toLowerCase();
  const bTitle = b.title.trim().toLowerCase();

  if (aTitle !== bTitle) {
    return aTitle < bTitle ? -1 : 1;
  }
  if (a.title !== b.title) {
    return a.title < b.title ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Collapse duplicate card rows and drop untrustworthy connection rows before
 * any counting. A connection is usable only when both endpoints resolve to
 * distinct cards supplied for this case.
 */
function indexGraph(
  cards: readonly ReadinessCard[],
  connections: readonly ReadinessConnection[],
): IndexedGraph {
  const byId = new Map<string, ReadinessCard>();
  for (const card of cards) {
    if (!byId.has(card.id)) {
      byId.set(card.id, card);
    }
  }

  const neighbours = new Map<string, NeighbourLink[]>();
  const addNeighbour = (cardId: string, link: NeighbourLink): void => {
    const links = neighbours.get(cardId);
    if (links === undefined) {
      neighbours.set(cardId, [link]);
      return;
    }
    links.push(link);
  };

  for (const connection of connections) {
    if (connection.fromCardId === connection.toCardId) {
      continue;
    }

    const from = byId.get(connection.fromCardId);
    const to = byId.get(connection.toCardId);
    if (from === undefined || to === undefined) {
      continue;
    }

    addNeighbour(from.id, { card: to, type: connection.type });
    addNeighbour(to.id, { card: from, type: connection.type });
  }

  return {
    cards: [...byId.values()].sort(compareCards),
    neighbours,
  };
}

function neighboursOf(graph: IndexedGraph, cardId: string): readonly NeighbourLink[] {
  return graph.neighbours.get(cardId) ?? [];
}

function topicStatusForNoteCount(linkedNoteCount: number): TopicStatus {
  if (linkedNoteCount >= 2) {
    return 'solved';
  }
  return linkedNoteCount === 1 ? 'developing' : 'orphan';
}

function buildNoteReadiness(
  card: ReadinessCard,
  neighbours: readonly NeighbourLink[],
): NoteReadiness {
  const sourceIds = new Set<string>();
  const topicIds = new Set<string>();

  for (const neighbour of neighbours) {
    if (neighbour.type === 'provenance' && neighbour.card.type === 'source') {
      sourceIds.add(neighbour.card.id);
    }
    if (neighbour.type === 'association' && neighbour.card.type === 'topic') {
      topicIds.add(neighbour.card.id);
    }
  }

  const reasons: LooseNoteReason[] = [];
  if (sourceIds.size === 0) {
    reasons.push('no-source-link');
  }
  if (topicIds.size === 0) {
    reasons.push('no-topic-connection');
  }

  return {
    card,
    cardId: card.id,
    ready: reasons.length === 0,
    sourceLinkCount: sourceIds.size,
    topicLinkCount: topicIds.size,
    reasons,
  };
}

function buildTopicReadiness(
  card: ReadinessCard,
  neighbours: readonly NeighbourLink[],
): TopicReadiness {
  const neighbourIds = new Set<string>();
  const linkedNoteIds = new Set<string>();

  for (const neighbour of neighbours) {
    neighbourIds.add(neighbour.card.id);
    if (neighbour.type === 'association' && neighbour.card.type === 'note') {
      linkedNoteIds.add(neighbour.card.id);
    }
  }

  const linkedNoteCount = linkedNoteIds.size;

  return {
    card,
    cardId: card.id,
    status: topicStatusForNoteCount(linkedNoteCount),
    linkedNoteCount,
    connectionCount: neighbourIds.size,
    loose: neighbourIds.size === 0,
  };
}

function primaryNoteReason(reasons: readonly LooseNoteReason[]): LooseNoteReason {
  return reasons[0] ?? 'no-source-link';
}

function toLooseNoteThread(note: NoteReadiness): LooseNoteThread {
  return {
    kind: 'note',
    card: note.card,
    cardId: note.cardId,
    reason: primaryNoteReason(note.reasons),
    reasons: note.reasons,
    sourceLinkCount: note.sourceLinkCount,
    topicLinkCount: note.topicLinkCount,
  };
}

function toLooseTopicThread(topic: TopicReadiness): LooseTopicThread {
  return {
    kind: 'topic',
    card: topic.card,
    cardId: topic.cardId,
    reason: 'no-connections',
    reasons: ['no-connections'],
    status: topic.status,
    connectionCount: topic.connectionCount,
  };
}

/**
 * Derive the whole readiness report. `cards` and `connections` must describe
 * the same case; the caller owns that scoping. Rows are validated on read by
 * the repository, while this function tolerates duplicates and dangling rows
 * so a selector can never throw on stale storage.
 */
export function deriveReadiness(
  cards: readonly ReadinessCard[],
  connections: readonly ReadinessConnection[] = [],
): CaseReadiness {
  const graph = indexGraph(cards, connections);

  const notes: NoteReadiness[] = [];
  const topics: TopicReadiness[] = [];

  for (const card of graph.cards) {
    if (card.type === 'note') {
      notes.push(buildNoteReadiness(card, neighboursOf(graph, card.id)));
    } else if (card.type === 'topic') {
      topics.push(buildTopicReadiness(card, neighboursOf(graph, card.id)));
    }
  }

  const looseNotes = notes.filter((note) => !note.ready).map(toLooseNoteThread);
  const looseTopics = topics.filter((topic) => topic.loose).map(toLooseTopicThread);
  const looseThreads: LooseThread[] = [...looseNotes, ...looseTopics];

  return {
    ready: looseThreads.length === 0,
    looseThreadCount: looseThreads.length,
    looseNoteCount: looseNotes.length,
    looseTopicCount: looseTopics.length,
    looseThreads,
    looseNotes,
    looseTopics,
    notes,
    topics,
  };
}

/** The loose notes and topics in stable order; one row per offending card. */
export function deriveLooseThreads(
  cards: readonly ReadinessCard[],
  connections: readonly ReadinessConnection[] = [],
): readonly LooseThread[] {
  return deriveReadiness(cards, connections).looseThreads;
}

/** Count offending cards once each, even when a note misses both requirements. */
export function countLooseThreads(
  cards: readonly ReadinessCard[],
  connections: readonly ReadinessConnection[] = [],
): number {
  return deriveReadiness(cards, connections).looseThreadCount;
}

/** True only when the graph has zero loose threads. */
export function isCaseReady(
  cards: readonly ReadinessCard[],
  connections: readonly ReadinessConnection[] = [],
): boolean {
  return deriveReadiness(cards, connections).ready;
}

/** Per-topic status for every topic, including non-loose ones. */
export function deriveTopicReadiness(
  cards: readonly ReadinessCard[],
  connections: readonly ReadinessConnection[] = [],
): readonly TopicReadiness[] {
  return deriveReadiness(cards, connections).topics;
}

/** Readiness for one note, or undefined when the id is not a note in the graph. */
export function getNoteReadiness(
  cardId: string,
  cards: readonly ReadinessCard[],
  connections: readonly ReadinessConnection[] = [],
): NoteReadiness | undefined {
  return deriveReadiness(cards, connections).notes.find((note) => note.cardId === cardId);
}

/** Status for one topic, or undefined when the id is not a topic in the graph. */
export function getTopicReadiness(
  cardId: string,
  cards: readonly ReadinessCard[],
  connections: readonly ReadinessConnection[] = [],
): TopicReadiness | undefined {
  return deriveReadiness(cards, connections).topics.find((topic) => topic.cardId === cardId);
}
