import { describe, expect, it } from 'vitest';

import type { CardRecord } from '../../src/domain/model';
import {
  SEARCH_DEBOUNCE_MS,
  cardTypeLabel,
  collectCardTags,
  hasActiveSearch,
  searchCards,
  typeFilterLabel,
} from '../../src/features/search/searchCards';

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

const MEMBRANE = makeCard({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Membrane transport',
  tags: ['Cell biology', 'Lecture'],
  ocrText: 'Active transport pumps sodium ions across the membrane against a gradient.',
});

const OSMOSIS = makeCard({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  type: 'topic',
  title: 'Osmosis',
  position: { x: 400, y: 60 },
  tags: ['Water balance'],
  createdAt: '2026-09-02T09:05:00.000Z',
  updatedAt: '2026-09-02T09:05:00.000Z',
});

const LECTURE = makeCard({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  type: 'source',
  title: 'Lecture slide 12',
  position: { x: 760, y: 60 },
  tags: ['lecture'],
  createdAt: '2026-09-02T09:10:00.000Z',
  updatedAt: '2026-09-02T09:10:00.000Z',
});

const CARDS: readonly CardRecord[] = [MEMBRANE, OSMOSIS, LECTURE];

describe('searchCards text matching', () => {
  it('finds a title, a tag, and an OCR phrase case-insensitively', () => {
    expect(searchCards(CARDS, { query: 'MEMBRANE' }).map((result) => result.card.id)).toContain(
      MEMBRANE.id,
    );

    const tagMatch = searchCards(CARDS, { query: 'cell BIOLOGY' });
    expect(tagMatch.map((result) => result.card.id)).toEqual([MEMBRANE.id]);
    expect(tagMatch[0]?.matchedTags).toEqual(['Cell biology']);
    expect(tagMatch[0]?.titleMatched).toBe(false);

    const ocrMatch = searchCards(CARDS, { query: 'SODIUM IONS' });
    expect(ocrMatch.map((result) => result.card.id)).toEqual([MEMBRANE.id]);
    expect(ocrMatch[0]?.ocrSnippet).toContain('sodium ions');
  });

  it('treats a missing OCR field as no match and never throws', () => {
    expect(() => searchCards(CARDS, { query: 'active transport' })).not.toThrow();
    expect(
      searchCards(CARDS, { query: 'active transport' }).map((result) => result.card.id),
    ).toEqual([MEMBRANE.id]);

    const withoutOcr = CARDS.map((card) => {
      const copy = { ...card };
      delete copy.ocrText;
      return copy;
    });

    expect(() => searchCards(withoutOcr, { query: 'sodium ions' })).not.toThrow();
    expect(searchCards(withoutOcr, { query: 'sodium ions' })).toEqual([]);
  });

  it('does not search the card id, position, type name, or other metadata', () => {
    expect(searchCards(CARDS, { query: 'aaaaaaaa' })).toEqual([]);
    expect(searchCards(CARDS, { query: '760' })).toEqual([]);
    expect(searchCards(CARDS, { query: 'source' })).toEqual([]);
    expect(searchCards(CARDS, { query: CASE_ID })).toEqual([]);
  });

  it('returns every card in input order for a blank query and no filters', () => {
    expect(searchCards(CARDS, { query: '   ' }).map((result) => result.card.id)).toEqual(
      CARDS.map((card) => card.id),
    );
    expect(searchCards(CARDS).map((result) => result.card.id)).toEqual(
      CARDS.map((card) => card.id),
    );
  });
});

describe('searchCards filter combination', () => {
  it('ORs selected tags, then ANDs the tag result with type and query', () => {
    const tagFiltered = searchCards(CARDS, { tags: ['Cell biology', 'water BALANCE'] });
    expect(tagFiltered.map((result) => result.card.id)).toEqual([MEMBRANE.id, OSMOSIS.id]);

    const typed = searchCards(CARDS, { tags: ['lecture'], type: 'note' });
    expect(typed.map((result) => result.card.id)).toEqual([MEMBRANE.id]);

    const typedSource = searchCards(CARDS, { tags: ['lecture'], type: 'source' });
    expect(typedSource.map((result) => result.card.id)).toEqual([LECTURE.id]);

    const queryAndType = searchCards(CARDS, { query: 'lecture', type: 'source' });
    expect(queryAndType.map((result) => result.card.id)).toEqual([LECTURE.id]);

    const allThree = searchCards(CARDS, {
      query: 'lecture',
      type: 'source',
      tags: ['Lecture'],
    });
    expect(allThree.map((result) => result.card.id)).toEqual([LECTURE.id]);

    const contradictory = searchCards(CARDS, {
      query: 'membrane',
      type: 'topic',
      tags: ['Cell biology'],
    });
    expect(contradictory).toEqual([]);
  });

  it('reports the tag filter matches as context even without a query', () => {
    const results = searchCards(CARDS, { tags: ['water balance'] });
    expect(results).toHaveLength(1);
    expect(results[0]?.matchedTags).toEqual(['Water balance']);
    expect(results[0]?.titleMatched).toBe(false);
    expect(results[0]?.ocrSnippet).toBeNull();
  });

  it('keeps result order stable across repeated calls', () => {
    const first = searchCards(CARDS, { query: 'lecture' }).map((result) => result.card.id);
    const second = searchCards(CARDS, { query: 'lecture' }).map((result) => result.card.id);
    expect(first).toEqual(second);
  });
});

describe('searchCards purity', () => {
  it('performs no writes and does not mutate the cards or their arrays', () => {
    const snapshot = JSON.parse(JSON.stringify(CARDS)) as unknown;
    const tagsBefore = CARDS.map((card) => [...card.tags]);

    searchCards(CARDS, {
      query: 'lecture',
      type: 'source',
      tags: ['Lecture', 'Cell biology'],
    });

    expect(JSON.parse(JSON.stringify(CARDS))).toEqual(snapshot);
    expect(CARDS.map((card) => [...card.tags])).toEqual(tagsBefore);
  });

  it('works with a frozen card list', () => {
    const frozen: readonly CardRecord[] = Object.freeze([
      Object.freeze({ ...MEMBRANE, tags: Object.freeze(['Lecture']) }),
    ]) as unknown as readonly CardRecord[];

    expect(() => searchCards(frozen, { query: 'lecture' })).not.toThrow();
  });
});

describe('search helper vocabulary', () => {
  it('deduplicates case tags while preserving the first display casing', () => {
    const tags = collectCardTags([
      makeCard({ tags: ['Cell biology', 'lecture'] }),
      makeCard({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', tags: ['cell Biology', 'Exam 1'] }),
    ]);

    expect(tags).toEqual(['Cell biology', 'Exam 1', 'lecture']);
  });

  it('detects active criteria and labels filters for the panel', () => {
    expect(hasActiveSearch()).toBe(false);
    expect(hasActiveSearch({ query: '   ' })).toBe(false);
    expect(hasActiveSearch({ query: 'x' })).toBe(true);
    expect(hasActiveSearch({ type: 'topic' })).toBe(true);
    expect(hasActiveSearch({ tags: [' lecture '] })).toBe(true);

    expect(SEARCH_DEBOUNCE_MS).toBe(150);
    expect(typeFilterLabel('all')).toBe('All types');
    expect(typeFilterLabel('note')).toBe('Notes');
    expect(typeFilterLabel('source')).toBe('Sources');
    expect(typeFilterLabel('topic')).toBe('Topics');
    expect(cardTypeLabel('note')).toBe('Study note');
    expect(cardTypeLabel('source')).toBe('Source');
    expect(cardTypeLabel('topic')).toBe('Topic');
  });
});
