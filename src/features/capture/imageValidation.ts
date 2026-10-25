/**
 * Image intake validation for the capture path.
 *
 * A selected file crosses four gates before anything is decoded into a card:
 * the 30 MB ceiling, the accepted JPEG/PNG/WebP magic bytes, compatibility
 * between the bytes and the browser-reported MIME type, and a real decode.
 * Every failure is a typed result so the capture UI can name what went wrong
 * while no Blob, object URL, or IndexedDB row exists yet.
 */

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

/** Enough of the file to cover every signature, EXIF wrapper, and SVG prefix. */
const HEADER_BYTES = 64;

export type ImageValidationCode =
  | 'empty-file'
  | 'oversized'
  | 'unsupported-type'
  | 'unsupported-format'
  | 'mime-mismatch'
  | 'corrupt-image'
  | 'unreadable-file';

export type UnsupportedImageFormat = 'svg' | 'heic' | 'gif' | 'pdf';

export type ImageValidationFailure = {
  readonly ok: false;
  readonly code: ImageValidationCode;
  /** Safe to show to a student: no filename, bytes, or image content. */
  readonly message: string;
  readonly detectedMime?: SupportedImageMime;
  readonly format?: UnsupportedImageFormat;
};

export type ImageInspectionSuccess = {
  readonly ok: true;
  readonly mime: SupportedImageMime;
  readonly byteLength: number;
};

export type ImageInspectionResult = ImageInspectionSuccess | ImageValidationFailure;

/**
 * A decoded image plus an explicit release hook. Orientation has already been
 * applied by the decoder (`imageOrientation: 'from-image'`), so callers must
 * never apply EXIF again.
 */
export type DecodedImage = {
  readonly width: number;
  readonly height: number;
  readonly source: CanvasImageSource;
  close(): void;
};

export type ImageBitmapFactory = (
  blob: Blob,
  options: { readonly imageOrientation: 'from-image' },
) => Promise<ImageBitmap>;

export type ImageDecoderOptions = {
  readonly signal?: AbortSignal;
  /**
   * `undefined` uses the platform factory when available, `null` forces the
   * `<img>` fallback. Tests use `null` to exercise object URL cleanup.
   */
  readonly createImageBitmap?: ImageBitmapFactory | null;
  readonly createImage?: () => HTMLImageElement;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
};

export type ImageDecoder = (blob: Blob, options?: ImageDecoderOptions) => Promise<DecodedImage>;

export type ImageDecodeOptionsWithoutSignal = Omit<ImageDecoderOptions, 'signal'>;

export type InspectImageOptions = {
  readonly signal?: AbortSignal;
};

export type ValidateImageOptions = {
  readonly signal?: AbortSignal;
  readonly decoder?: ImageDecoder;
  /**
   * Hand the decoded bitmap to the caller instead of closing it after the
   * probe. The caller then owns `source` and must call `source.close()`.
   */
  readonly keepDecodedImage?: boolean;
  readonly decodeOptions?: ImageDecodeOptionsWithoutSignal;
};

export type ImageValidationSuccess = {
  readonly ok: true;
  readonly mime: SupportedImageMime;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  /** Present only when `keepDecodedImage` is true. The caller owns it. */
  readonly source?: DecodedImage;
};

export type ImageValidationResult = ImageValidationSuccess | ImageValidationFailure;

export type ImageDecodeErrorCode = 'decode-failed';

/** Raised by the default decoder when the bytes cannot become an image. */
export class ImageDecodeError extends Error {
  readonly code: ImageDecodeErrorCode;

  constructor(code: ImageDecodeErrorCode, message: string) {
    super(message);
    this.name = 'ImageDecodeError';
    this.code = code;
  }
}

export function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name?: unknown }).name === 'AbortError'
  );
}

