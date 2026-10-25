// @vitest-environment node

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NewAttachment } from '../../src/data/attachmentStore';
import { AttachmentStore } from '../../src/data/attachmentStore';
import { CaseRepository } from '../../src/data/caseRepository';
import { createNotesDetectiveDatabase } from '../../src/data/db';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { deleteCase, readCaseDeletionPreview } from '../../src/data/deleteCase';
import { StorageReadError } from '../../src/data/errors';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../src/domain/model';
import { buildPairKey } from '../../src/domain/model';
import { advancingClock, closeTestDatabase, openTestDatabase, requireRow } from './testDatabase';

const SHA_256 = 'a'.repeat(64);

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
let repository: CaseRepository;
let store: AttachmentStore;
let targetCase: CaseRecord;
let otherCase: CaseRecord;
let note: CardRecord;
let source: CardRecord;
let topic: CardRecord;
let otherCard: CardRecord;
let targetAttachments: readonly { readonly id: string }[];
let otherAttachment: { readonly id: string };

beforeEach(async () => {
  db = await openTestDatabase('delete-case');
  const clock = advancingClock();
  repository = new CaseRepository(db, { clock });
  store = new AttachmentStore(db, { clock });

  targetCase = await repository.createCase({
    title: 'Organic Chemistry',
    subject: 'Chemistry',
    examDate: '2026-11-02',
  });
  otherCase = await repository.createCase({ title: 'Constitutional Law' });

  note = await repository.createCard({
    caseId: targetCase.id,
    type: 'note',
    title: 'Lecture 1',
    position: { x: 0, y: 0 },
  });
  source = await repository.createCard({
    caseId: targetCase.id,
    type: 'source',
    title: 'Textbook chapter 4',
    position: { x: 120, y: 0 },
  });
  topic = await repository.createCard({
    caseId: targetCase.id,
    type: 'topic',
    title: 'Carbonyls',
    position: { x: 240, y: 0 },
  });
  otherCard = await repository.createCard({
    caseId: otherCase.id,
    type: 'note',
    title: 'Case law',
    position: { x: 0, y: 0 },
  });

  const connections: ConnectionRecord[] = [
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      caseId: targetCase.id,
      fromCardId: note.id,
      toCardId: source.id,
      pairKey: buildPairKey(note.id, source.id),
      type: 'association',
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      caseId: targetCase.id,
      fromCardId: source.id,
      toCardId: topic.id,
      pairKey: buildPairKey(source.id, topic.id),
      type: 'association',
    },
  ];
  await db.connections.bulkAdd(connections);

  // One photo is three Blobs (original, display, thumbnail). The first image
  // card must count as one image in the confirmation, not three.
  targetAttachments = await store.addAttachments(note.id, [
    attachmentInput({ kind: 'original', blob: pngBlob('original-a') }),
    attachmentInput({ kind: 'display', blob: pngBlob('display-a') }),
    attachmentInput({ kind: 'thumbnail', blob: pngBlob('thumbnail-a') }),
  ]);
  await store.addAttachment(topic.id, attachmentInput({ kind: 'original' }));
  otherAttachment = await store.addAttachment(
    otherCard.id,
    attachmentInput({ kind: 'original', blob: pngBlob('original-other') }),
  );
});

afterEach(async () => {
  await closeTestDatabase(db);
});

describe('case deletion preview', () => {
  it('names the case and counts cards, connections, and distinct images', async () => {
    const preview = await readCaseDeletionPreview(db, targetCase.id);

    expect(preview).toEqual({
      caseId: targetCase.id,
      title: 'Organic Chemistry',
      cardCount: 3,
      connectionCount: 2,
      imageCount: 2,
    });
  });

  it('returns null when the case is already gone', async () => {
    expect(await readCaseDeletionPreview(db, '99999999-9999-4999-8999-999999999999')).toBeNull();
  });

  it('rejects a malformed stored case instead of trusting its title', async () => {
    const row = await requireRow(db.cases.get(targetCase.id));
    await db.cases.put({ ...row, title: '' });

    await expect(readCaseDeletionPreview(db, targetCase.id)).rejects.toBeInstanceOf(
      StorageReadError,
    );
  });
});

