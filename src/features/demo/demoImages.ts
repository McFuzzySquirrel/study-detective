import type { AttachmentKind, AttachmentMime } from '../../domain/model';

import {
  DISPLAY_MAX_EDGE,
  ORIGINAL_MAX_EDGE,
  THUMBNAIL_MAX_EDGE,
  computeScaledDimensions,
  sha256Hex,
} from '../capture/imagePipeline';

/**
 * Locally generated demo pages.
 *
 * Every pixel is drawn here, on a canvas created at runtime. There is no image
 * asset, remote URL, external font, or licensed artwork: the pages only use the
 * browser's built-in serif/sans-serif fallbacks and flat fills. The generator is
 * injectable so unit tests can exercise the exact derivative contract without a
 * real canvas, while production uses an OffscreenCanvas or HTMLCanvasElement.
 */

export const DEMO_IMAGE_WIDTH = 1200;
export const DEMO_IMAGE_HEIGHT = 800;
export const DEMO_PAGE_MIME: AttachmentMime = 'image/png';

/** The four photographed-looking pages attached to the demo notes and sources. */
export const DEMO_PAGE_IDS = ['note-1', 'note-2', 'source-1', 'source-2'] as const;
export type DemoPageId = (typeof DEMO_PAGE_IDS)[number];
export type DemoPageKind = 'note' | 'source';

export type DemoPageSpec = {
  readonly id: DemoPageId;
  readonly kind: DemoPageKind;
  readonly label: string;
  readonly heading: string;
  readonly subheading: string;
  readonly lines: readonly string[];
  /** A muted ink colour used for the page label and rules. */
  readonly accent: string;
};

export const DEMO_PAGES: readonly DemoPageSpec[] = Object.freeze([
  {
    id: 'note-1',
    kind: 'note',
    label: 'Page 1 of 4',
    heading: 'Photosynthesis',
    subheading: 'Biology 11 · lecture notes',
    lines: [
      'Light reactions split water and release O₂.',
      'The Calvin cycle fixes CO₂ into sugar.',
      'Chlorophyll absorbs red and blue light.',
      'Question: what limits the dark reactions?',
    ],
    accent: '#8a4b2f',
  },
  {
    id: 'note-2',
    kind: 'note',
    label: 'Page 2 of 4',
    heading: 'Cellular Respiration',
    subheading: 'Biology 11 · lecture notes',
    lines: [
      'Glycolysis yields 2 ATP and 2 NADH.',
      'The Krebs cycle runs in the mitochondrial matrix.',
      'The electron transport chain builds a proton gradient.',
      'Most ATP comes from oxidative phosphorylation.',
    ],
    accent: '#47613a',
  },
  {
    id: 'source-1',
    kind: 'source',
    label: 'Page 3 of 4',
    heading: 'Lecture 4 - Energy in Cells',
    subheading: 'Handout · page 12',
    lines: [
      'Photosynthesis stores energy in glucose.',
      'Respiration releases energy from glucose.',
      'Both pathways cycle carbon through the cell.',
      'Check the worked example before Friday.',
    ],
    accent: '#2f5670',
  },
  {
    id: 'source-2',
    kind: 'source',
    label: 'Page 4 of 4',
    heading: 'Textbook - Chapter 7',
    subheading: 'Section 7.3 · cellular energy',
    lines: [
      'Mitochondria are the site of aerobic respiration.',
      'ATP synthase converts the proton gradient to ATP.',
      'Anaerobic respiration produces less ATP.',
      'Compare the two pathways in the summary table.',
    ],
    accent: '#5b4770',
  },
]);

export interface DemoCanvas2DContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
}

export interface DemoCanvas {
  width: number;
  height: number;
  getContext(contextId: '2d'): DemoCanvas2DContext | null;
  convertToBlob?(options?: { readonly type?: string; readonly quality?: number }): Promise<Blob>;
  toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export type DemoCanvasFactory = (width: number, height: number) => DemoCanvas;
export type DemoBlobDigest = (blob: Blob) => Promise<string>;

export type DemoImageErrorCode =
  'canvas-unavailable' | 'context-unavailable' | 'encode-failed' | 'digest-failed';

/** A local-drawing failure the first-run bootstrap can report without details. */
export class DemoImageError extends Error {
  readonly code: DemoImageErrorCode;

