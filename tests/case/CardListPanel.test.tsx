import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type {
  AttachmentRecord,
  CardRecord,
  CaseRecord,
  ConnectionRecord,
} from '../../src/domain/model';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../src/domain/model';
import { CardListPage } from '../../src/features/case/CardListPage';
import { CaseBoardPage } from '../../src/features/case/CaseBoardPage';
import {
  contrastRatio,
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveColor,
  resolveLengthPx,
  stripComments,
} from '../helpers/css-contract';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOPIC_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONNECTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ATTACHMENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SHA_256 = 'b'.repeat(64);

const NOTE_TITLE = 'Membrane transport';
const SOURCE_TITLE = 'Lecture slide 12';
const TOPIC_TITLE = 'Osmosis';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Cell Biology',
  subject: 'Biology',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const NOTE: CardRecord = {
  id: NOTE_ID,
  caseId: CASE_ID,
  type: 'note',
  title: NOTE_TITLE,
  position: { x: 180, y: 240 },
  tags: ['lecture', 'transport'],
  createdAt: '2026-09-02T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
};

const SOURCE: CardRecord = {
  id: SOURCE_ID,
  caseId: CASE_ID,
  type: 'source',
  title: SOURCE_TITLE,
  position: { x: 460, y: 240 },
  tags: [],
  createdAt: '2026-09-02T09:05:00.000Z',
  updatedAt: '2026-09-02T09:05:00.000Z',
};

const TOPIC: CardRecord = {
  id: TOPIC_ID,
  caseId: CASE_ID,
  type: 'topic',
  title: TOPIC_TITLE,
  position: { x: 740, y: 240 },
  tags: [],
  createdAt: '2026-09-02T09:10:00.000Z',
  updatedAt: '2026-09-02T09:10:00.000Z',
};

const CONNECTION: ConnectionRecord = {
  id: CONNECTION_ID,
  caseId: CASE_ID,
  fromCardId: NOTE_ID,
  toCardId: TOPIC_ID,
  pairKey: buildPairKey(NOTE_ID, TOPIC_ID),
  type: 'association',
};

function makeAttachment(): AttachmentRecord {
  const blob = new Blob(['display-bytes'], { type: 'image/png' });
  return {
    id: ATTACHMENT_ID,
    cardId: NOTE_ID,
    kind: 'display',
    mime: 'image/png',
    width: 1200,
    height: 800,
    bytes: blob.size,
    sha256: SHA_256,
    blob,
  };
}

function seededRepository(): InMemoryCaseRepository {
  return new InMemoryCaseRepository({
    seed: {
      cases: [CASE],
      cards: [NOTE, SOURCE, TOPIC],
      connections: [CONNECTION],
      attachments: [makeAttachment()],
    },
  });
}

function emptyRepository(): InMemoryCaseRepository {
  return new InMemoryCaseRepository({ seed: { cases: [CASE] } });
}

