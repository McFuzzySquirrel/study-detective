import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// This is the one journey that must start with no localStorage or IndexedDB
// at all. Every other project test inherits the no-demo install flag fixture.
test.use({ storageState: { cookies: [], origins: [] } });

const DEMO_TITLE = 'Demo Case: The Missing Lecture';
const DEMO_FLAG_KEY = 'notes-detective.demo.seeded';
const HINT_SEEN_KEY = 'notes-detective.hints.seen';

type StoredCase = {
  readonly id: string;
  readonly title: string;
  readonly isDemo: boolean;
};

type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly type: string;
};

type StoredConnection = {
  readonly id: string;
  readonly caseId: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly type: string;
};

type StoredGraph = {
  readonly cases: StoredCase[];
  readonly cards: StoredCard[];
  readonly connections: StoredConnection[];
};

/**
 * Read the demo rows from the real IndexedDB database. This proves the seed
 * wrote normal case, card, and string records rather than only rendering a
 * fixture in memory.
 */
async function readStoredGraph(page: Page): Promise<StoredGraph> {
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

    const [caseRows, cardRows, connectionRows] = await Promise.all([
      readAll('cases'),
      readAll('cards'),
      readAll('connections'),
    ]);

    database.close();

    return {
      cases: caseRows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        isDemo: row.isDemo === true,
      })),
      cards: cardRows.map((row) => ({
        id: String(row.id),
        caseId: String(row.caseId),
        type: String(row.type),
      })),
      connections: connectionRows.map((row) => ({
        id: String(row.id),
        caseId: String(row.caseId),
        fromCardId: String(row.fromCardId),
        toCardId: String(row.toCardId),
        type: String(row.type),
      })),
    };
  });
}

test('a fresh install seeds, explains, removes, and replays the demo without reseeding', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  // A new Playwright context has no IndexedDB rows and no localStorage keys.
  // The first visit lands on the welcome screen; Enter is the one action this
  // journey needs from it before the seeded demo can be inspected.
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Welcome to Notes Detective' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Enter the case files' }).click();

  const demoLink = page.getByRole('link', { name: DEMO_TITLE });
  await expect(demoLink).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('case-demo-ribbon')).toHaveText('Demo');
  await expect(page.getByText('Demo case — remove it whenever you like.')).toBeVisible();

  const seeded = await readStoredGraph(page);
  expect(seeded.cases).toHaveLength(1);
  expect(seeded.cases[0]).toMatchObject({ title: DEMO_TITLE, isDemo: true });
  expect(seeded.cards).toHaveLength(6);
  expect(seeded.connections).toHaveLength(5);
  expect(new Set(seeded.cards.map((card) => card.type))).toEqual(
    new Set(['note', 'source', 'topic']),
  );

  const demoCaseId = seeded.cases[0]?.id;
  expect(demoCaseId).toBeDefined();
  expect(seeded.cards.every((card) => card.caseId === demoCaseId)).toBe(true);
  expect(seeded.connections.every((connection) => connection.caseId === demoCaseId)).toBe(true);

  // The demo opens like any other case and shows its derived graph and
  // readiness rather than a stored solved flag.
  await demoLink.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();

  const isPhone = (page.viewportSize()?.width ?? 1440) < 600;

  // The thread-anchor hint is the one contextual hint present on this board.
  // It is non-modal and marks itself seen on dismissal. Dismiss it before
  // opening any surface, because a surface suppresses hints without seeing them.
  const hint = page.getByRole('dialog', { name: 'Thread anchor' });
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await hint.getByRole('button', { name: 'Got it' }).click();
  await expect(hint).toBeHidden();

  if (isPhone) {
    await page.getByRole('button', { name: 'Case closure' }).click();
  } else {
    await page.getByRole('button', { name: /^Readiness:/ }).click();
  }

  const closure = page.getByTestId('closure-panel');
  await expect(closure).toContainText('Ready to close');
  await expect(closure).toContainText('No loose threads.');

  if (isPhone) {
    await page.keyboard.press('Escape');
  }

  const seenAfterDismiss = await page.evaluate((key) => localStorage.getItem(key), HINT_SEEN_KEY);
  expect(seenAfterDismiss).toContain('thread-anchor');

  // Removal uses the normal confirmed cascade, but names the demo case.
  if (isPhone) {
    await page.goto('/#/');
  } else {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Case shelf' })
      .click();
  }
  await expect(page.getByRole('link', { name: DEMO_TITLE })).toBeVisible();

  await page.getByRole('button', { name: `Remove demo ${DEMO_TITLE}` }).click();
  const removeDialog = page.getByRole('dialog', { name: /Remove demo case/ });
  await expect(removeDialog).toBeVisible();
  await expect(removeDialog).toContainText('demo case');
  await expect(removeDialog).toContainText('Your own cases are not touched.');
  await expect(removeDialog).toContainText('The demo will not be recreated automatically');

  await removeDialog.getByRole('button', { name: 'Remove demo' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'No case files yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: DEMO_TITLE })).toBeHidden();
  await expect(page.getByText(`Demo case removed: ${DEMO_TITLE}.`)).toBeVisible();

  expect(await page.evaluate((key) => localStorage.getItem(key), DEMO_FLAG_KEY)).toBe('1');

  const removed = await readStoredGraph(page);
  expect(removed.cases).toHaveLength(0);
  expect(removed.cards).toHaveLength(0);
  expect(removed.connections).toHaveLength(0);

  // Reload must not reseed: the install flag outlives the demo rows.
  await page.reload();
  await expect(page.getByRole('heading', { level: 3, name: 'No case files yet' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('link', { name: DEMO_TITLE })).toHaveCount(0);
  expect((await readStoredGraph(page)).cases).toHaveLength(0);

  // Settings can replay the hint after it has been seen and dismissed.
  if (isPhone) {
    await page.goto('/#/settings');
  } else {
    await page.getByRole('link', { name: 'Settings' }).click();
  }
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();

  const threadAnchorItem = page.locator('[data-hint-id="thread-anchor"]');
  await expect(threadAnchorItem).toContainText('Status: seen');

  const replay = page.getByRole('button', { name: 'Replay Thread anchor hint' });
  await replay.click();

  const replayed = page.getByRole('dialog', { name: 'Thread anchor' });
  await expect(replayed).toBeVisible();
  await expect(replayed).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(replayed).toBeHidden();
  await expect(replay).toBeFocused();

  expect(consoleErrors).toEqual([]);
});
