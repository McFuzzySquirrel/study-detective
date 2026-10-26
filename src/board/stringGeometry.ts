/**
 * Pure geometry for the case-board strings.
 *
 * Strings are physical: they leave the *nearest edge* of each card, sag under
 * the board's gravity, and get thicker and longer when the student zooms in.
 * This module computes that shape in **screen space** so the Pixi string layer
 * can draw below the world-scaled cards, hit-test in pointer pixels, and keep
 * the dashed provenance pattern legible at every zoom.
 *
 * Coordinate contract:
 *
 * - Card rectangles and returned points are screen pixels.
 * - `scale` is the board camera zoom (0.25-2.5). A 12 px sag at 100 percent
 *   becomes 6 px at 50 percent and 30 px at 250 percent.
 * - The sag is clamped to a fraction of the empty gap between the two cards so
 *   close cards cannot make a string bow through its neighbour.
 *
 * There is no PixiJS, DOM, React, storage, or repository import here. Every
 * helper is deterministic and mutation-free, and every function is safe for
 * degenerate rectangles (zero size, zero distance, overlapping cards).
 */

import type { ConnectionType } from '../domain/model';

import { clampScale, type BoardPoint } from './viewport';

/** Vertical sag at 100 percent zoom, in screen pixels. */
export const STRING_SAG_AT_SCALE_ONE = 12;

/** Association strings are the thicker solid red thread. */
export const ASSOCIATION_STROKE_WIDTH = 3;

/** Provenance strings are the thinner dashed amber thread. */
export const PROVENANCE_STROKE_WIDTH = 2;

/** Provenance dash and gap lengths at 100 percent zoom, in screen pixels. */
export const PROVENANCE_DASH_LENGTH = 8;
export const PROVENANCE_DASH_GAP = 6;

/**
 * Invisible hit band radius. The contract's 44 px touch target is met by a
 * 22 px radius on each side of the thread; the rendered stroke stays 3/2 px.
 */
export const STRING_HIT_TOLERANCE = 22;

/** A thread never renders thinner than one screen pixel. */
export const STRING_MIN_STROKE_WIDTH = 1;

/** A sag may use at most this share of the empty space between two cards. */
export const STRING_MAX_SAG_GAP_FRACTION = 0.4;

/** Curve samples used for hit testing and band outlines. */
export const STRING_CURVE_SAMPLES = 24;

/** Minimum samples used to place provenance dashes along the curve. */
export const STRING_DASH_SAMPLES = 24;

/** The theme tokens and fallbacks for the two string meanings. */
export const STRING_COLOR_TOKENS = Object.freeze({
  association: '--color-string-association',
  provenance: '--color-string-provenance',
});

export const STRING_COLOR_FALLBACKS = Object.freeze({
  association: 0xcf3d2f,
  provenance: 0xe8aa3c,
});

export interface StringRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type StringOrientation = 'horizontal' | 'vertical';
export type StringDirection = 'right' | 'left' | 'below' | 'above';

export interface StringAnchors {
  /** The point on the first card's nearest edge. */
  readonly from: BoardPoint;
  /** The point on the second card's nearest edge. */
  readonly to: BoardPoint;
  /** The axis used to choose the nearest edge pair. */
  readonly orientation: StringOrientation;
  /** Which edge of the first card the thread leaves from. */
  readonly direction: StringDirection;
  /** Empty space between the two card edges along the chosen axis. */
  readonly gap: number;
}

export interface StringStrokeStyle {
  readonly width: number;
  readonly dashed: boolean;
  readonly dashLength: number;
  readonly dashGap: number;
}

