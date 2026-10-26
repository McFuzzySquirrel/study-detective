import type { CaseRepositoryPort } from '../../data/caseRepository';
import type { NotesDetectiveDatabase } from '../../data/db';
import { toAttachmentRow, toCardRow, toCaseRow, toConnectionRow } from '../../data/mappers';
import type { Clock, IdFactory } from '../../domain/ids';
import { DomainValidationError } from '../../domain/validation';

import type { DemoCanvasFactory, DemoBlobDigest } from './demoImages';
import { generateDemoImages } from './demoImages';
import { buildDemoGraph } from './demoCase';

/**
 * One-time demo seeding.
 *
 * The install-level flag is checked before touching storage, so a student who
 * removes the demo never sees it again. Seeding is only attempted when the
 * database has zero cases; the case, cards, strings, and every attachment Blob
 * then commit in one IndexedDB transaction. A failed write leaves no partial
 * demo and does not set the flag.
 */

export const DEMO_SEED_FLAG_KEY = 'notes-detective.demo.seeded';
const DEMO_SEED_FLAG_VALUE = '1';

export type DemoFlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type DemoSeedFlagStore = {
  isSet(): boolean;
  markSet(): void;
};

function resolveDemoFlagStorage(): DemoFlagStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Wrap install-level storage. The in-memory fallback keeps one page load
 * honest when storage is blocked, but the browser flag remains the durable
 * "never seed again" marker.
 */
export function createDemoSeedFlagStore(
  storage: DemoFlagStorage | null = resolveDemoFlagStorage(),
): DemoSeedFlagStore {
  let memoryFlag = false;

  return {
    isSet() {
      if (memoryFlag) {
        return true;
      }
      if (storage === null) {
        return false;
      }
      try {
        return storage.getItem(DEMO_SEED_FLAG_KEY) === DEMO_SEED_FLAG_VALUE;
      } catch {
        return false;
      }
    },
    markSet() {
      memoryFlag = true;
      if (storage === null) {
        return;
      }
      try {
        storage.setItem(DEMO_SEED_FLAG_KEY, DEMO_SEED_FLAG_VALUE);
      } catch {
        // The in-memory flag still prevents a reseed in this page session.
      }
    },
  };
}

export type DemoSeedSkipReason = 'already-seeded' | 'existing-cases';

export type SeedDemoCaseResult =
  | { readonly seeded: true; readonly reason: 'seeded'; readonly caseId: string }
  | {
      readonly seeded: false;
      readonly reason: DemoSeedSkipReason;
      readonly caseId: null;
    };

export type SeedDemoCaseOptions = {
  readonly db: NotesDetectiveDatabase;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  /** Reuse one store across first-run checks; defaults to localStorage. */
  readonly flagStore?: DemoSeedFlagStore;
  /** Injected by tests; production draws on a real local canvas. */
  readonly createCanvas?: DemoCanvasFactory;
  readonly digest?: DemoBlobDigest;
};

function skip(reason: DemoSeedSkipReason): SeedDemoCaseResult {
  return { seeded: false, reason, caseId: null };
}

/**
 * Seed the demo exactly once. The flag is set even when seeding is skipped for
 * an existing case, which is what makes removal permanent.
 */
export async function seedDemoCase(options: SeedDemoCaseOptions): Promise<SeedDemoCaseResult> {
  const flagStore = options.flagStore ?? createDemoSeedFlagStore();

  if (flagStore.isSet()) {
    return skip('already-seeded');
  }

  if ((await options.db.cases.count()) > 0) {
    flagStore.markSet();
    return skip('existing-cases');
  }

  const images = await generateDemoImages({
    ...(options.createCanvas !== undefined ? { createCanvas: options.createCanvas } : {}),
    ...(options.digest !== undefined ? { digest: options.digest } : {}),
  });
  const graph = buildDemoGraph({
    images,
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.idFactory !== undefined ? { idFactory: options.idFactory } : {}),
  });

  let racedExistingCase = false;

  await options.db.transaction(
    'rw',
    options.db.cases,
    options.db.cards,
    options.db.connections,
    options.db.attachments,
    async () => {
      // Re-check inside the transaction so another tab creating a case first
      // cannot receive a demo inserted beside it.
      if ((await options.db.cases.count()) > 0) {
        racedExistingCase = true;
        return;
      }

      await options.db.cases.add(toCaseRow(graph.caseRecord));
      if (graph.cards.length > 0) {
        await options.db.cards.bulkAdd(graph.cards.map(toCardRow));
      }
      if (graph.connections.length > 0) {
        await options.db.connections.bulkAdd(graph.connections.map(toConnectionRow));
      }
      // Attachments are written last: a duplicate or failing Blob row proves
      // the case, cards, and strings above are rolled back with it.
      if (graph.attachments.length > 0) {
        await options.db.attachments.bulkAdd(graph.attachments.map(toAttachmentRow));
      }
    },
  );

  if (racedExistingCase) {
    flagStore.markSet();
    return skip('existing-cases');
  }

  flagStore.markSet();
  return { seeded: true, reason: 'seeded', caseId: graph.caseRecord.id };
}

export type DemoRemovalRepository = Pick<CaseRepositoryPort, 'getCase' | 'deleteCase'>;

export type RemoveDemoCaseOptions = {
  readonly repository: DemoRemovalRepository;
  readonly caseId: string;
  readonly flagStore?: DemoSeedFlagStore;
};

/**
 * Remove the demo through the normal confirmed cascade. The `isDemo` guard
 * keeps this helper from becoming a second, weaker delete path for a user case;
 * the flag is re-asserted so a lost localStorage value cannot reseed later.
 * Returns false when the case is already gone.
 */
export async function removeDemoCase(options: RemoveDemoCaseOptions): Promise<boolean> {
  const record = await options.repository.getCase(options.caseId);
  if (record === null) {
    return false;
  }
  if (!record.isDemo) {
    throw new DomainValidationError('Refusing to remove a case that is not the demo case');
  }

  const removed = await options.repository.deleteCase(options.caseId);
  if (removed) {
    (options.flagStore ?? createDemoSeedFlagStore()).markSet();
  }
  return removed;
}
