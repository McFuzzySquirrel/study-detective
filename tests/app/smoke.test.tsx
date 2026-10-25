import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
