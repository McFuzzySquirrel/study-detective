import type { CaseReadiness } from './readiness';

/**
 * Pure case-closure metadata.
 *
 * A case is open or closed; `closedAt` is the only authoritative closure
 * field. Readiness is derived from the graph by `readiness.ts` and is never
 * persisted as a solved flag, so a closed case that is edited into a loose
 * state immediately reports `Closed · loose threads` without clearing the
 * original timestamp.
 *
 * The module deliberately returns labels rather than JSX. The closure panel
 * and the shelf card both consume the same state, which keeps the case screen
 * and the shelf from disagreeing about what "closed" means.
 */

export type CaseLifecycleState = 'open-ready' | 'open-loose' | 'closed-ready' | 'closed-loose';

export interface CaseLifecycle {
  readonly state: CaseLifecycleState;
  readonly closed: boolean;
  readonly ready: boolean;
  readonly looseThreadCount: number;
  /** `Closed` or `Closed · loose threads`; null while the case is open. */
  readonly badgeLabel: string | null;
  /** `Ready to close` or `N loose threads`. */
  readonly readinessLabel: string;
  /** True only at zero loose threads, including re-affirming a closed case. */
  readonly canClose: boolean;
  /** Reopen exists only while `closedAt` is set; it is never automatic. */
  readonly canReopen: boolean;
  readonly closeLabel: string;
  /** Null when Close is enabled; otherwise the explanation shown with it. */
  readonly closeDisabledReason: string | null;
  /** True when a closed case has been edited into a loose state. */
  readonly showsLooseWarning: boolean;
}

/** The readiness fields lifecycle derivation needs. */
export type CaseReadinessInput = Pick<CaseReadiness, 'ready' | 'looseThreadCount'>;

function normalizeCount(count: number): number {
  if (!Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.trunc(count));
}

/** `0 loose threads`, `1 loose thread`, `4 loose threads`. */
export function looseThreadLabel(count: number): string {
  const normalized = normalizeCount(count);
  return `${normalized} ${normalized === 1 ? 'loose thread' : 'loose threads'}`;
}

/** What the panel announces when readiness changes. */
export function readinessLabelFor(readiness: CaseReadinessInput): string {
  return readiness.ready && normalizeCount(readiness.looseThreadCount) === 0
    ? 'Ready to close'
    : looseThreadLabel(readiness.looseThreadCount);
}

/**
 * Derive the complete closure view from `closedAt` and derived readiness.
 *
 * A closed case is never reopened here: an edit that breaks readiness only
 * changes the badge to `Closed · loose threads`. Reopen is a separate,
 * confirmed repository write.
 */
export function deriveCaseLifecycle(
  closedAt: string | null,
  readiness: CaseReadinessInput,
): CaseLifecycle {
  const looseThreadCount = normalizeCount(readiness.looseThreadCount);
  const ready = readiness.ready && looseThreadCount === 0;
  const closed = closedAt !== null;
  const state: CaseLifecycleState = closed
    ? ready
      ? 'closed-ready'
      : 'closed-loose'
    : ready
      ? 'open-ready'
      : 'open-loose';

  return {
    state,
    closed,
    ready,
    looseThreadCount,
    badgeLabel: closed ? (ready ? 'Closed' : 'Closed · loose threads') : null,
    readinessLabel: ready ? 'Ready to close' : looseThreadLabel(looseThreadCount),
    canClose: ready,
    canReopen: closed,
    closeLabel: closed ? 'Close again' : 'Close case',
    closeDisabledReason: ready
      ? null
      : `${looseThreadLabel(looseThreadCount)} must be resolved before this case can close.`,
    showsLooseWarning: closed && !ready,
  };
}

/**
 * The timestamp a close write should use.
 *
 * Re-affirming an already closed case after a repair keeps the original
 * closure date, so the case keeps telling the same story instead of silently
 * looking freshly closed.
 */
export function closureTimestamp(currentClosedAt: string | null, now: string): string {
  return currentClosedAt ?? now;
}
