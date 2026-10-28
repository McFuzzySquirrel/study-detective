// @vitest-environment node

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NewAttachment } from '../../src/data/attachmentStore';
import { AttachmentStore, buildAttachmentRecord } from '../../src/data/attachmentStore';
import {
  CaseRepository,
  InMemoryCaseRepository,
  compareCaseSummaries,
} from '../../src/data/caseRepository';
import type { CaseRepositoryPort } from '../../src/data/caseRepository';
import { createNotesDetectiveDatabase } from '../../src/data/db';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { RecordNotFoundError, StorageReadError } from '../../src/data/errors';
import { sequenceIdFactory } from '../../src/domain/ids';
import type { CardRecord, ConnectionRecord } from '../../src/domain/model';
import { buildPairKey } from '../../src/domain/model';
import { DomainValidationError } from '../../src/domain/validation';
import { advancingClock, closeTestDatabase, openTestDatabase, requireRow } from './testDatabase';
const SHA_256 = 'a'.repeat(64);

const CASE_ID_FIXTURE = '11111111-1111-4111-8111-111111111111';
const MISSING_CASE_ID = '99999999-9999-4999-8999-999999999999';
const CONNECTION_ID = '66666666-6666-4666-8666-666666666666';
const ATTACHMENT_ID = '77777777-7777-4777-8777-777777777777';
const DISPLAY_ID = '88888888-8888-4888-8888-888888888888';
const THUMBNAIL_ID = '12121212-1212-4212-8212-121212121212';

function pngBlob(content = 'abc'): Blob {
  return new Blob([content], { type: 'image/png' });
}

function attachmentInput(overrides: Partial<NewAttachment> = {}): NewAttachment {
  const blob = overrides.blob ?? pngBlob();
  return {
    kind: 'original',
    mime: 'image/png',
    width: 1200,
    height: 800,
    bytes: blob.size,
    sha256: SHA_256,
    blob,
    ...overrides,
  };
}

let db: NotesDetectiveDatabase;
let repository: CaseRepositoryPort;

beforeEach(async () => {
  db = await openTestDatabase('case-repository');
  repository = new CaseRepository(db, { clock: advancingClock() });
});

afterEach(async () => {
  await closeTestDatabase(db);
});

