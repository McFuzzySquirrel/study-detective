import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardStore } from '../../src/board/boardStore';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import { InMemoryConnectionRepository } from '../../src/data/connectionRepository';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../src/domain/model';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../src/domain/model';
import { CaseBoardPage } from '../../src/features/case/CaseBoardPage';
import ConnectionDetail from '../../src/features/connections/ConnectionDetail';
import {
  UNDO_DELETE_CONNECTION_TIMEOUT_MS,
  useUndoDeleteConnection,
} from '../../src/features/connections/useUndoDeleteConnection';
import {
  contrastRatio,
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveColor,
  resolveLengthPx,
} from '../helpers/css-contract';

// The page owns the canvas as a lazy chunk; this suite only exercises the DOM
// inspector, legend, and undo composition that belong to LINK-4. The stub also
// exposes the connection snapshot the page hands to the renderer, so a retype
// is proven to reach the string input without changing the row ID.
vi.mock('../../src/board/BoardCanvas', () => ({
  BoardCanvas: ({
    snapshot,
  }: {
    readonly snapshot: {
      readonly connections?: readonly { readonly id: string; readonly type: string }[];
    };
  }) => (
    <div
      data-testid="board-canvas-stub"
      data-connection-ids={(snapshot.connections ?? [])
        .map((connection) => `${connection.id}:${connection.type}`)
        .join('|')}
    />
  ),
}));

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOPIC_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOTE_SOURCE_CONNECTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOTE_TOPIC_CONNECTION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Connections case',
  subject: 'Biology',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const NOTE: CardRecord = {
  id: NOTE_ID,
  caseId: CASE_ID,
  type: 'note',
  title: 'Membrane transport',
  position: { x: 180, y: 240 },
  tags: ['Cell biology'],
  createdAt: '2026-09-02T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
};

const SOURCE: CardRecord = {
  id: SOURCE_ID,
  caseId: CASE_ID,
  type: 'source',
  title: 'Lecture handout',
  position: { x: 460, y: 240 },
  tags: [],
  createdAt: '2026-09-02T09:05:00.000Z',
  updatedAt: '2026-09-02T09:05:00.000Z',
};

const TOPIC: CardRecord = {
  id: TOPIC_ID,
  caseId: CASE_ID,
  type: 'topic',
  title: 'Osmosis',
  position: { x: 740, y: 240 },
  tags: [],
  createdAt: '2026-09-02T09:10:00.000Z',
  updatedAt: '2026-09-02T09:10:00.000Z',
};

const CARDS: readonly CardRecord[] = [NOTE, SOURCE, TOPIC];

function makeConnection(
  id: string,
  fromCardId: string,
  toCardId: string,
  type: ConnectionRecord['type'] = 'association',
): ConnectionRecord {
  return {
    id,
    caseId: CASE_ID,
    fromCardId,
    toCardId,
    pairKey: buildPairKey(fromCardId, toCardId),
    type,
  };
}

function makeConnectionRepository(
  connections: readonly ConnectionRecord[],
): InMemoryConnectionRepository {
  return new InMemoryConnectionRepository({ cards: CARDS, connections });
}

function makeCaseRepository(connections: readonly ConnectionRecord[]): InMemoryCaseRepository {
  return new InMemoryCaseRepository({
    seed: { cases: [CASE], cards: [...CARDS], connections: [...connections] },
  });
}

const connectionsCss = readRepositoryFile('src/features/connections/connections.css');
const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

function expectMinimumBlockTarget(selector: string): void {
  const styles = declarationsFor(connectionsCss, selector);
  const block = resolveLengthPx(tokens, styles.get('min-block-size'));
  const inline = resolveLengthPx(tokens, styles.get('min-inline-size'));

  expect(block, `${selector} block target`).toBeGreaterThanOrEqual(44);
  expect(inline, `${selector} inline target`).toBeGreaterThanOrEqual(44);
}

