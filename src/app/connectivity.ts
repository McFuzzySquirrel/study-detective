/**
 * Connectivity subscription shared by the offline notice and the shell's
 * `System status` chip. Keeping the store in one module means both surfaces
 * always agree about the current state without prop drilling.
 */

export function subscribeToConnectivity(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);

  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

export function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

export function getOnlineServerSnapshot(): boolean {
  return true;
}
