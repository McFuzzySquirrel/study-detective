import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AppRoutes from '../../src/app/routes';
import type { CaseRepositoryLoader } from '../../src/features/shelf/CaseShelfPage';
import CaseShelfPage from '../../src/features/shelf/CaseShelfPage';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CaseRepositoryPort } from '../../src/data/caseRepository';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../src/domain/model';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../src/domain/model';
import {
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
  stripComments,
} from '../helpers/css-contract';

const IDS = {
  organic: '11111111-1111-4111-8111-111111111111',
  constitutional: '22222222-2222-4222-8222-222222222222',
  ethics: '33333333-3333-4333-8333-333333333333',
  history: '44444444-4444-4444-8444-444444444444',
  closed: '55555555-5555-4555-8555-555555555555',
  cardA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cardB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  connection: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
} as const;

type CaseOverrides = {
  readonly subject?: string;
  readonly examDate?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly closedAt?: string | null;
};

function makeCase(id: string, title: string, overrides: CaseOverrides = {}): CaseRecord {
  const createdAt = overrides.createdAt ?? '2026-09-01T09:00:00.000Z';

  return {
    id,
    title,
    ...(overrides.subject !== undefined ? { subject: overrides.subject } : {}),
    ...(overrides.examDate !== undefined ? { examDate: overrides.examDate } : {}),
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    viewport: DEFAULT_VIEWPORT,
    closedAt: overrides.closedAt ?? null,
    isDemo: false,
    backupPromptedAt: null,
  };
}

const EVIDENCE_CARDS: readonly CardRecord[] = [
  {
    id: IDS.cardA,
    caseId: IDS.organic,
    type: 'note',
    title: 'Lecture 1',
    position: { x: 0, y: 0 },
    tags: [],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
  },
  {
    id: IDS.cardB,
    caseId: IDS.organic,
    type: 'topic',
    title: 'Carbonyls',
    position: { x: 120, y: 0 },
    tags: [],
    createdAt: '2026-09-02T09:05:00.000Z',
    updatedAt: '2026-09-02T09:05:00.000Z',
  },
];

const EVIDENCE_CONNECTIONS: readonly ConnectionRecord[] = [
  {
    id: IDS.connection,
    caseId: IDS.organic,
    fromCardId: IDS.cardA,
    toCardId: IDS.cardB,
    pairKey: buildPairKey(IDS.cardA, IDS.cardB),
    type: 'association',
  },
];

function makeRepository(cases: readonly CaseRecord[], withEvidence = false): CaseRepositoryPort {
  return new InMemoryCaseRepository({
    seed: withEvidence
      ? { cases, cards: EVIDENCE_CARDS, connections: EVIDENCE_CONNECTIONS }
      : { cases },
  });
}

function renderShelf(repository: CaseRepositoryPort) {
  return render(
    <MemoryRouter>
      <CaseShelfPage repository={repository} />
    </MemoryRouter>,
  );
}

async function caseLinks(): Promise<HTMLElement[]> {
  return screen.findAllByRole('link');
}

function cardFor(title: string): HTMLElement {
  const link = screen.getByRole('link', { name: title });
  const card = link.closest('article');

  if (card === null) {
    throw new Error(`The card for "${title}" is missing its article element.`);
  }

  return card;
}

function maxLength(...values: number[]): number {
  return Math.max(...values.filter((value) => Number.isFinite(value)));
}

function requireBlockTarget(css: string, selector: string): void {
  const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
  const styles = declarationsFor(css, selector);
  const block = maxLength(
    resolveLengthPx(tokens, styles.get('min-block-size')),
    resolveLengthPx(tokens, styles.get('block-size')),
  );

  expect(block, `${selector} block target`).toBeGreaterThanOrEqual(44);
}

afterEach(() => {
  cleanup();
});

