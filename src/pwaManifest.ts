import type { ManifestOptions, VitePWAOptions } from 'vite-plugin-pwa';

/**
 * Installable app metadata shared by the Vite build and the manifest contract
 * tests.
 *
 * `start_url` and `scope` stay relative so the same build works from the domain
 * root and from a GitHub Pages project path. Icons live under `public/icons`
 * and are generated from `public/icons/icon.svg` by `scripts/generate-icons.mjs`.
 */
export const pwaManifest = {
  name: 'Notes Detective',
  short_name: 'Notes Detective',
  description: 'Turn your notes into a detective story.',
  lang: 'en',
  dir: 'ltr',
  id: './',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#f4e7c8',
  theme_color: '#2f241b',
  categories: ['education', 'productivity'],
  icons: [
    {
      src: 'icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: 'icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: 'icons/maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
} satisfies Partial<ManifestOptions>;

/**
 * `prompt` mode keeps a waiting service worker waiting until the student
 * confirms the update. `injectRegister` is disabled because `src/pwa.ts`
 * registers the worker explicitly so the update prompt can require a user
 * action. The glob list reserves space for the future OCR worker, wasm, and
 * English traineddata so they are precached without a runtime download.
 */
export const pwaOptions = {
  registerType: 'prompt',
  injectRegister: false,
  includeManifestIcons: false,
  manifest: pwaManifest,
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,traineddata,gz,woff2}'],
    navigateFallback: 'index.html',
    cleanupOutdatedCaches: true,
    clientsClaim: false,
    skipWaiting: false,
    maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
  },
  devOptions: {
    enabled: false,
  },
} satisfies Partial<VitePWAOptions>;
