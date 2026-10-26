import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';

import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import { deriveCaseLifecycle } from '../../domain/caseLifecycle';
import type { CaseRecord } from '../../domain/model';
import type { CaseReadiness, LooseThread } from '../../domain/readiness';

import './closure.css';

const closedDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const LOOSE_REASON_LABELS: Record<LooseThread['reason'], string> = {
  'no-source-link': 'No source link',
  'no-topic-connection': 'No topic connection',
  'no-connections': 'No connections',
};

function formatClosedDate(value: string): string {
  return closedDateFormatter.format(new Date(value));
}

function reasonText(thread: LooseThread): string {
  return thread.reasons.map((reason) => LOOSE_REASON_LABELS[reason]).join(' · ');
}

export interface ClosurePanelProps {
  readonly caseRecord: CaseRecord;
  /** Derived from the current cards and connections, never stored. */
  readonly readiness: CaseReadiness;
  /** True while the owning page is writing another closure change. */
  readonly busy?: boolean;
  /** Inline write failure from `useCaseLifecycle`. */
  readonly error?: string | null;
  /** Confirmed close. Returns false when the write was rejected. */
  readonly onCloseCase: () => Promise<boolean> | boolean;
  /** Confirmed reopen. Returns false when the write was rejected. */
  readonly onReopenCase: () => Promise<boolean> | boolean;
  /** Card-detail link for a loose-thread row. */
  readonly cardHref: (cardId: string) => string;
  /** Optional non-spatial jump that centers the card on the board. */
  readonly onShowCard?: ((cardId: string) => void) | undefined;
  readonly onClearError?: (() => void) | undefined;
}

/**
 * The case-closure panel.
 *
 * It shows derived readiness, every loose thread with its missing requirement,
 * and one Close action that is disabled until the count is zero. Closing and
 * reopening are confirmed dialogs; closure is metadata, so nothing here blocks
 * editing, recall, or export.
 *
 * The panel never derives readiness itself and never writes a case record. It
 * receives both from the page so the shelf and the case screen cannot disagree
 * about the graph.
 */
