/**
 * Coverage policy shared by the Vitest config and the release tests.
 *
 * This module is deliberately free of Node and Vite imports so tests can
 * import the policy without executing the full `vitest.config.ts` module
 * runner (which rewrites `import.meta.url`).
 */

/**
 * Line-coverage floor for the pure domain rules and the persistence layer.
 * These modules carry the data-integrity contract, so they are held to a
 * higher bar than the UI.
 */
export const DOMAIN_DATA_LINE_COVERAGE = 85;

/**
 * Directory aggregates must reach the line floor. `perFile.lines: 1` is
 * deliberate: every domain/data file is matched by the coverage include glob,
 * so a new file that no test imports is reported at 0% and fails even if the
 * directory aggregate is still healthy.
 */
export const domainDataCoverageThresholds = {
  'src/domain/**': {
    lines: DOMAIN_DATA_LINE_COVERAGE,
    perFile: { lines: 1 },
  },
  'src/data/**': {
    lines: DOMAIN_DATA_LINE_COVERAGE,
    perFile: { lines: 1 },
  },
};
