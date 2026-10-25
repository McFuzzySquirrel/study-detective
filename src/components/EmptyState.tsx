import { useId } from 'react';
import type { ReactNode } from 'react';

import './components.css';

export type EmptyStateHeadingLevel = 2 | 3 | 4;

export interface EmptyStateProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** A shared Button or link; its own 44 px target is preserved. */
  readonly action?: ReactNode;
  /** Decorative glyph. Hidden from assistive technology. */
  readonly icon?: ReactNode;
  readonly headingLevel?: EmptyStateHeadingLevel;
  readonly className?: string;
}

/**
 * Shared "nothing here yet" panel. The heading names the region, the body says
 * what to do next, and the optional action stays a real focusable control.
 */
export default function EmptyState({
  title,
  description,
  action,
  icon,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const titleId = useId();
  const HeadingTag = `h${headingLevel}` as 'h2' | 'h3' | 'h4';

  return (
    <section
      className={['nd-empty-state', className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
    >
      {icon ? (
        <span className="nd-empty-state__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}

      <HeadingTag id={titleId} className="nd-empty-state__title">
        {title}
      </HeadingTag>

      {description ? <p className="nd-empty-state__description">{description}</p> : null}

      {action ? <div className="nd-empty-state__action">{action}</div> : null}
    </section>
  );
}
