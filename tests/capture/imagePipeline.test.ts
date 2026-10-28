// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import type { DecodedImage, ImageDecoder } from '../../src/features/capture/imageValidation';
import {
  DERIVATIVE_QUALITY,
  computeCropPixels,
  computeScaledDimensions,
  DISPLAY_MAX_EDGE,
  ImageProcessingError,
  InvalidImageInputError,
  normalizeCropRect,
  normalizeRotation,
  ORIGINAL_MAX_EDGE,
  processImage,
  rotatedDimensions,
  THUMBNAIL_MAX_EDGE,
  type Canvas2DContext,
  type CanvasFactory,
  type EncodableCanvas,
} from '../../src/features/capture/imagePipeline';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff, 0xe0];
const GIF_SIGNATURE = [...new TextEncoder().encode('GIF89a')];

type DrawCall = readonly [
  image: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
];

type TransformCall =
  | { readonly op: 'translate'; readonly x: number; readonly y: number }
  | { readonly op: 'rotate'; readonly radians: number };

class FakeContext implements Canvas2DContext {
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = 'low';
  readonly draws: DrawCall[] = [];
  readonly transforms: TransformCall[] = [];
  saveCount = 0;
  restoreCount = 0;

  save(): void {
    this.saveCount += 1;
  }

  restore(): void {
    this.restoreCount += 1;
  }

  translate(x: number, y: number): void {
    this.transforms.push({ op: 'translate', x, y });
  }

  rotate(radians: number): void {
    this.transforms.push({ op: 'rotate', radians });
  }

  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.draws.push([image, sx, sy, sw, sh, dx, dy, dw, dh]);
  }
}

class FakeCanvas implements EncodableCanvas {
  width: number;
  height: number;
  readonly context = new FakeContext();
  readonly encodings: { readonly type: string; readonly quality: number | undefined }[] = [];
  readonly releases: number[] = [];

  constructor(
    width: number,
    height: number,
    private readonly forcedMime?: string,
    private readonly onEncode?: () => void,
  ) {
    this.width = width;
    this.height = height;
  }

  getContext(): Canvas2DContext {
    return this.context;
  }

  async convertToBlob(options?: {
    readonly type?: string;
    readonly quality?: number;
  }): Promise<Blob> {
    this.encodings.push({ type: options?.type ?? '', quality: options?.quality });
    this.onEncode?.();
    const type = this.forcedMime ?? options?.type ?? 'image/png';
    return new Blob([`${type}:${this.width}x${this.height}`], { type });
  }
}

