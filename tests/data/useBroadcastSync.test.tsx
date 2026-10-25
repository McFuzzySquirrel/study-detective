import { MemoryRouter } from 'react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import { createCaseMutationEvent, isCaseMutationEvent } from '../../src/data/useBroadcastSync';
import type { BroadcastChannelFactory, CaseMutationEvent } from '../../src/data/useBroadcastSync';
import CaseShelfPage from '../../src/features/shelf/CaseShelfPage';
import { useBroadcastSync } from '../../src/features/shelf/useBroadcastSync';
import { DEFAULT_VIEWPORT } from '../../src/domain/model';
import type { CaseRecord } from '../../src/domain/model';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

type MutationListener = (event: CaseMutationEvent) => void;

interface ChannelHub {
  readonly factory: BroadcastChannelFactory;
  readonly sent: CaseMutationEvent[];
  readonly emit: (event: CaseMutationEvent) => void;
}

/**
 * A tiny in-memory BroadcastChannel bus. Every channel shares the listener set
 * and every post reaches every listener, including the sender, which mirrors a
 * same-tab second channel and lets the tests prove source filtering.
 */
function createChannelHub(): ChannelHub {
  const listeners = new Set<MutationListener>();
  const sent: CaseMutationEvent[] = [];

  const dispatch = (event: CaseMutationEvent): void => {
    for (const listener of [...listeners]) {
      listener(event);
    }
  };

  const factory: BroadcastChannelFactory = () => ({
    post(event) {
      sent.push(event);
      dispatch(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      // Unsubscribe removes the listener; nothing else to release.
    },
  });

  return { factory, sent, emit: dispatch };
}

function makeCase(id: string, title: string): CaseRecord {
  return {
    id,
    title,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    viewport: DEFAULT_VIEWPORT,
    closedAt: null,
    isDemo: false,
    backupPromptedAt: null,
  };
}

interface SyncHarnessProps {
  readonly hub: ChannelHub;
  readonly label: string;
  readonly onMutation: MutationListener;
}

function SyncHarness({ hub, label, onMutation }: SyncHarnessProps) {
  const { broadcastMutation } = useBroadcastSync({
    createChannel: hub.factory,
    onMutation,
  });

  return (
    <button type="button" onClick={() => broadcastMutation(CASE_ID, 'updated')}>
      {label}
    </button>
  );
}

interface UnsupportedHarnessProps {
  readonly onMutation: MutationListener;
}

function UnsupportedHarness({ onMutation }: UnsupportedHarnessProps) {
  const { broadcastMutation } = useBroadcastSync({
    createChannel: () => null,
    onMutation,
  });

  return (
    <button type="button" onClick={() => broadcastMutation(CASE_ID, 'created')}>
      Broadcast without a channel
    </button>
  );
}

afterEach(() => {
  cleanup();
});

describe('useBroadcastSync', () => {
  it('delivers a mutation to the other tab and ignores the sender echo', async () => {
    const user = userEvent.setup();
    const hub = createChannelHub();
    const firstTab = vi.fn<MutationListener>();
    const secondTab = vi.fn<MutationListener>();

    render(
      <>
        <SyncHarness hub={hub} label="First tab" onMutation={firstTab} />
        <SyncHarness hub={hub} label="Second tab" onMutation={secondTab} />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'First tab' }));

    await waitFor(() => {
      expect(secondTab).toHaveBeenCalledTimes(1);
    });
    expect(firstTab).not.toHaveBeenCalled();
    expect(hub.sent).toHaveLength(1);
    expect(hub.sent[0]).toMatchObject({
      type: 'case-mutation',
      caseId: CASE_ID,
      mutation: 'updated',
    });
  });

  it('becomes a no-op when BroadcastChannel is unsupported', async () => {
    const user = userEvent.setup();
    const onMutation = vi.fn<MutationListener>();

    render(<UnsupportedHarness onMutation={onMutation} />);

    await user.click(screen.getByRole('button', { name: 'Broadcast without a channel' }));

    expect(onMutation).not.toHaveBeenCalled();
  });

  it('validates event payloads before trusting them', () => {
    const event = createCaseMutationEvent(CASE_ID, 'updated', 'remote-tab');

    expect(isCaseMutationEvent(event)).toBe(true);
    expect(isCaseMutationEvent(null)).toBe(false);
    expect(isCaseMutationEvent({ ...event, type: 'other' })).toBe(false);
    expect(isCaseMutationEvent({ ...event, mutation: 'moved' })).toBe(false);
    expect(isCaseMutationEvent({ ...event, caseId: '' })).toBe(false);
    expect(isCaseMutationEvent({ ...event, sourceId: '' })).toBe(false);
  });

  it('invalidates shelf reads from another tab without replacing an open draft', async () => {
    const user = userEvent.setup();
    const hub = createChannelHub();
    const repository = new InMemoryCaseRepository({
      seed: { cases: [makeCase(CASE_ID, 'Organic Chemistry')] },
    });

    render(
      <MemoryRouter>
        <CaseShelfPage repository={repository} syncChannelFactory={hub.factory} />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Organic Chemistry' });
    await user.click(screen.getByRole('button', { name: 'Edit Organic Chemistry' }));

    const title = await screen.findByRole('textbox', { name: 'Case title' });
    await user.clear(title);
    await user.type(title, 'Unsaved draft');

    // Another tab committed a newer write. The broadcast triggers a re-read,
    // not an event-payload overwrite, so the persisted revision appears.
    await repository.updateCase(CASE_ID, { title: 'Organic Chemistry Revised' });
    hub.emit(createCaseMutationEvent(CASE_ID, 'updated', 'remote-tab'));

    expect(
      await screen.findByRole('link', { name: 'Organic Chemistry Revised' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit case' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Case title' })).toHaveValue('Unsaved draft');
  });

  it('broadcasts committed creates and updates from the shelf', async () => {
    const user = userEvent.setup();
    const hub = createChannelHub();
    const repository = new InMemoryCaseRepository();

    render(
      <MemoryRouter>
        <CaseShelfPage repository={repository} syncChannelFactory={hub.factory} />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Create your first case' }));
    await user.type(await screen.findByRole('textbox', { name: 'Case title' }), 'First case');
    await user.click(screen.getByRole('button', { name: 'Create case' }));

    await screen.findByRole('link', { name: 'First case' });
    await waitFor(() => {
      expect(hub.sent).toHaveLength(1);
    });
    expect(hub.sent[0]).toMatchObject({ mutation: 'created' });

    const summaries = await repository.listCaseSummaries();
    expect(summaries).toHaveLength(1);
    expect(hub.sent[0]?.caseId).toBe(summaries[0]?.id);

    await user.click(screen.getByRole('button', { name: 'Edit First case' }));
    const title = await screen.findByRole('textbox', { name: 'Case title' });
    await user.clear(title);
    await user.type(title, 'First case revised');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('link', { name: 'First case revised' });
    await waitFor(() => {
      expect(hub.sent).toHaveLength(2);
    });
    expect(hub.sent[1]).toMatchObject({ mutation: 'updated' });
  });
});
