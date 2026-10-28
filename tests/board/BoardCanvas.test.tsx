import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardSnapshot } from '../../src/board/BoardScene';
import { createBoardStore } from '../../src/board/boardStore';
import type { BoardStoreApi } from '../../src/board/boardStore';
import type { UsePixiAppResult } from '../../src/board/usePixiApp';

const { usePixiAppMock } = vi.hoisted(() => ({ usePixiAppMock: vi.fn() }));

vi.mock('../../src/board/usePixiApp', () => ({
  usePixiApp: usePixiAppMock,
}));

// The component imports the hook lazily through the mocked module above; the
// import order is intentionally after vi.mock so the boundary is replaced.
import { BoardCanvas } from '../../src/board/BoardCanvas';

const snapshot: BoardSnapshot = {
  caseId: 'case-1',
  caseTitle: 'Biology Final',
  cards: [
    {
      id: 'card-1',
      title: 'Photosynthesis notes',
      type: 'note',
      position: { x: 100, y: 120 },
    },
    {
      id: 'card-2',
      title: 'Light reactions',
      type: 'topic',
      position: { x: 420, y: 160 },
    },
  ],
};

let pixiState: UsePixiAppResult;

function readyState(overrides: Partial<UsePixiAppResult> = {}): UsePixiAppResult {
  return {
    status: 'ready',
    error: null,
    contextLost: false,
    viewportSize: { width: 1000, height: 800 },
    retry: vi.fn(),
    recover: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  pixiState = readyState();
  usePixiAppMock.mockImplementation(() => pixiState);
});

afterEach(() => {
  cleanup();
});

function renderBoard(store: BoardStoreApi = createBoardStore()) {
  const result = render(
    <MemoryRouter initialEntries={['/case/case-1']}>
      <BoardCanvas snapshot={snapshot} store={store} />
    </MemoryRouter>,
  );

  return { store, ...result };
}

