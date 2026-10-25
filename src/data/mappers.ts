import type { AttachmentRecord, CardRecord, CaseRecord, ConnectionRecord } from '../domain/model';
import {
  parseAttachmentRecord,
  parseCardRecord,
  parseCaseRecord,
  parseConnectionRecord,
} from '../domain/validation';

import type { AttachmentRow, CardRow, CaseRow, ConnectionRow } from './db';

/**
 * Mappers between IndexedDB rows and domain records.
 *
 * The v1 physical shape matches the domain shape, but every crossing goes
 * through a strict Zod parse. That gives the repository one place to reject a
 * stale, hand-edited, or partially migrated row before it reaches React or the
 * board, and it keeps a future row-shape change out of the repository code.
 */

export function toCaseRow(record: CaseRecord): CaseRow {
  return parseCaseRecord(record);
}

export function fromCaseRow(row: unknown): CaseRecord {
  return parseCaseRecord(row);
}

export function toCardRow(record: CardRecord): CardRow {
  return parseCardRecord(record);
}

export function fromCardRow(row: unknown): CardRecord {
  return parseCardRecord(row);
}

export function toConnectionRow(record: ConnectionRecord): ConnectionRow {
  return parseConnectionRecord(record);
}

export function fromConnectionRow(row: unknown): ConnectionRecord {
  return parseConnectionRecord(row);
}

export function toAttachmentRow(record: AttachmentRecord): AttachmentRow {
  return parseAttachmentRecord(record);
}

export function fromAttachmentRow(row: unknown): AttachmentRecord {
  return parseAttachmentRecord(row);
}
