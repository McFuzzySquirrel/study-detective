import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

import { seedLargeCase } from './helpers/seedLargeCase';

/**
 * BOARD-FR-09 board-dominance gate.
 *
 * Measures the real production build at the three canonical A11Y-FR-03
 * viewports with a 12-card case and one connection. The stage must hold at
 * least 75 % of the content area on tablet and desktop and 85 % on phone, the
 * page must not scroll vertically or horizontally at 100 % text, and opening
 * any board surface must not resize the stage.
 *
 * The viewport matrix lives here rather than in the Playwright projects so the
 * three measurements always run at 1x.
 */

type GateViewport = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly minimumShare: number;
};

const VIEWPORTS: readonly GateViewport[] = [
  { name: 'phone', width: 390, height: 844, minimumShare: 0.85 },
  { name: 'tablet-landscape', width: 1280, height: 800, minimumShare: 0.75 },
  { name: 'desktop', width: 1440, height: 900, minimumShare: 0.75 },
];

const CASE_TITLE = 'Board gate case';

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

async function requireBox(locator: ReturnType<Page['locator']>): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('The measured element did not render a box');
  }
  return box;
}

async function stageBox(page: Page): Promise<Box> {
  return requireBox(page.getByTestId('board-canvas'));
}

async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );
}

async function assertNoPageScroll(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement?.scrollHeight ?? document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    scrollY: window.scrollY,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  expect(metrics.scrollHeight, `${label}: page height`).toBeLessThanOrEqual(metrics.innerHeight);
  expect(metrics.scrollY, `${label}: scrollY`).toBe(0);
  expect(metrics.scrollWidth, `${label}: page width`).toBeLessThanOrEqual(metrics.innerWidth);
}

/** The card grid and camera the scene exposes for pointer evidence. */
async function readBoardState(page: Page): Promise<{
  readonly viewport: { x: number; y: number; scale: number };
  readonly cards: ReadonlyArray<{ id: string; x: number; y: number }>;
}> {
  return page.getByTestId('board-canvas').evaluate((element) => ({
    viewport: {
      x: Number(element.getAttribute('data-board-viewport-x')),
      y: Number(element.getAttribute('data-board-viewport-y')),
      scale: Number(element.getAttribute('data-board-scale')),
    },
    cards: JSON.parse(element.getAttribute('data-board-card-positions') ?? '[]') as Array<{
      id: string;
      x: number;
      y: number;
    }>,
  }));
}

async function boardPoint(
  page: Page,
  card: { x: number; y: number },
  offset: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const host = await requireBox(page.getByTestId('board-canvas-host'));
  const { viewport } = await readBoardState(page);
  return {
    x: host.x + (card.x + offset.x - viewport.x) * viewport.scale,
    y: host.y + (card.y + offset.y - viewport.y) * viewport.scale,
  };
}

