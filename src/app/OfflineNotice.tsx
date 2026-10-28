import { useSyncExternalStore } from 'react';

import {
  getOnlineServerSnapshot,
  getOnlineSnapshot,
  subscribeToConnectivity,
} from './connectivity';

/**
 * Non-blocking connectivity notice copy.
 *
 * It appears only while the browser reports an offline state and clears as soon
 * as the browser fires the online event. The shell renders the same copy inside
 * its `System status` dialog; this component remains the standalone form used
 * by older screens and tests.
 */
export default function OfflineNotice() {
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    getOnlineSnapshot,
    getOnlineServerSnapshot,
  );

  if (online) {
    return null;
  }

  return (
    <p className="offline-notice" role="status" aria-live="polite" aria-atomic="true">
      You are offline. Some actions may be unavailable until the connection returns.
    </p>
  );
}
