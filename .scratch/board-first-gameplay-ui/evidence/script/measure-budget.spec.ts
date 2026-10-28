/**
 * THROWAWAY measurement script for wayfinder ticket 01.
 *
 * It measures the board route's competing surfaces at the three canonical
 * viewports so the redesign spec has a "before" table instead of adjectives.
 * It asserts almost nothing; it records geometry and screenshots.
 *
 * Run:  npx playwright test e2e/measure-budget.spec.ts --project=desktop
 * It is expected to be archived under .scratch/ afterwards, never committed as
 * a maintained suite.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { seedLargeCase } from './helpers/seedLargeCase';

const CARD_COUNT = 12;
const OUT_DIR = '.scratch/board-first-gameplay-ui/evidence';

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'tablet-landscape-1280x800', width: 1280, height: 800 },
  { name: 'phone-390x844', width: 390, height: 844 },
] as const;

const SELECTORS: ReadonlyArray<readonly [string, string]> = [
  ['shell-topbar', '.app-frame__topbar'],
  ['shell-status', '.app-frame__status'],
  ['main', '#main-content'],
  ['page-header', '.case-board-page__header'],
  ['header-eyebrow', '.case-board-page__eyebrow'],
  ['header-title', '.case-board-page__title'],
  ['header-summary', '.case-board-page__summary'],
  ['header-actions', '.case-board-page__actions'],
  ['header-case-actions', '.case-board-page__header .case-board-page__sheet-trigger'],
  ['sheet-triggers', '.case-board-page__sheet-triggers'],
  ['sheet-trigger-file', '.case-board-page__sheet-trigger'],
  ['search-panel', '.case-board-page__search'],
  ['scale-warning', '.scale-warning'],
  ['backup-reminder', '.backup-reminder'],
  ['board-controls-row', '.case-board-page__board-controls'],
  ['connection-legend', '.connection-legend'],
  ['workspace', '.case-board-page__workspace'],
  ['closure-panel', '.closure-panel'],
  ['connection-detail', '.connection-detail'],
  ['stage', '.case-board-page__stage'],
  ['canvas', '.board-canvas'],
  ['canvas-controls', '.board-canvas__controls'],
  ['minimap', '.board-minimap'],
];

type Measurement = { readonly present: false } | { readonly present: true; readonly height: number; readonly width: number; readonly top: number };

async function measure(page: Page, selector: string): Promise<Measurement> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) {
    return { present: false };
  }
  if (!(await locator.isVisible())) {
    return { present: false };
  }
  const box = await locator.boundingBox();
  if (box === null) {
    return { present: false };
  }
  return {
    present: true,
    height: Math.round(box.height * 10) / 10,
    width: Math.round(box.width * 10) / 10,
    top: Math.round(box.y * 10) / 10,
  };
}

async function pageMetrics(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const main = document.getElementById('main-content');
    const style = main === null ? null : getComputedStyle(main);
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      pageScrollsVertically: document.documentElement.scrollHeight - window.innerHeight > 1,
      mainPaddingBlockStart: style?.paddingTop ?? null,
      mainPaddingBlockEnd: style?.paddingBottom ?? null,
      mainMaxInlineSize: style?.maxWidth ?? null,
    };
  });
}

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

async function waitForBoardReady(page: Page): Promise<void> {
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 30_000 },
  );
  await settleLayout(page);
}

async function snapshot(page: Page, name: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  // Record where the page had scrolled to during the interaction, then measure
  // from the top so every box is comparable across viewports.
  const scrollYAtCapture = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settleLayout(page);

  const surfaces: Record<string, Measurement> = {};
  for (const [label, selector] of SELECTORS) {
    surfaces[label] = await measure(page, selector);
  }

  const record = {
    name,
    scrollYAtCapture,
    metrics: await pageMetrics(page),
    surfaces,
    ...extra,
  };

  mkdirSync(join(OUT_DIR, 'raw'), { recursive: true });
  writeFileSync(join(OUT_DIR, 'raw', `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);

  mkdirSync(join(OUT_DIR, 'screenshots'), { recursive: true });
  await page.screenshot({ path: join(OUT_DIR, 'screenshots', `${name}.png`), fullPage: true });

  return record;
}

/* -------------------------------------------------------------------------- */
/* Thread creation (same mouse maths as e2e/connections.spec.ts)              */
/* -------------------------------------------------------------------------- */

type ScreenPoint = { readonly x: number; readonly y: number };

async function hostBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('board-canvas-host').boundingBox();
  if (box === null) {
    throw new Error('The board canvas host did not render');
  }
  return box;
}

async function boardCamera(page: Page): Promise<{ x: number; y: number; scale: number }> {
  const canvas = page.getByTestId('board-canvas');
  const [x, y, scale] = await Promise.all([
    canvas.getAttribute('data-board-viewport-x'),
    canvas.getAttribute('data-board-viewport-y'),
    canvas.getAttribute('data-board-scale'),
  ]);
  return { x: Number(x), y: Number(y), scale: Number(scale) };
}

async function boardCards(page: Page): Promise<Array<{ id: string; x: number; y: number }>> {
  const raw = await page.getByTestId('board-canvas').getAttribute('data-board-card-positions');
  return raw === null ? [] : (JSON.parse(raw) as Array<{ id: string; x: number; y: number }>);
}

async function cardGrabPoint(page: Page, cardId: string): Promise<ScreenPoint> {
  const box = await hostBox(page);
  const [camera, cards] = await Promise.all([boardCamera(page), boardCards(page)]);
  const card = cards.find((candidate) => candidate.id === cardId);
  if (card === undefined) {
    throw new Error(`Card ${cardId} is missing from the board snapshot`);
  }
  return {
    x: box.x + (card.x + 40 - camera.x) * camera.scale,
    y: box.y + (card.y + 40 - camera.y) * camera.scale,
  };
}

