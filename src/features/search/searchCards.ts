/**
 * Read-only card search and filter selector.
 *
 * This module is deliberately pure: it reads plain card records, performs no
 * I/O, mutates nothing, and never imports Dexie, React, PixiJS, or a worker.
 * Only the title, the card's normalized tags, and stored OCR text are
 * searchable. Image pixels, connection labels, positions, and provenance
 * metadata are not part of the query surface.
 *
 * Matching rules:
 *
 * - The query is matched case-insensitively against title, tags, and OCR text.
 * - Selected tag filters are ORed with each other.
 * - The tag result, the card-type filter, and the text query are ANDed.
 * - Missing or blank OCR text is simply not a match, never an error.
 * - Whitespace is collapsed before matching, so an OCR phrase split across
 *   lines is still findable with a normal single-space query.
 * - OCR excerpts are bounded, so a very long query cannot produce a giant row.
 * - Results preserve the input order so repeat calls are stable.
 */

import type { CardRecord, CardType } from '../../domain/model';
import { CARD_TYPES } from '../../domain/model';

/** The debounce used by the search field, shared with component tests. */
export const SEARCH_DEBOUNCE_MS = 150;

/** Characters of OCR context kept on each side of the matched phrase. */
export const OCR_SNIPPET_RADIUS = 48;

/**
 * Hard cap on the collapsed OCR excerpt (before the two optional ellipses).
 * A long query must not turn the result row into a wall of text.
 */
export const OCR_SNIPPET_MAX_LENGTH = 160;

export const SEARCH_TYPE_FILTERS = ['all', ...CARD_TYPES] as const;
export type SearchTypeFilter = (typeof SEARCH_TYPE_FILTERS)[number];

export interface SearchOptions {
  /** Raw student query. Surrounding whitespace is ignored. */
  readonly query?: string | undefined;
  /** Card-type filter. `all` (the default) does not constrain the result. */
  readonly type?: SearchTypeFilter | undefined;
  /** Selected tag filters. Any one matching tag is enough (OR). */
  readonly tags?: readonly string[] | undefined;
}

/**
 * The committed criteria the board page keeps while a search surface is
 * closed. Closing and reopening the same case never resets the query, type, or
 * selected tags.
 */
export interface SearchCriteria {
  readonly query: string;
  readonly type: SearchTypeFilter;
  readonly tags: readonly string[];
}

export interface CardSearchResult {
  readonly card: CardRecord;
  /** True when the query appears in the title. */
  readonly titleMatched: boolean;
  /** Card tags matched by the query or by a selected tag filter, in card order. */
  readonly matchedTags: readonly string[];
  /** A whitespace-collapsed OCR excerpt around the match, or null. */
  readonly ocrSnippet: string | null;
}

interface NormalizedCriteria {
  readonly query: string;
  readonly type: SearchTypeFilter;
  readonly tagKeys: ReadonlySet<string>;
}

function lower(value: string): string {
  return value.toLowerCase();
}

/**
 * Collapse runs of whitespace so a query typed with single spaces still finds
 * OCR text that the engine split across lines or double spaces. Collapsing is
 * also what makes the snippet a single-line, bounded excerpt.
 */
function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeCriteria(options: SearchOptions): NormalizedCriteria {
  const tagKeys = new Set<string>();

  for (const tag of options.tags ?? []) {
    const key = lower(tag.trim());
    if (key.length > 0) {
      tagKeys.add(key);
    }
  }

  return {
    query: normalizeSearchText(options.query ?? ''),
    type: options.type ?? 'all',
    tagKeys,
  };
}

/**
 * OCR text is optional. A blank or missing value never becomes an empty search
 * target, so a card without OCR is simply not matched by OCR.
 */
function readOcrText(card: CardRecord): string | null {
  const text = card.ocrText;
  if (typeof text !== 'string') {
    return null;
  }

  const normalized = normalizeSearchText(text);
  return normalized.length > 0 ? normalized : null;
}

function cardTags(card: CardRecord): readonly string[] {
  return Array.isArray(card.tags) ? card.tags : [];
}

function matchedTagsFor(
  tags: readonly string[],
  queryKey: string,
  tagKeys: ReadonlySet<string>,
): string[] {
  const matched: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const trimmed = tag.trim();
    const key = lower(trimmed);

    if (trimmed.length === 0 || seen.has(key)) {
      continue;
    }

    const queryMatches = queryKey.length > 0 && key.includes(queryKey);
    const filterMatches = tagKeys.has(key);

    if (queryMatches || filterMatches) {
      seen.add(key);
      matched.push(trimmed);
    }
  }

  return matched;
}

