import 'fake-indexeddb/auto';

import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardStore } from '../../src/board/boardStore';
import type { BoardStoreApi } from '../../src/board/boardStore';
import { worldToScreen } from '../../src/board/viewport';
import type { Viewport } from '../../src/domain/model';
import { buildPairKey, DEFAULT_VIEWPORT } from '../../src/domain/model';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../src/domain/model';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CaseRepositoryPort } from '../../src/data/caseRepository';
import { ConnectionRepository } from '../../src/data/connectionRepository';
import { createRecallStore } from '../../src/features/recall/recallStore';
import type { RecallStoreApi } from '../../src/features/recall/recallStore';
import type { UsePixiAppResult } from '../../src/board/usePixiApp';

const { usePixiAppMock } = vi.hoisted(() => ({ usePixiAppMock: vi.fn() }));

vi.mock('../../src/board/usePixiApp', () => ({
  usePixiApp: usePixiAppMock,
}));

// Import after the mock so the lazy BoardCanvas resolves to the real DOM
// component with a fake renderer boundary, not a PixiJS application.
import { RecallPage } from '../../src/features/recall/RecallPage';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const CARD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONNECTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const STORED_VIEWPORT: Viewport = { x: 11, y: 22, scale: 1.25 };

const CASE_RECORD: CaseRecord = {
  id: CASE_ID,
  title: 'Membrane transport',
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
    id: CONNECTION_ID,
    caseId: CASE_ID,
    fromCardId: CARD_A,
    toCardId: CARD_B,
    pairKey: buildPairKey(CARD_A, CARD_B),
    type: 'association',
  },
];

const TRUTH_PAIR_KEY = buildPairKey(CARD_A, CARD_B);

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

interface RenderOptions {
  readonly repository?: CaseRepositoryPort;
  readonly store?: BoardStoreApi;
  readonly scratchStore?: RecallStoreApi;
}

