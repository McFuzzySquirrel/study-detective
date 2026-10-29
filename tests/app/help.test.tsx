import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import AppShell from '../../src/app/AppShell';
import { TYPICAL_FLOW_STEPS } from '../../src/app/helpContent';

afterEach(() => {
  cleanup();
});

function renderShell(path = '/settings') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>
        <Routes>
          <Route path="/" element={<p>Case shelf content</p>} />
          <Route path="/welcome" element={<p>Welcome content</p>} />
          <Route path="/settings" element={<p>Settings content</p>} />
        </Routes>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('app help dialog', () => {
  it('opens from the top bar, teaches the flow, and returns focus on Escape', async () => {
    const user = userEvent.setup();
    renderShell();

    const helpButton = screen.getByRole('button', { name: 'Help' });
    await user.click(helpButton);

    const dialog = await screen.findByRole('dialog', { name: 'How Notes Detective works' });
    expect(dialog).toBeInTheDocument();

    for (const step of TYPICAL_FLOW_STEPS) {
      expect(dialog).toHaveTextContent(step.title);
      expect(dialog).toHaveTextContent(step.description);
    }

    expect(dialog).toHaveTextContent('Board gestures');
    expect(dialog).toHaveTextContent('Keyboard shortcuts');
    expect(dialog).toHaveTextContent('stay in this browser');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(helpButton).toHaveFocus();
  });

  it('can show the welcome screen again', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await screen.findByRole('dialog', { name: 'How Notes Detective works' });

    await user.click(screen.getByRole('button', { name: 'Show the welcome screen' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Welcome content')).toBeInTheDocument();
  });

  it('keeps primary navigation on app routes and removes it on the welcome', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/settings']}>
        <AppShell>
          <p>Settings content</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter initialEntries={['/welcome']}>
        <AppShell>
          <p>Welcome content</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });
});
