import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const CASE_TITLE = 'Keyboard card case';
const TOPIC_TITLE = 'Membrane transport';
const SOURCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONNECTION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ATTACHMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SHA_256 = 'a'.repeat(64);

type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly type: string;
  readonly title: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly tags: string[];
};

type StoredConnection = {
  readonly id: string;
  readonly caseId: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly pairKey: string;
  readonly type: string;
};

type StoredAttachment = {
  readonly id: string;
  readonly cardId: string;
  readonly kind: string;
};

type Snapshot = {
  readonly cases: Array<{ readonly id: string; readonly title: string }>;
  readonly cards: StoredCard[];
  readonly connections: StoredConnection[];
  readonly attachments: StoredAttachment[];
};

/** Read the real rows the app wrote, with Blobs reduced to metadata. */
async function readSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('notes-detective');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result);
    });

    const readAll = (storeName: string): Promise<Record<string, unknown>[]> =>
      new Promise((resolvePromise, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () =>
          resolvePromise(request.result as unknown as Record<string, unknown>[]);
      });

    const [caseRows, cardRows, connectionRows, attachmentRows] = await Promise.all([
      readAll('cases'),
      readAll('cards'),
      readAll('connections'),
      readAll('attachments'),
    ]);

    database.close();

    return {
      cases: caseRows.map((row) => ({ id: String(row.id), title: String(row.title) })),
      cards: cardRows.map((row) => {
        const position = row.position as { x?: unknown; y?: unknown } | undefined;
        return {
          id: String(row.id),
          caseId: String(row.caseId),
          type: String(row.type),
          title: String(row.title),
          position: { x: Number(position?.x ?? 0), y: Number(position?.y ?? 0) },
          tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
        };
      }),
      connections: connectionRows.map((row) => ({
        id: String(row.id),
        caseId: String(row.caseId),
        fromCardId: String(row.fromCardId),
        toCardId: String(row.toCardId),
        pairKey: String(row.pairKey),
        type: String(row.type),
      })),
      attachments: attachmentRows.map((row) => ({
        id: String(row.id),
        cardId: String(row.cardId),
        kind: String(row.kind),
      })),
    };
  });
}

/** Focus a control and activate it with the keyboard; never uses the mouse. */
async function activateByKeyboard(page: Page, label: string | RegExp): Promise<void> {
  const control = page.getByRole('button', { name: label });
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press('Enter');
}

async function createCaseByKeyboard(page: Page): Promise<string> {
  await page.goto('/');

  await activateByKeyboard(page, /Create your first case/i);
  await page.getByRole('textbox', { name: 'Case title' }).fill(CASE_TITLE);
  await activateByKeyboard(page, 'Create case');

  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();

  let caseId: string | undefined;
  await expect
    .poll(async () => {
      const snapshot = await readSnapshot(page);
      caseId = snapshot.cases.find((item) => item.title === CASE_TITLE)?.id;
      return caseId;
    })
    .not.toBeUndefined();

  if (caseId === undefined) {
    throw new Error('The keyboard-created case was not persisted');
  }
  return caseId;
}

async function createTopicByKeyboard(page: Page, caseId: string): Promise<void> {
  await page.goto(`/#/case/${caseId}/capture?kind=topic`);
  await expect(page.getByRole('heading', { level: 3, name: 'Add a topic' })).toBeVisible();

  const title = page.getByRole('textbox', { name: 'Topic title' });
  await title.focus();
  await page.keyboard.type(TOPIC_TITLE);

  await activateByKeyboard(page, 'Add topic');

  await expect
    .poll(async () => (await readSnapshot(page)).cards.length, { timeout: 15_000 })
    .toBe(1);
}

/**
 * Add one source and one association so the deletion confirmation has a real
 * string to name and undo can be proven to bring both endpoints back.
 */
