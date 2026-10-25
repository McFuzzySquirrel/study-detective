import Dexie, { type EntityTable } from 'dexie';

import type { AttachmentRecord, CardRecord, CaseRecord, ConnectionRecord } from '../domain/model';

/**
 * Version 1 of the local case database.
 *
 * The persisted row shapes are the validated domain records: every field is
 * JSON-safe except the attachment Blob, which IndexedDB stores structurally.
 * Mappers in `mappers.ts` are the only place that translates a raw row.
 */

export const DATABASE_NAME = 'notes-detective';
export const DATABASE_VERSION = 1;

export type CaseRow = CaseRecord;
export type CardRow = CardRecord;
export type ConnectionRow = ConnectionRecord;
export type AttachmentRow = AttachmentRecord;

/**
 * Indexes are chosen from the shelf and board read paths:
 *
 * - cases: newest-first shelf scans and nearest-exam-date sorting.
 * - cards: one case at a time plus the type filter used by the board and search.
 * - connections: one case at a time plus the canonical pair uniqueness rule.
 *   `pairKey` is globally unique because every card id is unique, so `&pairKey`
 *   also protects against a cross-case pair being written twice.
 * - attachments: every Blob for a card and one row per kind.
 */
export class NotesDetectiveDatabase extends Dexie {
  cases!: EntityTable<CaseRow, 'id'>;
  cards!: EntityTable<CardRow, 'id'>;
  connections!: EntityTable<ConnectionRow, 'id'>;
  attachments!: EntityTable<AttachmentRow, 'id'>;

  constructor(name: string = DATABASE_NAME) {
    super(name);

    this.version(DATABASE_VERSION).stores({
      cases: 'id, updatedAt, examDate',
      cards: 'id, caseId, [caseId+type]',
      connections: 'id, caseId, &pairKey, &[caseId+pairKey], fromCardId, toCardId',
      attachments: 'id, cardId, [cardId+kind]',
    });
  }
}

/**
 * Create a database handle without opening it. Callers own the handle so tests
 * can use isolated names and the app can create a single long-lived instance.
 */
export function createNotesDetectiveDatabase(name: string = DATABASE_NAME): NotesDetectiveDatabase {
  return new NotesDetectiveDatabase(name);
}

/** Open a handle and wait for the version upgrade to finish. */
export async function openNotesDetectiveDatabase(
  name: string = DATABASE_NAME,
): Promise<NotesDetectiveDatabase> {
  const db = new NotesDetectiveDatabase(name);
  await db.open();
  return db;
}
