// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  CROP_PRECISION,
  DEFAULT_NUDGE_STEP,
  FULL_CROP,
  clampCropRect,
  computeOutputBounds,
  cropFromRotated,
  cropRectsEqual,
  cropToRotated,
  describeCrop,
  fitWithin,
  isCropContained,
  nudgeCropRect,
  normalizeCropRect,
  normalizeRotation,
  previewDimensions,
  resetCropState,
  rotateBy,
  rotateLeft,
  rotateRight,
  rotatedAspectRatio,
  rotatedDimensions,
  translateCropRect,
  type CropRect,
  type Rotation,
} from '../../src/features/capture/cropMath';

const SAMPLE: CropRect = Object.freeze({ x: 0.2, y: 0.25, width: 0.5, height: 0.25 });

function frozenCrop(crop: CropRect): CropRect {
  return Object.freeze({ ...crop });
}

describe('rotation quarters', () => {
  it('normalizes signed, overshooting, and fractional rotations to exact quarters', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(720)).toBe(0);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-450)).toBe(270);
    expect(normalizeRotation(89)).toBe(90);
    expect(normalizeRotation(89.4)).toBe(90);
    expect(normalizeRotation(-0.1)).toBe(0);
  });

  it('rejects non-finite rotations', () => {
    expect(() => normalizeRotation(Number.NaN)).toThrow(RangeError);
    expect(() => normalizeRotation(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('cycles right and left through all four values with no floating residue', () => {
    let rotation: Rotation = 0;
    const seen: number[] = [];

    for (let index = 0; index < 4; index += 1) {
      rotation = rotateRight(rotation);
      seen.push(rotation);
    }

    expect(seen).toEqual([90, 180, 270, 0]);
    expect(Object.is(rotation, 0)).toBe(true);
    expect(rotateLeft(0)).toBe(270);
    expect(rotateLeft(90)).toBe(0);
    expect(rotateLeft(rotateRight(rotateRight(0)))).toBe(90);
  });

  it('stays exact after a thousand cycles', () => {
    let rotation: Rotation = 0;

    for (let index = 0; index < 1_001; index += 1) {
      rotation = rotateRight(rotation);
    }

    expect(rotation).toBe(90);
    expect(Number.isInteger(rotation)).toBe(true);
  });

  it('rotates by whole quarter turns and rejects fractional turns', () => {
    expect(rotateBy(90, 2)).toBe(270);
    expect(rotateBy(90, 3)).toBe(0);
    expect(rotateBy(0, -1)).toBe(270);
    expect(rotateBy(180, 3)).toBe(90);
    expect(() => rotateBy(0, 1.5)).toThrow(RangeError);
    expect(() => rotateBy(0, Number.NaN)).toThrow(RangeError);
  });

  it('swaps dimensions only for a quarter turn', () => {
    expect(rotatedDimensions(1000, 500, 0)).toEqual({ width: 1000, height: 500 });
    expect(rotatedDimensions(1000, 500, 90)).toEqual({ width: 500, height: 1000 });
    expect(rotatedDimensions(1000, 500, 180)).toEqual({ width: 1000, height: 500 });
    expect(rotatedDimensions(1000, 500, 270)).toEqual({ width: 500, height: 1000 });
    expect(() => rotatedDimensions(0, 500, 90)).toThrow(RangeError);
  });

  it('keeps the crop frame in step with a rotated selection', () => {
    expect(rotatedAspectRatio(4 / 3, 0)).toBeCloseTo(4 / 3, 12);
    expect(rotatedAspectRatio(4 / 3, 90)).toBeCloseTo(3 / 4, 12);
    expect(rotatedAspectRatio(4 / 3, 180)).toBeCloseTo(4 / 3, 12);
    expect(rotatedAspectRatio(4 / 3, 270)).toBeCloseTo(3 / 4, 12);
    expect(rotatedAspectRatio(rotatedAspectRatio(4 / 3, 90), 90)).toBeCloseTo(4 / 3, 12);
    expect(() => rotatedAspectRatio(0, 0)).toThrow(RangeError);
    expect(() => rotatedAspectRatio(Number.NaN, 0)).toThrow(RangeError);
  });
});

describe('normalized crop rectangles', () => {
  it('defaults to the full image without sharing mutable state', () => {
    const first = normalizeCropRect();
    const second = normalizeCropRect();

    expect(first).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(second).toEqual(first);
    expect(first).not.toBe(second);
    expect(FULL_CROP).toEqual(first);
    expect(Object.isFrozen(FULL_CROP)).toBe(true);
  });

  it('clamps negative origins and oversized extents inside the unit square', () => {
    expect(normalizeCropRect({ x: -0.5, y: 0.8, width: 2, height: 2 })).toEqual({
      x: 0,
      y: 0.8,
      width: 1,
      height: 0.2,
    });
    expect(normalizeCropRect({ x: 0.75, y: 0.9, width: 0.5, height: 0.5 })).toEqual({
      x: 0.75,
      y: 0.9,
      width: 0.25,
      height: 0.1,
    });
  });

  it('rounds binary-float tails to millionths', () => {
    const normalized = normalizeCropRect({
      x: 0.1 + 0.2,
      y: 0.4 + 0.2,
      width: 1 / 3,
      height: 1 / 7,
    });

    expect(normalized).toEqual({ x: 0.3, y: 0.6, width: 0.333333, height: 0.142857 });
    expect(Number.isInteger(normalized.x * CROP_PRECISION)).toBe(true);
  });

  it('rejects empty, negative, and non-finite rectangles', () => {
    expect(() => normalizeCropRect({ x: 0, y: 0, width: 0, height: 1 })).toThrow(RangeError);
    expect(() => normalizeCropRect({ x: 0, y: 0, width: 1, height: -1 })).toThrow(RangeError);
    expect(() => normalizeCropRect({ x: Number.NaN, width: 1, height: 1 })).toThrow(RangeError);
    expect(() => normalizeCropRect({ x: 2, width: 1, height: 1 })).toThrow(RangeError);
  });

  it('does not mutate a frozen input', () => {
    const input = frozenCrop({ x: -1, y: -1, width: 2, height: 2 });
    expect(() => normalizeCropRect(input)).not.toThrow();
    expect(input).toEqual({ x: -1, y: -1, width: 2, height: 2 });
  });
});

describe('aspect-preserving containment', () => {
  it('slides a displaced rectangle without resizing it', () => {
    expect(clampCropRect({ x: -0.4, y: -0.3, width: 0.5, height: 0.25 })).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.25,
    });
    expect(clampCropRect({ x: 0.8, y: 0.9, width: 0.5, height: 0.25 })).toEqual({
      x: 0.5,
      y: 0.75,
      width: 0.5,
      height: 0.25,
    });
  });

  it('shrinks an oversized rectangle uniformly so its ratio survives', () => {
    const clamped = clampCropRect({ x: 0.5, y: 0.5, width: 2, height: 1 });

    expect(clamped).toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 });
    expect(clamped.width / clamped.height).toBeCloseTo(2, 6);
    expect(isCropContained(clamped)).toBe(true);
  });

  it('is idempotent and contained for every sample', () => {
    const samples: readonly CropRect[] = [
      SAMPLE,
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0.999, y: 0.999, width: 0.5, height: 0.5 },
      { x: -2, y: 3, width: 4, height: 0.1 },
    ];

    for (const sample of samples) {
      const once = clampCropRect(sample);
      const twice = clampCropRect(once);

      expect(twice).toEqual(once);
      expect(isCropContained(once)).toBe(true);
    }
  });

  it('detects containment precisely', () => {
    expect(isCropContained(FULL_CROP)).toBe(true);
    expect(isCropContained({ x: 0.9, y: 0, width: 0.2, height: 1 })).toBe(false);
    expect(isCropContained({ x: 0, y: 0, width: 0, height: 1 })).toBe(false);
    expect(isCropContained({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBe(false);
  });

  it('does not mutate its input', () => {
    const input = frozenCrop({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 });
    expect(clampCropRect(input)).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    expect(input).toEqual({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 });
  });
});

describe('translation and keyboard nudges', () => {
  const CROP: CropRect = Object.freeze({ x: 0.2, y: 0.2, width: 0.4, height: 0.4 });

  it('translates within bounds and keeps the size', () => {
    expect(translateCropRect(CROP, 0.05, 0)).toEqual({ ...CROP, x: 0.25 });
    expect(translateCropRect(CROP, 0, 0.05)).toEqual({ ...CROP, y: 0.25 });
    expect(translateCropRect(CROP, 1, 1)).toEqual({ ...CROP, x: 0.6, y: 0.6 });
    expect(translateCropRect(CROP, -1, -1)).toEqual({ ...CROP, x: 0, y: 0 });
    expect(() => translateCropRect(CROP, Number.NaN, 0)).toThrow(RangeError);
  });

  it('nudges in the displayed frame for all four rotations', () => {
    const step = 0.05;

    expect(nudgeCropRect(CROP, 0, 'right', step)).toEqual({ ...CROP, x: 0.25 });
    expect(nudgeCropRect(CROP, 0, 'down', step)).toEqual({ ...CROP, y: 0.25 });

    // Rotating the photo clockwise puts the source's top edge on the right.
    expect(nudgeCropRect(CROP, 90, 'right', step)).toEqual({ ...CROP, y: 0.15 });
    expect(nudgeCropRect(CROP, 90, 'down', step)).toEqual({ ...CROP, x: 0.25 });

    expect(nudgeCropRect(CROP, 180, 'right', step)).toEqual({ ...CROP, x: 0.15 });
    expect(nudgeCropRect(CROP, 180, 'down', step)).toEqual({ ...CROP, y: 0.15 });

    expect(nudgeCropRect(CROP, 270, 'right', step)).toEqual({ ...CROP, y: 0.25 });
    expect(nudgeCropRect(CROP, 270, 'down', step)).toEqual({ ...CROP, x: 0.15 });
  });

  it('cannot move a full-frame selection and defaults to a two-percent step', () => {
    expect(nudgeCropRect(FULL_CROP, 0, 'right')).toEqual(FULL_CROP);
    expect(DEFAULT_NUDGE_STEP).toBe(0.02);
    expect(nudgeCropRect(CROP, 0, 'right')).toEqual({ ...CROP, x: 0.22 });
  });

  it('rejects a zero or non-finite nudge step', () => {
    expect(() => nudgeCropRect(CROP, 0, 'left', 0)).toThrow(RangeError);
    expect(() => nudgeCropRect(CROP, 0, 'left', Number.NaN)).toThrow(RangeError);
  });

  it('does not mutate the source crop', () => {
    const input = frozenCrop(CROP);
    nudgeCropRect(input, 90, 'left');
    translateCropRect(input, 0.1, 0.1);
    expect(input).toEqual(CROP);
  });
});

describe('rotation-aware crop conversion', () => {
  it('maps the source crop into each rotated frame', () => {
    expect(cropToRotated(SAMPLE, 0)).toEqual(SAMPLE);
    expect(cropToRotated(SAMPLE, 90)).toEqual({
      x: 0.5,
      y: 0.2,
      width: 0.25,
      height: 0.5,
    });
    expect(cropToRotated(SAMPLE, 180)).toEqual({
      x: 0.3,
      y: 0.5,
      width: 0.5,
      height: 0.25,
    });
    expect(cropToRotated(SAMPLE, 270)).toEqual({
      x: 0.25,
      y: 0.3,
      width: 0.25,
      height: 0.5,
    });
  });

  it('maps back to the source frame for every rotation', () => {
    expect(cropFromRotated(cropToRotated(SAMPLE, 0), 0)).toEqual(SAMPLE);
    expect(cropFromRotated(cropToRotated(SAMPLE, 90), 90)).toEqual(SAMPLE);
    expect(cropFromRotated(cropToRotated(SAMPLE, 180), 180)).toEqual(SAMPLE);
    expect(cropFromRotated(cropToRotated(SAMPLE, 270), 270)).toEqual(SAMPLE);
  });

  it('round-trips within the stored precision', () => {
    const values = [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0.125, y: 0.333333, width: 0.666667, height: 0.25 },
      { x: 0.9, y: 0.9, width: 0.1, height: 0.1 },
      SAMPLE,
    ] satisfies readonly CropRect[];

    for (const value of values) {
      for (const rotation of [0, 90, 180, 270] satisfies readonly Rotation[]) {
        const roundTripped = cropFromRotated(cropToRotated(value, rotation), rotation);
        expect(cropRectsEqual(value, roundTripped, 2 / CROP_PRECISION)).toBe(true);
        expect(isCropContained(roundTripped)).toBe(true);
      }
    }
  });

  it('swaps the pixel aspect ratio for a quarter turn without squashing it', () => {
    const sourceWidth = 4000;
    const sourceHeight = 3000;
    const rotated = cropToRotated(SAMPLE, 90);

    const sourceAspect = (SAMPLE.width * sourceWidth) / (SAMPLE.height * sourceHeight);
    const rotatedAspect = (rotated.width * sourceHeight) / (rotated.height * sourceWidth);

    expect(rotatedAspect * sourceAspect).toBeCloseTo(1, 9);
  });

  it('does not mutate the mapping input', () => {
    const input = frozenCrop(SAMPLE);
    cropToRotated(input, 90);
    cropFromRotated(input, 270);
    expect(input).toEqual(SAMPLE);
  });
});

