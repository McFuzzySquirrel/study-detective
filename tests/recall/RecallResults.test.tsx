import 'fake-indexeddb/auto';

import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPairKey } from '../../src/domain/model';
import type { CardRecord, CaseRecord, ConnectionRecord, Viewport } from '../../src/domain/model';
import { createBoardStore } from '../../src/board/boardStore';
import type { BoardStoreApi } from '../../src/board/boardStore';
import { DEFAULT_VIEWPORT } from '../../src/domain/model';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CaseRepositoryPort } from '../../src/data/caseRepository';
import { ConnectionRepository } from '../../src/data/connectionRepository';
import type { RecallComparison } from '../../src/features/recall/compareConnections';
import { compareConnections } from '../../src/features/recall/compareConnections';
import { createRecallStore } from '../../src/features/recall/recallStore';
import type { RecallStoreApi } from '../../src/features/recall/recallStore';
import { recallSummaryAnnouncement } from '../../src/features/recall/RecallSummary';
import { RecallResultOverlay, RecallResults } from '../../src/features/recall/RecallResults';
import type { UsePixiAppResult } from '../../src/board/usePixiApp';
import { readRepositoryFile } from '../helpers/css-contract';

const { usePixiAppMock } = vi.hoisted(() => ({ usePixiAppMock: vi.fn() }));

vi.mock('../../src/board/usePixiApp', () => ({
  usePixiApp: usePixiAppMock,
}));

// Import after the mock so the lazy BoardCanvas resolves with a fake renderer.
import { RecallPage } from '../../src/features/recall/RecallPage';

const CARD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CARD_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CARD_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const CARDS = [
  { id: CARD_A, title: 'Osmosis' },
  { id: CARD_B, title: 'Water potential' },
  { id: CARD_C, title: 'Membrane proteins' },
  { id: CARD_D, title: 'Diffusion' },
] as const;

const OVERLAY_CARDS = [
  { ...CARDS[0], position: { x: 100, y: 100 } },
  { ...CARDS[1], position: { x: 500, y: 100 } },
  { ...CARDS[2], position: { x: 900, y: 100 } },
  { ...CARDS[3], position: { x: 1300, y: 100 } },
] as const;

function mixedComparison(): RecallComparison {
  return compareConnections(
    [
      { fromCardId: CARD_A, toCardId: CARD_B, type: 'provenance' },
      { fromCardId: CARD_B, toCardId: CARD_C, type: 'association' },
      { fromCardId: CARD_C, toCardId: CARD_D, type: 'association' },
    ],
    [
      // Reversed and wrong type: remembered plus one mismatch.
      { fromCardId: CARD_B, toCardId: CARD_A, type: 'association' },
      // Reversed exact type: remembered.
      { fromCardId: CARD_C, toCardId: CARD_B, type: 'association' },
      // No saved pair: extra.
      { fromCardId: CARD_A, toCardId: CARD_D, type: 'association' },
    ],
  );
}

function emptyScratchComparison(): RecallComparison {
  return compareConnections([{ fromCardId: CARD_A, toCardId: CARD_B, type: 'association' }], []);
}

function expectNoScoreWording(element: HTMLElement): void {
  expect(element).not.toHaveTextContent(/\b(score|percentage|grade|streak|rank|ranking)\b/i);
  expect(element.textContent ?? '').not.toMatch(/%/);
}

beforeEach(() => {
  usePixiAppMock.mockImplementation(() => readyState());
});

afterEach(() => {
  cleanup();
});

