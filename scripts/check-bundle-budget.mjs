#!/usr/bin/env node
/**
 * Service-worker precache budget for the Notes Detective static build.
 *
 * `vite-plugin-pwa` generates `dist/sw.js` with a Workbox
 * `precacheAndRoute([...])` manifest. This script reads that manifest (not a
 * guessed file list), resolves every entry inside the build directory, sums
 * the emitted bytes, and fails when the total exceeds 25 MB. A missing file or
 * a URL that escapes the build directory is a hard failure too: a manifest that
 * silently under-counts would make the budget meaningless.
 *
 * The budget covers the *total service-worker precache*, including the shell,
 * icons, lazy chunks, and the bundled OCR worker/wasm/traineddata. The separate
 * initial-JavaScript budget lives in `scripts/perf-budget.mjs`.
 *
 * The script has no third-party dependencies, performs no network request, and
 * never reads application content beyond the generated build output.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 25 MiB, the documented total precache budget. */
export const DEFAULT_PRECACHE_BUDGET_BYTES = 25 * 1024 * 1024;
export const DEFAULT_SW_PATH = 'dist/sw.js';
export const PRECACHE_CALL_PATTERN = /precacheAndRoute\s*\(\s*\[/;

export class PrecacheBudgetError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PrecacheBudgetError';
  }
}

function toMib(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function toKib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function isWhitespace(character) {
  return /\s/.test(character);
}

function skipWhitespaceAndComments(source, index) {
  let cursor = index;

  while (cursor < source.length) {
    const character = source[cursor];

    if (isWhitespace(character)) {
      cursor += 1;
      continue;
    }

    if (character === '/' && source[cursor + 1] === '/') {
      cursor += 2;
      while (cursor < source.length && source[cursor] !== '\n') {
        cursor += 1;
      }
      continue;
    }

    if (character === '/' && source[cursor + 1] === '*') {
      const end = source.indexOf('*/', cursor + 2);
      if (end === -1) {
        throw new PrecacheBudgetError('The generated service worker has an unterminated comment.');
      }
      cursor = end + 2;
      continue;
    }

    break;
  }

  return cursor;
}

/**
 * Read a JavaScript string literal. Workbox emits double-quoted strings; single
 * quotes are accepted as well so a formatter change does not break the check.
 * Template literals are rejected: a dynamic URL cannot be budgeted statically.
 */
function readStringLiteral(source, index) {
  const quote = source[index];
  if (quote !== '"' && quote !== "'") {
    throw new PrecacheBudgetError(
      `Expected a quoted string in the precache manifest at offset ${index}.`,
    );
  }

  let cursor = index + 1;
  let value = '';

  while (cursor < source.length) {
    const character = source[cursor];

    if (character === quote) {
      return { value, nextIndex: cursor + 1 };
    }

    if (character !== '\\') {
      value += character;
      cursor += 1;
      continue;
    }

    const escape = source[cursor + 1];
    if (escape === undefined) {
      break;
    }

    const simpleEscapes = {
      '"': '"',
      "'": "'",
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      0: '\0',
    };

    if (Object.hasOwn(simpleEscapes, escape)) {
      value += simpleEscapes[escape];
      cursor += 2;
      continue;
    }

    if (escape === 'u') {
      const hex = source.slice(cursor + 2, cursor + 6);
      if (!/^[0-9a-f]{4}$/i.test(hex)) {
        throw new PrecacheBudgetError(`Invalid unicode escape in the precache manifest: \\u${hex}`);
      }
      value += String.fromCharCode(Number.parseInt(hex, 16));
      cursor += 6;
      continue;
    }

    if (escape === 'x') {
      const hex = source.slice(cursor + 2, cursor + 4);
      if (!/^[0-9a-f]{2}$/i.test(hex)) {
        throw new PrecacheBudgetError(`Invalid hex escape in the precache manifest: \\x${hex}`);
      }
      value += String.fromCharCode(Number.parseInt(hex, 16));
      cursor += 4;
      continue;
    }

    // Preserve an unknown escape rather than dropping it silently.
    value += escape;
    cursor += 2;
  }

  throw new PrecacheBudgetError(
    `Unterminated string literal in the precache manifest at offset ${index}.`,
  );
}

/**
 * Find the matching close bracket for an array or object literal, ignoring
 * brackets inside strings and comments.
 */
function findMatchingBracket(source, openIndex) {
  const open = source[openIndex];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;

  if (close === null) {
    throw new PrecacheBudgetError(`Expected an array or object at offset ${openIndex}.`);
  }

  let depth = 0;
  let cursor = openIndex;

  while (cursor < source.length) {
    const character = source[cursor];

    if (character === '"' || character === "'") {
      cursor = readStringLiteral(source, cursor).nextIndex;
      continue;
    }

    if (character === '/' && (source[cursor + 1] === '/' || source[cursor + 1] === '*')) {
      cursor = skipWhitespaceAndComments(source, cursor);
      continue;
    }

    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }

    cursor += 1;
  }

  throw new PrecacheBudgetError(`Unterminated ${open} literal in the precache manifest.`);
}

