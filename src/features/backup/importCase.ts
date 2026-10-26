import type { IdFactory } from '../../domain/ids';
import { createId } from '../../domain/ids';
import { buildPairKey, uuidSchema } from '../../domain/model';
import type {
  AttachmentRecord,
  CardRecord,
  CaseRecord,
  ConnectionRecord,
} from '../../domain/model';
import {
  parseAttachmentRecord,
  parseCardRecord,
  parseCaseRecord,
  parseConnectionRecord,
} from '../../domain/validation';
import type { NotesDetectiveDatabase } from '../../data/db';
import { readStored } from '../../data/errors';
import {
  fromCaseRow,
  toAttachmentRow,
  toCardRow,
  toCaseRow,
  toConnectionRow,
} from '../../data/mappers';

import {
  archiveCardOcrEquals,
  parseCaseArchiveManifest,
  readArchiveCardOcr,
} from './archiveFormat';
import {
  ArchiveImportError,
  summarizeValidatedArchive,
  validateCaseArchive,
} from './importValidation';
import type {
  ArchiveImportFailure,
  CaseArchiveInput,
  CaseArchiveSummary,
  ValidateCaseArchiveOptions,
  ValidatedCaseArchive,
} from './importValidation';

/**
 * Copy or replace restore for a validated `.ndcase` archive.
 *
 * Validation is complete before this module opens a transaction, and the whole
 * restore (case, cards, strings, and attachment Blobs) then commits in one
 * IndexedDB transaction. Copy mode allocates a fresh ID for every entity.
 * Replace mode deletes the named case and writes the archive under that same
 * case ID only after the caller confirms the existing case title.
 */

export type RestoreMode = 'copy' | 'replace';

export type ImportCaseOptions = ValidateCaseArchiveOptions & {
  readonly db: NotesDetectiveDatabase;
  /** Copy is the default; replace must be chosen explicitly. */
  readonly mode?: RestoreMode;
  /** Required in replace mode: the case that will be removed first. */
  readonly replaceCaseId?: string;
  /** Required in replace mode: must match the existing case title. */
  readonly confirmTitle?: string;
  /** Injected for deterministic ID-remapping tests. */
  readonly idFactory?: IdFactory;
};

export type RestoreCaseResult = {
  readonly caseId: string;
  readonly mode: RestoreMode;
  readonly title: string;
  readonly cardCount: number;
  readonly connectionCount: number;
  readonly attachmentCount: number;
  readonly exportedAt: string;
  readonly summary: CaseArchiveSummary;
};

type RestoredRecords = {
  readonly caseRecord: CaseRecord;
  readonly cards: CardRecord[];
  readonly connections: ConnectionRecord[];
  readonly attachments: AttachmentRecord[];
};

type ImportFailureCode = Extract<
  ArchiveImportFailure,
  'replace-not-confirmed' | 'replace-target-missing' | 'id-allocation-failed' | 'write-failed'
>;

function importFailure(failure: ImportFailureCode, message: string, cause?: unknown): never {
  throw new ArchiveImportError('writing', failure, message, cause);
}

function resolveMode(options: ImportCaseOptions): RestoreMode {
  const mode = options.mode ?? 'copy';
  if (mode !== 'copy' && mode !== 'replace') {
    throw new ArchiveImportError('writing', 'write-failed', 'The restore mode is not supported.');
  }
  return mode;
}

