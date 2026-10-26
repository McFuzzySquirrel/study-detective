import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const CASE_TITLE = 'Recall case';
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

/**
 * A screen point over one card's body, clear of its anchor and of every card
 * painted above it. Two cards can overlap after a move, so candidates walk the
 * corners and centre until one is not covered by a later card.
 */
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
  // Let the hover render's ref-sync effects settle before the next pointer down.
  await page.waitForTimeout(100);
}

async function dragThread(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

/** Remove the top-right inset so it cannot cover a card's thread anchor. */
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
  await page.getByRole('link', { name: 'Recall', exact: true }).click();
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

test('enters recall, hides truth strings, draws reversed pairs, checks, resets, and exits', async ({
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

  // Spread the two cards far enough apart that neither card covers the other's
  // body or thread anchor. Both cards are 240 px wide, so a 480 px world gap
  // leaves a clean 240 px empty span between their facing edges.
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

  // Create one truth string through the ordinary board gesture. The most
  // recently moved card is still selected, so its anchor is the reliable
  // source; the minimap is hidden because it can cover the top-right anchor.
  // Recall then hides this row and compares a reversed scratch draw against it.
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

  // Every truth string is hidden while both cards and their world positions
  // remain visible. The fit is in memory, so the stored camera is untouched.
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-board-card-count', '2');
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '0',
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-association-count',
    '0',
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-provenance-count',
    '0',
  );
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-board-scratch-count', '0');
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '0');

  const recallCards = await readBoardCards(page);
  expect(recallCards.map((card) => card.id).sort()).toEqual(
    truthCards.map((card) => card.id).sort(),
  );
  for (const card of recallCards) {
    const stored = truthCards.find((candidate) => candidate.id === card.id);
    expect(stored?.position.x ?? Number.NaN).toBeCloseTo(card.x, 0);
    expect(stored?.position.y ?? Number.NaN).toBeCloseTo(card.y, 0);
  }

  const storedViewportDuringRecall = (await readCaseViewports(page)).find(
    (row) => row.id === caseId,
  )?.viewport;
  expect(storedViewportDuringRecall).toEqual(storedViewportBefore);

  // Draw the reverse orientation: topmost card anchor -> lower card body.
  // The minimap sits over the board's top-right corner, where the rightmost
  // card's anchor can land. Hide it so the pointer journey hits the anchor, not
  // the inset overlay.
  await hideMinimap(page);
  await hoverCard(page, lower.id);
  const scratchAnchor = await anchorPoint(page);
  const scratchTarget = await cardGrabPoint(page, topmost.id);
  await dragThread(page, scratchAnchor, scratchTarget);

  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '1');
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-board-scratch-count', '1');
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '0',
  );
  await expect(page.getByTestId('recall-scratch-count')).toHaveText(/Scratch 1 connection/);
  await expect(page.getByRole('list', { name: 'Scratch connections' })).toContainText(FIRST_TOPIC);
  await expect(page.getByRole('list', { name: 'Scratch connections' })).toContainText(SECOND_TOPIC);
  await expect(page.getByTestId('connection-type-menu')).not.toBeVisible();

  // Check matches the reversed pair without creating a repository row.
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-checked', 'true');
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
  expect(await readConnections(page)).toEqual(truthConnections);

  // Reset stays in recall and clears both the strings and the check state.
  await page.getByRole('button', { name: 'Reset scratch' }).click();
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '0');
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-checked', 'false');
  await expect(page.getByRole('list', { name: 'Scratch connections' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Recall' })).toBeVisible();

  // A non-empty exit asks first. Keep practising does not leave the route.
  await hoverCard(page, lower.id);
  const secondAnchor = await anchorPoint(page);
  const secondTarget = await cardGrabPoint(page, topmost.id);
  await dragThread(page, secondAnchor, secondTarget);
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '1');

  await page.getByRole('button', { name: 'Exit recall' }).click();
  const exitDialog = page.getByRole('dialog', { name: 'Exit recall?' });
  await expect(exitDialog).toBeVisible();
  await page.getByRole('button', { name: 'Keep practising' }).click();
  await expect(exitDialog).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Recall' })).toBeVisible();

  await page.getByRole('button', { name: 'Exit recall' }).click();
  await page.getByRole('button', { name: 'Discard and exit' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-board-mode', 'browse');
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-connection-count',
    '1',
  );

  // Re-entry starts empty: exit discarded every scratch trace.
  await enterRecall(page);
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '0');

  // A plain route change also discards silently. No dialog blocks leaving.
  await hideMinimap(page);
  await hoverCard(page, lower.id);
  const routeAnchor = await anchorPoint(page);
  const routeTarget = await cardGrabPoint(page, topmost.id);
  await dragThread(page, routeAnchor, routeTarget);
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '1');

  await page.getByRole('link', { name: 'Back to case board' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await enterRecall(page);
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '0');

  // A reload is a fresh in-memory module: draw once, reload, and the scratch
  // layer is empty again without any confirmation or restore prompt.
  await hideMinimap(page);
  await hoverCard(page, lower.id);
  const reloadAnchor = await anchorPoint(page);
  const reloadTarget = await cardGrabPoint(page, topmost.id);
  await dragThread(page, reloadAnchor, reloadTarget);
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '1');

  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Recall' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('board-canvas')).toHaveAttribute('data-board-mode', 'recall', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '0');

  // The case graph and camera survived recall byte-for-byte.
  const afterConnections = await readConnections(page);
  const afterCards = await readCards(page);
  const storedViewportAfter = (await readCaseViewports(page)).find(
    (row) => row.id === caseId,
  )?.viewport;

  expect(afterConnections).toEqual(truthConnections);
  expect(afterCards.map((card) => card.id).sort()).toEqual(
    truthCards.map((card) => card.id).sort(),
  );
  for (const card of afterCards) {
    const before = truthCards.find((candidate) => candidate.id === card.id);
    expect(card.position.x).toBeCloseTo(before?.position.x ?? Number.NaN, 0);
    expect(card.position.y).toBeCloseTo(before?.position.y ?? Number.NaN, 0);
  }
  expect(storedViewportAfter).toEqual(storedViewportBefore);

  expect(consoleErrors).toEqual([]);
});