describe('case CRUD', () => {
  it('creates a case with defaults and reads the same validated record back', async () => {
    const created = await repository.createCase({
      title: '  Cell Biology Final  ',
      subject: 'Biology',
      examDate: '2026-06-15',
    });

    expect(created.title).toBe('Cell Biology Final');
    expect(created.subject).toBe('Biology');
    expect(created.examDate).toBe('2026-06-15');
    expect(created.viewport).toEqual({ x: 0, y: 0, scale: 1 });
    expect(created.closedAt).toBeNull();
    expect(created.isDemo).toBe(false);
    expect(created.backupPromptedAt).toBeNull();
    expect(created.updatedAt).toBe(created.createdAt);

    expect(await repository.getCase(created.id)).toEqual(created);
    expect(await repository.getCase(MISSING_CASE_ID)).toBeNull();
  });

  it('preserves the demo marker, backup prompt, closure metadata, and viewport', async () => {
    const closedAt = '2026-03-01T10:00:00.000Z';
    const backupPromptedAt = '2026-03-02T11:00:00.000Z';
    const created = await repository.createCase({
      title: 'Demo case',
      isDemo: true,
      backupPromptedAt,
      closedAt,
      viewport: { x: -240, y: 96, scale: 1.75 },
    });

    const loaded = await repository.getCase(created.id);
    expect(loaded).toEqual(created);
    expect(loaded?.isDemo).toBe(true);
    expect(loaded?.backupPromptedAt).toBe(backupPromptedAt);
    expect(loaded?.closedAt).toBe(closedAt);
    expect(loaded?.viewport).toEqual({ x: -240, y: 96, scale: 1.75 });
  });

  it('updates editable metadata and clears an optional field with null', async () => {
    const created = await repository.createCase({
      title: 'Original title',
      subject: 'Biology',
      examDate: '2026-06-15',
    });

    const updated = await repository.updateCase(created.id, {
      title: 'Revised title',
      subject: null,
      examDate: '2026-07-01',
    });

    expect(updated.title).toBe('Revised title');
    expect(updated.subject).toBeUndefined();
    expect(updated.examDate).toBe('2026-07-01');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));

    const loaded = await repository.getCase(created.id);
    expect(loaded?.title).toBe('Revised title');
    expect(loaded?.subject).toBeUndefined();
  });

  it('rejects an invalid title without changing the stored case', async () => {
    const created = await repository.createCase({ title: 'Original title' });

    await expect(
      repository.updateCase(created.id, { title: 'x'.repeat(81) }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect((await repository.getCase(created.id))?.title).toBe('Original title');
  });

  it('reports a missing case on update instead of creating a partial row', async () => {
    await expect(repository.updateCase(MISSING_CASE_ID, { title: 'Nope' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await db.cases.count()).toBe(0);
  });

  it('persists the viewport without churning the shelf updatedAt', async () => {
    const created = await repository.createCase({ title: 'Cell Biology Final' });

    const saved = await repository.saveViewport(created.id, { x: -400, y: 150, scale: 2 });

    expect(saved.viewport).toEqual({ x: -400, y: 150, scale: 2 });
    expect(saved.updatedAt).toBe(created.updatedAt);
    expect((await repository.getCase(created.id))?.viewport).toEqual({
      x: -400,
      y: 150,
      scale: 2,
    });

    await expect(
      repository.saveViewport(created.id, { x: 0, y: 0, scale: 9 }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect((await repository.getCase(created.id))?.viewport.scale).toBe(2);
  });
});

describe('card CRUD', () => {
  it('round-trips tags, position, and OCR metadata', async () => {
    const createdCase = await repository.createCase({ title: 'Cell Biology Final' });
    const ocrUpdatedAt = '2026-02-03T04:05:06.000Z';

    const card = await repository.createCard({
      caseId: createdCase.id,
      type: 'source',
      title: '  Lecture 4  ',
      position: { x: 120, y: 240 },
      tags: [' Biology ', 'biology', 'Energy'],
      ocrText: 'ATP synthase',
      ocrConfidence: 94.5,
      ocrEngineVersion: '7.0.0',
      ocrUpdatedAt,
    });

    expect(card.title).toBe('Lecture 4');
    expect(card.tags).toEqual(['Biology', 'Energy']);
    expect(card.ocrText).toBe('ATP synthase');
    expect(card.ocrConfidence).toBe(94.5);
    expect(card.ocrEngineVersion).toBe('7.0.0');
    expect(card.ocrUpdatedAt).toBe(ocrUpdatedAt);

    const loaded = await repository.getCard(card.id);
    expect(loaded).toEqual(card);
    expect(await repository.listCards(createdCase.id)).toEqual([card]);
    expect(await repository.getCard(MISSING_CASE_ID)).toBeNull();
  });

  it('lists cards in creation order and updates only the patched fields', async () => {
    const createdCase = await repository.createCase({ title: 'Cell Biology Final' });
    const first = await repository.createCard({
      caseId: createdCase.id,
      type: 'note',
      title: 'First',
      details: 'Read this alongside the diagram.',
      position: { x: 0, y: 0 },
      tags: ['Biology'],
      ocrText: 'initial OCR',
      ocrConfidence: 80,
    });
    const second = await repository.createCard({
      caseId: createdCase.id,
      type: 'topic',
      title: 'Second',
      position: { x: 10, y: 10 },
    });

    expect((await repository.listCards(createdCase.id)).map((card) => card.id)).toEqual([
      first.id,
      second.id,
    ]);

    const updated = await repository.updateCard(first.id, {
      title: 'First revised',
      position: { x: 55, y: 66 },
      tags: ['Energy'],
      details: 'Keep this example in mind.',
      ocrText: 'revised OCR',
    });

    expect(updated.title).toBe('First revised');
    expect(updated.position).toEqual({ x: 55, y: 66 });
    expect(updated.tags).toEqual(['Energy']);
    expect(updated.details).toBe('Keep this example in mind.');
    expect(updated.ocrText).toBe('revised OCR');
    expect(updated.ocrConfidence).toBe(80);
    expect(updated.type).toBe('note');
    expect(updated.createdAt).toBe(first.createdAt);

    const cleared = await repository.updateCard(first.id, { details: null });
    expect(cleared.details).toBeUndefined();
  });

  it('rejects a card whose case does not exist and an invalid card', async () => {
    const createdCase = await repository.createCase({ title: 'Cell Biology Final' });

    await expect(
      repository.createCard({
        caseId: MISSING_CASE_ID,
        type: 'note',
        title: 'Orphan',
        position: { x: 0, y: 0 },
      }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);

    await expect(
      repository.createCard({
        caseId: createdCase.id,
        type: 'note',
        title: '   ',
        position: { x: 0, y: 0 },
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(await db.cards.count()).toBe(0);
  });

  it('deletes a card with its connections and Blobs in one transaction', async () => {
    const createdCase = await repository.createCase({ title: 'Cell Biology Final' });
    const note = await repository.createCard({
      caseId: createdCase.id,
      type: 'note',
      title: 'Note',
      position: { x: 0, y: 0 },
    });
    const source = await repository.createCard({
      caseId: createdCase.id,
      type: 'source',
      title: 'Source',
      position: { x: 10, y: 10 },
    });
    const connection: ConnectionRecord = {
      id: CONNECTION_ID,
      caseId: createdCase.id,
      fromCardId: note.id,
      toCardId: source.id,
      pairKey: buildPairKey(note.id, source.id),
      type: 'provenance',
    };
    await db.connections.add(connection);

    const store = new AttachmentStore(db, { clock: advancingClock() });
    await store.addAttachment(note.id, { ...attachmentInput(), id: ATTACHMENT_ID });

    expect(await repository.deleteCard(note.id)).toBe(true);

    expect(await repository.getCard(note.id)).toBeNull();
    expect(await db.connections.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
    expect(await repository.getCard(source.id)).not.toBeNull();
    expect(await repository.deleteCard(note.id)).toBe(false);
  });

  it('rejects a malformed card row on read', async () => {
    const createdCase = await repository.createCase({ title: 'Cell Biology Final' });
    const card = await repository.createCard({
      caseId: createdCase.id,
      type: 'note',
      title: 'Note',
      position: { x: 0, y: 0 },
    });

    const row = await requireRow(db.cards.get(card.id));
    await db.cards.put({ ...row, tags: ['Biology', 'biology'] });

    await expect(repository.getCard(card.id)).rejects.toBeInstanceOf(StorageReadError);
  });
});

describe('case summaries', () => {
  it('counts cards and connections and sorts by exam date with undated cases last', async () => {
    const juneCase = await repository.createCase({
      title: 'June exam',
      examDate: '2026-06-15',
    });
    const mayCase = await repository.createCase({
      title: 'May exam',
      examDate: '2026-05-01',
    });
    const undatedCase = await repository.createCase({ title: 'No exam date' });

    const juneCardOne = await repository.createCard({
      caseId: juneCase.id,
      type: 'note',
      title: 'Note one',
      position: { x: 0, y: 0 },
    });
    const juneCardTwo = await repository.createCard({
      caseId: juneCase.id,
      type: 'source',
      title: 'Source one',
      position: { x: 10, y: 10 },
    });
    await repository.createCard({
      caseId: mayCase.id,
      type: 'topic',
      title: 'Topic one',
      position: { x: 0, y: 0 },
    });

    await db.connections.add({
      id: CONNECTION_ID,
      caseId: juneCase.id,
      fromCardId: juneCardOne.id,
      toCardId: juneCardTwo.id,
      pairKey: buildPairKey(juneCardOne.id, juneCardTwo.id),
      type: 'provenance',
    });

    const summaries = await repository.listCaseSummaries();
    expect(summaries.map((summary) => summary.id)).toEqual([
      mayCase.id,
      juneCase.id,
      undatedCase.id,
    ]);
    expect(summaries[1]?.cardCount).toBe(2);
    expect(summaries[1]?.connectionCount).toBe(1);
    expect(summaries[0]?.cardCount).toBe(1);
    expect(summaries[2]?.cardCount).toBe(0);

    const juneSummary = await repository.getCaseSummary(juneCase.id);
    expect(juneSummary).toMatchObject({ cardCount: 2, connectionCount: 1 });
    expect(await repository.getCaseSummary(MISSING_CASE_ID)).toBeNull();
  });

  it('orders cases with the same exam date by most recently modified', async () => {
    const first = await repository.createCase({ title: 'First', examDate: '2026-06-15' });
    const second = await repository.createCase({ title: 'Second', examDate: '2026-06-15' });

    const summaries = await repository.listCaseSummaries();
    expect(summaries.map((summary) => summary.id)).toEqual([second.id, first.id]);
    const mostRecent = summaries[0];
    const older = summaries[1];
    if (mostRecent === undefined || older === undefined) {
      throw new Error('Expected two case summaries');
    }
    expect(mostRecent.updatedAt.localeCompare(older.updatedAt)).toBeGreaterThan(0);
    expect(compareCaseSummaries(mostRecent, older)).toBeLessThan(0);
  });
});

describe('transaction atomicity', () => {
  it('rolls back a card and all Blobs when the attachment write fails', async () => {
    const createdCase = await repository.createCase({ title: 'Cell Biology Final' });
    const before = await repository.getCase(createdCase.id);
    const rejectBulkAdd = vi
      .spyOn(db.attachments, 'bulkAdd')
      .mockRejectedValueOnce(new Error('injected storage failure'));

    await expect(
      repository.createCardWithAttachments(
        {
          caseId: createdCase.id,
          type: 'source',
          title: 'Lecture 4',
          position: { x: 0, y: 0 },
        },
        [
          { ...attachmentInput({ kind: 'original', id: ATTACHMENT_ID }) },
          { ...attachmentInput({ kind: 'display', id: DISPLAY_ID }) },
          { ...attachmentInput({ kind: 'thumbnail', id: THUMBNAIL_ID }) },
        ],
      ),
    ).rejects.toThrow('injected storage failure');

    rejectBulkAdd.mockRestore();

    expect(await db.cards.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
    const after = await repository.getCase(createdCase.id);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it('rejects an invalid attachment before any card row is written', async () => {
    const createdCase = await repository.createCase({ title: 'Cell Biology Final' });

    await expect(
      repository.createCardWithAttachments(
        {
          caseId: createdCase.id,
          type: 'source',
          title: 'Lecture 4',
          position: { x: 0, y: 0 },
        },
        [{ ...attachmentInput({ bytes: 999 }) }],
      ),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(await db.cards.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });

  it('writes a card and its Blobs together on success', async () => {
    const createdCase = await repository.createCase({ title: 'Cell Biology Final' });

    const result = await repository.createCardWithAttachments(
      {
        caseId: createdCase.id,
        type: 'source',
        title: 'Lecture 4',
        position: { x: 0, y: 0 },
      },
      [
        { ...attachmentInput({ kind: 'original', id: ATTACHMENT_ID }) },
        { ...attachmentInput({ kind: 'display', id: DISPLAY_ID }) },
        { ...attachmentInput({ kind: 'thumbnail', id: THUMBNAIL_ID }) },
      ],
    );

    expect(result.card.caseId).toBe(createdCase.id);
    expect(result.attachments).toHaveLength(3);
    expect(await db.cards.count()).toBe(1);
    expect(await db.attachments.count()).toBe(3);
    expect(await repository.getCaseSummary(createdCase.id)).toMatchObject({
      cardCount: 1,
      connectionCount: 0,
    });
  });

  it('validates attachment metadata before a card write', () => {
    expect(() =>
      buildAttachmentRecord(
        'not-a-uuid',
        attachmentInput(),
        () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    ).toThrow(DomainValidationError);
  });
});

describe('in-memory repository', () => {
  const CASE_A = '11111111-1111-4111-8111-111111111111';
  const CASE_B = '22222222-2222-4222-8222-222222222222';
  const NOTE_ID = '33333333-3333-4333-8333-333333333333';
  const SOURCE_ID = '44444444-4444-4444-8444-444444444444';

  function createFake(): InMemoryCaseRepository {
    return new InMemoryCaseRepository({
      clock: advancingClock(),
      idFactory: sequenceIdFactory([CASE_A, NOTE_ID]),
    });
  }

  it('supports the same case and card contract without IndexedDB', async () => {
    const fake = createFake();

    const createdCase = await fake.createCase({
      title: 'In-memory case',
      examDate: '2026-06-15',
    });
    expect(createdCase.id).toBe(CASE_A);
    expect(await fake.getCase(CASE_A)).toEqual(createdCase);
    expect(await fake.getCase(MISSING_CASE_ID)).toBeNull();

    const card = await fake.createCard({
      caseId: CASE_A,
      type: 'note',
      title: 'Note',
      position: { x: 1, y: 2 },
      tags: ['Biology'],
    });
    expect(card.id).toBe(NOTE_ID);
    expect(await fake.getCard(NOTE_ID)).toEqual(card);
    expect(await fake.listCards(CASE_A)).toEqual([card]);

    const updatedCard = await fake.updateCard(NOTE_ID, { title: 'Revised note' });
    expect(updatedCard.title).toBe('Revised note');

    const summary = await fake.getCaseSummary(CASE_A);
    expect(summary).toMatchObject({ cardCount: 1, connectionCount: 0 });
    expect(await fake.getCaseSummary(MISSING_CASE_ID)).toBeNull();
    expect((await fake.listCaseSummaries()).map((item) => item.id)).toEqual([CASE_A]);

    const updatedCase = await fake.updateCase(CASE_A, {
      title: 'Revised case',
      subject: 'Biology',
    });
    expect(updatedCase.title).toBe('Revised case');

    const savedViewport = await fake.saveViewport(CASE_A, { x: 9, y: 8, scale: 1.5 });
    expect(savedViewport.viewport).toEqual({ x: 9, y: 8, scale: 1.5 });

    expect(await fake.deleteCard(NOTE_ID)).toBe(true);
    expect(await fake.getCard(NOTE_ID)).toBeNull();
    expect(await fake.deleteCard(NOTE_ID)).toBe(false);
  });

  it('writes a card with attachments and seeds graph rows for UI fixtures', async () => {
    const ids = sequenceIdFactory([CASE_A, NOTE_ID]);
    const fake = new InMemoryCaseRepository({ clock: advancingClock(), idFactory: ids });

    const createdCase = await fake.createCase({ title: 'Seeded case' });
    const result = await fake.createCardWithAttachments(
      {
        caseId: createdCase.id,
        type: 'source',
        title: 'Source',
        position: { x: 0, y: 0 },
      },
      [attachmentInput({ kind: 'display', id: DISPLAY_ID })],
    );
    expect(result.attachments).toHaveLength(1);
    expect((await fake.getCaseSummary(createdCase.id))?.cardCount).toBe(1);

    const seeded = new InMemoryCaseRepository({
      clock: advancingClock(),
      seed: {
        cases: [createdCase],
        cards: [
          {
            ...result.card,
            id: NOTE_ID,
            type: 'note',
          },
          {
            ...result.card,
            id: SOURCE_ID,
          },
        ],
        connections: [
          {
            id: CONNECTION_ID,
            caseId: createdCase.id,
            fromCardId: NOTE_ID,
            toCardId: SOURCE_ID,
            pairKey: buildPairKey(NOTE_ID, SOURCE_ID),
            type: 'association',
          },
        ],
        attachments: result.attachments,
      },
    });

    expect(await seeded.getCaseSummary(createdCase.id)).toMatchObject({
      cardCount: 2,
      connectionCount: 1,
    });
    expect((await seeded.listCards(createdCase.id)).length).toBe(2);
    expect(await seeded.listAttachments(NOTE_ID)).toHaveLength(1);
    expect((await seeded.getAttachment(DISPLAY_ID))?.kind).toBe('display');

    expect(await seeded.deleteCard(NOTE_ID)).toBe(true);
    expect(await seeded.listAttachments(NOTE_ID)).toHaveLength(0);
    expect(await seeded.getCaseSummary(createdCase.id)).toMatchObject({
      cardCount: 1,
      connectionCount: 0,
    });
  });

  it('rejects missing relations and invalid patches', async () => {
    const ids = sequenceIdFactory([CASE_A, NOTE_ID]);
    const fake = new InMemoryCaseRepository({ clock: advancingClock(), idFactory: ids });

    await expect(
      fake.createCard({
        caseId: MISSING_CASE_ID,
        type: 'note',
        title: 'Orphan',
        position: { x: 0, y: 0 },
      }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(fake.updateCase(MISSING_CASE_ID, { title: 'Nope' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await expect(
      fake.saveViewport(MISSING_CASE_ID, { x: 0, y: 0, scale: 1 }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(fake.updateCard(MISSING_CASE_ID, { title: 'Nope' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );

    const createdCase = await fake.createCase({ title: 'Valid' });
    expect(createdCase.id).toBe(CASE_A);
    await expect(fake.updateCase(CASE_A, { title: '' })).rejects.toBeInstanceOf(
      DomainValidationError,
    );

    await fake.createCard({
      caseId: CASE_A,
      type: 'note',
      title: 'Note',
      position: { x: 0, y: 0 },
    });
  });

  it('rejects seed rows whose relations are missing', () => {
    expect(
      () =>
        new InMemoryCaseRepository({
          seed: {
            cases: [
              {
                id: CASE_A,
                title: 'Seed',
                createdAt: '2026-01-02T03:04:05.000Z',
                updatedAt: '2026-01-02T04:05:06.000Z',
                viewport: { x: 0, y: 0, scale: 1 },
                closedAt: null,
                isDemo: false,
                backupPromptedAt: null,
              },
            ],
            cards: [
              {
                id: NOTE_ID,
                caseId: CASE_B,
                type: 'note',
                title: 'Orphan card',
                position: { x: 0, y: 0 },
                tags: [],
                createdAt: '2026-01-02T03:04:05.000Z',
                updatedAt: '2026-01-02T04:05:06.000Z',
              },
            ],
          },
        }),
    ).toThrow(RecordNotFoundError);

    expect(
      () =>
        new InMemoryCaseRepository({
          seed: {
            cards: [
              {
                id: NOTE_ID,
                caseId: CASE_A,
                type: 'note',
                title: 'Orphan card',
                position: { x: 0, y: 0 },
                tags: [],
                createdAt: '2026-01-02T03:04:05.000Z',
                updatedAt: '2026-01-02T04:05:06.000Z',
              },
            ],
          },
        }),
    ).toThrow(RecordNotFoundError);
  });
});

describe('repository edge cases', () => {
  it('leaves no rows when a create is rejected by validation', async () => {
    await expect(repository.createCase({ title: '' })).rejects.toBeInstanceOf(
      DomainValidationError,
    );
    expect(await db.cases.count()).toBe(0);
  });

  it('rejects an unknown case type patch without changing the card', async () => {
    const createdCase = await repository.createCase({ title: 'Cell Biology Final' });
    const card: CardRecord = await repository.createCard({
      caseId: createdCase.id,
      type: 'note',
      title: 'Note',
      position: { x: 0, y: 0 },
    });

    await expect(repository.updateCard(card.id, { type: 'quote' as never })).rejects.toBeInstanceOf(
      DomainValidationError,
    );
    expect((await repository.getCard(card.id))?.type).toBe('note');
  });

  it('throws when updating a card that does not exist', async () => {
    await expect(repository.updateCard(MISSING_CASE_ID, { title: 'Nope' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it('uses a generated attachment id when the caller does not supply one', () => {
    const record = buildAttachmentRecord(CASE_ID_FIXTURE, attachmentInput());
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.cardId).toBe(CASE_ID_FIXTURE);
  });
});

describe('database factory', () => {
  it('builds a database handle that is not opened until requested', () => {
    const handle = createNotesDetectiveDatabase('notes-detective-test-factory');
    expect(handle.isOpen()).toBe(false);
    handle.close();
  });
});
