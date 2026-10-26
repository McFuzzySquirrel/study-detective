import { Link } from 'react-router';

import EmptyState from '../../components/EmptyState';

import './EmptyBoard.css';

export interface EmptyBoardProps {
  readonly caseId: string;
}

/**
 * The zero-card board. Capture is the only useful action on an empty case, so
 * this panel replaces the canvas instead of showing controls that have nothing
 * to pan, zoom, or fit.
 */
export default function EmptyBoard({ caseId }: EmptyBoardProps) {
  return (
    <div className="empty-board">
      <EmptyState
        className="empty-board__panel"
        headingLevel={3}
        title="Pin the first clue"
        description="A case file starts with one note, one source, or one topic. Add evidence now; the board appears as soon as the first card is pinned."
        action={
          <div className="empty-board__actions">
            <Link
              className="nd-button nd-button--primary nd-button--lg"
              to={`/case/${caseId}/capture?kind=note`}
            >
              Add note
            </Link>
            <Link
              className="nd-button nd-button--secondary nd-button--lg"
              to={`/case/${caseId}/capture?kind=source`}
            >
              Add source
            </Link>
            <Link
              className="nd-button nd-button--secondary nd-button--lg"
              to={`/case/${caseId}/capture?kind=topic`}
            >
              Add topic
            </Link>
          </div>
        }
      />

      <p className="empty-board__hint">
        Tip: a topic is a good thread anchor. Every string later joins two cards, so a clear title
        now makes that connection easier to read.
      </p>
    </div>
  );
}
