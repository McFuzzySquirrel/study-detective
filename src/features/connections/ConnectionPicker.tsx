/**
 * The non-spatial connection picker.
 *
 * This is the keyboard and screen-reader path for the graph: it creates,
 * retypes, and deletes strings from card detail or the card list without ever
 * touching the Pixi canvas. The dialog owns only presentation and validation;
 * `ConnectionRepository` (injected or lazily opened by the page) is the write
 * boundary, and the page receives the resulting rows so its own snapshot stays
 * in sync.
 *
 * Rules mirrored from the domain:
 *
 * - Association may connect any two distinct cards.
 * - Provenance only connects one Study Note and one Source, so the target list
 *   filters to Sources for a note and to Notes for a source.
 * - A pair has at most one row. Choosing a pair that already exists retypes the
 *   existing connection instead of creating a duplicate.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import Field from '../../components/Field';
import type { ConnectionRepositoryPort } from '../../data/connectionRepository';
import { findConnectionForPair, isProvenanceEligible } from '../../domain/connections';
import type { CardType, ConnectionRecord, ConnectionType } from '../../domain/model';

import { connectionTypeLabel } from './useUndoDeleteConnection';

import './connections.css';

const CARD_TYPE_LABELS: Record<CardType, string> = {
  note: 'Study Note',
  source: 'Source',
  topic: 'Topic',
};

/** The card shape the picker needs. Full `CardRecord`s satisfy it. */
export interface ConnectionPickerCard {
  readonly id: string;
  readonly caseId: string;
  readonly title: string;
  readonly type: CardType;
}

export type ConnectionPickerIntent = 'connect' | 'attach-source';

export interface ConnectionPickerProps {
  readonly open: boolean;
  /** The card the new string starts from. */
  readonly currentCard: ConnectionPickerCard;
  /** Every card in the same case, including the current card. */
  readonly cards: readonly ConnectionPickerCard[];
  /** Every connection in the same case, in either orientation. */
  readonly connections: readonly ConnectionRecord[];
  /**
   * `attach-source` opens on Provenance and is aimed at Sources. A note's
   * ordinary `connect` action starts on Association and can use any card.
   */
  readonly intent?: ConnectionPickerIntent;
  /** Direct repository for tests and composition. */
  readonly repository?: ConnectionRepositoryPort | null;
  /** Lazy opener used by the routed pages; resolved on the first write. */
  readonly loadRepository?: () => Promise<ConnectionRepositoryPort | null>;
  /** Opens directly on an existing connection for retype or delete. */
  readonly initialConnectionId?: string | null;
  readonly onClose: () => void;
  readonly onConnectionCreated?: (connection: ConnectionRecord) => void;
  readonly onConnectionChanged?: (connection: ConnectionRecord) => void;
  readonly onConnectionDeleted?: (connection: ConnectionRecord) => void;
}

export const CONNECTION_PICKER_SAVE_ERROR =
  'The connection could not be saved. Your cards are unchanged; try again.';

export const CONNECTION_PICKER_DELETE_ERROR =
  'The connection could not be deleted. It is still on the board; try again.';

export const CONNECTION_PICKER_TARGET_ERROR = 'Choose a target card before saving.';