  constructor(code: DemoImageErrorCode, message: string) {
    super(message);
    this.name = 'DemoImageError';
    this.code = code;
  }
}

export type DemoDerivative = {
  readonly kind: AttachmentKind;
  readonly mime: AttachmentMime;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly blob: Blob;
};

export type DemoImageSet = {
  readonly pageId: DemoPageId;
  readonly kind: DemoPageKind;
  readonly heading: string;
  readonly original: DemoDerivative;
  readonly display: DemoDerivative;
  readonly thumbnail: DemoDerivative;
};

export type DemoImageGenerationOptions = {
  /** Injected in tests; production falls back to the browser canvas. */
  readonly createCanvas?: DemoCanvasFactory;
  /** Injected in tests; production uses SHA-256 over the encoded bytes. */
  readonly digest?: DemoBlobDigest;
  readonly mime?: AttachmentMime;
};

const SUPPORTED_ENCODED_MIME_TYPES: readonly AttachmentMime[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

const PAPER = '#f2e7d0';
const PAGE = '#fbf6ea';
const RULE = '#c9d5de';
const INK = '#2b2622';
const MUTED = '#6b625a';

function defaultDemoCanvasFactory(width: number, height: number): DemoCanvas {
  if (typeof OffscreenCanvas === 'function') {
    try {
      const canvas = new OffscreenCanvas(width, height);
      // Some environments expose OffscreenCanvas without an encoder; fall back
      // to the HTML canvas instead of failing only at encode time.
      if (typeof canvas.convertToBlob === 'function') {
        return canvas as unknown as DemoCanvas;
      }
    } catch {
      // Fall through to the HTML canvas path.
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as DemoCanvas;
  }

  throw new DemoImageError(
    'canvas-unavailable',
    'This browser cannot generate the demo images locally.',
  );
}

function context2d(canvas: DemoCanvas): DemoCanvas2DContext {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new DemoImageError(
      'context-unavailable',
      'This browser cannot draw the demo images on a canvas.',
    );
  }
  return context;
}

function drawBullet(
  context: DemoCanvas2DContext,
  text: string,
  x: number,
  y: number,
  scale: number,
  accent: string,
): void {
  context.fillStyle = accent;
  context.beginPath();
  context.arc(x, y - 5 * scale, 4 * scale, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = INK;
  context.fillText(text, x + 22 * scale, y);
}

/**
 * Draw one page scaled to the target canvas. Drawing each derivative from the
 * same spec, rather than scaling a bitmap, keeps the thumbnail's line work
 * crisp and makes the three outputs genuinely independent encodes.
 */
function drawDemoPage(
  context: DemoCanvas2DContext,
  spec: DemoPageSpec,
  width: number,
  height: number,
): void {
  const scale = width / DEMO_IMAGE_WIDTH;

  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);
  context.fillStyle = PAGE;
  context.fillRect(8 * scale, 8 * scale, width - 16 * scale, height - 16 * scale);

  // Soft top and bottom bands give the page a photographed-notebook feel.
  context.fillStyle = 'rgba(43, 38, 34, 0.08)';
  context.fillRect(0, 0, width, 5 * scale);
  context.fillRect(0, height - 5 * scale, width, 5 * scale);

  // Punch holes along the left edge.
  context.fillStyle = '#ddd1ba';
  for (let index = 0; index < 3; index += 1) {
    context.beginPath();
    context.arc(52 * scale, (190 + index * 210) * scale, 15 * scale, 0, Math.PI * 2);
    context.fill();
  }

  // Ruled paper.
  context.strokeStyle = RULE;
  context.lineWidth = Math.max(1, 1.4 * scale);
  for (let y = 214; y < DEMO_IMAGE_HEIGHT - 52; y += 42) {
    context.beginPath();
    context.moveTo(88 * scale, y * scale);
    context.lineTo((DEMO_IMAGE_WIDTH - 70) * scale, y * scale);
    context.stroke();
  }

  context.strokeStyle = 'rgba(176, 92, 84, 0.55)';
  context.lineWidth = Math.max(1, 1.2 * scale);
  context.beginPath();
  context.moveTo(146 * scale, 24 * scale);
  context.lineTo(146 * scale, (DEMO_IMAGE_HEIGHT - 24) * scale);
  context.stroke();

  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';

  context.fillStyle = spec.accent;
  context.font = `600 ${Math.round(19 * scale)}px "Trebuchet MS", Arial, sans-serif`;
  context.fillText(
    `${spec.kind === 'note' ? 'STUDY NOTE' : 'SOURCE'} · ${spec.label}`,
    174 * scale,
    82 * scale,
  );

  context.fillStyle = INK;
  context.font = `700 ${Math.round(46 * scale)}px Georgia, "Times New Roman", serif`;
  context.fillText(spec.heading, 174 * scale, 142 * scale);

  context.fillStyle = MUTED;
  context.font = `italic ${Math.round(22 * scale)}px Georgia, "Times New Roman", serif`;
  context.fillText(spec.subheading, 174 * scale, 180 * scale);

  context.font = `${Math.round(23 * scale)}px Georgia, "Times New Roman", serif`;
  spec.lines.forEach((line, index) => {
    drawBullet(context, line, 178 * scale, (262 + index * 58) * scale, scale, spec.accent);
  });

  context.strokeStyle = 'rgba(43, 38, 34, 0.18)';
  context.lineWidth = Math.max(1, scale);
  context.beginPath();
  context.moveTo(174 * scale, (DEMO_IMAGE_HEIGHT - 78) * scale);
  context.lineTo((DEMO_IMAGE_WIDTH - 72) * scale, (DEMO_IMAGE_HEIGHT - 78) * scale);
  context.stroke();

  context.fillStyle = MUTED;
  context.font = `${Math.round(16 * scale)}px "Trebuchet MS", Arial, sans-serif`;
  context.fillText(
    'DEMO PAGE · drawn locally, no third-party content',
    174 * scale,
    (DEMO_IMAGE_HEIGHT - 46) * scale,
  );
}

async function encodeCanvas(canvas: DemoCanvas, mime: AttachmentMime): Promise<Blob> {
  if (typeof canvas.convertToBlob === 'function') {
    try {
      return await canvas.convertToBlob({ type: mime });
    } catch {
      throw new DemoImageError('encode-failed', 'A demo image could not be prepared locally.');
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
              reject(
                new DemoImageError('encode-failed', 'A demo image could not be prepared locally.'),
              );
              return;
            }
            resolve(blob);
          },
          mime,
        );
      } catch {
        reject(new DemoImageError('encode-failed', 'A demo image could not be prepared locally.'));
      }
    });
  }

  throw new DemoImageError('encode-failed', 'This browser cannot encode the demo images.');
}

