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
import {
  ARCHIVE_CARD_OCR_FIELDS,
  ARCHIVE_MANIFEST_PATH,
  parseCaseArchiveManifest,
} from '../../src/features/backup/archiveFormat';
import type { CaseArchiveManifest } from '../../src/features/backup/archiveFormat';
import { buildCaseArchive } from '../../src/features/backup/exportCase';
import type { CaseArchive } from '../../src/features/backup/exportCase';
import { importCase } from '../../src/features/backup/importCase';
import { ArchiveImportError } from '../../src/features/backup/importValidation';
import { OCR_SNIPPET_MAX_LENGTH, searchCards } from '../../src/features/search/searchCards';
import { advancingClock, closeTestDatabase } from '../data/testDatabase';

const EXPORT_INSTANT = '2026-06-12T09:30:00.000Z';
const CASE_TITLE = 'Cell Biology: OCR Round Trip';

/** A realistic multi-line OCR page with the remembered phrase near the end. */
const OCR_TEXT = `${'Microscopy notes from the practical session. '.repeat(90)}The sodium pump moves three ions.`;

const OCR_CONFIDENCE = 87.25;
const OCR_ENGINE_VERSION = 'tesseract-7.0.0';
const OCR_UPDATED_AT = '2026-06-05T12:00:00.000Z';

type JsonObject = Record<string, unknown>;

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function image(content: string, mime: AttachmentMime = 'image/png'): NewAttachment {
  const blob = new Blob([content], { type: mime });
  return {
    kind: 'original',
    mime,
    width: 640,
    height: 480,
    bytes: blob.size,
    sha256: sha256(content),
    blob,
  };
}

function readManifest(bytes: Uint8Array): CaseArchiveManifest {
  const entries = unzipSync(bytes);
  const manifestBytes = entries[ARCHIVE_MANIFEST_PATH];
  if (manifestBytes === undefined) {
    throw new Error('The archive has no manifest');
  }
  return parseCaseArchiveManifest(JSON.parse(strFromU8(manifestBytes)));
}

