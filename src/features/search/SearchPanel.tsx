/**
 * Live search, filters, and the result panel for one open case.
 *
 * The panel owns only read-only UI state: the text draft, the debounced query,
 * the type filter, and the selected tag filters. It calls the pure
 * `searchCards` selector and renders the result list. Persistence, navigation,
 * and camera movement belong to the page that mounts it.
 *
 * Keyboard contract:
 *
 * - The search field is a labelled searchbox with a 150 ms debounce.
 * - Filter controls are real buttons with `aria-pressed` state and 44 px targets.
 * - Arrow Down from the search field enters the result list; Arrow Up/Down,
 *   Home, and End move within it. Tab remains a standard alternative.
 * - The result count and the no-result explanation share one polite live
 *   region mounted before any result appears.
 *
 * On phone widths the panel behaves as a full-height in-flow sheet. It is not
 * a modal overlay, so it never traps focus or hides the page for keyboard
 * users; moving focus out simply returns the reading flow to the page.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { DISMISS_EVENT, FOCUS_SEARCH_EVENT } from '../../app/focus';
import Button from '../../components/Button';
import Field from '../../components/Field';
import IconButton from '../../components/IconButton';
import type { CardRecord } from '../../domain/model';

import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_TYPE_FILTERS,
  cardTypeLabel,
  collectCardTags,
  hasActiveSearch,
  searchCards,
  typeFilterLabel,
} from './searchCards';
import type { CardSearchResult, SearchTypeFilter } from './searchCards';

import './SearchPanel.css';

export interface SearchPanelProps {
  readonly cards: readonly CardRecord[];
  /**
   * Called when the student chooses a result. The owning page decides whether
   * that means centring the card on the board or opening its detail route.
   */
  readonly onSelectCard: (card: CardRecord) => void;
  /** Optional detail path builder; defaults to the card-detail route. */
  readonly detailHref?: ((card: CardRecord) => string) | undefined;
  /** Stable ID prefix for labels, hints, filter panels, and descriptions. */
  readonly id?: string | undefined;
  /** Accessible panel title. Defaults to "Search this case". */
  readonly title?: string | undefined;
  /** Initial state of the filter drawer. Defaults to closed. */
  readonly defaultFiltersOpen?: boolean | undefined;
  /**
   * `inline` is the tablet/desktop reading column. `sheet` is the same panel
   * mounted inside a phone bottom sheet, so it must not claim a full viewport
   * height or draw its own card border around the sheet.
   */
  readonly variant?: 'inline' | 'sheet' | undefined;
  /** Debounce for the query. Defaults to the contract's 150 ms. */
  readonly debounceMs?: number | undefined;
  /** Notified when the query or filters begin/stop narrowing the result set. */
  readonly onActiveChange?: ((active: boolean) => void) | undefined;
  readonly className?: string | undefined;
}