describe('CaseShelfPage', () => {
  it('renders persisted cases in nearest-exam order with counts and a closure badge', async () => {
    const repository = makeRepository(
      [
        makeCase(IDS.organic, 'Organic Chemistry', {
          subject: 'Chemistry',
          examDate: '2026-11-02',
          updatedAt: '2026-10-01T10:00:00.000Z',
        }),
        makeCase(IDS.constitutional, 'Constitutional Law', {
          examDate: '2026-11-10',
          updatedAt: '2026-10-20T10:00:00.000Z',
        }),
        makeCase(IDS.closed, 'Victorian Literature', {
          examDate: '2026-12-01',
          updatedAt: '2026-10-05T10:00:00.000Z',
          closedAt: '2026-10-05T11:00:00.000Z',
        }),
        makeCase(IDS.ethics, 'Undated Ethics', {
          updatedAt: '2026-10-25T10:00:00.000Z',
        }),
        makeCase(IDS.history, 'Undated History', {
          updatedAt: '2026-10-15T10:00:00.000Z',
        }),
      ],
      true,
    );

    renderShelf(repository);

    await screen.findByRole('link', { name: 'Organic Chemistry' });

    expect((await caseLinks()).map((link) => link.textContent)).toEqual([
      'Organic Chemistry',
      'Constitutional Law',
      'Victorian Literature',
      'Undated Ethics',
      'Undated History',
    ]);

    const organic = cardFor('Organic Chemistry');
    expect(within(organic).getByText('Chemistry')).toBeInTheDocument();
    expect(within(organic).getByText('2 Nov 2026')).toHaveAttribute('dateTime', '2026-11-02');
    expect(within(organic).getByText('Cards').nextElementSibling).toHaveTextContent('2');
    expect(within(organic).getByText('Connections').nextElementSibling).toHaveTextContent('1');
    expect(within(organic).getByText(/Updated/)).toBeInTheDocument();
    expect(within(organic).queryByText('Closed')).not.toBeInTheDocument();

    const closed = cardFor('Victorian Literature');
    expect(within(closed).getByText('Closed')).toBeInTheDocument();

    const undated = cardFor('Undated Ethics');
    expect(within(undated).getByText('No subject recorded')).toBeInTheDocument();
    expect(within(undated).getByText('No exam date')).toBeInTheDocument();
  });

  it('creates a case from the empty state, announces it, and focuses the new card', async () => {
    const user = userEvent.setup();
    const repository = makeRepository([]);

    renderShelf(repository);

    const createButton = await screen.findByRole('button', { name: 'Create your first case' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'New case' })).not.toBeInTheDocument();

    createButton.focus();
    await user.keyboard('{Enter}');

    const title = await screen.findByRole('textbox', { name: 'Case title' });
    expect(title).toHaveFocus();

    await user.type(title, '  Tudor England  ');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const createdLink = await screen.findByRole('link', { name: 'Tudor England' });
    await waitFor(() => {
      expect(createdLink).toHaveFocus();
    });
    expect(createdLink).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Case created: Tudor England.');
    expect(screen.getByRole('button', { name: 'New case' })).toBeInTheDocument();

    const summaries = await repository.listCaseSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      title: 'Tudor England',
      cardCount: 0,
      connectionCount: 0,
    });
  });

  it('shows an announced title error and writes nothing for an empty title', async () => {
    const user = userEvent.setup();
    const repository = makeRepository([]);

    renderShelf(repository);

    await user.click(await screen.findByRole('button', { name: 'Create your first case' }));
    await user.click(screen.getByRole('button', { name: 'Create case' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Enter a case title.');

    const title = screen.getByRole('textbox', { name: 'Case title' });
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Create a case' })).toBeInTheDocument();
    expect(await repository.listCaseSummaries()).toHaveLength(0);
  });

  it('renames a case, edits subject and exam date, reorders the shelf, and restores focus', async () => {
    const user = userEvent.setup();
    const repository = makeRepository([
      makeCase(IDS.organic, 'Organic Chemistry', {
        subject: 'Chemistry',
        examDate: '2026-11-02',
        updatedAt: '2026-10-01T10:00:00.000Z',
      }),
      makeCase(IDS.ethics, 'Undated Ethics', {
        subject: 'Philosophy',
        updatedAt: '2026-10-20T10:00:00.000Z',
      }),
    ]);

    renderShelf(repository);

    await screen.findByRole('link', { name: 'Organic Chemistry' });
    expect((await caseLinks()).map((link) => link.textContent)).toEqual([
      'Organic Chemistry',
      'Undated Ethics',
    ]);

    const editTrigger = screen.getByRole('button', { name: 'Edit Undated Ethics' });
    await user.click(editTrigger);

    const title = await screen.findByRole('textbox', { name: 'Case title' });
    const subject = screen.getByRole('textbox', { name: 'Subject' });
    expect(title).toHaveValue('Undated Ethics');
    expect(subject).toHaveValue('Philosophy');

    await user.clear(title);
    await user.type(title, 'Applied Ethics');
    await user.clear(subject);
    await user.type(subject, 'Moral Philosophy');
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: '2026-10-25' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect((await caseLinks()).map((link) => link.textContent)).toEqual([
      'Applied Ethics',
      'Organic Chemistry',
    ]);

    const card = cardFor('Applied Ethics');
    expect(within(card).getByText('Moral Philosophy')).toBeInTheDocument();
    expect(within(card).getByText('25 Oct 2026')).toHaveAttribute('dateTime', '2026-10-25');
    expect(screen.getByRole('status')).toHaveTextContent('Case updated: Applied Ethics.');
    expect(screen.getByRole('button', { name: 'Edit Applied Ethics' })).toHaveFocus();

    const stored = await repository.getCaseSummary(IDS.ethics);
    expect(stored?.title).toBe('Applied Ethics');
    expect(stored?.subject).toBe('Moral Philosophy');
    expect(stored?.examDate).toBe('2026-10-25');
  });

  it('turns an open/read failure into a recoverable error with Retry and import guidance', async () => {
    const user = userEvent.setup();
    const repository = makeRepository(
      [
        makeCase(IDS.organic, 'Organic Chemistry', {
          examDate: '2026-11-02',
          updatedAt: '2026-10-01T10:00:00.000Z',
        }),
      ],
      true,
    );
    const loader = vi.fn<CaseRepositoryLoader>();
    loader.mockRejectedValueOnce(new Error('IndexedDB is unavailable'));
    loader.mockResolvedValueOnce(repository);

    render(
      <MemoryRouter>
        <CaseShelfPage loadRepository={loader} />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Case shelf could not open');
    expect(alert).not.toHaveTextContent('IndexedDB is unavailable');
    expect(alert).toHaveTextContent(/import/i);
    expect(alert).toHaveTextContent('.ndcase');

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    const recovered = await screen.findByRole('link', { name: 'Organic Chemistry' });
    await waitFor(() => {
      expect(recovered).toHaveFocus();
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps card links and edit actions in the keyboard path with 44px targets and focus rings', async () => {
    const user = userEvent.setup();
    const repository = makeRepository(
      [
        makeCase(IDS.organic, 'Organic Chemistry', {
          examDate: '2026-11-02',
          updatedAt: '2026-10-01T10:00:00.000Z',
        }),
      ],
      true,
    );

    renderShelf(repository);

    await screen.findByRole('link', { name: 'Organic Chemistry' });

    await user.tab();
    expect(screen.getByRole('button', { name: 'New case' })).toHaveFocus();

    await user.tab();
    const link = screen.getByRole('link', { name: 'Organic Chemistry' });
    expect(link).toHaveFocus();

    await user.tab();
    const edit = screen.getByRole('button', { name: 'Edit Organic Chemistry' });
    expect(edit).toHaveFocus();
    expect(edit).toHaveClass('nd-button');

    const shelfCss = readRepositoryFile('src/features/shelf/shelf.css');
    const componentsCss = readRepositoryFile('src/components/components.css');

    requireBlockTarget(shelfCss, '.case-card__link');
    requireBlockTarget(componentsCss, '.nd-button');

    const linkFocus = declarationsFor(shelfCss, '.case-card__link:focus-visible');
    expect(linkFocus.get('outline')).toContain('var(--focus-ring-width)');
    expect(linkFocus.get('outline')).toContain('var(--color-focus-ring)');

    const buttonFocus = declarationsFor(componentsCss, '.nd-button:focus-visible');
    expect(buttonFocus.get('outline')).toContain('var(--color-focus-ring)');

    expect(stripComments(shelfCss)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);

    const reducedMotion = declarationsFor(shelfCss, '.case-card', {
      media: 'prefers-reduced-motion',
    });
    expect(reducedMotion.get('transition')).toMatch(/^none\b/);
    expect(reducedMotion.get('animation')).toMatch(/^none\b/);
  });

  it('replaces the shelf placeholder through the route table', async () => {
    const repository = makeRepository([
      makeCase(IDS.organic, 'Organic Chemistry', {
        examDate: '2026-11-02',
        updatedAt: '2026-10-01T10:00:00.000Z',
      }),
    ]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes shelfRepository={repository} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Case shelf' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Organic Chemistry' })).toBeInTheDocument();
    expect(
      screen.queryByText('Your case files will be listed here once local storage is connected.'),
    ).not.toBeInTheDocument();
  });
});
