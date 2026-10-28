#!/usr/bin/env node
/**
 * Capture the README media from the built app.
 *
 * The stills and the animated GIF are taken from the first-run demo case, which
 * is generated locally on a canvas. Nothing here reads a user's case, a photo,
 * a network resource, or an external font, so the committed media contains no
 * personal data.
 *
 * The script starts its own `vite preview`, uses a fresh browser profile so the
 * demo seed runs, dismisses the one-time hints and toasts that would otherwise
 * sit over the board, and writes every image into `docs/media/`. The animated
 * GIF is assembled with sharp, which is already a dev dependency, so there is no
 * ffmpeg or other system tool to install.
 *
 * Run `npm run media` (build + capture) or `node scripts/capture-media.mjs`
 * against an existing preview with `--url`.
 */

import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import sharp from 'sharp';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..');
export const MEDIA_DIRECTORY = resolve(REPOSITORY_ROOT, 'docs', 'media');

export const DEMO_TITLE = 'Demo Case: The Missing Lecture';
export const GIF_BUDGET_BYTES = 5 * 1024 * 1024;

const STILL_VIEWPORT = { width: 1440, height: 900 };
const PHONE_VIEWPORT = { width: 390, height: 844 };
const GIF_VIEWPORT = { width: 1280, height: 800 };
const GIF_SIZE = { width: 1152, height: 720 };
const STILL_SCALE = 2;

const USAGE = `Usage: node scripts/capture-media.mjs [options]

Options:
  --url <url>     Use an already running preview instead of starting one
  --stills-only   Skip the animated GIF
  --gif-only      Skip the still screenshots
  -h, --help      Show this help

The default output is docs/media/. Run "npm run build" first when using --url.
The script has no network dependency beyond the local preview and no system
tool dependency beyond the Playwright browser.`;

class CaptureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CaptureError';
  }
}

function parseArguments(argv) {
  const options = { url: null, stills: true, gif: true, help: false };

  let index = 0;
  while (index < argv.length) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      index += 1;
    } else if (argument === '--stills-only') {
      options.gif = false;
      index += 1;
    } else if (argument === '--gif-only') {
      options.stills = false;
      index += 1;
    } else if (argument === '--url') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new CaptureError('Option --url requires a value.');
      }
      options.url = value.replace(/\/$/, '');
      index += 2;
    } else {
      throw new CaptureError(`Unknown argument "${argument}". Use --help for usage.`);
    }
  }

  return options;
}

async function findFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new CaptureError('Could not allocate a local preview port.'));
        return;
      }
      const { port } = address;
      server.close(() => resolvePromise(port));
    });
  });
}

async function waitForPreview(url) {
  const deadline = Date.now() + 60_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new CaptureError(
    `The preview at ${url} did not become ready: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function startPreview() {
  const port = await findFreePort();
  // Run Vite directly rather than through npm. npm does not reliably forward a
  // termination signal to its child, which would leave the preview server and
  // its pipes holding this process open after a capture failure.
  const viteBin = resolve(REPOSITORY_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: REPOSITORY_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });

  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForPreview(url);
  } catch (error) {
    await stopPreview(child);
    throw new CaptureError(
      `${error instanceof Error ? error.message : String(error)}\n${output.trim()}`,
    );
  }

  return { child, url };
}

async function stopPreview(child) {
  if (child === null || child.exitCode !== null) {
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }

  const exited = await Promise.race([
    new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 5_000)),
  ]);

  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
  }

  child.stdout?.destroy();
  child.stderr?.destroy();
}

/** Chromium needs a real GPU for the board's native-resolution textures. */
async function launchBrowser() {
  const gpuArguments =
    process.platform === 'linux' ? ['--enable-gpu', '--use-gl=angle', '--use-angle=gl'] : [];

  try {
    return await chromium.launch({ args: gpuArguments });
  } catch (error) {
    console.warn(
      `Could not launch Chromium with GPU flags; retrying without them.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return chromium.launch();
  }
}

async function readWebGlRenderer(page) {
  return page.evaluate(() => {
    try {
      const canvas = globalThis.document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (gl === null) {
        return null;
      }
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      if (extension === null) {
        return null;
      }
      return String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL));
    } catch {
      return null;
    }
  });
}

