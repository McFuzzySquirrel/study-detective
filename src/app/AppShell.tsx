import { useEffect } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

import HelpProvider from './HelpProvider';
import { useHelp } from './helpContext';
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

/** `/welcome` is the first-run landing surface; its primary exit is Enter. */
function isWelcomeRoute(pathname: string): boolean {
  return pathname === '/welcome';
}

function wantsMainFocus(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) {
    return false;
  }

  return (state as { focusMain?: unknown }).focusMain === true;
}

/**
 * The top-bar Help action. It lives inside `HelpProvider`, so it shares the
 * dialog and return-focus behavior with the `?` key and the welcome screen.
 */
function ShellHelpButton() {
  const { openHelp } = useHelp();

  return (
    <button
      type="button"
      className="app-frame__help"
      aria-haspopup="dialog"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        openHelp(event.currentTarget);
      }}
    >
      Help
    </button>
  );
}

/**
 * The shared frame every route renders inside: compact top bar, conditional
 * system-status chip, skip link, and the single main landmark.
 *
 * The board route is full-bleed and exactly one viewport tall; every other
 * route keeps the capped, padded reading column. The shell never renders a
 * full-width status strip: offline, update, and browser notices live behind
 * the trailing chip.
 *
 * On the welcome route the primary navigation is not rendered at all, so a
 * first visit cannot bounce between the landing screen and the redirect gate.
 * Help remains available in the top bar.
 */
export default function AppShell({ children }: AppShellProps) {
  // The shell reports the active breakpoint so tests and screens can prove the
  // phone/tablet/desktop branch without duplicating a second media query.
  const layout = useLayoutMode();
  const location = useLocation();
  const boardRoute = isBoardRoute(location.pathname);
  const welcomeRoute = isWelcomeRoute(location.pathname);

  // Enter on the welcome screen asks the destination route to move focus to
  // the landmark. Without this, the pressed button unmounts and focus falls to
  // the document body.
  useEffect(() => {
    if (wantsMainFocus(location.state)) {
      document.getElementById('main-content')?.focus();
    }
  }, [location.key, location.state]);

  const handleSkip = (event: MouseEvent<HTMLAnchorElement>): void => {
    // HashRouter owns window.location.hash, so a raw fragment navigation would
    // be read as a route change. Focus the landmark directly instead.
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  };

  return (
    <HelpProvider>
      <div
        className="app-frame"
        data-layout={layout}
        data-board-route={boardRoute ? 'true' : 'false'}
        data-welcome-route={welcomeRoute ? 'true' : 'false'}
        data-testid="app-frame"
      >
        <a className="app-frame__skip-link" href="#main-content" onClick={handleSkip}>
          Skip to content
        </a>

        <header className="app-frame__topbar">
          <h1 className="app-frame__title">Notes Detective</h1>
          <div className="app-frame__topbar-end">
            {welcomeRoute ? null : (
              <nav className="app-frame__nav" aria-label="Primary">
                <NavLink to="/" end>
                  Case shelf
                </NavLink>
                <NavLink to="/settings">Settings</NavLink>
              </nav>
            )}
            <ShellHelpButton />
            <SystemStatus />
          </div>
        </header>

        <main id="main-content" className="app-frame__content motion-page-transition" tabIndex={-1}>
          {children}
        </main>

        {/* The listener lives in the shell, so shortcuts exist on every route. */}
        <KeyboardShortcuts />
      </div>
    </HelpProvider>
  );
}
