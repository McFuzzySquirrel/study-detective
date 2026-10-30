import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * REL-3 offline PWA evidence.
 *
 * The claim is behavioural: after one successful production-preview load, a
 * student can reload with the network disabled and still see the shelf, open
 * the demo case, and fetch the bundled OCR worker, wasm, and English
 * traineddata from the service-worker cache. The spec also records every
 * runtime request and fails when any of them targets another origin.
 *
 * Two separate checks keep the result honest:
 *
 * - The installability test inspects the served manifest and the real icon
 *   PNGs (dimensions read from the bytes), and fetches the generated service
 *   worker. It does not claim a browser install prompt, which is a human step.
 * - The update test mutates only the generated `dist/sw.js` bytes to simulate a
 *   new deployment. The new worker installs and waits; the UI must prompt, and
 *   the old controller must keep controlling until the student confirms or
 *   dismisses. The original bytes are restored in a `finally` block.
 *
 * Every test starts from an empty browser context so the first-run demo seed
 * uses the real IndexedDB path. The hint-seen marker is pre-set only to keep
 * unrelated onboarding popovers out of the offline assertions.
 */

const DEMO_CASE_TITLE = 'Demo Case: The Missing Lecture';
const HINT_SEEN_KEY = 'notes-detective.hints.seen';
const SHELL_ASSETS = [
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
] as const;

const OCR_ASSETS = [
  { path: 'ocr/worker.min.js', minimumBytes: 10_000 },
  { path: 'ocr/tesseract-core-simd-lstm.wasm', minimumBytes: 512 * 1024 },
  { path: 'ocr/tesseract-core-simd-lstm.wasm.js', minimumBytes: 100_000 },
  { path: 'ocr/eng.traineddata.gz', minimumBytes: 1024 * 1024 },
] as const;

const PNG_SIGNATURE = '89504e470d0a1a0a';

test.use({ storageState: './e2e/fixtures/welcome-seen-storage.json' });

test.beforeEach(async ({ page }) => {
  // The demo must seed (no demo flag), but the contextual board hint is not
  // part of this journey. The app reads the seen list from localStorage.
  await page.addInitScript(
    ({ hintKey }) => {
      try {
        window.localStorage.setItem(
          hintKey,
          JSON.stringify(['thread-anchor', 'long-press', 'recall']),
        );
      } catch {
        // about:blank has an opaque origin before the first navigation.
      }
    },
    { hintKey: HINT_SEEN_KEY },
  );
});

type RequestAudit = {
  readonly baseOrigin: string;
  readonly requests: string[];
  readonly external: string[];
  readonly disallowedProtocols: string[];
};

/**
 * Record every request the page makes. HTTP(S) must stay on the preview origin;
 * data: and blob: URLs are local resource encodings allowed by the product.
 */
function startRequestAudit(page: Page, baseOrigin: string): RequestAudit {
  const audit: RequestAudit = {
    baseOrigin,
    requests: [],
    external: [],
    disallowedProtocols: [],
  };

  page.on('request', (request) => {
    const rawUrl = request.url();
    audit.requests.push(rawUrl);

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      audit.external.push(rawUrl);
      return;
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.origin !== baseOrigin) {
        audit.external.push(rawUrl);
      }
      return;
    }

    if (url.protocol !== 'data:' && url.protocol !== 'blob:') {
      audit.disallowedProtocols.push(rawUrl);
    }
  });

  return audit;
}

function expectNoExternalRequests(audit: RequestAudit): void {
  expect(
    audit.requests.length,
    'the request audit should have observed page traffic',
  ).toBeGreaterThan(0);
  expect(audit.external, `non-same-origin requests: ${audit.external.join(', ')}`).toEqual([]);
  expect(
    audit.disallowedProtocols,
    `unsupported request protocols: ${audit.disallowedProtocols.join(', ')}`,
  ).toEqual([]);
}

type ManifestIcon = {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
};

