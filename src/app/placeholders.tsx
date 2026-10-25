import type { ReactNode } from 'react';
import { Link } from 'react-router';

import './AppShell.css';

interface PlaceholderProps {
  readonly title: string;
  readonly description: ReactNode;
}

/**
 * Temporary route content until the owning feature replaces it. Placeholders
 * deliberately avoid data access so the shell can be exercised on its own.
 */
function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <section className="placeholder" aria-labelledby="route-placeholder-title">
      <h2 id="route-placeholder-title">{title}</h2>
      <p>{description}</p>
      <p className="placeholder__note">This screen will be replaced by its feature owner.</p>
    </section>
  );
}

export function ShelfPlaceholder() {
  return (
    <Placeholder
      title="Case shelf"
      description="Your case files will be listed here once local storage is connected."
    />
  );
}

export function CaseBoardPlaceholder() {
  return (
    <Placeholder
      title="Case board"
      description="The evidence board for this case will open here."
    />
  );
}

export function CapturePlaceholder() {
  return (
    <Placeholder
      title="Capture evidence"
      description="Add a photo of your notes to this case from this screen."
    />
  );
}

export function RecallPlaceholder() {
  return (
    <Placeholder
      title="Recall"
      description="Rebuild the case from memory here, then check your work."
    />
  );
}

export function SettingsPlaceholder() {
  return (
    <Placeholder
      title="Settings"
      description="Storage, backup, and reading preferences will be managed here."
    />
  );
}

export function NotFoundPlaceholder() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <h2 id="not-found-title">Page not found</h2>
      <p>This address does not match a case or a route in Notes Detective.</p>
      <p>
        <Link className="not-found__action" to="/">
          Back to case shelf
        </Link>
      </p>
    </section>
  );
}
