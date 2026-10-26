import { HashRouter } from 'react-router';

import AppBootstrap from './AppBootstrap';
import type { FirstRunSeed } from './AppBootstrap';
import AppShell from './AppShell';
import BrowserNotice from './BrowserNotice';
import AppRoutes from './routes';
import UpdatePrompt from './UpdatePrompt';

export interface AppProps {
  /** Injected first-run seed for tests; production uses the real demo seeder. */
  readonly seedFirstRun?: FirstRunSeed | undefined;
}

/**
 * Composition root. Hash routing keeps the static GitHub Pages build working
 * without a server rewrite, and the shell owns the frame around every route.
 * The first-run seed resolves before routes mount so the shelf's single case
 * read already includes the demo, while the shell and its navigation stay
 * usable throughout.
 */
export default function App({ seedFirstRun }: AppProps = {}) {
  return (
    <HashRouter>
      {/*
        The shell's status slot is the shared non-blocking banner area. Browser
        capability notices sit beside the offline notice and never gate routes.
      */}
      <AppShell storageStatus={<BrowserNotice />}>
        <AppBootstrap {...(seedFirstRun !== undefined ? { seedFirstRun } : {})}>
          <AppRoutes />
        </AppBootstrap>
      </AppShell>
      <UpdatePrompt />
    </HashRouter>
  );
}