export interface StringGeometry {
  /** The first card's anchor. */
  readonly start: BoardPoint;
  /** The second card's anchor. */
  readonly end: BoardPoint;
  /** Quadratic control point; the curve sags below the straight midpoint. */
  readonly control: BoardPoint;
  /** Midpoint of the straight chord between the anchors. */
  readonly midpoint: BoardPoint;
  /** Visible sag in screen pixels (curve midpoint minus chord midpoint). */
  readonly sag: number;
  readonly type: ConnectionType;
  readonly strokeWidth: number;
  readonly dashed: boolean;
  readonly dashLength: number;
  readonly dashGap: number;
  /** Invisible hit band radius in screen pixels. */
  readonly hitTolerance: number;
  /** Screen-space bounds of the curve and its stroke. */
  readonly bounds: StringRect;
  readonly anchors: StringAnchors;
}

export interface StringGeometryOptions {
  readonly type?: ConnectionType;
  /** Board zoom. Invalid or missing values fall back to 100 percent. */
  readonly scale?: number;
}

export interface StringDashOptions {
  readonly dashLength?: number;
  readonly gapLength?: number;
}

export interface StringSegment {
  readonly start: BoardPoint;
  readonly end: BoardPoint;
}

export interface StringHitBand {
  readonly tolerance: number;
  /** Closed outline: one side of the thread forward, the other side back. */
  readonly outline: readonly BoardPoint[];
}

const EPSILON = 1e-9;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeZoom(scale: number | undefined): number {
  if (scale === undefined) {
    return 1;
  }
  return clampScale(scale, 1);
}

function safeRect(rect: StringRect): StringRect {
  const width = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 0;
  const height = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 0;

  return {
    x: finiteOr(rect.x, 0),
    y: finiteOr(rect.y, 0),
    width,
    height,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rectCenter(rect: StringRect): BoardPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The stroke style for one string at a given zoom. Association is 3 px solid
 * red; provenance is 2 px dashed amber. Both scale with the board and have a
 * one-pixel visual floor so a zoomed-out case cannot lose its threads.
 */
export function stringStrokeStyle(type: ConnectionType, scale: number = 1): StringStrokeStyle {
  const zoom = normalizeZoom(scale);

  if (type === 'provenance') {
    return {
      width: Math.max(STRING_MIN_STROKE_WIDTH, PROVENANCE_STROKE_WIDTH * zoom),
      dashed: true,
      dashLength: Math.max(3, PROVENANCE_DASH_LENGTH * zoom),
      dashGap: Math.max(2, PROVENANCE_DASH_GAP * zoom),
    };
  }

  return {
    width: Math.max(STRING_MIN_STROKE_WIDTH, ASSOCIATION_STROKE_WIDTH * zoom),
    dashed: false,
    dashLength: 0,
    dashGap: 0,
  };
}

/**
 * Choose the nearest edge pair for two card rectangles.
 *
 * Rectangles that are separated on both axes use the axis with the smaller
 * empty gap, which puts the endpoints on the closest edge rather than the
 * diagonal centre. When they overlap on both axes, the dominant centre offset
 * breaks the tie. Anchor coordinates are clamped to the edge span, so a card
 * that is above and to the right anchors at the nearest point on the vertical
 * edge rather than an extrapolated midpoint.
 */
export function resolveStringAnchors(fromRect: StringRect, toRect: StringRect): StringAnchors {
  const from = safeRect(fromRect);
  const to = safeRect(toRect);
  const fromCenter = rectCenter(from);
  const toCenter = rectCenter(to);

  const horizontalGap =
    toCenter.x >= fromCenter.x ? to.x - (from.x + from.width) : from.x - (to.x + to.width);
  const verticalGap =
    toCenter.y >= fromCenter.y ? to.y - (from.y + from.height) : from.y - (to.y + to.height);

  const horizontalSeparation = Math.max(0, horizontalGap);
  const verticalSeparation = Math.max(0, verticalGap);

  let orientation: StringOrientation;
  if (horizontalSeparation > 0 && verticalSeparation > 0) {
    orientation = horizontalSeparation <= verticalSeparation ? 'horizontal' : 'vertical';
  } else if (horizontalSeparation > 0) {
    orientation = 'horizontal';
  } else if (verticalSeparation > 0) {
    orientation = 'vertical';
  } else {
    orientation =
      Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y)
        ? 'horizontal'
        : 'vertical';
  }

  if (orientation === 'horizontal') {
    if (toCenter.x >= fromCenter.x) {
      return {
        from: {
          x: from.x + from.width,
          y: clamp(toCenter.y, from.y, from.y + from.height),
        },
        to: {
          x: to.x,
          y: clamp(fromCenter.y, to.y, to.y + to.height),
        },
        orientation,
        direction: 'right',
        gap: horizontalSeparation,
      };
    }

    return {
      from: {
        x: from.x,
        y: clamp(toCenter.y, from.y, from.y + from.height),
      },
      to: {
        x: to.x + to.width,
        y: clamp(fromCenter.y, to.y, to.y + to.height),
      },
      orientation,
      direction: 'left',
      gap: horizontalSeparation,
    };
  }

  if (toCenter.y >= fromCenter.y) {
    return {
      from: {
        x: clamp(toCenter.x, from.x, from.x + from.width),
        y: from.y + from.height,
      },
      to: {
        x: clamp(fromCenter.x, to.x, to.x + to.width),
        y: to.y,
      },
      orientation,
      direction: 'below',
      gap: verticalSeparation,
    };
  }

  return {
    from: {
      x: clamp(toCenter.x, from.x, from.x + from.width),
      y: from.y,
    },
    to: {
      x: clamp(fromCenter.x, to.x, to.x + to.width),
      y: to.y + to.height,
    },
    orientation,
    direction: 'above',
    gap: verticalSeparation,
  };
}

/**
 * A unit normal for the chord with a deterministic "downward" preference. A
 * horizontal thread sags down; a vertical thread bows to the right; swapping
 * the two cards produces the same normal and therefore the same curve.
 */
function sagNormal(start: BoardPoint, end: BoardPoint): BoardPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length <= EPSILON) {
    return { x: 0, y: 1 };
  }

  let x = -dy / length;
  let y = dx / length;

  if (y < -EPSILON) {
    x = -x;
    y = -y;
  } else if (Math.abs(y) <= EPSILON && x < 0) {
    x = -x;
    y = -y;
  }

  return { x, y };
}

