import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * SEARCH-FR-04 / SEARCH-FR-05 / VIS-FR-02 browser evidence.
 *
 * The journey is keyboard-only from the moment the board is loaded: Tab reaches
 * the search field, typing runs the debounced in-memory search, Tab + Enter
 * opens Filters and combines type and tag filters, Shift+Tab + Enter clears
 * everything, and Arrow keys move through the result buttons before Enter
 * selects one. Selecting a result must centre the card and mark it selected on
 * the board without writing any card or case row.
 *
 * The spec runs in every Playwright project. The phone project additionally
 * proves the in-flow sheet has no horizontal page overflow, is a full-height
 * sheet, and exposes every control with a real 44px target inside the viewport.
 *
 * OCR text has no manual form in the product, so the fixture creates real rows
 * in the app's own IndexedDB schema and then loads them through the normal
 * CaseRepository read path. The content is synthetic test data.
 */

const CASE_TITLE = 'Search keyboard case';

const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const TOPIC_ID = '33333333-3333-4333-8333-333333333333';

const NOTE_TITLE = 'Osmosis lab observations';
const SOURCE_TITLE = 'Lecture slide: membrane structure';
const TOPIC_TITLE = 'Membrane transport';

const NOTE_OCR_TEXT =
  'Water moves across the membrane from low solute to high solute concentration.';

/** The contract's fixed card geometry, used by the search-centring math. */
const CARD_WIDTH = 240;
const CARD_HEIGHT = 320;

type BoardViewport = { readonly x: number; readonly y: number; readonly scale: number };
type BoardCardPosition = { readonly id: string; readonly x: number; readonly y: number };

type StoredCase = {
  readonly id: string;
  readonly title: string;
  readonly viewport: BoardViewport | null;
};

type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly type: string;
  readonly title: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly tags: string[];
  readonly ocrText?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type SeedCard = Omit<StoredCard, 'caseId'>;

const SEED_CARDS: readonly SeedCard[] = [
  {
    id: NOTE_ID,
    type: 'note',
    title: NOTE_TITLE,
    position: { x: 120, y: 140 },
    tags: ['Biology', 'Lab'],
    ocrText: NOTE_OCR_TEXT,
    createdAt: '2026-10-26T08:00:00.000Z',
    updatedAt: '2026-10-26T08:00:00.000Z',
  },
  {
    id: SOURCE_ID,
    type: 'source',
    title: SOURCE_TITLE,
    position: { x: 900, y: 140 },
    tags: ['Biology', 'Lecture'],
    createdAt: '2026-10-26T08:00:01.000Z',
    updatedAt: '2026-10-26T08:00:01.000Z',
  },
  {
    id: TOPIC_ID,
    type: 'topic',
    title: TOPIC_TITLE,
    position: { x: 1500, y: 700 },
    tags: ['Exam', 'Biology'],
    createdAt: '2026-10-26T08:00:02.000Z',
    updatedAt: '2026-10-26T08:00:02.000Z',
  },
];

async function readCases(page: Page): Promise<StoredCase[]> {
  return page.evaluate(async () => {
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

    return rows.map((row) => {
      const viewport = row.viewport as Partial<BoardViewport> | undefined;
      return {
        id: String(row.id),
        title: String(row.title),
        viewport:
          viewport === undefined
            ? null
            : { x: Number(viewport.x), y: Number(viewport.y), scale: Number(viewport.scale) },
      };
    });
  });
}

async function readCase(page: Page, caseId: string): Promise<StoredCase> {
  const found = (await readCases(page)).find((candidate) => candidate.id === caseId);
  if (found === undefined) {
    throw new Error(`Case ${caseId} was not found in IndexedDB`);
  }
  return found;
}

/** Read the real card rows, including the tags and OCR text search consumes. */
async function readCards(page: Page): Promise<StoredCard[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('notes-detective');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result);
    });

    const rows = await new Promise<Record<string, unknown>[]>((resolvePromise, reject) => {
      const transaction = database.transaction('cards', 'readonly');
      const request = transaction.objectStore('cards').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result as Record<string, unknown>[]);
    });

    database.close();

    return rows.map((row) => {
      const position = row.position as { x?: unknown; y?: unknown } | undefined;
      return {
        id: String(row.id),
        caseId: String(row.caseId),
        type: String(row.type),
        title: String(row.title),
        position: { x: Number(position?.x ?? 0), y: Number(position?.y ?? 0) },
        tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
        ...(typeof row.ocrText === 'string' ? { ocrText: row.ocrText } : {}),
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
      };
    });
  });
}