function mutateManifest(bytes: Uint8Array, mutate: (manifest: JsonObject) => void): Uint8Array {
  const entries = unzipSync(bytes);
  const manifestBytes = entries[ARCHIVE_MANIFEST_PATH];
  if (manifestBytes === undefined) {
    throw new Error('The archive has no manifest');
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as JsonObject;
  mutate(manifest);
  entries[ARCHIVE_MANIFEST_PATH] = strToU8(JSON.stringify(manifest));
  return zipSync(entries);
}

function manifestCards(manifest: JsonObject): JsonObject[] {
  const cards = manifest.cards;
  if (!Array.isArray(cards)) {
    throw new Error('The manifest has no cards array');
  }
  return cards as JsonObject[];
}

async function tableCounts(
  db: NotesDetectiveDatabase,
): Promise<{ cases: number; cards: number; connections: number; attachments: number }> {
  return {
    cases: await db.cases.count(),
    cards: await db.cards.count(),
    connections: await db.connections.count(),
    attachments: await db.attachments.count(),
  };
}

function cardByTitle(cards: readonly CardRecord[], title: string): CardRecord {
  const card = cards.find((candidate) => candidate.title === title);
  if (card === undefined) {
    throw new Error(`Expected a card titled "${title}"`);
  }
  return card;
}

function expectSameOcr(expected: CardRecord, actual: CardRecord): void {
  expect(actual.ocrText).toBe(expected.ocrText);
  expect(actual.ocrConfidence).toBe(expected.ocrConfidence);
  expect(actual.ocrEngineVersion).toBe(expected.ocrEngineVersion);
  expect(actual.ocrUpdatedAt).toBe(expected.ocrUpdatedAt);
}

function expectNoOcr(card: CardRecord): void {
  expect(card.ocrText).toBeUndefined();
  expect(card.ocrConfidence).toBeUndefined();
  expect(card.ocrEngineVersion).toBeUndefined();
  expect(card.ocrUpdatedAt).toBeUndefined();
}

let db: NotesDetectiveDatabase;
let repository: CaseRepository;
let archive: CaseArchive;
let caseRecord: CaseRecord;
let ocrCard: CardRecord;
let plainSource: CardRecord;
let plainTopic: CardRecord;
let sourceAttachments: AttachmentRecord[];
let provenance: ConnectionRecord;
let association: ConnectionRecord;

beforeEach(async () => {
  db = createNotesDetectiveDatabase(`notes-detective-ocr-roundtrip-${createId()}`);
  await db.open();
  repository = new CaseRepository(db, {
    clock: advancingClock('2026-06-01T08:00:00.000Z'),
  });

  caseRecord = await repository.createCase({
    title: CASE_TITLE,
    subject: 'Biology',
    viewport: { x: -40, y: 24, scale: 1.25 },
  });

  const sourceResult = await repository.createCardWithAttachments(
    {
      caseId: caseRecord.id,
      type: 'source',
      title: 'Lecture 7 handout',
      position: { x: 40, y: 80 },
      tags: ['biology', 'lecture-7'],
    },
    [image('lecture-handout-bytes')],
  );
  plainSource = sourceResult.card;
  sourceAttachments = sourceResult.attachments;

  ocrCard = await repository.createCard({
    caseId: caseRecord.id,
    type: 'note',
    title: 'Sodium pump reading',
    position: { x: 320, y: 260 },
    tags: ['transport', 'exam'],
    ocrText: OCR_TEXT,
    ocrConfidence: OCR_CONFIDENCE,
    ocrEngineVersion: OCR_ENGINE_VERSION,
    ocrUpdatedAt: OCR_UPDATED_AT,
  });

  plainTopic = await repository.createCard({
    caseId: caseRecord.id,
    type: 'topic',
    title: 'Active transport',
    position: { x: 620, y: 480 },
    tags: ['transport'],
  });

  provenance = parseConnectionRecord({
    id: createId(),
    caseId: caseRecord.id,
    fromCardId: ocrCard.id,
    toCardId: plainSource.id,
    pairKey: buildPairKey(ocrCard.id, plainSource.id),
    type: 'provenance',
  });
  await db.connections.add(provenance);

  association = parseConnectionRecord({
    id: createId(),
    caseId: caseRecord.id,
    fromCardId: ocrCard.id,
    toCardId: plainTopic.id,
    pairKey: buildPairKey(ocrCard.id, plainTopic.id),
    type: 'association',
  });
  await db.connections.add(association);

  const savedCase = await repository.getCase(caseRecord.id);
  if (savedCase === null) {
    throw new Error('Expected the fixture case to exist');
  }
  caseRecord = savedCase;

  archive = await buildCaseArchive({
    caseId: caseRecord.id,
    repository,
    clock: fixedClock(EXPORT_INSTANT),
  });
});

afterEach(async () => {
  await closeTestDatabase(db);
});

describe('OCR in the archive manifest', () => {
  it('writes text, confidence, engine version, and timestamp for the card that has OCR', () => {
    const manifest = readManifest(archive.bytes);
    const archivedOcrCard = manifest.cards.find((card) => card.id === ocrCard.id);

    expect(archivedOcrCard).toBeDefined();
    expect(archivedOcrCard?.ocrText).toBe(OCR_TEXT);
    expect(archivedOcrCard?.ocrText).toHaveLength(OCR_TEXT.length);
    expect(archivedOcrCard?.ocrText?.endsWith('The sodium pump moves three ions.')).toBe(true);
    expect(archivedOcrCard?.ocrConfidence).toBe(OCR_CONFIDENCE);
    expect(archivedOcrCard?.ocrEngineVersion).toBe(OCR_ENGINE_VERSION);
    expect(archivedOcrCard?.ocrUpdatedAt).toBe(OCR_UPDATED_AT);

    // Dropping any of these fields from the exporter must fail this test.
    for (const field of ARCHIVE_CARD_OCR_FIELDS) {
      expect(field in (archivedOcrCard as object)).toBe(true);
    }
  });

  it('leaves all OCR fields absent on cards that never ran OCR', () => {
    const manifest = readManifest(archive.bytes);
    const archivedSource = manifest.cards.find((card) => card.id === plainSource.id);
    const archivedTopic = manifest.cards.find((card) => card.id === plainTopic.id);

    expect(archivedSource).toBeDefined();
    expect(archivedTopic).toBeDefined();

    for (const card of [archivedSource, archivedTopic]) {
      for (const field of ARCHIVE_CARD_OCR_FIELDS) {
        expect(field in (card as object)).toBe(false);
      }
    }
  });
});

describe('OCR restore round-trip', () => {
  it('preserves OCR metadata through copy restore and keeps the graph unchanged', async () => {
    const result = await importCase(archive.bytes, { db });
    const restoredCase = await repository.getCase(result.caseId);
    const restoredCards = await repository.listCards(result.caseId);
    const restoredConnections = await repository.listConnections(result.caseId);

    expect(result.mode).toBe('copy');
    expect(result.caseId).not.toBe(caseRecord.id);
    expect(restoredCase?.title).toBe(CASE_TITLE);

    const restoredOcrCard = cardByTitle(restoredCards, ocrCard.title);
    expect(restoredOcrCard.id).not.toBe(ocrCard.id);
    expect(restoredOcrCard.ocrText).toHaveLength(OCR_TEXT.length);
    expectSameOcr(ocrCard, restoredOcrCard);

    const restoredSource = cardByTitle(restoredCards, plainSource.title);
    const restoredTopic = cardByTitle(restoredCards, plainTopic.title);
    expectNoOcr(restoredSource);
    expectNoOcr(restoredTopic);

    // OCR is never converted into tags, card types, or connections.
    expect(restoredCards.map((card) => card.type).sort()).toEqual(
      ['note', 'source', 'topic'].sort(),
    );
    expect(restoredOcrCard.tags).toEqual(ocrCard.tags);
    expect(restoredCards.some((card) => card.tags.includes('sodium'))).toBe(false);
    expect(restoredConnections).toHaveLength(2);
    expect(restoredConnections.map((connection) => connection.type).sort()).toEqual([
      'association',
      'provenance',
    ]);
    for (const connection of restoredConnections) {
      expect(connection.pairKey).toBe(buildPairKey(connection.fromCardId, connection.toCardId));
    }

    const restoredAttachments = await repository.listAttachments(restoredSource.id);
    expect(restoredAttachments).toHaveLength(sourceAttachments.length);
    expect(restoredAttachments[0]?.bytes).toBe(sourceAttachments[0]?.bytes);
    expect(restoredAttachments[0]?.sha256).toBe(sourceAttachments[0]?.sha256);
  });

  it('finds the restored OCR phrase through search with a bounded snippet and no writes', async () => {
    const result = await importCase(archive.bytes, { db });
    const restoredCards = await repository.listCards(result.caseId);
    const countsBefore = await tableCounts(db);
    const cardsBefore = structuredClone(restoredCards);

    const hits = searchCards(restoredCards, { query: 'sodium pump moves three ions' });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.card.id).toBe(cardByTitle(restoredCards, ocrCard.title).id);
    expect(hits[0]?.ocrSnippet).toContain('sodium pump moves three ions');
    expect((hits[0]?.ocrSnippet ?? '').length).toBeLessThanOrEqual(OCR_SNIPPET_MAX_LENGTH + 2);

    expect(() => searchCards(restoredCards, { query: 'lecture 7 handout' })).not.toThrow();
    expect(searchCards(restoredCards, { query: 'never stored anywhere' })).toEqual([]);

    expect(await tableCounts(db)).toEqual(countsBefore);
    expect(structuredClone(restoredCards)).toEqual(cardsBefore);
  });

  it('restores OCR metadata through replace mode and remaps every child id', async () => {
    const copy = await importCase(archive.bytes, { db });
    const copyCase = await repository.getCase(copy.caseId);
    if (copyCase === null) {
      throw new Error('Expected the copied case');
    }

    const copiedCards = await repository.listCards(copy.caseId);
    const copiedOcrCard = cardByTitle(copiedCards, ocrCard.title);
    const copiedSource = cardByTitle(copiedCards, plainSource.title);

    // Make the target deliberately stale so a no-op replace cannot pass.
    await repository.updateCard(copiedOcrCard.id, {
      ocrText: 'stale OCR text',
      ocrConfidence: 1,
      ocrEngineVersion: 'stale-engine',
      ocrUpdatedAt: '2020-01-01T00:00:00.000Z',
    });

    const replaced = await importCase(archive.bytes, {
      db,
      mode: 'replace',
      replaceCaseId: copy.caseId,
      confirmTitle: copyCase.title,
    });

    expect(replaced.mode).toBe('replace');
    expect(replaced.caseId).toBe(copy.caseId);

    const restoredCards = await repository.listCards(copy.caseId);
    const restoredOcrCard = cardByTitle(restoredCards, ocrCard.title);
    const restoredSource = cardByTitle(restoredCards, plainSource.title);

    expect(restoredOcrCard.id).not.toBe(copiedOcrCard.id);
    expect(restoredOcrCard.ocrText).not.toBe('stale OCR text');
    expectSameOcr(ocrCard, restoredOcrCard);
    expect(restoredSource.id).not.toBe(copiedSource.id);
    expectNoOcr(restoredSource);

    expect(await db.cases.count()).toBe(2);
    expect(await repository.getCase(caseRecord.id)).toEqual(caseRecord);
  });

  it('restores a case where no card has ever run OCR without inventing fields', async () => {
    const plainCase = await repository.createCase({ title: 'No OCR case' });
    const plainCard = await repository.createCard({
      caseId: plainCase.id,
      type: 'source',
      title: 'Plain source',
      position: { x: 10, y: 20 },
      tags: [],
    });
    const plainArchive = await buildCaseArchive({
      caseId: plainCase.id,
      repository,
      clock: fixedClock(EXPORT_INSTANT),
    });

    const result = await importCase(plainArchive.bytes, { db });
    const [restoredCard] = await repository.listCards(result.caseId);

    expect(restoredCard?.title).toBe(plainCard.title);
    expect(restoredCard).toBeDefined();
    if (restoredCard === undefined) {
      return;
    }
    expectNoOcr(restoredCard);
    expect(() => searchCards([restoredCard], { query: 'anything' })).not.toThrow();
  });
});