function renderRecall(options: RenderOptions = {}) {
  const repository = options.repository ?? makeRepository();
  const store = options.store ?? createBoardStore(DEFAULT_VIEWPORT);
  const scratchStore = options.scratchStore ?? createRecallStore();

  const result = render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}/recall`]}>
      <Routes>
        <Route
          path="/case/:caseId"
          element={
            <div>
              <h2>Case board route</h2>
              <Link to={`/case/${CASE_ID}/recall`}>Recall again</Link>
            </div>
          }
        />
        <Route
          path="/case/:caseId/recall"
          element={<RecallPage repository={repository} store={store} scratchStore={scratchStore} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  return { ...result, repository, store, scratchStore };
}

function firePointer(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: {
    readonly clientX: number;
    readonly clientY: number;
    readonly pointerId?: number;
    readonly buttons?: number;
  },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.assign(event, {
    pointerId: init.pointerId ?? 1,
    pointerType: 'mouse',
    button: 0,
    buttons: init.buttons ?? (type === 'pointerup' ? 0 : 1),
    clientX: init.clientX,
    clientY: init.clientY,
  });
  fireEvent(element, event);
}

function bodyPoint(card: CardRecord, viewport: Viewport): { x: number; y: number } {
  return worldToScreen({ x: card.position.x + 40, y: card.position.y + 40 }, viewport);
}

function anchorPoint(card: CardRecord, viewport: Viewport): { x: number; y: number } {
  return worldToScreen({ x: card.position.x + 240, y: card.position.y + 104 }, viewport);
}

async function waitForBoard(): Promise<void> {
  await screen.findByTestId('board-canvas');
  await waitFor(() => {
    expect(screen.getByTestId('board-canvas')).toHaveAttribute('data-board-scene-status', 'ready');
  });
}

/** Draw a reversed scratch pair: B's anchor to A's body. */
async function drawReversedScratch(
  store: BoardStoreApi,
  from: CardRecord,
  to: CardRecord,
): Promise<void> {
  const host = screen.getByTestId('board-canvas-host');
  await waitFor(() => {
    expect(store.getState().pendingViewport).not.toBeNull();
  });

  const viewport = store.getState().viewport;
  const fromBody = bodyPoint(from, viewport);
  firePointer(host, 'pointermove', {
    clientX: fromBody.x,
    clientY: fromBody.y,
    buttons: 0,
  });

  await waitFor(() => {
    expect(screen.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-anchor-card-id',
      from.id,
    );
  });

  const anchor = anchorPoint(from, viewport);
  const target = bodyPoint(to, viewport);

  firePointer(host, 'pointerdown', {
    clientX: anchor.x,
    clientY: anchor.y,
    pointerId: 7,
  });
  firePointer(host, 'pointermove', {
    clientX: target.x,
    clientY: target.y,
    pointerId: 7,
  });
  firePointer(host, 'pointerup', {
    clientX: target.x,
    clientY: target.y,
    pointerId: 7,
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

beforeEach(() => {
  usePixiAppMock.mockImplementation(() => readyState());
});

afterEach(() => {
  cleanup();
});

describe('RecallPage entry and camera', () => {
  it('hides truth strings, keeps the cards, and fits in memory without writing', async () => {
    const repository = makeRepository();
    const writes = writeSpies(repository);
    const storage = storageSpies();
    const store = createBoardStore(DEFAULT_VIEWPORT);

    renderRecall({ repository, store });
    await waitForBoard();

    const board = screen.getByTestId('board-canvas');
    expect(board).toHaveAttribute('data-board-mode', 'recall');
    expect(board).toHaveAttribute('data-board-card-count', '2');
    expect(board).toHaveAttribute('data-board-connection-count', '0');
    expect(board).toHaveAttribute('data-board-scratch-count', '0');

    const positions = JSON.parse(board.getAttribute('data-board-card-positions') ?? '[]') as Array<{
      id: string;
      x: number;
      y: number;
    }>;
    expect(positions.map((position) => position.id)).toEqual([CARD_A, CARD_B]);

    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '0');
    expect(screen.getByTestId('recall-scratch-count')).toHaveTextContent('Scratch 0 connections');

    // The fit is temporary: the saved viewport is byte-for-byte intact and the
    // recall camera is exposed through pendingViewport instead.
    await waitFor(() => {
      expect(store.getState().pendingViewport).not.toBeNull();
    });
    expect(store.getState().storedViewport).toEqual(STORED_VIEWPORT);
    expect(store.getState().viewportDirty).toBe(false);
    expect(store.getState().mode).toBe('recall');

    expect(usePixiAppMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canvasLabel: expect.stringMatching(/Recall board canvas/),
        snapshot: expect.objectContaining({ connections: [], caseId: CASE_ID }),
      }),
    );

    for (const spy of [...writes, ...storage]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('RecallPage scratch drawing', () => {
  it('draws a reversed pair, checks it, removes it, resets, and exits with confirmation', async () => {
    const repository = makeRepository();
    const writes = writeSpies(repository);
    const storage = storageSpies();
    const store = createBoardStore(DEFAULT_VIEWPORT);
    const scratchStore = createRecallStore();

    renderRecall({ repository, store, scratchStore });
    await waitForBoard();

    await drawReversedScratch(store, CARD_RECORDS[1] as CardRecord, CARD_RECORDS[0] as CardRecord);

    await waitFor(() => {
      expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '1');
    });

    expect(scratchStore.getState().scratchConnections).toHaveLength(1);
    expect(scratchStore.getState().scratchConnections[0]?.id).toBe(TRUTH_PAIR_KEY);
    expect(screen.getByTestId('board-canvas')).toHaveAttribute('data-board-scratch-count', '1');
    expect(screen.getByTestId('recall-scratch-count')).toHaveTextContent('Scratch 1 connection');

    const item = screen.getByRole('list', { name: 'Scratch connections' });
    expect(item).toHaveTextContent(/Osmosis/);
    expect(item).toHaveTextContent(/Water potential/);

    // Check is a pure comparison: the reversed pair counts as remembered.
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-checked', 'true');
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-remembered-count', '1');
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-missed-count', '0');
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-extra-count', '0');
    expect(screen.getByTestId('recall-page')).toHaveAttribute(
      'data-recall-type-mismatch-count',
      '0',
    );

    // Removing one scratch string clears the check and leaves the mode alive.
    fireEvent.click(
      screen.getByRole('button', {
        name: /Remove scratch connection between Osmosis and Water potential/,
      }),
    );
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '0');
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-checked', 'false');
    expect(scratchStore.getState().scratchConnections).toEqual([]);

    // Draw again, check, then reset: reset stays in recall and empties both the
    // scratch layer and the check state.
    await drawReversedScratch(store, CARD_RECORDS[1] as CardRecord, CARD_RECORDS[0] as CardRecord);
    await waitFor(() => {
      expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '1');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset scratch' }));

    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '0');
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-checked', 'false');
    expect(screen.getByRole('heading', { level: 2, name: 'Recall' })).toBeInTheDocument();
    expect(scratchStore.getState().scratchConnections).toEqual([]);

    // Exit with non-empty scratch asks first. Keep practising leaves the mode.
    await drawReversedScratch(store, CARD_RECORDS[1] as CardRecord, CARD_RECORDS[0] as CardRecord);
    await waitFor(() => {
      expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Exit recall' }));
    const dialog = screen.getByRole('dialog', { name: 'Exit recall?' });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep practising' }));
    expect(screen.queryByRole('dialog', { name: 'Exit recall?' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Recall' })).toBeInTheDocument();
    expect(scratchStore.getState().scratchConnections).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Exit recall' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and exit' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Case board route' }),
    ).toBeInTheDocument();
    expect(scratchStore.getState().scratchConnections).toEqual([]);

    for (const spy of [...writes, ...storage]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('RecallPage discard lifecycle', () => {
  it('discards scratch on a route change without a blocking confirmation', async () => {
    const store = createBoardStore(DEFAULT_VIEWPORT);
    const scratchStore = createRecallStore();

    renderRecall({ store, scratchStore });
    await waitForBoard();

    await drawReversedScratch(store, CARD_RECORDS[1] as CardRecord, CARD_RECORDS[0] as CardRecord);
    await waitFor(() => {
      expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '1');
    });

    fireEvent.click(screen.getByRole('link', { name: 'Back to case board' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Case board route' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(scratchStore.getState().scratchConnections).toEqual([]);
    expect(store.getState().mode).toBe('browse');

    fireEvent.click(screen.getByRole('link', { name: 'Recall again' }));
    await waitForBoard();
    expect(screen.getByTestId('recall-page')).toHaveAttribute('data-recall-scratch-count', '0');
  });
});
