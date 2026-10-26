import { z } from 'zod';

/**
 * Canonical record shapes for the Notes Detective case graph.
 *
 * Every record is persisted as a plain JSON-safe object (attachments keep their
 * Blob in the attachment table). Dates are ISO 8601 strings, never Date objects.
 * Schemas are strict: unknown fields are rejected so a stale or hand-edited
 * IndexedDB row cannot smuggle unvalidated state into the app.
 */

export const CARD_TYPES = ['note', 'source', 'topic'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CONNECTION_TYPES = ['association', 'provenance'] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const ATTACHMENT_KINDS = ['original', 'display', 'thumbnail'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIME_TYPES)[number];

/**
 * The shelf-facing readiness projection. It is derived from the graph every
 * time a summary is read; it is never accepted as authoritative storage.
 */
export const CASE_READINESS_STATES = ['ready', 'loose'] as const;
export type CaseReadinessStatus = (typeof CASE_READINESS_STATES)[number];

export const TITLE_MIN_LENGTH = 1;
export const TITLE_MAX_LENGTH = 80;
export const SUBJECT_MAX_LENGTH = 80;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 24;
export const MIN_VIEWPORT_SCALE = 0.25;
export const MAX_VIEWPORT_SCALE = 2.5;
export const MAX_OCR_TEXT_LENGTH = 20_000;
export const MAX_OCR_ENGINE_VERSION_LENGTH = 40;

/**
 * The separator cannot occur inside a UUID, so a canonical pair key is
 * unambiguous and lexicographically stable.
 */
export const CONNECTION_PAIR_SEPARATOR = '::';

/**
 * Build the canonical unordered key for a card pair. The two IDs are sorted
 * before joining, so `A::B` and `B::A` always produce the same value.
 */
export function buildPairKey(cardIdA: string, cardIdB: string): string {
  const [first, second] = cardIdA <= cardIdB ? [cardIdA, cardIdB] : [cardIdB, cardIdA];
  return `${first}${CONNECTION_PAIR_SEPARATOR}${second}`;
}

export const uuidSchema = z.uuid();
export const isoTimestampSchema = z.iso.datetime({ offset: true });
export const isoDateSchema = z.iso.date();

export const titleSchema = z
  .string()
  .trim()
  .min(TITLE_MIN_LENGTH, `Title must be at least ${TITLE_MIN_LENGTH} character`)
  .max(TITLE_MAX_LENGTH, `Title must be at most ${TITLE_MAX_LENGTH} characters`);

export const subjectSchema = z
  .string()
  .trim()
  .min(1, 'Subject must not be empty when provided')
  .max(SUBJECT_MAX_LENGTH, `Subject must be at most ${SUBJECT_MAX_LENGTH} characters`);

export const tagSchema = z
  .string()
  .trim()
  .min(1, 'Tag must not be empty')
  .max(MAX_TAG_LENGTH, `Tag must be at most ${MAX_TAG_LENGTH} characters`);

function addDuplicateTagIssues(tags: readonly string[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();

  tags.forEach((tag, index) => {
    const normalized = tag.toLowerCase();
    if (seen.has(normalized)) {
      ctx.addIssue({
        code: 'custom',
        path: [index],
        message: `Duplicate tag "${tag}" (tags are case-insensitive)`,
      });
      return;
    }
    seen.add(normalized);
  });
}

export const tagsSchema = z
  .array(tagSchema)
  .max(MAX_TAGS, `A card may have at most ${MAX_TAGS} tags`)
  .superRefine(addDuplicateTagIssues);

export const positionSchema = z.strictObject({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
});

export const viewportSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z
    .number()
    .finite()
    .min(MIN_VIEWPORT_SCALE, `Viewport scale must be at least ${MIN_VIEWPORT_SCALE}`)
    .max(MAX_VIEWPORT_SCALE, `Viewport scale must be at most ${MAX_VIEWPORT_SCALE}`),
});

/**
 * A non-destructive crop, normalized to the oriented source image. Keeping the
 * rectangle independent of derivative sizes lets a later re-crop regenerate the
 * display and thumbnail copies from the retained original.
 */
export const cardCropSchema = z
  .strictObject({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1),
  })
  .superRefine((crop, ctx) => {
    if (crop.x + crop.width > 1 + 1e-6) {
      ctx.addIssue({
        code: 'custom',
        path: ['width'],
        message: 'Crop must stay inside the image width',
      });
    }
    if (crop.y + crop.height > 1 + 1e-6) {
      ctx.addIssue({
        code: 'custom',
        path: ['height'],
        message: 'Crop must stay inside the image height',
      });
    }
  });

/** Exact clockwise quarter-turns; no floating-point degrees are stored. */
export const cardRotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

const pairKeySchema = z
  .string()
  .regex(/^[0-9a-fA-F-]{36}::[0-9a-fA-F-]{36}$/, 'Pair key must join two UUID strings with "::"');

function addUpdatedAtIssues(
  value: { createdAt: string; updatedAt: string },
  ctx: z.RefinementCtx,
): void {
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'updatedAt must not be before createdAt',
    });
  }
}

