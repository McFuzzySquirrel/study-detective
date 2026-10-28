import { strFromU8, unzipSync } from 'fflate';

import { DATABASE_VERSION } from '../../data/db';
import { DomainValidationError } from '../../domain/validation';
import { sha256Hex } from '../capture/imagePipeline';

import {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_IMAGES_DIRECTORY,
  ARCHIVE_MANIFEST_PATH,
  parseCaseArchiveManifest,
} from './archiveFormat';
import type { CaseArchiveManifest } from './archiveFormat';

/**
 * Import validation for a `.ndcase` archive.
 *
 * An archive is untrusted input. This module inspects the ZIP central directory
 * before decompressing anything, rejects unsafe or duplicate names, enforces
 * entry and size ceilings, validates the manifest, and only then checks every
 * image checksum. `importCase.ts` calls this before opening a write
 * transaction, so a rejected archive never reaches IndexedDB.
 */

/**
 * Ceilings from BACKUP-FR-02. They are binary megabytes: 250 MiB total, 50 MiB
 * per entry, and 500 entries counting `manifest.json`.
 */
export const MAX_IMPORT_ENTRIES = 500;
export const MAX_IMPORT_TOTAL_BYTES = 250 * 1024 * 1024;
export const MAX_IMPORT_ENTRY_BYTES = 50 * 1024 * 1024;

/** ZIP signatures, read little-endian from the central and local headers. */
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;
const EOCD_MIN_LENGTH = 22;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;

/**
 * Image entries are named only from the attachment UUID and MIME type by the
 * exporter. Restricting import to the same shape rejects traversal, absolute
 * roots, drive letters, backslashes, and names outside `images/` in one place.
 */
const ARCHIVE_IMAGE_PATH_PATTERN =
  /^images\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(?:png|jpg|jpeg|webp|gif)$/;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Where validation stopped, so the UI can name an actionable stage. */
export type ArchiveImportStage = 'reading' | 'structure' | 'integrity' | 'writing';

/**
 * Stable machine-readable failure codes. Tests assert these instead of brittle
 * message text, and the backup dialog can map them to specific guidance.
 */
export type ArchiveImportFailure =
  | 'unreadable-archive'
  | 'invalid-zip'
  | 'too-many-entries'
  | 'archive-too-large'
  | 'entry-too-large'
  | 'duplicate-entry'
  | 'unsafe-path'
  | 'unexpected-entry'
  | 'missing-manifest'
  | 'invalid-manifest'
  | 'unsupported-format'
  | 'unsupported-version'
  | 'missing-image'
  | 'checksum-mismatch'
  | 'size-mismatch'
  | 'replace-not-confirmed'
  | 'replace-target-missing'
  | 'id-allocation-failed'
  | 'write-failed';

/**
 * Typed import failure. Messages deliberately contain no titles, tags, OCR
 * text, or image bytes; a failed import must not leak user content into logs.
 */
export class ArchiveImportError extends Error {
  readonly stage: ArchiveImportStage;
  readonly failure: ArchiveImportFailure;
  readonly cause: unknown;

  constructor(
    stage: ArchiveImportStage,
    failure: ArchiveImportFailure,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'ArchiveImportError';
    this.stage = stage;
    this.failure = failure;
    this.cause = cause;
  }
}

export type CaseArchiveInput = Uint8Array | ArrayBuffer | Blob;

export type ValidateCaseArchiveOptions = {
  /** Injected for deterministic checksum tests. */
  readonly digest?: (blob: Blob) => Promise<string>;
  /**
   * Database schema versions this build can restore. Defaults to the open
   * database version; a newer or older archive is rejected rather than guessed
   * at until a migration exists.
   */
  readonly supportedDbSchemaVersions?: readonly number[];
};

export type ValidatedCaseArchive = {
  readonly manifest: CaseArchiveManifest;
  /** Attachment id -> verified Blob. Every manifest attachment has one. */
  readonly images: ReadonlyMap<string, Blob>;
  /** Number of ZIP entries, including `manifest.json`. */
  readonly entryCount: number;
  /** Sum of the central directory's uncompressed sizes. */
  readonly uncompressedBytes: number;
};

export type CaseArchiveSummary = {
  readonly caseId: string;
  readonly title: string;
  readonly subject?: string;
  readonly examDate?: string;
  readonly exportedAt: string;
  readonly appVersion: string;
  /** Cards that own at least one image, matching the deletion-preview count. */
  readonly imageCount: number;
  readonly cardCount: number;
  readonly connectionCount: number;
  readonly attachmentCount: number;
  readonly imageBytes: number;
};

