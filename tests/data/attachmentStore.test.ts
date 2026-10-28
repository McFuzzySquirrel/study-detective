// @vitest-environment node

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NewAttachment } from '../../src/data/attachmentStore';
import { AttachmentStore, buildAttachmentRecord } from '../../src/data/attachmentStore';
import { CaseRepository } from '../../src/data/caseRepository';
import { createNotesDetectiveDatabase } from '../../src/data/db';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { RecordNotFoundError, StorageReadError } from '../../src/data/errors';
import type { CardRecord } from '../../src/domain/model';
import { DomainValidationError } from '../../src/domain/validation';
import { advancingClock } from './testDatabase';
import { closeTestDatabase, openTestDatabase, requireRow } from './testDatabase';

const SHA_256 = 'a'.repeat(64);
const ORIGINAL_ID = '77777777-7777-4777-8777-777777777777';
const DISPLAY_ID = '88888888-8888-4888-8888-888888888888';
const THUMBNAIL_ID = '12121212-1212-4212-8212-121212121212';
const MISSING_CARD_ID = '99999999-9999-4999-8999-999999999999';
const ORPHAN_ATTACHMENT_ID = '13131313-1313-4313-8313-131313131313';

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
let card: CardRecord;

beforeEach(async () => {
  db = await openTestDatabase('attachment-store');
  const clock = advancingClock();
  repository = new CaseRepository(db, { clock });
  store = new AttachmentStore(db, { clock });

  const createdCase = await repository.createCase({ title: 'Cell Biology Final' });
  card = await repository.createCard({
    caseId: createdCase.id,
    type: 'source',
    title: 'Lecture 4',
    position: { x: 0, y: 0 },
  });
});

afterEach(async () => {
  await closeTestDatabase(db);
});

describe('attachment round-trip', () => {
  it('stores original, display, and thumbnail Blobs with their metadata', async () => {
    const originalBlob = pngBlob('original-bytes');
    const displayBlob = pngBlob('display-bytes');
    const thumbnailBlob = pngBlob('thumbnail-bytes');

    const written = await store.addAttachments(card.id, [
      {
        ...attachmentInput({ kind: 'original', id: ORIGINAL_ID, blob: originalBlob }),
        width: 1200,
        height: 800,
      },
      {
        ...attachmentInput({ kind: 'display', id: DISPLAY_ID, blob: displayBlob }),
        width: 800,
        height: 533,
        sha256: 'b'.repeat(64),
      },
      {
        ...attachmentInput({ kind: 'thumbnail', id: THUMBNAIL_ID, blob: thumbnailBlob }),
        width: 320,
        height: 213,
        sha256: 'c'.repeat(64),
      },
    ]);

    expect(written.map((record) => record.kind)).toEqual(['original', 'display', 'thumbnail']);

    const loaded = await store.listAttachments(card.id);
    expect(loaded.map((record) => record.id)).toEqual([ORIGINAL_ID, DISPLAY_ID, THUMBNAIL_ID]);
    expect(loaded.map((record) => record.kind)).toEqual(['original', 'display', 'thumbnail']);

    const original = loaded[0];
    expect(original?.mime).toBe('image/png');
    expect(original?.width).toBe(1200);
    expect(original?.height).toBe(800);
    expect(original?.bytes).toBe(originalBlob.size);
    expect(original?.sha256).toBe(SHA_256);
    expect(original?.blob).toBeInstanceOf(Blob);
    expect(original?.blob.type).toBe('image/png');
    expect(await original?.blob.text()).toBe('original-bytes');

    expect(await loaded[1]?.blob.text()).toBe('display-bytes');
    expect(await loaded[2]?.blob.text()).toBe('thumbnail-bytes');
    expect(loaded[1]?.sha256).toBe('b'.repeat(64));
    expect(loaded[2]?.sha256).toBe('c'.repeat(64));
  });

  it('reads the same rows through a fresh store and by kind', async () => {
    await store.addAttachments(card.id, [
      { ...attachmentInput({ kind: 'original', id: ORIGINAL_ID }) },
      { ...attachmentInput({ kind: 'thumbnail', id: THUMBNAIL_ID }) },
    ]);

    const freshStore = new AttachmentStore(db);
    const thumbnail = await freshStore.getAttachmentByKind(card.id, 'thumbnail');

    expect(thumbnail?.id).toBe(THUMBNAIL_ID);
    expect(await freshStore.getAttachmentByKind(card.id, 'display')).toBeNull();
    expect(await freshStore.getAttachment(ORIGINAL_ID)).not.toBeNull();
    expect(await freshStore.getAttachment(DISPLAY_ID)).toBeNull();
  });

  it('stores one attachment at a time and bumps the owning case timestamp', async () => {
    const before = await repository.getCase(card.caseId);

    const written = await store.addAttachment(card.id, {
      ...attachmentInput({ id: ORIGINAL_ID }),
    });

    expect(written.id).toBe(ORIGINAL_ID);
    expect(await store.listAttachments(card.id)).toEqual([written]);

    const after = await repository.getCase(card.caseId);
    expect(Date.parse(after?.updatedAt ?? '')).toBeGreaterThan(Date.parse(before?.updatedAt ?? ''));
  });

  it('accepts an empty attachment set without writing a row', async () => {
    expect(await store.addAttachments(card.id, [])).toEqual([]);
    expect(await db.attachments.count()).toBe(0);
  });
});

