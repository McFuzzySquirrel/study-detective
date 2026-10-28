import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const CASE_TITLE = 'Recall results case';
const FIRST_TOPIC = 'Osmosis';
const SECOND_TOPIC = 'Water potential';

type BoardViewport = { readonly x: number; readonly y: number; readonly scale: number };
type BoardCard = { readonly id: string; readonly x: number; readonly y: number };
type ScreenPoint = { readonly x: number; readonly y: number };

type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly title: string;
  readonly position: { readonly x: number; readonly y: number };
};

type StoredConnection = {
  readonly id: string;
  readonly caseId: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly pairKey: string;
  readonly type: string;
};

async function readCaseViewports(
  page: Page,
): Promise<Array<{ readonly id: string; readonly viewport: BoardViewport }>> {
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
      const viewport = row.viewport as { x?: unknown; y?: unknown; scale?: unknown } | undefined;
      return {
        id: String(row.id),
        viewport: {
          x: Number(viewport?.x ?? 0),
          y: Number(viewport?.y ?? 0),
          scale: Number(viewport?.scale ?? 1),
        },
      };
    });
  });
}

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

async function cardGrabPoint(page: Page, cardId: string): Promise<ScreenPoint> {
  const box = await hostBox(page);
  const [viewport, cards] = await Promise.all([readBoardViewport(page), readBoardCards(page)]);
  const card = cards.find((candidate) => candidate.id === cardId);
  if (card === undefined) {
    throw new Error(`Card ${cardId} is missing from the board snapshot`);
  }

  const candidates = [
    { x: 24, y: 24 },
    { x: 216, y: 24 },
    { x: 24, y: 296 },
    { x: 216, y: 296 },
    { x: 120, y: 160 },
  ];

  const chosen =
    candidates.find((offset) => {
      const worldX = card.x + offset.x;
      const worldY = card.y + offset.y;
      return !cards.some((other) => {
        if (other.id === card.id) {
          return false;
        }
        return (
          worldX >= other.x &&
          worldX <= other.x + 240 &&
          worldY >= other.y &&
          worldY <= other.y + 320
        );
      });
    }) ?? candidates[0];

  if (chosen === undefined) {
    throw new Error('The card has no reachable body point');
  }

  return {
    x: box.x + (card.x + chosen.x - viewport.x) * viewport.scale,
    y: box.y + (card.y + chosen.y - viewport.y) * viewport.scale,
  };
}

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
  // Results can grow below the board; bring the stage back into the viewport
  // before computing page coordinates.
  await page.getByTestId('board-canvas-host').scrollIntoViewIfNeeded();
  const point = await cardGrabPoint(page, cardId);
  await page.mouse.move(point.x, point.y);
  await expect
    .poll(async () => page.getByTestId('board-canvas').getAttribute('data-board-anchor-card-id'), {
      timeout: 5_000,
    })
    .toBe(cardId);
  await page.waitForTimeout(100);
}

async function dragThread(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

async function hideMinimap(page: Page): Promise<void> {
  const hide = page.getByRole('button', { name: 'Hide minimap' });
  if ((await hide.count()) > 0) {
    await hide.click();
  }
}

async function createCase(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /Create your first case/i }).click();

  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await dialog.getByRole('textbox', { name: 'Case title' }).fill(CASE_TITLE);
  await dialog.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();

  const cases = await readCaseViewports(page);
  const caseId = cases[0]?.id;
  if (caseId === undefined) {
    throw new Error('The created case was not persisted');
  }
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

async function enterRecall(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Case menu' }).click();
  await page
    .getByRole('dialog', { name: 'Case menu' })
    .getByRole('link', { name: 'Recall' })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: 'Recall' })).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-board-mode', 'recall', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 30_000 },
  );
}

function expectNoScoreWording(text: string): void {
  expect(text).not.toMatch(/\b(score|percentage|grade|streak|rank|ranking)\b/i);
  expect(text).not.toMatch(/%/);
}

