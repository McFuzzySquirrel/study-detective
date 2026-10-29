import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import WelcomeGate from '../../src/app/WelcomeGate';
import { createWelcomeSeenStore } from '../../src/features/welcome/welcomeSeen';
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

function renderAt(path: string, seen: boolean) {
  const store = createWelcomeSeenStore(new MemoryWelcomeStorage());

  if (seen) {
    store.markSeen();
  }

  render(
    <MemoryRouter initialEntries={[path]}>
      <WelcomeGate seenStore={store}>
        <Routes>
          <Route path="/" element={<p>Case shelf content</p>} />
          <Route path="/welcome" element={<p>Welcome content</p>} />
          <Route path="/settings" element={<p>Settings content</p>} />
        </Routes>
      </WelcomeGate>
    </MemoryRouter>,
  );

  return store;
}

afterEach(() => {
  cleanup();
});

describe('welcome gate', () => {
  it('redirects an unseen first visit from the home route to the welcome', () => {
    renderAt('/', false);

    expect(screen.getByText('Welcome content')).toBeInTheDocument();
    expect(screen.queryByText('Case shelf content')).not.toBeInTheDocument();
  });

  it('lets a returning visit through to the home route', () => {
    renderAt('/', true);

    expect(screen.getByText('Case shelf content')).toBeInTheDocument();
    expect(screen.queryByText('Welcome content')).not.toBeInTheDocument();
  });

  it('never intercepts a non-home route', () => {
    renderAt('/settings', false);

    expect(screen.getByText('Settings content')).toBeInTheDocument();
  });
});
