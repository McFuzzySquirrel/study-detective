/**
 * The static typical flow shown in the help dialog.
 *
 * This is reference content the student opens on demand, not a scripted tour:
 * it has no current step, no next action, and no auto-advance state. Keeping
 * the copy in one module lets the help dialog and its tests share exactly one
 * order.
 */

export interface HelpFlowStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export const TYPICAL_FLOW_STEPS: readonly HelpFlowStep[] = Object.freeze([
  {
    id: 'create-case',
    title: 'Create a case',
    description: 'One case per exam or course. The shelf keeps every case file together.',
  },
  {
    id: 'capture',
    title: 'Capture evidence',
    description:
      'Photograph the notes you took and the source material they came from. Rotate and crop on import.',
  },
  {
    id: 'pin',
    title: 'Pin and arrange',
    description:
      'Lay the cards out on the corkboard. Drag with a mouse, or long-press before dragging on touch.',
  },
  {
    id: 'connect',
    title: 'Connect the ideas',
    description:
      "Drag a card's pin anchor to another card. Associations are red; provenance is thin dashed amber.",
  },
  {
    id: 'recall',
    title: 'Test yourself',
    description: 'Open Recall, redraw the strings from memory, then check them against the truth.',
  },
  {
    id: 'close',
    title: 'Close and back up',
    description:
      'Close the case when no loose threads remain, then export a backup file you control.',
  },
]);

export const HELP_DATA_NOTE =
  'Your cases, photos, and strings stay in this browser. Nothing is uploaded; export an .ndcase file to keep a backup.';
