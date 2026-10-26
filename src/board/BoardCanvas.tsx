/**
 * The lazy Pixi board canvas and its DOM chrome.
 *
 * This module is the only React entry point into `src/board`. It is loaded by
 * `CaseBoardPage` with `React.lazy`, so `pixi.js` never enters the initial app
 * shell chunk. The component owns the host element, pointer intents, and the
 * accessible controls; `usePixiApp` owns renderer and texture teardown.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useStore } from 'zustand';

import Button from '../components/Button';

import type { BoardSnapshot, BoardStringConnection } from './BoardScene';
import { attachBoardInput } from './boardInput';
import { boardStore } from './boardStore';
import type { BoardStoreApi } from './boardStore';
import {
  selectHoveredCardId,
  selectSelectedCardId,
  selectSelectedConnectionId,
  selectViewport,
} from './boardStore';
import { SPLIT_CASE_MESSAGE } from './boardCapacity';
import FitToViewButton from './FitToViewButton';
import Minimap from './Minimap';
import { findThreadAnchorAtPoint, threadAnchorScreenPoint } from './ThreadAnchor';
import { useCulling } from './useCulling';
import { useCardGestures } from './useCardGestures';
import type { CardDragUpdate, ConnectEnd, ConnectMove, ConnectStart } from './useCardGestures';
import { findCardAtPoint } from './useCardGestures';
import { usePixiApp } from './usePixiApp';
import { DEFAULT_BOARD_VIEWPORT, screenToWorld } from './viewport';
import type { BoardPoint } from './viewport';

import './BoardCanvas.css';

/** Written to both the canvas host and the generated PixiJS canvas. */
export const BOARD_CANVAS_LABEL =
  'Case board canvas. Drag the cork to pan. Drag a card to move it. Select a card and drag its thread anchor to another card to connect them. Pinch or scroll to zoom. Use the controls for zoom and reset.';

/** The recall canvas has no truth strings; its label must not promise them. */
export const RECALL_CANVAS_LABEL =
  'Recall board canvas. The case strings are hidden. Card titles, images, and positions are visible. Select a card and drag its red thread anchor to another card to draw a scratch connection. Scratch connections are not saved. Pinch or scroll to zoom. Use the controls for zoom and reset.';

const ZOOM_STEP = 1.25;

export type BoardCanvasMode = 'browse' | 'recall';

/** A completed thread drop emitted to the page that owns the repository. */
export interface BoardConnectionDrop {
  readonly fromCardId: string;
  readonly toCardId: string | null;
  /** Client coordinates for the small type menu. */
  readonly point: { readonly clientX: number; readonly clientY: number };
}

/**
 * A recall scratch drop. It never carries a type, because drawing a scratch
 * string is not a repository write and the truth type is compared later.
 */
export interface BoardScratchDrop {
  readonly fromCardId: string;
  readonly toCardId: string | null;
}

export interface BoardCanvasProps {
  readonly snapshot: BoardSnapshot;
  /** Injected store for component tests and future multi-board screens. */
  readonly store?: BoardStoreApi | undefined;
  /**
   * Recall mode hides every truth string and routes a thread drop to
   * `onScratchDrop` instead of the repository-owned `onConnectionDrop`.
   */
  readonly mode?: BoardCanvasMode | undefined;
  /** The neutral scratch layer drawn only in recall mode. */
  readonly scratchConnections?: readonly BoardStringConnection[] | undefined;
  /** Called after a recall thread drop so the page updates the in-memory store. */
  readonly onScratchDrop?: ((drop: BoardScratchDrop) => void) | undefined;
  /**
   * Called once when a drag ends. The page debounces the repository update; the
   * canvas never writes a position itself.
   */
  readonly onCardMoved?: ((cardId: string, position: BoardPoint) => void) | undefined;
  /** Override the default navigation to card detail, for tests. */
  readonly onCardTap?: ((cardId: string) => void) | undefined;
  /**
   * A thread was dropped on a card or on the cork. The page performs the
   * repository write, duplicate handling, and type menu; the canvas never
   * imports a connection form or opens storage.
   */
  readonly onConnectionDrop?: ((drop: BoardConnectionDrop) => void) | undefined;
  /**
   * The shared 200-card guard already reports the case is full. The canvas
   * hides its Add evidence link rather than sending the student to a blocked
   * capture route.
   */
  readonly cardLimitReached?: boolean | undefined;
}

function formatViewportValue(value: number): string {
  return value.toFixed(3);
}

