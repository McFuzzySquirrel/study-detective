import type { CaseSummary } from '../../domain/model';

import CaseCard from './CaseCard';
import './shelf.css';

export interface CaseShelfProps {
  /** Already ordered by nearest exam date, undated last, then most recent. */
  readonly cases: readonly CaseSummary[];
  readonly selectedCaseId: string | null;
  readonly onEdit: (summary: CaseSummary) => void;
}

/**
 * The case grid. It is a real list so a screen reader announces the number of
 * case files and each card keeps its own link and edit control.
 */
export default function CaseShelf({ cases, selectedCaseId, onEdit }: CaseShelfProps) {
  return (
    <ul className="shelf__grid" aria-label="Case files">
      {cases.map((summary) => (
        <li key={summary.id} className="shelf__grid-item">
          <CaseCard summary={summary} selected={selectedCaseId === summary.id} onEdit={onEdit} />
        </li>
      ))}
    </ul>
  );
}
