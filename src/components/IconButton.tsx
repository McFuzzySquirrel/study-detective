import type { ComponentPropsWithRef, ReactNode } from 'react';

import './components.css';

export type IconButtonVariant = 'default' | 'quiet' | 'danger';
export type IconButtonSize = 'md' | 'lg';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'className'> {
  /**
   * Required accessible name. An icon button without a label is unusable with
   * a screen reader, so this prop is deliberately not optional.
   */
  readonly label: string;
  readonly variant?: IconButtonVariant;
  readonly size?: IconButtonSize;
  /** Marks a toggle button; omit for a plain action. */
  readonly pressed?: boolean;
  readonly className?: string;
  /** Usually a single glyph or a decorative SVG. */
  readonly children: ReactNode;
}

function classNames(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

/**
 * Square icon-only control. The visual glyph stays small; the hit area is the
 * shared 44x44 px target from tokens.css.
 */
export default function IconButton({
  label,
  variant = 'default',
  size = 'md',
  pressed,
  className,
  children,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const isToggle = pressed !== undefined;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classNames(
        'nd-icon-button',
        `nd-icon-button--${variant}`,
        `nd-icon-button--${size}`,
        className,
      )}
      aria-label={label}
      aria-pressed={isToggle ? pressed : undefined}
      data-variant={variant}
      data-size={size}
    >
      <span className="nd-icon-button__glyph" aria-hidden="true">
        {children}
      </span>
    </button>
  );
}
