// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  boardStore,
  createBoardStore,
  selectGesture,
  selectGestureKind,
  selectHoveredCardId,
  selectIsCardHovered,
  selectIsCardSelected,
  selectIsInteracting,
  selectMode,
  selectPendingViewport,
  selectScale,
  selectSelectedCardId,
  selectStoredViewport,
  selectViewport,
  selectViewportDirty,
  type BoardGesture,
} from '../../src/board/boardStore';
import {
  DEFAULT_BOARD_VIEWPORT,
  MAX_BOARD_SCALE,
  MIN_BOARD_SCALE,
  screenToWorld,
} from '../../src/board/viewport';

const SAVED_VIEWPORT = { x: -240, y: 96, scale: 1.75 } as const;
const FIT_VIEWPORT = { x: -520, y: -240, scale: 1 } as const;

function expectClosePoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe('board store initial state', () => {
  it('starts with the default camera and empty interaction state', () => {
    const state = createBoardStore().getState();

    expect(state.viewport).toEqual(DEFAULT_BOARD_VIEWPORT);
    expect(state.storedViewport).toEqual(DEFAULT_BOARD_VIEWPORT);
    expect(state.pendingViewport).toBeNull();
    expect(state.viewportDirty).toBe(false);
    expect(state.selectedCardId).toBeNull();
    expect(state.hoveredCardId).toBeNull();
    expect(state.mode).toBe('browse');
    expect(state.gesture).toEqual({ kind: 'idle' });
  });

  it('clamps a corrupted initial viewport into the supported range', () => {
    const state = createBoardStore({ x: Number.NaN, y: 42, scale: 12 }).getState();

    expect(state.viewport).toEqual({ x: 0, y: 42, scale: MAX_BOARD_SCALE });
    expect(state.storedViewport).toEqual({ x: 0, y: 42, scale: MAX_BOARD_SCALE });
    expect(state.viewportDirty).toBe(false);
  });

  it('creates isolated stores', () => {
    const first = createBoardStore();
    const second = createBoardStore();

    first.getState().selectCard('card-a');

    expect(second.getState().selectedCardId).toBeNull();
    expect(boardStore.getState().selectedCardId).toBeNull();
  });
});

describe('slice-only actions', () => {
  it('selection changes only selectedCardId', () => {
    const store = createBoardStore();
    const before = store.getState();

    store.getState().selectCard('card-a');
    const after = store.getState();

    expect(after.selectedCardId).toBe('card-a');
    expect(after.viewport).toBe(before.viewport);
    expect(after.storedViewport).toBe(before.storedViewport);
    expect(after.pendingViewport).toBe(before.pendingViewport);
    expect(after.viewportDirty).toBe(before.viewportDirty);
    expect(after.hoveredCardId).toBe(before.hoveredCardId);
    expect(after.mode).toBe(before.mode);
    expect(after.gesture).toBe(before.gesture);

    store.getState().selectCard(null);
    expect(store.getState().selectedCardId).toBeNull();
  });

  it('hover changes only hoveredCardId', () => {
    const store = createBoardStore();
    const before = store.getState();

    store.getState().setHoveredCard('card-b');
    const after = store.getState();

    expect(after.hoveredCardId).toBe('card-b');
    expect(after.viewport).toBe(before.viewport);
    expect(after.selectedCardId).toBe(before.selectedCardId);
    expect(after.mode).toBe(before.mode);
    expect(after.gesture).toBe(before.gesture);
    expect(after.viewportDirty).toBe(false);
  });

  it('mode changes only mode', () => {
    const store = createBoardStore();
    const before = store.getState();

    store.getState().setMode('connect');
    const after = store.getState();

    expect(after.mode).toBe('connect');
    expect(after.viewport).toBe(before.viewport);
    expect(after.selectedCardId).toBe(before.selectedCardId);
    expect(after.hoveredCardId).toBe(before.hoveredCardId);
    expect(after.gesture).toBe(before.gesture);

    store.getState().setMode('recall');
    expect(store.getState().mode).toBe('recall');
    store.getState().setMode('browse');
    expect(store.getState().mode).toBe('browse');
  });

  it('gesture changes only gesture', () => {
    const store = createBoardStore();
    const before = store.getState();
    const pan: BoardGesture = {
      kind: 'pan',
      pointerId: 1,
      start: { x: 10, y: 10 },
      current: { x: 40, y: 30 },
    };

    store.getState().setGesture(pan);
    const after = store.getState();

    expect(after.gesture).toBe(pan);
    expect(after.viewport).toBe(before.viewport);
    expect(after.storedViewport).toBe(before.storedViewport);
    expect(after.selectedCardId).toBe(before.selectedCardId);
    expect(after.mode).toBe(before.mode);

    store.getState().resetGesture();
    expect(store.getState().gesture).toEqual({ kind: 'idle' });
    expect(store.getState().viewport).toBe(before.viewport);
  });
});

