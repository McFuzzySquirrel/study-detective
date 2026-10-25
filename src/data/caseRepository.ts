import type { Clock, IdFactory } from '../domain/ids';
import { createId, nowIso, systemClock } from '../domain/ids';
import { DEFAULT_VIEWPORT, ATTACHMENT_KINDS } from '../domain/model';
import type {
  AttachmentRecord,
  CardPosition,
  CardRecord,
  CardType,
  CaseRecord,
  CaseSummary,
  ConnectionRecord,
  Viewport,
} from '../domain/model';
import {
  normalizeTags,
  parseAttachmentRecord,
  parseCaseRecord,
  parseCaseSummary,
  parseCardRecord,
  parseConnectionRecord,
  parseViewport,
} from '../domain/validation';

import type { NewAttachment } from './attachmentStore';
import { assertDistinctAttachmentKinds, buildAttachmentRecord } from './attachmentStore';
import type { NotesDetectiveDatabase } from './db';
import { deleteCase as deleteCaseTransaction, readCaseDeletionPreview } from './deleteCase';
import type { CaseDeletionCounts, CaseDeletionPreview } from './deleteCase';
import { RecordNotFoundError, readStored } from './errors';
import { fromCardRow, toAttachmentRow, toCardRow, toCaseRow } from './mappers';
import { latestTimestamp, markCaseUpdated, readCaseRow, saveTouchedCase } from './transactions';

/** Fields a student or the demo seeder may supply when creating a case. */
export type CaseCreateInput = {
  readonly title: string;
  readonly subject?: string;
  readonly examDate?: string;
  readonly viewport?: Viewport;
  readonly isDemo?: boolean;
  readonly closedAt?: string | null;
  readonly backupPromptedAt?: string | null;
};

/**
 * Mutable case metadata. `null` clears an optional subject or exam date; an
 * omitted key leaves it unchanged. Closure and backup flows write their own
 * timestamps through the same validated patch.
 */
export type CasePatch = {
  readonly title?: string;
  readonly subject?: string | null;
  readonly examDate?: string | null;
  readonly viewport?: Viewport;
  readonly isDemo?: boolean;
  readonly closedAt?: string | null;
  readonly backupPromptedAt?: string | null;
};

export type CardCreateInput = {
  readonly caseId: string;
  readonly type: CardType;
  readonly title: string;
  readonly position: CardPosition;
  readonly tags?: readonly string[];
  readonly ocrText?: string;
  readonly ocrConfidence?: number;
  readonly ocrEngineVersion?: string;
  readonly ocrUpdatedAt?: string;
};

export type CardPatch = {
  readonly title?: string;
  readonly type?: CardType;
  readonly position?: CardPosition;
  readonly tags?: readonly string[];
  readonly ocrText?: string;
  readonly ocrConfidence?: number;
  readonly ocrEngineVersion?: string;
  readonly ocrUpdatedAt?: string;
};

export type CardWithAttachments = {
  readonly card: CardRecord;
  readonly attachments: AttachmentRecord[];
};

/**
 * The boundary React and the board depend on. Both the Dexie repository and
 * the in-memory fake implement this so UI tests never open IndexedDB.
 */
export interface CaseRepositoryPort {
  createCase(input: CaseCreateInput): Promise<CaseRecord>;
  getCase(caseId: string): Promise<CaseRecord | null>;
  getCaseSummary(caseId: string): Promise<CaseSummary | null>;
  listCaseSummaries(): Promise<CaseSummary[]>;
  updateCase(caseId: string, patch: CasePatch): Promise<CaseRecord>;
  saveViewport(caseId: string, viewport: Viewport): Promise<CaseRecord>;
  createCard(input: CardCreateInput): Promise<CardRecord>;
  /**
   * Create a card and all of its attachment rows in one transaction. If any
   * Blob or the owning-case timestamp write fails, the card rolls back too.
   * Capture passes the original, display, and thumbnail set here.
   */
  createCardWithAttachments(
    input: CardCreateInput,
    attachments: readonly NewAttachment[],
  ): Promise<CardWithAttachments>;
  getCard(cardId: string): Promise<CardRecord | null>;
  listCards(caseId: string): Promise<CardRecord[]>;
  updateCard(cardId: string, patch: CardPatch): Promise<CardRecord>;
  deleteCard(cardId: string): Promise<boolean>;
  /** Counts a destructive confirmation must name before deleting a case. */
  getCaseDeletionPreview(caseId: string): Promise<CaseDeletionPreview | null>;
  /**
   * Delete the case, its cards, its connections, and every attachment Blob in
   * one transaction. Returns false when the case was already gone. There is no
   * undo path.
   */
  deleteCase(caseId: string): Promise<boolean>;
}

