import type { Clock, IdFactory } from '../../domain/ids';
import { createId, nowIso, systemClock } from '../../domain/ids';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../domain/model';
import type {
  AttachmentRecord,
  CardPosition,
  CardRecord,
  CardType,
  CaseRecord,
  ConnectionRecord,
  ConnectionType,
} from '../../domain/model';
import { DomainValidationError } from '../../domain/validation';
import {
  assertConnectionInCase,
  parseAttachmentRecord,
  parseCardRecord,
  parseCaseRecord,
  parseConnectionRecord,
} from '../../domain/validation';

import type { DemoImageSet, DemoPageId } from './demoImages';
import { DEMO_PAGE_IDS, DEMO_PAGES } from './demoImages';

/**
 * The demo case fixture.
 *
 * The graph is intentionally small and finished: two notes, two sources, two
 * topics, five legal strings, and the local page images. It is ready to close
 * rather than closed so a first-time student can try the closure panel and
 * recall mode themselves. Nothing here is derived state: readiness and topic
 * status come from `deriveReadiness` on every read.
 */

export const DEMO_CASE_TITLE = 'Demo Case: The Missing Lecture';
export const DEMO_CASE_SUBJECT = 'Biology';

export const DEMO_CARD_KEYS = [
  'note-1',
  'note-2',
  'source-1',
  'source-2',
  'topic-1',
  'topic-2',
] as const;
export type DemoCardKey = (typeof DEMO_CARD_KEYS)[number];

export type DemoCardSpec = {
  readonly key: DemoCardKey;
  readonly type: CardType;
  readonly title: string;
  readonly position: CardPosition;
  readonly tags: readonly string[];
  /** Notes and sources own a generated page; topics do not. */
  readonly pageId?: DemoPageId;
};

export const DEMO_CARD_SPECS: readonly DemoCardSpec[] = Object.freeze([
  {
    key: 'note-1',
    type: 'note',
    title: 'Photosynthesis lecture notes',
    position: { x: 120, y: 120 },
    tags: ['photosynthesis', 'energy'],
    pageId: 'note-1',
  },
  {
    key: 'note-2',
    type: 'note',
    title: 'Cellular respiration lecture notes',
    position: { x: 120, y: 520 },
    tags: ['respiration', 'energy'],
    pageId: 'note-2',
  },
  {
    key: 'source-1',
    type: 'source',
    title: 'Lecture 4 handout',
    position: { x: 760, y: 120 },
    tags: ['lecture', 'energy'],
    pageId: 'source-1',
  },
  {
    key: 'source-2',
    type: 'source',
    title: 'Textbook chapter 7',
    position: { x: 760, y: 520 },
    tags: ['textbook', 'respiration'],
    pageId: 'source-2',
  },
  {
    key: 'topic-1',
    type: 'topic',
    title: 'Energy in cells',
    position: { x: 440, y: 260 },
    tags: ['energy'],
  },
  {
    key: 'topic-2',
    type: 'topic',
    title: 'ATP production',
    position: { x: 440, y: 680 },
    tags: ['atp'],
  },
]);

export type DemoConnectionSpec = {
  readonly from: DemoCardKey;
  readonly to: DemoCardKey;
  readonly type: ConnectionType;
};

/**
 * Five strings: each note cites its own source, both notes feed topic 1, and
 * topic 2 receives one note. Topic 1 is therefore solved (two linked notes) and
 * topic 2 is developing (one linked note).
 */
export const DEMO_CONNECTION_SPECS: readonly DemoConnectionSpec[] = Object.freeze([
  { from: 'note-1', to: 'source-1', type: 'provenance' },
  { from: 'note-2', to: 'source-2', type: 'provenance' },
  { from: 'note-1', to: 'topic-1', type: 'association' },
  { from: 'note-2', to: 'topic-1', type: 'association' },
  { from: 'note-1', to: 'topic-2', type: 'association' },
]);

export type BuildDemoGraphOptions = {
  readonly images: readonly DemoImageSet[];
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
};

export type DemoGraph = {
  readonly caseRecord: CaseRecord;
  readonly cards: readonly CardRecord[];
  readonly connections: readonly ConnectionRecord[];
  readonly attachments: readonly AttachmentRecord[];
};

function requireCardId(cardIds: ReadonlyMap<DemoCardKey, string>, key: DemoCardKey): string {
  const id = cardIds.get(key);
  if (id === undefined) {
    throw new DomainValidationError(`The demo graph has no card for "${key}"`);
  }
  return id;
}

