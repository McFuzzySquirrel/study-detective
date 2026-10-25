import type { NotesDetectiveDatabase } from './db';
import { readStored } from './errors';
import { readCaseRow } from './transactions';

/**
 * The exact dependents a confirmation must name before a case is destroyed.
 *
 * An "image" is one card that owns at least one attachment Blob, not one row in
 * the attachment table: a single imported photo is stored as an original, a
 * display copy, and a thumbnail. Counting rows would tell a student that one
 * photo is three images.
 */
export type CaseDeletionCounts = {
  readonly cardCount: number;
  readonly connectionCount: number;
  readonly imageCount: number;
};

/** Everything DeleteCaseDialog needs to name what a deletion would remove. */
export type CaseDeletionPreview = CaseDeletionCounts & {
  readonly caseId: string;
  readonly title: string;
};

type CaseDependents = CaseDeletionCounts & {
  readonly cardIds: readonly string[];
  readonly connectionIds: readonly string[];
  readonly attachmentIds: readonly string[];
};

function countImages(attachments: readonly { readonly cardId: string }[]): number {
  return new Set(attachments.map((attachment) => attachment.cardId)).size;
}

/**
 * Read the dependent rows a case owns. Connections are selected by `caseId`
 * and also by either endpoint, so a corrupt cross-case string that points at a
 * card in this case cannot survive as a dangling endpoint.
 *
 * Counts are taken from the same row set that is deleted, so the confirmation
 * cannot promise one number and remove another. Rows are not schema-validated
 * here: deletion must be able to remove a malformed child instead of trapping
 * the case forever. The owning case row is validated by the callers.
 */
async function readDependents(db: NotesDetectiveDatabase, caseId: string): Promise<CaseDependents> {
  const cardRows = await db.cards.where('caseId').equals(caseId).toArray();
  const cardIds = cardRows.map((row) => row.id);

  const caseConnections = await db.connections.where('caseId').equals(caseId).toArray();
  const endpointConnections =
    cardIds.length === 0
      ? []
      : [
          ...(await db.connections.where('fromCardId').anyOf(cardIds).toArray()),
          ...(await db.connections.where('toCardId').anyOf(cardIds).toArray()),
        ];
  const connectionIds = [
    ...new Set([...caseConnections, ...endpointConnections].map((row) => row.id)),
  ];

  const attachmentRows =
    cardIds.length === 0 ? [] : await db.attachments.where('cardId').anyOf(cardIds).toArray();

  return {
    cardIds,
    connectionIds,
    attachmentIds: attachmentRows.map((row) => row.id),
    cardCount: cardIds.length,
    connectionCount: connectionIds.length,
    imageCount: countImages(attachmentRows),
  };
}

/**
 * Read the counts for the destructive confirmation. Returns `null` when the
 * case is already gone, and rejects a malformed case row rather than showing
 * counts derived from untrusted storage.
 */
export async function readCaseDeletionPreview(
  db: NotesDetectiveDatabase,
  caseId: string,
): Promise<CaseDeletionPreview | null> {
  return db.transaction('r', db.cases, db.cards, db.connections, db.attachments, async () => {
    const caseRow = await db.cases.get(caseId);
    if (caseRow === undefined) {
      return null;
    }

    const record = readStored('case', caseId, () => readCaseRow(caseRow, caseId));
    const dependents = await readDependents(db, caseId);

    return {
      caseId,
      title: record.title,
      cardCount: dependents.cardCount,
      connectionCount: dependents.connectionCount,
      imageCount: dependents.imageCount,
    };
  });
}

/**
 * Delete a case and every dependent row and Blob in one read-write
 * transaction. There is deliberately no undo, tombstone, archive, or partial
 * delete path: a failure rejects and IndexedDB rolls the whole action back.
 *
 * Returns true when rows were removed and false when the case had already
 * disappeared, matching `deleteCard` and `deleteAttachment`.
 */
export async function deleteCase(db: NotesDetectiveDatabase, caseId: string): Promise<boolean> {
  return db.transaction('rw', db.cases, db.cards, db.connections, db.attachments, async () => {
    const caseRow = await db.cases.get(caseId);
    if (caseRow === undefined) {
      return false;
    }

    readStored('case', caseId, () => readCaseRow(caseRow, caseId));

    const dependents = await readDependents(db, caseId);

    // Blobs and children first, then the case. Dexie aborts and rolls back
    // the entire transaction if any of these writes rejects.
    if (dependents.attachmentIds.length > 0) {
      await db.attachments.bulkDelete([...dependents.attachmentIds]);
    }
    if (dependents.connectionIds.length > 0) {
      await db.connections.bulkDelete([...dependents.connectionIds]);
    }
    if (dependents.cardIds.length > 0) {
      await db.cards.bulkDelete([...dependents.cardIds]);
    }
    await db.cases.delete(caseId);

    return true;
  });
}
