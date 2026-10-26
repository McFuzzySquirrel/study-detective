/**
 * App-wide keyboard shortcuts and the shortcut reference shown from Settings
 * and from the `?` key.
 *
 * The listener is mounted by `AppShell`, so it is active on every route. It
 * never edits a record: every shortcut either moves focus to a real control or
 * asks the current screen to open its own search surface. Spatial placement,
 * canvas panning, and scratch drawing remain pointer-only and have no shortcut.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import Dialog from '../components/Dialog';
import ShortcutList from '../components/ShortcutList';

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

export interface KeyboardShortcutsProps {
  /** Disable the global listener, for a route that supplies its own mode. */
  readonly enabled?: boolean | undefined;
}

/**
 * Mount once in `AppShell`. It renders no visible chrome until help is opened.
 */
export default function KeyboardShortcuts({ enabled = true }: KeyboardShortcutsProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
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
        returnFocusRef.current = activeFocusElement();
        setHelpOpen(true);
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
  }, [enabled, location.pathname, navigate]);

  return (
    <Dialog
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
      title="Keyboard shortcuts"
      description="These shortcuts work on every route. Spatial placement, canvas panning, and scratch drawing stay pointer-only."
      size="md"
      returnFocusRef={returnFocusRef}
    >
      <ShortcutList />
      <p className="shortcut-list__note">
        Every non-spatial action also has a visible button or link in the card list, card detail,
        search panel, or recall toolbar. Letter, bracket, and slash shortcuts stay inert while you
        type; Escape still closes an overlay or clears search.
      </p>
    </Dialog>
  );
}
