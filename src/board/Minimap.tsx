/**
 * The board minimap.
 *
 * The minimap is a DOM/SVG overview, not a second Pixi scene. It projects the
 * card rectangles and the current camera's visible world rectangle through the
 * same pure viewport helpers the canvas uses, so the inset can never disagree
 * with the board about where the camera is.
 *
 * Interaction is pointer-only, matching the canvas boundary: a tap centres the
 * board on the tapped world point and a drag continuously moves the camera.
 * The minimap defaults to collapsed on phone widths and can always be toggled.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { Viewport } from '../domain/model';
import Button from '../components/Button';

import type { BoardCardSnapshot } from './CardSprite';
import { boardStore } from './boardStore';
import type { BoardStoreApi } from './boardStore';
import {
  BOARD_CARD_HEIGHT,
  BOARD_CARD_WIDTH,
  computeCardsBounds,
  computeVisibleWorldRect,
  normalizeViewport,
  projectViewportToMinimap,
  projectWorldRectToMinimap,
  unionWorldRects,
  unprojectMinimapPoint,
  type BoardPoint,
  type BoardSize,
  type WorldRect,
} from './viewport';

/** The fixed inset width in SVG units. */
export const MINIMAP_WIDTH = 200;
/** The fixed inset height in SVG units. */
export const MINIMAP_HEIGHT = 140;

const MINIMAP_SIZE: Readonly<BoardSize> = Object.freeze({
  width: MINIMAP_WIDTH,
  height: MINIMAP_HEIGHT,
});

const MINIMAP_PADDING = 8;

export interface MinimapProps {
  readonly cards: readonly BoardCardSnapshot[];
  readonly viewport: Viewport;
  /** The canvas size in CSS pixels, used for the visible-world rectangle. */
  readonly viewportSize: BoardSize;
  /** Injected store for component tests or multi-board screens. */
  readonly store?: BoardStoreApi | undefined;
  /** Optional camera intent; when omitted the store's `moveViewport` is used. */
  readonly onNavigate?: ((viewport: Viewport) => void) | undefined;
  readonly className?: string | undefined;
}

