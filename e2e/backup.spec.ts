import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

/**
 * Real backup and restore evidence.
 *
 * The claim: a student can export one case to a `.ndcase` file through the
 * dialog, delete every local copy, restore the downloaded bytes as a fresh
 * copy, and then replace that copy from a generated archive, keeping every
 * card, string, tag, position, case field, and image.
 *
 * The journey drives the production build with the File System Access APIs
 * removed, so export uses the real Blob download and import uses the real
 * hidden file input. The archive is read back from the downloaded bytes and
 * unzipped with fflate; nothing is mocked. Any missing card, string, tag,
 * position, case field, attachment, or byte fails the comparison helpers.
 */

const specDirectory = dirname(fileURLToPath(import.meta.url));
const noteFixture = resolve(specDirectory, 'fixtures', 'note.png');
const sourceFixture = resolve(specDirectory, 'fixtures', 'source.png');

const DATABASE_NAME = 'notes-detective';
const PREVIEW_ORIGIN = 'http://127.0.0.1:4173';

const TARGET_TITLE = 'Cellular respiration';
const DECOY_TITLE = 'Decoy case';
const NOTE_TITLE = 'Glycolysis notes';
const SOURCE_TITLE = 'Textbook page 42';
const TOPIC_TITLE = 'ATP yield';

const NOTE_TAGS = ['metabolism', 'Exam'];
const SOURCE_TAGS = ['reading', 'exam'];
const TOPIC_TAGS = ['theme'];

/** OCR is optional metadata on a card; one seeded value proves it travels too. */
const NOTE_OCR = {
  text: 'Glycolysis converts glucose to pyruvate and yields two ATP.',
  confidence: 93.5,
  engineVersion: 'tesseract-5.4.0',
  updatedAt: '2026-10-19T08:00:00.000Z',
};

const CUSTOM_VIEWPORT = { x: -140, y: -96, scale: 1.25 };
const CLOSED_AT = '2026-10-20T09:30:00.000Z';
const ARCHIVE_FILENAME = /^cellular-respiration-\d{4}-\d{2}-\d{2}\.ndcase$/;

type Viewport = { readonly x: number; readonly y: number; readonly scale: number };
type Position = { readonly x: number; readonly y: number };
type Crop = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type StoredCase = {
  readonly id: string;
  readonly title: string;
  readonly subject?: string;
  readonly examDate?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly viewport: Viewport;
  readonly closedAt: string | null;
  readonly isDemo: boolean;
  readonly backupPromptedAt: string | null;
};

type StoredCard = {
  readonly id: string;
  readonly caseId: string;
  readonly type: string;
  readonly title: string;
  readonly position: Position;
  readonly tags: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly crop?: Crop;
  readonly rotation?: number;
  readonly retainFullResolution?: boolean;
  readonly ocrText?: string;
  readonly ocrConfidence?: number;
  readonly ocrEngineVersion?: string;
  readonly ocrUpdatedAt?: string;
};

type StoredConnection = {
  readonly id: string;
  readonly caseId: string;
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly pairKey: string;
  readonly type: string;
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
  readonly blobBytes: number;
  readonly blobSha256: string;
};

type Snapshot = {
  readonly cases: StoredCase[];
  readonly cards: StoredCard[];
  readonly connections: StoredConnection[];
  readonly attachments: StoredAttachment[];
};

type ArchiveAttachmentManifest = {
  readonly id: string;
  readonly cardId: string;
  readonly kind: string;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly path: string;
};

type ArchiveManifest = {
  readonly format: string;
  readonly formatVersion: number;
  readonly exportedAt: string;
  readonly appVersion: string;
  readonly dbSchemaVersion: number;
  readonly case: StoredCase;
  readonly cards: StoredCard[];
  readonly connections: StoredConnection[];
  readonly attachments: ArchiveAttachmentManifest[];
};

