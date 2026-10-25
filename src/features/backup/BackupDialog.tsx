import { useCallback, useId, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import { useNavigate } from 'react-router';

import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import Field from '../../components/Field';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import type { CaseRecord } from '../../domain/model';

import { createBackupOperations } from './backupOperations';
import type { BackupOperations } from './backupOperations';
import { ArchiveExportError, ArchiveSaveCancelledError, ArchiveSaveError } from './exportCase';
import type { ArchiveDownloader, ArchiveSaveFilePicker, ExportCaseResult } from './exportCase';
import type { RestoreCaseResult, RestoreMode } from './importCase';
import { ArchiveImportError } from './importValidation';
import type {
  ArchiveImportFailure,
  CaseArchiveInspection,
  CaseArchiveSummary,
} from './importValidation';
import './BackupDialog.css';

/**
 * Backup and restore dialog.
 *
 * Export reads exactly one case through the repository boundary, builds the
 * `.ndcase` archive, and saves it through File System Access when the browser
 * exposes it or a same-document Blob download otherwise. Import is always a
 * local file input; the selected bytes are validated and summarised before the
 * student chooses Copy (the default) or Replace. Replace is never the default
 * and requires the existing case title to be typed exactly.
 *
 * Nothing is uploaded. The dialog performs no network request and never stores
 * an archive in application state beyond the file the student selected.
 */

export type BackupDialogView = 'export' | 'import';

/** Minimal structural view of the File System Access open picker. */
export type BackupFileHandle = {
  getFile(): Promise<File>;
};

export type BackupOpenFilePicker = (options: {
  readonly multiple: false;
  readonly types: readonly {
    readonly description: string;
    readonly accept: Readonly<Record<string, readonly string[]>>;
  }[];
  readonly excludeAcceptAllOption: boolean;
}) => Promise<readonly BackupFileHandle[]>;

export interface BackupDialogProps {
  readonly open: boolean;
  readonly repository: CaseRepositoryPort;
  readonly initialView?: BackupDialogView;
  /** The case to export. Omit to hide the export action. */
  readonly exportCaseId?: string;
  readonly exportCaseTitle?: string;
  readonly onClose: () => void;
  /** Called after a copy or replacement committed. */
  readonly onImported?: (result: RestoreCaseResult) => void;
  /** Called after the archive file was saved. */
  readonly onExported?: (result: ExportCaseResult) => void;
  /** Injected archive operations. Production creates the real composition. */
  readonly operations?: BackupOperations;
  /** `null` forces the download fallback; omitted uses the browser API when available. */
  readonly showSaveFilePicker?: ArchiveSaveFilePicker | null;
  /** `null` forces the file-input fallback; omitted uses the browser API when available. */
  readonly showOpenFilePicker?: BackupOpenFilePicker | null;
  readonly download?: ArchiveDownloader;
  /** Overrides the success-destination navigation for component tests. */
  readonly onOpenCase?: (caseId: string) => void;
  readonly onBackToShelf?: () => void;
}

type OpenPickerGlobal = typeof globalThis & {
  showOpenFilePicker?: BackupOpenFilePicker;
};

function resolveOpenFilePicker(
  override: BackupOpenFilePicker | null | undefined,
): BackupOpenFilePicker | null {
  if (override !== undefined) {
    return override;
  }

  const picker = (globalThis as OpenPickerGlobal).showOpenFilePicker;
  return typeof picker === 'function' ? picker.bind(globalThis) : null;
}

function isPickerAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name?: unknown }).name === 'AbortError'
  );
}

type StageStatus = 'pending' | 'active' | 'complete' | 'failed';

type StageDefinition = {
  readonly id: string;
  readonly label: string;
};

const EXPORT_STAGES = [
  { id: 'reading', label: 'Reading case' },
  { id: 'hashing', label: 'Checking images' },
  { id: 'packaging', label: 'Packaging archive' },
  { id: 'saving', label: 'Saving file' },
  { id: 'done', label: 'Done' },
] as const satisfies readonly StageDefinition[];

const IMPORT_STAGES = [
  { id: 'reading', label: 'Reading archive' },
  { id: 'checking', label: 'Checking integrity' },
  { id: 'restoring-images', label: 'Restoring images' },
  { id: 'restoring-cards', label: 'Restoring cards' },
  { id: 'done', label: 'Done' },
] as const satisfies readonly StageDefinition[];

