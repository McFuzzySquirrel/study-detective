/**
 * The board-capacity section of the Case menu.
 *
 * Three states share one component so the menu and its tests cannot drift:
 *
 * - 120-149 cards: a dismissible soft notice for the page session.
 * - 150-199 cards: a persistent notice advising a case split.
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

import './CaseCapacitySection.css';

export interface CaseCapacitySectionProps {
  readonly cardCount: number;
  /** Soft-tier session dismissal, owned by the page. */
  readonly dismissed?: boolean | undefined;
  readonly onDismiss?: (() => void) | undefined;
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

/** Capacity section for the Case menu. Renders nothing below 120 cards. */
export default function CaseCapacitySection({
  cardCount,
  dismissed = false,
  onDismiss,
  className,
}: CaseCapacitySectionProps) {
  const count = normalizeCardCount(cardCount);
  const level = boardCapacityLevel(count);
  const headingId = useId();
  const [internalDismissed, setInternalDismissed] = useState(false);
  const isDismissed = dismissed || internalDismissed;

  if (level === 'normal' || (level === 'soft' && isDismissed)) {
    return null;
  }

  const blocked = level === 'blocked';
  const persistent = level === 'persistent' || blocked;
  const role = blocked ? 'alert' : 'status';
  const classes = ['case-capacity', `case-capacity--${level}`, className]
    .filter((value): value is string => value !== undefined)
    .join(' ');

  return (
    <section
      className={classes}
      role={role}
      aria-labelledby={headingId}
      data-card-count={count}
      data-card-capacity={level}
    >
      <h3 id={headingId} className="case-capacity__title">
        Case capacity
      </h3>
      <p className="case-capacity__heading">
        {warningTitle(level)}
        {blocked ? '' : ` (${count})`}
      </p>
      <p className="case-capacity__body">{warningBody(level, count)}</p>
      {blocked ? (
        <p className="case-capacity__body">
          New cards are blocked on the board and on the capture route. No case below{' '}
          {MAX_BOARD_CARDS} cards is limited.
        </p>
      ) : null}

      <div className="case-capacity__actions">
        {blocked ? (
          <Link className="case-capacity__link" to="/">
            Create a new case
          </Link>
        ) : null}
        {persistent ? null : (
          <Button
            variant="quiet"
            onClick={() => {
              setInternalDismissed(true);
              onDismiss?.();
            }}
          >
            Dismiss warning
          </Button>
        )}
      </div>
    </section>
  );
}
