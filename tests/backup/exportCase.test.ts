// @vitest-environment node

import 'fake-indexeddb/auto';

import { createHash } from 'node:crypto';

import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NewAttachment } from '../../src/data/attachmentStore';
import { CaseRepository } from '../../src/data/caseRepository';
import { createNotesDetectiveDatabase } from '../../src/data/db';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { RecordNotFoundError } from '../../src/data/errors';
import { createId, fixedClock } from '../../src/domain/ids';
import { buildPairKey } from '../../src/domain/model';
import type {
  AttachmentMime,
  CardRecord,
  CaseRecord,
  ConnectionRecord,
} from '../../src/domain/model';
import { DomainValidationError, parseConnectionRecord } from '../../src/domain/validation';
import {
  ARCHIVE_FILE_EXTENSION,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_MANIFEST_PATH,
  archiveImageExtension,
  buildCaseArchiveFileName,
  buildArchiveImagePath,
  parseCaseArchiveManifest,
  slugifyCaseTitle,
} from '../../src/features/backup/archiveFormat';
import type { CaseArchiveManifest } from '../../src/features/backup/archiveFormat';
import {
  ArchiveExportError,
  ArchiveSaveCancelledError,
  ArchiveSaveError,
  buildCaseArchive,
  exportCase,
  saveCaseArchive,
  triggerBlobDownload,
} from '../../src/features/backup/exportCase';
import type {
  ArchiveFileHandle,
  ArchiveSaveFilePicker,
  CaseArchive,
} from '../../src/features/backup/exportCase';
import { advancingClock, closeTestDatabase } from '../data/testDatabase';

const EXPORT_INSTANT = '2026-06-12T09:30:00.000Z';
const MISSING_CASE_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_IMAGE_SECRET = 'not-in-this-archive';

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function attachment(
  kind: NewAttachment['kind'],
  mime: AttachmentMime,
  content: string,
): NewAttachment {
  const blob = new Blob([content], { type: mime });
  return {
    kind,
    mime,
    width: 640,
    height: 480,
    bytes: blob.size,
    sha256: sha256(content),
    blob,
  };
}

function attachmentSet(prefix: string): NewAttachment[] {
  return [
    attachment('original', 'image/png', `${prefix}-original`),
    attachment('display', 'image/jpeg', `${prefix}-display`),
    attachment('thumbnail', 'image/webp', `${prefix}-thumbnail`),
  ];
}

function unzippedEntry(entries: Record<string, Uint8Array>, path: string): Uint8Array {
  const entry = entries[path];
  if (entry === undefined) {
    throw new Error(`Expected archive entry "${path}"`);
  }
  return entry;
}

function cloneManifest(manifest: CaseArchiveManifest): CaseArchiveManifest {
  return structuredClone(manifest);
}

let db: NotesDetectiveDatabase;
let repository: CaseRepository;
let archive: CaseArchive;

let caseRecord: CaseRecord;
let sourceCard: CardRecord;
let noteCard: CardRecord;
let topicCard: CardRecord;
let sourceAttachmentIds: string[];
let otherCaseId: string;
let otherCardId: string;
let otherAttachmentId: string;

async function addConnection(
  from: CardRecord,
  to: CardRecord,
  type: ConnectionRecord['type'],
): Promise<ConnectionRecord> {
  const connection = parseConnectionRecord({
    id: createId(),
    caseId: from.caseId,
    fromCardId: from.id,
    toCardId: to.id,
    pairKey: buildPairKey(from.id, to.id),
    type,
  });
  await db.connections.add(connection);
  return connection;
}

