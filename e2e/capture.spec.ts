import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const specDirectory = dirname(fileURLToPath(import.meta.url));
const noteFixture = resolve(specDirectory, 'fixtures', 'note.png');
const sourceFixture = resolve(specDirectory, 'fixtures', 'source.png');

const CARD_TITLE = 'Photosynthesis notes';
const EDITED_TITLE = 'Light reactions';

type StoredCrop = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly type: string;
  readonly title: string;
  readonly crop?: StoredCrop;
  readonly rotation?: number;
};

type StoredAttachment = {
  readonly id: string;
  readonly cardId: string;
  readonly kind: string;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
};

type StoredCase = {
  readonly id: string;
  readonly title: string;
};

type Snapshot = {
  readonly cards: StoredCard[];
  readonly attachments: StoredAttachment[];
  readonly cases: StoredCase[];
  readonly connections: Array<Record<string, unknown>>;
};

/**
 * Read the real IndexedDB rows the app wrote. Blobs are deliberately mapped to
 * their metadata so the browser context can serialize the snapshot.
 */
async function readSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open('notes-detective');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result);
    });

    const readAll = (storeName: string): Promise<Record<string, unknown>[]> =>
      new Promise((resolvePromise, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () =>
          resolvePromise(request.result as unknown as Record<string, unknown>[]);
      });

    const [cards, attachments, cases, connections] = await Promise.all([
      readAll('cards'),
      readAll('attachments'),
      readAll('cases'),
      readAll('connections'),
    ]);

    database.close();

    return {
      cards: cards.map((row) => ({
        id: String(row.id),
        caseId: String(row.caseId),
        type: String(row.type),
        title: String(row.title),
        ...(row.crop !== undefined ? { crop: row.crop as StoredCrop } : {}),
        ...(row.rotation !== undefined ? { rotation: Number(row.rotation) } : {}),
      })),
      attachments: attachments.map((row) => ({
        id: String(row.id),
        cardId: String(row.cardId),
        kind: String(row.kind),
        mime: String(row.mime),
        width: Number(row.width),
        height: Number(row.height),
        bytes: Number(row.bytes),
        sha256: String(row.sha256),
      })),
      cases: cases.map((row) => ({ id: String(row.id), title: String(row.title) })),
      connections,
    };
  });
}

async function waitForCardCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await readSnapshot(page)).cards.length, { timeout: 15_000 })
    .toBe(count);
}

