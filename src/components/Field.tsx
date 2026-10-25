import { useId } from 'react';
import type { ReactNode } from 'react';

import './components.css';

export interface FieldControlProps {
  /** ID for the visible label's `htmlFor`. */
  readonly id: string;
  /** Shared input styling, including the 44 px target. */
  readonly className: string;
  readonly required: boolean;
  readonly 'aria-required': boolean;
  readonly 'aria-invalid': boolean;
  /** Space-separated hint and error IDs, when either exists. */
  readonly 'aria-describedby'?: string;
  /** Error ID, when the field is invalid. */
  readonly 'aria-errormessage'?: string;
}

export interface FieldProps {
  /** Visible label. A field is never labelled by placeholder text alone. */
  readonly label: ReactNode;
  /** Persistent guidance; wired through `aria-describedby`. */
  readonly hint?: ReactNode;
  /** Current error. Rendered in an alert region and associated to the control. */
  readonly error?: ReactNode;
  readonly required?: boolean;
  /** Optional stable ID prefix. Defaults to a generated React ID. */
  readonly id?: string;
  readonly className?: string;
  /**
   * Render prop for the control. Spread the provided props onto an `input`,
   * `select`, or `textarea` so the label, hint, error, and required state all
   * stay wired without duplicating ID logic in every form.
   */
  readonly children: (control: FieldControlProps) => ReactNode;
}

/**
 * Accessible form field wrapper: visible label, hint, invalid state, error
 * association, and an alert region. It never hides the label and never uses a
 * placeholder as the only name.
 */
export default function Field({
  label,
  hint,
  error,
  required = false,
  id,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const baseId = id ?? `field-${generatedId.replace(/:/g, '')}`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== '';
  const hasError = error !== undefined && error !== null && error !== false && error !== '';

  const describedBy = [hasHint ? hintId : null, hasError ? errorId : null]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  const control: FieldControlProps = {
    id: baseId,
    className: 'nd-field__control',
    required,
    'aria-required': required,
    'aria-invalid': hasError,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(hasError ? { 'aria-errormessage': errorId } : {}),
  };

  return (
    <div className={['nd-field', className].filter(Boolean).join(' ')}>
      <label className="nd-field__label" htmlFor={baseId}>
        {label}
        {required ? (
          <span className="nd-field__required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>

      {hasHint ? (
        <p className="nd-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {children(control)}

      {hasError ? (
        <p className="nd-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
