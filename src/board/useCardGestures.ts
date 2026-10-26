/**
 * Card pointer gestures for the case board.
 *
 * The controller is deliberately renderer-free and framework-free so the
 * tap-versus-drag timing rules can be tested with a fake clock. `useCardGestures`
 * only adapts DOM pointer events to the controller and removes them on unmount.
 *
 * Rules:
 *
 * - Mouse and pen drags begin immediately; releasing without moving is a tap.
 * - Touch presses lift after 500 ms. Releasing under 500 ms without moving is a
 *   tap. Moving further than 6 px before the lift cancels the card press and
 *   hands the gesture to the board pan.
 * - A completed drag emits one final position. Intermediate positions are
 *   previews; the page debounces the single persisted update.
 * - Reduced motion changes the lift scale only; the gesture is unchanged.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import type { CardPosition, Viewport } from '../domain/model';

import type { BoardCardSnapshot } from './CardSprite';
import { BOARD_CARD_HEIGHT, BOARD_CARD_WIDTH } from './viewport';
import type { BoardPoint } from './viewport';

/** Touch long-press delay before a card lifts. */
export const CARD_LONG_PRESS_MS = 500;

/** Distance from the pointer-down point that turns a press into a drag. */
export const CARD_DRAG_TOLERANCE_PX = 6;

/** Scale applied while a card is lifted, unless reduced motion is preferred. */
export const CARD_LIFT_SCALE = 1.04;

export function liftScaleFor(lifted: boolean, reducedMotion: boolean): number {
  return lifted && !reducedMotion ? CARD_LIFT_SCALE : 1;
}

/** Card positions stay nonnegative, matching the persisted domain schema. */
export function clampCardPosition(point: BoardPoint): CardPosition {
  const x = Number.isFinite(point.x) ? Math.max(0, point.x) : 0;
  const y = Number.isFinite(point.y) ? Math.max(0, point.y) : 0;
  return { x, y };
}

/**
 * Resolve a screen-space point to a card. This mirrors the geometry used by
 * `CardLayer`; keeping it in this module means gesture tests do not need Pixi.
 */
export function findCardAtPoint(
  cards: readonly BoardCardSnapshot[],
  viewport: Viewport,
  point: BoardPoint,
): BoardCardSnapshot | null {
  const scale = Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
  const worldX = point.x / scale + viewport.x;
  const worldY = point.y / scale + viewport.y;

  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (card === undefined) {
      continue;
    }

    if (
      worldX >= card.position.x &&
      worldX <= card.position.x + BOARD_CARD_WIDTH &&
      worldY >= card.position.y &&
      worldY <= card.position.y + BOARD_CARD_HEIGHT
    ) {
      return card;
    }
  }

  return null;
}

export interface CardDragUpdate {
  readonly cardId: string;
  readonly pointerId: number;
  /** World offset from the card origin to the pointer at lift time. */
  readonly grabOffset: BoardPoint;
  /** The card's proposed world position after this move. */
  readonly position: CardPosition;
}

export interface ConnectStart {
  readonly fromCardId: string;
  readonly pointerId: number;
  readonly point: BoardPoint;
}

export interface ConnectMove {
  readonly fromCardId: string;
  readonly pointerId: number;
  readonly point: BoardPoint;
  /** The topmost card under the pointer, or null on the cork. */
  readonly targetCardId: string | null;
}

export type ConnectEnd = ConnectMove;

