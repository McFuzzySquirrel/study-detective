// @vitest-environment node

import 'fake-indexeddb/auto';

import { createHash } from 'node:crypto';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NewAttachment } from '../../src/data/attachmentStore';
import { CaseRepository } from '../../src/data/caseRepository';
import { createNotesDetectiveDatabase } from '../../src/data/db';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { createId, fixedClock } from '../../src/domain/ids';
import { buildPairKey } from '../../src/domain/model';
import type {
  AttachmentMime,
  AttachmentRecord,
  CardRecord,
  CaseRecord,
  ConnectionRecord,
} from '../../src/domain/model';
import { parseConnectionRecord } from '../../src/domain/validation';
import { ARCHIVE_MANIFEST_PATH } from '../../src/features/backup/archiveFormat';
import { buildCaseArchive } from '../../src/features/backup/exportCase';
import type { CaseArchive } from '../../src/features/backup/exportCase';
import {
  importCase,
  importCaseArchive,
  restoreValidatedCaseArchive,
} from '../../src/features/backup/importCase';
import type { ImportCaseOptions, RestoreCaseResult } from '../../src/features/backup/importCase';
import {
  ArchiveImportError,
  MAX_IMPORT_ENTRIES,
  inspectCaseArchive,
  summarizeValidatedArchive,
  validateCaseArchive,
} from '../../src/features/backup/importValidation';
import { advancingClock, closeTestDatabase } from '../data/testDatabase';

const EXPORT_INSTANT = '2026-06-12T09:30:00.000Z';
const EOCD_SIGNATURE = 0x06054b50;

type JsonObject = Record<string, unknown>;

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function attachment(
  kind: NewAttachment['kind'],
  mime: AttachmentMime,
  content: string,
): NewAttachment {
  const blob = new Blob([content], { type: mime });
  return {
    kind,
    mime,
    width: 640,
    height: 480,
    bytes: blob.size,
    sha256: sha256(content),
    blob,
  };
}

function attachmentSet(prefix: string): NewAttachment[] {
  return [
    attachment('original', 'image/png', `${prefix}-original`),
    attachment('display', 'image/jpeg', `${prefix}-display`),
    attachment('thumbnail', 'image/webp', `${prefix}-thumbnail`),
  ];
}

let db: NotesDetectiveDatabase;
let repository: CaseRepository;
let archive: CaseArchive;
let caseRecord: CaseRecord;
let sourceCard: CardRecord;
let noteCard: CardRecord;
let topicCard: CardRecord;
let sourceAttachments: AttachmentRecord[];

async function addConnection(
  from: CardRecord,
  to: CardRecord,
  type: ConnectionRecord['type'],
): Promise<ConnectionRecord> {
  const connection = parseConnectionRecord({
    id: createId(),
    caseId: from.caseId,
    fromCardId: from.id,
    toCardId: to.id,
    pairKey: buildPairKey(from.id, to.id),
    type,
  });
  await db.connections.add(connection);
  return connection;
}

function readEntries(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function readManifestObject(entries: Record<string, Uint8Array>): JsonObject {
  const bytes = entries[ARCHIVE_MANIFEST_PATH];
  if (bytes === undefined) {
    throw new Error('The fixture archive has no manifest');
  }
  return JSON.parse(strFromU8(bytes)) as JsonObject;
}

function manifestObjects(manifest: JsonObject, key: string): JsonObject[] {
  const value = manifest[key];
  if (!Array.isArray(value)) {
    throw new Error(`The fixture manifest has no "${key}" array`);
  }
  return value as JsonObject[];
}

function mutateArchive(
  bytes: Uint8Array,
  mutate: (entries: Record<string, Uint8Array>, manifest: JsonObject) => void,
): Uint8Array {
  const entries = readEntries(bytes);
  const manifest = readManifestObject(entries);
  mutate(entries, manifest);
  entries[ARCHIVE_MANIFEST_PATH] = strToU8(JSON.stringify(manifest));
  return zipSync(entries);
}

function withExtraEntry(bytes: Uint8Array, name: string, content = 'extra'): Uint8Array {
  const entries = readEntries(bytes);
  entries[name] = strToU8(content);
  return zipSync(entries);
}

function withoutEntry(bytes: Uint8Array, name: string): Uint8Array {
  const entries = readEntries(bytes);
  delete entries[name];
  return zipSync(entries);
}

function extraImagePath(index: number): string {
  const suffix = index.toString(16).padStart(12, '0');
  return `images/90000000-0000-4000-8000-${suffix}.png`;
}

/**
 * Rename one entry to an existing entry's name in both the local header and
 * the central directory. fflate's object API cannot create duplicates, so a
 * real duplicate-name ZIP is produced by patching equal-length name bytes.
 */
function duplicateEntryName(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const source = strToU8(from);
  const target = strToU8(to);
  if (source.length !== target.length) {
    throw new Error('Duplicate-name fixture requires equal-length entry names');
  }

  const copy = new Uint8Array(bytes);
  let replacements = 0;
  for (let index = 0; index <= copy.length - source.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < source.length; offset += 1) {
      if (copy[index + offset] !== source[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      copy.set(target, index);
      index += source.length - 1;
      replacements += 1;
    }
  }

  if (replacements < 2) {
    throw new Error(`Expected local and central entry names, found ${replacements}`);
  }
  return copy;
}

function findCentralDirectoryOffset(view: DataView): { offset: number; count: number } {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return {
        offset: view.getUint32(offset + 16, true),
        count: view.getUint16(offset + 10, true),
      };
    }
  }
  throw new Error('The fixture archive has no end-of-central-directory record');
}