type ExportStageId = (typeof EXPORT_STAGES)[number]['id'];
type ImportStageId = (typeof IMPORT_STAGES)[number]['id'];

type ProgressState<StageId extends string> = {
  readonly active: StageId | null;
  readonly failed: StageId | null;
  readonly completed: readonly StageId[];
};

type ExportPhase = 'idle' | 'working' | 'success' | 'error' | 'cancelled';
type ImportPhase = 'idle' | 'inspecting' | 'review' | 'restoring' | 'success' | 'error';

type ExportFailure = {
  readonly stage: ExportStageId;
  readonly message: string;
};

type ImportFailure = {
  readonly stage: ImportStageId;
  readonly message: string;
};

const EXPORT_ALL_COMPLETE: readonly ExportStageId[] = EXPORT_STAGES.map((stage) => stage.id);
const IMPORT_ALL_COMPLETE: readonly ImportStageId[] = IMPORT_STAGES.map((stage) => stage.id);

const exportDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

function formatExportedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : exportDateFormatter.format(date);
}

function stageLabel(stages: readonly StageDefinition[], id: string): string {
  return stages.find((stage) => stage.id === id)?.label ?? 'Preparing';
}

function stageStatus(
  stages: readonly StageDefinition[],
  index: number,
  progress: ProgressState<string>,
): StageStatus {
  const stage = stages[index];
  if (stage === undefined) {
    return 'pending';
  }

  const activeIndex =
    progress.active === null ? -1 : stages.findIndex((entry) => entry.id === progress.active);
  const failedIndex =
    progress.failed === null ? -1 : stages.findIndex((entry) => entry.id === progress.failed);

  if (progress.failed === stage.id) {
    return 'failed';
  }
  if (progress.active === stage.id) {
    return 'active';
  }
  if (progress.completed.includes(stage.id) || activeIndex > index || failedIndex > index) {
    return 'complete';
  }
  return 'pending';
}

const STATUS_TEXT: Record<StageStatus, string> = {
  pending: 'Waiting',
  active: 'In progress',
  complete: 'Complete',
  failed: 'Failed',
};