/** Create the case through the real shelf dialog, then seed the search fixture. */
async function seedCaseAndCards(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /Create your first case/i }).click();

  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await dialog.getByRole('textbox', { name: 'Case title' }).fill(CASE_TITLE);
  await dialog.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();

  let caseId: string | undefined;
  await expect
    .poll(async () => {
      caseId = (await readCases(page)).find((candidate) => candidate.title === CASE_TITLE)?.id;
      return caseId;
    })
    .not.toBeUndefined();

  if (caseId === undefined) {
    throw new Error('The created case was not persisted');
  }
  const persistedCaseId: string = caseId;

  const rows: StoredCard[] = SEED_CARDS.map((card) => ({ ...card, caseId: persistedCaseId }));

  await page.evaluate(async (cards) => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('notes-detective');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result);
    });

    try {
      await new Promise<void>((resolvePromise, reject) => {
        const transaction = database.transaction('cards', 'readwrite');
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => resolvePromise();

        const store = transaction.objectStore('cards');
        for (const card of cards) {
          store.add(card);
        }
      });
    } finally {
      database.close();
    }
  }, rows);

  return caseId;
}

async function readBoardViewport(page: Page): Promise<BoardViewport> {
  return page.getByTestId('board-canvas').evaluate((element) => ({
    x: Number(element.getAttribute('data-board-viewport-x')),
    y: Number(element.getAttribute('data-board-viewport-y')),
    scale: Number(element.getAttribute('data-board-scale')),
  }));
}

async function readBoardCards(page: Page): Promise<BoardCardPosition[]> {
  const raw = await page.getByTestId('board-canvas').getAttribute('data-board-card-positions');
  if (raw === null || raw.length === 0) {
    return [];
  }
  return JSON.parse(raw) as BoardCardPosition[];
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement);
}

/**
 * Move focus with Tab (or Shift+Tab) until the target is the active element.
 * Every call is a real keyboard event; nothing here calls `focus()`.
 */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  options: { readonly shift?: boolean; readonly maxPresses?: number } = {},
): Promise<void> {
  const maxPresses = options.maxPresses ?? 150;
  const key = options.shift === true ? 'Shift+Tab' : 'Tab';

  for (let press = 0; press < maxPresses; press += 1) {
    if (await isFocused(target)) {
      await expect(target).toBeFocused();
      return;
    }
    await page.keyboard.press(key);
  }

  if (!(await isFocused(target))) {
    throw new Error('Keyboard focus never reached the expected search control');
  }
  await expect(target).toBeFocused();
}

async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));

  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

/**
 * Phone sheet evidence: a full-height in-flow sheet, no page-level horizontal
 * scrolling, and every visible input/button/link exposed with a real 44px
 * target that stays inside the viewport's horizontal bounds.
 */
async function expectUsablePhoneSheet(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('The phone project did not define a viewport');
  }

  await expectNoHorizontalPageOverflow(page);

  const panel = page.locator('.search-panel');
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();

  if (panelBox === null) {
    return;
  }

  expect(panelBox.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(panelBox.height).toBeGreaterThanOrEqual(viewport.height - 2);

  const controls = panel.locator('input, button, a');
  const controlCount = await controls.count();
  expect(controlCount).toBeGreaterThan(0);

  for (let index = 0; index < controlCount; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) {
      continue;
    }

    await expect(control).toBeEnabled();
    await expect(control).toHaveAccessibleName(/\S/);

    const box = await control.boundingBox();
    expect(box).not.toBeNull();

    if (box === null) {
      continue;
    }

    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  }
}

/**
 * The selected card's centre must sit on the stage centre. The expected screen
 * point uses the same camera contract as the board: screen = (world - origin) *
 * scale, and the search jump keeps the current zoom.
 */
