import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { welcomeSeenStore } from '../features/welcome/welcomeSeen';
import type { WelcomeSeenStore } from '../features/welcome/welcomeSeen';

export interface WelcomeGateProps {
  readonly children: ReactNode;
  /** Injected seen store for tests and composition. */
  readonly seenStore?: WelcomeSeenStore | undefined;
}

/**
 * Sends an unseen first visit from the home route to the welcome screen.
 *
 * The store is read during render rather than cached in state so the Enter
 * action, which marks the flag before navigating, is visible to the gate in
 * the same pass. Other routes are never intercepted: direct links to a case,
 * Settings, or the welcome screen itself keep working.
 */
export default function WelcomeGate({ children, seenStore = welcomeSeenStore }: WelcomeGateProps) {
  const location = useLocation();

  if (location.pathname === '/' && !seenStore.hasSeen()) {
    return <Navigate to="/welcome" replace />;
  }

  return <>{children}</>;
}