beforeEach(async () => {
  db = createNotesDetectiveDatabase(`notes-detective-backup-${createId()}`);
  await db.open();
  repository = new CaseRepository(db, {
    clock: advancingClock('2026-06-01T08:00:00.000Z'),
  });

  const createdCase = await repository.createCase({
    title: '  Cell Biology: Final Review!  ',
    subject: 'Biology',
    examDate: '2026-06-15',
    viewport: { x: -120, y: 64, scale: 1.75 },
    closedAt: '2026-06-10T10:00:00.000Z',
    isDemo: true,
    backupPromptedAt: '2026-06-11T08:00:00.000Z',
  });
  const loadedCase = await repository.getCase(createdCase.id);
  if (loadedCase === null) {
    throw new Error('Expected the seeded case to exist');
  }
  caseRecord = loadedCase;

  const sourceResult = await repository.createCardWithAttachments(
    {
      caseId: caseRecord.id,
      type: 'source',
      title: 'Lecture 7 handout',
      position: { x: 40, y: 80 },
      tags: ['biology', 'lecture-7'],
    },
    attachmentSet('source'),
  );
  sourceCard = sourceResult.card;
  sourceAttachmentIds = sourceResult.attachments.map((record) => record.id);

  noteCard = await repository.createCard({
    caseId: caseRecord.id,
    type: 'note',
    title: 'Mitochondria are the powerhouse',
    position: { x: 320, y: 260 },
    tags: ['mitochondria', 'exam'],
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    rotation: 90,
    retainFullResolution: true,
    ocrText: 'The mitochondria is the powerhouse of the cell.',
    ocrConfidence: 92.5,
    ocrEngineVersion: 'tesseract-5.0.0',
    ocrUpdatedAt: '2026-06-05T12:00:00.000Z',
  });

  topicCard = await repository.createCard({
    caseId: caseRecord.id,
    type: 'topic',
    title: 'Cellular respiration',
    position: { x: 120, y: 520 },
    tags: ['respiration'],
  });

  await addConnection(noteCard, sourceCard, 'provenance');
  await addConnection(noteCard, topicCard, 'association');

  const otherCase = await repository.createCase({ title: 'Unrelated case' });
  const otherCardResult = await repository.createCardWithAttachments(
    {
      caseId: otherCase.id,
      type: 'source',
      title: 'Other source',
      position: { x: 10, y: 10 },
    },
    [
      {
        ...attachment('original', 'image/png', OTHER_IMAGE_SECRET),
      },
    ],
  );
  otherCaseId = otherCase.id;
  otherCardId = otherCardResult.card.id;
  const otherAttachment = otherCardResult.attachments[0];
  if (otherAttachment === undefined) {
    throw new Error('Expected the other case to own an attachment');
  }
  otherAttachmentId = otherAttachment.id;

  const finalCase = await repository.getCase(caseRecord.id);
  if (finalCase === null) {
    throw new Error('Expected the seeded case to still exist');
  }
  caseRecord = finalCase;

  archive = await buildCaseArchive({
    caseId: caseRecord.id,
    repository,
    clock: fixedClock(EXPORT_INSTANT),
  });
});

afterEach(async () => {
  await closeTestDatabase(db);
  vi.unstubAllGlobals();
});

