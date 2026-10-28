import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, webkit } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';

/**
 * A11Y-FR-08 / VIS-CON-06 cross-browser smoke.
 *
 * Runs in the three Chromium viewport projects and in the Firefox and WebKit
 * projects, which are limited to this spec by `testMatch` in
 * playwright.config.ts. Every project starts from a genuinely empty install so
 * the production first-run seeder writes the demo case through the real
 * IndexedDB path. The journey then opens the shelf, the demo case, the board,
 * the card list search, and settings without using a fixture-injected route.
 *
 * WebKit note: Playwright's WebKit embedder uses an ephemeral session for the
 * default non-persistent context, and WebKit's ephemeral sessions cannot write
 * Blob/File values to IndexedDB
 * (https://github.com/microsoft/playwright/issues/42795). The demo seed stores
 * four real image attachments, so the WebKit project runs this journey in a
 * persistent profile instead. That is the same production seed and IndexedDB
 * code path; only the browser session type changes. Chromium and Firefox keep
 * the normal context.
 *
 * Failure evidence is the browser's own `pageerror` and console-error stream,
 * not a screenshot-only check.
 */

const DEMO_TITLE = 'Demo Case: The Missing Lecture';
const NOTE_TITLE = 'Photosynthesis lecture notes';
const DEMO_CARD_COUNT = 6;

// A truly fresh install so the production first-run seeder writes the demo.
// The persistent WebKit profile is also created empty for the same reason.
test.use({ storageState: { cookies: [], origins: [] } });

interface BrowserErrorLog {
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
}

function trackBrowserErrors(page: Page): BrowserErrorLog {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  return { pageErrors, consoleErrors };
}

async function openWebkitPersistentPage(
  testInfo: TestInfo,
): Promise<{ context: BrowserContext; page: Page; profile: string }> {
  const profile = await mkdtemp(path.join(tmpdir(), 'notes-detective-webkit-'));

  try {
    const context = await webkit.launchPersistentContext(profile, {
      baseURL: testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173',
      headless: testInfo.project.use.headless ?? true,
      viewport: testInfo.project.use.viewport ?? { width: 1440, height: 900 },
    });
    const page = context.pages()[0] ?? (await context.newPage());

    return { context, page, profile };
  } catch (error) {
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

test('shelf, demo case, board, search, and settings load without an unhandled error', async ({
  page,
  browserName,
}, testInfo) => {
  test.setTimeout(120_000);

  let activePage = page;
  let persistentContext: BrowserContext | null = null;
  let profile: string | null = null;

  try {
    if (browserName === 'webkit') {
      const persistent = await openWebkitPersistentPage(testInfo);
      activePage = persistent.page;
      persistentContext = persistent.context;
      profile = persistent.profile;
    }

    const errors = trackBrowserErrors(activePage);

    // Shelf ----------------------------------------------------------------
    await activePage.goto('/');

    await expect(
      activePage.getByRole('heading', { level: 1, name: 'Notes Detective' }),
    ).toBeVisible();
    await expect(activePage.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible();
    await expect(activePage.getByRole('link', { name: DEMO_TITLE })).toBeVisible({
      timeout: 30_000,
    });
    await expect(activePage.getByTestId('case-demo-ribbon')).toHaveText('Demo');

    // These browsers all provide IndexedDB, Web Workers, WebAssembly, and
    // service workers, so the capability notice must stay absent.
    await expect(activePage.getByTestId('browser-notice')).toHaveCount(0);

    // Demo case and board --------------------------------------------------
    await activePage.getByRole('link', { name: DEMO_TITLE }).click();
    await expect(activePage.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
    await expect(activePage.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-scene-status',
      'ready',
      { timeout: 30_000 },
    );
    await expect(activePage.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-card-count',
      String(DEMO_CARD_COUNT),
    );

    // The contextual hint is expected and non-blocking; dismiss it like a
    // student would so it cannot cover the board controls in later assertions.
    const hint = activePage.getByRole('dialog', { name: 'Thread anchor' });
    if (await hint.isVisible().catch(() => false)) {
      await hint.getByRole('button', { name: 'Got it' }).click();
      await expect(hint).toBeHidden();
    }

    // Search ---------------------------------------------------------------
    const cardListLink = activePage.getByTestId('open-card-list');
    if ((await cardListLink.count()) === 0) {
      await activePage.getByRole('button', { name: 'Case menu' }).click();
      await activePage
        .getByRole('dialog', { name: 'Case menu' })
        .getByRole('link', { name: 'Open card list' })
        .click();
    } else {
      await cardListLink.click();
    }
    await expect(activePage.getByRole('heading', { level: 2, name: 'Card list' })).toBeVisible();

    const searchbox = activePage.getByRole('searchbox', { name: 'Search cards' });
    await expect(searchbox).toBeVisible();
    await searchbox.fill('Photosynthesis');
    await expect(
      activePage.getByRole('button', { name: `Select ${NOTE_TITLE} from search results` }),
    ).toBeVisible();

    // Settings -------------------------------------------------------------
    if ((activePage.viewportSize()?.width ?? 1440) < 600) {
      await activePage.goto('/#/settings');
    } else {
      await activePage.getByRole('link', { name: 'Settings' }).click();
    }
    await expect(activePage.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
    await expect(activePage.getByRole('heading', { level: 3, name: 'Appearance' })).toBeVisible();

    // A supported browser shows no capability banner on the settings route
    // either, so the notice is not tied to the shelf mount.
    await expect(activePage.getByTestId('browser-notice')).toHaveCount(0);

    await testInfo.attach('compat-evidence', {
      body: JSON.stringify(
        {
          project: testInfo.project.name,
          browser: testInfo.project.use.browserName,
          viewport: activePage.viewportSize(),
          session: browserName === 'webkit' ? 'persistent' : 'default',
          journey: ['shelf', 'demo-case', 'board', 'card-list-search', 'settings'],
          demoCardCount: DEMO_CARD_COUNT,
          pageErrors: errors.pageErrors,
          consoleErrors: errors.consoleErrors,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    expect(errors.pageErrors, 'an uncaught page error occurred').toEqual([]);
    expect(errors.consoleErrors, 'the browser reported a console error').toEqual([]);
  } finally {
    try {
      await persistentContext?.close();
    } finally {
      if (profile !== null) {
        await rm(profile, { recursive: true, force: true });
      }
    }
  }
});