function firePointer(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: { readonly clientX: number; readonly clientY: number; readonly pointerId?: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.assign(event, {
    pointerId: init.pointerId ?? 1,
    pointerType: 'mouse',
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  fireEvent(element, event);
}

function fireWheel(
  element: HTMLElement,
  init: { readonly clientX: number; readonly clientY: number; readonly deltaY: number },
): void {
  fireEvent(
    element,
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: init.clientX,
      clientY: init.clientY,
      deltaY: init.deltaY,
    }),
  );
}

describe('BoardCanvas', () => {
  it('renders the accessible canvas region and view controls without page links', () => {
    renderBoard();

    expect(screen.getByRole('group', { name: 'Case board canvas' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Board view controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeInTheDocument();
    expect(screen.getByLabelText('Board zoom')).toHaveTextContent('100%');

    expect(screen.queryByRole('link', { name: 'Add evidence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open card list' })).not.toBeInTheDocument();

    const canvas = screen.getByTestId('board-canvas');
    expect(canvas).toHaveAttribute('data-board-card-count', '2');
    expect(canvas).toHaveAttribute('data-board-connection-count', '0');
    expect(canvas).toHaveAttribute('data-board-scene-status', 'ready');
    expect(canvas).toHaveAttribute('data-board-viewport-x', '0.000');
    expect(canvas).toHaveAttribute('data-board-scale', '1.0000');
  });

  it('pans by the pointer delta and reports the rendered viewport', () => {
    const { store } = renderBoard();
    const host = screen.getByTestId('board-canvas-host');

    firePointer(host, 'pointerdown', { clientX: 100, clientY: 100 });
    firePointer(host, 'pointermove', { clientX: 160, clientY: 130 });
    firePointer(host, 'pointerup', { clientX: 160, clientY: 130 });

    expect(store.getState().viewport.x).toBeCloseTo(-60, 6);
    expect(store.getState().viewport.y).toBeCloseTo(-30, 6);

    const canvas = screen.getByTestId('board-canvas');
    expect(canvas).toHaveAttribute('data-board-viewport-x', '-60.000');
    expect(canvas).toHaveAttribute('data-board-viewport-y', '-30.000');
  });

  it('pinches around the midpoint and clamps the resulting scale', () => {
    const { store } = renderBoard();
    const host = screen.getByTestId('board-canvas-host');

    firePointer(host, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    firePointer(host, 'pointerdown', { pointerId: 2, clientX: 200, clientY: 100 });
    firePointer(host, 'pointermove', { pointerId: 2, clientX: 300, clientY: 100 });

    const zoomed = store.getState().viewport;
    expect(zoomed.scale).toBeCloseTo(2, 6);
    // The world point under the moving midpoint stays put.
    expect(200 / zoomed.scale + zoomed.x).toBeCloseTo(200, 6);
    expect(100 / zoomed.scale + zoomed.y).toBeCloseTo(100, 6);
  });

  it('zooms around the pointer anchor and clamps at 0.25 and 2.5', () => {
    const { store } = renderBoard();
    const host = screen.getByTestId('board-canvas-host');

    fireWheel(host, { clientX: 200, clientY: 150, deltaY: -100 });

    const zoomed = store.getState().viewport;
    expect(zoomed.scale).toBeGreaterThan(1);
    expect(zoomed.scale).toBeLessThanOrEqual(2.5);
    expect(200 / zoomed.scale + zoomed.x).toBeCloseTo(200, 6);
    expect(150 / zoomed.scale + zoomed.y).toBeCloseTo(150, 6);

    store.getState().hydrateViewport({ x: 0, y: 0, scale: 2.5 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(store.getState().viewport.scale).toBe(2.5);

    store.getState().hydrateViewport({ x: 0, y: 0, scale: 0.25 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(store.getState().viewport.scale).toBe(0.25);
  });

  it('resets to a temporary default view without marking the camera dirty', () => {
    const store = createBoardStore({ x: 100, y: 50, scale: 1 });
    renderBoard(store);

    store.getState().panBy({ x: -40, y: -20 });
    expect(store.getState().viewportDirty).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

    expect(store.getState().viewport).toEqual({ x: 0, y: 0, scale: 1 });
    expect(store.getState().storedViewport).toEqual({ x: 100, y: 50, scale: 1 });
    expect(store.getState().pendingViewport).toEqual({ x: 0, y: 0, scale: 1 });
    expect(store.getState().viewportDirty).toBe(false);
  });

  it('shows a recoverable fallback when the graphics context is lost', () => {
    pixiState = readyState({ contextLost: true });

    renderBoard();

    expect(screen.getByRole('alert')).toHaveTextContent('The board lost its graphics context');
    expect(screen.getByRole('link', { name: 'Open card list' })).toHaveAttribute(
      'href',
      '/case/case-1/list',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Restore board' }));
    expect(pixiState.recover).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable fallback when the renderer cannot start', () => {
    pixiState = readyState({
      status: 'error',
      error: 'The board canvas could not start. This browser may not support WebGL.',
    });

    renderBoard();

    expect(screen.getByRole('alert')).toHaveTextContent('The board canvas could not start');

    fireEvent.click(screen.getByRole('button', { name: 'Retry board' }));
    expect(pixiState.retry).toHaveBeenCalledTimes(1);
  });

  it('removes pointer listeners when it unmounts', () => {
    const { store, unmount } = renderBoard();
    const host = screen.getByTestId('board-canvas-host');
    const before = store.getState().viewport;

    unmount();

    firePointer(host, 'pointerdown', { clientX: 10, clientY: 10 });
    firePointer(host, 'pointermove', { clientX: 120, clientY: 90 });
    firePointer(host, 'pointerup', { clientX: 120, clientY: 90 });

    expect(store.getState().viewport).toEqual(before);
  });

  it('leaves Add evidence and the card-list link to the page chrome', () => {
    renderBoard();

    expect(screen.queryByTestId('board-add-evidence-blocked')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add evidence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open card list' })).not.toBeInTheDocument();
  });
});