describe('single-case archive export', () => {
  it('uses the GIF extension for animated image attachments', () => {
    expect(archiveImageExtension('image/gif')).toBe('gif');
    expect(buildArchiveImagePath('77777777-7777-4777-8777-777777777777', 'image/gif')).toBe(
      'images/77777777-7777-4777-8777-777777777777.gif',
    );
  });

  it('unzips to manifest.json plus only the selected case images', () => {
    const entries = unzipSync(archive.bytes);
    const paths = Object.keys(entries);
    const imageEntryPaths = paths.filter((path) => path !== ARCHIVE_MANIFEST_PATH);

    expect(paths.filter((path) => path === ARCHIVE_MANIFEST_PATH)).toHaveLength(1);
    expect(paths).toHaveLength(archive.manifest.attachments.length + 1);
    expect(imageEntryPaths).toHaveLength(archive.manifest.attachments.length);

    for (const path of imageEntryPaths) {
      expect(path.startsWith('images/')).toBe(true);
      expect(path).not.toContain('..');
      expect(path).not.toContain('\\');
      expect(path.startsWith('/')).toBe(false);
    }

    const imagePaths = new Set(archive.manifest.attachments.map((entry) => entry.path));
    for (const path of imageEntryPaths) {
      expect(imagePaths.has(path)).toBe(true);
    }
  });

  it('round-trips the case, tags, positions, viewport, closure, OCR, and demo marker', async () => {
    const entries = unzipSync(archive.bytes);
    const manifest = parseCaseArchiveManifest(
      JSON.parse(strFromU8(unzippedEntry(entries, ARCHIVE_MANIFEST_PATH))),
    );

    expect(manifest.format).toBe(ARCHIVE_FORMAT);
    expect(manifest.formatVersion).toBe(ARCHIVE_FORMAT_VERSION);
    expect(manifest.exportedAt).toBe(EXPORT_INSTANT);
    expect(manifest.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.dbSchemaVersion).toBe(1);
    expect(manifest.case).toEqual(caseRecord);
    expect(manifest.case.viewport).toEqual({ x: -120, y: 64, scale: 1.75 });
    expect(manifest.case.closedAt).toBe('2026-06-10T10:00:00.000Z');
    expect(manifest.case.isDemo).toBe(true);
    expect(manifest.case.backupPromptedAt).toBe('2026-06-11T08:00:00.000Z');

    expect(manifest.cards).toHaveLength(3);
    expect(manifest.cards).toEqual(await repository.listCards(caseRecord.id));

    const note = manifest.cards.find((card) => card.id === noteCard.id);
    expect(note).toBeDefined();
    expect(note?.type).toBe('note');
    expect(note?.tags).toEqual(['mitochondria', 'exam']);
    expect(note?.position).toEqual({ x: 320, y: 260 });
    expect(note?.crop).toEqual({ x: 0.1, y: 0.2, width: 0.7, height: 0.6 });
    expect(note?.rotation).toBe(90);
    expect(note?.retainFullResolution).toBe(true);
    expect(note?.ocrText).toBe('The mitochondria is the powerhouse of the cell.');
    expect(note?.ocrConfidence).toBe(92.5);
    expect(note?.ocrEngineVersion).toBe('tesseract-5.0.0');
    expect(note?.ocrUpdatedAt).toBe('2026-06-05T12:00:00.000Z');

    expect(manifest.connections).toEqual(await repository.listConnections(caseRecord.id));
    expect(manifest.connections).toHaveLength(2);
    expect(manifest.connections.map((connection) => connection.type).sort()).toEqual([
      'association',
      'provenance',
    ]);
    expect(manifest.connections.every((connection) => connection.caseId === caseRecord.id)).toBe(
      true,
    );
  });

  it('writes attachment metadata with safe paths and checksums that match the bytes', async () => {
    const entries = unzipSync(archive.bytes);
    const records = await repository.listAttachments(sourceCard.id);

    expect(archive.manifest.attachments).toHaveLength(sourceAttachmentIds.length);
    expect(new Set(archive.manifest.attachments.map((entry) => entry.id))).toEqual(
      new Set(sourceAttachmentIds),
    );

    for (const entry of archive.manifest.attachments) {
      const record = records.find((candidate) => candidate.id === entry.id);
      expect(record).toBeDefined();
      expect(entry.cardId).toBe(sourceCard.id);
      expect(entry.kind).toBe(record?.kind);
      expect(entry.mime).toBe(record?.mime);
      expect(entry.width).toBe(record?.width);
      expect(entry.height).toBe(record?.height);
      expect(entry.bytes).toBe(record?.bytes);

      const expectedExtension =
        entry.mime === 'image/jpeg' ? 'jpg' : entry.mime === 'image/png' ? 'png' : 'webp';
      expect(entry.path).toBe(`images/${entry.id}.${expectedExtension}`);
      expect(entry.path).not.toContain('..');
      expect(entry.path).not.toContain('\\');

      const bytes = unzippedEntry(entries, entry.path);
      expect(bytes.byteLength).toBe(entry.bytes);
      expect(sha256(bytes)).toBe(entry.sha256);
    }
  });

  it('contains exactly one case and never leaks another case, card, or image', () => {
    const serialized = JSON.stringify(archive.manifest);
    expect(serialized).not.toContain(otherCaseId);
    expect(serialized).not.toContain(otherCardId);
    expect(serialized).not.toContain(otherAttachmentId);

    expect(archive.manifest.case.id).toBe(caseRecord.id);
    expect(new Set(archive.manifest.cards.map((card) => card.caseId))).toEqual(
      new Set([caseRecord.id]),
    );

    const entries = unzipSync(archive.bytes);
    const entryPaths = Object.keys(entries);
    expect(entryPaths).not.toContain(`images/${otherAttachmentId}.png`);
    for (const path of entryPaths) {
      expect(strFromU8(unzippedEntry(entries, path))).not.toBe(OTHER_IMAGE_SECRET);
    }
  });

  it('recomputes a checksum instead of trusting a stale stored digest', async () => {
    const [firstAttachment] = sourceAttachmentIds;
    if (firstAttachment === undefined) {
      throw new Error('Expected a seeded attachment');
    }
    await db.attachments.update(firstAttachment, { sha256: 'b'.repeat(64) });

    const rebuilt = await buildCaseArchive({
      caseId: caseRecord.id,
      repository,
      clock: fixedClock(EXPORT_INSTANT),
    });
    const metadata = rebuilt.manifest.attachments.find((entry) => entry.id === firstAttachment);
    const record = (await repository.listAttachments(sourceCard.id)).find(
      (candidate) => candidate.id === firstAttachment,
    );
    if (metadata === undefined || record === undefined) {
      throw new Error('Expected rebuilt attachment metadata');
    }

    const actualBytes = await record.blob.text();
    expect(metadata.sha256).toBe(sha256(actualBytes));
    expect(metadata.sha256).not.toBe('b'.repeat(64));
  });

  it('names the file with a dated case slug and the .ndcase extension', () => {
    expect(archive.fileName).toBe('cell-biology-final-review-2026-06-12.ndcase');
    expect(archive.fileName.endsWith(ARCHIVE_FILE_EXTENSION)).toBe(true);
    expect(archive.blob.type).toBe('application/zip');
    expect(archive.blob.size).toBe(archive.bytes.byteLength);
  });

  it('fails when the requested case does not exist', async () => {
    await expect(
      buildCaseArchive({ caseId: MISSING_CASE_ID, repository, clock: fixedClock(EXPORT_INSTANT) }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('archive manifest hardening', () => {
  it('rejects traversal, absolute, backslash, and duplicate image paths', () => {
    const traversal = cloneManifest(archive.manifest);
    const traversalAttachment = traversal.attachments[0];
    if (traversalAttachment === undefined) {
      throw new Error('Expected an attachment');
    }
    traversalAttachment.path = 'images/../escape.png';
    expect(() => parseCaseArchiveManifest(traversal)).toThrow(DomainValidationError);

    const absolute = cloneManifest(archive.manifest);
    const absoluteAttachment = absolute.attachments[0];
    if (absoluteAttachment === undefined) {
      throw new Error('Expected an attachment');
    }
    absoluteAttachment.path = '/images/escape.png';
    expect(() => parseCaseArchiveManifest(absolute)).toThrow(DomainValidationError);

    const backslash = cloneManifest(archive.manifest);
    const backslashAttachment = backslash.attachments[0];
    if (backslashAttachment === undefined) {
      throw new Error('Expected an attachment');
    }
    backslashAttachment.path = 'images\\escape.png';
    expect(() => parseCaseArchiveManifest(backslash)).toThrow(DomainValidationError);

    const duplicate = cloneManifest(archive.manifest);
    const [first, second] = duplicate.attachments;
    if (first === undefined || second === undefined) {
      throw new Error('Expected two attachments');
    }
    second.path = first.path;
    expect(() => parseCaseArchiveManifest(duplicate)).toThrow(/duplicate image paths/);
  });

  it('rejects a card from another case and a dangling connection endpoint', () => {
    const foreignCard = cloneManifest(archive.manifest);
    const card = foreignCard.cards[0];
    if (card === undefined) {
      throw new Error('Expected a card');
    }
    card.caseId = otherCaseId;
    expect(() => parseCaseArchiveManifest(foreignCard)).toThrow(
      /Every card must belong to the archived case/,
    );

    const dangling = cloneManifest(archive.manifest);
    const connection = dangling.connections[0];
    if (connection === undefined) {
      throw new Error('Expected a connection');
    }
    connection.toCardId = otherCardId;
    expect(() => parseCaseArchiveManifest(dangling)).toThrow(/missing from the archive cards/);
  });

  it('rejects an unsupported format or version', () => {
    const wrongFormat = cloneManifest(archive.manifest) as unknown as Record<string, unknown>;
    wrongFormat.format = 'notes-detective-library';
    expect(() => parseCaseArchiveManifest(wrongFormat)).toThrow(DomainValidationError);

    const wrongVersion = cloneManifest(archive.manifest) as unknown as Record<string, unknown>;
    wrongVersion.formatVersion = 2;
    expect(() => parseCaseArchiveManifest(wrongVersion)).toThrow(DomainValidationError);
  });

  it('builds safe, dated filenames from awkward titles', () => {
    expect(slugifyCaseTitle('  Cell Biology: Final Review!  ')).toBe('cell-biology-final-review');
    expect(slugifyCaseTitle('!!!')).toBe('case');
    expect(
      buildCaseArchiveFileName('Cell Biology: Final Review!', '2026-06-12T23:30:00-05:00'),
    ).toBe('cell-biology-final-review-2026-06-13.ndcase');
  });
});

describe('archive saving', () => {
  it('writes through File System Access when it is available', async () => {
    const writes: Uint8Array[] = [];
    const close = vi.fn(async () => {});
    const abort = vi.fn(async () => {});
    const writable = {
      write: vi.fn(async (data: Uint8Array) => {
        writes.push(data);
      }),
      close,
      abort,
    };
    const handle: ArchiveFileHandle = {
      name: 'my-notes.ndcase',
      createWritable: vi.fn(async () => writable),
    };
    const picker = vi.fn<ArchiveSaveFilePicker>(async () => handle);

    const result = await saveCaseArchive(archive, { showSaveFilePicker: picker });

    expect(picker).toHaveBeenCalledTimes(1);
    const options = picker.mock.calls[0]?.[0];
    expect(options?.suggestedName).toBe(archive.fileName);
    expect(options?.types).toEqual([
      {
        description: 'Notes Detective case archive',
        accept: { 'application/zip': ['.ndcase'] },
      },
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(archive.bytes);
    expect(close).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
    expect(result).toEqual({ method: 'file-system-access', fileName: 'my-notes.ndcase' });
  });

  it('detects a globally available picker and falls back to a download otherwise', async () => {
    const handle: ArchiveFileHandle = {
      createWritable: async () => ({
        write: async () => {},
        close: async () => {},
      }),
    };
    const picker: ArchiveSaveFilePicker = async () => handle;
    const pickerMock = vi.fn(picker);
    vi.stubGlobal('showSaveFilePicker', pickerMock);

    const viaGlobal = await saveCaseArchive(archive);
    expect(viaGlobal.method).toBe('file-system-access');
    expect(pickerMock).toHaveBeenCalledTimes(1);

    const download = vi.fn<(blob: Blob, fileName: string) => void>();
    const viaFallback = await saveCaseArchive(archive, {
      showSaveFilePicker: null,
      download,
    });
    expect(viaFallback).toEqual({ method: 'download', fileName: archive.fileName });
    expect(download).toHaveBeenCalledWith(archive.blob, archive.fileName);
  });

  it('uses the Blob download fallback with the dated file name', async () => {
    const download = vi.fn<(blob: Blob, fileName: string) => void>();

    const result = await saveCaseArchive(archive, {
      showSaveFilePicker: null,
      download,
    });

    expect(result).toEqual({ method: 'download', fileName: archive.fileName });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(archive.blob, archive.fileName);
  });

  it('writes a Blob URL download when no File System Access API is present', () => {
    const anchor = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const append = vi.fn();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append },
    });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:archive');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.useFakeTimers();

    try {
      triggerBlobDownload(archive.blob, archive.fileName);

      expect(anchor.download).toBe(archive.fileName);
      expect(anchor.href).toBe('blob:archive');
      expect(anchor.rel).toBe('noopener');
      expect(append).toHaveBeenCalledWith(anchor);
      expect(anchor.click).toHaveBeenCalledTimes(1);
      expect(anchor.remove).toHaveBeenCalledTimes(1);
      expect(createObjectUrl).toHaveBeenCalledWith(archive.blob);

      vi.runAllTimers();
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:archive');
    } finally {
      vi.useRealTimers();
      createObjectUrl.mockRestore();
      revokeObjectUrl.mockRestore();
    }
  });

  it('reports a save-dialog failure instead of silently downloading', async () => {
    const picker: ArchiveSaveFilePicker = async () => {
      throw new Error('permission denied');
    };
    const download = vi.fn<(blob: Blob, fileName: string) => void>();

    await expect(
      saveCaseArchive(archive, { showSaveFilePicker: picker, download }),
    ).rejects.toBeInstanceOf(ArchiveSaveError);
    expect(download).not.toHaveBeenCalled();
  });

  it('reports a destination that cannot be opened for writing', async () => {
    const picker: ArchiveSaveFilePicker = async () => ({
      createWritable: async () => {
        throw new Error('destination is read-only');
      },
    });

    await expect(saveCaseArchive(archive, { showSaveFilePicker: picker })).rejects.toBeInstanceOf(
      ArchiveSaveError,
    );
  });

  it('reports a download that the browser refuses to start', async () => {
    const download = vi.fn(() => {
      throw new Error('download blocked');
    });

    await expect(
      saveCaseArchive(archive, { showSaveFilePicker: null, download }),
    ).rejects.toBeInstanceOf(ArchiveSaveError);
  });

  it('treats a dismissed save dialog as cancellation without starting a download', async () => {
    const picker: ArchiveSaveFilePicker = async () => {
      const error = new Error('cancelled');
      error.name = 'AbortError';
      throw error;
    };
    const download = vi.fn<(blob: Blob, fileName: string) => void>();

    await expect(
      saveCaseArchive(archive, { showSaveFilePicker: picker, download }),
    ).rejects.toBeInstanceOf(ArchiveSaveCancelledError);
    expect(download).not.toHaveBeenCalled();
  });

  it('reports a write failure and aborts the destination stream', async () => {
    const abort = vi.fn(async () => {});
    const handle: ArchiveFileHandle = {
      createWritable: async () => ({
        write: async () => {
          throw new Error('disk full');
        },
        close: async () => {},
        abort,
      }),
    };
    const picker: ArchiveSaveFilePicker = async () => handle;

    await expect(saveCaseArchive(archive, { showSaveFilePicker: picker })).rejects.toBeInstanceOf(
      ArchiveSaveError,
    );
    expect(abort).toHaveBeenCalledTimes(1);
  });
});

describe('exportCase entry point', () => {
  it('builds and saves the archive without calling a network API', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network is disabled')));
    vi.stubGlobal('fetch', fetchMock);
    const download = vi.fn<(blob: Blob, fileName: string) => void>();

    const result = await exportCase({
      caseId: caseRecord.id,
      repository,
      clock: fixedClock(EXPORT_INSTANT),
      showSaveFilePicker: null,
      download,
    });

    expect(result.save).toEqual({ method: 'download', fileName: archive.fileName });
    expect(result.archive.manifest.case.id).toBe(caseRecord.id);
    expect(result.archive.bytes).toEqual(archive.bytes);
    expect(download).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails the hashing stage when an image digest is invalid or unavailable', async () => {
    const invalid = await buildCaseArchive({
      caseId: caseRecord.id,
      repository,
      clock: fixedClock(EXPORT_INSTANT),
      digest: async () => 'not-a-digest',
    }).catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(ArchiveExportError);
    expect((invalid as ArchiveExportError).stage).toBe('hashing');

    const unavailable = await buildCaseArchive({
      caseId: caseRecord.id,
      repository,
      clock: fixedClock(EXPORT_INSTANT),
      digest: async () => {
        throw new Error('crypto unavailable');
      },
    }).catch((error: unknown) => error);
    expect(unavailable).toBeInstanceOf(ArchiveExportError);
    expect((unavailable as ArchiveExportError).stage).toBe('hashing');
  });

  it('defaults the version metadata and honors explicit overrides', async () => {
    const overridden = await buildCaseArchive({
      caseId: caseRecord.id,
      repository,
      clock: fixedClock(EXPORT_INSTANT),
      appVersion: '9.9.9-test',
      dbSchemaVersion: 7,
    });

    expect(overridden.manifest.appVersion).toBe('9.9.9-test');
    expect(overridden.manifest.dbSchemaVersion).toBe(7);
    expect(archive.manifest.dbSchemaVersion).toBe(1);
  });
});
