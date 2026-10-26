/**
 * Board UI state.
 *
 * This store owns the live camera, the last persisted camera, temporary
 * viewports (fit and recall), selection, hover, board mode, and the pointer
 * gesture state machine's current state.
 *
 * Boundary rules:
 *
 * - No PixiJS import. The scene reads the snapshot and emits intents; it does
 *   not call this store's persistence-adjacent actions directly.
 * - No Dexie import and no storage write. The page observes `viewportDirty`,
 *   debounces a repository call, then calls `markViewportPersisted(snapshot)`.
 * - No React component import. The store is a vanilla Zustand store so it can
 *   be exercised in a Node unit test. React screens bind it with
 *   `useStore(boardStore, selector)` in the canvas layer.
 *
 * Viewport persistence contract:
 *
 * 1. `hydrateViewport(saved)` restores the repo viewport without marking dirty.
 * 2. Pan/zoom/temporary changes call `moveViewport`, which clears the temporary
 *    viewport and marks the camera dirty when it differs from the persisted one.
 * 3. Fit and recall use `applyTemporaryViewport`. They change the live camera
 *    and expose `pendingViewport`, but never touch `storedViewport` and never
 *    set `viewportDirty`.
 * 4. `markViewportPersisted` refuses to write while the camera is clean, so a
 *    temporary fit cannot accidentally overwrite the stored camera.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';

import type { Viewport } from '../domain/model';
import {
  DEFAULT_BOARD_VIEWPORT,
  normalizeViewport,
  panViewport,
  viewportsEqual,
  zoomViewportAt,
  zoomViewportToScale,
  type BoardPoint,
} from './viewport';

/** Board interaction modes. Recall is a route mode; browse is the default. */
export const BOARD_MODES = ['browse', 'connect', 'recall'] as const;
export type BoardMode = (typeof BOARD_MODES)[number];

export interface IdleGesture {
  readonly kind: 'idle';
}

/** A one-pointer background drag. Coordinates are screen space. */
export interface PanGesture {
  readonly kind: 'pan';
  readonly pointerId: number;
  readonly start: BoardPoint;
  readonly current: BoardPoint;
}

/** Two-pointer zoom. The anchor and start points are screen space. */
export interface PinchGesture {
  readonly kind: 'pinch';
  readonly pointerIds: readonly [number, number];
  readonly startDistance: number;
  readonly startScale: number;
  readonly anchor: BoardPoint;
}

/**
 * Touch pointer-down on a card before the 500ms lift. A movement over 6px or a
 * release under 500ms resolves to a pan/tap instead of a drag.
 */
export interface PressGesture {
  readonly kind: 'press';
  readonly pointerId: number;
  readonly cardId: string;
  readonly start: BoardPoint;
  readonly current: BoardPoint;
  readonly startedAt: number;
}

/** A lifted card following the pointer. `grabOffset` and `position` are world space. */
export interface CardDragGesture {
  readonly kind: 'drag-card';
  readonly pointerId: number;
  readonly cardId: string;
  readonly grabOffset: BoardPoint;
  readonly position: BoardPoint;
}

/** A temporary thread being dragged from an anchor. `current` is world space. */
export interface ConnectGesture {
  readonly kind: 'connect';
  readonly pointerId: number;
  readonly fromCardId: string;
  readonly current: BoardPoint;
}

export type BoardGesture =
  IdleGesture | PanGesture | PinchGesture | PressGesture | CardDragGesture | ConnectGesture;

export type BoardGestureKind = BoardGesture['kind'];

export const IDLE_GESTURE: Readonly<IdleGesture> = Object.freeze({ kind: 'idle' });

/**
 * The plain board snapshot consumed by the scene and the DOM chrome. Nothing in
 * this object is persisted by the store itself.
 */
export interface BoardState {
  /** The camera currently shown. */
  readonly viewport: Viewport;
  /** The last camera the repository accepted, or the initial camera. */
  readonly storedViewport: Viewport;
  /** A fit/recall camera that is not yet a student movement. */
  readonly pendingViewport: Viewport | null;
  /** True once the student moves the camera away from `storedViewport`. */
  readonly viewportDirty: boolean;
  readonly selectedCardId: string | null;
  readonly selectedConnectionId: string | null;
  readonly hoveredCardId: string | null;
  readonly mode: BoardMode;
  readonly gesture: BoardGesture;
}

export interface BoardActions {
  /**
   * Replace the stored camera after loading a case. Does not mark dirty and
   * clears any temporary fit/recall camera.
   */
  hydrateViewport(viewport: Viewport): void;
  /**
   * Record a student camera movement. Stored camera is left for the debounced
   * save; a temporary viewport is cleared.
   */
  moveViewport(viewport: Viewport): void;
  /** Pan by a screen-space pointer delta and mark the camera as moved. */
  panBy(delta: BoardPoint): void;
  /** Multiplicative zoom around a screen anchor and mark the camera as moved. */
  zoomAt(anchor: BoardPoint, factor: number): void;
  /** Absolute zoom around a screen anchor and mark the camera as moved. */
  zoomTo(anchor: BoardPoint, scale: number): void;
  /**
   * Show a fit or recall camera without persisting it. `storedViewport` is
   * untouched so returning to the case restores the student's last position.
   */
  applyTemporaryViewport(viewport: Viewport): void;
  /** Return to the stored camera (for example after leaving recall). */
  restoreStoredViewport(): void;
  /**
   * Complete a debounced persistence pass. Accepts the exact snapshot that was
   * written so a movement during the async save leaves the camera dirty. A no-op
   * while the camera is clean, which protects a fit/recall viewport.
   */
  markViewportPersisted(saved?: Viewport): void;
  selectCard(cardId: string | null): void;
  /** Select an existing string, used when a duplicate drop selects its row. */
  selectConnection(connectionId: string | null): void;
  setHoveredCard(cardId: string | null): void;
  setMode(mode: BoardMode): void;
  setGesture(gesture: BoardGesture): void;
  resetGesture(): void;
  /** Reset every board interaction slice, optionally with a different camera. */
  resetBoard(initialViewport?: Viewport): void;
}

