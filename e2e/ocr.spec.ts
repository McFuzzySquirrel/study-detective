import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * OCR-FR-01, OCR-FR-03, OCR-FR-04, and OCR-FR-05 browser evidence.
 *
 * Real tesseract.js runs in the page against a bundled fixture. The journey
 * proves the engine only starts on Read text, a non-empty title stays untouched
 * until Apply, the accepted title and OCR metadata are stored with the card,
 * the search panel finds the OCR phrase, and all of it survives a reload.
 */

const specDirectory = dirname(fileURLToPath(import.meta.url));
const ocrFixture = resolve(specDirectory, 'fixtures', 'ocr-note.png');

const CASE_TITLE = 'OCR journey case';
const DRAFT_TITLE = 'Draft note';
const OCR_PHRASE = 'MITOCHONDRIA';

type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly title: string;
  readonly ocrText?: string;
  readonly ocrConfidence?: number;
  readonly ocrEngineVersion?: string;
  readonly ocrUpdatedAt?: string;
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

    return rows.map((row) => ({
      id: String(row.id),
      caseId: String(row.caseId),
      title: String(row.title),
      ...(row.ocrText !== undefined ? { ocrText: String(row.ocrText) } : {}),
      ...(row.ocrConfidence !== undefined ? { ocrConfidence: Number(row.ocrConfidence) } : {}),
      ...(row.ocrEngineVersion !== undefined
        ? { ocrEngineVersion: String(row.ocrEngineVersion) }
        : {}),
      ...(row.ocrUpdatedAt !== undefined ? { ocrUpdatedAt: String(row.ocrUpdatedAt) } : {}),
    }));
  });
}

async function expectMinTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('The control did not render a measurable target');
  }
  expect(box.width, 'control width').toBeGreaterThanOrEqual(44);
  expect(box.height, 'control height').toBeGreaterThanOrEqual(44);
}

async function readCaseId(page: Page): Promise<string> {
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
    return id === undefined ? null : String(id);
  });

  if (caseId === null) {
    throw new Error('The case was not persisted');
  }

  return caseId;
}

