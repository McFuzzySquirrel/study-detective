import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const CASE_TITLE = 'Card drag case';
const TOPIC_TITLE = 'Membrane transport';

type BoardViewport = { readonly x: number; readonly y: number; readonly scale: number };
type BoardCardPosition = { readonly id: string; readonly x: number; readonly y: number };
type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly title: string;
  readonly position: { readonly x: number; readonly y: number };
};

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
        title: String(row.title),
        position: {
          x: Number(position?.x ?? 0),
          y: Number(position?.y ?? 0),
        },
      };
    });
  });
}

async function readCard(page: Page, caseId: string): Promise<StoredCard> {
  const rows = await readCards(page);
  const found = rows.find((row) => row.caseId === caseId);
  if (found === undefined) {
    throw new Error(`No card was found for case ${caseId}`);
  }
  return found;
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
  if (raw === null) {
    return [];
  }
  return JSON.parse(raw) as BoardCardPosition[];
}

async function createCase(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /Create your first case/i }).click();

  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await dialog.getByRole('textbox', { name: 'Case title' }).fill(CASE_TITLE);
  await dialog.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();
  await expect.poll(async () => (await readCards(page)).length, { timeout: 10_000 }).toBe(0);

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

async function addTopic(page: Page, caseId: string): Promise<void> {
  await page.goto(`/#/case/${caseId}/capture`);
  await expect(page.getByRole('heading', { level: 2, name: 'Capture evidence' })).toBeVisible();
  await page.getByRole('button', { name: 'Add topic' }).click();
  await page.getByRole('textbox', { name: 'Topic title' }).fill(TOPIC_TITLE);
  await page.getByRole('button', { name: 'Add topic' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-board-card-count', '1');
}

/** The screen point over a card's upper-left region. */
async function cardPoint(page: Page, cardId: string): Promise<{ x: number; y: number }> {
  const host = page.getByTestId('board-canvas-host');
  const box = await host.boundingBox();
  if (box === null) {
    throw new Error('The board canvas host did not render');
  }

  const [viewport, cards] = await Promise.all([readBoardViewport(page), readBoardCards(page)]);
  const card = cards.find((candidate) => candidate.id === cardId);
  if (card === undefined) {
    throw new Error(`Card ${cardId} is missing from the board snapshot`);
  }

  // Forty pixels in from the top-left stays inside a 240 x 320 card and keeps
  // the point visible even when a drag moved the card near the viewport edge.
  return {
    x: box.x + (card.x + 40 - viewport.x) * viewport.scale,
    y: box.y + (card.y + 40 - viewport.y) * viewport.scale,
  };
}

async function dispatchTouch(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  point: { readonly x: number; readonly y: number },
  pointerId: number,
): Promise<void> {
  await page.evaluate(
    ({ eventType, x, y, id }) => {
      const host = document.querySelector('[data-testid="board-canvas-host"]');
      if (!(host instanceof HTMLElement)) {
        throw new Error('The board host is missing');
      }

      host.dispatchEvent(
        new PointerEvent(eventType, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          buttons: eventType === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { eventType: type, x: point.x, y: point.y, id: pointerId },
  );
}

test('drags a card with the mouse and persists its position across reload', async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const caseId = await createCase(page);
  await addTopic(page, caseId);

  const before = await readCard(page, caseId);

  // A click without movement is a tap and opens card detail. Do this while the
  // card is fully visible, before the drag moves it toward the viewport edge.
  const clickPoint = await cardPoint(page, before.id);
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect(page).toHaveURL(new RegExp(`/case/${caseId}/card/${before.id}`));
  await expect(page.getByRole('heading', { level: 2, name: TOPIC_TITLE })).toBeVisible({
    timeout: 20_000,
  });

  await page.goBack();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );

  const start = await cardPoint(page, before.id);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 150, start.y + 80, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => (await readBoardCards(page))[0]?.x ?? Number.NaN, { timeout: 5_000 })
    .toBeGreaterThan(before.position.x + 80);

  const live = (await readBoardCards(page))[0];
  if (live === undefined) {
    throw new Error('The dragged card disappeared from the board snapshot');
  }
  expect(live.y).toBeGreaterThan(before.position.y + 30);

  // The page waits 300 ms after drop before it writes. The final position must
  // reach IndexedDB and survive a full reload.
  await page.waitForTimeout(800);
  const stored = await readCard(page, caseId);
  expect(stored.position.x).toBeCloseTo(live.x, 0);
  expect(stored.position.y).toBeCloseTo(live.y, 0);

  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );

  await expect
    .poll(async () => (await readBoardCards(page))[0]?.x ?? Number.NaN, { timeout: 10_000 })
    .toBeCloseTo(stored.position.x, 0);

  const afterReload = (await readBoardCards(page))[0];
  expect(afterReload?.y ?? Number.NaN).toBeCloseTo(stored.position.y, 0);
  expect(afterReload?.id).toBe(before.id);

  expect(consoleErrors).toEqual([]);
});

test('touch tap opens detail and a 500 ms press drags the card', async ({ page }) => {
  test.setTimeout(60_000);
  const caseId = await createCase(page);
  await addTopic(page, caseId);
  const card = await readCard(page, caseId);

  // Quick touch: pointer down and up under the 500 ms threshold opens detail.
  const tapPoint = await cardPoint(page, card.id);
  await dispatchTouch(page, 'pointerdown', tapPoint, 41);
  await page.waitForTimeout(120);
  await dispatchTouch(page, 'pointerup', tapPoint, 41);

  await expect(page).toHaveURL(new RegExp(`/case/${caseId}/card/${card.id}`));
  await expect(page.getByRole('heading', { level: 2, name: TOPIC_TITLE })).toBeVisible({
    timeout: 20_000,
  });

  // Return to the board for the long-press journey.
  await page.goBack();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );

  const before = await readCard(page, caseId);
  const start = await cardPoint(page, card.id);
  await dispatchTouch(page, 'pointerdown', start, 42);
  await page.waitForTimeout(600);
  await dispatchTouch(page, 'pointermove', { x: start.x + 110, y: start.y + 60 }, 42);
  await dispatchTouch(page, 'pointerup', { x: start.x + 110, y: start.y + 60 }, 42);

  await expect
    .poll(async () => (await readBoardCards(page))[0]?.x ?? Number.NaN, { timeout: 5_000 })
    .toBeGreaterThan(before.position.x + 60);

  await page.waitForTimeout(800);
  const stored = await readCard(page, caseId);
  const live = (await readBoardCards(page))[0];
  expect(stored.position.x).toBeCloseTo(live?.x ?? Number.NaN, 0);
  expect(stored.position.y).toBeCloseTo(live?.y ?? Number.NaN, 0);
  expect(stored.position.x).toBeGreaterThan(before.position.x + 60);
});