describe('OCR import hardening', () => {
  async function expectRejectedWithoutWrite(
    input: Uint8Array,
    failure: ArchiveImportError['failure'],
  ): Promise<void> {
    const before = await tableCounts(db);
    const error = await importCase(input, { db }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ArchiveImportError);
    expect((error as ArchiveImportError).failure).toBe(failure);
    expect(await tableCounts(db)).toEqual(before);
  }

  it('rejects OCR confidence outside 0-100 before writing', async () => {
    const invalid = mutateManifest(archive.bytes, (manifest) => {
      const card = manifestCards(manifest).find((candidate) => candidate.id === ocrCard.id);
      if (card === undefined) {
        throw new Error('Expected the OCR card in the manifest');
      }
      card.ocrConfidence = 101;
    });

    await expectRejectedWithoutWrite(invalid, 'invalid-manifest');
  });

  it('rejects an empty OCR text value before writing', async () => {
    const invalid = mutateManifest(archive.bytes, (manifest) => {
      const card = manifestCards(manifest).find((candidate) => candidate.id === ocrCard.id);
      if (card === undefined) {
        throw new Error('Expected the OCR card in the manifest');
      }
      card.ocrText = '';
    });

    await expectRejectedWithoutWrite(invalid, 'invalid-manifest');
  });

  it('rejects an unknown OCR field instead of trusting it', async () => {
    const invalid = mutateManifest(archive.bytes, (manifest) => {
      const card = manifestCards(manifest).find((candidate) => candidate.id === ocrCard.id);
      if (card === undefined) {
        throw new Error('Expected the OCR card in the manifest');
      }
      card.ocrLanguage = 'eng';
    });

    await expectRejectedWithoutWrite(invalid, 'invalid-manifest');
  });
});