describe('camera movement', () => {
  it('pans by screen delta, marks dirty, and leaves stored camera alone', () => {
    const store = createBoardStore();
    const before = store.getState();

    store.getState().panBy({ x: 100, y: -50 });
    const after = store.getState();

    expect(after.viewport).toEqual({ x: -100, y: 50, scale: 1 });
    expect(after.storedViewport).toEqual(DEFAULT_BOARD_VIEWPORT);
    expect(after.pendingViewport).toBeNull();
    expect(after.viewportDirty).toBe(true);
    expect(after.selectedCardId).toBe(before.selectedCardId);
    expect(after.hoveredCardId).toBe(before.hoveredCardId);
    expect(after.mode).toBe(before.mode);
    expect(after.gesture).toBe(before.gesture);
  });

  it('divides pan by the current zoom', () => {
    const store = createBoardStore(SAVED_VIEWPORT);

    store.getState().panBy({ x: 70, y: -35 });

    expect(store.getState().viewport.x).toBeCloseTo(SAVED_VIEWPORT.x - 70 / 1.75, 12);
    expect(store.getState().viewport.y).toBeCloseTo(SAVED_VIEWPORT.y + 35 / 1.75, 12);
    expect(store.getState().viewport.scale).toBe(1.75);
    expect(store.getState().viewportDirty).toBe(true);
  });

  it('ignores non-finite pan deltas without touching state', () => {
    const store = createBoardStore();
    const before = store.getState();

    store.getState().panBy({ x: Number.NaN, y: Number.POSITIVE_INFINITY });

    expect(store.getState()).toBe(before);
  });

  it('zooms around the pointer anchor and marks dirty', () => {
    const store = createBoardStore();
    const anchor = { x: 640, y: 400 };
    const worldBefore = screenToWorld(anchor, store.getState().viewport);

    store.getState().zoomAt(anchor, 1.75);
    const after = store.getState();

    expect(after.viewport.scale).toBe(1.75);
    expect(after.viewportDirty).toBe(true);
    expect(after.storedViewport).toEqual(DEFAULT_BOARD_VIEWPORT);
    expectClosePoint(screenToWorld(anchor, after.viewport), worldBefore);
  });

  it('clamps zoom at both limits and keeps the anchor', () => {
    const store = createBoardStore();
    const anchor = { x: 320, y: 240 };
    const worldBefore = screenToWorld(anchor, store.getState().viewport);

    store.getState().zoomAt(anchor, 1000);
    expect(store.getState().viewport.scale).toBe(MAX_BOARD_SCALE);
    expectClosePoint(screenToWorld(anchor, store.getState().viewport), worldBefore);

    store.getState().zoomAt(anchor, 0.0001);
    expect(store.getState().viewport.scale).toBe(MIN_BOARD_SCALE);
    expectClosePoint(screenToWorld(anchor, store.getState().viewport), worldBefore);
  });

  it('supports absolute zoom and ignores invalid values', () => {
    const store = createBoardStore();
    const before = store.getState();

    store.getState().zoomTo({ x: 100, y: 100 }, 1.3);
    expect(store.getState().viewport.scale).toBe(1.3);
    expect(store.getState().viewportDirty).toBe(true);

    const afterValidZoom = store.getState();
    store.getState().zoomTo({ x: 100, y: 100 }, Number.NaN);
    store.getState().zoomTo({ x: 100, y: 100 }, 0);
    store.getState().zoomAt({ x: 100, y: 100 }, Number.NaN);

    expect(store.getState()).toBe(afterValidZoom);
    expect(afterValidZoom.selectedCardId).toBe(before.selectedCardId);
  });

  it('hydrates a saved camera without marking it dirty', () => {
    const store = createBoardStore();

    store.getState().hydrateViewport(SAVED_VIEWPORT);

    expect(store.getState().viewport).toEqual(SAVED_VIEWPORT);
    expect(store.getState().storedViewport).toEqual(SAVED_VIEWPORT);
    expect(store.getState().pendingViewport).toBeNull();
    expect(store.getState().viewportDirty).toBe(false);
  });

  it('hydrate clamps a corrupted saved camera', () => {
    const store = createBoardStore();

    store.getState().hydrateViewport({ x: 10, y: 20, scale: 0.001 });

    expect(store.getState().viewport).toEqual({ x: 10, y: 20, scale: MIN_BOARD_SCALE });
    expect(store.getState().storedViewport).toEqual({ x: 10, y: 20, scale: MIN_BOARD_SCALE });
  });
});