/** Throw the caller's abort reason, or a standard AbortError, when cancelled. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) {
    return;
  }

  const reason: unknown = signal.reason;
  if (isAbortError(reason)) {
    throw reason;
  }
  throw createAbortError();
}

function failure(
  code: ImageValidationCode,
  message: string,
  extra: {
    readonly detectedMime?: SupportedImageMime;
    readonly format?: UnsupportedImageFormat;
  } = {},
): ImageValidationFailure {
  return {
    ok: false,
    code,
    message,
    ...(extra.detectedMime !== undefined ? { detectedMime: extra.detectedMime } : {}),
    ...(extra.format !== undefined ? { format: extra.format } : {}),
  };
}

const FORMAT_LABEL: Record<UnsupportedImageFormat, string> = {
  svg: 'SVG',
  heic: 'HEIC/HEIF',
  gif: 'GIF',
  pdf: 'PDF',
};

function unsupportedFormatFailure(format: UnsupportedImageFormat): ImageValidationFailure {
  const label = FORMAT_LABEL[format];
  return failure(
    'unsupported-format',
    `${label} images are not supported. Choose a JPEG, PNG, or WebP photo.`,
    { format },
  );
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let value = '';
  for (let index = start; index < start + length && index < bytes.length; index += 1) {
    value += String.fromCharCode(bytes[index] ?? 0);
  }
  return value;
}

/** Detect the accepted formats from their real bytes, never from the extension. */
export function sniffImageMime(header: Uint8Array): SupportedImageMime | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (header.length >= 12 && ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 4) === 'WEBP') {
    return 'image/webp';
  }

  return null;
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/**
 * Name a well-known unsupported container so the student gets an actionable
 * message instead of a generic "corrupt image".
 */
export function detectUnsupportedImageFormat(header: Uint8Array): UnsupportedImageFormat | null {
  if (header.length >= 12 && ascii(header, 4, 4) === 'ftyp') {
    const brand = ascii(header, 8, 4).toLowerCase();
    if (HEIC_BRANDS.has(brand)) {
      return 'heic';
    }
  }

  if (ascii(header, 0, 4) === 'GIF8') {
    return 'gif';
  }

  if (ascii(header, 0, 5) === '%PDF-') {
    return 'pdf';
  }

  if (header.length > 0) {
    const prefix = new TextDecoder().decode(header).trimStart().toLowerCase();
    if (prefix.startsWith('<svg') || prefix.includes('<svg')) {
      return 'svg';
    }
  }

  return null;
}

function normalizeReportedMime(fileType: string): string {
  return fileType.split(';')[0]?.trim().toLowerCase() ?? '';
}

function isSupportedMime(value: string): value is SupportedImageMime {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

async function readHeader(file: Blob): Promise<Uint8Array | null> {
  try {
    const buffer = await file.slice(0, HEADER_BYTES).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Run the synchronous boundary checks without decoding: size, magic bytes,
 * unsupported containers, and MIME compatibility. The capture UI can call this
 * for an instant error; the import path follows with `validateImageFile` or the
 * pipeline's own decode.
 */
export async function inspectImageFile(
  file: Blob,
  options: InspectImageOptions = {},
): Promise<ImageInspectionResult> {
  throwIfAborted(options.signal);

  if (file.size === 0) {
    return failure('empty-file', 'That file is empty. Choose a photo.');
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return failure('oversized', 'That image is larger than 30 MB. Choose a smaller photo.');
  }

  const header = await readHeader(file);
  if (header === null || header.length === 0) {
    return failure('unreadable-file', 'That file could not be read. Try another photo.');
  }

  const detected = sniffImageMime(header);
  const reported = normalizeReportedMime(file.type);

  if (detected === null) {
    const unsupported = detectUnsupportedImageFormat(header);
    if (unsupported !== null) {
      return unsupportedFormatFailure(unsupported);
    }
    return failure('corrupt-image', 'That image could not be recognized. Try another photo.');
  }

  if (reported !== '' && !isSupportedMime(reported)) {
    return failure('unsupported-type', 'Choose a JPEG, PNG, or WebP photo.', {
      detectedMime: detected,
    });
  }

  if (reported !== '' && reported !== detected) {
    return failure(
      'mime-mismatch',
      'That file says it is one image type but contains another. Choose a JPEG, PNG, or WebP photo.',
      { detectedMime: detected },
    );
  }

  return { ok: true, mime: detected, byteLength: file.size };
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

function releaseImageElement(image: HTMLImageElement): void {
  image.onload = null;
  image.onerror = null;
  if (typeof image.removeAttribute === 'function') {
    // Clearing src without assigning an empty URL avoids a spurious request.
    image.removeAttribute('src');
  } else {
    image.src = '';
  }
}

function loadImageElement(
  image: HTMLImageElement,
  url: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort);
      image.onload = null;
      image.onerror = null;
    };

    const onAbort = (): void => {
      cleanup();
      reject(createAbortError());
    };

    if (signal?.aborted === true) {
      cleanup();
      reject(createAbortError());
      return;
    }

    image.onload = (): void => {
      cleanup();
      resolve();
    };
    image.onerror = (): void => {
      cleanup();
      reject(new ImageDecodeError('decode-failed', 'The image could not be decoded.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = url;
  });
}

/**
 * Decode with EXIF orientation applied exactly once. `createImageBitmap` is the
 * primary path; the `<img>` fallback exists for platforms without it and owns
 * an object URL that is revoked on load, failure, and abort.
 */
export async function decodeImageBlob(
  blob: Blob,
  options: ImageDecoderOptions = {},
): Promise<DecodedImage> {
  throwIfAborted(options.signal);

  const explicitFactory = options.createImageBitmap;
  const platformFactory =
    explicitFactory === undefined && typeof globalThis.createImageBitmap === 'function'
      ? globalThis.createImageBitmap.bind(globalThis)
      : undefined;
  const factory: ImageBitmapFactory | null =
    explicitFactory === null
      ? null
      : explicitFactory !== undefined
        ? explicitFactory
        : ((platformFactory as ImageBitmapFactory | undefined) ?? null);

  if (factory !== null) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await factory(blob, { imageOrientation: 'from-image' });
    } catch (cause) {
      if (isAbortError(cause)) {
        throw cause;
      }
      throw new ImageDecodeError('decode-failed', 'The image could not be decoded.');
    }

    if (options.signal?.aborted === true) {
      bitmap.close?.();
      throw createAbortError();
    }

    let closed = false;
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: (): void => {
        if (!closed) {
          closed = true;
          bitmap.close?.();
        }
      },
    };
  }

  const createUrl = options.createObjectUrl ?? ((value: Blob) => URL.createObjectURL(value));
  const revokeUrl = options.revokeObjectUrl ?? ((value: string) => URL.revokeObjectURL(value));
  const createImage =
    options.createImage ??
    (() => {
      if (typeof Image === 'undefined') {
        throw new ImageDecodeError('decode-failed', 'This environment cannot decode images.');
      }
      return new Image();
    });

  const url = createUrl(blob);
  const image = createImage();
  let loaded = false;
  try {
    await loadImageElement(image, url, options.signal);
    throwIfAborted(options.signal);

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new ImageDecodeError('decode-failed', 'The image has no readable dimensions.');
    }

    loaded = true;
    let closed = false;
    return {
      width,
      height,
      source: image,
      close: (): void => {
        if (!closed) {
          closed = true;
          releaseImageElement(image);
        }
      },
    };
  } finally {
    // The decoded pixels remain usable after the URL is revoked; the URL only
    // kept the load in flight. Revoking here bounds every failure branch.
    revokeUrl(url);
    if (!loaded) {
      // Release a half-loaded element so a cancelled import leaves no image
      // request pinned in the document.
      releaseImageElement(image);
    }
  }
}

