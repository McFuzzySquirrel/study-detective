/**
 * The case-board route.
 *
 * The page is the composition boundary between repository records and the
 * renderer. It loads one case and its cards, builds a plain `BoardSnapshot`,
 * lazily mounts the Pixi canvas, and owns the 500 ms viewport debounce. It never
 * imports PixiJS, opens Dexie directly, or writes a record itself.
 *
 * Viewport contract:
 *
 * - The stored camera is restored on load with `resetBoard`.
 * - Pan, zoom, and pinch only mark the board store dirty.
 * - This page writes the dirty camera after 500 ms, then calls
 *   `markViewportPersisted` with the exact snapshot that was saved.
 * - "Reset view" uses a temporary camera and never schedules a write.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useStore } from 'zustand';

import { boardStore } from '../../board/boardStore';
import type { BoardStoreApi } from '../../board/boardStore';
import { selectViewport, selectViewportDirty } from '../../board/boardStore';
import type { BoardSnapshot } from '../../board/BoardScene';
import Button from '../../components/Button';
import Toast from '../../components/Toast';
import { CaseRepository } from '../../data/caseRepository';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import { openNotesDetectiveDatabase } from '../../data/db';
import type { CardRecord, CaseRecord } from '../../domain/model';
import BackupDialog from '../backup/BackupDialog';
import { useBackupReminder } from '../backup/useBackupReminder';

import './CaseBoardPage.css';

const BoardCanvas = lazy(() =>
  import('../../board/BoardCanvas').then((module) => ({ default: module.BoardCanvas })),
);

/** The contract's debounce for a camera write. */
export const VIEWPORT_SAVE_DEBOUNCE_MS = 500;

export type CaseBoardRepositoryLoader = () => Promise<CaseRepositoryPort>;

export interface CaseBoardPageProps {
  /** Injected repository for route composition and component tests. */
  readonly repository?: CaseRepositoryPort | undefined;
  /** Injected opener used by the route table and failure-state tests. */
  readonly loadRepository?: CaseBoardRepositoryLoader | undefined;
  /** Injected board store for tests and future multi-board screens. */
  readonly store?: BoardStoreApi | undefined;
}

type LoadStatus = 'loading' | 'ready' | 'missing' | 'error';

let defaultRepositoryPromise: Promise<CaseRepositoryPort> | null = null;

/** Open the one production database handle, forgetting a failed open so Retry works. */
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

function cardSnapshot(card: CardRecord): BoardSnapshot['cards'][number] {
  return {
    id: card.id,
    title: card.title,
    type: card.type,
    position: { x: card.position.x, y: card.position.y },
  };
}

function cardCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

