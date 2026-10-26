import { z } from 'zod';

import {
  ATTACHMENT_KINDS,
  ATTACHMENT_MIME_TYPES,
  cardRecordSchema,
  caseRecordSchema,
  connectionRecordSchema,
  isoTimestampSchema,
  uuidSchema,
} from '../../domain/model';
import type {
  AttachmentKind,
  AttachmentMime,
  CardRecord,
  CaseRecord,
  ConnectionRecord,
} from '../../domain/model';
import {
  DomainValidationError,
  isProvenanceEligible,
  parseRecord,
  validateRecord,
} from '../../domain/validation';
import type { ValidationResult } from '../../domain/validation';

/**
 * The `.ndcase` archive contract.
 *
 * A case archive is a ZIP with exactly one `manifest.json` and one image entry
 * per attachment under `images/`. The manifest is self-describing so an import
 * can validate the whole archive before it writes a single row, and so a later
 * format version can be rejected instead of guessed at.
 *
 * Everything except the image Blobs lives in the manifest. Reusing the domain
 * schemas keeps tags, positions, viewport, closure, OCR, crop/rotation, the demo
 * marker, and `backupPromptedAt` identical to what IndexedDB stores.
 */

export const ARCHIVE_FORMAT = 'notes-detective-case' as const;
export const ARCHIVE_FORMAT_VERSION = 1 as const;
export const ARCHIVE_MANIFEST_PATH = 'manifest.json' as const;
export const ARCHIVE_IMAGES_DIRECTORY = 'images' as const;
export const ARCHIVE_FILE_EXTENSION = '.ndcase' as const;
export const ARCHIVE_MIME_TYPE = 'application/zip' as const;

/**
 * `appVersion` is written into the manifest for support and migration context.
 * The build does not import package.json at runtime, so the value is explicit.
 */
export const DEFAULT_APP_VERSION = '0.1.0';

/**
 * Generous ceilings that keep a hostile archive from exhausting memory before
 * the import stage applies its own 500-entry / 250 MB limits.
 */
export const MAX_ARCHIVE_CARDS = 500;
export const MAX_ARCHIVE_CONNECTIONS = 500;
export const MAX_ARCHIVE_ATTACHMENTS = 1_500;

export const MAX_ARCHIVE_SLUG_LENGTH = 60;

/**
 * OCR metadata travels inside each manifest card, next to the title and tags.
 * The list is explicit so an exporter or importer change cannot silently drop
 * a field, and so round-trip tests can assert every one of them.
 */
export const ARCHIVE_CARD_OCR_FIELDS = [
  'ocrText',
  'ocrConfidence',
  'ocrEngineVersion',
  'ocrUpdatedAt',
] as const;

export type ArchiveCardOcrField = (typeof ARCHIVE_CARD_OCR_FIELDS)[number];
export type ArchiveCardOcr = Partial<Pick<CardRecord, ArchiveCardOcrField>>;

const IMAGE_EXTENSIONS: Record<AttachmentMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** The extension used inside the archive for a stored MIME type. */
export function archiveImageExtension(mime: AttachmentMime): string {
  return IMAGE_EXTENSIONS[mime];
}

/**
 * Derive the only legal entry name for an attachment. It is relative, uses a
 * single `images/` directory, and is derived from IDs and the MIME type rather
 * than from a title, so user text can never become a path.
 */
export function buildArchiveImagePath(attachmentId: string, mime: AttachmentMime): string {
  if (!uuidSchema.safeParse(attachmentId).success) {
    throw new DomainValidationError('Invalid archive image path: attachment id must be a UUID');
  }
  return `${ARCHIVE_IMAGES_DIRECTORY}/${attachmentId}.${archiveImageExtension(mime)}`;
}

const archiveImagePathSchema = z
  .string()
  .regex(
    /^images\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(?:png|jpg|jpeg|webp)$/,
    'Image path must be a relative images/<attachment-id>.<ext> path',
  );

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hexadecimal characters');

/**
 * One image entry: the stored attachment metadata plus the relative ZIP path.
 * The Blob itself is not in the manifest; its bytes are the entry at `path`.
 */
export const archiveAttachmentSchema = z
  .strictObject({
    id: uuidSchema,
    cardId: uuidSchema,
    kind: z.enum(ATTACHMENT_KINDS),
    mime: z.enum(ATTACHMENT_MIME_TYPES),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
    path: archiveImagePathSchema,
  })
  .superRefine((attachment, ctx) => {
    const expected = buildArchiveImagePath(attachment.id, attachment.mime);
    if (attachment.path !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: `Image path must match the attachment id and MIME type ("${expected}")`,
      });
    }
  });

export type ArchiveAttachment = z.infer<typeof archiveAttachmentSchema>;

