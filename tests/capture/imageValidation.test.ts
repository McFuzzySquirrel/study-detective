// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  createAbortError,
  decodeImageBlob,
  detectUnsupportedImageFormat,
  ImageDecodeError,
  inspectImageFile,
  MAX_IMAGE_BYTES,
  sniffImageMime,
  validateImageFile,
  type DecodedImage,
  type ImageDecoder,
} from '../../src/features/capture/imageValidation';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff, 0xe0];

function bytesOf(size: number, prefix: readonly number[] = []): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set(prefix.slice(0, size));
  return bytes;
}

function pngBytes(size = 64): Uint8Array<ArrayBuffer> {
  return bytesOf(size, PNG_SIGNATURE);
}

function jpegBytes(size = 64): Uint8Array<ArrayBuffer> {
  return bytesOf(size, JPEG_SIGNATURE);
}

function webpBytes(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = bytesOf(size, [...new TextEncoder().encode('RIFF'), 0, 0, 0, 0]);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  return bytes;
}

function gifBytes(size = 64): Uint8Array<ArrayBuffer> {
  return bytesOf(size, [...new TextEncoder().encode('GIF89a')]);
}

function svgBytes(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>');
}

function heicBytes(): Uint8Array<ArrayBuffer> {
  const bytes = bytesOf(64, [0, 0, 0, 0x18]);
  bytes.set(new TextEncoder().encode('ftypheic'), 4);
  return bytes;
}

function imageFile(bytes: Uint8Array<ArrayBuffer>, type: string, name = 'notes.png'): File {
  return new File([bytes], name, { type });
}

function fakeDecoded(width = 800, height = 600): DecodedImage {
  return {
    width,
    height,
    source: {} as unknown as CanvasImageSource,
    close: vi.fn<() => void>(),
  };
}

function decoderFor(decoded: DecodedImage): ImageDecoder {
  return vi.fn<ImageDecoder>(async () => decoded);
}