export const caseRecordSchema = z
  .strictObject({
    id: uuidSchema,
    title: titleSchema,
    subject: subjectSchema.optional(),
    examDate: isoDateSchema.optional(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    viewport: viewportSchema,
    closedAt: isoTimestampSchema.nullable().default(null),
    isDemo: z.boolean().default(false),
    backupPromptedAt: isoTimestampSchema.nullable().default(null),
  })
  .superRefine(addUpdatedAtIssues);

export const cardRecordSchema = z
  .strictObject({
    id: uuidSchema,
    caseId: uuidSchema,
    type: z.enum(CARD_TYPES),
    title: titleSchema,
    position: positionSchema,
    tags: tagsSchema,
    // Photo cards may be re-cropped later, so the choice is part of the card
    // rather than a one-off import parameter. Cards without a photo omit them.
    crop: cardCropSchema.optional(),
    rotation: cardRotationSchema.optional(),
    retainFullResolution: z.boolean().optional(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    // OCR is optional metadata: a card that was never read has no OCR fields
    // and must still validate. The OCR feature owns producing these values.
    ocrText: z.string().min(1).max(MAX_OCR_TEXT_LENGTH).optional(),
    ocrConfidence: z.number().min(0).max(100).optional(),
    ocrEngineVersion: z.string().trim().min(1).max(MAX_OCR_ENGINE_VERSION_LENGTH).optional(),
    ocrUpdatedAt: isoTimestampSchema.optional(),
  })
  .superRefine(addUpdatedAtIssues);

function addConnectionIssues(
  value: {
    fromCardId: string;
    toCardId: string;
    pairKey: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.fromCardId === value.toCardId) {
    ctx.addIssue({
      code: 'custom',
      path: ['toCardId'],
      message: 'A connection cannot link a card to itself',
    });
  }

  const expectedPairKey = buildPairKey(value.fromCardId, value.toCardId);
  if (value.pairKey !== expectedPairKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['pairKey'],
      message: `pairKey must be the canonical unordered key "${expectedPairKey}"`,
    });
  }
}

export const connectionRecordSchema = z
  .strictObject({
    id: uuidSchema,
    caseId: uuidSchema,
    fromCardId: uuidSchema,
    toCardId: uuidSchema,
    pairKey: pairKeySchema,
    type: z.enum(CONNECTION_TYPES),
  })
  .superRefine(addConnectionIssues);

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hexadecimal characters');

function addAttachmentSizeIssues(value: { bytes: number; blob: Blob }, ctx: z.RefinementCtx): void {
  if (value.bytes !== value.blob.size) {
    ctx.addIssue({
      code: 'custom',
      path: ['bytes'],
      message: 'bytes must match the Blob byte size',
    });
  }
}

export const attachmentRecordSchema = z
  .strictObject({
    id: uuidSchema,
    cardId: uuidSchema,
    kind: z.enum(ATTACHMENT_KINDS),
    mime: z.enum(ATTACHMENT_MIME_TYPES),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
    blob: z.instanceof(Blob),
  })
  .superRefine(addAttachmentSizeIssues);

export const caseSummarySchema = z
  .strictObject({
    id: uuidSchema,
    title: titleSchema,
    subject: subjectSchema.optional(),
    examDate: isoDateSchema.optional(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    closedAt: isoTimestampSchema.nullable().default(null),
    isDemo: z.boolean().default(false),
    cardCount: z.number().int().nonnegative(),
    connectionCount: z.number().int().nonnegative(),
    /** Derived from the card graph for the shelf's closure badge. */
    readiness: z.enum(CASE_READINESS_STATES),
    looseThreadCount: z.number().int().nonnegative(),
  })
  .superRefine((summary, ctx) => {
    const expected = summary.looseThreadCount === 0 ? 'ready' : 'loose';
    if (summary.readiness !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['readiness'],
        message: `readiness must be "${expected}" for ${summary.looseThreadCount} loose threads`,
      });
    }
  });

export type CaseRecord = z.infer<typeof caseRecordSchema>;
export type CaseRecordInput = z.input<typeof caseRecordSchema>;
export type CardRecord = z.infer<typeof cardRecordSchema>;
export type CardRecordInput = z.input<typeof cardRecordSchema>;
export type ConnectionRecord = z.infer<typeof connectionRecordSchema>;
export type ConnectionRecordInput = z.input<typeof connectionRecordSchema>;
export type AttachmentRecord = z.infer<typeof attachmentRecordSchema>;
export type AttachmentRecordInput = z.input<typeof attachmentRecordSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type ViewportInput = z.input<typeof viewportSchema>;
export type CardPosition = z.infer<typeof positionSchema>;
export type CardCrop = z.infer<typeof cardCropSchema>;
export type CardRotation = z.infer<typeof cardRotationSchema>;
export type CaseSummary = z.infer<typeof caseSummarySchema>;
export type CaseSummaryInput = z.input<typeof caseSummarySchema>;

/** Initial board view when a case is first created. */
export const DEFAULT_VIEWPORT: Readonly<Viewport> = Object.freeze({
  x: 0,
  y: 0,
  scale: 1,
});
