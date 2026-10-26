import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const specDirectory = dirname(fileURLToPath(import.meta.url));
const noteFixture = resolve(specDirectory, 'fixtures', 'note.png');
const sourceFixture = resolve(specDirectory, 'fixtures', 'source.png');

const CASE_TITLE = 'Connections case';
const NOTE_TITLE = 'Membrane transport notes';
const SOURCE_TITLE = 'Lecture handout';
const TOPIC_TITLE = 'Osmosis';

type BoardViewport = { readonly x: number; readonly y: number; readonly scale: number };
type BoardCard = { readonly id: string; readonly x: number; readonly y: number };
type ScreenPoint = { readonly x: number; readonly y: number };

type StoredConnection = {
  readonly id: string;
  readonly caseId: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly pairKey: string;
  readonly type: string;
};

/**
 * Read the real connection rows the app wrote. Connections are read rather
 * than assumed so the test can prove there is exactly one row per pair.
 */
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

async function readCards(
  page: Page,
): Promise<Array<{ readonly id: string; readonly caseId: string; readonly type: string }>> {
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

    return rows.map((row) => ({
      id: String(row.id),
      caseId: String(row.caseId),
      type: String(row.type),
    }));
  });
}

async function readBoardViewport(page: Page): Promise<BoardViewport> {
  return page.getByTestId('board-canvas').evaluate((element) => ({
    x: Number(element.getAttribute('data-board-viewport-x')),
    y: Number(element.getAttribute('data-board-viewport-y')),
    scale: Number(element.getAttribute('data-board-scale')),
  }));
}

async function readBoardCards(page: Page): Promise<BoardCard[]> {
  const raw = await page.getByTestId('board-canvas').getAttribute('data-board-card-positions');
  if (raw === null) {
    return [];
  }
  return JSON.parse(raw) as BoardCard[];
}

async function hostBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('board-canvas-host').boundingBox();
  if (box === null) {
    throw new Error('The board canvas host did not render');
  }
  return box;
}

/** A screen point over one card's upper-left body, clear of the anchor. */
async function cardGrabPoint(page: Page, cardId: string): Promise<ScreenPoint> {
  const box = await hostBox(page);
  const [viewport, cards] = await Promise.all([readBoardViewport(page), readBoardCards(page)]);
  const card = cards.find((candidate) => candidate.id === cardId);
  if (card === undefined) {
    throw new Error(`Card ${cardId} is missing from the board snapshot`);
  }

  return {
    x: box.x + (card.x + 40 - viewport.x) * viewport.scale,
    y: box.y + (card.y + 40 - viewport.y) * viewport.scale,
  };
}

/** The visible thread anchor, in page coordinates. */
async function anchorPoint(page: Page): Promise<ScreenPoint> {
  const box = await hostBox(page);
  const raw = await page.getByTestId('board-canvas').getAttribute('data-board-anchor-point');
  const anchorCardId = await page
    .getByTestId('board-canvas')
    .getAttribute('data-board-anchor-card-id');

  if (raw === null || raw.length === 0 || anchorCardId === null || anchorCardId.length === 0) {
    throw new Error('The board has no visible thread anchor');
  }

  const point = JSON.parse(raw) as { readonly x: number; readonly y: number };
  return { x: box.x + point.x, y: box.y + point.y };
}

async function hoverCard(page: Page, cardId: string): Promise<void> {
  const point = await cardGrabPoint(page, cardId);
  await page.mouse.move(point.x, point.y);
  await expect
    .poll(async () => page.getByTestId('board-canvas').getAttribute('data-board-anchor-card-id'), {
      timeout: 5_000,
    })
    .toBe(cardId);
}

