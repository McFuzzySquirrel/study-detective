import type { Clock, IdFactory } from '../domain/ids';
import { createId, systemClock } from '../domain/ids';
import {
  DuplicateConnectionError,
  assertConnectionInCase,
  buildPairKey,
  findConnectionForPair,
  isConnectionForPair,
  planConnectionCascade,
} from '../domain/connections';
import type { ConnectionEndpointCard } from '../domain/connections';
import type { CardRecord, CaseRecord, ConnectionRecord, ConnectionType } from '../domain/model';
import { parseConnectionRecord } from '../domain/validation';

import type { ConnectionRow, NotesDetectiveDatabase } from './db';
import { RecordNotFoundError, readStored } from './errors';
import { fromCardRow, fromConnectionRow, toConnectionRow } from './mappers';
import { readCaseRow, saveTouchedCase } from './transactions';

/**
 * The connection write boundary.
 *
 * Every mutation validates the pair against the stored cards, rejects
 * self-links and provenance misuse before a row is written, and commits the
 * connection plus the owning case's `updatedAt` in one transaction. Reads
 * parse each row and re-check both endpoints against the case cards, so a
 * malformed or cross-case row can never reach the board as if it were valid.
 */

export type NewConnectionInput = {
  readonly caseId: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  /** Association is the product default; the student retypes to provenance. */
  readonly type?: ConnectionType;
};

/**
 * Creating the second string for a pair is not an error: it returns the
 * existing connection so the caller can select it, matching LINK-FR-01.
 */
export type CreateConnectionResult =
  | { readonly status: 'created'; readonly connection: ConnectionRecord }
  | { readonly status: 'duplicate'; readonly connection: ConnectionRecord };

export interface ConnectionRepositoryPort {
  create(input: NewConnectionInput): Promise<CreateConnectionResult>;
  /** Change the type on the existing row; the ID and pair key stay the same. */
  retype(connectionId: string, type: ConnectionType): Promise<ConnectionRecord>;
  /** Restore a deleted row with its original ID for the undo window. */
  restore(connection: ConnectionRecord): Promise<ConnectionRecord>;
  delete(connectionId: string): Promise<boolean>;
  /** Every validated string in one case, ordered by canonical pair key. */
  listByCase(caseId: string): Promise<ConnectionRecord[]>;
  /** Every validated string touching one card, in either orientation. */
  listByCard(cardId: string): Promise<ConnectionRecord[]>;
  /**
   * Remove all strings touching a card in one transaction. Card deletion uses
   * the same plan inside its own transaction so the card and strings commit
   * together. Returns the number of rows removed.
   */
  deleteByCard(cardId: string): Promise<number>;
}

export type ConnectionRepositoryOptions = {
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
};

export function compareConnections(a: ConnectionRecord, b: ConnectionRecord): number {
  return a.pairKey.localeCompare(b.pairKey);
}

function buildConnectionRecord(input: NewConnectionInput, id: string): ConnectionRecord {
  return parseConnectionRecord({
    id,
    caseId: input.caseId,
    fromCardId: input.fromCardId,
    toCardId: input.toCardId,
    pairKey: buildPairKey(input.fromCardId, input.toCardId),
    type: input.type ?? 'association',
  });
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConstraintError';
}

/** Every stored row whose `fromCardId` or `toCardId` is in `cardIds`. */
async function readEndpointRows(
  db: NotesDetectiveDatabase,
  cardIds: readonly string[],
): Promise<ConnectionRow[]> {
  if (cardIds.length === 0) {
    return [];
  }

  const [fromRows, toRows] = await Promise.all([
    db.connections
      .where('fromCardId')
      .anyOf([...cardIds])
      .toArray(),
    db.connections
      .where('toCardId')
      .anyOf([...cardIds])
      .toArray(),
  ]);

  return [...new Map([...fromRows, ...toRows].map((row) => [row.id, row] as const)).values()];
}

async function readPairRows(
  db: NotesDetectiveDatabase,
  cardIdA: string,
  cardIdB: string,
): Promise<ConnectionRow[]> {
  const rows = await readEndpointRows(db, [cardIdA, cardIdB]);
  return rows.filter((row) => isConnectionForPair(row, cardIdA, cardIdB));
}

function parseCardRow(row: unknown, cardId: string): CardRecord {
  return readStored('card', cardId, () => fromCardRow(row));
}