export type CaseRepositoryOptions = {
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
};

function optionalString(
  next: string | null | undefined,
  current: string | undefined,
): string | undefined {
  if (next === undefined) {
    return current;
  }
  return next === null ? undefined : next;
}

function buildCaseRecord(input: CaseCreateInput, id: string, now: string): CaseRecord {
  return parseCaseRecord({
    id,
    title: input.title,
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.examDate !== undefined ? { examDate: input.examDate } : {}),
    createdAt: now,
    updatedAt: now,
    viewport: input.viewport ?? DEFAULT_VIEWPORT,
    closedAt: input.closedAt ?? null,
    isDemo: input.isDemo ?? false,
    backupPromptedAt: input.backupPromptedAt ?? null,
  });
}

function mergeCaseRecord(current: CaseRecord, patch: CasePatch, clock: Clock): CaseRecord {
  const subject = optionalString(patch.subject, current.subject);
  const examDate = optionalString(patch.examDate, current.examDate);

  return parseCaseRecord({
    id: current.id,
    title: patch.title ?? current.title,
    ...(subject !== undefined ? { subject } : {}),
    ...(examDate !== undefined ? { examDate } : {}),
    createdAt: current.createdAt,
    updatedAt: latestTimestamp(nowIso(clock), current.updatedAt),
    viewport: patch.viewport ?? current.viewport,
    closedAt: patch.closedAt !== undefined ? patch.closedAt : current.closedAt,
    isDemo: patch.isDemo ?? current.isDemo,
    backupPromptedAt:
      patch.backupPromptedAt !== undefined ? patch.backupPromptedAt : current.backupPromptedAt,
  });
}

function buildCardRecord(input: CardCreateInput, id: string, now: string): CardRecord {
  return parseCardRecord({
    id,
    caseId: input.caseId,
    type: input.type,
    title: input.title,
    position: { x: input.position.x, y: input.position.y },
    tags: normalizeTags(input.tags ?? []),
    createdAt: now,
    updatedAt: now,
    ...(input.ocrText !== undefined ? { ocrText: input.ocrText } : {}),
    ...(input.ocrConfidence !== undefined ? { ocrConfidence: input.ocrConfidence } : {}),
    ...(input.ocrEngineVersion !== undefined ? { ocrEngineVersion: input.ocrEngineVersion } : {}),
    ...(input.ocrUpdatedAt !== undefined ? { ocrUpdatedAt: input.ocrUpdatedAt } : {}),
  });
}

function mergeCardRecord(current: CardRecord, patch: CardPatch, clock: Clock): CardRecord {
  return parseCardRecord({
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.position !== undefined
      ? { position: { x: patch.position.x, y: patch.position.y } }
      : {}),
    ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
    updatedAt: latestTimestamp(nowIso(clock), current.updatedAt),
    ...(patch.ocrText !== undefined ? { ocrText: patch.ocrText } : {}),
    ...(patch.ocrConfidence !== undefined ? { ocrConfidence: patch.ocrConfidence } : {}),
    ...(patch.ocrEngineVersion !== undefined ? { ocrEngineVersion: patch.ocrEngineVersion } : {}),
    ...(patch.ocrUpdatedAt !== undefined ? { ocrUpdatedAt: patch.ocrUpdatedAt } : {}),
  });
}

