import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Button from '../../src/components/Button';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CaseRepositoryPort } from '../../src/data/caseRepository';
import { DEFAULT_VIEWPORT } from '../../src/domain/model';
import type { CaseRecord } from '../../src/domain/model';
import BackupDialog from '../../src/features/backup/BackupDialog';
import type {
  BackupDialogView,
  BackupOpenFilePicker,
} from '../../src/features/backup/BackupDialog';
import type { BackupOperations } from '../../src/features/backup/backupOperations';
import {
  ArchiveExportError,
  ArchiveSaveCancelledError,
} from '../../src/features/backup/exportCase';
import type {
  ArchiveDownloader,
  CaseArchive,
  ExportCaseResult,
} from '../../src/features/backup/exportCase';
import type { RestoreCaseResult, RestoreMode } from '../../src/features/backup/importCase';
import { ArchiveImportError } from '../../src/features/backup/importValidation';
import type {
  CaseArchiveInspection,
  CaseArchiveSummary,
} from '../../src/features/backup/importValidation';
import CaseShelfPage from '../../src/features/shelf/CaseShelfPage';
import {
  declarationsFor,
  parseCssRules,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
  stripComments,
} from '../helpers/css-contract';

const ARCHIVE_CASE_ID = '11111111-1111-4111-8111-111111111111';
const RESTORED_CASE_ID = '99999999-9999-4999-8999-999999999999';
const EXPORT_CASE_ID = '22222222-2222-4222-8222-222222222222';

const EXISTING_CASE: CaseRecord = {
  id: ARCHIVE_CASE_ID,
  title: 'Tudor England',
  subject: 'History',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const SUMMARY: CaseArchiveSummary = {
  caseId: ARCHIVE_CASE_ID,
  title: 'Tudor England',
  subject: 'History',
  exportedAt: '2026-10-01T14:30:00.000Z',
  appVersion: '0.1.0',
  imageCount: 4,
  cardCount: 7,
  connectionCount: 3,
  attachmentCount: 12,
  imageBytes: 4096,
};

function fakeArchive(): CaseArchive {
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    bytes,
    blob: new Blob([bytes], { type: 'application/zip' }),
    manifest: {
      case: {
        id: ARCHIVE_CASE_ID,
        title: 'Tudor England',
      },
    },
    fileName: 'tudor-england-2026-10-01.ndcase',
  } as unknown as CaseArchive;
}

function fakeInspection(summary: CaseArchiveSummary = SUMMARY): CaseArchiveInspection {
  return {
    archive: fakeArchive(),
    summary,
  } as unknown as CaseArchiveInspection;
}

function restoreResult(mode: RestoreMode): RestoreCaseResult {
  return {
    caseId: RESTORED_CASE_ID,
    mode,
    title: 'Tudor England',
    cardCount: 7,
    connectionCount: 3,
    attachmentCount: 12,
    exportedAt: SUMMARY.exportedAt,
    summary: SUMMARY,
  };
}

function makeOperations(): BackupOperations {
  return {
    buildExport: vi.fn<BackupOperations['buildExport']>().mockResolvedValue(fakeArchive()),
    saveExport: vi.fn<BackupOperations['saveExport']>().mockResolvedValue({
      method: 'download',
      fileName: 'tudor-england-2026-10-01.ndcase',
    }),
    inspectArchive: vi.fn<BackupOperations['inspectArchive']>().mockResolvedValue(fakeInspection()),
    restoreArchive: vi
      .fn<BackupOperations['restoreArchive']>()
      .mockImplementation(async (_archive, options) => restoreResult(options.mode)),
  };
}

interface RenderDialogOptions {
  readonly repository?: CaseRepositoryPort;
  readonly operations?: BackupOperations;
  readonly initialView?: BackupDialogView;
  readonly exportCaseId?: string;
  readonly exportCaseTitle?: string;
  readonly download?: ArchiveDownloader;
  readonly showOpenFilePicker?: BackupOpenFilePicker | null;
  readonly onOpenCase?: (caseId: string) => void;
  readonly onBackToShelf?: () => void;
  readonly onImported?: (result: RestoreCaseResult) => void;
  readonly onExported?: (result: ExportCaseResult) => void;
}

