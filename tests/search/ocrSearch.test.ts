import { describe, expect, it } from 'vitest';

import type { CardRecord } from '../../src/domain/model';
import { OCR_SNIPPET_MAX_LENGTH, searchCards } from '../../src/features/search/searchCards';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

function makeCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    caseId: CASE_ID,
    type: 'note',
    title: 'Membrane transport',
    position: { x: 40, y: 60 },
    tags: ['Cell biology', 'Lecture'],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    ...overrides,
  };
}

/** A long OCR page where the remembered phrase sits far from both edges. */
const LONG_PREFIX = 'The lecturer began with a review of the previous week. '.repeat(6);
const LONG_SUFFIX = ' Remember this phrase for the final examination.'.repeat(6);

const OCR_TEXT = `${LONG_PREFIX}Sodium ions cross the membrane against their gradient.${LONG_SUFFIX}`;

const MEMBRANE = makeCard({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Membrane transport',
  tags: ['Cell biology', 'Lecture'],
  ocrText: OCR_TEXT,
  ocrConfidence: 92.5,
  ocrEngineVersion: 'tesseract-7.0.0',
  ocrUpdatedAt: '2026-09-02T09:04:00.000Z',
});

const MULTILINE = makeCard({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  type: 'source',
  title: 'Lecture slide 12',
  position: { x: 400, y: 60 },
  tags: ['Lecture'],
  ocrText: 'Active transport pumps\n\nsodium   ions\tacross the membrane.',
  createdAt: '2026-09-02T09:05:00.000Z',
  updatedAt: '2026-09-02T09:05:00.000Z',
});

const WITHOUT_OCR = makeCard({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  type: 'topic',
  title: 'Osmosis',
  position: { x: 760, y: 60 },
  tags: ['Water balance'],
  createdAt: '2026-09-02T09:10:00.000Z',
  updatedAt: '2026-09-02T09:10:00.000Z',
});

const CARDS: readonly CardRecord[] = [MEMBRANE, MULTILINE, WITHOUT_OCR];

describe('OCR text search', () => {
  it('finds a phrase in stored OCR text and returns a bounded snippet', () => {
    const results = searchCards(CARDS, { query: 'sodium ions cross the membrane' });

    expect(results.map((result) => result.card.id)).toEqual([MEMBRANE.id]);
    const [result] = results;
    expect(result?.titleMatched).toBe(false);
    expect(result?.ocrSnippet).not.toBeNull();
    expect(result?.ocrSnippet).toContain('Sodium ions cross the membrane');
    expect(result?.ocrSnippet).toContain('…');

    // The excerpt body is capped, with at most two ellipsis characters around it.
    expect((result?.ocrSnippet ?? '').length).toBeLessThanOrEqual(OCR_SNIPPET_MAX_LENGTH + 2);
  });

  it('matches OCR text that the engine split across lines and repeated spaces', () => {
    const results = searchCards(CARDS, { query: 'sodium ions across the membrane' });

    expect(results.map((result) => result.card.id)).toEqual([MULTILINE.id]);
    expect(results[0]?.ocrSnippet).toContain('sodium ions across the membrane');
    expect(results[0]?.ocrSnippet).not.toContain('\n');
  });

  it('does not throw and does not match a card that never ran OCR', () => {
    expect(() => searchCards(CARDS, { query: 'osmosis topic' })).not.toThrow();

    // Title and tag matching still work for the OCR-less card.
    expect(searchCards(CARDS, { query: 'osmosis' }).map((result) => result.card.id)).toEqual([
      WITHOUT_OCR.id,
    ]);

    const byOcr = searchCards(CARDS, { query: 'sodium ions across the membrane' });
    expect(byOcr.map((result) => result.card.id)).toEqual([MULTILINE.id]);

    const blank = searchCards([WITHOUT_OCR], { query: '   ' });
    expect(blank).toHaveLength(1);
    expect(blank[0]?.ocrSnippet).toBeNull();
  });

  it('searches only OCR text, never confidence, engine version, or timestamp', () => {
    expect(searchCards(CARDS, { query: '92.5' })).toEqual([]);
    expect(searchCards(CARDS, { query: 'tesseract' })).toEqual([]);
    expect(searchCards(CARDS, { query: '2026-09-02T09:04' })).toEqual([]);
    expect(searchCards(CARDS, { query: MEMBRANE.id })).toEqual([]);
  });

  it('caps the snippet even when the query itself is longer than the cap', () => {
    const hugeQuery = OCR_TEXT.slice(0, 300);
    expect(hugeQuery.length).toBeGreaterThan(OCR_SNIPPET_MAX_LENGTH);

    const results = searchCards([MEMBRANE], { query: hugeQuery });

    expect(results).toHaveLength(1);
    expect((results[0]?.ocrSnippet ?? '').length).toBeLessThanOrEqual(OCR_SNIPPET_MAX_LENGTH + 2);
    expect(results[0]?.ocrSnippet).toContain(hugeQuery.slice(0, 40));
  });

  it('performs no writes and leaves card data, tags, and types unchanged', () => {
    const before = structuredClone(CARDS);
    const tagArrays = CARDS.map((card) => [...card.tags]);
    const types = CARDS.map((card) => card.type);

    searchCards(CARDS, { query: 'sodium ions' });
    searchCards(CARDS, { query: 'lecture', type: 'source', tags: ['Lecture'] });

    expect(structuredClone(CARDS)).toEqual(before);
    expect(CARDS.map((card) => [...card.tags])).toEqual(tagArrays);
    expect(CARDS.map((card) => card.type)).toEqual(types);
  });
});
