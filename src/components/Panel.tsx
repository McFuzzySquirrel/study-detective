/**
 * The wide-board non-modal panel.
 *
 * A Panel is deliberately not a Dialog: it is a sibling of the board chrome,
 * it never portals, never traps focus, never marks the rest of the app `inert`,
 * and never locks body scroll. It owns four things only:
 *
 * - `role="dialog"` with a labelled heading (no `aria-modal`),
 * - initial focus on the heading (or a requested control),
 * - Escape to close,
 * - outside pointerdown for transient popovers.
 *
 * Focus return is the page's decision when an action moved the student;
 * otherwise the trigger that opened the panel receives focus on close.
 */

import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

import IconButton from './IconButton';

import './Panel.css';

export interface PanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  /** Required accessible name for the close control, e.g. `Close search`. */
  readonly closeLabel: string;
  /** Transient popovers close on an outside pointerdown; inspectors do not. */
  readonly transient?: boolean | undefined;
  /** The control to focus on open. Defaults to the heading. */
  readonly initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  /** The trigger restored on close, and the outside-click exception. */
  readonly returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}

/** True when a modal dialog (body portal) is above the panel and owns Escape. */
function hasModalDialog(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

export default function Panel({
  open,
  onClose,
  title,
  description,
  closeLabel,
  transient = false,
  initialFocusRef,
  returnFocusRef,
  id,
  className,
  children,
}: PanelProps) {
  const generatedId = useId().replace(/:/g, '');
  const titleId = `nd-panel-title-${generatedId}`;
  const descriptionId = `nd-panel-description-${generatedId}`;
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreRequestedRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const panel = panelRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trigger = returnFocusRef?.current ?? null;
    const requested = initialFocusRef?.current ?? null;
    const autofocus = panel?.querySelector<HTMLElement>('[data-panel-autofocus]') ?? null;
    const target = requested ?? autofocus ?? headingRef.current;
    target?.focus();
    restoreRequestedRef.current = false;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || hasModalDialog()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      restoreRequestedRef.current = true;
      onCloseRef.current();
    };

    const handlePointerDown = (event: PointerEvent): void => {
      if (!transient || !(event.target instanceof Node) || panel === null) {
        return;
      }

      if (panel.contains(event.target)) {
        return;
      }

      if (trigger?.contains(event.target) === true) {
        return;
      }

      onCloseRef.current();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    if (transient) {
      document.addEventListener('pointerdown', handlePointerDown, true);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);

      // Only restore when focus is still in the panel (or fell to the body); a
      // page action that deliberately moved focus keeps it.
      const active = document.activeElement;
      const focusWasInside =
        panel === null || active === null || active === document.body || panel.contains(active);

      if (!restoreRequestedRef.current && !focusWasInside) {
        return;
      }

      const returnTarget = trigger ?? previouslyFocused;
      if (returnTarget?.isConnected === true) {
        returnTarget.focus();
      }
    };
  }, [initialFocusRef, open, returnFocusRef, transient]);

  if (!open) {
    return null;
  }

  return (
    <section
      ref={panelRef}
      id={id}
      className={['nd-panel', className].filter(Boolean).join(' ')}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      tabIndex={-1}
    >
      <header className="nd-panel__header">
        <h2 id={titleId} ref={headingRef} className="nd-panel__title" tabIndex={-1}>
          {title}
        </h2>
        <IconButton label={closeLabel} variant="quiet" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </IconButton>
      </header>

      {description === undefined ? null : (
        <p id={descriptionId} className="nd-panel__description">
          {description}
        </p>
      )}

      <div className="nd-panel__body">{children}</div>
    </section>
  );
}
