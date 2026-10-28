import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const specDirectory = dirname(fileURLToPath(import.meta.url));
const noteFixture = resolve(specDirectory, 'fixtures', 'note.png');
const sourceFixture = resolve(specDirectory, 'fixtures', 'source.png');

const CASE_TITLE = 'Keyboard journey case';
const NOTE_TITLE = 'Keyboard membrane note';
const EDITED_NOTE_TITLE = 'Keyboard membrane note revised';
const SOURCE_TITLE = 'Keyboard lecture source';
const TOPIC_TITLE = 'Keyboard osmosis topic';

type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly type: string;
  readonly title: string;
};

type StoredConnection = {
  readonly id: string;
  readonly caseId: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly pairKey: string;
  readonly type: string;
};

type StoredGraph = {
  readonly cases: Array<{ readonly id: string; readonly title: string }>;
  readonly cards: StoredCard[];
  readonly connections: StoredConnection[];
};

/** Read the real rows the app wrote; UI state is never trusted as evidence. */
async function readGraph(page: Page): Promise<StoredGraph> {
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

    const [cases, cards, connections] = await Promise.all([
      readAll('cases'),
      readAll('cards'),
      readAll('connections'),
    ]);

    database.close();

    return {
      cases: cases.map((row) => ({ id: String(row.id), title: String(row.title) })),
      cards: cards.map((row) => ({
        id: String(row.id),
        caseId: String(row.caseId),
        type: String(row.type),
        title: String(row.title),
      })),
      connections: connections.map((row) => ({
        id: String(row.id),
        caseId: String(row.caseId),
        fromCardId: String(row.fromCardId),
        toCardId: String(row.toCardId),
        pairKey: String(row.pairKey),
        type: String(row.type),
      })),
    };
  });
}

async function focusAndEnter(page: Page, target: Locator): Promise<void> {
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
}

async function typeInto(page: Page, target: Locator, text: string): Promise<void> {
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.type(text);
}

async function createCase(page: Page): Promise<string> {
  await page.goto('/');

  const create = page.getByRole('button', { name: /Create your first case/i });
  await focusAndEnter(page, create);

  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await typeInto(page, dialog.getByRole('textbox', { name: 'Case title' }), CASE_TITLE);
  await focusAndEnter(page, dialog.getByRole('button', { name: 'Create case' }));

  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();

  let caseId: string | undefined;
  await expect
    .poll(async () => {
      const graph = await readGraph(page);
      caseId = graph.cases.find((record) => record.title === CASE_TITLE)?.id;
      return caseId;
    })
    .not.toBeUndefined();

  if (caseId === undefined) {
    throw new Error('The keyboard-created case was not persisted');
  }

  return caseId;
}