export interface CardGestureCallbacks {
  /** Resolve a screen point to a card ID, or null on the cork. */
  getCardAt(point: BoardPoint): string | null;
  /**
   * Resolve a screen point to the visible thread anchor's card. The board shows
   * one anchor for the selected or hovered card, so this returns that card only
   * when the pointer is inside its 44 px target.
   */
  getThreadAnchorAt?(point: BoardPoint): string | null;
  /** The card's current world position. */
  getCardPosition(cardId: string): BoardPoint | null;
  /** The live camera, used to convert screen movement into world movement. */
  getViewport(): Viewport;
  /** Read the current reduced-motion preference at gesture start. */
  isReducedMotion(): boolean;
  /** Pointer-down selected a card; detail is not open yet. */
  onPress?(cardId: string): void;
  /** The card has lifted. Reduced motion decides whether the scale is applied. */
  onLift?(update: CardDragUpdate, reducedMotion: boolean): void;
  /** One preview frame while the lifted card follows the pointer. */
  onDragMove?(update: CardDragUpdate): void;
  /** The drag finished; this is the only position worth persisting. */
  onDrop?(update: CardDragUpdate): void;
  /** The gesture ended without a new position (tap, cancel, or no movement). */
  onDragCancel?(update: CardDragUpdate): void;
  /** A press resolved to a tap and should open card detail. */
  onTap?(cardId: string): void;
  /** A touch press crossed the tolerance before lifting and became a pan. */
  onPressCancel?(cardId: string): void;
  /** Pan by a screen-space delta once a cancelled press hands off. */
  onPanBy?(delta: BoardPoint): void;
  /** A connection drag started on the visible thread anchor. */
  onConnectStart?(start: ConnectStart): void;
  /** The temporary thread followed the pointer. */
  onConnectMove?(move: ConnectMove): void;
  /** The pointer released; `targetCardId` may be the source or null. */
  onConnectEnd?(end: ConnectEnd): void;
  /** The connection drag was cancelled without a drop. */
  onConnectCancel?(pointerId: number): void;
  /** Injectable timer hooks for deterministic tests. */
  schedule?(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancelSchedule?(handle: ReturnType<typeof setTimeout>): void;
}

interface ConnectState {
  readonly pointerId: number;
  readonly fromCardId: string;
}

interface PressState {
  readonly pointerId: number;
  readonly cardId: string;
  readonly pointerType: string;
  readonly start: BoardPoint;
  readonly startPosition: CardPosition;
  readonly grabOffset: BoardPoint;
  startedAt: number;
  lastPoint: BoardPoint;
  moved: boolean;
  lifted: boolean;
  panning: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function distance(first: BoardPoint, second: BoardPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function clonePosition(position: BoardPoint): CardPosition {
  return { x: position.x, y: position.y };
}

/**
 * The pure gesture state machine. The DOM hook below is a thin adapter; tests
 * drive this class directly with synthetic points and a fake clock.
 */
export class CardGestureController {
  private state: PressState | null = null;
  private connect: ConnectState | null = null;
  private panPoint: BoardPoint | null = null;
  private destroyed = false;

  constructor(private readonly options: CardGestureCallbacks) {}

  get isActive(): boolean {
    return this.state !== null || this.connect !== null;
  }

  pointerDown(
    point: BoardPoint,
    info: { readonly pointerId: number; readonly pointerType: string; readonly button: number },
  ): void {
    if (this.destroyed) {
      return;
    }

    if (info.pointerType === 'mouse' && info.button !== 0) {
      return;
    }

    // A second finger belongs to a pinch. Cancel both a card press and an
    // in-flight connection rather than dragging while the camera zooms.
    if (this.state !== null || this.connect !== null) {
      this.cancel();
      return;
    }

    // The thread anchor wins over the card body. It is a deliberate handle and
    // starts immediately for mouse, pen, and touch alike; the 500 ms long press
    // belongs to lifting a whole card, not to pulling a thread.
    const anchorCardId = this.options.getThreadAnchorAt?.(point) ?? null;
    if (anchorCardId !== null) {
      this.connect = {
        pointerId: info.pointerId,
        fromCardId: anchorCardId,
      };
      this.options.onConnectStart?.({
        fromCardId: anchorCardId,
        pointerId: info.pointerId,
        point: { x: point.x, y: point.y },
      });
      return;
    }

    const cardId = this.options.getCardAt(point);
    if (cardId === null) {
      return;
    }

    const cardPosition = this.options.getCardPosition(cardId);
    if (cardPosition === null) {
      return;
    }

    const viewport = this.options.getViewport();
    const scale = Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
    const world = { x: point.x / scale + viewport.x, y: point.y / scale + viewport.y };

    const state: PressState = {
      pointerId: info.pointerId,
      cardId,
      pointerType: info.pointerType,
      start: { x: point.x, y: point.y },
      startPosition: clonePosition(cardPosition),
      grabOffset: { x: world.x - cardPosition.x, y: world.y - cardPosition.y },
      startedAt: Date.now(),
      lastPoint: { x: point.x, y: point.y },
      moved: false,
      lifted: false,
      panning: false,
      timer: null,
    };

    this.state = state;
    this.options.onPress?.(cardId);

    if (info.pointerType === 'touch') {
      state.timer = this.schedule(() => {
        if (this.state === state && !state.lifted) {
          this.lift(state);
        }
      }, CARD_LONG_PRESS_MS);
      return;
    }

    // Mouse and pen are immediate: the card is under the pointer and ready to
    // follow it before the first pointermove.
    this.lift(state);
  }

  pointerMove(point: BoardPoint, pointerId: number): void {
    const connect = this.connect;
    if (this.destroyed) {
      return;
    }

    if (connect !== null) {
      if (connect.pointerId !== pointerId) {
        return;
      }

      this.options.onConnectMove?.({
        fromCardId: connect.fromCardId,
        pointerId,
        point: { x: point.x, y: point.y },
        targetCardId: this.options.getCardAt(point),
      });
      return;
    }

    const state = this.state;
    if (state === null || state.pointerId !== pointerId) {
      return;
    }

    if (state.panning) {
      this.applyPan(point, state);
      return;
    }

    const movedDistance = distance(state.start, point);
    if (movedDistance > CARD_DRAG_TOLERANCE_PX) {
      state.moved = true;
    }

    if (!state.lifted) {
      if (movedDistance <= CARD_DRAG_TOLERANCE_PX) {
        return;
      }

      // The finger crossed the tolerance before the long press completed. The
      // press was not a card drag, so cancel it and pan from the start point.
      this.clearTimer(state);
      state.panning = true;
      state.lastPoint = state.start;
      this.panPoint = state.start;
      this.options.onPressCancel?.(state.cardId);
      this.applyPan(point, state);
      return;
    }

    const update = this.updateFor(point, state);
    state.lastPoint = { x: point.x, y: point.y };
    this.options.onDragMove?.(update);
  }

  pointerUp(point: BoardPoint, pointerId: number): void {
    const connect = this.connect;
    if (this.destroyed) {
      return;
    }

    if (connect !== null) {
      if (connect.pointerId !== pointerId) {
        return;
      }

      this.connect = null;
      this.options.onConnectEnd?.({
        fromCardId: connect.fromCardId,
        pointerId,
        point: { x: point.x, y: point.y },
        targetCardId: this.options.getCardAt(point),
      });
      return;
    }

    const state = this.state;
    if (state === null || state.pointerId !== pointerId) {
      return;
    }

    this.clearTimer(state);

    if (state.panning) {
      this.reset();
      return;
    }

    const movedDistance = distance(state.start, point);
    if (movedDistance > CARD_DRAG_TOLERANCE_PX) {
      state.moved = true;
    }

    if (state.lifted) {
      if (state.moved) {
        const update = this.updateFor(point, state);
        this.reset();
        this.options.onDrop?.(update);
        return;
      }

      // A mouse click with no movement opens detail; a long touch press that
      // never moved simply releases the card.
      const cancel = this.updateFor(state.start, state);
      const isClick = state.pointerType === 'mouse' || state.pointerType === 'pen';
      this.reset();
      if (isClick) {
        this.options.onDragCancel?.(cancel);
        this.options.onTap?.(state.cardId);
      } else {
        this.options.onDragCancel?.(cancel);
      }
      return;
    }

    // Touch tap: under the long-press threshold and without a meaningful move.
    const cardId = state.cardId;
    const isTap = !state.moved && movedDistance <= CARD_DRAG_TOLERANCE_PX;
    this.reset();
    if (isTap) {
      this.options.onTap?.(cardId);
    }
  }

  pointerCancel(pointerId: number): void {
    const connect = this.connect;
    if (this.destroyed) {
      return;
    }

    if (connect !== null) {
      if (connect.pointerId !== pointerId) {
        return;
      }
      this.connect = null;
      this.options.onConnectCancel?.(pointerId);
      return;
    }

    const state = this.state;
    if (state === null || state.pointerId !== pointerId) {
      return;
    }

    const cancel =
      state.lifted && !state.panning
        ? {
            cardId: state.cardId,
            pointerId: state.pointerId,
            grabOffset: state.grabOffset,
            position: clonePosition(state.startPosition),
          }
        : null;

    this.reset();
    if (cancel !== null) {
      this.options.onDragCancel?.(cancel);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.state !== null) {
      this.clearTimer(this.state);
      this.state = null;
    }
    this.connect = null;
    this.panPoint = null;
  }

  private lift(state: PressState): void {
    if (state.lifted || this.state !== state) {
      return;
    }

    state.lifted = true;
    this.options.onLift?.(
      {
        cardId: state.cardId,
        pointerId: state.pointerId,
        grabOffset: state.grabOffset,
        position: clonePosition(state.startPosition),
      },
      this.options.isReducedMotion(),
    );
  }

  private applyPan(point: BoardPoint, state: PressState): void {
    const previous = this.panPoint ?? state.lastPoint;
    const delta = { x: point.x - previous.x, y: point.y - previous.y };
    this.panPoint = { x: point.x, y: point.y };
    state.lastPoint = { x: point.x, y: point.y };

    if (delta.x !== 0 || delta.y !== 0) {
      this.options.onPanBy?.(delta);
    }
  }

  private updateFor(point: BoardPoint, state: PressState): CardDragUpdate {
    const viewport = this.options.getViewport();
    const scale = Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1;
    const world = { x: point.x / scale + viewport.x, y: point.y / scale + viewport.y };

    return {
      cardId: state.cardId,
      pointerId: state.pointerId,
      grabOffset: state.grabOffset,
      position: clampCardPosition({
        x: world.x - state.grabOffset.x,
        y: world.y - state.grabOffset.y,
      }),
    };
  }

  private schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    return this.options.schedule?.(callback, delayMs) ?? setTimeout(callback, delayMs);
  }

  private clearTimer(state: PressState): void {
    if (state.timer === null) {
      return;
    }

    const handle = state.timer;
    state.timer = null;
    if (this.options.cancelSchedule !== undefined) {
      this.options.cancelSchedule(handle);
    } else {
      clearTimeout(handle);
    }
  }

  private cancel(): void {
    if (this.connect !== null) {
      const pointerId = this.connect.pointerId;
      this.connect = null;
      this.options.onConnectCancel?.(pointerId);
    }

    if (this.state === null) {
      return;
    }

    const state = this.state;
    this.clearTimer(state);
    const cancel =
      state.lifted && !state.panning
        ? {
            cardId: state.cardId,
            pointerId: state.pointerId,
            grabOffset: state.grabOffset,
            position: clonePosition(state.startPosition),
          }
        : null;
    this.reset();
    if (cancel !== null) {
      this.options.onDragCancel?.(cancel);
    }
  }

  private reset(): void {
    if (this.state !== null) {
      this.clearTimer(this.state);
    }
    this.state = null;
    this.panPoint = null;
  }
}

export type UseCardGesturesOptions = CardGestureCallbacks;

function localPoint(element: HTMLElement, event: PointerEvent): BoardPoint {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * Attach card gestures to the board host.
 *
 * The host owns the listeners, not the generated canvas, so a WebGL context
 * recovery that swaps the canvas cannot leave the gestures detached.
 */
export function useCardGestures(
  hostRef: RefObject<HTMLElement | null>,
  options: UseCardGesturesOptions,
): void {
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const controller = new CardGestureController({
      getCardAt: (point) => optionsRef.current.getCardAt(point),
      ...(optionsRef.current.getThreadAnchorAt !== undefined
        ? {
            getThreadAnchorAt: (point: BoardPoint) =>
              optionsRef.current.getThreadAnchorAt?.(point) ?? null,
          }
        : {}),
      getCardPosition: (cardId) => optionsRef.current.getCardPosition(cardId),
      getViewport: () => optionsRef.current.getViewport(),
      isReducedMotion: () => optionsRef.current.isReducedMotion(),
      ...(optionsRef.current.onPress !== undefined
        ? { onPress: (cardId: string) => optionsRef.current.onPress?.(cardId) }
        : {}),
      ...(optionsRef.current.onLift !== undefined
        ? {
            onLift: (update: CardDragUpdate, reducedMotion: boolean) =>
              optionsRef.current.onLift?.(update, reducedMotion),
          }
        : {}),
      ...(optionsRef.current.onDragMove !== undefined
        ? { onDragMove: (update: CardDragUpdate) => optionsRef.current.onDragMove?.(update) }
        : {}),
      ...(optionsRef.current.onDrop !== undefined
        ? { onDrop: (update: CardDragUpdate) => optionsRef.current.onDrop?.(update) }
        : {}),
      ...(optionsRef.current.onDragCancel !== undefined
        ? {
            onDragCancel: (update: CardDragUpdate) => optionsRef.current.onDragCancel?.(update),
          }
        : {}),
      ...(optionsRef.current.onTap !== undefined
        ? { onTap: (cardId: string) => optionsRef.current.onTap?.(cardId) }
        : {}),
      ...(optionsRef.current.onPressCancel !== undefined
        ? {
            onPressCancel: (cardId: string) => optionsRef.current.onPressCancel?.(cardId),
          }
        : {}),
      ...(optionsRef.current.onPanBy !== undefined
        ? { onPanBy: (delta: BoardPoint) => optionsRef.current.onPanBy?.(delta) }
        : {}),
      ...(optionsRef.current.onConnectStart !== undefined
        ? {
            onConnectStart: (start: ConnectStart) => optionsRef.current.onConnectStart?.(start),
          }
        : {}),
      ...(optionsRef.current.onConnectMove !== undefined
        ? {
            onConnectMove: (move: ConnectMove) => optionsRef.current.onConnectMove?.(move),
          }
        : {}),
      ...(optionsRef.current.onConnectEnd !== undefined
        ? {
            onConnectEnd: (end: ConnectEnd) => optionsRef.current.onConnectEnd?.(end),
          }
        : {}),
      ...(optionsRef.current.onConnectCancel !== undefined
        ? {
            onConnectCancel: (pointerId: number) => optionsRef.current.onConnectCancel?.(pointerId),
          }
        : {}),
    });

    const handlePointerDown = (event: PointerEvent): void => {
      controller.pointerDown(localPoint(host, event), {
        pointerId: event.pointerId,
        pointerType: event.pointerType === '' ? 'mouse' : event.pointerType,
        button: event.button,
      });
    };

    const handlePointerMove = (event: PointerEvent): void => {
      controller.pointerMove(localPoint(host, event), event.pointerId);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      controller.pointerUp(localPoint(host, event), event.pointerId);
    };

    const handlePointerCancel = (event: PointerEvent): void => {
      controller.pointerCancel(event.pointerId);
    };

    host.addEventListener('pointerdown', handlePointerDown);
    host.addEventListener('pointermove', handlePointerMove);
    host.addEventListener('pointerup', handlePointerUp);
    host.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      host.removeEventListener('pointerdown', handlePointerDown);
      host.removeEventListener('pointermove', handlePointerMove);
      host.removeEventListener('pointerup', handlePointerUp);
      host.removeEventListener('pointercancel', handlePointerCancel);
      controller.destroy();
    };
  }, [hostRef]);
}
