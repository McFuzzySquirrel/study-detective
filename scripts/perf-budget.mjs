#!/usr/bin/env node
/**
 * Initial JavaScript budget for the Notes Detective static build.
 *
 * The budget counts the Vite entry chunk plus every chunk it statically
 * imports (the shared runtime, React, the router, and other eager code). The
 * board and OCR features are lazy dynamic imports, so they are not part of the
 * initial graph and are not counted. If a future change makes either eager, it
 * becomes part of the static closure and is counted automatically; the script
 * never hides an eager chunk just because its name contains "board" or "ocr".
 *
 * This module has no third-party dependencies and reads only files emitted by
 * `vite build`. It performs no network request and never reads user content.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** 300 KiB, the documented initial-JavaScript budget. */
export const DEFAULT_BUDGET_BYTES = 300 * 1024;
export const DEFAULT_MANIFEST_PATH = 'dist/.vite/manifest.json';
export const GZIP_LEVEL = 9;

const BOARD_OR_OCR_PATTERN = /\bboard|\bocr|tesseract/i;

export class BudgetError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'BudgetError';
  }
}

function isJavaScriptFile(fileName) {
  return typeof fileName === 'string' && /\.(?:m?js)$/.test(fileName);
}

function toKib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * Load and validate the Vite manifest. A missing manifest is a build-order
 * failure, not an empty budget.
 */
