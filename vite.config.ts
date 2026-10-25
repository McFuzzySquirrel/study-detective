import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import { pwaOptions } from './src/pwaManifest.ts';

// Relative base URLs keep the static build portable to GitHub Pages and file
// hosting. Hash routing is added by the composition root so no server rewrite
// is required.
export default defineConfig({
  base: './',
  plugins: [react(), VitePWA(pwaOptions)],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
