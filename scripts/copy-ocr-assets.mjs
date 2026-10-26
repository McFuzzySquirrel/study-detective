#!/usr/bin/env node
/**
 * Copy the pinned tesseract.js worker, wasm core, and English traineddata out
 * of node_modules and into public/ocr.
 *
 * The assets are generated, not hand-edited. Every copy is a same-origin
 * static file served from the configured Vite base path, so OCR never needs a
 * CDN or a runtime language download. Wire this script into postinstall,
 * predev, and prebuild so a fresh checkout always has the complete set.
 */
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveProjectRoot() {
  try {
    return fileURLToPath(new URL('..', import.meta.url));
  } catch {
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

/** The four browser assets required by the bundled English OCR path. */
export const OCR_ASSETS = Object.freeze([
  {
    packageName: 'tesseract.js',
    source: 'tesseract.js/dist/worker.min.js',
    destination: 'worker.min.js',
  },
  {
    packageName: 'tesseract.js-core',
    source: 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    destination: 'tesseract-core-simd-lstm.wasm.js',
  },
  {
    packageName: 'tesseract.js-core',
    source: 'tesseract.js-core/tesseract-core-simd-lstm.wasm',
    destination: 'tesseract-core-simd-lstm.wasm',
  },
  {
    packageName: '@tesseract.js-data/eng',
    source: '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    destination: 'eng.traineddata.gz',
  },
]);

/**
 * Resolve the source and destination paths for every required asset.
 *
 * `nodeModulesDir` is injectable so this module can be exercised without
 * touching the real project tree.
 */
export function resolveOcrAssets({ rootDir = PROJECT_ROOT, nodeModulesDir } = {}) {
  const modulesDir = nodeModulesDir ?? join(rootDir, 'node_modules');
  const outputDir = join(rootDir, 'public', 'ocr');

  return OCR_ASSETS.map((asset) => ({
    ...asset,
    sourcePath: join(modulesDir, asset.source),
    destinationPath: join(outputDir, asset.destination),
  }));
}

function copyAtomically(sourcePath, destinationPath) {
  const temporaryPath = join(dirname(destinationPath), `.${basename(destinationPath)}.tmp`);
  rmSync(temporaryPath, { force: true });
  copyFileSync(sourcePath, temporaryPath);
  // Rename within the same directory replaces the previous generated file
  // atomically, so a failed copy never leaves a half-written worker or wasm.
  renameSync(temporaryPath, destinationPath);
}

/**
 * Copy all four pinned assets into `public/ocr`. Throws before writing
 * anything when a package source is missing, so a broken install fails loudly
 * instead of producing an OCR build that only fails in the browser.
 */
export function copyOcrAssets({ rootDir = PROJECT_ROOT, nodeModulesDir, log = console.log } = {}) {
  const assets = resolveOcrAssets({ rootDir, nodeModulesDir });
  const missing = assets.filter((asset) => !existsSync(asset.sourcePath));

  if (missing.length > 0) {
    const list = missing.map((asset) => `  - ${asset.sourcePath}`).join('\n');
    throw new Error(`Missing pinned OCR package assets. Run npm install before building.\n${list}`);
  }

  const outputDir = join(rootDir, 'public', 'ocr');
  mkdirSync(outputDir, { recursive: true });

  const copied = [];
  for (const asset of assets) {
    const sourceStats = statSync(asset.sourcePath);
    if (!sourceStats.isFile() || sourceStats.size === 0) {
      throw new Error(`OCR package asset is empty or not a file: ${asset.sourcePath}`);
    }

    copyAtomically(asset.sourcePath, asset.destinationPath);
    const destinationStats = statSync(asset.destinationPath);
    copied.push({ ...asset, bytes: destinationStats.size });
    log(`copied ${asset.destination} (${destinationStats.size} bytes)`);
  }

  log(`OCR assets ready in ${outputDir}`);
  return copied;
}

function isMainModule() {
  const entry = process.argv[1];
  const modulePath = resolveModulePath();
  return entry !== undefined && modulePath !== null && resolve(entry) === modulePath;
}

if (isMainModule()) {
  try {
    copyOcrAssets();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
