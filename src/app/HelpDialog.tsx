import { useRef } from 'react';
import type { RefObject } from 'react';

import Button from '../components/Button';
import Dialog from '../components/Dialog';
import ShortcutList from '../components/ShortcutList';

import { HELP_DATA_NOTE, TYPICAL_FLOW_STEPS } from './helpContent';
import './help.css';

export interface HelpDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onShowWelcome: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

/**
 * One help surface for the whole app: the typical flow, board gestures, and
 * keyboard shortcuts. It is opened by the top-bar Help button, the welcome
 * screen, and the `?` key, so every entry point teaches the same model.
 */
export default function HelpDialog({
  open,
  onClose,
  onShowWelcome,
  returnFocusRef,
}: HelpDialogProps) {
  const startRef = useRef<HTMLElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="How Notes Detective works"
      description="A quick reference for the typical flow, the board gestures, and the shortcuts that are easiest to miss."
      size="lg"
      initialFocusRef={startRef}
      returnFocusRef={returnFocusRef}
      className="help-dialog"
      actions={
        <>
          <Button variant="secondary" onClick={onShowWelcome}>
            Show the welcome screen
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <section
        ref={startRef}
        className="help-section help-section--start"
        aria-labelledby="help-flow-title"
        tabIndex={-1}
      >
        <h3 id="help-flow-title" className="help-section__title">
          Typical flow
        </h3>
        <ol className="help-flow">
          {TYPICAL_FLOW_STEPS.map((step) => (
            <li className="help-flow__step" key={step.id} data-help-step={step.id}>
              <strong className="help-flow__step-title">{step.title}</strong>
              <span className="help-flow__step-copy">{step.description}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="help-section" aria-labelledby="help-gestures-title">
        <h3 id="help-gestures-title" className="help-section__title">
          Board gestures
        </h3>
        <dl className="help-gestures">
          <div className="help-gestures__row">
            <dt>Pan</dt>
            <dd>Drag the empty cork, or swipe with one finger.</dd>
          </div>
          <div className="help-gestures__row">
            <dt>Zoom</dt>
            <dd>Pinch, scroll, or use the view cluster.</dd>
          </div>
          <div className="help-gestures__row">
            <dt>Move a card</dt>
            <dd>Drag it with a mouse, or long-press for 500 ms on touch.</dd>
          </div>
          <div className="help-gestures__row">
            <dt>Draw a thread</dt>
            <dd>Select a card, then drag its pin anchor to another card.</dd>
          </div>
        </dl>
      </section>

      <section className="help-section" aria-labelledby="help-shortcuts-title">
        <h3 id="help-shortcuts-title" className="help-section__title">
          Keyboard shortcuts
        </h3>
        <ShortcutList />
      </section>

      <p className="help-note">{HELP_DATA_NOTE}</p>
    </Dialog>
  );
}
