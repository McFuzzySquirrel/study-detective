import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardStore } from '../../src/board/boardStore';
import { InMemoryConnectionRepository } from '../../src/data/connectionRepository';
import type { ConnectionRepositoryPort } from '../../src/data/connectionRepository';
import type { CardType, ConnectionRecord } from '../../src/domain/model';
import { buildPairKey } from '../../src/domain/model';
import { ConnectionTypeMenu } from '../../src/features/connections/ConnectionTypeMenu';
import {
  DUPLICATE_CONNECTION_MESSAGE,
  EMPTY_CONNECTION_MESSAGE,
  PROVENANCE_INELIGIBLE_REASON,
  SELF_CONNECTION_MESSAGE,
  useCreateConnection,
} from '../../src/features/connections/useCreateConnection';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '55555555-5555-4555-8555-555555555555';

interface TestCard {
  readonly id: string;
  readonly caseId: string;
  readonly type: CardType;
  readonly title: string;
}

const CARDS: readonly TestCard[] = [
  { id: NOTE_ID, caseId: CASE_ID, type: 'note', title: 'Membrane transport' },
  { id: SOURCE_ID, caseId: CASE_ID, type: 'source', title: 'Lecture handout' },
  { id: TOPIC_ID, caseId: CASE_ID, type: 'topic', title: 'Osmosis' },
];

function makeConnection(
  type: ConnectionRecord['type'] = 'association',
  fromCardId = NOTE_ID,
  toCardId = TOPIC_ID,
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

function setup(
  options: {
    readonly connections?: readonly ConnectionRecord[];
    readonly repository?: ConnectionRepositoryPort;
    readonly onConnectionCreated?: (connection: ConnectionRecord) => void;
    readonly onConnectionChanged?: (connection: ConnectionRecord) => void;
  } = {},
) {
  const repository =
    options.repository ??
    new InMemoryConnectionRepository({
      cards: CARDS,
      connections: options.connections ?? [],
    });
  const store = createBoardStore();
  const onConnectionCreated = options.onConnectionCreated ?? vi.fn();
  const onConnectionChanged = options.onConnectionChanged ?? vi.fn();

  const hook = renderHook(() =>
    useCreateConnection({
      caseId: CASE_ID,
      cards: CARDS,
      connections: options.connections ?? [],
      repository,
      store,
      onConnectionCreated,
      onConnectionChanged,
    }),
  );

  return { ...hook, repository, store, onConnectionCreated, onConnectionChanged };
}

afterEach(() => {
  cleanup();
});

describe('creating a connection', () => {
  it('creates exactly one association by default and opens the type menu', async () => {
    const { result, repository, store, onConnectionCreated } = setup();

    let outcome: Awaited<ReturnType<typeof result.current.requestConnection>> | undefined;
    await act(async () => {
      outcome = await result.current.requestConnection({
        fromCardId: NOTE_ID,
        toCardId: TOPIC_ID,
        point: { x: 420, y: 260 },
      });
    });

    expect(outcome?.status).toBe('created');
    expect(outcome?.connection?.type).toBe('association');

    const stored = await repository.listByCase(CASE_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.type).toBe('association');
    expect(stored[0]?.id).toBe(outcome?.connection?.id);

    expect(onConnectionCreated).toHaveBeenCalledTimes(1);
    expect(store.getState().selectedConnectionId).toBe(stored[0]?.id);
    expect(result.current.menu).toMatchObject({
      connectionId: stored[0]?.id,
      type: 'association',
      fromCardId: NOTE_ID,
      toCardId: TOPIC_ID,
      provenanceEligible: false,
    });
    expect(result.current.menu?.provenanceReason).toContain('one Study Note and one Source');
    expect(result.current.busy).toBe(false);
  });

  it('uses an eligible Note-to-Source pair for provenance', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.requestConnection({ fromCardId: NOTE_ID, toCardId: SOURCE_ID });
    });

    expect(result.current.menu?.provenanceEligible).toBe(true);
    expect(result.current.menu?.type).toBe('association');
  });
});