export function loadManifest(manifestPath) {
  const absolutePath = resolve(manifestPath);

  if (!existsSync(absolutePath)) {
    throw new BudgetError(
      `Vite manifest not found at ${absolutePath}. Run "npm run build" before the budget check.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new BudgetError(`Vite manifest at ${absolutePath} is not valid JSON.`, {
      cause: error,
    });
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BudgetError('The Vite manifest must be a JSON object keyed by chunk name.');
  }

  return { absolutePath, manifest: parsed };
}

export function findEntryKeys(manifest) {
  const entries = Object.entries(manifest)
    .filter(([, chunk]) => chunk !== null && typeof chunk === 'object' && chunk.isEntry === true)
    .map(([key]) => key);

  if (entries.length === 0) {
    throw new BudgetError('The Vite manifest contains no entry chunk.');
  }

  return entries;
}

/**
 * Follow only `imports` (static imports). `dynamicImports` are lazy route,
 * board, and OCR chunks and are intentionally outside the initial graph.
 */
export function collectInitialChunkKeys(manifest, entryKeys) {
  const visited = new Set();
  const queue = [...entryKeys];

  while (queue.length > 0) {
    const key = queue.pop();
    if (key === undefined || visited.has(key)) {
      continue;
    }

    const chunk = manifest[key];
    if (chunk === null || typeof chunk !== 'object') {
      throw new BudgetError(`Chunk "${key}" is referenced but missing from the Vite manifest.`);
    }

    visited.add(key);

    const imports = chunk.imports;
    if (imports === undefined) {
      continue;
    }
    if (!Array.isArray(imports)) {
      throw new BudgetError(`Chunk "${key}" has a non-array imports field.`);
    }

    for (const imported of imports) {
      if (typeof imported !== 'string') {
        throw new BudgetError(`Chunk "${key}" has a non-string static import.`);
      }
      queue.push(imported);
    }
  }

  return [...visited];
}

/** Classify a non-initial chunk for the transparency report. */
export function isLazyBoardOrOcrChunk(key, chunk) {
  const haystack = [key, chunk.src, chunk.name]
    .filter((value) => typeof value === 'string')
    .join(' ');
  return BOARD_OR_OCR_PATTERN.test(haystack);
}

function resolveChunkFile(buildDirectory, fileName) {
  const absolute = resolve(buildDirectory, fileName);
  const prefix = buildDirectory.endsWith(sep) ? buildDirectory : `${buildDirectory}${sep}`;

  if (absolute !== buildDirectory && !absolute.startsWith(prefix)) {
    throw new BudgetError(`Chunk file "${fileName}" escapes the build directory.`);
  }

  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new BudgetError(
      `Chunk file "${fileName}" is missing from ${buildDirectory}. Run "npm run build" again.`,
    );
  }

  return absolute;
}

/** Deterministic gzip size of one emitted JavaScript file. */
export function readGzipBytes(buildDirectory, fileName) {
  const absolute = resolveChunkFile(buildDirectory, fileName);
  return gzipSync(readFileSync(absolute), { level: GZIP_LEVEL }).length;
}

/**
 * Compute the initial JavaScript budget from a Vite manifest.
 *
 * Returned sizes are gzip bytes for each initial chunk plus the excluded lazy
 * board/OCR chunks. `pass` is true only when the initial total is at or below
 * `budgetBytes`.
 */
export function computeInitialBudget({
  manifestPath = DEFAULT_MANIFEST_PATH,
  budgetBytes = DEFAULT_BUDGET_BYTES,
} = {}) {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    throw new BudgetError(`The budget must be a positive number of bytes, got ${budgetBytes}.`);
  }

  const { absolutePath, manifest } = loadManifest(manifestPath);
  const buildDirectory = dirname(dirname(absolutePath));
  const entryKeys = new Set(findEntryKeys(manifest));
  const initialKeys = collectInitialChunkKeys(manifest, [...entryKeys]);

  const chunks = initialKeys
    .map((key) => {
      const chunk = manifest[key];
      const fileName = chunk.file;
      if (!isJavaScriptFile(fileName)) {
        throw new BudgetError(
          `Initial chunk "${key}" does not emit JavaScript (file: ${String(fileName)}).`,
        );
      }

      return {
        key,
        file: fileName,
        kind: entryKeys.has(key) ? 'entry' : 'shared',
        gzipBytes: readGzipBytes(buildDirectory, fileName),
      };
    })
    .sort((first, second) => second.gzipBytes - first.gzipBytes);

  const excluded = Object.entries(manifest)
    .filter(([key]) => !initialKeys.includes(key))
    .filter(([key, chunk]) => isLazyBoardOrOcrChunk(key, chunk))
    .map(([key, chunk]) => {
      const fileName = chunk.file;
      return {
        key,
        file: typeof fileName === 'string' ? fileName : '',
        gzipBytes:
          typeof fileName === 'string' && isJavaScriptFile(fileName)
            ? readGzipBytes(buildDirectory, fileName)
            : 0,
      };
    })
    .sort((first, second) => second.gzipBytes - first.gzipBytes);

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);

  return {
    manifestPath: absolutePath,
    buildDirectory,
    budgetBytes,
    totalBytes,
    totalKib: Number((totalBytes / 1024).toFixed(1)),
    pass: totalBytes <= budgetBytes,
    entries: chunks.filter((chunk) => chunk.kind === 'entry'),
    chunks,
    excluded,
  };
}

/** Human-readable report with one line per counted chunk. */
export function formatBudgetReport(result) {
  const lines = [
    'Initial JavaScript budget',
    `manifest: ${result.manifestPath}`,
    `budget:   ${toKib(result.budgetBytes)} (${result.budgetBytes} bytes gzip)`,
    '',
    ...result.chunks.map(
      (chunk) =>
        `  ${chunk.kind.padEnd(7)} ${chunk.file.padEnd(42)} ${toKib(chunk.gzipBytes).padStart(10)}`,
    ),
    '',
    `  total   ${'initial JavaScript'.padEnd(42)} ${toKib(result.totalBytes).padStart(10)}`,
  ];

  if (result.excluded.length > 0) {
    const excludedTotal = result.excluded.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
    lines.push(
      `  excluded lazy board/OCR: ${result.excluded.length} chunk(s), ${toKib(excludedTotal)}`,
    );
  }

  lines.push(
    result.pass
      ? `PASS: initial JavaScript ${toKib(result.totalBytes)} <= ${toKib(result.budgetBytes)}.`
      : `FAIL: initial JavaScript ${toKib(result.totalBytes)} exceeds the ${toKib(result.budgetBytes)} budget by ${toKib(result.totalBytes - result.budgetBytes)}.`,
  );

  return lines.join('\n');
}

function readOption(argv, index, name) {
  const argument = argv[index];
  const prefix = `--${name}=`;
  if (argument.startsWith(prefix)) {
    return { value: argument.slice(prefix.length), consumed: 1 };
  }
  if (argument === `--${name}`) {
    const value = argv[index + 1];
    if (value === undefined) {
      throw new BudgetError(`Option --${name} requires a value.`);
    }
    return { value, consumed: 2 };
  }
  return null;
}

export function parseArguments(argv) {
  const options = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    budgetBytes: DEFAULT_BUDGET_BYTES,
    json: false,
    help: false,
  };

  let index = 0;
  while (index < argv.length) {
    const argument = argv[index];
    if (argument === undefined) {
      break;
    }

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      index += 1;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      index += 1;
      continue;
    }

    const manifest = readOption(argv, index, 'manifest');
    if (manifest !== null) {
      options.manifestPath = manifest.value;
      index += manifest.consumed;
      continue;
    }

    const budgetKb = readOption(argv, index, 'budget-kb');
    if (budgetKb !== null) {
      const value = Number(budgetKb.value);
      if (!Number.isFinite(value) || value <= 0) {
        throw new BudgetError(`--budget-kb must be a positive number, got ${budgetKb.value}.`);
      }
      options.budgetBytes = Math.round(value * 1024);
      index += budgetKb.consumed;
      continue;
    }

    const budget = readOption(argv, index, 'budget-bytes');
    if (budget !== null) {
      const value = Number(budget.value);
      if (!Number.isInteger(value) || value <= 0) {
        throw new BudgetError(`--budget-bytes must be a positive integer, got ${budget.value}.`);
      }
      options.budgetBytes = value;
      index += budget.consumed;
      continue;
    }

    throw new BudgetError(`Unknown argument "${argument}". Use --help for usage.`);
  }

  return options;
}

const USAGE = `Usage: node scripts/perf-budget.mjs [options]

Options:
  --manifest <path>    Vite manifest (default: ${DEFAULT_MANIFEST_PATH})
  --budget-kb <n>      Budget in KiB gzip (default: 300)
  --budget-bytes <n>   Exact byte budget, useful for threshold tests
  --json               Print machine-readable JSON to stdout
  -h, --help           Show this help

Only the entry chunk and its statically imported chunks are counted. Lazy
board and OCR dynamic chunks are reported separately and never counted.`;

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const result = computeInitialBudget(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatBudgetReport(result));
  }

  if (!result.pass) {
    console.error(
      `Initial JavaScript ${toKib(result.totalBytes)} exceeds the ${toKib(result.budgetBytes)} budget.`,
    );
    return 1;
  }

  return 0;
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Perf budget check failed: ${message}`);
    process.exitCode = 1;
  }
}
