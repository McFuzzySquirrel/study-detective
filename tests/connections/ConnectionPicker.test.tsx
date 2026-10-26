import { useState } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryConnectionRepository } from '../../src/data/connectionRepository';
import type { ConnectionRecord } from '../../src/domain/model';
import { buildPairKey } from '../../src/domain/model';
import ConnectionPicker from '../../src/features/connections/ConnectionPicker';
import type {
  ConnectionPickerCard,
  ConnectionPickerIntent,
} from '../../src/features/connections/ConnectionPicker';
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

const NOTE_TITLE = 'Membrane transport';
const SOURCE_TITLE = 'Lecture slide 12';
const TOPIC_TITLE = 'Osmosis';

const NOTE: ConnectionPickerCard = {
  id: NOTE_ID,
  caseId: CASE_ID,
  type: 'note',
  title: NOTE_TITLE,
};

const SOURCE: ConnectionPickerCard = {
  id: SOURCE_ID,
  caseId: CASE_ID,
  type: 'source',
  title: SOURCE_TITLE,
};

const TOPIC: ConnectionPickerCard = {
  id: TOPIC_ID,
  caseId: CASE_ID,
  type: 'topic',
  title: TOPIC_TITLE,
};

const CARDS = [NOTE, SOURCE, TOPIC];

function association(
  fromCardId = NOTE_ID,
  toCardId = TOPIC_ID,
  id = CONNECTION_ID,
): ConnectionRecord {
  return {
    id,
    caseId: CASE_ID,
    fromCardId,
    toCardId,
    pairKey: buildPairKey(fromCardId, toCardId),
    type: 'association',
  };
}

function makeRepository(connections: readonly ConnectionRecord[] = []) {
  return new InMemoryConnectionRepository({ cards: CARDS, connections });
}

interface HarnessProps {
  readonly repository: InMemoryConnectionRepository;
  readonly currentCard?: ConnectionPickerCard;
  readonly intent?: ConnectionPickerIntent;
  readonly initialConnectionId?: string | null;
  readonly connections?: readonly ConnectionRecord[];
}

/**
 * A real trigger button so the dialog's focus restoration can be asserted, not
 * just assumed. The picker is mounted exactly while it is open.
 */
