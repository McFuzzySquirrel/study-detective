import { describe, expect, it } from 'vitest';

import {
  closureTimestamp,
  deriveCaseLifecycle,
  looseThreadLabel,
  readinessLabelFor,
} from '../../src/domain/caseLifecycle';

const CLOSED_AT = '2026-10-05T11:00:00.000Z';
const NOW = '2026-10-26T12:00:00.000Z';
const READY = { ready: true, looseThreadCount: 0 } as const;
const TWO_LOOSE = { ready: false, looseThreadCount: 2 } as const;

describe('looseThreadLabel', () => {
  it('uses singular and plural copy and normalizes unusable counts', () => {
    expect(looseThreadLabel(0)).toBe('0 loose threads');
    expect(looseThreadLabel(1)).toBe('1 loose thread');
    expect(looseThreadLabel(4)).toBe('4 loose threads');
    expect(looseThreadLabel(-3)).toBe('0 loose threads');
    expect(looseThreadLabel(Number.NaN)).toBe('0 loose threads');
    expect(looseThreadLabel(2.8)).toBe('2 loose threads');
  });

  it('describes derived readiness for an announcement', () => {
    expect(readinessLabelFor(READY)).toBe('Ready to close');
    expect(readinessLabelFor({ ready: false, looseThreadCount: 1 })).toBe('1 loose thread');
    // The count and the derived flag are both inputs: a stale ready flag cannot
    // hide a nonzero loose-thread count.
    expect(readinessLabelFor({ ready: true, looseThreadCount: 1 })).toBe('1 loose thread');
  });
});

describe('deriveCaseLifecycle', () => {
  it('marks an open, ready case with no badge and an enabled Close', () => {
    const lifecycle = deriveCaseLifecycle(null, READY);

    expect(lifecycle.state).toBe('open-ready');
    expect(lifecycle.closed).toBe(false);
    expect(lifecycle.ready).toBe(true);
    expect(lifecycle.badgeLabel).toBeNull();
    expect(lifecycle.readinessLabel).toBe('Ready to close');
    expect(lifecycle.canClose).toBe(true);
    expect(lifecycle.canReopen).toBe(false);
    expect(lifecycle.closeLabel).toBe('Close case');
    expect(lifecycle.closeDisabledReason).toBeNull();
    expect(lifecycle.showsLooseWarning).toBe(false);
  });

  it('disables Close on an open case with loose threads and explains the count', () => {
    const lifecycle = deriveCaseLifecycle(null, TWO_LOOSE);

    expect(lifecycle.state).toBe('open-loose');
    expect(lifecycle.badgeLabel).toBeNull();
    expect(lifecycle.readinessLabel).toBe('2 loose threads');
    expect(lifecycle.canClose).toBe(false);
    expect(lifecycle.closeDisabledReason).toBe(
      '2 loose threads must be resolved before this case can close.',
    );
  });

  it('marks a closed, ready case with the stamped badge and Reopen action', () => {
    const lifecycle = deriveCaseLifecycle(CLOSED_AT, READY);

    expect(lifecycle.state).toBe('closed-ready');
    expect(lifecycle.closed).toBe(true);
    expect(lifecycle.badgeLabel).toBe('Closed');
    expect(lifecycle.readinessLabel).toBe('Ready to close');
    expect(lifecycle.canClose).toBe(true);
    expect(lifecycle.canReopen).toBe(true);
    expect(lifecycle.closeLabel).toBe('Close again');
    expect(lifecycle.showsLooseWarning).toBe(false);
  });

  it('keeps a closed case closed when an edit introduces loose threads', () => {
    const lifecycle = deriveCaseLifecycle(CLOSED_AT, TWO_LOOSE);

    expect(lifecycle.state).toBe('closed-loose');
    expect(lifecycle.closed).toBe(true);
    expect(lifecycle.badgeLabel).toBe('Closed · loose threads');
    expect(lifecycle.canClose).toBe(false);
    expect(lifecycle.canReopen).toBe(true);
    expect(lifecycle.closeLabel).toBe('Close again');
    expect(lifecycle.showsLooseWarning).toBe(true);
    // There is no lifecycle transition that clears closedAt on its own.
    expect(deriveCaseLifecycle(CLOSED_AT, TWO_LOOSE).closed).toBe(true);
  });

  it('re-enables Close for a closed case after the graph is repaired', () => {
    const repaired = deriveCaseLifecycle(CLOSED_AT, READY);

    expect(repaired.state).toBe('closed-ready');
    expect(repaired.canClose).toBe(true);
    expect(repaired.canReopen).toBe(true);
    expect(repaired.badgeLabel).toBe('Closed');
  });

  it('never claims closure for a case whose readiness flag and count disagree', () => {
    const lifecycle = deriveCaseLifecycle(null, { ready: true, looseThreadCount: 1 });

    expect(lifecycle.state).toBe('open-loose');
    expect(lifecycle.ready).toBe(false);
    expect(lifecycle.canClose).toBe(false);
  });
});

describe('closureTimestamp', () => {
  it('stamps a first close and preserves an existing closure date', () => {
    expect(closureTimestamp(null, NOW)).toBe(NOW);
    expect(closureTimestamp(CLOSED_AT, NOW)).toBe(CLOSED_AT);
  });
});