async function warnOnSoftwareRenderer(page) {
  const renderer = await readWebGlRenderer(page);
  if (renderer === null) {
    console.warn(
      'Warning: the browser did not expose a WebGL renderer string. The board may look soft.',
    );
    return;
  }
  if (/swiftshader|llvmpipe|softpipe|software rasterizer/i.test(renderer)) {
    console.warn(
      `Warning: WebGL is using a software renderer (${renderer}). The board renders at a reduced\n` +
        'resolution in that mode, so the captured media may look blurry. Use a machine with a GPU.',
    );
    return;
  }
  console.log(`WebGL renderer: ${renderer}`);
}

function stillContext(browser, viewport, options = {}) {
  return browser.newContext({
    viewport,
    deviceScaleFactor: STILL_SCALE,
    reducedMotion: 'reduce',
    locale: 'en-GB',
    ...options,
  });
}

function gifContext(browser) {
  return browser.newContext({
    viewport: GIF_VIEWPORT,
    deviceScaleFactor: 1.5,
    reducedMotion: 'reduce',
    locale: 'en-GB',
  });
}

function trackConsoleErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function clickIfVisible(locator, options = {}) {
  try {
    if ((await locator.count()) === 0) {
      return false;
    }
    const first = locator.first();
    if (!(await first.isVisible())) {
      return false;
    }
    await first.click({ timeout: options.timeout ?? 2_000 });
    return true;
  } catch {
    return false;
  }
}

/** Dismiss every visible toast, then the thread-anchor hint. */
async function dismissOverlays(page) {
  for (let index = 0; index < 6; index += 1) {
    const dismissed = await clickIfVisible(page.getByRole('button', { name: /^Dismiss / }));
    if (!dismissed) {
      break;
    }
    await page.waitForTimeout(100);
  }

  const hint = page.getByRole('dialog', { name: 'Thread anchor' });
  await clickIfVisible(hint.getByRole('button', { name: 'Got it' }));
  await page.waitForTimeout(150);
}

async function blurFocus(page) {
  await page.evaluate(() => {
    if (globalThis.document.activeElement instanceof globalThis.HTMLElement) {
      globalThis.document.activeElement.blur();
    }
  });
}

/** Move the pointer off the controls so they do not keep a hover style. */
async function parkPointer(page) {
  await page.mouse.move(700, 30);
  await page.waitForTimeout(150);
}

async function waitForBoardReady(page) {
  const board = page.getByTestId('board-canvas');
  await board.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      globalThis.document
        .querySelector('[data-testid="board-canvas"]')
        ?.getAttribute('data-board-scene-status') === 'ready',
    undefined,
    { timeout: 30_000 },
  );
  // Textures are requested after the scene reports ready. Give the thumbnail
  // and display derivatives time to decode before the first frame.
  await page.waitForTimeout(1_800);
}

async function openDemoBoard(page, baseUrl) {
  await page.goto(`${baseUrl}/`);
  const demoLink = page.getByRole('link', { name: DEMO_TITLE });
  await demoLink.waitFor({ state: 'visible', timeout: 30_000 });
  await demoLink.click();
  await waitForBoardReady(page);
  await dismissOverlays(page);
}

async function readGraph(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolvePromise, reject) => {
      const request = globalThis.indexedDB.open('notes-detective');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolvePromise(request.result);
    });

    const readAll = (storeName) =>
      new Promise((resolvePromise, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolvePromise(request.result);
      });

    const [cases, cards] = await Promise.all([readAll('cases'), readAll('cards')]);
    database.close();

    return {
      cases: cases.map((row) => ({ id: String(row.id), title: String(row.title) })),
      cards: cards.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        type: String(row.type),
        position: { x: Number(row.position?.x ?? 0), y: Number(row.position?.y ?? 0) },
      })),
    };
  });
}

async function saveStill(page, fileName, target = STILL_VIEWPORT, options = {}) {
  const buffer = await page.screenshot({ fullPage: options.fullPage === true });
  const image = sharp(buffer);
  const resized =
    options.fullPage === true
      ? image.resize({ width: target.width, withoutEnlargement: true })
      : image.resize(target.width, target.height, { fit: 'cover' });
  const png = await resized.png({ palette: true, quality: 92, effort: 10 }).toBuffer();
  await writeFile(resolve(MEDIA_DIRECTORY, fileName), png);
  return png.length;
}

/**
 * Read the board's camera and card positions from its data attributes. The
 * conversion matches the documented screen-space contract:
 * screen = (world - viewport.origin) * scale + host top-left.
 */
