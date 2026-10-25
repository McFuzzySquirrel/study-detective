import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Button from '../../src/components/Button';
import CaseFormDialog from '../../src/features/shelf/CaseFormDialog';
import type { CaseFormMode, CaseFormValues } from '../../src/features/shelf/CaseFormDialog';
import type { CaseSummary } from '../../src/domain/model';
import {
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

type SubmitHandler = (values: CaseFormValues) => Promise<void>;

interface HarnessProps {
  readonly mode?: CaseFormMode;
  readonly initialCase?: CaseSummary | undefined;
  readonly onSubmit: SubmitHandler;
}

function Harness({ mode = 'create', initialCase, onSubmit }: HarnessProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open case form</Button>
      <p>Background content stays inert while the form is open.</p>
      {open ? (
        <CaseFormDialog
          mode={mode}
          {...(initialCase !== undefined ? { initialCase } : {})}
          onClose={() => setOpen(false)}
          onSubmit={onSubmit}
        />
      ) : null}
    </div>
  );
}

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const EXISTING_CASE: CaseSummary = {
  id: CASE_ID,
  title: 'Tudor England',
  subject: 'History',
  examDate: '2026-11-02',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  closedAt: null,
  isDemo: false,
  cardCount: 4,
  connectionCount: 3,
};

function maxLength(...values: number[]): number {
  return Math.max(...values.filter((value) => Number.isFinite(value)));
}

function requireControlTarget(css: string, selector: string): void {
  const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
  const styles = declarationsFor(css, selector);
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

afterEach(() => {
  cleanup();
});

describe('CaseFormDialog', () => {
  it('creates through the keyboard, trims the title, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>().mockResolvedValue(undefined);

    render(<Harness onSubmit={onSubmit} />);

    const trigger = screen.getByRole('button', { name: 'Open case form' });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Create a case' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const title = screen.getByRole('textbox', { name: 'Case title' });
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute('aria-required', 'true');

    await user.type(title, '  Tudor England  ');
    await user.tab();
    await user.type(screen.getByRole('textbox', { name: 'Subject' }), 'History');
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: '2026-11-02' } });
    await user.click(screen.getByRole('button', { name: 'Create case' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Tudor England',
        subject: 'History',
        examDate: '2026-11-02',
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('announces an empty title, marks the field invalid, and writes nothing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>().mockResolvedValue(undefined);

    render(<Harness onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Open case form' }));
    await user.click(screen.getByRole('button', { name: 'Create case' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Enter a case title.');

    const title = screen.getByRole('textbox', { name: 'Case title' });
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAttribute('aria-errormessage', alert.id);
    expect(title).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Create a case' })).toBeInTheDocument();
  });

  it('rejects a title over 80 characters without writing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>().mockResolvedValue(undefined);

    render(<Harness onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Open case form' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Case title' }), {
      target: { value: 'a'.repeat(81) },
    });
    await user.click(screen.getByRole('button', { name: 'Create case' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Case titles can be at most 80 characters.',
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('edits pre-filled values and clears optional fields with null', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>().mockResolvedValue(undefined);

    render(<Harness mode="edit" initialCase={EXISTING_CASE} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Open case form' }));

    const title = await screen.findByRole('textbox', { name: 'Case title' });
    const subject = screen.getByRole('textbox', { name: 'Subject' });
    const examDate = screen.getByLabelText('Exam date');

    expect(title).toHaveValue('Tudor England');
    expect(subject).toHaveValue('History');
    expect(examDate).toHaveValue('2026-11-02');

    await user.clear(subject);
    await user.clear(examDate);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Tudor England',
        subject: null,
        examDate: null,
      });
    });
  });

  it('closes on Escape and restores focus without submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>().mockResolvedValue(undefined);

    render(<Harness onSubmit={onSubmit} />);

    const trigger = screen.getByRole('button', { name: 'Open case form' });
    await user.tab();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Create a case' });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the draft open and announces a persistence failure', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>().mockRejectedValue(new Error('storage unavailable'));

    render(<Harness onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Open case form' }));
    const title = screen.getByRole('textbox', { name: 'Case title' });
    await user.type(title, 'Tudor England');
    await user.click(screen.getByRole('button', { name: 'Create case' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The case could not be created.');
    expect(alert).not.toHaveTextContent('storage unavailable');
    expect(screen.getByRole('dialog', { name: 'Create a case' })).toBeInTheDocument();
    expect(title).toHaveValue('Tudor England');
    expect(screen.getByRole('button', { name: 'Create case' })).toBeEnabled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('uses labelled 44px controls with visible focus rings', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>().mockResolvedValue(undefined);

    render(<Harness onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Open case form' }));

    const title = await screen.findByRole('textbox', { name: 'Case title' });
    const subject = screen.getByRole('textbox', { name: 'Subject' });
    const examDate = screen.getByLabelText('Exam date');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const submit = screen.getByRole('button', { name: 'Create case' });

    [title, subject, examDate].forEach((control) => {
      expect(control).toHaveClass('nd-field__control');
      expect(control).toHaveAttribute('aria-describedby');
    });
    expect(cancel).toHaveClass('nd-button');
    expect(submit).toHaveClass('nd-button');

    const componentsCss = readRepositoryFile('src/components/components.css');
    requireControlTarget(componentsCss, '.nd-field__control');
    requireControlTarget(componentsCss, '.nd-button');

    expect(
      declarationsFor(componentsCss, '.nd-field__control:focus-visible').get('outline'),
    ).toContain('var(--color-focus-ring)');
    expect(declarationsFor(componentsCss, '.nd-button:focus-visible').get('outline')).toContain(
      'var(--color-focus-ring)',
    );

    await user.keyboard('{Escape}');
  });
});
