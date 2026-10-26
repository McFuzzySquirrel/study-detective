import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';

import { DATABASE_VERSION } from '../../data/db';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import { RecordNotFoundError } from '../../data/errors';
import type { Clock } from '../../domain/ids';
import { nowIso, systemClock } from '../../domain/ids';
import { DomainValidationError } from '../../domain/validation';
import { isAbortError } from '../capture/imageValidation';
import { sha256Hex } from '../capture/imagePipeline';

import {
  ARCHIVE_FILE_EXTENSION,
  ARCHIVE_MANIFEST_PATH,
  ARCHIVE_MIME_TYPE,
  assertArchiveCardOcrPreserved,
  buildCaseArchiveFileName,
  buildCaseArchiveManifest,
  createArchiveAttachmentMetadata,
} from './archiveFormat';
import type { ArchiveAttachment, CaseArchiveManifest } from './archiveFormat';

/**
 * Single-case `.ndcase` export.
 *
 * The exporter reads one case through the repository boundary, re-hashes every
 * stored Blob instead of trusting the stored digest, and packages the validated
 * manifest with its images. It performs no network request and no upload; the
 * archive is released only when the caller explicitly invokes `exportCase` or
 * `saveCaseArchive` in response to a user action.
 */

/** The read-only slice of the repository an export needs. */
export type CaseArchiveRepository = Pick<
  CaseRepositoryPort,
  'getCase' | 'listCards' | 'listConnections' | 'listAttachments'
>;

export type BuildCaseArchiveInput = {
  readonly caseId: string;
  readonly repository: CaseArchiveRepository;
  readonly clock?: Clock;
  /** Manifest support metadata; defaults to the current app version. */
  readonly appVersion?: string;
  /** Defaults to the open database schema version. */
  readonly dbSchemaVersion?: number;
  /** Injected for deterministic checksum tests. */
  readonly digest?: (blob: Blob) => Promise<string>;
};

export type CaseArchive = {
  readonly bytes: Uint8Array;
  readonly blob: Blob;
  readonly manifest: CaseArchiveManifest;
  /** Suggested `<case-slug>-<yyyy-mm-dd>.ndcase` name. */
  readonly fileName: string;
};

export type ArchiveExportStage = 'reading' | 'hashing' | 'packaging';

/** A typed export failure so the UI can name the stage that failed. */
export class ArchiveExportError extends Error {
  readonly stage: ArchiveExportStage;
  readonly cause: unknown;

  constructor(stage: ArchiveExportStage, message: string, cause?: unknown) {
    super(message);
    this.name = 'ArchiveExportError';
    this.stage = stage;
    this.cause = cause;
  }
}

function assertDigest(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new ArchiveExportError(
      'hashing',
      'An image could not be verified because its SHA-256 digest was invalid.',
    );
  }
  return value;
}

async function readBlobBytes(attachmentId: string, blob: Blob): Promise<Uint8Array> {
  try {
    return new Uint8Array(await blob.arrayBuffer());
  } catch (cause) {
    throw new ArchiveExportError(
      'reading',
      `Image attachment "${attachmentId}" could not be read from device storage.`,
      cause,
    );
  }
}

/**
 * Build the archive bytes for exactly one case.
 *
 * Cards, strings, and attachments are read by `caseId`/card id only. A card or
 * string that belongs to another case fails manifest validation rather than
 * being written into the archive.
 */
