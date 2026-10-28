import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import Panel from '../../src/components/Panel';

/**
 * Panel contract (06): a wide non-modal surface that never traps focus, never
 * marks the app inert, and never locks body scroll. Escape and outside clicks
 * follow the transient/persistent split, and focus returns to the trigger.
 */

function Harness({ transient = true }: { readonly transient?: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open panel
      </button>
      <button type="button">Outside control</button>
      <Panel
        open={open}
        onClose={() => setOpen(false)}
        title="Panel title"
        description="Panel description"
        closeLabel="Close panel"
        transient={transient}
        returnFocusRef={triggerRef}
      >
        <button type="button">Inside control</button>
      </Panel>
    </div>
  );
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('Panel', () => {
  it('is a labelled dialog without aria-modal and moves focus to its heading', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open panel' }));

    const panel = screen.getByRole('dialog', { name: 'Panel title' });
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveAttribute('aria-modal');
    expect(panel).toHaveAccessibleDescription('Panel description');
    expect(screen.getByRole('heading', { name: 'Panel title' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
    expect(screen.getByRole('button', { name: 'Outside control' })).not.toHaveAttribute('inert');
  });

  it('does not trap Tab and restores the trigger on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open panel' });
    await user.click(trigger);
    await user.tab();
    await user.tab();

    expect(screen.getByRole('button', { name: 'Inside control' })).toHaveFocus();

    // No trap: the next Tab leaves the panel instead of cycling to its start.
    await user.tab();
    expect(document.body).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Panel title' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes a transient panel on an outside pointerdown but keeps a persistent one', async () => {
    const { rerender } = render(<Harness transient />);

    fireEvent.click(screen.getByRole('button', { name: 'Open panel' }));
    const outside = screen.getByRole('button', { name: 'Outside control' });

    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('dialog', { name: 'Panel title' })).not.toBeInTheDocument();

    rerender(<Harness transient={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open panel' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside control' }));

    expect(screen.getByRole('dialog', { name: 'Panel title' })).toBeInTheDocument();
  });

  it('keeps its own close control at a named 44 px target', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open panel' }));
    const close = screen.getByRole('button', { name: 'Close panel' });

    expect(close).toHaveClass('nd-icon-button');
    await user.click(close);
    expect(screen.queryByRole('dialog', { name: 'Panel title' })).not.toBeInTheDocument();
  });
});