interface DetailHarnessProps {
  readonly initial: ConnectionRecord;
  readonly fromCard?: CardRecord;
  readonly toCard?: CardRecord;
  readonly repository: InMemoryConnectionRepository;
  readonly onDelete?: () => Promise<void>;
}

function DetailHarness({
  initial,
  fromCard = NOTE,
  toCard = SOURCE,
  repository,
  onDelete = async () => undefined,
}: DetailHarnessProps) {
  const [connection, setConnection] = useState(initial);

  return (
    <ConnectionDetail
      connection={connection}
      fromCard={fromCard}
      toCard={toCard}
      onRetype={async (type) => {
        const updated = await repository.retype(connection.id, type);
        setConnection(updated);
      }}
      onDelete={onDelete}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ConnectionDetail retyping', () => {
  it('updates the existing row without changing the connection ID', async () => {
    const user = userEvent.setup();
    const connection = makeConnection(NOTE_SOURCE_CONNECTION_ID, NOTE_ID, SOURCE_ID);
    const repository = makeConnectionRepository([connection]);

    render(<DetailHarness initial={connection} repository={repository} />);

    const detail = screen.getByTestId('connection-detail');
    expect(detail).toHaveAttribute('data-connection-id', NOTE_SOURCE_CONNECTION_ID);
    expect(detail).toHaveAttribute('data-current-type', 'association');
    expect(screen.getByRole('radio', { name: /Association/ })).toBeChecked();
    expect(screen.getByText(/Current type:/)).toHaveTextContent('Association');

    await user.click(screen.getByRole('radio', { name: /Provenance/ }));

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Provenance/ })).toBeChecked();
    });
    expect(screen.getByTestId('connection-detail')).toHaveAttribute(
      'data-connection-id',
      NOTE_SOURCE_CONNECTION_ID,
    );
    expect(screen.getByTestId('connection-detail')).toHaveAttribute(
      'data-current-type',
      'provenance',
    );
    expect(screen.getByText(/Current type:/)).toHaveTextContent('Provenance');

    const stored = await repository.listByCase(CASE_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(NOTE_SOURCE_CONNECTION_ID);
    expect(stored[0]?.type).toBe('provenance');
  });

  it('disables provenance for a note-to-topic pair and explains why', () => {
    const connection = makeConnection(NOTE_TOPIC_CONNECTION_ID, NOTE_ID, TOPIC_ID);
    const repository = makeConnectionRepository([connection]);

    render(
      <DetailHarness initial={connection} fromCard={NOTE} toCard={TOPIC} repository={repository} />,
    );

    const provenance = screen.getByRole('radio', { name: /Provenance/ });
    expect(provenance).toBeDisabled();
    expect(provenance).toHaveAccessibleDescription(
      /only available between one Study Note and one Source/i,
    );

    const reason = screen.getByText(/only available between one Study Note and one Source/i);
    expect(reason).toBeVisible();
    expect(reason).toHaveAttribute('data-eligible', 'false');
    expect(screen.getByRole('radio', { name: /Association/ })).toBeChecked();
  });
});