async function expectSelectedCardCentered(page: Page, cardId: string): Promise<void> {
  const board = page.getByTestId('board-canvas');
  await expect(board).toHaveAttribute('data-board-anchor-card-id', cardId);

  const anchorPoint = await board.getAttribute('data-board-anchor-point');
  expect(anchorPoint === null ? '' : anchorPoint.length).toBeGreaterThan(0);

  const stage = page.locator('.case-board-page__stage');
  await expect(stage).toBeVisible();

  await expect
    .poll(
      async () => {
        const box = await stage.boundingBox();
        if (box === null) {
          return Number.POSITIVE_INFINITY;
        }

        const [viewport, cards] = await Promise.all([
          readBoardViewport(page),
          readBoardCards(page),
        ]);
        const card = cards.find((candidate) => candidate.id === cardId);
        if (card === undefined) {
          return Number.POSITIVE_INFINITY;
        }

        const centreX = box.x + (card.x + CARD_WIDTH / 2 - viewport.x) * viewport.scale;
        const centreY = box.y + (card.y + CARD_HEIGHT / 2 - viewport.y) * viewport.scale;

        return Math.max(
          Math.abs(centreX - (box.x + box.width / 2)),
          Math.abs(centreY - (box.y + box.height / 2)),
        );
      },
      { message: 'The selected card centre should coincide with the board stage centre' },
    )
    .toBeLessThanOrEqual(2);
}

