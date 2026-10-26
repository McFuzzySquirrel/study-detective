/**
 * Derived Topic status for the non-spatial surfaces.
 *
 * The status is never stored: callers pass the values produced by
 * `deriveReadiness(...).topics` on the current render, so adding or removing a
 * connection after the initial load re-renders the badge without a reload.
 *
 * Semantics:
 *
 * - The accessible name is `Topic status: Solved, 2 linked notes`, so a screen
 *   reader hears both the state and the count. The visible chip keeps the same
 *   words, and the icon is decorative only: colour is never the only signal.
 * - Study Notes and Sources return `null`. That guard lives here as well as at
 *   the call sites so a future card list cannot accidentally badge a note.
 * - The copy names linked notes, not points, XP, score, or rank.
 */

import type { CardType } from '../../domain/model';
import type { TopicStatus } from '../../domain/readiness';

import './TopicStatusBadge.css';

export interface TopicStatusBadgeProps {
  readonly cardType: CardType;
  /** Derived by the readiness selector for this render. */
  readonly status: TopicStatus;
  /** Distinct associated Study Notes, derived by the readiness selector. */
  readonly linkedNoteCount: number;
  readonly className?: string;
}

const STATUS_LABELS: Record<TopicStatus, string> = {
  orphan: 'Orphan',
  developing: 'Developing',
  solved: 'Solved',
};

/** Readable and announced count; singular at one, plural everywhere else. */
function linkedNoteCountLabel(count: number): string {
  return `${count} linked ${count === 1 ? 'note' : 'notes'}`;
}

function normaliseCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.floor(count);
}

/**
 * Decorative status glyph. Each state has a distinct silhouette as well as a
 * text label, so the badge survives greyscale and low colour perception.
 */
function StatusIcon({ status }: { readonly status: TopicStatus }) {
  if (status === 'solved') {
    return (
      <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M4.9 8.2 7 10.3l4.1-4.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (status === 'developing') {
    return (
      <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

export default function TopicStatusBadge({
  cardType,
  status,
  linkedNoteCount,
  className,
}: TopicStatusBadgeProps) {
  // Notes and Sources never carry a topic status, even if a caller passes one.
  if (cardType !== 'topic') {
    return null;
  }

  const safeStatus: TopicStatus =
    status === 'orphan' || status === 'developing' || status === 'solved' ? status : 'orphan';
  const label = STATUS_LABELS[safeStatus];
  const countLabel = linkedNoteCountLabel(normaliseCount(linkedNoteCount));

  return (
    <p
      className={['topic-status', className].filter(Boolean).join(' ')}
      data-status={safeStatus}
      role="status"
      aria-label={`Topic status: ${label}, ${countLabel}`}
    >
      <span className="topic-status__icon" aria-hidden="true">
        <StatusIcon status={safeStatus} />
      </span>
      <span className="topic-status__label">{label}</span>
      <span className="topic-status__separator" aria-hidden="true">
        ·
      </span>
      <span className="topic-status__count">{countLabel}</span>
    </p>
  );
}
