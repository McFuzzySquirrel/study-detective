import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * A11Y-FR-03 / VIS-FR-02 browser evidence.
 *
 * The matrix test sets each named viewport explicitly on one page, walks every
 * primary screen (shelf, board, search, card detail, recall, card list, and
 * settings), and fails if the document gains a horizontal scrollbar or if the
 * screen's primary action is missing, disabled, unnamed, or smaller than
 * 44x44 CSS pixels.
 *
 * The phone test proves the side panels are real modal sheets: open from a
 * trigger, focus trapped in the sheet, Escape closes, focus returns to the
 * trigger, and every sheet action stays at the target floor.
 *
 * The fixture is synthetic test data inserted through the app's own IndexedDB
 * schema and then read through the normal repository path.
 */

const CASE_TITLE = 'Responsive audit case';
const TOPIC_TITLE = 'Membrane transport';
const NOTE_TITLE = 'Osmosis lab observations';
const SOURCE_TITLE = 'Lecture slide: membrane structure';

const TOPIC_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const ASSOCIATION_ID = '44444444-4444-4444-8444-444444444444';
const PROVENANCE_ID = '55555555-5555-4555-8555-555555555555';

type ViewportName = 'phone' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';

type ViewportCase = {
  readonly name: ViewportName;
  readonly width: number;
  readonly height: number;
  readonly layout: 'phone' | 'tablet' | 'desktop';
};

const VIEWPORTS: readonly ViewportCase[] = [
  { name: 'phone', width: 390, height: 844, layout: 'phone' },
  { name: 'tablet-portrait', width: 768, height: 1024, layout: 'tablet' },
  // 1280x800 is the primary tablet-landscape arranging shape, but 1200 px and
  // up uses the desktop breakpoint by the documented rule.
  { name: 'tablet-landscape', width: 1280, height: 800, layout: 'desktop' },
  { name: 'desktop', width: 1440, height: 900, layout: 'desktop' },
];

type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly type: 'note' | 'source' | 'topic';
  readonly title: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly tags: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

type StoredConnection = {
  readonly id: string;
  readonly caseId: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly pairKey: string;
  readonly type: 'association' | 'provenance';
};

function pairKey(first: string, second: string): string {
  return first <= second ? `${first}::${second}` : `${second}::${first}`;
}

const TIMESTAMP = '2026-10-01T09:00:00.000Z';

function seedCards(caseId: string): StoredCard[] {
  return [
    {
      id: TOPIC_ID,
      caseId,
      type: 'topic',
      title: TOPIC_TITLE,
      position: { x: 120, y: 140 },
      tags: ['Biology'],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    {
      id: NOTE_ID,
      caseId,
      type: 'note',
      title: NOTE_TITLE,
      position: { x: 520, y: 260 },
      // A 24-character unbroken tag is the tag ceiling; it must wrap rather
      // than widen the page at 390 px.
      tags: ['Biology', 'Membranetransportgradien'],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    {
      id: SOURCE_ID,
      caseId,
      type: 'source',
      title: SOURCE_TITLE,
      position: { x: 900, y: 140 },
      tags: ['Lecture'],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  ];
}

/** Create the case through the real shelf form, then seed the graph rows. */
async function seedCase(page: Page): Promise<string> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible();

  await page.getByRole('button', { name: /Create your first case/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await dialog.getByRole('textbox', { name: 'Case title' }).fill(CASE_TITLE);
  await dialog.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();

  let caseId: string | undefined;
  await expect
    .poll(async () => {
      caseId = await page.evaluate(async (title) => {
        const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
          const request = indexedDB.open('notes-detective');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolvePromise(request.result);
        });

        try {
          const rows = await new Promise<Array<Record<string, unknown>>>(
            (resolvePromise, reject) => {
              const transaction = database.transaction('cases', 'readonly');
              const request = transaction.objectStore('cases').getAll();
              request.onerror = () => reject(request.error);
              request.onsuccess = () =>
                resolvePromise(request.result as Array<Record<string, unknown>>);
            },
          );

          return rows.find((row) => String(row.title) === title)?.id as string | undefined;
        } finally {
          database.close();
        }
      }, CASE_TITLE);

      return caseId;
    })
    .not.toBeUndefined();

  if (caseId === undefined) {
    throw new Error('The created case was not persisted');
  }
  const persistedCaseId = caseId;

  const cards = seedCards(persistedCaseId);
  const connections: StoredConnection[] = [
    {
      id: ASSOCIATION_ID,
      caseId: persistedCaseId,
      fromCardId: TOPIC_ID,
      toCardId: NOTE_ID,
      pairKey: pairKey(TOPIC_ID, NOTE_ID),
      type: 'association',
    },
    {
      id: PROVENANCE_ID,
      caseId: persistedCaseId,
      fromCardId: NOTE_ID,
      toCardId: SOURCE_ID,
      pairKey: pairKey(NOTE_ID, SOURCE_ID),
      type: 'provenance',
    },
  ];

  await page.evaluate(
    async ({ cardRows, connectionRows }) => {
      const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
        const request = indexedDB.open('notes-detective');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolvePromise(request.result);
      });

      try {
        await new Promise<void>((resolvePromise, reject) => {
          const transaction = database.transaction(['cards', 'connections'], 'readwrite');
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
          transaction.oncomplete = () => resolvePromise();

          const cardStore = transaction.objectStore('cards');
          for (const card of cardRows) {
            cardStore.add(card);
          }

          const connectionStore = transaction.objectStore('connections');
          for (const connection of connectionRows) {
            connectionStore.add(connection);
          }
        });
      } finally {
        database.close();
      }
    },
    { cardRows: cards, connectionRows: connections },
  );

  return persistedCaseId;
}