describe('attachment integrity', () => {
  it('refuses to store a Blob for a card that does not exist', async () => {
    await expect(
      store.addAttachments(MISSING_CARD_ID, [attachmentInput({ id: ORIGINAL_ID })]),
    ).rejects.toBeInstanceOf(RecordNotFoundError);

    expect(await db.attachments.count()).toBe(0);
  });

  it('rejects invalid metadata before any row is written', async () => {
    await expect(
      store.addAttachment(card.id, attachmentInput({ bytes: 999 })),
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      store.addAttachment(card.id, attachmentInput({ sha256: 'not-a-digest' })),
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      store.addAttachment(card.id, attachmentInput({ mime: 'image/heic' as never })),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(await db.attachments.count()).toBe(0);
  });

  it('rejects a set that repeats an attachment kind', async () => {
    await expect(
      store.addAttachments(card.id, [
        attachmentInput({ kind: 'original', id: ORIGINAL_ID }),
        attachmentInput({ kind: 'original', id: DISPLAY_ID }),
      ]),
    ).rejects.toThrow('more than one "original" Blob');

    expect(await db.attachments.count()).toBe(0);
  });

  it('rejects a malformed stored attachment on every read path', async () => {
    await store.addAttachment(card.id, attachmentInput({ id: ORIGINAL_ID }));
    const row = await requireRow(db.attachments.get(ORIGINAL_ID));
    await db.attachments.put({ ...row, sha256: 'not-a-digest' });

    await expect(store.getAttachment(ORIGINAL_ID)).rejects.toBeInstanceOf(StorageReadError);
    await expect(store.listAttachments(card.id)).rejects.toBeInstanceOf(StorageReadError);
    await expect(store.getAttachmentByKind(card.id, 'original')).rejects.toBeInstanceOf(
      StorageReadError,
    );
  });

  it('rolls back every attachment when the Blob write fails', async () => {
    const before = await repository.getCase(card.caseId);
    const rejectBulkAdd = vi
      .spyOn(db.attachments, 'bulkAdd')
      .mockRejectedValueOnce(new Error('injected Blob failure'));

    await expect(
      store.addAttachments(card.id, [
        attachmentInput({ kind: 'original', id: ORIGINAL_ID }),
        attachmentInput({ kind: 'display', id: DISPLAY_ID }),
      ]),
    ).rejects.toThrow('injected Blob failure');

    rejectBulkAdd.mockRestore();

    expect(await db.attachments.count()).toBe(0);
    const after = await repository.getCase(card.caseId);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });
});

describe('attachment deletion', () => {
  it('deletes one Blob and reports a repeated delete as false', async () => {
    await store.addAttachment(card.id, attachmentInput({ id: ORIGINAL_ID }));

    expect(await store.deleteAttachment(ORIGINAL_ID)).toBe(true);
    expect(await store.getAttachment(ORIGINAL_ID)).toBeNull();
    expect(await store.deleteAttachment(ORIGINAL_ID)).toBe(false);
  });

  it('cleans up an orphan Blob whose card is already gone', async () => {
    const orphan = buildAttachmentRecord(
      MISSING_CARD_ID,
      attachmentInput({ id: ORPHAN_ATTACHMENT_ID }),
      () => ORIGINAL_ID,
    );
    await db.attachments.add(orphan);

    expect(await store.deleteAttachment(ORPHAN_ATTACHMENT_ID)).toBe(true);
    expect(await db.attachments.count()).toBe(0);
  });
});

describe('database handle isolation', () => {
  it('creates unopened handles for tests and callers', () => {
    const handle = createNotesDetectiveDatabase('notes-detective-test-attachment-factory');
    expect(handle.isOpen()).toBe(false);
    handle.close();
  });
});
