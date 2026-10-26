import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardStore } from '../../src/board/boardStore';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CardRecord, CaseRecord } from '../../src/domain/model';
import { DEFAULT_VIEWPORT } from '../../src/domain/model';
import { CardListPage } from '../../src/features/case/CardListPage';
import { CaseBoardPage } from '../../src/features/case/CaseBoardPage';
import SearchPanel from '../../src/features/search/SearchPanel';
import {
  contrastRatio,
  declarationsFor,
  mediaBody,
  parseTokens,
  readRepositoryFile,
  resolveColor,
  resolveLengthPx,
  stripComments,
} from '../helpers/css-contract';

vi.mock('../../src/board/BoardCanvas', () => ({
  BoardCanvas: () => <div data-testid="board-canvas-stub" />,
}));

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOPIC_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Cell Biology',
  subject: 'Biology',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const MEMBRANE: CardRecord = {
  id: NOTE_ID,
  caseId: CASE_ID,
  type: 'note',
  title: 'Membrane transport',
  position: { x: 180, y: 240 },
  tags: ['Cell biology', 'Lecture'],
  ocrText: 'Active transport pumps sodium ions across the membrane against a gradient.',
  createdAt: '2026-09-02T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
};

const OSMOSIS: CardRecord = {
  id: TOPIC_ID,
  caseId: CASE_ID,
  type: 'topic',
  title: 'Osmosis',
  position: { x: 460, y: 240 },
  tags: ['Water balance'],
  createdAt: '2026-09-02T09:05:00.000Z',
  updatedAt: '2026-09-02T09:05:00.000Z',
};

const LECTURE: CardRecord = {
  id: SOURCE_ID,
  caseId: CASE_ID,
  type: 'source',
  title: 'Lecture slide 12',
  position: { x: 740, y: 240 },
  tags: ['lecture'],
  createdAt: '2026-09-02T09:10:00.000Z',
  updatedAt: '2026-09-02T09:10:00.000Z',
};

const CARDS: readonly CardRecord[] = [MEMBRANE, OSMOSIS, LECTURE];

function renderPanel(onSelectCard = vi.fn()) {
  return {
    onSelectCard,
    ...render(
      <MemoryRouter>
        <SearchPanel cards={CARDS} onSelectCard={onSelectCard} />
      </MemoryRouter>,
    ),
  };
}

function BoardFocusProbe() {
  const [params] = useSearchParams();
  return <h2>Case board focus {params.get('card')}</h2>;
}

function seededRepository(): InMemoryCaseRepository {
  return new InMemoryCaseRepository({ seed: { cases: [CASE], cards: [...CARDS] } });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SearchPanel query debounce', () => {
  it('waits 150 ms after the last keystroke before applying the query', () => {
    vi.useFakeTimers();
    renderPanel();

    const input = screen.getByRole('searchbox', { name: 'Search cards' });
    fireEvent.change(input, { target: { value: 'sodium' } });

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(
      screen.queryByRole('button', { name: 'Select Membrane transport from search results' }),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      screen.getByRole('button', { name: 'Select Membrane transport from search results' }),
    ).toBeInTheDocument();
  });

  it('restarts the debounce when the student keeps typing', () => {
    vi.useFakeTimers();
    renderPanel();

    const input = screen.getByRole('searchbox', { name: 'Search cards' });
    fireEvent.change(input, { target: { value: 'sod' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: 'sodium' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('status')).toHaveTextContent('3 cards available');

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole('status')).toHaveTextContent('1 card matches');
  });
});

describe('SearchPanel filters and clear all', () => {
  it('applies type and tag filters immediately and ORs the selected tags', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(screen.getByRole('button', { name: 'Topics' }));

    expect(
      screen.getByRole('button', { name: 'Select Osmosis from search results' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Select Membrane transport from search results' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Water balance' }));
    expect(screen.getByRole('button', { name: 'Water balance' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'All types' }));
    await user.click(screen.getByRole('button', { name: 'Cell biology' }));
    await user.click(screen.getByRole('button', { name: 'Lecture' }));

    const results = within(screen.getByRole('list', { name: 'Search results' })).getAllByRole(
      'button',
      { name: /from search results/ },
    );
    const names = results.map((button) => button.getAttribute('aria-label'));

    expect(names).toContain('Select Membrane transport from search results');
    expect(names).toContain('Select Osmosis from search results');
    expect(names).toContain('Select Lecture slide 12 from search results');
  });

  it('shows active filter chips and clears query, type, and tags in one action', async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByRole('searchbox', { name: 'Search cards' });
    await user.type(input, 'lecture');

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(screen.getByRole('button', { name: 'Sources' }));
    await user.click(screen.getByRole('button', { name: 'Lecture' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 card matches');
    });
    expect(screen.getByRole('heading', { name: 'Active filters' })).toBeInTheDocument();
    expect(screen.getByText('Type: Sources')).toBeInTheDocument();
    expect(screen.getByText('Tag: Lecture')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'All types' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Lecture' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByRole('heading', { name: 'Active filters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('3 cards available');
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled();
  });

  it('removes an individual active filter without clearing the query', async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByRole('searchbox', { name: 'Search cards' });
    await user.type(input, 'lecture');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(screen.getByRole('button', { name: 'Sources' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 card matches');
    });

    await user.click(screen.getByRole('button', { name: 'Remove Type: Sources' }));

    expect(input).toHaveValue('lecture');
    expect(screen.queryByText('Type: Sources')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('2 cards match your search');
    });
  });
});

