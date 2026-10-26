import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import { pwaOptions } from './src/pwaManifest.ts';

/**
 * The single build-time base path input. Vite bakes it into every emitted
 * asset URL, so changing it after a build has no effect. GitHub Pages deploys
 * a project site under a repository subpath; a plain local build keeps the
 * portable relative base.
 */
export const DEFAULT_BASE_PATH = './';

/**
 * Turn `VITE_BASE_PATH` into a Vite base URL.
 *
 * `''` and `'.'` mean "relative to the document", `/` means the domain root,
 * and a project-site path such as `notes-detective` or `/notes-detective` is
 * normalized to `/notes-detective/`. Absolute URLs are rejected because the
 * deployed app may only load same-origin static assets.
 */
export function normalizeBasePath(input: string | undefined): string {
  const value = input?.trim() ?? '';
  if (value === '' || value === '.' || value === './') {
    return DEFAULT_BASE_PATH;
  }
  if (value === '/') {
    return '/';
  }
  if (value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error(
      `VITE_BASE_PATH must be a same-origin path such as /notes-detective/, received "${value}".`,
    );
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

const basePath = normalizeBasePath(process.env.VITE_BASE_PATH);

// Hash routing lives in the composition root (`src/app/App.tsx`), so every
// route stays after `#` and GitHub Pages needs no server rewrite. The manifest
// keeps relative `start_url`/`scope` (`./`) so an installed app launches and
// scopes under whatever base path served it.
export default defineConfig({
  base: basePath,
  plugins: [react(), VitePWA(pwaOptions)],
  build: {
    target: 'es2022',
    sourcemap: false,
    // A11Y-5 reads dist/.vite/manifest.json to measure the entry and its
    // statically imported shared chunks. Lazy board and OCR chunks are dynamic
    // imports, so they stay outside the initial-JavaScript budget.
    manifest: true,
  },
});
