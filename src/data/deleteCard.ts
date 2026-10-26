import type { AttachmentRecord, CardRecord, ConnectionRecord } from '../domain/model';

import type { CaseRepositoryPort } from './caseRepository';

/**
 * Everything one deleted card needs to come back exactly as it was.
 *
 * The snapshot is deliberately plain data: the card keeps its ID, position,
 * crop, OCR fields, and timestamps; every string and every attachment Blob is
 * retained with its original ID. It is held in memory for the undo window only
 * and is never written to storage as a tombstone.
 */
export type CardDeletionSnapshot = {
  readonly card: CardRecord;
  readonly connections: readonly ConnectionRecord[];
  readonly attachments: readonly AttachmentRecord[];
};

/** The facts a destructive confirmation must name before a card is removed. */
export type CardDeletionPreview = {
  readonly cardId: string;
  readonly caseId: string;
  readonly title: string;
  /** Strings whose endpoint is this card; they are removed by the cascade. */
  readonly stringCount: number;
  /** Blob rows that belong to this card, not distinct photos. */
  readonly attachmentCount: number;
};

function connectionsForCard(
  connections: readonly ConnectionRecord[],
  cardId: string,
): ConnectionRecord[] {
  return connections.filter(
    (connection) => connection.fromCardId === cardId || connection.toCardId === cardId,
  );
}

/**
 * Read the counts for the confirmation without mutating anything. Returns
 * `null` when the card is already gone, so a stale row never opens a prompt
 * that can only fail.
 */
export async function readCardDeletionPreview(
  repository: Pick<CaseRepositoryPort, 'getCard' | 'listConnections' | 'listAttachments'>,
  cardId: string,
): Promise<CardDeletionPreview | null> {
  const card = await repository.getCard(cardId);
  if (card === null) {
    return null;
  }

  const [connections, attachments] = await Promise.all([
    repository.listConnections(card.caseId),
    repository.listAttachments(cardId),
  ]);

  return {
    cardId: card.id,
    caseId: card.caseId,
    title: card.title,
    stringCount: connectionsForCard(connections, cardId).length,
    attachmentCount: attachments.length,
  };
}

/**
 * Delete one card and return the exact snapshot needed to restore it.
 *
 * The cascade itself belongs to the repository: this module only takes the
 * read-before-delete snapshot and asks the owning API to remove the card,
 * its strings, and its attachments in one transaction. A missing card yields
 * `null` rather than a fabricated snapshot.
 */
export async function deleteCard(
  repository: Pick<
    CaseRepositoryPort,
    'getCard' | 'listConnections' | 'listAttachments' | 'deleteCard'
  >,
  cardId: string,
): Promise<CardDeletionSnapshot | null> {
  const card = await repository.getCard(cardId);
  if (card === null) {
    return null;
  }

  const [allConnections, attachments] = await Promise.all([
    repository.listConnections(card.caseId),
    repository.listAttachments(cardId),
  ]);

  const removed = await repository.deleteCard(cardId);
  if (!removed) {
    return null;
  }

  return {
    card,
    connections: connectionsForCard(allConnections, cardId),
    attachments,
  };
}

/**
 * Restore a snapshot through the repository. The owning implementation writes
 * the card, its strings, and its Blobs in one transaction, so a partial card
 * can never appear on the board.
 */
export async function restoreDeletedCard(
  repository: Pick<CaseRepositoryPort, 'restoreCardDeletion'>,
  snapshot: CardDeletionSnapshot,
): Promise<CardRecord> {
  return repository.restoreCardDeletion(snapshot);
}
