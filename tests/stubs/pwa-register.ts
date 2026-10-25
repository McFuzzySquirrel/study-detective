import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

let options: RegisterSWOptions | undefined;
let updateCalls: Array<boolean | undefined> = [];

/**
 * Test double for the service worker registration module provided by
 * vite-plugin-pwa. Individual tests trigger the waiting-worker callback.
 */
export function registerSW(
  nextOptions?: RegisterSWOptions,
): (reloadPage?: boolean) => Promise<void> {
  options = nextOptions;

  return async (reloadPage?: boolean) => {
    updateCalls.push(reloadPage);
  };
}

export function __triggerNeedRefresh(): void {
  options?.onNeedRefresh?.();
}

export function __triggerOfflineReady(): void {
  options?.onOfflineReady?.();
}

export function __getUpdateCalls(): Array<boolean | undefined> {
  return [...updateCalls];
}

export function __clearUpdateCalls(): void {
  updateCalls = [];
}

export function __resetPwaStub(): void {
  options = undefined;
  updateCalls = [];
}