function readConnectionInCase(
  row: unknown,
  cards: readonly ConnectionEndpointCard[],
): ConnectionRecord {
  const record =
    row !== null && typeof row === 'object' ? (row as { readonly id?: unknown }) : undefined;
  const recordId = typeof record?.id === 'string' ? record.id : '(unknown)';

  return readStored('connection', recordId, () => {
    const connection = fromConnectionRow(row);
    assertConnectionInCase(connection, cards);
    return connection;
  });
}

/** Dexie-backed connection repository. */
export class ConnectionRepository implements ConnectionRepositoryPort {
  private readonly db: NotesDetectiveDatabase;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(db: NotesDetectiveDatabase, options: ConnectionRepositoryOptions = {}) {
    this.db = db;
    this.clock = options.clock ?? systemClock;
    this.idFactory = options.idFactory ?? createId;
  }

  async create(input: NewConnectionInput): Promise<CreateConnectionResult> {
    const record = buildConnectionRecord(input, this.idFactory());

    try {
      let duplicate: ConnectionRecord | undefined;

      await this.db.transaction(
        'rw',
        this.db.cases,
        this.db.cards,
        this.db.connections,
        async () => {
          const currentCase = await this.readCase(record.caseId);
          const fromCard = await this.readCard(record.fromCardId);
          const toCard =
            record.toCardId === record.fromCardId ? fromCard : await this.readCard(record.toCardId);

          // Rejects self-links, stale pair keys, foreign-case endpoints, and
          // provenance between anything other than a note and a source.
          assertConnectionInCase(record, [fromCard, toCard]);

          // The unique pairKey index is the backstop; this endpoint lookup also
          // catches a row whose stored pairKey was hand-edited.
          const rows = await readPairRows(this.db, record.fromCardId, record.toCardId);
          const existingRow = rows[0];
          if (existingRow !== undefined) {
            duplicate = readConnectionInCase(existingRow, [fromCard, toCard]);
            return;
          }

          await this.db.connections.add(toConnectionRow(record));
          await saveTouchedCase(this.db, currentCase, this.clock);
        },
      );

      if (duplicate !== undefined) {
        return { status: 'duplicate', connection: duplicate };
      }
      return { status: 'created', connection: record };
    } catch (error) {
      // A concurrent create can pass the in-transaction lookup and lose the
      // race at the unique index. Resolve that as the same duplicate result
      // instead of surfacing a storage error.
      if (isConstraintError(error)) {
        const existing = await this.findPair(record.fromCardId, record.toCardId);
        if (existing !== null) {
          return { status: 'duplicate', connection: existing };
        }
      }
      throw error;
    }
  }

  async retype(connectionId: string, type: ConnectionType): Promise<ConnectionRecord> {
    return this.db.transaction(
      'rw',
      this.db.cases,
      this.db.cards,
      this.db.connections,
      async () => {
        const row = await this.db.connections.get(connectionId);
        if (row === undefined) {
          throw new RecordNotFoundError('connection', connectionId);
        }

        const current = readStored('connection', connectionId, () => fromConnectionRow(row));
        // An invalid enum value fails here, before any write.
        const updated = parseConnectionRecord({ ...current, type });

        const currentCase = await this.readCase(current.caseId);
        const cards = await this.readCaseCards(current.caseId);
        assertConnectionInCase(updated, cards);

        if (updated.type === current.type) {
          return current;
        }

        await this.db.connections.put(toConnectionRow(updated));
        await saveTouchedCase(this.db, currentCase, this.clock);
        return updated;
      },
    );
  }

  async delete(connectionId: string): Promise<boolean> {
    return this.db.transaction('rw', this.db.cases, this.db.connections, async () => {
      const row = await this.db.connections.get(connectionId);
      if (row === undefined) {
        return false;
      }

      const current = readStored('connection', connectionId, () => fromConnectionRow(row));
      const currentCase = await this.readCase(current.caseId);

      await this.db.connections.delete(connectionId);
      await saveTouchedCase(this.db, currentCase, this.clock);
      return true;
    });
  }