/** Extract the array literal passed to `precacheAndRoute([...])`. */
export function extractPrecacheArray(swSource) {
  if (typeof swSource !== 'string' || swSource.length === 0) {
    throw new PrecacheBudgetError('The service worker source is empty.');
  }

  const match = PRECACHE_CALL_PATTERN.exec(swSource);
  if (match === null) {
    throw new PrecacheBudgetError(
      'The service worker has no precacheAndRoute([...]) manifest. Run "npm run build" to regenerate it.',
    );
  }

  const openIndex = swSource.indexOf('[', match.index);
  const closeIndex = findMatchingBracket(swSource, openIndex);

  return swSource.slice(openIndex, closeIndex + 1);
}

function parseValue(source, index) {
  const cursor = skipWhitespaceAndComments(source, index);
  const character = source[cursor];

  if (character === undefined) {
    throw new PrecacheBudgetError('Unexpected end of the precache manifest.');
  }

  if (character === '"' || character === "'") {
    const { value, nextIndex } = readStringLiteral(source, cursor);
    return { value, nextIndex };
  }

  if (character === '{' || character === '[') {
    const closeIndex = findMatchingBracket(source, cursor);
    return { value: source.slice(cursor, closeIndex + 1), nextIndex: closeIndex + 1 };
  }

  const remainder = source.slice(cursor);
  const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
    remainder,
  );

  if (literal === null) {
    throw new PrecacheBudgetError(
      `Unexpected token in the precache manifest near "${remainder.slice(0, 24)}".`,
    );
  }

  const raw = literal[0];
  const value =
    raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : Number(raw);

  return { value, nextIndex: cursor + raw.length };
}

function parseObjectFields(source, openIndex) {
  const fields = new Map();
  let cursor = skipWhitespaceAndComments(source, openIndex + 1);

  while (cursor < source.length) {
    const character = source[cursor];

    if (character === '}') {
      return { fields, nextIndex: cursor + 1 };
    }

    let key;
    if (character === '"' || character === "'") {
      const read = readStringLiteral(source, cursor);
      key = read.value;
      cursor = skipWhitespaceAndComments(source, read.nextIndex);
    } else {
      const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(cursor));
      if (identifier === null) {
        throw new PrecacheBudgetError(
          `Invalid object key in the precache manifest near offset ${cursor}.`,
        );
      }
      key = identifier[0];
      cursor = skipWhitespaceAndComments(source, cursor + key.length);
    }

    if (source[cursor] !== ':') {
      throw new PrecacheBudgetError(`Expected ":" after "${key}" in the precache manifest.`);
    }

    const parsed = parseValue(source, cursor + 1);
    fields.set(key, parsed.value);
    cursor = skipWhitespaceAndComments(source, parsed.nextIndex);

    if (source[cursor] === ',') {
      cursor = skipWhitespaceAndComments(source, cursor + 1);
      continue;
    }

    if (source[cursor] === '}') {
      return { fields, nextIndex: cursor + 1 };
    }

    throw new PrecacheBudgetError(
      `Expected "," or "}" in the precache manifest near offset ${cursor}.`,
    );
  }

  throw new PrecacheBudgetError('Unterminated precache entry in the service worker.');
}

