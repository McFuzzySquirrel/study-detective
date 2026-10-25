import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base URLs keep the static build portable to GitHub Pages and file
// hosting. Hash routing is added by the composition root so no server rewrite
// is required.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