function normalizedConfirmation(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read and validate the replace target before touching the transaction. The
 * title comparison is repeated inside the transaction so a concurrent rename
 * cannot slip a replacement past the confirmation.
 */
async function readReplaceTarget(
  db: NotesDetectiveDatabase,
  replaceCaseId: string | undefined,
  confirmTitle: string | undefined,
): Promise<{ readonly caseId: string; readonly title: string }> {
  if (replaceCaseId === undefined || !uuidSchema.safeParse(replaceCaseId).success) {
    importFailure(
      'replace-not-confirmed',
      'Replacing a case requires the existing case id and its title.',
    );
  }
  const confirmedTitle = normalizedConfirmation(confirmTitle);
  if (confirmedTitle === null) {
    importFailure(
      'replace-not-confirmed',
      'Replacing a case requires its title to be typed for confirmation.',
    );
  }

  const row = await db.cases.get(replaceCaseId);
  if (row === undefined) {
    importFailure('replace-target-missing', 'The case chosen for replacement no longer exists.');
  }
  const existing = readStored('case', replaceCaseId, () => fromCaseRow(row));
  if (existing.title !== confirmedTitle) {
    importFailure(
      'replace-not-confirmed',
      'The confirmation does not match the existing case title.',
    );
  }

  return { caseId: replaceCaseId, title: confirmedTitle };
}

function allocateId(idFactory: IdFactory, used: Set<string>, label: string): string {
  const id = idFactory();
  if (!uuidSchema.safeParse(id).success) {
    importFailure('id-allocation-failed', `The restore could not allocate a valid ${label} id.`);
  }
  if (used.has(id)) {
    importFailure('id-allocation-failed', `The restore generated a duplicate ${label} id.`);
  }
  used.add(id);
  return id;
}

function buildRestoredRecords(
  archive: ValidatedCaseArchive,
  caseId: string,
  idFactory: IdFactory,
): RestoredRecords {
  const { manifest } = archive;
  const cardIds = new Map<string, string>();
  const usedCardIds = new Set<string>();
  const usedConnectionIds = new Set<string>();
  const usedAttachmentIds = new Set<string>();

  for (const card of manifest.cards) {
    cardIds.set(card.id, allocateId(idFactory, usedCardIds, 'card'));
  }

  const cardIdFor = (originalCardId: string): string => {
    const mapped = cardIds.get(originalCardId);
    if (mapped === undefined) {
      throw new ArchiveImportError(
        'structure',
        'invalid-manifest',
        'An archive reference points at a card that is not in the manifest.',
      );
    }
    return mapped;
  };

  const caseRecord = parseCaseRecord({ ...manifest.case, id: caseId });

  const cards = manifest.cards.map((card) =>
    parseCardRecord({
      ...card,
      // Reapply the OCR contract explicitly so a future card-field mapping
      // change cannot quietly drop text, confidence, engine, or timestamp.
      ...readArchiveCardOcr(card),
      id: cardIdFor(card.id),
      caseId,
    }),
  );

  manifest.cards.forEach((archivedCard, index) => {
    const restoredCard = cards[index];
    if (restoredCard === undefined || !archiveCardOcrEquals(archivedCard, restoredCard)) {
      throw new ArchiveImportError(
        'structure',
        'invalid-manifest',
        'The restored card did not preserve its OCR metadata.',
      );
    }
  });

  const connections = manifest.connections.map((connection) => {
    const fromCardId = cardIdFor(connection.fromCardId);
    const toCardId = cardIdFor(connection.toCardId);
    return parseConnectionRecord({
      id: allocateId(idFactory, usedConnectionIds, 'connection'),
      caseId,
      fromCardId,
      toCardId,
      // The canonical key depends on the new IDs, never on archive text.
      pairKey: buildPairKey(fromCardId, toCardId),
      type: connection.type,
    });
  });

  const attachments = manifest.attachments.map((attachment) => {
    const blob = archive.images.get(attachment.id);
    if (blob === undefined) {
      throw new ArchiveImportError(
        'integrity',
        'missing-image',
        'An archive image was not verified before the restore.',
      );
    }

    return parseAttachmentRecord({
      id: allocateId(idFactory, usedAttachmentIds, 'attachment'),
      cardId: cardIdFor(attachment.cardId),
      kind: attachment.kind,
      mime: attachment.mime,
      width: attachment.width,
      height: attachment.height,
      bytes: attachment.bytes,
      sha256: attachment.sha256,
      blob,
    });
  });

  return { caseRecord, cards, connections, attachments };
}

/**
 * Re-check the restored graph immediately before the write. The manifest
 * schema already proves this, but a remapping bug must fail before a row is
 * added rather than leave a dangling endpoint in IndexedDB.
 */
function assertRestoredGraph(records: RestoredRecords): void {
  const cardIds = new Set(records.cards.map((card) => card.id));
  const pairKeys = new Set<string>();

  for (const card of records.cards) {
    if (card.caseId !== records.caseRecord.id) {
      throw new ArchiveImportError(
        'structure',
        'invalid-manifest',
        'A restored card does not belong to the restored case.',
      );
    }
  }

  for (const connection of records.connections) {
    if (
      connection.caseId !== records.caseRecord.id ||
      !cardIds.has(connection.fromCardId) ||
      !cardIds.has(connection.toCardId) ||
      pairKeys.has(connection.pairKey)
    ) {
      throw new ArchiveImportError(
        'structure',
        'invalid-manifest',
        'The restored graph contains a dangling or duplicate connection.',
      );
    }
    pairKeys.add(connection.pairKey);
  }

  for (const attachment of records.attachments) {
    if (!cardIds.has(attachment.cardId)) {
      throw new ArchiveImportError(
        'structure',
        'invalid-manifest',
        'A restored image is not attached to a restored card.',
      );
    }
  }
}

type CaseDependents = {
  readonly cardIds: readonly string[];
  readonly connectionIds: readonly string[];
  readonly attachmentIds: readonly string[];
};

/**
 * Select every row owned by a case for the replace cascade. Children are not
 * schema-validated here for the same reason as `deleteCase`: a malformed child
 * must be removable instead of trapping the case forever. The target case row
 * itself is validated by the caller.
 */
async function readCaseDependents(
  db: NotesDetectiveDatabase,
  caseId: string,
): Promise<CaseDependents> {
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
  };
}