function curveBounds(
  start: BoardPoint,
  control: BoardPoint,
  end: BoardPoint,
  strokeWidth: number,
): StringRect {
  const padding = Math.max(1, strokeWidth / 2 + 1);
  const minX = Math.min(start.x, control.x, end.x) - padding;
  const minY = Math.min(start.y, control.y, end.y) - padding;
  const maxX = Math.max(start.x, control.x, end.x) + padding;
  const maxY = Math.max(start.y, control.y, end.y) + padding;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Compute the full screen-space geometry for one string.
 *
 * `sag = min(12 * scale, 0.4 * gap)`. The gap clamp keeps the bow between the
 * two card edges; the zoom term makes it grow with the board.
 */
export function computeStringGeometry(
  fromRect: StringRect,
  toRect: StringRect,
  options: StringGeometryOptions = {},
): StringGeometry {
  const type = options.type ?? 'association';
  const zoom = normalizeZoom(options.scale);
  const anchors = resolveStringAnchors(fromRect, toRect);

  const start = anchors.from;
  const end = anchors.to;
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };

  const sagLimit = Math.max(0, anchors.gap * STRING_MAX_SAG_GAP_FRACTION);
  const sag = Math.min(STRING_SAG_AT_SCALE_ONE * zoom, sagLimit);
  const normal = sagNormal(start, end);
  const control = {
    x: midpoint.x + normal.x * sag * 2,
    y: midpoint.y + normal.y * sag * 2,
  };

  const style = stringStrokeStyle(type, zoom);

  return {
    start,
    end,
    control,
    midpoint,
    sag,
    type,
    strokeWidth: style.width,
    dashed: style.dashed,
    dashLength: style.dashLength,
    dashGap: style.dashGap,
    hitTolerance: STRING_HIT_TOLERANCE,
    bounds: curveBounds(start, control, end, style.width),
    anchors,
  };
}

