import { describe, expect, it } from 'vitest';

import {
  CONNECTION_PAIR_SEPARATOR,
  attachmentRecordSchema,
  buildPairKey,
  cardRecordSchema,
  caseRecordSchema,
  caseSummarySchema,
  connectionRecordSchema,
  viewportSchema,
} from '../../src/domain/model';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '66666666-6666-4666-8666-666666666666';
const ATTACHMENT_ID = '77777777-7777-4777-8777-777777777777';

const CREATED_AT = '2026-01-02T03:04:05.000Z';
const UPDATED_AT = '2026-01-02T04:05:06.000Z';
const SHA_256 = 'a'.repeat(64);

const validCase = {
  id: CASE_ID,
  title: 'Cell Biology Final',
  subject: 'Biology',
  examDate: '2026-06-15',
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  viewport: { x: -120, y: 48, scale: 1.25 },
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const validCard = {
  id: NOTE_ID,
  caseId: CASE_ID,
  type: 'note',
  title: 'Mitochondria notes',
  position: { x: 120, y: 240 },
  tags: ['Biology', 'Energy'],
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const validConnection = {
  id: CONNECTION_ID,
  caseId: CASE_ID,
  fromCardId: NOTE_ID,
  toCardId: SOURCE_ID,
  pairKey: buildPairKey(NOTE_ID, SOURCE_ID),
  type: 'association',
};

const validAttachment = {
  id: ATTACHMENT_ID,
  cardId: NOTE_ID,
  kind: 'original',
  mime: 'image/png',
  width: 1200,
  height: 800,
  bytes: 3,
  sha256: SHA_256,
  blob: new Blob(['abc'], { type: 'image/png' }),
};

const validSummary = {
  id: CASE_ID,
  title: 'Cell Biology Final',
  subject: 'Biology',
  examDate: '2026-06-15',
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  closedAt: null,
  isDemo: false,
  cardCount: 4,
  connectionCount: 5,
};

describe('CaseRecord schema', () => {
  it('accepts a complete case and preserves ISO timestamps as strings', () => {
    const parsed = caseRecordSchema.parse(validCase);

    expect(parsed.id).toBe(CASE_ID);
    expect(parsed.title).toBe('Cell Biology Final');
    expect(parsed.examDate).toBe('2026-06-15');
    expect(parsed.createdAt).toBe(CREATED_AT);
    expect(parsed.updatedAt).toBe(UPDATED_AT);
    expect(typeof parsed.createdAt).toBe('string');
    expect(parsed.viewport).toEqual({ x: -120, y: 48, scale: 1.25 });
  });

  it('defaults isDemo to false and both nullable timestamps to null', () => {
    const parsed = caseRecordSchema.parse({
      id: CASE_ID,
      title: 'Cell Biology Final',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      viewport: { x: 0, y: 0, scale: 1 },
    });

    expect(parsed.isDemo).toBe(false);
    expect(parsed.backupPromptedAt).toBeNull();
    expect(parsed.closedAt).toBeNull();
  });

  it('keeps isDemo true and round-trips backupPromptedAt and closedAt', () => {
    const parsed = caseRecordSchema.parse({
      ...validCase,
      isDemo: true,
      backupPromptedAt: UPDATED_AT,
      closedAt: '2026-02-01T10:00:00.000Z',
    });

    expect(parsed.isDemo).toBe(true);
    expect(parsed.backupPromptedAt).toBe(UPDATED_AT);
    expect(parsed.closedAt).toBe('2026-02-01T10:00:00.000Z');
  });

  it('trims title and subject', () => {
    const parsed = caseRecordSchema.parse({
      ...validCase,
      title: '  Cell Biology Final  ',
      subject: '  Biology  ',
    });

    expect(parsed.title).toBe('Cell Biology Final');
    expect(parsed.subject).toBe('Biology');
  });

  it('accepts an 80 character title and rejects 81 characters', () => {
    expect(caseRecordSchema.safeParse({ ...validCase, title: 'x'.repeat(80) }).success).toBe(true);
    expect(caseRecordSchema.safeParse({ ...validCase, title: 'x'.repeat(81) }).success).toBe(false);
  });

  it('rejects empty, whitespace-only, and non-string titles', () => {
    for (const title of ['', '   ', 42, null]) {
      expect(caseRecordSchema.safeParse({ ...validCase, title }).success).toBe(false);
    }
  });

  it('rejects an empty or overlong subject when one is supplied', () => {
    expect(caseRecordSchema.safeParse({ ...validCase, subject: '' }).success).toBe(false);
    expect(caseRecordSchema.safeParse({ ...validCase, subject: '   ' }).success).toBe(false);
    expect(caseRecordSchema.safeParse({ ...validCase, subject: 'x'.repeat(81) }).success).toBe(
      false,
    );
  });

  it('accepts a real calendar exam date and rejects invalid dates', () => {
    expect(caseRecordSchema.safeParse({ ...validCase, examDate: '2026-02-28' }).success).toBe(true);

    for (const examDate of [
      '2026-02-30',
      '2026-13-01',
      '15/06/2026',
      '2026-06-15T00:00:00.000Z',
      '',
    ]) {
      expect(caseRecordSchema.safeParse({ ...validCase, examDate }).success).toBe(false);
    }
  });

  it('rejects timestamps that are not ISO 8601 strings with an offset', () => {
    for (const createdAt of [
      '2026-01-02',
      '2026-01-02T03:04:05',
      '2026-13-02T03:04:05.000Z',
      'not-a-date',
      new Date(),
    ]) {
      expect(caseRecordSchema.safeParse({ ...validCase, createdAt }).success).toBe(false);
    }
  });

  it('rejects updatedAt before createdAt', () => {
    expect(
      caseRecordSchema.safeParse({
        ...validCase,
        createdAt: UPDATED_AT,
        updatedAt: CREATED_AT,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields at the case and viewport level', () => {
    expect(caseRecordSchema.safeParse({ ...validCase, extra: true }).success).toBe(false);
    expect(
      caseRecordSchema.safeParse({
        ...validCase,
        viewport: { x: 0, y: 0, scale: 1, rotation: 0 },
      }).success,
    ).toBe(false);
  });

  it('rejects non-boolean demo markers and malformed backup timestamps', () => {
    expect(caseRecordSchema.safeParse({ ...validCase, isDemo: 'yes' }).success).toBe(false);
    expect(
      caseRecordSchema.safeParse({ ...validCase, backupPromptedAt: '2026-01-02' }).success,
    ).toBe(false);
    expect(caseRecordSchema.safeParse({ ...validCase, closedAt: 'soon' }).success).toBe(false);
  });
});

describe('Viewport schema', () => {
  it('accepts the inclusive 0.25 to 2.5 scale boundaries and negative pan offsets', () => {
    expect(viewportSchema.safeParse({ x: -1000, y: 500, scale: 0.25 }).success).toBe(true);
    expect(viewportSchema.safeParse({ x: 1000, y: -500, scale: 2.5 }).success).toBe(true);
  });

  it('rejects scale values outside 0.25 to 2.5', () => {
    expect(viewportSchema.safeParse({ x: 0, y: 0, scale: 0.24 }).success).toBe(false);
    expect(viewportSchema.safeParse({ x: 0, y: 0, scale: 2.51 }).success).toBe(false);
    expect(viewportSchema.safeParse({ x: 0, y: 0, scale: 0 }).success).toBe(false);
  });

  it('rejects non-finite coordinates, non-numeric scale, and unknown fields', () => {
    expect(viewportSchema.safeParse({ x: Number.NaN, y: 0, scale: 1 }).success).toBe(false);
    expect(viewportSchema.safeParse({ x: 0, y: Number.POSITIVE_INFINITY, scale: 1 }).success).toBe(
      false,
    );
    expect(viewportSchema.safeParse({ x: 0, y: 0, scale: '1' }).success).toBe(false);
    expect(viewportSchema.safeParse({ x: 0, y: 0, scale: 1, zoom: 1 }).success).toBe(false);
  });
});

describe('CardRecord schema', () => {
  it.each(['note', 'source', 'topic'] as const)('accepts a %s card', (type) => {
    expect(cardRecordSchema.safeParse({ ...validCard, type }).success).toBe(true);
  });

  it('rejects an unknown card type', () => {
    expect(cardRecordSchema.safeParse({ ...validCard, type: 'quote' }).success).toBe(false);
  });

  it('enforces the title boundaries and trims the stored title', () => {
    expect(cardRecordSchema.safeParse({ ...validCard, title: 'x'.repeat(80) }).success).toBe(true);
    expect(cardRecordSchema.safeParse({ ...validCard, title: 'x'.repeat(81) }).success).toBe(false);
    expect(cardRecordSchema.safeParse({ ...validCard, title: '   ' }).success).toBe(false);
    expect(cardRecordSchema.parse({ ...validCard, title: '  Mitochondria notes  ' }).title).toBe(
      'Mitochondria notes',
    );
  });

  it('accepts zero and positive positions but rejects negative or non-finite values', () => {
    expect(cardRecordSchema.safeParse({ ...validCard, position: { x: 0, y: 0 } }).success).toBe(
      true,
    );
    expect(cardRecordSchema.safeParse({ ...validCard, position: { x: -1, y: 0 } }).success).toBe(
      false,
    );
    expect(cardRecordSchema.safeParse({ ...validCard, position: { x: 0, y: -1 } }).success).toBe(
      false,
    );
    expect(
      cardRecordSchema.safeParse({ ...validCard, position: { x: Number.NaN, y: 0 } }).success,
    ).toBe(false);
    expect(
      cardRecordSchema.safeParse({
        ...validCard,
        position: { x: 0, y: Number.POSITIVE_INFINITY },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields at the card and position level', () => {
    expect(cardRecordSchema.safeParse({ ...validCard, color: 'red' }).success).toBe(false);
    expect(
      cardRecordSchema.safeParse({
        ...validCard,
        position: { x: 0, y: 0, z: 10 },
      }).success,
    ).toBe(false);
  });

  it('enforces tag count, length, emptiness, and case-insensitive uniqueness', () => {
    expect(
      cardRecordSchema.safeParse({
        ...validCard,
        tags: Array.from({ length: 10 }, (_, index) => `tag-${index}`),
      }).success,
    ).toBe(true);
    expect(
      cardRecordSchema.safeParse({
        ...validCard,
        tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
      }).success,
    ).toBe(false);
    expect(cardRecordSchema.safeParse({ ...validCard, tags: ['x'.repeat(24)] }).success).toBe(true);
    expect(cardRecordSchema.safeParse({ ...validCard, tags: ['x'.repeat(25)] }).success).toBe(
      false,
    );
    expect(cardRecordSchema.safeParse({ ...validCard, tags: [''] }).success).toBe(false);
    expect(cardRecordSchema.safeParse({ ...validCard, tags: ['   '] }).success).toBe(false);
    expect(cardRecordSchema.safeParse({ ...validCard, tags: ['Biology', 'biology'] }).success).toBe(
      false,
    );
    expect(cardRecordSchema.safeParse({ ...validCard, tags: 'Biology' }).success).toBe(false);
  });

  it('trims stored tags', () => {
    expect(cardRecordSchema.parse({ ...validCard, tags: ['  Biology  '] }).tags).toEqual([
      'Biology',
    ]);
  });

  it('accepts cards without OCR metadata and rejects malformed OCR metadata', () => {
    expect(cardRecordSchema.safeParse(validCard).success).toBe(true);
    expect(
      cardRecordSchema.safeParse({
        ...validCard,
        ocrText: 'ATP synthase',
        ocrConfidence: 91.5,
        ocrEngineVersion: '7.0.0',
        ocrUpdatedAt: UPDATED_AT,
      }).success,
    ).toBe(true);
    expect(cardRecordSchema.safeParse({ ...validCard, ocrConfidence: 101 }).success).toBe(false);
    expect(
      cardRecordSchema.safeParse({ ...validCard, ocrText: '', ocrConfidence: 50 }).success,
    ).toBe(false);
    expect(cardRecordSchema.safeParse({ ...validCard, ocrUpdatedAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('rejects malformed timestamps and updatedAt before createdAt', () => {
    expect(cardRecordSchema.safeParse({ ...validCard, createdAt: '2026-01-02' }).success).toBe(
      false,
    );
    expect(
      cardRecordSchema.safeParse({
        ...validCard,
        createdAt: UPDATED_AT,
        updatedAt: CREATED_AT,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-UUID case or card ID', () => {
    expect(cardRecordSchema.safeParse({ ...validCard, id: 'note-1' }).success).toBe(false);
    expect(cardRecordSchema.safeParse({ ...validCard, caseId: 'case-1' }).success).toBe(false);
  });
});

describe('ConnectionRecord schema', () => {
  it('accepts association and provenance records', () => {
    expect(connectionRecordSchema.safeParse(validConnection).success).toBe(true);
    expect(
      connectionRecordSchema.safeParse({ ...validConnection, type: 'provenance' }).success,
    ).toBe(true);
  });

  it('uses the same canonical pair key for A-B and B-A', () => {
    const forward = buildPairKey(NOTE_ID, SOURCE_ID);
    const backward = buildPairKey(SOURCE_ID, NOTE_ID);

    expect(forward).toBe(backward);
    expect(forward).toBe(`${NOTE_ID}${CONNECTION_PAIR_SEPARATOR}${SOURCE_ID}`);
    expect(
      connectionRecordSchema.safeParse({
        ...validConnection,
        fromCardId: SOURCE_ID,
        toCardId: NOTE_ID,
        pairKey: backward,
      }).success,
    ).toBe(true);
  });

  it('requires the canonical pair key for the pair', () => {
    expect(
      connectionRecordSchema.safeParse({
        ...validConnection,
        pairKey: buildPairKey(NOTE_ID, TOPIC_ID),
      }).success,
    ).toBe(false);
  });

  it('rejects self-links even with a syntactically canonical key', () => {
    expect(
      connectionRecordSchema.safeParse({
        ...validConnection,
        toCardId: NOTE_ID,
        pairKey: buildPairKey(NOTE_ID, NOTE_ID),
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown connection type', () => {
    expect(connectionRecordSchema.safeParse({ ...validConnection, type: 'causal' }).success).toBe(
      false,
    );
  });

  it('rejects malformed pair keys, UUIDs, and unknown fields', () => {
    expect(
      connectionRecordSchema.safeParse({ ...validConnection, pairKey: 'not-a-pair' }).success,
    ).toBe(false);
    expect(connectionRecordSchema.safeParse({ ...validConnection, id: 'c-1' }).success).toBe(false);
    expect(connectionRecordSchema.safeParse({ ...validConnection, label: 'because' }).success).toBe(
      false,
    );
  });
});

describe('AttachmentRecord schema', () => {
  it.each(['original', 'display', 'thumbnail'] as const)('accepts a %s attachment', (kind) => {
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, kind }).success).toBe(true);
  });

  it('accepts every supported image MIME type', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(attachmentRecordSchema.safeParse({ ...validAttachment, mime }).success).toBe(true);
    }
  });

  it('rejects unsupported MIME types, kinds, and non-Blob payloads', () => {
    expect(
      attachmentRecordSchema.safeParse({ ...validAttachment, mime: 'image/svg+xml' }).success,
    ).toBe(false);
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, kind: 'full' }).success).toBe(
      false,
    );
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, blob: 'abc' }).success).toBe(
      false,
    );
  });

  it('rejects non-positive dimensions and negative or fractional byte counts', () => {
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, width: 0 }).success).toBe(false);
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, height: -1 }).success).toBe(
      false,
    );
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, width: 1200.5 }).success).toBe(
      false,
    );
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, bytes: -1 }).success).toBe(false);
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, bytes: 2.5 }).success).toBe(
      false,
    );
  });

  it('rejects a byte count that does not match the Blob size', () => {
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, bytes: 4 }).success).toBe(false);
  });

  it('requires a lowercase 64 character SHA-256 digest', () => {
    expect(
      attachmentRecordSchema.safeParse({ ...validAttachment, sha256: 'a'.repeat(63) }).success,
    ).toBe(false);
    expect(
      attachmentRecordSchema.safeParse({
        ...validAttachment,
        sha256: 'A'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      attachmentRecordSchema.safeParse({
        ...validAttachment,
        sha256: 'g'.repeat(64),
      }).success,
    ).toBe(false);
  });

  it('rejects unknown attachment fields and non-UUID IDs', () => {
    expect(
      attachmentRecordSchema.safeParse({ ...validAttachment, path: 'images/a.png' }).success,
    ).toBe(false);
    expect(
      attachmentRecordSchema.safeParse({ ...validAttachment, id: 'attachment-1' }).success,
    ).toBe(false);
    expect(attachmentRecordSchema.safeParse({ ...validAttachment, cardId: 'note-1' }).success).toBe(
      false,
    );
  });
});

