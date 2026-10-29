import { HashRouter } from 'react-router';

import type { WelcomeSeenStore } from '../features/welcome/welcomeSeen';
import AppBootstrap from './AppBootstrap';
import type { FirstRunSeed } from './AppBootstrap';
import AppShell from './AppShell';
import WelcomeGate from './WelcomeGate';
import AppRoutes from './routes';

export interface AppProps {
  /** Injected first-run seed for tests; production uses the real demo seeder. */
  readonly seedFirstRun?: FirstRunSeed | undefined;
  /** Injected welcome flag store for tests; production uses localStorage. */
  readonly welcomeSeenStore?: WelcomeSeenStore | undefined;
}

/**
 * Composition root. Hash routing keeps the static GitHub Pages build working
 * without a server rewrite, and the shell owns the frame around every route.
 * The first-run seed resolves before routes mount so the shelf's single case
 * read already includes the demo, while the shell and its navigation stay
 * usable throughout.
 *
 * An unseen first visit is redirected to the welcome screen before the shell
 * mounts. The demo seed then runs behind the welcome, so Enter opens an
 * already-prepared shelf.
 *
 * Offline, update, and browser-support notices are owned by the shell's
 * `System status` chip, so the root renders no floating status surfaces.
 */
export default function App({ seedFirstRun, welcomeSeenStore }: AppProps = {}) {
  return (
    <HashRouter>
      <WelcomeGate {...(welcomeSeenStore !== undefined ? { seenStore: welcomeSeenStore } : {})}>
        <AppShell>
          <AppBootstrap {...(seedFirstRun !== undefined ? { seedFirstRun } : {})}>
            <AppRoutes {...(welcomeSeenStore !== undefined ? { welcomeSeenStore } : {})} />
          </AppBootstrap>
        </AppShell>
      </WelcomeGate>
    </HashRouter>
  );
}