describe('RecallSummary and RecallResults', () => {
  it('lists all four groups by card title and count with an explanatory mismatch label', () => {
    const comparison = mixedComparison();

    render(<RecallResults comparison={comparison} cards={CARDS} />);

    const heading = screen.getByRole('heading', { level: 3, name: 'Recall results' });
    expect(heading).toHaveFocus();

    const results = screen.getByTestId('recall-results');
    expect(results).toHaveAttribute('data-remembered-count', '2');
    expect(results).toHaveAttribute('data-missed-count', '1');
    expect(results).toHaveAttribute('data-extra-count', '1');
    expect(results).toHaveAttribute('data-type-mismatch-count', '1');

    const remembered = screen.getByTestId('recall-summary-remembered');
    expect(remembered).toHaveAttribute('data-count', '2');
    expect(within(remembered).getByRole('list', { name: 'Remembered pairs' })).toHaveTextContent(
      'Osmosis',
    );
    expect(within(remembered).getByRole('list', { name: 'Remembered pairs' })).toHaveTextContent(
      'Water potential',
    );
    expect(within(remembered).getByRole('list', { name: 'Remembered pairs' })).toHaveTextContent(
      'Provenance',
    );

    const missed = screen.getByTestId('recall-summary-missed');
    expect(missed).toHaveAttribute('data-count', '1');
    expect(within(missed).getByRole('list', { name: 'Missed pairs' })).toHaveTextContent(
      'Membrane proteins',
    );
    expect(within(missed).getByRole('list', { name: 'Missed pairs' })).toHaveTextContent(
      'Diffusion',
    );

    const extra = screen.getByTestId('recall-summary-extra');
    expect(extra).toHaveAttribute('data-count', '1');
    expect(within(extra).getByRole('list', { name: 'Extra pairs' })).toHaveTextContent('Osmosis');
    expect(within(extra).getByRole('list', { name: 'Extra pairs' })).toHaveTextContent('Diffusion');

    const mismatch = screen.getByTestId('recall-summary-typeMismatch');
    expect(mismatch).toHaveAttribute('data-count', '1');
    const label = within(mismatch).getByTestId('recall-type-mismatch-label');
    expect(label).toHaveTextContent('Association drawn / Provenance actual');
    expect(label).toHaveAttribute('data-expected-type', 'provenance');
    expect(label).toHaveAttribute('data-actual-type', 'association');
    expect(mismatch).toHaveTextContent('Remembered because the pair matches');

    expectNoScoreWording(results);
  });

  it('explains an empty scratch layer and lists every saved pair as missed', () => {
    render(<RecallResults comparison={emptyScratchComparison()} cards={CARDS} />);

    expect(screen.getByTestId('recall-summary-empty-scratch')).toHaveTextContent(
      'No scratch connections were drawn',
    );
    expect(screen.getByTestId('recall-summary-remembered')).toHaveAttribute('data-count', '0');
    expect(screen.getByTestId('recall-summary-missed')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('recall-summary-extra')).toHaveAttribute('data-count', '0');
    expect(screen.getByTestId('recall-summary-typeMismatch')).toHaveAttribute('data-count', '0');

    const missed = screen.getByTestId('recall-summary-missed');
    expect(within(missed).getByRole('list', { name: 'Missed pairs' })).toHaveTextContent('Osmosis');
    expect(within(missed).getByRole('list', { name: 'Missed pairs' })).toHaveTextContent(
      'Water potential',
    );
    expectNoScoreWording(screen.getByTestId('recall-results'));
  });

  it('moves focus to the heading and leaves the document tab order free', async () => {
    const user = userEvent.setup();

    render(
      <>
        <button type="button">Before results</button>
        <RecallResults comparison={mixedComparison()} cards={CARDS} />
        <button type="button">After results</button>
      </>,
    );

    const heading = screen.getByRole('heading', { level: 3, name: 'Recall results' });
    expect(heading).toHaveFocus();

    // Every group is a named list, so a keyboard or screen-reader reader can
    // reach the content without the canvas.
    expect(screen.getAllByRole('list')).toHaveLength(4);

    await user.tab();
    expect(screen.getByRole('button', { name: 'After results' })).toHaveFocus();
    expect(heading).not.toHaveFocus();
  });

  it('announces counts and pair names without a score', () => {
    const comparison = mixedComparison();
    const announcement = recallSummaryAnnouncement(comparison);

    expect(announcement).toContain('2 pairs remembered');
    expect(announcement).toContain('1 pair missed');
    expect(announcement).toContain('1 pair extra');
    expect(announcement).toContain('1 pair with a different relationship type');
    expect(announcement).not.toMatch(/score|percentage|grade|streak|rank|%/i);
  });
});