describe('CaseSummary schema', () => {
  it('accepts counts and defaults closedAt and isDemo', () => {
    const parsed = caseSummarySchema.parse({
      id: CASE_ID,
      title: 'Cell Biology Final',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      cardCount: 0,
      connectionCount: 0,
    });

    expect(parsed.cardCount).toBe(0);
    expect(parsed.connectionCount).toBe(0);
    expect(parsed.closedAt).toBeNull();
    expect(parsed.isDemo).toBe(false);
  });

  it('rejects negative or fractional counts', () => {
    expect(caseSummarySchema.safeParse({ ...validSummary, cardCount: -1 }).success).toBe(false);
    expect(caseSummarySchema.safeParse({ ...validSummary, connectionCount: 1.5 }).success).toBe(
      false,
    );
  });

  it('rejects unknown fields and malformed metadata', () => {
    expect(caseSummarySchema.safeParse({ ...validSummary, readiness: 'ready' }).success).toBe(
      false,
    );
    expect(caseSummarySchema.safeParse({ ...validSummary, updatedAt: 'today' }).success).toBe(
      false,
    );
    expect(caseSummarySchema.safeParse({ ...validSummary, examDate: '2026-02-30' }).success).toBe(
      false,
    );
  });

  it('requires both counts', () => {
    const minimalSummary = {
      id: CASE_ID,
      title: 'Cell Biology Final',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    };

    expect(caseSummarySchema.safeParse({ ...minimalSummary, cardCount: 1 }).success).toBe(false);
    expect(caseSummarySchema.safeParse({ ...minimalSummary, connectionCount: 1 }).success).toBe(
      false,
    );
  });
});
