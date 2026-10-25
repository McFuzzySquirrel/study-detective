// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CaseRepository, type CaseRepositoryPort } from '../../src/data/caseRepository';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import {
  importImageCard,
  type ImageCardType,
  type ImportStage,
} from '../../src/features/capture/cardImport';
import {
  decodeImageBlob,
  ImageDecodeError,
  type DecodedImage,
  type ImageDecoder,
} from '../../src/features/capture/imageValidation';
import type {
  Canvas2DContext,
  CanvasFactory,
  EncodableCanvas,
} from '../../src/features/capture/imagePipeline';
import { advancingClock } from '../data/testDatabase';
import { closeTestDatabase, openTestDatabase } from '../data/testDatabase';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

class PassThroughContext implements Canvas2DContext {
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = 'low';
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  drawImage(): void {}
}

class PassThroughCanvas implements EncodableCanvas {
  width: number;
  height: number;
  readonly context = new PassThroughContext();
  readonly encodings: { readonly type: string; readonly quality: number | undefined }[] = [];

  constructor(width: number, height: number) {
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
    const type = options?.type ?? 'image/png';
    return new Blob([`${type}:${this.width}x${this.height}`], { type });
  }
}

function canvasHarness(): {
  readonly factory: CanvasFactory;
  readonly canvases: PassThroughCanvas[];
} {
  const canvases: PassThroughCanvas[] = [];
  const factory: CanvasFactory = (width, height) => {
    const canvas = new PassThroughCanvas(width, height);
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

function pngFile(size = 256, name = 'note.png'): File {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set(PNG_SIGNATURE);
  return new File([bytes], name, { type: 'image/png' });
}

function svgFile(): File {
  return new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'drawing.svg', {
    type: 'image/svg+xml',
  });
}

function baseInput(overrides: Partial<Parameters<typeof importImageCard>[0]> = {}) {
  return {
    file: pngFile(),
    caseId: '',
    type: 'note' as ImageCardType,
    title: 'Lecture page',
    position: { x: 120, y: 80 },
    tags: ['Biology'],
    ...overrides,
  };
}

let db: NotesDetectiveDatabase;
let repository: CaseRepository;
let caseId: string;

beforeEach(async () => {
  db = await openTestDatabase('card-import');
  repository = new CaseRepository(db, { clock: advancingClock() });
  const createdCase = await repository.createCase({ title: 'Cell Biology Final' });
  caseId = createdCase.id;
});

afterEach(async () => {
  await closeTestDatabase(db);
});

describe('successful import', () => {
  it('commits one card and exactly one original, display, and thumbnail row', async () => {
    const decoded = fakeDecoded(3000, 2000);
    const harness = canvasHarness();
    const stages: ImportStage[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const logSpy = vi.spyOn(console, 'log');
    const createSpy = vi.spyOn(repository, 'createCardWithAttachments');

    const outcome = await importImageCard(baseInput({ caseId }), {
      repository,
      decode: decoderFor(decoded),
      createCanvas: harness.factory,
      onProgress: ({ stage }) => stages.push(stage),
    });

    expect(outcome.status).toBe('imported');
    if (outcome.status !== 'imported') {
      throw new Error('Expected a successful import');
    }

    expect(outcome.card).toMatchObject({
      caseId,
      type: 'note',
      title: 'Lecture page',
      position: { x: 120, y: 80 },
      tags: ['Biology'],
    });
    expect(outcome.attachments).toHaveLength(3);

    expect(await db.cards.count()).toBe(1);
    expect(await db.attachments.count()).toBe(3);

    const rows = await db.attachments.where('cardId').equals(outcome.card.id).toArray();
    expect(rows.map((row) => row.kind).sort()).toEqual(['display', 'original', 'thumbnail']);

    const original = rows.find((row) => row.kind === 'original');
    const display = rows.find((row) => row.kind === 'display');
    const thumbnail = rows.find((row) => row.kind === 'thumbnail');

    expect(original).toMatchObject({ width: 3000, height: 2000, mime: 'image/png' });
    expect(display).toMatchObject({ width: 2048, height: 1365 });
    expect(thumbnail).toMatchObject({ width: 320, height: 213 });

    for (const row of rows) {
      expect(row.bytes).toBe(row.blob.size);
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    }

    expect(stages).toEqual([
      'validating',
      'decoding',
      'transforming',
      'encoding',
      'encoding',
      'encoding',
      'saving',
      'done',
    ]);
    expect(decoded.close).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[1]).toHaveLength(3);
    expect(await repository.getCaseSummary(caseId)).toMatchObject({ cardCount: 1 });
  });

  it('stores cropped and rotated display dimensions while retaining the uncropped original', async () => {
    const outcome = await importImageCard(
      baseInput({
        caseId,
        crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
        rotation: 90,
      }),
      {
        repository,
        decode: decoderFor(fakeDecoded(5000, 3000)),
        createCanvas: canvasHarness().factory,
      },
    );

    expect(outcome.status).toBe('imported');
    if (outcome.status !== 'imported') {
      throw new Error('Expected a successful import');
    }

    const rows = await db.attachments.where('cardId').equals(outcome.card.id).toArray();
    expect(rows.find((row) => row.kind === 'original')).toMatchObject({
      width: 4096,
      height: 2458,
    });
    expect(rows.find((row) => row.kind === 'display')).toMatchObject({
      width: 1229,
      height: 2048,
    });
    expect(rows.find((row) => row.kind === 'thumbnail')).toMatchObject({
      width: 192,
      height: 320,
    });
  });

  it('retains the decoded resolution when full resolution is opted in', async () => {
    const outcome = await importImageCard(baseInput({ caseId, retainFullResolution: true }), {
      repository,
      decode: decoderFor(fakeDecoded(5000, 3000)),
      createCanvas: canvasHarness().factory,
    });

    expect(outcome.status).toBe('imported');
    if (outcome.status !== 'imported') {
      throw new Error('Expected a successful import');
    }

    const rows = await db.attachments.where('cardId').equals(outcome.card.id).toArray();
    expect(rows.find((row) => row.kind === 'original')).toMatchObject({
      width: 5000,
      height: 3000,
    });
  });
});

describe('atomic failure', () => {
  it('leaves zero cards and zero attachments when the Blob write fails, and a retry succeeds', async () => {
    const input = baseInput({ caseId });
    const caseBefore = await repository.getCase(caseId);
    const failWrite = vi
      .spyOn(db.attachments, 'bulkAdd')
      .mockRejectedValueOnce(new Error('injected storage failure'));

    const failed = await importImageCard(input, {
      repository,
      decode: decoderFor(fakeDecoded(2400, 1600)),
      createCanvas: canvasHarness().factory,
    });

    expect(failed).toMatchObject({ status: 'failed', code: 'storage' });
    expect(await db.cards.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
    expect(await repository.listCards(caseId)).toEqual([]);
    expect((await repository.getCase(caseId))?.updatedAt).toBe(caseBefore?.updatedAt);

    failWrite.mockRestore();

    const retry = await importImageCard(input, {
      repository,
      decode: decoderFor(fakeDecoded(2400, 1600)),
      createCanvas: canvasHarness().factory,
    });

    expect(retry.status).toBe('imported');
    expect(await db.cards.count()).toBe(1);
    expect(await db.attachments.count()).toBe(3);
  });

  it('rejects a spoofed MIME before decoding and writes nothing', async () => {
    const decode = vi.fn();
    const harness = canvasHarness();

    const outcome = await importImageCard(
      baseInput({
        caseId,
        file: new File([new Uint8Array(PNG_SIGNATURE)], 'spoofed.jpg', { type: 'image/jpeg' }),
      }),
      {
        repository,
        decode: decode as unknown as ImageDecoder,
        createCanvas: harness.factory,
      },
    );

    expect(outcome).toMatchObject({
      status: 'failed',
      code: 'invalid-image',
      validationCode: 'mime-mismatch',
    });
    expect(decode).not.toHaveBeenCalled();
    expect(harness.canvases).toHaveLength(0);
    expect(await db.cards.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });

  it('rejects SVG and corrupt payloads with no card rows', async () => {
    const svg = await importImageCard(baseInput({ caseId, file: svgFile() }), { repository });
    expect(svg).toMatchObject({
      status: 'failed',
      code: 'invalid-image',
      validationCode: 'unsupported-format',
    });

    const corruptDecode = vi.fn<ImageDecoder>(async () => {
      throw new ImageDecodeError('decode-failed', 'The image could not be decoded.');
    });

    const corrupt = await importImageCard(baseInput({ caseId }), {
      repository,
      decode: corruptDecode,
      createCanvas: canvasHarness().factory,
    });
    expect(corrupt).toMatchObject({
      status: 'failed',
      code: 'invalid-image',
      validationCode: 'corrupt-image',
    });

    expect(await db.cards.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });

  it('rejects a Topic card before reading the image', async () => {
    const decode = vi.fn();
    const outcome = await importImageCard(
      baseInput({ caseId, type: 'topic' as unknown as ImageCardType }),
      { repository, decode: decode as unknown as ImageDecoder },
    );

    expect(outcome).toMatchObject({ status: 'failed', code: 'unsupported-card-type' });
    expect(decode).not.toHaveBeenCalled();
    expect(await db.cards.count()).toBe(0);
  });
});

describe('cancellation', () => {
  it('cancels before decoding and writes nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const decode = vi.fn();

    const outcome = await importImageCard(baseInput({ caseId }), {
      repository,
      signal: controller.signal,
      decode: decode as unknown as ImageDecoder,
    });

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(decode).not.toHaveBeenCalled();
    expect(await db.cards.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });

  it('cancels during encoding, closes the bitmap, and writes nothing', async () => {
    const controller = new AbortController();
    const decoded = fakeDecoded(3000, 2000);
    const harness = canvasHarness();

    const outcome = await importImageCard(baseInput({ caseId }), {
      repository,
      signal: controller.signal,
      decode: decoderFor(decoded),
      createCanvas: harness.factory,
      onProgress: ({ stage }) => {
        if (stage === 'encoding') {
          controller.abort();
        }
      },
    });

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(decoded.close).toHaveBeenCalledTimes(1);
    expect(await db.cards.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });

  it('cancels after processing but before the transaction begins', async () => {
    const controller = new AbortController();
    const createSpy = vi.spyOn(repository, 'createCardWithAttachments');

    const outcome = await importImageCard(baseInput({ caseId }), {
      repository: repository as CaseRepositoryPort,
      signal: controller.signal,
      decode: decoderFor(fakeDecoded(2000, 1200)),
      createCanvas: canvasHarness().factory,
      onProgress: ({ stage }) => {
        if (stage === 'saving') {
          controller.abort();
        }
      },
    });

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(createSpy).not.toHaveBeenCalled();
    expect(await db.cards.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });

  it('revokes the decode object URL when cancelled during the <img> fallback', async () => {
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

    const decode: ImageDecoder = (blob, options) =>
      decodeImageBlob(blob, {
        ...(options ?? {}),
        createImageBitmap: null,
        createImage: () => new AbortingImage() as unknown as HTMLImageElement,
        createObjectUrl: () => 'blob:cancelled-card-import',
        revokeObjectUrl,
      });

    const outcome = await importImageCard(baseInput({ caseId }), {
      repository,
      signal: controller.signal,
      decode,
      createCanvas: canvasHarness().factory,
    });

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cancelled-card-import');
    expect(await db.cards.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });
});
