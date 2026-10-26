/**
 * The board's thread-type key.
 *
 * The legend teaches both string meanings with a shape difference as well as
 * colour: association is a solid red line, provenance is a dashed amber line.
 * The toggle is a real button with `aria-expanded`/`aria-controls`, so it is
 * keyboard operable and its state is announced. When collapsed the panel is
 * `hidden`, which removes it from the accessibility tree as well as the layout.
 */

import { useId, useState } from 'react';

import Button from '../../components/Button';

import './connections.css';

export interface ConnectionLegendProps {
  /** Initial expanded state. Defaults to open so the key is visible on arrival. */
  readonly defaultOpen?: boolean;
  readonly className?: string | undefined;
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

export default function ConnectionLegend({ defaultOpen = true, className }: ConnectionLegendProps) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = useId();
  const panelId = useId();

  return (
    <section
      className={joinClassNames('connection-legend', className)}
      aria-labelledby={titleId}
      data-testid="connection-legend"
    >
      <h3 id={titleId} className="visually-hidden">
        Connection legend
      </h3>

      <Button
        variant="quiet"
        className="connection-legend__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        Connection legend
      </Button>

      <div
        id={panelId}
        className="connection-legend__panel"
        role="group"
        aria-label="Thread types"
        hidden={!open}
      >
        <ul className="connection-legend__list">
          <li className="connection-legend__item">
            <span
              className="connection-legend__swatch"
              data-type="association"
              aria-hidden="true"
            />
            <span>
              <strong>Association</strong> — solid red thread between any two cards
            </span>
          </li>
          <li className="connection-legend__item">
            <span className="connection-legend__swatch" data-type="provenance" aria-hidden="true" />
            <span>
              <strong>Provenance</strong> — thin dashed amber thread from a Study Note to a Source
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}