export async function buildCaseArchive(input: BuildCaseArchiveInput): Promise<CaseArchive> {
  const { caseId, repository } = input;
  const caseRecord = await repository.getCase(caseId);
  if (caseRecord === null) {
    throw new RecordNotFoundError('case', caseId);
  }

  const [cards, connections] = await Promise.all([
    repository.listCards(caseId),
    repository.listConnections(caseId),
  ]);

  const attachmentsByCard = await Promise.all(
    cards.map(async (card) => ({
      cardId: card.id,
      attachments: await repository.listAttachments(card.id),
    })),
  );

  const archiveFiles = new Map<string, Uint8Array>();
  const attachmentMetadata: ArchiveAttachment[] = [];
  const digest = input.digest ?? sha256Hex;

  for (const { cardId, attachments } of attachmentsByCard) {
    for (const attachment of attachments) {
      if (attachment.cardId !== cardId) {
        throw new ArchiveExportError(
          'reading',
          `Attachment "${attachment.id}" does not belong to card "${cardId}".`,
        );
      }

      let sha256: string;
      try {
        sha256 = assertDigest(await digest(attachment.blob));
      } catch (cause) {
        if (cause instanceof ArchiveExportError) {
          throw cause;
        }
        throw new ArchiveExportError(
          'hashing',
          `Image attachment "${attachment.id}" could not be verified.`,
          cause,
        );
      }

      const metadata = createArchiveAttachmentMetadata({
        id: attachment.id,
        cardId: attachment.cardId,
        kind: attachment.kind,
        mime: attachment.mime,
        width: attachment.width,
        height: attachment.height,
        bytes: attachment.bytes,
        sha256,
      });

      if (archiveFiles.has(metadata.path)) {
        throw new ArchiveExportError(
          'packaging',
          `Image attachment "${attachment.id}" produced a duplicate archive path.`,
        );
      }
      archiveFiles.set(metadata.path, await readBlobBytes(attachment.id, attachment.blob));
      attachmentMetadata.push(metadata);
    }
  }

  const exportedAt = nowIso(input.clock ?? systemClock);

  let manifest: CaseArchiveManifest;
  try {
    manifest = buildCaseArchiveManifest({
      caseRecord,
      cards,
      connections,
      attachments: attachmentMetadata,
      exportedAt,
      ...(input.appVersion !== undefined ? { appVersion: input.appVersion } : {}),
      dbSchemaVersion: input.dbSchemaVersion ?? DATABASE_VERSION,
    });

    // The manifest is assembled from the stored cards, but OCR is exactly the
    // optional metadata a future mapping change could drop. Fail the export
    // rather than hand the student a backup that silently lost their OCR text.
    const archivedCards = new Map(manifest.cards.map((card) => [card.id, card] as const));
    for (const card of cards) {
      const archived = archivedCards.get(card.id);
      if (archived === undefined) {
        throw new DomainValidationError('The case archive manifest did not include every card');
      }
      assertArchiveCardOcrPreserved(card, archived);
    }
  } catch (cause) {
    if (cause instanceof DomainValidationError) {
      throw cause;
    }
    throw new ArchiveExportError(
      'packaging',
      'The case archive manifest could not be validated.',
      cause,
    );
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const archive: Zippable = {
      [ARCHIVE_MANIFEST_PATH]: [
        strToU8(JSON.stringify(manifest, null, 2)),
        { level: 6, mtime: exportedAt },
      ],
    };
    for (const entry of manifest.attachments) {
      const image = archiveFiles.get(entry.path);
      if (image === undefined) {
        throw new ArchiveExportError(
          'packaging',
          `Image attachment "${entry.id}" is missing from the archive contents.`,
        );
      }
      // Stored derivatives are already compressed; re-deflating them wastes
      // time and cannot shrink the archive meaningfully.
      archive[entry.path] = [image, { level: 0, mtime: exportedAt }];
    }
    bytes = zipSync(archive);
  } catch (cause) {
    if (cause instanceof ArchiveExportError) {
      throw cause;
    }
    throw new ArchiveExportError('packaging', 'The case archive could not be packaged.', cause);
  }

  return {
    bytes,
    blob: new Blob([bytes], { type: ARCHIVE_MIME_TYPE }),
    manifest,
    fileName: buildCaseArchiveFileName(caseRecord.title, exportedAt),
  };
}

/**
 * Minimal structural view of the File System Access API. Declaring it here
 * keeps the exporter testable without depending on browser-only lib types.
 */
export type ArchiveWritableStream = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
};

export type ArchiveFileHandle = {
  readonly name?: string;
  createWritable(): Promise<ArchiveWritableStream>;
};

export type ArchiveSaveFilePickerOptions = {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
};

export type ArchiveSaveFilePicker = (
  options: ArchiveSaveFilePickerOptions,
) => Promise<ArchiveFileHandle>;

export type ArchiveDownloader = (blob: Blob, fileName: string) => void;

export type ArchiveSaveMethod = 'file-system-access' | 'download';

