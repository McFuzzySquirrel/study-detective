import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import {
  AXE_BLOCKING_IMPACTS,
  AXE_DELIBERATE_EXCLUSIONS,
  AXE_EXCLUDED_SELECTORS,
  AXE_OVERLAY_SURFACES,
  AXE_PRIMARY_SCREENS,
  AXE_RUN_OPTIONS,
  formatAxeFailure,
  isBlockingImpact,
  summarizeAxeResults,
} from '../tests/a11y/axeConfig';
import type { AxeOverlaySurface, AxePrimaryScreen } from '../tests/a11y/axeConfig';

/**
 * A11Y-FR-05 browser evidence.
 *
 * Every test starts from a truly fresh install, so the real first-run demo
 * seeder writes a case, six cards, five strings, and four images through the
 * production IndexedDB path. The scans then read that graph through the normal
 * routes; nothing is mocked and no fixture is injected into the page.
 *
 * The primary-screen journey runs in the desktop (1440x900) and
 * tablet-landscape (1280x800) projects. The overlay journey runs in the same
 * two projects. The sheet journey sets the phone viewport explicitly because
 * modal sheets exist only below the 600 px breakpoint.
 *
 * Each scan runs every axe rule and fails on any serious or critical result.
 * Deliberate limits (canvas pixels and browser-native chrome) are documented in
 * tests/a11y/axeConfig.ts and are not selector exclusions.
 */

const DEMO_CASE_TITLE = 'Demo Case: The Missing Lecture';
const NOTE_TITLE = 'Photosynthesis lecture notes';

const TABLET_OR_DESKTOP_PROJECTS = ['desktop', 'tablet-landscape'];

test.use({ storageState: { cookies: [], origins: [] } });

type StoredCard = {
  readonly id: string;
  readonly type: string;
  readonly title: string;
};

type DemoGraph = {
  readonly caseId: string;
  readonly cards: readonly StoredCard[];
};

type ScanEvidence = {
  readonly project: string;
  readonly viewport: string;
  readonly surfaces: readonly string[];
};

/**
 * Wait for the first-run demo and read the rows it actually wrote. The demo
 * link proves the shelf rendered; the IndexedDB read supplies the case and card
 * IDs the direct routes need without trusting a UI-only marker.
 */
async function waitForDemo(page: Page): Promise<DemoGraph> {
  await page.goto('/');
  await expect(page.getByRole('link', { name: DEMO_CASE_TITLE })).toBeVisible({
    timeout: 30_000,
  });

  const graph = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('notes-detective');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result);
    });

    try {
      const readAll = (storeName: string): Promise<Record<string, unknown>[]> =>
        new Promise((resolvePromise, reject) => {
          const transaction = database.transaction(storeName, 'readonly');
          const request = transaction.objectStore(storeName).getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () =>
            resolvePromise(request.result as unknown as Record<string, unknown>[]);
        });

      const [caseRows, cardRows] = await Promise.all([readAll('cases'), readAll('cards')]);
      const demoCase = caseRows.find(
        (row) => String(row.title) === 'Demo Case: The Missing Lecture',
      );

      if (demoCase === undefined) {
        throw new Error('The first-run demo did not persist a case');
      }

      return {
        caseId: String(demoCase.id),
        cards: cardRows
          .filter((row) => String(row.caseId) === String(demoCase.id))
          .map((row) => ({
            id: String(row.id),
            type: String(row.type),
            title: String(row.title),
          })),
      };
    } finally {
      database.close();
    }
  });

  if (graph.cards.length !== 6) {
    throw new Error(`The demo case seeded ${graph.cards.length} cards instead of 6`);
  }

  return graph;
}

function requireCard(graph: DemoGraph, title: string): StoredCard {
  const card = graph.cards.find((candidate) => candidate.title === title);

  if (card === undefined) {
    throw new Error(`The demo case does not contain the card “${title}”`);
  }

  return card;
}

