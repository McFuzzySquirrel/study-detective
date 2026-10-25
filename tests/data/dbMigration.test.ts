// @vitest-environment node

import 'fake-indexeddb/auto';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { CaseRepository } from '../../src/data/caseRepository';
import { DATABASE_VERSION, createNotesDetectiveDatabase } from '../../src/data/db';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { StorageReadError } from '../../src/data/errors';
import {
  fromAttachmentRow,
  fromCardRow,
  fromCaseRow,
  fromConnectionRow,
  toAttachmentRow,
  toCardRow,
  toCaseRow,
  toConnectionRow,
} from '../../src/data/mappers';
import type { AttachmentRecord, CardRecord, ConnectionRecord } from '../../src/domain/model';
import { buildPairKey } from '../../src/domain/model';
import { DomainValidationError } from '../../src/domain/validation';
import { advancingClock, closeTestDatabase, openTestDatabase, requireRow } from './testDatabase';

const CREATED_AT = '2026-01-02T03:04:05.000Z';
const UPDATED_AT = '2026-01-02T04:05:06.000Z';
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_CONNECTION_ID = '77777777-7777-4777-8777-777777777777';
const ATTACHMENT_ID = '88888888-8888-4888-8888-888888888888';
const SHA_256 = 'a'.repeat(64);

const validCase = {
  id: CASE_ID,
  title: 'Cell Biology Final',
  subject: 'Biology',
  examDate: '2026-06-15',
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  viewport: { x: -120, y: 48, scale: 1.25 },
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const validCard: CardRecord = {
  id: NOTE_ID,
  caseId: CASE_ID,
  type: 'note',
  title: 'Mitochondria notes',
  position: { x: 120, y: 240 },
  tags: ['Biology', 'Energy'],
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

let db: NotesDetectiveDatabase | null = null;
const extraHandles: NotesDetectiveDatabase[] = [];

afterEach(async () => {
  for (const handle of extraHandles.splice(0)) {
    handle.close();
    await handle.delete();
  }
  if (db !== null) {
    await closeTestDatabase(db);
    db = null;
  }
});

function indexNames(table: { schema: { indexes: readonly { name: string }[] } }): string[] {
  return table.schema.indexes.map((index) => index.name);
}

describe('Dexie schema version 1', () => {
  it('opens a fresh database at version 1 with the four tables and their indexes', async () => {
    db = await openTestDatabase('migration');

    expect(db.verno).toBe(DATABASE_VERSION);
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'attachments',
      'cards',
      'cases',
      'connections',
    ]);

    expect(indexNames(db.cases)).toEqual(expect.arrayContaining(['updatedAt', 'examDate']));
    expect(indexNames(db.cards)).toEqual(expect.arrayContaining(['caseId', '[caseId+type]']));
    expect(indexNames(db.connections)).toEqual(
      expect.arrayContaining(['caseId', 'pairKey', '[caseId+pairKey]', 'fromCardId', 'toCardId']),
    );
    expect(indexNames(db.attachments)).toEqual(expect.arrayContaining(['cardId', '[cardId+kind]']));

    const pairKeyIndex = db.connections.schema.indexes.find((index) => index.name === 'pairKey');
    expect(pairKeyIndex?.unique).toBe(true);
    expect(pairKeyIndex?.keyPath).toBe('pairKey');

    const casePairKeyIndex = db.connections.schema.indexes.find(
      (index) => index.name === '[caseId+pairKey]',
    );
    expect(casePairKeyIndex?.unique).toBe(true);
    expect(casePairKeyIndex?.keyPath).toEqual(['caseId', 'pairKey']);

    const cardTypeIndex = db.cards.schema.indexes.find((index) => index.name === '[caseId+type]');
    expect(cardTypeIndex?.compound).toBe(true);
    expect(cardTypeIndex?.keyPath).toEqual(['caseId', 'type']);

    const cardKindIndex = db.attachments.schema.indexes.find(
      (index) => index.name === '[cardId+kind]',
    );
    expect(cardKindIndex?.compound).toBe(true);
    expect(cardKindIndex?.keyPath).toEqual(['cardId', 'kind']);
  });

  it('runs the empty-database migration once and keeps data after reopening', async () => {
    db = createNotesDetectiveDatabase(`notes-detective-test-reopen-${Date.now()}`);
    let populateCount = 0;
    db.on('populate', () => {
      populateCount += 1;
    });
    await db.open();

    expect(populateCount).toBe(1);

    const repository = new CaseRepository(db, { clock: advancingClock() });
    const created = await repository.createCase({
      title: 'Cell Biology Final',
      examDate: '2026-06-15',
    });

    const databaseName = db.name;
    db.close();

    const reopened = createNotesDetectiveDatabase(databaseName);
    extraHandles.push(reopened);
    await reopened.open();

    expect(reopened.verno).toBe(1);
    expect(populateCount).toBe(1);
    const row = await requireRow(reopened.cases.get(created.id));
    expect(row.title).toBe('Cell Biology Final');
    expect(row.examDate).toBe('2026-06-15');
    expect(row.createdAt).toBe(created.createdAt);
  });

  it('round-trips a validated case through the raw table', async () => {
    db = await openTestDatabase('round-trip');
    const repository = new CaseRepository(db, { clock: advancingClock() });
    const created = await repository.createCase({
      title: 'Cell Biology Final',
      subject: 'Biology',
      examDate: '2026-06-15',
    });

    const row = await requireRow(db.cases.get(created.id));
    expect(row).toEqual(created);
    expect(typeof row.createdAt).toBe('string');
    expect(typeof row.updatedAt).toBe('string');
  });

  it('rejects a second connection for the same unordered pair at the index', async () => {
    db = await openTestDatabase('pair-key');
    const pairKey = buildPairKey(NOTE_ID, SOURCE_ID);

    const first: ConnectionRecord = {
      id: CONNECTION_ID,
      caseId: CASE_ID,
      fromCardId: NOTE_ID,
      toCardId: SOURCE_ID,
      pairKey,
      type: 'association',
    };
    await db.connections.add(first);

    const reversed: ConnectionRecord = {
      ...first,
      id: OTHER_CONNECTION_ID,
      fromCardId: SOURCE_ID,
      toCardId: NOTE_ID,
    };

    await expect(db.connections.add(reversed)).rejects.toThrow();
    expect(await db.connections.count()).toBe(1);
  });
});