function renderDialog(options: RenderDialogOptions = {}) {
  const repository = options.repository ?? new InMemoryCaseRepository();
  const operations = options.operations ?? makeOperations();
  const onClose = vi.fn();
  const onImported = options.onImported ?? vi.fn();
  const onExported = options.onExported ?? vi.fn();

  const view = render(
    <MemoryRouter>
      <BackupDialog
        open
        repository={repository}
        operations={operations}
        initialView={options.initialView ?? 'import'}
        onClose={onClose}
        onImported={onImported}
        onExported={onExported}
        {...(options.exportCaseId !== undefined ? { exportCaseId: options.exportCaseId } : {})}
        {...(options.exportCaseTitle !== undefined
          ? { exportCaseTitle: options.exportCaseTitle }
          : {})}
        {...(options.download !== undefined ? { download: options.download } : {})}
        {...(options.showOpenFilePicker !== undefined
          ? { showOpenFilePicker: options.showOpenFilePicker }
          : {})}
        {...(options.onOpenCase !== undefined ? { onOpenCase: options.onOpenCase } : {})}
        {...(options.onBackToShelf !== undefined ? { onBackToShelf: options.onBackToShelf } : {})}
      />
    </MemoryRouter>,
  );

  return { ...view, repository, operations, onClose, onImported, onExported };
}

function chooseFile(fileName = 'tudor-england.ndcase'): File {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('The backup file input is missing.');
  }

  const file = new File([new Uint8Array([1, 2, 3])], fileName, {
    type: 'application/zip',
  });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

async function chooseAndReview(fileName?: string): Promise<File> {
  const file = chooseFile(fileName);
  await screen.findByRole('region', { name: 'Archive summary' });
  return file;
}

function stageItem(label: string): HTMLElement {
  const text = screen.getByText(label);
  const item = text.closest('li');
  if (item === null) {
    throw new Error(`The stage "${label}" is missing its list item.`);
  }
  return item;
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
  vi.unstubAllGlobals();
});