async function readBoard(page) {
  const host = page.getByTestId('board-canvas-host');
  const box = await host.boundingBox();
  if (box === null) {
    throw new CaptureError('The board canvas host did not render.');
  }

  const state = await page.getByTestId('board-canvas').evaluate((element) => ({
    scale: Number(element.getAttribute('data-board-scale')),
    originX: Number(element.getAttribute('data-board-viewport-x')),
    originY: Number(element.getAttribute('data-board-viewport-y')),
    cards: JSON.parse(element.getAttribute('data-board-card-positions') ?? '[]'),
  }));

  return { box, state };
}

function toPagePoint(board, worldX, worldY) {
  return {
    x: board.box.x + (worldX - board.state.originX) * board.state.scale,
    y: board.box.y + (worldY - board.state.originY) * board.state.scale,
  };
}

/**
 * Select a card by clicking its body. After the first selection the board keeps
 * that card's thread anchor visible, so a later hover does not move the anchor;
 * clicking is the reliable way to choose the next source card.
 */
async function selectCard(page, cardId) {
  const board = await readBoard(page);
  const card = board.state.cards.find((candidate) => candidate.id === cardId);
  if (card === undefined) {
    throw new CaptureError(`Card ${cardId} is not on the board.`);
  }

  const point = toPagePoint(board, card.x + 120, card.y + 160);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.mouse.click(point.x + attempt * 3, point.y + attempt * 2);
    await page.waitForTimeout(300);
    const anchorCard = await page
      .getByTestId('board-canvas')
      .getAttribute('data-board-anchor-card-id');
    if (anchorCard === cardId) {
      return point;
    }
  }

  throw new CaptureError(`The pointer never reached card ${cardId}.`);
}

async function readAnchorPoint(page) {
  const raw = await page.getByTestId('board-canvas').getAttribute('data-board-anchor-point');
  if (raw === null || raw === '') {
    throw new CaptureError('The board has no visible thread anchor.');
  }
  const point = JSON.parse(raw);
  const box = await page.getByTestId('board-canvas-host').boundingBox();
  if (box === null) {
    throw new CaptureError('The board canvas host did not render.');
  }
  return { x: box.x + point.x, y: box.y + point.y };
}

async function scratchCount(page) {
  const raw = await page.getByTestId('board-canvas').getAttribute('data-board-scratch-count');
  return Number(raw ?? 0);
}

/**
 * Draw one scratch connection from source card to target card. The target point
 * is verified by hovering it first; the source anchor is then read from the app
 * rather than recomputed, because it is the authoritative pin position.
 */
async function drawScratchConnection(page, fromCardId, toCardId) {
  const board = await readBoard(page);
  const toCard = board.state.cards.find((card) => card.id === toCardId);
  if (toCard === undefined) {
    throw new CaptureError(`Card ${toCardId} is not on the board.`);
  }
  const target = toPagePoint(board, toCard.x + 120, toCard.y + 160);

  await selectCard(page, fromCardId);
  const source = await readAnchorPoint(page);

  const before = await scratchCount(page);
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await scratchCount(page);
  if (after !== before + 1) {
    throw new CaptureError(
      `Drawing ${fromCardId} to ${toCardId} did not create a scratch connection (${before} → ${after}).`,
    );
  }
}

async function openRecall(page, baseUrl, caseId) {
  await page.goto(`${baseUrl}/#/case/${caseId}/recall`);
  await waitForBoardReady(page);

  const hint = page.getByRole('dialog', { name: 'Recall mode' });
  await clickIfVisible(hint.getByRole('button', { name: 'Got it' }));
  await page.waitForTimeout(500);

  const hideMinimap = page.getByRole('button', { name: 'Hide minimap' });
  await clickIfVisible(hideMinimap);

  const fit = page.getByRole('button', { name: 'Fit all cards' });
  await clickIfVisible(fit);
  await page.waitForTimeout(900);
  await dismissOverlays(page);
}

