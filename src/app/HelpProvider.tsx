import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { HelpContext } from './helpContext';
import type { HelpApi } from './helpContext';
import HelpDialog from './HelpDialog';

export interface HelpProviderProps {
  readonly children: ReactNode;
}

/**
 * Hosts the single help dialog and exposes `openHelp` to the shell, the `?`
 * shortcuts listener, and the welcome screen.
 *
 * The trigger is captured at open time and read again at close time, so focus
 * returns to whichever control actually opened the dialog.
 */
export default function HelpProvider({ children }: HelpProviderProps) {
  const [open, setOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();

  const openHelp = useCallback((trigger?: HTMLElement | null) => {
    const active =
      typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)
        ? null
        : document.activeElement;

    returnFocusRef.current = trigger ?? active;
    setOpen(true);
  }, []);

  const closeHelp = useCallback(() => {
    setOpen(false);
  }, []);

  const showWelcome = useCallback(() => {
    setOpen(false);
    navigate('/welcome');
  }, [navigate]);

  const api = useMemo<HelpApi>(() => ({ openHelp }), [openHelp]);

  return (
    <HelpContext.Provider value={api}>
      {children}
      <HelpDialog
        open={open}
        onClose={closeHelp}
        onShowWelcome={showWelcome}
        returnFocusRef={returnFocusRef}
      />
    </HelpContext.Provider>
  );
}