function StageList({
  stages,
  progress,
  label,
}: {
  readonly stages: readonly StageDefinition[];
  readonly progress: ProgressState<string>;
  readonly label: string;
}) {
  return (
    <ol className="backup-dialog__stages" aria-label={label}>
      {stages.map((stage, index) => {
        const status = stageStatus(stages, index, progress);
        return (
          <li
            key={stage.id}
            className="backup-dialog__stage"
            data-status={status}
            aria-current={status === 'active' ? 'step' : undefined}
          >
            <span className="backup-dialog__stage-label">{stage.label}</span>
            <span className="backup-dialog__stage-state">{STATUS_TEXT[status]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function summaryCount(value: number): string {
  return String(value);
}

function importFailureMessage(failure: ArchiveImportFailure): string {
  switch (failure) {
    case 'unsupported-format':
      return 'This is not a Notes Detective backup. Choose a .ndcase file exported from this app.';
    case 'unsupported-version':
      return 'This backup was made by a different version of Notes Detective. Update the app and try again.';
    case 'missing-image':
      return 'The backup is missing an image. Choose a complete copy of the .ndcase file.';
    case 'checksum-mismatch':
      return 'The backup is damaged and failed its integrity check. Try another copy; nothing on this device was changed.';
    case 'size-mismatch':
      return 'The backup is damaged or incomplete. Try another copy; nothing on this device was changed.';
    case 'too-many-entries':
      return 'This file contains too many entries to be a case backup.';
    case 'archive-too-large':
      return 'This backup is too large to restore.';
    case 'entry-too-large':
      return 'This backup contains a file that is too large to restore.';
    case 'unsafe-path':
    case 'duplicate-entry':
    case 'unexpected-entry':
      return 'This file is not a safe Notes Detective backup and was rejected. Your existing data was not changed.';
    case 'replace-not-confirmed':
      return 'Choose Replace existing case and type the existing case title exactly.';
    case 'replace-target-missing':
      return 'The case to replace is no longer on this device. Restore the backup as a copy instead.';
    case 'id-allocation-failed':
      return 'The restore could not create new identifiers. Try again; nothing on this device was changed.';
    case 'write-failed':
      return 'The case could not be saved to this device. Nothing was changed. Check free space and try again.';
    case 'unreadable-archive':
      return 'The selected file could not be read. Choose the .ndcase file again.';
    case 'invalid-zip':
    case 'missing-manifest':
    case 'invalid-manifest':
      return 'The backup file could not be opened. Try another copy; nothing on this device was changed.';
    default:
      return 'The backup could not be restored. Nothing on this device was changed.';
  }
}

function mapImportStage(stage: ArchiveImportError['stage']): ImportStageId {
  if (stage === 'reading') {
    return 'reading';
  }
  if (stage === 'structure' || stage === 'integrity') {
    return 'checking';
  }
  return 'restoring-cards';
}

function describeImportError(error: unknown): ImportFailure {
  if (error instanceof ArchiveImportError) {
    return {
      stage: mapImportStage(error.stage),
      message: importFailureMessage(error.failure),
    };
  }

  return {
    stage: 'reading',
    message: 'The backup could not be read. Choose the file again; nothing was changed.',
  };
}

function mapExportStage(stage: ArchiveExportError['stage']): ExportStageId {
  return stage;
}

function describeExportError(error: unknown, fallback: ExportStageId): ExportFailure {
  if (error instanceof ArchiveExportError) {
    return { stage: mapExportStage(error.stage), message: error.message };
  }
  if (error instanceof ArchiveSaveError) {
    return { stage: 'saving', message: error.message };
  }

  return {
    stage: fallback,
    message:
      fallback === 'saving'
        ? 'The archive could not be saved. Choose a different location and try again.'
        : 'The case could not be prepared for backup. Nothing was changed.',
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function ArchiveSummary({
  summary,
  headingId,
}: {
  readonly summary: CaseArchiveSummary;
  readonly headingId: string;
}) {
  return (
    <section className="backup-dialog__summary" aria-labelledby={headingId}>
      <h3 id={headingId} className="backup-dialog__section-title">
        Archive summary
      </h3>

      <dl className="backup-dialog__summary-grid">
        <div>
          <dt>Case</dt>
          <dd className="backup-dialog__summary-title">{summary.title}</dd>
        </div>
        <div>
          <dt>Cards</dt>
          <dd>{summaryCount(summary.cardCount)}</dd>
        </div>
        <div>
          <dt>Connections</dt>
          <dd>{summaryCount(summary.connectionCount)}</dd>
        </div>
        <div>
          <dt>Images</dt>
          <dd>{summaryCount(summary.imageCount)}</dd>
        </div>
        <div>
          <dt>Exported</dt>
          <dd>
            <time dateTime={summary.exportedAt}>{formatExportedAt(summary.exportedAt)}</time>
          </dd>
        </div>
      </dl>

      {summary.subject !== undefined ? (
        <p className="backup-dialog__summary-note">Subject: {summary.subject}</p>
      ) : null}

      <p className="backup-dialog__privacy">
        This file contains private notes and is not encrypted. Store it somewhere you trust.
      </p>
    </section>
  );
}

export default function BackupDialog({
  open,
  repository,
  initialView = 'export',
  exportCaseId,
  exportCaseTitle,
  onClose,
  onImported,
  onExported,
  operations,
  showSaveFilePicker,
  showOpenFilePicker,
  download,
  onOpenCase,
  onBackToShelf,
}: BackupDialogProps) {
  const navigate = useNavigate();
  const generatedId = useId();
  const fileInputId = `backup-file-${generatedId.replace(/:/g, '')}`;
  const fileHintId = `${fileInputId}-hint`;
  const summaryHeadingId = `${fileInputId}-summary`;
  const choicesLegendId = `${fileInputId}-choices`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const [defaultOperations] = useState(() => createBackupOperations());

  const activeOperations = operations ?? defaultOperations;

  const [view, setView] = useState<BackupDialogView>(initialView);

  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle');
  const [exportProgress, setExportProgress] = useState<ProgressState<ExportStageId>>({
    active: null,
    failed: null,
    completed: [],
  });
  const [exportFailure, setExportFailure] = useState<ExportFailure | null>(null);
  const [exportResult, setExportResult] = useState<ExportCaseResult | null>(null);

  const [importPhase, setImportPhase] = useState<ImportPhase>('idle');
  const [importProgress, setImportProgress] = useState<ProgressState<ImportStageId>>({
    active: null,
    failed: null,
    completed: [],
  });
  const [importFailure, setImportFailure] = useState<ImportFailure | null>(null);
  const [inspection, setInspection] = useState<CaseArchiveInspection | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<CaseRecord | null>(null);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('copy');
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<RestoreCaseResult | null>(null);

  const busy =
    exportPhase === 'working' || importPhase === 'inspecting' || importPhase === 'restoring';

  const requestClose = useCallback(() => {
    if (busy) {
      return;
    }
    onClose();
  }, [busy, onClose]);

  const finishToCase = (caseId: string): void => {
    if (onOpenCase !== undefined) {
      onOpenCase(caseId);
    } else {
      void navigate(`/case/${caseId}`);
    }
    onClose();
  };

  const finishToShelf = (): void => {
    if (onBackToShelf !== undefined) {
      onBackToShelf();
    } else {
      void navigate('/');
    }
    onClose();
  };

  const handleExport = async (): Promise<void> => {
    if (exportCaseId === undefined) {
      setExportFailure({
        stage: 'reading',
        message: 'Open a case before making a backup of it.',
      });
      setExportPhase('error');
      return;
    }

    setExportPhase('working');
    setExportFailure(null);
    setExportResult(null);
    setExportProgress({ active: 'reading', failed: null, completed: [] });
    let failingStage: ExportStageId = 'reading';

    try {
      const archive = await activeOperations.buildExport({
        caseId: exportCaseId,
        repository,
      });

      failingStage = 'saving';
      setExportProgress({
        active: 'saving',
        failed: null,
        completed: ['reading', 'hashing', 'packaging'],
      });

      const saveOptions = {
        ...(showSaveFilePicker !== undefined ? { showSaveFilePicker } : {}),
        ...(download !== undefined ? { download } : {}),
      };
      const save = await activeOperations.saveExport(archive, saveOptions);

      const result: ExportCaseResult = { archive, save };
      setExportProgress({ active: null, failed: null, completed: EXPORT_ALL_COMPLETE });
      setExportResult(result);
      setExportPhase('success');
      onExported?.(result);
    } catch (error) {
      if (error instanceof ArchiveSaveCancelledError) {
        setExportProgress({ active: null, failed: null, completed: [] });
        setExportPhase('cancelled');
        return;
      }

      const failure = describeExportError(error, failingStage);
      setExportFailure(failure);
      setExportProgress({ active: null, failed: failure.stage, completed: [] });
      setExportPhase('error');
    }
  };

  const inspectFile = async (file: File): Promise<void> => {
    setImportPhase('inspecting');
    setImportFailure(null);
    setImportResult(null);
    setInspection(null);
    setReplaceTarget(null);
    setRestoreMode('copy');
    setConfirmTitle('');
    setConfirmError(null);
    setImportProgress({ active: 'reading', failed: null, completed: [] });

    try {
      await tick();
      setImportProgress({ active: 'checking', failed: null, completed: ['reading'] });
      const nextInspection = await activeOperations.inspectArchive(file);

      let existing: CaseRecord | null = null;
      try {
        existing = await repository.getCase(nextInspection.summary.caseId);
      } catch {
        // Copy restore is still safe when the optional replace lookup fails.
        existing = null;
      }

      setInspection(nextInspection);
      setReplaceTarget(existing);
      setImportProgress({
        active: null,
        failed: null,
        completed: ['reading', 'checking'],
      });
      setImportPhase('review');
    } catch (error) {
      const failure = describeImportError(error);
      setImportFailure(failure);
      setImportProgress({ active: null, failed: failure.stage, completed: [] });
      setImportPhase('error');
    } finally {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    void inspectFile(file);
  };

  const handleChooseClick = (event: MouseEvent<HTMLElement>): void => {
    if (busy) {
      event.preventDefault();
      return;
    }

    const picker = resolveOpenFilePicker(showOpenFilePicker);
    if (picker === null) {
      // No File System Access support: let the label activate its file input.
      return;
    }

    event.preventDefault();

    void (async () => {
      try {
        const handles = await picker({
          multiple: false,
          types: [
            {
              description: 'Notes Detective case archive',
              accept: { 'application/zip': ['.ndcase'] },
            },
          ],
          excludeAcceptAllOption: false,
        });
        const handle = handles[0];
        if (handle === undefined) {
          return;
        }
        const file = await handle.getFile();
        await inspectFile(file);
      } catch (error) {
        if (isPickerAbort(error)) {
          return;
        }
        setImportFailure({
          stage: 'reading',
          message: 'The file picker could not be opened. Choose the backup file again.',
        });
        setImportProgress({ active: null, failed: 'reading', completed: [] });
        setImportPhase('error');
      }
    })();
  };

  const handleRestore = async (): Promise<void> => {
    if (inspection === null) {
      return;
    }

    if (restoreMode === 'replace') {
      if (replaceTarget === null) {
        setConfirmError(
          'The case to replace is no longer available. Restore the backup as a copy.',
        );
        return;
      }
      if (confirmTitle.trim() !== replaceTarget.title) {
        setConfirmError('Type the existing case title exactly to replace it.');
        confirmInputRef.current?.focus();
        return;
      }
    }

    setImportPhase('restoring');
    setImportFailure(null);
    setConfirmError(null);
    setImportProgress({
      active: 'restoring-images',
      failed: null,
      completed: ['reading', 'checking'],
    });

    try {
      await tick();
      setImportProgress({
        active: 'restoring-cards',
        failed: null,
        completed: ['reading', 'checking', 'restoring-images'],
      });

      const result = await activeOperations.restoreArchive(inspection.archive, {
        mode: restoreMode,
        ...(restoreMode === 'replace' && replaceTarget !== null
          ? { replaceCaseId: replaceTarget.id, confirmTitle: confirmTitle.trim() }
          : {}),
      });

      setImportProgress({ active: null, failed: null, completed: IMPORT_ALL_COMPLETE });
      setImportResult(result);
      setImportPhase('success');
      onImported?.(result);
    } catch (error) {
      const failure = describeImportError(error);
      setImportFailure(failure);
      setImportProgress({ active: null, failed: failure.stage, completed: [] });
      setImportPhase('error');
    }
  };

  const chooseAnotherFile = (): void => {
    fileInputRef.current?.click();
  };

  const openCaseId = view === 'export' ? exportCaseId : importResult?.caseId;
  const exportStageAnnouncement =
    exportPhase === 'working'
      ? `${stageLabel(EXPORT_STAGES, exportProgress.active ?? 'reading')}…`
      : exportPhase === 'success'
        ? 'Backup complete.'
        : exportFailure !== null
          ? `Export failed at ${stageLabel(EXPORT_STAGES, exportFailure.stage)}.`
          : '';
  const importStageAnnouncement =
    importPhase === 'inspecting'
      ? `${stageLabel(IMPORT_STAGES, importProgress.active ?? 'reading')}…`
      : importPhase === 'restoring'
        ? `${stageLabel(IMPORT_STAGES, importProgress.active ?? 'restoring-cards')}…`
        : importPhase === 'review'
          ? 'Archive checked. Review the summary before restoring.'
          : importPhase === 'success'
            ? 'Restore complete.'
            : importFailure !== null
              ? `Import failed at ${stageLabel(IMPORT_STAGES, importFailure.stage)}.`
              : '';

  const viewSwitch = (
    <div className="backup-dialog__views" role="group" aria-label="Backup actions">
      {exportCaseId !== undefined ? (
        <Button
          variant={view === 'export' ? 'secondary' : 'quiet'}
          aria-pressed={view === 'export'}
          onClick={() => setView('export')}
          disabled={busy}
        >
          Export this case
        </Button>
      ) : null}
      <Button
        variant={view === 'import' ? 'secondary' : 'quiet'}
        aria-pressed={view === 'import'}
        onClick={() => setView('import')}
        disabled={busy}
      >
        Restore a backup
      </Button>
    </div>
  );

  const exportBody = (
    <>
      <p className="backup-dialog__lead">
        {exportCaseTitle !== undefined
          ? `Save one file containing “${exportCaseTitle}” and its images.`
          : 'Save one case and its images as a single .ndcase file.'}
      </p>

      <p role="status" aria-live="polite" className="backup-dialog__announcement">
        {exportStageAnnouncement}
      </p>

      <StageList stages={EXPORT_STAGES} progress={exportProgress} label="Export progress" />

      {exportPhase === 'success' && exportResult !== null ? (
        <section className="backup-dialog__result" aria-labelledby={`${fileInputId}-export-done`}>
          <h3 id={`${fileInputId}-export-done`} className="backup-dialog__section-title">
            Backup saved
          </h3>
          <p>
            <strong>{exportResult.save.fileName}</strong> was saved
            {exportResult.save.method === 'download'
              ? ' through your browser’s download folder.'
              : ' to the location you chose.'}
          </p>
          <p className="backup-dialog__privacy">
            Keep it somewhere trusted. The archive is not encrypted.
          </p>
        </section>
      ) : null}

      {exportPhase === 'error' && exportFailure !== null ? (
        <section
          className="backup-dialog__error"
          role="alert"
          aria-labelledby={`${fileInputId}-export-error`}
        >
          <h3 id={`${fileInputId}-export-error`} className="backup-dialog__section-title">
            Export failed while {stageLabel(EXPORT_STAGES, exportFailure.stage).toLowerCase()}
          </h3>
          <p>{exportFailure.message}</p>
          <p className="backup-dialog__privacy">Your case was not changed.</p>
        </section>
      ) : null}

      {exportPhase === 'cancelled' ? (
        <p className="backup-dialog__notice" role="status">
          Saving was cancelled. The case was not changed.
        </p>
      ) : null}
    </>
  );

  const importBody = (
    <>
      <p className="backup-dialog__lead">
        Restore a case from a <code>.ndcase</code> file. The file stays on this device and is never
        uploaded.
      </p>

      <div className="backup-dialog__pick">
        <label
          className="backup-dialog__file-label"
          htmlFor={fileInputId}
          onClick={handleChooseClick}
        >
          Choose backup file
        </label>
        <input
          ref={fileInputRef}
          id={fileInputId}
          className="backup-dialog__file-input visually-hidden"
          type="file"
          accept=".ndcase,application/zip"
          aria-describedby={fileHintId}
          onChange={handleFileChange}
          onClick={handleChooseClick}
          disabled={busy}
          data-autofocus
        />
        <p id={fileHintId} className="backup-dialog__hint">
          Only .ndcase files created by Notes Detective are accepted.
        </p>
      </div>

      <p role="status" aria-live="polite" className="backup-dialog__announcement">
        {importStageAnnouncement}
      </p>

      <StageList stages={IMPORT_STAGES} progress={importProgress} label="Import progress" />

      {inspection !== null && importPhase !== 'success' ? (
        <ArchiveSummary summary={inspection.summary} headingId={summaryHeadingId} />
      ) : null}

      {inspection !== null && (importPhase === 'review' || importPhase === 'restoring') ? (
        <fieldset className="backup-dialog__choices" aria-describedby={choicesLegendId}>
          <legend id={choicesLegendId} className="backup-dialog__section-title">
            Restore how?
          </legend>

          <label className="backup-dialog__choice">
            <input
              type="radio"
              name={`${fileInputId}-mode`}
              value="copy"
              checked={restoreMode === 'copy'}
              onChange={() => setRestoreMode('copy')}
              disabled={importPhase === 'restoring'}
            />
            <span>
              <strong>Restore as a copy</strong>
              <span className="backup-dialog__choice-detail">
                Adds a new case with new IDs. The existing copy on this device is left alone.
              </span>
            </span>
          </label>

          {replaceTarget !== null ? (
            <label className="backup-dialog__choice">
              <input
                type="radio"
                name={`${fileInputId}-mode`}
                value="replace"
                checked={restoreMode === 'replace'}
                onChange={() => {
                  setRestoreMode('replace');
                  setConfirmError(null);
                }}
                disabled={importPhase === 'restoring'}
              />
              <span>
                <strong>Replace existing case</strong>
                <span className="backup-dialog__choice-detail">
                  Replaces “{replaceTarget.title}” after you type its title. This cannot be undone.
                </span>
              </span>
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {restoreMode === 'replace' && replaceTarget !== null && importPhase !== 'success' ? (
        <div className="backup-dialog__confirm">
          <Field
            label={`Type “${replaceTarget.title}” to confirm`}
            hint="The existing case and its contents will be removed first."
            {...(confirmError !== null ? { error: confirmError } : {})}
            required
          >
            {(control) => (
              <input
                {...control}
                ref={confirmInputRef}
                type="text"
                value={confirmTitle}
                autoComplete="off"
                spellCheck={false}
                disabled={importPhase === 'restoring'}
                onChange={(event) => {
                  setConfirmTitle(event.target.value);
                  setConfirmError(null);
                }}
              />
            )}
          </Field>
        </div>
      ) : null}

      {importPhase === 'error' && importFailure !== null ? (
        <section
          className="backup-dialog__error"
          role="alert"
          aria-labelledby={`${fileInputId}-import-error`}
        >
          <h3 id={`${fileInputId}-import-error`} className="backup-dialog__section-title">
            Import failed while {stageLabel(IMPORT_STAGES, importFailure.stage).toLowerCase()}
          </h3>
          <p>{importFailure.message}</p>
          <p className="backup-dialog__privacy">Nothing on this device was changed.</p>
        </section>
      ) : null}

      {importPhase === 'success' && importResult !== null ? (
        <section className="backup-dialog__result" aria-labelledby={`${fileInputId}-import-done`}>
          <h3 id={`${fileInputId}-import-done`} className="backup-dialog__section-title">
            Case restored
          </h3>
          <p>
            <strong>{importResult.title}</strong> was restored
            {importResult.mode === 'replace' ? ' over the existing copy.' : ' as a new copy.'}
          </p>
          <p>
            {importResult.cardCount} {importResult.cardCount === 1 ? 'card' : 'cards'}, {''}
            {importResult.connectionCount}{' '}
            {importResult.connectionCount === 1 ? 'connection' : 'connections'}, and{' '}
            {importResult.attachmentCount} {importResult.attachmentCount === 1 ? 'image' : 'images'}{' '}
            restored.
          </p>
        </section>
      ) : null}
    </>
  );

  const actions = (() => {
    if (view === 'export') {
      if (exportPhase === 'success') {
        return (
          <>
            <Button variant="secondary" onClick={finishToShelf}>
              Back to shelf
            </Button>
            {openCaseId !== undefined ? (
              <Button variant="primary" onClick={() => finishToCase(openCaseId)}>
                Open case
              </Button>
            ) : null}
          </>
        );
      }

      if (exportPhase === 'error') {
        return (
          <>
            <Button variant="quiet" onClick={requestClose}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void handleExport()}>
              Try export again
            </Button>
          </>
        );
      }

      if (exportPhase === 'cancelled') {
        return (
          <>
            <Button variant="quiet" onClick={requestClose}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void handleExport()}>
              Export again
            </Button>
          </>
        );
      }

      if (exportPhase === 'working') {
        return (
          <Button variant="secondary" disabled>
            Saving…
          </Button>
        );
      }

      return (
        <>
          <Button variant="quiet" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleExport()}
            disabled={exportCaseId === undefined}
          >
            Export case
          </Button>
        </>
      );
    }

    if (importPhase === 'success') {
      return (
        <>
          <Button variant="secondary" onClick={finishToShelf}>
            Back to shelf
          </Button>
          {openCaseId !== undefined ? (
            <Button variant="primary" onClick={() => finishToCase(openCaseId)}>
              Open case
            </Button>
          ) : null}
        </>
      );
    }

    if (importPhase === 'error') {
      return (
        <>
          <Button variant="quiet" onClick={requestClose}>
            Close
          </Button>
          <Button variant="primary" onClick={chooseAnotherFile}>
            Choose another backup
          </Button>
        </>
      );
    }

    if (importPhase === 'restoring') {
      return (
        <Button variant="secondary" disabled>
          Restoring…
        </Button>
      );
    }

    if (importPhase === 'inspecting') {
      return (
        <Button variant="secondary" disabled>
          Checking backup…
        </Button>
      );
    }

    if (importPhase === 'review' && inspection !== null) {
      return (
        <>
          <Button variant="quiet" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            variant={restoreMode === 'replace' ? 'danger' : 'primary'}
            onClick={() => void handleRestore()}
          >
            {restoreMode === 'replace' ? 'Replace case' : 'Restore as a copy'}
          </Button>
        </>
      );
    }

    return (
      <Button variant="quiet" onClick={requestClose}>
        Cancel
      </Button>
    );
  })();

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      title="Backup and restore"
      description="Backups stay on this device and are never uploaded. The .ndcase file is not encrypted, so store it somewhere you trust."
      size="lg"
      className="backup-dialog"
      dismissible={!busy}
      closeOnBackdrop={!busy}
      actions={actions}
    >
      {viewSwitch}
      {view === 'export' ? exportBody : importBody}
    </Dialog>
  );
}
