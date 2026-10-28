import { MemoryRouter } from 'react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CaseMenu from '../../src/features/case/CaseMenu';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

function renderMenu(overrides: Partial<Parameters<typeof CaseMenu>[0]> = {}) {
  const props = {
    caseId: CASE_ID,
    phone: false,
    ready: true,
    cardCount: 6,
    reminderVisible: false,
    reminderSaving: false,
    reminderError: null,
    capacityDismissed: false,
    onBackup: vi.fn(),
    onDismissReminder: vi.fn(),
    onDismissCapacity: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  };

  return render(
    <MemoryRouter>
      <CaseMenu {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('CaseMenu', () => {
  it('carries the first-backup section and its two actions', () => {
    renderMenu({ reminderVisible: true });

    expect(screen.getByRole('heading', { name: 'First backup' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeVisible();
  });

  it('shows the persistent capacity warning at 150 cards without a dismiss control', () => {
    renderMenu({ cardCount: 150 });

    const capacity = screen.getByRole('status');
    expect(capacity).toHaveAttribute('data-card-capacity', 'persistent');
    expect(capacity).toHaveTextContent('Case capacity');
    expect(within(capacity).queryByRole('button', { name: 'Dismiss warning' })).toBeNull();
  });

  it('blocks at 200 with an alert and the new-case destination', () => {
    renderMenu({ cardCount: 200 });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-card-capacity', 'blocked');
    expect(within(alert).getByRole('link', { name: 'Create a new case' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('keeps phone-only destinations out of the wide menu', () => {
    renderMenu();

    expect(screen.queryByRole('link', { name: 'Open card list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Case shelf' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thread types' })).toBeVisible();
  });

  it('adds card list, case shelf, and settings on a phone', () => {
    renderMenu({ phone: true });

    expect(screen.getByRole('link', { name: 'Open card list' })).toHaveAttribute(
      'href',
      `/case/${CASE_ID}/list`,
    );
    expect(screen.getByRole('link', { name: 'Case shelf' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('reduces the loading/missing/error menu to the two safe destinations', async () => {
    const user = userEvent.setup();
    renderMenu({ ready: false, reminderVisible: true, cardCount: 200 });

    expect(screen.getByRole('link', { name: 'Case shelf' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Back up now' })).not.toBeInTheDocument();
    expect(screen.queryByText('Case capacity')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Settings' }));
  });
});
