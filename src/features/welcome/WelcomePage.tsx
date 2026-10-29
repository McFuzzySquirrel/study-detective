import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router';

import { useHelp } from '../../app/helpContext';
import { useLayoutMode } from '../../app/useLayoutMode';
import Button from '../../components/Button';

import { welcomeSeenStore } from './welcomeSeen';
import type { WelcomeSeenStore } from './welcomeSeen';
import './welcome.css';

export interface WelcomePageProps {
  /** Injected seen store for component tests and composition. */
  readonly seenStore?: WelcomeSeenStore | undefined;
}

/**
 * First-run welcome screen.
 *
 * The illustration is the hero, but the copy stays first in the document so a
 * screen reader meets the explanation and actions before the decorative
 * artwork. On phones the illustration is reordered visually above the copy
 * without moving focusable content.
 *
 * Enter marks the install-local flag and replaces the welcome entry in history,
 * so Back cannot bounce through the redirect gate. The route itself remains
 * reachable at any time from Help.
 */
export function WelcomePage({ seenStore = welcomeSeenStore }: WelcomePageProps = {}) {
  const layout = useLayoutMode();
  const navigate = useNavigate();
  const { openHelp } = useHelp();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const handleEnter = (): void => {
    seenStore.markSeen();
    navigate('/', { replace: true, state: { focusMain: true } });
  };

  const handleHelp = (event: MouseEvent<HTMLButtonElement>): void => {
    openHelp(event.currentTarget);
  };

  return (
    <section
      className="welcome"
      aria-labelledby="welcome-title"
      data-layout={layout}
      data-testid="welcome-page"
    >
      <div className="welcome__copy">
        <p className="welcome__eyebrow">Case file intake</p>
        <h2 id="welcome-title" className="welcome__title" ref={headingRef} tabIndex={-1}>
          Welcome to Notes Detective
        </h2>
        <p className="welcome__intro">
          Pin the notes you took and the sources they came from, draw strings between related ideas,
          then rebuild the case from memory before the exam.
        </p>

        <ul className="welcome__beats" aria-label="How a case works">
          <li>Pin your notes and sources.</li>
          <li>String the ideas that belong together.</li>
          <li>Rebuild the board from memory in Recall.</li>
        </ul>

        <div className="welcome__actions">
          <Button variant="primary" size="lg" onClick={handleEnter}>
            Enter the case files
          </Button>
          <Button variant="secondary" size="lg" onClick={handleHelp}>
            How it works
          </Button>
        </div>

        <p className="welcome__note">
          Local-first: your notes and photos stay on this device. No account and no uploads.
        </p>
      </div>

      <figure className="welcome__figure">
        <img
          className="welcome__image"
          src={`${import.meta.env.BASE_URL}study-detective-welcome-vector.svg`}
          alt="Illustration of students studying together in a cozy, book-lined room."
          width={1536}
          height={1024}
          decoding="async"
          fetchPriority="high"
        />
        <figcaption className="welcome__caption">Explore. Investigate. Learn.</figcaption>
      </figure>
    </section>
  );
}

export default WelcomePage;
