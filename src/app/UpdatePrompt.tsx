import { useSyncExternalStore } from 'react';

import {
  confirmUpdate,
  dismissUpdate,
  getUpdatePromptState,
  subscribeToUpdatePrompt,
} from '../pwa';
import './UpdatePrompt.css';

export default function UpdatePrompt() {
  const { needRefresh, blockedByUnsavedChanges } = useSyncExternalStore(
    subscribeToUpdatePrompt,
    getUpdatePromptState,
  );

  if (!needRefresh) {
    return null;
  }

  return (
    <aside className="update-prompt" role="status" aria-live="polite" aria-atomic="true">
      <div className="update-prompt__copy">
        <p className="update-prompt__title">A new version of Notes Detective is ready.</p>
        <p className="update-prompt__hint">
          {blockedByUnsavedChanges
            ? 'Finish your current edit before refreshing.'
            : 'Refresh when you are ready; nothing changes until you confirm.'}
        </p>
      </div>
      <div className="update-prompt__actions">
        <button
          type="button"
          className="update-prompt__action update-prompt__action--confirm"
          onClick={() => {
            void confirmUpdate();
          }}
          disabled={blockedByUnsavedChanges}
        >
          Refresh
        </button>
        <button type="button" className="update-prompt__action" onClick={dismissUpdate}>
          Later
        </button>
      </div>
    </aside>
  );
}
