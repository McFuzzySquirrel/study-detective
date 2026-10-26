import 'fake-indexeddb/auto';

import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsePixiAppResult } from '../../src/board/usePixiApp';

const { usePixiAppMock } = vi.hoisted(() => ({ usePixiAppMock: vi.fn() }));

vi.mock('../../src/board/usePixiApp', () => ({
  usePixiApp: usePixiAppMock,
}));

import AppBootstrap, { BOOTSTRAP_MAX_WAIT_MS } from '../../src/app/AppBootstrap';
import { createBoardStore } from '../../src/board/boardStore';
import type { BoardStoreApi } from '../../src/board/boardStore';
import { CaseRepository, InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CaseRepositoryPort } from '../../src/data/caseRepository';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../src/domain/model';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../src/domain/model';
import { CaseBoardPage } from '../../src/features/case/CaseBoardPage';
import { DEMO_CASE_TITLE } from '../../src/features/demo/demoCase';
import { createDemoSeedFlagStore, seedDemoCase } from '../../src/features/demo/seedDemoCase';
import type { DemoSeedFlagStore, SeedDemoCaseResult } from '../../src/features/demo/seedDemoCase';
import { createHintSeenStore } from '../../src/features/onboarding/hints';
import type { HintStorage } from '../../src/features/onboarding/hints';
import { RecallPage } from '../../src/features/recall/RecallPage';
import { createRecallStore } from '../../src/features/recall/recallStore';
import CaseShelfPage from '../../src/features/shelf/CaseShelfPage';
import { closeTestDatabase, openTestDatabase } from '../data/testDatabase';
import { createMemoryStorage, fakeDemoCanvasHarness } from './demoFixtures';
import type { MemoryStorage } from './demoFixtures';

const USER_CASE_ID = '11111111-1111-4111-8111-111111111111';
const DEMO_CASE_ID = '22222222-2222-4222-8222-222222222222';
const CARD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONNECTION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

class MemoryHintStorage implements HintStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function createHintStore(): ReturnType<typeof createHintSeenStore> {
  return createHintSeenStore(new MemoryHintStorage());
}

function readyPixiState(): UsePixiAppResult {
  return {
    status: 'ready',
    error: null,
    contextLost: false,
    viewportSize: { width: 1024, height: 768 },
    retry: vi.fn(),
    recover: vi.fn(),
  };
}

type MatchMediaOptions = {
  readonly coarse?: boolean;
  readonly reducedMotion?: boolean;
};

function installMatchMedia(options: MatchMediaOptions = {}): () => void {
  const original = window.matchMedia;
  const mock = vi.fn((query: string): MediaQueryList => {
    const matches = query.includes('pointer: coarse')
      ? options.coarse === true
      : query.includes('prefers-reduced-motion')
        ? options.reducedMotion === true
        : false;

    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList;
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: mock,
  });

  return () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

let restoreMatchMedia: () => void = () => undefined;

function useMatchMedia(options: MatchMediaOptions = {}): void {
  restoreMatchMedia();
  restoreMatchMedia = installMatchMedia(options);
}

function makeCase(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: USER_CASE_ID,
    title: 'My own case',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    viewport: DEFAULT_VIEWPORT,
    closedAt: null,
    isDemo: false,
    backupPromptedAt: null,
    ...overrides,
  };
}

function makeCard(
  id: string,
  caseId: string,
  type: CardRecord['type'],
  title: string,
  x: number,
  y: number,
): CardRecord {
  return {
    id,
    caseId,
    type,
    title,
    position: { x, y },
    tags: [],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
  };
}

function makeConnection(caseId: string): ConnectionRecord {
  return {
    id: CONNECTION_ID,
    caseId,
    fromCardId: CARD_A,
    toCardId: CARD_B,
    pairKey: buildPairKey(CARD_A, CARD_B),
    type: 'association',
  };
}

function seededRepository(
  options: {
    readonly caseRecord?: CaseRecord;
    readonly cards?: readonly CardRecord[];
    readonly connections?: readonly ConnectionRecord[];
  } = {},
): InMemoryCaseRepository {
  const caseRecord = options.caseRecord ?? makeCase();

  return new InMemoryCaseRepository({
    seed: {
      cases: [caseRecord],
      cards: [...(options.cards ?? [])],
      connections: [...(options.connections ?? [])],
    },
  });
}

function seedFirstRun(value: SeedDemoCaseResult) {
  return vi.fn(() => Promise.resolve(value));
}

