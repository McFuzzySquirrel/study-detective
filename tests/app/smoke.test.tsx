import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App smoke test', () => {
  it('renders the app shell with accessible text and no console error', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Notes Detective' })).toBeInTheDocument();
    expect(screen.getByText('Turn your notes into a detective story.')).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(
      screen.getByText('Turn your notes into a detective story.'),
    );
    expect(consoleError).not.toHaveBeenCalled();
  });
});
