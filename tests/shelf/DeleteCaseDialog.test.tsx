import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Button from '../../src/components/Button';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CaseDeletionPreview } from '../../src/data/deleteCase';
import type {
  AttachmentRecord,
  CardRecord,
  CaseRecord,
  ConnectionRecord,
} from '../../src/domain/model';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../src/domain/model';
import CaseShelfPage from '../../src/features/shelf/CaseShelfPage';
import DeleteCaseDialog from '../../src/features/shelf/DeleteCaseDialog';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const CARD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONNECTION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ATTACHMENT_ID = '77777777-7777-4777-8777-777777777777';
const SHA_256 = 'a'.repeat(64);

const PREVIEW: CaseDeletionPreview = {
  caseId: CASE_ID,
  title: 'Organic Chemistry',
  cardCount: 4,
  connectionCount: 3,
  imageCount: 2,
};

interface HarnessProps {
  readonly preview?: CaseDeletionPreview;
  readonly onConfirm: () => Promise<void>;
}

function Harness({ preview = PREVIEW, onConfirm }: HarnessProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button onClick={() => setOpen(true)}>Delete Organic Chemistry</Button>
      <p>Background content stays inert while the confirmation is open.</p>
      {open ? (
        <DeleteCaseDialog preview={preview} onClose={() => setOpen(false)} onConfirm={onConfirm} />
      ) : null}
    </div>
  );
}

function countValue(dialog: HTMLElement, label: string): HTMLElement {
  const dt = within(dialog).getByText(label);
  const dd = dt.nextElementSibling;

  if (!(dd instanceof HTMLElement)) {
    throw new Error(`The ${label} count is missing its value element.`);
  }

  return dd;
}

function makeCase(): CaseRecord {
  return {
    id: CASE_ID,
    title: 'Organic Chemistry',
    subject: 'Chemistry',
    examDate: '2026-11-02',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    viewport: DEFAULT_VIEWPORT,
    closedAt: null,
    isDemo: false,
    backupPromptedAt: null,
  };
}

function makeCard(id: string, type: 'note' | 'source', title: string): CardRecord {
  return {
    id,
    caseId: CASE_ID,
    type,
    title,
    position: { x: 0, y: 0 },
    tags: [],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
  };
}

function makeConnection(): ConnectionRecord {
  return {
    id: CONNECTION_ID,
    caseId: CASE_ID,
    fromCardId: CARD_A,
    toCardId: CARD_B,
    pairKey: buildPairKey(CARD_A, CARD_B),
    type: 'association',
  };
}

function makeAttachment(): AttachmentRecord {
  const blob = new Blob(['image-bytes'], { type: 'image/png' });
  return {
    id: ATTACHMENT_ID,
    cardId: CARD_A,
    kind: 'original',
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
      cases: [makeCase()],
      cards: [makeCard(CARD_A, 'note', 'Lecture 1'), makeCard(CARD_B, 'source', 'Chapter 4')],
      connections: [makeConnection()],
      attachments: [makeAttachment()],
    },
  });
}

async function confirmDialogOpensFromShelf(): Promise<{
  user: ReturnType<typeof userEvent.setup>;
  repository: InMemoryCaseRepository;
  trigger: HTMLElement;
  dialog: HTMLElement;
}> {
  const user = userEvent.setup();
  const repository = seededRepository();

  render(
    <MemoryRouter>
      <CaseShelfPage repository={repository} />
    </MemoryRouter>,
  );

  const trigger = await screen.findByRole('button', { name: 'Delete Organic Chemistry' });
  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: /Organic Chemistry/ });

  return { user, repository, trigger, dialog };
}

afterEach(() => {
  cleanup();
});

describe('DeleteCaseDialog', () => {
  it('names the case, shows exact counts, and says deletion is permanent', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Delete Organic Chemistry' }));

    const dialog = await screen.findByRole('dialog', { name: /Organic Chemistry/ });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText(/permanently removes/i)).toBeInTheDocument();

    expect(countValue(dialog, 'Cards')).toHaveTextContent('4');
    expect(countValue(dialog, 'Connections')).toHaveTextContent('3');
    expect(countValue(dialog, 'Images')).toHaveTextContent('2');

    expect(within(dialog).getByText(/Deletion is permanent/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
  });

  it('focuses Cancel by default and restores focus to the trigger on Escape', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    render(<Harness onConfirm={onConfirm} />);

    const trigger = screen.getByRole('button', { name: 'Delete Organic Chemistry' });
    trigger.focus();

    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: /Organic Chemistry/ });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });

    await waitFor(() => {
      expect(cancel).toHaveFocus();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels without deleting and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    render(<Harness onConfirm={onConfirm} />);

    const trigger = screen.getByRole('button', { name: 'Delete Organic Chemistry' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: /Organic Chemistry/ });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms once, shows a pending label, and closes after success', async () => {
    const user = userEvent.setup();
    let resolveDelete: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const onConfirm = vi.fn<() => Promise<void>>().mockReturnValue(pending);

    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Delete Organic Chemistry' }));
    const dialog = await screen.findByRole('dialog', { name: /Organic Chemistry/ });
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete case' });

    expect(deleteButton).toHaveClass('nd-button--danger');

    await user.click(deleteButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    resolveDelete?.();

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps the confirmation open and announces a failed transaction', async () => {
    const user = userEvent.setup();
    const onConfirm = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('injected delete failure'));

    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Delete Organic Chemistry' }));
    const dialog = await screen.findByRole('dialog', { name: /Organic Chemistry/ });

    await user.click(within(dialog).getByRole('button', { name: 'Delete case' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'The case could not be deleted. Nothing was removed; try again.',
    );
    expect(alert).not.toHaveTextContent('injected delete failure');
    expect(countValue(dialog, 'Cards')).toHaveTextContent('4');
    expect(within(dialog).getByRole('button', { name: 'Delete case' })).toBeEnabled();
    expect(screen.getByRole('dialog', { name: /Organic Chemistry/ })).toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('shelf delete wiring', () => {
  it('removes the case and every dependent after confirmation', async () => {
    const { user, repository, dialog } = await confirmDialogOpensFromShelf();

    expect(countValue(dialog, 'Cards')).toHaveTextContent('2');
    expect(countValue(dialog, 'Connections')).toHaveTextContent('1');
    expect(countValue(dialog, 'Images')).toHaveTextContent('1');

    await user.click(within(dialog).getByRole('button', { name: 'Delete case' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(await repository.getCase(CASE_ID)).toBeNull();
    expect(await repository.getCaseDeletionPreview(CASE_ID)).toBeNull();
    expect(await repository.listCaseSummaries()).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Organic Chemistry' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Case deleted: Organic Chemistry.');
    expect(screen.getByText('No case files yet')).toBeInTheDocument();
  });

  it('leaves the case and its evidence intact when the confirmation is cancelled', async () => {
    const { user, repository, trigger, dialog } = await confirmDialogOpensFromShelf();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();

    const summaries = await repository.listCaseSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      title: 'Organic Chemistry',
      cardCount: 2,
      connectionCount: 1,
    });
    expect(await repository.getCard(CARD_A)).not.toBeNull();
    expect(await repository.getCard(CARD_B)).not.toBeNull();
    expect(await repository.getAttachment(ATTACHMENT_ID)).not.toBeNull();
  });
});