function renderBootstrap(
  seedFirstRun: () => Promise<SeedDemoCaseResult>,
  repository: CaseRepositoryPort,
) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/']}>
        <AppBootstrap seedFirstRun={seedFirstRun}>
          <CaseShelfPage repository={repository} />
        </AppBootstrap>
      </MemoryRouter>
    </StrictMode>,
  );
}

function renderBoard(
  repository: CaseRepositoryPort,
  hintStore: ReturnType<typeof createHintSeenStore>,
) {
  const store: BoardStoreApi = createBoardStore();

  const result = render(
    <MemoryRouter initialEntries={[`/case/${USER_CASE_ID}`]}>
      <Routes>
        <Route
          path="/case/:caseId"
          element={<CaseBoardPage repository={repository} store={store} hintStore={hintStore} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  return { store, ...result };
}

function renderRecall(
  repository: CaseRepositoryPort,
  hintStore: ReturnType<typeof createHintSeenStore>,
) {
  return render(
    <MemoryRouter initialEntries={[`/case/${USER_CASE_ID}/recall`]}>
      <Routes>
        <Route
          path="/case/:caseId/recall"
          element={
            <RecallPage
              repository={repository}
              store={createBoardStore()}
              scratchStore={createRecallStore()}
              hintStore={hintStore}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitForBoardReady(): Promise<void> {
  await screen.findByTestId('board-canvas');
  await waitFor(() => {
    expect(screen.getByTestId('board-canvas')).toHaveAttribute('data-board-scene-status', 'ready');
  });
}

beforeEach(() => {
  window.localStorage.clear();
  usePixiAppMock.mockImplementation(() => readyPixiState());
  restoreMatchMedia = installMatchMedia();
});

afterEach(() => {
  cleanup();
  restoreMatchMedia();
  window.localStorage.clear();
});

describe('first-run bootstrap', () => {
  it('seeds one labeled demo case before the shelf renders on a fresh install', async () => {
    const db: NotesDetectiveDatabase = await openTestDatabase('demo-bootstrap-fresh');
    const repository = new CaseRepository(db);
    const storage: MemoryStorage = createMemoryStorage();
    const flagStore = createDemoSeedFlagStore(storage);
    const canvas = fakeDemoCanvasHarness();
    const seed = vi.fn(() => seedDemoCase({ db, flagStore, createCanvas: canvas.factory }));

    try {
      renderBootstrap(seed, repository);

      expect(screen.getByRole('status')).toHaveTextContent('Preparing your case files…');
      expect(screen.queryByRole('heading', { level: 2, name: 'Case shelf' })).toBeNull();

      const demoLink = await screen.findByRole('link', { name: DEMO_CASE_TITLE });
      expect(seed).toHaveBeenCalledTimes(1);
      expect(demoLink).toBeInTheDocument();

      const summary = await repository.getCaseSummary(
        (await repository.listCaseSummaries())[0]?.id ?? '',
      );
      expect(summary).toMatchObject({
        title: DEMO_CASE_TITLE,
        isDemo: true,
        cardCount: 6,
        connectionCount: 5,
        readiness: 'ready',
        looseThreadCount: 0,
      });
      expect(await repository.listCaseSummaries()).toHaveLength(1);
      expect(flagStore.isSet()).toBe(true);

      expect(screen.getByTestId('case-demo-ribbon')).toHaveTextContent('Demo');
      expect(screen.getByText('Demo case — remove it whenever you like.')).toBeInTheDocument();
      // Four pages, each encoded independently at original, display, and
      // thumbnail size.
      expect(canvas.canvases).toHaveLength(12);
    } finally {
      await closeTestDatabase(db);
    }
  });

  it('seeds nothing when a case already exists and still marks the demo flag', async () => {
    const db = await openTestDatabase('demo-bootstrap-existing');
    const repository = new CaseRepository(db);
    const storage = createMemoryStorage();
    const flagStore = createDemoSeedFlagStore(storage);
    const userCase = await repository.createCase({ title: 'My own case' });
    const seed = vi.fn(() =>
      seedDemoCase({
        db,
        flagStore,
        createCanvas: fakeDemoCanvasHarness().factory,
      }),
    );

    try {
      renderBootstrap(seed, repository);

      expect(await screen.findByRole('link', { name: 'My own case' })).toBeInTheDocument();
      await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('link', { name: DEMO_CASE_TITLE })).toBeNull();
      expect(screen.queryByTestId('case-demo-ribbon')).toBeNull();

      const summaries = await repository.listCaseSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        id: userCase.id,
        title: 'My own case',
        isDemo: false,
        cardCount: 0,
      });
      expect(flagStore.isSet()).toBe(true);
    } finally {
      await closeTestDatabase(db);
    }
  });

  it('opens the app when the seed fails so the shelf is never blocked', async () => {
    const seed = vi.fn(() => Promise.reject(new Error('seed failed')));

    render(
      <MemoryRouter>
        <AppBootstrap seedFirstRun={seed}>
          <p>Case shelf is available</p>
        </AppBootstrap>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Case shelf is available')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it('renders the app after an already-seeded result', async () => {
    const seed = seedFirstRun({ seeded: false, reason: 'already-seeded', caseId: null });
    const repository = seededRepository();

    renderBootstrap(seed, repository);

    expect(await screen.findByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible();
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it('opens after the grace period when the seed never settles', async () => {
    vi.useFakeTimers();
    const seed = vi.fn(() => new Promise<SeedDemoCaseResult>(() => undefined));

    try {
      render(
        <MemoryRouter>
          <AppBootstrap seedFirstRun={seed}>
            <p>Case shelf is available</p>
          </AppBootstrap>
        </MemoryRouter>,
      );

      expect(screen.getByRole('status')).toHaveTextContent('Preparing your case files…');
      act(() => {
        vi.advanceTimersByTime(BOOTSTRAP_MAX_WAIT_MS);
      });
      expect(screen.getByText('Case shelf is available')).toBeInTheDocument();
      expect(seed).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('demo shelf label and removal', () => {
  it('labels the demo, removes only the demo through confirmation, and marks the flag', async () => {
    const demoCase = makeCase({ id: DEMO_CASE_ID, title: DEMO_CASE_TITLE, isDemo: true });
    const userCase = makeCase();
    const repository = new InMemoryCaseRepository({
      seed: { cases: [demoCase, userCase] },
    });
    const storage = createMemoryStorage();
    const flagStore: DemoSeedFlagStore = createDemoSeedFlagStore(storage);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CaseShelfPage repository={repository} demoFlagStore={flagStore} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: DEMO_CASE_TITLE })).toBeInTheDocument();
    expect(screen.getByTestId('case-demo-ribbon')).toHaveTextContent('Demo');
    expect(screen.getByText('Demo case — remove it whenever you like.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My own case' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Remove demo ${DEMO_CASE_TITLE}` }));

    const dialog = await screen.findByRole('dialog', { name: /Remove demo case/ });
    expect(dialog).toHaveTextContent('demo case');
    expect(dialog).toHaveTextContent('Your own cases are not touched.');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Remove demo' }));

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: DEMO_CASE_TITLE })).toBeNull();
    });
    expect(screen.getByRole('link', { name: 'My own case' })).toBeInTheDocument();
    expect(screen.getByText(`Demo case removed: ${DEMO_CASE_TITLE}.`)).toBeInTheDocument();
    expect(flagStore.isSet()).toBe(true);

    const summaries = await repository.listCaseSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: USER_CASE_ID, title: 'My own case', isDemo: false });
  });

  it('keeps the ordinary delete wording for a user case', async () => {
    const user = userEvent.setup();
    const repository = seededRepository();

    render(
      <MemoryRouter>
        <CaseShelfPage repository={repository} />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'My own case' });
    await user.click(screen.getByRole('button', { name: 'Delete My own case' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete “My own case”?' });
    expect(dialog).toHaveTextContent('Deletion is permanent.');
    expect(within(dialog).getByRole('button', { name: 'Delete case' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/demo case/i)).toBeNull();
  });
});

describe('contextual board hints', () => {
  it('shows the thread-anchor hint once at two cards, marks it seen, and restores focus', async () => {
    const user = userEvent.setup();
    const hintStore = createHintStore();
    const caseRecord = makeCase();
    const repository = seededRepository({
      caseRecord,
      cards: [
        makeCard(CARD_A, USER_CASE_ID, 'note', 'Photosynthesis', 120, 120),
        makeCard(CARD_B, USER_CASE_ID, 'topic', 'Energy in cells', 460, 240),
      ],
    });

    renderBoard(repository, hintStore);
    await waitForBoardReady();

    const hint = await screen.findByRole('dialog', { name: 'Thread anchor' });
    expect(hint).toHaveFocus();
    expect(hintStore.isSeen('thread-anchor')).toBe(false);

    await user.click(within(hint).getByRole('button', { name: 'Got it' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Thread anchor' })).toBeNull();
    });
    expect(hintStore.isSeen('thread-anchor')).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Case board' })).toHaveFocus();
    });

    cleanup();
    renderBoard(repository, hintStore);
    await waitForBoardReady();
    expect(screen.queryByRole('dialog', { name: 'Thread anchor' })).toBeNull();
  });

  it('waits for two cards before offering the thread-anchor hint', async () => {
    const hintStore = createHintStore();
    const repository = seededRepository({
      cards: [makeCard(CARD_A, USER_CASE_ID, 'topic', 'Only card', 120, 120)],
    });

    renderBoard(repository, hintStore);
    await waitForBoardReady();

    expect(screen.queryByRole('dialog', { name: 'Thread anchor' })).toBeNull();
    expect(hintStore.isSeen('thread-anchor')).toBe(false);
  });

  it('offers the long-press hint only on a coarse pointer after a card is selected', async () => {
    useMatchMedia({ coarse: true });
    const user = userEvent.setup();
    const hintStore = createHintStore();
    const repository = seededRepository({
      cards: [makeCard(CARD_A, USER_CASE_ID, 'topic', 'Only card', 120, 120)],
    });

    const { store } = renderBoard(repository, hintStore);
    await waitForBoardReady();
    expect(screen.queryByRole('dialog', { name: 'Touch long-press' })).toBeNull();

    act(() => {
      store.getState().selectCard(CARD_A);
    });

    const hint = await screen.findByRole('dialog', { name: 'Touch long-press' });
    expect(hint).toHaveFocus();
    await user.click(within(hint).getByRole('button', { name: 'Got it' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Touch long-press' })).toBeNull();
    });
    expect(hintStore.isSeen('long-press')).toBe(true);

    act(() => {
      store.getState().selectCard(null);
      store.getState().selectCard(CARD_A);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Touch long-press' })).toBeNull();
    });
  });

  it('does not offer the long-press hint to a fine pointer', async () => {
    const hintStore = createHintStore();
    const repository = seededRepository({
      cards: [makeCard(CARD_A, USER_CASE_ID, 'topic', 'Only card', 120, 120)],
    });

    const { store } = renderBoard(repository, hintStore);
    await waitForBoardReady();

    act(() => {
      store.getState().selectCard(CARD_A);
    });

    await waitFor(() => expect(store.getState().selectedCardId).toBe(CARD_A));
    expect(screen.queryByRole('dialog', { name: 'Touch long-press' })).toBeNull();
  });

  it('offers the recall hint after the first connection exists and nowhere earlier', async () => {
    const user = userEvent.setup();
    const hintStore = createHintStore();
    const repository = seededRepository({
      cards: [
        makeCard(CARD_A, USER_CASE_ID, 'note', 'Photosynthesis', 120, 120),
        makeCard(CARD_B, USER_CASE_ID, 'topic', 'Energy in cells', 460, 240),
      ],
      connections: [makeConnection(USER_CASE_ID)],
    });

    renderRecall(repository, hintStore);
    await waitForBoardReady();

    const hint = await screen.findByRole('dialog', { name: 'Recall mode' });
    expect(hint).toHaveFocus();
    await user.click(within(hint).getByRole('button', { name: 'Got it' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Recall mode' })).toBeNull();
    });
    expect(hintStore.isSeen('recall')).toBe(true);

    cleanup();
    const emptyConnectionStore = createHintStore();
    const disconnected = seededRepository({
      cards: [
        makeCard(CARD_A, USER_CASE_ID, 'note', 'Photosynthesis', 120, 120),
        makeCard(CARD_B, USER_CASE_ID, 'topic', 'Energy in cells', 460, 240),
      ],
    });

    renderRecall(disconnected, emptyConnectionStore);
    await waitForBoardReady();
    expect(screen.queryByRole('dialog', { name: 'Recall mode' })).toBeNull();
    expect(emptyConnectionStore.isSeen('recall')).toBe(false);
  });
});

describe('hint definitions used by the contextual triggers', () => {
  it('uses the existing copy and never invents a scripted sequence', async () => {
    const hintStore = createHintStore();
    const repository = seededRepository({
      cards: [makeCard(CARD_A, USER_CASE_ID, 'topic', 'Only card', 120, 120)],
    });

    renderBoard(repository, hintStore);
    await waitForBoardReady();

    // No auto-advance: after the only applicable trigger is absent, nothing
    // opens even when the seen set stays empty.
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(hintStore.getSeenHints()).toHaveLength(0);
  });
});