function Harness({
  repository,
  currentCard = NOTE,
  intent = 'connect',
  initialConnectionId = null,
  connections = [],
}: HarnessProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open connection picker
      </button>
      {open ? (
        <ConnectionPicker
          open
          currentCard={currentCard}
          cards={CARDS}
          connections={connections}
          intent={intent}
          repository={repository}
          initialConnectionId={initialConnectionId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

async function openPicker(): Promise<{
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly trigger: HTMLElement;
}> {
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Open connection picker' });
  trigger.focus();
  await user.keyboard('{Enter}');
  return { user, trigger };
}

function dialogByTitle(title: string | RegExp): HTMLElement {
  return screen.getByRole('dialog', { name: title });
}

afterEach(() => {
  cleanup();
});

describe('ConnectionPicker targets, search, and announcements', () => {
  it('focuses search, announces the target count, filters by title, and restores focus on Escape', async () => {
    render(<Harness repository={makeRepository()} />);
    const { user, trigger } = await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    const search = within(dialog).getByRole('searchbox', { name: 'Find a target card' });
    expect(search).toHaveFocus();
    expect(within(dialog).getByRole('status')).toHaveTextContent('2 targets available.');

    await user.type(search, 'Lecture');

    expect(within(dialog).getByRole('status')).toHaveTextContent('1 of 2 targets match “Lecture”.');
    expect(within(dialog).getByRole('radio', { name: SOURCE_TITLE })).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: TOPIC_TITLE })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('creates an association by keyboard and announces the text alternative', async () => {
    const repository = makeRepository();
    render(<Harness repository={repository} />);
    const { user, trigger } = await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    const target = within(dialog).getByRole('radio', { name: TOPIC_TITLE });
    target.focus();
    await user.keyboard(' ');

    expect(target).toBeChecked();

    const save = within(dialog).getByRole('button', { name: 'Save' });
    save.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();

    const rows = await repository.listByCase(CASE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fromCardId: NOTE_ID,
      toCardId: TOPIC_ID,
      type: 'association',
    });
  });

  it('filters provenance targets to Sources for a note and saves a provenance row', async () => {
    const repository = makeRepository();
    render(<Harness repository={repository} />);
    const { user } = await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    const provenance = within(dialog).getByRole('radio', { name: 'Provenance' });
    expect(provenance).toBeEnabled();
    provenance.focus();
    await user.keyboard(' ');

    expect(within(dialog).getByRole('status')).toHaveTextContent('1 target available.');
    expect(within(dialog).getByRole('radio', { name: SOURCE_TITLE })).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: TOPIC_TITLE })).not.toBeInTheDocument();

    const source = within(dialog).getByRole('radio', { name: SOURCE_TITLE });
    source.focus();
    await user.keyboard(' ');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    save.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const rows = await repository.listByCase(CASE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromCardId: NOTE_ID, toCardId: SOURCE_ID, type: 'provenance' });
  });

  it('returns to the unfiltered association list when provenance is switched back', async () => {
    render(<Harness repository={makeRepository()} />);
    const { user } = await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    const provenance = within(dialog).getByRole('radio', { name: 'Provenance' });
    provenance.focus();
    await user.keyboard(' ');
    expect(within(dialog).queryByRole('radio', { name: TOPIC_TITLE })).not.toBeInTheDocument();

    const association = within(dialog).getByRole('radio', { name: 'Association' });
    association.focus();
    await user.keyboard(' ');

    expect(within(dialog).getByRole('radio', { name: TOPIC_TITLE })).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent('2 targets available.');
  });

  it('filters provenance targets to Notes when the current card is a Source', async () => {
    const repository = makeRepository();
    render(<Harness repository={repository} currentCard={SOURCE} />);
    const { user } = await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    const provenance = within(dialog).getByRole('radio', { name: 'Provenance' });
    provenance.focus();
    await user.keyboard(' ');

    expect(within(dialog).getByRole('radio', { name: NOTE_TITLE })).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: TOPIC_TITLE })).not.toBeInTheDocument();

    const note = within(dialog).getByRole('radio', { name: NOTE_TITLE });
    note.focus();
    await user.keyboard(' ');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    save.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const rows = await repository.listByCase(CASE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromCardId: SOURCE_ID, toCardId: NOTE_ID, type: 'provenance' });
  });

  it('opens Attach source on Provenance with a Source-only target list', async () => {
    const repository = makeRepository();
    render(<Harness repository={repository} intent="attach-source" />);
    const { user } = await openPicker();
    const dialog = dialogByTitle('Attach a source');

    expect(within(dialog).getByRole('radio', { name: 'Provenance' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: SOURCE_TITLE })).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: TOPIC_TITLE })).not.toBeInTheDocument();

    const source = within(dialog).getByRole('radio', { name: SOURCE_TITLE });
    source.focus();
    await user.keyboard(' ');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    save.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(await repository.listByCase(CASE_ID)).toMatchObject([
      { fromCardId: NOTE_ID, toCardId: SOURCE_ID, type: 'provenance' },
    ]);
  });

  it('disables provenance for a Topic and explains why', async () => {
    render(<Harness repository={makeRepository()} currentCard={TOPIC} />);
    await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    const provenance = within(dialog).getByRole('radio', { name: 'Provenance' });
    expect(provenance).toBeDisabled();
    expect(within(dialog).getByText(/A Topic cannot be an endpoint/)).toBeInTheDocument();
  });

  it('announces a save without a target and keeps the dialog open', async () => {
    render(<Harness repository={makeRepository()} />);
    const { user } = await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    const save = within(dialog).getByRole('button', { name: 'Save' });
    save.focus();
    await user.keyboard('{Enter}');

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Choose a target card before saving.',
    );
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: SOURCE_TITLE })).toHaveFocus();
  });

  it('does not create a second row when the chosen pair already exists', async () => {
    const existing = association();
    const repository = makeRepository([existing]);
    render(<Harness repository={repository} connections={[existing]} />);
    const { user } = await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    expect(within(dialog).getByText(/Already connected as Association/)).toBeInTheDocument();

    const target = within(dialog).getByRole('radio', { name: TOPIC_TITLE });
    target.focus();
    await user.keyboard(' ');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    save.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const rows = await repository.listByCase(CASE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(CONNECTION_ID);
  });
});