async function imageIsLoaded(page: Page): Promise<void> {
  const image = page.locator('img.card-detail__image');
  await expect(image).toBeVisible();
  await expect
    .poll(
      async () =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement &&
            element.complete &&
            element.naturalWidth > 0 &&
            element.naturalHeight > 0,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

test('imports, crops, rotates, reloads, edits, and replaces a real photo without changing the card ID', async ({
  page,
}) => {
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

  // Create a case through the real shelf dialog.
  await page.goto('/');
  await page.getByRole('button', { name: /Create your first case/i }).click();
  const caseDialog = page.getByRole('dialog', { name: 'Create a case' });
  await caseDialog.getByRole('textbox', { name: 'Case title' }).fill('Biology Final');
  await caseDialog.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByRole('link', { name: 'Biology Final' })).toBeVisible();
  await expect.poll(async () => (await readSnapshot(page)).cases.length).toBe(1);

  const snapshot = await readSnapshot(page);
  const caseId = snapshot.cases[0]?.id;
  if (caseId === undefined) {
    throw new Error('The case was not persisted');
  }

  // Import the real PNG through the native file input on the capture route.
  await page.goto(`/#/case/${caseId}/capture`);
  await expect(page.getByRole('heading', { level: 2, name: 'Capture evidence' })).toBeVisible();
  await page.setInputFiles('[data-testid="capture-choose-photo"]', noteFixture);

  await expect(page.getByRole('heading', { name: 'Crop and rotate' })).toBeVisible();
  await expect(page.getByAltText('Selected note photo to crop and rotate')).toBeVisible();

  // Zoom into the page to create a real sub-frame crop, then rotate 90 degrees.
  const cropper = page.getByRole('group', { name: 'Crop area' });
  const cropperBox = await cropper.boundingBox();
  if (cropperBox === null) {
    throw new Error('The crop area did not render');
  }

  await page.mouse.move(cropperBox.x + cropperBox.width / 2, cropperBox.y + cropperBox.height / 2);
  await page.mouse.wheel(0, -700);

  const cropSummary = page.locator('.nd-crop__summary');
  await expect
    .poll(async () => cropSummary.innerText(), { timeout: 10_000 })
    .not.toContain('100% wide, 100% tall');

  await page.getByRole('button', { name: 'Rotate right 90 degrees' }).click();
  await expect(cropSummary).toContainText('90° clockwise');
  await page.getByRole('button', { name: 'Use this crop' }).click();

  await expect(page.getByRole('heading', { name: 'Name the card' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Title' }).fill(CARD_TITLE);
  await page.getByRole('button', { name: 'Save card' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
  await waitForCardCount(page, 1);

  const afterImport = await readSnapshot(page);
  const importedCard = afterImport.cards[0];
  expect(importedCard).toBeDefined();
  if (importedCard === undefined) {
    throw new Error('The imported card is missing');
  }

  expect(importedCard.caseId).toBe(caseId);
  expect(importedCard.title).toBe(CARD_TITLE);
  expect(importedCard.type).toBe('note');
  expect(importedCard.rotation).toBe(90);
  expect(importedCard.crop?.width ?? 1).toBeLessThan(1);
  expect(importedCard.crop?.height ?? 1).toBeLessThan(1);

  const importedAttachments = afterImport.attachments.filter(
    (attachment) => attachment.cardId === importedCard.id,
  );
  expect(importedAttachments.map((attachment) => attachment.kind).sort()).toEqual([
    'display',
    'original',
    'thumbnail',
  ]);

  const importedDisplay = importedAttachments.find((attachment) => attachment.kind === 'display');
  expect(importedDisplay).toBeDefined();
  if (importedDisplay === undefined) {
    throw new Error('The imported display attachment is missing');
  }

  // Reload to prove the card survived; then open card detail by URL.
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
  await waitForCardCount(page, 1);

  await page.goto(`/#/case/${caseId}/card/${importedCard.id}`);
  await expect(page.getByRole('heading', { level: 2, name: CARD_TITLE })).toBeVisible();
  await expect(page.getByText('Study Note')).toBeVisible();
  await imageIsLoaded(page);

  const cardSection = page.locator('.card-detail');
  await expect(cardSection).toHaveAttribute('data-card-id', importedCard.id);

  // Keyboard path: the heading focuses on load, then Tab reaches each action
  // with a visible focus ring; every action keeps the 44 px target.
  await page.getByRole('heading', { level: 2, name: CARD_TITLE }).focus();
  await page.keyboard.press('Tab');
  const editTitleButton = page.getByRole('button', { name: 'Edit title' });
  await expect(editTitleButton).toBeFocused();
  const focusStyle = await editTitleButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(2);

  for (const name of ['Edit title', 'Replace photo', 'Crop/rotate', 'Delete card']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    if (box === null) {
      throw new Error(`The ${name} button did not render`);
    }
    expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }

  // Edit the title.
  await page.getByRole('button', { name: 'Edit title' }).click();
  const titleDialog = page.getByRole('dialog', { name: 'Edit card title' });
  const titleInput = titleDialog.getByRole('textbox', { name: 'Card title' });
  await expect(titleInput).toBeVisible();
  await titleInput.fill(EDITED_TITLE);
  await titleDialog.getByRole('button', { name: 'Save title' }).click();
  await expect(page.getByRole('heading', { level: 2, name: EDITED_TITLE })).toBeVisible();

  await expect
    .poll(async () => (await readSnapshot(page)).cards[0]?.title, { timeout: 10_000 })
    .toBe(EDITED_TITLE);

  // Replace the photo with a different real PNG. The card ID must not change.
  const oldDisplaySrc = await page.locator('img.card-detail__image').getAttribute('src');
  await page.setInputFiles('[data-testid="card-replace-photo"]', sourceFixture);
  await expect(page.getByText(/Photo replaced\. The card kept its ID/)).toBeVisible();

  await expect
    .poll(
      async () => {
        const current = await readSnapshot(page);
        const attachment = current.attachments.find(
          (row) => row.cardId === importedCard.id && row.kind === 'display',
        );
        return attachment?.sha256 ?? '';
      },
      { timeout: 20_000 },
    )
    .not.toBe(importedDisplay.sha256);

  await expect
    .poll(async () => page.locator('img.card-detail__image').getAttribute('src'), {
      timeout: 10_000,
    })
    .not.toBe(oldDisplaySrc);
  await imageIsLoaded(page);

  const afterReplace = await readSnapshot(page);
  const replacedCard = afterReplace.cards[0];
  expect(replacedCard?.id).toBe(importedCard.id);
  expect(replacedCard?.title).toBe(EDITED_TITLE);
  expect(replacedCard?.caseId).toBe(caseId);

  const replacedAttachments = afterReplace.attachments.filter(
    (attachment) => attachment.cardId === importedCard.id,
  );
  expect(replacedAttachments).toHaveLength(3);
  expect(replacedAttachments.map((attachment) => attachment.kind).sort()).toEqual([
    'display',
    'original',
    'thumbnail',
  ]);
  replacedAttachments.forEach((attachment) => {
    expect(attachment.cardId).toBe(importedCard.id);
    expect(attachment.bytes).toBeGreaterThan(0);
    expect(attachment.mime).toMatch(/^image\//);
  });

  const replacedDisplay = replacedAttachments.find((attachment) => attachment.kind === 'display');
  expect(replacedDisplay?.sha256).not.toBe(importedDisplay.sha256);

  // Reload once more: the title, card ID, and replacement display must persist.
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: EDITED_TITLE })).toBeVisible();
  await expect(page.locator('.card-detail')).toHaveAttribute('data-card-id', importedCard.id);
  await imageIsLoaded(page);

  await expect
    .poll(async () => {
      const current = await readSnapshot(page);
      const card = current.cards[0];
      const display = current.attachments.find(
        (row) => row.cardId === importedCard.id && row.kind === 'display',
      );
      return `${card?.id ?? ''}|${card?.title ?? ''}|${display?.sha256 ?? ''}`;
    })
    .toBe(`${importedCard.id}|${EDITED_TITLE}|${replacedDisplay?.sha256 ?? ''}`);

  // The destructive action is gated by a confirmation; Escape must leave the card.
  await page.getByRole('button', { name: 'Delete card' }).click();
  const deleteDialog = page.getByRole('dialog', { name: /Delete “Light reactions”\?/ });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(deleteDialog).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: EDITED_TITLE })).toBeVisible();

  expect(externalRequests, 'no image or other user data left the browser').toEqual([]);
  expect(consoleErrors, 'no console errors during the capture journey').toEqual([]);
});