test('runs real OCR, applies a suggested title, searches the text, and survives reload', async ({
  page,
}) => {
  test.setTimeout(240_000);

  const externalRequests: string[] = [];
  const consoleErrors: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && !url.startsWith('http://127.0.0.1:4173')) {
      externalRequests.push(url);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  // Create a real case through the shelf dialog.
  await page.goto('/');
  await page.getByRole('button', { name: /Create your first case/i }).click();
  const caseDialog = page.getByRole('dialog', { name: 'Create a case' });
  await caseDialog.getByRole('textbox', { name: 'Case title' }).fill(CASE_TITLE);
  await caseDialog.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByRole('link', { name: CASE_TITLE })).toBeVisible();
  const caseId = await readCaseId(page);

  // Import the fixture with a non-empty draft title, then explicitly start OCR.
  await page.goto(`/#/case/${caseId}/capture`);
  await expect(page.getByRole('heading', { level: 2, name: 'Capture evidence' })).toBeVisible();
  await page.setInputFiles('[data-testid="capture-choose-photo"]', ocrFixture);

  await expect(page.getByRole('heading', { name: 'Crop and rotate' })).toBeVisible();
  await page.getByRole('button', { name: 'Use this crop' }).click();
  await expect(page.getByRole('heading', { name: 'Name the card' })).toBeVisible();

  const titleInput = page.getByRole('textbox', { name: 'Title' });
  await titleInput.fill(DRAFT_TITLE);

  // OCR stays off until this click. No worker is created before it.
  const readText = page.getByRole('button', { name: 'Read text' });
  await expect(readText).toBeVisible();
  await expectMinTarget(readText);
  await expect(page.locator('.ocr-panel')).toHaveAttribute('data-ocr-status', 'idle');
  await readText.click();

  // The panel shows progress and Cancel while it runs.
  await expect(page.getByRole('progressbar', { name: 'OCR progress' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 15_000 });

  // Real OCR on the clear fixture finishes with a suggestion, not an overwrite.
  const suggestionHeading = page.getByRole('heading', { name: 'Suggested title' });
  await expect(suggestionHeading).toBeVisible({ timeout: 180_000 });
  const ocrText = page.getByRole('textbox', { name: 'Extracted OCR text' });
  await expect(ocrText).toHaveValue(new RegExp(OCR_PHRASE), { timeout: 10_000 });
  await expect(page.getByText(/tesseract\.js 7\.0\.0/)).toBeVisible();
  await expect(titleInput).toHaveValue(DRAFT_TITLE);

  // Apply is the explicit replacement action; the field changes only now.
  const applyButton = page.getByRole('button', { name: 'Apply' });
  await expectMinTarget(applyButton);
  await applyButton.click();
  await expect(titleInput).toHaveValue(/CELL\s+BIOLOGY/i);
  const appliedTitle = await titleInput.inputValue();

  await page.getByRole('button', { name: 'Save card' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();

  await expect.poll(async () => (await readCards(page)).length, { timeout: 30_000 }).toBe(1);

  const saved = (await readCards(page))[0];
  if (saved === undefined) {
    throw new Error('The OCR card was not persisted');
  }

  expect(saved.caseId).toBe(caseId);
  expect(saved.title).toBe(appliedTitle);
  expect(saved.ocrText?.toUpperCase()).toContain(OCR_PHRASE);
  expect(saved.ocrConfidence).toBeGreaterThan(0);
  expect(saved.ocrConfidence).toBeLessThanOrEqual(100);
  expect(saved.ocrEngineVersion).toBe('tesseract.js 7.0.0');
  expect(saved.ocrUpdatedAt).toBeTruthy();
  expect(Number.isNaN(Date.parse(saved.ocrUpdatedAt ?? ''))).toBe(false);

  // The grouped list mounts the real search panel. OCR text is searchable.
  await page.goto(`/#/case/${caseId}/list`);
  const search = page.getByRole('searchbox', { name: 'Search cards' });
  await expect(search).toBeVisible();
  await search.fill(OCR_PHRASE);

  await expect(page.getByText(/1 card matches your search\./)).toBeVisible({ timeout: 10_000 });
  const results = page.getByRole('list', { name: 'Search results' });
  await expect(results).toBeVisible();
  await expect(
    results.getByRole('button', { name: `Select ${appliedTitle} from search results` }),
  ).toBeVisible();
  await expect(results.getByText(/OCR text:/)).toContainText(OCR_PHRASE);

  // Reload proves the OCR row, not just in-memory state, survives.
  await page.reload();
  const reloadedSearch = page.getByRole('searchbox', { name: 'Search cards' });
  await expect(reloadedSearch).toBeVisible();
  await reloadedSearch.fill(OCR_PHRASE);
  await expect(page.getByText(/1 card matches your search\./)).toBeVisible({ timeout: 10_000 });
  await expect(
    page
      .getByRole('list', { name: 'Search results' })
      .getByRole('button', { name: `Select ${appliedTitle} from search results` }),
  ).toBeVisible();

  // Card detail renders the persisted text, confidence, engine, and timestamp.
  await page.goto(`/#/case/${caseId}/card/${saved.id}`);
  await expect(page.getByRole('heading', { level: 2, name: appliedTitle })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Extracted OCR text' })).toHaveValue(
    new RegExp(OCR_PHRASE),
  );
  const confidence = page.locator('.ocr-panel__meta-item').filter({ hasText: 'Confidence' });
  await expect(confidence).toContainText('%');
  await expect(page.getByText('tesseract.js 7.0.0')).toBeVisible();
  await expect(page.locator('.ocr-panel time')).toHaveAttribute(
    'datetime',
    saved.ocrUpdatedAt ?? '',
  );
  await expectMinTarget(page.getByRole('button', { name: 'Run again' }));
  await expectMinTarget(page.getByRole('button', { name: 'Clear OCR' }));

  expect(externalRequests, 'OCR assets stayed on this origin').toEqual([]);
  expect(consoleErrors, 'no console errors during the OCR journey').toEqual([]);
});