function renderList(repository: InMemoryCaseRepository) {
  return render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}/list`]}>
      <Routes>
        <Route path="/case/:caseId/list" element={<CardListPage repository={repository} />} />
        <Route path="/case/:caseId" element={<h2>Case board</h2>} />
        <Route path="/case/:caseId/capture" element={<h2>Capture evidence</h2>} />
        <Route path="/case/:caseId/card/:cardId" element={<h2>Card detail</h2>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderBoard(repository: InMemoryCaseRepository) {
  return render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}`]}>
      <Routes>
        <Route path="/case/:caseId" element={<CaseBoardPage repository={repository} />} />
        <Route path="/case/:caseId/list" element={<h2>Card list</h2>} />
        <Route path="/case/:caseId/capture" element={<h2>Capture evidence</h2>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openList(repository: InMemoryCaseRepository) {
  const view = renderList(repository);
  const heading = await screen.findByRole('heading', { level: 2, name: 'Card list' });
  return { ...view, heading };
}

afterEach(() => {
  cleanup();
});

describe('CardListPage grouping and empty state', () => {
  it('groups notes, sources, and topics as text and derives the topic status', async () => {
    await openList(seededRepository());

    expect(screen.queryByTestId('board-canvas')).not.toBeInTheDocument();

    const notes = screen.getByRole('region', { name: /Study notes/ });
    const sources = screen.getByRole('region', { name: /Sources/ });
    const topics = screen.getByRole('region', { name: /Topics/ });

    expect(within(notes).getByRole('heading', { level: 4, name: NOTE_TITLE })).toBeInTheDocument();
    expect(
      within(sources).getByRole('heading', { level: 4, name: SOURCE_TITLE }),
    ).toBeInTheDocument();
    expect(
      within(topics).getByRole('heading', { level: 4, name: TOPIC_TITLE }),
    ).toBeInTheDocument();

    // The type is visible text, not a colour-only signal.
    expect(within(notes).getByText('Study note')).toBeInTheDocument();
    expect(within(sources).getByText('Source')).toBeInTheDocument();
    expect(within(topics).getByText('Topic')).toBeInTheDocument();

    expect(
      within(topics).getByRole('status', {
        name: 'Topic status: Developing, 1 linked note',
      }),
    ).toBeInTheDocument();
    expect(within(notes).getByText('Tags:')).toBeInTheDocument();
    expect(within(notes).getByText(/lecture, transport/)).toBeInTheDocument();

    // Every row has the three keyboard actions plus the create links.
    expect(
      within(notes).getByRole('link', { name: `Open detail for ${NOTE_TITLE}` }),
    ).toHaveAttribute('href', `/case/${CASE_ID}/card/${NOTE_ID}`);
    expect(within(notes).getByRole('button', { name: `Edit ${NOTE_TITLE}` })).toBeInTheDocument();
    expect(within(notes).getByRole('button', { name: `Delete ${NOTE_TITLE}` })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add note' })).toHaveAttribute(
      'href',
      `/case/${CASE_ID}/capture?kind=note`,
    );
    expect(screen.getByRole('link', { name: 'Add source' })).toHaveAttribute(
      'href',
      `/case/${CASE_ID}/capture?kind=source`,
    );
    expect(screen.getByRole('link', { name: 'Add topic' })).toHaveAttribute(
      'href',
      `/case/${CASE_ID}/capture?kind=topic`,
    );
  });

  it('offers note, source, and topic capture on an empty case with no canvas controls', async () => {
    await openList(emptyRepository());

    expect(
      screen.getByRole('heading', { level: 3, name: 'Pin the first clue' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add note' })).toHaveAttribute(
      'href',
      `/case/${CASE_ID}/capture?kind=note`,
    );
    expect(screen.getByRole('link', { name: 'Add source' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add topic' })).toBeInTheDocument();
    expect(screen.queryByTestId('board-canvas')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fit to view/i })).not.toBeInTheDocument();
  });

  it('replaces the empty case board canvas with the same three capture actions', async () => {
    renderBoard(emptyRepository());

    expect(
      await screen.findByRole('heading', { level: 3, name: 'Pin the first clue' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add note' })).toHaveAttribute(
      'href',
      `/case/${CASE_ID}/capture?kind=note`,
    );
    expect(screen.getByRole('link', { name: 'Add source' })).toHaveAttribute(
      'href',
      `/case/${CASE_ID}/capture?kind=source`,
    );
    expect(screen.getByRole('link', { name: 'Add topic' })).toHaveAttribute(
      'href',
      `/case/${CASE_ID}/capture?kind=topic`,
    );
    expect(screen.getByRole('link', { name: 'Open card list' })).toHaveAttribute(
      'href',
      `/case/${CASE_ID}/list`,
    );

    // No dead canvas: zero cards means no canvas host, fit, zoom, or minimap.
    expect(screen.queryByTestId('board-canvas')).not.toBeInTheDocument();
    expect(screen.queryByTestId('board-canvas-host')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fit to view/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zoom in/i })).not.toBeInTheDocument();
  });
});

describe('CardListPage keyboard actions', () => {
  it('exposes focusable add links that open the requested capture kind', async () => {
    const user = userEvent.setup();
    await openList(seededRepository());

    const addTopic = screen.getByRole('link', { name: 'Add topic' });
    addTopic.focus();
    expect(addTopic).toHaveFocus();

    await user.click(addTopic);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Capture evidence' }),
    ).toBeInTheDocument();
  });

  it('edits a title by keyboard, announces the change, and restores focus to Edit', async () => {
    const user = userEvent.setup();
    const repository = seededRepository();
    await openList(repository);

    const edit = screen.getByRole('button', { name: `Edit ${NOTE_TITLE}` });
    edit.focus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Edit card title' });
    const input = within(dialog).getByRole('textbox', { name: 'Card title' });
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, 'Active transport');
    const save = within(dialog).getByRole('button', { name: 'Save title' });
    save.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { level: 4, name: 'Active transport' })).toBeInTheDocument();
    expect(screen.getByText('Card title updated.')).toBeInTheDocument();
    expect(await repository.getCard(NOTE_ID)).toMatchObject({ title: 'Active transport' });
    expect(screen.getByRole('button', { name: 'Edit Active transport' })).toHaveFocus();
  });

  it('confirms the string count, deletes, and restores from the 8-second Undo toast by keyboard', async () => {
    const user = userEvent.setup();
    const repository = seededRepository();
    await openList(repository);

    const deleteButton = screen.getByRole('button', { name: `Delete ${NOTE_TITLE}` });
    deleteButton.focus();
    await user.keyboard('{Enter}');

    let dialog = await screen.findByRole('dialog', { name: `Delete “${NOTE_TITLE}”?` });
    expect(dialog).toHaveTextContent('1 string attached');
    expect(dialog).toHaveTextContent('Undo stays available for 8 seconds');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    // Escape cancels and focus returns to the row's Delete trigger.
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(deleteButton).toHaveFocus();

    // Reopen and move from Cancel to the confirm button with the keyboard only.
    await user.keyboard('{Enter}');
    dialog = await screen.findByRole('dialog', { name: `Delete “${NOTE_TITLE}”?` });
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Delete card' })).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { level: 4, name: NOTE_TITLE })).not.toBeInTheDocument();
    expect(await repository.getCard(NOTE_ID)).toBeNull();
    expect(await repository.listConnections(CASE_ID)).toHaveLength(0);
    expect(await repository.listAttachments(NOTE_ID)).toHaveLength(0);

    expect(
      screen.getByText(/Card deleted: .*Membrane transport.*1 string removed/),
    ).toBeInTheDocument();
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Card list' })).toHaveFocus();

    undo.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/Card restored: .*Membrane transport/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: NOTE_TITLE })).toBeInTheDocument();
    expect(await repository.getCard(NOTE_ID)).toMatchObject({
      position: { x: 180, y: 240 },
    });
    expect(await repository.listConnections(CASE_ID)).toHaveLength(1);
    expect(await repository.listAttachments(NOTE_ID)).toHaveLength(1);

    expect(screen.getByRole('link', { name: `Open detail for ${NOTE_TITLE}` })).toHaveFocus();
    expect(
      within(screen.getByRole('region', { name: /Topics/ })).getByRole('status', {
        name: 'Topic status: Developing, 1 linked note',
      }),
    ).toBeInTheDocument();
  });
});

