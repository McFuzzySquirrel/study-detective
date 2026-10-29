import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import HelpProvider from '../../src/app/HelpProvider';
import { TYPICAL_FLOW_STEPS } from '../../src/app/helpContent';
import { WelcomePage } from '../../src/features/welcome/WelcomePage';
import {
  createWelcomeSeenStore,
  WELCOME_SEEN_STORAGE_KEY,
} from '../../src/features/welcome/welcomeSeen';
import type { WelcomeStorage } from '../../src/features/welcome/welcomeSeen';

class MemoryWelcomeStorage implements WelcomeStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

afterEach(() => {
  cleanup();
});

function renderWelcome(store = createWelcomeSeenStore(new MemoryWelcomeStorage())) {
  render(
    <MemoryRouter initialEntries={['/welcome']}>
      <HelpProvider>
        <Routes>
          <Route path="/welcome" element={<WelcomePage seenStore={store} />} />
          <Route path="/" element={<h2>Case shelf</h2>} />
        </Routes>
      </HelpProvider>
    </MemoryRouter>,
  );

  return store;
}

describe('welcome screen', () => {
  it('shows the hero illustration and puts focus on the welcome heading', () => {
    renderWelcome();

    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Welcome to Notes Detective',
    });
    expect(heading).toHaveFocus();

    const image = screen.getByRole('img', { name: /students studying together/i });
    expect(image).toHaveAttribute(
      'src',
      expect.stringContaining('study-detective-welcome-vector.svg'),
    );
    expect(image).toHaveAttribute('width', '1536');
    expect(image).toHaveAttribute('height', '1024');
  });

  it('marks the welcome seen and enters the case shelf', async () => {
    const user = userEvent.setup();
    const store = renderWelcome();

    expect(store.hasSeen()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Enter the case files' }));

    expect(store.hasSeen()).toBe(true);
    expect(screen.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeInTheDocument();
  });

  it('opens the typical-flow help and returns focus on Escape', async () => {
    const user = userEvent.setup();
    renderWelcome();

    const trigger = screen.getByRole('button', { name: 'How it works' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'How Notes Detective works' });
    expect(dialog).toBeInTheDocument();

    for (const step of TYPICAL_FLOW_STEPS) {
      expect(dialog).toHaveTextContent(step.title);
      expect(dialog).toHaveTextContent(step.description);
    }

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('persists Enter through the real storage key', async () => {
    const user = userEvent.setup();
    renderWelcome(createWelcomeSeenStore(window.localStorage));

    await user.click(screen.getByRole('button', { name: 'Enter the case files' }));

    expect(window.localStorage.getItem(WELCOME_SEEN_STORAGE_KEY)).toBe('1');
    window.localStorage.clear();
  });
});
