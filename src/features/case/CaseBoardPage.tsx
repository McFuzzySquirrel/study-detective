/**
 * The case-board route.
 *
 * The page is the composition boundary between repository records and the
 * renderer. It loads one case and its cards, builds a plain `BoardSnapshot`,
 * lazily mounts the Pixi canvas, and owns the 500 ms viewport debounce. It never
 * imports PixiJS, opens Dexie directly, or writes a record itself.
 *
 * Frame contract:
 *
 * - The board is the page. A 48 px identity band, an 8 px gap, a 56 px leading
 *   rail, and the stage remainder fill the content area exactly; the phone
 *   composition swaps the rail for a 56 px bottom bar.
 * - Every non-board surface is a Panel (wide, non-modal) or a Dialog sheet
 *   (phone). None of them adds a grid column or changes the stage width.
 * - The page never renders a page-height sibling or an in-flow banner.
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
import type { ReactElement } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useStore } from 'zustand';

import { boardStore } from '../../board/boardStore';
import type { BoardStoreApi } from '../../board/boardStore';
import {
  selectSelectedCardId,
  selectSelectedConnectionId,
  selectViewport,
  selectViewportDirty,
} from '../../board/boardStore';
import { SPLIT_CASE_MESSAGE, boardCapacityLevel, canAddCard } from '../../board/boardCapacity';
import type { BoardCardImage, BoardSnapshot, BoardStringConnection } from '../../board/BoardScene';
import {
  BOARD_CARD_HEIGHT,
  BOARD_CARD_WIDTH,
  normalizeViewport,
  type BoardSize,
} from '../../board/viewport';
import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import Glyph from '../../components/Glyph';
import IconButton from '../../components/IconButton';
import Panel from '../../components/Panel';
import Toast from '../../components/Toast';
import { usePhoneLayout } from '../../app/useLayoutMode';
import { FOCUS_SEARCH_EVENT } from '../../app/focus';
import { motionBehavior, useMotionPreference } from '../../app/motionPreference';
import { CaseRepository } from '../../data/caseRepository';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import { ConnectionRepository } from '../../data/connectionRepository';
import type { ConnectionRepositoryPort } from '../../data/connectionRepository';
import { openNotesDetectiveDatabase } from '../../data/db';
import { deriveCaseLifecycle } from '../../domain/caseLifecycle';
import type {
  AttachmentMime,
  CardRecord,
  CaseRecord,
  ConnectionRecord,
  ConnectionType,
  Viewport,
} from '../../domain/model';
import { deriveReadiness } from '../../domain/readiness';
import BackupDialog from '../backup/BackupDialog';
import { useBackupReminder } from '../backup/useBackupReminder';
import ClosurePanel from '../closure/ClosurePanel';
import { useCaseLifecycle } from '../closure/useCaseLifecycle';
import ConnectionDetail from '../connections/ConnectionDetail';
import ConnectionTypeMenu from '../connections/ConnectionTypeMenu';
import type { ConnectionDropInput } from '../connections/useCreateConnection';
import { useCreateConnection } from '../connections/useCreateConnection';
import { useUndoDeleteConnection } from '../connections/useUndoDeleteConnection';
import HintPopover from '../onboarding/HintPopover';
import { getHint, hintSeenStore, useSeenHints } from '../onboarding/hints';
import type { HintId, HintSeenStore } from '../onboarding/hints';
import SearchPanel from '../search/SearchPanel';
import { hasActiveSearch } from '../search/searchCards';
import type { SearchCriteria } from '../search/searchCards';

import CaseMenu from './CaseMenu';
import EmptyBoard from './EmptyBoard';
import './CaseBoardPage.css';

const BoardCanvas = lazy(() =>
  import('../../board/BoardCanvas').then((module) => ({ default: module.BoardCanvas })),
);

/** The contract's debounce for a camera write. */
export const VIEWPORT_SAVE_DEBOUNCE_MS = 500;

/** The contract's debounce for a completed card drag. */
export const CARD_POSITION_SAVE_DEBOUNCE_MS = 300;

const EMPTY_CARD_IMAGES: Record<string, BoardCardImage> = Object.freeze({});

const EMPTY_SEARCH_CRITERIA: SearchCriteria = Object.freeze({
  query: '',
  type: 'all',
  tags: [],
});

export type CaseBoardRepositoryLoader = () => Promise<CaseRepositoryPort>;
export type CaseBoardConnectionRepositoryLoader = () => Promise<ConnectionRepositoryPort>;

export interface CaseBoardPageProps {
  /** Injected repository for route composition and component tests. */
  readonly repository?: CaseRepositoryPort | undefined;
  /** Injected opener used by the route table and failure-state tests. */
  readonly loadRepository?: CaseBoardRepositoryLoader | undefined;
  /** Injected connection write boundary for tests and composition. */
  readonly connectionRepository?: ConnectionRepositoryPort | undefined;
  /** Lazy connection opener for tests and composition; resolved on first draw. */
  readonly loadConnectionRepository?: CaseBoardConnectionRepositoryLoader | undefined;
  /** Injected board store for tests and future multi-board screens. */
  readonly store?: BoardStoreApi | undefined;
  /** Injected hint seen store for context-trigger tests and composition. */
  readonly hintStore?: HintSeenStore | undefined;
}

type LoadStatus = 'loading' | 'ready' | 'missing' | 'error';

let defaultRepositoryPromise: Promise<CaseRepositoryPort> | null = null;
let defaultConnectionRepositoryPromise: Promise<ConnectionRepositoryPort> | null = null;

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

/**
 * Open the connection repository only when a student draws the first thread.
 * The page still never opens Dexie itself; this is the same shared opener the
 * case repository uses, wrapped by the data layer.
 */