describe('output bounds', () => {
  it('returns source pixels and the rotated output size', () => {
    const upright = computeOutputBounds({ x: 0.1, y: 0.2, width: 0.4, height: 0.5 }, 4000, 3000, 0);

    expect(upright.sourcePixels).toEqual({ x: 400, y: 600, width: 1600, height: 1500 });
    expect(upright.outputPixels).toEqual({ width: 1600, height: 1500 });
    expect(upright.aspectRatio).toBeCloseTo(1600 / 1500, 9);

    const quarterTurn = computeOutputBounds(
      { x: 0.1, y: 0.2, width: 0.4, height: 0.5 },
      4000,
      3000,
      90,
    );

    expect(quarterTurn.sourcePixels).toEqual(upright.sourcePixels);
    expect(quarterTurn.outputPixels).toEqual({ width: 1500, height: 1600 });
    expect(quarterTurn.aspectRatio).toBeCloseTo(1500 / 1600, 9);
  });

  it('keeps a one-pixel floor at the far edge', () => {
    expect(
      computeOutputBounds({ x: 0.999, y: 0.999, width: 0.5, height: 0.5 }, 4000, 3000, 0),
    ).toMatchObject({
      sourcePixels: { x: 3996, y: 2997, width: 4, height: 3 },
    });
  });

  it('rejects invalid source dimensions', () => {
    expect(() => computeOutputBounds(FULL_CROP, 0, 100, 0)).toThrow(RangeError);
    expect(() => computeOutputBounds(FULL_CROP, 100, Number.NaN, 0)).toThrow(RangeError);
  });
});

