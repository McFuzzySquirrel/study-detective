/**
 * The keyboard card-list route: the text alternative to the Pixi canvas.
 *
 * Every non-spatial action lives here — create, edit, open, delete, and undo —
 * while placement and panning stay on the board. The page owns repository
 * reads and the delete confirmation; `useUndoDelete` owns the single 8-second
 * snapshot, and neither this file nor the panel opens Dexie.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import Field from '../../components/Field';
import Toast from '../../components/Toast';
import type { ToastTone } from '../../components/Toast';
import { CaseRepository } from '../../data/caseRepository';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import { openNotesDetectiveDatabase } from '../../data/db';
import { readCardDeletionPreview } from '../../data/deleteCard';
import type { CardDeletionPreview, CardDeletionSnapshot } from '../../data/deleteCard';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../domain/model';
import { TITLE_MAX_LENGTH } from '../../domain/model';

import CardListPanel from './CardListPanel';
import EmptyBoard from './EmptyBoard';
import { useUndoDelete } from './useUndoDelete';

import './CardListPage.css';

export type CardListRepositoryLoader = () => Promise<CaseRepositoryPort>;

export interface CardListPageProps {
  /** Injected repository for route composition and component tests. */
  readonly repository?: CaseRepositoryPort | undefined;
  /** Injected opener used by the route table and failure-state tests. */
  readonly loadRepository?: CardListRepositoryLoader | undefined;
}

type LoadStatus = 'loading' | 'ready' | 'missing' | 'error';

type Feedback = {
  readonly message: string;
  readonly tone: ToastTone;
};

let defaultRepositoryPromise: Promise<CaseRepositoryPort> | null = null;

/** Open the one production repository, forgetting a failed open so Retry works. */
function loadDefaultRepository(): Promise<CaseRepositoryPort> {
  if (defaultRepositoryPromise === null) {
    defaultRepositoryPromise = openNotesDetectiveDatabase()
      .then((database) => new CaseRepository(database))
      .catch((error: unknown) => {
        defaultRepositoryPromise = null;
        throw error;
      });
  }

  return defaultRepositoryPromise;
}

function compareCards(a: CardRecord, b: CardRecord): number {
  const byCreatedAt = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return byCreatedAt !== 0 ? byCreatedAt : a.id.localeCompare(b.id);
}

function mergeConnections(
  current: readonly ConnectionRecord[],
  restored: readonly ConnectionRecord[],
): ConnectionRecord[] {
  const byId = new Map(current.map((connection) => [connection.id, connection] as const));
  for (const connection of restored) {
    byId.set(connection.id, connection);
  }
  return [...byId.values()].sort((a, b) => a.pairKey.localeCompare(b.pairKey));
}

function cardCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

function itemCountLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

interface CardEditDialogProps {
  readonly card: CardRecord;
  readonly onClose: () => void;
  readonly onSubmit: (title: string) => Promise<void>;
}