export type SaveCaseArchiveOptions = {
  /** `null` forces the download fallback; omitted uses the browser API when present. */
  readonly showSaveFilePicker?: ArchiveSaveFilePicker | null | undefined;
  readonly download?: ArchiveDownloader | undefined;
};

export type SaveCaseArchiveResult = {
  readonly method: ArchiveSaveMethod;
  readonly fileName: string;
};

/** Raised when the user dismisses the native save dialog. */
export class ArchiveSaveCancelledError extends Error {
  constructor() {
    super('Saving the case archive was cancelled.');
    this.name = 'ArchiveSaveCancelledError';
  }
}

/** Raised when the selected save destination cannot be written. */
export class ArchiveSaveError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ArchiveSaveError';
    this.cause = cause;
  }
}

type SaveFilePickerGlobal = typeof globalThis & {
  showSaveFilePicker?: ArchiveSaveFilePicker;
};

function resolveShowSaveFilePicker(): ArchiveSaveFilePicker | null {
  const picker = (globalThis as SaveFilePickerGlobal).showSaveFilePicker;
  return typeof picker === 'function' ? picker.bind(globalThis) : null;
}

/**
 * The fallback save path: a same-document Blob URL plus a download attribute.
 * The object URL is revoked on the next task so the browser can start writing.
 */
export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const documentRef = globalThis.document;
  if (documentRef === undefined) {
    throw new ArchiveSaveError('This browser cannot download files.');
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    documentRef.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Save an already-built archive. File System Access is preferred when the
 * browser exposes it; otherwise the explicit Blob download fallback is used.
 * This function never chooses to run on its own — callers invoke it from a
 * user action.
 */
export async function saveCaseArchive(
  archive: CaseArchive,
  options: SaveCaseArchiveOptions = {},
): Promise<SaveCaseArchiveResult> {
  const picker =
    options.showSaveFilePicker === undefined
      ? resolveShowSaveFilePicker()
      : options.showSaveFilePicker;

  if (picker !== null && picker !== undefined) {
    let handle: ArchiveFileHandle;
    try {
      handle = await picker({
        suggestedName: archive.fileName,
        types: [
          {
            description: 'Notes Detective case archive',
            accept: { [ARCHIVE_MIME_TYPE]: [ARCHIVE_FILE_EXTENSION] },
          },
        ],
        excludeAcceptAllOption: false,
      });
    } catch (cause) {
      if (isAbortError(cause)) {
        throw new ArchiveSaveCancelledError();
      }
      throw new ArchiveSaveError('The save dialog could not be opened.', cause);
    }

    let writable: ArchiveWritableStream;
    try {
      writable = await handle.createWritable();
    } catch (cause) {
      throw new ArchiveSaveError('The archive file could not be opened for writing.', cause);
    }

    try {
      await writable.write(archive.bytes);
      await writable.close();
    } catch (cause) {
      if (writable.abort !== undefined) {
        try {
          await writable.abort(cause);
        } catch {
          // The original write failure is the actionable error.
        }
      }
      throw new ArchiveSaveError('The archive could not be written to the chosen file.', cause);
    }

    const savedName = handle.name?.trim();
    return {
      method: 'file-system-access',
      fileName: savedName !== undefined && savedName.length > 0 ? savedName : archive.fileName,
    };
  }

  const download = options.download ?? triggerBlobDownload;
  try {
    download(archive.blob, archive.fileName);
  } catch (cause) {
    if (cause instanceof ArchiveSaveError) {
      throw cause;
    }
    throw new ArchiveSaveError('The archive download could not be started.', cause);
  }

  return { method: 'download', fileName: archive.fileName };
}

export type ExportCaseInput = BuildCaseArchiveInput & SaveCaseArchiveOptions;

export type ExportCaseResult = {
  readonly archive: CaseArchive;
  readonly save: SaveCaseArchiveResult;
};

/**
 * Build and save exactly one case. This is the app-facing backup entry point;
 * it must be called from a user action and performs no network request.
 */
export async function exportCase(input: ExportCaseInput): Promise<ExportCaseResult> {
  const archive = await buildCaseArchive(input);
  const save = await saveCaseArchive(archive, input);
  return { archive, save };
}
