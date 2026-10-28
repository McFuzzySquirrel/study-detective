import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TopicForm from '../../src/features/capture/TopicForm';
import type { TopicFormValues } from '../../src/features/capture/TopicForm';
import {
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

type SubmitHandler = (values: TopicFormValues) => void;

afterEach(() => {
  cleanup();
});

describe('TopicForm', () => {
  it('supports an optional image and submits a trimmed title by keyboard', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>();
    const onBack = vi.fn();

    render(<TopicForm onBack={onBack} onSubmit={onSubmit} />);

    expect(screen.queryByRole('textbox', { name: 'Topic title' })).toBeInTheDocument();
    const imageInput = screen.getByLabelText('Topic image');
    expect(imageInput).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');

    await user.tab();
    const title = screen.getByRole('textbox', { name: 'Topic title' });
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute('aria-required', 'true');

    await user.type(title, '  Carbonyls  ');
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Topic tags' })).toHaveFocus();
    await user.tab();
    expect(imageInput).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
    await user.tab();

    const submit = screen.getByRole('button', { name: 'Add topic' });
    expect(submit).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith({ title: 'Carbonyls' });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('submits the selected image with the topic details', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>();
    const image = new File(['image'], 'topic.png', { type: 'image/png' });
    render(<TopicForm onBack={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox', { name: 'Topic title' }), 'Cell structure');
    fireEvent.change(screen.getByTestId('topic-image-input'), { target: { files: [image] } });
    await user.click(screen.getByRole('button', { name: 'Add topic' }));

    expect(onSubmit).toHaveBeenCalledWith({ title: 'Cell structure', image });
  });

  it('announces and focuses an empty title without submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>();
    render(<TopicForm onBack={vi.fn()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Add topic' }));

    const alert = await screen.findByRole('alert');
    const title = screen.getByRole('textbox', { name: 'Topic title' });

    expect(alert).toHaveTextContent('Enter a title for this topic.');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAttribute('aria-errormessage', alert.id);
    expect(title).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a title over 80 characters without writing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>();
    render(<TopicForm onBack={vi.fn()} onSubmit={onSubmit} />);

    const title = screen.getByRole('textbox', { name: 'Topic title' });
    fireEvent.change(title, { target: { value: 'a'.repeat(81) } });
    await user.click(screen.getByRole('button', { name: 'Add topic' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Titles can be at most 80 characters.',
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('returns through Back without submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<SubmitHandler>();
    const onBack = vi.fn();
    render(<TopicForm onBack={onBack} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses labelled, 44px controls with token-driven focus styles', async () => {
    const user = userEvent.setup();
    render(<TopicForm onBack={vi.fn()} onSubmit={vi.fn()} />);

    const title = screen.getByRole('textbox', { name: 'Topic title' });
    expect(title).toHaveClass('nd-field__control');
    expect(title).toHaveAttribute('aria-describedby');

    const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
    const css = readRepositoryFile('src/features/capture/capture.css');

    const submit = declarationsFor(css, '.capture-form__submit');
    expect(
      resolveLengthPx(tokens, submit.get('min-block-size')),
      'topic submit block target',
    ).toBeGreaterThanOrEqual(44);
    expect(
      resolveLengthPx(tokens, submit.get('min-inline-size')),
      'topic submit inline target',
    ).toBeGreaterThanOrEqual(44);

    const control = declarationsFor(
      readRepositoryFile('src/components/components.css'),
      '.nd-field__control',
    );
    expect(resolveLengthPx(tokens, control.get('min-block-size'))).toBeGreaterThanOrEqual(44);

    expect(declarationsFor(css, '.capture__step:focus-visible').get('outline')).toContain(
      'var(--color-focus-ring)',
    );

    await user.tab();
    await waitFor(() => expect(title).toHaveFocus());
  });
});
