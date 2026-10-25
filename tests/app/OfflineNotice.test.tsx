import { MemoryRouter } from 'react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import AppShell from '../../src/app/AppShell';
import OfflineNotice from '../../src/app/OfflineNotice';

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

function announce(value: boolean): void {
  act(() => {
    setOnline(value);
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
}

beforeEach(() => {
  setOnline(true);
});

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe('OfflineNotice', () => {
  it('stays quiet while the browser is online', () => {
    render(<OfflineNotice />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('appears on an offline event and clears on online', () => {
    render(<OfflineNotice />);

    announce(false);

    expect(screen.getByRole('status')).toHaveTextContent(
      'You are offline. Some actions may be unavailable until the connection returns.',
    );

    announce(true);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('is visible on first render when the page loads offline', () => {
    setOnline(false);

    render(<OfflineNotice />);

    expect(screen.getByRole('status')).toHaveTextContent('You are offline.');
  });

  it('is mounted by the app shell and clears from the shell', async () => {
    render(
      <MemoryRouter>
        <AppShell>
          <p>Case content</p>
        </AppShell>
      </MemoryRouter>,
    );

    announce(false);

    expect(screen.getByRole('status')).toHaveTextContent('You are offline.');

    announce(true);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stops listening after unmount', () => {
    const { unmount } = render(<OfflineNotice />);

    unmount();

    expect(() => {
      announce(false);
      announce(true);
    }).not.toThrow();
  });
});