describe('ConnectionDetail deletion', () => {
  it('names both cards and the type, and cancelling keeps the connection', async () => {
    const user = userEvent.setup();
    const connection = makeConnection(NOTE_SOURCE_CONNECTION_ID, NOTE_ID, SOURCE_ID);
    const repository = makeConnectionRepository([connection]);
    const onDelete = vi.fn(async () => undefined);

    render(<DetailHarness initial={connection} repository={repository} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete connection' });
    await user.click(deleteButton);

    const dialog = await screen.findByRole('dialog', { name: 'Delete this connection?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText(/Membrane transport/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Lecture handout/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Association/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Keep connection' }));

    expect(
      screen.queryByRole('dialog', { name: 'Delete this connection?' }),
    ).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId('connection-detail')).toBeInTheDocument();
    await expect(repository.listByCase(CASE_ID)).resolves.toHaveLength(1);
    await waitFor(() => {
      expect(deleteButton).toHaveFocus();
    });
  });

  it('exposes keyboard-operable type controls and the 44 px target', async () => {
    const user = userEvent.setup();
    const connection = makeConnection(NOTE_SOURCE_CONNECTION_ID, NOTE_ID, SOURCE_ID);
    const repository = makeConnectionRepository([connection]);

    render(<DetailHarness initial={connection} repository={repository} />);

    expectMinimumBlockTarget('.connection-detail__label');

    const association = screen.getByRole('radio', { name: /Association/ });
    await user.tab();
    expect(association).toHaveFocus();

    // Native radio groups keep one tab stop and move within the group with the
    // arrow keys; user-event mirrors that browser behaviour.
    await user.keyboard('{ArrowDown}');
    const provenance = screen.getByRole('radio', { name: /Provenance/ });
    expect(provenance).toHaveFocus();
    expect(provenance).toBeChecked();
    await waitFor(() => {
      expect(screen.getByTestId('connection-detail')).toHaveAttribute(
        'data-current-type',
        'provenance',
      );
    });

    const focusRing = declarationsFor(connectionsCss, '.connection-detail__radio:focus-visible');
    expect(focusRing.get('outline')).toContain('var(--focus-ring-width)');
    expect(focusRing.get('outline')).toContain('var(--color-focus-ring)');

    const summaryContrast = contrastRatio(
      resolveColor(tokens, '--color-ink-muted'),
      resolveColor(tokens, '--color-surface'),
    );
    expect(summaryContrast).toBeGreaterThanOrEqual(4.5);
  });
});

