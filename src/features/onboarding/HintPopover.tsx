import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

import Button from '../../components/Button';

import { hintSeenStore } from './hints';
import type { HintId, HintSeenStore } from './hints';

import './hints.css';

export type HintDismissReason = 'got-it' | 'escape' | 'show-me';

export interface HintShowMe {
  /** Defaults to `Show me`. */
  readonly label?: string | undefined;
  /** Focus or reveal the control the hint describes. */
  readonly onShowMe: () => void;
}

export interface HintPopoverProps {
  readonly open: boolean;
  /** Plain-text heading, rendered as a real heading. */
  readonly title: ReactNode;
  /** One sentence of guidance, associated with the dialog. */
  readonly description: ReactNode;
  /** When supplied, dismissing the hint records it in the seen store. */
  readonly hintId?: HintId | undefined;
  /** Overrides the shared seen store, for tests and composed screens. */
  readonly store?: HintSeenStore | undefined;
  /** Optional second action. It hands focus to the relevant control. */
  readonly showMe?: HintShowMe | undefined;
  readonly onDismiss: (reason: HintDismissReason) => void;
  /** Explicit trigger to restore. Defaults to the element focused on open. */
  readonly returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  readonly className?: string | undefined;
}

function focusFallback(): void {
  const target = document.querySelector<HTMLElement>('main') ?? document.querySelector('h1');

  if (!target) {
    return;
  }

  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
  }

  target.focus();
}

/**
 * A small, non-modal hint popover.
 *
 * It is deliberately not a tour: there is no step index, no carousel, no
 * auto-advance timer, and no focus trap. Opening moves focus to the hint so
 * its heading and sentence are announced; Tab continues through the actions
 * and out of the popover. Escape and `Got it` mark the hint seen and restore
 * focus to the trigger. `Show me` marks it seen and leaves focus on the
 * control the caller reveals instead of pulling focus back.
 *
 * Motion is a short entrance in `hints.css`; the reduced-motion media query
 * removes it and keeps the focus and final state.
 */
export default function HintPopover({
  open,
  title,
  description,
  hintId,
  store,
  showMe,
  onDismiss,
  returnFocusRef,
  className,
}: HintPopoverProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTargetRef = useRef<HTMLElement | null>(null);
  const skipRestoreRef = useRef(false);
  const latestRef = useRef({ onDismiss, hintId, store, showMe });
  const dismissRef = useRef<(reason: HintDismissReason) => void>(() => {});

  useEffect(() => {
    latestRef.current = { onDismiss, hintId, store, showMe };
  });

  const dismiss = (reason: HintDismissReason): void => {
    if (reason === 'show-me') {
      skipRestoreRef.current = true;
    }

    const current = latestRef.current;

    if (current.hintId !== undefined) {
      (current.store ?? hintSeenStore).markSeen(current.hintId);
    }

    current.onDismiss(reason);
  };

  useEffect(() => {
    dismissRef.current = dismiss;
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const panel = panelRef.current;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnTarget = returnFocusRef?.current ?? active;
    // The trigger can be reassigned while the hint is open (for example when
    // Reset all closes a replayed hint), so read the live target at cleanup.
    const liveReturnFocus = (): HTMLElement | null =>
      returnFocusRef?.current ?? returnTargetRef.current;

    returnTargetRef.current = returnTarget;
    skipRestoreRef.current = false;
    panel?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dismissRef.current('escape');
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);

      if (skipRestoreRef.current) {
        return;
      }

      const target = liveReturnFocus();

      if (target?.isConnected) {
        target.focus();
      } else {
        focusFallback();
      }
    };
  }, [open, returnFocusRef]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const handleShowMe = (): void => {
    const action = latestRef.current.showMe;

    if (!action) {
      return;
    }

    skipRestoreRef.current = true;
    action.onShowMe();
    dismiss('show-me');
  };

  return createPortal(
    <div className="nd-hint-layer">
      <div
        ref={panelRef}
        className={['nd-hint', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-hint-id={hintId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="nd-hint__title">
          {title}
        </h2>

        <p id={descriptionId} className="nd-hint__body">
          {description}
        </p>

        <div className="nd-hint__actions">
          <Button variant="primary" className="nd-hint__action" onClick={() => dismiss('got-it')}>
            Got it
          </Button>
          {showMe ? (
            <Button variant="secondary" className="nd-hint__action" onClick={handleShowMe}>
              {showMe.label ?? 'Show me'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
