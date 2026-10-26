import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const CASE_TITLE = 'Keyboard link case';
const NOTE_TITLE = 'Membrane transport';
const SOURCE_TITLE = 'Lecture slide 12';
const TOPIC_TITLE = 'Osmosis';

const NOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOPIC_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type StoredConnection = {
  readonly id: string;
  readonly caseId: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly pairKey: string;
  readonly type: string;
};

/** Read the real rows the app wrote; no UI state is trusted as evidence. */
async function readConnections(page: Page): Promise<StoredConnection[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('notes-detective');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result);
    });

    const rows = await new Promise<Record<string, unknown>[]>((resolvePromise, reject) => {
      const transaction = database.transaction('connections', 'readonly');
      const request = transaction.objectStore('connections').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result as Record<string, unknown>[]);
    });

    database.close();

    return rows.map((row) => ({
      id: String(row.id),
      caseId: String(row.caseId),
      fromCardId: String(row.fromCardId),
      toCardId: String(row.toCardId),
      pairKey: String(row.pairKey),
      type: String(row.type),
    }));
  });
}

async function createCaseByKeyboard(page: Page): Promise<string> {
  await page.goto('/');

  const create = page.getByRole('button', { name: /Create your first case/i });
  await create.focus();
  await expect(create).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await dialog.getByRole('textbox', { name: 'Case title' }).fill(CASE_TITLE);
  const submit = dialog.getByRole('button', { name: 'Create case' });
  await submit.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();

  let caseId: string | undefined;
  await expect
    .poll(async () => {
      const rows = await page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
          const request = indexedDB.open('notes-detective');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolvePromise(request.result);
        });
        const records = await new Promise<Record<string, unknown>[]>((resolvePromise, reject) => {
          const transaction = database.transaction('cases', 'readonly');
          const request = transaction.objectStore('cases').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolvePromise(request.result as Record<string, unknown>[]);
        });
        database.close();
        return records.map((row) => ({ id: String(row.id), title: String(row.title) }));
      });

      caseId = rows.find((row) => row.title === CASE_TITLE)?.id;
      return caseId;
    })
    .not.toBeUndefined();

  if (caseId === undefined) {
    throw new Error('The keyboard-created case was not persisted');
  }
  return caseId;
}

/**
 * Seed the three card types directly so this journey exercises only the link
 * workflow. The card list is the accessible surface; no canvas is mounted.
 */
