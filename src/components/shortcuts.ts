/**
 * The single source of truth for the app's non-spatial keyboard shortcuts.
 *
 * It lives outside the components so Settings, the help dialog, and tests can
 * share exactly one list without tripping the fast-refresh rule that asks a
 * component module to export only components.
 */

export type KeyboardShortcutId =
  'help' | 'search' | 'previous-card' | 'next-card' | 'connect' | 'escape';

export interface KeyboardShortcutDefinition {
  readonly id: KeyboardShortcutId;
  /** Display text for the real key. */
  readonly keys: string;
  readonly title: string;
  readonly description: string;
}

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcutDefinition[] = Object.freeze([
  {
    id: 'help',
    keys: '?',
    title: 'Help',
    description: 'Open the typical flow, board gestures, and keyboard shortcuts.',
  },
  {
    id: 'search',
    keys: '/',
    title: 'Search',
    description: 'Move focus to the case search field. On a phone board it opens the Search sheet.',
  },
  {
    id: 'previous-card',
    keys: '[',
    title: 'Previous card',
    description: 'Move focus to the previous card in the keyboard card list.',
  },
  {
    id: 'next-card',
    keys: ']',
    title: 'Next card',
    description: 'Move focus to the next card in the keyboard card list.',
  },
  {
    id: 'connect',
    keys: 'c',
    title: 'Connect the focused card',
    description:
      'Open the connection picker for the card row that contains focus. Use the picker to attach provenance or create an association.',
  },
  {
    id: 'escape',
    keys: 'Escape',
    title: 'Close or clear',
    description: 'Close the top dialog or sheet, or clear an active search.',
  },
]);
