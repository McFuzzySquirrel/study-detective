/**
 * The Case menu: one dialog-style list for attention, backup, case capacity,
 * recall, non-spatial destinations, and the thread-type key.
 *
 * It is plain content inside the page's Panel (wide) or Dialog (phone). It has
 * no `role="menu"`; items keep normal Tab order. Phone adds the destinations
 * that the wide shell nav already keeps visible: card list, case shelf, and
 * settings.
 */

import { useId } from 'react';
import { Link } from 'react-router';

import Button from '../../components/Button';
import CaseCapacitySection from './CaseCapacitySection';
import ThreadTypes from '../connections/ThreadTypes';

import './CaseMenu.css';

export interface CaseMenuProps {
  readonly caseId: string;
  readonly phone: boolean;
  /** False while loading, missing, or failed: only safe destinations show. */
  readonly ready: boolean;
  readonly cardCount: number;
  readonly reminderVisible: boolean;
  readonly reminderSaving: boolean;
  readonly reminderError: string | null;
  /** Soft-capacity tier dismissal, owned by the page session. */
  readonly capacityDismissed: boolean;
  readonly onBackup: () => void;
  readonly onDismissReminder: () => void;
  readonly onDismissCapacity: () => void;
  /** Closes the menu before a route item unmounts the board. */
  readonly onNavigate: () => void;
}

export default function CaseMenu({
  caseId,
  phone,
  ready,
  cardCount,
  reminderVisible,
  reminderSaving,
  reminderError,
  capacityDismissed,
  onBackup,
  onDismissReminder,
  onDismissCapacity,
  onNavigate,
}: CaseMenuProps) {
  const backupTitleId = useId();

  if (!ready) {
    return (
      <div className="case-menu" data-ready="false">
        <Link className="case-menu__item" to="/" onClick={onNavigate}>
          Case shelf
        </Link>
        <Link className="case-menu__item" to="/settings" onClick={onNavigate}>
          Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="case-menu" data-ready="true">
      {reminderVisible ? (
        <section className="case-menu__section" aria-labelledby={backupTitleId}>
          <h3 id={backupTitleId} className="case-menu__section-title">
            First backup
          </h3>
          <p className="case-menu__copy">
            Five cards and at least one connection is a good moment to keep a copy outside this
            browser. Backups are a single file and are never uploaded.
          </p>
          {reminderError !== null ? (
            <p className="case-menu__error" role="alert">
              {reminderError}
            </p>
          ) : null}
          <div className="case-menu__actions">
            <Button variant="primary" onClick={onBackup}>
              Back up now
            </Button>
            <Button variant="quiet" onClick={onDismissReminder} disabled={reminderSaving}>
              Not now
            </Button>
          </div>
        </section>
      ) : (
        <Button className="case-menu__item" variant="quiet" onClick={onBackup}>
          Back up case
        </Button>
      )}

      <CaseCapacitySection
        cardCount={cardCount}
        dismissed={capacityDismissed}
        onDismiss={onDismissCapacity}
      />

      {cardCount > 0 ? (
        <Link className="case-menu__item" to={`/case/${caseId}/recall`} onClick={onNavigate}>
          Recall
        </Link>
      ) : null}

      <hr className="case-menu__divider" />

      {phone ? (
        <>
          <Link className="case-menu__item" to={`/case/${caseId}/list`} onClick={onNavigate}>
            Open card list
          </Link>
          <Link className="case-menu__item" to="/" onClick={onNavigate}>
            Case shelf
          </Link>
          <Link className="case-menu__item" to="/settings" onClick={onNavigate}>
            Settings
          </Link>
          <hr className="case-menu__divider" />
        </>
      ) : null}

      <ThreadTypes />
    </div>
  );
}