async function anchorPoint(page: Page): Promise<ScreenPoint> {
  const box = await hostBox(page);
  const raw = await page.getByTestId('board-canvas').getAttribute('data-board-anchor-point');
  if (raw === null || raw.length === 0) {
    throw new Error('The board has no visible thread anchor');
  }
  const point = JSON.parse(raw) as { x: number; y: number };
  return { x: box.x + point.x, y: box.y + point.y };
}

async function hoverCard(page: Page, cardId: string): Promise<void> {
  const point = await cardGrabPoint(page, cardId);
  await page.mouse.move(point.x, point.y);
  await expect
    .poll(async () => page.getByTestId('board-canvas').getAttribute('data-board-anchor-card-id'), {
      timeout: 5_000,
    })
    .not.toBe('');
}

async function dragThread(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

/** Create the first thread between two visible cards, then dismiss the type menu. */
async function createThread(page: Page, fromCardId: string, toCardId: string): Promise<void> {
  await page.getByRole('button', { name: 'Fit all cards' }).click({ timeout: 15_000 });
  await settleLayout(page);
  await hoverCard(page, fromCardId);
  const anchor = await anchorPoint(page);
  const target = await cardGrabPoint(page, toCardId);
  await dragThread(page, anchor, target);

  const debug = {
    count: await page.getByTestId('board-canvas').getAttribute('data-board-connection-count'),
    selected: await page
      .getByTestId('board-canvas')
      .getAttribute('data-board-selected-connection'),
    anchorCard: await page.getByTestId('board-canvas').getAttribute('data-board-anchor-card-id'),
  };
  console.log('DEBUG after drag', JSON.stringify(debug));

  const menu = page.getByTestId('connection-type-menu');
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(menu).not.toBeVisible();
}

/** Dropping the same pair re-selects the existing row and opens the inspector. */
async function reselectThread(page: Page, fromCardId: string, toCardId: string): Promise<void> {
  await page.getByRole('button', { name: 'Fit all cards' }).click({ timeout: 15_000 });
  await settleLayout(page);
  await hoverCard(page, fromCardId);
  const anchor = await anchorPoint(page);
  const target = await cardGrabPoint(page, toCardId);
  await dragThread(page, anchor, target);
  await expect
    .poll(async () => page.getByTestId('board-canvas').getAttribute('data-board-selected-connection'), {
      timeout: 10_000,
    })
    .not.toBe('');
  await settleLayout(page);
}

/* -------------------------------------------------------------------------- */
/* Passes                                                                     */
/* -------------------------------------------------------------------------- */

test('baseline chrome with 12 cards and no thread', async ({ page }) => {
  test.setTimeout(240_000);
  const fixture = await seedLargeCase(page, {
    cardCount: CARD_COUNT,
    caseTitle: 'Budget fixture: 12 cards',
  });
  const casePath = `/#/case/${fixture.caseId}`;

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(casePath);
    await waitForBoardReady(page);
    const record = await snapshot(page, `baseline-${viewport.name}`, {
      caseId: fixture.caseId,
      cardCount: CARD_COUNT,
      hasThread: false,
    });
    console.log(JSON.stringify(record, null, 2));
  }
});

test('first-backup reminder and connection inspector', async ({ page }) => {
  test.setTimeout(240_000);
  const fixture = await seedLargeCase(page, {
    cardCount: CARD_COUNT,
    caseTitle: 'Budget fixture: 12 cards with a thread',
  });
  const casePath = `/#/case/${fixture.caseId}`;
  const [firstCard, secondCard] = [fixture.cardIds[0], fixture.cardIds[1]];

  await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
  await page.goto(casePath);
  await waitForBoardReady(page);
  await createThread(page, firstCard, secondCard);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // The reminder hook reads counts on mount, so a reload after the first
    // thread is what the student actually sees on return.
    await page.goto(casePath);
    await waitForBoardReady(page);
    const reminderNodes = await page.locator('.backup-reminder').count();

    console.log(
      JSON.stringify(
        await snapshot(page, `thread-${viewport.name}`, {
          caseId: fixture.caseId,
          cardCount: CARD_COUNT,
          hasThread: true,
          reminderNodes,
          selectedThread: false,
        }),
        null,
        2,
      ),
    );

    // The phone inspector is a modal sheet, not a layout column, so only the
    // two wide modes get a second selection pass.
    if (viewport.name === VIEWPORTS[2].name) {
      continue;
    }

    await reselectThread(page, firstCard, secondCard);

    console.log(
      JSON.stringify(
        await snapshot(page, `thread-selected-${viewport.name}`, {
          caseId: fixture.caseId,
          cardCount: CARD_COUNT,
          hasThread: true,
          reminderNodes,
          selectedThread: true,
        }),
        null,
        2,
      ),
    );
  }
});

for (const cardCount of [125, 150] as const) {
  test(`scale warning at ${cardCount} cards`, async ({ page }) => {
    test.setTimeout(240_000);

    const fixture = await seedLargeCase(page, {
      cardCount,
      caseTitle: `Budget fixture: ${cardCount} cards`,
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/#/case/${fixture.caseId}`);
    await waitForBoardReady(page);

    const record = await snapshot(page, `scale-${cardCount}-tablet-landscape-1280x800`, {
      caseId: fixture.caseId,
      cardCount,
      hasThread: false,
    });
    console.log(JSON.stringify(record, null, 2));
  });
}
