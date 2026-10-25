import { MemoryRouter } from 'react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import { createPersistenceClient } from '../../src/data/persistence';
import type { PersistenceResult } from '../../src/data/persistence';
import { summarizeStorageEstimate, UNKNOWN_STORAGE_ESTIMATE } from '../../src/data/storageEstimate';
import CaseShelfPage from '../../src/features/shelf/CaseShelfPage';
import StorageStatus from '../../src/features/shelf/StorageStatus';

const PERSISTENT: PersistenceResult = {
  state: 'persistent',
  supported: true,
  requested: true,
  granted: true,
};

const BEST_EFFORT: PersistenceResult = {
  state: 'best-effort',
  supported: true,
  requested: true,
  granted: false,
};

const UNSUPPORTED: PersistenceResult = {
  state: 'best-effort',
  supported: false,
  requested: false,
  granted: false,
};

type PersistFn = () => Promise<boolean>;

afterEach(() => {
  cleanup();
});

describe('StorageStatus', () => {
  it('shows persistent storage with usage, quota, and percentage', () => {
    render(
      <StorageStatus
        persistence={PERSISTENT}
        estimate={summarizeStorageEstimate({ usage: 1024 * 1024, quota: 100 * 1024 * 1024 })}
      />,
    );

    expect(screen.getByText('Persistent')).toBeInTheDocument();
    expect(screen.getByText(/1 MB used of 100 MB \(1%\)/)).toBeInTheDocument();

    const meter = screen.getByRole('progressbar', { name: 'Storage used' });
    expect(meter).toHaveAttribute('max', '100');
    expect(meter).toHaveAttribute('value', '1');
    expect(meter).toHaveAttribute('aria-valuetext', '1% used');

    expect(screen.queryByText(/Storage warning\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/Back up your cases/)).not.toBeInTheDocument();
  });

  it('warns above 80 percent and renders the backup action slot', () => {
    render(
      <StorageStatus
        persistence={PERSISTENT}
        estimate={summarizeStorageEstimate({ usage: 850, quota: 1000 })}
        backupAction={<button type="button">Back up cases</button>}
      />,
    );

    expect(screen.getByText(/Storage warning/)).toBeInTheDocument();
    expect(screen.getByText(/Storage is 85% full\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back up cases' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Storage used' })).toHaveAttribute(
      'value',
      '85',
    );
  });

  it('renders denied persistence as best effort with a prominent backup reminder', () => {
    render(
      <StorageStatus
        persistence={BEST_EFFORT}
        estimate={summarizeStorageEstimate({ usage: 10, quota: 1000 })}
      />,
    );

    expect(screen.getByText('Best effort')).toBeInTheDocument();
    expect(screen.getByText(/Persistent storage is not active/)).toBeInTheDocument();
    expect(screen.getByText(/The browser may clear this data/)).toBeInTheDocument();
    expect(screen.queryByText(/Storage warning\./)).not.toBeInTheDocument();
  });

  it('renders unsupported storage APIs as best effort without crashing', () => {
    render(<StorageStatus persistence={UNSUPPORTED} estimate={UNKNOWN_STORAGE_ESTIMATE} />);

    expect(screen.getByText('Best effort')).toBeInTheDocument();
    expect(screen.getByText(/does not support persistent storage/)).toBeInTheDocument();
    expect(
      screen.getByText('Storage usage and quota are unavailable in this browser.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows a checking state until the first reads resolve', () => {
    render(<StorageStatus persistence={null} estimate={null} />);

    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText(/Checking whether this browser/)).toBeInTheDocument();
    expect(screen.getByText('Reading storage usage…')).toBeInTheDocument();
  });

  it('requests persistence once on first case creation and not again on edit', async () => {
    const user = userEvent.setup();
    const persist = vi.fn<PersistFn>().mockResolvedValue(true);
    const persisted = vi.fn<PersistFn>().mockResolvedValue(false);
    const client = createPersistenceClient({ persist, persisted });
    const repository = new InMemoryCaseRepository();
    const loadStorageEstimate = async () =>
      summarizeStorageEstimate({ usage: 2048, quota: 102400 });

    render(
      <MemoryRouter>
        <CaseShelfPage
          repository={repository}
          persistenceClient={client}
          loadStorageEstimate={loadStorageEstimate}
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Create your first case' }));
    await user.type(await screen.findByRole('textbox', { name: 'Case title' }), 'First case');
    await user.click(screen.getByRole('button', { name: 'Create case' }));

    expect(await screen.findByText('Persistent')).toBeInTheDocument();
    await waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1);
    });

    await user.click(await screen.findByRole('button', { name: 'Edit First case' }));
    const title = await screen.findByRole('textbox', { name: 'Case title' });
    await user.clear(title);
    await user.type(title, 'First case edited');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('link', { name: 'First case edited' });
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
