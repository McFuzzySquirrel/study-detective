import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  OcrAssetConfigurationError,
  createOcrAssetPaths,
  ocrAssets,
  ocrWorkerOptions,
  toOcrWorkerConfiguration,
} from '../../src/features/ocr/ocrAssets';

const PROJECT_ROOT = process.cwd();
const CHECK_SCRIPT = join(PROJECT_ROOT, 'scripts/check-ocr-assets.mjs');
const TEMP_ROOTS: string[] = [];

type CheckerModule = {
  REQUIRED_OCR_ASSETS: readonly string[];
  checkOcrAssets: (options?: {
    rootDir?: string;
    minWasmBytes?: number;
    requireDist?: boolean;
  }) => {
    ok: boolean;
    errors: string[];
    publicAssets: Array<{ name: string; filePath: string; bytes: number }>;
    distChecked: boolean;
    distAssets: Array<{ name: string; filePath: string; bytes: number }>;
  };
};

async function loadChecker(): Promise<CheckerModule> {
  const module = await import(/* @vite-ignore */ pathToFileURL(CHECK_SCRIPT).href);
  return module as CheckerModule;
}

function createFixture({
  includeAssets = true,
  source = "export const ocrDirectory = './ocr';\n",
  wasmBytes = 600 * 1024,
}: {
  includeAssets?: boolean;
  source?: string;
  wasmBytes?: number;
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nd-ocr-assets-'));
  TEMP_ROOTS.push(root);

  const sourceDirectory = join(root, 'src', 'features', 'ocr');
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(join(sourceDirectory, 'ocrAssets.ts'), source, 'utf8');

  if (includeAssets) {
    const assetDirectory = join(root, 'public', 'ocr');
    mkdirSync(assetDirectory, { recursive: true });
    writeFileSync(join(assetDirectory, 'worker.min.js'), '// worker\n', 'utf8');
    writeFileSync(join(assetDirectory, 'tesseract-core-simd-lstm.wasm.js'), '// loader\n', 'utf8');
    writeFileSync(
      join(assetDirectory, 'tesseract-core-simd-lstm.wasm'),
      Buffer.alloc(wasmBytes, 1),
    );
    writeFileSync(join(assetDirectory, 'eng.traineddata.gz'), Buffer.alloc(64, 2));
  }

  return root;
}

function runCheckerCli(root: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [CHECK_SCRIPT, '--root', root], {
    encoding: 'utf8',
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('OCR asset URLs', () => {
  it('builds same-origin paths for the root, relative, and project bases', () => {
    expect(createOcrAssetPaths('/')).toEqual({
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr',
      coreLoaderPath: '/ocr/tesseract-core-simd-lstm.wasm.js',
      coreWasmPath: '/ocr/tesseract-core-simd-lstm.wasm',
      trainedDataPath: '/ocr/eng.traineddata.gz',
    });

    expect(createOcrAssetPaths('./')).toMatchObject({
      workerPath: './ocr/worker.min.js',
      corePath: './ocr/',
      langPath: './ocr',
    });

    expect(createOcrAssetPaths('/notes-detective')).toMatchObject({
      workerPath: '/notes-detective/ocr/worker.min.js',
      corePath: '/notes-detective/ocr/',
      langPath: '/notes-detective/ocr',
    });

    expect(createOcrAssetPaths('')).toMatchObject({
      workerPath: './ocr/worker.min.js',
      corePath: './ocr/',
      langPath: './ocr',
    });
  });

  it('rejects absolute and protocol-relative origins', () => {
    expect(() => createOcrAssetPaths('https://cdn.jsdelivr.net/npm/tesseract.js/')).toThrow(
      OcrAssetConfigurationError,
    );
    expect(() => createOcrAssetPaths('http://localhost:4173/')).toThrow(OcrAssetConfigurationError);
    expect(() => createOcrAssetPaths('//cdn.example.test/ocr/')).toThrow(
      OcrAssetConfigurationError,
    );
  });

  it('configures tesseract without a CDN fallback or worker blob wrapper', () => {
    const paths = createOcrAssetPaths('/notes-detective/');
    expect(toOcrWorkerConfiguration(paths)).toEqual({
      workerPath: '/notes-detective/ocr/worker.min.js',
      corePath: '/notes-detective/ocr/',
      langPath: '/notes-detective/ocr',
      workerBlobURL: false,
      gzip: true,
    });

    expect(ocrAssets.workerPath).not.toMatch(/^(?:[a-z][a-z\d+.-]*:|\/\/)/i);
    expect(ocrAssets.corePath).not.toMatch(/^(?:[a-z][a-z\d+.-]*:|\/\/)/i);
    expect(ocrAssets.langPath).not.toMatch(/^(?:[a-z][a-z\d+.-]*:|\/\/)/i);
    expect(ocrWorkerOptions).toEqual(toOcrWorkerConfiguration(ocrAssets));
    expect(new URL(ocrWorkerOptions.workerPath, window.location.href).origin).toBe(
      window.location.origin,
    );
  });
});

describe('bundled OCR assets', () => {
  it('has all four non-empty assets under public/ocr', async () => {
    const checker = await loadChecker();
    const result = checker.checkOcrAssets({ rootDir: PROJECT_ROOT, requireDist: false });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.publicAssets.map((asset) => asset.name).sort()).toEqual(
      [...checker.REQUIRED_OCR_ASSETS].sort(),
    );
    for (const asset of result.publicAssets) {
      expect(asset.bytes).toBeGreaterThan(0);
    }
  });

  it('fails when a required built asset is missing', async () => {
    const checker = await loadChecker();
    const root = createFixture({ includeAssets: false });
    const result = checker.checkOcrAssets({ rootDir: root, requireDist: false });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Missing OCR asset');
    expect(result.errors.join('\n')).toContain('tesseract-core-simd-lstm.wasm');

    const cli = runCheckerCli(root);
    expect(cli.status).toBe(1);
    expect(cli.output).toContain('OCR asset check failed');
  });

  it('fails when the OCR module references an external origin', async () => {
    const checker = await loadChecker();
    const root = createFixture({
      source:
        "export const workerPath = 'https://cdn.jsdelivr.net/npm/tesseract.js/worker.min.js';\n",
    });
    const result = checker.checkOcrAssets({ rootDir: root, requireDist: false });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('External origin referenced');
    expect(result.errors.join('\n')).toContain('https://cdn.jsdelivr.net');

    const cli = runCheckerCli(root);
    expect(cli.status).toBe(1);
    expect(cli.output).toContain('External origin referenced');
  });

  it('accepts a complete same-origin fixture', async () => {
    const checker = await loadChecker();
    const root = createFixture();
    const result = checker.checkOcrAssets({ rootDir: root, requireDist: false });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);

    const cli = runCheckerCli(root);
    expect(cli.status).toBe(0);
    expect(cli.output).toContain('OCR assets present');
  });

  it('fails when the wasm core is a truncated placeholder', async () => {
    const checker = await loadChecker();
    const root = createFixture({ wasmBytes: 128 });
    const result = checker.checkOcrAssets({ rootDir: root, requireDist: false });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('looks truncated');
  });
});

afterAll(() => {
  for (const root of TEMP_ROOTS) {
    rmSync(root, { recursive: true, force: true });
  }
});
