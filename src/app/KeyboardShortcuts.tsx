/**
 * App-wide keyboard shortcuts.
 *
 * The listener is mounted inside the app shell, so it is active on every
 * route. It never edits a record: every shortcut either moves focus to a real
 * control or asks the current screen to open its own search surface. Spatial
 * placement, canvas panning, and scratch drawing remain pointer-only and have
 * no shortcut.
 *
 * The `?` key opens the shared help dialog from `HelpProvider`; this module
 * owns only the key handling so the top-bar Help button, the welcome screen,
 * and the keyboard all teach the same model.
 */

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

import {
  DISMISS_EVENT,
  FOCUS_SEARCH_EVENT,
  activeFocusElement,
  connectFocusedCard,
  focusSearchField,
  hasOpenDialog,
  isEditableElement,
  moveCardListFocus,
} from './focus';
import { useHelp } from './helpContext';

export interface KeyboardShortcutsProps {
  /** Disable the global listener, for a route that supplies its own mode. */
  readonly enabled?: boolean | undefined;
}

/**
 * Mount once in `AppShell`. It renders no visible chrome; the help dialog is
 * rendered by `HelpProvider`.
 */
export default function KeyboardShortcuts({ enabled = true }: KeyboardShortcutsProps) {
  const { openHelp } = useHelp();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      // A dialog or sheet owns the keyboard while it is open. Escape closes it
      // through the Dialog primitive, not through this global listener.
      if (hasOpenDialog()) {
        return;
      }

      // Browser and operating-system shortcuts always win.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key === 'Escape') {
        // Clearing search is safe while the field itself is focused; every
        // other shortcut is suppressed for editable targets below.
        window.dispatchEvent(new Event(DISMISS_EVENT));
        return;
      }

      if (isEditableElement(event.target)) {
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        openHelp(activeFocusElement());
        return;
      }

      if (event.key === '/') {
        event.preventDefault();

        if (focusSearchField()) {
          return;
        }

        // A phone board has no mounted search panel until its sheet opens.
        window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));

        // Card detail and capture have no search panel at all. Send the student
        // to the keyboard card list's search field rather than doing nothing.
        const caseRoute = /^\/case\/([^/]+)\/(?:card\/[^/]+|capture)$/.exec(location.pathname);
        if (caseRoute?.[1] !== undefined) {
          navigate(`/case/${encodeURIComponent(caseRoute[1])}/list?focus=search`);
        }
        return;
      }

      if (event.key === '[') {
        if (moveCardListFocus('previous') !== null) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === ']') {
        if (moveCardListFocus('next') !== null) {
          event.preventDefault();
        }
        return;
      }

      if (event.key.toLowerCase() === 'c' && !event.shiftKey) {
        if (connectFocusedCard()) {
          event.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, location.pathname, navigate, openHelp]);

  return null;
}