type SeedResult = {
  readonly noteCardId: string;
  readonly sourceCardId: string;
  readonly topicCardId: string;
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Read the real IndexedDB rows and re-hash every stored Blob in the browser.
 * Metadata-only assertions cannot prove an image survived, so each attachment
 * carries both its recorded digest and the digest of the bytes actually stored.
 */
async function readSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async (databaseName) => {
    // Open the version the app already created. A version-less open would
    // create an empty database if this read won the race against app startup.
    const databases = await indexedDB.databases();
    const existing = databases.find((entry) => entry.name === databaseName);
    if (existing?.version === undefined) {
      throw new Error('The application database has not been created yet');
    }

    const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
      const request = indexedDB.open(databaseName, existing.version);
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

    const toHex = (buffer: ArrayBuffer): string =>
      Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

    const [caseRows, cardRows, connectionRows, attachmentRows] = await Promise.all([
      readAll('cases'),
      readAll('cards'),
      readAll('connections'),
      readAll('attachments'),
    ]);

    const attachments: StoredAttachment[] = [];
    for (const row of attachmentRows) {
      const blob = row.blob;
      if (!(blob instanceof Blob)) {
        throw new Error('An attachment row is missing its Blob');
      }
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      attachments.push({
        id: String(row.id),
        cardId: String(row.cardId),
        kind: String(row.kind),
        mime: String(row.mime),
        width: Number(row.width),
        height: Number(row.height),
        bytes: Number(row.bytes),
        sha256: String(row.sha256),
        blobBytes: blob.size,
        blobSha256: toHex(digest),
      });
    }

    database.close();

    return {
      cases: caseRows.map((row) => {
        const viewport = row.viewport as { x?: unknown; y?: unknown; scale?: unknown } | undefined;
        return {
          id: String(row.id),
          title: String(row.title),
          ...(row.subject !== undefined ? { subject: String(row.subject) } : {}),
          ...(row.examDate !== undefined ? { examDate: String(row.examDate) } : {}),
          createdAt: String(row.createdAt),
          updatedAt: String(row.updatedAt),
          viewport: {
            x: Number(viewport?.x ?? 0),
            y: Number(viewport?.y ?? 0),
            scale: Number(viewport?.scale ?? 1),
          },
          closedAt:
            row.closedAt === null || row.closedAt === undefined ? null : String(row.closedAt),
          isDemo: Boolean(row.isDemo),
          backupPromptedAt:
            row.backupPromptedAt === null || row.backupPromptedAt === undefined
              ? null
              : String(row.backupPromptedAt),
        };
      }),
      cards: cardRows.map((row) => {
        const position = row.position as { x?: unknown; y?: unknown } | undefined;
        const crop = row.crop as Crop | undefined;
        return {
          id: String(row.id),
          caseId: String(row.caseId),
          type: String(row.type),
          title: String(row.title),
          position: { x: Number(position?.x ?? 0), y: Number(position?.y ?? 0) },
          tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
          createdAt: String(row.createdAt),
          updatedAt: String(row.updatedAt),
          ...(crop !== undefined ? { crop } : {}),
          ...(row.rotation !== undefined ? { rotation: Number(row.rotation) } : {}),
          ...(row.retainFullResolution !== undefined
            ? { retainFullResolution: Boolean(row.retainFullResolution) }
            : {}),
          ...(row.ocrText !== undefined ? { ocrText: String(row.ocrText) } : {}),
          ...(row.ocrConfidence !== undefined ? { ocrConfidence: Number(row.ocrConfidence) } : {}),
          ...(row.ocrEngineVersion !== undefined
            ? { ocrEngineVersion: String(row.ocrEngineVersion) }
            : {}),
          ...(row.ocrUpdatedAt !== undefined ? { ocrUpdatedAt: String(row.ocrUpdatedAt) } : {}),
        };
      }),
      connections: connectionRows.map((row) => ({
        id: String(row.id),
        caseId: String(row.caseId),
        fromCardId: String(row.fromCardId),
        toCardId: String(row.toCardId),
        pairKey: String(row.pairKey),
        type: String(row.type),
      })),
      attachments,
    };
  }, DATABASE_NAME);
}

function casesWithTitle(snapshot: Snapshot, title: string): StoredCase[] {
  return snapshot.cases.filter((record) => record.title === title);
}

function singleCase(snapshot: Snapshot, title: string): StoredCase {
  const matches = casesWithTitle(snapshot, title);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one case titled "${title}", found ${matches.length}`);
  }
  return matches[0] as StoredCase;
}

function singleCard(snapshot: Snapshot, title: string): StoredCard {
  const matches = snapshot.cards.filter((card) => card.title === title);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one card titled "${title}", found ${matches.length}`);
  }
  return matches[0] as StoredCard;
}

function cardTitleById(snapshot: Snapshot): Map<string, string> {
  return new Map(snapshot.cards.map((card) => [card.id, card.title] as const));
}

function normalizedCard(card: StoredCard): Record<string, unknown> {
  return {
    title: card.title,
    type: card.type,
    position: { x: card.position.x, y: card.position.y },
    tags: [...card.tags].sort(),
    crop: card.crop ?? null,
    rotation: card.rotation ?? null,
    retainFullResolution: card.retainFullResolution ?? null,
    ocrText: card.ocrText ?? null,
    ocrConfidence: card.ocrConfidence ?? null,
    ocrEngineVersion: card.ocrEngineVersion ?? null,
    ocrUpdatedAt: card.ocrUpdatedAt ?? null,
  };
}

function normalizedCase(record: StoredCase): Record<string, unknown> {
  return {
    title: record.title,
    subject: record.subject ?? null,
    examDate: record.examDate ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    viewport: record.viewport,
    closedAt: record.closedAt,
    isDemo: record.isDemo,
  };
}

