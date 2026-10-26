import { useMemo, useState } from 'react';

import { CORE_API_NOTICES, SUPPORT_MATRIX_URL, supportsCoreApis } from './browserSupport';
import type { CoreApiEnvironment } from './browserSupport';

/**
 * A11Y-FR-08 browser capability notice.
 *
 * The notice is deliberately non-blocking: it is a labelled section in the
 * shell's status slot, not a dialog. It never traps focus, never covers the
 * shelf, and can be dismissed for the current page session. Capability checks
 * run synchronously once per mount because a browser cannot gain IndexedDB or
 * a service worker without a reload.
 */

export interface BrowserNoticeProps {
  /** Injected environment for component tests; production reads the globals. */
  readonly environment?: CoreApiEnvironment | undefined;
}

export default function BrowserNotice({ environment }: BrowserNoticeProps = {}) {
  const [dismissed, setDismissed] = useState(false);
  const support = useMemo(() => supportsCoreApis(environment), [environment]);
  const missing = useMemo(
    () => CORE_API_NOTICES.filter((notice) => !support[notice.key]),
    [support],
  );

  if (dismissed || missing.length === 0) {
    return null;
  }

  return (
    <section
      className="browser-notice"
      aria-labelledby="browser-notice-title"
      data-testid="browser-notice"
    >
      <div className="browser-notice__message" role="status" aria-live="polite" aria-atomic="false">
        <h2 id="browser-notice-title" className="browser-notice__title">
          This browser is missing some features
        </h2>
        <ul className="browser-notice__list">
          {missing.map((notice) => (
            <li key={notice.key} data-capability={notice.key}>
              {notice.message}
            </li>
          ))}
        </ul>
      </div>

      <div className="browser-notice__actions">
        <a className="browser-notice__link" href={SUPPORT_MATRIX_URL} rel="noreferrer">
          Browser support matrix (README)
        </a>
        <button
          type="button"
          className="browser-notice__dismiss"
          aria-label="Dismiss browser support notice"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