async function createImageCard(
  page: Page,
  caseId: string,
  kind: 'note' | 'source',
  fixture: string,
  title: string,
): Promise<void> {
  await page.goto(`/#/case/${caseId}/capture?kind=${kind}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Capture evidence' })).toBeVisible();

  await page.setInputFiles('[data-testid="capture-choose-photo"]', fixture);
  await expect(page.getByRole('heading', { name: 'Crop and rotate' })).toBeVisible();
  await focusAndEnter(page, page.getByRole('button', { name: 'Use this crop' }));

  await expect(page.getByRole('heading', { name: 'Name the card' })).toBeVisible();
  await typeInto(page, page.getByRole('textbox', { name: 'Title' }), title);
  await focusAndEnter(page, page.getByRole('button', { name: 'Save card' }));

  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible({
    timeout: 30_000,
  });
}

async function createTopic(page: Page, caseId: string, title: string): Promise<void> {
  await page.goto(`/#/case/${caseId}/capture?kind=topic`);
  await expect(page.getByRole('heading', { name: 'Add a topic' })).toBeVisible();
  await typeInto(page, page.getByRole('textbox', { name: 'Topic title' }), title);
  await focusAndEnter(page, page.getByRole('button', { name: 'Add topic' }));

  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible({
    timeout: 30_000,
  });
}

/** Recall lives in the Case menu on both compositions. */
async function enterRecall(page: Page): Promise<void> {
  await focusAndEnter(page, page.getByRole('button', { name: 'Case menu' }));
  const menu = page.getByRole('dialog', { name: 'Case menu' });
  await focusAndEnter(page, menu.getByRole('link', { name: 'Recall' }));

  await expect(page.getByRole('heading', { level: 2, name: 'Recall' })).toBeVisible();
}

test('completes the non-spatial case workflow with the keyboard only', async ({ page }) => {
  test.setTimeout(180_000);

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const caseId = await createCase(page);

  // Create all three card kinds through the real capture route. Choosing files
  // is a file-input operation, never a pointer drag or canvas gesture.
  await createImageCard(page, caseId, 'note', noteFixture, NOTE_TITLE);
  await createImageCard(page, caseId, 'source', sourceFixture, SOURCE_TITLE);
  await createTopic(page, caseId, TOPIC_TITLE);

  await page.goto(`/#/case/${caseId}/list`);
  await expect(page.getByRole('heading', { level: 2, name: 'Card list' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 4, name: NOTE_TITLE })).toBeVisible();

  // 1. ? opens help, Escape closes it, and focus returns to the trigger.
  const openNote = page.getByRole('link', { name: `Open detail for ${NOTE_TITLE}` });
  await openNote.focus();
  await expect(openNote).toBeFocused();
  await page.keyboard.type('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.getByText('Connect the focused card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(openNote).toBeFocused();

  // 2. [ and ] move focus through the keyboard card list.
  await page.keyboard.press(']');
  await expect(page.getByRole('link', { name: `Open detail for ${SOURCE_TITLE}` })).toBeFocused();
  await page.keyboard.press('[');
  await expect(openNote).toBeFocused();

  // 3. Edit the note title through the dialog, with focus returning to Edit.
  await focusAndEnter(page, page.getByRole('button', { name: `Edit ${NOTE_TITLE}` }));
  const editDialog = page.getByRole('dialog', { name: 'Edit card title' });
  const editTitle = editDialog.getByRole('textbox', { name: 'Card title' });
  await editTitle.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(EDITED_NOTE_TITLE);
  await focusAndEnter(page, editDialog.getByRole('button', { name: 'Save title' }));

  await expect(editDialog).toBeHidden();
  await expect(page.getByRole('button', { name: `Edit ${EDITED_NOTE_TITLE}` })).toBeFocused();
  await expect(page.getByRole('heading', { level: 4, name: EDITED_NOTE_TITLE })).toBeVisible();

  // 4. Attach provenance from the note to the source.
  const attach = page.getByRole('button', { name: `Attach source to ${EDITED_NOTE_TITLE}` });
  await focusAndEnter(page, attach);
  const provenanceDialog = page.getByRole('dialog', { name: 'Attach a source' });
  await expect(provenanceDialog.getByRole('radio', { name: 'Provenance' })).toBeChecked();
  await expect(provenanceDialog.getByRole('radio', { name: TOPIC_TITLE })).toHaveCount(0);

  await page.keyboard.type('Keyboard lecture');
  const sourceTarget = provenanceDialog.getByRole('radio', { name: SOURCE_TITLE });
  await sourceTarget.focus();
  await page.keyboard.press('Space');
  await expect(sourceTarget).toBeChecked();
  await focusAndEnter(page, provenanceDialog.getByRole('button', { name: 'Save' }));

  await expect(provenanceDialog).toBeHidden();
  await expect(attach).toBeFocused();
  await expect.poll(async () => (await readGraph(page)).connections.length).toBe(1);

  let graph = await readGraph(page);
  const provenance = graph.connections[0];
  expect(provenance?.type).toBe('provenance');
  if (provenance === undefined) {
    throw new Error('The provenance row was not stored');
  }

  // 5. Create an association with the c shortcut from the focused note row.
  await page.getByRole('link', { name: `Open detail for ${EDITED_NOTE_TITLE}` }).focus();
  await page.keyboard.press('c');
  const associationDialog = page.getByRole('dialog', { name: 'Connect to a card' });
  await expect(associationDialog).toBeVisible();
  await expect(
    associationDialog.getByRole('searchbox', { name: 'Find a target card' }),
  ).toBeFocused();

  await page.keyboard.type(TOPIC_TITLE);
  const topicTarget = associationDialog.getByRole('radio', { name: TOPIC_TITLE });
  await topicTarget.focus();
  await page.keyboard.press('Space');
  await expect(topicTarget).toBeChecked();
  await focusAndEnter(page, associationDialog.getByRole('button', { name: 'Save' }));

  await expect(associationDialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: `Connect to… for ${EDITED_NOTE_TITLE}` }),
  ).toBeFocused();
  await expect.poll(async () => (await readGraph(page)).connections.length).toBe(2);

  // 6. Retype the provenance row to an association; the ID and pair survive.
  await focusAndEnter(
    page,
    page.getByRole('button', { name: `Connect to… for ${EDITED_NOTE_TITLE}` }),
  );
  const picker = page.getByRole('dialog', { name: 'Connect to a card' });
  await focusAndEnter(
    page,
    picker.getByRole('button', { name: `Edit connection with ${SOURCE_TITLE}` }),
  );

  const manage = page.getByRole('dialog', { name: 'Manage connection' });
  const associationRadio = manage.getByRole('radio', { name: 'Association' });
  await expect(associationRadio).toBeFocused();
  await page.keyboard.press('Space');
  await expect(associationRadio).toBeChecked();
  await focusAndEnter(page, manage.getByRole('button', { name: 'Save' }));

  await expect(manage).toBeHidden();
  await expect
    .poll(
      async () =>
        (await readGraph(page)).connections.find((connection) => connection.id === provenance.id)
          ?.type,
      { timeout: 10_000 },
    )
    .toBe('association');

  // 7. / focuses search; typing ? stays in the field; Escape clears it.
  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: 'Search cards' });
  await expect(search).toBeFocused();

  await page.keyboard.type('revised');
  await expect(page.getByText('1 card matches your search.')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();

  await page.keyboard.type('?');
  await expect(help).toBeHidden();
  await expect(search).toHaveValue('?');
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');

  // 8. Search again, choose a result with the keyboard, and land on the board.
  await page.keyboard.type(TOPIC_TITLE);
  await expect(page.getByText('1 card matches your search.')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  const topicResult = page.getByRole('button', {
    name: `Select ${TOPIC_TITLE} from search results`,
  });
  await expect(topicResult).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();

  // The canvas is a named region with a text description and a visible,
  // keyboard-operable alternative. Spatial placement is not claimed.
  const canvasHost = page.getByTestId('board-canvas-host');
  await expect(canvasHost).toHaveAttribute('aria-label', 'Case board canvas');
  await expect(canvasHost).toHaveAccessibleDescription(
    /Case board with 3 cards arranged spatially\. Use Open card list for a keyboard-operable view\./,
  );
  if ((page.viewportSize()?.width ?? 1440) < 600) {
    await page.getByRole('button', { name: 'Case menu' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Case menu' }).getByRole('link', { name: 'Open card list' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  } else {
    await expect(page.getByTestId('open-card-list')).toBeVisible();
  }

  // 9. Enter recall, check, reset, and exit without touching the canvas.
  await enterRecall(page);
  await focusAndEnter(page, page.getByRole('button', { name: 'Check' }));

  await expect(page.getByRole('heading', { level: 3, name: 'Recall results' })).toBeFocused();
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-checked', 'true');
  await expect(page.getByTestId('recall-announcement')).not.toBeEmpty();

  await focusAndEnter(page, page.getByRole('button', { name: 'Reset scratch' }));
  await expect(page.getByRole('button', { name: 'Check' })).toBeFocused();
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-checked', 'false');

  await focusAndEnter(page, page.getByRole('button', { name: 'Exit recall' }));
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();

  // 10. Delete a card and restore it with the 8-second Undo action.
  await page.goto(`/#/case/${caseId}/list`);
  await expect(page.getByRole('heading', { level: 2, name: 'Card list' })).toBeVisible();
  await focusAndEnter(page, page.getByRole('button', { name: `Delete ${TOPIC_TITLE}` }));

  const deleteDialog = page.getByRole('dialog', { name: /Delete .*Keyboard osmosis topic/ });
  await expect(deleteDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await focusAndEnter(page, deleteDialog.getByRole('button', { name: 'Delete card' }));
  await expect(deleteDialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 4, name: TOPIC_TITLE })).toHaveCount(0);

  await focusAndEnter(page, page.getByRole('button', { name: 'Undo' }));
  await expect(page.getByRole('heading', { level: 4, name: TOPIC_TITLE })).toBeVisible();
  await expect(page.getByRole('link', { name: `Open detail for ${TOPIC_TITLE}` })).toBeFocused();

  graph = await readGraph(page);
  expect(graph.cards.filter((record) => record.caseId === caseId)).toHaveLength(3);
  expect(graph.connections).toHaveLength(2);
  expect(consoleErrors).toEqual([]);
});
