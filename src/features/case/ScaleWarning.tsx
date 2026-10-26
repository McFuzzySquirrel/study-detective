/**
 * The board-capacity warning.
 *
 * Three states share one component so the board and its tests cannot drift:
 *
 * - 120-149 cards: a dismissible soft warning.
 * - 150-199 cards: a persistent warning advising a case split.
 * - 200 cards: a hard-stop alert with the shared split-case message.
 *
 * The count is supplied by the page. This component never reads storage and
 * never creates a card; it only explains the limit and, at the hard stop,
 * points at the case shelf where a new case can be started.
 */

import { useId, useState } from 'react';
import { Link } from 'react-router';

import Button from '../../components/Button';
import {
  MAX_BOARD_CARDS,
  SPLIT_CASE_MESSAGE,
  boardCapacityLevel,
  normalizeCardCount,
  remainingCardCapacity,
} from '../../board/boardCapacity';

import './ScaleWarning.css';

export interface ScaleWarningProps {
  readonly cardCount: number;
  readonly className?: string | undefined;
}

function warningTitle(level: 'soft' | 'persistent' | 'blocked'): string {
  if (level === 'blocked') {
    return 'This case is full';
  }
  if (level === 'persistent') {
    return 'This case is large — consider splitting it';
  }
  return 'This case is getting large';
}

function warningBody(level: 'soft' | 'persistent' | 'blocked', count: number): string {
  if (level === 'blocked') {
    return SPLIT_CASE_MESSAGE;
  }

  if (level === 'persistent') {
    const remaining = remainingCardCapacity(count);
    return `${count} of ${MAX_BOARD_CARDS} cards are pinned. Split the case into two boards before the hard stop; ${remaining} ${remaining === 1 ? 'card remains' : 'cards remain'}.`;
  }

  return `${count} cards are pinned. A case becomes hard to scan at 150 cards, so plan a split before then.`;
}

/** Capacity warning for the board header. Renders nothing below 120 cards. */
export default function ScaleWarning({ cardCount, className }: ScaleWarningProps) {
  const count = normalizeCardCount(cardCount);
  const level = boardCapacityLevel(count);
  const [softDismissed, setSoftDismissed] = useState(false);
  const headingId = useId();

  if (level === 'normal' || (level === 'soft' && softDismissed)) {
    return null;
  }

  const blocked = level === 'blocked';
  const persistent = level === 'persistent' || blocked;
  const role = blocked ? 'alert' : 'status';
  const classes = ['scale-warning', `scale-warning--${level}`, className]
    .filter((value): value is string => value !== undefined)
    .join(' ');

  return (
    <aside
      className={classes}
      role={role}
      aria-labelledby={headingId}
      data-card-count={count}
      data-card-capacity={level}
    >
      <div className="scale-warning__copy">
        <h3 id={headingId} className="scale-warning__title">
          {warningTitle(level)}
          {blocked ? '' : ` (${count})`}
        </h3>
        <p className="scale-warning__body">{warningBody(level, count)}</p>
        {blocked ? (
          <p className="scale-warning__body">
            New cards are blocked on the board and on the capture route. No case below{' '}
            {MAX_BOARD_CARDS} cards is limited.
          </p>
        ) : null}
      </div>

      <div className="scale-warning__actions">
        {blocked ? (
          <Link className="scale-warning__link" to="/">
            Create a new case
          </Link>
        ) : null}
        {persistent ? null : (
          <Button variant="quiet" onClick={() => setSoftDismissed(true)}>
            Dismiss warning
          </Button>
        )}
      </div>
    </aside>
  );
}