function defaultDetailHref(card: CardRecord): string {
  return `/case/${card.caseId}/card/${card.id}`;
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

function summaryText(active: boolean, results: readonly CardSearchResult[], total: number): string {
  if (!active) {
    return `${countLabel(total)} available. Search titles, tags, or OCR text, or choose a filter.`;
  }

  if (results.length === 0) {
    return 'No cards match. Search covers titles, tags, and OCR text only; the handwritten image itself is not searched.';
  }

  return `${countLabel(results.length)} ${results.length === 1 ? 'matches' : 'match'} your search.`;
}

function resultContext(result: CardSearchResult, type: SearchTypeFilter): string {
  const parts: string[] = [];

  if (result.titleMatched) {
    parts.push('Title matches.');
  }

  if (result.matchedTags.length > 0) {
    const label = result.matchedTags.length === 1 ? 'Matched tag' : 'Matched tags';
    parts.push(`${label}: ${result.matchedTags.join(', ')}.`);
  }

  if (result.ocrSnippet !== null) {
    parts.push(`OCR text: “${result.ocrSnippet}”`);
  }

  if (parts.length === 0) {
    parts.push(
      type === 'all' ? 'Matches the selected filters.' : `Type: ${typeFilterLabel(type)}.`,
    );
  }

  return parts.join(' ');
}

/**
 * Read-only search panel. It mounts once per open case and never writes to the
 * repository, the board store, or the route.
 */
export default function SearchPanel({
  cards,
  onSelectCard,
  detailHref = defaultDetailHref,
  id,
  title = 'Search this case',
  defaultFiltersOpen = false,
  variant = 'inline',
  debounceMs = SEARCH_DEBOUNCE_MS,
  onActiveChange,
  className,
}: SearchPanelProps) {
  const generatedId = useId();
  const baseId = id ?? `search-panel-${generatedId.replace(/:/g, '')}`;
  const titleId = `${baseId}-title`;
  const searchId = `${baseId}-query`;
  const filtersId = `${baseId}-filters`;

  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<SearchTypeFilter>('all');
  const [selectedTags, setSelectedTags] = useState<readonly string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(defaultFiltersOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [searchParams] = useSearchParams();

  // The `/` shortcut on card detail or capture navigates here with
  // `?focus=search`. The panel mounts after the case data loads, so focus is
  // applied here rather than by the shell reaching across routes.
  useEffect(() => {
    if (searchParams.get('focus') !== 'search') {
      return;
    }

    inputRef.current?.focus();
  }, [searchParams]);

  // Debounce only the text query. Filter state is applied by the render below,
  // so tapping a chip updates the list immediately.
  useEffect(() => {
    const delay = Number.isFinite(debounceMs) ? Math.max(0, debounceMs) : SEARCH_DEBOUNCE_MS;
    const timer = window.setTimeout(() => {
      setQuery(draft);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [draft, debounceMs]);

  const criteriaActive = hasActiveSearch({ query: draft, type: typeFilter, tags: selectedTags });
  const searchActive = hasActiveSearch({ query, type: typeFilter, tags: selectedTags });
  const results = useMemo(
    () => searchCards(cards, { query, type: typeFilter, tags: selectedTags }),
    [cards, query, selectedTags, typeFilter],
  );
  const tagOptions = useMemo(() => collectCardTags(cards), [cards]);

  useEffect(() => {
    onActiveChange?.(criteriaActive);
  }, [criteriaActive, onActiveChange]);

  const toggleTag = useCallback((tag: string) => {
    const key = tag.trim().toLowerCase();
    if (key.length === 0) {
      return;
    }

    setSelectedTags((current) =>
      current.some((selected) => selected.trim().toLowerCase() === key)
        ? current.filter((selected) => selected.trim().toLowerCase() !== key)
        : [...current, tag],
    );
  }, []);

  const clearAll = useCallback((): void => {
    setDraft('');
    setQuery('');
    setTypeFilter('all');
    setSelectedTags([]);
    inputRef.current?.focus();
  }, []);

  // The shell's `/` shortcut and its Escape handler publish these events.
  // Keeping the listeners here means the panel owns its own focus and reset
  // behavior instead of the shell reaching into its state.
  useEffect(() => {
    const handleFocusSearch = (): void => {
      const field = inputRef.current;

      if (field === null) {
        return;
      }

      field.focus();
      field.select();
    };

    const handleDismiss = (): void => {
      if (criteriaActive) {
        clearAll();
      }
    };

    window.addEventListener(FOCUS_SEARCH_EVENT, handleFocusSearch);
    window.addEventListener(DISMISS_EVENT, handleDismiss);

    return () => {
      window.removeEventListener(FOCUS_SEARCH_EVENT, handleFocusSearch);
      window.removeEventListener(DISMISS_EVENT, handleDismiss);
    };
  }, [clearAll, criteriaActive]);

  const chooseResult = (card: CardRecord): void => {
    onSelectCard(card);
  };

  const focusResult = (index: number): void => {
    const target = resultRefs.current[index];
    target?.focus();
  };

  const handleResultKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusResult(Math.min(results.length - 1, index + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusResult(Math.max(0, index - 1));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusResult(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusResult(results.length - 1);
    }
  };

  const handleQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      focusResult(0);
    }
  };

  const removeTypeFilter = (): void => {
    setTypeFilter('all');
  };

  const activeFilterChips: Array<{ key: string; label: string; remove: () => void }> = [];

  if (typeFilter !== 'all') {
    activeFilterChips.push({
      key: 'type',
      label: `Type: ${typeFilterLabel(typeFilter)}`,
      remove: removeTypeFilter,
    });
  }

  for (const tag of selectedTags) {
    activeFilterChips.push({
      key: `tag:${tag.toLowerCase()}`,
      label: `Tag: ${tag}`,
      remove: () => toggleTag(tag),
    });
  }

  const summary = summaryText(searchActive, results, cards.length);

  return (
    <section
      className={joinClassNames('search-panel', `search-panel--${variant}`, className)}
      aria-labelledby={titleId}
      data-search-active={searchActive ? 'true' : 'false'}
      data-result-count={results.length}
      data-variant={variant}
    >
      <header className="search-panel__header">
        <h3 id={titleId} className="search-panel__title">
          {title}
        </h3>
        <p className="search-panel__intro">
          Matches are found in titles, tags, and stored OCR text. The handwritten image itself is
          not searched.
        </p>
      </header>

      <div className="search-panel__bar">
        <Field
          id={searchId}
          className="search-panel__field"
          label="Search cards"
          hint="Results update 150 ms after you stop typing."
        >
          {(control) => (
            <input
              {...control}
              ref={inputRef}
              className={`${control.className} search-panel__input`}
              type="search"
              name="card-search"
              value={draft}
              autoComplete="off"
              spellCheck={false}
              data-shortcut-target="search"
              aria-keyshortcuts="/"
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={handleQueryKeyDown}
            />
          )}
        </Field>

        <div className="search-panel__bar-actions">
          <Button
            variant="secondary"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters
          </Button>
          <Button variant="quiet" onClick={clearAll} disabled={!criteriaActive}>
            Clear all
          </Button>
        </div>
      </div>

      {activeFilterChips.length > 0 ? (
        <div className="search-panel__active">
          <h4 className="search-panel__active-title">Active filters</h4>
          <ul className="search-panel__active-list" aria-label="Active filters">
            {activeFilterChips.map((chip) => (
              <li className="search-panel__active-chip" key={chip.key}>
                <span className="search-panel__active-label">{chip.label}</span>
                <IconButton
                  className="search-panel__active-remove"
                  label={`Remove ${chip.label}`}
                  variant="quiet"
                  onClick={chip.remove}
                >
                  ×
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="search-panel__filters" id={filtersId} hidden={!filtersOpen}>
        <fieldset className="search-panel__fieldset">
          <legend className="search-panel__legend">Card type</legend>
          <div className="search-panel__chips">
            {SEARCH_TYPE_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                className="search-panel__chip"
                aria-pressed={typeFilter === option}
                onClick={() => setTypeFilter(option)}
              >
                {typeFilterLabel(option)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="search-panel__fieldset">
          <legend className="search-panel__legend">Tag filters</legend>
          {tagOptions.length === 0 ? (
            <p className="search-panel__filter-empty">No tags on this case yet.</p>
          ) : (
            <div className="search-panel__chips">
              {tagOptions.map((tag) => {
                const selected = selectedTags.some(
                  (candidate) => candidate.trim().toLowerCase() === tag.toLowerCase(),
                );
                return (
                  <button
                    key={tag}
                    type="button"
                    className="search-panel__chip"
                    aria-pressed={selected}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
          <p className="search-panel__filter-hint">
            Any selected tag can match. Type, tag, and text filters combine.
          </p>
        </fieldset>
      </div>

      <p
        className="search-panel__summary"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-empty={searchActive && results.length === 0 ? 'true' : 'false'}
      >
        {summary}
      </p>

      {searchActive && results.length > 0 ? (
        <ul className="search-panel__results" aria-label="Search results">
          {results.map((result, index) => {
            const contextId = `${baseId}-result-${index}-context`;
            return (
              <li className="search-panel__result-item" key={result.card.id}>
                <div className="search-panel__result">
                  <button
                    ref={(node) => {
                      resultRefs.current[index] = node;
                    }}
                    type="button"
                    className="search-panel__result-select"
                    aria-label={`Select ${result.card.title} from search results`}
                    aria-describedby={contextId}
                    onClick={() => chooseResult(result.card)}
                    onKeyDown={(event) => handleResultKeyDown(event, index)}
                  >
                    <span className="search-panel__result-type">
                      {cardTypeLabel(result.card.type)}
                    </span>
                    <span className="search-panel__result-title">{result.card.title}</span>
                  </button>

                  <p className="search-panel__result-context" id={contextId}>
                    {resultContext(result, typeFilter)}
                  </p>

                  <Link
                    className="search-panel__detail-link"
                    to={detailHref(result.card)}
                    aria-label={`Open detail for ${result.card.title}`}
                  >
                    Open detail
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