export type BoardStore = BoardState & BoardActions;
export type BoardStoreApi = StoreApi<BoardStore>;

function movementPatch(state: BoardState, nextViewport: Viewport): Partial<BoardState> {
  const viewport = normalizeViewport(nextViewport);

  return {
    viewport,
    pendingViewport: null,
    viewportDirty: !viewportsEqual(viewport, state.storedViewport),
  };
}

/**
 * Create an isolated board store. Tests and future multi-canvas screens use the
 * factory; the app uses the `boardStore` singleton.
 */
export function createBoardStore(
  initialViewport: Viewport = DEFAULT_BOARD_VIEWPORT,
): BoardStoreApi {
  return createStore<BoardStore>()((set, get) => ({
    ...createInitialBoardState(initialViewport),

    hydrateViewport(viewport) {
      const normalized = normalizeViewport(viewport);
      set({
        viewport: normalized,
        storedViewport: normalized,
        pendingViewport: null,
        viewportDirty: false,
      });
    },

    moveViewport(viewport) {
      set(movementPatch(get(), viewport));
    },

    panBy(delta) {
      if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
        return;
      }

      const state = get();
      set(movementPatch(state, panViewport(state.viewport, delta)));
    },

    zoomAt(anchor, factor) {
      if (!Number.isFinite(factor) || factor <= 0) {
        return;
      }

      const state = get();
      set(movementPatch(state, zoomViewportAt(state.viewport, anchor, factor)));
    },

    zoomTo(anchor, scale) {
      if (!Number.isFinite(scale) || scale <= 0) {
        return;
      }

      const state = get();
      set(movementPatch(state, zoomViewportToScale(state.viewport, scale, anchor)));
    },

    applyTemporaryViewport(viewport) {
      const normalized = normalizeViewport(viewport);
      set({
        viewport: normalized,
        pendingViewport: normalized,
        viewportDirty: false,
      });
    },

    restoreStoredViewport() {
      const stored = normalizeViewport(get().storedViewport);
      set({
        viewport: stored,
        pendingViewport: null,
        viewportDirty: false,
      });
    },

    markViewportPersisted(saved) {
      const state = get();

      // A clean camera is a restored or temporary camera. Writing it here would
      // let fit/recall overwrite the student's stored position.
      if (!state.viewportDirty) {
        return;
      }

      const persisted = normalizeViewport(saved ?? state.viewport);
      set({
        storedViewport: persisted,
        viewportDirty: !viewportsEqual(state.viewport, persisted),
      });
    },

    selectCard(cardId) {
      set({ selectedCardId: cardId });
    },

    selectConnection(connectionId) {
      set({ selectedConnectionId: connectionId });
    },

    setHoveredCard(cardId) {
      set({ hoveredCardId: cardId });
    },

    setMode(mode) {
      set({ mode });
    },

    setGesture(gesture) {
      set({ gesture });
    },

    resetGesture() {
      set({ gesture: IDLE_GESTURE });
    },

    resetBoard(initialViewport = DEFAULT_BOARD_VIEWPORT) {
      set(createInitialBoardState(initialViewport));
    },
  }));
}

export function createInitialBoardState(
  initialViewport: Viewport = DEFAULT_BOARD_VIEWPORT,
): BoardState {
  const viewport = normalizeViewport(initialViewport);

  return {
    viewport,
    storedViewport: viewport,
    pendingViewport: null,
    viewportDirty: false,
    selectedCardId: null,
    selectedConnectionId: null,
    hoveredCardId: null,
    mode: 'browse',
    gesture: IDLE_GESTURE,
  };
}

/** The application board store. The canvas binds it; tests create isolated stores. */
export const boardStore: BoardStoreApi = createBoardStore();

/*
 * Selectors. Each returns a primitive or an existing state reference, so React
 * consumption allocates no new object per render. Derived values (selected
 * outline, hover shadow, mode checks) are computed by the caller from these
 * primitives.
 */

export const selectViewport = (state: BoardState): Viewport => state.viewport;
export const selectStoredViewport = (state: BoardState): Viewport => state.storedViewport;
export const selectPendingViewport = (state: BoardState): Viewport | null => state.pendingViewport;
export const selectViewportDirty = (state: BoardState): boolean => state.viewportDirty;
export const selectScale = (state: BoardState): number => state.viewport.scale;
export const selectSelectedCardId = (state: BoardState): string | null => state.selectedCardId;
export const selectSelectedConnectionId = (state: BoardState): string | null =>
  state.selectedConnectionId;
export const selectHoveredCardId = (state: BoardState): string | null => state.hoveredCardId;
export const selectMode = (state: BoardState): BoardMode => state.mode;
export const selectGesture = (state: BoardState): BoardGesture => state.gesture;
export const selectGestureKind = (state: BoardState): BoardGestureKind => state.gesture.kind;
export const selectIsInteracting = (state: BoardState): boolean => state.gesture.kind !== 'idle';
export const selectIsCardSelected = (state: BoardState, cardId: string): boolean =>
  state.selectedCardId === cardId;
export const selectIsCardHovered = (state: BoardState, cardId: string): boolean =>
  state.hoveredCardId === cardId;
