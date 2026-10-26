/**
 * First-run bootstrap.
 *
 * The demo case is seeded before the routed screens mount, because the shelf
 * reads its case list exactly once on mount. Waiting here is the only way a
 * fresh install can open onto a demo that is already part of that read.
 *
 * The bootstrap is deliberately quiet and non-modal:
 *
 * - It renders a small live status inside the normal app frame; it never
 *   replaces the shell with a blocking splash.
 * - A failed seed is swallowed. The shelf still renders and its own recoverable
 *   database error is the only error the student needs to act on.
 * - The seed promise is shared across React's strict-mode effect replay, so one
 *   install never attempts two seeds.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { SeedDemoCaseResult } from '../features/demo/seedDemoCase';

export type FirstRunSeed = () => Promise<SeedDemoCaseResult>;

/**
 * A stopped database upgrade or an unusually slow canvas must not leave the
 * student on the preparation line forever. After this grace period the app
 * opens with whatever the repository can currently read.
 */
export const BOOTSTRAP_MAX_WAIT_MS = 5_000;

/**
 * Production seeding. Both the database and the demo generator are loaded on
 * demand so the image pipeline and demo fixture stay out of the initial shell
 * chunk.
 */
async function seedFirstRunDemo(): Promise<SeedDemoCaseResult> {
  const [{ openNotesDetectiveDatabase }, { seedDemoCase }] = await Promise.all([
    import('../data/db'),
    import('../features/demo/seedDemoCase'),
  ]);
  const database = await openNotesDetectiveDatabase();

  try {
    return await seedDemoCase({ db: database });
  } finally {
    database.close();
  }
}

export interface AppBootstrapProps {
  readonly children: ReactNode;
  /**
   * Injected first-run seed for component tests and composition. Production
   * resolves the real demo seeder from `seedFirstRunDemo`.
   */
  readonly seedFirstRun?: FirstRunSeed | undefined;
}

function runSeed(seed: FirstRunSeed): Promise<SeedDemoCaseResult> {
  try {
    return seed();
  } catch {
    // A synchronous throw must not leave the app on the status line forever.
    return Promise.reject(new Error('The first-run seed could not start.'));
  }
}

/**
 * Mount the first-run seed once, then render the route tree.
 *
 * The promise is cached per seed function, not per effect, so StrictMode's
 * mount/unmount replay joins the same operation instead of starting a second
 * one. A rejection and an already-seeded result both open the app normally.
 */
export default function AppBootstrap({
  children,
  seedFirstRun = seedFirstRunDemo,
}: AppBootstrapProps) {
  const [ready, setReady] = useState(false);
  const seedRef = useRef<FirstRunSeed>(seedFirstRun);
  const promiseRef = useRef<Promise<SeedDemoCaseResult> | null>(null);

  useEffect(() => {
    if (seedRef.current !== seedFirstRun) {
      seedRef.current = seedFirstRun;
      promiseRef.current = null;
    }

    let cancelled = false;
    const promise = promiseRef.current ?? runSeed(seedFirstRun);
    promiseRef.current = promise;

    const settle = (): void => {
      if (!cancelled) {
        setReady(true);
      }
    };

    const timer = window.setTimeout(settle, BOOTSTRAP_MAX_WAIT_MS);
    void promise.then(settle, settle);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [seedFirstRun]);

  if (!ready) {
    return (
      <p className="route-loading" role="status" aria-live="polite" data-bootstrap-status="seeding">
        Preparing your case files…
      </p>
    );
  }

  return <>{children}</>;
}