/** Mimics HTMLCanvasElement, which exposes toBlob but not convertToBlob. */
class LegacyCanvas implements EncodableCanvas {
  width: number;
  height: number;
  readonly context = new FakeContext();
  readonly encodings: { readonly type: string; readonly quality: number | undefined }[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(): Canvas2DContext {
    return this.context;
  }

  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void {
    this.encodings.push({ type: type ?? '', quality });
    const mime = type ?? 'image/png';
    callback(new Blob([`${mime}:${this.width}x${this.height}`], { type: mime }));
  }
}

/** A canvas that rejects WebP so the pipeline's JPEG fallback is exercised. */
class WebpRejectingCanvas extends FakeCanvas {
  override async convertToBlob(options?: {
    readonly type?: string;
    readonly quality?: number;
  }): Promise<Blob> {
    if (options?.type === 'image/webp') {
      this.encodings.push({ type: 'image/webp', quality: options.quality });
      throw new Error('WebP encoding is unavailable');
    }
    return super.convertToBlob(options);
  }
}

type CanvasHarness = {
  readonly factory: CanvasFactory;
  readonly canvases: FakeCanvas[];
};

function canvasHarness(onEncode?: () => void, forcedMime?: string): CanvasHarness {
  const canvases: FakeCanvas[] = [];
  const factory: CanvasFactory = (width, height) => {
    const canvas = new FakeCanvas(width, height, forcedMime, onEncode);
    canvases.push(canvas);
    return canvas;
  };
  return { factory, canvases };
}

function fakeDecoded(width: number, height: number): DecodedImage {
  return {
    width,
    height,
    source: { width, height } as unknown as CanvasImageSource,
    close: vi.fn<() => void>(),
  };
}

function decoderFor(decoded: DecodedImage): ImageDecoder {
  return vi.fn<ImageDecoder>(async () => decoded);
}

function imageFile(mime = 'image/jpeg', bytes = JPEG_SIGNATURE): File {
  return new File([new Uint8Array(bytes)], 'notes.jpg', { type: mime });
}

function webpFile(): File {
  const bytes = new Uint8Array(new ArrayBuffer(64));
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  return new File([bytes], 'notes.webp', { type: 'image/webp' });
}

function gifFile(): File {
  return new File([new Uint8Array(GIF_SIGNATURE)], 'animation.gif', { type: 'image/gif' });
}

function validDigest(): (blob: Blob) => Promise<string> {
  let counter = 0;
  return async () => {
    counter += 1;
    return counter.toString(16).padStart(64, '0');
  };
}

function expectProportional(
  derivations: { width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
): void {
  const expected = sourceWidth / sourceHeight;
  expect(derivations.width / derivations.height).toBeCloseTo(expected, 1);
}

describe('pure dimension and crop helpers', () => {
  it('caps the longest edge without upscaling', () => {
    expect(computeScaledDimensions(6000, 4000, ORIGINAL_MAX_EDGE)).toEqual({
      width: 4096,
      height: 2731,
    });
    expect(computeScaledDimensions(800, 600, ORIGINAL_MAX_EDGE)).toEqual({
      width: 800,
      height: 600,
    });
    expect(computeScaledDimensions(200, 100, THUMBNAIL_MAX_EDGE)).toEqual({
      width: 200,
      height: 100,
    });
    expect(computeScaledDimensions(5000, 5000, DISPLAY_MAX_EDGE)).toEqual({
      width: 2048,
      height: 2048,
    });
  });

  it('clamps normalized crops inside the image and rejects zero-area crops', () => {
    expect(normalizeCropRect({ x: -0.5, y: 0.8, width: 2, height: 2 })).toEqual({
      x: 0,
      y: 0.8,
      width: 1,
      height: 0.2,
    });
    expect(() => normalizeCropRect({ x: 0, y: 0, width: 0, height: 1 })).toThrow(
      ImageProcessingError,
    );
    expect(() => normalizeCropRect({ x: Number.NaN, y: 0, width: 1, height: 1 })).toThrow(
      ImageProcessingError,
    );
  });

  it('converts a normalized crop to integer source pixels with a one-pixel floor', () => {
    expect(computeCropPixels(4000, 3000, { x: 0.1, y: 0.2, width: 0.4, height: 0.5 })).toEqual({
      x: 400,
      y: 600,
      width: 1600,
      height: 1500,
    });
    expect(computeCropPixels(4000, 3000, { x: 0.999, y: 0.999, width: 0.5, height: 0.5 })).toEqual({
      x: 3996,
      y: 2997,
      width: 4,
      height: 3,
    });
  });

  it('normalizes rotations to exact integer quarters', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(89)).toBe(90);
  });

  it('swaps dimensions only for 90 and 270', () => {
    expect(rotatedDimensions(1000, 500, 0)).toEqual({ width: 1000, height: 500 });
    expect(rotatedDimensions(1000, 500, 90)).toEqual({ width: 500, height: 1000 });
    expect(rotatedDimensions(1000, 500, 180)).toEqual({ width: 1000, height: 500 });
    expect(rotatedDimensions(1000, 500, 270)).toEqual({ width: 500, height: 1000 });
  });
});