async function captureStills(browser, baseUrl) {
  const context = await stillContext(browser, STILL_VIEWPORT);
  const page = await context.newPage();
  const consoleErrors = trackConsoleErrors(page);
  await warnOnSoftwareRenderer(page);

  const results = {};

  await openDemoBoard(page, baseUrl);
  await clickIfVisible(page.getByRole('button', { name: 'Fit all cards' }));
  await page.waitForTimeout(700);
  await dismissOverlays(page);
  await parkPointer(page);
  await blurFocus(page);
  results['board.png'] = await saveStill(page, 'board.png');

  await page.getByRole('button', { name: /^Readiness:/ }).click();
  await page.getByTestId('closure-panel').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(600);
  await parkPointer(page);
  await blurFocus(page);
  results['closure.png'] = await saveStill(page, 'closure.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const graph = await readGraph(page);
  const caseId = graph.cases[0]?.id;
  if (caseId === undefined) {
    throw new CaptureError('The demo case was not seeded.');
  }
  const note = graph.cards.find((card) => card.type === 'note');
  if (note === undefined) {
    throw new CaptureError('The demo case has no Study Note to open.');
  }

  await page.goto(`${baseUrl}/#/case/${caseId}/card/${note.id}`);
  await page.waitForTimeout(2_400);
  await parkPointer(page);
  await blurFocus(page);
  results['card-detail.png'] = await saveStill(page, 'card-detail.png');

  const byTitle = (title) => {
    const card = graph.cards.find((candidate) => candidate.title === title);
    if (card === undefined) {
      throw new CaptureError(`The demo case has no card titled "${title}".`);
    }
    return card;
  };

  await openRecall(page, baseUrl, caseId);
  // Both demo pairs are association strings, so the board does not stack
  // "Association drawn / Provenance actual" mismatch labels over the result.
  for (const [from, to] of [
    ['Photosynthesis lecture notes', 'ATP production'],
    ['Cellular respiration lecture notes', 'Energy in cells'],
  ]) {
    await drawScratchConnection(page, byTitle(from).id, byTitle(to).id);
    await dismissOverlays(page);
  }

  const check = page.getByRole('button', { name: 'Check' });
  await check.click();
  await page.waitForTimeout(900);

  await page.getByRole('heading', { name: 'Recall results' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => globalThis.scrollBy(0, -80));
  await page.waitForTimeout(500);
  await dismissOverlays(page);
  await parkPointer(page);
  await blurFocus(page);
  results['recall-results.png'] = await saveStill(page, 'recall-results.png');

  if (consoleErrors.length > 0) {
    throw new CaptureError(
      `The still captures logged console errors:\n${consoleErrors.join('\n')}`,
    );
  }

  await context.close();

  const phoneContext = await stillContext(browser, PHONE_VIEWPORT, {
    isMobile: true,
    hasTouch: true,
  });
  const phone = await phoneContext.newPage();
  const phoneErrors = trackConsoleErrors(phone);
  await phone.goto(`${baseUrl}/`);
  await phone
    .getByRole('link', { name: DEMO_TITLE })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await phone.getByRole('link', { name: DEMO_TITLE }).click();
  await waitForBoardReady(phone);
  await dismissOverlays(phone);
  // Step out once: 100% on a 390px board shows only two card faces and cuts
  // the neighbouring column, while 80% keeps the phone context readable.
  await clickIfVisible(phone.getByRole('button', { name: 'Zoom out' }));
  await phone.waitForTimeout(1_500);
  await blurFocus(phone);
  results['phone-board.png'] = await saveStill(phone, 'phone-board.png', PHONE_VIEWPORT);

  if (phoneErrors.length > 0) {
    throw new CaptureError(`The phone capture logged console errors:\n${phoneErrors.join('\n')}`);
  }

  await phoneContext.close();
  return results;
}

async function installGifCursor(context) {
  await context.addInitScript(() => {
    const ensureCursor = () => {
      if (globalThis.document.getElementById('nd-capture-cursor') !== null) {
        return;
      }
      const style = globalThis.document.createElement('style');
      style.textContent = [
        '#nd-capture-cursor{position:fixed;left:0;top:0;width:20px;height:20px;',
        'border:2px solid #fff;border-radius:50%;background:rgba(20,16,12,.45);',
        'box-shadow:0 2px 6px rgba(0,0,0,.55);pointer-events:none;',
        'z-index:2147483647;transform:translate(-50%,-50%)}',
      ].join('');
      globalThis.document.head.append(style);
      const dot = globalThis.document.createElement('div');
      dot.id = 'nd-capture-cursor';
      dot.setAttribute('aria-hidden', 'true');
      globalThis.document.body.append(dot);
    };

    globalThis.__ndCursor = (x, y) => {
      const dot = globalThis.document.getElementById('nd-capture-cursor');
      if (dot !== null) {
        dot.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      }
    };

    if (globalThis.document.readyState === 'loading') {
      globalThis.document.addEventListener('DOMContentLoaded', ensureCursor, { once: true });
    } else {
      ensureCursor();
    }
  });
}

async function cursorTo(page, x, y) {
  await page.mouse.move(x, y);
  await page.evaluate(({ x: cursorX, y: cursorY }) => globalThis.__ndCursor?.(cursorX, cursorY), {
    x,
    y,
  });
}

async function clickLocator(page, locator, settleMilliseconds = 250) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new CaptureError('A control needed for the GIF was not visible.');
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cursorTo(page, x, y);
  await page.waitForTimeout(150);
  await page.mouse.click(x, y);
  await page.waitForTimeout(settleMilliseconds);
}

async function encodeGif(frames, framesDirectory) {
  const raw = Buffer.alloc(GIF_SIZE.width * GIF_SIZE.height * frames.length * 4);

  for (const [index, frame] of frames.entries()) {
    const rgba = await sharp(frame.buffer)
      .resize(GIF_SIZE.width, GIF_SIZE.height, { fit: 'cover' })
      .ensureAlpha()
      .raw()
      .toBuffer();
    rgba.copy(raw, index * GIF_SIZE.width * GIF_SIZE.height * 4);
  }

  const delays = frames.map((frame) => Math.max(20, Math.round(frame.delayMs / 10) * 10));
  const options = [
    { colours: 192, dither: 0.7, effort: 9 },
    { colours: 128, dither: 0.4, effort: 9 },
    { colours: 96, dither: 0.2, effort: 8 },
  ];

  let smallest = null;
  for (const option of options) {
    const buffer = await sharp(raw, {
      raw: {
        width: GIF_SIZE.width,
        height: GIF_SIZE.height * frames.length,
        channels: 4,
        pageHeight: GIF_SIZE.height,
      },
    })
      .gif({ loop: 0, delay: delays, ...option })
      .toBuffer();

    if (smallest === null || buffer.length < smallest.length) {
      smallest = buffer;
    }
    if (buffer.length <= GIF_BUDGET_BYTES) {
      await writeFile(resolve(framesDirectory, 'demo.gif'), buffer);
      return { bytes: buffer.length, frames: frames.length, options: option };
    }
  }

  throw new CaptureError(
    `The GIF is ${(smallest.length / (1024 * 1024)).toFixed(1)} MiB, above the ` +
      `${(GIF_BUDGET_BYTES / (1024 * 1024)).toFixed(0)} MiB budget. Reduce the frame count or size.`,
  );
}

async function captureGif(browser, baseUrl) {
  const context = await gifContext(browser);
  await installGifCursor(context);
  const page = await context.newPage();
  const consoleErrors = trackConsoleErrors(page);
  await warnOnSoftwareRenderer(page);

  const frames = [];
  const snap = async (delayMs) => {
    frames.push({ buffer: await page.screenshot(), delayMs });
  };

  await openDemoBoard(page, baseUrl);

  // The demo case has five cards and one connection, so the first-backup
  // reminder is due. Clear it before recording: the GIF is a tour of the board,
  // closure, and recall, not a backup prompt.
  await clickLocator(page, page.getByRole('button', { name: /^Case menu/ }), 350);
  const notNow = page
    .getByRole('dialog', { name: 'Case menu' })
    .getByRole('button', { name: 'Not now' });
  if (await notNow.isVisible().catch(() => false)) {
    await notNow.click();
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await parkPointer(page);

  await clickLocator(page, page.getByRole('button', { name: 'Fit all cards' }), 900);
  await snap(1_300);

  const boardBox = await page.getByTestId('board-canvas-host').boundingBox();
  if (boardBox === null) {
    throw new CaptureError('The GIF board did not render.');
  }
  const centreX = boardBox.x + boardBox.width * 0.56;
  const centreY = boardBox.y + boardBox.height * 0.5;

  await cursorTo(page, centreX, centreY);
  await snap(300);
  for (let index = 0; index < 3; index += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(120);
    await snap(150);
  }
  await snap(700);

  await page.mouse.down();
  for (let index = 0; index < 10; index += 1) {
    await cursorTo(page, centreX - (index + 1) * 22, centreY + (index + 1) * 9);
    await page.waitForTimeout(70);
    await snap(90);
  }
  await page.mouse.up();
  await snap(800);

  await clickLocator(page, page.getByRole('button', { name: /^Readiness:/ }), 700);
  await snap(1_700);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  await snap(350);

  await clickLocator(page, page.getByRole('button', { name: /^Case menu/ }), 500);
  await snap(1_100);

  const graph = await readGraph(page);
  const recallLink = page.getByRole('dialog', { name: 'Case menu' }).getByRole('link', {
    name: 'Recall',
  });
  await clickLocator(page, recallLink, 900);
  await waitForBoardReady(page);

  const recallHint = page.getByRole('dialog', { name: 'Recall mode' });
  await clickIfVisible(recallHint.getByRole('button', { name: 'Got it' }));
  await page.waitForTimeout(400);
  await clickIfVisible(page.getByRole('button', { name: 'Hide minimap' }));
  await clickIfVisible(page.getByRole('button', { name: 'Fit all cards' }));
  await page.waitForTimeout(900);
  await dismissOverlays(page);
  await cursorTo(page, centreX, centreY);
  await snap(1_100);

  const findCard = (title) => {
    const card = graph.cards.find((candidate) => candidate.title === title);
    if (card === undefined) {
      throw new CaptureError(`The demo case has no card titled "${title}".`);
    }
    return card;
  };
  const fromTitle = 'Cellular respiration lecture notes';
  const toTitle = 'Energy in cells';
  const fromCard = findCard(fromTitle);
  const toCard = findCard(toTitle);

  const recallBoard = await readBoard(page);
  const fromPoint = toPagePoint(recallBoard, fromCard.position.x + 120, fromCard.position.y + 160);
  const toPoint = toPagePoint(recallBoard, toCard.position.x + 120, toCard.position.y + 160);

  await cursorTo(page, fromPoint.x, fromPoint.y);
  await page.waitForTimeout(450);
  await selectCard(page, fromCard.id);
  const sourceAnchor = await readAnchorPoint(page);
  await cursorTo(page, sourceAnchor.x, sourceAnchor.y);
  await snap(500);
  const scratchBefore = await scratchCount(page);
  await page.mouse.down();
  for (let index = 1; index <= 10; index += 1) {
    const ratio = index / 10;
    await cursorTo(
      page,
      sourceAnchor.x + (toPoint.x - sourceAnchor.x) * ratio,
      sourceAnchor.y + (toPoint.y - sourceAnchor.y) * ratio,
    );
    await page.waitForTimeout(60);
    await snap(100);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
  if ((await scratchCount(page)) !== scratchBefore + 1) {
    throw new CaptureError('The GIF could not draw a scratch connection in recall mode.');
  }
  await snap(1_000);
  await dismissOverlays(page);

  await clickLocator(page, page.getByRole('button', { name: 'Check' }), 800);
  await snap(1_200);
  await cursorTo(page, centreX, centreY);
  for (let index = 0; index < 5; index += 1) {
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(90);
    await snap(130);
  }
  await snap(2_000);

  if (consoleErrors.length > 0) {
    await context.close();
    throw new CaptureError(`The GIF capture logged console errors:\n${consoleErrors.join('\n')}`);
  }

  await context.close();

  const encodeDirectory = MEDIA_DIRECTORY;
  const encoded = await encodeGif(frames, encodeDirectory);
  return { ...encoded, bytes: encoded.bytes };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  await mkdir(MEDIA_DIRECTORY, { recursive: true });

  let server = null;
  const baseUrl = options.url ?? null;
  try {
    if (baseUrl === null) {
      server = await startPreview();
    }
    const url = baseUrl ?? server.url;
    console.log(`Capturing from ${url}`);

    const browser = await launchBrowser();
    try {
      if (options.stills) {
        const stills = await captureStills(browser, url);
        for (const [fileName, bytes] of Object.entries(stills)) {
          console.log(`  docs/media/${fileName} (${(bytes / 1024).toFixed(0)} KiB)`);
        }
      }

      if (options.gif) {
        const gif = await captureGif(browser, url);
        console.log(
          `  docs/media/demo.gif (${(gif.bytes / (1024 * 1024)).toFixed(2)} MiB, ` +
            `${gif.frames} frames, ${gif.options.colours} colours)`,
        );
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (server !== null) {
      await stopPreview(server.child);
    }
  }

  const files = options.stills
    ? ['board.png', 'closure.png', 'card-detail.png', 'recall-results.png', 'phone-board.png']
    : [];
  if (options.gif) {
    files.push('demo.gif');
  }
  let total = 0;
  for (const file of files) {
    const info = await stat(resolve(MEDIA_DIRECTORY, file));
    total += info.size;
  }
  console.log(`Media captured into docs/media/ (${(total / (1024 * 1024)).toFixed(1)} MiB total).`);
  return 0;
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  try {
    process.exitCode = await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Media capture failed: ${message}`);
    process.exitCode = 1;
  }
}

export { main, parseArguments };
