import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const CASE_TITLE = 'Board navigation case';
const TOPIC_TITLE = 'Membrane transport';

type BoardViewport = {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
};

type StoredCase = {
  readonly id: string;
  readonly title: string;
  readonly viewport: BoardViewport | null;
};

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
      const viewport = row.viewport as BoardViewport | undefined;
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
  const rows = await readCases(page);
  const found = rows.find((row) => row.id === caseId);
  if (found === undefined) {
    throw new Error(`Case ${caseId} was not found in IndexedDB`);
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

async function createCase(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /Create your first case/i }).click();

  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await dialog.getByRole('textbox', { name: 'Case title' }).fill(CASE_TITLE);
  await dialog.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();

  await expect.poll(async () => (await readCases(page)).length, { timeout: 10_000 }).toBe(1);
  const cases = await readCases(page);

  const caseId = cases[0]?.id;
  if (caseId === undefined) {
    throw new Error('The created case was not persisted');
  }
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

test('pans, zooms, clamps, persists the viewport, reloads it, and tears down cleanly', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const caseId = await createCase(page);
  await addTopic(page, caseId);

  const host = page.getByTestId('board-canvas-host');
  const canvas = page.getByTestId('board-pixi-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('role', 'img');
  await expect(canvas).toHaveAttribute('aria-label', /Case board canvas/i);

  const box = await host.boundingBox();
  if (box === null) {
    throw new Error('The board canvas host did not render');
  }

  // A scripted background drag changes the rendered camera.
  const beforePan = await readBoardViewport(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => (await readBoardViewport(page)).x).toBeLessThan(beforePan.x - 40);
  await expect.poll(async () => (await readBoardViewport(page)).y).toBeLessThan(beforePan.y - 20);

  // Wait past the 500 ms debounce and prove the repository has the same camera.
  await page.waitForTimeout(900);
  const afterPan = await readBoardViewport(page);
  const savedAfterPan = await readCase(page, caseId);
  expect(savedAfterPan.viewport).not.toBeNull();
  expect(savedAfterPan.viewport?.x ?? Number.NaN).toBeCloseTo(afterPan.x, 1);
  expect(savedAfterPan.viewport?.y ?? Number.NaN).toBeCloseTo(afterPan.y, 1);

  // Wheel zoom stays pointer-anchored and inside the clamp.
  // Playwright dispatches integer client coordinates; floor the stage centre
  // so the expected anchor matches the browser event exactly.
  const anchorX = Math.floor(box.width / 2);
  const anchorY = Math.floor(box.height / 2);
  const beforeWheel = await readBoardViewport(page);
  await page.mouse.move(box.x + anchorX, box.y + anchorY);
  await page.mouse.wheel(0, -240);

  await expect
    .poll(async () => (await readBoardViewport(page)).scale)
    .toBeGreaterThan(beforeWheel.scale);
  const afterWheel = await readBoardViewport(page);
  expect(afterWheel.scale).toBeLessThanOrEqual(2.5);
  expect(afterWheel.scale).toBeGreaterThanOrEqual(0.25);
  expect(anchorX / afterWheel.scale + afterWheel.x).toBeCloseTo(
    anchorX / beforeWheel.scale + beforeWheel.x,
    1,
  );
  expect(anchorY / afterWheel.scale + afterWheel.y).toBeCloseTo(
    anchorY / beforeWheel.scale + beforeWheel.y,
    1,
  );

  // Controls expose both clamp boundaries.
  for (let index = 0; index < 10; index += 1) {
    await page.getByRole('button', { name: 'Zoom in' }).click();
  }
  await expect.poll(async () => (await readBoardViewport(page)).scale).toBeCloseTo(2.5, 3);

  for (let index = 0; index < 20; index += 1) {
    await page.getByRole('button', { name: 'Zoom out' }).click();
  }
  await expect.poll(async () => (await readBoardViewport(page)).scale).toBeCloseTo(0.25, 3);

  // Reset never writes. The wheel and click run in one task, before the 500 ms
  // save timer exists, so the stored camera must remain byte-for-byte stable.
  await page.waitForTimeout(900);
  const storedBeforeReset = await readCase(page, caseId);
  expect(storedBeforeReset.viewport).not.toBeNull();

  await page.evaluate(() => {
    const hostElement = document.querySelector('[data-testid="board-canvas-host"]');
    if (!(hostElement instanceof HTMLElement)) {
      throw new Error('The board host is missing');
    }

    const rect = hostElement.getBoundingClientRect();
    hostElement.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deltaY: -240,
      }),
    );

    const reset = document.querySelector('button[aria-label="Reset view"]');
    if (!(reset instanceof HTMLButtonElement)) {
      throw new Error('The reset control is missing');
    }
    reset.click();
  });

  await expect.poll(async () => (await readBoardViewport(page)).scale).toBeCloseTo(1, 2);

  const resetViewport = await readBoardViewport(page);
  expect(resetViewport.x).toBeCloseTo(0, 2);
  expect(resetViewport.y).toBeCloseTo(0, 2);

  await page.waitForTimeout(900);
  const afterReset = await readCase(page, caseId);
  expect(afterReset.viewport?.x ?? Number.NaN).toBeCloseTo(
    storedBeforeReset.viewport?.x ?? Number.NaN,
    3,
  );
  expect(afterReset.viewport?.y ?? Number.NaN).toBeCloseTo(
    storedBeforeReset.viewport?.y ?? Number.NaN,
    3,
  );
  expect(afterReset.viewport?.scale ?? Number.NaN).toBeCloseTo(
    storedBeforeReset.viewport?.scale ?? Number.NaN,
    3,
  );

  // Moving again is a real camera change and is persisted after the debounce.
  const beforeSecondPan = await readBoardViewport(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(async () => (await readCase(page, caseId)).viewport?.scale ?? 0, { timeout: 10_000 })
    .toBeCloseTo(beforeSecondPan.scale, 2);

  const liveAfterSecondPan = await readBoardViewport(page);
  expect(liveAfterSecondPan.x).toBeLessThan(-20);
  const persistedBeforeReload = await readCase(page, caseId);
  expect(persistedBeforeReload.viewport).not.toBeNull();
  expect(persistedBeforeReload.viewport?.x ?? Number.NaN).toBeCloseTo(liveAfterSecondPan.x, 1);
  expect(persistedBeforeReload.viewport?.y ?? Number.NaN).toBeCloseTo(liveAfterSecondPan.y, 1);

  // Reload restores the stored camera.
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );

  await expect
    .poll(async () => (await readBoardViewport(page)).x, { timeout: 10_000 })
    .toBeCloseTo(persistedBeforeReload.viewport?.x ?? 0, 0);

  const restored = await readBoardViewport(page);
  expect(restored.y).toBeCloseTo(persistedBeforeReload.viewport?.y ?? 0, 1);
  expect(restored.scale).toBeCloseTo(persistedBeforeReload.viewport?.scale ?? 0, 2);

  // Route away and back twice through the in-app link. Each mount must leave
  // exactly one canvas and no listener or renderer error behind.
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole('link', { name: 'Add evidence' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Capture evidence' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
    await expect(page.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-scene-status',
      'ready',
      { timeout: 20_000 },
    );
    await expect(page.locator('[data-testid="board-canvas-host"] canvas')).toHaveCount(1);
  }

  expect(consoleErrors).toEqual([]);
});

