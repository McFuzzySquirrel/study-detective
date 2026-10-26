import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Button from '../../../src/components/Button';
import Toast from '../../../src/components/Toast';
import { InMemoryCaseRepository } from '../../../src/data/caseRepository';
import type { CaseRepositoryPort } from '../../../src/data/caseRepository';
import { deriveReadiness } from '../../../src/domain/readiness';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../../src/domain/model';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../../src/domain/model';
import { fixedClock } from '../../../src/domain/ids';
import ClosurePanel from '../../../src/features/closure/ClosurePanel';
import { CLOSE_CASE_ERROR, useCaseLifecycle } from '../../../src/features/closure/useCaseLifecycle';
import {
  contrastRatio,
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveColor,
  resolveLengthPx,
  stripComments,
} from '../../helpers/css-contract';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOPIC_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOTE_SOURCE_CONNECTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOTE_TOPIC_CONNECTION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CLOSED_AT = '2026-10-05T11:00:00.000Z';
const NOW = '2026-10-26T12:00:00.000Z';

function makeCase(closedAt: string | null = null): CaseRecord {
  return {
    id: CASE_ID,
    title: 'Membrane transport',
    subject: 'Biology',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    viewport: DEFAULT_VIEWPORT,
    closedAt,
    isDemo: false,
    backupPromptedAt: null,
  };
}

const NOTE: CardRecord = {
  id: NOTE_ID,
  caseId: CASE_ID,
  type: 'note',
  title: 'Passive transport',
  position: { x: 120, y: 160 },
  tags: [],
  createdAt: '2026-09-02T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
};

const SOURCE: CardRecord = {
  id: SOURCE_ID,
  caseId: CASE_ID,
  type: 'source',
  title: 'Lecture handout',
  position: { x: 320, y: 160 },
  tags: [],
  createdAt: '2026-09-02T09:05:00.000Z',
  updatedAt: '2026-09-02T09:05:00.000Z',
};

const TOPIC: CardRecord = {
  id: TOPIC_ID,
  caseId: CASE_ID,
  type: 'topic',
  title: 'Osmosis',
  position: { x: 520, y: 160 },
  tags: [],
  createdAt: '2026-09-02T09:10:00.000Z',
  updatedAt: '2026-09-02T09:10:00.000Z',
};

const CARDS: readonly CardRecord[] = [NOTE, SOURCE, TOPIC];

function makeConnection(
  id: string,
  fromCardId: string,
  toCardId: string,
  type: ConnectionRecord['type'],
): ConnectionRecord {
  return {
    id,
    caseId: CASE_ID,
    fromCardId,
    toCardId,
    pairKey: buildPairKey(fromCardId, toCardId),
    type,
  };
}

const READY_CONNECTIONS: readonly ConnectionRecord[] = [
  makeConnection(NOTE_SOURCE_CONNECTION, NOTE_ID, SOURCE_ID, 'provenance'),
  makeConnection(NOTE_TOPIC_CONNECTION, NOTE_ID, TOPIC_ID, 'association'),
];

const LOOSE_CONNECTIONS: readonly ConnectionRecord[] = [];

interface HarnessProps {
  readonly initialCase: CaseRecord;
  readonly initialConnections: readonly ConnectionRecord[];
  readonly repository: CaseRepositoryPort;
  readonly onShowCard: (cardId: string) => void;
}

function LifecycleHarness({
  initialCase,
  initialConnections,
  repository,
  onShowCard,
}: HarnessProps) {
  const [caseRecord, setCaseRecord] = useState(initialCase);
  const [connections, setConnections] = useState(initialConnections);
  const readiness = deriveReadiness(CARDS, connections);
  const lifecycle = useCaseLifecycle({
    caseRecord,
    readiness,
    repository,
    clock: fixedClock(NOW),
    onCaseChanged: setCaseRecord,
  });

  return (
    <MemoryRouter>
      <ClosurePanel
        caseRecord={caseRecord}
        readiness={readiness}
        busy={lifecycle.busy}
        error={lifecycle.error}
        onCloseCase={lifecycle.closeCase}
        onReopenCase={lifecycle.reopenCase}
        cardHref={(cardId) => `/case/${CASE_ID}/card/${cardId}`}
        onShowCard={onShowCard}
        onClearError={lifecycle.clearError}
      />
      <Button onClick={() => setConnections(READY_CONNECTIONS)}>Repair graph</Button>
      <Toast message={lifecycle.message} onDismiss={lifecycle.clearMessage} />
    </MemoryRouter>
  );
}

