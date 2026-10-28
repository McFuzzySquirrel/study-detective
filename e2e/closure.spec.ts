import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const specDirectory = dirname(fileURLToPath(import.meta.url));
const noteFixture = resolve(specDirectory, 'fixtures', 'note.png');
const sourceFixture = resolve(specDirectory, 'fixtures', 'source.png');

const CASE_TITLE = 'Closure journey case';
const NOTE_TITLE = 'Membrane transport';
const SOURCE_TITLE = 'Lecture handout';
const TOPIC_TITLE = 'Osmosis';
const LOOSE_NOTE_TITLE = 'Loose addition';

async function readCaseClosedAt(page: Page, caseId: string): Promise<string | null> {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('notes-detective');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result);
    });

    const row = await new Promise<Record<string, unknown> | undefined>((resolvePromise, reject) => {
      const transaction = database.transaction('cases', 'readonly');
      const request = transaction.objectStore('cases').get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () =>
        resolvePromise(request.result as Record<string, unknown> | undefined);
    });

    database.close();

    if (row === undefined || row.closedAt === null || row.closedAt === undefined) {
      return null;
    }
    return String(row.closedAt);
  }, caseId);
}

async function createCase(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /Create your first case/i }).click();

  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await dialog.getByRole('textbox', { name: 'Case title' }).fill(CASE_TITLE);
  await dialog.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();

  const caseId = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('notes-detective');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result);
    });

    const rows = await new Promise<Record<string, unknown>[]>((resolvePromise, reject) => {
      const transaction = database.transaction('cases', 'readonly');
      const request = transaction.objectStore('cases').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result as Record<string, unknown>[]);
    });

    database.close();

    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('The created case was not persisted');
    }
    return String(id);
  });

  return caseId;
}

async function waitForBoardReady(page: Page, cardCount: number): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-card-count',
    String(cardCount),
    { timeout: 30_000 },
  );

  // The closure surface is the readiness chip's persistent panel, not a
  // permanent column. Open it for the assertions that follow.
  await page.getByRole('button', { name: /^Readiness:/ }).click();
  await expect(page.getByTestId('closure-panel')).toBeVisible({ timeout: 30_000 });
}

async function goToShelf(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Case shelf' })
    .click();
}