  async restore(connection: ConnectionRecord): Promise<ConnectionRecord> {
    const record = parseConnectionRecord(connection);

    return this.db.transaction(
      'rw',
      this.db.cases,
      this.db.cards,
      this.db.connections,
      async () => {
        const currentCase = await this.readCase(record.caseId);
        const fromCard = await this.readCard(record.fromCardId);
        const toCard =
          record.toCardId === record.fromCardId ? fromCard : await this.readCard(record.toCardId);
        assertConnectionInCase(record, [fromCard, toCard]);

        const rows = await readPairRows(this.db, record.fromCardId, record.toCardId);
        const conflict = rows.find((row) => row.id !== record.id);
        if (conflict !== undefined) {
          throw new DuplicateConnectionError(conflict.id);
        }

        await this.db.connections.put(toConnectionRow(record));
        await saveTouchedCase(this.db, currentCase, this.clock);
        return record;
      },
    );
  }

  async listByCase(caseId: string): Promise<ConnectionRecord[]> {
    return this.db.transaction('r', this.db.cases, this.db.cards, this.db.connections, async () => {
      const caseRow = await this.db.cases.get(caseId);
      if (caseRow === undefined) {
        return [];
      }

      readStored('case', caseId, () => readCaseRow(caseRow, caseId));
      const cards = await this.readCaseCards(caseId);
      const rows = await this.db.connections.where('caseId').equals(caseId).toArray();

      return rows.map((row) => readConnectionInCase(row, cards)).sort(compareConnections);
    });
  }

  async listByCard(cardId: string): Promise<ConnectionRecord[]> {
    return this.db.transaction('r', this.db.cases, this.db.cards, this.db.connections, async () => {
      const cardRow = await this.db.cards.get(cardId);
      if (cardRow === undefined) {
        return [];
      }

      const card = parseCardRow(cardRow, cardId);
      // A card whose owning case is missing is corrupt: reject it rather
      // than returning strings from a graph that cannot be displayed.
      await this.readCase(card.caseId);
      const cards = await this.readCaseCards(card.caseId);
      const rows = await readEndpointRows(this.db, [cardId]);

      return rows.map((row) => readConnectionInCase(row, cards)).sort(compareConnections);
    });
  }

  async deleteByCard(cardId: string): Promise<number> {
    return this.db.transaction(
      'rw',
      this.db.cases,
      this.db.cards,
      this.db.connections,
      async () => {
        const cardRow = await this.db.cards.get(cardId);
        if (cardRow === undefined) {
          return 0;
        }

        const card = parseCardRow(cardRow, cardId);
        const currentCase = await this.readCase(card.caseId);
        const rows = await readEndpointRows(this.db, [cardId]);
        const plan = planConnectionCascade(rows, [cardId]);

        if (plan.connectionIds.length > 0) {
          await this.db.connections.bulkDelete([...plan.connectionIds]);
        }
        await saveTouchedCase(this.db, currentCase, this.clock);
        return plan.connectionIds.length;
      },
    );
  }

  private async readCase(caseId: string): Promise<CaseRecord> {
    const row = await this.db.cases.get(caseId);
    if (row === undefined) {
      throw new RecordNotFoundError('case', caseId);
    }
    return readStored('case', caseId, () => readCaseRow(row, caseId));
  }

  private async readCard(cardId: string): Promise<CardRecord> {
    const row = await this.db.cards.get(cardId);
    if (row === undefined) {
      throw new RecordNotFoundError('card', cardId);
    }
    return parseCardRow(row, cardId);
  }

  private async readCaseCards(caseId: string): Promise<CardRecord[]> {
    const rows = await this.db.cards.where('caseId').equals(caseId).toArray();
    return rows.map((row) => parseCardRow(row, row.id));
  }

  private async findPair(cardIdA: string, cardIdB: string): Promise<ConnectionRecord | null> {
    return this.db.transaction('r', this.db.connections, async () => {
      const rows = await readPairRows(this.db, cardIdA, cardIdB);
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      return readStored('connection', row.id, () => fromConnectionRow(row));
    });
  }
}

export type InMemoryConnectionCards =
  readonly ConnectionEndpointCard[] | (() => readonly ConnectionEndpointCard[]);

export type InMemoryConnectionRepositoryOptions = {
  readonly cards: InMemoryConnectionCards;
  readonly connections?: readonly ConnectionRecord[];
  readonly idFactory?: IdFactory;
};

/**
 * In-memory implementation of the connection contract for unit and component
 * tests. It applies the same rules before mutating and never opens IndexedDB;
 * the Dexie tests remain the transaction proof.
 */