describe('row mappers', () => {
  it('round-trips every record through its persisted row and rejects unknown fields', () => {
    const connection: ConnectionRecord = {
      id: CONNECTION_ID,
      caseId: CASE_ID,
      fromCardId: NOTE_ID,
      toCardId: SOURCE_ID,
      pairKey: buildPairKey(NOTE_ID, SOURCE_ID),
      type: 'provenance',
    };
    const attachment: AttachmentRecord = {
      id: ATTACHMENT_ID,
      cardId: NOTE_ID,
      kind: 'original',
      mime: 'image/png',
      width: 1200,
      height: 800,
      bytes: 3,
      sha256: SHA_256,
      blob: new Blob(['abc'], { type: 'image/png' }),
    };

    expect(fromCaseRow(toCaseRow(validCase))).toEqual(validCase);
    expect(fromCardRow(toCardRow(validCard))).toEqual(validCard);
    expect(fromConnectionRow(toConnectionRow(connection))).toEqual(connection);
    expect(fromAttachmentRow(toAttachmentRow(attachment))).toEqual(attachment);

    expect(() => fromCaseRow({ ...validCase, extra: true })).toThrow(DomainValidationError);
    expect(() => fromCardRow({ ...validCard, extra: true })).toThrow(DomainValidationError);
    expect(() => fromConnectionRow({ ...connection, extra: true })).toThrow(DomainValidationError);
    expect(() => fromAttachmentRow({ ...attachment, extra: true })).toThrow(DomainValidationError);
  });
});

describe('malformed stored rows', () => {
  it('rejects a stored case with an invalid title instead of returning partial data', async () => {
    db = await openTestDatabase('bad-case');
    const repository = new CaseRepository(db, { clock: advancingClock() });
    const created = await repository.createCase({ title: 'Valid title' });

    await db.cases.put({ ...validCase, id: created.id, title: '' });

    await expect(repository.getCase(created.id)).rejects.toBeInstanceOf(StorageReadError);
    await expect(repository.getCase(created.id)).rejects.toMatchObject({
      entity: 'case',
      recordId: created.id,
      cause: expect.any(DomainValidationError),
    });
    await expect(repository.listCaseSummaries()).rejects.toBeInstanceOf(StorageReadError);
  });

  it('rejects a stored card with an unknown field on single and list reads', async () => {
    db = await openTestDatabase('bad-card');
    const repository = new CaseRepository(db, { clock: advancingClock() });
    const created = await repository.createCase({ title: 'Valid case' });
    const card = await repository.createCard({
      caseId: created.id,
      type: 'note',
      title: 'Valid card',
      position: { x: 0, y: 0 },
      tags: ['Biology'],
    });

    await db.cards.put({
      ...validCard,
      id: card.id,
      caseId: created.id,
      color: 'red',
    } as unknown as CardRecord);

    await expect(repository.getCard(card.id)).rejects.toBeInstanceOf(StorageReadError);
    await expect(repository.listCards(created.id)).rejects.toBeInstanceOf(StorageReadError);
  });
});

describe('data-layer boundaries', () => {
  const dataDirectory = fileURLToPath(new URL('../../src/data', import.meta.url));

  it('imports neither React nor a network API', () => {
    const files = readdirSync(dataDirectory).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(join(dataDirectory, file), 'utf8');
      expect(source, `${file} must not import React`).not.toMatch(
        /from\s+['"]react(?:-dom)?(?:\/[^'"]*)?['"]/,
      );
      expect(source, `${file} must not call fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${file} must not import feature modules`).not.toMatch(
        /from\s+['"][^'"]*features\//,
      );
    }
  });
});