type ManifestRefinementInput = {
  readonly case: CaseRecord;
  readonly cards: readonly CardRecord[];
  readonly connections: readonly ConnectionRecord[];
  readonly attachments: readonly ArchiveAttachment[];
};

function addManifestIssues(value: ManifestRefinementInput, ctx: z.RefinementCtx): void {
  const cardIds = new Set<string>();
  const connectionPairKeys = new Set<string>();
  const connectionIds = new Set<string>();
  const attachmentIds = new Set<string>();
  const attachmentPaths = new Set<string>();
  const attachmentKinds = new Set<string>();

  value.cards.forEach((card, index) => {
    if (cardIds.has(card.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['cards', index, 'id'],
        message: 'Archive contains duplicate card ids',
      });
    }
    cardIds.add(card.id);

    if (card.caseId !== value.case.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['cards', index, 'caseId'],
        message: 'Every card must belong to the archived case',
      });
    }
  });

  const cardsById = new Map(value.cards.map((card) => [card.id, card] as const));

  value.connections.forEach((connection, index) => {
    if (connectionIds.has(connection.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['connections', index, 'id'],
        message: 'Archive contains duplicate connection ids',
      });
    }
    connectionIds.add(connection.id);

    if (connection.caseId !== value.case.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['connections', index, 'caseId'],
        message: 'Every connection must belong to the archived case',
      });
    }

    if (connectionPairKeys.has(connection.pairKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['connections', index, 'pairKey'],
        message: 'Archive contains more than one connection for the same card pair',
      });
    }
    connectionPairKeys.add(connection.pairKey);

    const fromCard = cardsById.get(connection.fromCardId);
    const toCard = cardsById.get(connection.toCardId);

    if (fromCard === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['connections', index, 'fromCardId'],
        message: 'Connection endpoint is missing from the archive cards',
      });
    }
    if (toCard === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['connections', index, 'toCardId'],
        message: 'Connection endpoint is missing from the archive cards',
      });
    }

    if (
      fromCard !== undefined &&
      toCard !== undefined &&
      connection.type === 'provenance' &&
      !isProvenanceEligible(fromCard.type, toCard.type)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['connections', index, 'type'],
        message: 'Provenance is legal only between one Study Note and one Source',
      });
    }
  });

  value.attachments.forEach((attachment, index) => {
    if (attachmentIds.has(attachment.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attachments', index, 'id'],
        message: 'Archive contains duplicate attachment ids',
      });
    }
    attachmentIds.add(attachment.id);

    if (attachmentPaths.has(attachment.path)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attachments', index, 'path'],
        message: 'Archive contains duplicate image paths',
      });
    }
    attachmentPaths.add(attachment.path);

    if (!cardIds.has(attachment.cardId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attachments', index, 'cardId'],
        message: 'Attachment must reference a card in the archive',
      });
    }

    const kindKey = `${attachment.cardId}::${attachment.kind}`;
    if (attachmentKinds.has(kindKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attachments', index, 'kind'],
        message: 'A card may archive only one attachment of each kind',
      });
    }
    attachmentKinds.add(kindKey);
  });
}

/**
 * The versioned archive manifest. The format literal and version make an
 * unsupported archive fail at validation instead of at write time.
 */
export const caseArchiveManifestSchema = z
  .strictObject({
    format: z.literal(ARCHIVE_FORMAT),
    formatVersion: z.literal(ARCHIVE_FORMAT_VERSION),
    exportedAt: isoTimestampSchema,
    appVersion: z.string().trim().min(1).max(40),
    dbSchemaVersion: z.number().int().positive(),
    case: caseRecordSchema,
    cards: z.array(cardRecordSchema).max(MAX_ARCHIVE_CARDS),
    connections: z.array(connectionRecordSchema).max(MAX_ARCHIVE_CONNECTIONS),
    attachments: z.array(archiveAttachmentSchema).max(MAX_ARCHIVE_ATTACHMENTS),
  })
  .superRefine(addManifestIssues);

export type CaseArchiveManifest = z.infer<typeof caseArchiveManifestSchema>;

/** Validate an unknown manifest-shaped object (typically parsed ZIP JSON). */
export function validateCaseArchiveManifest(input: unknown): ValidationResult<CaseArchiveManifest> {
  return validateRecord(caseArchiveManifestSchema, input, 'CaseArchiveManifest');
}

/** Parse and validate an unknown manifest, throwing a typed domain error. */
export function parseCaseArchiveManifest(input: unknown): CaseArchiveManifest {
  return parseRecord(caseArchiveManifestSchema, input, 'CaseArchiveManifest');
}

/**
 * Read only the OCR fields a card actually has. Missing metadata stays absent
 * rather than becoming `undefined` keys or empty strings.
 */