type WebAppManifest = {
  readonly name?: string;
  readonly short_name?: string;
  readonly display?: string;
  readonly start_url?: string;
  readonly scope?: string;
  readonly icons?: readonly ManifestIcon[];
};

function readPngDimensions(bytes: Buffer, label: string): { width: number; height: number } {
  expect(bytes.length, `${label} should not be empty`).toBeGreaterThan(24);
  expect(bytes.subarray(0, 8).toString('hex'), `${label} should be a PNG`).toBe(PNG_SIGNATURE);

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration !== undefined && registration.active !== null;
    },
    undefined,
    { timeout: 90_000 },
  );

  // The first install activates without claiming existing clients
  // (`clientsClaim: false`). One reload moves this document under the worker.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });
}

type CacheReport = {
  readonly cacheNames: readonly string[];
  readonly entryCount: number;
  readonly present: Readonly<Record<string, boolean>>;
};

async function readPrecacheReport(page: Page, assets: readonly string[]): Promise<CacheReport> {
  return page.evaluate(
    async (requestedAssets) => {
      const cacheNames = await caches.keys();
      const cachedPathnames: string[] = [];

      for (const name of cacheNames) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          cachedPathnames.push(new URL(request.url).pathname);
        }
      }

      const present: Record<string, boolean> = {};
      for (const asset of requestedAssets) {
        present[asset] = cachedPathnames.some((pathname) => pathname.endsWith(`/${asset}`));
      }

      return {
        cacheNames,
        entryCount: cachedPathnames.length,
        present,
      };
    },
    [...assets],
  );
}

type OfflineAssetFetch = {
  readonly path: string;
  readonly status: number;
  readonly ok: boolean;
  readonly bytes: number;
  readonly type: string | null;
};

async function fetchAssetsOffline(
  page: Page,
  assets: readonly { readonly path: string }[],
): Promise<OfflineAssetFetch[]> {
  return page.evaluate(
    async (requestedAssets) => {
      const results = [];

      for (const asset of requestedAssets) {
        const url = new URL(asset.path, window.location.href).href;
        const response = await fetch(url);
        const bytes = (await response.arrayBuffer()).byteLength;

        results.push({
          path: asset.path,
          status: response.status,
          ok: response.ok,
          bytes,
          type: response.headers.get('content-type'),
        });
      }

      return results;
    },
    [...assets],
  );
}

