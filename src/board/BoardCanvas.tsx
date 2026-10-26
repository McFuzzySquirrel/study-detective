/**
 * The lazy Pixi board canvas and its DOM chrome.
 *
 * This module is the only React entry point into `src/board`. It is loaded by
 * `CaseBoardPage` with `React.lazy`, so `pixi.js` never enters the initial app
 * shell chunk. The component owns the host element, pointer intents, and the
 * accessible controls; `usePixiApp` owns renderer and texture teardown.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useStore } from 'zustand';

import Button from '../components/Button';

import type { BoardSnapshot } from './BoardScene';
import { attachBoardInput } from './boardInput';
import { boardStore } from './boardStore';
import type { BoardStoreApi } from './boardStore';
import { selectViewport } from './boardStore';
import { SPLIT_CASE_MESSAGE } from './boardCapacity';
import FitToViewButton from './FitToViewButton';
import Minimap from './Minimap';
import { useCulling } from './useCulling';
import { useCardGestures } from './useCardGestures';
import type { CardDragUpdate } from './useCardGestures';
import { findCardAtPoint } from './useCardGestures';
import { usePixiApp } from './usePixiApp';
import { DEFAULT_BOARD_VIEWPORT } from './viewport';
import type { BoardPoint } from './viewport';

import './BoardCanvas.css';

/** Written to both the canvas host and the generated PixiJS canvas. */
export const BOARD_CANVAS_LABEL =
  'Case board canvas. Drag the cork to pan. Drag a card to move it. Pinch or scroll to zoom. Use the controls for zoom and reset.';

const ZOOM_STEP = 1.25;

export interface BoardCanvasProps {
  readonly snapshot: BoardSnapshot;
  /** Injected store for component tests and future multi-board screens. */
  readonly store?: BoardStoreApi | undefined;
  /**
   * Called once when a drag ends. The page debounces the repository update; the
   * canvas never writes a position itself.
   */
  readonly onCardMoved?: ((cardId: string, position: BoardPoint) => void) | undefined;
  /** Override the default navigation to card detail, for tests. */
  readonly onCardTap?: ((cardId: string) => void) | undefined;
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
  onCardMoved,
  onCardTap,
  cardLimitReached = false,
}: BoardCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeStore = store ?? boardStore;
  const viewport = useStore(activeStore, selectViewport);
  const reducedMotion = usePrefersReducedMotion();
  const navigate = useNavigate();

  const snapshotRef = useRef(snapshot);
  const reducedMotionRef = useRef(reducedMotion);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

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
  } = usePixiApp({
    hostRef,
    snapshot,
    viewport,
    canvasLabel: BOARD_CANVAS_LABEL,
  });

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
      // A pointer that lands on a card belongs to the card gesture controller;
      // the cork only pans when the press starts on empty board.
      shouldStartPan: (point) =>
        findCardAtPoint(snapshotRef.current.cards, activeStore.getState().viewport, point) === null,
    });

    return () => input.destroy();
  }, [activeStore]);

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

      if (onCardTap !== undefined) {
        onCardTap(cardId);
        return;
      }

      navigate(`/case/${snapshot.caseId}/card/${cardId}`);
    },
    [activeStore, navigate, onCardTap, setCardLiftedInScene, snapshot.caseId],
  );

  useCardGestures(hostRef, {
    getCardAt: (point) => {
      const card = findCardAtPoint(
        snapshotRef.current.cards,
        activeStore.getState().viewport,
        point,
      );
      return card?.id ?? null;
    },
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

  return (
    <section
      className="board-canvas"
      aria-label="Case board"
      data-testid="board-canvas"
      data-board-viewport-x={formatViewportValue(viewport.x)}
      data-board-viewport-y={formatViewportValue(viewport.y)}
      data-board-scale={formatScale(viewport.scale)}
      data-board-card-count={snapshot.cards.length}
      data-board-visible-card-count={visibleCards.length}
      data-board-card-positions={cardPositions}
      data-board-scene-status={sceneStatus}
      data-board-context-lost={contextLost ? 'true' : 'false'}
      aria-busy={status === 'initializing'}
    >
      <div
        ref={hostRef}
        className="board-canvas__host"
        data-testid="board-canvas-host"
        role="group"
        aria-label="Case board canvas"
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

      {status !== 'error' && !contextLost ? (
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
          <Link className="board-canvas__link" to={`${casePath}/list`}>
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