function buildSummary(record: CaseRecord, cardCount: number, connectionCount: number): CaseSummary {
  return parseCaseSummary({
    id: record.id,
    title: record.title,
    ...(record.subject !== undefined ? { subject: record.subject } : {}),
    ...(record.examDate !== undefined ? { examDate: record.examDate } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    closedAt: record.closedAt,
    isDemo: record.isDemo,
    cardCount,
    connectionCount,
  });
}

function countByCase(rows: readonly { readonly caseId: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.caseId, (counts.get(row.caseId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Shelf order: nearest exam date first, undated cases last, then most recently
 * modified, with the UUID as a stable tie-break.
 */
export function compareCaseSummaries(a: CaseSummary, b: CaseSummary): number {
  if (a.examDate !== undefined && b.examDate !== undefined) {
    const byExamDate = a.examDate.localeCompare(b.examDate);
    if (byExamDate !== 0) {
      return byExamDate;
    }
  } else if (a.examDate !== undefined) {
    return -1;
  } else if (b.examDate !== undefined) {
    return 1;
  }

  const byUpdatedAt = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : a.id.localeCompare(b.id);
}

function compareCards(a: CardRecord, b: CardRecord): number {
  const byCreatedAt = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return byCreatedAt !== 0 ? byCreatedAt : a.id.localeCompare(b.id);
}

/** Dexie-backed repository: the only production write boundary for cases. */
export class CaseRepository implements CaseRepositoryPort {
  private readonly db: NotesDetectiveDatabase;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(db: NotesDetectiveDatabase, options: CaseRepositoryOptions = {}) {
    this.db = db;
    this.clock = options.clock ?? systemClock;
    this.idFactory = options.idFactory ?? createId;
  }

  async createCase(input: CaseCreateInput): Promise<CaseRecord> {
    const record = buildCaseRecord(input, this.idFactory(), nowIso(this.clock));

    await this.db.transaction('rw', this.db.cases, async () => {
      await this.db.cases.add(toCaseRow(record));
    });

    return record;
  }

  async getCase(caseId: string): Promise<CaseRecord | null> {
    const row = await this.db.cases.get(caseId);
    if (row === undefined) {
      return null;
    }
    return readStored('case', caseId, () => readCaseRow(row, caseId));
  }

  async getCaseSummary(caseId: string): Promise<CaseSummary | null> {
    const row = await this.db.cases.get(caseId);
    if (row === undefined) {
      return null;
    }
    const record = readStored('case', caseId, () => readCaseRow(row, caseId));
    const [cardCount, connectionCount] = await Promise.all([
      this.db.cards.where('caseId').equals(caseId).count(),
      this.db.connections.where('caseId').equals(caseId).count(),
    ]);
    return buildSummary(record, cardCount, connectionCount);
  }

  async listCaseSummaries(): Promise<CaseSummary[]> {
    const [caseRows, cardRows, connectionRows] = await Promise.all([
      this.db.cases.toArray(),
      this.db.cards.toArray(),
      this.db.connections.toArray(),
    ]);
    const cardCounts = countByCase(cardRows);
    const connectionCounts = countByCase(connectionRows);

    return caseRows
      .map((row) => readStored('case', row.id, () => readCaseRow(row, row.id)))
      .map((record) =>
        buildSummary(record, cardCounts.get(record.id) ?? 0, connectionCounts.get(record.id) ?? 0),
      )
      .sort(compareCaseSummaries);
  }

  async updateCase(caseId: string, patch: CasePatch): Promise<CaseRecord> {
    return this.db.transaction('rw', this.db.cases, async () => {
      const row = await this.db.cases.get(caseId);
      if (row === undefined) {
        throw new RecordNotFoundError('case', caseId);
      }
      const current = readStored('case', caseId, () => readCaseRow(row, caseId));
      const updated = mergeCaseRecord(current, patch, this.clock);
      await this.db.cases.put(toCaseRow(updated));
      return updated;
    });
  }

  async saveViewport(caseId: string, viewport: Viewport): Promise<CaseRecord> {
    const parsedViewport = parseViewport(viewport);

    return this.db.transaction('rw', this.db.cases, async () => {
      const row = await this.db.cases.get(caseId);
      if (row === undefined) {
        throw new RecordNotFoundError('case', caseId);
      }
      const current = readStored('case', caseId, () => readCaseRow(row, caseId));
      // Panning is not a content edit: keep updatedAt so the shelf order does
      // not churn every time the board is opened or zoomed.
      const updated = parseCaseRecord({ ...current, viewport: parsedViewport });
      await this.db.cases.put(toCaseRow(updated));
      return updated;
    });
  }

  async createCard(input: CardCreateInput): Promise<CardRecord> {
    const record = buildCardRecord(input, this.idFactory(), nowIso(this.clock));

    await this.db.transaction('rw', this.db.cases, this.db.cards, async () => {
      const caseRow = await this.db.cases.get(record.caseId);
      if (caseRow === undefined) {
        throw new RecordNotFoundError('case', record.caseId);
      }
      const currentCase = readStored('case', record.caseId, () =>
        readCaseRow(caseRow, record.caseId),
      );

      await this.db.cards.add(toCardRow(record));
      await saveTouchedCase(this.db, currentCase, this.clock);
    });

    return record;
  }

  /**
   * One transaction covers cases, cards, and attachments: a failed Blob write
   * cannot leave a card or a touched case behind.
   */
  async createCardWithAttachments(
    input: CardCreateInput,
    attachments: readonly NewAttachment[],
  ): Promise<CardWithAttachments> {
    const card = buildCardRecord(input, this.idFactory(), nowIso(this.clock));
    const attachmentRecords = attachments.map((attachment) =>
      buildAttachmentRecord(card.id, attachment, this.idFactory),
    );
    assertDistinctAttachmentKinds(attachmentRecords);

    await this.db.transaction('rw', this.db.cases, this.db.cards, this.db.attachments, async () => {
      const caseRow = await this.db.cases.get(card.caseId);
      if (caseRow === undefined) {
        throw new RecordNotFoundError('case', card.caseId);
      }
      const currentCase = readStored('case', card.caseId, () => readCaseRow(caseRow, card.caseId));

      await this.db.cards.add(toCardRow(card));
      if (attachmentRecords.length > 0) {
        await this.db.attachments.bulkAdd(attachmentRecords.map(toAttachmentRow));
      }
      await saveTouchedCase(this.db, currentCase, this.clock);
    });

    return { card, attachments: attachmentRecords };
  }

  async getCard(cardId: string): Promise<CardRecord | null> {
    const row = await this.db.cards.get(cardId);
    if (row === undefined) {
      return null;
    }
    return readStored('card', cardId, () => fromCardRow(row));
  }

  async listCards(caseId: string): Promise<CardRecord[]> {
    const rows = await this.db.cards.where('caseId').equals(caseId).toArray();
    return rows.map((row) => readStored('card', row.id, () => fromCardRow(row))).sort(compareCards);
  }

  async updateCard(cardId: string, patch: CardPatch): Promise<CardRecord> {
    return this.db.transaction('rw', this.db.cases, this.db.cards, async () => {
      const row = await this.db.cards.get(cardId);
      if (row === undefined) {
        throw new RecordNotFoundError('card', cardId);
      }
      const current = readStored('card', cardId, () => fromCardRow(row));

      const caseRow = await this.db.cases.get(current.caseId);
      if (caseRow === undefined) {
        throw new RecordNotFoundError('case', current.caseId);
      }
      const currentCase = readStored('case', current.caseId, () =>
        readCaseRow(caseRow, current.caseId),
      );

      const updated = mergeCardRecord(current, patch, this.clock);
      await this.db.cards.put(toCardRow(updated));
      await saveTouchedCase(this.db, currentCase, this.clock);
      return updated;
    });
  }

  async deleteCard(cardId: string): Promise<boolean> {
    return this.db.transaction(
      'rw',
      this.db.cases,
      this.db.cards,
      this.db.connections,
      this.db.attachments,
      async () => {
        const row = await this.db.cards.get(cardId);
        if (row === undefined) {
          return false;
        }
        const card = readStored('card', cardId, () => fromCardRow(row));

        const caseRow = await this.db.cases.get(card.caseId);
        if (caseRow === undefined) {
          throw new RecordNotFoundError('case', card.caseId);
        }
        const currentCase = readStored('case', card.caseId, () =>
          readCaseRow(caseRow, card.caseId),
        );

        const [fromConnections, toConnections] = await Promise.all([
          this.db.connections.where('fromCardId').equals(cardId).toArray(),
          this.db.connections.where('toCardId').equals(cardId).toArray(),
        ]);
        const connectionIds = new Set(
          [...fromConnections, ...toConnections].map((connection) => connection.id),
        );
        if (connectionIds.size > 0) {
          await this.db.connections.bulkDelete([...connectionIds]);
        }

        await this.db.attachments.where('cardId').equals(cardId).delete();
        await this.db.cards.delete(cardId);
        await saveTouchedCase(this.db, currentCase, this.clock);
        return true;
      },
    );
  }

  async getCaseDeletionPreview(caseId: string): Promise<CaseDeletionPreview | null> {
    return readCaseDeletionPreview(this.db, caseId);
  }

  async deleteCase(caseId: string): Promise<boolean> {
    return deleteCaseTransaction(this.db, caseId);
  }
}

export type InMemoryCaseSeed = {
  readonly cases?: readonly CaseRecord[];
  readonly cards?: readonly CardRecord[];
  readonly connections?: readonly ConnectionRecord[];
  readonly attachments?: readonly AttachmentRecord[];
};

export type InMemoryCaseRepositoryOptions = CaseRepositoryOptions & {
  readonly seed?: InMemoryCaseSeed;
};

/**
 * In-memory implementation of the same contract for unit and component tests.
 *
 * It keeps validation and timestamps identical to the Dexie path but makes no
 * claim to prove transaction behaviour; data tests use fake-indexeddb.
 */
export class InMemoryCaseRepository implements CaseRepositoryPort {
  private readonly cases = new Map<string, CaseRecord>();
  private readonly cards = new Map<string, CardRecord>();
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly attachments = new Map<string, AttachmentRecord>();
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(options: InMemoryCaseRepositoryOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.idFactory = options.idFactory ?? createId;

    for (const record of options.seed?.cases ?? []) {
      const parsed = parseCaseRecord(record);
      this.cases.set(parsed.id, parsed);
    }
    for (const record of options.seed?.cards ?? []) {
      const parsed = parseCardRecord(record);
      if (!this.cases.has(parsed.caseId)) {
        throw new RecordNotFoundError('case', parsed.caseId);
      }
      this.cards.set(parsed.id, parsed);
    }
    for (const record of options.seed?.connections ?? []) {
      const parsed = parseConnectionRecord(record);
      if (!this.cases.has(parsed.caseId)) {
        throw new RecordNotFoundError('case', parsed.caseId);
      }
      if (!this.cards.has(parsed.fromCardId) || !this.cards.has(parsed.toCardId)) {
        throw new RecordNotFoundError(
          'card',
          this.cards.has(parsed.fromCardId) ? parsed.toCardId : parsed.fromCardId,
        );
      }
      this.connections.set(parsed.id, parsed);
    }
    for (const record of options.seed?.attachments ?? []) {
      const parsed = parseAttachmentRecord(record);
      const card = this.cards.get(parsed.cardId);
      if (card === undefined) {
        throw new RecordNotFoundError('card', parsed.cardId);
      }
      this.attachments.set(parsed.id, parsed);
    }
  }

  async createCase(input: CaseCreateInput): Promise<CaseRecord> {
    const record = buildCaseRecord(input, this.idFactory(), nowIso(this.clock));
    this.cases.set(record.id, record);
    return record;
  }

  async getCase(caseId: string): Promise<CaseRecord | null> {
    return this.cases.get(caseId) ?? null;
  }

  async getCaseSummary(caseId: string): Promise<CaseSummary | null> {
    const record = this.cases.get(caseId);
    if (record === undefined) {
      return null;
    }
    const cardCount = [...this.cards.values()].filter((card) => card.caseId === caseId).length;
    const connectionCount = [...this.connections.values()].filter(
      (connection) => connection.caseId === caseId,
    ).length;
    return buildSummary(record, cardCount, connectionCount);
  }

  async listCaseSummaries(): Promise<CaseSummary[]> {
    const summaries = await Promise.all(
      [...this.cases.values()].map((record) => this.getCaseSummary(record.id)),
    );
    return summaries
      .filter((summary): summary is CaseSummary => summary !== null)
      .sort(compareCaseSummaries);
  }

  async updateCase(caseId: string, patch: CasePatch): Promise<CaseRecord> {
    const current = this.requireCase(caseId);
    const updated = mergeCaseRecord(current, patch, this.clock);
    this.cases.set(caseId, updated);
    return updated;
  }

  async saveViewport(caseId: string, viewport: Viewport): Promise<CaseRecord> {
    const current = this.requireCase(caseId);
    const updated = parseCaseRecord({ ...current, viewport: parseViewport(viewport) });
    this.cases.set(caseId, updated);
    return updated;
  }

  async createCard(input: CardCreateInput): Promise<CardRecord> {
    this.requireCase(input.caseId);
    const record = buildCardRecord(input, this.idFactory(), nowIso(this.clock));
    this.cards.set(record.id, record);
    this.cases.set(record.caseId, markCaseUpdated(this.requireCase(record.caseId), this.clock));
    return record;
  }

  /**
   * Mirrors the Dexie atomic contract for tests. The fake applies the mutations
   * in memory and is not itself a transaction proof.
   */
  async createCardWithAttachments(
    input: CardCreateInput,
    attachments: readonly NewAttachment[],
  ): Promise<CardWithAttachments> {
    this.requireCase(input.caseId);
    const card = buildCardRecord(input, this.idFactory(), nowIso(this.clock));
    const records = attachments.map((attachment) =>
      buildAttachmentRecord(card.id, attachment, this.idFactory),
    );
    assertDistinctAttachmentKinds(records);

    this.cards.set(card.id, card);
    for (const record of records) {
      this.attachments.set(record.id, record);
    }
    this.cases.set(card.caseId, markCaseUpdated(this.requireCase(card.caseId), this.clock));
    return { card, attachments: records };
  }

  async getCard(cardId: string): Promise<CardRecord | null> {
    return this.cards.get(cardId) ?? null;
  }

  async listCards(caseId: string): Promise<CardRecord[]> {
    return [...this.cards.values()].filter((card) => card.caseId === caseId).sort(compareCards);
  }

  /** Test convenience: inspect seeded Blob rows without opening IndexedDB. */
  async listAttachments(cardId: string): Promise<AttachmentRecord[]> {
    return [...this.attachments.values()]
      .filter((attachment) => attachment.cardId === cardId)
      .sort((a, b) => {
        const byKind = ATTACHMENT_KINDS.indexOf(a.kind) - ATTACHMENT_KINDS.indexOf(b.kind);
        return byKind !== 0 ? byKind : a.id.localeCompare(b.id);
      });
  }

  /** Test convenience: read one seeded Blob by attachment ID. */
  async getAttachment(attachmentId: string): Promise<AttachmentRecord | null> {
    return this.attachments.get(attachmentId) ?? null;
  }

  async updateCard(cardId: string, patch: CardPatch): Promise<CardRecord> {
    const current = this.requireCard(cardId);
    const updated = mergeCardRecord(current, patch, this.clock);
    this.cards.set(cardId, updated);
    this.cases.set(updated.caseId, markCaseUpdated(this.requireCase(updated.caseId), this.clock));
    return updated;
  }

  async deleteCard(cardId: string): Promise<boolean> {
    const card = this.cards.get(cardId);
    if (card === undefined) {
      return false;
    }

    for (const connection of [...this.connections.values()]) {
      if (connection.fromCardId === cardId || connection.toCardId === cardId) {
        this.connections.delete(connection.id);
      }
    }
    for (const attachment of [...this.attachments.values()]) {
      if (attachment.cardId === cardId) {
        this.attachments.delete(attachment.id);
      }
    }
    this.cards.delete(cardId);
    this.cases.set(card.caseId, markCaseUpdated(this.requireCase(card.caseId), this.clock));
    return true;
  }

  async getCaseDeletionPreview(caseId: string): Promise<CaseDeletionPreview | null> {
    const record = this.cases.get(caseId);
    if (record === undefined) {
      return null;
    }

    return {
      caseId,
      title: record.title,
      ...this.countDependents(caseId),
    };
  }

  async deleteCase(caseId: string): Promise<boolean> {
    const record = this.cases.get(caseId);
    if (record === undefined) {
      return false;
    }

    const cardIds = new Set(
      [...this.cards.values()].filter((card) => card.caseId === caseId).map((card) => card.id),
    );

    for (const [connectionId, connection] of [...this.connections]) {
      if (
        connection.caseId === caseId ||
        cardIds.has(connection.fromCardId) ||
        cardIds.has(connection.toCardId)
      ) {
        this.connections.delete(connectionId);
      }
    }

    for (const [attachmentId, attachment] of [...this.attachments]) {
      if (cardIds.has(attachment.cardId)) {
        this.attachments.delete(attachmentId);
      }
    }

    for (const cardId of cardIds) {
      this.cards.delete(cardId);
    }
    this.cases.delete(caseId);
    return true;
  }

  /**
   * The in-memory fake has no transaction guarantee; it mirrors the row
   * selection of the Dexie cascade so component tests see the same counts.
   */
  private countDependents(caseId: string): CaseDeletionCounts {
    const cards = [...this.cards.values()].filter((card) => card.caseId === caseId);
    const cardIds = new Set(cards.map((card) => card.id));
    const connections = [...this.connections.values()].filter(
      (connection) =>
        connection.caseId === caseId ||
        cardIds.has(connection.fromCardId) ||
        cardIds.has(connection.toCardId),
    );
    const attachments = [...this.attachments.values()].filter((attachment) =>
      cardIds.has(attachment.cardId),
    );

    return {
      cardCount: cards.length,
      connectionCount: connections.length,
      imageCount: new Set(attachments.map((attachment) => attachment.cardId)).size,
    };
  }

  private requireCase(caseId: string): CaseRecord {
    const record = this.cases.get(caseId);
    if (record === undefined) {
      throw new RecordNotFoundError('case', caseId);
    }
    return record;
  }

  private requireCard(cardId: string): CardRecord {
    const record = this.cards.get(cardId);
    if (record === undefined) {
      throw new RecordNotFoundError('card', cardId);
    }
    return record;
  }
}