interface RenderOptions {
  readonly closedAt?: string | null;
  readonly connections?: readonly ConnectionRecord[];
  readonly repository?: CaseRepositoryPort;
}

function renderHarness(options: RenderOptions = {}) {
  const initialCase = makeCase(options.closedAt ?? null);
  const connections = options.connections ?? LOOSE_CONNECTIONS;
  const repository =
    options.repository ??
    new InMemoryCaseRepository({
      seed: { cases: [initialCase], cards: [...CARDS], connections: [...connections] },
    });
  const onShowCard = vi.fn<(cardId: string) => void>();

  const view = render(
    <LifecycleHarness
      initialCase={initialCase}
      initialConnections={connections}
      repository={repository}
      onShowCard={onShowCard}
    />,
  );

  return { ...view, repository, initialCase, onShowCard };
}

/** A write failure must not mutate the caller's case or the repository row. */
class RejectingCaseRepository extends InMemoryCaseRepository {
  override async updateCase(): Promise<CaseRecord> {
    throw new Error('disk is unavailable');
  }
}

const closureCss = readRepositoryFile('src/features/closure/closure.css');
const componentsCss = readRepositoryFile('src/components/components.css');
const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

function expectMinimumTarget(selector: string): void {
  const styles = declarationsFor(closureCss, selector);
  const block = resolveLengthPx(tokens, styles.get('min-block-size'));
  const inline = resolveLengthPx(tokens, styles.get('min-inline-size'));

  expect(block, `${selector} block target`).toBeGreaterThanOrEqual(44);
  expect(inline, `${selector} inline target`).toBeGreaterThanOrEqual(44);
}

afterEach(() => {
  cleanup();
});

describe('ClosurePanel readiness states', () => {
  it('shows Ready to close with an enabled Close and no badge on an open, ready case', () => {
    const { initialCase } = renderHarness({ connections: READY_CONNECTIONS });
    const panel = screen.getByTestId('closure-panel');

    expect(panel).toHaveAttribute('data-closure-state', 'open-ready');
    expect(panel).toHaveAttribute('data-loose-count', '0');
    expect(within(panel).getByRole('status')).toHaveTextContent('Ready to close');
    expect(within(panel).getByRole('button', { name: 'Close case' })).toBeEnabled();
    expect(within(panel).queryByTestId('closure-badge')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Reopen case' })).not.toBeInTheDocument();
    expect(within(panel).getByText(/No loose threads/)).toBeInTheDocument();
    expect(initialCase.closedAt).toBeNull();
  });

  it('disables Close on loose threads, explains the count, and links every offender', async () => {
    const user = userEvent.setup();
    const { onShowCard } = renderHarness();
    const panel = screen.getByTestId('closure-panel');

    expect(panel).toHaveAttribute('data-closure-state', 'open-loose');
    expect(panel).toHaveAttribute('data-loose-count', '2');
    expect(within(panel).getByRole('status')).toHaveTextContent('2 loose threads');

    const close = within(panel).getByRole('button', { name: 'Close case' });
    expect(close).toBeDisabled();
    expect(close).toHaveAccessibleDescription(/2 loose threads must be resolved/);
    expect(
      within(panel).getByText('2 loose threads must be resolved before this case can close.'),
    ).toBeVisible();

    const noteLink = within(panel).getByRole('link', {
      name: 'Open detail for Passive transport',
    });
    expect(noteLink).toHaveAttribute('href', `/case/${CASE_ID}/card/${NOTE_ID}`);

    const topicLink = within(panel).getByRole('link', { name: 'Open detail for Osmosis' });
    expect(topicLink).toHaveAttribute('href', `/case/${CASE_ID}/card/${TOPIC_ID}`);

    const rows = within(panel).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText(/No source link/)).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/No topic connection/)).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('No connections')).toBeInTheDocument();

    // The row link and the centering action are both keyboard reachable. The
    // first Tab lands on the first loose-thread link; Enter opens its detail.
    await user.tab();
    expect(noteLink).toHaveFocus();

    const show = within(panel).getByRole('button', {
      name: 'Show Passive transport on the board',
    });
    show.focus();
    await user.keyboard('{Enter}');
    expect(onShowCard).toHaveBeenCalledWith(NOTE_ID);
  });
});

