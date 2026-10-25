import { useSyncExternalStore } from 'react';

function subscribeToConnectivity(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);

  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

/**
 * Non-blocking connectivity notice. It is rendered by the app shell, appears
 * only while the browser reports an offline state, and clears as soon as the
 * browser fires the online event.
 */
export default function OfflineNotice() {
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    getOnlineSnapshot,
    getServerSnapshot,
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
