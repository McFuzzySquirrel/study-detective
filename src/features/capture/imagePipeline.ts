/**
 * The device-local image pipeline.
 *
 * One oriented decode feeds three bounded derivatives: a retained original
 * (uncropped, so a later re-crop can regenerate from it), a display copy, and a
 * thumbnail. The student's normalized crop and 90-degree rotation are applied
 * only to the display and thumbnail. Nothing is uploaded, and no path upscales.
 */

import type { AttachmentKind, AttachmentMime } from '../../domain/model';

import {
  decodeImageBlob,
  inspectImageFile,
  isAbortError,
  throwIfAborted,
  type DecodedImage,
  type ImageDecodeOptionsWithoutSignal,
  type ImageDecoder,
  type ImageDecoderOptions,
  type ImageValidationFailure,
  type SupportedImageMime,
  SUPPORTED_IMAGE_MIME_TYPES,
} from './imageValidation';

export const ORIGINAL_MAX_EDGE = 4096;
export const DISPLAY_MAX_EDGE = 2048;
export const THUMBNAIL_MAX_EDGE = 320;
export const DERIVATIVE_QUALITY = 0.9;

export type Rotation = 0 | 90 | 180 | 270;

export type CropRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export const FULL_CROP: Readonly<CropRect> = Object.freeze({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

export type ImagePipelineStage = 'decoding' | 'transforming' | 'encoding';

export type ImageDerivative = {
  readonly kind: AttachmentKind;
  readonly mime: AttachmentMime;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly blob: Blob;
};

export type ProcessedImage = {
  readonly mime: SupportedImageMime;
  /** Oriented source dimensions before any crop or student rotation. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly crop: CropRect;
  readonly rotation: Rotation;
  readonly retainFullResolution: boolean;
  /** The uncropped, oriented image retained for later re-cropping. */
  readonly original: ImageDerivative;
  readonly display: ImageDerivative;
  readonly thumbnail: ImageDerivative;
};

export type ImageProcessingErrorCode =
  | 'invalid-crop'
  | 'canvas-unavailable'
  | 'context-unavailable'
  | 'encode-failed'
  | 'digest-failed'
  | 'digest-unavailable';

export class ImageProcessingError extends Error {
  readonly code: ImageProcessingErrorCode;

  constructor(code: ImageProcessingErrorCode, message: string) {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = code;
  }
}

/** A file whose bytes failed intake validation before any processing began. */
export class InvalidImageInputError extends Error {
  readonly validation: ImageValidationFailure;

  constructor(validation: ImageValidationFailure) {
    super(validation.message);
    this.name = 'InvalidImageInputError';
    this.validation = validation;
  }
}

export interface Canvas2DContext {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
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
  ): void;
}

export interface EncodableCanvas {
  width: number;
  height: number;
  getContext(contextId: '2d'): Canvas2DContext | null;
  convertToBlob?(options?: { readonly type?: string; readonly quality?: number }): Promise<Blob>;
  toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export type CanvasFactory = (width: number, height: number) => EncodableCanvas;

export type BlobDigest = (blob: Blob) => Promise<string>;

export type ImagePipelineOptions = {
  /** Normalized 0-1 rectangle of the oriented source. Defaults to the full image. */
  readonly crop?: Partial<CropRect>;
  readonly rotation?: Rotation;
  /** Keep the decoded resolution for the retained original. Defaults to false. */
  readonly retainFullResolution?: boolean;
  /** Skip a second signature read when the caller already inspected the file. */
  readonly sourceMime?: SupportedImageMime;
  readonly signal?: AbortSignal;
  readonly decode?: ImageDecoder;
  readonly decodeOptions?: ImageDecodeOptionsWithoutSignal;
  readonly createCanvas?: CanvasFactory;
  readonly digest?: BlobDigest;
  readonly onProgress?: (stage: ImagePipelineStage) => void;
};

function defaultCreateCanvas(width: number, height: number): EncodableCanvas {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    // Some browsers expose OffscreenCanvas without an encoder; fall through to
    // the HTML canvas path instead of failing at save time.
    if (typeof canvas.convertToBlob === 'function') {
      return canvas as unknown as EncodableCanvas;
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as EncodableCanvas;
  }

  throw new ImageProcessingError(
    'canvas-unavailable',
    'This browser cannot prepare images for a card.',
  );
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Keep persisted crop values free of binary-float tails. */
function roundUnit(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Clamp a normalized crop inside the unit square. A zero-area crop is a caller
 * bug, not a silent full-image import.
 */
export function normalizeCropRect(input: Partial<CropRect> = {}): CropRect {
  const x = input.x ?? 0;
  const y = input.y ?? 0;
  const width = input.width ?? 1;
  const height = input.height ?? 1;

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    throw new ImageProcessingError('invalid-crop', 'Crop values must be finite numbers.');
  }

  if (width <= 0 || height <= 0) {
    throw new ImageProcessingError('invalid-crop', 'Crop width and height must be greater than 0.');
  }

  const clampedX = clampUnit(x);
  const clampedY = clampUnit(y);
  const clampedWidth = Math.min(clampUnit(width), 1 - clampedX);
  const clampedHeight = Math.min(clampUnit(height), 1 - clampedY);

  if (clampedWidth <= 0 || clampedHeight <= 0) {
    throw new ImageProcessingError('invalid-crop', 'The crop must overlap the image.');
  }

  return {
    x: roundUnit(clampedX),
    y: roundUnit(clampedY),
    width: roundUnit(clampedWidth),
    height: roundUnit(clampedHeight),
  };
}

/** Convert a normalized crop into integer source pixels with a one-pixel floor. */
export function computeCropPixels(
  sourceWidth: number,
  sourceHeight: number,
  crop: Partial<CropRect> = {},
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new ImageProcessingError('invalid-crop', 'Image dimensions must be positive.');
  }

  const normalized = normalizeCropRect(crop);
  const x = Math.min(sourceWidth - 1, Math.max(0, Math.round(normalized.x * sourceWidth)));
  const y = Math.min(sourceHeight - 1, Math.max(0, Math.round(normalized.y * sourceHeight)));
  const right = Math.min(
    sourceWidth,
    Math.max(x + 1, Math.round((normalized.x + normalized.width) * sourceWidth)),
  );
  const bottom = Math.min(
    sourceHeight,
    Math.max(y + 1, Math.round((normalized.y + normalized.height) * sourceHeight)),
  );

  return { x, y, width: right - x, height: bottom - y };
}

/** Floor to one pixel and cap the longest edge without ever enlarging. */
export function computeScaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { readonly width: number; readonly height: number } {
  if (width <= 0 || height <= 0 || maxEdge <= 0) {
    throw new ImageProcessingError('invalid-crop', 'Image dimensions and caps must be positive.');
  }

  const longestEdge = Math.max(width, height);
  const scale = Math.min(1, maxEdge / longestEdge);
  return {
    width: Math.max(1, Math.min(maxEdge, Math.round(width * scale))),
    height: Math.max(1, Math.min(maxEdge, Math.round(height * scale))),
  };
}

/** Exact integer quarter-turn normalization; no accumulated radians. */
export function normalizeRotation(value: number): Rotation {
  if (!Number.isFinite(value)) {
    throw new ImageProcessingError('invalid-crop', 'Rotation must be a finite number.');
  }
  const normalized = (((Math.round(value / 90) * 90) % 360) + 360) % 360;
  return normalized as Rotation;
}

export function rotatedDimensions(
  width: number,
  height: number,
  rotation: Rotation,
): { readonly width: number; readonly height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

function emit(options: ImagePipelineOptions, stage: ImagePipelineStage): void {
  try {
    options.onProgress?.(stage);
  } catch {
    // Progress is advisory; a UI callback must never corrupt an import.
  }
}

function makeCanvas(factory: CanvasFactory, width: number, height: number): EncodableCanvas {
  let canvas: EncodableCanvas;
  try {
    canvas = factory(width, height);
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    throw new ImageProcessingError('canvas-unavailable', 'This browser cannot prepare the image.');
  }

  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: EncodableCanvas): Canvas2DContext {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new ImageProcessingError('context-unavailable', 'This browser cannot draw the image.');
  }
  return context;
}

function configureSmoothing(context: Canvas2DContext): void {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
}

/** Draw the full oriented source into the retained-original canvas. */
function drawOriginal(
  context: Canvas2DContext,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): void {
  configureSmoothing(context);
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
}

/**
 * Draw the crop into a canvas after a quarter-turn. Rotation is applied first
 * in drawing space, so a 90/270 crop swaps the draw rectangle while the target
 * dimensions already describe the rotated result.
 */
function drawCroppedAndRotated(
  context: Canvas2DContext,
  source: CanvasImageSource,
  crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  rotation: Rotation,
  targetWidth: number,
  targetHeight: number,
): void {
  configureSmoothing(context);
  context.save();

  switch (rotation) {
    case 0:
      break;
    case 90:
      context.translate(targetWidth, 0);
      context.rotate(Math.PI / 2);
      break;
    case 180:
      context.translate(targetWidth, targetHeight);
      context.rotate(Math.PI);
      break;
    case 270:
      context.translate(0, targetHeight);
      context.rotate(-Math.PI / 2);
      break;
  }

  const drawWidth = rotation === 90 || rotation === 270 ? targetHeight : targetWidth;
  const drawHeight = rotation === 90 || rotation === 270 ? targetWidth : targetHeight;

  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, drawWidth, drawHeight);
  context.restore();
}

async function encodeOnce(
  canvas: EncodableCanvas,
  mime: SupportedImageMime,
  quality: number,
): Promise<Blob> {
  if (typeof canvas.convertToBlob === 'function') {
    try {
      return await canvas.convertToBlob({ type: mime, quality });
    } catch (cause) {
      if (isAbortError(cause)) {
        throw cause;
      }
      throw new ImageProcessingError('encode-failed', 'The image could not be prepared.');
    }
  }

  const toBlob = canvas.toBlob;
  if (typeof toBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      try {
        toBlob.call(
          canvas,
          (blob) => {
            if (blob === null) {
              reject(new ImageProcessingError('encode-failed', 'The image could not be prepared.'));
              return;
            }
            resolve(blob);
          },
          mime,
          quality,
        );
      } catch (cause) {
        reject(
          isAbortError(cause)
            ? cause
            : new ImageProcessingError('encode-failed', 'The image could not be prepared.'),
        );
      }
    });
  }

  throw new ImageProcessingError('encode-failed', 'This browser cannot encode images.');
}

