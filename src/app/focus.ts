/**
 * Small, framework-free focus helpers shared by the keyboard shortcuts and the
 * screens they drive.
 *
 * The helpers deliberately use the DOM as the source of truth: a shortcut asks
 * "what is focused now?" and "which card row owns it?" rather than keeping a
 * second focus model in React state. That keeps focus restoration reliable when
 * a dialog, sheet, route change, or deletion removes the element that used to
 * have focus.
 */

/** A screen asks the open search panel to take focus. */
export const FOCUS_SEARCH_EVENT = 'notes-detective:focus-search';

/** A screen asks the top inline surface to close or clear itself. */
export const DISMISS_EVENT = 'notes-detective:dismiss';

const EDITABLE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
].join(',');

const DIALOG_SELECTOR = '[role="dialog"]';

/**
 * True when a key press belongs to a text field rather than a shortcut.
 *
 * `contenteditable` is checked through `isContentEditable` because the
 * attribute may be inherited from an ancestor.
 */
export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return target.closest(EDITABLE_SELECTOR) !== null;
}

/** True while any dialog or sheet is mounted; it owns Escape and focus. */
export function hasOpenDialog(): boolean {
  return document.querySelector(DIALOG_SELECTOR) !== null;
}

/** The element that should receive focus next, ignoring a detached target. */
export function activeFocusElement(): HTMLElement | null {
  const active = document.activeElement;

  if (!(active instanceof HTMLElement) || active === document.body) {
    return null;
  }

  return active.isConnected ? active : null;
}

/** Focus the main landmark or the visible page heading as a safe fallback. */
export function focusMainLandmark(): boolean {
  const target =
    document.querySelector<HTMLElement>('main') ??
    document.querySelector<HTMLElement>('h1') ??
    document.querySelector<HTMLElement>('h2');

  if (target === null) {
    return false;
  }

  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
  }

  target.focus();
  return document.activeElement === target;
}

/**
 * Focus the search field of the mounted search panel, if there is one.
 * The panel is often rendered only after its route loads, so a missing field
 * is a normal result rather than an error.
 */
export function focusSearchField(): boolean {
  const field = document.querySelector<HTMLElement>('[data-shortcut-target="search"]');

  if (field === null) {
    return false;
  }

  field.focus();

  if (field instanceof HTMLInputElement) {
    field.select();
  }

  return document.activeElement === field;
}

function cardRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-card-row="true"]'));
}

function firstControlIn(row: HTMLElement): HTMLElement {
  return (
    row.querySelector<HTMLElement>(
      '[data-card-open], a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? row
  );
}

function focusedRowIndex(rows: readonly HTMLElement[]): number {
  const active = document.activeElement;

  if (!(active instanceof HTMLElement)) {
    return -1;
  }

  return rows.findIndex((row) => row.contains(active));
}

/**
 * Move focus to the previous or next keyboard card row.
 *
 * When focus is not in a row yet, `next` starts at the first card and
 * `previous` starts at the last one. The ends clamp instead of wrapping so the
 * student never loses their sense of position in a long list.
 *
 * @returns the card id that received focus, or `null` when no row exists.
 */
export function moveCardListFocus(direction: 'previous' | 'next'): string | null {
  const rows = cardRows();

  if (rows.length === 0) {
    return null;
  }

  const current = focusedRowIndex(rows);
  const step = direction === 'next' ? 1 : -1;
  const fallback = direction === 'next' ? 0 : rows.length - 1;
  const nextIndex =
    current === -1 ? fallback : Math.min(rows.length - 1, Math.max(0, current + step));
  const row = rows[nextIndex];

  if (row === undefined) {
    return null;
  }

  firstControlIn(row).focus();
  return row.getAttribute('data-card-id');
}

/**
 * Activate the Connect action for the card row that owns focus.
 *
 * Focus moves to the real button before its click opens the dialog, so the
 * dialog records that button as its trigger and restores focus there on close.
 * Returns false when the focused element is not inside a card with a Connect
 * action, leaving the key inert on unrelated screens.
 */
export function connectFocusedCard(): boolean {
  const active = document.activeElement;

  if (!(active instanceof HTMLElement)) {
    return false;
  }

  const row = active.closest<HTMLElement>('[data-card-row="true"], [data-card-id]');

  if (row === null) {
    return false;
  }

  const action = row.querySelector<HTMLElement>('[data-connect-action]:not([disabled])');

  if (action === null) {
    return false;
  }

  action.focus();
  action.click();
  return true;
}
