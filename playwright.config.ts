import { defineConfig, devices } from '@playwright/test';

const previewUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Frame-rate evidence is only comparable when the machine is not also
  // rendering two other WebGL contexts. CI already uses one worker; keeping one
  // locally makes `npm run test:e2e -- e2e/performance.spec.ts` measure the
  // board rather than worker contention.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: previewUrl,
    trace: 'on-first-retry',
    // Every pre-existing journey starts from an ordinary empty shelf with
    // onboarding already seen. The install-level demo flag suppresses the
    // first-run seed, and the seen set keeps one-time hints from covering
    // unrelated pointer work. e2e/demo.spec.ts overrides this with a truly
    // fresh context to exercise the seed and the first hint themselves.
    storageState: './e2e/fixtures/no-demo-storage.json',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'tablet-landscape',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
      },
    },
    // A11Y-FR-08 / VIS-CON-06 smoke path only. Firefox and WebKit are current
    // desktop targets, but running the full pointer, axe, and performance
    // matrices on three engines would multiply CI time without adding
    // evidence. Their projects are intentionally limited to the documented
    // shelf/demo/board/search/settings smoke.
    {
      name: 'firefox',
      testMatch: /compat\.spec\.ts$/,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'webkit',
      testMatch: /compat\.spec\.ts$/,
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