function tagsMatchFilter(tags: readonly string[], tagKeys: ReadonlySet<string>): boolean {
  if (tagKeys.size === 0) {
    return true;
  }

  return tags.some((tag) => tagKeys.has(lower(tag.trim())));
}

function ocrSnippetFor(text: string, matchIndex: number, matchLength: number): string {
  const matchEnd = Math.min(text.length, matchIndex + matchLength);
  let start = Math.max(0, matchIndex - OCR_SNIPPET_RADIUS);
  let end = Math.min(text.length, matchEnd + OCR_SNIPPET_RADIUS);

  // Keep the excerpt inside the cap. Prefer the end of the match so a long
  // query still shows where it landed, then truncate the leading context.
  if (end - start > OCR_SNIPPET_MAX_LENGTH) {
    start = Math.max(0, Math.min(matchIndex, matchEnd - OCR_SNIPPET_MAX_LENGTH));
    end = Math.min(text.length, start + OCR_SNIPPET_MAX_LENGTH);

    if (end < matchEnd) {
      start = matchIndex;
      end = Math.min(text.length, start + OCR_SNIPPET_MAX_LENGTH);
    }
  }

  const body = text.slice(start, end).trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';

  return `${prefix}${body}${suffix}`;
}

/**
 * Filter cards for the open case and return the matching context the panel
 * shows. A card with no OCR fields is skipped by an OCR-only query without
 * throwing; a blank query does not test OCR at all.
 */
export function searchCards(
  cards: readonly CardRecord[],
  options: SearchOptions = {},
): readonly CardSearchResult[] {
  const { query, type, tagKeys } = normalizeCriteria(options);
  const queryKey = lower(query);
  const results: CardSearchResult[] = [];

  for (const card of cards) {
    if (type !== 'all' && card.type !== type) {
      continue;
    }

    const tags = cardTags(card);

    if (!tagsMatchFilter(tags, tagKeys)) {
      continue;
    }

    const titleMatched =
      queryKey.length > 0 && typeof card.title === 'string' && lower(card.title).includes(queryKey);
    const matchedTags = matchedTagsFor(tags, queryKey, tagKeys);
    const tagQueryMatched =
      queryKey.length > 0 && tags.some((tag) => lower(tag.trim()).includes(queryKey));
    const ocrText = readOcrText(card);
    let ocrSnippet: string | null = null;

    if (queryKey.length > 0 && ocrText !== null) {
      const matchIndex = lower(ocrText).indexOf(queryKey);
      if (matchIndex >= 0) {
        ocrSnippet = ocrSnippetFor(ocrText, matchIndex, queryKey.length);
      }
    }

    const textMatches =
      queryKey.length === 0 || titleMatched || tagQueryMatched || ocrSnippet !== null;

    if (!textMatches) {
      continue;
    }

    results.push({
      card,
      titleMatched,
      matchedTags,
      ocrSnippet,
    });
  }

  return results;
}

/** True when the query or any filter would narrow the result set. */
export function hasActiveSearch(options: SearchOptions = {}): boolean {
  const queryActive = (options.query ?? '').trim().length > 0;
  const typeActive = (options.type ?? 'all') !== 'all';
  const tagsActive = (options.tags ?? []).some((tag) => tag.trim().length > 0);

  return queryActive || typeActive || tagsActive;
}

/**
 * Every distinct tag in the case, in a stable case-insensitive order. The
 * first display casing is preserved for the filter chips.
 */
export function collectCardTags(cards: readonly CardRecord[]): readonly string[] {
  const seen = new Map<string, string>();

  for (const card of cards) {
    for (const tag of cardTags(card)) {
      const trimmed = tag.trim();
      const key = lower(trimmed);

      if (trimmed.length > 0 && !seen.has(key)) {
        seen.set(key, trimmed);
      }
    }
  }

  return [...seen.values()].sort(
    (first, second) => lower(first).localeCompare(lower(second)) || first.localeCompare(second),
  );
}

/** Human-readable label for a type filter, shared by chips and tests. */
export function typeFilterLabel(type: SearchTypeFilter): string {
  switch (type) {
    case 'all':
      return 'All types';
    case 'note':
      return 'Notes';
    case 'source':
      return 'Sources';
    case 'topic':
      return 'Topics';
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/** Human-readable label for a result row's card type. */
export function cardTypeLabel(type: CardType): string {
  switch (type) {
    case 'note':
      return 'Study note';
    case 'source':
      return 'Source';
    case 'topic':
      return 'Topic';
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}