async function dragThread(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

/** Dispatch a real touch pointer sequence on the board host. */
async function dispatchTouch(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  point: ScreenPoint,
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

test('draws two strings, retypes one to provenance, and persists both without duplicates', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone',
    'Two-card thread drawing is exercised at desktop and tablet widths; phone uses the card list path.',
  );
  test.setTimeout(120_000);

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

  const cards = await readCards(page);
  const note = cards.find((card) => card.type === 'note');
  const source = cards.find((card) => card.type === 'source');
  const topic = cards.find((card) => card.type === 'topic');
  if (note === undefined || source === undefined || topic === undefined) {
    throw new Error('The three capture cards were not persisted');
  }

  // New cards stack with a small stagger and can start below the visible stage.
  // Fit first so every card is reachable, then move the topmost away before the
  // cards beneath it. Fit is a temporary camera and does not persist.
  await page.getByRole('button', { name: 'Fit all cards' }).click();
  await page.waitForTimeout(150);

  const box = await hostBox(page);
  const cardOrder = await readBoardCards(page);
  const topmost = [...cardOrder].reverse();

  for (const card of topmost) {
    const from = await cardGrabPoint(page, card.id);
    const target =
      card.id === topic.id
        ? { x: box.x + box.width - 320, y: box.y + 100 }
        : card.id === source.id
          ? { x: box.x + 120, y: box.y + 100 }
          : { x: box.x + box.width / 2 - 40, y: box.y + 130 };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const live = await readBoardCards(page);
        return live.find((candidate) => candidate.id === card.id)?.x ?? Number.NaN;
      })
      .not.toBe(card.x);
  }

  // Re-fit the spread-out layout so all three anchors are visible.
  await page.getByRole('button', { name: 'Fit all cards' }).click();
  await page.waitForTimeout(150);

  // 1. Note -> Topic creates an association and opens the type menu.
  await hoverCard(page, note.id);
  const firstAnchor = await anchorPoint(page);
  const topicTarget = await cardGrabPoint(page, topic.id);
  await dragThread(page, firstAnchor, topicTarget);

  await expect(page.getByTestId('connection-type-menu')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '1',
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-association-count',
    '1',
  );

  const provenanceOption = page.getByRole('radio', { name: /Provenance/ });
  await expect(provenanceOption).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: /only available between/ })).toHaveText(
    /one Study Note and one Source/,
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('connection-type-menu')).not.toBeVisible();

  // 2. Note -> Source creates another association, then is retyped to provenance.
  const secondAnchor = await anchorPoint(page);
  const sourceTarget = await cardGrabPoint(page, source.id);
  await dragThread(page, secondAnchor, sourceTarget);

  await expect(page.getByTestId('connection-type-menu')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '2',
  );
  await expect(provenanceOption).toBeEnabled();
  await provenanceOption.check();

  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-provenance-count',
    '1',
    { timeout: 10_000 },
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-association-count',
    '1',
  );
  await page.getByRole('button', { name: 'Done' }).click();

  // Wait out the card-position debounce so reload restores the same layout.
  await page.waitForTimeout(600);

  const beforeReload = await readConnections(page);
  expect(beforeReload).toHaveLength(2);
  expect(beforeReload.map((row) => row.type).sort()).toEqual(['association', 'provenance']);
  expect(new Set(beforeReload.map((row) => row.pairKey)).size).toBe(2);

  const association = beforeReload.find((row) => row.type === 'association');
  if (association === undefined) {
    throw new Error('The association row was not stored');
  }

  // 3. Reload: both string types survive, still with one row per pair.
  await page.reload();
  await waitForBoardReady(page, 3);
  await page.getByRole('button', { name: 'Fit all cards' }).click();
  await page.waitForTimeout(150);
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '2',
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-association-count',
    '1',
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-provenance-count',
    '1',
  );

  const afterReload = await readConnections(page);
  expect(afterReload).toHaveLength(2);
  expect(afterReload.map((row) => row.id).sort()).toEqual(beforeReload.map((row) => row.id).sort());
  expect(afterReload.map((row) => row.type).sort()).toEqual(['association', 'provenance']);
  expect(new Set(afterReload.map((row) => row.pairKey)).size).toBe(2);

  // 4. Dropping the same pair selects the existing row and writes nothing.
  await hoverCard(page, note.id);
  const duplicateAnchor = await anchorPoint(page);
  const duplicateTarget = await cardGrabPoint(page, topic.id);
  await dragThread(page, duplicateAnchor, duplicateTarget);

  await expect(page.getByText(/already have a thread/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '2',
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-selected-connection',
    association.id,
  );
  await expect(page.getByTestId('connection-type-menu')).not.toBeVisible();
  expect(await readConnections(page)).toHaveLength(2);

  // 5. Self-drop and empty cork give feedback and create nothing.
  const selfAnchor = await anchorPoint(page);
  const selfTarget = await cardGrabPoint(page, note.id);
  await dragThread(page, selfAnchor, selfTarget);
  await expect(page.getByText(/cannot link to itself/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '2',
  );

  await hoverCard(page, note.id);
  const emptyAnchor = await anchorPoint(page);
  await dragThread(page, emptyAnchor, {
    x: box.x + 28,
    y: box.y + 28,
  });
  await expect(page.getByText(/Drop the thread on another card/i)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '2',
  );

  expect(await readConnections(page)).toHaveLength(2);
  expect(consoleErrors).toEqual([]);
});

test('selects a card by touch and draws a thread from its anchor', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'tablet-landscape',
    'Synthetic touch anchor proof runs once at tablet width.',
  );
  test.setTimeout(120_000);

  const caseId = await createCase(page);
  await addTopic(page, caseId, 'Touch topic one', 1);
  await addTopic(page, caseId, 'Touch topic two', 2);

  await page.getByRole('button', { name: 'Fit all cards' }).click();
  await page.waitForTimeout(150);

  const box = await hostBox(page);
  const boardOrder = await readBoardCards(page);
  const topmost = boardOrder[boardOrder.length - 1];
  const source = boardOrder.find((card) => card.id !== topmost?.id);
  if (topmost === undefined || source === undefined) {
    throw new Error('The touch fixture needs two cards');
  }

  // Move the topmost card away so the lower card is exposed for its press.
  const from = await cardGrabPoint(page, topmost.id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 320, box.y + 100, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const live = await readBoardCards(page);
      return live.find((card) => card.id === topmost.id)?.x ?? Number.NaN;
    })
    .not.toBe(topmost.x);

  await page.getByRole('button', { name: 'Fit all cards' }).click();
  await page.waitForTimeout(150);

  // A 500 ms touch press selects the card; releasing without movement does not
  // open detail, so the anchor stays available.
  const sourcePoint = await cardGrabPoint(page, source.id);
  await dispatchTouch(page, 'pointerdown', sourcePoint, 71);
  await page.waitForTimeout(600);
  await dispatchTouch(page, 'pointerup', sourcePoint, 71);

  await expect
    .poll(async () => page.getByTestId('board-canvas').getAttribute('data-board-anchor-card-id'))
    .toBe(source.id);

  const anchor = await anchorPoint(page);
  const target = await cardGrabPoint(page, topmost.id);

  await dispatchTouch(page, 'pointerdown', anchor, 72);
  await dispatchTouch(page, 'pointermove', target, 72);
  await dispatchTouch(page, 'pointerup', target, 72);

  await expect(page.getByTestId('connection-type-menu')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '1',
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-association-count',
    '1',
  );
  await expect(page.getByRole('radio', { name: /Provenance/ })).toBeDisabled();
});
