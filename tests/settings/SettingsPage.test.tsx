import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HINTS, createHintSeenStore } from '../../src/features/onboarding/hints';
import SettingsPage from '../../src/features/settings/SettingsPage';
import {
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

const hintsCss = readRepositoryFile('src/features/onboarding/hints.css');
const componentsCss = readRepositoryFile('src/components/components.css');
const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function statusFor(hintId: string): HTMLElement {
  const item = document.querySelector<HTMLElement>(`[data-hint-id="${hintId}"]`);

  if (!item) {
    throw new Error(`Missing Settings item for ${hintId}`);
  }

  return item;
}

describe('SettingsPage hint replay', () => {
  it('lists every hint once under a Replay hints section with seen status text', () => {
    const store = createHintSeenStore(null);

    render(<SettingsPage hintStore={store} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Replay hints' })).toBeInTheDocument();

    HINTS.forEach((hint) => {
      expect(screen.getByRole('button', { name: `Replay ${hint.title} hint` })).toBeInTheDocument();
      expect(within(statusFor(hint.id)).getByText('Status: not seen yet')).toBeInTheDocument();
      expect(within(statusFor(hint.id)).getByText(hint.description)).toBeInTheDocument();
    });

    expect(screen.getAllByText('Replay')).toHaveLength(HINTS.length);
    expect(screen.getByRole('button', { name: 'Reset all hints' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('replays each hint, moves focus into it, and returns focus on Escape', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    render(<SettingsPage hintStore={store} />);

    for (const hint of HINTS) {
      const replay = screen.getByRole('button', { name: `Replay ${hint.title} hint` });

      await user.click(replay);

      const dialog = screen.getByRole('dialog', { name: hint.title });
      expect(dialog).toHaveFocus();
      expect(dialog).toHaveAccessibleDescription(hint.description);
      expect(store.isSeen(hint.id)).toBe(false);

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(store.isSeen(hint.id)).toBe(true);
      expect(replay).toHaveFocus();
    }

    expect(screen.getAllByText('Status: seen')).toHaveLength(HINTS.length);
    expect(screen.queryAllByText('Status: not seen yet')).toHaveLength(0);
  });

  it('resets all seen state and announces the result', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    store.markSeen('thread-anchor');
    store.markSeen('recall');

    render(<SettingsPage hintStore={store} />);

    expect(screen.getAllByText('Status: seen')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Reset all hints' }));

    expect(store.getSeenHints()).toEqual([]);
    expect(screen.queryAllByText('Status: seen')).toHaveLength(0);
    expect(screen.getAllByText('Status: not seen yet')).toHaveLength(HINTS.length);
    expect(screen.getByRole('status')).toHaveTextContent(
      'All hints reset. Each hint will appear again the next time it is relevant.',
    );
  });

  it('moves focus to a different replayed hint when another is chosen', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    render(<SettingsPage hintStore={store} />);

    await user.click(screen.getByRole('button', { name: 'Replay Thread anchor hint' }));
    expect(screen.getByRole('dialog', { name: 'Thread anchor' })).toHaveFocus();

    const recallReplay = screen.getByRole('button', { name: 'Replay Recall mode hint' });
    await user.click(recallReplay);

    expect(screen.getByRole('dialog', { name: 'Recall mode' })).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'Thread anchor' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(recallReplay).toHaveFocus();
    expect(store.isSeen('recall')).toBe(true);
  });

  it('closes an open hint on reset and keeps focus on the reset control', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    render(<SettingsPage hintStore={store} />);

    await user.click(screen.getByRole('button', { name: 'Replay Thread anchor hint' }));
    expect(screen.getByRole('dialog', { name: 'Thread anchor' })).toBeInTheDocument();

    const reset = screen.getByRole('button', { name: 'Reset all hints' });
    await user.click(reset);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(store.getSeenHints()).toEqual([]);
    expect(reset).toHaveFocus();
  });

  it('never auto-opens a hint, auto-advances, or offers a tour chrome', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    render(<SettingsPage hintStore={store} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    vi.useFakeTimers();
    vi.advanceTimersByTime(30_000);
    vi.useRealTimers();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay Recall mode hint' }));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /next|previous|skip|start tour/i })).toBeNull();

    vi.useFakeTimers();
    vi.advanceTimersByTime(30_000);
    vi.useRealTimers();

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Recall mode' })).toBeInTheDocument();
  });

  it('keeps replay and reset controls at the 44x44 target floor', () => {
    const store = createHintSeenStore(null);

    render(<SettingsPage hintStore={store} />);

    const replay = screen.getByRole('button', { name: 'Replay Recall mode hint' });
    const reset = screen.getByRole('button', { name: 'Reset all hints' });

    expect(replay).toHaveClass('nd-button--md');
    expect(replay).toHaveClass('hint-settings__replay');
    expect(reset).toHaveClass('nd-button--md');

    const replayStyles = declarationsFor(hintsCss, '.hint-settings__replay', {
      topLevelOnly: true,
    });
    const buttonStyles = declarationsFor(componentsCss, '.nd-button', {
      topLevelOnly: true,
    });

    expect(resolveLengthPx(tokens, replayStyles.get('min-block-size'))).toBeGreaterThanOrEqual(44);
    expect(resolveLengthPx(tokens, replayStyles.get('min-inline-size'))).toBeGreaterThanOrEqual(44);
    expect(resolveLengthPx(tokens, buttonStyles.get('min-block-size'))).toBeGreaterThanOrEqual(44);
    expect(resolveLengthPx(tokens, buttonStyles.get('min-inline-size'))).toBeGreaterThanOrEqual(44);
  });

  it('uses the shared focus ring and preserves a keyboard order through replay', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    render(<SettingsPage hintStore={store} />);

    const replay = screen.getByRole('button', { name: 'Replay Touch long-press hint' });
    replay.focus();
    expect(replay).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Touch long-press' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(replay).toHaveFocus();
  });
});
