import { openNotesDetectiveDatabase } from '../../data/db';
import type { NotesDetectiveDatabase } from '../../data/db';

import { buildCaseArchive, saveCaseArchive } from './exportCase';
import type {
  BuildCaseArchiveInput,
  CaseArchive,
  SaveCaseArchiveOptions,
  SaveCaseArchiveResult,
} from './exportCase';
import { restoreValidatedCaseArchive } from './importCase';
import type { RestoreCaseResult, RestoreMode } from './importCase';
import { inspectCaseArchive } from './importValidation';
import type {
  CaseArchiveInspection,
  CaseArchiveInput,
  ValidatedCaseArchive,
} from './importValidation';

/**
 * The operations seam between the backup dialog and the archive machinery.
 *
 * The dialog never opens Dexie, parses a ZIP, hashes an image, or writes a
 * record itself. It calls this small interface, which composes the existing
 * export and import APIs. Tests inject a fake to exercise every UI state
 * without rebuilding real archives, while production resolves the one app
 * database lazily on the first restore.
 */

export type BackupRestoreRequest = {
  readonly mode: RestoreMode;
  readonly replaceCaseId?: string;
  readonly confirmTitle?: string;
  readonly supportedDbSchemaVersions?: readonly number[];
};

export interface BackupOperations {
  /** Read one case and package its archive bytes (no file has been saved yet). */
  buildExport(input: BuildCaseArchiveInput): Promise<CaseArchive>;
  /** Save those bytes using File System Access or the Blob download fallback. */
  saveExport(
    archive: CaseArchive,
    options?: SaveCaseArchiveOptions,
  ): Promise<SaveCaseArchiveResult>;
  /** Validate an untrusted file and produce the dialog summary. */
  inspectArchive(input: CaseArchiveInput): Promise<CaseArchiveInspection>;
  /** Restore an already inspected archive as a copy or an explicit replacement. */
  restoreArchive(
    archive: ValidatedCaseArchive,
    options: BackupRestoreRequest,
  ): Promise<RestoreCaseResult>;
}

export type CreateBackupOperationsOptions = {
  /** Injected only for integration tests; production opens the app database. */
  readonly database?: NotesDetectiveDatabase;
};

export function createBackupOperations(
  options: CreateBackupOperationsOptions = {},
): BackupOperations {
  let databasePromise: Promise<NotesDetectiveDatabase> | null = null;

  const resolveDatabase = (): Promise<NotesDetectiveDatabase> => {
    if (options.database !== undefined) {
      return Promise.resolve(options.database);
    }

    if (databasePromise === null) {
      databasePromise = openNotesDetectiveDatabase().catch((error: unknown) => {
        databasePromise = null;
        throw error;
      });
    }

    return databasePromise;
  };

  return {
    buildExport: (input) => buildCaseArchive(input),
    saveExport: (archive, saveOptions = {}) => saveCaseArchive(archive, saveOptions),
    inspectArchive: (input) => inspectCaseArchive(input),
    restoreArchive: async (archive, restoreOptions) => {
      const db = await resolveDatabase();
      return restoreValidatedCaseArchive(archive, {
        db,
        mode: restoreOptions.mode,
        ...(restoreOptions.replaceCaseId !== undefined
          ? { replaceCaseId: restoreOptions.replaceCaseId }
          : {}),
        ...(restoreOptions.confirmTitle !== undefined
          ? { confirmTitle: restoreOptions.confirmTitle }
          : {}),
        ...(restoreOptions.supportedDbSchemaVersions !== undefined
          ? { supportedDbSchemaVersions: restoreOptions.supportedDbSchemaVersions }
          : {}),
      });
    },
  };
}