describe('RecallResultOverlay', () => {
  it('marks remembered, missed, extra, and mismatched pairs and hides itself from AT', () => {
    render(
      <RecallResultOverlay
        comparison={mixedComparison()}
        cards={OVERLAY_CARDS}
        viewport={{ x: 0, y: 0, scale: 1 }}
      />,
    );

    const overlay = screen.getByTestId('recall-overlay');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toHaveAttribute('data-marker-count', '5');
    expect(overlay).toHaveAttribute('data-outline-count', '2');

    const markers = screen.getAllByTestId('recall-overlay-marker');
    expect(markers).toHaveLength(5);
    expect(markers.filter((marker) => marker.dataset.resultKind === 'remembered')).toHaveLength(2);
    expect(markers.filter((marker) => marker.dataset.resultKind === 'missed')).toHaveLength(1);
    expect(markers.filter((marker) => marker.dataset.resultKind === 'extra')).toHaveLength(1);
    expect(markers.filter((marker) => marker.dataset.resultKind === 'mismatch')).toHaveLength(1);

    expect(screen.getAllByTestId('recall-overlay-outline')).toHaveLength(2);
    const mismatch = markers.find((marker) => marker.dataset.resultKind === 'mismatch');
    expect(mismatch).toHaveTextContent('Association drawn / Provenance actual');
  });

  it('records reduced motion and its stylesheet removes the entrance animation', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    try {
      render(
        <RecallResultOverlay
          comparison={mixedComparison()}
          cards={OVERLAY_CARDS}
          viewport={{ x: 0, y: 0, scale: 1 }}
        />,
      );

      expect(screen.getByTestId('recall-overlay')).toHaveAttribute('data-reduced-motion', 'true');
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }

    const css = readRepositoryFile('src/features/recall/recall.css');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.recall-overlay__marker,[\s\S]*\.recall-overlay__outline[\s\S]*animation:\s*none/,
    );
  });
});

/* ------------------------------------------------------------------------- */
/* RecallPage integration                                                    */
/* ------------------------------------------------------------------------- */

const CASE_ID = '99999999-9999-4999-8999-999999999999';
const STORED_VIEWPORT: Viewport = { x: 11, y: 22, scale: 1.25 };

const CASE_RECORD: CaseRecord = {
  id: CASE_ID,
  title: 'Recall results case',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: STORED_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const CARD_RECORDS: readonly CardRecord[] = [
  {
    id: CARD_A,
    caseId: CASE_ID,
    type: 'topic',
    title: 'Osmosis',
    position: { x: 100, y: 100 },
    tags: [],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
  },
  {
    id: CARD_B,
    caseId: CASE_ID,
    type: 'note',
    title: 'Water potential',
    position: { x: 500, y: 200 },
    tags: [],
    createdAt: '2026-09-02T09:05:00.000Z',
    updatedAt: '2026-09-02T09:05:00.000Z',
  },
];

const CONNECTIONS: readonly ConnectionRecord[] = [
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    caseId: CASE_ID,
    fromCardId: CARD_A,
    toCardId: CARD_B,
    pairKey: buildPairKey(CARD_A, CARD_B),
    type: 'association',
  },
];

function readyState(): UsePixiAppResult {
  return {
    status: 'ready',
    error: null,
    contextLost: false,
    viewportSize: { width: 1024, height: 768 },
    retry: vi.fn(),
    recover: vi.fn(),
  };
}

function makeRepository(): InMemoryCaseRepository {
  return new InMemoryCaseRepository({
    seed: {
      cases: [CASE_RECORD],
      cards: [...CARD_RECORDS],
      connections: [...CONNECTIONS],
    },
  });
}

function writeSpies(repository: CaseRepositoryPort) {
  const methods = [
    'createCase',
    'updateCase',
    'saveViewport',
    'createCard',
    'createCardWithAttachments',
    'replaceCardAttachments',
    'updateCard',
    'deleteCard',
    'restoreCardDeletion',
    'deleteCase',
  ] as const;

  return methods.map((method) => vi.spyOn(repository, method));
}

