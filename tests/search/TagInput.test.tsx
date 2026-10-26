import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CardRecord, CaseRecord } from '../../src/domain/model';
import { DEFAULT_VIEWPORT } from '../../src/domain/model';
import NoteSourceForm from '../../src/features/capture/NoteSourceForm';
import TopicForm from '../../src/features/capture/TopicForm';
import { CardDetailPage } from '../../src/features/cards/CardDetailPage';
import TagInput from '../../src/features/search/TagInput';
import {
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const CARD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Biology Final',
  subject: 'Biology',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

function makeCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: CARD_ID,
    caseId: CASE_ID,
    type: 'note',
    title: 'Photosynthesis',
    position: { x: 40, y: 60 },
    tags: ['Cell biology'],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    ...overrides,
  };
}

function makeRepository(card: CardRecord = makeCard()): InMemoryCaseRepository {
  return new InMemoryCaseRepository({ seed: { cases: [CASE], cards: [card] } });
}

function TagHarness({
  initialTags = [],
  onSubmit,
}: {
  readonly initialTags?: readonly string[];
  readonly onSubmit?: () => void;
}) {
  const [tags, setTags] = useState<readonly string[]>(initialTags);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <TagInput value={tags} onChange={setTags} />
      <button type="submit">Submit form</button>
    </form>
  );
}

afterEach(() => {
  cleanup();
});