export function readArchiveCardOcr(card: CardRecord): ArchiveCardOcr {
  const ocr: ArchiveCardOcr = {};
  if (card.ocrText !== undefined) {
    ocr.ocrText = card.ocrText;
  }
  if (card.ocrConfidence !== undefined) {
    ocr.ocrConfidence = card.ocrConfidence;
  }
  if (card.ocrEngineVersion !== undefined) {
    ocr.ocrEngineVersion = card.ocrEngineVersion;
  }
  if (card.ocrUpdatedAt !== undefined) {
    ocr.ocrUpdatedAt = card.ocrUpdatedAt;
  }
  return ocr;
}

/** True when both cards carry exactly the same OCR text and metadata. */
export function archiveCardOcrEquals(expected: CardRecord, actual: CardRecord): boolean {
  return ARCHIVE_CARD_OCR_FIELDS.every((field) => Object.is(expected[field], actual[field]));
}

/**
 * Fail before packaging or writing when a card's OCR metadata changed between
 * storage and the archive record. The message names the field, never its value.
 */
export function assertArchiveCardOcrPreserved(expected: CardRecord, actual: CardRecord): void {
  const field = ARCHIVE_CARD_OCR_FIELDS.find(
    (candidate) => !Object.is(expected[candidate], actual[candidate]),
  );
  if (field !== undefined) {
    throw new DomainValidationError(`The case archive did not preserve the card ${field} value`);
  }
}

export type ArchiveAttachmentMetadataInput = {
  readonly id: string;
  readonly cardId: string;
  readonly kind: AttachmentKind;
  readonly mime: AttachmentMime;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
};

/** Build the manifest entry for one attachment, deriving its safe path. */
export function createArchiveAttachmentMetadata(
  input: ArchiveAttachmentMetadataInput,
): ArchiveAttachment {
  return parseRecord(
    archiveAttachmentSchema,
    {
      ...input,
      path: buildArchiveImagePath(input.id, input.mime),
    },
    'archive attachment',
  );
}

const ATTACHMENT_KIND_ORDER = new Map(
  ATTACHMENT_KINDS.map((kind, index) => [kind, index] as const),
);

function compareCards(a: CardRecord, b: CardRecord): number {
  const byCreatedAt = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return byCreatedAt !== 0 ? byCreatedAt : a.id.localeCompare(b.id);
}

function compareConnections(a: ConnectionRecord, b: ConnectionRecord): number {
  const byPairKey = a.pairKey.localeCompare(b.pairKey);
  return byPairKey !== 0 ? byPairKey : a.id.localeCompare(b.id);
}

function compareAttachments(a: ArchiveAttachment, b: ArchiveAttachment): number {
  const byCard = a.cardId.localeCompare(b.cardId);
  if (byCard !== 0) {
    return byCard;
  }
  const byKind =
    (ATTACHMENT_KIND_ORDER.get(a.kind) ?? 0) - (ATTACHMENT_KIND_ORDER.get(b.kind) ?? 0);
  return byKind !== 0 ? byKind : a.id.localeCompare(b.id);
}

export type BuildCaseArchiveManifestInput = {
  readonly caseRecord: CaseRecord;
  readonly cards: readonly CardRecord[];
  readonly connections: readonly ConnectionRecord[];
  readonly attachments: readonly ArchiveAttachment[];
  readonly exportedAt: string;
  readonly appVersion?: string;
  readonly dbSchemaVersion: number;
};

/**
 * Assemble and validate a manifest. Arrays are sorted so the same case exports
 * the same logical manifest even when repository read order changes.
 */
export function buildCaseArchiveManifest(
  input: BuildCaseArchiveManifestInput,
): CaseArchiveManifest {
  const manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    exportedAt: input.exportedAt,
    appVersion: input.appVersion ?? DEFAULT_APP_VERSION,
    dbSchemaVersion: input.dbSchemaVersion,
    case: input.caseRecord,
    cards: [...input.cards].sort(compareCards),
    connections: [...input.connections].sort(compareConnections),
    attachments: [...input.attachments].sort(compareAttachments),
  };

  return parseCaseArchiveManifest(manifest);
}

/**
 * Lowercase, ASCII-only, hyphenated slug. Non-Latin titles fall back to
 * `case` because inventing a transliteration is worse than a safe name.
 */
export function slugifyCaseTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ARCHIVE_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return slug.length > 0 ? slug : 'case';
}

/** UTC calendar date (`yyyy-mm-dd`) derived from the manifest `exportedAt`. */
export function archiveDateStamp(exportedAt: string): string {
  const parsed = parseRecord(isoTimestampSchema, exportedAt, 'exportedAt');
  return new Date(parsed).toISOString().slice(0, 10);
}

/** `<case-slug>-<yyyy-mm-dd>.ndcase` */
export function buildCaseArchiveFileName(title: string, exportedAt: string): string {
  return `${slugifyCaseTitle(title)}-${archiveDateStamp(exportedAt)}${ARCHIVE_FILE_EXTENSION}`;
}