describe('ConnectionPicker edit and delete', () => {
  it('retypes an existing connection without changing its ID', async () => {
    const existing = association(NOTE_ID, SOURCE_ID);
    const repository = makeRepository([existing]);
    render(<Harness repository={repository} connections={[existing]} />);
    const { user, trigger } = await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    const edit = within(dialog).getByRole('button', {
      name: `Edit connection with ${SOURCE_TITLE}`,
    });
    edit.focus();
    await user.keyboard('{Enter}');

    const manage = dialogByTitle('Manage connection');
    const associationRadio = within(manage).getByRole('radio', { name: 'Association' });
    expect(associationRadio).toBeChecked();
    expect(associationRadio).toHaveFocus();

    const provenance = within(manage).getByRole('radio', { name: 'Provenance' });
    provenance.focus();
    await user.keyboard(' ');
    const save = within(manage).getByRole('button', { name: 'Save' });
    save.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();

    const rows = await repository.listByCase(CASE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: CONNECTION_ID, type: 'provenance' });
  });

  it('deletes an existing connection after an explicit keyboard confirmation', async () => {
    const existing = association();
    const repository = makeRepository([existing]);
    render(<Harness repository={repository} connections={[existing]} />);
    const { user, trigger } = await openPicker();
    const dialog = dialogByTitle('Connect to a card');

    const edit = within(dialog).getByRole('button', {
      name: `Edit connection with ${TOPIC_TITLE}`,
    });
    edit.focus();
    await user.keyboard('{Enter}');

    const manage = dialogByTitle('Manage connection');
    const deleteTrigger = within(manage).getByRole('button', { name: 'Delete connection' });
    deleteTrigger.focus();
    await user.keyboard('{Enter}');

    expect(within(manage).getByRole('button', { name: 'Keep connection' })).toHaveFocus();

    // Cancelling the confirmation returns focus to the re-rendered Delete
    // connection action; the previous node was replaced with the confirmation.
    await user.keyboard('{Enter}');
    const restoredDelete = within(manage).getByRole('button', { name: 'Delete connection' });
    expect(restoredDelete).toHaveFocus();
    expect(
      within(manage).queryByRole('button', { name: 'Keep connection' }),
    ).not.toBeInTheDocument();

    // Reopen and move from Keep connection to the destructive action by Tab.
    await user.keyboard('{Enter}');
    expect(within(manage).getByRole('button', { name: 'Keep connection' })).toHaveFocus();
    await user.tab();
    expect(within(manage).getByRole('button', { name: 'Delete connection' })).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(await repository.listByCase(CASE_ID)).toEqual([]);
  });
});

describe('ConnectionPicker accessibility contract', () => {
  const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
  const css = readRepositoryFile('src/features/connections/connections.css');

  it('keeps target, type, and existing-connection controls at 44 px', () => {
    for (const selector of [
      '.connection-picker__label',
      '.connection-picker__target-label',
      '.connection-picker__existing-action',
    ] as const) {
      const declarations = declarationsFor(css, selector);
      expect(resolveLengthPx(tokens, declarations.get('min-block-size'))).toBe(44);
      expect(resolveLengthPx(tokens, declarations.get('min-inline-size'))).toBe(44);
    }
  });

  it('keeps dialog text at AA contrast and introduces no raw palette literals', () => {
    const panel = resolveColor(tokens, '--color-surface-raised');

    for (const token of [
      '--color-ink',
      '--color-ink-muted',
      '--color-heading-ink',
      '--color-danger-text',
    ]) {
      expect(contrastRatio(resolveColor(tokens, token), panel)).toBeGreaterThanOrEqual(4.5);
    }

    expect(stripComments(css)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