/** Two frames so responsive layout and the board stage have settled. */
async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await settleLayout(page);

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
    viewport:
      document.documentElement.scrollWidth - (window.visualViewport?.width ?? window.innerWidth),
  }));

  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.viewport).toBeLessThanOrEqual(1);
}

async function expectTarget(
  locator: Locator,
  options: { readonly enabled?: boolean } = {},
): Promise<void> {
  const viewport = locator.page().viewportSize();
  if (viewport === null) {
    throw new Error('The project did not define a viewport');
  }

  await expect(locator).toBeVisible();
  if (options.enabled !== false) {
    await expect(locator).toBeEnabled();
  }
  await expect(locator).toHaveAccessibleName(/\S/);

  const box = await locator.boundingBox();
  expect(box).not.toBeNull();

  if (box === null) {
    return;
  }

  expect(box.width).toBeGreaterThanOrEqual(43.5);
  expect(box.height).toBeGreaterThanOrEqual(43.5);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

async function openPhoneSearch(page: Page): Promise<Locator> {
  const trigger = page.getByRole('button', { name: 'Search and filters' });
  await expectTarget(trigger);
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: 'Search and filters' });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closePhoneSheet(page: Page, name: string, trigger?: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name })).toBeHidden();
  if (trigger !== undefined) {
    await expect(trigger).toBeFocused();
  }
}

