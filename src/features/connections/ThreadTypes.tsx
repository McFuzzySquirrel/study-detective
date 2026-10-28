/**
 * The Case menu's thread-type key.
 *
 * It teaches both string meanings with a shape difference as well as colour:
 * association is a solid red line, provenance is a dashed amber line. The
 * toggle is a real button with `aria-expanded`/`aria-controls`, so it is
 * keyboard operable and its state is announced. When collapsed the panel is
 * `hidden`, which removes it from the accessibility tree as well as the layout.
 */

import { useId, useState } from 'react';

import Button from '../../components/Button';

import './connections.css';

export interface ThreadTypesProps {
  /** Initial expanded state. Defaults to collapsed inside the Case menu. */
  readonly defaultOpen?: boolean;
  readonly className?: string | undefined;
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

export default function ThreadTypes({ defaultOpen = false, className }: ThreadTypesProps) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = useId();
  const panelId = useId();

  return (
    <section
      className={joinClassNames('thread-types', className)}
      aria-labelledby={titleId}
      data-testid="thread-types"
    >
      <h3 id={titleId} className="visually-hidden">
        Thread types
      </h3>

      <Button
        variant="quiet"
        className="thread-types__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        Thread types
        <span className="thread-types__chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </Button>

      <div
        id={panelId}
        className="thread-types__panel"
        role="group"
        aria-label="Thread types"
        hidden={!open}
      >
        <ul className="thread-types__list">
          <li className="thread-types__item">
            <span className="thread-types__swatch" data-type="association" aria-hidden="true" />
            <span>
              <strong>Association</strong> — solid red thread between any two cards
            </span>
          </li>
          <li className="thread-types__item">
            <span className="thread-types__swatch" data-type="provenance" aria-hidden="true" />
            <span>
              <strong>Provenance</strong> — thin dashed amber thread from a Study Note to a Source
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}