describe('duplicate and self handling', () => {
  it('selects the existing connection without a write when the pair is already in the snapshot', async () => {
    const existing = makeConnection('association', NOTE_ID, SOURCE_ID);
    const repository = new InMemoryConnectionRepository({
      cards: CARDS,
      connections: [existing],
    });
    const createSpy = vi.spyOn(repository, 'create');
    const { result, store } = setup({ repository, connections: [existing] });

    let outcome: Awaited<ReturnType<typeof result.current.requestConnection>> | undefined;
    await act(async () => {
      outcome = await result.current.requestConnection({
        fromCardId: SOURCE_ID,
        toCardId: NOTE_ID,
      });
    });

    expect(outcome?.status).toBe('duplicate');
    expect(outcome?.connection?.id).toBe(existing.id);
    expect(createSpy).not.toHaveBeenCalled();
    expect(store.getState().selectedConnectionId).toBe(existing.id);
    expect(result.current.feedback?.message).toBe(DUPLICATE_CONNECTION_MESSAGE);
    expect(result.current.menu).toBeNull();
    await expect(repository.listByCase(CASE_ID)).resolves.toHaveLength(1);
  });

  it('handles a repository duplicate result and still never creates a second row', async () => {
    const existing = makeConnection('association', NOTE_ID, SOURCE_ID);
    const repository = new InMemoryConnectionRepository({
      cards: CARDS,
      connections: [existing],
    });
    const createSpy = vi.spyOn(repository, 'create');
    // The page snapshot is stale, so the pre-check misses and the repository
    // returns its duplicate result.
    const { result, store, onConnectionChanged } = setup({ repository, connections: [] });

    let outcome: Awaited<ReturnType<typeof result.current.requestConnection>> | undefined;
    await act(async () => {
      outcome = await result.current.requestConnection({
        fromCardId: NOTE_ID,
        toCardId: SOURCE_ID,
      });
    });

    expect(outcome?.status).toBe('duplicate');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(store.getState().selectedConnectionId).toBe(existing.id);
    expect(result.current.feedback?.message).toBe(DUPLICATE_CONNECTION_MESSAGE);
    expect(onConnectionChanged).toHaveBeenCalledWith(existing);
    await expect(repository.listByCase(CASE_ID)).resolves.toHaveLength(1);
  });

  it('rejects a self-link and empty cork with feedback and no write', async () => {
    const { result, repository } = setup();
    const createSpy = vi.spyOn(repository, 'create');

    await act(async () => {
      await result.current.requestConnection({
        fromCardId: NOTE_ID,
        toCardId: NOTE_ID,
      });
    });
    expect(result.current.feedback?.message).toBe(SELF_CONNECTION_MESSAGE);

    await act(async () => {
      await result.current.requestConnection({
        fromCardId: NOTE_ID,
        toCardId: null,
      });
    });
    expect(result.current.feedback?.message).toBe(EMPTY_CONNECTION_MESSAGE);

    expect(createSpy).not.toHaveBeenCalled();
    await expect(repository.listByCase(CASE_ID)).resolves.toHaveLength(0);
  });
});