/** Title-only edit. The type, photo, position, and strings are not changed. */
function CardEditDialog({ card, onClose, onSubmit }: CardEditDialogProps) {
  const [title, setTitle] = useState(card.title);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (saving) {
      return;
    }

    const trimmed = title.trim();

    if (trimmed.length === 0) {
      setError('Enter a card title.');
      inputRef.current?.focus();
      return;
    }

    if (trimmed.length > TITLE_MAX_LENGTH) {
      setError(`Card titles can be at most ${TITLE_MAX_LENGTH} characters.`);
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setFormError(null);
    setSaving(true);

    try {
      await onSubmit(trimmed);
    } catch {
      setFormError('The title could not be saved. Your text is still here; try again.');
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit card title"
      description="The title appears in this list and on the board. The card type, photo, position, and strings do not change."
      dismissible={!saving}
      closeOnBackdrop={!saving}
    >
      <form className="card-list-form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Card title"
          hint={`1 to ${TITLE_MAX_LENGTH} characters.`}
          error={error}
          required
        >
          {(control) => (
            <input
              {...control}
              ref={inputRef}
              type="text"
              name="title"
              value={title}
              autoComplete="off"
              maxLength={TITLE_MAX_LENGTH}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setError(null);
                setFormError(null);
              }}
            />
          )}
        </Field>

        {formError !== null ? (
          <p className="card-list-form__error" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="nd-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save title'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface DeleteCardDialogProps {
  readonly preview: CardDeletionPreview;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<void>;
}

/**
 * Destructive confirmation. It names the card and the exact number of strings
 * the cascade will remove, focuses Cancel first, and leaves Escape working.
 */
function DeleteCardDialog({ preview, onClose, onConfirm }: DeleteCardDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const strings = `${preview.stringCount} ${preview.stringCount === 1 ? 'string' : 'strings'}`;
  const photos = preview.attachmentCount === 0 ? '' : 'Its photo files are removed too. ';

  const handleConfirm = async (): Promise<void> => {
    if (deleting) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      await onConfirm();
    } catch {
      setError('The card could not be deleted. Nothing was removed; try again.');
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete “${preview.title}”?`}
      description={`This removes the card and ${strings} attached to it. ${photos}Undo stays available for 8 seconds after deletion.`}
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
            {deleting ? 'Deleting…' : 'Delete card'}
          </Button>
        </>
      }
    >
      {error !== null ? (
        <p className="card-list-form__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

/** The routed text view for one case; every action except placement is here. */
export function CardListPage({ repository, loadRepository }: CardListPageProps) {
  const { caseId: caseIdParam } = useParams();
  const caseId = caseIdParam ?? '';
  const boardPath = `/case/${caseId}`;

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeRepository, setActiveRepository] = useState<CaseRepositoryPort | null>(null);
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [editing, setEditing] = useState<CardRecord | null>(null);
  const [deletePreview, setDeletePreview] = useState<CardDeletionPreview | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterDeleteRef = useRef(false);
  const focusAfterRestoreRef = useRef<string | null>(null);

  const resolveRepository = useCallback<CardListRepositoryLoader>(() => {
    if (repository !== undefined) {
      return Promise.resolve(repository);
    }
    return (loadRepository ?? loadDefaultRepository)();
  }, [repository, loadRepository]);

  const handleDeleted = useCallback((snapshot: CardDeletionSnapshot): void => {
    const cardId = snapshot.card.id;
    setCards((current) => current.filter((card) => card.id !== cardId));
    setConnections((current) =>
      current.filter(
        (connection) => connection.fromCardId !== cardId && connection.toCardId !== cardId,
      ),
    );
    setFeedback(null);
    setUndoError(null);
  }, []);

  const handleRestored = useCallback((snapshot: CardDeletionSnapshot): void => {
    setCards((current) =>
      [...current.filter((card) => card.id !== snapshot.card.id), snapshot.card].sort(compareCards),
    );
    setConnections((current) => mergeConnections(current, snapshot.connections));
    setUndoError(null);
    focusAfterRestoreRef.current = snapshot.card.id;
    setFeedback({
      message: `Card restored: “${snapshot.card.title}”. Its strings and photo files are back.`,
      tone: 'success',
    });
  }, []);

  const undoDelete = useUndoDelete({
    repository: activeRepository,
    onDeleted: handleDeleted,
    onRestored: handleRestored,
  });

  const invalidAddress = caseId.length === 0;
  const visibleStatus: LoadStatus = invalidAddress ? 'missing' : status;

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      if (invalidAddress) {
        return;
      }

      try {
        const target = await resolveRepository();
        const record = await target.getCase(caseId);

        if (cancelled) {
          return;
        }

        if (record === null) {
          setActiveRepository(target);
          setStatus('missing');
          return;
        }

        const [storedCards, storedConnections] = await Promise.all([
          target.listCards(caseId),
          target.listConnections(caseId),
        ]);
        if (cancelled) {
          return;
        }

        setActiveRepository(target);
        setCaseRecord(record);
        setCards(storedCards);
        setConnections(storedConnections);
        setLoadError(null);
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setActiveRepository(null);
          setCaseRecord(null);
          setCards([]);
          setConnections([]);
          setLoadError(
            'The local case database could not be reached. Nothing in this card list was changed.',
          );
          setStatus('error');
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [caseId, invalidAddress, reloadToken, resolveRepository]);

  // After a deletion the row is gone, so land on the list heading. After an
  // undo the restored row's Open detail link is the logical destination.
  useEffect(() => {
    const restoredId = focusAfterRestoreRef.current;
    if (restoredId !== null) {
      focusAfterRestoreRef.current = null;
      document.getElementById(`card-open-${restoredId}`)?.focus();
      return;
    }

    if (focusAfterDeleteRef.current) {
      focusAfterDeleteRef.current = false;
      headingRef.current?.focus();
    }
  }, [cards]);

  const openEdit = (card: CardRecord): void => {
    setFeedback(null);
    setEditing(card);
  };

  const openDelete = (card: CardRecord): void => {
    const target = activeRepository;
    if (target === null) {
      return;
    }

    void readCardDeletionPreview(target, card.id)
      .then((preview) => {
        if (preview === null) {
          setFeedback({
            message: `That card is already gone: ${card.title}.`,
            tone: 'info',
          });
          setReloadToken((token) => token + 1);
          return;
        }
        setFeedback(null);
        setDeletePreview(preview);
      })
      .catch(() => {
        setFeedback({
          message: 'The card contents could not be read. Nothing was deleted.',
          tone: 'error',
        });
      });
  };

  const handleEditSubmit = async (title: string): Promise<void> => {
    const target = activeRepository;
    const current = editing;

    if (target === null || current === null) {
      throw new Error('The case repository is not open.');
    }

    const updated = await target.updateCard(current.id, { title });
    setCards((existing) =>
      existing.map((card) => (card.id === updated.id ? updated : card)).sort(compareCards),
    );
    setEditing(null);
    setFeedback({ message: 'Card title updated.', tone: 'success' });
  };

  const handleDeleteConfirmed = async (): Promise<void> => {
    const preview = deletePreview;

    if (activeRepository === null || preview === null) {
      throw new Error('The case repository is not open.');
    }

    // Set before the repository call: the list can disappear in the same batch
    // that resolves the deletion, and the focus effect must already see this.
    focusAfterDeleteRef.current = true;
    const snapshot = await undoDelete.deleteWithUndo(preview.cardId);

    if (snapshot === null) {
      focusAfterDeleteRef.current = false;
      setDeletePreview(null);
      setFeedback({
        message: `That card was already gone: ${preview.title}.`,
        tone: 'info',
      });
      setReloadToken((token) => token + 1);
      return;
    }

    setDeletePreview(null);
  };

  const handleUndo = (): void => {
    setUndoError(null);
    void undoDelete.undo().catch(() => {
      setUndoError(
        'The card could not be restored. Its snapshot is still held; try Undo again before the window closes.',
      );
    });
  };

  const handleToastDismiss = (): void => {
    setUndoError(null);
    if (undoDelete.pending !== null) {
      undoDelete.dismiss();
      return;
    }
    setFeedback(null);
  };

  const toastMessage =
    undoError ?? (undoDelete.pending !== null ? undoDelete.message : (feedback?.message ?? null));
  const toastTone: ToastTone =
    undoError !== null
      ? 'error'
      : undoDelete.pending !== null
        ? 'info'
        : (feedback?.tone ?? 'info');

  const cardGroups = useMemo(
    () => ({
      note: cards.filter((card) => card.type === 'note').length,
      source: cards.filter((card) => card.type === 'source').length,
      topic: cards.filter((card) => card.type === 'topic').length,
    }),
    [cards],
  );

  const summary =
    visibleStatus === 'ready'
      ? `${cardCountLabel(cards.length)} in text: ${itemCountLabel(cardGroups.note, 'study note', 'study notes')}, ${itemCountLabel(cardGroups.source, 'source', 'sources')}, and ${itemCountLabel(cardGroups.topic, 'topic', 'topics')}. Placement, panning, and zooming stay on the board.`
      : visibleStatus === 'loading'
        ? 'Loading this case and its cards from local storage.'
        : 'This case is not available in local storage.';

  return (
    <section
      className="card-list-page"
      aria-labelledby="card-list-title"
      aria-busy={visibleStatus === 'loading'}
      data-case-id={caseId}
      data-card-list-status={visibleStatus}
    >
      <Toast
        message={toastMessage}
        tone={toastTone}
        onDismiss={handleToastDismiss}
        {...(undoDelete.pending !== null ? { actionLabel: 'Undo', onAction: handleUndo } : {})}
      />

      <header className="card-list-page__header">
        <div className="card-list-page__heading">
          <p className="card-list-page__eyebrow">
            {caseRecord !== null ? caseRecord.title : 'Case file'}
          </p>
          <h2 id="card-list-title" ref={headingRef} className="card-list-page__title" tabIndex={-1}>
            Card list
          </h2>
          <p className="card-list-page__summary">{summary}</p>
        </div>

        <div className="card-list-page__actions">
          <Link className="card-list-page__nav-link" to={boardPath}>
            Back to board
          </Link>
          {visibleStatus === 'ready' && cards.length > 0 ? (
            <>
              <Link
                className="nd-button nd-button--primary nd-button--md"
                to={`/case/${caseId}/capture?kind=note`}
              >
                Add note
              </Link>
              <Link
                className="nd-button nd-button--secondary nd-button--md"
                to={`/case/${caseId}/capture?kind=source`}
              >
                Add source
              </Link>
              <Link
                className="nd-button nd-button--secondary nd-button--md"
                to={`/case/${caseId}/capture?kind=topic`}
              >
                Add topic
              </Link>
            </>
          ) : null}
        </div>
      </header>

      {visibleStatus === 'loading' ? (
        <p className="card-list-page__status" role="status">
          Opening the card list…
        </p>
      ) : null}

      {visibleStatus === 'error' ? (
        <section
          className="card-list-page__error"
          role="alert"
          aria-labelledby="card-list-load-error"
        >
          <h3 id="card-list-load-error">Card list could not open</h3>
          <p>{loadError}</p>
          <div className="card-list-page__error-actions">
            <Button
              variant="primary"
              onClick={() => {
                setLoadError(null);
                setStatus('loading');
                setReloadToken((token) => token + 1);
              }}
            >
              Retry
            </Button>
            <Link className="card-list-page__nav-link" to="/">
              Back to case shelf
            </Link>
          </div>
        </section>
      ) : null}

      {visibleStatus === 'missing' ? (
        <section
          className="card-list-page__error"
          role="alert"
          aria-labelledby="card-list-missing-title"
        >
          <h3 id="card-list-missing-title">Case not found</h3>
          <p>
            This case is no longer in local storage. It may have been deleted, or the address may be
            incomplete.
          </p>
          <div className="card-list-page__error-actions">
            <Link className="card-list-page__nav-link" to="/">
              Back to case shelf
            </Link>
          </div>
        </section>
      ) : null}

      {visibleStatus === 'ready' && cards.length === 0 ? <EmptyBoard caseId={caseId} /> : null}

      {visibleStatus === 'ready' && cards.length > 0 ? (
        <CardListPanel
          cards={cards}
          connections={connections}
          onEdit={openEdit}
          onDelete={openDelete}
        />
      ) : null}

      {editing !== null ? (
        <CardEditDialog
          card={editing}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
        />
      ) : null}

      {deletePreview !== null ? (
        <DeleteCardDialog
          preview={deletePreview}
          onClose={() => setDeletePreview(null)}
          onConfirm={handleDeleteConfirmed}
        />
      ) : null}
    </section>
  );
}

export default CardListPage;