describe('cascade delete', () => {
  it('removes the case, cards, connections, and every attachment Blob in one action', async () => {
    expect(await readCaseDeletionPreview(db, targetCase.id)).toMatchObject({
      cardCount: 3,
      connectionCount: 2,
      imageCount: 2,
    });

    expect(await deleteCase(db, targetCase.id)).toBe(true);
    expect(await db.cases.get(targetCase.id)).toBeUndefined();
    expect(await db.cards.where('caseId').equals(targetCase.id).count()).toBe(0);
    expect(await db.connections.where('caseId').equals(targetCase.id).count()).toBe(0);
    expect(await db.attachments.where('cardId').equals(note.id).count()).toBe(0);
    expect(await db.attachments.where('cardId').equals(topic.id).count()).toBe(0);

    for (const attachment of targetAttachments) {
      expect(await db.attachments.get(attachment.id)).toBeUndefined();
    }

    // The other case is untouched, including its own Blob.
    expect((await db.cases.get(otherCase.id))?.title).toBe('Constitutional Law');
    expect(await db.cards.get(otherCard.id)).toEqual(otherCard);
    expect(await db.attachments.get(otherAttachment.id)).toBeDefined();
  });

  it('offers no second delete or restore path', async () => {
    expect(await deleteCase(db, targetCase.id)).toBe(true);
    expect(await deleteCase(db, targetCase.id)).toBe(false);
    expect(await db.cases.count()).toBe(1);
    expect(await db.attachments.get(otherAttachment.id)).toBeDefined();
  });

  it('deletes a case that has no cards, connections, or images yet', async () => {
    const emptyCase = await repository.createCase({ title: 'Empty Case' });

    expect(await readCaseDeletionPreview(db, emptyCase.id)).toMatchObject({
      cardCount: 0,
      connectionCount: 0,
      imageCount: 0,
    });
    expect(await deleteCase(db, emptyCase.id)).toBe(true);
    expect(await db.cases.get(emptyCase.id)).toBeUndefined();
    expect(await db.cards.count()).toBe(4);
    expect(await db.attachments.count()).toBe(5);
  });

  it('is exposed through the repository write boundary', async () => {
    const preview = await repository.getCaseDeletionPreview(targetCase.id);
    expect(preview).toMatchObject({ cardCount: 3, connectionCount: 2, imageCount: 2 });

    expect(await repository.deleteCase(targetCase.id)).toBe(true);
    expect(await repository.getCase(targetCase.id)).toBeNull();
    expect(await repository.listCaseSummaries()).toHaveLength(1);
    expect(await repository.deleteCase(targetCase.id)).toBe(false);
  });

  it('rolls every dependent row back when the final case delete fails', async () => {
    const [firstTargetAttachment] = targetAttachments;
    if (firstTargetAttachment === undefined) {
      throw new Error('The target image fixture has no attachment rows');
    }

    const beforeCase = await requireRow(db.cases.get(targetCase.id));
    const beforeNote = await requireRow(db.cards.get(note.id));
    const beforeAttachment = await requireRow(db.attachments.get(firstTargetAttachment.id));

    const rejectCaseDelete = vi
      .spyOn(db.cases, 'delete')
      .mockRejectedValueOnce(new Error('injected delete failure'));

    await expect(deleteCase(db, targetCase.id)).rejects.toThrow('injected delete failure');
    rejectCaseDelete.mockRestore();

    // The transaction had already attempted the attachment, connection, and
    // card deletes before the injected failure. All of them must be rolled back.
    expect(await db.cases.count()).toBe(2);
    expect(await db.cards.count()).toBe(4);
    expect(await db.connections.count()).toBe(2);
    expect(await db.attachments.count()).toBe(5);

    expect(await db.cases.get(targetCase.id)).toEqual(beforeCase);
    expect(await db.cards.get(note.id)).toEqual(beforeNote);
    expect(await db.connections.get('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toBeDefined();

    const restored = await requireRow(db.attachments.get(firstTargetAttachment.id));
    expect(restored).toEqual(beforeAttachment);
    expect(restored.blob).toBeInstanceOf(Blob);
    expect(await restored.blob.text()).toBe('original-a');
  });
});

describe('database handle isolation', () => {
  it('creates unopened handles for delete tests', () => {
    const handle = createNotesDetectiveDatabase('notes-detective-test-delete-factory');
    expect(handle.isOpen()).toBe(false);
    handle.close();
  });
});
