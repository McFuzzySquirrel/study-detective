import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardCardSnapshot } from '../../src/board/CardSprite';
import { createBoardStore } from '../../src/board/boardStore';
import { MINIMAP_HEIGHT, MINIMAP_WIDTH, Minimap } from '../../src/board/Minimap';
import { BOARD_CARD_HEIGHT, BOARD_CARD_WIDTH } from '../../src/board/viewport';
import type { Viewport } from '../../src/domain/model';

const VIEWPORT_SIZE = { width: 1000, height: 800 };

function makeCards(count = 150): BoardCardSnapshot[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: `card-${index}`,
    title: `Card ${index}`,
    type: 'note',
    position: {
      x: (index % 15) * (BOARD_CARD_WIDTH + 60),
      y: Math.floor(index / 15) * (BOARD_CARD_HEIGHT + 60),
    },
  }));
}

function firePointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { readonly clientX: number; readonly clientY: number; readonly pointerId?: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.assign(event, {
    pointerId: init.pointerId ?? 1,
    pointerType: 'mouse',
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  fireEvent(element, event);
}

function mockSvgRect(svg: HTMLElement): void {
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: MINIMAP_WIDTH,
    bottom: MINIMAP_HEIGHT,
    width: MINIMAP_WIDTH,
    height: MINIMAP_HEIGHT,
    toJSON: () => ({}),
  } as DOMRect);
}

function renderMinimap(
  viewport: Viewport = { x: 0, y: 0, scale: 1 },
  cards: BoardCardSnapshot[] = makeCards(),
  autoOpen = true,
) {
  const store = createBoardStore(viewport);
  const view = render(
    <MemoryRouter>
      <Minimap cards={cards} viewport={viewport} viewportSize={VIEWPORT_SIZE} store={store} />
    </MemoryRouter>,
  );

  if (autoOpen) {
    fireEvent.click(screen.getByRole('button', { name: 'Show minimap' }));
  }

  return { store, ...view };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Minimap', () => {
  it('projects every card and the camera rectangle', () => {
    const cards = makeCards();
    const { container } = renderMinimap();

    expect(screen.getByTestId('board-minimap')).toHaveAttribute(
      'data-minimap-card-count',
      String(cards.length),
    );
    expect(container.querySelectorAll('[data-minimap-card]')).toHaveLength(cards.length);
    expect(screen.getByTestId('board-minimap-viewport')).toBeInTheDocument();
  });

  it('tracks pan and zoom in the viewport rectangle', () => {
    const cards = makeCards(4);
    const { rerender } = renderMinimap({ x: 0, y: 0, scale: 1 }, cards);
    const store = createBoardStore();

    const initial = screen.getByTestId('board-minimap-viewport');
    const initialX = Number(initial.getAttribute('data-minimap-viewport-x'));
    const initialWidth = Number(initial.getAttribute('data-minimap-viewport-width'));

    rerender(
      <MemoryRouter>
        <Minimap
          cards={cards}
          viewport={{ x: 500, y: 200, scale: 2 }}
          viewportSize={VIEWPORT_SIZE}
          store={store}
        />
      </MemoryRouter>,
    );

    const zoomed = screen.getByTestId('board-minimap-viewport');
    expect(Number(zoomed.getAttribute('data-minimap-viewport-x'))).not.toBeCloseTo(initialX);
    expect(Number(zoomed.getAttribute('data-minimap-viewport-width'))).toBeLessThan(initialWidth);
  });

  it('moves the camera when the inset is tapped', () => {
    const { store } = renderMinimap();
    const svg = screen.getByTestId('board-minimap');
    mockSvgRect(svg);

    firePointer(svg, 'pointerdown', {
      clientX: MINIMAP_WIDTH / 2,
      clientY: MINIMAP_HEIGHT / 2,
    });
    firePointer(svg, 'pointerup', {
      clientX: MINIMAP_WIDTH / 2,
      clientY: MINIMAP_HEIGHT / 2,
    });

    expect(store.getState().viewport.x).not.toBe(0);
    expect(store.getState().viewportDirty).toBe(true);
  });

  it('moves the camera continuously while dragging', () => {
    const { store } = renderMinimap();
    const svg = screen.getByTestId('board-minimap');
    mockSvgRect(svg);

    firePointer(svg, 'pointerdown', { clientX: 20, clientY: MINIMAP_HEIGHT / 2 });
    const afterDown = store.getState().viewport.x;

    firePointer(svg, 'pointermove', { clientX: 170, clientY: MINIMAP_HEIGHT / 2 });
    const afterMove = store.getState().viewport.x;

    firePointer(svg, 'pointerup', { clientX: 170, clientY: MINIMAP_HEIGHT / 2 });

    expect(afterMove).toBeGreaterThan(afterDown);
    expect(store.getState().viewport.scale).toBe(1);
  });

  it('collapses and reopens from its toggle', () => {
    renderMinimap();

    expect(screen.getByTestId('board-minimap')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide minimap' }));
    expect(screen.queryByTestId('board-minimap')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show minimap' }));
    expect(screen.getByTestId('board-minimap')).toBeInTheDocument();
  });

  it('starts collapsed at every width', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: '(max-width: 40rem)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    try {
      renderMinimap({ x: 0, y: 0, scale: 1 }, makeCards(), false);

      expect(screen.getByRole('button', { name: 'Show minimap' })).toBeInTheDocument();
      expect(screen.queryByTestId('board-minimap')).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });
});