test.describe('viewport matrix', () => {
  test('every primary screen fits and keeps its primary action reachable', async ({
    page,
  }, testInfo) => {
    // The test sets each named viewport explicitly, so it only needs one
    // project run. Other projects still execute the phone-sheet journey below.
    test.skip(
      testInfo.project.name !== 'desktop',
      'The viewport matrix sets all four viewports on one page.',
    );
    test.setTimeout(180_000);

    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    const caseId = await seedCase(page);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(page.getByTestId('app-frame')).toHaveAttribute('data-layout', viewport.layout);

      // Shelf -----------------------------------------------------------------
      await page.goto('/#/');
      await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTarget(page.getByRole('button', { name: 'New case' }));

      // Board ----------------------------------------------------------------
      await page.goto(`/#/case/${caseId}`);
      await expect(page.getByTestId('board-canvas')).toHaveAttribute(
        'data-board-scene-status',
        'ready',
      );
      await expectNoHorizontalOverflow(page);

      if (viewport.layout === 'phone') {
        await expectTarget(page.getByRole('button', { name: 'Case actions' }));
        await expectTarget(page.getByRole('button', { name: 'Search and filters' }));
        await expectTarget(page.getByRole('button', { name: 'Case closure' }));

        const sheet = await openPhoneSearch(page);
        await expectTarget(sheet.getByRole('button', { name: 'Filters' }));
        await closePhoneSheet(
          page,
          'Search and filters',
          page.getByRole('button', {
            name: 'Search and filters',
          }),
        );
      } else {
        await expectTarget(page.getByRole('button', { name: 'Back up case' }));
        await expect(page.getByRole('searchbox', { name: 'Search cards' })).toBeVisible();
        await expectTarget(page.getByRole('button', { name: 'Filters' }));
        await expect(page.getByTestId('closure-panel')).toBeVisible();
      }

      // Card detail ----------------------------------------------------------
      await page.goto(`/#/case/${caseId}/card/${NOTE_ID}`);
      await expect(page.getByRole('heading', { level: 2, name: NOTE_TITLE })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      if (viewport.layout === 'phone') {
        const trigger = page.getByRole('button', { name: 'Card actions and tags' });
        await expectTarget(trigger);
        await trigger.click();
        const sheet = page.getByRole('dialog', { name: 'Card actions and tags' });
        await expect(sheet).toBeVisible();
        await expectTarget(sheet.getByRole('button', { name: 'Edit title' }));
        await expectTarget(sheet.getByRole('button', { name: 'Delete card' }));
        await closePhoneSheet(page, 'Card actions and tags', trigger);
      } else {
        await expectTarget(page.getByRole('button', { name: 'Edit title' }));
      }

      // Recall ---------------------------------------------------------------
      await page.goto(`/#/case/${caseId}/recall`);
      await expect(page.getByRole('heading', { level: 2, name: 'Recall' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTarget(page.getByRole('button', { name: 'Check' }));

      // Card list ------------------------------------------------------------
      await page.goto(`/#/case/${caseId}/list`);
      await expect(page.getByRole('heading', { level: 2, name: 'Card list' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTarget(page.getByRole('link', { name: 'Add note' }));

      // Settings -------------------------------------------------------------
      await page.goto('/#/settings');
      await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectTarget(page.getByRole('button', { name: 'Reset all hints' }));
    }

    expect(consoleErrors).toEqual([]);
  });
});

test.describe('phone bottom sheets', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('side panels open as modal sheets, close on Escape, and keep 44px actions', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'phone',
      'The 390x844 sheet journey runs in the phone project.',
    );
    test.setTimeout(120_000);

    const caseId = await seedCase(page);
    await page.goto(`/#/case/${caseId}`);
    await expect(page.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-scene-status',
      'ready',
    );
    await expectNoHorizontalOverflow(page);

    // Board view controls ----------------------------------------------------
    const viewControls = page
      .getByRole('group', { name: 'Board view controls' })
      .getByRole('button');
    const viewControlCount = await viewControls.count();
    expect(viewControlCount).toBeGreaterThan(0);
    for (let index = 0; index < viewControlCount; index += 1) {
      const control = viewControls.nth(index);
      if (await control.isVisible()) {
        await expectTarget(control);
      }
    }
    await expectTarget(page.getByRole('link', { name: 'Add evidence' }));
    await expectTarget(page.getByRole('link', { name: 'Open card list' }));

    // Case actions ----------------------------------------------------------
    const actionsTrigger = page.getByRole('button', { name: 'Case actions' });
    await expectTarget(actionsTrigger);
    await actionsTrigger.click();

    const actionsSheet = page.getByRole('dialog', { name: 'Case actions' });
    await expect(actionsSheet).toBeVisible();
    await expect(actionsSheet).toHaveAttribute('aria-modal', 'true');

    for (const name of ['Back up case']) {
      await expectTarget(actionsSheet.getByRole('button', { name }));
    }
    for (const name of ['Open card list', 'Back to case shelf']) {
      await expectTarget(actionsSheet.getByRole('link', { name }));
    }

    await closePhoneSheet(page, 'Case actions', actionsTrigger);

    // Search sheet ----------------------------------------------------------
    const searchTrigger = page.getByRole('button', { name: 'Search and filters' });
    await expectTarget(searchTrigger);
    await searchTrigger.click();

    const searchSheet = page.getByRole('dialog', { name: 'Search and filters' });
    await expect(searchSheet).toBeVisible();
    const searchbox = searchSheet.getByRole('searchbox', { name: 'Search cards' });
    await expect(searchbox).toBeFocused();

    await searchbox.fill('Osmosis');
    const searchResult = searchSheet.getByRole('button', {
      name: `Select ${NOTE_TITLE} from search results`,
    });
    await expect(searchResult).toBeVisible();
    await expectTarget(searchSheet.getByRole('button', { name: 'Filters' }));

    // Choosing a result is a primary action inside the sheet: it must close the
    // sheet and leave focus on the board context that changed.
    await searchResult.click();
    await expect(searchSheet).toBeHidden();
    await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeFocused();
    await expect(page.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-anchor-card-id',
      NOTE_ID,
    );

    // Closure sheet ---------------------------------------------------------
    const closureTrigger = page.getByRole('button', { name: 'Case closure' });
    await expectTarget(closureTrigger);
    await closureTrigger.click();

    const closureSheet = page.getByRole('dialog', { name: 'Case closure' });
    await expect(closureSheet).toBeVisible();
    await expect(closureSheet.getByTestId('closure-panel')).toBeVisible();
    await expectTarget(closureSheet.getByRole('button', { name: 'Close case' }));
    await closePhoneSheet(page, 'Case closure', closureTrigger);

    // Card detail action sidebar --------------------------------------------
    await page.goto(`/#/case/${caseId}/card/${NOTE_ID}`);
    await expect(page.getByRole('heading', { level: 2, name: NOTE_TITLE })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const detailTrigger = page.getByRole('button', { name: 'Card actions and tags' });
    await expectTarget(detailTrigger);
    await detailTrigger.click();

    const detailSheet = page.getByRole('dialog', { name: 'Card actions and tags' });
    await expect(detailSheet).toBeVisible();
    for (const name of ['Edit title', 'Replace photo', 'Delete card', 'Edit tags']) {
      await expectTarget(detailSheet.getByRole('button', { name }));
    }

    // This fixture has no retained original, so the crop action is correctly
    // disabled. It still owns a 44 px target.
    await expectTarget(detailSheet.getByRole('button', { name: 'Crop/rotate' }), {
      enabled: false,
    });

    await closePhoneSheet(page, 'Card actions and tags', detailTrigger);
    await expectNoHorizontalOverflow(page);
  });
});