describe('CardListPage CSS contract', () => {
  const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

  it('keeps every list control at the 44 px target floor', () => {
    const panelCss = readRepositoryFile('src/features/case/CardListPanel.css');
    const pageCss = readRepositoryFile('src/features/case/CardListPage.css');
    const emptyCss = readRepositoryFile('src/features/case/EmptyBoard.css');

    for (const [css, selector] of [
      [panelCss, '.card-list__action-link'],
      [panelCss, '.card-list__action'],
      [pageCss, '.card-list-page__nav-link'],
    ] as const) {
      const declarations = declarationsFor(css, selector);
      expect(resolveLengthPx(tokens, declarations.get('min-block-size'))).toBe(44);
      expect(resolveLengthPx(tokens, declarations.get('min-inline-size'))).toBe(44);
    }

    const emptyActions = declarationsFor(emptyCss, '.empty-board__actions');
    expect(emptyActions.get('gap')).toBe('var(--space-3)');

    // EmptyBoard reuses the shared Button classes; prove that primitive still
    // carries the 44 px floor rather than assuming it.
    const sharedButton = declarationsFor(
      readRepositoryFile('src/components/components.css'),
      '.nd-button',
    );
    expect(resolveLengthPx(tokens, sharedButton.get('min-block-size'))).toBe(44);
    expect(resolveLengthPx(tokens, sharedButton.get('min-inline-size'))).toBe(44);
  });

  it('keeps list text at AA contrast on its surface', () => {
    const surface = resolveColor(tokens, '--color-surface');

    for (const token of [
      '--color-ink',
      '--color-ink-muted',
      '--color-heading-ink',
      '--color-link',
    ]) {
      expect(contrastRatio(resolveColor(tokens, token), surface)).toBeGreaterThanOrEqual(4.5);
    }

    expect(
      contrastRatio(
        resolveColor(tokens, '--color-danger-text'),
        resolveColor(tokens, '--color-surface'),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('introduces no raw palette literals in its feature stylesheets', () => {
    const pattern = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

    for (const file of [
      'src/features/case/CardListPanel.css',
      'src/features/case/CardListPage.css',
      'src/features/case/EmptyBoard.css',
    ]) {
      expect(stripComments(readRepositoryFile(file))).not.toMatch(pattern);
    }
  });
});