/** The point on the quadratic curve at parameter `t` in [0, 1]. */
export function pointOnString(geometry: StringGeometry, t: number): BoardPoint {
  const clamped = clamp(Number.isFinite(t) ? t : 0, 0, 1);
  const inverse = 1 - clamped;
  const startWeight = inverse * inverse;
  const controlWeight = 2 * inverse * clamped;
  const endWeight = clamped * clamped;

  return {
    x:
      geometry.start.x * startWeight +
      geometry.control.x * controlWeight +
      geometry.end.x * endWeight,
    y:
      geometry.start.y * startWeight +
      geometry.control.y * controlWeight +
      geometry.end.y * endWeight,
  };
}

/**
 * Sample the quadratic into a polyline. Used by dashes, hit testing, and the
 * band outline; the result always includes both anchors.
 */
export function sampleStringCurve(
  geometry: StringGeometry,
  steps: number = STRING_CURVE_SAMPLES,
): BoardPoint[] {
  const count = Math.max(2, Math.floor(Number.isFinite(steps) ? steps : STRING_CURVE_SAMPLES));
  const points: BoardPoint[] = new Array<BoardPoint>(count + 1);

  for (let index = 0; index <= count; index += 1) {
    points[index] = pointOnString(geometry, index / count);
  }

  return points;
}

function distanceSquared(first: BoardPoint, second: BoardPoint): number {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
}

function segmentDistanceSquared(point: BoardPoint, start: BoardPoint, end: BoardPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= EPSILON) {
    return distanceSquared(point, start);
  }

  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const projection = { x: start.x + dx * t, y: start.y + dy * t };
  return distanceSquared(point, projection);
}

/**
 * Squared distance from a point to the sampled curve. Comparing squared
 * distances avoids a square root inside the 300-string hit-test loop.
 */
export function distanceSquaredToString(
  geometry: StringGeometry,
  point: BoardPoint,
  steps: number = STRING_CURVE_SAMPLES,
): number {
  const samples = sampleStringCurve(geometry, steps);
  let best = Number.POSITIVE_INFINITY;
  let previous = samples[0];

  if (previous === undefined) {
    return best;
  }

  for (let index = 1; index < samples.length; index += 1) {
    const current = samples[index];
    if (current === undefined) {
      continue;
    }
    best = Math.min(best, segmentDistanceSquared(point, previous, current));
    previous = current;
  }

  return best;
}

/** Distance from a screen point to the string curve. */
export function distanceToString(
  geometry: StringGeometry,
  point: BoardPoint,
  steps: number = STRING_CURVE_SAMPLES,
): number {
  return Math.sqrt(distanceSquaredToString(geometry, point, steps));
}

/**
 * True when a screen point is inside the string's invisible hit band. The
 * default tolerance is a 22 px radius (44 px band) for touch.
 */
export function hitTestStringGeometry(
  geometry: StringGeometry,
  point: BoardPoint,
  tolerance: number = geometry.hitTolerance,
): boolean {
  const radius = Math.max(
    0,
    Number.isFinite(tolerance) ? tolerance : geometry.hitTolerance,
    geometry.strokeWidth / 2,
  );

  return distanceSquaredToString(geometry, point) <= radius * radius;
}

/**
 * Build the closed outline of the string's hit band. This is primarily a
 * geometry contract for tests and future DOM overlays; the layer hit-tests
 * against distance so it does not allocate a polygon per pointer event.
 */
