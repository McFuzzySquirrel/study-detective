import { useId } from 'react';
import type { ReactNode } from 'react';

import type { PersistenceResult } from '../../data/persistence';
import { formatStorageBytes } from '../../data/storageEstimate';
import type { StorageEstimateSnapshot } from '../../data/storageEstimate';

import './shelf.css';

export interface StorageStatusProps {
  /** The current persistence answer, or null while the first read is pending. */
  readonly persistence: PersistenceResult | null;
  /** The current estimate, or null while the first read is pending. */
  readonly estimate: StorageEstimateSnapshot | null;
  /**
   * Slot for the backup entry point. The storage warnings only describe the
   * risk; the owner decides where the backup action lives and how it behaves.
   */
  readonly backupAction?: ReactNode | undefined;
}

function persistenceLabel(persistence: PersistenceResult | null): string {
  if (persistence === null) {
    return 'Checking';
  }
  return persistence.state === 'persistent' ? 'Persistent' : 'Best effort';
}

function persistenceDetail(persistence: PersistenceResult): string {
  if (persistence.state === 'persistent') {
    return 'The browser agreed to keep this case data. It can still be evicted if you clear site data or the device is wiped.';
  }

  if (!persistence.supported) {
    return 'This browser does not support persistent storage. It may clear case data when device space runs low.';
  }

  return 'Persistent storage is not active. The browser may clear case data when device space runs low.';
}

function usageText(estimate: StorageEstimateSnapshot): string {
  if (!estimate.supported) {
    return 'Storage usage and quota are unavailable in this browser.';
  }

  if (estimate.usageBytes === null) {
    return 'Storage usage is unavailable in this browser.';
  }

  const used = `${formatStorageBytes(estimate.usageBytes)} used`;
  const quota =
    estimate.quotaBytes === null ? null : ` of ${formatStorageBytes(estimate.quotaBytes)}`;
  const percent = estimate.percent === null ? '' : ` (${estimate.percent}%)`;

  return `${used}${quota ?? ''}${percent}`;
}

/**
 * Compact storage strip for the shelf.
 *
 * It reports persistent versus best effort, usage and quota from
 * `navigator.storage.estimate()`, and a warning above 80 percent with a slot
 * for the backup action. Every warning is plain text (not color alone) and the
 * meter has a numeric accessible value.
 */
export default function StorageStatus({ persistence, estimate, backupAction }: StorageStatusProps) {
  const titleId = useId();
  const loading = persistence === null || estimate === null;
  const warning = estimate?.warning === true;
  const bestEffort = persistence !== null && persistence.state === 'best-effort';
  const showNotice = warning || bestEffort;
  const state = persistence?.state ?? 'checking';
  const percent = estimate?.percent ?? null;

  return (
    <section
      className="storage-status"
      aria-labelledby={titleId}
      aria-busy={loading}
      data-persistence={state}
      data-warning={warning ? 'true' : 'false'}
    >
      <div className="storage-status__header">
        <h3 id={titleId} className="storage-status__title">
          Storage
        </h3>
        <span className="storage-status__badge" data-state={state}>
          {persistenceLabel(persistence)}
        </span>
      </div>

      <p className="storage-status__detail">
        {persistence === null
          ? 'Checking whether this browser will keep your case data…'
          : persistenceDetail(persistence)}
      </p>

      <p className="storage-status__usage">
        {estimate === null ? 'Reading storage usage…' : usageText(estimate)}
      </p>

      {percent !== null ? (
        <progress
          className="storage-status__meter"
          aria-label="Storage used"
          aria-valuetext={`${percent}% used`}
          max={100}
          value={Math.min(100, Math.max(0, percent))}
        />
      ) : null}

      {showNotice ? (
        <div
          className="storage-status__notice"
          data-tone={warning ? 'warning' : 'caution'}
          data-slot="storage-warning"
        >
          <p className="storage-status__notice-text">
            <strong>{warning ? 'Storage warning. ' : 'Back up your cases. '}</strong>
            {warning
              ? `Storage is ${percent ?? 0}% full. Back up cases now, before the browser refuses another photo or clears data.`
              : 'The browser may clear this data when space runs low. Back up anything you cannot lose.'}
          </p>
          {backupAction !== undefined && backupAction !== null ? (
            <div className="storage-status__backup" data-slot="backup-action">
              {backupAction}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