describe('temporary fit and recall viewports', () => {
  it('does not overwrite the stored camera until the student moves', () => {
    const store = createBoardStore(SAVED_VIEWPORT);

    store.getState().applyTemporaryViewport(FIT_VIEWPORT);

    expect(store.getState().viewport).toEqual(FIT_VIEWPORT);
    expect(store.getState().pendingViewport).toEqual(FIT_VIEWPORT);
    expect(store.getState().storedViewport).toEqual(SAVED_VIEWPORT);
    expect(store.getState().viewportDirty).toBe(false);

    // Even an accidental persistence pass while the camera is clean is a no-op.
    store.getState().markViewportPersisted();
    expect(store.getState().storedViewport).toEqual(SAVED_VIEWPORT);
    expect(store.getState().viewportDirty).toBe(false);

    store.getState().panBy({ x: 10, y: 10 });
    expect(store.getState().pendingViewport).toBeNull();
    expect(store.getState().viewportDirty).toBe(true);
    expect(store.getState().storedViewport).toEqual(SAVED_VIEWPORT);
  });

  it('restores the stored camera and clears the temporary viewport', () => {
    const store = createBoardStore(SAVED_VIEWPORT);

    store.getState().applyTemporaryViewport(FIT_VIEWPORT);
    store.getState().restoreStoredViewport();

    expect(store.getState().viewport).toEqual(SAVED_VIEWPORT);
    expect(store.getState().pendingViewport).toBeNull();
    expect(store.getState().viewportDirty).toBe(false);
    expect(store.getState().storedViewport).toEqual(SAVED_VIEWPORT);
  });

  it('keeps the camera dirty if it moved again during the async save', () => {
    const store = createBoardStore(SAVED_VIEWPORT);

    store.getState().panBy({ x: 100, y: 100 });
    const snapshot = store.getState().viewport;

    store.getState().panBy({ x: 100, y: 100 });
    store.getState().markViewportPersisted(snapshot);

    expect(store.getState().storedViewport).toEqual(snapshot);
    expect(store.getState().viewportDirty).toBe(true);

    store.getState().markViewportPersisted();
    expect(store.getState().storedViewport).toEqual(store.getState().viewport);
    expect(store.getState().viewportDirty).toBe(false);
  });

  it('does not change selection, hover, mode, or gesture when the camera changes', () => {
    const store = createBoardStore();
    store.getState().selectCard('card-a');
    store.getState().setHoveredCard('card-b');
    store.getState().setMode('connect');
    store.getState().setGesture({
      kind: 'drag-card',
      pointerId: 3,
      cardId: 'card-a',
      grabOffset: { x: 12, y: 8 },
      position: { x: 100, y: 200 },
    });
    const before = store.getState();

    store.getState().applyTemporaryViewport(FIT_VIEWPORT);
    expect(store.getState().selectedCardId).toBe(before.selectedCardId);
    expect(store.getState().hoveredCardId).toBe(before.hoveredCardId);
    expect(store.getState().mode).toBe(before.mode);
    expect(store.getState().gesture).toBe(before.gesture);

    store.getState().restoreStoredViewport();
    store.getState().hydrateViewport(SAVED_VIEWPORT);

    expect(store.getState().selectedCardId).toBe('card-a');
    expect(store.getState().hoveredCardId).toBe('card-b');
    expect(store.getState().mode).toBe('connect');
    expect(store.getState().gesture).toBe(before.gesture);
  });
});

