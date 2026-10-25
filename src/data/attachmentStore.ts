import type { Clock, IdFactory } from '../domain/ids';
import { createId, systemClock } from '../domain/ids';
import { ATTACHMENT_KINDS } from '../domain/model';
import type { AttachmentKind, AttachmentMime, AttachmentRecord, CardRecord } from '../domain/model';
import { DomainValidationError, parseAttachmentRecord } from '../domain/validation';

import type { NotesDetectiveDatabase } from './db';
import { RecordNotFoundError, readStored } from './errors';
import { fromAttachmentRow, fromCardRow, toAttachmentRow } from './mappers';
import { touchCase } from './transactions';

/** Validated inputs for one original, display, or thumbnail Blob. */
export type NewAttachment = {
  readonly id?: string;
  readonly kind: AttachmentKind;
  readonly mime: AttachmentMime;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly blob: Blob;
};

export type AttachmentStoreOptions = {
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
};

/**
 * Build and validate an attachment row before it is handed to a transaction.
 * Capture owns the image math, dimensions, and digest; the store owns the
 * schema boundary and the card relationship.
 */
export function buildAttachmentRecord(
  cardId: string,
  input: NewAttachment,
  idFactory: IdFactory = createId,
): AttachmentRecord {
  return parseAttachmentRecord({
    id: input.id ?? idFactory(),
    cardId,
    kind: input.kind,
    mime: input.mime,
    width: input.width,
    height: input.height,
    bytes: input.bytes,
    sha256: input.sha256,
    blob: input.blob,
  });
}

function sortByKind(records: readonly AttachmentRecord[]): AttachmentRecord[] {
  return [...records].sort((a, b) => {
    const kindDifference = ATTACHMENT_KINDS.indexOf(a.kind) - ATTACHMENT_KINDS.indexOf(b.kind);
    return kindDifference !== 0 ? kindDifference : a.id.localeCompare(b.id);
  });
}

/**
 * An image card holds one original, one display, and one thumbnail. Reject a
 * set that repeats a kind before any row reaches IndexedDB.
 */
export function assertDistinctAttachmentKinds(records: readonly AttachmentRecord[]): void {
  const kinds = new Set<AttachmentKind>();
  for (const record of records) {
    if (kinds.has(record.kind)) {
      throw new DomainValidationError(
        `Attachment set contains more than one "${record.kind}" Blob`,
      );
    }
    kinds.add(record.kind);
  }
}

/**
 * The only read/write boundary for attachment Blobs.
 *
 * Every write verifies that the owning card exists in the same transaction, so
 * a Blob can never be stored without a card. Reads validate the stored row just
 * like cards and cases.
 */
export class AttachmentStore {
  private readonly db: NotesDetectiveDatabase;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(db: NotesDetectiveDatabase, options: AttachmentStoreOptions = {}) {
    this.db = db;
    this.clock = options.clock ?? systemClock;
    this.idFactory = options.idFactory ?? createId;
  }

  /** Store one attachment for an existing card in one transaction. */
  async addAttachment(cardId: string, input: NewAttachment): Promise<AttachmentRecord> {
    const [record] = await this.addAttachments(cardId, [input]);
    if (record === undefined) {
      throw new Error('Attachment write produced no record');
    }
    return record;
  }

  /**
   * Store one or more attachment kinds together. All rows commit atomically;
   * if any insert fails the card and every Blob are rolled back.
   */
  async addAttachments(
    cardId: string,
    inputs: readonly NewAttachment[],
  ): Promise<AttachmentRecord[]> {
    const records = inputs.map((input) => buildAttachmentRecord(cardId, input, this.idFactory));
    assertDistinctAttachmentKinds(records);

    if (records.length === 0) {
      return [];
    }

    await this.db.transaction('rw', this.db.cases, this.db.cards, this.db.attachments, async () => {
      const cardRow = await this.db.cards.get(cardId);
      if (cardRow === undefined) {
        throw new RecordNotFoundError('card', cardId);
      }
      const card: CardRecord = readStored('card', cardId, () => fromCardRow(cardRow));

      await this.db.attachments.bulkAdd(records.map(toAttachmentRow));
      await touchCase(this.db, card.caseId, this.clock);
    });

    return records;
  }

  /** Read one attachment, rejecting a malformed stored row. */
  async getAttachment(attachmentId: string): Promise<AttachmentRecord | null> {
    const row = await this.db.attachments.get(attachmentId);
    if (row === undefined) {
      return null;
    }
    return readStored('attachment', attachmentId, () => fromAttachmentRow(row));
  }

  /** Read the attachment of a given kind for a card, if present. */
  async getAttachmentByKind(
    cardId: string,
    kind: AttachmentKind,
  ): Promise<AttachmentRecord | null> {
    const row = await this.db.attachments.where('[cardId+kind]').equals([cardId, kind]).first();
    if (row === undefined) {
      return null;
    }
    return readStored('attachment', row.id, () => fromAttachmentRow(row));
  }

  /** All Blobs for one card in original, display, thumbnail order. */
  async listAttachments(cardId: string): Promise<AttachmentRecord[]> {
    const rows = await this.db.attachments.where('cardId').equals(cardId).toArray();
    return sortByKind(
      rows.map((row) => readStored('attachment', row.id, () => fromAttachmentRow(row))),
    );
  }

  /**
   * Delete one attachment and bump the owning case. Returns false when the row
   * is already gone; an orphan Blob is still removed without inventing a case.
   */
  async deleteAttachment(attachmentId: string): Promise<boolean> {
    return this.db.transaction(
      'rw',
      this.db.cases,
      this.db.cards,
      this.db.attachments,
      async () => {
        const row = await this.db.attachments.get(attachmentId);
        if (row === undefined) {
          return false;
        }
        const attachment = readStored('attachment', attachmentId, () => fromAttachmentRow(row));

        await this.db.attachments.delete(attachmentId);

        const cardRow = await this.db.cards.get(attachment.cardId);
        if (cardRow !== undefined) {
          const card = readStored('card', attachment.cardId, () => fromCardRow(cardRow));
          await touchCase(this.db, card.caseId, this.clock);
        }
        return true;
      },
    );
  }
}