function compareCardsByTitle(a: ConnectionPickerCard, b: ConnectionPickerCard): number {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function otherCardId(connection: ConnectionRecord, currentCardId: string): string {
  return connection.fromCardId === currentCardId ? connection.toCardId : connection.fromCardId;
}

export default function ConnectionPicker({
  open,
  currentCard,
  cards,
  connections,
  intent = 'connect',
  repository,
  loadRepository,
  initialConnectionId = null,
  onClose,
  onConnectionCreated,
  onConnectionChanged,
  onConnectionDeleted,
}: ConnectionPickerProps) {
  const idBase = useId().replace(/:/g, '');
  const provenanceReasonId = `${idBase}-provenance-reason`;
  const targetCountId = `${idBase}-target-count`;
  const existingTitleId = `${idBase}-existing-title`;

  // The picker is mounted fresh for each open (the callers render it only while
  // open and key it by card and intent), so the props are the initial state.
  // That avoids a reset effect that would cascade a second render on mount.
  const initialType: ConnectionType =
    initialConnectionId !== null
      ? (connections.find((connection) => connection.id === initialConnectionId)?.type ??
        'association')
      : intent === 'attach-source'
        ? 'provenance'
        : 'association';

  const [search, setSearch] = useState('');
  const [type, setType] = useState<ConnectionType>(initialType);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(initialConnectionId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const typeGroupRef = useRef<HTMLFieldSetElement>(null);
  const targetGroupRef = useRef<HTMLFieldSetElement>(null);
  const keepConnectionRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingDeleteRef = useRef(false);
  const connectionsRef = useRef(connections);

  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  // Keep focus on the meaningful control when the dialog opens or switches
  // between target selection and editing.
  useEffect(() => {
    if (!open) {
      return;
    }

    if (editingId !== null) {
      typeGroupRef.current?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
      return;
    }

    searchRef.current?.focus();
  }, [open, editingId]);

  useEffect(() => {
    if (confirmingDelete) {
      keepConnectionRef.current?.focus();
    }
  }, [confirmingDelete]);

  // Cancelling the confirmation removes the focused Keep button. Land on the
  // original Delete connection action instead of letting focus fall to body.
  useEffect(() => {
    if (wasConfirmingDeleteRef.current && !confirmingDelete) {
      deleteTriggerRef.current?.focus();
    }
    wasConfirmingDeleteRef.current = confirmingDelete;
  }, [confirmingDelete]);

  const editingConnection =
    editingId === null
      ? null
      : (connections.find((connection) => connection.id === editingId) ?? null);
  const editingOther = useMemo(() => {
    if (editingConnection === null) {
      return null;
    }
    const id = otherCardId(editingConnection, currentCard.id);
    return cards.find((card) => card.id === id) ?? null;
  }, [cards, currentCard.id, editingConnection]);

  const provenanceTargets = useMemo(
    () =>
      cards
        .filter(
          (card) => card.id !== currentCard.id && isProvenanceEligible(currentCard.type, card.type),
        )
        .sort(compareCardsByTitle),
    [cards, currentCard.id, currentCard.type],
  );

  // A Topic can never be a provenance endpoint. A note or source can choose
  // provenance even before a legal target exists; the target count then
  // explains what is missing instead of leaving a checked-but-disabled radio.
  const provenanceAllowed = currentCard.type !== 'topic';
  const provenancePossible = provenanceTargets.length > 0;

  const provenanceReason = !provenanceAllowed
    ? 'Provenance is only available between one Study Note and one Source. A Topic cannot be an endpoint.'
    : provenancePossible
      ? currentCard.type === 'note'
        ? 'Provenance connects this Study Note to a Source.'
        : 'Provenance connects this Source to a Study Note.'
      : currentCard.type === 'note'
        ? 'Provenance needs a Source in this case. Add a Source first, or use an Association.'
        : 'Provenance needs a Study Note in this case. Add a Study Note first, or use an Association.';

  const targetsForType = useCallback(
    (nextType: ConnectionType): ConnectionPickerCard[] => {
      const others = cards.filter((card) => card.id !== currentCard.id);

      if (nextType === 'provenance') {
        return others
          .filter((card) => isProvenanceEligible(currentCard.type, card.type))
          .sort(compareCardsByTitle);
      }

      return others.sort(compareCardsByTitle);
    },
    [cards, currentCard.id, currentCard.type],
  );

  const normalizedSearch = search.trim().toLowerCase();
  const baseTargets = targetsForType(type);
  const visibleTargets =
    normalizedSearch.length === 0
      ? baseTargets
      : baseTargets.filter((card) => card.title.toLowerCase().includes(normalizedSearch));

  const targetCount =
    visibleTargets.length === 0
      ? normalizedSearch.length > 0
        ? `No targets match “${search.trim()}”.`
        : `No eligible target cards for ${connectionTypeLabel(type)}.`
      : normalizedSearch.length > 0
        ? `${visibleTargets.length} of ${baseTargets.length} ${baseTargets.length === 1 ? 'target' : 'targets'} match “${search.trim()}”.`
        : `${visibleTargets.length} ${visibleTargets.length === 1 ? 'target' : 'targets'} available.`;

  const existingConnections = useMemo(
    () =>
      connections
        .filter(
          (connection) =>
            connection.fromCardId === currentCard.id || connection.toCardId === currentCard.id,
        )
        .map((connection) => {
          const id = otherCardId(connection, currentCard.id);
          const other = cards.find((card) => card.id === id) ?? null;
          return { connection, other };
        })
        .filter(
          (entry): entry is { connection: ConnectionRecord; other: ConnectionPickerCard } =>
            entry.other !== null,
        )
        .sort((a, b) => compareCardsByTitle(a.other, b.other)),
    [cards, connections, currentCard.id],
  );

  const resolveRepository = useCallback(async (): Promise<ConnectionRepositoryPort | null> => {
    if (repository !== undefined) {
      return repository;
    }
    if (loadRepository !== undefined) {
      return loadRepository();
    }
    return null;
  }, [loadRepository, repository]);

  const requestClose = useCallback((): void => {
    if (busy) {
      return;
    }

    if (confirmingDelete) {
      setConfirmingDelete(false);
      setError(null);
      return;
    }

    onClose();
  }, [busy, confirmingDelete, onClose]);

  const handleTypeChange = (nextType: ConnectionType): void => {
    setType(nextType);
    setError(null);

    if (nextType === 'provenance') {
      const allowed = targetsForType('provenance');
      setTargetId((current) =>
        current !== null && allowed.some((card) => card.id === current) ? current : null,
      );
    }
  };

  const startEditing = (connection: ConnectionRecord): void => {
    setEditingId(connection.id);
    setType(connection.type);
    setTargetId(null);
    setSearch('');
    setError(null);
    setConfirmingDelete(false);
  };

  const stopEditing = (): void => {
    setEditingId(null);
    setType('association');
    setTargetId(null);
    setError(null);
    setConfirmingDelete(false);
  };

  const handleSave = async (): Promise<void> => {
    if (busy) {
      return;
    }

    setError(null);

    if (editingConnection !== null) {
      setBusy(true);

      try {
        const target = await resolveRepository();
        if (target === null) {
          throw new Error('The connection repository is not open.');
        }

        const updated =
          editingConnection.type === type
            ? editingConnection
            : await target.retype(editingConnection.id, type);

        if (updated !== editingConnection) {
          onConnectionChanged?.(updated);
        }

        setBusy(false);
        onClose();
      } catch {
        setBusy(false);
        setError(CONNECTION_PICKER_SAVE_ERROR);
      }

      return;
    }

    if (targetId === null) {
      setError(CONNECTION_PICKER_TARGET_ERROR);
      const firstTarget =
        targetGroupRef.current?.querySelector<HTMLInputElement>('input:not([disabled])');
      (firstTarget ?? searchRef.current)?.focus();
      return;
    }

    const targetCard = cards.find((card) => card.id === targetId);

    if (targetCard === undefined) {
      setError('That target card is no longer in this case. Choose another.');
      return;
    }

    if (type === 'provenance' && !isProvenanceEligible(currentCard.type, targetCard.type)) {
      setError('Provenance needs one Study Note and one Source. Choose a valid target.');
      return;
    }

    setBusy(true);

    try {
      const target = await resolveRepository();
      if (target === null) {
        throw new Error('The connection repository is not open.');
      }

      const existing = findConnectionForPair(connectionsRef.current, currentCard.id, targetCard.id);

      if (existing !== undefined) {
        // An existing pair is never duplicated. Saving updates that row so the
        // ID and the pair stay stable, exactly like the board's type menu.
        const updated = existing.type === type ? existing : await target.retype(existing.id, type);
        onConnectionChanged?.(updated);
      } else {
        const result = await target.create({
          caseId: currentCard.caseId,
          fromCardId: currentCard.id,
          toCardId: targetCard.id,
          type,
        });

        let saved = result.connection;
        if (result.status === 'duplicate' && saved.type !== type) {
          saved = await target.retype(saved.id, type);
        }

        if (result.status === 'duplicate') {
          onConnectionChanged?.(saved);
        } else {
          onConnectionCreated?.(saved);
        }
      }

      setBusy(false);
      onClose();
    } catch {
      setBusy(false);
      setError(CONNECTION_PICKER_SAVE_ERROR);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (busy) {
      return;
    }

    const target = editingConnection;
    if (target === null) {
      setError('That connection is no longer in this case.');
      setConfirmingDelete(false);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const connectionRepository = await resolveRepository();
      if (connectionRepository === null) {
        throw new Error('The connection repository is not open.');
      }

      await connectionRepository.delete(target.id);
      onConnectionDeleted?.(target);
      setBusy(false);
      onClose();
    } catch {
      setBusy(false);
      setError(CONNECTION_PICKER_DELETE_ERROR);
    }
  };

  const dialogTitle =
    editingConnection !== null
      ? 'Manage connection'
      : intent === 'attach-source'
        ? 'Attach a source'
        : 'Connect to a card';

  const dialogDescription =
    editingConnection !== null
      ? 'Change this connection’s type or remove it. Retyping keeps the same connection and pair.'
      : intent === 'attach-source'
        ? 'Choose the Source this note came from. The link is saved as provenance between the Study Note and that Source.'
        : 'Choose one card and the thread type. Association connects any two distinct cards; provenance connects one Study Note and one Source.';

  const actions =
    editingConnection !== null && confirmingDelete ? (
      <>
        <Button
          ref={keepConnectionRef}
          variant="quiet"
          onClick={() => setConfirmingDelete(false)}
          disabled={busy}
        >
          Keep connection
        </Button>
        <Button variant="danger" onClick={() => void handleDelete()} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete connection'}
        </Button>
      </>
    ) : (
      <>
        <Button variant="quiet" onClick={requestClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void handleSave()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      title={dialogTitle}
      description={dialogDescription}
      size="md"
      dismissible={!busy}
      closeOnBackdrop={!busy}
      className="connection-picker"
      actions={actions}
    >
      {editingConnection === null ? (
        <>
          {intent === 'attach-source' ? (
            <p className="connection-picker__note">
              Showing Sources for this Study Note. Save adds a provenance string.
            </p>
          ) : null}

          <Field
            label="Find a target card"
            hint="Type part of a card title to narrow the list."
            id={`${idBase}-search`}
          >
            {(control) => (
              <input
                {...control}
                ref={searchRef}
                type="search"
                value={search}
                autoComplete="off"
                onChange={(event) => {
                  setSearch(event.currentTarget.value);
                  setError(null);
                }}
              />
            )}
          </Field>

          <fieldset ref={typeGroupRef} className="connection-picker__types" disabled={busy}>
            <legend className="connection-picker__legend">Thread type</legend>

            <div className="connection-picker__option">
              <input
                id={`${idBase}-association`}
                className="connection-picker__radio"
                type="radio"
                name={`${idBase}-type`}
                value="association"
                checked={type === 'association'}
                aria-label="Association"
                onChange={() => handleTypeChange('association')}
              />
              <label className="connection-picker__label" htmlFor={`${idBase}-association`}>
                <strong>Association</strong>
                <span className="connection-picker__hint">
                  Solid red thread between any two distinct cards
                </span>
              </label>
            </div>

            <div className="connection-picker__option">
              <input
                id={`${idBase}-provenance`}
                className="connection-picker__radio"
                type="radio"
                name={`${idBase}-type`}
                value="provenance"
                checked={type === 'provenance'}
                disabled={!provenanceAllowed}
                aria-label="Provenance"
                aria-describedby={provenanceReasonId}
                onChange={() => handleTypeChange('provenance')}
              />
              <label className="connection-picker__label" htmlFor={`${idBase}-provenance`}>
                <strong>Provenance</strong>
                <span className="connection-picker__hint">
                  Thin dashed amber thread from a Study Note to a Source
                </span>
              </label>
            </div>
          </fieldset>

          <p
            id={provenanceReasonId}
            className="connection-picker__reason"
            data-eligible={provenancePossible ? 'true' : 'false'}
          >
            {provenanceReason}
          </p>

          <fieldset
            ref={targetGroupRef}
            className="connection-picker__targets"
            disabled={busy}
            aria-describedby={targetCountId}
          >
            <legend className="connection-picker__legend">Target card</legend>
            <p
              id={targetCountId}
              className="connection-picker__count"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {targetCount}
            </p>

            {visibleTargets.length === 0 ? (
              <p className="connection-picker__empty">
                {normalizedSearch.length > 0
                  ? 'Clear the search or type a different card title.'
                  : type === 'provenance'
                    ? 'No card in this case can be a provenance target yet.'
                    : 'This case has no other cards to connect.'}
              </p>
            ) : (
              <ul className="connection-picker__target-list">
                {visibleTargets.map((card) => {
                  const existing = findConnectionForPair(connections, currentCard.id, card.id);
                  const detailId = `${idBase}-target-${card.id}-detail`;

                  return (
                    <li key={card.id} className="connection-picker__target-option">
                      <input
                        id={`${idBase}-target-${card.id}`}
                        className="connection-picker__radio"
                        type="radio"
                        name={`${idBase}-target`}
                        value={card.id}
                        checked={targetId === card.id}
                        aria-label={card.title}
                        aria-describedby={detailId}
                        onChange={() => {
                          setTargetId(card.id);
                          setError(null);
                        }}
                      />
                      <label
                        className="connection-picker__target-label"
                        htmlFor={`${idBase}-target-${card.id}`}
                      >
                        <span className="connection-picker__target-title">{card.title}</span>
                        <span id={detailId} className="connection-picker__target-detail">
                          {CARD_TYPE_LABELS[card.type]}
                          {existing !== undefined
                            ? ` · Already connected as ${connectionTypeLabel(existing.type)}. Saving updates that connection.`
                            : ''}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

          {existingConnections.length > 0 ? (
            <section className="connection-picker__existing" aria-labelledby={existingTitleId}>
              <h3 id={existingTitleId} className="connection-picker__existing-title">
                Existing connections
              </h3>
              <ul className="connection-picker__existing-list">
                {existingConnections.map(({ connection, other }) => (
                  <li key={connection.id} className="connection-picker__existing-item">
                    <span>
                      {connectionTypeLabel(connection.type)} with “{other.title}”
                    </span>
                    <Button
                      className="connection-picker__existing-action"
                      variant="quiet"
                      aria-label={`Edit connection with ${other.title}`}
                      onClick={() => startEditing(connection)}
                      disabled={busy}
                    >
                      Edit connection
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <p className="connection-picker__summary">
            “{currentCard.title}” and “{editingOther?.title ?? 'Unknown card'}”
          </p>

          {editingOther === null ? (
            <p className="connection-picker__error" role="alert">
              The other card is no longer in this case. Close this dialog and choose another
              connection.
            </p>
          ) : null}

          <fieldset ref={typeGroupRef} className="connection-picker__types" disabled={busy}>
            <legend className="connection-picker__legend">Thread type</legend>

            <div className="connection-picker__option">
              <input
                id={`${idBase}-edit-association`}
                className="connection-picker__radio"
                type="radio"
                name={`${idBase}-edit-type`}
                value="association"
                checked={type === 'association'}
                aria-label="Association"
                onChange={() => handleTypeChange('association')}
              />
              <label className="connection-picker__label" htmlFor={`${idBase}-edit-association`}>
                <strong>Association</strong>
                <span className="connection-picker__hint">
                  Solid red thread between any two distinct cards
                </span>
              </label>
            </div>

            <div className="connection-picker__option">
              <input
                id={`${idBase}-edit-provenance`}
                className="connection-picker__radio"
                type="radio"
                name={`${idBase}-edit-type`}
                value="provenance"
                checked={type === 'provenance'}
                disabled={
                  editingOther === null ||
                  !isProvenanceEligible(currentCard.type, editingOther.type)
                }
                aria-label="Provenance"
                onChange={() => handleTypeChange('provenance')}
              />
              <label className="connection-picker__label" htmlFor={`${idBase}-edit-provenance`}>
                <strong>Provenance</strong>
                <span className="connection-picker__hint">
                  Thin dashed amber thread from a Study Note to a Source
                </span>
              </label>
            </div>
          </fieldset>

          {!confirmingDelete ? (
            <div className="connection-picker__edit-actions">
              <Button variant="quiet" onClick={stopEditing} disabled={busy}>
                Back to targets
              </Button>
              <Button
                ref={deleteTriggerRef}
                variant="danger"
                onClick={() => {
                  setError(null);
                  setConfirmingDelete(true);
                }}
                disabled={busy || editingOther === null}
              >
                Delete connection
              </Button>
            </div>
          ) : (
            <p className="connection-picker__confirm">
              Delete the {connectionTypeLabel(editingConnection.type)} connection between “
              {currentCard.title}” and “{editingOther?.title ?? 'the other card'}”? Both cards stay
              on the board.
            </p>
          )}
        </>
      )}

      <p
        className={error === null ? 'visually-hidden' : 'connection-picker__error'}
        role="alert"
        aria-atomic="true"
      >
        {error ?? ''}
      </p>
    </Dialog>
  );
}