function isPhoneWidth(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(max-width: 40rem)').matches;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The world bounds the inset must show: every card plus the camera window. */
function computeMinimapWorldBounds(
  cards: readonly BoardCardSnapshot[],
  viewport: Viewport,
  viewportSize: BoardSize,
): WorldRect | null {
  const cardBounds = computeCardsBounds(
    cards.map((card) => card.position),
    { width: BOARD_CARD_WIDTH, height: BOARD_CARD_HEIGHT },
  );

  return unionWorldRects([cardBounds, computeVisibleWorldRect(viewport, viewportSize)]);
}

/**
 * The world point at the centre of the camera after a minimap navigation.
 */
function minimapCenteredViewport(
  worldPoint: BoardPoint,
  scale: number,
  viewportSize: BoardSize,
): Viewport {
  const safeScale = normalizeViewport({ x: 0, y: 0, scale }).scale;
  const width = Number.isFinite(viewportSize.width) ? Math.max(1, viewportSize.width) : 1;
  const height = Number.isFinite(viewportSize.height) ? Math.max(1, viewportSize.height) : 1;

  return {
    x: worldPoint.x - width / (2 * safeScale),
    y: worldPoint.y - height / (2 * safeScale),
    scale: safeScale,
  };
}

/** The minimap inset with a toggle, card overview, and camera rectangle. */
export function Minimap({
  cards,
  viewport,
  viewportSize,
  store,
  onNavigate,
  className,
}: MinimapProps) {
  const [open, setOpen] = useState(() => !isPhoneWidth());
  const panelId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragPointerRef = useRef<number | null>(null);
  const dragBoundsRef = useRef<WorldRect | null>(null);

  const bounds = useMemo(
    () => computeMinimapWorldBounds(cards, viewport, viewportSize),
    [cards, viewport, viewportSize],
  );

  const viewportRect = useMemo(
    () => projectViewportToMinimap(viewport, viewportSize, bounds, MINIMAP_SIZE, MINIMAP_PADDING),
    [bounds, viewport, viewportSize],
  );

  const cardRects = useMemo(
    () =>
      cards.map((card) => ({
        id: card.id,
        rect: projectWorldRectToMinimap(
          {
            x: card.position.x,
            y: card.position.y,
            width: BOARD_CARD_WIDTH,
            height: BOARD_CARD_HEIGHT,
          },
          bounds,
          MINIMAP_SIZE,
          MINIMAP_PADDING,
        ),
      })),
    [bounds, cards],
  );

  const navigateAtEvent = useCallback(
    (clientX: number, clientY: number, worldBounds: WorldRect | null): void => {
      const svg = svgRef.current;
      if (svg === null || worldBounds === null) {
        return;
      }

      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const local = {
        x: clamp(((clientX - rect.left) / rect.width) * MINIMAP_SIZE.width, 0, MINIMAP_SIZE.width),
        y: clamp(
          ((clientY - rect.top) / rect.height) * MINIMAP_SIZE.height,
          0,
          MINIMAP_SIZE.height,
        ),
      };
      const world = unprojectMinimapPoint(local, worldBounds, MINIMAP_SIZE, MINIMAP_PADDING);
      const next = minimapCenteredViewport(world, viewport.scale, viewportSize);

      if (onNavigate !== undefined) {
        onNavigate(next);
        return;
      }

      (store ?? boardStore).getState().moveViewport(next);
    },
    [onNavigate, store, viewport.scale, viewportSize],
  );

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    event.preventDefault();
    dragPointerRef.current = event.pointerId;
    dragBoundsRef.current = bounds;

    const svg = event.currentTarget;
    if (typeof svg.setPointerCapture === 'function') {
      svg.setPointerCapture(event.pointerId);
    }

    navigateAtEvent(event.clientX, event.clientY, bounds);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (dragPointerRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    navigateAtEvent(event.clientX, event.clientY, dragBoundsRef.current ?? bounds);
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (dragPointerRef.current !== event.pointerId) {
      return;
    }

    dragPointerRef.current = null;
    dragBoundsRef.current = null;

    const svg = event.currentTarget;
    if (typeof svg.releasePointerCapture === 'function') {
      try {
        svg.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may already have released capture on pointercancel.
      }
    }
  };

  return (
    <div className={className === undefined ? 'board-minimap' : `board-minimap ${className}`}>
      <Button
        variant="quiet"
        className="board-minimap__toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? 'Hide minimap' : 'Show minimap'}
      </Button>

      {open ? (
        <div className="board-minimap__panel" id={panelId} data-testid="board-minimap-panel">
          <svg
            ref={svgRef}
            className="board-minimap__svg"
            viewBox={`0 0 ${MINIMAP_SIZE.width} ${MINIMAP_SIZE.height}`}
            role="img"
            aria-label="Board minimap. Pointer only: tap or drag to move the board view."
            data-testid="board-minimap"
            data-minimap-card-count={cards.length}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <rect
              className="board-minimap__background"
              x={0}
              y={0}
              width={MINIMAP_SIZE.width}
              height={MINIMAP_SIZE.height}
              rx={4}
            />

            <g className="board-minimap__cards">
              {cardRects.map(({ id, rect }) => (
                <rect
                  key={id}
                  className="board-minimap__card"
                  data-minimap-card={id}
                  x={rect.x}
                  y={rect.y}
                  width={Math.max(1, rect.width)}
                  height={Math.max(1, rect.height)}
                  rx={0.75}
                />
              ))}
            </g>

            <rect
              className="board-minimap__viewport"
              data-testid="board-minimap-viewport"
              data-minimap-viewport-x={viewportRect.x.toFixed(3)}
              data-minimap-viewport-y={viewportRect.y.toFixed(3)}
              data-minimap-viewport-width={viewportRect.width.toFixed(3)}
              data-minimap-viewport-height={viewportRect.height.toFixed(3)}
              x={viewportRect.x}
              y={viewportRect.y}
              width={Math.max(1, viewportRect.width)}
              height={Math.max(1, viewportRect.height)}
              rx={1.5}
            />
          </svg>
        </div>
      ) : null}
    </div>
  );
}

export default Minimap;