function attachEvidence(
  testInfo: TestInfo,
  name: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  return testInfo.attach(name, {
    body: JSON.stringify(
      {
        task: 'REL-3',
        project: testInfo.project.name,
        browser: testInfo.project.use.browserName ?? 'chromium',
        viewport: testInfo.project.use.viewport ?? null,
        ...evidence,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
}

test('serves an installable manifest, real 192/512/maskable icons, and the service worker', async ({
  page,
}, testInfo) => {
  const baseOrigin = new URL(testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173').origin;
  const audit = startRequestAudit(page, baseOrigin);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible({
    timeout: 30_000,
  });

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref, 'the document should link the web app manifest').toBeTruthy();

  const manifestUrl = new URL(manifestHref ?? '', page.url());
  expect(manifestUrl.origin).toBe(baseOrigin);

  const manifestResponse = await page.request.get(manifestUrl.href);
  expect(manifestResponse.status()).toBe(200);
  const manifest = (await manifestResponse.json()) as WebAppManifest;

  expect(manifest.name).toBe('Notes Detective');
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');

  const icons = manifest.icons ?? [];
  const icon192 = icons.find((icon) => icon.sizes === '192x192');
  const icon512 = icons.find((icon) => icon.sizes === '512x512' && icon.purpose !== 'maskable');
  const maskable = icons.find((icon) => icon.purpose === 'maskable');

  expect(icon192, 'the manifest should declare a 192x192 icon').toBeDefined();
  expect(icon512, 'the manifest should declare a 512x512 icon').toBeDefined();
  expect(maskable, 'the manifest should declare a maskable icon').toBeDefined();

  const iconEvidence: Array<{ src: string; width: number; height: number; status: number }> = [];
  for (const icon of [icon192, icon512, maskable]) {
    if (icon === undefined) {
      continue;
    }

    const iconUrl = new URL(icon.src, manifestUrl);
    expect(iconUrl.origin).toBe(baseOrigin);
    expect(icon.type).toBe('image/png');

    const iconResponse = await page.request.get(iconUrl.href);
    expect(iconResponse.status(), `${icon.src} should be served`).toBe(200);
    expect(iconResponse.headers()['content-type']).toContain('image/png');

    const dimensions = readPngDimensions(await iconResponse.body(), icon.src);
    expect(dimensions.width).toBe(Number.parseInt(icon.sizes.split('x')[0] ?? '', 10));
    expect(dimensions.height).toBe(Number.parseInt(icon.sizes.split('x')[1] ?? '', 10));

    iconEvidence.push({ src: icon.src, ...dimensions, status: iconResponse.status() });
  }

  const serviceWorkerResponse = await page.request.get(new URL('/sw.js', baseOrigin).href);
  expect(serviceWorkerResponse.status()).toBe(200);
  const serviceWorkerSource = (await serviceWorkerResponse.body()).toString('utf8');
  expect(serviceWorkerSource).toContain('precacheAndRoute');
  expect(serviceWorkerSource).toContain('manifest.webmanifest');
  for (const asset of OCR_ASSETS) {
    expect(serviceWorkerSource, `${asset.path} should be in the precache manifest`).toContain(
      asset.path,
    );
  }

  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return {
      scope: ready.scope,
      activeState: ready.active?.state ?? null,
      activeScript: ready.active?.scriptURL ?? null,
    };
  });

  expect(registration.activeState).toBe('activated');
  expect(registration.activeScript).toBe(new URL('/sw.js', baseOrigin).href);
  expect(new URL(registration.scope).origin).toBe(baseOrigin);

  expectNoExternalRequests(audit);

  await attachEvidence(testInfo, `pwa-install-${testInfo.project.name}.json`, {
    criterion: 'REL-FR-03 / REL-FR-04 / REL-FR-07',
    manifest: {
      name: manifest.name,
      display: manifest.display,
      startUrl: manifest.start_url,
      scope: manifest.scope,
      icons: iconEvidence,
    },
    serviceWorker: {
      status: serviceWorkerResponse.status(),
      scope: registration.scope,
      activeScript: registration.activeScript,
      precacheEntries: (serviceWorkerSource.match(/url:/g) ?? []).length,
    },
    requests: {
      count: audit.requests.length,
      origins: [...new Set(audit.requests.map((request) => new URL(request).origin))],
      nonSameOrigin: audit.external,
    },
  });
});

test('reloads offline into the shelf and demo and serves the OCR assets from cache', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);

  const baseOrigin = new URL(testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173').origin;
  const audit = startRequestAudit(page, baseOrigin);
  const consoleErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('link', { name: DEMO_CASE_TITLE })).toBeVisible({ timeout: 30_000 });

  await waitForServiceWorkerControl(page);

  // The shell, icons, and OCR payload must already be in the Workbox cache
  // before the network is removed. Reading the real Cache API is the assertion;
  // a registration object alone would not prove the payload is usable offline.
  const requestedAssets = [...SHELL_ASSETS, ...OCR_ASSETS.map((asset) => asset.path)];
  const cacheReport = await readPrecacheReport(page, requestedAssets);

  for (const asset of requestedAssets) {
    expect(cacheReport.present[asset], `${asset} should be precached`).toBe(true);
  }

  const controllerBeforeOffline = await page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? null,
  );
  expect(controllerBeforeOffline).toBe(new URL('/sw.js', baseOrigin).href);

  const offlineEvidence: {
    offlineReload: boolean;
    shelfVisible: boolean;
    demoVisible: boolean;
    boardVisible: boolean;
    assets: OfflineAssetFetch[];
  } = {
    offlineReload: false,
    shelfVisible: false,
    demoVisible: false,
    boardVisible: false,
    assets: [],
  };

  try {
    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await page.reload();

    await expect(page.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible({
      timeout: 30_000,
    });
    offlineEvidence.offlineReload = true;
    offlineEvidence.shelfVisible = true;

    const demoLink = page.getByRole('link', { name: DEMO_CASE_TITLE });
    await expect(demoLink).toBeVisible();
    offlineEvidence.demoVisible = true;

    await demoLink.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('board-canvas')).toHaveAttribute(
      'data-board-scene-status',
      'ready',
      { timeout: 30_000 },
    );
    offlineEvidence.boardVisible = true;

    // Fetching while the context is offline proves the service worker serves
    // the bundled OCR payload, rather than the HTTP cache or a live server.
    const assets = await fetchAssetsOffline(page, OCR_ASSETS);
    offlineEvidence.assets = assets;

    for (const [index, asset] of assets.entries()) {
      const expected = OCR_ASSETS[index];
      expect(expected, 'every expected OCR asset should have a matching result').toBeDefined();
      expect(asset.path).toBe(expected?.path);
      expect(asset.ok, `${asset.path} should be available offline`).toBe(true);
      expect(asset.status).toBe(200);
      expect(asset.bytes, `${asset.path} should not be an empty cached response`).toBeGreaterThan(
        expected?.minimumBytes ?? 0,
      );
    }

    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  } finally {
    await context.setOffline(false);
  }

  expectNoExternalRequests(audit);
  expect(consoleErrors).toEqual([]);

  console.info(
    `[REL-3] ${testInfo.project.name}: offline reload rendered shelf, demo, and board; ` +
      `${cacheReport.entryCount} cached entries; OCR ${offlineEvidence.assets
        .map((asset) => `${asset.path}=${asset.bytes}B`)
        .join(', ')}`,
  );

  await attachEvidence(testInfo, `pwa-offline-${testInfo.project.name}.json`, {
    criterion: 'REL-FR-03 / VIS-FR-01 / VIS-CON-07',
    input: 'Playwright context.setOffline(true) and a real navigation reload',
    persistence: 'real IndexedDB demo rows after the first load; no in-memory fixture',
    cache: cacheReport,
    offline: {
      reloaded: offlineEvidence.offlineReload,
      shelfVisible: offlineEvidence.shelfVisible,
      demoVisible: offlineEvidence.demoVisible,
      boardVisible: offlineEvidence.boardVisible,
      assets: offlineEvidence.assets,
    },
    requests: {
      count: audit.requests.length,
      nonSameOrigin: audit.external,
    },
  });
});