/**
 * Full intake validation, including a real decode. On success the decoded
 * bitmap is closed unless `keepDecodedImage` is set, so a plain "is this file
 * usable?" call cannot leak a 30 MB bitmap.
 */
export async function validateImageFile(
  file: Blob,
  options: ValidateImageOptions = {},
): Promise<ImageValidationResult> {
  const inspection = await inspectImageFile(
    file,
    options.signal !== undefined ? { signal: options.signal } : {},
  );
  if (!inspection.ok) {
    return inspection;
  }

  throwIfAborted(options.signal);

  const decoder = options.decoder ?? decodeImageBlob;
  let decoded: DecodedImage;
  try {
    decoded = await decoder(file, buildDecoderOptions(options.signal, options.decodeOptions));
  } catch (cause) {
    if (isAbortError(cause)) {
      throw cause;
    }
    return failure('corrupt-image', 'That image could not be read. Try another photo.');
  }

  const validDimensions =
    Number.isInteger(decoded.width) &&
    Number.isInteger(decoded.height) &&
    decoded.width > 0 &&
    decoded.height > 0;

  if (!validDimensions) {
    decoded.close();
    return failure('corrupt-image', 'That image could not be read. Try another photo.');
  }

  const keepSource = options.keepDecodedImage === true;
  // Capture dimensions before release: a real ImageBitmap reports 0x0 after
  // close(), even though our test doubles keep their fields.
  const width = decoded.width;
  const height = decoded.height;

  if (!keepSource) {
    try {
      throwIfAborted(options.signal);
    } finally {
      decoded.close();
    }
    return {
      ok: true,
      mime: inspection.mime,
      byteLength: inspection.byteLength,
      width,
      height,
    };
  }

  try {
    throwIfAborted(options.signal);
  } catch (cause) {
    decoded.close();
    throw cause;
  }

  return {
    ok: true,
    mime: inspection.mime,
    byteLength: inspection.byteLength,
    width,
    height,
    source: decoded,
  };
}
