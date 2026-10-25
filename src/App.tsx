import { HashRouter } from 'react-router';

import AppShell from './app/AppShell';
import AppRoutes from './app/routes';
import UpdatePrompt from './app/UpdatePrompt';

/**
 * Composition root. Hash routing keeps the static GitHub Pages build working
 * without a server rewrite, and the shell owns the frame around every route.
 */
export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <AppRoutes />
      </AppShell>
      <UpdatePrompt />
    </HashRouter>
  );
}
