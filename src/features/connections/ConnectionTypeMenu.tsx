/**
 * The small thread-type menu shown after a thread is drawn.
 *
 * Dropping a thread always creates an association first, so this menu starts on
 * Association and can retype the same row to Provenance. Provenance is only
 * valid between one Study Note and one Source; when it is not, the option is
 * disabled and its reason is both visible and announced.
 *
 * The menu is deliberately not modal: it is a short follow-up to a pointer
 * gesture, and the board stays the primary surface. Escape and Done dismiss it,
 * leaving the current (default association) type in place.
 */

import { useEffect, useId, useRef } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';

import Button from '../../components/Button';
import type { ConnectionType } from '../../domain/model';

import './connections.css';

export interface ConnectionTypeMenuProps {
  readonly open: boolean;
  readonly type: ConnectionType;
  readonly provenanceEligible: boolean;
  readonly provenanceReason: string;
  /** Client-space drop point; the menu is clamped inside the viewport. */
  readonly point?: { readonly x: number; readonly y: number } | null;
  readonly busy?: boolean;
  readonly onSelect: (type: ConnectionType) => void;
  readonly onDismiss: () => void;
}

const MENU_WIDTH = 300;
const MENU_HEIGHT = 340;

function clampPosition(
  point: { readonly x: number; readonly y: number } | null | undefined,
): CSSProperties {
  if (typeof window === 'undefined' || point === null || point === undefined) {
    return { left: '1rem', top: '1rem' };
  }

  const maxLeft = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
  const maxTop = Math.max(8, window.innerHeight - MENU_HEIGHT - 8);

  return {
    left: `${Math.max(8, Math.min(point.x + 12, maxLeft))}px`,
    top: `${Math.max(8, Math.min(point.y + 12, maxTop))}px`,
  };
}

export function ConnectionTypeMenu({
  open,
  type,
  provenanceEligible,
  provenanceReason,
  point,
  busy = false,
  onSelect,
  onDismiss,
}: ConnectionTypeMenuProps) {
  const titleId = useId();
  const reasonId = useId();
  const associationRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    associationRef.current?.focus();

    return () => {
      const previous = previousFocusRef.current;
      if (previous !== null && previous.isConnected) {
        previous.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    }
  };

  return (
    <div
      className="connection-type-menu"
      role="group"
      aria-label="Connection type menu"
      data-testid="connection-type-menu"
      style={clampPosition(point)}
      onKeyDown={handleKeyDown}
    >
      <div className="connection-type-menu__header">
        <h3 id={titleId} className="connection-type-menu__title">
          Thread type
        </h3>
        <p className="connection-type-menu__intro">
          The thread is drawn. Choose Association, or Provenance when it is available.
        </p>
      </div>

      <fieldset className="connection-type-menu__options" disabled={busy}>
        <legend className="visually-hidden">Thread type</legend>

        <div className="connection-type-menu__option">
          <input
            ref={associationRef}
            id={`${titleId}-association`}
            className="connection-type-menu__radio"
            type="radio"
            name={`${titleId}-type`}
            value="association"
            checked={type === 'association'}
            onChange={() => {
              if (!busy) {
                onSelect('association');
              }
            }}
          />
          <label className="connection-type-menu__label" htmlFor={`${titleId}-association`}>
            <span
              className="connection-type-menu__swatch"
              data-type="association"
              aria-hidden="true"
            />
            <span>
              <strong>Association</strong>
              <span className="connection-type-menu__hint">Red thread between any two cards</span>
            </span>
          </label>
        </div>

        <div className="connection-type-menu__option">
          <input
            id={`${titleId}-provenance`}
            className="connection-type-menu__radio"
            type="radio"
            name={`${titleId}-type`}
            value="provenance"
            checked={type === 'provenance'}
            disabled={!provenanceEligible || busy}
            aria-describedby={reasonId}
            onChange={() => {
              if (provenanceEligible && !busy) {
                onSelect('provenance');
              }
            }}
          />
          <label className="connection-type-menu__label" htmlFor={`${titleId}-provenance`}>
            <span
              className="connection-type-menu__swatch"
              data-type="provenance"
              aria-hidden="true"
            />
            <span>
              <strong>Provenance</strong>
              <span className="connection-type-menu__hint">
                Dashed amber thread from a Note to a Source
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <p
        id={reasonId}
        className="connection-type-menu__reason"
        data-eligible={provenanceEligible ? 'true' : 'false'}
        role="status"
        aria-live="polite"
      >
        {provenanceReason}
      </p>

      <div className="connection-type-menu__actions">
        <Button variant="secondary" size="md" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

export default ConnectionTypeMenu;
