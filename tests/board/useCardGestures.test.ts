import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardCardSnapshot } from '../../src/board/CardSprite';
import {
  CARD_DRAG_TOLERANCE_PX,
  CARD_LIFT_SCALE,
  CARD_LONG_PRESS_MS,
  CardGestureController,
  clampCardPosition,
  findCardAtPoint,
  liftScaleFor,
} from '../../src/board/useCardGestures';
import type { CardDragUpdate } from '../../src/board/useCardGestures';
import type { Viewport } from '../../src/domain/model';

const CARD: BoardCardSnapshot = {
  id: 'card-1',
  title: 'Membrane transport',
  type: 'topic',
  position: { x: 100, y: 100 },
};

type PointerInfo = {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
};

function mouse(pointerId = 1): PointerInfo {
  return { pointerId, pointerType: 'mouse', button: 0 };
}

function touch(pointerId = 1): PointerInfo {
  return { pointerId, pointerType: 'touch', button: 0 };
}

function setup(options: { readonly reducedMotion?: boolean; readonly viewport?: Viewport } = {}) {
  const viewport: Viewport = options.viewport ?? { x: 0, y: 0, scale: 1 };
  const calls = {
    press: vi.fn(),
    lift: vi.fn(),
    move: vi.fn(),
    drop: vi.fn(),
    cancel: vi.fn(),
    tap: vi.fn(),
    pressCancel: vi.fn(),
    pan: vi.fn(),
  };

  const controller = new CardGestureController({
    getCardAt: (point) => findCardAtPoint([CARD], viewport, point)?.id ?? null,
    getCardPosition: (cardId) => (cardId === CARD.id ? CARD.position : null),
    getViewport: () => viewport,
    isReducedMotion: () => options.reducedMotion ?? false,
    onPress: calls.press,
    onLift: calls.lift,
    onDragMove: calls.move,
    onDrop: calls.drop,
    onDragCancel: calls.cancel,
    onTap: calls.tap,
    onPressCancel: calls.pressCancel,
    onPanBy: calls.pan,
  });

  return { controller, calls };
}

