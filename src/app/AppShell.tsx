import type { MouseEvent, ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

import { useLayoutMode } from './useLayoutMode';
import KeyboardShortcuts from './KeyboardShortcuts';
import SystemStatus from './SystemStatus';
import './AppShell.css';

interface AppShellProps {
  readonly children: ReactNode;
}

/** `/case/:caseId` is the full-bleed board route; its child routes are not. */
function isBoardRoute(pathname: string): boolean {
  return /^\/case\/[^/]+\/?$/.test(pathname);
}

/**
 * The shared frame every route renders inside: compact top bar, conditional
 * system-status chip, skip link, and the single main landmark.
 *
 * The board route is full-bleed and exactly one viewport tall; every other
 * route keeps the capped, padded reading column. The shell never renders a
 * full-width status strip: offline, update, and browser notices live behind
 * the trailing chip.
 */
export default function AppShell({ children }: AppShellProps) {
  // The shell reports the active breakpoint so tests and screens can prove the
  // phone/tablet/desktop branch without duplicating a second media query.
  const layout = useLayoutMode();
  const location = useLocation();
  const boardRoute = isBoardRoute(location.pathname);

  const handleSkip = (event: MouseEvent<HTMLAnchorElement>): void => {
    // HashRouter owns window.location.hash, so a raw fragment navigation would
    // be read as a route change. Focus the landmark directly instead.
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  };

  return (
    <div
      className="app-frame"
      data-layout={layout}
      data-board-route={boardRoute ? 'true' : 'false'}
      data-testid="app-frame"
    >
      <a className="app-frame__skip-link" href="#main-content" onClick={handleSkip}>
        Skip to content
      </a>

      <header className="app-frame__topbar">
        <h1 className="app-frame__title">Notes Detective</h1>
        <div className="app-frame__topbar-end">
          <nav className="app-frame__nav" aria-label="Primary">
            <NavLink to="/" end>
              Case shelf
            </NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </nav>
          <SystemStatus />
        </div>
      </header>

      <main id="main-content" className="app-frame__content motion-page-transition" tabIndex={-1}>
        {children}
      </main>

      {/* The listener lives in the shell, so shortcuts exist on every route. */}
      <KeyboardShortcuts />
    </div>
  );
}
