/**
 * The shared shortcut table used by the `?` help dialog and Settings.
 *
 * It is plain definition-list content, so screen readers read each key and its
 * meaning in order and the list stays useful without CSS.
 */

import { KEYBOARD_SHORTCUTS } from './shortcuts';

export interface ShortcutListProps {
  readonly className?: string | undefined;
}

export function ShortcutList({ className }: ShortcutListProps) {
  return (
    <dl className={['shortcut-list', className].filter(Boolean).join(' ')}>
      {KEYBOARD_SHORTCUTS.map((shortcut) => (
        <div className="shortcut-list__row" key={shortcut.id} data-shortcut-id={shortcut.id}>
          <dt className="shortcut-list__keys">
            <kbd>{shortcut.keys}</kbd>
          </dt>
          <dd className="shortcut-list__description">
            <strong>{shortcut.title}</strong>
            <span className="shortcut-list__detail">{shortcut.description}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default ShortcutList;
