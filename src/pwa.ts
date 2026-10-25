import { registerSW } from 'virtual:pwa-register';

export interface UpdatePromptState {
  readonly needRefresh: boolean;
  readonly blockedByUnsavedChanges: boolean;
}

type UpdatePromptListener = () => void;
type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

let updateServiceWorker: UpdateServiceWorker | null = null;
let registrationStarted = false;
let needRefresh = false;
let unsavedChanges = false;
let snapshot: UpdatePromptState = Object.freeze({
  needRefresh: false,
  blockedByUnsavedChanges: false,
});

const listeners = new Set<UpdatePromptListener>();

function publish(): void {
  snapshot = Object.freeze({
    needRefresh,
    blockedByUnsavedChanges: needRefresh && unsavedChanges,
  });

  for (const listener of listeners) {
    listener();
  }
}

/**
 * Registers the generated service worker in prompt mode. The waiting worker is
 * never activated here: only `confirmUpdate()` may activate it, and only after
 * the student asks for the refresh.
 */
export function registerPwa(): void {
  if (registrationStarted) {
    return;
  }

  registrationStarted = true;

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      publish();
    },
    onOfflineReady() {
      // Offline readiness is verified by the release PWA journey, not claimed
      // by the shell on the first load.
    },
    onRegisterError() {
      // A failed registration must leave the app usable. No error details or
      // user content are logged or surfaced.
    },
  });
}

/** Marks whether a form currently holds unsaved edits. */
export function setUnsavedChanges(value: boolean): void {
  if (unsavedChanges === value) {
    return;
  }

  unsavedChanges = value;
  publish();
}

export function hasUnsavedChanges(): boolean {
  return unsavedChanges;
}

export function subscribeToUpdatePrompt(listener: UpdatePromptListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getUpdatePromptState(): UpdatePromptState {
  return snapshot;
}

export function dismissUpdate(): void {
  if (!needRefresh) {
    return;
  }

  needRefresh = false;
  publish();
}

/**
 * Activates the waiting service worker only after an explicit confirmation and
 * only while no edit is unsaved.
 */
export async function confirmUpdate(): Promise<boolean> {
  if (!needRefresh || unsavedChanges || updateServiceWorker === null) {
    return false;
  }

  try {
    await updateServiceWorker(true);
    needRefresh = false;
    publish();
    return true;
  } catch {
    // Keep the prompt available when activation fails.
    return false;
  }
}
