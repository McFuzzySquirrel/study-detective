// @vitest-environment node

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../src/domain/ids';
import type { AttachmentRecord, CardRecord } from '../../src/domain/model';
import { deriveReadiness } from '../../src/domain/readiness';
import { DomainValidationError } from '../../src/domain/validation';
import {
  DEMO_CARD_SPECS,
  DEMO_CASE_SUBJECT,
  DEMO_CASE_TITLE,
  DEMO_CONNECTION_SPECS,
  buildDemoGraph,
} from '../../src/features/demo/demoCase';
import {
  DEMO_IMAGE_HEIGHT,
  DEMO_IMAGE_WIDTH,
  DemoImageError,
  generateDemoImages,
} from '../../src/features/demo/demoImages';
import type { DemoImageSet } from '../../src/features/demo/demoImages';
import {
  ContextlessDemoCanvas,
  LegacyDemoCanvas,
  UnencodableDemoCanvas,
  fakeDemoCanvasHarness,
} from './demoFixtures';

const INSTANT = '2026-02-03T04:05:06.000Z';

async function digest(blob: Blob): Promise<string> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  return createHash('sha256').update(bytes).digest('hex');
}

function requireCard(cards: readonly CardRecord[], title: string): CardRecord {
  const card = cards.find((candidate) => candidate.title === title);
  if (card === undefined) {
    throw new Error(`Expected a card titled "${title}"`);
  }
  return card;
}

function attachmentsFor(
  attachments: readonly AttachmentRecord[],
  card: CardRecord,
): AttachmentRecord[] {
  return attachments.filter((attachment) => attachment.cardId === card.id);
}

async function demoImages(): Promise<DemoImageSet[]> {
  const harness = fakeDemoCanvasHarness();
  return generateDemoImages({ createCanvas: harness.factory });
}

