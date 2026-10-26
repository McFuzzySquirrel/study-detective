// @vitest-environment node

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CaseRepository } from '../../src/data/caseRepository';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { fixedClock } from '../../src/domain/ids';
import { DEMO_CASE_TITLE } from '../../src/features/demo/demoCase';
import { createDemoSeedFlagStore, seedDemoCase } from '../../src/features/demo/seedDemoCase';
import { buildCaseArchive } from '../../src/features/backup/exportCase';
import type { CaseArchive } from '../../src/features/backup/exportCase';
import { importCase } from '../../src/features/backup/importCase';
import { closeTestDatabase, openTestDatabase } from '../data/testDatabase';
import { createMemoryStorage, fakeDemoCanvasHarness } from './demoFixtures';

const SEED_INSTANT = '2026-02-03T04:05:06.000Z';
const EXPORT_INSTANT = '2026-06-12T09:30:00.000Z';

let sourceDb: NotesDetectiveDatabase;
let targetDb: NotesDetectiveDatabase;
let sourceRepository: CaseRepository;
let targetRepository: CaseRepository;

beforeEach(async () => {
  sourceDb = await openTestDatabase('demo-backup-source');
  targetDb = await openTestDatabase('demo-backup-target');
  sourceRepository = new CaseRepository(sourceDb, { clock: fixedClock(SEED_INSTANT) });
  targetRepository = new CaseRepository(targetDb, { clock: fixedClock(SEED_INSTANT) });
});

afterEach(async () => {
  await closeTestDatabase(sourceDb);
  await closeTestDatabase(targetDb);
});

async function seedAndExport(): Promise<{
  caseId: string;
  archive: CaseArchive;
}> {
  const storage = createMemoryStorage();
  const seeded = await seedDemoCase({
    db: sourceDb,
    clock: fixedClock(SEED_INSTANT),
    flagStore: createDemoSeedFlagStore(storage),
    createCanvas: fakeDemoCanvasHarness().factory,
  });
  if (!seeded.seeded) {
    throw new Error('Expected the demo to seed');
  }

  const archive = await buildCaseArchive({
    caseId: seeded.caseId,
    repository: sourceRepository,
    clock: fixedClock(EXPORT_INSTANT),
  });

  return { caseId: seeded.caseId, archive };
}

describe('demo marker through backup', () => {
  it('writes isDemo into the manifest and restores it as a labeled demo', async () => {
    const { caseId, archive } = await seedAndExport();

    expect(archive.manifest.case.isDemo).toBe(true);
    expect(archive.manifest.case.title).toBe(DEMO_CASE_TITLE);
    expect(archive.manifest.cards).toHaveLength(6);
    expect(archive.manifest.connections).toHaveLength(5);
    expect(archive.manifest.attachments).toHaveLength(12);

    const restored = await importCase(archive.bytes, { db: targetDb });

    expect(restored.mode).toBe('copy');
    expect(restored.caseId).not.toBe(caseId);
    expect(restored).toMatchObject({
      title: DEMO_CASE_TITLE,
      cardCount: 6,
      connectionCount: 5,
      attachmentCount: 12,
    });

    const restoredCase = await targetRepository.getCase(restored.caseId);
    expect(restoredCase?.isDemo).toBe(true);
    expect(restoredCase?.closedAt).toBeNull();

    const summaries = await targetRepository.listCaseSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      title: DEMO_CASE_TITLE,
      isDemo: true,
      readiness: 'ready',
      cardCount: 6,
      connectionCount: 5,
    });

    const cards = await targetRepository.listCards(restored.caseId);
    expect(cards).toHaveLength(6);
    const imageCards = cards.filter((card) => card.type === 'note' || card.type === 'source');
    for (const card of imageCards) {
      expect(await targetRepository.listAttachments(card.id)).toHaveLength(3);
    }

    // Re-export the restored case: the marker is durable storage, not a
    // one-time import decoration.
    const reexported = await buildCaseArchive({
      caseId: restored.caseId,
      repository: targetRepository,
      clock: fixedClock(EXPORT_INSTANT),
    });
    expect(reexported.manifest.case.isDemo).toBe(true);
  });
});
