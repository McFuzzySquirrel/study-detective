/**
 * Shared axe configuration for the browser accessibility gate.
 *
 * A11Y-FR-05 requires zero serious or critical violations on the shelf, board,
 * card detail, recall, search, and settings screens, including open dialogs and
 * sheets. The Playwright spec imports this module so the screen list, the
 * blocking-impact threshold, the deliberate exclusions, and the failure format
 * cannot drift between the scan and its evidence.
 *
 * This module is data and pure functions on purpose: the browser spec owns the
 * page, and Vitest can import the same contract without starting a browser.
 */

import type { AxeResults, Result, RunOptions } from 'axe-core';

/** The six named primary screens in A11Y-FR-05. */
export const AXE_PRIMARY_SCREENS = [
  'shelf',
  'board',
  'card-detail',
  'recall',
  'search',
  'settings',
] as const;

export type AxePrimaryScreen = (typeof AXE_PRIMARY_SCREENS)[number];

/**
 * Overlay surfaces that must be scanned while open. A base-page-only scan
 * misses dialog labels, focus traps, sheet controls, and hint popovers.
 */
export const AXE_OVERLAY_SURFACES = [
  'shelf-create-case-dialog',
  'shelf-backup-dialog',
  'shelf-backup-import-view',
  'shelf-delete-dialog',
  'board-shortcut-help-dialog',
  'board-backup-dialog',
  'board-context-hint',
  'card-title-dialog',
  'card-tags-dialog',
  'card-delete-dialog',
  'connection-picker-dialog',
  'settings-replay-hint',
  'phone-case-actions-sheet',
  'phone-search-sheet',
  'phone-closure-sheet',
  'phone-card-actions-sheet',
] as const;

export type AxeOverlaySurface = (typeof AXE_OVERLAY_SURFACES)[number];

/** Only these impacts fail the gate. Moderate and minor findings are reported. */
export const AXE_BLOCKING_IMPACTS = ['serious', 'critical'] as const;

export type AxeBlockingImpact = (typeof AXE_BLOCKING_IMPACTS)[number];

/**
 * No DOM selector is excluded from any scan. The board's canvas host, its
 * role/label/description, its zoom controls, minimap, and card-list links stay
 * in scope, as do every dialog, sheet, and interactive control.
 *
 * If a future exclusion becomes unavoidable, add the selector here with a
 * documented reason in AXE_DELIBERATE_EXCLUSIONS and keep it off interactive
 * controls. The browser spec records this list in every scan's evidence.
 */
export const AXE_EXCLUDED_SELECTORS: readonly string[] = [];

export interface AxeDeliberateExclusion {
  /** The area that automated analysis cannot cover. */
  readonly area: string;
  /** Why axe cannot evaluate it. */
  readonly reason: string;
  /** What remains in the automated scan so no control is hidden. */
  readonly includedInstead: string;
}

/**
 * Deliberate limits of an automated DOM scan. These are not selector
 * exclusions: nothing in the document is removed from analysis.
 */
export const AXE_DELIBERATE_EXCLUSIONS: readonly AxeDeliberateExclusion[] = [
  {
    area: 'Canvas pixel content (painted cards, strings, pin shapes, and minimap pixels)',
    reason:
      'axe evaluates the DOM and accessibility tree, not WebGL raster output, so the pixels drawn by PixiJS cannot be inspected for contrast, overlap, or readable text.',
    includedInstead:
      'The canvas host keeps its accessible name and description, the generated canvas keeps role="img" and its label, and every board control, minimap control, card-list link, status message, and empty/error state remains in the scan. Spatial screen-reader parity is a human review item, not an axe claim.',
  },
  {
    area: 'Browser-native surfaces (file picker, download shelf, and the OS save dialog)',
    reason:
      'Those surfaces belong to the browser or operating system and are outside the page document that axe injects into.',
    includedInstead:
      'The app-owned file input, its visible label and hint, the export/import progress regions, and every dialog button remain in the scan.',
  },
];

/**
 * Run every axe rule and return only the result groups evidence needs. This
 * keeps CDP payloads small without weakening coverage: no rule is disabled and
 * no WCAG tag filter is applied, so a serious best-practice finding still
 * fails the gate.
 */
export const AXE_RUN_OPTIONS: RunOptions = {
  resultTypes: ['violations', 'incomplete'],
  reporter: 'v2',
};

/** A violation reduced to selector targets, with no user content or HTML. */
export interface AxeViolationSummary {
  readonly id: string;
  readonly impact: string;
  readonly help: string;
  readonly helpUrl: string;
  readonly targets: readonly (readonly string[])[];
}

export interface AxeScanSummary {
  readonly violations: readonly AxeViolationSummary[];
  readonly incomplete: readonly AxeViolationSummary[];
  readonly blocking: readonly AxeViolationSummary[];
}

export function isBlockingImpact(impact: string | null | undefined): boolean {
  return impact === 'serious' || impact === 'critical';
}

function summarizeViolation(violation: Result): AxeViolationSummary {
  return {
    id: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    helpUrl: violation.helpUrl,
    // Selectors only. The HTML and failure summary can contain card titles,
    // OCR text, or file names, which must never reach logs or artifacts.
    targets: violation.nodes.map((node) => node.target.map((target) => String(target))),
  };
}

/** Filter a raw axe result down to the blocking threshold and safe metadata. */
export function summarizeAxeResults(
  results: Pick<AxeResults, 'violations' | 'incomplete'>,
): AxeScanSummary {
  const violations = results.violations.map(summarizeViolation);
  const incomplete = results.incomplete.map(summarizeViolation);

  return {
    violations,
    incomplete,
    blocking: violations.filter((violation) => isBlockingImpact(violation.impact)),
  };
}

/** A deterministic failure message naming the scan and each blocking rule. */
export function formatAxeFailure(
  surface: string,
  blocking: readonly AxeViolationSummary[],
): string {
  if (blocking.length === 0) {
    return `axe ${surface} scan found no blocking violations`;
  }

  const detail = blocking
    .map((violation) => {
      const targets = violation.targets.map((target) => target.join(' ')).join(' | ');
      return `- [${violation.impact}] ${violation.id}: ${violation.help} — ${targets}`;
    })
    .join('\n');

  return `axe ${surface} scan found ${blocking.length} serious/critical violation(s):\n${detail}`;
}
