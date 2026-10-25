import type { ReactNode } from 'react';

import Button from './Button';
import IconButton from './IconButton';
import './components.css';

export type ToastTone = 'info' | 'success' | 'error';

const TONE_LABELS: Record<ToastTone, string> = {
  info: 'Notice',
  success: 'Success',
  error: 'Error',
};

export interface ToastProps {
  /**
   * The announcement. Keep the Toast mounted with `message={null}` between
   * announcements so the polite live region is already in the accessibility
   * tree when the text changes.
   */
  readonly message: ReactNode | null;
  readonly tone?: ToastTone;
  /** Optional action, such as Undo. Requires `onAction`. */
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  /** Optional dismiss control. Undo/error feedback should outlive focus travel. */
  readonly onDismiss?: () => void;
  readonly dismissLabel?: string;
}

function hasMessage(message: ReactNode | null): boolean {
  return message !== null && message !== undefined && message !== false && message !== '';
}

/**
 * Polite live-region toast. It never moves focus: the message is announced and
 * the action (for example an 8-second undo) remains reachable with Tab. Timers
 * belong to the feature that owns the action, not to this primitive.
 *
 * `aria-live` is always polite per the design contract, including error tone;
 * the tone is also exposed as text so color is never the only signal.
 */
export default function Toast({
  message,
  tone = 'info',
  actionLabel,
  onAction,
  onDismiss,
  dismissLabel = 'Dismiss message',
}: ToastProps) {
  const showMessage = hasMessage(message);
  const showAction = showMessage && actionLabel !== undefined && onAction !== undefined;

  return (
    <div className="nd-toast-region" role="status" aria-live="polite" aria-atomic="true">
      {showMessage ? (
        <div className="nd-toast" data-tone={tone}>
          <p className="nd-toast__message">
            <span className="visually-hidden">{TONE_LABELS[tone]}: </span>
            {message}
          </p>
          {showAction || onDismiss ? (
            <div className="nd-toast__actions">
              {showAction ? (
                <Button variant="secondary" size="md" onClick={onAction}>
                  {actionLabel}
                </Button>
              ) : null}
              {onDismiss ? (
                <IconButton label={dismissLabel} variant="quiet" onClick={onDismiss}>
                  <span aria-hidden="true">×</span>
                </IconButton>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