export class InMemoryConnectionRepository implements ConnectionRepositoryPort {
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly readCards: () => readonly ConnectionEndpointCard[];
  private readonly idFactory: IdFactory;

  constructor(options: InMemoryConnectionRepositoryOptions) {
    const cards = options.cards;
    this.readCards = typeof cards === 'function' ? cards : () => cards;
    this.idFactory = options.idFactory ?? createId;

    for (const seed of options.connections ?? []) {
      const parsed = parseConnectionRecord(seed);
      this.assertConnection(parsed);
      const existing = findConnectionForPair(
        [...this.connections.values()],
        parsed.fromCardId,
        parsed.toCardId,
      );
      if (existing !== undefined) {
        throw new DuplicateConnectionError(existing.id);
      }
      this.connections.set(parsed.id, parsed);
    }
  }

  async create(input: NewConnectionInput): Promise<CreateConnectionResult> {
    const record = buildConnectionRecord(input, this.idFactory());
    this.assertConnection(record);

    const existing = findConnectionForPair(
      [...this.connections.values()],
      record.fromCardId,
      record.toCardId,
    );
    if (existing !== undefined) {
      return { status: 'duplicate', connection: existing };
    }

    this.connections.set(record.id, record);
    return { status: 'created', connection: record };
  }

  async retype(connectionId: string, type: ConnectionType): Promise<ConnectionRecord> {
    const current = this.require(connectionId);
    const updated = parseConnectionRecord({ ...current, type });
    this.assertConnection(updated);
    if (updated.type === current.type) {
      return current;
    }

    this.connections.set(connectionId, updated);
    return updated;
  }

  async delete(connectionId: string): Promise<boolean> {
    return this.connections.delete(connectionId);
  }

  async restore(connection: ConnectionRecord): Promise<ConnectionRecord> {
    const record = parseConnectionRecord(connection);
    this.assertConnection(record);

    const conflict = findConnectionForPair(
      [...this.connections.values()],
      record.fromCardId,
      record.toCardId,
    );
    if (conflict !== undefined && conflict.id !== record.id) {
      throw new DuplicateConnectionError(conflict.id);
    }

    this.connections.set(record.id, record);
    return record;
  }

  async listByCase(caseId: string): Promise<ConnectionRecord[]> {
    const cards = this.readCards().filter((card) => card.caseId === caseId);
    return [...this.connections.values()]
      .filter((connection) => connection.caseId === caseId)
      .map((connection) => this.validateAgainst(connection, cards))
      .sort(compareConnections);
  }

  async listByCard(cardId: string): Promise<ConnectionRecord[]> {
    const card = this.readCards().find((candidate) => candidate.id === cardId);
    if (card === undefined) {
      return [];
    }

    const cards = this.readCards().filter((candidate) => candidate.caseId === card.caseId);
    return [...this.connections.values()]
      .filter((connection) => connection.fromCardId === cardId || connection.toCardId === cardId)
      .map((connection) => this.validateAgainst(connection, cards))
      .sort(compareConnections);
  }

  async deleteByCard(cardId: string): Promise<number> {
    if (!this.readCards().some((card) => card.id === cardId)) {
      return 0;
    }

    const plan = planConnectionCascade([...this.connections.values()], [cardId]);
    for (const connectionId of plan.connectionIds) {
      this.connections.delete(connectionId);
    }
    return plan.connectionIds.length;
  }

  private require(connectionId: string): ConnectionRecord {
    const connection = this.connections.get(connectionId);
    if (connection === undefined) {
      throw new RecordNotFoundError('connection', connectionId);
    }
    return connection;
  }

  private assertConnection(connection: ConnectionRecord): void {
    const cards = this.readCards();
    const fromCard = cards.find((card) => card.id === connection.fromCardId);
    if (fromCard === undefined) {
      throw new RecordNotFoundError('card', connection.fromCardId);
    }

    const toCard =
      connection.toCardId === connection.fromCardId
        ? fromCard
        : cards.find((card) => card.id === connection.toCardId);
    if (toCard === undefined) {
      throw new RecordNotFoundError('card', connection.toCardId);
    }

    assertConnectionInCase(connection, [fromCard, toCard]);
  }

  private validateAgainst(
    connection: ConnectionRecord,
    cards: readonly ConnectionEndpointCard[],
  ): ConnectionRecord {
    assertConnectionInCase(connection, cards);
    return connection;
  }
}
