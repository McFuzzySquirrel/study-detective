import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { AXE_RUN_OPTIONS, formatAxeFailure, summarizeAxeResults } from '../tests/a11y/axeConfig';

// The welcome is the one surface that must be seen with no prior state. Every
// other journey inherits a storage fixture with the welcome flag already set.
test.use({ storageState: { cookies: [], origins: [] } });

const WELCOME_TITLE = 'Welcome to Notes Detective';
const DEMO_TITLE = 'Demo Case: The Missing Lecture';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  return errors;
}

async function waitForWelcome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: WELCOME_TITLE })).toBeVisible({
    timeout: 30_000,
  });
}

test('a first visit lands on the welcome, teaches the flow, and enters the shelf', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const consoleErrors = collectConsoleErrors(page);

  await waitForWelcome(page);
  expect(page.url()).toContain('#/welcome');

  // The traced SVG is a real, loaded hero, not a broken image placeholder.
  const image = page.getByRole('img', { name: /students studying together/i });
  await expect(image).toBeVisible();
  await expect
    .poll(async () => image.evaluate((element: HTMLImageElement) => element.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // The welcome route keeps Help but not the primary nav, so Enter is the
  // deliberate way into the shelf.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Help' })).toBeVisible();

  const howItWorks = page.getByRole('button', { name: 'How it works' });
  await howItWorks.click();

  const help = page.getByRole('dialog', { name: 'How Notes Detective works' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('heading', { name: 'Typical flow' })).toBeVisible();
  await expect(help).toContainText('Create a case');
  await expect(help).toContainText('Capture evidence');
  await expect(help).toContainText('Test yourself');
  await expect(help).toContainText('Board gestures');
  await expect(help).toContainText('Keyboard shortcuts');

  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(howItWorks).toBeFocused();

  await page.getByRole('button', { name: 'Enter the case files' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('link', { name: DEMO_TITLE })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('notes-detective.welcome.seen'))).toBe('1');

  // Returning visits go straight to the shelf.
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { level: 2, name: WELCOME_TITLE })).toBeHidden();

  // The welcome stays directly reachable from Help and from a link.
  await page.goto('/#/welcome');
  await expect(page.getByRole('heading', { level: 2, name: WELCOME_TITLE })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('the welcome stays readable and reachable at the phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForWelcome(page);

  const image = page.getByRole('img', { name: /students studying together/i });
  await expect(image).toBeVisible();

  const enter = page.getByRole('button', { name: 'Enter the case files' });
  const howItWorks = page.getByRole('button', { name: 'How it works' });
  await expect(enter).toBeInViewport();
  await expect(howItWorks).toBeInViewport();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);

  // The help becomes a bottom sheet at this width but keeps its actions.
  await howItWorks.click();
  const help = page.getByRole('dialog', { name: 'How Notes Detective works' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(help.getByRole('button', { name: 'Show the welcome screen' })).toBeVisible();
});

test('axe finds zero serious or critical violations on the welcome', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'The welcome scan runs once at the desktop viewport.',
  );

  await waitForWelcome(page);

  const results = await new AxeBuilder({ page }).options(AXE_RUN_OPTIONS).analyze();
  const summary = summarizeAxeResults(results);

  await testInfo.attach('axe-welcome', {
    body: JSON.stringify(
      {
        counts: {
          violations: summary.violations.length,
          blocking: summary.blocking.length,
          incomplete: summary.incomplete.length,
        },
        blocking: summary.blocking,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });

  expect(summary.blocking.length, formatAxeFailure('welcome', summary.blocking)).toBe(0);
});
