/**
 * Settings route: replay the three board hints or reset their seen state.
 *
 * The page owns no hint sequencing. Each hint is an independent popover, so a
 * student can replay one without being walked through the others. Seen state is
 * read through the injectable hint store; the popover marks a hint seen only
 * when it is dismissed, and Reset all clears the install-level state.
 */

import { useId, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import { useMotionPreference } from '../../app/motionPreference';
import type { MotionStore } from '../../app/motionPreference';
import { useLayoutMode } from '../../app/useLayoutMode';
import Button from '../../components/Button';
import { ShortcutList } from '../../components/ShortcutList';
import HintPopover from '../onboarding/HintPopover';
import { HINTS, getHint, hintSeenStore, useSeenHints } from '../onboarding/hints';
import type { HintId, HintSeenStore } from '../onboarding/hints';

import '../onboarding/hints.css';
import './settings.css';

export interface SettingsPageProps {
  /** Injected seen store for component tests and future composition. */
  readonly hintStore?: HintSeenStore | undefined;
  /** Injected motion store for component tests and future composition. */
  readonly motionStore?: MotionStore | undefined;
}

export function SettingsPage({ hintStore = hintSeenStore, motionStore }: SettingsPageProps = {}) {
  // Settings is a short reading page at every width; the mode attribute keeps
  // its phone/tablet/desktop layout testable without a second media query.
  const layout = useLayoutMode();
  const seen = useSeenHints(hintStore);
  const motion = useMotionPreference(motionStore);
  const [activeHint, setActiveHint] = useState<HintId | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);

  const motionBaseId = `motion-${useId().replace(/:/g, '')}`;
  const motionToggleId = `${motionBaseId}-toggle`;
  const motionLabelId = `${motionBaseId}-label`;
  const motionNoteId = `${motionBaseId}-note`;
  const motionStatusId = `${motionBaseId}-status`;

  // The device preference is the floor. An explicit "on" is persisted for a
  // device that does not ask for reduced motion; the control is disabled when
  // the device itself has already asked, because turning it off could not
  // override the platform floor.
  const motionDisabled = motion.systemReduced;
  const motionNote = motionDisabled
    ? 'Your device asks for reduced motion, so this setting stays on while that preference is active.'
    : 'Defaults to your device setting. Changing it applies immediately and is saved on this device.';
  const motionStatus = motion.reduced
    ? 'Reduced motion is on. Pins, strings, camera pans, and page transitions stay still.'
    : 'Motion is on. Pins, strings, and page transitions follow your device.';

  const openHint = (event: MouseEvent<HTMLButtonElement>, hintId: HintId): void => {
    returnFocusRef.current = event.currentTarget;
    setAnnouncement('');
    setActiveHint(hintId);
  };

  const dismissHint = (): void => {
    setActiveHint(null);
  };

  const resetAllHints = (): void => {
    if (activeHint !== null) {
      // The popover restores focus on unmount; send it to the reset control
      // that is actually receiving the click rather than back to the replay
      // button the student used earlier.
      returnFocusRef.current = resetButtonRef.current;
    }

    hintStore.resetAll();
    setActiveHint(null);
    setAnnouncement('All hints reset. Each hint will appear again the next time it is relevant.');
  };

  const activeDefinition = activeHint === null ? null : getHint(activeHint);

  return (
    <section
      className="settings-page"
      aria-labelledby="settings-title"
      data-layout={layout}
      data-testid="settings-page"
    >
      <header className="settings-page__header">
        <p className="settings-page__eyebrow">Install preferences</p>
        <h2 id="settings-title" className="settings-page__title">
          Settings
        </h2>
        <p className="settings-page__intro">
          Preferences stay on this device. Hints explain the board gestures that are easiest to
          miss.
        </p>
      </header>

      <section
        className="appearance-settings"
        aria-labelledby="appearance-title"
        data-testid="appearance-settings"
      >
        <div className="appearance-settings__header">
          <h3 id="appearance-title" className="appearance-settings__title">
            Appearance
          </h3>
          <p className="appearance-settings__intro">
            Motion is the only display preference in this version. It follows your device until you
            change it here.
          </p>
        </div>

        <label
          className="appearance-settings__toggle"
          htmlFor={motionToggleId}
          data-disabled={motionDisabled ? 'true' : 'false'}
        >
          <input
            id={motionToggleId}
            type="checkbox"
            className="appearance-settings__checkbox"
            checked={motion.reduced}
            disabled={motionDisabled}
            aria-labelledby={motionLabelId}
            aria-describedby={`${motionNoteId} ${motionStatusId}`}
            data-testid="motion-toggle"
            data-motion-reduced={motion.reduced ? 'true' : 'false'}
            data-motion-preference={motion.preference}
            onChange={(event) => {
              motion.setReduced(event.currentTarget.checked);
            }}
          />
          <span className="appearance-settings__copy">
            <span id={motionLabelId} className="appearance-settings__label">
              Reduce motion
            </span>
            <span id={motionNoteId} className="appearance-settings__hint">
              {motionNote}
            </span>
          </span>
        </label>

        <p
          id={motionStatusId}
          className="appearance-settings__status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="motion-status"
        >
          {motionStatus}
        </p>
      </section>

      <section className="shortcut-settings" aria-labelledby="keyboard-shortcuts-title">
        <div className="shortcut-settings__header">
          <h3 id="keyboard-shortcuts-title" className="shortcut-settings__title">
            Keyboard shortcuts
          </h3>
          <p className="shortcut-settings__intro">
            Every non-spatial task has a keyboard path. All shortcuts are active on every route;
            letter, bracket, and slash shortcuts stay inert while you type, and Escape still closes
            an overlay or clears search.
          </p>
        </div>
        <ShortcutList />
        <p className="shortcut-settings__note">
          Spatial placement, canvas panning, and scratch drawing remain pointer-only in this
          version. Use the card list and recall toolbar for every other action.
        </p>
      </section>

      <section className="hint-settings" aria-labelledby="replay-hints-title">
        <div className="hint-settings__header">
          <h3 id="replay-hints-title" className="hint-settings__title">
            Replay hints
          </h3>
          <p className="hint-settings__intro">
            Replay any hint at any time. Each hint appears once at the moment it is useful, then
            stays here for a refresher.
          </p>
        </div>

        <ul className="hint-settings__list">
          {HINTS.map((hint) => {
            const hasSeen = seen.has(hint.id);

            return (
              <li className="hint-settings__item" key={hint.id} data-hint-id={hint.id}>
                <div className="hint-settings__copy">
                  <h4 className="hint-settings__name">{hint.title}</h4>
                  <p className="hint-settings__text">{hint.description}</p>
                  <p className="hint-settings__status">
                    Status: {hasSeen ? 'seen' : 'not seen yet'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="hint-settings__replay"
                  aria-label={`Replay ${hint.title} hint`}
                  onClick={(event) => openHint(event, hint.id)}
                >
                  Replay
                </Button>
              </li>
            );
          })}
        </ul>

        <div className="hint-settings__footer">
          <Button ref={resetButtonRef} variant="secondary" onClick={resetAllHints}>
            Reset all hints
          </Button>
          <p
            className="hint-settings__announcement"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {announcement}
          </p>
        </div>
      </section>

      {activeDefinition ? (
        <HintPopover
          key={activeDefinition.id}
          open
          hintId={activeDefinition.id}
          store={hintStore}
          title={activeDefinition.title}
          description={activeDefinition.description}
          onDismiss={dismissHint}
          returnFocusRef={returnFocusRef}
        />
      ) : null}
    </section>
  );
}

export default SettingsPage;
