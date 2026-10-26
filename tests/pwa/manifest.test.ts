import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pwaManifest, pwaOptions } from '../../src/pwaManifest';

const projectRoot = process.cwd();
const iconsDirectory = path.join(projectRoot, 'public', 'icons');
const PNG_SIGNATURE = '89504e470d0a1a0a';

interface PngSize {
  width: number;
  height: number;
}

function readPngSize(fileName: string): PngSize {
  const filePath = path.join(iconsDirectory, fileName);
  expect(existsSync(filePath), `${fileName} should exist`).toBe(true);
  expect(statSync(filePath).size, `${fileName} should not be empty`).toBeGreaterThan(0);

  const buffer = readFileSync(filePath);
  expect(buffer.subarray(0, 8).toString('hex'), `${fileName} should be a PNG`).toBe(PNG_SIGNATURE);

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readSource(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function isRelativeAssetUrl(value: string): boolean {
  return value.length > 0 && !value.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

describe('installable web app manifest', () => {
  it('has the product identity and standalone launch scope', () => {
    expect(pwaManifest.name).toBe('Notes Detective');
    expect(pwaManifest.short_name).toBeTruthy();
    expect(pwaManifest.start_url).toBe('./');
    expect(pwaManifest.scope).toBe('./');
    expect(pwaManifest.display).toBe('standalone');
    expect(pwaManifest.orientation).toBe('any');
  });

  it('declares theme colors for the install surface', () => {
    expect(pwaManifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(pwaManifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('declares 192, 512, and maskable icons that exist on disk', () => {
    const icons = pwaManifest.icons ?? [];
    expect(icons).toHaveLength(3);

    const anyIcon192 = icons.find((icon) => icon.sizes === '192x192');
    const anyIcon512 = icons.find((icon) => icon.sizes === '512x512' && icon.purpose === 'any');
    const maskable = icons.find((icon) => icon.purpose === 'maskable');

    expect(anyIcon192).toMatchObject({
      src: 'icons/icon-192.png',
      type: 'image/png',
      purpose: 'any',
    });
    expect(anyIcon512).toMatchObject({
      src: 'icons/icon-512.png',
      type: 'image/png',
      sizes: '512x512',
    });
    expect(maskable).toMatchObject({
      src: 'icons/maskable-512.png',
      type: 'image/png',
      sizes: '512x512',
    });

    expect(readPngSize('icon-192.png')).toEqual({ width: 192, height: 192 });
    expect(readPngSize('icon-512.png')).toEqual({ width: 512, height: 512 });
    expect(readPngSize('maskable-512.png')).toEqual({ width: 512, height: 512 });
  });

  it('references only same-origin, relative runtime assets', () => {
    expect(isRelativeAssetUrl(pwaManifest.start_url)).toBe(true);
    expect(isRelativeAssetUrl(pwaManifest.scope)).toBe(true);

    for (const icon of pwaManifest.icons ?? []) {
      expect(isRelativeAssetUrl(icon.src), `${icon.src} should be relative`).toBe(true);
      expect(icon.src).not.toMatch(/^https?:\/\//i);
    }

    const serialized = JSON.stringify(pwaManifest);
    expect(serialized).not.toMatch(/https?:\/\//i);
    expect(serialized).not.toMatch(/\/\//);
  });

  it('generates all icons from the SVG source with sharp', () => {
    expect(existsSync(path.join(iconsDirectory, 'icon.svg'))).toBe(true);

    const script = readSource('scripts/generate-icons.mjs');
    expect(script).toContain('sharp');
    expect(script).toContain('icon.svg');
    expect(script).toContain('icon-192.png');
    expect(script).toContain('icon-512.png');
    expect(script).toContain('maskable-512.png');
  });
});

describe('service worker update policy', () => {
  it('registers in prompt mode without skipWaiting or an injected auto-registration', () => {
    expect(pwaOptions.registerType).toBe('prompt');
    expect(pwaOptions.injectRegister).toBe(false);
    expect(pwaOptions.workbox?.skipWaiting).toBe(false);
    expect(pwaOptions.workbox?.clientsClaim).toBe(false);
  });

  it('precaches the app shell and reserves future wasm and traineddata assets', () => {
    const globPatterns = pwaOptions.workbox?.globPatterns ?? [];

    expect(globPatterns.some((pattern) => pattern.includes('js'))).toBe(true);
    expect(globPatterns.some((pattern) => pattern.includes('html'))).toBe(true);
    expect(globPatterns.some((pattern) => pattern.includes('wasm'))).toBe(true);
    expect(globPatterns.some((pattern) => pattern.includes('traineddata'))).toBe(true);
    expect(pwaOptions.workbox?.maximumFileSizeToCacheInBytes).toBeGreaterThanOrEqual(
      25 * 1024 * 1024,
    );
  });

  it('wires the shared options into the Vite build', () => {
    const viteConfig = readSource('vite.config.ts');
    expect(viteConfig).toMatch(/import \{ pwaOptions \} from '\.\/src\/pwaManifest(?:\.ts)?'/);
    expect(viteConfig).toContain('VitePWA(pwaOptions)');
  });
});

describe('PWA registration wiring', () => {
  it('registers the service worker from the composition entry', () => {
    const mainSource = readSource('src/main.tsx');
    expect(mainSource).toContain("import { registerPwa } from './pwa'");
    expect(mainSource).toContain('registerPwa()');
  });

  it('mounts the update prompt from the app root', () => {
    const appSource = readSource('src/app/App.tsx');
    expect(appSource).toContain("import UpdatePrompt from './UpdatePrompt'");
    expect(appSource).toContain('<UpdatePrompt />');
  });
});