function lastUpdate(mock: ReturnType<typeof vi.fn>): CardDragUpdate {
  const call = mock.mock.calls.at(-1)?.[0] as CardDragUpdate | undefined;
  if (call === undefined) {
    throw new Error('Expected a gesture callback');
  }
  return call;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('card hit testing', () => {
  it('resolves a screen point through the camera and ignores the cork', () => {
    const viewport: Viewport = { x: 50, y: 40, scale: 2 };

    expect(findCardAtPoint([CARD], viewport, { x: 100, y: 120 })?.id).toBe(CARD.id);
    expect(findCardAtPoint([CARD], viewport, { x: 1, y: 1 })).toBeNull();
  });

  it('clamps a dragged position to the nonnegative domain contract', () => {
    expect(clampCardPosition({ x: -20, y: 12.5 })).toEqual({ x: 0, y: 12.5 });
    expect(clampCardPosition({ x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe('mouse gestures', () => {
  it('lifts and follows immediately, then emits one drop position', () => {
    const { controller, calls } = setup();

    controller.pointerDown({ x: 120, y: 120 }, mouse());
    expect(calls.lift).toHaveBeenCalledTimes(1);
    expect(lastUpdate(calls.lift).grabOffset).toEqual({ x: 20, y: 20 });

    controller.pointerMove({ x: 220, y: 170 }, 1);
    expect(lastUpdate(calls.move).position).toEqual({ x: 200, y: 150 });

    controller.pointerUp({ x: 220, y: 170 }, 1);
    expect(calls.drop).toHaveBeenCalledTimes(1);
    expect(lastUpdate(calls.drop).position).toEqual({ x: 200, y: 150 });
    expect(calls.tap).not.toHaveBeenCalled();
    expect(controller.isActive).toBe(false);
  });

  it('opens detail on a click without movement and does not persist a drop', () => {
    const { controller, calls } = setup();

    controller.pointerDown({ x: 120, y: 120 }, mouse());
    controller.pointerUp({ x: 122, y: 122 }, 1);

    expect(calls.tap).toHaveBeenCalledWith(CARD.id);
    expect(calls.drop).not.toHaveBeenCalled();
    expect(calls.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not open detail after a drag', () => {
    const { controller, calls } = setup();

    controller.pointerDown({ x: 120, y: 120 }, mouse());
    controller.pointerMove({ x: 170, y: 120 }, 1);
    controller.pointerUp({ x: 170, y: 120 }, 1);

    expect(calls.tap).not.toHaveBeenCalled();
    expect(calls.drop).toHaveBeenCalledTimes(1);
  });

  it('cleans up a cancelled drag without a drop', () => {
    const { controller, calls } = setup();

    controller.pointerDown({ x: 120, y: 120 }, mouse());
    controller.pointerMove({ x: 200, y: 150 }, 1);
    controller.pointerCancel(1);

    expect(calls.drop).not.toHaveBeenCalled();
    expect(lastUpdate(calls.cancel).position).toEqual({ x: 100, y: 100 });
    expect(controller.isActive).toBe(false);
  });
});

describe('touch gestures', () => {
  it('opens detail for a quick tap under the 500 ms threshold', () => {
    const { controller, calls } = setup();

    controller.pointerDown({ x: 120, y: 120 }, touch());
    vi.advanceTimersByTime(120);
    controller.pointerUp({ x: 121, y: 121 }, 1);

    expect(calls.lift).not.toHaveBeenCalled();
    expect(calls.tap).toHaveBeenCalledWith(CARD.id);
    expect(calls.drop).not.toHaveBeenCalled();
  });

  it('opens detail when movement stays under the six pixel tolerance', () => {
    const { controller, calls } = setup();

    controller.pointerDown({ x: 120, y: 120 }, touch());
    controller.pointerMove({ x: 124, y: 122 }, 1);
    vi.advanceTimersByTime(100);
    controller.pointerUp({ x: 124, y: 122 }, 1);

    expect(calls.lift).not.toHaveBeenCalled();
    expect(calls.tap).toHaveBeenCalledWith(CARD.id);
    expect(calls.drop).not.toHaveBeenCalled();
  });

  it('cancels the press and pans when movement exceeds six pixels early', () => {
    const { controller, calls } = setup();

    controller.pointerDown({ x: 120, y: 120 }, touch());
    controller.pointerMove({ x: 120 + CARD_DRAG_TOLERANCE_PX + 4, y: 120 }, 1);

    expect(calls.pressCancel).toHaveBeenCalledWith(CARD.id);
    expect(calls.pan).toHaveBeenCalledWith({ x: CARD_DRAG_TOLERANCE_PX + 4, y: 0 });
    expect(calls.lift).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CARD_LONG_PRESS_MS + 100);
    expect(calls.lift).not.toHaveBeenCalled();

    controller.pointerMove({ x: 160, y: 120 }, 1);
    expect(lastUpdate(calls.pan)).toEqual({ x: 30, y: 0 });

    controller.pointerUp({ x: 160, y: 120 }, 1);
    expect(calls.tap).not.toHaveBeenCalled();
    expect(calls.drop).not.toHaveBeenCalled();
  });

  it('lifts after a 500 ms press and drags until release', () => {
    const { controller, calls } = setup();

    controller.pointerDown({ x: 120, y: 120 }, touch());
    vi.advanceTimersByTime(CARD_LONG_PRESS_MS - 1);
    expect(calls.lift).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(calls.lift).toHaveBeenCalledTimes(1);

    controller.pointerMove({ x: 220, y: 170 }, 1);
    expect(lastUpdate(calls.move).position).toEqual({ x: 200, y: 150 });

    controller.pointerUp({ x: 220, y: 170 }, 1);
    expect(calls.drop).toHaveBeenCalledTimes(1);
    expect(lastUpdate(calls.drop).position).toEqual({ x: 200, y: 150 });
    expect(calls.tap).not.toHaveBeenCalled();
  });

  it('does not lift a press that was released before the timer', () => {
    const { controller, calls } = setup();

    controller.pointerDown({ x: 120, y: 120 }, touch());
    controller.pointerUp({ x: 120, y: 120 }, 1);
    vi.advanceTimersByTime(CARD_LONG_PRESS_MS + 100);

    expect(calls.lift).not.toHaveBeenCalled();
    expect(calls.tap).toHaveBeenCalledTimes(1);
  });
});

describe('reduced motion', () => {
  it('keeps the gesture but removes the lift scale', () => {
    const { controller, calls } = setup({ reducedMotion: true });

    controller.pointerDown({ x: 120, y: 120 }, mouse());

    expect(calls.lift).toHaveBeenCalledTimes(1);
    expect(calls.lift.mock.calls[0]?.[1]).toBe(true);
    expect(liftScaleFor(true, true)).toBe(1);
    expect(liftScaleFor(true, false)).toBe(CARD_LIFT_SCALE);

    controller.pointerMove({ x: 160, y: 140 }, 1);
    controller.pointerUp({ x: 160, y: 140 }, 1);
    expect(calls.drop).toHaveBeenCalledTimes(1);
  });
});
