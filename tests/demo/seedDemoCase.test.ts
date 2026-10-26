// @vitest-environment node

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CaseRepository } from '../../src/data/caseRepository';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { fixedClock, sequenceIdFactory } from '../../src/domain/ids';
import { deriveReadiness } from '../../src/domain/readiness';
import { DomainValidationError } from '../../src/domain/validation';
import { DEMO_CASE_TITLE } from '../../src/features/demo/demoCase';
import {
  DEMO_SEED_FLAG_KEY,
  createDemoSeedFlagStore,
  removeDemoCase,
  seedDemoCase,
} from '../../src/features/demo/seedDemoCase';
import type { SeedDemoCaseOptions } from '../../src/features/demo/seedDemoCase';
import { closeTestDatabase, openTestDatabase } from '../data/testDatabase';
import { createMemoryStorage, fakeDemoCanvasHarness } from './demoFixtures';
import type { MemoryStorage } from './demoFixtures';

const INSTANT = '2026-02-03T04:05:06.000Z';

let db: NotesDetectiveDatabase;
let repository: CaseRepository;
let storage: MemoryStorage;

beforeEach(async () => {
  db = await openTestDatabase('demo-seed');
  repository = new CaseRepository(db, { clock: fixedClock(INSTANT) });
  storage = createMemoryStorage();
});

afterEach(async () => {
  await closeTestDatabase(db);
});

function seedOptions(overrides: Partial<SeedDemoCaseOptions> = {}): SeedDemoCaseOptions {
  return {
    db,
    clock: fixedClock(INSTANT),
    flagStore: createDemoSeedFlagStore(storage),
    createCanvas: fakeDemoCanvasHarness().factory,
    ...overrides,
  };
}

async function tableCounts(): Promise<{
  cases: number;
  cards: number;
  connections: number;
  attachments: number;
}> {
  return {
    cases: await db.cases.count(),
    cards: await db.cards.count(),
    connections: await db.connections.count(),
    attachments: await db.attachments.count(),
  };
}

/** 24 valid UUIDs for case, six cards, five strings, and twelve attachments. */
function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

describe('one-time demo seeding', () => {
  it('seeds one labeled, close-ready case with normal attachments', async () => {
    const result = await seedDemoCase(seedOptions());

    expect(result).toMatchObject({ seeded: true, reason: 'seeded' });
    if (!result.seeded) {
      throw new Error('Expected the demo to seed');
    }

    const summaries = await repository.listCaseSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      title: DEMO_CASE_TITLE,
      isDemo: true,
      cardCount: 6,
      connectionCount: 5,
      readiness: 'ready',
      looseThreadCount: 0,
    });

    const caseRecord = await repository.getCase(result.caseId);
    expect(caseRecord?.isDemo).toBe(true);

    const cards = await repository.listCards(result.caseId);
    const connections = await repository.listConnections(result.caseId);
    const readiness = deriveReadiness(cards, connections);
    expect(readiness.ready).toBe(true);
    const topicOne = readiness.topics.find((topic) => topic.card.title === 'Energy in cells');
    const topicTwo = readiness.topics.find((topic) => topic.card.title === 'ATP production');
    expect(topicOne).toMatchObject({ status: 'solved', linkedNoteCount: 2 });
    expect(topicTwo).toMatchObject({ status: 'developing', linkedNoteCount: 1 });

    const imageCards = cards.filter((card) => card.type === 'note' || card.type === 'source');
    expect(imageCards).toHaveLength(4);
    for (const card of imageCards) {
      const attachments = await repository.listAttachments(card.id);
      expect(attachments.map((attachment) => attachment.kind)).toEqual([
        'original',
        'display',
        'thumbnail',
      ]);
      expect(attachments.every((attachment) => attachment.mime === 'image/png')).toBe(true);
      expect(attachments.every((attachment) => attachment.bytes === attachment.blob.size)).toBe(
        true,
      );
      expect(attachments[0]).toMatchObject({ width: 1200, height: 800 });
      expect(attachments[2]).toMatchObject({ width: 320, height: 213 });
    }

    expect(await db.cards.where('caseId').equals(result.caseId).count()).toBe(6);
    expect(await db.connections.where('caseId').equals(result.caseId).count()).toBe(5);
    expect(await db.attachments.count()).toBe(12);
    expect(createDemoSeedFlagStore(storage).isSet()).toBe(true);
    expect(storage.values.get(DEMO_SEED_FLAG_KEY)).toBe('1');
  });

  it('does not seed a second time even when the demo still exists', async () => {
    const first = await seedDemoCase(seedOptions());
    expect(first.seeded).toBe(true);

    const second = await seedDemoCase(seedOptions());

    expect(second).toEqual({ seeded: false, reason: 'already-seeded', caseId: null });
    expect(await repository.listCaseSummaries()).toHaveLength(1);
    expect(await tableCounts()).toEqual({ cases: 1, cards: 6, connections: 5, attachments: 12 });
  });

  it('skips a student who already has a case and still marks the install flag', async () => {
    const userCase = await repository.createCase({ title: 'My own case' });

    const result = await seedDemoCase(seedOptions());

    expect(result).toEqual({ seeded: false, reason: 'existing-cases', caseId: null });
    expect(createDemoSeedFlagStore(storage).isSet()).toBe(true);
    const summaries = await repository.listCaseSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: userCase.id,
      title: 'My own case',
      isDemo: false,
      cardCount: 0,
    });
    expect(await tableCounts()).toEqual({ cases: 1, cards: 0, connections: 0, attachments: 0 });

    // A reload sees the flag and never reconsiders the empty-of-demo install.
    const reload = await seedDemoCase(seedOptions());
    expect(reload).toEqual({ seeded: false, reason: 'already-seeded', caseId: null });
  });
});