/** Dismiss a contextual hint only after proving it actually opened. */
async function dismissHint(page: Page, name: string): Promise<void> {
  const hint = page.getByRole('dialog', { name });
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await hint.getByRole('button', { name: 'Got it' }).click();
  await expect(hint).toBeHidden();
}

/**
 * Wait for finite CSS animations and transitions to finish before measuring.
 * Axe composites foreground and background using the current opacity, so a
 * dialog captured mid fade-in reports a false contrast failure. Infinite
 * motions (the status pulse) are excluded because they never finish and do not
 * change the resting text color.
 */
async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getTiming();
      return timing?.iterations !== Infinity && animation.playState !== 'finished';
    });

    await Promise.all(
      finite.map((animation) =>
        animation.finished.then(
          () => undefined,
          () => undefined,
        ),
      ),
    );

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

/**
 * Run axe on the current page state and attach the sanitized result summary.
 * A serious or critical violation fails immediately with the rule, impact, and
 * selector targets, never with card text or OCR content.
 */
async function scanSurface(
  page: Page,
  surface: string,
  testInfo: TestInfo,
  scanned: string[],
): Promise<void> {
  let builder = new AxeBuilder({ page }).options(AXE_RUN_OPTIONS);

  for (const selector of AXE_EXCLUDED_SELECTORS) {
    builder = builder.exclude(selector);
  }

  await settleAnimations(page);
  const results = await builder.analyze();
  const summary = summarizeAxeResults(results);

  await testInfo.attach(`axe-${surface}`, {
    body: JSON.stringify(
      {
        surface,
        excludedSelectors: AXE_EXCLUDED_SELECTORS,
        deliberateExclusions: AXE_DELIBERATE_EXCLUSIONS,
        blockingImpacts: AXE_BLOCKING_IMPACTS,
        counts: {
          violations: summary.violations.length,
          blocking: summary.blocking.length,
          incomplete: summary.incomplete.length,
        },
        blocking: summary.blocking,
        nonBlocking: summary.violations.filter((violation) => !isBlockingImpact(violation.impact)),
        incomplete: summary.incomplete,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });

  expect(summary.blocking.length, formatAxeFailure(surface, summary.blocking)).toBe(0);
  scanned.push(surface);
}

async function attachScanEvidence(
  testInfo: TestInfo,
  page: Page,
  surfaces: readonly string[],
): Promise<void> {
  const viewport = page.viewportSize();
  const evidence: ScanEvidence = {
    project: testInfo.project.name,
    viewport: viewport === null ? 'undefined' : `${viewport.width}x${viewport.height}`,
    surfaces,
  };

  await testInfo.attach('axe-evidence', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
}

test.describe('primary screens', () => {
  test('axe finds zero serious or critical violations on all six screens', async ({
    page,
  }, testInfo) => {
    test.skip(
      !TABLET_OR_DESKTOP_PROJECTS.includes(testInfo.project.name),
      'The A11Y-FR-05 screen matrix runs at the desktop and tablet viewports.',
    );
    test.setTimeout(240_000);

    const graph = await waitForDemo(page);
    const note = requireCard(graph, NOTE_TITLE);
    const casePath = `/#/case/${graph.caseId}`;
    const scanned: AxePrimaryScreen[] = [];

    // Shelf -----------------------------------------------------------------
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible();
    await expect(page.getByRole('link', { name: DEMO_CASE_TITLE })).toBeVisible();
    // 1280x800 is above the documented 1200 px desktop boundary, so the
    // tablet-landscape project correctly reports the desktop layout.
    await expect(page.getByTestId('app-frame')).toHaveAttribute('data-layout', 'desktop');
    await scanSurface(page, 'shelf', testInfo, scanned);

    // Board -----------------------------------------------------------------
    await page.goto(casePath);
    await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
    await expect(page.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-scene-status',
      'ready',
      { timeout: 30_000 },
    );
    await dismissHint(page, 'Thread anchor');
    await scanSurface(page, 'board', testInfo, scanned);

    // Card detail -----------------------------------------------------------
    await page.goto(`${casePath}/card/${note.id}`);
    await expect(page.getByRole('heading', { level: 2, name: NOTE_TITLE })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Photo' })).toBeVisible();
    await scanSurface(page, 'card-detail', testInfo, scanned);

    // Recall ----------------------------------------------------------------
    await page.goto(`${casePath}/recall`);
    await expect(page.getByTestId('recall-page')).toHaveAttribute('data-recall-status', 'ready', {
      timeout: 30_000,
    });
    await expect(
      page.getByRole('heading', { level: 2, name: 'Recall', exact: true }),
    ).toBeVisible();
    await dismissHint(page, 'Recall mode');
    await scanSurface(page, 'recall', testInfo, scanned);

    // Search ----------------------------------------------------------------
    await page.goto(`${casePath}/list`);
    await expect(page.getByRole('heading', { level: 2, name: 'Card list' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Search this case' })).toBeVisible();

    const searchbox = page.getByRole('searchbox', { name: 'Search cards' });
    await expect(searchbox).toBeVisible();
    await searchbox.fill('Photosynthesis');
    await expect(
      page.getByRole('button', {
        name: `Select ${NOTE_TITLE} from search results`,
      }),
    ).toBeVisible();

    const filters = page.getByRole('button', { name: 'Filters' });
    await filters.click();
    await expect(filters).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Notes', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Remove Type: Notes' })).toBeVisible();
    await scanSurface(page, 'search', testInfo, scanned);

    // Settings --------------------------------------------------------------
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
    await scanSurface(page, 'settings', testInfo, scanned);

    // Every named screen must have been reached and scanned, in order.
    expect(scanned).toEqual([...AXE_PRIMARY_SCREENS]);
    await attachScanEvidence(testInfo, page, scanned);
  });
});

test.describe('open dialogs and sheets', () => {
  test('axe scans each open dialog, hint, and popover', async ({ page }, testInfo) => {
    test.skip(
      !TABLET_OR_DESKTOP_PROJECTS.includes(testInfo.project.name),
      'The A11Y-FR-05 overlay matrix runs at the desktop and tablet viewports.',
    );
    test.setTimeout(240_000);

    const graph = await waitForDemo(page);
    const note = requireCard(graph, NOTE_TITLE);
    const casePath = `/#/case/${graph.caseId}`;
    const scanned: AxeOverlaySurface[] = [];

    // Shelf: create, export, import, and destructive confirmation ------------
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible();

    await page.getByRole('button', { name: 'New case' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create a case' });
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByRole('textbox', { name: 'Case title' })).toBeFocused();
    await scanSurface(page, 'shelf-create-case-dialog', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(createDialog).toBeHidden();

    await page.getByRole('button', { name: `Back up ${DEMO_CASE_TITLE}` }).click();
    const shelfBackup = page.getByRole('dialog', { name: 'Backup and restore' });
    await expect(shelfBackup).toBeVisible();
    await expect(shelfBackup.getByRole('group', { name: 'Backup actions' })).toBeVisible();
    await scanSurface(page, 'shelf-backup-dialog', testInfo, scanned);

    await shelfBackup.getByRole('button', { name: 'Restore a backup' }).click();
    await expect(shelfBackup.getByText('Choose backup file')).toBeVisible();
    await expect(shelfBackup.locator('input[type="file"]')).toHaveCount(1);
    await scanSurface(page, 'shelf-backup-import-view', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(shelfBackup).toBeHidden();

    await page.getByRole('button', { name: `Remove demo ${DEMO_CASE_TITLE}` }).click();
    const deleteDialog = page.getByRole('dialog', {
      name: `Remove demo case “${DEMO_CASE_TITLE}”?`,
    });
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await scanSurface(page, 'shelf-delete-dialog', testInfo, scanned);
    await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(deleteDialog).toBeHidden();

    // Board: contextual hint, shortcut help, and backup ----------------------
    await page.goto(casePath);
    await expect(page.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-scene-status',
      'ready',
      { timeout: 30_000 },
    );

    const contextHint = page.getByRole('dialog', { name: 'Thread anchor' });
    await expect(contextHint).toBeVisible({ timeout: 20_000 });
    await scanSurface(page, 'board-context-hint', testInfo, scanned);
    await contextHint.getByRole('button', { name: 'Got it' }).click();
    await expect(contextHint).toBeHidden();

    await page.keyboard.type('?');
    const shortcutHelp = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(shortcutHelp).toBeVisible();
    await expect(shortcutHelp.locator('[data-shortcut-id="help"]')).toContainText('Shortcut help');
    await scanSurface(page, 'board-shortcut-help-dialog', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(shortcutHelp).toBeHidden();

    await page.getByRole('button', { name: 'Case menu' }).click();
    const boardMenu = page.getByRole('dialog', { name: 'Case menu' });
    await expect(boardMenu).toBeVisible();
    const boardBackupTrigger = boardMenu.getByRole('button', {
      name: /^(Back up case|Back up now)$/,
    });
    await expect(boardBackupTrigger).toBeVisible();
    await boardBackupTrigger.click();
    const boardBackup = page.getByRole('dialog', { name: 'Backup and restore' });
    await expect(boardBackup).toBeVisible();
    await expect(boardBackup.getByRole('button', { name: 'Export this case' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await scanSurface(page, 'board-backup-dialog', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(boardBackup).toBeHidden();

    // Card detail: title, tags, delete, and the connection picker -------------
    await page.goto(`${casePath}/card/${note.id}`);
    await expect(page.getByRole('heading', { level: 2, name: NOTE_TITLE })).toBeVisible();

    await page.getByRole('button', { name: 'Edit title' }).click();
    const titleDialog = page.getByRole('dialog', { name: 'Edit card title' });
    await expect(titleDialog).toBeVisible();
    await scanSurface(page, 'card-title-dialog', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(titleDialog).toBeHidden();

    await page.getByRole('button', { name: 'Edit tags' }).click();
    const tagsDialog = page.getByRole('dialog', { name: 'Edit card tags' });
    await expect(tagsDialog).toBeVisible();
    await scanSurface(page, 'card-tags-dialog', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(tagsDialog).toBeHidden();

    await page.getByRole('button', { name: 'Delete card' }).click();
    const cardDelete = page.getByRole('dialog', { name: `Delete “${NOTE_TITLE}”?` });
    await expect(cardDelete).toBeVisible();
    await expect(cardDelete.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await scanSurface(page, 'card-delete-dialog', testInfo, scanned);
    await cardDelete.getByRole('button', { name: 'Cancel' }).click();
    await expect(cardDelete).toBeHidden();

    await page.getByRole('button', { name: 'Connect to…' }).click();
    const picker = page.getByRole('dialog', { name: 'Connect to a card' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('radio', { name: 'Association' })).toBeChecked();
    await scanSurface(page, 'connection-picker-dialog', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();

    // Settings: a replayed hint popover -------------------------------------
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();

    const replay = page.getByRole('button', { name: 'Replay Thread anchor hint' });
    await replay.click();
    const replayedHint = page.getByRole('dialog', { name: 'Thread anchor' });
    await expect(replayedHint).toBeVisible();
    await expect(replayedHint).toBeFocused();
    await scanSurface(page, 'settings-replay-hint', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(replayedHint).toBeHidden();
    await expect(replay).toBeFocused();

    // Every overlay surface named by the shared configuration was reached.
    expect(scanned).toEqual([
      'shelf-create-case-dialog',
      'shelf-backup-dialog',
      'shelf-backup-import-view',
      'shelf-delete-dialog',
      'board-context-hint',
      'board-shortcut-help-dialog',
      'board-backup-dialog',
      'card-title-dialog',
      'card-tags-dialog',
      'card-delete-dialog',
      'connection-picker-dialog',
      'settings-replay-hint',
    ]);
    for (const surface of scanned) {
      expect(AXE_OVERLAY_SURFACES).toContain(surface);
    }

    await attachScanEvidence(testInfo, page, scanned);
  });

  test('axe scans the phone sheets with their content open', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'The phone sheet journey sets 390x844 explicitly on one project.',
    );
    test.setTimeout(240_000);

    const graph = await waitForDemo(page);
    const note = requireCard(graph, NOTE_TITLE);
    const casePath = `/#/case/${graph.caseId}`;
    const scanned: AxeOverlaySurface[] = [];

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(casePath);
    await expect(page.getByTestId('app-frame')).toHaveAttribute('data-layout', 'phone');
    await expect(page.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-scene-status',
      'ready',
      { timeout: 30_000 },
    );
    await dismissHint(page, 'Thread anchor');

    // Search sheet ----------------------------------------------------------
    const searchTrigger = page.getByRole('button', { name: 'Search' });
    await expect(searchTrigger).toBeVisible();
    await searchTrigger.click();

    const searchSheet = page.getByRole('dialog', { name: 'Search this case' });
    await expect(searchSheet).toBeVisible();
    const sheetSearch = searchSheet.getByRole('searchbox', { name: 'Search cards' });
    await expect(sheetSearch).toBeFocused();
    await sheetSearch.fill('Photosynthesis');
    await expect(
      searchSheet.getByRole('button', { name: `Select ${NOTE_TITLE} from search results` }),
    ).toBeVisible();
    await searchSheet.getByRole('button', { name: 'Filters' }).click();
    await expect(searchSheet.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
    await scanSurface(page, 'phone-search-sheet', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(searchSheet).toBeHidden();
    await expect(searchTrigger).toBeFocused();

    // Case menu sheet --------------------------------------------------------
    const actionsTrigger = page.getByRole('button', { name: 'Case menu' });
    await actionsTrigger.click();
    const actionsSheet = page.getByRole('dialog', { name: 'Case menu' });
    await expect(actionsSheet).toBeVisible();
    await expect(
      actionsSheet.getByRole('button', { name: /^(Back up case|Back up now)$/ }),
    ).toBeVisible();
    await scanSurface(page, 'phone-case-actions-sheet', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(actionsSheet).toBeHidden();
    await expect(actionsTrigger).toBeFocused();

    // Case closure sheet ----------------------------------------------------
    const closureTrigger = page.getByRole('button', { name: 'Case closure' });
    await closureTrigger.click();
    const closureSheet = page.getByRole('dialog', { name: 'Case closure' });
    await expect(closureSheet).toBeVisible();
    await expect(closureSheet.getByTestId('closure-panel')).toBeVisible();
    await scanSurface(page, 'phone-closure-sheet', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(closureSheet).toBeHidden();
    await expect(closureTrigger).toBeFocused();

    // Card actions and tags sheet ------------------------------------------
    await page.goto(`${casePath}/card/${note.id}`);
    await expect(page.getByRole('heading', { level: 2, name: NOTE_TITLE })).toBeVisible();
    await expect(page.getByTestId('app-frame')).toHaveAttribute('data-layout', 'phone');

    const cardActionsTrigger = page.getByRole('button', { name: 'Card actions and tags' });
    await cardActionsTrigger.click();
    const cardActionsSheet = page.getByRole('dialog', { name: 'Card actions and tags' });
    await expect(cardActionsSheet).toBeVisible();
    await expect(cardActionsSheet.getByRole('button', { name: 'Edit title' })).toBeVisible();
    await expect(cardActionsSheet.getByRole('button', { name: 'Delete card' })).toBeVisible();
    await scanSurface(page, 'phone-card-actions-sheet', testInfo, scanned);
    await page.keyboard.press('Escape');
    await expect(cardActionsSheet).toBeHidden();
    await expect(cardActionsTrigger).toBeFocused();

    expect(scanned).toEqual([
      'phone-search-sheet',
      'phone-case-actions-sheet',
      'phone-closure-sheet',
      'phone-card-actions-sheet',
    ]);

    await attachScanEvidence(testInfo, page, scanned);
  });
});