describe('ClosurePanel closure lifecycle', () => {
  it('confirms before closing, cancels with Escape, and restores focus to Close', async () => {
    const user = userEvent.setup();
    const { repository, initialCase } = renderHarness({ connections: READY_CONNECTIONS });
    const panel = screen.getByTestId('closure-panel');
    const close = within(panel).getByRole('button', { name: 'Close case' });

    await user.click(close);

    const dialog = await screen.findByRole('dialog', { name: 'Close this case?' });
    expect(within(dialog).getByText(/keeps every card editable/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep open' })).toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Close this case?' })).not.toBeInTheDocument();
    });
    expect(close).toHaveFocus();
    await expect(repository.getCase(CASE_ID)).resolves.toEqual(initialCase);
  });

  it('records closedAt, stamps Closed, and keeps the case editable', async () => {
    const user = userEvent.setup();
    const { repository } = renderHarness({ connections: READY_CONNECTIONS });
    const panel = screen.getByTestId('closure-panel');

    await user.click(within(panel).getByRole('button', { name: 'Close case' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this case?' });
    await user.click(within(dialog).getByRole('button', { name: 'Close case' }));

    await waitFor(() => {
      expect(panel).toHaveAttribute('data-closure-state', 'closed-ready');
    });
    expect(within(panel).getByTestId('closure-badge')).toHaveTextContent('Closed');
    expect(within(panel).getByTestId('closure-badge')).toHaveTextContent('on 26 Oct 2026');
    expect(within(panel).getByRole('button', { name: 'Close again' })).toBeEnabled();
    expect(within(panel).getByRole('button', { name: 'Reopen case' })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(panel).getByRole('button', { name: 'Close again' })).toHaveFocus();
    });
    expect(screen.getByText(/Case closed: Membrane transport/)).toBeInTheDocument();

    const stored = await repository.getCase(CASE_ID);
    expect(stored?.closedAt).toBe(NOW);

    // Closure is metadata, not a lock: an ordinary card edit still commits.
    const edited = await repository.updateCard(NOTE_ID, { title: 'Passive transport revised' });
    expect(edited.title).toBe('Passive transport revised');
    await expect(repository.getCase(CASE_ID)).resolves.toMatchObject({ closedAt: NOW });
  });

  it('keeps a closed case closed when edits introduce loose threads', async () => {
    const { repository, initialCase } = renderHarness({ closedAt: CLOSED_AT });
    const panel = screen.getByTestId('closure-panel');

    expect(panel).toHaveAttribute('data-closure-state', 'closed-loose');
    expect(within(panel).getByTestId('closure-badge')).toHaveTextContent('Closed · loose threads');
    expect(within(panel).getByTestId('closure-badge')).toHaveTextContent('on 5 Oct 2026');
    expect(within(panel).getByRole('status')).toHaveTextContent('2 loose threads');
    expect(within(panel).getByRole('button', { name: 'Close again' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'Reopen case' })).toBeEnabled();

    // The panel only renders; it never clears closedAt on its own.
    expect(await repository.getCase(CASE_ID)).toMatchObject({ closedAt: CLOSED_AT });
    expect(initialCase.closedAt).toBe(CLOSED_AT);
  });

  it('re-enables Close after the graph is repaired without reopening', async () => {
    const user = userEvent.setup();
    const { repository } = renderHarness({ closedAt: CLOSED_AT });
    const panel = screen.getByTestId('closure-panel');

    expect(within(panel).getByRole('button', { name: 'Close again' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Repair graph' }));

    await waitFor(() => {
      expect(panel).toHaveAttribute('data-closure-state', 'closed-ready');
    });
    expect(within(panel).getByTestId('closure-badge')).toHaveTextContent(/^Closed/);
    expect(within(panel).getByRole('button', { name: 'Close again' })).toBeEnabled();
    expect(within(panel).getByText('Ready to close')).toBeInTheDocument();
    expect(await repository.getCase(CASE_ID)).toMatchObject({ closedAt: CLOSED_AT });
  });
});

describe('ClosurePanel reopen', () => {
  it('requires confirmation, clears closedAt, and returns focus to the panel', async () => {
    const user = userEvent.setup();
    const { repository } = renderHarness({
      closedAt: CLOSED_AT,
      connections: READY_CONNECTIONS,
    });
    const panel = screen.getByTestId('closure-panel');
    const heading = within(panel).getByRole('heading', { name: 'Closure' });

    await user.click(within(panel).getByRole('button', { name: 'Reopen case' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reopen this case?' });
    expect(within(dialog).getByRole('button', { name: 'Keep closed' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Reopen this case?' })).not.toBeInTheDocument();
    });
    expect(within(panel).getByRole('button', { name: 'Reopen case' })).toHaveFocus();
    expect(await repository.getCase(CASE_ID)).toMatchObject({ closedAt: CLOSED_AT });

    await user.click(within(panel).getByRole('button', { name: 'Reopen case' }));
    const secondDialog = await screen.findByRole('dialog', { name: 'Reopen this case?' });
    await user.click(within(secondDialog).getByRole('button', { name: 'Reopen case' }));

    await waitFor(() => {
      expect(panel).toHaveAttribute('data-closure-state', 'open-ready');
    });
    expect(within(panel).queryByTestId('closure-badge')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Reopen case' })).not.toBeInTheDocument();
    expect(screen.getByText(/Case reopened: Membrane transport/)).toBeInTheDocument();
    expect(await repository.getCase(CASE_ID)).toMatchObject({ closedAt: null });

    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
  });
});

describe('ClosurePanel failure and contract checks', () => {
  it('reports a failed close inside the dialog and leaves closedAt unchanged', async () => {
    const user = userEvent.setup();
    const initialCase = makeCase();
    const repository = new RejectingCaseRepository({
      seed: { cases: [initialCase], cards: [...CARDS], connections: [...READY_CONNECTIONS] },
    });
    renderHarness({ connections: READY_CONNECTIONS, repository });
    const panel = screen.getByTestId('closure-panel');

    await user.click(within(panel).getByRole('button', { name: 'Close case' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this case?' });
    await user.click(within(dialog).getByRole('button', { name: 'Close case' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(CLOSE_CASE_ERROR);
    expect(within(dialog).getByRole('button', { name: 'Close case' })).toBeEnabled();
    expect(panel).toHaveAttribute('data-closure-state', 'open-ready');
    expect(await repository.getCase(CASE_ID)).toMatchObject({ closedAt: null });
  });

  it('exposes derived readiness and the loose-thread count on shelf summaries', async () => {
    const looseRepository = new InMemoryCaseRepository({
      seed: { cases: [makeCase()], cards: [...CARDS], connections: [] },
    });
    await expect(looseRepository.getCaseSummary(CASE_ID)).resolves.toMatchObject({
      readiness: 'loose',
      looseThreadCount: 2,
      cardCount: 3,
      connectionCount: 0,
    });

    const readyRepository = new InMemoryCaseRepository({
      seed: {
        cases: [makeCase(CLOSED_AT)],
        cards: [...CARDS],
        connections: [...READY_CONNECTIONS],
      },
    });
    await expect(readyRepository.getCaseSummary(CASE_ID)).resolves.toMatchObject({
      readiness: 'ready',
      looseThreadCount: 0,
      closedAt: CLOSED_AT,
    });
  });

  it('keeps its links at the 44 px floor with a visible focus ring and AA contrast', () => {
    expectMinimumTarget('.closure-panel__thread-link');

    const actionButtons = declarationsFor(componentsCss, '.nd-button');
    expect(resolveLengthPx(tokens, actionButtons.get('min-block-size'))).toBeGreaterThanOrEqual(44);
    expect(resolveLengthPx(tokens, actionButtons.get('min-inline-size'))).toBeGreaterThanOrEqual(
      44,
    );

    const focusRing = declarationsFor(closureCss, '.closure-panel__thread-link:focus-visible');
    expect(focusRing.get('outline')).toContain('var(--focus-ring-width)');
    expect(focusRing.get('outline')).toContain('var(--color-focus-ring)');

    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['--color-ink-muted', '--color-surface'],
      ['--color-danger-text', '--color-surface-sunken'],
      ['--color-accent-ink', '--color-accent'],
      ['--color-warning-ink', '--color-warning'],
    ];

    for (const [foreground, background] of pairs) {
      expect(
        contrastRatio(resolveColor(tokens, foreground), resolveColor(tokens, background)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    expect(stripComments(closureCss)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(readRepositoryFile('src/features/closure/ClosurePanel.tsx')).not.toContain(
      'dangerouslySetInnerHTML',
    );
  });
});