describe('demo removal', () => {
  it('removes only the demo, leaves user cases, and never reseeds', async () => {
    const seeded = await seedDemoCase(seedOptions());
    if (!seeded.seeded) {
      throw new Error('Expected the demo to seed');
    }
    const userCase = await repository.createCase({ title: 'My own case' });

    const removed = await removeDemoCase({
      repository,
      caseId: seeded.caseId,
      flagStore: createDemoSeedFlagStore(storage),
    });

    expect(removed).toBe(true);
    expect(await repository.getCase(seeded.caseId)).toBeNull();
    expect(await repository.getCase(userCase.id)).not.toBeNull();
    expect(await tableCounts()).toEqual({ cases: 1, cards: 0, connections: 0, attachments: 0 });

    const reload = await seedDemoCase(seedOptions());
    expect(reload).toEqual({ seeded: false, reason: 'already-seeded', caseId: null });
    expect(await repository.listCaseSummaries()).toHaveLength(1);
  });

  it('refuses to remove a user case through the demo-only path', async () => {
    const userCase = await repository.createCase({ title: 'My own case' });

    await expect(
      removeDemoCase({
        repository,
        caseId: userCase.id,
        flagStore: createDemoSeedFlagStore(storage),
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(await repository.getCase(userCase.id)).not.toBeNull();
  });

  it('returns false when the demo is already gone', async () => {
    await expect(
      removeDemoCase({
        repository,
        caseId: uuid(1),
        flagStore: createDemoSeedFlagStore(storage),
      }),
    ).resolves.toBe(false);
  });
});

describe('seeding atomicity', () => {
  it('rolls back every row and leaves the flag unset when an attachment write fails', async () => {
    const ids = Array.from({ length: 24 }, (_, index) => uuid(index + 1));
    // The second attachment reuses the first attachment's primary key, so the
    // final bulkAdd rejects after the case, cards, and strings were staged.
    ids[13] = ids[12] as string;

    await expect(
      seedDemoCase(
        seedOptions({
          idFactory: sequenceIdFactory(ids),
        }),
      ),
    ).rejects.toBeDefined();

    expect(await tableCounts()).toEqual({ cases: 0, cards: 0, connections: 0, attachments: 0 });
    expect(createDemoSeedFlagStore(storage).isSet()).toBe(false);
  });
});