test('checks recall, shows grouped results and board marks, and writes nothing', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'phone',
    'Drawing scratch strings is a pointer journey exercised at desktop and tablet widths.',
  );
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const caseId = await createCase(page);
  await addTopic(page, caseId, FIRST_TOPIC, 1);
  await addTopic(page, caseId, SECOND_TOPIC, 2);

  await page.getByRole('button', { name: 'Fit all cards' }).click();
  await page.waitForTimeout(200);

  const box = await hostBox(page);
  const initialViewport = await readBoardViewport(page);
  const unordered = await readBoardCards(page);
  const topmost = unordered[unordered.length - 1];
  const lower = unordered[0];
  if (topmost === undefined || lower === undefined) {
    throw new Error('The recall fixture needs two cards');
  }

  const toPagePoint = (worldX: number, worldY: number): ScreenPoint => ({
    x: box.x + (worldX - initialViewport.x) * initialViewport.scale,
    y: box.y + (worldY - initialViewport.y) * initialViewport.scale,
  });

  const grab = toPagePoint(topmost.x + 24, topmost.y + 24);
  const drop = toPagePoint(lower.x + 480 + 24, topmost.y + 24);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const live = await readBoardCards(page);
      return live.find((candidate) => candidate.id === topmost.id)?.x ?? Number.NaN;
    })
    .toBeGreaterThan(lower.x + 400);

  await page.getByRole('button', { name: 'Fit all cards' }).click();
  await page.waitForTimeout(800);

  const spreadCards = await readBoardCards(page);
  const spreadTop = spreadCards.find((card) => card.id === topmost.id);
  const spreadLower = spreadCards.find((card) => card.id === lower.id);
  if (spreadTop === undefined || spreadLower === undefined) {
    throw new Error('The spread cards disappeared from the board');
  }
  expect(spreadTop.x - spreadLower.x).toBeGreaterThan(400);

  await hideMinimap(page);
  await hoverCard(page, topmost.id);
  const truthAnchor = await anchorPoint(page);
  const truthTarget = await cardGrabPoint(page, lower.id);
  await dragThread(page, truthAnchor, truthTarget);

  await expect(page.getByTestId('connection-type-menu')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '1',
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(800);

  const truthConnections = await readConnections(page);
  const truthCards = await readCards(page);
  const storedViewportBefore = (await readCaseViewports(page)).find(
    (row) => row.id === caseId,
  )?.viewport;
  expect(truthConnections).toHaveLength(1);

  await enterRecall(page);

  // Check with no scratch first: the accessible summary lists the saved pair
  // as missed and explains why, while the board shows a dashed outline.
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByTestId('recall-page')).toHaveAttribute(
    'data-recall-results-visible',
    'true',
  );

  const results = page.getByTestId('recall-results');
  const resultsHeading = results.getByRole('heading', { level: 3, name: 'Recall results' });
  await expect(resultsHeading).toBeVisible();
  await expect(resultsHeading).toBeFocused();
  await expect(page.getByTestId('recall-summary-empty-scratch')).toContainText(
    'No scratch connections were drawn',
  );
  await expect(page.getByTestId('recall-summary-missed')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('recall-summary-remembered')).toHaveAttribute('data-count', '0');
  await expect(page.getByRole('list', { name: 'Missed pairs' })).toContainText(FIRST_TOPIC);
  await expect(page.getByRole('list', { name: 'Missed pairs' })).toContainText(SECOND_TOPIC);
  await expect(page.getByTestId('recall-overlay')).toHaveAttribute('data-outline-count', '2');
  await expect(page.locator('[data-result-kind="missed"]')).toHaveCount(1);
  await expect(page.getByTestId('recall-announcement')).toContainText(
    'No scratch connections were drawn',
  );
  expectNoScoreWording(await results.innerText());

  // Drawing a scratch pair clears the previous check, then Check marks the
  // reversed pair remembered and lists both card titles.
  await hideMinimap(page);
  await hoverCard(page, lower.id);
  const scratchAnchor = await anchorPoint(page);
  const scratchTarget = await cardGrabPoint(page, topmost.id);
  await dragThread(page, scratchAnchor, scratchTarget);

  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '1');
  await expect(page.getByTestId('recall-page')).toHaveAttribute(
    'data-recall-results-visible',
    'false',
  );

  await page.getByRole('button', { name: 'Check' }).click();

  await expect(page.getByTestId('recall-page')).toHaveAttribute(
    'data-recall-remembered-count',
    '1',
  );
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-missed-count', '0');
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-extra-count', '0');
  await expect(page.getByTestId('recall-page')).toHaveAttribute(
    'data-recall-type-mismatch-count',
    '0',
  );

  await expect(page.getByTestId('recall-results')).toBeVisible();
  await expect(
    page.getByTestId('recall-results').getByRole('heading', {
      level: 3,
      name: 'Recall results',
    }),
  ).toBeFocused();
  await expect(page.getByTestId('recall-summary-remembered')).toHaveAttribute('data-count', '1');
  await expect(page.getByRole('list', { name: 'Remembered pairs' })).toContainText(FIRST_TOPIC);
  await expect(page.getByRole('list', { name: 'Remembered pairs' })).toContainText(SECOND_TOPIC);
  await expect(page.locator('[data-result-kind="remembered"]')).toHaveCount(1);
  await expect(page.getByTestId('recall-overlay')).toHaveAttribute('data-marker-count', '1');
  await expect(page.getByTestId('recall-announcement')).toContainText('1 pair remembered');
  expectNoScoreWording(await page.getByTestId('recall-results').innerText());

  // The three toolbar actions remain available after Check, at the 44 px floor.
  const checkButton = page.getByRole('button', { name: 'Check' });
  await expect(checkButton).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Reset scratch' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Exit recall' })).toBeEnabled();
  const checkBox = await checkButton.boundingBox();
  expect(checkBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(checkBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  // The OS reduced-motion preference removes the marker entrance animation.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByTestId('recall-overlay')).toHaveAttribute('data-reduced-motion', 'true');
  const markerAnimation = await page
    .locator('[data-result-kind="remembered"]')
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(markerAnimation).toBe('none');

  // Check and results never touch the saved graph, card positions, or camera.
  expect(await readConnections(page)).toEqual(truthConnections);
  const cardsDuringResults = await readCards(page);
  expect(cardsDuringResults.map((card) => card.id).sort()).toEqual(
    truthCards.map((card) => card.id).sort(),
  );
  for (const card of cardsDuringResults) {
    const before = truthCards.find((candidate) => candidate.id === card.id);
    expect(card.position.x).toBeCloseTo(before?.position.x ?? Number.NaN, 0);
    expect(card.position.y).toBeCloseTo(before?.position.y ?? Number.NaN, 0);
  }
  const viewportDuringResults = (await readCaseViewports(page)).find(
    (row) => row.id === caseId,
  )?.viewport;
  expect(viewportDuringResults).toEqual(storedViewportBefore);

  // Reset clears the result surfaces and keeps the recall route.
  await page.getByRole('button', { name: 'Reset scratch' }).click();
  await expect(page.getByTestId('recall-page')).toHaveAttribute(
    'data-recall-results-visible',
    'false',
  );
  await expect(page.getByTestId('recall-results')).toHaveCount(0);
  await expect(page.getByTestId('recall-overlay')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Recall' })).toBeVisible();

  // With an empty scratch layer, exit does not ask for confirmation.
  await page.getByRole('button', { name: 'Exit recall' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '1',
  );

  expect(await readConnections(page)).toEqual(truthConnections);
  const storedViewportAfter = (await readCaseViewports(page)).find(
    (row) => row.id === caseId,
  )?.viewport;
  expect(storedViewportAfter).toEqual(storedViewportBefore);
  expect(consoleErrors).toEqual([]);
});
