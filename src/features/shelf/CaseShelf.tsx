import type { ReactNode } from 'react';

import Button from '../../components/Button';
import type { CaseSummary } from '../../domain/model';

import CaseCard from './CaseCard';
import './shelf.css';

export interface CaseShelfProps {
  /** Already ordered by nearest exam date, undated last, then most recent. */
  readonly cases: readonly CaseSummary[];
  readonly selectedCaseId: string | null;
  readonly onEdit: (summary: CaseSummary) => void;
  /** Opens the destructive confirmation owned by the shelf page. */
  readonly onDelete: (summary: CaseSummary) => void;
  /** Opens the export flow for one case from its row actions. */
  readonly onBackUp?: ((summary: CaseSummary) => void) | undefined;
  /** Opens the import flow. The page owns the dialog. */
  readonly onImport?: (() => void) | undefined;
  /** Storage strip rendered above the grid. The shelf page owns its data. */
  readonly storageStatus?: ReactNode | undefined;
}

/**
 * The case grid. It is a real list so a screen reader announces the number of
 * case files and each card keeps its own link and edit control.
 */
export default function CaseShelf({
  cases,
  selectedCaseId,
  onEdit,
  onDelete,
  onBackUp,
  onImport,
  storageStatus,
}: CaseShelfProps) {
  return (
    <>
      {storageStatus}
      <ul className="shelf__grid" aria-label="Case files">
        {cases.map((summary) => (
          <li key={summary.id} className="shelf__grid-item">
            <CaseCard
              summary={summary}
              selected={selectedCaseId === summary.id}
              onEdit={onEdit}
              onDelete={onDelete}
              onBackup={onBackUp}
            />
          </li>
        ))}
      </ul>

      {onImport !== undefined ? (
        <section className="shelf__backup" aria-labelledby="shelf-backup-title">
          <div className="shelf__backup-copy">
            <p className="shelf__eyebrow">Backup and restore</p>
            <h3 id="shelf-backup-title">Keep a copy outside this browser</h3>
            <p>
              Export one case at a time from its Back up action, or restore a <code>.ndcase</code>{' '}
              file here. Backups stay on this device and are never uploaded.
            </p>
          </div>
          <Button variant="secondary" onClick={onImport}>
            Restore from backup
          </Button>
        </section>
      ) : null}
    </>
  );
}