/**
 * Restore a `.ndcase` archive.
 *
 * The archive is fully validated (structure, path safety, manifest, versions,
 * checksums, and image presence) before the transaction opens. On any write
 * failure, IndexedDB rolls the whole restore back, including a replace delete.
 */
export async function importCase(
  input: CaseArchiveInput,
  options: ImportCaseOptions,
): Promise<RestoreCaseResult> {
  const validated = await validateCaseArchive(input, {
    ...(options.digest !== undefined ? { digest: options.digest } : {}),
    ...(options.supportedDbSchemaVersions !== undefined
      ? { supportedDbSchemaVersions: options.supportedDbSchemaVersions }
      : {}),
  });

  return restoreValidatedCaseArchive(validated, options);
}

/**
 * Restore an archive already returned by `validateCaseArchive`. Use this only
 * with a result from this module's validation path; the manifest and image
 * presence are re-checked here, but hashing is not repeated.
 */
export async function restoreValidatedCaseArchive(
  archive: ValidatedCaseArchive,
  options: ImportCaseOptions,
): Promise<RestoreCaseResult> {
  const { db } = options;
  const mode = resolveMode(options);
  const idFactory = options.idFactory ?? createId;

  // Re-parse the manifest so a mutated inspection object cannot reach storage.
  const manifest = parseCaseArchiveManifest(archive.manifest);
  for (const attachment of manifest.attachments) {
    if (!archive.images.has(attachment.id)) {
      throw new ArchiveImportError(
        'integrity',
        'missing-image',
        'An archive image was not verified before the restore.',
      );
    }
  }

  let caseId: string;
  let confirmedTitle: string | null = null;
  if (mode === 'replace') {
    const target = await readReplaceTarget(db, options.replaceCaseId, options.confirmTitle);
    caseId = target.caseId;
    confirmedTitle = target.title;
  } else {
    caseId = allocateId(idFactory, new Set<string>(), 'case');
  }

  const records = buildRestoredRecords({ ...archive, manifest }, caseId, idFactory);
  assertRestoredGraph(records);

  try {
    await db.transaction('rw', db.cases, db.cards, db.connections, db.attachments, async () => {
      // Re-run the pure graph check inside the transaction as well as before
      // it. The records are freshly built, but an import boundary must never
      // rely on a single check when a dangling endpoint is the failure mode.
      assertRestoredGraph(records);

      if (mode === 'replace') {
        const replaceCaseId = options.replaceCaseId;
        if (replaceCaseId === undefined) {
          importFailure(
            'replace-not-confirmed',
            'Replacing a case requires the existing case id and its title.',
          );
        }

        const row = await db.cases.get(replaceCaseId);
        if (row === undefined) {
          importFailure(
            'replace-target-missing',
            'The case chosen for replacement no longer exists.',
          );
        }
        const existing = readStored('case', replaceCaseId, () => fromCaseRow(row));
        if (confirmedTitle === null || existing.title !== confirmedTitle) {
          importFailure(
            'replace-not-confirmed',
            'The confirmation does not match the existing case title.',
          );
        }

        const dependents = await readCaseDependents(db, replaceCaseId);
        if (dependents.attachmentIds.length > 0) {
          await db.attachments.bulkDelete([...dependents.attachmentIds]);
        }
        if (dependents.connectionIds.length > 0) {
          await db.connections.bulkDelete([...dependents.connectionIds]);
        }
        if (dependents.cardIds.length > 0) {
          await db.cards.bulkDelete([...dependents.cardIds]);
        }
        await db.cases.delete(replaceCaseId);
      }

      await db.cases.add(toCaseRow(records.caseRecord));
      if (records.cards.length > 0) {
        await db.cards.bulkAdd(records.cards.map(toCardRow));
      }
      if (records.connections.length > 0) {
        await db.connections.bulkAdd(records.connections.map(toConnectionRow));
      }
      // Attachments last: a failure here proves the case, cards, and strings
      // were rolled back too, which is exactly the mid-write failure test.
      if (records.attachments.length > 0) {
        await db.attachments.bulkAdd(records.attachments.map(toAttachmentRow));
      }
    });
  } catch (cause) {
    if (cause instanceof ArchiveImportError) {
      throw cause;
    }
    throw new ArchiveImportError(
      'writing',
      'write-failed',
      'The case could not be restored. The existing data was left unchanged.',
      cause,
    );
  }

  const summary = summarizeValidatedArchive({ ...archive, manifest });

  return {
    caseId,
    mode,
    title: records.caseRecord.title,
    cardCount: records.cards.length,
    connectionCount: records.connections.length,
    attachmentCount: records.attachments.length,
    exportedAt: manifest.exportedAt,
    summary,
  };
}

/** Descriptive alias for callers that already have an archive input. */
export const importCaseArchive = importCase;