function loadDefaultConnectionRepository(): Promise<ConnectionRepositoryPort> {
  if (defaultConnectionRepositoryPromise === null) {
    defaultConnectionRepositoryPromise = openNotesDetectiveDatabase()
      .then((database) => new ConnectionRepository(database))
      .catch((error: unknown) => {
        defaultConnectionRepositoryPromise = null;
        throw error;
      });
  }

  return defaultConnectionRepositoryPromise;
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

function connectionSnapshot(connection: ConnectionRecord): BoardStringConnection {
  return {
    id: connection.id,
    fromCardId: connection.fromCardId,
    toCardId: connection.toCardId,
    type: connection.type,
  };
}

/**
 * The camera that puts a card's centre at the centre of the board stage. The
 * scale is kept because search selection is a navigation jump, not a zoom.
 * A zero-sized stage (tests, or before the canvas settles) falls back to the
 * window size so the result is still deterministic.
 */
function centeredViewportOnCard(
  position: { readonly x: number; readonly y: number },
  viewportSize: BoardSize,
  scale: number,
): Viewport {
  const width =
    Number.isFinite(viewportSize.width) && viewportSize.width > 0 ? viewportSize.width : 1;
  const height =
    Number.isFinite(viewportSize.height) && viewportSize.height > 0 ? viewportSize.height : 1;
  const normalized = normalizeViewport({ x: 0, y: 0, scale });

  return normalizeViewport({
    x: position.x + BOARD_CARD_WIDTH / 2 - width / (2 * normalized.scale),
    y: position.y + BOARD_CARD_HEIGHT / 2 - height / (2 * normalized.scale),
    scale: normalized.scale,
  });
}

function readStageSize(element: HTMLElement | null): BoardSize {
  const rect = element?.getBoundingClientRect();
  const width = rect !== undefined && rect.width > 0 ? rect.width : window.innerWidth;
  const height = rect !== undefined && rect.height > 0 ? rect.height : window.innerHeight;

  return {
    width: Number.isFinite(width) && width > 0 ? width : 1024,
    height: Number.isFinite(height) && height > 0 ? height : 768,
  };
}

/** A coarse primary pointer is the touch case the long-press hint explains. */
function readCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function readinessDotTone(closed: boolean, ready: boolean): 'success' | 'warning' | 'neutral' {
  if (closed) {
    return ready ? 'neutral' : 'warning';
  }
  return ready ? 'success' : 'warning';
}

/** The routed case-board screen: repository load, canvas mount, viewport save. */
export function CaseBoardPage({
  repository,
  loadRepository,
  connectionRepository,
  loadConnectionRepository,
  store,
  hintStore,
}: CaseBoardPageProps) {
  const { caseId: caseIdParam } = useParams();
  const caseId = caseIdParam ?? '';
  const [searchParams] = useSearchParams();
  const focusCardId = searchParams.get('card');
  const activeStore = store ?? boardStore;

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeRepository, setActiveRepository] = useState<CaseRepositoryPort | null>(null);
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [cardImageState, setCardImageState] = useState<{
    readonly key: string;
    readonly images: Record<string, BoardCardImage>;
  }>({ key: '', images: {} });
  const [backupOpen, setBackupOpen] = useState(false);
  const [restoredConnectionFocusToken, setRestoredConnectionFocusToken] = useState(0);
  const [coarsePointer, setCoarsePointer] = useState(readCoarsePointer);

  // The three board surfaces. Wide allows one transient popover plus one
  // persistent inspector; phone allows exactly one modal sheet.
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [closureOpen, setClosureOpen] = useState(false);
  const [searchCriteria, setSearchCriteria] = useState<SearchCriteria>(EMPTY_SEARCH_CRITERIA);
  const [capacityDismissed, setCapacityDismissed] = useState(false);
  const [backupToastCase, setBackupToastCase] = useState<string | null>(null);
  const [capacityToastOpen, setCapacityToastOpen] = useState(false);

  const phoneLayout = usePhoneLayout();
  const motion = useMotionPreference();
  // Auto-pan is a camera jump. The policy makes that explicit under reduced
  // motion; nothing in this page schedules a camera tween or smooth scroll.
  const autoPan = motionBehavior(motion.reduced).autoPan;
  const activeHintStore = hintStore ?? hintSeenStore;
  const seenHints = useSeenHints(activeHintStore);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const cardSaveTimersRef = useRef(new Map<string, number>());
  const cardSaveGenerationsRef = useRef(new Map<string, number>());
  const cardSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const boardHeadingRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const readinessTriggerRef = useRef<HTMLButtonElement>(null);
  const searchBarRef = useRef<HTMLButtonElement>(null);
  const closureBarRef = useRef<HTMLButtonElement>(null);
  const menuBarRef = useRef<HTMLButtonElement>(null);

  const focusHandledRef = useRef<string | null>(null);
  const restoredFocusHandledRef = useRef(0);
  const backupToastShownRef = useRef<string | null>(null);
  const capacityToastShownRef = useRef(false);
  /**
   * A phone sheet normally returns focus to the trigger that opened it. When an
   * action inside the sheet moves the student (selecting a search result or
   * centring a loose card), the sheet points this ref at the board heading so
   * closing lands on the new context instead.
   */
  const sheetReturnFocusRef = useRef<HTMLElement | null>(null);

  const viewport = useStore(activeStore, selectViewport);
  const viewportDirty = useStore(activeStore, selectViewportDirty);
  const selectedConnectionId = useStore(activeStore, selectSelectedConnectionId);
  const selectedCardId = useStore(activeStore, selectSelectedCardId);

  const resolveRepository = useCallback<CaseBoardRepositoryLoader>(() => {
    if (repository !== undefined) {
      return Promise.resolve(repository);
    }
    return (loadRepository ?? loadDefaultRepository)();
  }, [repository, loadRepository]);

  const resolveConnectionRepository = useCallback<CaseBoardConnectionRepositoryLoader>(() => {
    if (connectionRepository !== undefined) {
      return Promise.resolve(connectionRepository);
    }
    return (loadConnectionRepository ?? loadDefaultConnectionRepository)();
  }, [connectionRepository, loadConnectionRepository]);

  const invalidAddress = caseId.length === 0;
  const visibleStatus: LoadStatus = invalidAddress ? 'missing' : status;
  const reminder = useBackupReminder({
    repository: activeRepository,
    caseId,
    enabled: visibleStatus === 'ready',
  });

  // Readiness is derived once per graph change and shared by the band and the
  // closure surface. No loose-thread count or solved flag is written anywhere.
  const readiness = useMemo(() => deriveReadiness(cards, connections), [cards, connections]);
  const lifecycle = useMemo(
    () => deriveCaseLifecycle(caseRecord?.closedAt ?? null, readiness),
    [caseRecord?.closedAt, readiness],
  );
  const caseLifecycle = useCaseLifecycle({
    caseRecord,
    readiness,
    repository: activeRepository,
    onCaseChanged: setCaseRecord,
  });

  const readinessText =
    lifecycle.closed && lifecycle.badgeLabel !== null
      ? lifecycle.badgeLabel
      : lifecycle.readinessLabel;
  const readinessName = lifecycle.closed
    ? lifecycle.ready
      ? 'Readiness: closed'
      : 'Readiness: closed, loose threads'
    : lifecycle.ready
      ? 'Readiness: ready to close'
      : `Readiness: ${lifecycle.looseThreadCount} loose thread${
          lifecycle.looseThreadCount === 1 ? '' : 's'
        }`;

  const ready = visibleStatus === 'ready' && caseRecord !== null;
  const hasCards = ready && cards.length > 0;
  const cardListAvailable = caseId.length > 0 && visibleStatus !== 'missing';
  const capacityBlocked = hasCards && !canAddCard(cards.length);
  const capacityLevel = ready ? boardCapacityLevel(cards.length) : 'normal';
  const searchActive = hasActiveSearch(searchCriteria);
  const searchTriggerName = searchActive ? 'Search, filters active' : 'Search';

  const attentionReasons: string[] = [];
  if (ready && reminder.visible) {
    attentionReasons.push('first backup recommended');
  }
  if (capacityLevel === 'persistent') {
    attentionReasons.push(`${cards.length} cards, split recommended`);
  }
  if (capacityLevel === 'blocked') {
    attentionReasons.push('case full');
  }
  const attentionTone =
    capacityLevel === 'blocked' ? 'danger' : attentionReasons.length > 0 ? 'warning' : null;
  const menuName =
    attentionReasons.length === 0 ? 'Case menu' : `Case menu, ${attentionReasons.join(', ')}`;

  // The first-backup toast appears once per case per page session. The dot and
  // menu section persist independently until the case is backed up.
  useEffect(() => {
    if (!ready || reminder.loading || !reminder.visible) {
      return;
    }
    if (backupToastShownRef.current === caseId) {
      return;
    }
    backupToastShownRef.current = caseId;
    setBackupToastCase(caseId);
  }, [caseId, ready, reminder.loading, reminder.visible]);

  // The 120-149 capacity toast is once per page session; the section keeps its
  // own session dismissal.
  useEffect(() => {
    if (capacityLevel !== 'soft' || capacityDismissed || capacityToastShownRef.current) {
      return;
    }
    capacityToastShownRef.current = true;
    setCapacityToastOpen(true);
  }, [capacityDismissed, capacityLevel]);

  const openSearchSurface = useCallback((): void => {
    if (!ready || cards.length === 0) {
      return;
    }
    setMenuOpen(false);
    if (phoneLayout) {
      setClosureOpen(false);
      activeStore.getState().selectConnection(null);
      sheetReturnFocusRef.current = null;
    }
    setSearchOpen(true);
  }, [activeStore, cards.length, phoneLayout, ready]);

  const openMenuSurface = useCallback((): void => {
    setSearchOpen(false);
    if (phoneLayout) {
      setClosureOpen(false);
      activeStore.getState().selectConnection(null);
      sheetReturnFocusRef.current = null;
    }
    setMenuOpen(true);
  }, [activeStore, phoneLayout]);

  const openClosureSurface = useCallback((): void => {
    if (!ready) {
      return;
    }
    setSearchOpen(false);
    setMenuOpen(false);
    activeStore.getState().selectConnection(null);
    if (phoneLayout) {
      sheetReturnFocusRef.current = null;
    }
    setClosureOpen(true);
  }, [activeStore, phoneLayout, ready]);

  const openBackup = useCallback((): void => {
    setMenuOpen(false);
    setBackupToastCase(null);
    if (phoneLayout) {
      sheetReturnFocusRef.current = null;
    }
    setBackupOpen(true);
  }, [phoneLayout]);

  // The shell's `/` shortcut. On phone it opens the Search sheet; on wide it
  // opens the Search popover and the Panel focuses the first field.
  useEffect(() => {
    const handleFocusSearch = (): void => {
      if (visibleStatus !== 'ready' || cards.length === 0) {
        return;
      }
      openSearchSurface();
    };

    window.addEventListener(FOCUS_SEARCH_EVENT, handleFocusSearch);

    return () => {
      window.removeEventListener(FOCUS_SEARCH_EVENT, handleFocusSearch);
    };
  }, [cards.length, openSearchSurface, visibleStatus]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      if (invalidAddress) {
        return;
      }

      // A case switch starts a fresh surface slice. This runs inside the async
      // load rather than synchronously in an effect body.
      setSearchCriteria(EMPTY_SEARCH_CRITERIA);
      setCapacityDismissed(false);
      setSearchOpen(false);
      setMenuOpen(false);
      setClosureOpen(false);

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

        // A board mount starts a fresh interaction slice; the persisted camera
        // is restored as the stored and live viewport together.
        activeStore.getState().resetBoard(record.viewport);

        setActiveRepository(target);
        setCaseRecord(record);
        setCards(storedCards);
        setConnections(storedConnections);
        setLoadError(null);
        setSaveError(null);
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setActiveRepository(null);
          setCaseRecord(null);
          setCards([]);
          setConnections([]);
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

  // The long-press hint only makes sense for a coarse primary pointer. Track
  // the media query so a tablet with a paired mouse still gets the right copy.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    let query: MediaQueryList;
    try {
      query = window.matchMedia('(pointer: coarse)');
    } catch {
      return;
    }

    const sync = (): void => setCoarsePointer(query.matches);
    sync();

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
    }

    return undefined;
  }, []);

  // Clear pending card-position timers on route/case change so a late write
  // cannot land in a different case. Generation tokens make an already-started
  // save a no-op after the reset.
  useEffect(
    () => () => {
      for (const timer of cardSaveTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      cardSaveTimersRef.current.clear();
      cardSaveGenerationsRef.current.clear();
    },
    [caseId],
  );

  // The image set only changes when the card IDs or the case database changes,
  // not on every completed drag. Object URLs are owned here and revoked on
  // route change, case switch, or unmount.
  const cardIdsKey = useMemo(() => cards.map((card) => card.id).join('|'), [cards]);
  const cardImages = cardImageState.key === cardIdsKey ? cardImageState.images : EMPTY_CARD_IMAGES;

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
              mime?: AttachmentMime;
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
              image.mime = displayAttachment.mime;
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

  const handleCardMoved = useCallback(
    (cardId: string, position: { readonly x: number; readonly y: number }): void => {
      const next = {
        x: Number.isFinite(position.x) ? Math.max(0, position.x) : 0,
        y: Number.isFinite(position.y) ? Math.max(0, position.y) : 0,
      };

      // The scene has already drawn this position; mirror it in page state so a
      // later snapshot re-render (or route return) uses the final value.
      setCards((current) =>
        current.map((card) => (card.id === cardId ? { ...card, position: next } : card)),
      );

      if (activeRepository === null) {
        return;
      }

      const generation = (cardSaveGenerationsRef.current.get(cardId) ?? 0) + 1;
      cardSaveGenerationsRef.current.set(cardId, generation);

      const existing = cardSaveTimersRef.current.get(cardId);
      if (existing !== undefined) {
        window.clearTimeout(existing);
      }

      const timer = window.setTimeout(() => {
        cardSaveTimersRef.current.delete(cardId);

        cardSaveChainRef.current = cardSaveChainRef.current.then(async () => {
          // A newer drag superseded this one while the timer was pending.
          if (cardSaveGenerationsRef.current.get(cardId) !== generation) {
            return;
          }

          try {
            await activeRepository.updateCard(cardId, { position: next });
            setSaveError(null);
          } catch {
            setSaveError(
              'The card position could not be saved. Your card is still on the board; drag it again to retry.',
            );
          }
        });
      }, CARD_POSITION_SAVE_DEBOUNCE_MS);

      cardSaveTimersRef.current.set(cardId, timer);
    },
    [activeRepository],
  );

  /** A selected string is an inspector: it closes closure and other phone sheets. */
  const handleConnectionSelected = useCallback((): void => {
    setClosureOpen(false);
    if (phoneLayout) {
      setSearchOpen(false);
      setMenuOpen(false);
    }
  }, [phoneLayout]);

  const handleConnectionCreated = useCallback(
    (connection: ConnectionRecord): void => {
      handleConnectionSelected();
      setConnections((current) => {
        const without = current.filter((candidate) => candidate.id !== connection.id);
        return [...without, connection];
      });
    },
    [handleConnectionSelected],
  );

  const handleConnectionChanged = useCallback((connection: ConnectionRecord): void => {
    setConnections((current) => {
      const exists = current.some((candidate) => candidate.id === connection.id);
      if (!exists) {
        return [...current, connection];
      }
      return current.map((candidate) => (candidate.id === connection.id ? connection : candidate));
    });
  }, []);

  const connection = useCreateConnection({
    caseId,
    cards,
    connections,
    ...(connectionRepository !== undefined ? { repository: connectionRepository } : {}),
    loadRepository: resolveConnectionRepository,
    store: activeStore,
    onConnectionCreated: handleConnectionCreated,
    onConnectionChanged: handleConnectionChanged,
  });

  const { requestConnection } = connection;

  const {
    message: connectionUndoMessage,
    error: connectionUndoError,
    deleteWithUndo: deleteConnectionWithUndo,
    undo: undoConnectionDelete,
    dismiss: dismissConnectionUndo,
    clearError: clearConnectionUndoError,
  } = useUndoDeleteConnection({
    loadRepository: resolveConnectionRepository,
    onDeleted: (deleted) => {
      setConnections((current) => current.filter((candidate) => candidate.id !== deleted.id));
      if (activeStore.getState().selectedConnectionId === deleted.id) {
        activeStore.getState().selectConnection(null);
      }
    },
    onRestored: (restored) => {
      handleConnectionChanged(restored);
      handleConnectionSelected();
      activeStore.getState().selectConnection(restored.id);
    },
  });

  const handleConnectionDrop = useCallback(
    (drop: {
      readonly fromCardId: string;
      readonly toCardId: string | null;
      readonly point: { readonly clientX: number; readonly clientY: number };
    }): void => {
      const input: ConnectionDropInput = {
        fromCardId: drop.fromCardId,
        toCardId: drop.toCardId,
        point: { x: drop.point.clientX, y: drop.point.clientY },
      };
      // Any drop can end with the inspector open (created or duplicate), so it
      // closes closure and the other phone sheets up front.
      handleConnectionSelected();
      void requestConnection(input);
    },
    [handleConnectionSelected, requestConnection],
  );

  const handleConnectionRetype = useCallback(
    async (target: ConnectionRecord, type: ConnectionType): Promise<void> => {
      const repository = await resolveConnectionRepository();
      // Retype updates the existing row; the connection ID and pair key are
      // preserved so the rendered string is the same one, not a replacement.
      const updated = await repository.retype(target.id, type);
      handleConnectionChanged(updated);
    },
    [handleConnectionChanged, resolveConnectionRepository],
  );

  const handleConnectionDelete = useCallback(
    async (target: ConnectionRecord, fromTitle: string, toTitle: string): Promise<void> => {
      const removed = await deleteConnectionWithUndo({
        connection: target,
        fromTitle,
        toTitle,
      });

      if (!removed) {
        // The row was already gone when the delete reached storage. Drop the
        // stale snapshot without offering an undo that could resurrect it.
        setConnections((current) => current.filter((candidate) => candidate.id !== target.id));
        if (activeStore.getState().selectedConnectionId === target.id) {
          // The phone inspector is a sheet; focus should land on the board
          // heading after the string it described is gone.
          sheetReturnFocusRef.current = boardHeadingRef.current;
          activeStore.getState().selectConnection(null);
        }
      }
    },
    [activeStore, deleteConnectionWithUndo],
  );

  const handleUndoConnectionDelete = useCallback(async (): Promise<void> => {
    const restored = await undoConnectionDelete();
    if (restored) {
      // The Undo action disappears with the toast. Move focus to the restored
      // inspector after the state commit so focus never falls back to <body>.
      setRestoredConnectionFocusToken((token) => token + 1);
    }
  }, [undoConnectionDelete]);

  useEffect(() => {
    if (restoredConnectionFocusToken === 0) {
      return;
    }

    if (restoredFocusHandledRef.current === restoredConnectionFocusToken) {
      return;
    }
    restoredFocusHandledRef.current = restoredConnectionFocusToken;

    const detailHeading = document.getElementById('connection-detail-title');
    (detailHeading ?? boardHeadingRef.current)?.focus();
  }, [connections, restoredConnectionFocusToken]);

  const snapshot = useMemo<BoardSnapshot>(
    () => ({
      caseId,
      caseTitle: caseRecord?.title ?? '',
      cards: cards.map((card) => cardSnapshot(card, cardImages[card.id])),
      connections: connections.map(connectionSnapshot),
    }),
    [cardImages, cards, caseId, caseRecord, connections],
  );

  const selectedConnection =
    selectedConnectionId === null
      ? null
      : (connections.find((candidate) => candidate.id === selectedConnectionId) ?? null);
  const selectedFromCard =
    selectedConnection === null
      ? null
      : (cards.find((candidate) => candidate.id === selectedConnection.fromCardId) ?? null);
  const selectedToCard =
    selectedConnection === null
      ? null
      : (cards.find((candidate) => candidate.id === selectedConnection.toCardId) ?? null);
  const selectedDetail =
    selectedConnection !== null && selectedFromCard !== null && selectedToCard !== null
      ? { connection: selectedConnection, fromCard: selectedFromCard, toCard: selectedToCard }
      : null;
  // The short type menu follows a fresh pointer drop. The inspector takes over
  // once that menu is dismissed, so the two surfaces never compete for the same
  // newly created string.
  const menuCompetesWithDetail =
    connection.menu !== null &&
    selectedDetail !== null &&
    connection.menu.connectionId === selectedDetail.connection.id;
  const detailVisible = ready && selectedDetail !== null && !menuCompetesWithDetail;

  /**
   * Search selection is a read-only navigation: it changes only the live
   * camera (a temporary viewport, like fit-to-view) and the selected card.
   * It never updates a card, a position, a connection, or case metadata.
   */
  const applySearchSelection = useCallback(
    (card: CardRecord): void => {
      const current = activeStore.getState().viewport;
      const next = centeredViewportOnCard(
        card.position,
        readStageSize(stageRef.current),
        current.scale,
      );

      activeStore.getState().applyTemporaryViewport(next);
      activeStore.getState().selectCard(card.id);
      boardHeadingRef.current?.focus();
    },
    [activeStore],
  );

  /** Loose-thread rows can center their card without leaving the board. */
  const handleShowLooseCard = useCallback(
    (cardId: string): void => {
      const card = cards.find((candidate) => candidate.id === cardId);
      if (card !== undefined) {
        applySearchSelection(card);
      }
    },
    [applySearchSelection, cards],
  );

  /** Search selection closes the surface and lands focus on the board. */
  const handleSearchSelect = useCallback(
    (card: CardRecord): void => {
      setSearchOpen(false);
      if (phoneLayout) {
        sheetReturnFocusRef.current = boardHeadingRef.current;
      }
      applySearchSelection(card);
    },
    [applySearchSelection, phoneLayout],
  );

  const handleClosureShowCard = useCallback(
    (cardId: string): void => {
      if (phoneLayout) {
        sheetReturnFocusRef.current = boardHeadingRef.current;
        setClosureOpen(false);
      }
      handleShowLooseCard(cardId);
    },
    [handleShowLooseCard, phoneLayout],
  );

  const handleCloseConnectionDetail = useCallback((): void => {
    // The phone inspector is a sheet; closing it should land on the board
    // heading rather than the unrelated trigger that was focused before the
    // string was picked. The Dialog reads this ref during its cleanup, so focus
    // is not moved to an inert element while the trap is still active.
    if (phoneLayout) {
      sheetReturnFocusRef.current = boardHeadingRef.current;
    } else {
      boardHeadingRef.current?.focus();
    }
    activeStore.getState().selectConnection(null);
  }, [activeStore, phoneLayout]);

  // The card list's search results navigate here with `?card=<id>` so that
  // "Select" means the same thing on both surfaces: center and select the card.
  // The ref makes the jump happen once per case/card pair, not on every
  // subsequent cards refresh (for example after a drag save).
  useEffect(() => {
    if (visibleStatus !== 'ready' || focusCardId === null) {
      return;
    }

    const focusKey = `${caseId}:${focusCardId}`;
    if (focusHandledRef.current === focusKey) {
      return;
    }

    const card = cards.find((candidate) => candidate.id === focusCardId);
    if (card === undefined) {
      return;
    }

    focusHandledRef.current = focusKey;
    applySearchSelection(card);
  }, [applySearchSelection, cards, caseId, focusCardId, visibleStatus]);

  /**
   * Contextual hints are independent, not a tour. Only the one whose moment is
   * actually present is shown, and the shared seen store removes it for good
   * once it is dismissed. A hint never covers the board pointer surface: it
   * uses the contextual modifier that lets clicks pass through the panel body.
   * Any open surface suppresses the hint without marking it seen.
   */
  const surfaceOpen = searchOpen || menuOpen || closureOpen || detailVisible;
  const activeHintId: HintId | null =
    visibleStatus !== 'ready' || caseRecord === null || surfaceOpen
      ? null
      : cards.length >= 2 && !seenHints.has('thread-anchor')
        ? 'thread-anchor'
        : coarsePointer && selectedCardId !== null && !seenHints.has('long-press')
          ? 'long-press'
          : null;
  const activeHint = activeHintId === null ? null : getHint(activeHintId);

  const retryLoad = (): void => {
    setLoadError(null);
    setStatus('loading');
    setReloadToken((token) => token + 1);
  };

  const addEvidence = (): ReactElement | null => {
    if (!hasCards) {
      return null;
    }

    const href = `/case/${caseId}/capture`;

    if (capacityBlocked) {
      return (
        <span
          className="case-board-add"
          aria-disabled="true"
          aria-describedby="case-board-add-blocked"
          data-testid="board-add-evidence-blocked"
        >
          <Glyph name="add" />
          <span>Add evidence</span>
        </span>
      );
    }

    return (
      <Link className="case-board-add" to={href} aria-label="Add evidence">
        <Glyph name="add" />
        <span>Add evidence</span>
      </Link>
    );
  };

  const attentionDot =
    attentionTone === null ? null : (
      <span className="case-board-attention" data-tone={attentionTone} aria-hidden="true" />
    );

  const panelReturnFocus = phoneLayout ? searchBarRef : searchTriggerRef;

  return (
    <section
      className="case-board-page"
      aria-labelledby="case-board-page-title"
      aria-busy={visibleStatus === 'loading'}
      data-case-id={caseId}
      data-board-status={visibleStatus}
    >
      {/*
        The only page heading. It is visually hidden but focusable so a search
        result, Show on board, and a closed inspector have one landing target.
      */}
      <h2
        id="case-board-page-title"
        ref={boardHeadingRef}
        className="visually-hidden"
        tabIndex={-1}
      >
        Case board
      </h2>

      <Toast
        placement="top"
        message={saveError}
        tone="error"
        onDismiss={() => setSaveError(null)}
        dismissLabel="Dismiss board save error"
      />

      <Toast
        placement="top"
        message={connection.feedback?.message ?? null}
        tone={connection.feedback?.tone ?? 'info'}
        onDismiss={connection.clearFeedback}
        dismissLabel="Dismiss connection message"
      />

      <Toast
        placement="top"
        message={connectionUndoMessage}
        tone="info"
        actionLabel="Undo"
        onAction={() => {
          void handleUndoConnectionDelete();
        }}
        onDismiss={dismissConnectionUndo}
        dismissLabel="Dismiss connection undo"
      />

      <Toast
        placement="top"
        message={connectionUndoError}
        tone="error"
        onDismiss={clearConnectionUndoError}
        dismissLabel="Dismiss connection undo error"
      />

      <Toast
        placement="top"
        message={caseLifecycle.message}
        tone="success"
        onDismiss={caseLifecycle.clearMessage}
        dismissLabel="Dismiss closure message"
      />

      <Toast
        placement="top"
        message={
          backupToastCase === caseId && ready && reminder.visible
            ? 'Five cards and a connection make this a good moment for a first backup.'
            : null
        }
        actionLabel="Back up now"
        onAction={openBackup}
        onDismiss={() => setBackupToastCase(null)}
        dismissLabel="Dismiss backup reminder"
      />

      <Toast
        placement="top"
        message={
          capacityToastOpen && capacityLevel === 'soft' && ready
            ? `${cards.length} cards are pinned. A case becomes hard to scan at 150 cards, so plan a split before then.`
            : null
        }
        onDismiss={() => setCapacityToastOpen(false)}
        dismissLabel="Dismiss capacity notice"
      />

      {hasCards ? (
        <p id="case-board-add-blocked" className="visually-hidden">
          {SPLIT_CASE_MESSAGE}
        </p>
      ) : null}

      <header className="case-board-band">
        <p className="case-board-band__title" data-testid="case-board-title">
          {ready && caseRecord !== null ? caseRecord.title : 'Case file'}
        </p>

        {ready && caseRecord !== null ? (
          phoneLayout ? (
            <span
              className="case-board-band__readiness case-board-band__readiness--static"
              data-state={lifecycle.state}
            >
              <span
                className="case-board-readiness-dot"
                data-tone={readinessDotTone(lifecycle.closed, lifecycle.ready)}
                aria-hidden="true"
              />
              {readinessText}
            </span>
          ) : (
            <button
              type="button"
              ref={readinessTriggerRef}
              className="case-board-band__readiness"
              data-state={lifecycle.state}
              aria-label={readinessName}
              aria-haspopup="dialog"
              aria-expanded={closureOpen}
              aria-controls="case-board-closure-panel"
              onClick={openClosureSurface}
            >
              <span
                className="case-board-readiness-dot"
                data-tone={readinessDotTone(lifecycle.closed, lifecycle.ready)}
                aria-hidden="true"
              />
              <span className="case-board-band__readiness-label">{readinessText}</span>
              <span className="case-board-band__chevron" aria-hidden="true">
                ▾
              </span>
            </button>
          )
        ) : null}
      </header>

      <div className="case-board-row">
        {!phoneLayout ? (
          <nav className="case-board-rail" aria-label="Case tools">
            {hasCards ? (
              <IconButton
                ref={searchTriggerRef}
                label={searchTriggerName}
                variant="quiet"
                aria-haspopup="dialog"
                aria-expanded={searchOpen}
                aria-controls="case-board-search-panel"
                onClick={() => (searchOpen ? setSearchOpen(false) : openSearchSurface())}
              >
                <Glyph name="search" />
              </IconButton>
            ) : null}

            {cardListAvailable ? (
              <Link
                className="case-board-rail__link"
                to={`/case/${caseId}/list`}
                data-testid="open-card-list"
              >
                <Glyph name="card-list" />
                <span className="visually-hidden">Open card list</span>
              </Link>
            ) : null}

            <IconButton
              ref={menuTriggerRef}
              className="case-board-rail__menu"
              label={menuName}
              variant="quiet"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls="case-board-menu-panel"
              onClick={() => (menuOpen ? setMenuOpen(false) : openMenuSurface())}
            >
              <Glyph name="case-menu" />
              {attentionDot}
            </IconButton>
          </nav>
        ) : null}

        <div
          className="case-board-stage"
          ref={stageRef}
          data-motion={motion.reduced ? 'reduced' : 'full'}
          data-motion-auto-pan={autoPan}
        >
          {visibleStatus === 'loading' ? (
            <p className="case-board-status" role="status">
              Opening the case…
            </p>
          ) : null}

          {visibleStatus === 'error' ? (
            <section className="case-board-error" role="alert" aria-labelledby="board-load-error">
              <h3 id="board-load-error">Case could not open</h3>
              <p>{loadError}</p>
              <div className="case-board-error__actions">
                <Button variant="primary" onClick={retryLoad}>
                  Retry
                </Button>
                <Link className="case-board-text-link" to="/">
                  Back to case shelf
                </Link>
              </div>
            </section>
          ) : null}

          {visibleStatus === 'missing' ? (
            <section
              className="case-board-error"
              role="alert"
              aria-labelledby="board-missing-title"
            >
              <h3 id="board-missing-title">Case not found</h3>
              <p>
                This case is no longer in local storage. It may have been deleted, or the address
                may be incomplete.
              </p>
              <div className="case-board-error__actions">
                <Link className="case-board-text-link" to="/">
                  Back to case shelf
                </Link>
              </div>
            </section>
          ) : null}

          {ready && cards.length === 0 ? <EmptyBoard caseId={caseId} /> : null}

          {hasCards ? (
            <Suspense
              fallback={
                <p className="case-board-status" role="status">
                  Preparing the board canvas…
                </p>
              }
            >
              <BoardCanvas
                snapshot={snapshot}
                store={activeStore}
                onCardMoved={handleCardMoved}
                onConnectionDrop={handleConnectionDrop}
              />
            </Suspense>
          ) : null}

          {!phoneLayout && addEvidence()}

          {!phoneLayout && searchOpen && hasCards ? (
            <Panel
              open
              id="case-board-search-panel"
              className="case-board-panel case-board-panel--search"
              title="Search this case"
              description="Matches are found in titles, tags, and stored OCR text."
              closeLabel="Close search"
              transient
              returnFocusRef={panelReturnFocus}
              onClose={() => setSearchOpen(false)}
            >
              <SearchPanel
                variant="popover"
                hideTitle
                cards={cards}
                criteria={searchCriteria}
                onCriteriaChange={setSearchCriteria}
                onSelectCard={handleSearchSelect}
                title="Search this case"
              />
            </Panel>
          ) : null}

          {!phoneLayout && menuOpen ? (
            <Panel
              open
              id="case-board-menu-panel"
              className="case-board-panel case-board-panel--menu"
              title="Case menu"
              closeLabel="Close case menu"
              transient
              returnFocusRef={menuTriggerRef}
              onClose={() => setMenuOpen(false)}
            >
              <CaseMenu
                caseId={caseId}
                phone={false}
                ready={ready}
                cardCount={cards.length}
                reminderVisible={ready && reminder.visible}
                reminderSaving={reminder.saving}
                reminderError={reminder.error}
                capacityDismissed={capacityDismissed}
                onBackup={openBackup}
                onDismissReminder={() => {
                  void reminder.dismiss();
                }}
                onDismissCapacity={() => {
                  setCapacityDismissed(true);
                  setCapacityToastOpen(false);
                }}
                onNavigate={() => setMenuOpen(false)}
              />
            </Panel>
          ) : null}

          {!phoneLayout && closureOpen && ready && caseRecord !== null ? (
            <Panel
              open
              id="case-board-closure-panel"
              className="case-board-panel case-board-panel--closure"
              title="Case closure"
              description="Derived readiness, loose threads, and the close or reopen action for this case."
              closeLabel="Close case closure"
              returnFocusRef={readinessTriggerRef}
              onClose={() => setClosureOpen(false)}
            >
              <ClosurePanel
                caseRecord={caseRecord}
                readiness={readiness}
                busy={caseLifecycle.busy}
                error={caseLifecycle.error}
                onCloseCase={caseLifecycle.closeCase}
                onReopenCase={caseLifecycle.reopenCase}
                cardHref={(cardId) => `/case/${caseId}/card/${cardId}`}
                onShowCard={handleClosureShowCard}
                onClearError={caseLifecycle.clearError}
              />
            </Panel>
          ) : null}

          {!phoneLayout && detailVisible && selectedDetail !== null ? (
            <Panel
              open
              id="case-board-detail-panel"
              className="case-board-panel case-board-panel--detail"
              title="Connection details"
              description={`“${selectedDetail.fromCard.title}” and “${selectedDetail.toCard.title}”`}
              closeLabel="Close connection details"
              returnFocusRef={boardHeadingRef}
              onClose={handleCloseConnectionDetail}
            >
              <ConnectionDetail
                embedded
                connection={selectedDetail.connection}
                fromCard={selectedDetail.fromCard}
                toCard={selectedDetail.toCard}
                onRetype={(type) => handleConnectionRetype(selectedDetail.connection, type)}
                onDelete={() =>
                  handleConnectionDelete(
                    selectedDetail.connection,
                    selectedDetail.fromCard.title,
                    selectedDetail.toCard.title,
                  )
                }
              />
            </Panel>
          ) : null}
        </div>
      </div>

      {phoneLayout ? (
        <nav className="case-board-bar" aria-label="Case board actions">
          {hasCards ? (
            <IconButton
              ref={searchBarRef}
              label={searchTriggerName}
              aria-haspopup="dialog"
              aria-expanded={searchOpen}
              aria-controls="case-board-search-sheet"
              onClick={() => (searchOpen ? setSearchOpen(false) : openSearchSurface())}
            >
              <Glyph name="search" />
            </IconButton>
          ) : null}

          {hasCards &&
            (capacityBlocked ? (
              <span
                className="case-board-bar__add"
                aria-disabled="true"
                aria-label="Add evidence"
                aria-describedby="case-board-add-blocked"
                data-testid="board-add-evidence-blocked"
              >
                <Glyph name="add" />
              </span>
            ) : (
              <Link
                className="case-board-bar__add"
                to={`/case/${caseId}/capture`}
                aria-label="Add evidence"
              >
                <Glyph name="add" />
              </Link>
            ))}

          {ready && caseRecord !== null ? (
            <IconButton
              ref={closureBarRef}
              label="Case closure"
              aria-haspopup="dialog"
              aria-expanded={closureOpen}
              aria-controls="case-board-closure-sheet"
              onClick={() => (closureOpen ? setClosureOpen(false) : openClosureSurface())}
            >
              <Glyph name="closure" />
            </IconButton>
          ) : null}

          <IconButton
            ref={menuBarRef}
            className="case-board-bar__menu"
            label={menuName}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="case-board-menu-sheet"
            onClick={() => (menuOpen ? setMenuOpen(false) : openMenuSurface())}
          >
            <Glyph name="case-menu" />
            {attentionDot}
          </IconButton>
        </nav>
      ) : null}

      {phoneLayout ? (
        <Dialog
          open={searchOpen && hasCards}
          onClose={() => setSearchOpen(false)}
          id="case-board-search-sheet"
          title="Search this case"
          description="Matches are found in titles, tags, and stored OCR text. Choose a result to centre it on the board."
          size="lg"
          className="case-board-sheet case-board-sheet--search"
          returnFocusRef={sheetReturnFocusRef}
        >
          <SearchPanel
            variant="sheet"
            hideTitle
            cards={cards}
            criteria={searchCriteria}
            onCriteriaChange={setSearchCriteria}
            onSelectCard={handleSearchSelect}
            title="Search this case"
          />
        </Dialog>
      ) : null}

      {phoneLayout ? (
        <Dialog
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          id="case-board-menu-sheet"
          title="Case menu"
          description="Backup, case capacity, recall, and case destinations."
          size="lg"
          className="case-board-sheet case-board-sheet--menu"
          returnFocusRef={sheetReturnFocusRef}
        >
          <CaseMenu
            caseId={caseId}
            phone
            ready={ready}
            cardCount={cards.length}
            reminderVisible={ready && reminder.visible}
            reminderSaving={reminder.saving}
            reminderError={reminder.error}
            capacityDismissed={capacityDismissed}
            onBackup={openBackup}
            onDismissReminder={() => {
              void reminder.dismiss();
            }}
            onDismissCapacity={() => {
              setCapacityDismissed(true);
              setCapacityToastOpen(false);
            }}
            onNavigate={() => setMenuOpen(false)}
          />
        </Dialog>
      ) : null}

      {phoneLayout && ready && caseRecord !== null ? (
        <Dialog
          open={closureOpen}
          onClose={() => setClosureOpen(false)}
          id="case-board-closure-sheet"
          title="Case closure"
          description="Derived readiness, loose threads, and the close or reopen action for this case."
          size="lg"
          className="case-board-sheet case-board-sheet--closure"
          returnFocusRef={sheetReturnFocusRef}
        >
          <ClosurePanel
            caseRecord={caseRecord}
            readiness={readiness}
            busy={caseLifecycle.busy}
            error={caseLifecycle.error}
            onCloseCase={caseLifecycle.closeCase}
            onReopenCase={caseLifecycle.reopenCase}
            cardHref={(cardId) => `/case/${caseId}/card/${cardId}`}
            onShowCard={handleClosureShowCard}
            onClearError={caseLifecycle.clearError}
          />
        </Dialog>
      ) : null}

      {phoneLayout && detailVisible && selectedDetail !== null ? (
        <Dialog
          open
          onClose={handleCloseConnectionDetail}
          title="Connection details"
          description={`“${selectedDetail.fromCard.title}” and “${selectedDetail.toCard.title}”`}
          className="case-board-sheet case-board-sheet--connection"
          returnFocusRef={sheetReturnFocusRef}
        >
          <ConnectionDetail
            embedded
            connection={selectedDetail.connection}
            fromCard={selectedDetail.fromCard}
            toCard={selectedDetail.toCard}
            onRetype={(type) => handleConnectionRetype(selectedDetail.connection, type)}
            onDelete={() =>
              handleConnectionDelete(
                selectedDetail.connection,
                selectedDetail.fromCard.title,
                selectedDetail.toCard.title,
              )
            }
            onClose={handleCloseConnectionDetail}
          />
        </Dialog>
      ) : null}

      <ConnectionTypeMenu
        open={connection.menu !== null}
        type={connection.menu?.type ?? 'association'}
        provenanceEligible={connection.menu?.provenanceEligible ?? false}
        provenanceReason={connection.menu?.provenanceReason ?? ''}
        point={connection.menu?.point ?? null}
        busy={connection.busy}
        onSelect={(type) => {
          void connection.selectConnectionType(type);
        }}
        onDismiss={connection.dismissMenu}
      />

      {activeHint !== null ? (
        <HintPopover
          key={activeHint.id}
          open
          hintId={activeHint.id}
          store={activeHintStore}
          title={activeHint.title}
          description={activeHint.description}
          className="nd-hint--contextual"
          placement="board"
          autoFocus={false}
          returnFocusRef={boardHeadingRef}
          onDismiss={() => undefined}
        />
      ) : null}

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
