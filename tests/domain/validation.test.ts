import { describe, expect, it } from 'vitest';

import { createId, fixedClock, nowIso, sequenceIdFactory, systemClock } from '../../src/domain/ids';
import {
  CARD_TYPES,
  buildPairKey,
  connectionRecordSchema,
  type CardType,
  type ConnectionRecord,
} from '../../src/domain/model';
import {
  DomainValidationError,
  assertCanonicalPairKey,
  assertConnectionEligible,
  assertConnectionInCase,
  isAssociationEligible,
  isCanonicalPairKey,
  isIsoDate,
  isIsoTimestamp,
  isProvenanceEligible,
  isUuid,
  normalizeTag,
  normalizeTags,
  parseAttachmentRecord,
  parseCardRecord,
  parseCaseRecord,
  parseCaseSummary,
  parseConnectionRecord,
  parseViewport,
  validateCardRecord,
  validateCaseRecord,
  validateCaseSummary,
  validateConnectionRecord,
  validateViewport,
} from '../../src/domain/validation';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CASE_ID = '99999999-9999-4999-8999-999999999999';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_NOTE_ID = '55555555-5555-4555-8555-555555555555';
const FOREIGN_CARD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONNECTION_ID = '66666666-6666-4666-8666-666666666666';
const ATTACHMENT_ID = '77777777-7777-4777-8777-777777777777';

const CREATED_AT = '2026-01-02T03:04:05.000Z';
const UPDATED_AT = '2026-01-02T04:05:06.000Z';