export type CaseArchiveInspection = {
  readonly archive: ValidatedCaseArchive;
  readonly summary: CaseArchiveSummary;
};

type ZipDirectoryEntry = {
  readonly name: string;
  readonly flags: number;
  readonly compression: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
};

function invalidZip(message: string, cause?: unknown): ArchiveImportError {
  return new ArchiveImportError('structure', 'invalid-zip', message, cause);
}

function decodeEntryName(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw invalidZip('The archive contains a file name that is not valid UTF-8.', cause);
  }
}

/**
 * Read an archive input into a private byte array. Copying also detaches the
 * result from any caller-owned buffer that could mutate during verification.
 */
export async function readCaseArchiveBytes(
  input: CaseArchiveInput,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    if (input instanceof Uint8Array) {
      return new Uint8Array(input);
    }
    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input.slice(0));
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      return new Uint8Array(await input.arrayBuffer());
    }
  } catch (cause) {
    throw new ArchiveImportError(
      'reading',
      'unreadable-archive',
      'The archive file could not be read.',
      cause,
    );
  }

  throw new ArchiveImportError(
    'reading',
    'unreadable-archive',
    'The selected file is not a readable archive.',
  );
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView): number {
  if (view.byteLength < EOCD_MIN_LENGTH) {
    throw invalidZip('The file is too small to be a ZIP archive.');
  }

  const earliest = Math.max(0, view.byteLength - EOCD_MIN_LENGTH - MAX_ZIP_COMMENT_LENGTH);
  for (let offset = view.byteLength - EOCD_MIN_LENGTH; offset >= earliest; offset -= 1) {
    if (readU32(view, offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    const commentLength = readU16(view, offset + 20);
    // Reject trailing bytes after the declared comment. A backup produced by
    // this app never has any, and accepting them hides ambiguous structure.
    if (offset + EOCD_MIN_LENGTH + commentLength === view.byteLength) {
      return offset;
    }
  }

  throw invalidZip('The file is not a ZIP archive.');
}

/**
 * Walk the ZIP central directory without decompressing entry data. The walk
 * enforces the entry count, duplicate names, encryption, ZIP64, and both size
 * ceilings before an attacker-controlled deflate stream can allocate memory.
 */
function parseZipDirectory(bytes: Uint8Array): ZipDirectoryEntry[] {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(view);

    const diskNumber = readU16(view, eocdOffset + 4);
    const centralDirectoryDisk = readU16(view, eocdOffset + 6);
    const entriesOnThisDisk = readU16(view, eocdOffset + 8);
    const totalEntries = readU16(view, eocdOffset + 10);
    const centralDirectorySize = readU32(view, eocdOffset + 12);
    const centralDirectoryOffset = readU32(view, eocdOffset + 16);

    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnThisDisk !== totalEntries) {
      throw invalidZip('Multi-disk ZIP archives are not supported.');
    }
    if (
      totalEntries === 0xffff ||
      centralDirectorySize === ZIP64_SENTINEL ||
      centralDirectoryOffset === ZIP64_SENTINEL
    ) {
      throw invalidZip('ZIP64 archives are not supported.');
    }
    if (totalEntries > MAX_IMPORT_ENTRIES) {
      throw new ArchiveImportError(
        'structure',
        'too-many-entries',
        `The archive contains more than ${MAX_IMPORT_ENTRIES} entries.`,
      );
    }
    if (totalEntries === 0) {
      throw new ArchiveImportError(
        'structure',
        'missing-manifest',
        'The archive does not contain a manifest.',
      );
    }
    if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
      throw invalidZip('The archive central directory is out of bounds.');
    }

    const entries: ZipDirectoryEntry[] = [];
    const names = new Set<string>();
    let totalCompressedBytes = 0;
    let totalUncompressedBytes = 0;
    let cursor = centralDirectoryOffset;

    for (let index = 0; index < totalEntries; index += 1) {
      if (cursor + 46 > centralDirectoryOffset + centralDirectorySize) {
        throw invalidZip('The archive central directory is truncated.');
      }
      if (readU32(view, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw invalidZip('The archive central directory is malformed.');
      }

      const flags = readU16(view, cursor + 8);
      const compression = readU16(view, cursor + 10);
      const compressedSize = readU32(view, cursor + 20);
      const uncompressedSize = readU32(view, cursor + 24);
      const nameLength = readU16(view, cursor + 28);
      const extraLength = readU16(view, cursor + 30);
      const commentLength = readU16(view, cursor + 32);
      const diskStart = readU16(view, cursor + 34);
      const localHeaderOffset = readU32(view, cursor + 42);

      if (nameLength === 0) {
        throw invalidZip('The archive contains an entry with no name.');
      }
      if ((flags & 0x1) !== 0) {
        throw invalidZip('Encrypted ZIP entries are not supported.');
      }
      if (diskStart !== 0) {
        throw invalidZip('Multi-disk ZIP entries are not supported.');
      }
      if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
        throw invalidZip('ZIP64 entries are not supported.');
      }
      if (localHeaderOffset === ZIP64_SENTINEL) {
        throw invalidZip('ZIP64 entries are not supported.');
      }
      if (compression !== 0 && compression !== 8) {
        throw invalidZip('The archive uses an unsupported compression method.');
      }

      const nameStart = cursor + 46;
      const nameEnd = nameStart + nameLength;
      const next = nameEnd + extraLength + commentLength;
      if (next > centralDirectoryOffset + centralDirectorySize) {
        throw invalidZip('The archive central directory is truncated.');
      }

      const name = decodeEntryName(bytes.subarray(nameStart, nameEnd));
      if (names.has(name)) {
        throw new ArchiveImportError(
          'structure',
          'duplicate-entry',
          'The archive contains the same entry name more than once.',
        );
      }
      names.add(name);

      // Cross-check the local header against the central directory. Some
      // archive readers trust one or the other; validating both prevents a
      // hostile archive from presenting different names to different readers.
      if (localHeaderOffset + 30 > centralDirectoryOffset) {
        throw invalidZip('An archive entry has an invalid local header offset.');
      }
      if (readU32(view, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
        throw invalidZip('An archive entry has an invalid local header.');
      }
      const localFlags = readU16(view, localHeaderOffset + 6);
      const localCompression = readU16(view, localHeaderOffset + 8);
      const localNameLength = readU16(view, localHeaderOffset + 26);
      const localExtraLength = readU16(view, localHeaderOffset + 28);
      if (localFlags !== flags || localCompression !== compression) {
        throw invalidZip('An archive entry header does not match its directory record.');
      }
      if (localNameLength !== nameLength) {
        throw invalidZip('An archive entry name does not match its directory record.');
      }
      const localNameStart = localHeaderOffset + 30;
      const localNameEnd = localNameStart + localNameLength;
      if (localNameEnd > centralDirectoryOffset) {
        throw invalidZip('An archive entry header is out of bounds.');
      }
      for (let nameIndex = 0; nameIndex < nameLength; nameIndex += 1) {
        if (bytes[localNameStart + nameIndex] !== bytes[nameStart + nameIndex]) {
          throw invalidZip('An archive entry name does not match its directory record.');
        }
      }
      const dataStart = localNameEnd + localExtraLength;
      if (dataStart + compressedSize > centralDirectoryOffset) {
        throw invalidZip('An archive entry overlaps the central directory.');
      }

      if (uncompressedSize > MAX_IMPORT_ENTRY_BYTES || compressedSize > MAX_IMPORT_ENTRY_BYTES) {
        throw new ArchiveImportError(
          'structure',
          'entry-too-large',
          'An archive entry exceeds the per-entry size limit.',
        );
      }

      totalCompressedBytes += compressedSize;
      totalUncompressedBytes += uncompressedSize;
      if (
        totalCompressedBytes > MAX_IMPORT_TOTAL_BYTES ||
        totalUncompressedBytes > MAX_IMPORT_TOTAL_BYTES
      ) {
        throw new ArchiveImportError(
          'structure',
          'archive-too-large',
          'The archive exceeds the total size limit.',
        );
      }

      entries.push({
        name,
        flags,
        compression,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
      cursor = next;
    }

    if (cursor !== centralDirectoryOffset + centralDirectorySize) {
      throw invalidZip('The archive central directory has an unexpected length.');
    }

    return entries;
  } catch (cause) {
    if (cause instanceof ArchiveImportError) {
      throw cause;
    }
    throw invalidZip('The archive is not a readable ZIP file.', cause);
  }
}

/**
 * BACKUP-CON-03: only `manifest.json` and `images/<uuid>.<ext>` are legal.
 * Testing the segments separately makes traversal and absolute roots explicit
 * even though the final pattern would also reject them.
 */
function assertSafeEntryPath(name: string): void {
  const hasParentSegment = name.split('/').some((segment) => segment === '..');
  if (
    hasParentSegment ||
    name.startsWith('/') ||
    name.startsWith('\\') ||
    name.includes('\\') ||
    /^[A-Za-z]:/.test(name) ||
    name.includes('\u0000')
  ) {
    throw new ArchiveImportError(
      'structure',
      'unsafe-path',
      'The archive contains an unsafe file path.',
    );
  }

  if (name === ARCHIVE_MANIFEST_PATH) {
    return;
  }

  if (!name.startsWith(`${ARCHIVE_IMAGES_DIRECTORY}/`)) {
    throw new ArchiveImportError(
      'structure',
      'unsafe-path',
      'The archive contains an entry outside manifest.json and images/.',
    );
  }

  if (!ARCHIVE_IMAGE_PATH_PATTERN.test(name)) {
    throw new ArchiveImportError(
      'structure',
      'unsafe-path',
      'The archive contains an unsafe image path.',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSupportedVersions(
  manifest: unknown,
  supportedDbSchemaVersions: readonly number[],
): void {
  if (!isRecord(manifest)) {
    throw new ArchiveImportError(
      'structure',
      'invalid-manifest',
      'The archive manifest is not a JSON object.',
    );
  }

  if (manifest.format !== ARCHIVE_FORMAT) {
    if (typeof manifest.format !== 'string') {
      throw new ArchiveImportError(
        'structure',
        'invalid-manifest',
        'The archive manifest does not declare a format.',
      );
    }
    throw new ArchiveImportError(
      'structure',
      'unsupported-format',
      'This file is not a Notes Detective case archive.',
    );
  }

  if (manifest.formatVersion !== ARCHIVE_FORMAT_VERSION) {
    if (typeof manifest.formatVersion !== 'number') {
      throw new ArchiveImportError(
        'structure',
        'invalid-manifest',
        'The archive manifest does not declare a format version.',
      );
    }
    throw new ArchiveImportError(
      'structure',
      'unsupported-version',
      'This archive format version is not supported.',
    );
  }

  if (
    typeof manifest.dbSchemaVersion !== 'number' ||
    !Number.isInteger(manifest.dbSchemaVersion) ||
    manifest.dbSchemaVersion < 1
  ) {
    throw new ArchiveImportError(
      'structure',
      'invalid-manifest',
      'The archive manifest does not declare a database schema version.',
    );
  }

  if (!supportedDbSchemaVersions.includes(manifest.dbSchemaVersion)) {
    throw new ArchiveImportError(
      'structure',
      'unsupported-version',
      'This archive was written by an unsupported database schema version.',
    );
  }
}

function readManifest(
  bytes: Uint8Array,
  supportedDbSchemaVersions: readonly number[],
): CaseArchiveManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(bytes));
  } catch (cause) {
    throw new ArchiveImportError(
      'structure',
      'invalid-manifest',
      'The archive manifest is not valid JSON.',
      cause,
    );
  }

  assertSupportedVersions(raw, supportedDbSchemaVersions);

  try {
    return parseCaseArchiveManifest(raw);
  } catch (cause) {
    if (cause instanceof DomainValidationError) {
      throw new ArchiveImportError(
        'structure',
        'invalid-manifest',
        'The archive manifest failed schema validation.',
        cause,
      );
    }
    throw new ArchiveImportError(
      'structure',
      'invalid-manifest',
      'The archive manifest could not be validated.',
      cause,
    );
  }
}

function unzipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch (cause) {
    throw invalidZip('The archive contents could not be decompressed.', cause);
  }

  return new Map(Object.entries(unzipped));
}

function assertUnzippedMatchesDirectory(
  directory: readonly ZipDirectoryEntry[],
  files: ReadonlyMap<string, Uint8Array>,
): void {
  if (files.size !== directory.length) {
    throw invalidZip('The archive contents do not match its directory.');
  }

  for (const entry of directory) {
    const data = files.get(entry.name);
    if (data === undefined) {
      throw invalidZip('The archive contents do not match its directory.');
    }
    if (data.byteLength !== entry.uncompressedSize) {
      throw new ArchiveImportError(
        'structure',
        'size-mismatch',
        'An archive entry does not match its declared size.',
      );
    }
  }
}

async function assertImagesMatchManifest(
  manifest: CaseArchiveManifest,
  files: ReadonlyMap<string, Uint8Array>,
  digest: (blob: Blob) => Promise<string>,
): Promise<ReadonlyMap<string, Blob>> {
  const expectedPaths = new Set(manifest.attachments.map((attachment) => attachment.path));

  for (const name of files.keys()) {
    if (name === ARCHIVE_MANIFEST_PATH) {
      continue;
    }
    if (!expectedPaths.has(name)) {
      throw new ArchiveImportError(
        'structure',
        'unexpected-entry',
        'The archive contains an image that the manifest does not reference.',
      );
    }
  }

  const images = new Map<string, Blob>();

  for (const attachment of manifest.attachments) {
    const data = files.get(attachment.path);
    if (data === undefined) {
      throw new ArchiveImportError(
        'integrity',
        'missing-image',
        'The archive is missing an image that the manifest references.',
      );
    }
    if (data.byteLength !== attachment.bytes) {
      throw new ArchiveImportError(
        'integrity',
        'size-mismatch',
        'An archived image does not match its manifest byte size.',
      );
    }

    const blob = new Blob([new Uint8Array(data)], { type: attachment.mime });
    let actualDigest: string;
    try {
      actualDigest = await digest(blob);
    } catch (cause) {
      throw new ArchiveImportError(
        'integrity',
        'checksum-mismatch',
        'An archived image could not be verified.',
        cause,
      );
    }

    if (!SHA256_PATTERN.test(actualDigest) || actualDigest !== attachment.sha256) {
      throw new ArchiveImportError(
        'integrity',
        'checksum-mismatch',
        'An archived image failed checksum verification.',
      );
    }

    images.set(attachment.id, blob);
  }

  return images;
}

/**
 * Validate a complete `.ndcase` archive without writing anything.
 *
 * Order matters for security and for useful errors: ZIP structure and path
 * safety first (no decompression), then the manifest and version, then image
 * presence, then byte sizes and SHA-256. A caller may show `summary` and only
 * later call `importCase`.
 */
export async function validateCaseArchive(
  input: CaseArchiveInput,
  options: ValidateCaseArchiveOptions = {},
): Promise<ValidatedCaseArchive> {
  const supportedDbSchemaVersions = options.supportedDbSchemaVersions ?? [DATABASE_VERSION];
  const digest = options.digest ?? sha256Hex;

  const bytes = await readCaseArchiveBytes(input);
  const directory = parseZipDirectory(bytes);

  for (const entry of directory) {
    assertSafeEntryPath(entry.name);
  }

  if (!directory.some((entry) => entry.name === ARCHIVE_MANIFEST_PATH)) {
    throw new ArchiveImportError(
      'structure',
      'missing-manifest',
      'The archive does not contain a manifest.',
    );
  }

  const files = unzipEntries(bytes);
  assertUnzippedMatchesDirectory(directory, files);

  const manifestBytes = files.get(ARCHIVE_MANIFEST_PATH);
  if (manifestBytes === undefined) {
    throw new ArchiveImportError(
      'structure',
      'missing-manifest',
      'The archive does not contain a manifest.',
    );
  }
  const manifest = readManifest(manifestBytes, supportedDbSchemaVersions);

  const images = await assertImagesMatchManifest(manifest, files, digest);
  const uncompressedBytes = directory.reduce((sum, entry) => sum + entry.uncompressedSize, 0);

  return {
    manifest,
    images,
    entryCount: directory.length,
    uncompressedBytes,
  };
}

/** Build the shelf/dialog summary from an already validated archive. */
export function summarizeValidatedArchive(archive: ValidatedCaseArchive): CaseArchiveSummary {
  const { manifest } = archive;
  const imageCardIds = new Set(manifest.attachments.map((attachment) => attachment.cardId));
  const imageBytes = manifest.attachments.reduce((sum, attachment) => sum + attachment.bytes, 0);

  return {
    caseId: manifest.case.id,
    title: manifest.case.title,
    ...(manifest.case.subject !== undefined ? { subject: manifest.case.subject } : {}),
    ...(manifest.case.examDate !== undefined ? { examDate: manifest.case.examDate } : {}),
    exportedAt: manifest.exportedAt,
    appVersion: manifest.appVersion,
    imageCount: imageCardIds.size,
    cardCount: manifest.cards.length,
    connectionCount: manifest.connections.length,
    attachmentCount: manifest.attachments.length,
    imageBytes,
  };
}

/** Validate once and return both the verified archive and its UI summary. */
export async function inspectCaseArchive(
  input: CaseArchiveInput,
  options: ValidateCaseArchiveOptions = {},
): Promise<CaseArchiveInspection> {
  const archive = await validateCaseArchive(input, options);
  return { archive, summary: summarizeValidatedArchive(archive) };
}
