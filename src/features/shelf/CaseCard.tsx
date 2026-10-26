import { Link } from 'react-router';

import Button from '../../components/Button';
import { deriveCaseLifecycle, looseThreadLabel } from '../../domain/caseLifecycle';
import type { CaseSummary } from '../../domain/model';

import './shelf.css';

export interface CaseCardProps {
  readonly summary: CaseSummary;
  readonly selected: boolean;
  readonly onEdit: (summary: CaseSummary) => void;
  /** Opens the destructive confirmation; it never deletes on its own. */
  readonly onDelete: (summary: CaseSummary) => void;
  /** Opens the export flow for just this case. */
  readonly onBackup?: ((summary: CaseSummary) => void) | undefined;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

function formatExamDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function formatUpdatedAt(value: string): string {
  return timestampFormatter.format(new Date(value));
}

/**
 * One case in the shelf grid. The title is a link to the board; the edit and
 * delete controls are siblings, never nested inside the link. The link's
 * stretched pseudo-element makes the whole card pointer-clickable while the
 * actions stay on top and keyboard reachable on their own.
 */
export default function CaseCard({ summary, selected, onEdit, onDelete, onBackup }: CaseCardProps) {
  const titleId = `case-title-${summary.id}`;
  const linkId = `case-open-${summary.id}`;
  const lifecycle = deriveCaseLifecycle(summary.closedAt, {
    ready: summary.readiness === 'ready',
    looseThreadCount: summary.looseThreadCount,
  });
  const openLoose = !lifecycle.closed && lifecycle.looseThreadCount > 0;
  const badgeLabel =
    lifecycle.badgeLabel ?? (openLoose ? looseThreadLabel(lifecycle.looseThreadCount) : null);
  const badgeState = lifecycle.closed
    ? lifecycle.ready
      ? 'closed'
      : 'closed-loose'
    : openLoose
      ? 'loose'
      : null;

  return (
    <article
      className="case-card"
      aria-labelledby={titleId}
      data-selected={selected ? 'true' : 'false'}
      data-demo={summary.isDemo ? 'true' : 'false'}
    >
      <div className="case-card__header">
        <div className="case-card__title-group">
          {summary.isDemo ? (
            <span className="case-card__demo-ribbon" data-testid="case-demo-ribbon">
              Demo
            </span>
          ) : null}
          <h3 id={titleId} className="case-card__title">
            <Link
              id={linkId}
              className="case-card__link"
              to={`/case/${summary.id}`}
              data-case-link={summary.id}
              aria-current={selected ? 'true' : undefined}
            >
              {summary.title}
            </Link>
          </h3>
        </div>

        {badgeLabel !== null && badgeState !== null ? (
          <span className="case-card__badge" data-state={badgeState}>
            {badgeLabel}
          </span>
        ) : null}
      </div>

      {summary.isDemo ? (
        <p className="case-card__demo-note">Demo case — remove it whenever you like.</p>
      ) : null}

      <p className="case-card__subject">
        {summary.subject !== undefined ? summary.subject : 'No subject recorded'}
      </p>

      <dl className="case-card__meta">
        <div className="case-card__meta-item">
          <dt>Exam date</dt>
          <dd>
            {summary.examDate !== undefined ? (
              <time dateTime={summary.examDate}>{formatExamDate(summary.examDate)}</time>
            ) : (
              'No exam date'
            )}
          </dd>
        </div>
        <div className="case-card__meta-item">
          <dt>Cards</dt>
          <dd>{summary.cardCount}</dd>
        </div>
        <div className="case-card__meta-item">
          <dt>Connections</dt>
          <dd>{summary.connectionCount}</dd>
        </div>
      </dl>

      <p className="case-card__updated">
        Updated <time dateTime={summary.updatedAt}>{formatUpdatedAt(summary.updatedAt)}</time>
      </p>

      <div className="case-card__actions">
        <Button
          variant="quiet"
          size="md"
          aria-label={`Edit ${summary.title}`}
          onClick={() => onEdit(summary)}
        >
          Edit
        </Button>
        {onBackup !== undefined ? (
          <Button
            variant="quiet"
            size="md"
            aria-label={`Back up ${summary.title}`}
            onClick={() => onBackup(summary)}
          >
            Back up
          </Button>
        ) : null}
        <Button
          variant="danger"
          size="md"
          aria-label={summary.isDemo ? `Remove demo ${summary.title}` : `Delete ${summary.title}`}
          onClick={() => onDelete(summary)}
        >
          {summary.isDemo ? 'Remove demo' : 'Delete'}
        </Button>
      </div>
    </article>
  );
}