const validCase = {
  id: CASE_ID,
  title: 'Cell Biology Final',
  subject: 'Biology',
  examDate: '2026-06-15',
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  viewport: { x: 0, y: 0, scale: 1 },
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const validCard = {
  id: NOTE_ID,
  caseId: CASE_ID,
  type: 'note',
  title: 'Mitochondria notes',
  position: { x: 10, y: 20 },
  tags: ['Biology'],
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const cards = [
  { id: NOTE_ID, caseId: CASE_ID, type: 'note' as const },
  { id: SOURCE_ID, caseId: CASE_ID, type: 'source' as const },
  { id: TOPIC_ID, caseId: CASE_ID, type: 'topic' as const },
  { id: SECOND_NOTE_ID, caseId: CASE_ID, type: 'note' as const },
  { id: FOREIGN_CARD_ID, caseId: OTHER_CASE_ID, type: 'source' as const },
];

function connection(
  fromCardId: string,
  toCardId: string,
  type: ConnectionRecord['type'] = 'association',
): ConnectionRecord {
  return {
    id: CONNECTION_ID,
    caseId: CASE_ID,
    fromCardId,
    toCardId,
    pairKey: buildPairKey(fromCardId, toCardId),
    type,
  };
}

describe('boundary validation wrappers', () => {
  it('parses every record type and returns typed values', () => {
    expect(parseCaseRecord(validCase).id).toBe(CASE_ID);
    expect(parseCardRecord(validCard).title).toBe('Mitochondria notes');
    expect(parseConnectionRecord(connection(NOTE_ID, SOURCE_ID, 'provenance')).type).toBe(
      'provenance',
    );
    expect(
      parseAttachmentRecord({
        id: ATTACHMENT_ID,
        cardId: NOTE_ID,
        kind: 'thumbnail',
        mime: 'image/webp',
        width: 320,
        height: 240,
        bytes: 3,
        sha256: 'b'.repeat(64),
        blob: new Blob(['abc'], { type: 'image/webp' }),
      }).kind,
    ).toBe('thumbnail');
    expect(parseViewport({ x: -10, y: 25, scale: 0.5 }).scale).toBe(0.5);
    expect(
      parseCaseSummary({
        id: CASE_ID,
        title: 'Cell Biology Final',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        cardCount: 2,
        connectionCount: 1,
        readiness: 'loose',
        looseThreadCount: 1,
      }).connectionCount,
    ).toBe(1);
  });

  it('reports a structured failure instead of throwing for stored rows', () => {
    const result = validateCaseRecord({ ...validCase, title: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(DomainValidationError);
      expect(result.error.name).toBe('DomainValidationError');
      expect(result.error.issues).not.toHaveLength(0);
      expect(result.error.message).toContain('Invalid CaseRecord');
      expect(result.error.issues[0]?.path).toEqual(['title']);
    }
  });

  it('throws DomainValidationError from parse wrappers', () => {
    expect(() => parseCardRecord({ ...validCard, type: 'quote' })).toThrow(DomainValidationError);
    expect(() => parseCardRecord({ ...validCard, type: 'quote' })).toThrow(/Invalid CardRecord/);
  });

  it('rejects unknown fields and invalid tag arrays on the read path', () => {
    expect(validateCardRecord({ ...validCard, extra: true }).success).toBe(false);
    expect(validateCardRecord({ ...validCard, tags: ['Biology', 'biology'] }).success).toBe(false);
    expect(validateCardRecord({ ...validCard, tags: [''] }).success).toBe(false);
  });

  it('validates viewport, connection, and summary boundaries through the wrappers', () => {
    expect(validateViewport({ x: 0, y: 0, scale: 2.6 }).success).toBe(false);
    expect(
      validateConnectionRecord({
        ...connection(NOTE_ID, SOURCE_ID),
        pairKey: buildPairKey(NOTE_ID, TOPIC_ID),
      }).success,
    ).toBe(false);
    expect(
      validateCaseSummary({
        id: CASE_ID,
        title: 'Cell Biology Final',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        cardCount: -1,
        connectionCount: 0,
        readiness: 'ready',
        looseThreadCount: 0,
      }).success,
    ).toBe(false);
    expect(validateCaseRecord({ ...validCase, examDate: '2026-02-30' }).success).toBe(false);
    expect(connectionRecordSchema.safeParse(connection(NOTE_ID, SOURCE_ID)).success).toBe(true);
  });
});

describe('canonical connection pair keys', () => {
  it('produces the identical key for A-B and B-A regardless of call order', () => {
    const forward = buildPairKey(NOTE_ID, SOURCE_ID);
    const backward = buildPairKey(SOURCE_ID, NOTE_ID);

    expect(forward).toBe(backward);
    expect(forward.startsWith(NOTE_ID)).toBe(true);
    expect(forward.endsWith(SOURCE_ID)).toBe(true);
    expect(forward).toContain('::');
  });

  it('is stable and distinct for different pairs', () => {
    expect(buildPairKey(NOTE_ID, SOURCE_ID)).toBe(buildPairKey(NOTE_ID, SOURCE_ID));
    expect(buildPairKey(NOTE_ID, SOURCE_ID)).not.toBe(buildPairKey(NOTE_ID, TOPIC_ID));
  });

  it('recognizes a canonical key and rejects a stale one', () => {
    const pairKey = buildPairKey(NOTE_ID, SOURCE_ID);

    expect(isCanonicalPairKey(pairKey, NOTE_ID, SOURCE_ID)).toBe(true);
    expect(isCanonicalPairKey(pairKey, SOURCE_ID, NOTE_ID)).toBe(true);
    expect(isCanonicalPairKey(pairKey, NOTE_ID, TOPIC_ID)).toBe(false);
    expect(() => assertCanonicalPairKey(pairKey, NOTE_ID, SOURCE_ID)).not.toThrow();
    expect(() => assertCanonicalPairKey(pairKey, NOTE_ID, TOPIC_ID)).toThrow(DomainValidationError);
  });
});

describe('connection eligibility', () => {
  it('allows association only between two distinct cards', () => {
    expect(isAssociationEligible(NOTE_ID, TOPIC_ID)).toBe(true);
    expect(isAssociationEligible(NOTE_ID, SOURCE_ID)).toBe(true);
    expect(isAssociationEligible(NOTE_ID, NOTE_ID)).toBe(false);
  });

  it('allows provenance only between a Study Note and a Source', () => {
    for (const fromType of CARD_TYPES) {
      for (const toType of CARD_TYPES) {
        const expected =
          (fromType === 'note' && toType === 'source') ||
          (fromType === 'source' && toType === 'note');
        expect(isProvenanceEligible(fromType, toType), `${fromType} -> ${toType}`).toBe(expected);
      }
    }
  });

  it('accepts a valid association and rejects self-links', () => {
    expect(() =>
      assertConnectionEligible(connection(NOTE_ID, TOPIC_ID), 'note', 'topic'),
    ).not.toThrow();
    expect(() => assertConnectionEligible(connection(NOTE_ID, NOTE_ID), 'note', 'note')).toThrow(
      DomainValidationError,
    );
  });

  it('accepts provenance in both orientations and rejects every other pairing', () => {
    expect(() =>
      assertConnectionEligible(connection(NOTE_ID, SOURCE_ID, 'provenance'), 'note', 'source'),
    ).not.toThrow();
    expect(() =>
      assertConnectionEligible(connection(SOURCE_ID, NOTE_ID, 'provenance'), 'source', 'note'),
    ).not.toThrow();

    const invalidPairs: Array<[CardType, CardType]> = [
      ['note', 'note'],
      ['source', 'source'],
      ['note', 'topic'],
      ['topic', 'topic'],
      ['source', 'topic'],
      ['topic', 'source'],
    ];

    for (const [fromType, toType] of invalidPairs) {
      expect(
        () =>
          assertConnectionEligible(
            connection(NOTE_ID, SECOND_NOTE_ID, 'provenance'),
            fromType,
            toType,
          ),
        `${fromType} -> ${toType}`,
      ).toThrow(DomainValidationError);
    }
  });
});

describe('connection endpoints against case cards', () => {
  it('accepts association between any two distinct cards in the case', () => {
    expect(() => assertConnectionInCase(connection(NOTE_ID, TOPIC_ID), cards)).not.toThrow();
    expect(() => assertConnectionInCase(connection(NOTE_ID, SECOND_NOTE_ID), cards)).not.toThrow();
  });

  it('accepts provenance between a note and a source in either orientation', () => {
    expect(() =>
      assertConnectionInCase(connection(NOTE_ID, SOURCE_ID, 'provenance'), cards),
    ).not.toThrow();
    expect(() =>
      assertConnectionInCase(connection(SOURCE_ID, NOTE_ID, 'provenance'), cards),
    ).not.toThrow();
  });

  it('rejects a dangling endpoint before a write', () => {
    expect(() => assertConnectionInCase(connection(SECOND_NOTE_ID, TOPIC_ID), [cards[0]!])).toThrow(
      DomainValidationError,
    );
  });

  it('rejects an endpoint that belongs to another case', () => {
    expect(() => assertConnectionInCase(connection(NOTE_ID, FOREIGN_CARD_ID), cards)).toThrow(
      DomainValidationError,
    );
  });

  it('rejects self-links and non-canonical pair keys', () => {
    const selfLink = {
      ...connection(NOTE_ID, NOTE_ID),
      pairKey: buildPairKey(NOTE_ID, NOTE_ID),
    };
    const staleKey = {
      ...connection(NOTE_ID, TOPIC_ID),
      pairKey: buildPairKey(NOTE_ID, SOURCE_ID),
    };

    expect(() => assertConnectionInCase(selfLink, cards)).toThrow(DomainValidationError);
    expect(() => assertConnectionInCase(staleKey, cards)).toThrow(DomainValidationError);
  });

  it('rejects provenance between a note and a topic', () => {
    expect(() =>
      assertConnectionInCase(connection(NOTE_ID, TOPIC_ID, 'provenance'), cards),
    ).toThrow(/Provenance is legal only between one Study Note and one Source/);
  });

  it('reports the failing endpoint path in the error issues', () => {
    try {
      assertConnectionInCase(connection(SECOND_NOTE_ID, TOPIC_ID), [cards[0]!]);
      expect.unreachable('expected a dangling endpoint to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      const validationError = error as DomainValidationError;
      expect(validationError.issues.some((issue) => issue.path.includes('fromCardId'))).toBe(true);
    }
  });
});

describe('tag normalization', () => {
  it('trims a tag and preserves display casing', () => {
    expect(normalizeTag('  Biology  ')).toBe('Biology');
    expect(normalizeTag('x'.repeat(24))).toHaveLength(24);
  });

  it('rejects empty, whitespace-only, and overlong tags', () => {
    expect(() => normalizeTag('')).toThrow(DomainValidationError);
    expect(() => normalizeTag('   ')).toThrow(DomainValidationError);
    expect(() => normalizeTag('x'.repeat(25))).toThrow(DomainValidationError);
  });

  it('deduplicates case-insensitively while keeping the first display casing and order', () => {
    expect(normalizeTags(['Biology', 'biology', '  ENERGY  ', 'Energy'])).toEqual([
      'Biology',
      'ENERGY',
    ]);
  });

  it('accepts ten distinct tags and rejects eleven', () => {
    expect(normalizeTags(Array.from({ length: 10 }, (_, index) => `tag-${index}`))).toHaveLength(
      10,
    );
    expect(() => normalizeTags(Array.from({ length: 11 }, (_, index) => `tag-${index}`))).toThrow(
      DomainValidationError,
    );
  });

  it('counts deduplicated tags rather than raw array entries', () => {
    const tags = Array.from({ length: 10 }, (_, index) => `tag-${index}`);
    expect(normalizeTags([...tags, 'TAG-0'])).toHaveLength(10);
  });
});

describe('identifier and clock helpers', () => {
  it('creates UUID strings with crypto.randomUUID', () => {
    const first = createId();
    const second = createId();

    expect(isUuid(first)).toBe(true);
    expect(isUuid(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it('serializes an injected clock to an ISO timestamp', () => {
    expect(nowIso(fixedClock(CREATED_AT))).toBe(CREATED_AT);
    expect(nowIso(fixedClock(new Date(CREATED_AT)))).toBe(CREATED_AT);
    expect(isIsoTimestamp(nowIso(systemClock))).toBe(true);
  });

  it('returns a fresh Date so callers cannot advance a fixed clock', () => {
    const clock = fixedClock(CREATED_AT);
    const firstRead = clock();
    firstRead.setUTCFullYear(1999);

    expect(clock().toISOString()).toBe(CREATED_AT);
  });

  it('rejects an invalid fixed clock instant', () => {
    expect(() => fixedClock('not-a-date')).toThrow(RangeError);
  });

  it('supplies deterministic IDs in order and fails when exhausted', () => {
    const factory = sequenceIdFactory([NOTE_ID, SOURCE_ID]);

    expect(factory()).toBe(NOTE_ID);
    expect(factory()).toBe(SOURCE_ID);
    expect(factory).toThrow(RangeError);
  });
});

describe('format guards', () => {
  it('recognizes UUID strings only', () => {
    expect(isUuid(NOTE_ID)).toBe(true);
    expect(isUuid('note-1')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('requires an ISO timestamp with a timezone', () => {
    expect(isIsoTimestamp(CREATED_AT)).toBe(true);
    expect(isIsoTimestamp('2026-01-02T03:04:05+02:00')).toBe(true);
    expect(isIsoTimestamp('2026-01-02')).toBe(false);
    expect(isIsoTimestamp('2026-01-02T03:04:05')).toBe(false);
  });

  it('stores exam dates as valid ISO calendar dates only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-06-15T00:00:00.000Z')).toBe(false);
  });
});
