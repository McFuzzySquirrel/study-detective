import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ErrorBoundary from '../../src/app/ErrorBoundary';

function ThrowingScreen(): ReactNode {
  throw new Error('secret student note');
}

function Harness() {
  const location = useLocation();

  return (
    <ErrorBoundary resetKey={location.key}>
      <Routes>
        <Route path="/" element={<p>Case shelf restored</p>} />
        <Route path="/case/:caseId" element={<ThrowingScreen />} />
      </Routes>
    </ErrorBoundary>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its children while no error is thrown', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <p>Case content</p>
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('Case content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('catches a route error, offers recovery, and hides the error and stack trace', () => {
    // React logs caught render errors in development. Silence that framework
    // output so the assertion is about what the boundary itself exposes.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <MemoryRouter initialEntries={['/case/broken']}>
        <Harness />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'This view could not open' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Back to shelf' })).toHaveAttribute('href', '/');

    expect(document.body).not.toHaveTextContent('secret student note');
    expect(document.body.textContent).not.toMatch(/\bat .+:\d+:\d+/);
  });

  it('recovers to the shelf when the route changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <MemoryRouter initialEntries={['/case/broken']}>
        <Harness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Back to shelf' }));

    expect(await screen.findByText('Case shelf restored')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