async function addImageCard(
  page: Page,
  caseId: string,
  kind: 'note' | 'source',
  fixture: string,
  title: string,
  expectedCount: number,
): Promise<void> {
  await page.goto(`/#/case/${caseId}/capture?kind=${kind}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Capture evidence' })).toBeVisible();

  await page.setInputFiles('[data-testid="capture-choose-photo"]', fixture);
  await expect(page.getByRole('heading', { name: 'Crop and rotate' })).toBeVisible();
  await page.getByRole('button', { name: 'Use this crop' }).click();
  await expect(page.getByRole('heading', { name: 'Name the card' })).toBeVisible();

  if (kind === 'source') {
    await expect(page.getByRole('combobox', { name: 'Card type' })).toHaveValue('source');
  }

  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('button', { name: 'Save card' }).click();
  await waitForBoardReady(page, expectedCount);
}

async function addTopic(
  page: Page,
  caseId: string,
  title: string,
  expectedCount: number,
): Promise<void> {
  await page.goto(`/#/case/${caseId}/capture?kind=topic`);
  await expect(page.getByRole('heading', { level: 2, name: 'Capture evidence' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Topic title' }).fill(title);
  await page.getByRole('button', { name: 'Add topic' }).click();
  await waitForBoardReady(page, expectedCount);
}

async function connectFromList(
  page: Page,
  caseId: string,
  fromTitle: string,
  targetTitle: string,
  intent: 'connect' | 'attach-source',
): Promise<void> {
  await page.goto(`/#/case/${caseId}/list`);
  await expect(page.getByRole('heading', { level: 2, name: 'Card list' })).toBeVisible();

  const trigger =
    intent === 'attach-source'
      ? page.getByRole('button', { name: `Attach source to ${fromTitle}` })
      : page.getByRole('button', { name: `Connect to… for ${fromTitle}` });
  await trigger.click();

  const dialog = page.getByRole('dialog', {
    name: intent === 'attach-source' ? 'Attach a source' : 'Connect to a card',
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: targetTitle }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).not.toBeVisible();
}

test('closes a complete case, survives a loose edit, repairs it, and reopens', async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 1440) < 600,
    'The phone closure sheet is covered by the responsive and accessibility suites.',
  );
  test.setTimeout(240_000);

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const caseId = await createCase(page);
  await addImageCard(page, caseId, 'note', noteFixture, NOTE_TITLE, 1);
  await addImageCard(page, caseId, 'source', sourceFixture, SOURCE_TITLE, 2);
  await addTopic(page, caseId, TOPIC_TITLE, 3);

  // Build a structurally complete graph through the keyboard card list, not
  // the canvas: one association to the topic and one provenance link.
  await connectFromList(page, caseId, NOTE_TITLE, TOPIC_TITLE, 'connect');
  await connectFromList(page, caseId, NOTE_TITLE, SOURCE_TITLE, 'attach-source');

  await page.goto(`/#/case/${caseId}`);
  await waitForBoardReady(page, 3);

  const panel = page.getByTestId('closure-panel');
  await expect(panel).toHaveAttribute('data-closure-state', 'open-ready');
  await expect(panel.getByRole('status')).toHaveText('Ready to close');

  // Close requires a quiet confirmation, then stamps the case.
  await panel.getByRole('button', { name: 'Close case' }).click();
  const closeDialog = page.getByRole('dialog', { name: 'Close this case?' });
  await expect(closeDialog).toBeVisible();
  await expect(closeDialog.getByRole('button', { name: 'Keep open' })).toBeFocused();
  await closeDialog.getByRole('button', { name: 'Close case' }).click();

  await expect(panel).toHaveAttribute('data-closure-state', 'closed-ready');
  await expect(panel.getByTestId('closure-badge')).toContainText('Closed');
  await expect(panel.getByText('Ready to close')).toBeVisible();

  const closedAt = await readCaseClosedAt(page, caseId);
  expect(closedAt).not.toBeNull();

  // The shelf shows the same closure badge.
  await goToShelf(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible();
  const shelfCard = page.locator('article').filter({ hasText: CASE_TITLE });
  await expect(shelfCard.getByText('Closed', { exact: true })).toBeVisible();

  // A new loose card is allowed on a closed case. It breaks readiness but must
  // never clear closedAt or silently reopen the case.
  await shelfCard.getByRole('link', { name: CASE_TITLE }).click();
  await waitForBoardReady(page, 3);
  await addImageCard(page, caseId, 'note', noteFixture, LOOSE_NOTE_TITLE, 4);

  await expect(panel).toHaveAttribute('data-closure-state', 'closed-loose');
  await expect(panel.getByTestId('closure-badge')).toContainText('Closed · loose threads');
  await expect(panel.getByRole('status')).toHaveText('1 loose thread');
  await expect(panel.getByText(LOOSE_NOTE_TITLE)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Close again' })).toBeDisabled();
  expect(await readCaseClosedAt(page, caseId)).toBe(closedAt);

  // The shelf carries the same warning without changing the closure date.
  await goToShelf(page);
  const brokenShelfCard = page.locator('article').filter({ hasText: CASE_TITLE });
  await expect(brokenShelfCard.getByText('Closed · loose threads')).toBeVisible();

  // Repair the new note with both required links. Close becomes available
  // again, still closed, without reopening first.
  await connectFromList(page, caseId, LOOSE_NOTE_TITLE, TOPIC_TITLE, 'connect');
  await connectFromList(page, caseId, LOOSE_NOTE_TITLE, SOURCE_TITLE, 'attach-source');

  await page.goto(`/#/case/${caseId}`);
  await waitForBoardReady(page, 4);
  await expect(panel).toHaveAttribute('data-closure-state', 'closed-ready');
  await expect(panel.getByTestId('closure-badge')).toContainText('Closed');
  await expect(panel.getByRole('button', { name: 'Close again' })).toBeEnabled();
  expect(await readCaseClosedAt(page, caseId)).toBe(closedAt);

  // Reopen is manual and confirmed; the closed date is cleared only here.
  await panel.getByRole('button', { name: 'Reopen case' }).click();
  const reopenDialog = page.getByRole('dialog', { name: 'Reopen this case?' });
  await expect(reopenDialog).toBeVisible();
  await expect(reopenDialog.getByRole('button', { name: 'Keep closed' })).toBeFocused();
  await reopenDialog.getByRole('button', { name: 'Reopen case' }).click();

  await expect(panel).toHaveAttribute('data-closure-state', 'open-ready');
  await expect(panel.getByTestId('closure-badge')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Reopen case' })).toHaveCount(0);
  expect(await readCaseClosedAt(page, caseId)).toBeNull();

  await goToShelf(page);
  const reopenedCard = page.locator('article').filter({ hasText: CASE_TITLE });
  await expect(reopenedCard).toBeVisible();
  await expect(reopenedCard.getByText('Closed', { exact: true })).toHaveCount(0);
  await expect(reopenedCard.getByText(/loose thread/i)).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});