describe('TagInput', () => {
  it('adds trimmed tags with Enter and comma without submitting the form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TagHarness onSubmit={onSubmit} />);

    const input = screen.getByRole('textbox', { name: 'Tags' });
    expect(input).toHaveAttribute('aria-describedby');
    expect(screen.getByText('0/10')).toBeInTheDocument();

    await user.click(input);
    await user.type(input, '  Cell biology  {Enter}');
    expect(screen.getByRole('list', { name: 'Card tags' })).toHaveTextContent('Cell biology');
    expect(screen.getByText('1/10')).toBeInTheDocument();
    expect(input).toHaveValue('');

    await user.type(input, 'Exam 1,');
    expect(screen.getByText('2/10')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Card tags' })).toHaveTextContent('Exam 1');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects overlong tags and announces the error on the mounted status region', async () => {
    const user = userEvent.setup();
    render(<TagHarness />);

    const input = screen.getByRole('textbox', { name: 'Tags' });
    await user.type(input, `${'a'.repeat(25)}{Enter}`);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('at most 24 characters');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-errormessage', status.id);
    expect(screen.queryByRole('list', { name: 'Card tags' })).not.toBeInTheDocument();
  });

  it('rejects a case-insensitive duplicate and keeps the first display casing', async () => {
    const user = userEvent.setup();
    render(<TagHarness initialTags={['Cell Biology']} />);

    const input = screen.getByRole('textbox', { name: 'Tags' });
    await user.type(input, '  cell biology  {Enter}');

    expect(screen.getByRole('status')).toHaveTextContent('Cell Biology');
    const list = screen.getByRole('list', { name: 'Card tags' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('Cell Biology');
    expect(list).not.toHaveTextContent('cell biology');
    expect(screen.getByText('1/10')).toBeInTheDocument();
  });

  it('rejects an eleventh tag and announces the limit', async () => {
    const user = userEvent.setup();
    const initialTags = Array.from({ length: 10 }, (_value, index) => `Tag ${index + 1}`);
    render(<TagHarness initialTags={initialTags} />);

    expect(screen.getByText('10/10')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Tags' }), 'Overflow{Enter}');

    expect(screen.getByRole('status')).toHaveTextContent('at most 10 tags');
    expect(screen.getByText('10/10')).toBeInTheDocument();
    expect(screen.queryByText('Overflow')).not.toBeInTheDocument();
  });

  it('removes the last tag with Backspace only when the draft is empty', async () => {
    const user = userEvent.setup();
    render(<TagHarness initialTags={['One', 'Two']} />);

    const input = screen.getByRole('textbox', { name: 'Tags' });
    await user.click(input);
    await user.type(input, 'x');
    await user.keyboard('{Backspace}');
    expect(screen.getByText('2/10')).toBeInTheDocument();

    await user.keyboard('{Backspace}');
    expect(screen.getByText('1/10')).toBeInTheDocument();
    expect(screen.queryByText('Two')).not.toBeInTheDocument();

    await user.keyboard('{Backspace}');
    expect(screen.getByText('0/10')).toBeInTheDocument();
    expect(screen.queryByText('One')).not.toBeInTheDocument();
  });

  it('gives every remove control an accessible name and returns focus to the input', async () => {
    const user = userEvent.setup();
    render(<TagHarness initialTags={['Cell biology', 'Exam 1']} />);

    const remove = screen.getByRole('button', { name: 'Remove tag Exam 1' });
    expect(remove).toHaveClass('nd-icon-button');

    await user.click(remove);

    expect(screen.queryByRole('button', { name: 'Remove tag Exam 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tags' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Removed “Exam 1”.');
  });

  it('keeps the remove control at the 44px target with a token-driven focus ring', () => {
    const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
    const css = readRepositoryFile('src/features/search/TagInput.css');
    const remove = declarationsFor(css, '.tag-input__remove');

    expect(resolveLengthPx(tokens, remove.get('min-block-size'))).toBeGreaterThanOrEqual(44);
    expect(resolveLengthPx(tokens, remove.get('min-inline-size'))).toBeGreaterThanOrEqual(44);
    expect(declarationsFor(css, '.tag-input__remove:focus-visible').get('outline')).toContain(
      'var(--color-focus-ring)',
    );
    expect(declarationsFor(css, '.tag-input__field:focus-visible').get('outline')).toContain(
      'var(--focus-ring-width)',
    );
    expect(css).not.toMatch(/(#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/i);
    expect(readRepositoryFile('src/features/search/TagInput.tsx')).not.toContain(
      'dangerouslySetInnerHTML',
    );
  });
});

describe('Tag persistence wiring', () => {
  it('submits trimmed tags from a topic form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TopicForm onBack={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox', { name: 'Topic title' }), '  Carbonyls  ');
    const tags = screen.getByRole('textbox', { name: 'Topic tags' });
    await user.type(tags, '  Organic  {Enter}');
    await user.type(tags, 'Exam 2,');
    await user.click(screen.getByRole('button', { name: 'Add topic' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Carbonyls',
      tags: ['Organic', 'Exam 2'],
    });
  });

  it('submits tags from a note or source form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<NoteSourceForm onBack={vi.fn()} onSubmit={onSubmit} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Card type' }), 'source');
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '  Lecture 3  ');
    await user.type(screen.getByRole('textbox', { name: 'Tags' }), 'Biochemistry{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save card' }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'source',
      title: 'Lecture 3',
      retainFullResolution: false,
      tags: ['Biochemistry'],
    });
  });

  it('saves card detail tags through the repository and shows them after reload', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();

    const first = render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}/card/${CARD_ID}`]}>
        <Routes>
          <Route
            path="/case/:caseId/card/:cardId"
            element={<CardDetailPage repository={repository} />}
          />
          <Route path="/case/:caseId" element={<h2>Case board</h2>} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    const trigger = screen.getByRole('button', { name: 'Edit tags' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Edit card tags' });
    const input = await within(dialog).findByRole('textbox', { name: 'Card tags' });
    await waitFor(() => expect(input).toHaveFocus());

    await user.type(input, '  Exam 1  {Enter}');
    await user.type(input, 'Mitosis,');
    await user.click(within(dialog).getByRole('button', { name: 'Save tags' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit card tags' })).not.toBeInTheDocument();
    });
    expect(await repository.getCard(CARD_ID)).toMatchObject({
      tags: ['Cell biology', 'Exam 1', 'Mitosis'],
    });
    expect(await screen.findByText('Card tags updated.')).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    first.unmount();

    render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}/card/${CARD_ID}`]}>
        <Routes>
          <Route
            path="/case/:caseId/card/:cardId"
            element={<CardDetailPage repository={repository} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const reloaded = await screen.findByRole('list', { name: 'Card tags' });
    expect(reloaded).toHaveTextContent('Exam 1');
    expect(reloaded).toHaveTextContent('Mitosis');
  });

  it('closes the tag dialog with Escape and restores the trigger', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}/card/${CARD_ID}`]}>
        <Routes>
          <Route
            path="/case/:caseId/card/:cardId"
            element={<CardDetailPage repository={makeRepository()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    const trigger = screen.getByRole('button', { name: 'Edit tags' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: 'Edit card tags' });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit card tags' })).not.toBeInTheDocument();
    });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