describe('default derivatives', () => {
  it('caps a 6000x4000 source at 4096/2048/320 and encodes at quality 0.9', async () => {
    const decoded = fakeDecoded(6000, 4000);
    const decode = decoderFor(decoded);
    const harness = canvasHarness();

    const result = await processImage(imageFile(), {
      sourceMime: 'image/jpeg',
      decode,
      createCanvas: harness.factory,
      digest: validDigest(),
    });

    expect(result.original).toMatchObject({ width: 4096, height: 2731, mime: 'image/jpeg' });
    expect(result.display).toMatchObject({ width: 2048, height: 1365 });
    expect(result.thumbnail).toMatchObject({ width: 320, height: 213 });
    expect(result.sourceWidth).toBe(6000);
    expect(result.sourceHeight).toBe(4000);
    expect(result.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(result.rotation).toBe(0);
    expect(result.retainFullResolution).toBe(false);

    for (const canvas of harness.canvases) {
      expect(canvas.encodings).toHaveLength(1);
      expect(canvas.encodings[0]).toEqual({ type: 'image/jpeg', quality: DERIVATIVE_QUALITY });
    }

    expect(decode).toHaveBeenCalledTimes(1);
    expect(decoded.close).toHaveBeenCalledTimes(1);
    expect(result.original.bytes).toBe(result.original.blob.size);
    expect(result.original.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.display.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.thumbnail.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('encodes canvas toBlob outputs at quality 0.9 for HTMLCanvasElement', async () => {
    const canvases: LegacyCanvas[] = [];
    const createCanvas: CanvasFactory = (width, height) => {
      const canvas = new LegacyCanvas(width, height);
      canvases.push(canvas);
      return canvas;
    };

    const result = await processImage(imageFile(), {
      sourceMime: 'image/jpeg',
      decode: decoderFor(fakeDecoded(1200, 800)),
      createCanvas,
      digest: validDigest(),
    });

    expect(result.original).toMatchObject({ width: 1200, height: 800 });
    expect(result.display).toMatchObject({ width: 1200, height: 800 });
    expect(result.thumbnail).toMatchObject({ width: 320, height: 213 });
    for (const canvas of canvases) {
      expect(canvas.encodings).toHaveLength(1);
      expect(canvas.encodings[0]).toEqual({ type: 'image/jpeg', quality: DERIVATIVE_QUALITY });
    }
  });

  it('never upscales a small source: all three outputs stay 200x100', async () => {
    const result = await processImage(imageFile('image/png', PNG_SIGNATURE), {
      sourceMime: 'image/png',
      decode: decoderFor(fakeDecoded(200, 100)),
      createCanvas: canvasHarness().factory,
      digest: validDigest(),
    });

    expect(result.original).toMatchObject({ width: 200, height: 100, mime: 'image/png' });
    expect(result.display).toMatchObject({ width: 200, height: 100 });
    expect(result.thumbnail).toMatchObject({ width: 200, height: 100 });
    expect(result.original.width).toBeLessThanOrEqual(ORIGINAL_MAX_EDGE);
    expect(result.display.width).toBeLessThanOrEqual(DISPLAY_MAX_EDGE);
    expect(result.thumbnail.width).toBeLessThanOrEqual(THUMBNAIL_MAX_EDGE);
  });

  it('retains the decoded size when full resolution is opted in', async () => {
    const result = await processImage(imageFile(), {
      sourceMime: 'image/jpeg',
      retainFullResolution: true,
      decode: decoderFor(fakeDecoded(6000, 4000)),
      createCanvas: canvasHarness().factory,
      digest: validDigest(),
    });

    expect(result.original).toMatchObject({ width: 6000, height: 4000 });
    expect(result.display).toMatchObject({ width: 2048, height: 1365 });
    expect(result.thumbnail).toMatchObject({ width: 320, height: 213 });
    expect(result.retainFullResolution).toBe(true);
  });

  it('uses oriented portrait dimensions from the decoder', async () => {
    const result = await processImage(imageFile(), {
      sourceMime: 'image/jpeg',
      decode: decoderFor(fakeDecoded(3000, 4000)),
      createCanvas: canvasHarness().factory,
      digest: validDigest(),
    });

    expect(result.original).toMatchObject({ width: 3000, height: 4000 });
    expect(result.display).toMatchObject({ width: 1536, height: 2048 });
    expect(result.thumbnail).toMatchObject({ width: 240, height: 320 });
    expectProportional(result.original, 3000, 4000);
  });
});

describe('animated GIF imports', () => {
  it('keeps animated source bytes for original and display while bounding the thumbnail', async () => {
    const file = gifFile();
    const result = await processImage(file, {
      decode: decoderFor(fakeDecoded(6000, 4000)),
      createCanvas: canvasHarness().factory,
      digest: validDigest(),
    });

    expect(result).toMatchObject({
      mime: 'image/gif',
      sourceWidth: 6000,
      sourceHeight: 4000,
      retainFullResolution: true,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      rotation: 0,
      original: { mime: 'image/gif', width: 6000, height: 4000 },
      display: { mime: 'image/gif', width: 6000, height: 4000 },
      thumbnail: { mime: 'image/png', width: 320, height: 213 },
    });
    expect(result.original.blob).toBe(result.display.blob);
    expect([...new Uint8Array(await result.display.blob.arrayBuffer())]).toEqual(GIF_SIGNATURE);
  });

  it('rejects crop and rotation because re-encoding would discard animation', async () => {
    await expect(
      processImage(gifFile(), {
        crop: { x: 0, y: 0, width: 0.5, height: 1 },
        decode: decoderFor(fakeDecoded(1000, 500)),
        createCanvas: canvasHarness().factory,
        digest: validDigest(),
      }),
    ).rejects.toMatchObject({ code: 'invalid-crop' });
  });
});

describe('crop and rotation on derivatives', () => {
  it('applies the crop and a 90-degree turn to display and thumbnail only', async () => {
    const decoded = fakeDecoded(4000, 3000);
    const harness = canvasHarness();

    const result = await processImage(imageFile(), {
      sourceMime: 'image/jpeg',
      crop: { x: 0, y: 0, width: 0.5, height: 0.25 },
      rotation: 90,
      decode: decoderFor(decoded),
      createCanvas: harness.factory,
      digest: validDigest(),
    });

    // The retained original is the uncropped source so a later re-crop can
    // regenerate the display and thumbnail without the import file.
    expect(result.original).toMatchObject({ width: 4000, height: 3000 });
    expect(result.crop).toEqual({ x: 0, y: 0, width: 0.5, height: 0.25 });
    expect(result.rotation).toBe(90);
    expect(result.display).toMatchObject({ width: 750, height: 2000 });
    expect(result.thumbnail).toMatchObject({ width: 120, height: 320 });

    const [originalCanvas, displayCanvas, thumbnailCanvas] = harness.canvases;
    expect(originalCanvas?.context.draws[0]).toEqual([
      decoded.source,
      0,
      0,
      4000,
      3000,
      0,
      0,
      4000,
      3000,
    ]);
    expect(displayCanvas?.context.draws[0]).toEqual([
      decoded.source,
      0,
      0,
      2000,
      750,
      0,
      0,
      2000,
      750,
    ]);
    expect(displayCanvas?.context.transforms).toEqual([
      { op: 'translate', x: 750, y: 0 },
      { op: 'rotate', radians: Math.PI / 2 },
    ]);
    expect(thumbnailCanvas?.context.draws[0]).toEqual([
      decoded.source,
      0,
      0,
      2000,
      750,
      0,
      0,
      320,
      120,
    ]);
    expect(thumbnailCanvas?.context.saveCount).toBe(1);
    expect(thumbnailCanvas?.context.restoreCount).toBe(1);
  });

  it.each([
    [0, 1000, 500, 320, 160],
    [90, 500, 1000, 160, 320],
    [180, 1000, 500, 320, 160],
    [270, 500, 1000, 160, 320],
  ] as const)(
    'handles rotation %i without changing the uncropped original',
    async (rotation, displayWidth, displayHeight, thumbnailWidth, thumbnailHeight) => {
      const result = await processImage(imageFile(), {
        sourceMime: 'image/jpeg',
        rotation,
        decode: decoderFor(fakeDecoded(1000, 500)),
        createCanvas: canvasHarness().factory,
        digest: validDigest(),
      });

      expect(result.original).toMatchObject({ width: 1000, height: 500 });
      expect(result.display).toMatchObject({ width: displayWidth, height: displayHeight });
      expect(result.thumbnail).toMatchObject({ width: thumbnailWidth, height: thumbnailHeight });
    },
  );

  it('clamps a crop that runs past the right and bottom edges', async () => {
    const result = await processImage(imageFile(), {
      sourceMime: 'image/jpeg',
      crop: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 },
      decode: decoderFor(fakeDecoded(1000, 1000)),
      createCanvas: canvasHarness().factory,
      digest: validDigest(),
    });

    expect(result.crop).toEqual({ x: 0.9, y: 0.9, width: 0.1, height: 0.1 });
    expect(result.display).toMatchObject({ width: 100, height: 100 });
    expect(result.thumbnail).toMatchObject({ width: 100, height: 100 });
  });
});

describe('failure, cancellation, and cleanup', () => {
  it('throws before decoding when the abort signal is already set', async () => {
    const controller = new AbortController();
    controller.abort();
    const decode = vi.fn();

    await expect(
      processImage(imageFile(), {
        sourceMime: 'image/jpeg',
        signal: controller.signal,
        decode: decode as unknown as ImageDecoder,
        createCanvas: canvasHarness().factory,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(decode).not.toHaveBeenCalled();
  });

  it('closes the bitmap and releases canvases when encoding is cancelled', async () => {
    const controller = new AbortController();
    const decoded = fakeDecoded(3000, 2000);
    const harness = canvasHarness(() => controller.abort());

    await expect(
      processImage(imageFile(), {
        sourceMime: 'image/jpeg',
        signal: controller.signal,
        decode: decoderFor(decoded),
        createCanvas: harness.factory,
        digest: validDigest(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(decoded.close).toHaveBeenCalledTimes(1);
    for (const canvas of harness.canvases) {
      expect(canvas.width).toBe(1);
      expect(canvas.height).toBe(1);
    }
  });

  it('rejects invalid bytes before decoding when no sourceMime is supplied', async () => {
    const decode = vi.fn();

    await expect(
      processImage(new File([new Uint8Array([1, 2, 3])], 'broken.png', { type: 'image/png' }), {
        decode: decode as unknown as ImageDecoder,
        createCanvas: canvasHarness().factory,
      }),
    ).rejects.toBeInstanceOf(InvalidImageInputError);
    expect(decode).not.toHaveBeenCalled();
  });

  it('falls back to JPEG when the browser cannot encode WebP', async () => {
    const canvases: WebpRejectingCanvas[] = [];
    const createCanvas: CanvasFactory = (width, height) => {
      const canvas = new WebpRejectingCanvas(width, height);
      canvases.push(canvas);
      return canvas;
    };

    const result = await processImage(webpFile(), {
      sourceMime: 'image/webp',
      decode: decoderFor(fakeDecoded(1000, 500)),
      createCanvas,
      digest: validDigest(),
    });

    expect(result.mime).toBe('image/webp');
    expect(result.original.mime).toBe('image/jpeg');
    expect(result.display.mime).toBe('image/jpeg');
    expect(result.thumbnail.mime).toBe('image/jpeg');
    expect(canvases[0]?.encodings.map((encoding) => encoding.type)).toEqual([
      'image/webp',
      'image/jpeg',
    ]);
  });

  it('records the encoder MIME when a browser silently falls back from WebP', async () => {
    const result = await processImage(webpFile(), {
      sourceMime: 'image/webp',
      decode: decoderFor(fakeDecoded(1000, 500)),
      createCanvas: canvasHarness(undefined, 'image/png').factory,
      digest: validDigest(),
    });

    expect(result.mime).toBe('image/webp');
    expect(result.original.mime).toBe('image/png');
    expect(result.display.mime).toBe('image/png');
    expect(result.thumbnail.mime).toBe('image/png');
  });
});
