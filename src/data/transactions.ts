import type { Clock } from '../domain/ids';
import { nowIso } from '../domain/ids';
import type { CaseRecord } from '../domain/model';
import { parseCaseRecord } from '../domain/validation';

import type { NotesDetectiveDatabase } from './db';
import { RecordNotFoundError, readStored } from './errors';
import { toCaseRow } from './mappers';

/**
 * Keep `updatedAt` monotonic even if an injected clock is fixed or moves
 * backwards. The domain schema rejects an update that predates creation, so a
 * test clock must never be able to produce an unpersistable case.
 */
export function latestTimestamp(candidate: string, previous: string): string {
  return Date.parse(candidate) < Date.parse(previous) ? previous : candidate;
}

export function markCaseUpdated(record: CaseRecord, clock: Clock): CaseRecord {
  return parseCaseRecord({
    ...record,
    updatedAt: latestTimestamp(nowIso(clock), record.updatedAt),
  });
}

/** Validate a case row loaded inside a transaction. */
export function readCaseRow(row: unknown, caseId: string): CaseRecord {
  return readStored('case', caseId, () => parseCaseRecord(row));
}

/** Persist a case whose graph content changed, bumping only `updatedAt`. */
export async function saveTouchedCase(
  db: NotesDetectiveDatabase,
  current: CaseRecord,
  clock: Clock,
): Promise<CaseRecord> {
  const updated = markCaseUpdated(current, clock);
  await db.cases.put(toCaseRow(updated));
  return updated;
}

/**
 * Bump a case's `updatedAt` after a card or attachment mutation. Must run
 * inside the caller's read-write transaction.
 */
export async function touchCase(
  db: NotesDetectiveDatabase,
  caseId: string,
  clock: Clock,
): Promise<CaseRecord> {
  const row = await db.cases.get(caseId);
  if (row === undefined) {
    throw new RecordNotFoundError('case', caseId);
  }
  return saveTouchedCase(db, readCaseRow(row, caseId), clock);
}
