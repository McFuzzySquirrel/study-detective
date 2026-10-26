/**
 * A11Y-5 initial-JavaScript budget parser evidence.
 *
 * These tests execute the real `scripts/perf-budget.mjs` against synthetic Vite
 * manifests written to a temporary build directory. They prove the parser's
 * observable contract:
 *
 * - entry + transitive static imports are counted;
 * - lazy `dynamicImports` (board and OCR) are not counted;
 * - the exact-byte threshold passes at the boundary and fails one byte over;
 * - the default 300 KiB budget fails a realistic over-budget initial graph;
 * - a missing manifest or emitted chunk fails loudly instead of reporting 0.
 *
 * No source, fixture image, or user content is involved.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(testDirectory, '../../scripts/perf-budget.mjs');
const GZIP_LEVEL = 9;

type ManifestChunk = {
  readonly file: string;
  readonly src?: string;
  readonly name?: string;
  readonly isEntry?: boolean;
  readonly isDynamicEntry?: boolean;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
};

type BuildFixture = {
  readonly root: string;
  readonly manifestPath: string;
  readonly buildDirectory: string;
};

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Deterministic high-entropy bytes so gzip cannot compress the fixture away. */
function incompressibleBytes(size: number): Buffer {
  const bytes = Buffer.allocUnsafe(size);
  let state = 0x9e3779b9;

  for (let index = 0; index < size; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = (state >>> 24) & 0xff;
  }

  return bytes;
}

function createBuild(
  manifest: Record<string, ManifestChunk>,
  files: Record<string, Buffer | string>,
): BuildFixture {
  const root = mkdtempSync(join(tmpdir(), 'notes-detective-perf-budget-'));
  temporaryRoots.push(root);

  const buildDirectory = join(root, 'dist');
  const manifestPath = join(buildDirectory, '.vite', 'manifest.json');
  mkdirSync(dirname(manifestPath), { recursive: true });

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = join(buildDirectory, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { root, manifestPath, buildDirectory };
}

type ScriptResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

function runBudget(args: readonly string[], cwd?: string): ScriptResult {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    cwd: cwd ?? testDirectory,
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function gzipSize(contents: Buffer | string): number {
  return gzipSync(contents, { level: GZIP_LEVEL }).length;
}

function chunkKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    if (entry === null || typeof entry !== 'object') {
      throw new Error('Expected a chunk record');
    }
    return String((entry as { readonly key?: unknown }).key);
  });
}

