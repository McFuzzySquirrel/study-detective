import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A deterministic 150-card case for A11Y-FR-07 / VIS-FR-04 browser evidence.
 *
 * The case is created through the real shelf form, then the card rows are
 * inserted through the app's own IndexedDB stores and indexes. The board then
 * reads the graph back through the normal repository path; nothing is injected
 * into React state and no renderer object is stubbed.
 *
 * Positions form a 10-column grid with the fixed 240x320 card geometry in mind.
 * The resulting world is much larger than the board viewport, so the run also
 * proves that culling keeps the drawn card count below the fixture count.
 */

export const LARGE_CASE_CARD_COUNT = 150;
export const LARGE_CASE_DEFAULT_TITLE = 'Performance fixture: 150 cards';

const DATABASE_NAME = 'notes-detective';

/** Deterministic timestamps and schema-valid UUIDs keep the fixture stable. */
const TIMESTAMP = '2026-10-26T09:00:00.000Z';
const GRID_COLUMNS = 10;
const COLUMN_PITCH = 320;
const ROW_PITCH = 400;
const ORIGIN_X = 300;
const ORIGIN_Y = 300;

export const LARGE_CASE_VIEWPORT = Object.freeze({ x: 0, y: 0, scale: 0.75 });

export type BoardPosition = {
  readonly x: number;
  readonly y: number;
};

export type LargeCaseCardRow = {
  readonly id: string;
  readonly caseId: string;
  readonly type: 'note' | 'source' | 'topic';
  readonly title: string;
  readonly position: BoardPosition;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export interface LargeCaseSeedOptions {
  /** Defaults to the A11Y-5 fixture size. */
  readonly cardCount?: number;
  readonly caseTitle?: string;
  /**
   * Camera persisted on the case before the board opens. The default 75% scale
   * is a detail camera: the 150-card graph still creates every sprite and the
   * pan/zoom still drives culling, but the CI floor is not measured against a
   * dense zoomed-out overview. The 45 FPS tablet review covers that view.
   */
  readonly viewport?: { readonly x: number; readonly y: number; readonly scale: number };
}

export interface LargeCaseFixture {
  readonly caseId: string;
  readonly caseTitle: string;
  readonly cardCount: number;
  readonly cardIds: readonly string[];
  readonly positions: readonly BoardPosition[];
}

function cardId(index: number): string {
  const suffix = index.toString(16).padStart(12, '0');
  return `cccccccc-cccc-4ccc-8ccc-${suffix}`;
}

function cardTitle(index: number): string {
  return `Performance card ${String(index + 1).padStart(3, '0')}`;
}

function cardType(index: number): LargeCaseCardRow['type'] {
  return index % 3 === 0 ? 'topic' : index % 3 === 1 ? 'note' : 'source';
}

function cardPosition(index: number): BoardPosition {
  const column = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);

  return {
    x: ORIGIN_X + column * COLUMN_PITCH,
    y: ORIGIN_Y + row * ROW_PITCH,
  };
}

/** Build the in-memory graph that is written to IndexedDB. */
export function buildLargeCaseCards(
  caseId: string,
  cardCount: number = LARGE_CASE_CARD_COUNT,
): LargeCaseCardRow[] {
  return Array.from({ length: cardCount }, (_value, index) => ({
    id: cardId(index),
    caseId,
    type: cardType(index),
    title: cardTitle(index),
    position: cardPosition(index),
    tags: index % 2 === 0 ? ['performance', 'fixture'] : ['performance'],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  }));
}

async function readCaseIdByTitle(page: Page, title: string): Promise<string> {
  let found: string | undefined;

  await expect
    .poll(
      async () => {
        found = await page.evaluate(
          async ({ databaseName, caseTitle }) => {
            const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
              const request = indexedDB.open(databaseName);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolvePromise(request.result);
            });

            try {
              const cases = await new Promise<Array<Record<string, unknown>>>(
                (resolvePromise, reject) => {
                  const transaction = database.transaction('cases', 'readonly');
                  const request = transaction.objectStore('cases').getAll();
                  request.onerror = () => reject(request.error);
                  request.onsuccess = () =>
                    resolvePromise(request.result as Array<Record<string, unknown>>);
                },
              );

              return cases.find((row) => String(row.title) === caseTitle)?.id as string | undefined;
            } finally {
              database.close();
            }
          },
          { databaseName: DATABASE_NAME, caseTitle: title },
        );

        return found;
      },
      { timeout: 20_000 },
    )
    .not.toBeUndefined();

  if (found === undefined) {
    throw new Error('The performance case was not persisted by the shelf form');
  }

  return found;
}