async function seedCards(page: Page, caseId: string): Promise<void> {
  await page.evaluate(
    async ({ targetCaseId, noteId, sourceId, topicId }) => {
      const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
        const request = indexedDB.open('notes-detective');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolvePromise(request.result);
      });

      const timestamp = new Date().toISOString();

      await new Promise<void>((resolvePromise, reject) => {
        const transaction = database.transaction('cards', 'readwrite');
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => resolvePromise();

        const cards = [
          {
            id: noteId,
            caseId: targetCaseId,
            type: 'note',
            title: 'Membrane transport',
            position: { x: 180, y: 240 },
            tags: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          {
            id: sourceId,
            caseId: targetCaseId,
            type: 'source',
            title: 'Lecture slide 12',
            position: { x: 480, y: 240 },
            tags: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          {
            id: topicId,
            caseId: targetCaseId,
            type: 'topic',
            title: 'Osmosis',
            position: { x: 780, y: 240 },
            tags: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ];

        for (const card of cards) {
          transaction.objectStore('cards').add(card);
        }
      });

      database.close();
    },
    { targetCaseId: caseId, noteId: NOTE_ID, sourceId: SOURCE_ID, topicId: TOPIC_ID },
  );
}

async function pressButton(page: Page, scope: Page | Locator, name: string | RegExp) {
  const button = scope.getByRole('button', { name });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
}

async function chooseRadio(page: Page, scope: Page | Locator, name: string | RegExp) {
  const radio = scope.getByRole('radio', { name });
  await radio.focus();
  await expect(radio).toBeFocused();
  await page.keyboard.press(' ');
  await expect(radio).toBeChecked();
}

test('creates, retypes, and deletes links from the card list with no canvas interaction', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const caseId = await createCaseByKeyboard(page);
  await seedCards(page, caseId);

  await page.goto(`/#/case/${caseId}/list`);
  await expect(page.getByRole('heading', { level: 2, name: 'Card list' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 4, name: NOTE_TITLE })).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toHaveCount(0);

  // 1. Association: Note -> Topic, using the searchable target list.
  await pressButton(page, page, `Connect to… for ${NOTE_TITLE}`);
  const associationDialog = page.getByRole('dialog', { name: 'Connect to a card' });
  await expect(associationDialog).toBeVisible();

  const associationSearch = associationDialog.getByRole('searchbox', {
    name: 'Find a target card',
  });
  await expect(associationSearch).toBeFocused();
  await page.keyboard.type(TOPIC_TITLE);
  await expect(associationDialog.getByRole('status')).toHaveText(
    `1 of 2 targets match “${TOPIC_TITLE}”.`,
  );
  await chooseRadio(page, associationDialog, TOPIC_TITLE);

  await pressButton(page, associationDialog, 'Save');
  await expect(associationDialog).toBeHidden();
  await expect(page.getByRole('button', { name: `Connect to… for ${NOTE_TITLE}` })).toBeFocused();

  await expect.poll(async () => (await readConnections(page)).length, { timeout: 10_000 }).toBe(1);
  let rows = await readConnections(page);
  expect(rows[0]).toMatchObject({
    fromCardId: NOTE_ID,
    toCardId: TOPIC_ID,
    type: 'association',
  });

  // 2. Provenance: Attach source starts on Provenance and filters to Sources.
  await pressButton(page, page, `Attach source to ${NOTE_TITLE}`);
  const provenanceDialog = page.getByRole('dialog', { name: 'Attach a source' });
  await expect(provenanceDialog).toBeVisible();
  await expect(provenanceDialog.getByRole('radio', { name: 'Provenance' })).toBeChecked();
  await expect(provenanceDialog.getByRole('radio', { name: TOPIC_TITLE })).toHaveCount(0);

  const provenanceSearch = provenanceDialog.getByRole('searchbox', {
    name: 'Find a target card',
  });
  await provenanceSearch.focus();
  await page.keyboard.type('Lecture');
  await chooseRadio(page, provenanceDialog, SOURCE_TITLE);
  await pressButton(page, provenanceDialog, 'Save');

  await expect(provenanceDialog).toBeHidden();
  await expect(page.getByRole('button', { name: `Attach source to ${NOTE_TITLE}` })).toBeFocused();

  await expect.poll(async () => (await readConnections(page)).length, { timeout: 10_000 }).toBe(2);
  rows = await readConnections(page);
  expect(rows.map((row) => row.type).sort()).toEqual(['association', 'provenance']);
  expect(new Set(rows.map((row) => row.pairKey)).size).toBe(2);

  const provenanceRow = rows.find((row) => row.type === 'provenance');
  if (provenanceRow === undefined) {
    throw new Error('The provenance row was not stored');
  }

  // 3. Retype the provenance row to association without changing its ID.
  // Reopen the picker from the list, then choose the existing row.
  await pressButton(page, page, `Connect to… for ${NOTE_TITLE}`);
  const retypePicker = page.getByRole('dialog', { name: 'Connect to a card' });
  await expect(retypePicker).toBeVisible();
  await pressButton(page, retypePicker, `Edit connection with ${SOURCE_TITLE}`);
  const retypeDialog = page.getByRole('dialog', { name: 'Manage connection' });
  await expect(retypeDialog).toBeVisible();

  const associationRadio = retypeDialog.getByRole('radio', { name: 'Association' });
  await expect(associationRadio).toBeFocused();
  await page.keyboard.press(' ');
  await expect(associationRadio).toBeChecked();
  await pressButton(page, retypeDialog, 'Save');

  await expect(retypeDialog).toBeHidden();
  await expect
    .poll(
      async () => (await readConnections(page)).find((row) => row.id === provenanceRow.id)?.type,
      {
        timeout: 10_000,
      },
    )
    .toBe('association');

  // 4. Delete the retyped row through the explicit confirmation.
  await pressButton(page, page, `Connect to… for ${NOTE_TITLE}`);
  const deletePicker = page.getByRole('dialog', { name: 'Connect to a card' });
  await expect(deletePicker).toBeVisible();
  await pressButton(page, deletePicker, `Edit connection with ${SOURCE_TITLE}`);
  const deleteDialog = page.getByRole('dialog', { name: 'Manage connection' });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog.getByRole('radio', { name: 'Association' })).toBeChecked();

  await pressButton(page, deleteDialog, 'Delete connection');
  await expect(deleteDialog.getByRole('button', { name: 'Keep connection' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(deleteDialog.getByRole('button', { name: 'Delete connection' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(deleteDialog).toBeHidden();
  await expect.poll(async () => (await readConnections(page)).length, { timeout: 10_000 }).toBe(1);

  const remaining = await readConnections(page);
  expect(remaining).toHaveLength(1);
  expect(remaining[0]).toMatchObject({
    fromCardId: NOTE_ID,
    toCardId: TOPIC_ID,
    type: 'association',
  });
  expect(remaining[0]?.id).not.toBe(provenanceRow.id);

  // 5. Reload and reopen the picker: the surviving row is read from IndexedDB.
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Card list' })).toBeVisible();
  await pressButton(page, page, `Connect to… for ${NOTE_TITLE}`);
  const reloadedDialog = page.getByRole('dialog', { name: 'Connect to a card' });
  await expect(reloadedDialog).toBeVisible();
  await expect(
    reloadedDialog.getByRole('button', { name: `Edit connection with ${TOPIC_TITLE}` }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(reloadedDialog).toBeHidden();
  await expect(page.getByRole('button', { name: `Connect to… for ${NOTE_TITLE}` })).toBeFocused();

  // 6. The same picker is reachable from card detail, with the same focus return.
  await page.goto(`/#/case/${caseId}/card/${NOTE_ID}`);
  await expect(page.getByRole('heading', { level: 2, name: NOTE_TITLE })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach source' })).toBeVisible();

  await pressButton(page, page, 'Connect to…');
  const detailDialog = page.getByRole('dialog', { name: 'Connect to a card' });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByRole('searchbox', { name: 'Find a target card' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(detailDialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Connect to…' })).toBeFocused();

  expect(await readConnections(page)).toHaveLength(1);
  expect(consoleErrors).toEqual([]);
});