function formatScale(value: number): string {
  return value.toFixed(4);
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Track the OS motion preference so a mid-session change updates the lift. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (): void => {
      setReduced(query.matches);
    };

    handleChange();
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

/** The styled canvas surface, controls, and recoverable renderer states. */
export function BoardCanvas({
  snapshot,
  store,
  mode = 'browse',
  scratchConnections,
  onScratchDrop,
  onCardMoved,
  onCardTap,
  onConnectionDrop,
  cardLimitReached = false,
}: BoardCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeStore = store ?? boardStore;
  const viewport = useStore(activeStore, selectViewport);
  const selectedCardId = useStore(activeStore, selectSelectedCardId);
  const hoveredCardId = useStore(activeStore, selectHoveredCardId);
  const selectedConnectionId = useStore(activeStore, selectSelectedConnectionId);
  const reducedMotion = usePrefersReducedMotion();
  const navigate = useNavigate();
  const recall = mode === 'recall';
  const canvasTitle = recall ? 'Recall board canvas' : 'Case board canvas';
  const canvasDescriptionId = `board-canvas-description-${useId().replace(/:/g, '')}`;
  const cardCount = snapshot.cards.length;
  const canvasDescription = recall
    ? `Recall board with ${cardCount} ${
        cardCount === 1 ? 'card' : 'cards'
      } arranged spatially. Case strings are hidden. Use the recall toolbar for Check, Reset scratch, and Exit; scratch drawing is pointer-only.`
    : `Case board with ${cardCount} ${
        cardCount === 1 ? 'card' : 'cards'
      } arranged spatially. Use Open card list for a keyboard-operable view. Placement, panning, and thread drawing stay pointer-only.`;

  const snapshotRef = useRef(snapshot);
  const viewportRef = useRef(viewport);
  const anchorCardIdRef = useRef<string | null>(null);
  const onConnectionDropRef = useRef(onConnectionDrop);
  const onScratchDropRef = useRef(onScratchDrop);
  const reducedMotionRef = useRef(reducedMotion);

  // Recall never hands the truth graph to the scene, even if the page's plain
  // snapshot still carries it for the later comparison and check step.
  const truthConnections = useMemo(
    () => (recall ? [] : (snapshot.connections ?? [])),
    [recall, snapshot.connections],
  );
  const scratch = useMemo(() => scratchConnections ?? [], [scratchConnections]);
  const sceneSnapshot = useMemo<BoardSnapshot>(
    () =>
      recall
        ? { ...snapshot, connections: truthConnections, scratchConnections: scratch }
        : { ...snapshot, connections: truthConnections },
    [recall, scratch, snapshot, truthConnections],
  );

  const anchorCardId = selectedCardId ?? hoveredCardId;
  const anchorCard =
    anchorCardId === null ? undefined : snapshot.cards.find((card) => card.id === anchorCardId);
  const anchorPoint = anchorCard ? threadAnchorScreenPoint(anchorCard.position, viewport) : null;

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    anchorCardIdRef.current = anchorCardId;
  }, [anchorCardId]);

  useEffect(() => {
    onConnectionDropRef.current = onConnectionDrop;
  }, [onConnectionDrop]);

  useEffect(() => {
    onScratchDropRef.current = onScratchDrop;
  }, [onScratchDrop]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const {
    status,
    error,
    contextLost,
    viewportSize,
    retry,
    recover,
    moveCard: moveCardInScene,
    setCardLifted: setCardLiftedInScene,
    setAnchorCard: setAnchorCardInScene,
    beginThread: beginThreadInScene,
    updateThread: updateThreadInScene,
    endThread: endThreadInScene,
  } = usePixiApp({
    hostRef,
    snapshot: sceneSnapshot,
    viewport,
    canvasLabel: recall ? RECALL_CANVAS_LABEL : BOARD_CANVAS_LABEL,
    reducedMotion,
  });

  useEffect(() => {
    setAnchorCardInScene?.(anchorCardId);
  }, [anchorCardId, setAnchorCardInScene]);

  const getThreadAnchorAt = useCallback((point: BoardPoint): string | null => {
    return findThreadAnchorAtPoint(
      snapshotRef.current.cards,
      viewportRef.current,
      anchorCardIdRef.current,
      point,
    );
  }, []);

  const cardPositionList = useMemo(
    () => snapshot.cards.map((card) => ({ x: card.position.x, y: card.position.y })),
    [snapshot.cards],
  );
  const visibleCards = useCulling(snapshot.cards, viewport, viewportSize);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const input = attachBoardInput(host, {
      onPan: (delta) => activeStore.getState().panBy(delta),
      onZoom: (anchor, factor) => activeStore.getState().zoomAt(anchor, factor),
      onZoomTo: (anchor, scale) => activeStore.getState().zoomTo(anchor, scale),
      getScale: () => activeStore.getState().viewport.scale,
      // A pointer that lands on a card or its thread anchor belongs to the card
      // gesture controller; the cork only pans on empty board.
      shouldStartPan: (point) =>
        findCardAtPoint(snapshotRef.current.cards, activeStore.getState().viewport, point) ===
          null && getThreadAnchorAt(point) === null,
    });

    return () => input.destroy();
  }, [activeStore, getThreadAnchorAt]);

  // Mouse hover reveals the thread anchor without a click. Touch users get the
  // same affordance after a long-press release selects the card. The anchor's
  // own hit target keeps the hover alive while the pointer moves onto it.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (event.buttons !== 0) {
        return;
      }

      const rect = host.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const card = findCardAtPoint(snapshotRef.current.cards, viewportRef.current, point);

      if (card !== null) {
        if (activeStore.getState().hoveredCardId !== card.id) {
          activeStore.getState().setHoveredCard(card.id);
        }
        return;
      }

      if (getThreadAnchorAt(point) !== null) {
        return;
      }

      if (activeStore.getState().hoveredCardId !== null) {
        activeStore.getState().setHoveredCard(null);
      }
    };

    const handlePointerLeave = (): void => {
      if (activeStore.getState().hoveredCardId !== null) {
        activeStore.getState().setHoveredCard(null);
      }
    };

    host.addEventListener('pointermove', handlePointerMove);
    host.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      host.removeEventListener('pointermove', handlePointerMove);
      host.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [activeStore, getThreadAnchorAt]);

  const applyGesture = useCallback(
    (update: CardDragUpdate): void => {
      activeStore.getState().setGesture({
        kind: 'drag-card',
        pointerId: update.pointerId,
        cardId: update.cardId,
        grabOffset: { x: update.grabOffset.x, y: update.grabOffset.y },
        position: { x: update.position.x, y: update.position.y },
      });
    },
    [activeStore],
  );

  const handleLift = useCallback(
    (update: CardDragUpdate, reduced: boolean): void => {
      activeStore.getState().selectCard(update.cardId);
      applyGesture(update);
      setCardLiftedInScene?.(update.cardId, true, reduced);
    },
    [activeStore, applyGesture, setCardLiftedInScene],
  );

  const handleDragMove = useCallback(
    (update: CardDragUpdate): void => {
      applyGesture(update);
      moveCardInScene?.(update.cardId, update.position);
    },
    [applyGesture, moveCardInScene],
  );

  const handleDrop = useCallback(
    (update: CardDragUpdate): void => {
      moveCardInScene?.(update.cardId, update.position);
      setCardLiftedInScene?.(update.cardId, false, reducedMotionRef.current);
      activeStore.getState().resetGesture();
      onCardMoved?.(update.cardId, { x: update.position.x, y: update.position.y });
    },
    [activeStore, moveCardInScene, onCardMoved, setCardLiftedInScene],
  );

  const handleDragCancel = useCallback(
    (update: CardDragUpdate): void => {
      moveCardInScene?.(update.cardId, update.position);
      setCardLiftedInScene?.(update.cardId, false, reducedMotionRef.current);
      activeStore.getState().resetGesture();
    },
    [activeStore, moveCardInScene, setCardLiftedInScene],
  );

  const handleTap = useCallback(
    (cardId: string): void => {
      setCardLiftedInScene?.(cardId, false, reducedMotionRef.current);
      activeStore.getState().selectCard(cardId);
      activeStore.getState().resetGesture();

      // Recall is a reconstruction surface, not a route into card detail. A tap
      // selects the card so its thread anchor is available, and the titles and
      // images already stay visible on the board.
      if (recall) {
        return;
      }

      if (onCardTap !== undefined) {
        onCardTap(cardId);
        return;
      }

      navigate(`/case/${snapshot.caseId}/card/${cardId}`);
    },
    [activeStore, navigate, onCardTap, recall, setCardLiftedInScene, snapshot.caseId],
  );

  const handleConnectStart = useCallback(
    (start: ConnectStart): void => {
      activeStore.getState().selectCard(start.fromCardId);
      if (activeStore.getState().hoveredCardId !== start.fromCardId) {
        activeStore.getState().setHoveredCard(start.fromCardId);
      }
      activeStore.getState().setGesture({
        kind: 'connect',
        pointerId: start.pointerId,
        fromCardId: start.fromCardId,
        current: screenToWorld(start.point, activeStore.getState().viewport),
      });
      beginThreadInScene?.(start.fromCardId, start.point);
    },
    [activeStore, beginThreadInScene],
  );

  const handleConnectMove = useCallback(
    (move: ConnectMove): void => {
      activeStore.getState().setGesture({
        kind: 'connect',
        pointerId: move.pointerId,
        fromCardId: move.fromCardId,
        current: screenToWorld(move.point, activeStore.getState().viewport),
      });
      updateThreadInScene?.(move.point, move.targetCardId);
    },
    [activeStore, updateThreadInScene],
  );

  const handleConnectEnd = useCallback(
    (end: ConnectEnd): void => {
      endThreadInScene?.();
      activeStore.getState().resetGesture();

      // Recall reuses the thread-anchor gesture, but the drop is an in-memory
      // scratch intent. It must never reach the repository-owned drop handler.
      if (recall) {
        onScratchDropRef.current?.({
          fromCardId: end.fromCardId,
          toCardId: end.targetCardId,
        });
        return;
      }

      const rect = hostRef.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;

      onConnectionDropRef.current?.({
        fromCardId: end.fromCardId,
        toCardId: end.targetCardId,
        point: {
          clientX: left + end.point.x,
          clientY: top + end.point.y,
        },
      });
    },
    [activeStore, endThreadInScene, recall],
  );

  const handleConnectCancel = useCallback((): void => {
    endThreadInScene?.();
    activeStore.getState().resetGesture();
  }, [activeStore, endThreadInScene]);

  useCardGestures(hostRef, {
    getCardAt: (point) => {
      const card = findCardAtPoint(
        snapshotRef.current.cards,
        activeStore.getState().viewport,
        point,
      );
      return card?.id ?? null;
    },
    getThreadAnchorAt,
    getCardPosition: (cardId) =>
      snapshotRef.current.cards.find((card) => card.id === cardId)?.position ?? null,
    getViewport: () => activeStore.getState().viewport,
    isReducedMotion: () => reducedMotionRef.current,
    onPress: (cardId) => activeStore.getState().selectCard(cardId),
    onLift: handleLift,
    onDragMove: handleDragMove,
    onDrop: handleDrop,
    onDragCancel: handleDragCancel,
    onTap: handleTap,
    onPanBy: (delta) => activeStore.getState().panBy(delta),
    onConnectStart: handleConnectStart,
    onConnectMove: handleConnectMove,
    onConnectEnd: handleConnectEnd,
    onConnectCancel: handleConnectCancel,
  });

  const canvasCenter = useCallback((): BoardPoint => {
    const host = hostRef.current;
    return {
      x: (host?.clientWidth ?? 0) / 2,
      y: (host?.clientHeight ?? 0) / 2,
    };
  }, []);

  const zoomIn = (): void => {
    activeStore.getState().zoomAt(canvasCenter(), ZOOM_STEP);
  };

  const zoomOut = (): void => {
    activeStore.getState().zoomAt(canvasCenter(), 1 / ZOOM_STEP);
  };

  /**
   * Reset is intentionally a temporary camera: it returns the view to 100% at
   * the world origin without writing it. The next real pan or zoom is what
   * persists; a reload still restores the student's saved view.
   */
  const resetView = (): void => {
    activeStore.getState().applyTemporaryViewport(DEFAULT_BOARD_VIEWPORT);
  };

  const sceneStatus = contextLost ? 'context-lost' : status;
  const casePath = `/case/${snapshot.caseId}`;
  const zoomPercent = `${Math.round(viewport.scale * 100)}%`;
  const cardPositions = JSON.stringify(
    snapshot.cards.map((card) => ({
      id: card.id,
      x: card.position.x,
      y: card.position.y,
    })),
  );
  const connections = truthConnections;
  const associationCount = connections.filter(
    (connection) => connection.type === 'association',
  ).length;
  const provenanceCount = connections.length - associationCount;
  const scratchIds = scratch.map((connection) => connection.id).join('|');
  const anchorPointAttribute =
    anchorPoint === null
      ? ''
      : JSON.stringify({
          x: Math.round(anchorPoint.x * 100) / 100,
          y: Math.round(anchorPoint.y * 100) / 100,
        });

  return (
    <section
      className="board-canvas"
      aria-label={recall ? 'Recall board' : 'Case board'}
      data-testid="board-canvas"
      data-board-mode={mode}
      data-board-viewport-x={formatViewportValue(viewport.x)}
      data-board-viewport-y={formatViewportValue(viewport.y)}
      data-board-scale={formatScale(viewport.scale)}
      data-board-card-count={snapshot.cards.length}
      data-board-connection-count={connections.length}
      data-board-association-count={associationCount}
      data-board-provenance-count={provenanceCount}
      data-board-scratch-count={scratch.length}
      data-board-scratch-connections={scratchIds}
      data-board-visible-card-count={visibleCards.length}
      data-board-card-positions={cardPositions}
      data-board-anchor-card-id={anchorCardId ?? ''}
      data-board-anchor-point={anchorPointAttribute}
      data-board-selected-connection={selectedConnectionId ?? ''}
      data-board-scene-status={sceneStatus}
      data-board-context-lost={contextLost ? 'true' : 'false'}
      aria-busy={status === 'initializing'}
    >
      <p id={canvasDescriptionId} className="visually-hidden">
        {canvasDescription}
      </p>
      <div
        ref={hostRef}
        className="board-canvas__host"
        data-testid="board-canvas-host"
        role="group"
        aria-label={canvasTitle}
        aria-describedby={canvasDescriptionId}
      />

      <div className="board-canvas__controls" role="group" aria-label="Board view controls">
        <Button
          variant="quiet"
          className="board-canvas__zoom-button"
          aria-label="Zoom out"
          onClick={zoomOut}
        >
          −
        </Button>
        <output className="board-canvas__zoom-value" aria-label="Board zoom">
          {zoomPercent}
        </output>
        <Button
          variant="quiet"
          className="board-canvas__zoom-button"
          aria-label="Zoom in"
          onClick={zoomIn}
        >
          +
        </Button>
        <FitToViewButton
          positions={cardPositionList}
          viewportSize={viewportSize}
          store={activeStore}
        />
        <Button variant="quiet" onClick={resetView} aria-label="Reset view">
          Reset view
        </Button>
      </div>

      <Minimap
        cards={snapshot.cards}
        viewport={viewport}
        viewportSize={viewportSize}
        store={activeStore}
      />

      {status !== 'error' && !contextLost && !recall ? (
        <div className="board-canvas__links">
          {cardLimitReached ? (
            <span
              className="board-canvas__link board-canvas__link--blocked"
              aria-disabled="true"
              title={SPLIT_CASE_MESSAGE}
              data-testid="board-add-evidence-blocked"
            >
              Add evidence
            </span>
          ) : (
            <Link className="board-canvas__link" to={`${casePath}/capture`}>
              Add evidence
            </Link>
          )}
          <Link className="board-canvas__link" to={`${casePath}/list`} data-testid="open-card-list">
            Open card list
          </Link>
        </div>
      ) : null}

      {status === 'initializing' ? (
        <p className="board-canvas__notice" role="status" aria-live="polite">
          Preparing the board canvas…
        </p>
      ) : null}

      {status === 'error' ? (
        <section
          className="board-canvas__fallback"
          role="alert"
          aria-labelledby="board-error-title"
        >
          <h3 id="board-error-title">The board canvas could not start</h3>
          <p>
            {error ??
              'This browser may not support the graphics mode the board needs. Your cards are still safe.'}
          </p>
          <div className="board-canvas__fallback-actions">
            <Button variant="primary" onClick={retry}>
              Retry board
            </Button>
            <Link className="board-canvas__fallback-link" to={`${casePath}/list`}>
              Open card list
            </Link>
          </div>
        </section>
      ) : null}

      {contextLost ? (
        <section
          className="board-canvas__fallback"
          role="alert"
          aria-labelledby="board-context-title"
        >
          <h3 id="board-context-title">The board lost its graphics context</h3>
          <p>
            The camera and every card are still stored. Restore the board, or use the card list
            while graphics are unavailable.
          </p>
          <div className="board-canvas__fallback-actions">
            <Button variant="primary" onClick={recover}>
              Restore board
            </Button>
            <Link className="board-canvas__fallback-link" to={`${casePath}/list`}>
              Open card list
            </Link>
          </div>
        </section>
      ) : null}
    </section>
  );
}

export default BoardCanvas;
