// @vitest-environment node

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NewAttachment } from '../../src/data/attachmentStore';
import { CaseRepository } from '../../src/data/caseRepository';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { closeTestDatabase, openTestDatabase } from './testDatabase';

const SHA = 'a'.repeat(64);

function attachment(kind: NewAttachment['kind'], content: string): NewAttachment {
  const blob = new Blob([content], { type: 'image/png' });
  return {
    kind,
    mime: 'image/png',
    width: 1200,
    height: 800,
    bytes: blob.size,
    sha256: SHA,
    blob,
  };
}

function imageSet(label: string): NewAttachment[] {
  return [
    attachment('original', `${label}-original`),
    attachment('display', `${label}-display`),
    attachment('thumbnail', `${label}-thumbnail`),
  ];
}

let db: NotesDetectiveDatabase;
let repository: CaseRepository;

beforeEach(async () => {
  db = await openTestDatabase('case-repository-replace');
  repository = new CaseRepository(db);
});

afterEach(async () => {
  await closeTestDatabase(db);
});

describe('photo replacement transaction', () => {
  it('keeps the card ID, writes exactly one of each kind, and removes the old rows', async () => {
    const owningCase = await repository.createCase({ title: 'Cell Biology Final' });
    const created = await repository.createCardWithAttachments(
      {
        caseId: owningCase.id,
        type: 'note',
        title: 'Photosynthesis',
        position: { x: 40, y: 60 },
        crop: { x: 0, y: 0, width: 1, height: 1 },
        rotation: 0,
      },
      imageSet('first'),
    );
    const oldIds = created.attachments.map((row) => row.id);

    const replaced = await repository.replaceCardAttachments(created.card.id, imageSet('second'), {
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
      rotation: 90,
      retainFullResolution: true,
    });

    expect(replaced.card.id).toBe(created.card.id);
    expect(replaced.cleanupPending).toBeUndefined();
    expect(replaced.card.crop).toEqual({ x: 0.1, y: 0.2, width: 0.7, height: 0.6 });
    expect(replaced.card.rotation).toBe(90);
    expect(replaced.card.retainFullResolution).toBe(true);

    const stored = await repository.listAttachments(created.card.id);
    expect(stored).toHaveLength(3);
    expect(stored.map((row) => row.kind)).toEqual(['original', 'display', 'thumbnail']);
    stored.forEach((row) => expect(oldIds).not.toContain(row.id));
  });

  it('leaves the old image and card metadata intact when the replacement transaction fails', async () => {
    const owningCase = await repository.createCase({ title: 'Cell Biology Final' });
    const created = await repository.createCardWithAttachments(
      {
        caseId: owningCase.id,
        type: 'note',
        title: 'Photosynthesis',
        position: { x: 40, y: 60 },
        crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
        rotation: 180,
      },
      imageSet('first'),
    );
    const oldAttachments = await repository.listAttachments(created.card.id);
    const oldIds = oldAttachments.map((row) => row.id);
    const oldOriginal = oldAttachments.find((row) => row.kind === 'original');
    const firstId = oldIds[0];

    if (oldOriginal === undefined || firstId === undefined) {
      throw new Error('The seeded original attachment is missing');
    }

    const originalBytes = await oldOriginal.blob.text();

    // Reusing an existing primary key makes the first write transaction fail.
    // The new rows and the card metadata must roll back together, and the old
    // original must still be readable for a later retry.
    const conflicting = imageSet('second');
    const [conflictingOriginal] = conflicting;
    if (conflictingOriginal === undefined) {
      throw new Error('The conflicting attachment set is empty');
    }
    conflicting[0] = { ...conflictingOriginal, id: firstId };

    await expect(
      repository.replaceCardAttachments(created.card.id, conflicting, {
        crop: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
        rotation: 270,
      }),
    ).rejects.toBeDefined();

    const afterFailure = await repository.listAttachments(created.card.id);
    expect(afterFailure.map((row) => row.id)).toEqual(oldIds);
    const retainedOriginal = afterFailure.find((row) => row.kind === 'original');
    expect(retainedOriginal).toBeDefined();
    expect(await retainedOriginal?.blob.text()).toBe(originalBytes);

    const cardAfterFailure = await repository.getCard(created.card.id);
    expect(cardAfterFailure?.id).toBe(created.card.id);
    expect(cardAfterFailure?.crop).toEqual({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
    expect(cardAfterFailure?.rotation).toBe(180);

    const retried = await repository.replaceCardAttachments(created.card.id, imageSet('third'), {
      crop: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
      rotation: 270,
    });

    expect(retried.card.id).toBe(created.card.id);
    expect(await repository.listAttachments(created.card.id)).toHaveLength(3);
  });
});
