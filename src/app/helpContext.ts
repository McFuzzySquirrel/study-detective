import { createContext, useContext } from 'react';

/**
 * The app-level help surface.
 *
 * `openHelp` accepts the trigger that opened it so the dialog can return focus
 * to the real control. The default no-op keeps isolated component tests (for
 * example, a shortcut listener rendered without the app shell) from throwing
 * when no provider is mounted.
 */
export interface HelpApi {
  openHelp(trigger?: HTMLElement | null): void;
}

const unavailableHelp: HelpApi = {
  openHelp: () => undefined,
};

export const HelpContext = createContext<HelpApi>(unavailableHelp);

export function useHelp(): HelpApi {
  return useContext(HelpContext);
}