function storageSpies() {
  return [
    vi.spyOn(IDBFactory.prototype, 'open'),
    vi.spyOn(IDBDatabase.prototype, 'transaction'),
    vi.spyOn(IDBObjectStore.prototype, 'add'),
    vi.spyOn(IDBObjectStore.prototype, 'put'),
    vi.spyOn(IDBObjectStore.prototype, 'delete'),
    vi.spyOn(IDBObjectStore.prototype, 'clear'),
    vi.spyOn(Storage.prototype, 'setItem'),
    vi.spyOn(Storage.prototype, 'removeItem'),
    vi.spyOn(Storage.prototype, 'clear'),
    vi.spyOn(ConnectionRepository.prototype, 'create'),
    vi.spyOn(ConnectionRepository.prototype, 'retype'),
    vi.spyOn(ConnectionRepository.prototype, 'delete'),
    vi.spyOn(ConnectionRepository.prototype, 'deleteByCard'),
    vi.spyOn(ConnectionRepository.prototype, 'restore'),
  ];
}

interface RenderOptions {
  readonly repository?: CaseRepositoryPort;
  readonly store?: BoardStoreApi;
  readonly scratchStore?: RecallStoreApi;
}

function renderRecall(options: RenderOptions = {}) {
  const repository = options.repository ?? makeRepository();
  const store = options.store ?? createBoardStore(DEFAULT_VIEWPORT);
  const scratchStore = options.scratchStore ?? createRecallStore();

  return render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}/recall`]}>
      <Routes>
        <Route path="/case/:caseId" element={<h2>Case board route</h2>} />
        <Route
          path="/case/:caseId/recall"
          element={<RecallPage repository={repository} store={store} scratchStore={scratchStore} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitForBoard(): Promise<void> {
  await screen.findByTestId('board-canvas');
  await waitFor(() => {
    expect(screen.getByTestId('board-canvas')).toHaveAttribute('data-board-scene-status', 'ready');
  });
}

describe('RecallPage results integration', () => {
  it('renders results after Check, announces them, and keeps toolbar controls available', async () => {
    const repository = makeRepository();
    const writes = writeSpies(repository);
    const storage = storageSpies();
    const scratchStore = createRecallStore();
    scratchStore.getState().addScratchConnection({ fromCardId: CARD_B, toCardId: CARD_A });

    renderRecall({ repository, scratchStore });
    await waitForBoard();

    expect(screen.queryByTestId('recall-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recall-overlay')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    const results = await screen.findByTestId('recall-results');
    expect(screen.getByTestId('recall-page')).toHaveAttribute(
      'data-recall-results-visible',
      'true',
    );
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-remembered-count', '1');
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-missed-count', '0');

    const resultsHeading = within(results).getByRole('heading', {
      level: 3,
      name: 'Recall results',
    });
    expect(resultsHeading).toHaveFocus();
    expect(
      within(screen.getByTestId('recall-summary-remembered')).getByRole('list', {
        name: 'Remembered pairs',
      }),
    ).toHaveTextContent('Osmosis');
    expect(screen.getByTestId('recall-overlay')).toHaveAttribute('data-marker-count', '1');

    // The persistent live region receives the count summary.
    expect(screen.getByTestId('recall-announcement')).toHaveTextContent('1 pair remembered');
    expect(screen.getByTestId('recall-announcement')).toHaveTextContent('0 pairs missed');

    // The toolbar is still mounted and usable after Check.
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset scratch' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Exit recall' })).toBeEnabled();

    // Reset clears the result surfaces but keeps the recall route alive.
    fireEvent.click(screen.getByRole('button', { name: 'Reset scratch' }));
    expect(screen.queryByTestId('recall-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recall-overlay')).not.toBeInTheDocument();
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-checked', 'false');
    expect(screen.getByTestId('recall-announcement')).toBeEmptyDOMElement();

    for (const spy of [...writes, ...storage]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('renders an empty-scratch check as missed pairs without writing storage', async () => {
    const repository = makeRepository();
    const writes = writeSpies(repository);
    const storage = storageSpies();

    renderRecall({ repository });
    await waitForBoard();

    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByTestId('recall-summary-empty-scratch')).toHaveTextContent(
      'No scratch connections were drawn',
    );
    expect(screen.getByTestId('recall-summary-missed')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('recall-summary-remembered')).toHaveAttribute('data-count', '0');
    expect(screen.getByTestId('recall-announcement')).toHaveTextContent(
      'No scratch connections were drawn',
    );
    expectNoScoreWording(screen.getByTestId('recall-results'));

    for (const spy of [...writes, ...storage]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
