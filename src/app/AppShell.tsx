import type { MouseEvent, ReactNode } from 'react';
import { NavLink } from 'react-router';

import OfflineNotice from './OfflineNotice';
import './AppShell.css';

interface AppShellProps {
  readonly children: ReactNode;
  /** Optional storage or persistence state supplied by a feature owner. */
  readonly storageStatus?: ReactNode;
}

/**
 * The shared frame every route renders inside: compact top bar, status slot,
 * skip link, and the single main landmark.
 */
export default function AppShell({ children, storageStatus }: AppShellProps) {
  const handleSkip = (event: MouseEvent<HTMLAnchorElement>): void => {
    // HashRouter owns window.location.hash, so a raw fragment navigation would
    // be read as a route change. Focus the landmark directly instead.
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  };

  return (
    <div className="app-frame">
      <a className="app-frame__skip-link" href="#main-content" onClick={handleSkip}>
        Skip to content
      </a>

      <header className="app-frame__topbar">
        <h1 className="app-frame__title">Notes Detective</h1>
        <nav className="app-frame__nav" aria-label="Primary">
          <NavLink to="/" end>
            Case shelf
          </NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>

      <div className="app-frame__status">
        <OfflineNotice />
        {storageStatus}
      </div>

      <main id="main-content" className="app-frame__content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
