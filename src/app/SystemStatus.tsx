import { useState, useSyncExternalStore } from 'react';

import Dialog from '../components/Dialog';
import { getUpdatePromptState, subscribeToUpdatePrompt } from '../pwa';
import {
  getOnlineServerSnapshot,
  getOnlineSnapshot,
  subscribeToConnectivity,
} from './connectivity';
import BrowserNotice from './BrowserNotice';
import { CORE_API_NOTICES, supportsCoreApis } from './browserSupport';
import type { CoreApiEnvironment } from './browserSupport';
import UpdatePrompt from './UpdatePrompt';

/**
 * The one conditional shell notice.
 *
 * Offline, update-ready, and reduced-browser-support states collapse into a
 * short trailing chip. The full copy and actions live in a modal `System
 * status` dialog, so no notice consumes content height above or below the
 * board and the shell height stays fixed.
 */

export interface SystemStatusProps {
  /** Injected environment for component tests; production reads the globals. */
  readonly environment?: CoreApiEnvironment | undefined;
}

export default function SystemStatus({ environment }: SystemStatusProps = {}) {
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    getOnlineSnapshot,
    getOnlineServerSnapshot,
  );
  const { needRefresh } = useSyncExternalStore(subscribeToUpdatePrompt, getUpdatePromptState);
  const [browserDismissed, setBrowserDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  const support = supportsCoreApis(environment);
  const missing = CORE_API_NOTICES.filter((notice) => support[notice.key] === false);
  const showsBrowser = missing.length > 0 && !browserDismissed;
  const reasons: string[] = [];

  if (!online) {
    reasons.push('offline');
  }
  if (needRefresh) {
    reasons.push('update ready');
  }
  if (showsBrowser) {
    reasons.push('limited support');
  }

  const shortLabel = !online ? 'Offline' : needRefresh ? 'Update ready' : 'Limited support';
  const chipLabel = reasons.length > 1 ? `Status · ${reasons.length}` : shortLabel;
  const accessibleName = `System status: ${reasons.join(', ')}`;

  return (
    <>
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {reasons.length > 0 ? `${accessibleName}.` : ''}
      </span>

      {reasons.length > 0 ? (
        <button
          type="button"
          className="app-frame__status-chip"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={accessibleName}
          onClick={() => setOpen(true)}
        >
          {chipLabel}
        </button>
      ) : null}

      <Dialog
        open={open && reasons.length > 0}
        onClose={() => setOpen(false)}
        title="System status"
        description="Offline use, app updates, and browser support for this device."
        size="md"
        closeLabel="Close system status"
      >
        {!online ? (
          <section className="system-status__section" aria-labelledby="system-status-offline">
            <h3 id="system-status-offline" className="system-status__title">
              Offline
            </h3>
            <p className="system-status__copy">
              You are offline. Some actions may be unavailable until the connection returns. Your
              local case files stay readable.
            </p>
          </section>
        ) : null}

        {needRefresh ? <UpdatePrompt variant="inline" /> : null}

        {showsBrowser ? (
          <BrowserNotice
            {...(environment !== undefined ? { environment } : {})}
            dismissed={browserDismissed}
            onDismiss={() => setBrowserDismissed(true)}
          />
        ) : null}
      </Dialog>
    </>
  );
}
