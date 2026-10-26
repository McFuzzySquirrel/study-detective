#!/usr/bin/env node
/**
 * Fail the build when the bundled OCR path is incomplete or can reach a
 * third-party origin.
 *
 * Checks:
 * - all four required files exist under public/ocr and are non-empty;
 * - the wasm binary is a plausible size, not an HTML error page;
 * - no OCR source file mentions an external http(s) origin;
 * - when dist exists, the same four files were emitted into dist/ocr.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveProjectRoot() {
  try {
    return fileURLToPath(new URL('..', import.meta.url));
  } catch {
    // Vitest imports this module through Vite, where import.meta.url is not
    // necessarily a file URL. The test process still runs from the project root.
    return process.cwd();
  }
}

function resolveModulePath() {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return null;
  }
}

export const PROJECT_ROOT = resolveProjectRoot();

export const REQUIRED_OCR_ASSETS = Object.freeze([
  'worker.min.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'eng.traineddata.gz',
]);

/** A real simd-lstm wasm core is megabytes; an error page is not. */
export const MIN_WASM_BYTES = 512 * 1024;

export const OCR_SOURCE_DIRECTORY = 'src/features/ocr';

/** Any absolute http(s) URL in the OCR module is an offline/runtime failure. */
export const EXTERNAL_ORIGIN_PATTERN = /https?:\/\/[^\s'"`)>]+/gi;

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(path));
    } else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function inspectAssetFile(directory, fileName, errors, minWasmBytes) {
  const filePath = join(directory, fileName);
  if (!existsSync(filePath)) {
    errors.push(`Missing OCR asset: ${filePath}`);
    return null;
  }

  const stats = statSync(filePath);
  if (!stats.isFile() || stats.size === 0) {
    errors.push(`OCR asset is empty or not a file: ${filePath}`);
    return null;
  }

  if (fileName.endsWith('.wasm') && stats.size < minWasmBytes) {
    errors.push(
      `OCR wasm core looks truncated at ${stats.size} bytes (expected at least ${minWasmBytes}): ${filePath}`,
    );
  }

  return { filePath, bytes: stats.size };
}

function inspectAssetDirectory(directory, { errors, minWasmBytes }) {
  const assets = [];
  for (const fileName of REQUIRED_OCR_ASSETS) {
    const asset = inspectAssetFile(directory, fileName, errors, minWasmBytes);
    if (asset !== null) {
      assets.push({ name: fileName, ...asset });
    }
  }
  return assets;
}

function scanOcrSources(sourceDirectory, errors) {
  if (!existsSync(sourceDirectory)) {
    errors.push(`Missing OCR source directory: ${sourceDirectory}`);
    return;
  }

  for (const filePath of collectSourceFiles(sourceDirectory)) {
    const contents = readFileSync(filePath, 'utf8');
    for (const match of contents.matchAll(EXTERNAL_ORIGIN_PATTERN)) {
      errors.push(
        `External origin referenced in ${relative(sourceDirectory, filePath)}: ${match[0]}`,
      );
    }
  }
}

/**
 * Inspect a project root. Tests pass small fixture roots to prove the check
 * fails for a missing file or an external OCR origin.
 */
export function checkOcrAssets({
  rootDir = PROJECT_ROOT,
  minWasmBytes = MIN_WASM_BYTES,
  requireDist = true,
} = {}) {
  const errors = [];

  const publicAssets = inspectAssetDirectory(join(rootDir, 'public', 'ocr'), {
    errors,
    minWasmBytes,
  });

  scanOcrSources(join(rootDir, OCR_SOURCE_DIRECTORY), errors);

  const distDirectory = join(rootDir, 'dist');
  const distExists = existsSync(distDirectory);
  let distAssets = [];
  if (requireDist && distExists) {
    distAssets = inspectAssetDirectory(join(distDirectory, 'ocr'), {
      errors,
      minWasmBytes,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    publicAssets,
    distChecked: requireDist && distExists,
    distAssets,
  };
}

function parseArguments(argv) {
  const options = { rootDir: PROJECT_ROOT, requireDist: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('--root requires a directory');
      }
      options.rootDir = resolve(value);
      index += 1;
    } else if (argument === '--skip-dist') {
      options.requireDist = false;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/check-ocr-assets.mjs [--root <dir>] [--skip-dist]');
    return 0;
  }

  const result = checkOcrAssets(options);
  if (!result.ok) {
    console.error('OCR asset check failed:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    return 1;
  }

  const sizes = result.publicAssets.map((asset) => `${asset.name}=${asset.bytes}B`).join(', ');
  console.log(`OCR assets present: ${sizes}`);
  console.log(
    result.distChecked ? 'OCR assets emitted into dist/ocr.' : 'dist/ocr not present yet.',
  );
  return 0;
}

const entry = process.argv[1];
const modulePath = resolveModulePath();
if (entry !== undefined && modulePath !== null && resolve(entry) === modulePath) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