describe('BackupDialog import', () => {
  it('shows title, card, connection, and image counts plus the exported date', async () => {
    const { operations } = renderDialog();
    const file = chooseFile();

    const summary = await screen.findByRole('region', { name: 'Archive summary' });

    expect(within(summary).getByText('Tudor England')).toBeInTheDocument();
    expect(within(summary).getByText('Cards').nextElementSibling).toHaveTextContent('7');
    expect(within(summary).getByText('Connections').nextElementSibling).toHaveTextContent('3');
    expect(within(summary).getByText('Images').nextElementSibling).toHaveTextContent('4');
    expect(within(summary).getByText(/1 Oct 2026/)).toHaveAttribute('dateTime', SUMMARY.exportedAt);
    expect(within(summary).getByText(/not encrypted/)).toBeInTheDocument();
    expect(operations.inspectArchive).toHaveBeenCalledWith(file);
  });

  it('uses the File System Access picker when available', async () => {
    const user = userEvent.setup();
    const operations = makeOperations();
    const chosen = new File([new Uint8Array([4, 5, 6])], 'tudor-england.ndcase', {
      type: 'application/zip',
    });
    const getFile = vi.fn(async () => chosen);
    const showOpenFilePicker = vi.fn<BackupOpenFilePicker>(async () => [{ getFile }]);

    renderDialog({ operations, showOpenFilePicker });

    await user.click(screen.getByText('Choose backup file'));

    expect(await screen.findByRole('region', { name: 'Archive summary' })).toBeInTheDocument();
    expect(showOpenFilePicker).toHaveBeenCalledWith(expect.objectContaining({ multiple: false }));
    expect(getFile).toHaveBeenCalledTimes(1);
    expect(operations.inspectArchive).toHaveBeenCalledWith(chosen);
  });

  it('lists every import stage and restores a copy by default with an Open case action', async () => {
    const user = userEvent.setup();
    const onOpenCase = vi.fn();
    const { operations } = renderDialog({ onOpenCase });

    chooseFile();

    for (const label of [
      'Reading archive',
      'Checking integrity',
      'Restoring images',
      'Restoring cards',
      'Done',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    await screen.findByRole('region', { name: 'Archive summary' });
    expect(screen.getByRole('radio', { name: /Restore as a copy/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Replace existing case/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore as a copy' }));

    expect(await screen.findByRole('heading', { name: 'Case restored' })).toBeInTheDocument();
    expect(operations.restoreArchive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'copy' }),
    );

    const restoreOptions = vi.mocked(operations.restoreArchive).mock.calls[0]?.[1];
    expect(restoreOptions).not.toHaveProperty('replaceCaseId');

    await user.click(screen.getByRole('button', { name: 'Open case' }));
    expect(onOpenCase).toHaveBeenCalledWith(RESTORED_CASE_ID);
  });

  it('requires an explicit replace choice and the typed existing title', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository({ seed: { cases: [EXISTING_CASE] } });
    const { operations } = renderDialog({ repository });

    await chooseAndReview();

    const copy = screen.getByRole('radio', { name: /Restore as a copy/ });
    const replace = screen.getByRole('radio', { name: /Replace existing case/ });
    expect(copy).toBeChecked();
    expect(replace).not.toBeChecked();

    await user.click(replace);

    const confirm = screen.getByRole('textbox', { name: /Type .*Tudor England.*confirm/ });
    await user.click(screen.getByRole('button', { name: 'Replace case' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Type the existing case title exactly to replace it.',
    );
    expect(operations.restoreArchive).not.toHaveBeenCalled();

    await user.type(confirm, 'Tudor England');
    await user.click(screen.getByRole('button', { name: 'Replace case' }));

    expect(await screen.findByRole('heading', { name: 'Case restored' })).toBeInTheDocument();
    expect(operations.restoreArchive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: 'replace',
        replaceCaseId: ARCHIVE_CASE_ID,
        confirmTitle: 'Tudor England',
      }),
    );
  });

  it('names the failed integrity stage and keeps existing data untouched', async () => {
    const operations = makeOperations();
    vi.mocked(operations.inspectArchive).mockRejectedValue(
      new ArchiveImportError(
        'integrity',
        'checksum-mismatch',
        'The backup failed checksum verification.',
      ),
    );
    const repository = new InMemoryCaseRepository({ seed: { cases: [EXISTING_CASE] } });
    renderDialog({ operations, repository });

    chooseFile();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Import failed while checking integrity');
    expect(alert).toHaveTextContent('damaged');
    expect(stageItem('Checking integrity')).toHaveAttribute('data-status', 'failed');
    expect(screen.getByRole('button', { name: 'Choose another backup' })).toBeInTheDocument();
    expect(operations.restoreArchive).not.toHaveBeenCalled();
    expect(await repository.listCaseSummaries()).toHaveLength(1);
  });

  it('names the failed write stage and promises that data was not cleared', async () => {
    const user = userEvent.setup();
    const operations = makeOperations();
    vi.mocked(operations.restoreArchive).mockRejectedValue(
      new ArchiveImportError(
        'writing',
        'write-failed',
        'The case could not be restored. The existing data was left unchanged.',
      ),
    );
    renderDialog({ operations });

    await chooseAndReview();
    await user.click(screen.getByRole('button', { name: 'Restore as a copy' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Import failed while restoring cards');
    expect(alert).toHaveTextContent('Nothing on this device was changed');
    expect(stageItem('Restoring cards')).toHaveAttribute('data-status', 'failed');
  });

  it('renders an imported title as plain text, never as HTML', async () => {
    const operations = makeOperations();
    const injected = '<img src=x onerror="alert(1)">';
    vi.mocked(operations.inspectArchive).mockResolvedValue(
      fakeInspection({ ...SUMMARY, title: injected }),
    );
    renderDialog({ operations });

    chooseFile();

    const summary = await screen.findByRole('region', { name: 'Archive summary' });
    expect(within(summary).getByText(injected)).toBeInTheDocument();
    expect(summary.querySelector('img')).toBeNull();
  });
});

describe('BackupDialog export', () => {
  it('shows every export stage and saves through the download fallback without a network call', async () => {
    const user = userEvent.setup();
    const operations = makeOperations();
    const download = vi.fn<ArchiveDownloader>();
    const onExported = vi.fn();
    const onOpenCase = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderDialog({
      operations,
      initialView: 'export',
      exportCaseId: EXPORT_CASE_ID,
      exportCaseTitle: 'Tudor England',
      download,
      onExported,
      onOpenCase,
    });

    for (const label of [
      'Reading case',
      'Checking images',
      'Packaging archive',
      'Saving file',
      'Done',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'Export case' }));

    expect(await screen.findByRole('heading', { name: 'Backup saved' })).toBeInTheDocument();
    expect(operations.buildExport).toHaveBeenCalledWith({
      caseId: EXPORT_CASE_ID,
      repository: expect.any(InMemoryCaseRepository),
    });
    expect(operations.saveExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ download }),
    );
    expect(onExported).toHaveBeenCalledTimes(1);
    expect(stageItem('Checking images')).toHaveAttribute('data-status', 'complete');
    expect(stageItem('Done')).toHaveAttribute('data-status', 'complete');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Open case' }));
    expect(onOpenCase).toHaveBeenCalledWith(EXPORT_CASE_ID);
  });

  it('uses the Blob download fallback when File System Access is unavailable', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository({
      seed: {
        cases: [
          {
            ...EXISTING_CASE,
            id: EXPORT_CASE_ID,
            title: 'Organic Chemistry',
          },
        ],
      },
    });
    const download = vi.fn<ArchiveDownloader>();

    render(
      <MemoryRouter>
        <BackupDialog
          open
          repository={repository}
          initialView="export"
          exportCaseId={EXPORT_CASE_ID}
          exportCaseTitle="Organic Chemistry"
          download={download}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Export case' }));

    expect(await screen.findByRole('heading', { name: 'Backup saved' })).toBeInTheDocument();
    expect(download).toHaveBeenCalledTimes(1);

    const saved = download.mock.calls[0];
    expect(saved?.[0]).toBeInstanceOf(Blob);
    expect(saved?.[1]).toMatch(/^organic-chemistry-\d{4}-\d{2}-\d{2}\.ndcase$/);
  });

  it('names the failed export stage from the typed export error', async () => {
    const user = userEvent.setup();
    const operations = makeOperations();
    vi.mocked(operations.buildExport).mockRejectedValue(
      new ArchiveExportError('hashing', 'An image could not be verified.'),
    );
    const onExported = vi.fn();
    renderDialog({
      operations,
      initialView: 'export',
      exportCaseId: EXPORT_CASE_ID,
      exportCaseTitle: 'Tudor England',
      onExported,
    });

    await user.click(screen.getByRole('button', { name: 'Export case' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Export failed while checking images');
    expect(alert).toHaveTextContent('An image could not be verified.');
    expect(stageItem('Checking images')).toHaveAttribute('data-status', 'failed');
    expect(onExported).not.toHaveBeenCalled();
  });

  it('treats a cancelled save as a notice rather than an error', async () => {
    const user = userEvent.setup();
    const operations = makeOperations();
    vi.mocked(operations.saveExport).mockRejectedValue(new ArchiveSaveCancelledError());
    const onExported = vi.fn();
    renderDialog({
      operations,
      initialView: 'export',
      exportCaseId: EXPORT_CASE_ID,
      exportCaseTitle: 'Tudor England',
      onExported,
    });

    await user.click(screen.getByRole('button', { name: 'Export case' }));

    expect(await screen.findByText(/Saving was cancelled/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onExported).not.toHaveBeenCalled();
  });
});

describe('BackupDialog wiring and accessibility', () => {
  it('opens import from the empty shelf recovery link', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();

    render(
      <MemoryRouter>
        <CaseShelfPage repository={repository} />
      </MemoryRouter>,
    );

    const restore = await screen.findByRole('link', { name: 'Restore from a backup file' });
    expect(restore).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(restore);

    expect(await screen.findByRole('dialog', { name: 'Backup and restore' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose backup file')).toBeInTheDocument();
  });

  it('opens import and export from the shelf card actions', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository({
      seed: {
        cases: [
          {
            ...EXISTING_CASE,
            id: EXPORT_CASE_ID,
            title: 'Organic Chemistry',
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <CaseShelfPage repository={repository} />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Restore from backup' }));

    expect(await screen.findByRole('dialog', { name: 'Backup and restore' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose backup file')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Back up Organic Chemistry' }));

    expect(await screen.findByRole('dialog', { name: 'Backup and restore' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export case' })).toBeInTheDocument();
    expect(screen.getByText(/Save one file containing/)).toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [repository] = useState(() => new InMemoryCaseRepository());

      return (
        <MemoryRouter>
          <Button onClick={() => setOpen(true)}>Open backup</Button>
          {open ? (
            <BackupDialog
              open
              repository={repository}
              initialView="import"
              onClose={() => setOpen(false)}
            />
          ) : null}
        </MemoryRouter>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open backup' });
    await user.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Backup and restore' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('keeps the file trigger at a 44px target, visible focus, and token-only colours', () => {
    const css = readRepositoryFile('src/features/backup/BackupDialog.css');
    const shelfCss = readRepositoryFile('src/features/shelf/shelf.css');
    const source = readRepositoryFile('src/features/backup/BackupDialog.tsx');

    requireBlockTarget(css, '.backup-dialog__file-label');
    requireBlockTarget(css, '.backup-dialog__choice');
    requireBlockTarget(shelfCss, '.shelf__restore-link');

    const focus = declarationsFor(css, '.backup-dialog__file-label:focus-within');
    expect(focus.get('outline')).toContain('var(--focus-ring-width)');
    expect(focus.get('outline')).toContain('var(--color-focus-ring)');

    const shelfFocus = declarationsFor(shelfCss, '.shelf__restore-link:focus-visible');
    expect(shelfFocus.get('outline')).toContain('var(--color-focus-ring)');

    expect(stripComments(css)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(source).not.toContain('dangerouslySetInnerHTML');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(
      parseCssRules(css).some((rule) => rule.media?.includes('prefers-reduced-motion: reduce')),
    ).toBe(true);
  });
});
