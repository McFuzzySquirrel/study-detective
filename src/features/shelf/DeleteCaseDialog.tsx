import { useRef, useState } from 'react';

import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import type { CaseDeletionPreview } from '../../data/deleteCase';

import './shelf.css';

export interface DeleteCaseDialogProps {
  /** Authoritative counts read from storage when the dialog opened. */
  readonly preview: CaseDeletionPreview;
  /** Names the target as the demo case and uses removal wording. */
  readonly isDemo?: boolean | undefined;
  readonly onClose: () => void;
  /**
   * Performs the cascade. A rejection keeps the dialog open and announces that
   * nothing was removed; the transaction rolls back in the data layer.
   */
  readonly onConfirm: () => Promise<void>;
}

type CountKey = 'cards' | 'connections' | 'images';

function countRows(
  preview: CaseDeletionPreview,
): { key: CountKey; label: string; value: number }[] {
  return [
    { key: 'cards', label: 'Cards', value: preview.cardCount },
    { key: 'connections', label: 'Connections', value: preview.connectionCount },
    { key: 'images', label: 'Images', value: preview.imageCount },
  ];
}

/**
 * Destructive confirmation for deleting a whole case.
 *
 * It names the case, states the exact card, connection, and image counts, and
 * says plainly that deletion is permanent. Cancel receives initial focus so a
 * keyboard user cannot destroy a case by reflex, Escape cancels, and the shared
 * Dialog restores focus to the delete trigger on close. There is deliberately
 * no undo control.
 */
export default function DeleteCaseDialog({
  preview,
  isDemo = false,
  onClose,
  onConfirm,
}: DeleteCaseDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const targetName = isDemo ? 'the demo case' : 'this case';
  const dialogTitle = isDemo
    ? `Remove demo case “${preview.title}”?`
    : `Delete “${preview.title}”?`;
  const dialogDescription = isDemo
    ? 'Removing the demo case deletes its sample cards, strings, and images from this device. Your own cases are not touched.'
    : 'Deleting a case permanently removes it and everything pinned to it from this device.';

  const handleConfirm = async (): Promise<void> => {
    if (deleting) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      await onConfirm();
      onClose();
    } catch {
      // The data layer rolled the whole transaction back. Keep the dialog and
      // its counts so the student can retry or cancel.
      setError(
        isDemo
          ? 'The demo case could not be removed. Nothing was removed; try again.'
          : 'The case could not be deleted. Nothing was removed; try again.',
      );
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={dialogTitle}
      description={dialogDescription}
      size="sm"
      dismissible={!deleting}
      closeOnBackdrop={!deleting}
      initialFocusRef={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} variant="quiet" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void handleConfirm()} disabled={deleting}>
            {deleting
              ? isDemo
                ? 'Removing…'
                : 'Deleting…'
              : isDemo
                ? 'Remove demo'
                : 'Delete case'}
          </Button>
        </>
      }
    >
      <div className="delete-case">
        <p className="delete-case__lead">This removes {targetName} and everything stored in it:</p>

        <dl className="delete-case__counts" aria-label="Case contents">
          {countRows(preview).map((row) => (
            <div key={row.key} className="delete-case__count" data-count={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        <p className="delete-case__warning" role="note">
          <strong>{isDemo ? 'Removal is permanent.' : 'Deletion is permanent.'}</strong>{' '}
          {isDemo
            ? 'The demo will not be recreated automatically, and no copy is kept in the app.'
            : 'It cannot be undone and no copy is kept in the app.'}
        </p>

        {error !== null ? (
          <p className="delete-case__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