describe('CaseBoardPage connection detail and undo', () => {
  it('mounts the selected detail, retypes it, deletes it, and restores the same row', async () => {
    const user = userEvent.setup();
    const connection = makeConnection(NOTE_SOURCE_CONNECTION_ID, NOTE_ID, SOURCE_ID);
    const caseRepository = makeCaseRepository([connection]);
    const connectionRepository = makeConnectionRepository([connection]);
    const store = createBoardStore();

    render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}`]}>
        <Routes>
          <Route
            path="/case/:caseId"
            element={
              <CaseBoardPage
                repository={caseRepository}
                connectionRepository={connectionRepository}
                store={store}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 2, name: 'Case board' });
    expect(screen.getByRole('button', { name: 'Connection legend' })).toBeInTheDocument();

    act(() => {
      store.getState().selectConnection(NOTE_SOURCE_CONNECTION_ID);
    });

    const detail = await screen.findByTestId('connection-detail');
    expect(within(detail).getByText(/Membrane transport/)).toBeInTheDocument();
    expect(within(detail).getByText(/Lecture handout/)).toBeInTheDocument();
    expect(await screen.findByTestId('board-canvas-stub')).toHaveAttribute(
      'data-connection-ids',
      `${NOTE_SOURCE_CONNECTION_ID}:association`,
    );

    await user.click(within(detail).getByRole('radio', { name: /Provenance/ }));

    await waitFor(() => {
      expect(screen.getByTestId('connection-detail')).toHaveAttribute(
        'data-current-type',
        'provenance',
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('board-canvas-stub')).toHaveAttribute(
        'data-connection-ids',
        `${NOTE_SOURCE_CONNECTION_ID}:provenance`,
      );
    });
    await expect(connectionRepository.listByCase(CASE_ID)).resolves.toMatchObject([
      { id: NOTE_SOURCE_CONNECTION_ID, type: 'provenance' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Delete connection' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this connection?' });
    expect(within(dialog).getByText(/Provenance/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete connection' }));

    expect(
      await screen.findByText(/Connection deleted: .*Undo within 8 seconds/),
    ).toBeInTheDocument();
    await waitFor(async () => {
      await expect(connectionRepository.listByCase(CASE_ID)).resolves.toHaveLength(0);
    });
    expect(store.getState().selectedConnectionId).toBeNull();
    expect(screen.queryByTestId('connection-detail')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('board-canvas-stub')).toHaveAttribute('data-connection-ids', '');
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(async () => {
      await expect(connectionRepository.listByCase(CASE_ID)).resolves.toMatchObject([
        { id: NOTE_SOURCE_CONNECTION_ID, type: 'provenance' },
      ]);
      expect(store.getState().selectedConnectionId).toBe(NOTE_SOURCE_CONNECTION_ID);
    });
    await waitFor(() => {
      expect(screen.getByTestId('board-canvas-stub')).toHaveAttribute(
        'data-connection-ids',
        `${NOTE_SOURCE_CONNECTION_ID}:provenance`,
      );
    });

    expect(await screen.findByTestId('connection-detail')).toHaveAttribute(
      'data-connection-id',
      NOTE_SOURCE_CONNECTION_ID,
    );
    await waitFor(() => {
      expect(document.getElementById('connection-detail-title')).toHaveFocus();
    });
    expect(
      screen.queryByText(/Connection deleted: .*Undo within 8 seconds/),
    ).not.toBeInTheDocument();
  });
});

describe('useUndoDeleteConnection', () => {
  it('clears the undo slot when the 8-second window closes', async () => {
    vi.useFakeTimers();
    const connection = makeConnection(NOTE_SOURCE_CONNECTION_ID, NOTE_ID, SOURCE_ID);
    const repository = makeConnectionRepository([connection]);
    const { result } = renderHook(() => useUndoDeleteConnection({ repository }));

    await act(async () => {
      await result.current.deleteWithUndo({
        connection,
        fromTitle: NOTE.title,
        toTitle: SOURCE.title,
      });
    });

    expect(result.current.pending?.connection.id).toBe(NOTE_SOURCE_CONNECTION_ID);
    expect(result.current.message).toContain('Membrane transport');
    expect(result.current.message).toContain('Lecture handout');
    expect(result.current.message).toContain('Association');
    expect(result.current.message).toContain('Undo within 8 seconds');

    act(() => {
      vi.advanceTimersByTime(UNDO_DELETE_CONNECTION_TIMEOUT_MS - 1);
    });
    expect(result.current.pending).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.message).toBeNull();

    let restored = true;
    await act(async () => {
      restored = await result.current.undo();
    });
    expect(restored).toBe(false);
    await expect(repository.listByCase(CASE_ID)).resolves.toHaveLength(0);
  });

  it('replaces the slot on a second delete and cannot restore the first row', async () => {
    const first = makeConnection(NOTE_SOURCE_CONNECTION_ID, NOTE_ID, SOURCE_ID);
    const second = makeConnection(NOTE_TOPIC_CONNECTION_ID, NOTE_ID, TOPIC_ID);
    const repository = makeConnectionRepository([first, second]);
    const { result } = renderHook(() => useUndoDeleteConnection({ repository }));

    await act(async () => {
      await result.current.deleteWithUndo({
        connection: first,
        fromTitle: NOTE.title,
        toTitle: SOURCE.title,
      });
    });
    expect(result.current.pending?.connection.id).toBe(NOTE_SOURCE_CONNECTION_ID);

    await act(async () => {
      await result.current.deleteWithUndo({
        connection: second,
        fromTitle: NOTE.title,
        toTitle: TOPIC.title,
      });
    });
    expect(result.current.pending?.connection.id).toBe(NOTE_TOPIC_CONNECTION_ID);
    expect(result.current.message).toContain('Osmosis');

    let restored = false;
    await act(async () => {
      restored = await result.current.undo();
    });
    expect(restored).toBe(true);

    const stored = await repository.listByCase(CASE_ID);
    expect(stored.map((row) => row.id)).toEqual([NOTE_TOPIC_CONNECTION_ID]);
  });
});
