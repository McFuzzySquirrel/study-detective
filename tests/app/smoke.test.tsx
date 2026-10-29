import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/App';
import { WELCOME_SEEN_STORAGE_KEY } from '../../src/features/welcome/welcomeSeen';

beforeEach(() => {
  // This is the shelf smoke test; the first-run welcome has its own coverage.
  window.localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, '1');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.location.hash = '';
});

describe('App smoke test', () => {
  it('renders the app shell with accessible text and no console error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Notes Detective' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(
      await screen.findByRole('heading', { level: 2, name: 'Case shelf' }),
    );
    expect(consoleError).not.toHaveBeenCalled();
  });
});
