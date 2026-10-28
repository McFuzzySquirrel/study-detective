import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import SystemStatus from '../../src/app/SystemStatus';
import type { CoreApiEnvironment } from '../../src/app/browserSupport';

const SUPPORTED_ENVIRONMENT: CoreApiEnvironment = {
  indexedDB: {},
  Worker: class TestWorker {},
  WebAssembly: { instantiate: () => undefined, compile: () => undefined },
  navigator: { serviceWorker: {} },
};

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

describe('System status', () => {
  it('stays quiet while every notice is inactive', () => {
    render(<SystemStatus environment={SUPPORTED_ENVIRONMENT} />);

    expect(screen.queryByRole('button', { name: /^System status:/ })).not.toBeInTheDocument();
  });

  it('collapses offline into one chip and opens the dialog with the notice copy', () => {
    render(<SystemStatus environment={SUPPORTED_ENVIRONMENT} />);

    announce(false);

    const chip = screen.getByRole('button', { name: 'System status: offline' });
    expect(chip).toBeVisible();

    fireEvent.click(chip);

    const dialog = screen.getByRole('dialog', { name: 'System status' });
    expect(within(dialog).getByRole('heading', { name: 'Offline' })).toBeVisible();
    expect(within(dialog).getByText(/You are offline/)).toBeVisible();
  });

  it('lists every active reason in the chip name and shows a count instead of hiding one', () => {
    render(<SystemStatus environment={{}} />);

    const chip = screen.getByRole('button', {
      name: 'System status: limited support',
    });
    expect(chip).toHaveTextContent('Limited support');

    announce(false);

    const combined = screen.getByRole('button', {
      name: 'System status: offline, limited support',
    });
    expect(combined).toHaveTextContent('Status · 2');
  });

  it('dismisses the browser notice for the page session and removes the chip', () => {
    render(<SystemStatus environment={{}} />);

    fireEvent.click(screen.getByRole('button', { name: 'System status: limited support' }));
    const dialog = screen.getByRole('dialog', { name: 'System status' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss browser support notice' }));

    expect(screen.queryByRole('button', { name: /^System status:/ })).not.toBeInTheDocument();
  });
});
