/**
 * The selected-thread inspector on the case board.
 *
 * It shows the two card titles, the current type, a retype control, and a
 * destructive action. Retyping updates the existing connection row, so the ID
 * and the pair are never recreated. Provenance stays disabled with a visible
 * explanation unless the pair is one Study Note and one Source.
 *
 * Deleting always opens a confirmation that names both cards and the type.
 * Cancelling leaves the string untouched; confirming calls back to the page,
 * which owns the repository write and the 8-second undo toast.
 */

import { useId, useState } from 'react';

import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import type { CardType, ConnectionRecord, ConnectionType } from '../../domain/model';
import { isProvenanceEligible } from '../../domain/connections';

import { connectionTypeLabel } from './useUndoDeleteConnection';
import { provenanceReasonFor } from './useCreateConnection';

import './connections.css';

export interface ConnectionDetailCard {
  readonly id: string;
  readonly title: string;
  readonly type: CardType;
}

export interface ConnectionDetailProps {
  readonly connection: ConnectionRecord;
  readonly fromCard: ConnectionDetailCard;
  readonly toCard: ConnectionDetailCard;
  /** True while the owning page is already saving another mutation. */
  readonly busy?: boolean;
  /** Retype the existing row. A rejected promise is reported inline. */
  readonly onRetype: (type: ConnectionType) => Promise<void> | void;
  /** Delete the connection after confirmation. The page owns undo. */
  readonly onDelete: () => Promise<void> | void;
  /** Clears the board selection and closes the inspector. */
  readonly onClose?: (() => void) | undefined;
}

export const RETYPE_CONNECTION_ERROR =
  'The thread type could not be saved. The connection ID is unchanged; try again.';

export const DELETE_CONNECTION_ERROR =
  'The connection could not be deleted. It is still on the board; try again.';

export default function ConnectionDetail({
  connection,
  fromCard,
  toCard,
  busy = false,
  onRetype,
  onDelete,
  onClose,
}: ConnectionDetailProps) {
  const idBase = useId();
  const reasonId = `${idBase}-provenance-reason`;
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const eligible = isProvenanceEligible(fromCard.type, toCard.type);
  const provenanceReason = provenanceReasonFor(fromCard.type, toCard.type);
  const currentLabel = connectionTypeLabel(connection.type);
  const disabled = busy || saving;

  const handleRetype = async (type: ConnectionType): Promise<void> => {
    if (disabled || type === connection.type) {
      return;
    }

    setError(null);
    setSaving(true);

    try {
      await onRetype(type);
    } catch {
      setError(RETYPE_CONNECTION_ERROR);
    } finally {
      setSaving(false);
    }
  };

  const openConfirmation = (): void => {
    setDeleteError(null);
    setError(null);
    setConfirming(true);
  };

  const cancelConfirmation = (): void => {
    if (!saving) {
      setConfirming(false);
      setDeleteError(null);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    setDeleteError(null);
    setSaving(true);

    try {
      await onDelete();
      setConfirming(false);
    } catch {
      setDeleteError(DELETE_CONNECTION_ERROR);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="connection-detail"
      aria-labelledby="connection-detail-title"
      data-testid="connection-detail"
      data-connection-id={connection.id}
      data-current-type={connection.type}
    >
      <header className="connection-detail__header">
        <p className="connection-detail__eyebrow">Selected connection</p>
        <h3 id="connection-detail-title" className="connection-detail__title" tabIndex={-1}>
          “{fromCard.title}” and “{toCard.title}”
        </h3>
        <p className="connection-detail__summary">
          Current type: <strong>{currentLabel}</strong>.{' '}
          {connection.type === 'association'
            ? 'A solid red thread between any two cards.'
            : 'A thin dashed amber thread between a Study Note and a Source.'}
        </p>
      </header>

      <fieldset className="connection-detail__types" disabled={disabled}>
        <legend className="connection-detail__legend">Thread type</legend>

        <div className="connection-detail__option">
          <input
            id={`${idBase}-association`}
            className="connection-detail__radio"
            type="radio"
            name={`${idBase}-type`}
            value="association"
            checked={connection.type === 'association'}
            onChange={() => {
              void handleRetype('association');
            }}
          />
          <label className="connection-detail__label" htmlFor={`${idBase}-association`}>
            <span
              className="connection-detail__swatch"
              data-type="association"
              aria-hidden="true"
            />
            <span>
              <strong>Association</strong>
              <span className="connection-detail__hint">
                Solid red thread between any two distinct cards
              </span>
            </span>
          </label>
        </div>

        <div className="connection-detail__option">
          <input
            id={`${idBase}-provenance`}
            className="connection-detail__radio"
            type="radio"
            name={`${idBase}-type`}
            value="provenance"
            checked={connection.type === 'provenance'}
            disabled={!eligible}
            aria-describedby={eligible ? undefined : reasonId}
            onChange={() => {
              if (eligible) {
                void handleRetype('provenance');
              }
            }}
          />
          <label className="connection-detail__label" htmlFor={`${idBase}-provenance`}>
            <span className="connection-detail__swatch" data-type="provenance" aria-hidden="true" />
            <span>
              <strong>Provenance</strong>
              <span className="connection-detail__hint">
                Thin dashed amber thread from a Study Note to a Source
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <p
        id={reasonId}
        className="connection-detail__reason"
        data-eligible={eligible ? 'true' : 'false'}
        role="status"
        aria-live="polite"
      >
        {provenanceReason}
      </p>

      {error !== null ? (
        <p className="connection-detail__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="connection-detail__actions">
        <Button variant="danger" onClick={openConfirmation} disabled={disabled}>
          Delete connection
        </Button>
        {onClose !== undefined ? (
          <Button variant="quiet" onClick={onClose} disabled={disabled}>
            Close detail
          </Button>
        ) : null}
      </div>

      <Dialog
        open={confirming}
        onClose={cancelConfirmation}
        title="Delete this connection?"
        description={
          <span>
            {`This removes the ${currentLabel} connection between “${fromCard.title}” and “${toCard.title}”. Both cards stay on the board.`}
          </span>
        }
        size="sm"
        dismissible={!saving}
        actions={
          <>
            <Button variant="secondary" onClick={cancelConfirmation} disabled={saving}>
              Keep connection
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void confirmDelete();
              }}
              disabled={saving}
            >
              {saving ? 'Deleting…' : 'Delete connection'}
            </Button>
          </>
        }
      >
        {deleteError !== null ? (
          <p className="connection-detail__error" role="alert">
            {deleteError}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}