/** Patch a declared uncompressed size without allocating the claimed bytes. */
function setDeclaredEntrySize(bytes: Uint8Array, name: string, size: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directory = findCentralDirectoryOffset(view);
  const copy = new Uint8Array(bytes);
  const copyView = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  let cursor = directory.offset;

  for (let index = 0; index < directory.count; index += 1) {
    const nameLength = copyView.getUint16(cursor + 28, true);
    const extraLength = copyView.getUint16(cursor + 30, true);
    const commentLength = copyView.getUint16(cursor + 32, true);
    const entryName = new TextDecoder().decode(
      copy.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    if (entryName === name) {
      copyView.setUint32(cursor + 24, size, true);
      return copy;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`The fixture archive has no entry "${name}"`);
}

type TableCounts = {
  cases: number;
  cards: number;
  connections: number;
  attachments: number;
};

async function tableCounts(): Promise<TableCounts> {
  return {
    cases: await db.cases.count(),
    cards: await db.cards.count(),
    connections: await db.connections.count(),
    attachments: await db.attachments.count(),
  };
}

type CaseSnapshot = {
  case: JsonObject | null;
  cards: JsonObject[];
  connections: JsonObject[];
  attachments: JsonObject[];
};

/**
 * A Blob-free projection of a case's rows, so rollback assertions compare the
 * durable metadata rather than relying on cross-environment Blob equality.
 */
async function snapshotCase(caseId: string): Promise<CaseSnapshot> {
  const caseRow = await db.cases.get(caseId);
  const cards = await db.cards.where('caseId').equals(caseId).toArray();
  const connections = await db.connections.where('caseId').equals(caseId).toArray();
  const attachments =
    cards.length === 0
      ? []
      : await db.attachments
          .where('cardId')
          .anyOf(cards.map((card) => card.id))
          .toArray();

  return {
    case: caseRow === undefined ? null : { ...caseRow },
    cards: cards.map((card) => ({ ...card })),
    connections: connections.map((connection) => ({ ...connection })),
    attachments: attachments.map((record) => ({
      id: record.id,
      cardId: record.cardId,
      kind: record.kind,
      mime: record.mime,
      width: record.width,
      height: record.height,
      bytes: record.bytes,
      sha256: record.sha256,
      blobSize: record.blob.size,
    })),
  };
}

async function importFailureOf(
  input: Uint8Array | Blob,
  options: Omit<ImportCaseOptions, 'db'> = {},
): Promise<ArchiveImportError> {
  try {
    await importCase(input, { db, ...options });
  } catch (error) {
    if (error instanceof ArchiveImportError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the archive import to be rejected');
}

async function expectRejectedWithoutWrite(
  input: Uint8Array | Blob,
  failure: ArchiveImportError['failure'],
  options: Omit<ImportCaseOptions, 'db'> = {},
): Promise<ArchiveImportError> {
  const before = await tableCounts();
  const error = await importFailureOf(input, options);
  expect(error.failure).toBe(failure);
  expect(await tableCounts()).toEqual(before);
  return error;
}

function recordByTitle<T extends { readonly title: string }>(
  records: readonly T[],
  title: string,
): T {
  const record = records.find((candidate) => candidate.title === title);
  if (record === undefined) {
    throw new Error(`Expected a record titled "${title}"`);
  }
  return record;
}

async function expectNoOrphans(): Promise<void> {
  const caseIds = new Set((await db.cases.toArray()).map((record) => record.id));
  const cards = await db.cards.toArray();
  const cardIds = new Set(cards.map((card) => card.id));

  for (const card of cards) {
    expect(caseIds.has(card.caseId)).toBe(true);
  }
  for (const connection of await db.connections.toArray()) {
    expect(caseIds.has(connection.caseId)).toBe(true);
    expect(cardIds.has(connection.fromCardId)).toBe(true);
    expect(cardIds.has(connection.toCardId)).toBe(true);
  }
  for (const record of await db.attachments.toArray()) {
    expect(cardIds.has(record.cardId)).toBe(true);
  }
}

beforeEach(async () => {
  db = createNotesDetectiveDatabase(`notes-detective-import-${createId()}`);
  await db.open();
  repository = new CaseRepository(db, {
    clock: advancingClock('2026-06-01T08:00:00.000Z'),
  });

  const createdCase = await repository.createCase({
    title: 'Cell Biology: Final Review!',
    subject: 'Biology',
    examDate: '2026-06-15',
    viewport: { x: -120, y: 64, scale: 1.75 },
    closedAt: '2026-06-10T10:00:00.000Z',
    isDemo: true,
    backupPromptedAt: '2026-06-11T08:00:00.000Z',
  });

  const sourceResult = await repository.createCardWithAttachments(
    {
      caseId: createdCase.id,
      type: 'source',
      title: 'Lecture 7 handout',
      position: { x: 40, y: 80 },
      tags: ['biology', 'lecture-7'],
    },
    attachmentSet('source'),
  );
  sourceCard = sourceResult.card;
  sourceAttachments = sourceResult.attachments;

  noteCard = await repository.createCard({
    caseId: createdCase.id,
    type: 'note',
    title: 'Mitochondria are the powerhouse',
    position: { x: 320, y: 260 },
    tags: ['mitochondria', 'exam'],
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    rotation: 90,
    retainFullResolution: true,
    ocrText: 'The mitochondria is the powerhouse of the cell.',
    ocrConfidence: 92.5,
    ocrEngineVersion: 'tesseract-5.0.0',
    ocrUpdatedAt: '2026-06-05T12:00:00.000Z',
  });

  topicCard = await repository.createCard({
    caseId: createdCase.id,
    type: 'topic',
    title: 'Cellular respiration',
    position: { x: 120, y: 520 },
    tags: ['respiration'],
  });

  await addConnection(noteCard, sourceCard, 'provenance');
  await addConnection(noteCard, topicCard, 'association');

  const finalCase = await repository.getCase(createdCase.id);
  if (finalCase === null) {
    throw new Error('Expected the fixture case to exist');
  }
  caseRecord = finalCase;

  archive = await buildCaseArchive({
    caseId: caseRecord.id,
    repository,
    clock: fixedClock(EXPORT_INSTANT),
  });
});

afterEach(async () => {
  await closeTestDatabase(db);
});

describe('archive import validation', () => {
  it('round-trips an animated GIF attachment through its archive entry', async () => {
    const result = await repository.createCardWithAttachments(
      {
        caseId: caseRecord.id,
        type: 'source',
        title: 'Animated source',
        position: { x: 520, y: 80 },
      },
      [attachment('original', 'image/gif', 'GIF89a-animation-bytes')],
    );
    const gifAttachment = result.attachments[0];
    if (gifAttachment === undefined) {
      throw new Error('Expected the GIF attachment to be stored');
    }

    const gifArchive = await buildCaseArchive({
      caseId: caseRecord.id,
      repository,
      clock: fixedClock(EXPORT_INSTANT),
    });
    const validated = await validateCaseArchive(gifArchive.bytes);

    expect(validated.manifest.attachments).toContainEqual(
      expect.objectContaining({ id: gifAttachment.id, mime: 'image/gif' }),
    );
    expect(validated.images.get(gifAttachment.id)).toMatchObject({
      type: 'image/gif',
      size: gifAttachment.bytes,
    });
  });

  it('validates a real exported archive and exposes a preview summary', async () => {
    const validated = await validateCaseArchive(archive.bytes);

    expect(validated.manifest.case).toEqual(caseRecord);
    expect(validated.manifest.cards).toHaveLength(3);
    expect(validated.manifest.connections).toHaveLength(2);
    expect(validated.manifest.attachments).toHaveLength(3);
    expect(validated.entryCount).toBe(4);
    expect(validated.images.size).toBe(3);
    expect(validated.images.has(sourceAttachments[0]?.id ?? '')).toBe(true);

    const summary = summarizeValidatedArchive(validated);
    expect(summary).toMatchObject({
      caseId: caseRecord.id,
      title: 'Cell Biology: Final Review!',
      cardCount: 3,
      connectionCount: 2,
      imageCount: 1,
      attachmentCount: 3,
      exportedAt: EXPORT_INSTANT,
    });
    expect(summary.imageBytes).toBe(
      sourceAttachments.reduce((sum, record) => sum + record.bytes, 0),
    );

    const inspection = await inspectCaseArchive(archive.bytes);
    expect(inspection.summary).toEqual(summary);
    expect(inspection.archive.images.size).toBe(3);
  });

  it('accepts the archive as a Blob from a file input', async () => {
    const blob = new Blob([new Uint8Array(archive.bytes)], { type: 'application/zip' });
    const validated = await validateCaseArchive(blob);
    expect(validated.manifest.case.id).toBe(caseRecord.id);
  });

  it('accepts an ArrayBuffer input', async () => {
    const buffer = new Uint8Array(archive.bytes).buffer;
    const validated = await validateCaseArchive(buffer);
    expect(validated.manifest.case.id).toBe(caseRecord.id);
  });

  it('rejects an attachment byte count that disagrees with the image', async () => {
    const mismatched = mutateArchive(archive.bytes, (_entries, manifest) => {
      const first = manifestObjects(manifest, 'attachments')[0];
      if (first === undefined) {
        throw new Error('Expected a fixture attachment');
      }
      first.bytes = (first.bytes as number) + 1;
    });
    await expectRejectedWithoutWrite(mismatched, 'size-mismatch');
  });

  it('rejects a file that is not a ZIP archive', async () => {
    await expectRejectedWithoutWrite(new Uint8Array([1, 2, 3, 4]), 'invalid-zip');
  });

  it('rejects an archive with no manifest.json', async () => {
    await expectRejectedWithoutWrite(
      withoutEntry(archive.bytes, ARCHIVE_MANIFEST_PATH),
      'missing-manifest',
    );
  });

  it('rejects a manifest that is not valid JSON', async () => {
    const entries = readEntries(archive.bytes);
    entries[ARCHIVE_MANIFEST_PATH] = strToU8('{"format":');
    await expectRejectedWithoutWrite(zipSync(entries), 'invalid-manifest');
  });

  it('rejects an unknown manifest field through the strict schema', async () => {
    await expectRejectedWithoutWrite(
      mutateArchive(archive.bytes, (_entries, manifest) => {
        manifest.unexpected = true;
      }),
      'invalid-manifest',
    );
  });

  it('rejects an unsupported archive format and format version', async () => {
    const wrongFormat = mutateArchive(archive.bytes, (_entries, manifest) => {
      manifest.format = 'notes-detective-library';
    });
    const formatError = await expectRejectedWithoutWrite(wrongFormat, 'unsupported-format');
    expect(formatError.message).toMatch(/not a Notes Detective case archive/);

    const wrongFormatVersion = mutateArchive(archive.bytes, (_entries, manifest) => {
      manifest.formatVersion = 2;
    });
    await expectRejectedWithoutWrite(wrongFormatVersion, 'unsupported-version');
  });

  it('rejects an unsupported database schema version', async () => {
    const newerSchema = mutateArchive(archive.bytes, (_entries, manifest) => {
      manifest.dbSchemaVersion = 2;
    });
    await expectRejectedWithoutWrite(newerSchema, 'unsupported-version');

    const olderSchema = mutateArchive(archive.bytes, (_entries, manifest) => {
      manifest.dbSchemaVersion = 0;
    });
    await expectRejectedWithoutWrite(olderSchema, 'invalid-manifest');
  });

  it('rejects traversal, absolute, backslash, and outside-directory paths', async () => {
    for (const name of ['../escape.png', '/absolute.png', 'images\\escape.png', 'notes.txt']) {
      await expectRejectedWithoutWrite(withExtraEntry(archive.bytes, name), 'unsafe-path');
    }
  });

  it('rejects a drive-letter path', async () => {
    await expectRejectedWithoutWrite(withExtraEntry(archive.bytes, 'C:/escape.png'), 'unsafe-path');
  });

  it('rejects duplicate entry names', async () => {
    const [first, second] = archive.manifest.attachments;
    if (first === undefined || second === undefined) {
      throw new Error('Expected two fixture attachments');
    }
    const duplicated = duplicateEntryName(archive.bytes, second.path, first.path);
    const error = await expectRejectedWithoutWrite(duplicated, 'duplicate-entry');
    expect(error.message).toMatch(/same entry name/);
  });

  it('rejects an entry outside the manifest and images directory even when it looks safe', async () => {
    await expectRejectedWithoutWrite(
      withExtraEntry(archive.bytes, 'extra/readme.txt'),
      'unsafe-path',
    );
  });

  it('rejects an unreferenced image entry', async () => {
    await expectRejectedWithoutWrite(
      withExtraEntry(archive.bytes, extraImagePath(0), 'not-referenced'),
      'unexpected-entry',
    );
  });

  it('rejects more than the maximum number of entries', async () => {
    const entries = readEntries(archive.bytes);
    for (let index = 0; index < MAX_IMPORT_ENTRIES; index += 1) {
      entries[extraImagePath(index)] = new Uint8Array([index % 256]);
    }
    await expectRejectedWithoutWrite(zipSync(entries), 'too-many-entries');
  });

  it('rejects a single entry above the per-entry size limit', async () => {
    const first = archive.manifest.attachments[0];
    if (first === undefined) {
      throw new Error('Expected a fixture attachment');
    }
    const oversized = setDeclaredEntrySize(archive.bytes, first.path, 50 * 1024 * 1024 + 1);
    await expectRejectedWithoutWrite(oversized, 'entry-too-large');
  });

  it('rejects an archive whose total uncompressed size exceeds the limit', async () => {
    let bytes = archive.bytes;
    const entries = readEntries(bytes);
    const imagePaths = archive.manifest.attachments.map((entry) => entry.path);
    for (let index = 0; index < 3; index += 1) {
      const path = extraImagePath(index);
      entries[path] = new Uint8Array([index]);
      imagePaths.push(path);
    }
    bytes = zipSync(entries);

    // Six 45 MiB entries: below the per-entry ceiling, above 250 MiB in total.
    for (const path of imagePaths) {
      bytes = setDeclaredEntrySize(bytes, path, 45 * 1024 * 1024);
    }

    await expectRejectedWithoutWrite(bytes, 'archive-too-large');
  });

  it('rejects a checksum mismatch before writing', async () => {
    const badChecksum = mutateArchive(archive.bytes, (_entries, manifest) => {
      const first = manifestObjects(manifest, 'attachments')[0];
      if (first === undefined) {
        throw new Error('Expected a fixture attachment');
      }
      first.sha256 = 'f'.repeat(64);
    });
    const error = await expectRejectedWithoutWrite(badChecksum, 'checksum-mismatch');
    expect(error.stage).toBe('integrity');
  });

  it('rejects a missing referenced image', async () => {
    const first = archive.manifest.attachments[0];
    if (first === undefined) {
      throw new Error('Expected a fixture attachment');
    }
    await expectRejectedWithoutWrite(withoutEntry(archive.bytes, first.path), 'missing-image');
  });

  it('rejects a corrupted image with the declared size preserved', async () => {
    const first = archive.manifest.attachments[0];
    if (first === undefined) {
      throw new Error('Expected a fixture attachment');
    }
    const entries = readEntries(archive.bytes);
    const data = entries[first.path];
    if (data === undefined) {
      throw new Error('Expected the fixture image entry');
    }
    const corrupted = new Uint8Array(data);
    corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
    entries[first.path] = corrupted;

    const error = await expectRejectedWithoutWrite(zipSync(entries), 'checksum-mismatch');
    expect(error.stage).toBe('integrity');
  });
});

describe('copy restore', () => {
  it('creates a new case and remaps every case, card, connection, and attachment id', async () => {
    const result = await importCaseArchive(archive.bytes, { db });

    expect(result.mode).toBe('copy');
    expect(result.caseId).not.toBe(caseRecord.id);
    expect(result.cardCount).toBe(3);
    expect(result.connectionCount).toBe(2);
    expect(result.attachmentCount).toBe(3);

    const restoredCase = await repository.getCase(result.caseId);
    expect(restoredCase).toEqual({ ...archive.manifest.case, id: result.caseId });

    const restoredCards = await repository.listCards(result.caseId);
    expect(restoredCards).toHaveLength(archive.manifest.cards.length);

    const originalCardIds = new Set(archive.manifest.cards.map((card) => card.id));
    const cardIdByOriginal = new Map<string, string>();
    for (const originalCard of archive.manifest.cards) {
      const restoredCard = recordByTitle(restoredCards, originalCard.title);
      expect(originalCardIds.has(restoredCard.id)).toBe(false);
      expect(restoredCard.caseId).toBe(result.caseId);
      cardIdByOriginal.set(originalCard.id, restoredCard.id);
    }

    const restoredConnections = await repository.listConnections(result.caseId);
    expect(restoredConnections).toHaveLength(archive.manifest.connections.length);
    const originalConnectionIds = new Set(
      archive.manifest.connections.map((connection) => connection.id),
    );
    const expectedConnections = new Set(
      archive.manifest.connections.map((connection) => {
        const fromCardId = cardIdByOriginal.get(connection.fromCardId);
        const toCardId = cardIdByOriginal.get(connection.toCardId);
        if (fromCardId === undefined || toCardId === undefined) {
          throw new Error('Expected every connection endpoint to be remapped');
        }
        return `${connection.type}:${buildPairKey(fromCardId, toCardId)}`;
      }),
    );

    for (const connection of restoredConnections) {
      expect(originalConnectionIds.has(connection.id)).toBe(false);
      expect(connection.caseId).toBe(result.caseId);
      expect(connection.pairKey).toBe(buildPairKey(connection.fromCardId, connection.toCardId));
      expect(expectedConnections.has(`${connection.type}:${connection.pairKey}`)).toBe(true);
      expect(restoredCards.some((card) => card.id === connection.fromCardId)).toBe(true);
      expect(restoredCards.some((card) => card.id === connection.toCardId)).toBe(true);
    }

    const originalAttachmentIds = new Set(
      archive.manifest.attachments.map((attachmentEntry) => attachmentEntry.id),
    );
    for (const originalAttachment of archive.manifest.attachments) {
      const originalCard = archive.manifest.cards.find(
        (card) => card.id === originalAttachment.cardId,
      );
      if (originalCard === undefined) {
        throw new Error('Expected the attachment card to exist');
      }
      const restoredCard = recordByTitle(restoredCards, originalCard.title);
      const restoredAttachments = await repository.listAttachments(restoredCard.id);
      const restoredAttachment = restoredAttachments.find(
        (record) => record.kind === originalAttachment.kind,
      );
      expect(restoredAttachment).toBeDefined();
      if (restoredAttachment === undefined) {
        continue;
      }
      expect(originalAttachmentIds.has(restoredAttachment.id)).toBe(false);
      expect(restoredAttachment.cardId).toBe(restoredCard.id);
      expect(restoredAttachment.mime).toBe(originalAttachment.mime);
      expect(restoredAttachment.width).toBe(originalAttachment.width);
      expect(restoredAttachment.height).toBe(originalAttachment.height);
      expect(restoredAttachment.bytes).toBe(originalAttachment.bytes);
      expect(restoredAttachment.sha256).toBe(originalAttachment.sha256);
    }

    await expectNoOrphans();
  });

  it('preserves tags, positions, viewport, closure, OCR, and demo metadata', async () => {
    const result = await importCase(archive.bytes, { db });
    const restoredCase = await repository.getCase(result.caseId);
    const restoredCards = await repository.listCards(result.caseId);

    expect(restoredCase?.viewport).toEqual({ x: -120, y: 64, scale: 1.75 });
    expect(restoredCase?.closedAt).toBe('2026-06-10T10:00:00.000Z');
    expect(restoredCase?.backupPromptedAt).toBe('2026-06-11T08:00:00.000Z');
    expect(restoredCase?.isDemo).toBe(true);

    const originalNote = archive.manifest.cards.find((card) => card.id === noteCard.id);
    if (originalNote === undefined) {
      throw new Error('Expected the note card in the manifest');
    }
    const restoredNote = recordByTitle(restoredCards, originalNote.title);
    expect(restoredNote.tags).toEqual(['mitochondria', 'exam']);
    expect(restoredNote.position).toEqual({ x: 320, y: 260 });
    expect(restoredNote.crop).toEqual({ x: 0.1, y: 0.2, width: 0.7, height: 0.6 });
    expect(restoredNote.rotation).toBe(90);
    expect(restoredNote.retainFullResolution).toBe(true);
    expect(restoredNote.ocrText).toBe('The mitochondria is the powerhouse of the cell.');
    expect(restoredNote.ocrConfidence).toBe(92.5);
    expect(restoredNote.ocrEngineVersion).toBe('tesseract-5.0.0');
    expect(restoredNote.ocrUpdatedAt).toBe('2026-06-05T12:00:00.000Z');
  });

  it('leaves the original case and its images untouched', async () => {
    const before = await snapshotCase(caseRecord.id);
    await importCase(archive.bytes, { db });

    expect(await snapshotCase(caseRecord.id)).toEqual(before);
    expect(await repository.getCase(caseRecord.id)).toEqual(caseRecord);
  });

  it('restores a case with no cards, connections, or images', async () => {
    const emptyCase = await repository.createCase({ title: 'Empty case' });
    const emptyArchive = await buildCaseArchive({
      caseId: emptyCase.id,
      repository,
      clock: fixedClock(EXPORT_INSTANT),
    });

    const result = await importCase(emptyArchive.bytes, { db });
    expect(result.cardCount).toBe(0);
    expect(result.connectionCount).toBe(0);
    expect(result.attachmentCount).toBe(0);
    expect(result.caseId).not.toBe(emptyCase.id);

    const restored = await repository.getCase(result.caseId);
    expect(restored).toEqual({ ...emptyArchive.manifest.case, id: result.caseId });
    await expectNoOrphans();
  });

  it('imports the same archive twice as two independent copies', async () => {
    const first = await importCase(archive.bytes, { db });
    const second = await importCase(archive.bytes, { db });

    expect(second.caseId).not.toBe(first.caseId);
    expect(await db.cases.count()).toBe(3);
    expect(await repository.listCards(first.caseId)).toHaveLength(3);
    expect(await repository.listCards(second.caseId)).toHaveLength(3);

    const firstCardIds = new Set((await repository.listCards(first.caseId)).map((card) => card.id));
    for (const card of await repository.listCards(second.caseId)) {
      expect(firstCardIds.has(card.id)).toBe(false);
    }
    await expectNoOrphans();
  });

  it('rolls back the case and first card when a later card write fails', async () => {
    const countsBefore = await tableCounts();
    const originalBefore = await snapshotCase(caseRecord.id);
    const generatedCaseId = '11111111-1111-4111-8111-111111111111';
    let calls = 0;

    const error = await importFailureOf(archive.bytes, {
      idFactory: () => {
        calls += 1;
        if (calls === 1) {
          return generatedCaseId;
        }
        // The second card collides with a card in the original case, so the
        // first card row is already inserted when the transaction aborts.
        if (calls === 3) {
          return sourceCard.id;
        }
        return createId();
      },
    });

    expect(error.failure).toBe('write-failed');
    expect(await db.cases.get(generatedCaseId)).toBeUndefined();
    expect(await tableCounts()).toEqual(countsBefore);
    expect(await snapshotCase(caseRecord.id)).toEqual(originalBefore);
    await expectNoOrphans();
  });

  it('restores a prevalidated archive without hashing it again', async () => {
    const validated = await validateCaseArchive(archive.bytes);
    const result = await importCaseArchive(archive.bytes, { db });
    expect(result.cardCount).toBe(validated.manifest.cards.length);

    const second = await restoreValidatedCaseArchive(validated, {
      db,
      digest: async () => {
        throw new Error('A prevalidated archive must not be hashed again');
      },
    });
    expect(second.caseId).not.toBe(result.caseId);
    expect(await db.cases.count()).toBe(3);
  });
});

describe('replace restore', () => {
  async function importCopy(): Promise<RestoreCaseResult> {
    return importCase(archive.bytes, { db });
  }

  it('requires replace mode, an existing target, and the confirmed case title', async () => {
    const copy = await importCopy();
    const copyCase = await repository.getCase(copy.caseId);
    if (copyCase === null) {
      throw new Error('Expected the copied case');
    }

    await expectRejectedWithoutWrite(archive.bytes, 'replace-not-confirmed', {
      mode: 'replace',
      replaceCaseId: copy.caseId,
    });
    await expectRejectedWithoutWrite(archive.bytes, 'replace-not-confirmed', {
      mode: 'replace',
      replaceCaseId: copy.caseId,
      confirmTitle: 'The wrong title',
    });
    await expectRejectedWithoutWrite(archive.bytes, 'replace-not-confirmed', {
      mode: 'replace',
      confirmTitle: copyCase.title,
    });
    await expectRejectedWithoutWrite(archive.bytes, 'replace-target-missing', {
      mode: 'replace',
      replaceCaseId: '99999999-9999-4999-8999-999999999999',
      confirmTitle: copyCase.title,
    });
  });

  it('does not delete or rewrite anything when confirmation fails', async () => {
    const copy = await importCopy();
    const copyCase = await repository.getCase(copy.caseId);
    if (copyCase === null) {
      throw new Error('Expected the copied case');
    }
    const before = await snapshotCase(copy.caseId);

    await expectRejectedWithoutWrite(archive.bytes, 'replace-not-confirmed', {
      mode: 'replace',
      replaceCaseId: copy.caseId,
      confirmTitle: 'Not the title',
    });

    expect(await snapshotCase(copy.caseId)).toEqual(before);
    expect(await repository.getCase(copy.caseId)).toEqual(copyCase);
  });

  it('replaces the named case transactionally with new card and attachment ids', async () => {
    const copy = await importCopy();
    const copyCase = await repository.getCase(copy.caseId);
    if (copyCase === null) {
      throw new Error('Expected the copied case');
    }
    const before = await snapshotCase(copy.caseId);
    const otherCaseBefore = await snapshotCase(caseRecord.id);

    const replaced = await importCase(archive.bytes, {
      db,
      mode: 'replace',
      replaceCaseId: copy.caseId,
      confirmTitle: copyCase.title,
    });

    expect(replaced.mode).toBe('replace');
    expect(replaced.caseId).toBe(copy.caseId);
    expect(replaced.cardCount).toBe(3);
    expect(replaced.connectionCount).toBe(2);
    expect(replaced.attachmentCount).toBe(3);

    const oldCardIds = new Set(before.cards.map((card) => card.id as string));
    const oldAttachmentIds = new Set(before.attachments.map((record) => record.id as string));
    const restoredCards = await repository.listCards(copy.caseId);
    expect(restoredCards).toHaveLength(3);
    for (const card of restoredCards) {
      expect(oldCardIds.has(card.id)).toBe(false);
    }
    const restoredAttachmentIds = new Set(
      (await Promise.all(restoredCards.map((card) => repository.listAttachments(card.id))))
        .flat()
        .map((record) => record.id),
    );
    for (const id of oldAttachmentIds) {
      expect(restoredAttachmentIds.has(id)).toBe(false);
      expect(await db.attachments.get(id)).toBeUndefined();
    }

    expect(await db.cases.count()).toBe(2);
    expect(await repository.getCase(copy.caseId)).not.toBeNull();
    expect(await snapshotCase(caseRecord.id)).toEqual(otherCaseBefore);
    await expectNoOrphans();
  });

  it('rolls back the delete and writes when the attachment write fails midway', async () => {
    const copy = await importCopy();
    const copyCase = await repository.getCase(copy.caseId);
    if (copyCase === null) {
      throw new Error('Expected the copied case');
    }
    const before = await snapshotCase(copy.caseId);
    const countsBefore = await tableCounts();
    const foreignAttachmentId = sourceAttachments[0]?.id;
    if (foreignAttachmentId === undefined) {
      throw new Error('Expected a pre-existing attachment id');
    }

    // Card and connection ids are allocated first; the first attachment then
    // collides with a row in another case and aborts the attachment bulkAdd.
    const attachmentAllocation =
      archive.manifest.cards.length + archive.manifest.connections.length;
    let calls = 0;
    const error = await importFailureOf(archive.bytes, {
      mode: 'replace',
      replaceCaseId: copy.caseId,
      confirmTitle: copyCase.title,
      idFactory: () => {
        calls += 1;
        return calls === attachmentAllocation + 1 ? foreignAttachmentId : createId();
      },
    });

    expect(error.failure).toBe('write-failed');
    expect(await snapshotCase(copy.caseId)).toEqual(before);
    expect(await tableCounts()).toEqual(countsBefore);
    expect(await repository.getCase(copy.caseId)).toEqual(copyCase);
    await expectNoOrphans();

    // A rollback must leave the database usable rather than wedged.
    const retried = await importCase(archive.bytes, {
      db,
      mode: 'replace',
      replaceCaseId: copy.caseId,
      confirmTitle: copyCase.title,
    });
    expect(retried.caseId).toBe(copy.caseId);
    expect(await db.cases.count()).toBe(2);
    await expectNoOrphans();
  });
});