describe('changing the type after creation', () => {
  it('retypes the same row and keeps its id', async () => {
    const { result, repository, store, onConnectionChanged } = setup();
    const retypeSpy = vi.spyOn(repository, 'retype');
    const createSpy = vi.spyOn(repository, 'create');

    let connectionId = '';
    await act(async () => {
      const created = await result.current.requestConnection({
        fromCardId: NOTE_ID,
        toCardId: SOURCE_ID,
      });
      connectionId = created.connection?.id ?? '';
    });

    expect(result.current.menu?.type).toBe('association');
    expect(store.getState().selectedConnectionId).toBe(connectionId);

    await act(async () => {
      await result.current.selectConnectionType('provenance');
    });

    expect(retypeSpy).toHaveBeenCalledWith(connectionId, 'provenance');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(onConnectionChanged).toHaveBeenCalledTimes(1);

    const stored = await repository.listByCase(CASE_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(connectionId);
    expect(stored[0]?.type).toBe('provenance');
    expect(result.current.menu?.connectionId).toBe(connectionId);
    expect(result.current.menu?.type).toBe('provenance');
  });

  it('does not retype to provenance for an ineligible pair and announces why', async () => {
    const { result, repository } = setup();
    const retypeSpy = vi.spyOn(repository, 'retype');

    await act(async () => {
      await result.current.requestConnection({ fromCardId: NOTE_ID, toCardId: TOPIC_ID });
    });

    expect(result.current.menu?.provenanceEligible).toBe(false);

    await act(async () => {
      await result.current.selectConnectionType('provenance');
    });

    expect(retypeSpy).not.toHaveBeenCalled();
    expect(result.current.feedback?.message).toContain(PROVENANCE_INELIGIBLE_REASON);
    expect(result.current.menu?.type).toBe('association');

    const stored = await repository.listByCase(CASE_ID);
    expect(stored[0]?.type).toBe('association');
  });

  it('dismissing the menu keeps the association', async () => {
    const { result, repository } = setup();

    await act(async () => {
      await result.current.requestConnection({ fromCardId: NOTE_ID, toCardId: TOPIC_ID });
    });

    expect(result.current.menu).not.toBeNull();

    act(() => {
      result.current.dismissMenu();
    });

    expect(result.current.menu).toBeNull();
    const stored = await repository.listByCase(CASE_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.type).toBe('association');
  });

  it('reports a storage failure without opening the menu', async () => {
    const repository = new InMemoryConnectionRepository({ cards: CARDS });
    vi.spyOn(repository, 'create').mockRejectedValueOnce(new Error('storage unavailable'));
    const { result } = setup({ repository });

    let outcome: Awaited<ReturnType<typeof result.current.requestConnection>> | undefined;
    await act(async () => {
      outcome = await result.current.requestConnection({
        fromCardId: NOTE_ID,
        toCardId: TOPIC_ID,
      });
    });

    expect(outcome?.status).toBe('error');
    expect(result.current.menu).toBeNull();
    expect(result.current.feedback?.tone).toBe('error');
  });
});

describe('ConnectionTypeMenu', () => {
  it('announces an ineligible provenance reason and disables the option', () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    const reason = 'Provenance is only available between one Study Note and one Source.';

    render(
      <ConnectionTypeMenu
        open
        type="association"
        provenanceEligible={false}
        provenanceReason={reason}
        point={{ x: 20, y: 30 }}
        onSelect={onSelect}
        onDismiss={onDismiss}
      />,
    );

    const association = screen.getByRole('radio', { name: /Association/ });
    const provenance = screen.getByRole('radio', { name: /Provenance/ });

    expect(association).toBeChecked();
    expect(provenance).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(reason);
    expect(provenance).toHaveAttribute('aria-describedby', screen.getByRole('status').id);
    expect(screen.getByRole('heading', { name: 'Thread type' })).toBeInTheDocument();

    fireEvent.click(provenance);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects a type and dismisses with Escape or Done', () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();

    render(
      <ConnectionTypeMenu
        open
        type="provenance"
        provenanceEligible
        provenanceReason="Provenance is available for this pair."
        onSelect={onSelect}
        onDismiss={onDismiss}
      />,
    );

    const association = screen.getByRole('radio', { name: /Association/ });
    const provenance = screen.getByRole('radio', { name: /Provenance/ });

    expect(provenance).toBeChecked();
    expect(provenance).toBeEnabled();

    fireEvent.click(association);
    expect(onSelect).toHaveBeenCalledWith('association');

    fireEvent.keyDown(screen.getByTestId('connection-type-menu'), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <ConnectionTypeMenu
        open={false}
        type="association"
        provenanceEligible={false}
        provenanceReason="Not available"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