function resolveEncodedMime(blob: Blob, requested: AttachmentMime): AttachmentMime {
  const actual = blob.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (actual === '') {
    return requested;
  }
  if ((SUPPORTED_ENCODED_MIME_TYPES as readonly string[]).includes(actual)) {
    return actual as AttachmentMime;
  }
  throw new DemoImageError(
    'encode-failed',
    'The browser produced a demo image format the app cannot store.',
  );
}

async function renderDerivative(
  spec: DemoPageSpec,
  kind: AttachmentKind,
  width: number,
  height: number,
  factory: DemoCanvasFactory,
  digest: DemoBlobDigest,
  mime: AttachmentMime,
): Promise<DemoDerivative> {
  const canvas = factory(width, height);
  canvas.width = width;
  canvas.height = height;
  drawDemoPage(context2d(canvas), spec, width, height);

  const blob = await encodeCanvas(canvas, mime);

  let sha256: string;
  try {
    sha256 = await digest(blob);
  } catch {
    throw new DemoImageError('digest-failed', 'A demo image could not be verified.');
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new DemoImageError('digest-failed', 'A demo image digest was invalid.');
  }

  return {
    kind,
    mime: resolveEncodedMime(blob, mime),
    width,
    height,
    bytes: blob.size,
    sha256,
    blob,
  };
}

/**
 * Generate the four demo pages and their normal original/display/thumbnail
 * derivatives. The function performs no network request and reads no asset.
 */
export async function generateDemoImages(
  options: DemoImageGenerationOptions = {},
): Promise<DemoImageSet[]> {
  const factory = options.createCanvas ?? defaultDemoCanvasFactory;
  const digest = options.digest ?? sha256Hex;
  const mime = options.mime ?? DEMO_PAGE_MIME;

  const originalTarget = computeScaledDimensions(
    DEMO_IMAGE_WIDTH,
    DEMO_IMAGE_HEIGHT,
    ORIGINAL_MAX_EDGE,
  );
  const displayTarget = computeScaledDimensions(
    DEMO_IMAGE_WIDTH,
    DEMO_IMAGE_HEIGHT,
    DISPLAY_MAX_EDGE,
  );
  const thumbnailTarget = computeScaledDimensions(
    DEMO_IMAGE_WIDTH,
    DEMO_IMAGE_HEIGHT,
    THUMBNAIL_MAX_EDGE,
  );

  const images: DemoImageSet[] = [];
  for (const page of DEMO_PAGES) {
    const original = await renderDerivative(
      page,
      'original',
      originalTarget.width,
      originalTarget.height,
      factory,
      digest,
      mime,
    );
    const display = await renderDerivative(
      page,
      'display',
      displayTarget.width,
      displayTarget.height,
      factory,
      digest,
      mime,
    );
    const thumbnail = await renderDerivative(
      page,
      'thumbnail',
      thumbnailTarget.width,
      thumbnailTarget.height,
      factory,
      digest,
      mime,
    );

    images.push({
      pageId: page.id,
      kind: page.kind,
      heading: page.heading,
      original,
      display,
      thumbnail,
    });
  }

  return images;
}
