import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Button from '../../src/components/Button';
import Dialog from '../../src/components/Dialog';
import EmptyState from '../../src/components/EmptyState';
import Field from '../../src/components/Field';
import IconButton from '../../src/components/IconButton';
import Toast from '../../src/components/Toast';
import {
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

const componentsCss = readRepositoryFile('src/components/components.css');
const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

function declarations(selector: string): Map<string, string> {
  return declarationsFor(componentsCss, selector);
}

function maxLength(...values: number[]): number {
  return Math.max(...values.filter((value) => Number.isFinite(value)));
}

function expectMinimumTarget(selector: string): void {
  const styles = declarations(selector);
  const block = maxLength(
    resolveLengthPx(tokens, styles.get('min-block-size')),
    resolveLengthPx(tokens, styles.get('block-size')),
  );
  const inline = maxLength(
    resolveLengthPx(tokens, styles.get('min-inline-size')),
    resolveLengthPx(tokens, styles.get('inline-size')),
  );

  expect(block, `${selector} block target`).toBeGreaterThanOrEqual(44);
  expect(inline, `${selector} inline target`).toBeGreaterThanOrEqual(44);
}

function expectVisibleFocusRing(selector: string): void {
  const styles = declarations(`${selector}:focus-visible`);
  expect(styles.get('outline'), `${selector} focus outline`).toContain('var(--focus-ring-width)');
  expect(styles.get('outline'), `${selector} focus outline`).toContain('var(--color-focus-ring)');
}

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  it('is keyboard operable and exposes the 44x44 target and focus ring', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<Button onClick={onClick}>Open the case</Button>);

    const button = screen.getByRole('button', { name: 'Open the case' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('nd-button');
    expect(button).toHaveClass('nd-button--secondary');
    expect(button).toHaveClass('nd-button--md');

    expectMinimumTarget('.nd-button');
    expectVisibleFocusRing('.nd-button');

    await user.tab();
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);

    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('exposes variants and a full-width form action', () => {
    render(
      <Button variant="primary" size="lg" fullWidth>
        Save changes
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toHaveClass('nd-button--primary');
    expect(button).toHaveClass('nd-button--lg');
    expect(button).toHaveClass('nd-button--full');
    expect(button).toHaveAttribute('data-variant', 'primary');
  });
});

describe('IconButton', () => {
  it('has an accessible name, keyboard activation, and the shared target', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <IconButton label="Remove tag" onClick={onClick}>
        <span aria-hidden="true">×</span>
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: 'Remove tag' });
    expect(button).toHaveClass('nd-icon-button');
    expect(button).not.toHaveAttribute('aria-pressed');

    expectMinimumTarget('.nd-icon-button');
    expectVisibleFocusRing('.nd-icon-button');

    await user.tab();
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('announces toggle state when used as a pressed control', () => {
    render(
      <IconButton label="Show strings" pressed>
        <span aria-hidden="true">↔</span>
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Show strings' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

function DialogHarness({ dismissible = true }: { readonly dismissible?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open case settings</Button>
      <p>Background content stays inert while the dialog is open.</p>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Case settings"
        description="Changes apply to this case only."
        dismissible={dismissible}
        actions={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary">Save changes</Button>
          </>
        }
      >
        <input aria-label="Case title" defaultValue="The Speckled Band" />
        <button type="button">Choose a pin</button>
      </Dialog>
    </div>
  );
}

describe('Dialog', () => {
  it('labels itself, focuses the first input, traps Tab, and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole('button', { name: 'Open case settings' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Case settings' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Changes apply to this case only.');

    const input = screen.getByRole('textbox', { name: 'Case title' });
    expect(input).toHaveFocus();

    const close = screen.getByRole('button', { name: 'Close dialog' });
    const save = screen.getByRole('button', { name: 'Save changes' });

    save.focus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(save).toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(trigger.closest('[inert]')).toBeNull();
  });

  it('restores focus after the close control is activated', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole('button', { name: 'Open case settings' });
    await user.click(trigger);

    await user.click(await screen.findByRole('button', { name: 'Close dialog' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('marks every non-dialog body child inert while open', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Open case settings' }));

    const backdrop = screen.getByTestId('dialog-backdrop');
    Array.from(document.body.children)
      .filter((child) => child !== backdrop)
      .forEach((child) => {
        expect(child).toHaveAttribute('inert');
      });

    await user.keyboard('{Escape}');
  });

  it('hides the close control and ignores the backdrop when not dismissible', async () => {
    const user = userEvent.setup();
    render(<DialogHarness dismissible={false} />);

    await user.click(screen.getByRole('button', { name: 'Open case settings' }));

    expect(screen.queryByRole('button', { name: 'Close dialog' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(screen.getByRole('dialog', { name: 'Case settings' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('gives its close and action controls the 44x44 shared targets', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Open case settings' }));

    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveClass('nd-icon-button');
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveClass('nd-button');

    expectMinimumTarget('.nd-icon-button');
    expectMinimumTarget('.nd-button');
    expectVisibleFocusRing('.nd-icon-button');
    expectVisibleFocusRing('.nd-button');

    await user.keyboard('{Escape}');
  });
});

describe('Toast', () => {
  it('is a polite live region with a keyboard-operable optional action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onDismiss = vi.fn();

    const { rerender } = render(
      <Toast
        message="Card moved to the shelf."
        tone="success"
        actionLabel="Undo"
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent('Success: Card moved to the shelf.');

    const action = screen.getByRole('button', { name: 'Undo' });
    expect(action).toHaveClass('nd-button');
    expectMinimumTarget('.nd-button');

    await user.tab();
    expect(action).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(
      <Toast
        message="Card returned to the board."
        tone="success"
        actionLabel="Undo"
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Card returned to the board.');
    expect(status).not.toHaveTextContent('Card moved to the shelf.');
  });

  it('keeps an empty live region mounted between announcements', () => {
    render(<Toast message={null} />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Field', () => {
  it('associates the label, hint, required state, and announced error', async () => {
    const user = userEvent.setup();

    render(
      <Field label="Topic" hint="Use one or two words." error="Choose a topic." required>
        {(control) => <input {...control} />}
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'Topic' });
    expect(input).toHaveClass('nd-field__control');
    expect(input).toHaveAccessibleName('Topic');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ').length).toBe(2);
    describedBy.split(' ').forEach((id) => {
      expect(document.getElementById(id)).toBeInTheDocument();
    });
    expect(input.getAttribute('aria-errormessage')).toBe(describedBy.split(' ')[1]);

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a topic.');
    expectMinimumTarget('.nd-field__control');
    expectVisibleFocusRing('.nd-field__control');

    await user.tab();
    expect(input).toHaveFocus();
  });

  it('omits invalid state and the alert when there is no error', () => {
    render(
      <Field label="Subject" hint="Optional context.">
        {(control) => <input {...control} />}
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'Subject' });
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).not.toHaveAttribute('aria-errormessage');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ')).toHaveLength(1);
    expect(document.getElementById(describedBy)).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('names its region and keeps the recovery action keyboard operable', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <EmptyState
        title="No cases yet"
        description="Create your first case to start pinning evidence."
        action={<Button onClick={onClick}>Create a case</Button>}
      />,
    );

    expect(screen.getByRole('region', { name: 'No cases yet' })).toBeInTheDocument();

    const action = screen.getByRole('button', { name: 'Create a case' });
    expect(action).toHaveClass('nd-button');
    expectMinimumTarget('.nd-button');

    await user.tab();
    expect(action).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('supports a secondary heading level without losing the region name', () => {
    render(<EmptyState title="No connections" headingLevel={3} />);

    expect(screen.getByRole('heading', { level: 3, name: 'No connections' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'No connections' })).toBeInTheDocument();
  });
});

describe('shared style contracts', () => {
  it('removes primitive transitions, animations, and transforms under reduced motion', () => {
    const media = 'prefers-reduced-motion';

    ['.nd-button', '.nd-icon-button', '.nd-dialog', '.nd-dialog__panel', '.nd-toast'].forEach(
      (selector) => {
        const styles = declarationsFor(componentsCss, selector, { media });
        expect(styles.get('transition'), `${selector} transition`).toMatch(/^none\b/);
        expect(styles.get('animation'), `${selector} animation`).toMatch(/^none\b/);
      },
    );

    [
      '.nd-button:hover:not(:disabled)',
      '.nd-button:active:not(:disabled)',
      '.nd-icon-button:hover:not(:disabled)',
      '.nd-icon-button:active:not(:disabled)',
      '.nd-dialog__panel',
      '.nd-toast',
    ].forEach((selector) => {
      expect(
        declarationsFor(componentsCss, selector, { media }).get('transform'),
        `${selector} transform`,
      ).toMatch(/^none\b/);
    });
  });

  it('keeps the hidden-background rule inside the dialog lifecycle only', () => {
    expect(componentsCss).toContain('.nd-dialog');
    expect(componentsCss).not.toContain('dangerouslySetInnerHTML');
  });
});