export default function ClosurePanel({
  caseRecord,
  readiness,
  busy = false,
  error = null,
  onCloseCase,
  onReopenCase,
  cardHref,
  onShowCard,
  onClearError,
}: ClosurePanelProps) {
  const idBase = useId().replace(/:/g, '');
  const titleId = `${idBase}-title`;
  const looseTitleId = `${idBase}-loose-title`;
  const reasonId = `${idBase}-close-reason`;

  const lifecycle = deriveCaseLifecycle(caseRecord.closedAt, readiness);
  const [confirming, setConfirming] = useState<'close' | 'reopen' | null>(null);
  const [working, setWorking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelCloseRef = useRef<HTMLButtonElement>(null);
  const cancelReopenRef = useRef<HTMLButtonElement>(null);
  const workingRef = useRef(false);

  const isWorking = busy || working;

  const openClose = (): void => {
    if (!lifecycle.canClose || isWorking) {
      return;
    }
    onClearError?.();
    setConfirming('close');
  };

  const openReopen = (): void => {
    if (!lifecycle.canReopen || isWorking) {
      return;
    }
    onClearError?.();
    setConfirming('reopen');
  };

  const cancelConfirmation = (): void => {
    if (!isWorking) {
      setConfirming(null);
    }
  };

  const confirmAction = async (): Promise<void> => {
    const action = confirming;
    if (action === null || workingRef.current) {
      return;
    }

    workingRef.current = true;
    setWorking(true);
    onClearError?.();

    try {
      const succeeded = action === 'close' ? await onCloseCase() : await onReopenCase();

      if (succeeded) {
        setConfirming(null);

        // A successful close keeps the same Close trigger, so Dialog returns
        // focus there. Reopen removes its trigger; after Dialog's cleanup runs,
        // land on the panel heading rather than letting focus fall to <body>.
        if (action === 'reopen') {
          window.setTimeout(() => {
            headingRef.current?.focus();
          }, 0);
        }
      }
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  };

  return (
    <aside
      className="closure-panel"
      aria-labelledby={titleId}
      data-testid="closure-panel"
      data-closure-state={lifecycle.state}
      data-loose-count={lifecycle.looseThreadCount}
    >
      <header className="closure-panel__header">
        <p className="closure-panel__eyebrow">Case closure</p>
        <h3 id={titleId} ref={headingRef} className="closure-panel__title" tabIndex={-1}>
          Closure
        </h3>

        {caseRecord.closedAt !== null && lifecycle.badgeLabel !== null ? (
          <p
            className="closure-panel__badge"
            data-state={lifecycle.state}
            data-testid="closure-badge"
          >
            <span className="closure-panel__badge-label">{lifecycle.badgeLabel}</span>
            <time className="closure-panel__badge-date" dateTime={caseRecord.closedAt}>
              on {formatClosedDate(caseRecord.closedAt)}
            </time>
          </p>
        ) : null}

        <p
          className="closure-panel__readiness"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-ready={lifecycle.ready ? 'true' : 'false'}
        >
          {lifecycle.readinessLabel}
        </p>

        <p className="closure-panel__hint">
          Closing records a date. It never locks editing, recall, or export, and nothing is archived
          or deleted.
        </p>
      </header>

      {lifecycle.looseThreadCount === 0 ? (
        <p className="closure-panel__clear">
          No loose threads. Every Study Note has a source and a topic, and every Topic has a
          connection.
        </p>
      ) : (
        <section className="closure-panel__threads" aria-labelledby={looseTitleId}>
          <h4 id={looseTitleId} className="closure-panel__threads-title">
            Loose threads
          </h4>
          <ul className="closure-panel__thread-list">
            {readiness.looseThreads.map((thread) => (
              <li
                key={`${thread.kind}:${thread.cardId}`}
                className="closure-panel__thread"
                data-thread-kind={thread.kind}
                data-thread-reason={thread.reason}
              >
                <div className="closure-panel__thread-head">
                  <Link
                    className="closure-panel__thread-link"
                    to={cardHref(thread.cardId)}
                    aria-label={`Open detail for ${thread.card.title}`}
                  >
                    {thread.card.title}
                  </Link>
                  <span className="closure-panel__thread-kind">
                    {thread.kind === 'note' ? 'Study Note' : 'Topic'}
                  </span>
                </div>

                <p className="closure-panel__thread-reason">
                  <span className="visually-hidden">Missing: </span>
                  {reasonText(thread)}
                </p>

                {onShowCard !== undefined ? (
                  <Button
                    className="closure-panel__thread-action"
                    variant="quiet"
                    aria-label={`Show ${thread.card.title} on the board`}
                    onClick={() => onShowCard(thread.cardId)}
                  >
                    Show on board
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="closure-panel__actions">
        <Button
          variant="primary"
          onClick={openClose}
          disabled={!lifecycle.canClose || isWorking}
          aria-describedby={lifecycle.closeDisabledReason === null ? undefined : reasonId}
        >
          {isWorking && confirming === 'close' ? 'Closing…' : lifecycle.closeLabel}
        </Button>

        {lifecycle.canReopen ? (
          <Button variant="secondary" onClick={openReopen} disabled={isWorking}>
            Reopen case
          </Button>
        ) : null}
      </div>

      {lifecycle.closeDisabledReason !== null ? (
        <p id={reasonId} className="closure-panel__reason">
          {lifecycle.closeDisabledReason}
        </p>
      ) : null}

      {error !== null && confirming === null ? (
        <p className="closure-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog
        open={confirming === 'close'}
        onClose={cancelConfirmation}
        title="Close this case?"
        description={`“${caseRecord.title}” has no loose threads. Closing records the closure date and keeps every card editable. It does not lock, archive, or delete anything.`}
        size="sm"
        initialFocusRef={cancelCloseRef}
        dismissible={!isWorking}
        closeOnBackdrop={!isWorking}
        actions={
          <>
            <Button
              ref={cancelCloseRef}
              variant="quiet"
              onClick={cancelConfirmation}
              disabled={isWorking}
            >
              Keep open
            </Button>
            <Button variant="primary" onClick={() => void confirmAction()} disabled={isWorking}>
              {isWorking ? 'Closing…' : 'Close case'}
            </Button>
          </>
        }
      >
        <p className="closure-panel__dialog-copy">
          The closure date is metadata, not a lock. You can keep editing, opening recall, and
          exporting this case afterwards.
        </p>
        {error !== null ? (
          <p className="closure-panel__error" role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={confirming === 'reopen'}
        onClose={cancelConfirmation}
        title="Reopen this case?"
        description={`“${caseRecord.title}” will return to open. Its cards, strings, and backups are unchanged. Nothing is archived or deleted.`}
        size="sm"
        initialFocusRef={cancelReopenRef}
        dismissible={!isWorking}
        closeOnBackdrop={!isWorking}
        actions={
          <>
            <Button
              ref={cancelReopenRef}
              variant="quiet"
              onClick={cancelConfirmation}
              disabled={isWorking}
            >
              Keep closed
            </Button>
            <Button variant="primary" onClick={() => void confirmAction()} disabled={isWorking}>
              {isWorking ? 'Reopening…' : 'Reopen case'}
            </Button>
          </>
        }
      >
        <p className="closure-panel__dialog-copy">
          Reopening clears the closed date. It never happens automatically, even when the exam date
          passes.
        </p>
        {error !== null ? (
          <p className="closure-panel__error" role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>
    </aside>
  );
}
