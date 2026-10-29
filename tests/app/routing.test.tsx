import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import App from '../../src/App';
import AppShell from '../../src/app/AppShell';
import AppRoutes from '../../src/app/routes';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>
        <AppRoutes />
      </AppShell>
    </MemoryRouter>,
  );
}

const namedRoutes = [
  ['/', 'Case shelf'],
  ['/welcome', 'Welcome to Notes Detective'],
  ['/case/alpha', 'Case board'],
  ['/case/alpha/capture', 'Capture evidence'],
  ['/case/alpha/recall', 'Recall'],
  ['/settings', 'Settings'],
] as const;

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('route table', () => {
  it.each(namedRoutes)('lazily renders the placeholder at %s', async (path, heading) => {
    renderAt(path);

    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
  });

  it('renders a recoverable not-found screen for an unknown route', async () => {
    renderAt('/case/alpha/not-a-route');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Page not found' }),
    ).toBeInTheDocument();

    const backToShelf = screen.getByRole('link', { name: 'Back to case shelf' });
    expect(backToShelf).toHaveAttribute('href', '/');

    fireEvent.click(backToShelf);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Case shelf' }),
    ).toBeInTheDocument();
  });

  it('moves the shell to the requested hash route', async () => {
    window.location.hash = '#/settings';

    render(<App />);

    expect(await screen.findByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Notes Detective' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }));

    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#/settings');
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
  });

  it('exposes one main landmark and a first-focus skip link', async () => {
    renderAt('/');

    await screen.findByRole('heading', { level: 2, name: 'Case shelf' });

    expect(screen.getAllByRole('main')).toHaveLength(1);

    const skipLink = screen.getByRole('link', { name: 'Skip to content' });
    const main = screen.getByRole('main');

    expect(skipLink).toHaveAttribute('href', '#main-content');
    expect(main).toHaveAttribute('id', 'main-content');

    const focusable = document.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable[0]).toBe(skipLink);

    skipLink.focus();
    expect(skipLink).toHaveFocus();
  });

  it('renders no full-width status strip above the content', async () => {
    renderAt('/');

    await screen.findByRole('heading', { level: 2, name: 'Case shelf' });

    expect(screen.getByTestId('app-frame')).toHaveAttribute('data-board-route', 'false');
    expect(document.querySelector('.app-frame__status')).toBeNull();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