/** Hover the first card, drag its thread anchor to the second, open detail. */
async function openConnectionDetail(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Fit all cards' }).click();
  await page.waitForTimeout(250);

  const { cards } = await readBoardState(page);
  const [from, to] = cards;
  if (from === undefined || to === undefined) {
    throw new Error('The gate fixture needs at least two cards to draw a thread');
  }

  const grab = await boardPoint(page, from, { x: 40, y: 40 });
  await page.mouse.move(grab.x, grab.y);

  await expect
    .poll(() => page.getByTestId('board-canvas').getAttribute('data-board-anchor-card-id'))
    .toBe(from.id);

  const rawAnchor = await page.getByTestId('board-canvas').getAttribute('data-board-anchor-point');
  const host = await requireBox(page.getByTestId('board-canvas-host'));
  const anchor = JSON.parse(rawAnchor ?? '{}') as { x?: number; y?: number };
  if (anchor.x === undefined || anchor.y === undefined) {
    throw new Error('The selected card has no thread anchor');
  }

  const target = await boardPoint(page, to, { x: 40, y: 40 });
  await page.mouse.move(host.x + anchor.x, host.y + anchor.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByTestId('connection-type-menu')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog', { name: 'Connection details' })).toBeVisible();
}

async function capture(page: Page, viewport: GateViewport, testInfo: TestInfo): Promise<void> {
  await testInfo.attach(`board-gate-${viewport.name}.png`, {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
}

test.describe('board dominance gate', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(
      testInfo.project.name !== 'desktop',
      'The gate sets all three canonical viewports itself.',
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height} holds the board`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const fixture = await seedLargeCase(page, {
        cardCount: 12,
        caseTitle: CASE_TITLE,
        viewport: { x: 0, y: 0, scale: 0.75 },
      });

      await page.goto(`/#/case/${fixture.caseId}`);
      await waitForBoard(page);

      const shell = await requireBox(page.locator('.app-frame__topbar'));
      const stage = await stageBox(page);
      const contentHeight = viewport.height - shell.height;
      const share = stage.height / contentHeight;

      expect(share, `${viewport.name}: board share of the content area`).toBeGreaterThanOrEqual(
        viewport.minimumShare,
      );
      expect(stage.width, `${viewport.name}: full-bleed stage width`).toBeGreaterThan(
        shell.width * 0.9,
      );

      await assertNoPageScroll(page, viewport.name);
      await capture(page, viewport, testInfo);

      const widthBefore = stage.width;
      const isPhone = viewport.width < 600;
      const trigger = (name: RegExp | string) =>
        isPhone
          ? page.locator('.case-board-bar').getByRole('button', { name })
          : page.getByRole('button', { name });

      // Search.
      await trigger(isPhone ? 'Search' : 'Search').click();
      await expect(page.getByRole('dialog', { name: 'Search this case' })).toBeVisible();
      expect((await stageBox(page)).width, `${viewport.name}: search width`).toBeCloseTo(
        widthBefore,
        0,
      );
      await page.keyboard.press('Escape');

      // Case menu.
      await trigger(/^Case menu/).click();
      await expect(page.getByRole('dialog', { name: 'Case menu' })).toBeVisible();
      expect((await stageBox(page)).width, `${viewport.name}: menu width`).toBeCloseTo(
        widthBefore,
        0,
      );
      await page.keyboard.press('Escape');

      // Closure.
      await trigger(isPhone ? 'Case closure' : /^Readiness:/).click();
      await expect(page.getByRole('dialog', { name: 'Case closure' })).toBeVisible();
      expect((await stageBox(page)).width, `${viewport.name}: closure width`).toBeCloseTo(
        widthBefore,
        0,
      );
      await page.keyboard.press('Escape');

      // Connection detail is a trailing Non-modal panel on wide; on phone it is
      // a modal sheet that covers the bar, so the responsive suite proves its
      // containment rather than a pointer-drawn thread at this viewport.
      if (!isPhone) {
        await openConnectionDetail(page);
        expect((await stageBox(page)).width, `${viewport.name}: detail width`).toBeCloseTo(
          widthBefore,
          0,
        );
        await page.keyboard.press('Escape');
      }

      await assertNoPageScroll(page, `${viewport.name} after surfaces`);
    });
  }
});
test('200 % text keeps the frame readable and free of horizontal scroll', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await seedLargeCase(page, {
    cardCount: 12,
    caseTitle: CASE_TITLE,
    viewport: { x: 0, y: 0, scale: 0.75 },
  });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/#/case/${fixture.caseId}`);
    await waitForBoard(page);

    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(metrics.scrollWidth, `${viewport.name} 200 % text width`).toBeLessThanOrEqual(
      metrics.innerWidth,
    );

    const stage = await stageBox(page);
    expect(stage.height, `${viewport.name} 200 % stage floor`).toBeGreaterThanOrEqual(239);
    await expect(page.getByRole('button', { name: /^Case menu/ })).toBeVisible();
    await expect(page.getByTestId('case-board-title')).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  }

  await capture(page, VIEWPORTS[VIEWPORTS.length - 1] as GateViewport, testInfo);
});