/** The routed case-board screen: repository load, canvas mount, viewport save. */
export function CaseBoardPage({ repository, loadRepository, store }: CaseBoardPageProps) {
  const { caseId: caseIdParam } = useParams();
  const caseId = caseIdParam ?? '';
  const activeStore = store ?? boardStore;

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeRepository, setActiveRepository] = useState<CaseRepositoryPort | null>(null);
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [backupOpen, setBackupOpen] = useState(false);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const viewport = useStore(activeStore, selectViewport);
  const viewportDirty = useStore(activeStore, selectViewportDirty);

  const resolveRepository = useCallback<CaseBoardRepositoryLoader>(() => {
    if (repository !== undefined) {
      return Promise.resolve(repository);
    }
    return (loadRepository ?? loadDefaultRepository)();
  }, [repository, loadRepository]);

  const invalidAddress = caseId.length === 0;
  const visibleStatus: LoadStatus = invalidAddress ? 'missing' : status;
  const reminder = useBackupReminder({
    repository: activeRepository,
    caseId,
    enabled: visibleStatus === 'ready',
  });

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

        const storedCards = await target.listCards(caseId);
        if (cancelled) {
          return;
        }

        // A board mount starts a fresh interaction slice; the persisted camera
        // is restored as the stored and live viewport together.
        activeStore.getState().resetBoard(record.viewport);

        setActiveRepository(target);
        setCaseRecord(record);
        setCards(storedCards);
        setLoadError(null);
        setSaveError(null);
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setActiveRepository(null);
          setCaseRecord(null);
          setCards([]);
          setLoadError(
            'The local case database could not be reached. Nothing on this board was changed.',
          );
          setStatus('error');
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeStore, caseId, invalidAddress, reloadToken, resolveRepository]);

  // Drop any in-flight gesture when the route leaves. Selection is local UI
  // state and is deliberately not persisted.
  useEffect(
    () => () => {
      activeStore.getState().resetGesture();
    },
    [activeStore],
  );

  // Debounced camera persistence. The exact viewport handed to the repository
  // is also handed to markViewportPersisted, so a movement during the async
  // save leaves the camera dirty for the next write.
  useEffect(() => {
    if (visibleStatus !== 'ready' || activeRepository === null || !viewportDirty) {
      return;
    }

    const target = activeRepository;
    const savedViewport = viewport;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      // Serialise writes so a slow earlier save can never land after a newer
      // one. A cancelled pass (route change, unmount, newer movement) skips its
      // write entirely when it has not started yet.
      saveChainRef.current = saveChainRef.current.then(async () => {
        if (cancelled) {
          return;
        }

        try {
          await target.saveViewport(caseId, savedViewport);
          if (cancelled) {
            return;
          }
          activeStore.getState().markViewportPersisted(savedViewport);
          setSaveError(null);
        } catch {
          if (!cancelled) {
            setSaveError(
              'The board position could not be saved. Your cards are safe; move the board again to retry.',
            );
          }
        }
      });
    }, VIEWPORT_SAVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRepository, activeStore, caseId, viewport, viewportDirty, visibleStatus]);

  const snapshot = useMemo<BoardSnapshot>(
    () => ({
      caseId,
      caseTitle: caseRecord?.title ?? '',
      cards: cards.map(cardSnapshot),
    }),
    [cards, caseId, caseRecord],
  );

  const retryLoad = (): void => {
    setLoadError(null);
    setStatus('loading');
    setReloadToken((token) => token + 1);
  };

  return (
    <section
      className="case-board-page"
      aria-labelledby="case-board-page-title"
      aria-busy={visibleStatus === 'loading'}
      data-case-id={caseId}
      data-board-status={visibleStatus}
    >
      <Toast
        message={saveError}
        tone="error"
        onDismiss={() => setSaveError(null)}
        dismissLabel="Dismiss board save error"
      />

      <header className="case-board-page__header">
        <div className="case-board-page__heading">
          <p className="case-board-page__eyebrow">
            {caseRecord !== null ? caseRecord.title : 'Case file'}
          </p>
          <h2 id="case-board-page-title" className="case-board-page__title">
            Case board
          </h2>
          <p className="case-board-page__summary">
            {visibleStatus === 'ready'
              ? `${cardCountLabel(cards.length)} pinned to the cork. Drag the background to pan; pinch or scroll to zoom.`
              : visibleStatus === 'loading'
                ? 'Loading this case from local storage.'
                : 'This case is not available in local storage.'}
          </p>
        </div>

        <div className="case-board-page__actions">
          <Button
            variant="secondary"
            onClick={() => setBackupOpen(true)}
            disabled={visibleStatus !== 'ready' || activeRepository === null}
          >
            Back up case
          </Button>
          <Link className="case-board-page__back" to="/">
            Back to case shelf
          </Link>
        </div>
      </header>

      {visibleStatus === 'ready' && reminder.visible ? (
        <aside className="backup-reminder" aria-labelledby="backup-reminder-title">
          <p className="visually-hidden" role="status">
            This case is ready for its first backup.
          </p>
          <div className="backup-reminder__copy">
            <h3 id="backup-reminder-title">This case is worth backing up</h3>
            <p>
              Five cards and at least one connection is a good moment to keep a copy outside this
              browser. Backups are a single file and are never uploaded.
            </p>
            {reminder.error !== null ? (
              <p className="backup-reminder__error" role="alert">
                {reminder.error}
              </p>
            ) : null}
          </div>
          <div className="backup-reminder__actions">
            <Button variant="primary" onClick={() => setBackupOpen(true)}>
              Back up now
            </Button>
            <Button
              variant="quiet"
              onClick={() => void reminder.dismiss()}
              disabled={reminder.saving}
            >
              Not now
            </Button>
          </div>
        </aside>
      ) : null}

      <div className="case-board-page__stage">
        {visibleStatus === 'loading' ? (
          <p className="case-board-page__status" role="status">
            Opening the case…
          </p>
        ) : null}

        {visibleStatus === 'error' ? (
          <section
            className="case-board-page__error"
            role="alert"
            aria-labelledby="board-load-error"
          >
            <h3 id="board-load-error">Case could not open</h3>
            <p>{loadError}</p>
            <div className="case-board-page__error-actions">
              <Button variant="primary" onClick={retryLoad}>
                Retry
              </Button>
              <Link className="case-board-page__text-link" to="/">
                Back to case shelf
              </Link>
            </div>
          </section>
        ) : null}

        {visibleStatus === 'missing' ? (
          <section
            className="case-board-page__error"
            role="alert"
            aria-labelledby="board-missing-title"
          >
            <h3 id="board-missing-title">Case not found</h3>
            <p>
              This case is no longer in local storage. It may have been deleted, or the address may
              be incomplete.
            </p>
            <div className="case-board-page__error-actions">
              <Link className="case-board-page__text-link" to="/">
                Back to case shelf
              </Link>
            </div>
          </section>
        ) : null}

        {visibleStatus === 'ready' && caseRecord !== null ? (
          <Suspense
            fallback={
              <p className="case-board-page__status" role="status">
                Preparing the board canvas…
              </p>
            }
          >
            <BoardCanvas snapshot={snapshot} store={activeStore} />
          </Suspense>
        ) : null}
      </div>

      {backupOpen && caseRecord !== null && activeRepository !== null ? (
        <BackupDialog
          open
          repository={activeRepository}
          initialView="export"
          exportCaseId={caseRecord.id}
          exportCaseTitle={caseRecord.title}
          onClose={() => setBackupOpen(false)}
          onExported={() => {
            void reminder.complete();
          }}
          onImported={(result) => {
            if (result.caseId === caseId) {
              setReloadToken((token) => token + 1);
            }
          }}
        />
      ) : null}
    </section>
  );
}

export default CaseBoardPage;