async function seedStringAndAttachment(page: Page, caseId: string): Promise<void> {
  await page.evaluate(
    async ({ targetCaseId, sourceId, connectionId, attachmentId, sha256 }) => {
      const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
        const request = indexedDB.open('notes-detective');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolvePromise(request.result);
      });

      const cards = await new Promise<Record<string, unknown>[]>((resolvePromise, reject) => {
        const transaction = database.transaction('cards', 'readonly');
        const request = transaction.objectStore('cards').getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolvePromise(request.result as Record<string, unknown>[]);
      });

      const topic = cards.find((card) => card.caseId === targetCaseId);
      if (topic === undefined) {
        throw new Error('The topic card was not found');
      }
      const topicId = String(topic.id);
      const pairKey = topicId <= sourceId ? `${topicId}::${sourceId}` : `${sourceId}::${topicId}`;
      const timestamp = new Date().toISOString();
      const blob = new Blob(['seeded-display'], { type: 'image/png' });

      await new Promise<void>((resolvePromise, reject) => {
        const transaction = database.transaction(
          ['cards', 'connections', 'attachments'],
          'readwrite',
        );
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => resolvePromise();

        transaction.objectStore('cards').add({
          id: sourceId,
          caseId: targetCaseId,
          type: 'source',
          title: 'Seeded lecture slide',
          position: { x: 520, y: 260 },
          tags: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        transaction.objectStore('connections').add({
          id: connectionId,
          caseId: targetCaseId,
          fromCardId: topicId,
          toCardId: sourceId,
          pairKey,
          type: 'association',
        });

        transaction.objectStore('attachments').add({
          id: attachmentId,
          cardId: topicId,
          kind: 'display',
          mime: 'image/png',
          width: 1200,
          height: 800,
          bytes: blob.size,
          sha256,
          blob,
        });
      });

      database.close();
    },
    {
      targetCaseId: caseId,
      sourceId: SOURCE_ID,
      connectionId: CONNECTION_ID,
      attachmentId: ATTACHMENT_ID,
      sha256: SHA_256,
    },
  );

  await expect
    .poll(async () => (await readSnapshot(page)).connections.length, { timeout: 10_000 })
    .toBe(1);
}

test('deletes a card and restores it from the undo toast with the keyboard only', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const caseId = await createCaseByKeyboard(page);
  await createTopicByKeyboard(page, caseId);
  await seedStringAndAttachment(page, caseId);

  const before = await readSnapshot(page);
  const topic = before.cards.find((card) => card.title === TOPIC_TITLE);
  if (topic === undefined) {
    throw new Error('The topic card disappeared before deletion');
  }

  await page.goto(`/#/case/${caseId}/list`);
  await expect(page.getByRole('heading', { level: 2, name: 'Card list' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 4, name: TOPIC_TITLE })).toBeVisible();

  // Delete opens with focus on Cancel. Move to the destructive action by Tab.
  await activateByKeyboard(page, `Delete ${TOPIC_TITLE}`);
  const dialog = page.getByRole('dialog', { name: `Delete “${TOPIC_TITLE}”?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('1 string');
  await expect(dialog).toContainText('Undo stays available for 8 seconds');
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Delete card' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 4, name: TOPIC_TITLE })).toBeHidden();

  await expect(page.getByText(/Card deleted: .*1 string removed/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Card list' })).toBeFocused();

  const afterDelete = await readSnapshot(page);
  expect(afterDelete.cards.some((card) => card.id === topic.id)).toBe(false);
  expect(afterDelete.cards.some((card) => card.id === SOURCE_ID)).toBe(true);
  expect(afterDelete.connections).toHaveLength(0);
  expect(afterDelete.attachments).toHaveLength(0);

  // The toast action is reachable without ever moving the pointer.
  const undo = page.getByRole('button', { name: 'Undo' });
  await undo.focus();
  await expect(undo).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByText(/Card restored: .*Membrane transport/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 4, name: TOPIC_TITLE })).toBeVisible();
  await expect(page.getByRole('link', { name: `Open detail for ${TOPIC_TITLE}` })).toBeFocused();

  const afterUndo = await readSnapshot(page);
  const restored = afterUndo.cards.find((card) => card.id === topic.id);
  expect(restored?.title).toBe(TOPIC_TITLE);
  expect(restored?.position).toEqual(topic.position);
  expect(restored?.tags).toEqual(topic.tags);
  expect(afterUndo.connections.map((connection) => connection.id)).toEqual([CONNECTION_ID]);
  expect(afterUndo.attachments.map((attachment) => attachment.id)).toEqual([ATTACHMENT_ID]);

  expect(consoleErrors).toEqual([]);
});