async function encodeCanvas(
  canvas: EncodableCanvas,
  mime: SupportedImageMime,
  quality: number,
): Promise<Blob> {
  try {
    return await encodeOnce(canvas, mime, quality);
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    // Not every browser can encode WebP from a canvas. JPEG is an accepted
    // fallback; the stored MIME is always resolved from the real Blob.
    if (mime === 'image/webp') {
      return encodeOnce(canvas, 'image/jpeg', quality);
    }
    throw cause;
  }
}

function isSupportedMime(value: string): value is SupportedImageMime {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Trust the encoder's real output type. Some browsers silently encode PNG when
 * WebP is requested; recording the actual MIME keeps the stored metadata true.
 */
function resolveEncodedMime(blob: Blob, requested: SupportedImageMime): SupportedImageMime {
  const actual = blob.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (actual === '') {
    return requested;
  }
  if (isSupportedMime(actual)) {
    return actual;
  }
  throw new ImageProcessingError(
    'encode-failed',
    'The browser produced an image format the app cannot store.',
  );
}

/** Digest the exact stored bytes. The archive exporter reuses this value. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new ImageProcessingError(
      'digest-unavailable',
      'This browser cannot verify image integrity.',
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await blob.arrayBuffer();
  } catch {
    throw new ImageProcessingError('digest-failed', 'The image could not be verified.');
  }

  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest('SHA-256', buffer);
  } catch {
    throw new ImageProcessingError('digest-failed', 'The image could not be verified.');
  }

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function releaseCanvas(canvas: EncodableCanvas | undefined): void {
  if (canvas === undefined) {
    return;
  }
  try {
    // Resizing drops the backing store in every browser; references are also
    // dropped by the caller. This is the best available "free the canvas" step.
    canvas.width = 1;
    canvas.height = 1;
  } catch {
    // A detached OffscreenCanvas may already be released.
  }
}

async function encodeDerivative(
  canvas: EncodableCanvas,
  kind: AttachmentKind,
  sourceMime: SupportedImageMime,
  options: ImagePipelineOptions,
): Promise<ImageDerivative> {
  throwIfAborted(options.signal);
  emit(options, 'encoding');
  throwIfAborted(options.signal);

  const blob = await encodeCanvas(canvas, sourceMime, DERIVATIVE_QUALITY);
  throwIfAborted(options.signal);

  const digest = options.digest ?? sha256Hex;
  const sha256 = await digest(blob);
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new ImageProcessingError('digest-failed', 'The image digest was invalid.');
  }
  throwIfAborted(options.signal);

  return {
    kind,
    mime: resolveEncodedMime(blob, sourceMime),
    width: canvas.width,
    height: canvas.height,
    bytes: blob.size,
    sha256,
    blob,
  };
}

async function renderDerivatives(
  decoded: DecodedImage,
  sourceMime: SupportedImageMime,
  options: ImagePipelineOptions,
): Promise<ProcessedImage> {
  const crop = normalizeCropRect(options.crop);
  const rotation = normalizeRotation(options.rotation ?? 0);
  const retainFullResolution = options.retainFullResolution === true;
  const cropPixels = computeCropPixels(decoded.width, decoded.height, crop);
  const rotated = rotatedDimensions(cropPixels.width, cropPixels.height, rotation);

  throwIfAborted(options.signal);
  emit(options, 'transforming');

  const factory = options.createCanvas ?? defaultCreateCanvas;
  const originalTarget = retainFullResolution
    ? { width: decoded.width, height: decoded.height }
    : computeScaledDimensions(decoded.width, decoded.height, ORIGINAL_MAX_EDGE);
  const displayTarget = computeScaledDimensions(rotated.width, rotated.height, DISPLAY_MAX_EDGE);
  const thumbnailTarget = computeScaledDimensions(
    rotated.width,
    rotated.height,
    THUMBNAIL_MAX_EDGE,
  );

  // Render and encode one derivative at a time so only one full-size canvas is
  // resident beside the decoded bitmap. This matters on a 30 MB import.
  let canvas: EncodableCanvas | undefined;
  try {
    canvas = makeCanvas(factory, originalTarget.width, originalTarget.height);
    throwIfAborted(options.signal);
    drawOriginal(
      context2d(canvas),
      decoded.source,
      decoded.width,
      decoded.height,
      originalTarget.width,
      originalTarget.height,
    );
    const original = await encodeDerivative(canvas, 'original', sourceMime, options);
    releaseCanvas(canvas);
    canvas = undefined;

    canvas = makeCanvas(factory, displayTarget.width, displayTarget.height);
    throwIfAborted(options.signal);
    drawCroppedAndRotated(
      context2d(canvas),
      decoded.source,
      cropPixels,
      rotation,
      displayTarget.width,
      displayTarget.height,
    );
    const display = await encodeDerivative(canvas, 'display', sourceMime, options);
    releaseCanvas(canvas);
    canvas = undefined;

    canvas = makeCanvas(factory, thumbnailTarget.width, thumbnailTarget.height);
    throwIfAborted(options.signal);
    drawCroppedAndRotated(
      context2d(canvas),
      decoded.source,
      cropPixels,
      rotation,
      thumbnailTarget.width,
      thumbnailTarget.height,
    );
    const thumbnail = await encodeDerivative(canvas, 'thumbnail', sourceMime, options);
    releaseCanvas(canvas);
    canvas = undefined;

    return {
      mime: sourceMime,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      crop,
      rotation,
      retainFullResolution,
      original,
      display,
      thumbnail,
    };
  } finally {
    releaseCanvas(canvas);
  }
}

function buildDecoderOptions(
  signal: AbortSignal | undefined,
  extra: ImageDecodeOptionsWithoutSignal | undefined,
): ImageDecoderOptions {
  return {
    ...extra,
    ...(signal !== undefined ? { signal } : {}),
  };
}

/**
 * Decode, transform, encode, digest, and clean up. The decoded bitmap is always
 * closed before this function settles, including cancel and encode failures.
 */
export async function processImage(
  file: Blob,
  options: ImagePipelineOptions = {},
): Promise<ProcessedImage> {
  throwIfAborted(options.signal);

  // Always re-check the inexpensive header even when the caller supplied a
  // MIME: a pipeline must never decode bytes that failed intake validation.
  const inspection = await inspectImageFile(
    file,
    options.signal !== undefined ? { signal: options.signal } : {},
  );
  if (!inspection.ok) {
    throw new InvalidImageInputError(inspection);
  }
  if (options.sourceMime !== undefined && options.sourceMime !== inspection.mime) {
    throw new InvalidImageInputError({
      ok: false,
      code: 'mime-mismatch',
      message:
        'That file says it is one image type but contains another. Choose a JPEG, PNG, or WebP photo.',
      detectedMime: inspection.mime,
    });
  }
  const sourceMime = inspection.mime;

  throwIfAborted(options.signal);
  emit(options, 'decoding');

  const decoder = options.decode ?? decodeImageBlob;
  let decoded: DecodedImage | undefined;
  try {
    decoded = await decoder(file, buildDecoderOptions(options.signal, options.decodeOptions));
    throwIfAborted(options.signal);
    return await renderDerivatives(decoded, sourceMime, options);
  } finally {
    decoded?.close();
  }
}
