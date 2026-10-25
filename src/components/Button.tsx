import type { ComponentPropsWithRef, ReactNode } from 'react';

import './components.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'className'> {
  /** Visual weight. Defaults to `secondary`. */
  readonly variant?: ButtonVariant;
  /** `md` is the 44 px floor; `lg` adds padding for primary route actions. */
  readonly size?: ButtonSize;
  /** Stretch to the available inline size, for forms and phone sheets. */
  readonly fullWidth?: boolean;
  /** Decorative glyph rendered before the label. It is hidden from AT. */
  readonly leadingIcon?: ReactNode;
  /** Decorative glyph rendered after the label. It is hidden from AT. */
  readonly trailingIcon?: ReactNode;
  readonly className?: string;
}

function classNames(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

/**
 * Native button with the locked 44x44 px target, visible focus ring, and the
 * four variants the case file uses. `type` defaults to `button` so a form
 * action never submits by accident.
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classNames(
        'nd-button',
        `nd-button--${variant}`,
        `nd-button--${size}`,
        fullWidth ? 'nd-button--full' : undefined,
        className,
      )}
      data-variant={variant}
      data-size={size}
    >
      {leadingIcon ? (
        <span className="nd-button__icon" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      <span className="nd-button__label">{children}</span>
      {trailingIcon ? (
        <span className="nd-button__icon" aria-hidden="true">
          {trailingIcon}
        </span>
      ) : null}
    </button>
  );
}