describe('locally generated demo images', () => {
  it('draws two note pages and two source pages at 1200x800', async () => {
    const harness = fakeDemoCanvasHarness();
    const images = await generateDemoImages({ createCanvas: harness.factory });

    expect(images).toHaveLength(4);
    expect(images.map((image) => image.pageId)).toEqual([
      'note-1',
      'note-2',
      'source-1',
      'source-2',
    ]);
    expect(images.map((image) => image.kind)).toEqual(['note', 'note', 'source', 'source']);
    expect(harness.canvases).toHaveLength(12);
    expect(harness.canvases.every((canvas) => canvas.width > 0 && canvas.height > 0)).toBe(true);

    for (const image of images) {
      expect(image.original).toMatchObject({
        kind: 'original',
        mime: 'image/png',
        width: DEMO_IMAGE_WIDTH,
        height: DEMO_IMAGE_HEIGHT,
      });
      expect(image.display).toMatchObject({
        kind: 'display',
        mime: 'image/png',
        width: DEMO_IMAGE_WIDTH,
        height: DEMO_IMAGE_HEIGHT,
      });
      expect(image.thumbnail).toMatchObject({
        kind: 'thumbnail',
        mime: 'image/png',
        width: 320,
        height: 213,
      });
    }

    const headings = harness.canvases.flatMap((canvas) => canvas.context.texts);
    for (const image of images) {
      expect(headings).toContain(image.heading);
      expect(headings).toContain('DEMO PAGE · drawn locally, no third-party content');
    }
  });

  it('stores true byte counts and SHA-256 digests for every derivative', async () => {
    const images = await demoImages();
    const originalDigests = new Set<string>();

    for (const image of images) {
      for (const derivative of [image.original, image.display, image.thumbnail]) {
        expect(derivative.bytes).toBe(derivative.blob.size);
        expect(derivative.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(await digest(derivative.blob)).toBe(derivative.sha256);
      }
      originalDigests.add(image.original.sha256);
    }

    // Each page has its own drawn content, so the four originals differ.
    expect(originalDigests.size).toBe(4);
  });

  it('fails with a local-canvas error instead of falling back to an asset', async () => {
    await expect(generateDemoImages()).rejects.toMatchObject({
      name: 'DemoImageError',
      code: 'canvas-unavailable',
    });
    await expect(generateDemoImages()).rejects.toBeInstanceOf(DemoImageError);
  });

  it('reports digest failures without returning an unverified image', async () => {
    const harness = fakeDemoCanvasHarness();

    await expect(
      generateDemoImages({
        createCanvas: harness.factory,
        digest: async () => {
          throw new Error('subtle crypto unavailable');
        },
      }),
    ).rejects.toMatchObject({ name: 'DemoImageError', code: 'digest-failed' });

    await expect(
      generateDemoImages({
        createCanvas: harness.factory,
        digest: async () => 'not-a-sha256',
      }),
    ).rejects.toMatchObject({ name: 'DemoImageError', code: 'digest-failed' });
  });

  it('supports the HTML canvas toBlob fallback and rejects unusable canvases', async () => {
    const legacyCanvases: LegacyDemoCanvas[] = [];
    const legacy = await generateDemoImages({
      createCanvas: (width, height) => {
        const canvas = new LegacyDemoCanvas(width, height);
        legacyCanvases.push(canvas);
        return canvas;
      },
    });
    expect(legacy).toHaveLength(4);
    expect(legacyCanvases).toHaveLength(12);

    await expect(
      generateDemoImages({
        createCanvas: (width, height) => new UnencodableDemoCanvas(width, height),
      }),
    ).rejects.toMatchObject({ name: 'DemoImageError', code: 'encode-failed' });

    await expect(
      generateDemoImages({
        createCanvas: (width, height) => new ContextlessDemoCanvas(width, height),
      }),
    ).rejects.toMatchObject({ name: 'DemoImageError', code: 'context-unavailable' });
  });
});

describe('demo graph shape and readiness', () => {
  it('builds a close-ready graph with two of each card and five legal strings', async () => {
    const images = await demoImages();
    const graph = buildDemoGraph({
      images,
      clock: fixedClock(INSTANT),
      idFactory: () => crypto.randomUUID(),
    });

    expect(graph.caseRecord.title).toBe(DEMO_CASE_TITLE);
    expect(graph.caseRecord.subject).toBe(DEMO_CASE_SUBJECT);
    expect(graph.caseRecord.isDemo).toBe(true);
    expect(graph.caseRecord.closedAt).toBeNull();
    expect(graph.caseRecord.createdAt).toBe(INSTANT);
    expect(graph.cards).toHaveLength(6);
    expect(graph.cards.filter((card) => card.type === 'note')).toHaveLength(2);
    expect(graph.cards.filter((card) => card.type === 'source')).toHaveLength(2);
    expect(graph.cards.filter((card) => card.type === 'topic')).toHaveLength(2);
    expect(graph.connections).toHaveLength(5);
    expect(graph.connections.filter((connection) => connection.type === 'provenance')).toHaveLength(
      2,
    );
    expect(
      graph.connections.filter((connection) => connection.type === 'association'),
    ).toHaveLength(3);
    expect(new Set(graph.connections.map((connection) => connection.pairKey)).size).toBe(5);

    const cardTitles = new Map(graph.cards.map((card) => [card.id, card.title] as const));
    const pairs = graph.connections
      .map(
        (connection) =>
          `${cardTitles.get(connection.fromCardId)} -> ${cardTitles.get(connection.toCardId)} (${connection.type})`,
      )
      .sort();
    expect(pairs).toEqual(
      [
        'Cellular respiration lecture notes -> Textbook chapter 7 (provenance)',
        'Cellular respiration lecture notes -> Energy in cells (association)',
        'Photosynthesis lecture notes -> ATP production (association)',
        'Photosynthesis lecture notes -> Energy in cells (association)',
        'Photosynthesis lecture notes -> Lecture 4 handout (provenance)',
      ].sort(),
    );

    expect(DEMO_CARD_SPECS).toHaveLength(6);
    expect(DEMO_CONNECTION_SPECS).toHaveLength(5);
  });

  it('derives a ready case with topic 1 solved and topic 2 developing', async () => {
    const graph = buildDemoGraph({
      images: await demoImages(),
      clock: fixedClock(INSTANT),
    });
    const readiness = deriveReadiness(graph.cards, graph.connections);

    expect(readiness.ready).toBe(true);
    expect(readiness.looseThreadCount).toBe(0);
    expect(readiness.looseThreads).toEqual([]);
    expect(readiness.notes.every((note) => note.ready)).toBe(true);
    expect(readiness.notes.every((note) => note.sourceLinkCount >= 1)).toBe(true);
    expect(readiness.notes.every((note) => note.topicLinkCount >= 1)).toBe(true);

    const topicOne = readiness.topics.find((topic) => topic.card.title === 'Energy in cells');
    const topicTwo = readiness.topics.find((topic) => topic.card.title === 'ATP production');
    expect(topicOne).toMatchObject({ status: 'solved', linkedNoteCount: 2, loose: false });
    expect(topicTwo).toMatchObject({ status: 'developing', linkedNoteCount: 1, loose: false });
  });

  it('attaches exactly one original, display, and thumbnail to each note and source', async () => {
    const graph = buildDemoGraph({
      images: await demoImages(),
      clock: fixedClock(INSTANT),
    });

    expect(graph.attachments).toHaveLength(12);

    for (const spec of DEMO_CARD_SPECS) {
      const card = requireCard(graph.cards, spec.title);
      const attachments = attachmentsFor(graph.attachments, card);

      if (spec.pageId === undefined) {
        expect(attachments).toHaveLength(0);
        continue;
      }

      expect(attachments.map((attachment) => attachment.kind).sort()).toEqual([
        'display',
        'original',
        'thumbnail',
      ]);
      for (const attachment of attachments) {
        expect(attachment.mime).toBe('image/png');
        expect(attachment.bytes).toBe(attachment.blob.size);
        expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(attachment.width).toBeGreaterThan(0);
        expect(attachment.height).toBeGreaterThan(0);
      }

      const original = attachments.find((attachment) => attachment.kind === 'original');
      const thumbnail = attachments.find((attachment) => attachment.kind === 'thumbnail');
      expect(original).toMatchObject({
        width: DEMO_IMAGE_WIDTH,
        height: DEMO_IMAGE_HEIGHT,
      });
      expect(thumbnail).toMatchObject({ width: 320, height: 213 });
    }
  });

  it('rejects an incomplete or unknown image set before returning a graph', async () => {
    const images = await demoImages();

    expect(() => buildDemoGraph({ images: images.slice(1) })).toThrow(DomainValidationError);
    expect(() => buildDemoGraph({ images: [...images, images[0] as DemoImageSet] })).toThrow(
      DomainValidationError,
    );
    expect(() =>
      buildDemoGraph({
        images: [
          ...images.slice(0, 3),
          { ...(images[3] as DemoImageSet), pageId: 'topic-1' } as unknown as DemoImageSet,
        ],
      }),
    ).toThrow(DomainValidationError);
  });
});