export function computeStringHitBand(
  geometry: StringGeometry,
  tolerance: number = geometry.hitTolerance,
): StringHitBand {
  const radius = Math.max(
    0,
    Number.isFinite(tolerance) ? tolerance : geometry.hitTolerance,
    geometry.strokeWidth / 2,
  );
  const samples = sampleStringCurve(geometry, STRING_CURVE_SAMPLES);
  const left: BoardPoint[] = [];
  const right: BoardPoint[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const point = samples[index];
    if (point === undefined) {
      continue;
    }

    const previous = samples[Math.max(0, index - 1)] ?? point;
    const next = samples[Math.min(samples.length - 1, index + 1)] ?? point;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    const normalX = length <= EPSILON ? 0 : -dy / length;
    const normalY = length <= EPSILON ? 1 : dx / length;

    left.push({
      x: point.x + normalX * radius,
      y: point.y + normalY * radius,
    });
    right.push({
      x: point.x - normalX * radius,
      y: point.y - normalY * radius,
    });
  }

  return {
    tolerance: radius,
    outline: [...right, ...left.reverse()],
  };
}

function pointAtDistance(
  points: readonly BoardPoint[],
  cumulative: readonly number[],
  distance: number,
): BoardPoint {
  const lastIndex = points.length - 1;
  const first = points[0];
  const last = points[lastIndex];

  if (first === undefined || last === undefined) {
    return { x: 0, y: 0 };
  }

  const total = cumulative[lastIndex] ?? 0;
  if (distance <= 0) {
    return first;
  }
  if (distance >= total) {
    return last;
  }

  let low = 0;
  let high = lastIndex;

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    const middleDistance = cumulative[middle] ?? 0;
    if (middleDistance <= distance) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const start = points[low] ?? first;
  const end = points[high] ?? last;
  const startDistance = cumulative[low] ?? 0;
  const endDistance = cumulative[high] ?? startDistance;
  const span = endDistance - startDistance;
  const t = span <= EPSILON ? 0 : (distance - startDistance) / span;

  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

/**
 * Compute the dash segments for a provenance string. Association strings
 * return an empty list. The first dash starts at the anchor and the pattern
 * walks the curve by arc length, so dashes stay even through the sag.
 */
export function computeStringDashes(
  geometry: StringGeometry,
  options: StringDashOptions = {},
): StringSegment[] {
  if (!geometry.dashed) {
    return [];
  }

  const dashLength =
    options.dashLength !== undefined &&
    Number.isFinite(options.dashLength) &&
    options.dashLength > 0
      ? options.dashLength
      : geometry.dashLength > 0
        ? geometry.dashLength
        : PROVENANCE_DASH_LENGTH;
  const gapLength =
    options.gapLength !== undefined && Number.isFinite(options.gapLength) && options.gapLength >= 0
      ? options.gapLength
      : geometry.dashGap >= 0
        ? geometry.dashGap
        : PROVENANCE_DASH_GAP;

  const chordLength =
    Math.hypot(geometry.control.x - geometry.start.x, geometry.control.y - geometry.start.y) +
    Math.hypot(geometry.end.x - geometry.control.x, geometry.end.y - geometry.control.y);
  const sampleCount = Math.min(96, Math.max(STRING_DASH_SAMPLES, Math.ceil(chordLength / 8)));
  const points = sampleStringCurve(geometry, sampleCount);
  const cumulative: number[] = new Array<number>(points.length);
  let total = 0;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[Math.max(0, index - 1)];
    if (point === undefined || previous === undefined) {
      cumulative[index] = total;
      continue;
    }
    if (index > 0) {
      total += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    cumulative[index] = total;
  }

  if (total <= EPSILON) {
    return [];
  }

  const period = dashLength + gapLength;
  const segments: StringSegment[] = [];

  for (let startDistance = 0; startDistance < total; startDistance += period) {
    const endDistance = Math.min(total, startDistance + dashLength);
    if (endDistance <= startDistance) {
      continue;
    }

    segments.push({
      start: pointAtDistance(points, cumulative, startDistance),
      end: pointAtDistance(points, cumulative, endDistance),
    });
  }

  return segments;
}