describe('SearchPanel announcements and results', () => {
  it('announces the result count and the no-result explanation in one live region', async () => {
    const user = userEvent.setup();
    renderPanel();

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');

    const input = screen.getByRole('searchbox', { name: 'Search cards' });
    await user.type(input, 'sodium');

    await waitFor(() => {
      expect(status).toHaveTextContent('1 card matches');
    });

    await user.clear(input);
    await user.type(input, 'not on any card');

    await waitFor(() => {
      expect(status).toHaveTextContent('No cards match');
    });
    expect(status).toHaveTextContent('titles, tags, and OCR text only');
    expect(status).toHaveTextContent('handwritten image itself is not searched');
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('shows matched context, keeps the OCR excerpt plain text, and links to detail', async () => {
    const user = userEvent.setup();
    const onSelectCard = vi.fn();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <SearchPanel
                cards={[
                  {
                    ...MEMBRANE,
                    title: '<script>alert("membrane")</script> transport',
                  },
                ]}
                onSelectCard={onSelectCard}
              />
            }
          />
          <Route path="/case/:caseId/card/:cardId" element={<h2>Card detail</h2>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search cards' }), 'sodium');

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'Select <script>alert("membrane")</script> transport from search results',
        }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('<script>alert("membrane")</script> transport')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();

    const resultButton = screen.getByRole('button', {
      name: 'Select <script>alert("membrane")</script> transport from search results',
    });
    const contextId = resultButton.getAttribute('aria-describedby');
    expect(contextId).not.toBeNull();
    expect(document.getElementById(contextId ?? '')).toHaveTextContent(
      'OCR text: “Active transport pumps sodium ions',
    );

    const detail = screen.getByRole('link', { name: /Open detail for/ });
    expect(detail).toHaveAttribute('href', `/case/${CASE_ID}/card/${NOTE_ID}`);

    await user.click(detail);
    expect(screen.getByRole('heading', { level: 2, name: 'Card detail' })).toBeInTheDocument();
    expect(onSelectCard).not.toHaveBeenCalled();
  });
});

describe('SearchPanel keyboard path', () => {
  it('enters the result list with Arrow Down, moves with arrows, and selects with Enter', async () => {
    const user = userEvent.setup();
    const onSelectCard = vi.fn();
    renderPanel(onSelectCard);

    const input = screen.getByRole('searchbox', { name: 'Search cards' });
    await user.type(input, 'a');

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /from search results/ }).length).toBeGreaterThan(
        1,
      );
    });

    input.focus();
    await user.keyboard('{ArrowDown}');
    const results = screen.getAllByRole('button', { name: /from search results/ });
    expect(results[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(results[1]).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(results[0]).toHaveFocus();

    await user.keyboard('{End}');
    expect(results[results.length - 1]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(results[0]).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onSelectCard).toHaveBeenCalledTimes(1);
    expect(onSelectCard.mock.calls[0]?.[0]).toMatchObject({ id: expect.any(String) });
  });
});