describe('preview sizing', () => {
  it('reports rotation-aware dimensions for the full source', () => {
    expect(previewDimensions(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
    expect(previewDimensions(4000, 3000, 90)).toEqual({ width: 3000, height: 4000 });
    expect(previewDimensions(4000, 3000, 180)).toEqual({ width: 4000, height: 3000 });
    expect(previewDimensions(4000, 3000, 270)).toEqual({ width: 3000, height: 4000 });
  });

  it('contains the preview without upscaling', () => {
    expect(previewDimensions(4000, 3000, 90, { width: 1200, height: 800 })).toEqual({
      width: 600,
      height: 800,
    });
    expect(fitWithin({ width: 200, height: 100 }, { width: 1000, height: 1000 })).toEqual({
      width: 200,
      height: 100,
    });
    expect(fitWithin({ width: 1000, height: 500 }, { width: 500, height: 500 })).toEqual({
      width: 500,
      height: 250,
    });
  });

  it('rejects non-positive bounds', () => {
    expect(() => fitWithin({ width: 100, height: 100 }, { width: 0, height: 100 })).toThrow(
      RangeError,
    );
    expect(() => previewDimensions(0, 100, 0)).toThrow(RangeError);
  });
});

describe('reset and description', () => {
  it('resets to a frozen full-frame upright state', () => {
    const state = resetCropState();

    expect(state).toEqual({ crop: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0 });
    expect(state.crop).toBe(FULL_CROP);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('describes the full image and each rotation', () => {
    expect(describeCrop(FULL_CROP, 0)).toBe(
      'Crop 100% wide, 100% tall, starting 0% from the left and 0% from the top. Rotation: upright.',
    );
    expect(describeCrop(SAMPLE, 90)).toBe(
      'Crop 50% wide, 25% tall, starting 20% from the left and 25% from the top. Rotation: 90° clockwise.',
    );
    expect(describeCrop(SAMPLE, 180)).toContain('Rotation: 180°.');
    expect(describeCrop(SAMPLE, 270)).toContain('Rotation: 270° clockwise.');
  });

  it('never announces more than a hundred percent', () => {
    const text = describeCrop({ x: 0.999, y: 0.999, width: 0.001, height: 0.001 }, 0);

    expect(text).toContain('Crop 1% wide, 1% tall');
    expect(text).toContain('starting 99% from the left and 99% from the top');
  });

  it('compares crops with a precision tolerance', () => {
    expect(cropRectsEqual(SAMPLE, { ...SAMPLE })).toBe(true);
    expect(cropRectsEqual(SAMPLE, { ...SAMPLE, x: SAMPLE.x + 0.0000001 })).toBe(true);
    expect(cropRectsEqual(SAMPLE, { ...SAMPLE, x: SAMPLE.x + 0.01 })).toBe(false);
  });
});
