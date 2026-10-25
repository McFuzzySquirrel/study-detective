/**
 * The lazy Pixi board canvas and its DOM chrome.
 *
 * This module is the only React entry point into `src/board`. It is loaded by
 * `CaseBoardPage` with `React.lazy`, so `pixi.js` never enters the initial app
 * shell chunk. The component owns the host element, pointer intents, and the
 * accessible controls; `usePixiApp` owns renderer and texture teardown.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useStore } from 'zustand';

import Button from '../components/Button';

import type { BoardSnapshot } from './BoardScene';
import { attachBoardInput } from './boardInput';
import { boardStore } from './boardStore';
import type { BoardStoreApi } from './boardStore';
import { selectViewport } from './boardStore';
import { usePixiApp } from './usePixiApp';
import { DEFAULT_BOARD_VIEWPORT } from './viewport';
import type { BoardPoint } from './viewport';

import './BoardCanvas.css';

/** Written to both the canvas host and the generated PixiJS canvas. */
export const BOARD_CANVAS_LABEL =
  'Case board canvas. Drag the cork to pan. Pinch or scroll to zoom. Use the controls for zoom and reset.';

const ZOOM_STEP = 1.25;

export interface BoardCanvasProps {
  readonly snapshot: BoardSnapshot;
  /** Injected store for component tests and future multi-board screens. */
  readonly store?: BoardStoreApi | undefined;
}

function formatViewportValue(value: number): string {
  return value.toFixed(3);
}

function formatScale(value: number): string {
  return value.toFixed(4);
}

/** The styled canvas surface, controls, and recoverable renderer states. */
export function BoardCanvas({ snapshot, store }: BoardCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeStore = store ?? boardStore;
  const viewport = useStore(activeStore, selectViewport);

  const { status, error, contextLost, retry, recover } = usePixiApp({
    hostRef,
    snapshot,
    viewport,
    canvasLabel: BOARD_CANVAS_LABEL,
  });

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
    });

    return () => input.destroy();
  }, [activeStore]);

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

  return (
    <section
      className="board-canvas"
      aria-label="Case board"
      data-testid="board-canvas"
      data-board-viewport-x={formatViewportValue(viewport.x)}
      data-board-viewport-y={formatViewportValue(viewport.y)}
      data-board-scale={formatScale(viewport.scale)}
      data-board-card-count={snapshot.cards.length}
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
        <Button variant="quiet" onClick={resetView} aria-label="Reset view">
          Reset view
        </Button>
      </div>

      {status !== 'error' && !contextLost ? (
        <div className="board-canvas__links">
          <Link className="board-canvas__link" to={`${casePath}/capture`}>
            Add evidence
          </Link>
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