test('opens, queries, filters, clears, and selects a search result with the keyboard', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  const isPhone = testInfo.project.name === 'phone';
  const expectedViewports: Record<string, { readonly width: number; readonly height: number }> = {
    desktop: { width: 1440, height: 900 },
    'tablet-landscape': { width: 1280, height: 800 },
    phone: { width: 390, height: 844 },
  };
  const expectedViewport = expectedViewports[testInfo.project.name];
  if (expectedViewport !== undefined) {
    expect(page.viewportSize()).toEqual(expectedViewport);
  }

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const caseId = await seedCaseAndCards(page);

  // Load the board through the real repository. The seeded note carries OCR
  // text; the source and topic deliberately have no OCR field, proving a
  // missing OCR value is simply not a text match.
  await page.goto(`/#/case/${caseId}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-board-card-count', '3');

  const seeded = await readCards(page);
  expect(seeded).toHaveLength(3);
  expect(seeded.find((card) => card.id === NOTE_ID)?.tags).toEqual(['Biology', 'Lab']);
  expect(seeded.find((card) => card.id === NOTE_ID)?.ocrText).toBe(NOTE_OCR_TEXT);
  expect(seeded.find((card) => card.id === SOURCE_ID)?.ocrText).toBeUndefined();
  expect(seeded.find((card) => card.id === TOPIC_ID)?.ocrText).toBeUndefined();

  const cardsBeforeSearch = seeded;
  const caseBeforeSearch = await readCase(page, caseId);

  const searchbox = page.getByRole('searchbox', { name: 'Search cards' });
  const filtersButton = page.getByRole('button', { name: 'Filters' });
  const clearAllButton = page.getByRole('button', { name: 'Clear all' });
  const resultButtons = page.getByRole('button', {
    name: /^Select .+ from search results$/,
  });
  const summary = page.locator('.search-panel__summary');

  // The page starts with focus on the document, so Tab is the honest keyboard
  // path into the always-present search region.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await tabUntilFocused(page, searchbox);
  await expect(searchbox).toBeVisible();
  await expect(searchbox).toBeFocused();
  await expect(summary).toContainText('3 cards available');
  await expectNoHorizontalPageOverflow(page);

  // A partial title also matches the note through its stored OCR text.
  await page.keyboard.type('membr');
  await expect(resultButtons).toHaveCount(3);
  await expect(summary).toContainText('3 cards match your search');
  await expect(resultButtons.nth(0)).toHaveAccessibleName(
    `Select ${NOTE_TITLE} from search results`,
  );
  await expect(resultButtons.nth(1)).toHaveAccessibleName(
    `Select ${SOURCE_TITLE} from search results`,
  );
  await expect(resultButtons.nth(2)).toHaveAccessibleName(
    `Select ${TOPIC_TITLE} from search results`,
  );

  const noteResult = page.locator('.search-panel__result-item').filter({
    has: page.getByRole('button', { name: `Select ${NOTE_TITLE} from search results` }),
  });
  await expect(noteResult.locator('.search-panel__result-context')).toContainText('OCR text:');

  if (isPhone) {
    await expectUsablePhoneSheet(page);
  }

  // Filters open and apply with Tab + Enter. The filter region is only hidden
  // until the button is activated, so this also proves "open" is keyboard-only.
  await tabUntilFocused(page, filtersButton);
  await expect(filtersButton).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(filtersButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.search-panel__filters')).toBeVisible();

  const notesChip = page.getByRole('button', { name: 'Notes', exact: true });
  await tabUntilFocused(page, notesChip);
  await page.keyboard.press('Enter');
  await expect(notesChip).toHaveAttribute('aria-pressed', 'true');
  await expect(resultButtons).toHaveCount(1);
  await expect(resultButtons.nth(0)).toHaveAccessibleName(
    `Select ${NOTE_TITLE} from search results`,
  );
  await expect(summary).toContainText('1 card matches your search');

  // Notes AND tag Exam has no match: the AND between type and tag is real.
  const examChip = page.getByRole('button', { name: 'Exam', exact: true });
  await tabUntilFocused(page, examChip);
  await page.keyboard.press('Enter');
  await expect(examChip).toHaveAttribute('aria-pressed', 'true');
  await expect(resultButtons).toHaveCount(0);
  await expect(summary).toContainText('No cards match');
  await expect(summary).toContainText('handwritten image itself is not searched');

  // Exam OR Lab keeps the note: tags are ORed inside the tag filter.
  const labChip = page.getByRole('button', { name: 'Lab', exact: true });
  await tabUntilFocused(page, labChip);
  await page.keyboard.press('Enter');
  await expect(labChip).toHaveAttribute('aria-pressed', 'true');
  await expect(resultButtons).toHaveCount(1);
  await expect(summary).toContainText('1 card matches your search');

  const activeFilters = page.getByRole('list', { name: 'Active filters' });
  await expect(activeFilters).toContainText('Type: Notes');
  await expect(activeFilters).toContainText('Tag: Exam');
  await expect(activeFilters).toContainText('Tag: Lab');

  if (isPhone) {
    await expectUsablePhoneSheet(page);
  }

  // Clear all moves backwards out of the filter group to the bar and resets the
  // query, type, and tags in one keyboard action.
  await tabUntilFocused(page, clearAllButton, { shift: true });
  await page.keyboard.press('Enter');
  await expect(searchbox).toBeFocused();
  await expect(searchbox).toHaveValue('');
  await expect(clearAllButton).toBeDisabled();
  await expect(page.getByRole('button', { name: 'All types' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(examChip).toHaveAttribute('aria-pressed', 'false');
  await expect(labChip).toHaveAttribute('aria-pressed', 'false');
  await expect(activeFilters).toHaveCount(0);
  await expect(resultButtons).toHaveCount(0);
  await expect(summary).toContainText('3 cards available');

  // Re-run the query and navigate the result list with the arrow keys.
  await page.keyboard.type('membr');
  await expect(resultButtons).toHaveCount(3);

  await page.keyboard.press('ArrowDown');
  await expect(resultButtons.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(resultButtons.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(resultButtons.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(resultButtons.nth(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(resultButtons.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(resultButtons.nth(1)).toBeFocused();

  // The result's secondary Open detail action is also a tab stop. Return to the
  // Select button before activating the selection.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: `Open detail for ${SOURCE_TITLE}` })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(resultButtons.nth(1)).toBeFocused();

  await page.keyboard.press('Enter');

  // Selection returns keyboard focus to the board heading, marks the card
  // selected, and centres it, all without a write.
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeFocused();
  await expectSelectedCardCentered(page, SOURCE_ID);
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-anchor-card-id',
    SOURCE_ID,
  );

  if (isPhone) {
    await expectUsablePhoneSheet(page);
  } else {
    await expectNoHorizontalPageOverflow(page);
  }

  // Search and selection are read-only: same card rows and same stored camera.
  // The camera is a temporary jump, so the 500 ms persistence pass must not run.
  await page.waitForTimeout(800);
  expect(await readCards(page)).toEqual(cardsBeforeSearch);
  expect(await readCase(page, caseId)).toEqual(caseBeforeSearch);

  expect(consoleErrors).toEqual([]);
});
