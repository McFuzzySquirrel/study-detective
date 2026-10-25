import type { ReactNode } from 'react';

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
            />
          </li>
        ))}
      </ul>
    </>
  );
}