function normalizedConnections(snapshot: Snapshot): string[] {
  const titles = cardTitleById(snapshot);
  return snapshot.connections
    .map((connection) => {
      const from = titles.get(connection.fromCardId) ?? 'missing-from-card';
      const to = titles.get(connection.toCardId) ?? 'missing-to-card';
      return `${from} <-> ${to} (${connection.type})`;
    })
    .sort();
}

function normalizedAttachments(snapshot: Snapshot): Record<string, unknown> {
  const titles = cardTitleById(snapshot);
  const result: Record<string, unknown> = {};
  for (const attachment of snapshot.attachments) {
    const cardTitle = titles.get(attachment.cardId) ?? 'missing-card';
    result[`${cardTitle}::${attachment.kind}`] = {
      mime: attachment.mime,
      width: attachment.width,
      height: attachment.height,
      bytes: attachment.bytes,
      sha256: attachment.sha256,
      blobBytes: attachment.blobBytes,
      blobSha256: attachment.blobSha256,
    };
  }
  return result;
}

function expectPairKeysAreCanonical(snapshot: Snapshot): void {
  for (const connection of snapshot.connections) {
    const expected = [connection.fromCardId, connection.toCardId].sort().join('::');
    expect(connection.pairKey, `pairKey for ${connection.id}`).toBe(expected);
  }
}

/** Prove that no card, string, or attachment kept an ID from the prior copy. */
function expectFreshChildIds(before: Snapshot, after: Snapshot): void {
  const beforeIds = new Set([
    ...before.cards.map((card) => card.id),
    ...before.connections.map((connection) => connection.id),
    ...before.attachments.map((attachment) => attachment.id),
  ]);
  const afterIds = [
    ...after.cards.map((card) => card.id),
    ...after.connections.map((connection) => connection.id),
    ...after.attachments.map((attachment) => attachment.id),
  ];

  expect(new Set(afterIds).size, 'restored child IDs must be unique').toBe(afterIds.length);
  for (const id of afterIds) {
    expect(beforeIds.has(id), `restored child ${id} kept an old ID`).toBe(false);
  }
}

/**
 * Compare everything the archive claims to preserve. Case timestamps, viewport,
 * closure, and card metadata use exact equality; images use the recorded
 * digest, the blob size, and the digest of the stored bytes.
 */
function expectSameCaseData(before: Snapshot, after: Snapshot): void {
  expect(after.cards).toHaveLength(before.cards.length);
  expect(after.connections).toHaveLength(before.connections.length);
  expect(after.attachments).toHaveLength(before.attachments.length);

  for (const beforeCard of before.cards) {
    expect(normalizedCard(singleCard(after, beforeCard.title))).toEqual(normalizedCard(beforeCard));
  }

  expect(normalizedConnections(after)).toEqual(normalizedConnections(before));
  expectPairKeysAreCanonical(after);

  expect(normalizedAttachments(after)).toEqual(normalizedAttachments(before));
}

function expectSameCaseRecord(before: StoredCase, after: StoredCase): void {
  expect(normalizedCase(after)).toEqual(normalizedCase(before));
}

