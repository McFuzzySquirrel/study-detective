/**
 * Pure crop and rotation math for the capture editor.
 *
 * Every rectangle is normalized to the oriented source image: `x` and `y` are
 * the top-left corner and all four values live in the 0-1 unit square. The
 * retained original always stays in that source orientation, so a crop can be
 * replayed later against the same source without depending on a derivative's
 * pixel dimensions.
 *
 * Rotation is one of four exact clockwise quarter turns. Nothing here touches
 * a bitmap, canvas, DOM node, repository, or object URL, and no function
 * mutates its input.
 */

import type { CropRect, Rotation } from './imagePipeline';

export type { CropRect, Rotation };

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CropState {
  readonly crop: CropRect;
  readonly rotation: Rotation;
}

export type CropNudgeDirection = 'left' | 'right' | 'up' | 'down';

export interface CropOutputBounds {
  /** The crop in integer oriented-source pixels. */
  readonly sourcePixels: PixelRect;
  /** The derivative dimensions after the clockwise rotation. */
  readonly outputPixels: Size;
  /** Width divided by height after rotation. */
  readonly aspectRatio: number;
}

/** The whole oriented source: the reset target and the default editor crop. */
export const FULL_CROP: Readonly<CropRect> = Object.freeze({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

/** Normalized values are rounded to millionths so no binary-float tails persist. */
export const CROP_PRECISION = 1_000_000;

/** One keyboard nudge moves the crop window by two percent of the displayed frame. */
export const DEFAULT_NUDGE_STEP = 0.02;

const CONTAINMENT_EPSILON = 1e-9;
const MIN_CROP_EXTENT = 1 / CROP_PRECISION;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

function roundUnit(value: number): number {
  const rounded = Math.round(value * CROP_PRECISION) / CROP_PRECISION;
  // Math.round(-0.0000001) produces -0, which serializes as 0 but reads badly
  // in a snapshot or a comparison.
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Crop ${name} must be a finite number.`);
  }
}

function readCrop(input: Partial<CropRect>): CropRect {
  return {
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? 1,
    height: input.height ?? 1,
  };
}

function assertPositiveExtent(width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    throw new RangeError('Crop width and height must be greater than 0.');
  }
}

function roundCrop(crop: CropRect): CropRect {
  return {
    x: roundUnit(crop.x),
    y: roundUnit(crop.y),
    width: roundUnit(crop.width),
    height: roundUnit(crop.height),
  };
}

/** Round a quarter turn to the nearest exact 0/90/180/270 value. */
export function normalizeRotation(value: number): Rotation {
  assertFinite(value, 'rotation');
  const normalized = (((Math.round(value / 90) * 90) % 360) + 360) % 360;
  return normalized as Rotation;
}

/** Turn by a whole number of clockwise quarter turns without accumulating radians. */
export function rotateBy(rotation: Rotation, quarterTurns: number): Rotation {
  assertFinite(quarterTurns, 'quarter turn count');
  if (!Number.isInteger(quarterTurns)) {
    throw new RangeError('Crop quarter turns must be an integer.');
  }

  const base = normalizeRotation(rotation);
  const steps = (base / 90 + quarterTurns) % 4;
  return (((steps + 4) % 4) * 90) as Rotation;
}

export function rotateLeft(rotation: Rotation): Rotation {
  return rotateBy(rotation, -1);
}

export function rotateRight(rotation: Rotation): Rotation {
  return rotateBy(rotation, 1);
}

/** Swap the axes for a quarter turn; 0 and 180 keep them. */
export function rotatedDimensions(width: number, height: number, rotation: Rotation): Size {
  assertFinite(width, 'width');
  assertFinite(height, 'height');
  if (width <= 0 || height <= 0) {
    throw new RangeError('Image dimensions must be positive.');
  }

  const normalizedRotation = normalizeRotation(rotation);
  return normalizedRotation === 90 || normalizedRotation === 270
    ? { width: height, height: width }
    : { width, height };
}

/**
 * The same content rotated a quarter turn has a reciprocal aspect ratio. Keep
 * the crop frame in step with the photo so rotating a full-frame selection
 * does not silently crop a band out of the portrait result.
 */
export function rotatedAspectRatio(aspectRatio: number, rotation: Rotation): number {
  assertFinite(aspectRatio, 'aspect ratio');
  if (aspectRatio <= 0) {
    throw new RangeError('The aspect ratio must be greater than 0.');
  }

  const normalizedRotation = normalizeRotation(rotation);
  return normalizedRotation === 90 || normalizedRotation === 270 ? 1 / aspectRatio : aspectRatio;
}

/**
 * Clamp a crop inside the unit square while preserving the rectangle's own
 * aspect ratio. Oversized rectangles shrink uniformly; displaced rectangles
 * keep their size and slide back inside.
 */
export function clampCropRect(input: Partial<CropRect> = {}): CropRect {
  const { x, y, width, height } = readCrop(input);
  assertFinite(x, 'x');
  assertFinite(y, 'y');
  assertFinite(width, 'width');
  assertFinite(height, 'height');
  assertPositiveExtent(width, height);

  const scale = Math.min(1, 1 / width, 1 / height);
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;

  if (scaledWidth < MIN_CROP_EXTENT || scaledHeight < MIN_CROP_EXTENT) {
    throw new RangeError('Crop width and height are too small to store.');
  }

  const clampedWidth = Math.min(1, roundUnit(scaledWidth));
  const clampedHeight = Math.min(1, roundUnit(scaledHeight));
  const clampedX = clamp(roundUnit(x), 0, Math.max(0, roundUnit(1 - clampedWidth)));
  const clampedY = clamp(roundUnit(y), 0, Math.max(0, roundUnit(1 - clampedHeight)));

  return {
    x: clampedX,
    y: clampedY,
    width: clampedWidth,
    height: clampedHeight,
  };
}

/**
 * Validate and clamp a crop with the pipeline's edge semantics: the origin is
 * clamped first, then the width and height are reduced to the remaining space.
 * Use `clampCropRect` when the rectangle's aspect ratio must be preserved.
 */
export function normalizeCropRect(input: Partial<CropRect> = {}): CropRect {
  const { x, y, width, height } = readCrop(input);
  assertFinite(x, 'x');
  assertFinite(y, 'y');
  assertFinite(width, 'width');
  assertFinite(height, 'height');
  assertPositiveExtent(width, height);

  const clampedX = clampUnit(x);
  const clampedY = clampUnit(y);
  const clampedWidth = Math.min(clampUnit(width), 1 - clampedX);
  const clampedHeight = Math.min(clampUnit(height), 1 - clampedY);

  if (clampedWidth <= 0 || clampedHeight <= 0) {
    throw new RangeError('The crop must overlap the image.');
  }

  return roundCrop({
    x: clampedX,
    y: clampedY,
    width: clampedWidth,
    height: clampedHeight,
  });
}

/** True when the rectangle is finite, non-empty, and wholly inside the image. */
export function isCropContained(crop: Partial<CropRect>, epsilon = CONTAINMENT_EPSILON): boolean {
  const { x, y, width, height } = readCrop(crop);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return false;
  }

  return (
    x >= -epsilon &&
    y >= -epsilon &&
    width <= 1 + epsilon &&
    height <= 1 + epsilon &&
    x + width <= 1 + epsilon &&
    y + height <= 1 + epsilon
  );
}

/** Slide a contained rectangle without changing its size. */
export function translateCropRect(crop: Partial<CropRect>, dx: number, dy: number): CropRect {
  assertFinite(dx, 'x offset');
  assertFinite(dy, 'y offset');

  const contained = clampCropRect(crop);
  return {
    x: roundUnit(clamp(contained.x + dx, 0, 1 - contained.width)),
    y: roundUnit(clamp(contained.y + dy, 0, 1 - contained.height)),
    width: contained.width,
    height: contained.height,
  };
}

/**
 * Nudge the crop window in the displayed (rotated) orientation. A `right`
 * nudge therefore moves the source rectangle vertically when the photo is
 * rotated a quarter turn.
 */
export function nudgeCropRect(
  crop: Partial<CropRect>,
  rotation: Rotation,
  direction: CropNudgeDirection,
  step = DEFAULT_NUDGE_STEP,
): CropRect {
  assertFinite(step, 'nudge step');
  if (step <= 0) {
    throw new RangeError('The crop nudge step must be greater than 0.');
  }

  const normalizedRotation = normalizeRotation(rotation);
  const rotated = cropToRotated(crop, normalizedRotation);
  const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
  const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;

  return cropFromRotated(translateCropRect(rotated, dx, dy), normalizedRotation);
}

/**
 * Map a normalized source crop into the rotated display frame. For 90 and 270
 * the width and height swap, so a landscape crop is not squashed into a
 * portrait box.
 */
export function cropToRotated(crop: Partial<CropRect>, rotation: Rotation): CropRect {
  const source = clampCropRect(crop);
  const normalizedRotation = normalizeRotation(rotation);

  switch (normalizedRotation) {
    case 90:
      return clampCropRect({
        x: 1 - source.y - source.height,
        y: source.x,
        width: source.height,
        height: source.width,
      });
    case 180:
      return clampCropRect({
        x: 1 - source.x - source.width,
        y: 1 - source.y - source.height,
        width: source.width,
        height: source.height,
      });
    case 270:
      return clampCropRect({
        x: source.y,
        y: 1 - source.x - source.width,
        width: source.height,
        height: source.width,
      });
    case 0:
    default:
      return source;
  }
}

/** Map a crop measured in the rotated display frame back to the source frame. */
export function cropFromRotated(crop: Partial<CropRect>, rotation: Rotation): CropRect {
  const rotated = clampCropRect(crop);
  const normalizedRotation = normalizeRotation(rotation);

  switch (normalizedRotation) {
    case 90:
      return clampCropRect({
        x: rotated.y,
        y: 1 - rotated.x - rotated.width,
        width: rotated.height,
        height: rotated.width,
      });
    case 180:
      return clampCropRect({
        x: 1 - rotated.x - rotated.width,
        y: 1 - rotated.y - rotated.height,
        width: rotated.width,
        height: rotated.height,
      });
    case 270:
      return clampCropRect({
        x: 1 - rotated.y - rotated.height,
        y: rotated.x,
        width: rotated.height,
        height: rotated.width,
      });
    case 0:
    default:
      return rotated;
  }
}

/**
 * Integer pixel bounds for a crop, matching the derivative generator's
 * one-pixel floor. The output dimensions are the rotated result, so a
 * 1600x1500 crop at 90 degrees becomes 1500x1600.
 */
export function computeOutputBounds(
  crop: Partial<CropRect>,
  sourceWidth: number,
  sourceHeight: number,
  rotation: Rotation,
): CropOutputBounds {
  assertFinite(sourceWidth, 'source width');
  assertFinite(sourceHeight, 'source height');
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('Image dimensions must be positive.');
  }

  const normalized = normalizeCropRect(crop);
  const x = clamp(Math.round(normalized.x * sourceWidth), 0, sourceWidth - 1);
  const y = clamp(Math.round(normalized.y * sourceHeight), 0, sourceHeight - 1);
  const right = clamp(
    Math.round((normalized.x + normalized.width) * sourceWidth),
    x + 1,
    sourceWidth,
  );
  const bottom = clamp(
    Math.round((normalized.y + normalized.height) * sourceHeight),
    y + 1,
    sourceHeight,
  );

  const sourcePixels: PixelRect = {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
  const outputPixels = rotatedDimensions(
    sourcePixels.width,
    sourcePixels.height,
    normalizeRotation(rotation),
  );

  return {
    sourcePixels,
    outputPixels,
    aspectRatio: outputPixels.height === 0 ? 0 : outputPixels.width / outputPixels.height,
  };
}

/**
 * Rotation-aware preview dimensions. Without bounds this is the rotated full
 * image; with bounds it is contained inside them and never enlarged.
 */
export function previewDimensions(
  sourceWidth: number,
  sourceHeight: number,
  rotation: Rotation,
  bounds?: Size,
): Size {
  const rotated = rotatedDimensions(sourceWidth, sourceHeight, rotation);

  if (bounds === undefined) {
    return rotated;
  }

  return fitWithin(rotated, bounds);
}

/** Contain a size inside a box, preserving aspect ratio and never upscaling. */
export function fitWithin(size: Size, bounds: Size): Size {
  assertFinite(size.width, 'width');
  assertFinite(size.height, 'height');
  assertFinite(bounds.width, 'bounds width');
  assertFinite(bounds.height, 'bounds height');
  if (size.width <= 0 || size.height <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    throw new RangeError('Sizes and bounds must be positive.');
  }

  const scale = Math.min(1, bounds.width / size.width, bounds.height / size.height);
  return {
    width: Math.max(1, Math.min(bounds.width, Math.round(size.width * scale))),
    height: Math.max(1, Math.min(bounds.height, Math.round(size.height * scale))),
  };
}

/** A fresh reset target: full image, upright. */
export function resetCropState(): CropState {
  return Object.freeze({ crop: FULL_CROP, rotation: 0 });
}

/** Compare two crops within a tolerance, for dirty-state checks. */
export function cropRectsEqual(
  first: Partial<CropRect>,
  second: Partial<CropRect>,
  tolerance = 1 / CROP_PRECISION,
): boolean {
  const a = readCrop(first);
  const b = readCrop(second);

  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

const ROTATION_LABELS: Readonly<Record<Rotation, string>> = Object.freeze({
  0: 'upright',
  90: '90° clockwise',
  180: '180°',
  270: '270° clockwise',
});

/**
 * A short, announced description of the selection. Percentages are whole
 * numbers and always add up to 100 so a screen reader never hears "101%".
 */
export function describeCrop(crop: Partial<CropRect>, rotation: Rotation): string {
  const normalized = normalizeCropRect(crop);
  const normalizedRotation = normalizeRotation(rotation);

  const left = Math.min(99, Math.max(0, Math.round(normalized.x * 100)));
  const top = Math.min(99, Math.max(0, Math.round(normalized.y * 100)));
  const width = Math.max(1, Math.min(100 - left, Math.round(normalized.width * 100)));
  const height = Math.max(1, Math.min(100 - top, Math.round(normalized.height * 100)));

  return `Crop ${width}% wide, ${height}% tall, starting ${left}% from the left and ${top}% from the top. Rotation: ${ROTATION_LABELS[normalizedRotation]}.`;
}
