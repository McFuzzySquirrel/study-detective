import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import { InMemoryConnectionRepository } from '../../src/data/connectionRepository';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../src/domain/model';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../src/domain/model';
import CardListPanel from '../../src/features/case/CardListPanel';
import TopicStatusBadge from '../../src/features/case/TopicStatusBadge';
import { CardDetailPage } from '../../src/features/cards/CardDetailPage';
import {
  contrastRatio,
  parseTokens,
  readRepositoryFile,
  resolveColor,
} from '../helpers/css-contract';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOTE_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOPIC_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CONNECTION_A_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CONNECTION_B_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const NOTE_A_TITLE = 'Passive transport';
const NOTE_B_TITLE = 'Active transport';
const SOURCE_TITLE = 'Lecture handout';
const TOPIC_TITLE = 'Osmosis';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Membrane transport',
  subject: 'Biology',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

function makeCard(id: string, type: CardRecord['type'], title: string, x: number): CardRecord {
  return {
    id,
    caseId: CASE_ID,
    type,
    title,
    position: { x, y: 160 },
    tags: [],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
  };
}

const NOTE_A = makeCard(NOTE_A_ID, 'note', NOTE_A_TITLE, 120);
const NOTE_B = makeCard(NOTE_B_ID, 'note', NOTE_B_TITLE, 260);
const SOURCE = makeCard(SOURCE_ID, 'source', SOURCE_TITLE, 400);
const TOPIC = makeCard(TOPIC_ID, 'topic', TOPIC_TITLE, 540);

const CARDS: readonly CardRecord[] = [NOTE_A, NOTE_B, SOURCE, TOPIC];

function association(fromCardId: string, toCardId: string, id: string): ConnectionRecord {
  return {
    id,
    caseId: CASE_ID,
    fromCardId,
    toCardId,
    pairKey: buildPairKey(fromCardId, toCardId),
    type: 'association',
  };
}

function makeCaseRepository(connections: readonly ConnectionRecord[] = []): InMemoryCaseRepository {
  return new InMemoryCaseRepository({
    seed: { cases: [CASE], cards: CARDS, connections },
  });
}

function makeConnectionRepository(
  connections: readonly ConnectionRecord[] = [],
): InMemoryConnectionRepository {
  return new InMemoryConnectionRepository({ cards: CARDS, connections });
}

function topicName(status: string, count: number): string {
  return `Topic status: ${status}, ${linkedNoteCountLabel(count)}`;
}

/** Mirrors the component copy so the test fails if either form drifts. */
function linkedNoteCountLabel(count: number): string {
  return `${count} linked ${count === 1 ? 'note' : 'notes'}`;
}

function renderPanel(connections: readonly ConnectionRecord[]) {
  const view = render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}/list`]}>
      <CardListPanel
        cards={CARDS}
        connections={connections}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </MemoryRouter>,
  );

  const rerenderWith = (next: readonly ConnectionRecord[]): void => {
    view.rerender(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}/list`]}>
        <CardListPanel cards={CARDS} connections={next} onEdit={() => {}} onDelete={() => {}} />
      </MemoryRouter>,
    );
  };

  return { ...view, rerenderWith };
}