describe('board reset', () => {
  it('resets every slice and keeps the actions usable', () => {
    const store = createBoardStore(SAVED_VIEWPORT);
    store.getState().selectCard('card-a');
    store.getState().setHoveredCard('card-b');
    store.getState().setMode('recall');
    store.getState().setGesture({
      kind: 'press',
      pointerId: 5,
      cardId: 'card-a',
      start: { x: 0, y: 0 },
      current: { x: 2, y: 2 },
      startedAt: 100,
    });
    store.getState().applyTemporaryViewport(FIT_VIEWPORT);

    store.getState().resetBoard({ x: -10, y: -20, scale: 2 });

    const state = store.getState();
    expect(state.viewport).toEqual({ x: -10, y: -20, scale: 2 });
    expect(state.storedViewport).toEqual({ x: -10, y: -20, scale: 2 });
    expect(state.pendingViewport).toBeNull();
    expect(state.viewportDirty).toBe(false);
    expect(state.selectedCardId).toBeNull();
    expect(state.hoveredCardId).toBeNull();
    expect(state.mode).toBe('browse');
    expect(state.gesture).toEqual({ kind: 'idle' });

    state.selectCard('card-z');
    expect(store.getState().selectedCardId).toBe('card-z');
  });

  it('resets to the default camera when no camera is supplied', () => {
    const store = createBoardStore(SAVED_VIEWPORT);

    store.getState().resetBoard();

    expect(store.getState().viewport).toEqual(DEFAULT_BOARD_VIEWPORT);
    expect(store.getState().storedViewport).toEqual(DEFAULT_BOARD_VIEWPORT);
  });
});

describe('selectors', () => {
  it('return existing references or primitives, never new objects', () => {
    const store = createBoardStore(SAVED_VIEWPORT);
    store.getState().selectCard('card-a');
    store.getState().setHoveredCard('card-b');
    store.getState().setGesture({
      kind: 'pan',
      pointerId: 2,
      start: { x: 0, y: 0 },
      current: { x: 1, y: 1 },
    });
    const state = store.getState();

    expect(selectViewport(state)).toBe(state.viewport);
    expect(selectViewport(state)).toBe(selectViewport(state));
    expect(selectStoredViewport(state)).toBe(state.storedViewport);
    expect(selectPendingViewport(state)).toBe(state.pendingViewport);
    expect(selectGesture(state)).toBe(state.gesture);
    expect(selectGesture(state)).toBe(selectGesture(state));
    expect(selectSelectedCardId(state)).toBe('card-a');
    expect(selectHoveredCardId(state)).toBe('card-b');
    expect(selectScale(state)).toBe(1.75);
    expect(selectViewportDirty(state)).toBe(false);
    expect(selectMode(state)).toBe('browse');
    expect(selectGestureKind(state)).toBe('pan');
    expect(selectIsInteracting(state)).toBe(true);
  });

  it('compare card ids without allocating a derived collection', () => {
    const store = createBoardStore();

    store.getState().selectCard('card-a');
    store.getState().setHoveredCard('card-b');

    expect(selectIsCardSelected(store.getState(), 'card-a')).toBe(true);
    expect(selectIsCardSelected(store.getState(), 'card-b')).toBe(false);
    expect(selectIsCardHovered(store.getState(), 'card-b')).toBe(true);
    expect(selectIsCardHovered(store.getState(), 'card-a')).toBe(false);
  });

  it('reflect idle state and pending viewport after fit', () => {
    const store = createBoardStore();

    expect(selectIsInteracting(store.getState())).toBe(false);

    store.getState().applyTemporaryViewport(FIT_VIEWPORT);

    expect(selectPendingViewport(store.getState())).toEqual(FIT_VIEWPORT);
    expect(selectViewportDirty(store.getState())).toBe(false);
  });
});

describe('module boundary', () => {
  const SOURCE_FILES = [
    new URL('../../src/board/viewport.ts', import.meta.url),
    new URL('../../src/board/boardStore.ts', import.meta.url),
  ] as const;

  it('imports no PixiJS, Dexie, React, or React DOM', () => {
    const forbidden = [
      /from\s+['"]pixi\.js['"]/u,
      /from\s+['"]dexie['"]/u,
      /from\s+['"]react['"]/u,
      /from\s+['"]react-dom['"]/u,
      /from\s+['"]react-router['"]/u,
      /from\s+['"].*\.tsx['"]/u,
    ];

    for (const file of SOURCE_FILES) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(source, `${file.pathname} matched ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('keeps the store on the vanilla Zustand runtime', () => {
    const source = readFileSync(SOURCE_FILES[1], 'utf8');

    expect(source).toMatch(/from\s+['"]zustand\/vanilla['"]/u);
    expect(source).not.toMatch(/from\s+['"]zustand['"]/u);
  });
});