async function createCase(page: Page, title: string): Promise<StoredCase> {
  await page.goto('/');

  // Wait for the shelf to leave its loading state before choosing the trigger.
  // Reading the button count during the first render races the repository open
  // and can wait forever for a trigger that is no longer the right one.
  const firstCase = page.getByRole('button', { name: /Create your first case/i });
  const newCase = page.getByRole('button', { name: 'New case', exact: true });
  await expect(firstCase.or(newCase)).toBeVisible();
  if ((await newCase.count()) > 0) {
    await newCase.click();
  } else {
    await firstCase.click();
  }

  const dialog = page.getByRole('dialog', { name: 'Create a case' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Case title' }).fill(title);
  await dialog.getByRole('button', { name: 'Create case' }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();

  await expect
    .poll(async () => casesWithTitle(await readSnapshot(page), title).length, { timeout: 15_000 })
    .toBe(1);

  return singleCase(await readSnapshot(page), title);
}

async function captureImage(
  page: Page,
  caseId: string,
  fixture: string,
  title: string,
  type: 'note' | 'source',
): Promise<void> {
  await page.goto(`/#/case/${caseId}/capture`);
  await expect(page.getByRole('heading', { level: 2, name: 'Capture evidence' })).toBeVisible();

  await page.setInputFiles('[data-testid="capture-choose-photo"]', fixture);
  await expect(page.getByRole('heading', { name: 'Crop and rotate' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByAltText('Selected note photo to crop and rotate')).toBeVisible();

  await page.getByRole('button', { name: 'Use this crop' }).click();
  await expect(page.getByRole('heading', { name: 'Name the card' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Card type' }).selectOption(type);
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('button', { name: 'Save card' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => (await readSnapshot(page)).cards.some((card) => card.title === title), {
      timeout: 30_000,
    })
    .toBe(true);
}

async function captureTopic(page: Page, caseId: string, title: string): Promise<void> {
  await page.goto(`/#/case/${caseId}/capture`);
  await expect(page.getByRole('heading', { level: 2, name: 'Capture evidence' })).toBeVisible();

  await page.getByRole('button', { name: 'Add topic' }).click();
  await expect(page.getByRole('heading', { name: 'Add a topic' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Topic title' }).fill(title);
  await page.getByRole('button', { name: 'Add topic' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => (await readSnapshot(page)).cards.some((card) => card.title === title), {
      timeout: 30_000,
    })
    .toBe(true);
}

/**
 * Add the tags, two strings, the non-default viewport, and the closed marker
 * that the current UI does not expose yet. This is not a mock: it writes the
 * exact application row shapes into the same IndexedDB database through raw
 * transactions, so the production exporter and importer read and write them.
 */
async function seedTagsAndStrings(
  page: Page,
  caseId: string,
  tagsByTitle: Readonly<Record<string, readonly string[]>>,
  ocrByTitle: Readonly<
    Record<
      string,
      {
        readonly text: string;
        readonly confidence: number;
        readonly engineVersion: string;
        readonly updatedAt: string;
      }
    >
  > = {},
): Promise<SeedResult> {
  return page.evaluate(
    async ({ databaseName, targetCaseId, tagMap, ocrMap, viewport, closedAt }) => {
      const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
        const request = indexedDB.open(databaseName);
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

      const cardRows = await readAll('cards');
      const caseRows = await readAll('cases');
      const targetCase = caseRows.find((row) => String(row.id) === targetCaseId);
      if (targetCase === undefined) {
        throw new Error('The target case row is missing before seeding');
      }

      const cardByTitle = new Map(cardRows.map((row) => [String(row.title), row] as const));
      const note = cardByTitle.get('Glycolysis notes');
      const source = cardByTitle.get('Textbook page 42');
      const topic = cardByTitle.get('ATP yield');
      if (note === undefined || source === undefined || topic === undefined) {
        throw new Error('The three captured cards are not present before seeding');
      }

      const pairKey = (first: string, second: string): string => [first, second].sort().join('::');

      const noteCardId = String(note.id);
      const sourceCardId = String(source.id);
      const topicCardId = String(topic.id);

      const connections = [
        {
          id: crypto.randomUUID(),
          caseId: targetCaseId,
          fromCardId: noteCardId,
          toCardId: sourceCardId,
          pairKey: pairKey(noteCardId, sourceCardId),
          // A second type proves the string type is carried through the archive
          // instead of every string collapsing to the default association.
          type: 'provenance',
        },
        {
          id: crypto.randomUUID(),
          caseId: targetCaseId,
          fromCardId: noteCardId,
          toCardId: topicCardId,
          pairKey: pairKey(noteCardId, topicCardId),
          type: 'association',
        },
      ];

      await new Promise<void>((resolvePromise, rejectPromise) => {
        const transaction = database.transaction(['cases', 'cards', 'connections'], 'readwrite');
        transaction.oncomplete = () => resolvePromise();
        transaction.onerror = () => rejectPromise(transaction.error);
        transaction.onabort = () => rejectPromise(transaction.error);

        const caseStore = transaction.objectStore('cases');
        const cardStore = transaction.objectStore('cards');
        const connectionStore = transaction.objectStore('connections');

        caseStore.put({ ...targetCase, viewport, closedAt });

        for (const row of [note, source, topic]) {
          const tags = tagMap[String(row.title)] ?? [];
          const ocr = ocrMap[String(row.title)];
          cardStore.put({
            ...row,
            tags: [...tags],
            ...(ocr !== undefined
              ? {
                  ocrText: ocr.text,
                  ocrConfidence: ocr.confidence,
                  ocrEngineVersion: ocr.engineVersion,
                  ocrUpdatedAt: ocr.updatedAt,
                }
              : {}),
          });
        }

        for (const connection of connections) {
          connectionStore.add(connection);
        }
      });

      database.close();

      return { noteCardId, sourceCardId, topicCardId };
    },
    {
      databaseName: DATABASE_NAME,
      targetCaseId: caseId,
      tagMap: tagsByTitle,
      ocrMap: ocrByTitle,
      viewport: CUSTOM_VIEWPORT,
      closedAt: CLOSED_AT,
    },
  );
}

async function readDownload(
  page: Page,
): Promise<{ readonly fileName: string; readonly bytes: Buffer }> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export case', exact: true }).click();
  const download = await downloadPromise;

  const fileName = download.suggestedFilename();
  const path = await download.path();
  if (path === null) {
    throw new Error(`The browser did not provide a path for ${fileName}`);
  }

  return { fileName, bytes: await readFile(path) };
}

async function exportFromShelf(
  page: Page,
  title: string,
): Promise<{ readonly fileName: string; readonly bytes: Buffer }> {
  await page.goto('/');
  await page.getByRole('button', { name: `Back up ${title}`, exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Backup and restore' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(`Save one file containing “${title}” and its images.`),
  ).toBeVisible();

  const download = await readDownload(page);
  await expect(dialog.getByRole('heading', { name: 'Backup saved' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByText(/The archive is not encrypted\./)).toBeVisible();

  await dialog.getByRole('button', { name: 'Back to shelf' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(`Backup saved: ${download.fileName}.`)).toBeVisible({
    timeout: 15_000,
  });

  return download;
}

function parseArchive(bytes: Buffer): {
  readonly manifest: ArchiveManifest;
  readonly entries: Record<string, Uint8Array>;
} {
  expect(bytes.byteLength, 'the downloaded archive must be non-empty').toBeGreaterThan(0);
  expect(bytes[0], 'ZIP local file header').toBe(0x50);
  expect(bytes[1], 'ZIP local file header').toBe(0x4b);

  const entries = unzipSync(new Uint8Array(bytes));
  const manifestBytes = entries['manifest.json'];
  if (manifestBytes === undefined) {
    throw new Error('The archive does not contain manifest.json');
  }

  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ArchiveManifest;
  return { manifest, entries };
}

/**
 * Read the archive's own manifest and bytes. This proves the file contains the
 * expected case and no other, every image entry matches its SHA-256, and the
 * tags, positions, strings, viewport, and closure are in the archive too.
 */
function expectArchiveContents(
  bytes: Buffer,
  baseline: Snapshot,
  targetCaseId: string,
  decoyCaseId: string,
): void {
  const { manifest, entries } = parseArchive(bytes);

  expect(manifest.format).toBe('notes-detective-case');
  expect(manifest.formatVersion).toBe(1);
  expect(manifest.dbSchemaVersion).toBe(1);
  expect(manifest.appVersion.length).toBeGreaterThan(0);
  expect(Number.isNaN(Date.parse(manifest.exportedAt))).toBe(false);

  expect(manifest.case.id).toBe(targetCaseId);
  expect(manifest.case.id).not.toBe(decoyCaseId);
  expect(manifest.case.title).toBe(TARGET_TITLE);
  expect(manifest.case.viewport).toEqual(CUSTOM_VIEWPORT);
  expect(manifest.case.closedAt).toBe(CLOSED_AT);

  expect(manifest.cards).toHaveLength(baseline.cards.length);
  expect(manifest.connections).toHaveLength(baseline.connections.length);
  expect(manifest.attachments).toHaveLength(baseline.attachments.length);

  for (const card of manifest.cards) {
    expect(card.caseId, `archived card ${card.title} leaks another case`).toBe(targetCaseId);
    expect(normalizedCard(card)).toEqual(normalizedCard(singleCard(baseline, card.title)));
  }

  expect(
    normalizedConnections({
      ...baseline,
      cards: manifest.cards,
      connections: manifest.connections,
    }),
  ).toEqual(normalizedConnections(baseline));

  const expectedEntries = [
    'manifest.json',
    ...manifest.attachments.map((entry) => entry.path),
  ].sort();
  expect(Object.keys(entries).sort()).toEqual(expectedEntries);

  const imageCards = new Set(manifest.attachments.map((attachment) => attachment.cardId));
  expect(imageCards.size, 'the archive contains both photo cards').toBe(2);

  for (const attachment of manifest.attachments) {
    const entry = entries[attachment.path];
    if (entry === undefined) {
      throw new Error(`The archive is missing ${attachment.path}`);
    }
    expect(entry.byteLength, `archived bytes for ${attachment.kind}`).toBe(attachment.bytes);
    expect(sha256(entry), `archived SHA-256 for ${attachment.kind}`).toBe(attachment.sha256);
    expect(
      manifest.cards.some((card) => card.id === attachment.cardId),
      `archived image ${attachment.kind} references an archived card`,
    ).toBe(true);
  }

  const archivedAttachmentMap: Record<string, unknown> = {};
  const titles = new Map(manifest.cards.map((card) => [card.id, card.title] as const));
  for (const attachment of manifest.attachments) {
    archivedAttachmentMap[
      `${titles.get(attachment.cardId) ?? 'missing-card'}::${attachment.kind}`
    ] = {
      mime: attachment.mime,
      width: attachment.width,
      height: attachment.height,
      bytes: attachment.bytes,
      sha256: attachment.sha256,
      blobBytes: attachment.bytes,
      blobSha256: attachment.sha256,
    };
  }
  expect(archivedAttachmentMap).toEqual(normalizedAttachments(baseline));
}

async function chooseArchiveFile(page: Page, bytes: Buffer, fileName: string): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Backup and restore' });
  await expect(dialog).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'application/zip',
    buffer: bytes,
  });

  await expect(dialog.getByRole('region', { name: 'Archive summary' })).toBeVisible({
    timeout: 30_000,
  });

  const summary = dialog.getByRole('region', { name: 'Archive summary' });
  const summaryCopy = await summary
    .locator('dl > div')
    .evaluateAll((rows) =>
      Object.fromEntries(
        rows.map((row) => [
          row.querySelector('dt')?.textContent?.trim() ?? '',
          row.querySelector('dd')?.textContent?.trim() ?? '',
        ]),
      ),
    );
  expect(summaryCopy['Case']).toBe(TARGET_TITLE);
  expect(summaryCopy['Cards']).toBe('3');
  expect(summaryCopy['Connections']).toBe('2');
  expect(summaryCopy['Images']).toBe('2');

  return dialog;
}

async function restoreCopy(page: Page, bytes: Buffer, fileName: string): Promise<StoredCase> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore from backup', exact: true }).click();

  const dialog = await chooseArchiveFile(page, bytes, fileName);

  await expect(dialog.getByRole('radio', { name: /Restore as a copy/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /Replace existing case/ })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Restore as a copy' }).click();
  await expect(dialog.getByRole('heading', { name: 'Case restored' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByText(/as a new copy\./)).toBeVisible();
  await expect(dialog.getByText(/3 cards, 2 connections, and 6 images restored\./)).toBeVisible();

  await expect
    .poll(async () => casesWithTitle(await readSnapshot(page), TARGET_TITLE).length, {
      timeout: 15_000,
    })
    .toBe(1);

  const restored = singleCase(await readSnapshot(page), TARGET_TITLE);

  await dialog.getByRole('button', { name: 'Open case' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible();
  await expect(page.getByTestId('board-canvas')).toHaveAttribute(
    'data-board-scene-status',
    'ready',
    { timeout: 20_000 },
  );

  return restored;
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

async function expectCardDetail(page: Page, caseId: string, card: StoredCard): Promise<void> {
  await page.goto(`/#/case/${caseId}/card/${card.id}`);
  await expect(page.getByRole('heading', { level: 2, name: card.title })).toBeVisible();
  await expect(page.locator('.card-detail')).toHaveAttribute('data-card-id', card.id);

  const tags = page.getByRole('list', { name: 'Card tags' });
  if (card.tags.length === 0) {
    await expect(page.getByText('No tags yet.')).toBeVisible();
    return;
  }

  await expect(tags).toBeVisible();
  for (const tag of card.tags) {
    await expect(tags.getByText(tag, { exact: true })).toBeVisible();
  }

  await imageIsLoaded(page);
}

test('exports one real .ndcase, deletes it, restores a copy with new IDs, and replaces it', async ({
  page,
}) => {
  test.setTimeout(240_000);

  const externalRequests: string[] = [];
  const writeRequests: string[] = [];
  const consoleErrors: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/i.test(url) && !url.startsWith(PREVIEW_ORIGIN)) {
      externalRequests.push(url);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writeRequests.push(`${request.method()} ${url}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  // Force the documented fallback path: a real Blob download for export and the
  // real hidden file input for import. The native File System Access picker
  // cannot be driven by Playwright, and BACKUP-FR-06 requires both paths.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: undefined,
    });
  });

  // A decoy case proves the exporter includes exactly one case.
  const decoy = await createCase(page, DECOY_TITLE);
  const target = await createCase(page, TARGET_TITLE);
  expect(decoy.id).not.toBe(target.id);

  // Two real PNGs through the native capture input, plus a text topic. The
  // topic provides a second card for the second string.
  await captureImage(page, target.id, noteFixture, NOTE_TITLE, 'note');
  await captureImage(page, target.id, sourceFixture, SOURCE_TITLE, 'source');
  await captureTopic(page, target.id, TOPIC_TITLE);

  const seededIds = await seedTagsAndStrings(
    page,
    target.id,
    {
      [NOTE_TITLE]: NOTE_TAGS,
      [SOURCE_TITLE]: SOURCE_TAGS,
      [TOPIC_TITLE]: TOPIC_TAGS,
    },
    { [NOTE_TITLE]: NOTE_OCR },
  );

  await page.goto('/');
  const baselineSnapshot = await readSnapshot(page);
  const baseline = singleCase(baselineSnapshot, TARGET_TITLE);
  expect(baseline.id).toBe(target.id);
  expect(baseline.viewport).toEqual(CUSTOM_VIEWPORT);
  expect(baseline.closedAt).toBe(CLOSED_AT);
  expect(baselineSnapshot.cards).toHaveLength(3);
  expect(baselineSnapshot.connections).toHaveLength(2);
  expect(baselineSnapshot.attachments).toHaveLength(6);
  expect(singleCard(baselineSnapshot, NOTE_TITLE).tags).toEqual(NOTE_TAGS);
  expect(singleCard(baselineSnapshot, SOURCE_TITLE).tags).toEqual(SOURCE_TAGS);
  expect(singleCard(baselineSnapshot, TOPIC_TITLE).tags).toEqual(TOPIC_TAGS);
  expect(singleCard(baselineSnapshot, NOTE_TITLE).ocrText).toBe(NOTE_OCR.text);
  expect(singleCard(baselineSnapshot, NOTE_TITLE).ocrConfidence).toBe(NOTE_OCR.confidence);
  expect(normalizedConnections(baselineSnapshot)).toEqual(
    [
      `${NOTE_TITLE} <-> ${SOURCE_TITLE} (provenance)`,
      `${NOTE_TITLE} <-> ${TOPIC_TITLE} (association)`,
    ].sort(),
  );
  expectPairKeysAreCanonical(baselineSnapshot);

  // Positions must be real, distinct graph data before the export: if every
  // card sat at the default origin, a restore that dropped positions would
  // still look identical.
  const seededPositions = baselineSnapshot.cards.map(
    (card) => `${card.position.x},${card.position.y}`,
  );
  expect(new Set(seededPositions).size, 'cards start at distinct positions').toBe(3);
  expect(seededPositions, 'cards are not all at the default origin').not.toContain('0,0');
  expect(
    baselineSnapshot.attachments.every((attachment) => attachment.blobSha256 === attachment.sha256),
    'stored image bytes match their recorded digests before export',
  ).toBe(true);

  // Export through the real shelf dialog and read the downloaded bytes.
  const firstArchive = await exportFromShelf(page, TARGET_TITLE);
  expect(firstArchive.fileName).toMatch(ARCHIVE_FILENAME);
  expectArchiveContents(firstArchive.bytes, baselineSnapshot, target.id, decoy.id);

  // Delete the case through the real confirmation. The dialog must name the
  // contents it is about to remove, and the cascade must leave no rows behind.
  await page.goto('/');
  await page.getByRole('button', { name: `Delete ${TARGET_TITLE}`, exact: true }).click();
  const deleteDialog = page.getByRole('dialog', {
    name: new RegExp(`Delete “${TARGET_TITLE}”\\?`),
  });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog.locator('[data-count="cards"] dd')).toHaveText('3');
  await expect(deleteDialog.locator('[data-count="connections"] dd')).toHaveText('2');
  await expect(deleteDialog.locator('[data-count="images"] dd')).toHaveText('2');
  await deleteDialog.getByRole('button', { name: 'Delete case' }).click();
  await expect(deleteDialog).not.toBeVisible();

  await expect
    .poll(async () => (await readSnapshot(page)).cases.some((row) => row.id === target.id), {
      timeout: 15_000,
    })
    .toBe(false);

  const afterDelete = await readSnapshot(page);
  expect(afterDelete.cases.map((row) => row.id)).toEqual([decoy.id]);
  expect(afterDelete.cards).toHaveLength(0);
  expect(afterDelete.connections).toHaveLength(0);
  expect(afterDelete.attachments).toHaveLength(0);

  // Restore the downloaded bytes as a copy. The new case, cards, strings, and
  // attachments must all have new IDs and identical data.
  const restored = await restoreCopy(page, firstArchive.bytes, firstArchive.fileName);
  const restoredSnapshot = await readSnapshot(page);
  expect(restored.id).not.toBe(target.id);
  expect(restored.id).not.toBe(decoy.id);
  expect(casesWithTitle(restoredSnapshot, DECOY_TITLE)).toHaveLength(1);
  expectSameCaseRecord(baseline, restored);
  expectSameCaseData(baselineSnapshot, restoredSnapshot);
  expectFreshChildIds(baselineSnapshot, restoredSnapshot);

  // No orphaned rows: every restored child hangs off the restored case, so a
  // remapping bug cannot hide behind matching titles.
  const restoredCardIds = new Set(restoredSnapshot.cards.map((card) => card.id));
  expect(restoredSnapshot.cards.every((card) => card.caseId === restored.id)).toBe(true);
  expect(restoredSnapshot.connections.every((row) => row.caseId === restored.id)).toBe(true);
  expect(
    restoredSnapshot.attachments.every((attachment) => restoredCardIds.has(attachment.cardId)),
    'every restored image belongs to a restored card',
  ).toBe(true);

  // Verify the restored images and tags through the real card-detail screen.
  for (const title of [NOTE_TITLE, SOURCE_TITLE]) {
    await expectCardDetail(page, restored.id, singleCard(restoredSnapshot, title));
  }
  await page.goto('/');

  // Export the restored case from the app again. Copy restore deliberately
  // remaps the case ID, so the first archive no longer names an existing case;
  // the dialog therefore cannot offer Replace for it against the copy. Replace
  // acts on an existing case ID, so this freshly generated archive of the same
  // case targets the restored copy directly and exercises the real replace path.
  const secondArchive = await exportFromShelf(page, TARGET_TITLE);
  expect(secondArchive.fileName).toMatch(ARCHIVE_FILENAME);
  const secondParsed = parseArchive(secondArchive.bytes);
  expect(secondParsed.manifest.case.id).toBe(restored.id);
  expectArchiveContents(secondArchive.bytes, baselineSnapshot, restored.id, decoy.id);

  // Replace the restored copy by importing the generated archive. Copy remains
  // the default; replace needs an explicit choice and the typed title.
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore from backup', exact: true }).click();
  const replaceDialog = await chooseArchiveFile(page, secondArchive.bytes, secondArchive.fileName);

  const copyRadio = replaceDialog.getByRole('radio', { name: /Restore as a copy/ });
  const replaceRadio = replaceDialog.getByRole('radio', { name: /Replace existing case/ });
  await expect(copyRadio).toBeChecked();
  await expect(replaceRadio).toHaveCount(1);
  await replaceRadio.check();
  await expect(copyRadio).not.toBeChecked();
  await expect(
    replaceDialog.getByText(`Replaces “${TARGET_TITLE}” after you type its title.`),
  ).toBeVisible();

  // An empty or wrong confirmation must not write anything.
  const beforeFailedConfirm = await readSnapshot(page);
  await replaceDialog.getByRole('button', { name: 'Replace case' }).click();
  await expect(replaceDialog.getByRole('alert')).toContainText(
    'Type the existing case title exactly to replace it.',
  );
  expect(await readSnapshot(page)).toEqual(beforeFailedConfirm);

  await replaceDialog.getByRole('textbox').fill(TARGET_TITLE);
  await replaceDialog.getByRole('button', { name: 'Replace case' }).click();
  await expect(replaceDialog.getByRole('heading', { name: 'Case restored' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(replaceDialog.getByText(/over the existing copy\./)).toBeVisible();

  await expect
    .poll(
      async () => {
        const snapshot = await readSnapshot(page);
        return snapshot.cards.length === 3 && snapshot.attachments.length === 6;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const replacedSnapshot = await readSnapshot(page);
  const replaced = singleCase(replacedSnapshot, TARGET_TITLE);
  expect(casesWithTitle(replacedSnapshot, TARGET_TITLE)).toHaveLength(1);
  expect(replacedSnapshot.cases).toHaveLength(2);
  expect(casesWithTitle(replacedSnapshot, DECOY_TITLE)).toHaveLength(1);
  expect(replaced.id).toBe(restored.id);

  expectSameCaseRecord(baseline, replaced);
  expectSameCaseData(baselineSnapshot, replacedSnapshot);
  expectFreshChildIds(restoredSnapshot, replacedSnapshot);

  // No stale copy rows remain: the replaced case owns exactly the archive rows.
  expect(replacedSnapshot.cards.every((card) => card.caseId === restored.id)).toBe(true);
  expect(replacedSnapshot.connections.every((row) => row.caseId === restored.id)).toBe(true);
  expect(replacedSnapshot.attachments).toHaveLength(6);
  expect(replacedSnapshot.connections).toHaveLength(2);
  expect(replacedSnapshot.cards).toHaveLength(3);
  expect(
    replacedSnapshot.attachments.every((attachment) => attachment.blobSha256 === attachment.sha256),
    'restored image bytes match their recorded digests after replace',
  ).toBe(true);

  await replaceDialog.getByRole('button', { name: 'Back to shelf' }).click();
  await expect(replaceDialog).not.toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: TARGET_TITLE, exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: DECOY_TITLE, exact: true })).toHaveCount(1);

  // The replaced card keeps its tags and image on the real screen.
  await expectCardDetail(page, replaced.id, singleCard(replacedSnapshot, NOTE_TITLE));

  expect(externalRequests, 'no backup request left the browser').toEqual([]);
  expect(writeRequests, 'no archive or image was uploaded').toEqual([]);
  expect(consoleErrors, 'no console errors during the backup journey').toEqual([]);
  expect(seededIds.noteCardId).toBe(singleCard(baselineSnapshot, NOTE_TITLE).id);
  expect(seededIds.sourceCardId).toBe(singleCard(baselineSnapshot, SOURCE_TITLE).id);
  expect(seededIds.topicCardId).toBe(singleCard(baselineSnapshot, TOPIC_TITLE).id);
});