function cardStoreRow(card: LargeCaseCardRow): Record<string, unknown> {
  // A plain object rather than a class instance so Playwright serialises it into
  // the browser exactly as IndexedDB will store it.
  return {
    id: card.id,
    caseId: card.caseId,
    type: card.type,
    title: card.title,
    position: { x: card.position.x, y: card.position.y },
    tags: [...card.tags],
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

async function writeCards(
  page: Page,
  caseId: string,
  cards: readonly LargeCaseCardRow[],
  viewport: LargeCaseSeedOptions['viewport'],
): Promise<void> {
  const rows = cards.map(cardStoreRow);

  await page.evaluate(
    async ({ databaseName, targetCaseId, cardRows, nextViewport }) => {
      const databases = await indexedDB.databases();
      const existing = databases.find((entry) => entry.name === databaseName);
      if (existing?.version === undefined) {
        throw new Error('The application database schema is missing');
      }

      const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
        // Open the version the app already created. A version-less open could
        // win the race against app startup and create an empty database.
        const request = indexedDB.open(databaseName, existing.version);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolvePromise(request.result);
      });

      try {
        if (
          !database.objectStoreNames.contains('cases') ||
          !database.objectStoreNames.contains('cards')
        ) {
          throw new Error('The application database schema has no cases/cards stores');
        }

        await new Promise<void>((resolvePromise, reject) => {
          const transaction = database.transaction(['cases', 'cards'], 'readwrite');
          transaction.oncomplete = () => resolvePromise();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () =>
            reject(transaction.error ?? new Error('The large-case transaction aborted'));

          const caseStore = transaction.objectStore('cases');
          const caseRequest = caseStore.get(targetCaseId);
          caseRequest.onerror = () => reject(caseRequest.error);
          caseRequest.onsuccess = () => {
            const record = caseRequest.result as Record<string, unknown> | undefined;
            if (record === undefined) {
              transaction.abort();
              reject(new Error('The performance case disappeared before seeding'));
              return;
            }

            if (nextViewport !== undefined) {
              caseStore.put({ ...record, viewport: nextViewport });
            }

            const cardStore = transaction.objectStore('cards');
            const existingKeys = cardStore.index('caseId').getAllKeys(targetCaseId);
            existingKeys.onerror = () => reject(existingKeys.error);
            existingKeys.onsuccess = () => {
              for (const key of existingKeys.result) {
                cardStore.delete(key);
              }
              for (const card of cardRows) {
                cardStore.add(card);
              }
            };
          };
        });
      } finally {
        database.close();
      }
    },
    {
      databaseName: DATABASE_NAME,
      targetCaseId: caseId,
      cardRows: rows,
      nextViewport: viewport,
    },
  );
}

async function readBackCards(
  page: Page,
  caseId: string,
): Promise<{
  readonly count: number;
  readonly uniqueCount: number;
  readonly positions: BoardPosition[];
}> {
  return page.evaluate(
    async ({ databaseName, targetCaseId }) => {
      const databases = await indexedDB.databases();
      const existing = databases.find((entry) => entry.name === databaseName);
      if (existing?.version === undefined) {
        throw new Error('The application database schema is missing');
      }

      const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
        const request = indexedDB.open(databaseName, existing.version);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolvePromise(request.result);
      });

      try {
        const rows = await new Promise<Array<Record<string, unknown>>>((resolvePromise, reject) => {
          const transaction = database.transaction('cards', 'readonly');
          const request = transaction.objectStore('cards').index('caseId').getAll(targetCaseId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () =>
            resolvePromise(request.result as Array<Record<string, unknown>>);
        });

        const positions = rows.map((row) => {
          const position = row.position as { readonly x?: unknown; readonly y?: unknown };
          return { x: Number(position?.x), y: Number(position?.y) };
        });

        return {
          count: rows.length,
          uniqueCount: new Set(rows.map((row) => String(row.id))).size,
          positions,
        };
      } finally {
        database.close();
      }
    },
    { databaseName: DATABASE_NAME, targetCaseId: caseId },
  );
}

/**
 * Create the 150-card case and leave the page on the shelf.
 *
 * Callers navigate to `#/case/<caseId>` and wait for the board attributes before
 * measuring. The helper throws if the app schema is unavailable, the case did
 * not persist, or the read-back card count is not exactly the requested count.
 */
export async function seedLargeCase(
  page: Page,
  options: LargeCaseSeedOptions = {},
): Promise<LargeCaseFixture> {
  const cardCount = options.cardCount ?? LARGE_CASE_CARD_COUNT;
  const caseTitle = options.caseTitle ?? LARGE_CASE_DEFAULT_TITLE;
  const viewport = options.viewport ?? LARGE_CASE_VIEWPORT;

  if (!Number.isInteger(cardCount) || cardCount <= 0) {
    throw new Error(`The large-case fixture needs a positive integer count, got ${cardCount}`);
  }

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: /^(?:New case|Create your first case)$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Case title' }).fill(caseTitle);
  await dialog.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByRole('link', { name: caseTitle })).toBeVisible({ timeout: 20_000 });

  const caseId = await readCaseIdByTitle(page, caseTitle);

  const cards = buildLargeCaseCards(caseId, cardCount);
  await writeCards(page, caseId, cards, viewport);

  const stored = await readBackCards(page, caseId);
  if (stored.count !== cardCount || stored.uniqueCount !== cardCount) {
    throw new Error(
      `The large-case fixture wrote ${stored.count} rows (${stored.uniqueCount} unique) instead of ${cardCount}`,
    );
  }

  const outsideGrid = stored.positions.filter(
    (position) => !Number.isFinite(position.x) || !Number.isFinite(position.y),
  );
  if (outsideGrid.length > 0) {
    throw new Error('The large-case fixture has a non-finite card position');
  }

  return {
    caseId,
    caseTitle,
    cardCount,
    cardIds: cards.map((card) => card.id),
    positions: stored.positions,
  };
}
