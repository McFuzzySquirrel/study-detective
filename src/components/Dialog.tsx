import { useEffect, useId, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

import IconButton from './IconButton';
import './components.css';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !element.closest('[hidden]'),
  );
}

function focusFallback(): void {
  const main = document.querySelector<HTMLElement>('main');
  const heading = document.querySelector<HTMLElement>('h1');
  const target = main ?? heading;

  if (!target) {
    return;
  }

  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
  }

  target.focus();
}

export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Rendered as the dialog heading; always plain text or React nodes. */
  readonly title: ReactNode;
  /** Optional consequence or instruction, wired to `aria-describedby`. */
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  /** Footer buttons. They sit in the focus trap after the body content. */
  readonly actions?: ReactNode;
  readonly size?: DialogSize;
  /**
   * When false the header close control and the backdrop are inert. Escape
   * still cancels, because cancelling a destructive prompt is always safe.
   */
  readonly dismissible?: boolean;
  readonly closeOnBackdrop?: boolean;
  readonly closeLabel?: string;
  /** Overrides the first-focus target. `data-autofocus` wins over the default. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** Overrides the element that receives focus after the dialog closes. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly className?: string;
}

/**
 * Modal dialog built on a portal at the document body.
 *
 * Contract: `role="dialog"` + `aria-modal`, labelled by its title, initial
 * focus on the first input/primary action (never the close control), Tab and
 * Shift+Tab cycle inside while open, Escape cancels, and focus returns to the
 * trigger on close or unmount. The rest of the app is `inert` and the page
 * cannot scroll underneath.
 */
export default function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  size = 'md',
  dismissible = true,
  closeOnBackdrop = true,
  closeLabel = 'Close dialog',
  initialFocusRef,
  returnFocusRef,
  className,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const panel = panelRef.current;
    const overlay = overlayRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const explicitReturn = returnFocusRef?.current ?? null;
    const inertedSiblings: HTMLElement[] = [];
    const previousOverflow = document.body.style.overflow;

    if (overlay) {
      Array.from(document.body.children).forEach((child) => {
        if (child !== overlay && child instanceof HTMLElement && !child.hasAttribute('inert')) {
          child.setAttribute('inert', '');
          inertedSiblings.push(child);
        }
      });
    }

    document.body.style.overflow = 'hidden';

    const focusFirstMatch = (container: Element | null): HTMLElement | undefined =>
      getFocusable(container instanceof HTMLElement ? container : null)[0];

    const body = panel?.querySelector<HTMLElement>('.nd-dialog__body') ?? null;
    const actionArea = panel?.querySelector<HTMLElement>('.nd-dialog__actions') ?? null;
    const firstInput =
      body?.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
      ) ?? null;
    const initialTarget =
      initialFocusRef?.current ??
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      firstInput ??
      focusFirstMatch(body) ??
      focusFirstMatch(actionArea) ??
      panel;

    initialTarget?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !panel) {
        return;
      }

      const focusable = getFocusable(panel);

      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!first || !last) {
        return;
      }

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent): void => {
      if (!panel) {
        return;
      }

      if (event.target instanceof Node && !panel.contains(event.target)) {
        (getFocusable(panel)[0] ?? panel).focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);

      inertedSiblings.forEach((element) => element.removeAttribute('inert'));
      document.body.style.overflow = previousOverflow;

      const explicitReturnElement = explicitReturn;
      const target =
        explicitReturnElement ?? (previouslyFocused?.isConnected ? previouslyFocused : null);

      if (target) {
        target.focus();
      } else {
        focusFallback();
      }
    };
  }, [open, initialFocusRef, returnFocusRef]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const handleBackdrop = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (closeOnBackdrop && dismissible && event.target === event.currentTarget) {
      onCloseRef.current();
    }
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="nd-dialog"
      data-testid="dialog-backdrop"
      onClick={handleBackdrop}
    >
      <div
        ref={panelRef}
        className={['nd-dialog__panel', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-size={size}
        tabIndex={-1}
      >
        <div className="nd-dialog__header">
          <h2 id={titleId} className="nd-dialog__title">
            {title}
          </h2>
          {dismissible ? (
            <IconButton label={closeLabel} variant="quiet" onClick={() => onCloseRef.current()}>
              <span aria-hidden="true">×</span>
            </IconButton>
          ) : null}
        </div>

        {description ? (
          <p id={descriptionId} className="nd-dialog__description">
            {description}
          </p>
        ) : null}

        <div className="nd-dialog__body">{children}</div>

        {actions ? <div className="nd-dialog__actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
