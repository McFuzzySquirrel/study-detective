/**
 * The recall route.
 *
 * Recall is a read-only investigation of the student's own case:
 *
 * - The case, cards, and strings are read through the injected repository, the
 *   same plain data boundary the board uses. Nothing in this file writes.
 * - The canvas receives the cards but no truth strings. A separate neutral
 *   scratch layer draws the student's undirected pairs from the in-memory
 *   `recallStore`.
 * - The camera is fitted in memory with `applyTemporaryViewport`; recall never
 *   schedules a viewport write.
 * - Exit, browser back, reload, and route change discard the scratch layer.
 *   Only the in-app Exit action asks before discarding non-empty scratch.
 *
 * Check computes the pure comparison and exposes its counts as data attributes
 * for the next task's accessible results panel. It deliberately renders no
 * results list here.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { boardStore } from '../../board/boardStore';
import type { BoardStoreApi } from '../../board/boardStore';
import type { BoardCardImage, BoardSnapshot, BoardStringConnection } from '../../board/BoardScene';
import { fitViewportToCards, type BoardSize } from '../../board/viewport';
import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import Toast from '../../components/Toast';
import type { ToastTone } from '../../components/Toast';
import { CaseRepository } from '../../data/caseRepository';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import { openNotesDetectiveDatabase } from '../../data/db';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../domain/model';

import { compareConnections } from './compareConnections';
import type { RecallComparison } from './compareConnections';
import { recallStore } from './recallStore';
import type { RecallStoreApi } from './recallStore';
import RecallToolbar from './RecallToolbar';
import { useScratchConnections } from './useScratchConnections';

import './recall.css';

const BoardCanvas = lazy(() =>
  import('../../board/BoardCanvas').then((module) => ({ default: module.BoardCanvas })),
);

export type RecallRepositoryLoader = () => Promise<CaseRepositoryPort>;

export interface RecallPageProps {
  /** Injected repository for route composition and component tests. */
  readonly repository?: CaseRepositoryPort | undefined;
  /** Injected opener used by the route table and failure-state tests. */
  readonly loadRepository?: RecallRepositoryLoader | undefined;
  /** Injected board store for tests and future multi-board screens. */
  readonly store?: BoardStoreApi | undefined;
  /** Injected scratch store so a test can assert the discard lifecycle. */
  readonly scratchStore?: RecallStoreApi | undefined;
}

type LoadStatus = 'loading' | 'ready' | 'missing' | 'error';

interface RecallFeedback {
  readonly message: string;
  readonly tone: ToastTone;
}

const EMPTY_CARD_IMAGES: Record<string, BoardCardImage> = Object.freeze({});

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

function cardSnapshot(
  card: CardRecord,
  image: BoardCardImage | undefined,
): BoardSnapshot['cards'][number] {
  const snapshot = {
    id: card.id,
    title: card.title,
    type: card.type,
    position: { x: card.position.x, y: card.position.y },
  };

  return image === undefined ? snapshot : { ...snapshot, image };
}

function readStageSize(element: HTMLElement | null): BoardSize {
  const rect = element?.getBoundingClientRect();
  const windowWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const windowHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const width = rect !== undefined && rect.width > 0 ? rect.width : windowWidth;
  const height = rect !== undefined && rect.height > 0 ? rect.height : windowHeight;

  return {
    width: Number.isFinite(width) && width > 0 ? width : 1024,
    height: Number.isFinite(height) && height > 0 ? height : 768,
  };
}

function scratchSnapshot(connection: {
  readonly id: string;
  readonly fromCardId: string;
  readonly toCardId: string;
}): BoardStringConnection {
  return {
    id: connection.id,
    fromCardId: connection.fromCardId,
    toCardId: connection.toCardId,
    type: 'association',
  };
}