function normalizePrecacheUrl(value) {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new PrecacheBudgetError('A precache entry has an empty url.');
  }

  if (trimmed.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new PrecacheBudgetError(
      `The precache manifest contains an absolute URL, which is not served from the build: ${trimmed}`,
    );
  }

  if (trimmed.startsWith('/')) {
    throw new PrecacheBudgetError(
      `The precache manifest contains a root-absolute URL, which breaks a subpath deployment: ${trimmed}`,
    );
  }

  if (trimmed.includes('\\')) {
    throw new PrecacheBudgetError(`The precache manifest contains a backslash path: ${trimmed}`);
  }

  const withoutPrefix = trimmed.replace(/^\.\//, '');
  const withoutQuery = withoutPrefix.split(/[?#]/, 1)[0];

  if (withoutQuery === undefined || withoutQuery.length === 0 || withoutQuery === '.') {
    throw new PrecacheBudgetError(`The precache manifest contains an unusable URL: ${trimmed}`);
  }

  if (withoutQuery.split('/').some((segment) => segment === '..')) {
    throw new PrecacheBudgetError(
      `The precache manifest URL escapes the build directory: ${trimmed}`,
    );
  }

  return withoutQuery;
}

/**
 * Parse the Workbox precache manifest array from the generated service worker.
 * Every entry must have a string `url`; `revision` is a string or null. Extra
 * fields (for example `integrity`) are tolerated.
 */
export function parsePrecacheManifest(swSource) {
  const arraySource = extractPrecacheArray(swSource);
  const entries = [];
  const seen = new Set();
  let cursor = skipWhitespaceAndComments(arraySource, 1);

  if (arraySource[cursor] === ']') {
    throw new PrecacheBudgetError('The precache manifest contains no entries.');
  }

  while (cursor < arraySource.length) {
    const character = arraySource[cursor];

    if (character === ']') {
      break;
    }

    if (character !== '{') {
      throw new PrecacheBudgetError(
        `Expected a precache entry object near "${arraySource.slice(cursor, cursor + 24)}".`,
      );
    }

    const { fields, nextIndex } = parseObjectFields(arraySource, cursor);
    const url = fields.get('url');
    const revision = fields.has('revision') ? fields.get('revision') : null;

    if (typeof url !== 'string') {
      throw new PrecacheBudgetError('A precache entry is missing a string url.');
    }

    if (revision !== null && typeof revision !== 'string') {
      throw new PrecacheBudgetError(`The precache entry for "${url}" has a non-string revision.`);
    }

    const normalizedUrl = normalizePrecacheUrl(url);
    if (seen.has(normalizedUrl)) {
      throw new PrecacheBudgetError(`The precache manifest lists "${normalizedUrl}" twice.`);
    }
    seen.add(normalizedUrl);

    entries.push({ url: normalizedUrl, revision });

    cursor = skipWhitespaceAndComments(arraySource, nextIndex);
    if (arraySource[cursor] === ',') {
      cursor = skipWhitespaceAndComments(arraySource, cursor + 1);
      continue;
    }
    if (arraySource[cursor] !== ']') {
      throw new PrecacheBudgetError(
        `Expected "," or "]" after a precache entry near offset ${cursor}.`,
      );
    }
  }

  if (entries.length === 0) {
    throw new PrecacheBudgetError('The precache manifest contains no entries.');
  }

  return entries;
}

function resolvePrecacheFile(buildDirectory, url) {
  const absolutePath = resolve(buildDirectory, url);
  const prefix = buildDirectory.endsWith(sep) ? buildDirectory : `${buildDirectory}${sep}`;

  if (absolutePath !== buildDirectory && !absolutePath.startsWith(prefix)) {
    throw new PrecacheBudgetError(`The precache URL "${url}" escapes the build directory.`);
  }

  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new PrecacheBudgetError(
      `The precache manifest lists "${url}", but the file is missing from the build. Run "npm run build" again.`,
    );
  }

  return { absolutePath, bytes: statSync(absolutePath).size };
}

/**
 * Read a generated service worker, resolve every precache entry, and compare
 * the total emitted bytes with the budget. Throws when the manifest cannot be
 * read or an entry does not resolve to a file in the build.
 */
export function computePrecacheBudget({
  swPath = DEFAULT_SW_PATH,
  distDirectory,
  budgetBytes = DEFAULT_PRECACHE_BUDGET_BYTES,
} = {}) {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    throw new PrecacheBudgetError(
      `The budget must be a positive number of bytes, got ${budgetBytes}.`,
    );
  }

  const absoluteSwPath = resolve(swPath);

  if (!existsSync(absoluteSwPath) || !statSync(absoluteSwPath).isFile()) {
    throw new PrecacheBudgetError(
      `Service worker not found at ${absoluteSwPath}. Run "npm run build" before the budget check.`,
    );
  }

  const buildDirectory = resolve(distDirectory ?? dirname(absoluteSwPath));
  const swBytes = statSync(absoluteSwPath).size;
  const swSource = readFileSync(absoluteSwPath, 'utf8');
  const entries = parsePrecacheManifest(swSource).map((entry) => {
    const file = resolvePrecacheFile(buildDirectory, entry.url);
    return {
      url: entry.url,
      revision: entry.revision,
      file: file.absolutePath,
      bytes: file.bytes,
    };
  });

  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const largest = [...entries].sort((first, second) => second.bytes - first.bytes);

  return {
    ok: totalBytes <= budgetBytes,
    swPath: absoluteSwPath,
    swBytes,
    buildDirectory,
    budgetBytes,
    totalBytes,
    totalMib: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    entryCount: entries.length,
    pass: totalBytes <= budgetBytes,
    entries,
    largest: largest.slice(0, 10),
  };
}

