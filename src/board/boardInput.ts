/**
 * Pointer input for the case board.
 *
 * This module is deliberately independent of PixiJS and React: it translates
 * DOM pointer and wheel events into pan and zoom intents. The board store owns
 * the camera, so this controller never reads or writes storage and never keeps
 * a second copy of the viewport.
 *
 * Gestures:
 *
 * - One pointer drags the cork and pans by the pointer delta.
 * - Two pointers pinch around their midpoint. The scale factor is relative to
 *   the distance at the moment the second pointer landed, so a jittery finger
 *   cannot compound the zoom.
 * - The wheel and trackpad zoom around the pointer anchor. Delta modes are
 *   normalised so a line- or page-based wheel behaves like pixels.
 *
 * Every listener and pointer capture is removed by `destroy`.
 */

import type { BoardPoint } from './viewport';

/** Wheel delta to multiplicative zoom factor. 100 px is roughly one notch. */
const WHEEL_ZOOM_RATE = 0.0015;

/** One wheel event may not more than halve or double the scale. */
const MIN_WHEEL_FACTOR = 0.5;
const MAX_WHEEL_FACTOR = 2;

export interface BoardInputCallbacks {
  /** Pan by a screen-space delta. */
  readonly onPan: (delta: BoardPoint) => void;
  /** Multiply the zoom by `factor`, anchored at a screen point. */
  readonly onZoom: (anchor: BoardPoint, factor: number) => void;
  /** Set an absolute scale, anchored at a screen point. Used by pinch. */
  readonly onZoomTo: (anchor: BoardPoint, scale: number) => void;
  /** The camera's current scale, read when a pinch starts. */
  readonly getScale: () => number;
}

export interface BoardInputHandle {
  destroy(): void;
}

interface PinchState {
  readonly pointerIds: readonly [number, number];
  readonly startDistance: number;
  readonly startScale: number;
}

function localPoint(element: HTMLElement, clientX: number, clientY: number): BoardPoint {
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function distanceBetween(first: BoardPoint, second: BoardPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first: BoardPoint, second: BoardPoint): BoardPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function pointerPoint(element: HTMLElement, event: PointerEvent): BoardPoint {
  return localPoint(element, event.clientX, event.clientY);
}

function normaliseWheelDelta(event: WheelEvent): number {
  const modeMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
  return event.deltaY * modeMultiplier;
}

/**
 * Attach board pan/pinch/wheel handling to a host element.
 *
 * The host, not the generated canvas, owns the listeners: the canvas is created
 * asynchronously by PixiJS and may be replaced after a context loss, while the
 * host element remains stable for the lifetime of the React tree.
 */
export function attachBoardInput(
  element: HTMLElement,
  callbacks: BoardInputCallbacks,
): BoardInputHandle {
  const pointers = new Map<number, BoardPoint>();
  let panPointerId: number | null = null;
  let lastPanPoint: BoardPoint | null = null;
  let pinch: PinchState | null = null;

  const releasePointer = (pointerId: number): void => {
    pointers.delete(pointerId);

    if (pinch !== null && pointers.size < 2) {
      pinch = null;
    }

    if (pointers.size === 1) {
      const [remainingId, remainingPoint] = [...pointers.entries()][0] ?? [];
      if (remainingId !== undefined && remainingPoint !== undefined) {
        panPointerId = remainingId;
        lastPanPoint = remainingPoint;
        return;
      }
    }

    panPointerId = null;
    lastPanPoint = null;
  };

  const handlePointerDown = (event: PointerEvent): void => {
    // Only the primary mouse button pans. Touch, pen, and secondary mouse
    // buttons are handled by the pointer map below.
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const point = pointerPoint(element, event);
    pointers.set(event.pointerId, point);

    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in some embedded browsers. The host
      // still receives moves while the pointer stays over it.
    }

    if (pointers.size === 1) {
      panPointerId = event.pointerId;
      lastPanPoint = point;
      pinch = null;
      return;
    }

    if (pointers.size === 2) {
      const entries = [...pointers.entries()];
      const first = entries[0];
      const second = entries[1];

      if (first !== undefined && second !== undefined) {
        const startDistance = distanceBetween(first[1], second[1]);
        pinch =
          startDistance > 0
            ? {
                pointerIds: [first[0], second[0]],
                startDistance,
                startScale: callbacks.getScale(),
              }
            : null;
        panPointerId = null;
        lastPanPoint = null;
      }
    }
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    const point = pointerPoint(element, event);
    pointers.set(event.pointerId, point);

    if (pinch !== null) {
      const first = pointers.get(pinch.pointerIds[0]);
      const second = pointers.get(pinch.pointerIds[1]);

      if (first !== undefined && second !== undefined) {
        const distance = distanceBetween(first, second);
        if (pinch.startDistance > 0 && Number.isFinite(distance)) {
          callbacks.onZoomTo(
            midpoint(first, second),
            pinch.startScale * (distance / pinch.startDistance),
          );
        }
        return;
      }
    }

    if (panPointerId === event.pointerId && lastPanPoint !== null) {
      const delta = { x: point.x - lastPanPoint.x, y: point.y - lastPanPoint.y };
      lastPanPoint = point;

      if (delta.x !== 0 || delta.y !== 0) {
        callbacks.onPan(delta);
      }
    }
  };

  const handlePointerUp = (event: PointerEvent): void => {
    releasePointer(event.pointerId);

    try {
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Capture may already be gone after pointercancel.
    }
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    releasePointer(event.pointerId);
  };

  const handleLostPointerCapture = (event: PointerEvent): void => {
    releasePointer(event.pointerId);
  };

  const handleWheel = (event: WheelEvent): void => {
    event.preventDefault();

    const delta = normaliseWheelDelta(event);
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }

    const factor = Math.min(
      MAX_WHEEL_FACTOR,
      Math.max(MIN_WHEEL_FACTOR, Math.exp(-delta * WHEEL_ZOOM_RATE)),
    );

    if (factor === 1) {
      return;
    }

    callbacks.onZoom(localPoint(element, event.clientX, event.clientY), factor);
  };

  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('pointermove', handlePointerMove);
  element.addEventListener('pointerup', handlePointerUp);
  element.addEventListener('pointercancel', handlePointerCancel);
  element.addEventListener('lostpointercapture', handleLostPointerCapture);
  element.addEventListener('wheel', handleWheel, { passive: false });

  return {
    destroy() {
      pointers.clear();
      panPointerId = null;
      lastPanPoint = null;
      pinch = null;
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerCancel);
      element.removeEventListener('lostpointercapture', handleLostPointerCapture);
      element.removeEventListener('wheel', handleWheel);
    },
  };
}