function renderCardDetail(
  cardId: string,
  repository: InMemoryCaseRepository,
  connectionRepository: InMemoryConnectionRepository,
) {
  return render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}/card/${cardId}`]}>
      <Routes>
        <Route
          path="/case/:caseId/card/:cardId"
          element={
            <CardDetailPage repository={repository} connectionRepository={connectionRepository} />
          }
        />
        <Route path="/case/:caseId" element={<h2>Case board</h2>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('TopicStatusBadge states', () => {
  it.each([
    { count: 0, status: 'orphan', label: 'Orphan' },
    { count: 1, status: 'developing', label: 'Developing' },
    { count: 2, status: 'solved', label: 'Solved' },
    { count: 7, status: 'solved', label: 'Solved' },
  ] as const)(
    'renders $label with text and icon at $count linked notes',
    ({ count, status, label }) => {
      render(
        <MemoryRouter>
          <TopicStatusBadge cardType="topic" status={status} linkedNoteCount={count} />
        </MemoryRouter>,
      );

      const badge = screen.getByRole('status', {
        name: topicName(label, count),
      });

      expect(badge).toHaveAttribute('data-status', status);
      expect(badge).toHaveTextContent(label);
      expect(badge).toHaveTextContent(linkedNoteCountLabel(count));

      // The glyph is decorative and hidden from assistive technology; the text
      // and accessible name already carry both pieces of information.
      const icon = badge.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
    },
  );

  it('gives each status a distinct icon silhouette', () => {
    const markup = (['orphan', 'developing', 'solved'] as const).map((status) => {
      const view = render(
        <TopicStatusBadge
          cardType="topic"
          status={status}
          linkedNoteCount={status === 'orphan' ? 0 : status === 'developing' ? 1 : 2}
        />,
      );
      const icon = view.container.querySelector('svg')?.innerHTML ?? '';
      view.unmount();
      return icon;
    });

    expect(new Set(markup).size).toBe(3);
  });

  it('states singular and plural counts in the visible and announced label', () => {
    expect(linkedNoteCountLabel(0)).toBe('0 linked notes');
    expect(linkedNoteCountLabel(1)).toBe('1 linked note');
    expect(linkedNoteCountLabel(2)).toBe('2 linked notes');

    render(<TopicStatusBadge cardType="topic" status="developing" linkedNoteCount={1} />);
    expect(
      screen.getByRole('status', { name: 'Topic status: Developing, 1 linked note' }),
    ).toHaveTextContent('1 linked note');
  });

  it('exposes a status and count label to keyboard and screen-reader users without adding a tab stop', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <button type="button">Before badge</button>
        <TopicStatusBadge cardType="topic" status="solved" linkedNoteCount={2} />
        <button type="button">After badge</button>
      </MemoryRouter>,
    );

    const badge = screen.getByRole('status', { name: topicName('Solved', 2) });
    expect(badge).toHaveTextContent('Solved');
    expect(badge).toHaveTextContent('2 linked notes');

    // Keyboard users hear the label in reading order; the non-interactive chip
    // is skipped by Tab instead of becoming a dead stop.
    screen.getByRole('button', { name: 'Before badge' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After badge' })).toHaveFocus();
    expect(badge).not.toHaveFocus();
  });

  it.each(['note', 'source'] as const)('never renders a badge for a %s', (cardType) => {
    const view = render(
      <TopicStatusBadge cardType={cardType} status="solved" linkedNoteCount={3} />,
    );

    expect(view.container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/linked note/)).not.toBeInTheDocument();
  });

  it('treats a corrupt negative count defensively as zero', () => {
    render(<TopicStatusBadge cardType="topic" status="orphan" linkedNoteCount={-2} />);
    expect(screen.getByRole('status', { name: topicName('Orphan', 0) })).toBeInTheDocument();
  });

  it('uses no points, XP, score, level, streak, grade, or ranking copy', () => {
    render(
      <>
        <TopicStatusBadge cardType="topic" status="orphan" linkedNoteCount={0} />
        <TopicStatusBadge cardType="topic" status="developing" linkedNoteCount={1} />
        <TopicStatusBadge cardType="topic" status="solved" linkedNoteCount={2} />
      </>,
    );

    const text = screen
      .getAllByRole('status')
      .map((badge) => badge.textContent ?? '')
      .join(' ');
    const names = screen
      .getAllByRole('status')
      .map((badge) => badge.getAttribute('aria-label') ?? '')
      .join(' ');

    expect(`${text} ${names}`).not.toMatch(
      /\b(?:score|scores|point|points|xp|rank|ranking|level|levels|streak|grade)\b/i,
    );
  });
});

describe('TopicStatusBadge in the card list', () => {
  it('shows the derived status only on topics and updates as connections change', () => {
    const { rerenderWith } = renderPanel([]);

    const topics = screen.getByRole('region', { name: /Topics/ });
    const notes = screen.getByRole('region', { name: /Study notes/ });
    const sources = screen.getByRole('region', { name: /Sources/ });

    // Orphan: zero linked notes.
    expect(within(topics).getByRole('status', { name: topicName('Orphan', 0) })).toBeVisible();

    // Notes and Sources never carry a topic badge.
    expect(within(notes).queryByRole('status')).not.toBeInTheDocument();
    expect(within(sources).queryByRole('status')).not.toBeInTheDocument();
    expect(within(notes).queryByText(/linked note/)).not.toBeInTheDocument();
    expect(within(sources).queryByText(/linked note/)).not.toBeInTheDocument();

    // One added association: Developing, without remounting the panel.
    const first = association(NOTE_A_ID, TOPIC_ID, CONNECTION_A_ID);
    rerenderWith([first]);
    expect(within(topics).getByRole('status', { name: topicName('Developing', 1) })).toBeVisible();
    expect(within(topics).queryByText('Orphan')).not.toBeInTheDocument();

    // A second note: Solved at two distinct linked notes.
    const second = association(NOTE_B_ID, TOPIC_ID, CONNECTION_B_ID);
    rerenderWith([first, second]);
    expect(within(topics).getByRole('status', { name: topicName('Solved', 2) })).toBeVisible();

    // Removing the second string drops the status back to Developing.
    rerenderWith([first]);
    expect(within(topics).getByRole('status', { name: topicName('Developing', 1) })).toBeVisible();

    // Removing the last string returns to Orphan.
    rerenderWith([]);
    expect(within(topics).getByRole('status', { name: topicName('Orphan', 0) })).toBeVisible();
  });
});

describe('TopicStatusBadge in card detail', () => {
  it('updates a topic badge after a connection is added and deleted by keyboard', async () => {
    const user = userEvent.setup();
    const repository = makeCaseRepository();
    const connectionRepository = makeConnectionRepository();

    renderCardDetail(TOPIC_ID, repository, connectionRepository);

    expect(await screen.findByRole('heading', { level: 2, name: TOPIC_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: topicName('Orphan', 0) })).toBeVisible();

    // Add an association to the first note through the keyboard picker.
    const connect = screen.getByRole('button', { name: 'Connect to…' });
    connect.focus();
    await user.keyboard('{Enter}');

    let dialog = await screen.findByRole('dialog', { name: 'Connect to a card' });
    const target = within(dialog).getByRole('radio', { name: NOTE_A_TITLE });
    target.focus();
    await user.keyboard(' ');
    expect(target).toBeChecked();

    const save = within(dialog).getByRole('button', { name: 'Save' });
    save.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(await screen.findByRole('status', { name: topicName('Developing', 1) })).toBeVisible();
    expect(await connectionRepository.listByCase(CASE_ID)).toHaveLength(1);

    // Removing the same string drops the badge back to Orphan in place.
    screen.getByRole('button', { name: 'Connect to…' }).focus();
    await user.keyboard('{Enter}');

    dialog = await screen.findByRole('dialog', { name: 'Connect to a card' });
    const edit = within(dialog).getByRole('button', {
      name: `Edit connection with ${NOTE_A_TITLE}`,
    });
    edit.focus();
    await user.keyboard('{Enter}');

    const manage = await screen.findByRole('dialog', { name: 'Manage connection' });
    const deleteTrigger = within(manage).getByRole('button', { name: 'Delete connection' });
    deleteTrigger.focus();
    await user.keyboard('{Enter}');

    const confirm = await screen.findByRole('dialog', { name: 'Manage connection' });
    const confirmDelete = within(confirm).getByRole('button', { name: 'Delete connection' });
    confirmDelete.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('status', { name: topicName('Orphan', 0) })).toBeVisible();
    expect(await connectionRepository.listByCase(CASE_ID)).toHaveLength(0);
  });

  it.each(['note', 'source'] as const)(
    'does not render a topic badge on a %s detail',
    async (cardType) => {
      const card = cardType === 'note' ? NOTE_A : SOURCE;
      const repository = makeCaseRepository([association(NOTE_A_ID, TOPIC_ID, CONNECTION_A_ID)]);
      const connectionRepository = makeConnectionRepository([
        association(NOTE_A_ID, TOPIC_ID, CONNECTION_A_ID),
      ]);

      renderCardDetail(card.id, repository, connectionRepository);

      expect(
        await screen.findByRole('heading', { level: 2, name: card.title }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('status', { name: /Topic status/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/linked note/)).not.toBeInTheDocument();
    },
  );
});

describe('TopicStatusBadge CSS contract', () => {
  const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

  it('keeps every palette value in tokens.css', () => {
    for (const path of [
      'src/features/case/TopicStatusBadge.tsx',
      'src/features/case/TopicStatusBadge.css',
    ]) {
      expect(readRepositoryFile(path)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });

  it.each([
    ['orphan', '--color-ink-muted', '--color-surface-sunken'],
    ['developing', '--color-warning-ink', '--color-warning'],
    ['solved', '--color-success-ink', '--color-success'],
  ] as const)('keeps the %s tone at or above 4.5:1', (_status, foreground, background) => {
    expect(
      contrastRatio(resolveColor(tokens, foreground), resolveColor(tokens, background)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('removes the tone transition when motion is reduced', () => {
    expect(readRepositoryFile('src/features/case/TopicStatusBadge.css')).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.topic-status[\s\S]*?transition: none/,
    );
  });
});