/** Human-readable report with one line per precached file. */
export function formatPrecacheBudgetReport(result) {
  const lines = [
    'Service-worker precache budget',
    `service worker: ${result.swPath}`,
    `build dir:      ${result.buildDirectory}`,
    `budget:         ${toMib(result.budgetBytes)} (${result.budgetBytes} bytes)`,
    `entries:        ${result.entryCount}`,
    '',
    ...result.entries.map(
      (entry) => `  ${entry.url.padEnd(62)} ${toKib(entry.bytes).padStart(12)}`,
    ),
    '',
    `  total ${'service-worker precache'.padEnd(61)} ${toKib(result.totalBytes).padStart(12)} (${toMib(result.totalBytes)})`,
    '',
  ];

  lines.push(
    result.pass
      ? `PASS: precache ${toMib(result.totalBytes)} <= ${toMib(result.budgetBytes)} budget.`
      : `FAIL: precache ${toMib(result.totalBytes)} exceeds the ${toMib(result.budgetBytes)} budget by ${toMib(result.totalBytes - result.budgetBytes)}.`,
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
      throw new PrecacheBudgetError(`Option --${name} requires a value.`);
    }
    return { value, consumed: 2 };
  }

  return null;
}

export function parseArguments(argv) {
  const options = {
    swPath: DEFAULT_SW_PATH,
    distDirectory: undefined,
    budgetBytes: DEFAULT_PRECACHE_BUDGET_BYTES,
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

    const sw = readOption(argv, index, 'sw');
    if (sw !== null) {
      options.swPath = sw.value;
      index += sw.consumed;
      continue;
    }

    const dist = readOption(argv, index, 'dist');
    if (dist !== null) {
      options.distDirectory = dist.value;
      index += dist.consumed;
      continue;
    }

    const budgetKb = readOption(argv, index, 'budget-kb');
    if (budgetKb !== null) {
      const value = Number(budgetKb.value);
      if (!Number.isFinite(value) || value <= 0) {
        throw new PrecacheBudgetError(
          `--budget-kb must be a positive number, got ${budgetKb.value}.`,
        );
      }
      options.budgetBytes = Math.round(value * 1024);
      index += budgetKb.consumed;
      continue;
    }

    const budget = readOption(argv, index, 'budget-bytes');
    if (budget !== null) {
      const value = Number(budget.value);
      if (!Number.isInteger(value) || value <= 0) {
        throw new PrecacheBudgetError(
          `--budget-bytes must be a positive integer, got ${budget.value}.`,
        );
      }
      options.budgetBytes = value;
      index += budget.consumed;
      continue;
    }

    throw new PrecacheBudgetError(`Unknown argument "${argument}". Use --help for usage.`);
  }

  return options;
}

const USAGE = `Usage: node scripts/check-bundle-budget.mjs [options]

Reads the Workbox precache manifest in the generated service worker and fails
when the total emitted bytes exceed the budget.

Options:
  --sw <path>          Generated service worker (default: ${DEFAULT_SW_PATH})
  --dist <path>        Build directory containing the precached files
                       (default: the service worker's directory)
  --budget-kb <n>      Budget in KiB (default: 25600 = 25 MiB)
  --budget-bytes <n>   Exact byte budget, useful for threshold tests
  --json               Print machine-readable JSON to stdout
  -h, --help           Show this help

The total counts every entry in the service-worker precache, including lazily
loaded board/OCR chunks and the bundled OCR worker, wasm, and traineddata.`;

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const result = computePrecacheBudget(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPrecacheBudgetReport(result));
  }

  if (!result.pass) {
    console.error(
      `Precache ${toMib(result.totalBytes)} (${result.totalBytes} bytes) exceeds the ${toMib(result.budgetBytes)} (${result.budgetBytes} bytes) budget.`,
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
    console.error(`Precache budget check failed: ${message}`);
    process.exitCode = 1;
  }
}