describe('sniffImageMime and unsupported formats', () => {
  it('detects JPEG, PNG, WebP, and GIF from magic bytes', () => {
    expect(sniffImageMime(jpegBytes())).toBe('image/jpeg');
    expect(sniffImageMime(pngBytes())).toBe('image/png');
    expect(sniffImageMime(webpBytes())).toBe('image/webp');
    expect(sniffImageMime(gifBytes())).toBe('image/gif');
    expect(sniffImageMime(new TextEncoder().encode('not an image'))).toBeNull();
  });

  it('names SVG, HEIC, and PDF as unsupported containers', () => {
    expect(detectUnsupportedImageFormat(svgBytes())).toBe('svg');
    expect(detectUnsupportedImageFormat(heicBytes())).toBe('heic');
    expect(detectUnsupportedImageFormat(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(detectUnsupportedImageFormat(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('size boundary', () => {
  it('accepts exactly 30 MB and decodes it once', async () => {
    const decoded = fakeDecoded(512, 512);
    const decoder = decoderFor(decoded);
    const file = imageFile(bytesOf(MAX_IMAGE_BYTES, JPEG_SIGNATURE), 'image/jpeg', 'large.jpg');

    expect(file.size).toBe(MAX_IMAGE_BYTES);
    const result = await validateImageFile(file, { decoder });

    expect(result).toMatchObject({
      ok: true,
      mime: 'image/jpeg',
      byteLength: MAX_IMAGE_BYTES,
      width: 512,
      height: 512,
    });
    expect(decoder).toHaveBeenCalledTimes(1);
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });

  it('rejects one byte over 30 MB before decoding or writing anything', async () => {
    const decoder = decoderFor(fakeDecoded());
    const file = imageFile(bytesOf(MAX_IMAGE_BYTES + 1, JPEG_SIGNATURE), 'image/jpeg', 'large.jpg');

    const result = await validateImageFile(file, { decoder });

    expect(result).toMatchObject({
      ok: false,
      code: 'oversized',
      message: expect.stringContaining('30 MB'),
    });
    expect(decoder).not.toHaveBeenCalled();
  });

  it('rejects a zero-byte file before decoding', async () => {
    const decoder = decoderFor(fakeDecoded());
    const result = await validateImageFile(imageFile(bytesOf(0), 'image/png'), { decoder });

    expect(result).toMatchObject({ ok: false, code: 'empty-file' });
    expect(decoder).not.toHaveBeenCalled();
  });
});

describe('type and payload validation', () => {
  it('rejects a PNG whose reported MIME says JPEG', async () => {
    const decoder = decoderFor(fakeDecoded());
    const result = await validateImageFile(imageFile(pngBytes(), 'image/jpeg', 'spoofed.jpg'), {
      decoder,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'mime-mismatch',
      detectedMime: 'image/png',
    });
    expect(decoder).not.toHaveBeenCalled();
  });

  it('rejects a reported GIF MIME when the bytes are a JPEG', async () => {
    const decoder = decoderFor(fakeDecoded());
    const result = await validateImageFile(imageFile(jpegBytes(), 'image/gif', 'renamed.gif'), {
      decoder,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'mime-mismatch',
      detectedMime: 'image/jpeg',
    });
    expect(decoder).not.toHaveBeenCalled();
  });

  it('accepts a GIF with a matching MIME and returns its decoded dimensions', async () => {
    const decoder = decoderFor(fakeDecoded(640, 480));
    const result = await validateImageFile(imageFile(gifBytes(), 'image/gif', 'animated.gif'), {
      decoder,
    });

    expect(result).toMatchObject({
      ok: true,
      mime: 'image/gif',
      width: 640,
      height: 480,
    });
    expect(decoder).toHaveBeenCalledTimes(1);
  });

  it('rejects an SVG before any decode', async () => {
    const decoder = decoderFor(fakeDecoded());
    const result = await validateImageFile(imageFile(svgBytes(), 'image/svg+xml', 'drawing.svg'), {
      decoder,
    });

    expect(result).toMatchObject({ ok: false, code: 'unsupported-format', format: 'svg' });
    expect(decoder).not.toHaveBeenCalled();
  });

  it('rejects SVG bytes spoofed as a PNG', async () => {
    const result = await validateImageFile(imageFile(svgBytes(), 'image/png', 'spoofed.png'));

    expect(result).toMatchObject({ ok: false, code: 'unsupported-format', format: 'svg' });
  });

  it('rejects HEIC bytes and images with an unreadable payload', async () => {
    const heic = await validateImageFile(imageFile(heicBytes(), 'image/heic', 'photo.heic'));
    expect(heic).toMatchObject({ ok: false, code: 'unsupported-format', format: 'heic' });

    const unknown = await validateImageFile(imageFile(bytesOf(64, [1, 2, 3, 4]), 'image/png'));
    expect(unknown).toMatchObject({ ok: false, code: 'corrupt-image' });
  });

  it('rejects a truncated image when the decoder fails', async () => {
    const decoder = vi.fn(async () => {
      throw new ImageDecodeError('decode-failed', 'The image could not be decoded.');
    });

    const result = await validateImageFile(imageFile(pngBytes(), 'image/png'), { decoder });

    expect(result).toMatchObject({ ok: false, code: 'corrupt-image' });
    expect(decoder).toHaveBeenCalledTimes(1);
  });

  it('accepts a file with no reported type when the bytes are supported', async () => {
    const decoded = fakeDecoded(400, 300);
    const result = await validateImageFile(imageFile(webpBytes(), '', 'photo'), {
      decoder: decoderFor(decoded),
    });

    expect(result).toMatchObject({ ok: true, mime: 'image/webp', width: 400, height: 300 });
  });

  it('does not decode in inspectImageFile, and returns byte length only', async () => {
    const inspection = await inspectImageFile(imageFile(pngBytes(), 'image/png'));
    expect(inspection).toEqual({ ok: true, mime: 'image/png', byteLength: 64 });
  });
});

describe('decode ownership and orientation', () => {
  it('requests EXIF orientation exactly once and closes the probe bitmap', async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({
      width: 1200,
      height: 1600,
      close,
    })) as unknown as (
      blob: Blob,
      options: { imageOrientation: 'from-image' },
    ) => Promise<ImageBitmap>;

    const result = await validateImageFile(imageFile(jpegBytes(), 'image/jpeg'), {
      decodeOptions: { createImageBitmap },
    });

    expect(result).toMatchObject({ ok: true, width: 1200, height: 1600 });
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), {
      imageOrientation: 'from-image',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('hands the decoded source to the caller only when keepDecodedImage is set', async () => {
    const decoded = fakeDecoded(900, 700);

    const result = await validateImageFile(imageFile(pngBytes(), 'image/png'), {
      decoder: decoderFor(decoded),
      keepDecodedImage: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe(decoded);
      expect(result.source?.width).toBe(900);
    }
    expect(decoded.close).not.toHaveBeenCalled();
    decoded.close();
  });
});

describe('cancellation and object URL cleanup', () => {
  it('throws AbortError before reading the file when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const decoder = decoderFor(fakeDecoded());

    await expect(
      validateImageFile(imageFile(pngBytes(), 'image/png'), {
        decoder,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(decoder).not.toHaveBeenCalled();
  });

  it('propagates AbortError from a decoder and does not turn it into corruption', async () => {
    const decoder = vi.fn(async () => {
      throw createAbortError();
    });

    await expect(
      validateImageFile(imageFile(pngBytes(), 'image/png'), { decoder }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('revokes the <img> fallback object URL when cancelled during load', async () => {
    const controller = new AbortController();
    const revokeObjectUrl = vi.fn();

    class AbortingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      width = 0;
      height = 0;
      decoding = '';
      set src(_value: string) {
        controller.abort();
      }
    }

    await expect(
      decodeImageBlob(imageFile(pngBytes(), 'image/png'), {
        createImageBitmap: null,
        createImage: () => new AbortingImage() as unknown as HTMLImageElement,
        createObjectUrl: () => 'blob:cancelled-import',
        revokeObjectUrl,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cancelled-import');
  });

  it('revokes the <img> fallback object URL after a successful load', async () => {
    const revokeObjectUrl = vi.fn();

    class LoadedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 640;
      naturalHeight = 480;
      width = 640;
      height = 480;
      decoding = '';
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    const image = new LoadedImage();
    const decoded = await decodeImageBlob(imageFile(pngBytes(), 'image/png'), {
      createImageBitmap: null,
      createImage: () => image as unknown as HTMLImageElement,
      createObjectUrl: () => 'blob:loaded',
      revokeObjectUrl,
    });

    expect(decoded.width).toBe(640);
    expect(decoded.height).toBe(480);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:loaded');
    decoded.close();
  });

  it('revokes the <img> fallback object URL when the decode fails', async () => {
    const revokeObjectUrl = vi.fn();

    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      width = 0;
      height = 0;
      decoding = '';
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }

    await expect(
      decodeImageBlob(imageFile(pngBytes(), 'image/png'), {
        createImageBitmap: null,
        createImage: () => new BrokenImage() as unknown as HTMLImageElement,
        createObjectUrl: () => 'blob:broken',
        revokeObjectUrl,
      }),
    ).rejects.toBeInstanceOf(ImageDecodeError);

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:broken');
  });
});