describe('SearchPanel wiring', () => {
  it('centers and selects the card on the board without writing card or case data', async () => {
    const user = userEvent.setup();
    const repository = seededRepository();
    const store = createBoardStore();
    const cardBefore = await repository.getCard(NOTE_ID);
    const caseBefore = await repository.getCase(CASE_ID);

    render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}`]}>
        <Routes>
          <Route
            path="/case/:caseId"
            element={<CaseBoardPage repository={repository} store={store} />}
          />
          <Route path="/case/:caseId/card/:cardId" element={<h2>Card detail</h2>} />
        </Routes>
      </MemoryRouter>,
    );

    const input = await screen.findByRole('searchbox', { name: 'Search cards' });
    await user.type(input, 'sodium');

    const result = await screen.findByRole('button', {
      name: 'Select Membrane transport from search results',
    });
    await user.click(result);

    const state = store.getState();
    expect(state.selectedCardId).toBe(NOTE_ID);
    expect(state.viewport).toEqual({
      x: MEMBRANE.position.x + 120 - window.innerWidth / 2,
      y: MEMBRANE.position.y + 160 - window.innerHeight / 2,
      scale: 1,
    });
    expect(state.pendingViewport).toEqual(state.viewport);
    expect(state.viewportDirty).toBe(false);
    expect(screen.getByRole('heading', { level: 2, name: 'Case board' })).toHaveFocus();

    expect(await repository.getCard(NOTE_ID)).toEqual(cardBefore);
    expect(await repository.getCase(CASE_ID)).toEqual(caseBefore);
  });

  it('centers a card requested by the card-list search link', async () => {
    const repository = seededRepository();
    const store = createBoardStore();

    render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}?card=${NOTE_ID}`]}>
        <Routes>
          <Route
            path="/case/:caseId"
            element={<CaseBoardPage repository={repository} store={store} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(store.getState().selectedCardId).toBe(NOTE_ID);
    });

    const state = store.getState();
    expect(state.viewport).toEqual({
      x: MEMBRANE.position.x + 120 - window.innerWidth / 2,
      y: MEMBRANE.position.y + 160 - window.innerHeight / 2,
      scale: 1,
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Case board' })).toHaveFocus();
  });

  it('wires search into the card list and sends selection to the board', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}/list`]}>
        <Routes>
          <Route
            path="/case/:caseId/list"
            element={<CardListPage repository={seededRepository()} />}
          />
          <Route path="/case/:caseId" element={<BoardFocusProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 2, name: 'Card list' });
    const input = screen.getByRole('searchbox', { name: 'Search cards' });
    await user.type(input, 'Osmosis');

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /Study notes/ })).not.toBeInTheDocument();
    });
    expect(
      screen.getByText(/The grouped list is hidden while results are shown/i),
    ).toBeInTheDocument();

    await user.click(
      await screen.findByRole('button', { name: 'Select Osmosis from search results' }),
    );

    expect(
      await screen.findByRole('heading', { level: 2, name: `Case board focus ${TOPIC_ID}` }),
    ).toBeInTheDocument();
  });
});

describe('SearchPanel CSS contract', () => {
  const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

  it('keeps every search control at the 44 px target floor', () => {
    const css = readRepositoryFile('src/features/search/SearchPanel.css');

    for (const selector of [
      '.search-panel__chip',
      '.search-panel__result-select',
      '.search-panel__detail-link',
      '.search-panel__active-remove',
    ]) {
      const declarations = declarationsFor(css, selector);
      expect(resolveLengthPx(tokens, declarations.get('min-block-size'))).toBeGreaterThanOrEqual(
        44,
      );
      expect(resolveLengthPx(tokens, declarations.get('min-inline-size'))).toBeGreaterThanOrEqual(
        44,
      );
    }
  });

  it('uses token-driven focus rings, a phone sheet, and reduced-motion branches', () => {
    const css = readRepositoryFile('src/features/search/SearchPanel.css');

    expect(
      declarationsFor(css, '.search-panel__result-select:focus-visible').get('outline'),
    ).toContain('var(--focus-ring-width)');
    expect(declarationsFor(css, '.search-panel__chip:focus-visible').get('outline')).toContain(
      'var(--color-focus-ring)',
    );

    const phone = mediaBody(css, 'max-width: 37.4375rem');
    expect(phone).toContain('.search-panel');
    expect(phone).toContain('min-block-size: 100dvh');

    expect(mediaBody(css, 'prefers-reduced-motion: reduce')).toContain(
      '.search-panel__result-select',
    );
  });

  it('keeps body and result text at AA contrast on its surfaces', () => {
    const surface = resolveColor(tokens, '--color-surface');
    const raised = resolveColor(tokens, '--color-surface-raised');

    for (const token of [
      '--color-ink',
      '--color-ink-muted',
      '--color-heading-ink',
      '--color-link',
      '--color-danger-text',
    ]) {
      expect(contrastRatio(resolveColor(tokens, token), surface)).toBeGreaterThanOrEqual(4.5);
    }

    for (const token of ['--color-ink', '--color-ink-muted', '--color-heading-ink']) {
      expect(contrastRatio(resolveColor(tokens, token), raised)).toBeGreaterThanOrEqual(4.5);
    }

    expect(
      contrastRatio(
        resolveColor(tokens, '--color-selection-ink'),
        resolveColor(tokens, '--color-selection-bg'),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('introduces no raw palette literals and no HTML injection', () => {
    const pattern = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

    for (const file of [
      'src/features/search/SearchPanel.css',
      'src/features/case/CaseBoardPage.css',
      'src/features/case/CardListPanel.css',
    ]) {
      expect(stripComments(readRepositoryFile(file))).not.toMatch(pattern);
    }

    expect(readRepositoryFile('src/features/search/SearchPanel.tsx')).not.toContain(
      'dangerouslySetInnerHTML',
    );
  });
});