test('a waiting update prompts instead of activating silently', async ({ page }, testInfo) => {
  test.setTimeout(180_000);

  const baseOrigin = new URL(testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173').origin;
  const audit = startRequestAudit(page, baseOrigin);
  const serviceWorkerPath = resolve(process.cwd(), 'dist', 'sw.js');
  const originalServiceWorker = readFileSync(serviceWorkerPath);

  try {
    await page.goto('/');
    await expect(page.getByRole('link', { name: DEMO_CASE_TITLE })).toBeVisible({
      timeout: 30_000,
    });
    await waitForServiceWorkerControl(page);

    const beforeUpdate = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        waiting: Boolean(registration?.waiting),
        installing: Boolean(registration?.installing),
      };
    });
    expect(beforeUpdate.waiting, 'no update is waiting before the probe').toBe(false);
    expect(beforeUpdate.installing, 'no update is installing before the probe').toBe(false);
    await expect(page.getByText('A new version of Notes Detective is ready.')).toBeHidden();

    await page.evaluate(() => {
      const probe = { controllerChanges: 0 };
      (
        window as unknown as { __notesDetectiveUpdateProbe: typeof probe }
      ).__notesDetectiveUpdateProbe = probe;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        probe.controllerChanges += 1;
      });
    });

    // Simulate the next deployment by changing the bytes at the same service
    // worker URL. The preview server serves the updated file immediately; the
    // browser installs it as a waiting worker because skipWaiting is off.
    writeFileSync(
      serviceWorkerPath,
      `${originalServiceWorker.toString('utf8')}\n/* REL-3 update probe ${Date.now()} */\n`,
      'utf8',
    );

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration === undefined) {
        throw new Error('The service worker is not registered.');
      }
      await registration.update();
    });

    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return Boolean(registration?.waiting);
          }),
        { timeout: 120_000 },
      )
      .toBe(true);

    await page.getByRole('button', { name: /^System status: .*update ready/ }).click();
    const statusDialog = page.getByRole('dialog', { name: 'System status' });
    await expect(statusDialog).toBeVisible({ timeout: 30_000 });
    await expect(
      statusDialog.getByText('A new version of Notes Detective is ready.'),
    ).toBeVisible();
    await expect(
      statusDialog.getByText('Refresh when you are ready; nothing changes until you confirm.'),
    ).toBeVisible();
    await expect(statusDialog.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(statusDialog.getByRole('button', { name: 'Later' })).toBeVisible();

    const waitingState = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const probe = (
        window as unknown as { __notesDetectiveUpdateProbe?: { controllerChanges: number } }
      ).__notesDetectiveUpdateProbe;

      return {
        hasWaitingWorker: Boolean(registration?.waiting),
        waitingWorkerState: registration?.waiting?.state ?? null,
        activeScript: registration?.active?.scriptURL ?? null,
        controllerScript: navigator.serviceWorker.controller?.scriptURL ?? null,
        controllerChanges: probe?.controllerChanges ?? -1,
      };
    });

    expect(waitingState.hasWaitingWorker).toBe(true);
    expect(waitingState.waitingWorkerState).toBe('installed');
    expect(waitingState.activeScript).toBe(new URL('/sw.js', baseOrigin).href);
    expect(waitingState.controllerScript).toBe(new URL('/sw.js', baseOrigin).href);
    expect(
      waitingState.controllerChanges,
      'the waiting worker must not take control before the student confirms',
    ).toBe(0);

    // Dismissing leaves the worker waiting and the current document controlled
    // by the old worker. Only Refresh may activate it.
    await statusDialog.getByRole('button', { name: 'Later' }).click();
    await expect(page.getByRole('dialog', { name: 'System status' })).toBeHidden();

    const afterDismiss = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const probe = (
        window as unknown as { __notesDetectiveUpdateProbe?: { controllerChanges: number } }
      ).__notesDetectiveUpdateProbe;

      return {
        hasWaitingWorker: Boolean(registration?.waiting),
        controllerChanges: probe?.controllerChanges ?? -1,
      };
    });

    expect(afterDismiss.hasWaitingWorker).toBe(true);
    expect(afterDismiss.controllerChanges).toBe(0);
    expectNoExternalRequests(audit);

    console.info(
      `[REL-3] ${testInfo.project.name}: waiting worker prompted; controller unchanged ` +
        `(${waitingState.controllerChanges} controllerchange events); Later left it waiting`,
    );

    await attachEvidence(testInfo, `pwa-update-${testInfo.project.name}.json`, {
      criterion: 'REL-FR-03',
      input: 'changed dist/sw.js bytes followed by registration.update()',
      waitingWorker: waitingState.hasWaitingWorker,
      waitingWorkerState: waitingState.waitingWorkerState,
      controllerBeforeConfirm: waitingState.controllerScript,
      controllerChangesBeforeConfirm: waitingState.controllerChanges,
      afterDismiss,
    });
  } finally {
    writeFileSync(serviceWorkerPath, originalServiceWorker);
  }
});