/** The routed, non-persistent recall screen. */
export function RecallPage({ repository, loadRepository, store, scratchStore }: RecallPageProps) {
  const { caseId: caseIdParam } = useParams();
  const caseId = caseIdParam ?? '';
  const navigate = useNavigate();
  const activeStore = store ?? boardStore;
  const activeScratchStore = scratchStore ?? recallStore;
  const scratch = useScratchConnections({ store: activeScratchStore });

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeRepository, setActiveRepository] = useState<CaseRepositoryPort | null>(null);
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [cardImageState, setCardImageState] = useState<{
    readonly key: string;
    readonly images: Record<string, BoardCardImage>;
  }>({ key: '', images: {} });
  const [checked, setChecked] = useState(false);
  const [comparison, setComparison] = useState<RecallComparison | null>(null);
  const [feedback, setFeedback] = useState<RecallFeedback | null>(null);
  const [exitOpen, setExitOpen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fittedKeyRef = useRef<string | null>(null);

  const invalidAddress = caseId.length === 0;
  const visibleStatus: LoadStatus = invalidAddress ? 'missing' : status;

  const resolveRepository = useCallback<RecallRepositoryLoader>(() => {
    if (repository !== undefined) {
      return Promise.resolve(repository);
    }
    return (loadRepository ?? loadDefaultRepository)();
  }, [repository, loadRepository]);

  // A recall mount is a fresh read-only camera. Hydrating the stored viewport
  // first keeps the fit honest: the temporary fit below is the only camera the
  // student sees, and leaving recall restores the saved board camera.
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

        activeStore.getState().resetBoard(record.viewport);
        activeStore.getState().setMode('recall');

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
            'Recall could not read this case from local storage. Nothing on the case was changed.',
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

  // Entering recall sets the board mode; leaving for any reason discards every
  // scratch trace and returns the shared store to browse. This covers Exit,
  // browser back, a route change, and a reload (which starts a fresh module).
  useEffect(() => {
    activeStore.getState().setMode('recall');

    return () => {
      activeStore.getState().setMode('browse');
      activeStore.getState().resetGesture();
      activeScratchStore.getState().resetOnExit();
    };
  }, [activeScratchStore, activeStore]);

  const cardIdsKey = useMemo(() => cards.map((card) => card.id).join('|'), [cards]);
  const cardImages = cardImageState.key === cardIdsKey ? cardImageState.images : EMPTY_CARD_IMAGES;

  // Images are read-only attachments. Object URLs are owned by this page and
  // revoked on unmount, case switch, or a failed load.
  useEffect(() => {
    if (visibleStatus !== 'ready' || activeRepository === null || cardIdsKey.length === 0) {
      return;
    }

    const ids = cardIdsKey.split('|');
    const repository = activeRepository;
    const urls: string[] = [];
    let cancelled = false;

    const createUrl = (blob: Blob): string | null => {
      if (typeof URL.createObjectURL !== 'function') {
        return null;
      }
      try {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return url;
      } catch {
        return null;
      }
    };

    const load = async (): Promise<void> => {
      const entries = await Promise.all(
        ids.map(async (id): Promise<[string, BoardCardImage] | null> => {
          try {
            const attachments = await repository.listAttachments(id);
            const displayAttachment =
              attachments.find((attachment) => attachment.kind === 'display') ??
              attachments.find((attachment) => attachment.kind === 'original') ??
              null;
            const thumbnailAttachment =
              attachments.find((attachment) => attachment.kind === 'thumbnail') ??
              displayAttachment;

            const thumbnailUrl =
              thumbnailAttachment !== null ? createUrl(thumbnailAttachment.blob) : null;
            const displayUrl =
              displayAttachment === null
                ? null
                : displayAttachment === thumbnailAttachment
                  ? thumbnailUrl
                  : createUrl(displayAttachment.blob);

            if (thumbnailUrl === null && displayUrl === null) {
              return null;
            }

            const image: {
              thumbnailUrl?: string;
              displayUrl?: string;
              width?: number;
              height?: number;
            } = {};

            if (thumbnailUrl !== null) {
              image.thumbnailUrl = thumbnailUrl;
            }
            if (displayUrl !== null) {
              image.displayUrl = displayUrl;
            }
            if (displayAttachment !== null) {
              image.width = displayAttachment.width;
              image.height = displayAttachment.height;
            }

            return [id, image];
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) {
        for (const url of urls) {
          URL.revokeObjectURL(url);
        }
        return;
      }

      setCardImageState({
        key: cardIdsKey,
        images: Object.fromEntries(entries.filter((entry) => entry !== null)),
      });
    };

    void load();

    return () => {
      cancelled = true;
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [activeRepository, cardIdsKey, visibleStatus]);

  // Fit the case to the available stage in memory. `applyTemporaryViewport`
  // leaves `storedViewport` and the dirty flag untouched, so recall can never
  // overwrite the camera the student left on the case board.
  useEffect(() => {
    if (visibleStatus !== 'ready' || cards.length === 0) {
      return;
    }

    const fitKey = `${caseId}:${cardIdsKey}`;
    if (fittedKeyRef.current === fitKey) {
      return;
    }

    const next = fitViewportToCards(
      cards.map((card) => card.position),
      readStageSize(stageRef.current),
    );

    fittedKeyRef.current = fitKey;
    activeStore.getState().applyTemporaryViewport(next);
  }, [activeStore, cardIdsKey, cards, caseId, visibleStatus]);

  const snapshot = useMemo<BoardSnapshot>(
    () => ({
      caseId,
      caseTitle: caseRecord?.title ?? '',
      cards: cards.map((card) => cardSnapshot(card, cardImages[card.id])),
      // Truth strings stay in page state for Check, but never reach the canvas.
      connections: [],
      scratchConnections: scratch.scratchConnections.map(scratchSnapshot),
    }),
    [cardImages, cards, caseId, caseRecord, scratch.scratchConnections],
  );

  const afterScratchChange = useCallback((): void => {
    setChecked(false);
    setComparison(null);
  }, []);

  const handleScratchDrop = useCallback(
    (drop: { readonly fromCardId: string; readonly toCardId: string | null }): void => {
      if (drop.toCardId === null) {
        setFeedback({
          message:
            'Drop the thread on another card to draw a scratch connection. Nothing was drawn.',
          tone: 'info',
        });
        return;
      }

      if (drop.toCardId === drop.fromCardId) {
        setFeedback({
          message: 'A card cannot link to itself. Drop the thread on a different card.',
          tone: 'info',
        });
        return;
      }

      const result = scratch.addScratchPair(drop.fromCardId, drop.toCardId);
      afterScratchChange();

      if (result.status === 'created') {
        setFeedback({ message: 'Scratch connection drawn. It is not saved.', tone: 'success' });
      } else if (result.status === 'duplicate') {
        setFeedback({
          message: 'Those two cards already have a scratch connection.',
          tone: 'info',
        });
      } else {
        setFeedback({ message: 'That scratch connection could not be drawn.', tone: 'error' });
      }
    },
    [afterScratchChange, scratch],
  );

  const handleRemoveScratch = useCallback(
    (connectionId: string): void => {
      const removed = scratch.removeScratch(connectionId);
      afterScratchChange();
      if (removed) {
        setFeedback({ message: 'Scratch connection removed.', tone: 'info' });
      }
    },
    [afterScratchChange, scratch],
  );

  const handleCheck = useCallback((): void => {
    const result = compareConnections(connections, scratch.scratchConnections);
    setComparison(result);
    setChecked(true);
    setFeedback({
      message: 'Check complete. Recall has not changed the case.',
      tone: 'info',
    });
  }, [connections, scratch.scratchConnections]);

  const handleReset = useCallback((): void => {
    scratch.resetScratch();
    afterScratchChange();
    setFeedback({ message: 'Scratch cleared. You are still in recall.', tone: 'info' });
  }, [afterScratchChange, scratch]);

  const finishExit = useCallback((): void => {
    scratch.resetOnExit();
    setExitOpen(false);
    const target = `/case/${caseId}`;
    navigate(target);
  }, [caseId, navigate, scratch]);

  const handleExit = useCallback((): void => {
    if (scratch.hasScratch) {
      setExitOpen(true);
      return;
    }

    finishExit();
  }, [finishExit, scratch.hasScratch]);

  const retry = (): void => {
    setLoadError(null);
    setStatus('loading');
    setReloadToken((token) => token + 1);
  };

  const scratchCount = scratch.scratchConnections.length;
  const rememberedCount = comparison?.remembered.length ?? 0;
  const missedCount = comparison?.missed.length ?? 0;
  const extraCount = comparison?.extra.length ?? 0;
  const typeMismatchCount = comparison?.typeMismatch.length ?? 0;

  return (
    <section
      className="recall-page"
      aria-labelledby="recall-page-title"
      aria-busy={visibleStatus === 'loading'}
      data-testid="recall-page"
      data-case-id={caseId}
      data-recall-status={visibleStatus}
      data-recall-scratch-count={scratchCount}
      data-recall-checked={checked ? 'true' : 'false'}
      data-recall-remembered-count={rememberedCount}
      data-recall-missed-count={missedCount}
      data-recall-extra-count={extraCount}
      data-recall-type-mismatch-count={typeMismatchCount}
    >
      <Toast
        message={feedback?.message ?? null}
        tone={feedback?.tone ?? 'info'}
        onDismiss={() => setFeedback(null)}
        dismissLabel="Dismiss recall message"
      />

      <header className="recall-page__header">
        <div className="recall-page__heading">
          <p className="recall-page__eyebrow">
            {caseRecord !== null ? caseRecord.title : 'Case file'}
          </p>
          <h2 id="recall-page-title" ref={headingRef} className="recall-page__title" tabIndex={-1}>
            Recall
          </h2>
          <p className="recall-page__summary">
            The strings are hidden, but every card title, image, and position stays. Rebuild the
            connections from memory, then check your work. Nothing drawn here is saved.
          </p>
        </div>

        <div className="recall-page__actions">
          <Link className="recall-page__nav-link" to={`/case/${caseId}`}>
            Back to case board
          </Link>
        </div>
      </header>

      {visibleStatus === 'ready' && cards.length > 0 ? (
        <RecallToolbar
          scratchConnections={scratch.scratchConnections}
          cards={cards}
          checked={checked}
          onCheck={handleCheck}
          onReset={handleReset}
          onExit={handleExit}
          onRemove={handleRemoveScratch}
        />
      ) : null}

      <div className="recall-page__stage" ref={stageRef}>
        {visibleStatus === 'loading' ? (
          <p className="recall-page__status" role="status">
            Opening the recall board…
          </p>
        ) : null}

        {visibleStatus === 'error' ? (
          <section className="recall-page__error" role="alert" aria-labelledby="recall-load-error">
            <h3 id="recall-load-error">Recall could not open</h3>
            <p>{loadError}</p>
            <div className="recall-page__error-actions">
              <Button variant="primary" onClick={retry}>
                Retry
              </Button>
              <Link className="recall-page__text-link" to={`/case/${caseId}`}>
                Back to case board
              </Link>
            </div>
          </section>
        ) : null}

        {visibleStatus === 'missing' ? (
          <section
            className="recall-page__error"
            role="alert"
            aria-labelledby="recall-missing-title"
          >
            <h3 id="recall-missing-title">Case not found</h3>
            <p>
              This case is not in local storage. It may have been deleted, or the address may be
              incomplete.
            </p>
            <div className="recall-page__error-actions">
              <Link className="recall-page__text-link" to="/">
                Back to case shelf
              </Link>
            </div>
          </section>
        ) : null}

        {visibleStatus === 'ready' && cards.length === 0 ? (
          <section className="recall-page__empty" aria-labelledby="recall-empty-title">
            <h3 id="recall-empty-title">Nothing to recall yet</h3>
            <p>Add a card to this case first. Recall hides strings, not the cards themselves.</p>
            <Link className="nd-button nd-button--primary nd-button--lg" to={`/case/${caseId}`}>
              Back to case board
            </Link>
          </section>
        ) : null}

        {visibleStatus === 'ready' && cards.length > 0 ? (
          <Suspense
            fallback={
              <p className="recall-page__status" role="status">
                Preparing the recall canvas…
              </p>
            }
          >
            <BoardCanvas
              snapshot={snapshot}
              store={activeStore}
              mode="recall"
              scratchConnections={snapshot.scratchConnections}
              onScratchDrop={handleScratchDrop}
            />
          </Suspense>
        ) : null}
      </div>

      <Dialog
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Exit recall?"
        description="Your scratch connections will be discarded. The case cards, images, and saved strings will not change."
        actions={
          <>
            <Button variant="secondary" onClick={() => setExitOpen(false)}>
              Keep practising
            </Button>
            <Button variant="danger" onClick={finishExit}>
              Discard and exit
            </Button>
          </>
        }
      />
    </section>
  );
}

export default RecallPage;