test('shows a recoverable fallback after a lost WebGL context and restores the board', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const caseId = await createCase(page);
  await addTopic(page, caseId);

  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );

  const extensionAvailable = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="board-pixi-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return false;
    }
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (context === null) {
      return false;
    }
    return 'getExtension' in context
      ? Boolean((context as WebGLRenderingContext).getExtension('WEBGL_lose_context'))
      : false;
  });

  test.skip(!extensionAvailable, 'This browser does not expose WEBGL_lose_context.');

  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="board-pixi-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('The Pixi canvas is missing');
    }
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (context === null || !('getExtension' in context)) {
      throw new Error('A WebGL context is required for this test');
    }
    const extension = (context as WebGLRenderingContext).getExtension('WEBGL_lose_context');
    if (extension === null) {
      throw new Error('WEBGL_lose_context is unavailable');
    }
    extension.loseContext();
  });

  await expect(page.getByRole('alert')).toContainText('The board lost its graphics context');
  await expect(
    page.getByTestId('board-canvas').getByRole('link', { name: 'Open card list' }),
  ).toHaveAttribute('href', `#/case/${caseId}/list`);

  await page.getByRole('button', { name: 'Restore board' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('board-pixi-canvas')).toBeVisible();
  await expect(page.locator('[data-testid="board-canvas-host"] canvas')).toHaveCount(1);
});
