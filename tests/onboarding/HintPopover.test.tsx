import { useRef, useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HintPopover from '../../src/features/onboarding/HintPopover';
import type { HintDismissReason } from '../../src/features/onboarding/HintPopover';
import { createHintSeenStore } from '../../src/features/onboarding/hints';
import {
  declarationsFor,
  mediaBody,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

const hintsCss = readRepositoryFile('src/features/onboarding/hints.css');
const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

const THREAD_ANCHOR_SENTENCE =
  'Drag from the pin on a card to another card to tie the two pieces of evidence together.';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface HarnessProps {
  readonly store: ReturnType<typeof createHintSeenStore>;
}

function Harness({ store }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<HintDismissReason | ''>('');

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open hint
      </button>
      <button type="button">Outside control</button>
      <HintPopover
        open={open}
        hintId="thread-anchor"
        store={store}
        title="Thread anchor"
        description={THREAD_ANCHOR_SENTENCE}
        onDismiss={(nextReason) => {
          setReason(nextReason);
          setOpen(false);
        }}
      />
      <p data-testid="dismiss-reason">{reason}</p>
    </div>
  );
}

function ShowMeHarness({ store }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<HintDismissReason | ''>('');
  const targetRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open hint
      </button>
      <button ref={targetRef} type="button">
        Card thread anchor
      </button>
      <HintPopover
        open={open}
        hintId="recall"
        store={store}
        title="Recall mode"
        description="Open Recall to rebuild the board from memory, then check your strings against the case."
        showMe={{ onShowMe: () => targetRef.current?.focus() }}
        onDismiss={(nextReason) => {
          setReason(nextReason);
          setOpen(false);
        }}
      />
      <p data-testid="dismiss-reason">{reason}</p>
    </div>
  );
}

describe('HintPopover', () => {
  it('moves focus to a named hint with its one-sentence description', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    render(<Harness store={store} />);

    await user.click(screen.getByRole('button', { name: 'Open hint' }));

    const dialog = screen.getByRole('dialog', { name: 'Thread anchor' });

    expect(dialog).toHaveFocus();
    expect(dialog).toHaveAccessibleDescription(THREAD_ANCHOR_SENTENCE);
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(within(dialog).getByRole('button', { name: 'Got it' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Show me' })).not.toBeInTheDocument();

    const gotIt = within(dialog).getByRole('button', { name: 'Got it' });
    expect(gotIt).toHaveClass('nd-button--md');
    expect(gotIt).toHaveClass('nd-hint__action');
  });

  it('marks the hint seen on Got it and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);
    const trigger = () => screen.getByRole('button', { name: 'Open hint' });

    render(<Harness store={store} />);
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('dismiss-reason')).toHaveTextContent('got-it');
    expect(store.isSeen('thread-anchor')).toBe(true);
    expect(trigger()).toHaveFocus();
  });

  it('marks the hint seen on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);
    const trigger = () => screen.getByRole('button', { name: 'Open hint' });

    render(<Harness store={store} />);
    await user.click(trigger());

    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('dismiss-reason')).toHaveTextContent('escape');
    expect(store.isSeen('thread-anchor')).toBe(true);
    expect(trigger()).toHaveFocus();
  });

  it('does not trap focus or inert the rest of the page', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    render(<Harness store={store} />);
    await user.click(screen.getByRole('button', { name: 'Open hint' }));

    const dialog = screen.getByRole('dialog', { name: 'Thread anchor' });
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });

    expect(dialog.dispatchEvent(tabEvent)).toBe(true);
    expect(tabEvent.defaultPrevented).toBe(false);
    expect(document.querySelector('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Outside control' })).toBeEnabled();
  });

  it('hands focus to the revealed control on Show me without pulling it back', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    render(<ShowMeHarness store={store} />);
    await user.click(screen.getByRole('button', { name: 'Open hint' }));

    expect(screen.getByRole('dialog', { name: 'Recall mode' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Show me' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('dismiss-reason')).toHaveTextContent('show-me');
    expect(screen.getByRole('button', { name: 'Card thread anchor' })).toHaveFocus();
    expect(store.isSeen('recall')).toBe(true);
  });

  it('moves through actions with the keyboard and never auto-opens', async () => {
    const user = userEvent.setup();
    const store = createHintSeenStore(null);

    render(<Harness store={store} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    vi.useFakeTimers();
    vi.advanceTimersByTime(30_000);
    vi.useRealTimers();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open hint' }));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /next|previous|skip tour/i })).toBeNull();
  });

  it('renders hint text as inert text, never as HTML', () => {
    const store = createHintSeenStore(null);

    render(
      <HintPopover
        open
        hintId="thread-anchor"
        store={store}
        title={'<img src="x" onerror="alert(1)">'}
        description={'<script>alert(1)</script> Still only a sentence.'}
        onDismiss={() => {}}
      />,
    );

    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveTextContent('<img src="x" onerror="alert(1)">');
    expect(dialog).toHaveTextContent('<script>alert(1)</script>');
    expect(dialog.querySelector('img')).toBeNull();
    expect(dialog.querySelector('script')).toBeNull();
  });
});

describe('HintPopover CSS contract', () => {
  it('removes the entrance animation under reduced motion while keeping the final state', () => {
    const base = declarationsFor(hintsCss, '.nd-hint', { topLevelOnly: true });
    const reduced = mediaBody(hintsCss, 'prefers-reduced-motion: reduce');

    expect(base.get('animation')).toContain('nd-hint-enter');
    expect(reduced).toContain('.nd-hint');
    expect(reduced).toMatch(/animation:\s*none/);
    expect(reduced).toMatch(/transition:\s*none/);
  });

  it('keeps both hint actions at the 44x44 target floor with a visible focus ring', () => {
    const action = declarationsFor(hintsCss, '.nd-hint__action', { topLevelOnly: true });
    const focus = declarationsFor(hintsCss, '.nd-hint:focus-visible', { topLevelOnly: true });

    expect(resolveLengthPx(tokens, action.get('min-block-size'))).toBeGreaterThanOrEqual(44);
    expect(resolveLengthPx(tokens, action.get('min-inline-size'))).toBeGreaterThanOrEqual(44);
    expect(focus.get('outline')).toContain('var(--focus-ring-width)');
    expect(focus.get('outline')).toContain('var(--color-focus-ring)');
  });

  it('uses tokens only, with no raw palette values', () => {
    expect(hintsCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(hintsCss).not.toMatch(/\brgba?\(/i);
    expect(hintsCss).not.toMatch(/\bhsla?\(/i);
  });
});