function assertImages(images: readonly DemoImageSet[]): void {
  const expectedPages = new Set<DemoPageId>(DEMO_PAGE_IDS);
  const seen = new Set<DemoPageId>();

  for (const image of images) {
    if (!expectedPages.has(image.pageId)) {
      throw new DomainValidationError(`The demo image "${image.pageId}" has no card`);
    }
    if (seen.has(image.pageId)) {
      throw new DomainValidationError(`The demo image "${image.pageId}" was supplied twice`);
    }
    seen.add(image.pageId);
  }

  const missing = DEMO_PAGE_IDS.filter((pageId) => !seen.has(pageId));
  if (missing.length > 0) {
    throw new DomainValidationError(`The demo graph is missing images for ${missing.join(', ')}`);
  }
}

/**
 * Build and validate the complete demo graph from freshly allocated IDs. The
 * caller supplies the generated images so the pure graph shape can be tested
 * without a browser canvas.
 */
export function buildDemoGraph(options: BuildDemoGraphOptions): DemoGraph {
  const clock = options.clock ?? systemClock;
  const idFactory = options.idFactory ?? createId;
  const now = nowIso(clock);

  assertImages(options.images);

  const caseRecord = parseCaseRecord({
    id: idFactory(),
    title: DEMO_CASE_TITLE,
    subject: DEMO_CASE_SUBJECT,
    createdAt: now,
    updatedAt: now,
    viewport: DEFAULT_VIEWPORT,
    closedAt: null,
    isDemo: true,
    backupPromptedAt: null,
  });

  const cardIds = new Map<DemoCardKey, string>();
  const cards = DEMO_CARD_SPECS.map((spec) => {
    const id = idFactory();
    cardIds.set(spec.key, id);
    return parseCardRecord({
      id,
      caseId: caseRecord.id,
      type: spec.type,
      title: spec.title,
      position: spec.position,
      tags: [...spec.tags],
      createdAt: now,
      updatedAt: now,
    });
  });

  const pages = new Map(DEMO_PAGES.map((page) => [page.id, page] as const));
  const pairKeys = new Set<string>();
  const connections = DEMO_CONNECTION_SPECS.map((spec) => {
    const fromCardId = requireCardId(cardIds, spec.from);
    const toCardId = requireCardId(cardIds, spec.to);
    const pairKey = buildPairKey(fromCardId, toCardId);
    if (pairKeys.has(pairKey)) {
      throw new DomainValidationError('The demo graph contains the same card pair twice');
    }
    pairKeys.add(pairKey);

    const connection = parseConnectionRecord({
      id: idFactory(),
      caseId: caseRecord.id,
      fromCardId,
      toCardId,
      pairKey,
      type: spec.type,
    });
    assertConnectionInCase(connection, cards);
    return connection;
  });

  const cardKeysByPage = new Map<DemoPageId, DemoCardKey>();
  for (const spec of DEMO_CARD_SPECS) {
    if (spec.pageId !== undefined) {
      cardKeysByPage.set(spec.pageId, spec.key);
    }
  }

  const attachments: AttachmentRecord[] = [];
  for (const image of options.images) {
    const page = pages.get(image.pageId);
    const cardKey = cardKeysByPage.get(image.pageId);
    if (page === undefined || cardKey === undefined) {
      throw new DomainValidationError(`The demo image "${image.pageId}" has no card`);
    }

    const cardId = requireCardId(cardIds, cardKey);
    for (const derivative of [image.original, image.display, image.thumbnail]) {
      attachments.push(
        parseAttachmentRecord({
          id: idFactory(),
          cardId,
          kind: derivative.kind,
          mime: derivative.mime,
          width: derivative.width,
          height: derivative.height,
          bytes: derivative.bytes,
          sha256: derivative.sha256,
          blob: derivative.blob,
        }),
      );
    }
  }

  // Every note and source must end up with exactly one original, display, and
  // thumbnail. A malformed image set must fail here rather than produce a card
  // that the board renders without a usable page.
  for (const spec of DEMO_CARD_SPECS) {
    if (spec.pageId === undefined) {
      continue;
    }
    const cardId = requireCardId(cardIds, spec.key);
    const kinds = attachments
      .filter((attachment) => attachment.cardId === cardId)
      .map((attachment) => attachment.kind)
      .sort();
    if (kinds.join(',') !== 'display,original,thumbnail') {
      throw new DomainValidationError(`The demo card "${spec.title}" has an incomplete image set`);
    }
  }

  return { caseRecord, cards, connections, attachments };
}