describe('perf-budget.mjs initial JavaScript accounting', () => {
  it('counts entry plus transitive static imports and reports lazy board/OCR chunks separately', () => {
    const initial = {
      entry: Buffer.from('entry chunk'),
      shared: incompressibleBytes(6_000),
      runtime: Buffer.from('runtime chunk'),
    };
    const lazyBoard = incompressibleBytes(220_000);
    const lazyOcr = incompressibleBytes(180_000);

    const fixture = createBuild(
      {
        'index.html': {
          file: 'assets/index.js',
          src: 'index.html',
          isEntry: true,
          imports: ['_shared.js'],
          dynamicImports: ['_board.js', '_ocr.js'],
        },
        '_shared.js': {
          file: 'assets/shared.js',
          src: 'src/shared.ts',
          imports: ['_runtime.js'],
        },
        '_runtime.js': {
          file: 'assets/runtime.js',
          src: 'src/runtime.ts',
        },
        '_board.js': {
          file: 'assets/board.js',
          src: 'src/board/BoardCanvas.tsx',
          isDynamicEntry: true,
        },
        '_ocr.js': {
          file: 'assets/ocr.js',
          src: 'src/features/ocr/ocrWorker.ts',
          isDynamicEntry: true,
        },
      },
      {
        'assets/index.js': initial.entry,
        'assets/shared.js': initial.shared,
        'assets/runtime.js': initial.runtime,
        'assets/board.js': lazyBoard,
        'assets/ocr.js': lazyOcr,
      },
    );

    const result = runBudget([
      '--manifest',
      fixture.manifestPath,
      '--budget-bytes',
      '100000',
      '--json',
    ]);
    expect(result.status).toBe(0);

    const parsed = JSON.parse(result.stdout) as {
      readonly pass: boolean;
      readonly totalBytes: number;
      readonly budgetBytes: number;
      readonly chunks: unknown;
      readonly excluded: unknown;
    };

    expect(parsed.pass).toBe(true);
    expect(parsed.budgetBytes).toBe(100_000);
    expect(chunkKeys(parsed.chunks).sort()).toEqual(['_runtime.js', '_shared.js', 'index.html']);
    expect(parsed.totalBytes).toBe(
      gzipSize(initial.entry) + gzipSize(initial.shared) + gzipSize(initial.runtime),
    );

    const excludedKeys = chunkKeys(parsed.excluded).sort();
    expect(excludedKeys).toEqual(['_board.js', '_ocr.js']);
    // The lazy board and OCR chunks are larger than the entire budget; they
    // must not contribute a byte, or this fixture would fail.
    expect(parsed.totalBytes).toBeLessThan(100_000);
  });

  it('fails the default 300 KiB budget when the initial graph is over it', () => {
    const oversizedEntry = incompressibleBytes(330 * 1024);
    const fixture = createBuild(
      {
        'index.html': {
          file: 'assets/index.js',
          src: 'index.html',
          isEntry: true,
        },
      },
      { 'assets/index.js': oversizedEntry },
    );

    expect(gzipSize(oversizedEntry)).toBeGreaterThan(300 * 1024);

    const human = runBudget(['--manifest', fixture.manifestPath]);
    expect(human.status).toBe(1);
    expect(human.stdout).toContain('FAIL: initial JavaScript');
    expect(human.stderr).toContain('exceeds the 300.0 KiB budget');

    const json = runBudget(['--manifest', fixture.manifestPath, '--json']);
    expect(json.status).toBe(1);
    const parsed = JSON.parse(json.stdout) as {
      readonly pass: boolean;
      readonly budgetBytes: number;
      readonly totalBytes: number;
    };
    expect(parsed.pass).toBe(false);
    expect(parsed.budgetBytes).toBe(300 * 1024);
    expect(parsed.totalBytes).toBeGreaterThan(parsed.budgetBytes);
  });

  it('passes at the exact gzip boundary and fails one byte over', () => {
    const entry = incompressibleBytes(8_192);
    const expectedBytes = gzipSize(entry);
    const fixture = createBuild(
      {
        'index.html': {
          file: 'assets/index.js',
          src: 'index.html',
          isEntry: true,
        },
      },
      { 'assets/index.js': entry },
    );

    const atBoundary = runBudget([
      '--manifest',
      fixture.manifestPath,
      '--budget-bytes',
      String(expectedBytes),
      '--json',
    ]);
    expect(atBoundary.status).toBe(0);
    const boundary = JSON.parse(atBoundary.stdout) as {
      readonly totalBytes: number;
      readonly pass: boolean;
    };
    expect(boundary.totalBytes).toBe(expectedBytes);
    expect(boundary.pass).toBe(true);

    const overBoundary = runBudget([
      '--manifest',
      fixture.manifestPath,
      '--budget-bytes',
      String(expectedBytes - 1),
    ]);
    expect(overBoundary.status).toBe(1);
    expect(overBoundary.stderr).toContain('exceeds the');
  });

  it('fails loudly when the manifest is missing instead of reporting an empty budget', () => {
    const missing = join(tmpdir(), `notes-detective-missing-${Date.now()}`, 'manifest.json');
    const result = runBudget(['--manifest', missing]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Vite manifest not found');
    expect(result.stdout).not.toContain('PASS');
  });

  it('fails when an initial chunk file is absent from the build output', () => {
    const fixture = createBuild(
      {
        'index.html': {
          file: 'assets/index.js',
          src: 'index.html',
          isEntry: true,
        },
      },
      {},
    );

    const result = runBudget(['--manifest', fixture.manifestPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is missing from');
  });
});
