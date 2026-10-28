import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import App from '../../src/App';
import UpdatePrompt from '../../src/app/UpdatePrompt';
import { confirmUpdate, dismissUpdate, registerPwa, setUnsavedChanges } from '../../src/pwa';
import { __clearUpdateCalls, __getUpdateCalls, __triggerNeedRefresh } from '../stubs/pwa-register';

beforeAll(() => {
  registerPwa();
});

beforeEach(() => {
  dismissUpdate();
  setUnsavedChanges(false);
  __clearUpdateCalls();
});

afterEach(() => {
  cleanup();
});

describe('update prompt', () => {
  it('is mounted in the shell System status dialog only for a waiting worker', () => {
    render(<App />);

    expect(
      screen.queryByText('A new version of Notes Detective is ready.'),
    ).not.toBeInTheDocument();

    act(() => {
      __triggerNeedRefresh();
    });

    fireEvent.click(screen.getByRole('button', { name: /^System status: .*update ready/ }));

    expect(screen.getByText('A new version of Notes Detective is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Later' })).toBeEnabled();
  });

  it('never activates the waiting worker until Refresh is confirmed', async () => {
    render(<UpdatePrompt />);

    act(() => {
      __triggerNeedRefresh();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(__getUpdateCalls()).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(__getUpdateCalls()).toEqual([true]);
    });
    await waitFor(() => {
      expect(
        screen.queryByText('A new version of Notes Detective is ready.'),
      ).not.toBeInTheDocument();
    });
  });

  it('dismisses with Later without activating the waiting worker', () => {
    render(<UpdatePrompt />);

    act(() => {
      __triggerNeedRefresh();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    expect(
      screen.queryByText('A new version of Notes Detective is ready.'),
    ).not.toBeInTheDocument();
    expect(__getUpdateCalls()).toEqual([]);
  });

  it('blocks activation while an edit is unsaved', async () => {
    render(<UpdatePrompt />);

    act(() => {
      __triggerNeedRefresh();
      setUnsavedChanges(true);
    });

    expect(screen.getByText('Finish your current edit before refreshing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    let confirmed = true;
    await act(async () => {
      confirmed = await confirmUpdate();
    });

    expect(confirmed).toBe(false);
    expect(__getUpdateCalls()).toEqual([]);

    act(() => {
      setUnsavedChanges(false);
    });
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(__getUpdateCalls()).toEqual([true]);
    });
  });
});
