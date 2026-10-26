import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

import { seedLargeCase } from './helpers/seedLargeCase';

/**
 * A11Y-FR-07 / VIS-FR-04 performance evidence.
 *
 * The claim is deliberately split into two gates:
 *
 * - Automated CI: a real 150-card case opens on the real board, survives a
 *   five-second pointer pan and wheel zoom, and stays at or above the
 *   documented 30 FPS headless floor with the documented p95 frame-time
 *   ceiling. This catches catastrophic renderer regressions, not the tablet
 *   feel target.
 * - Human tablet review: the 45 FPS target at 150 cards is measured on the
 *   target tablet by a person. Headless software WebGL is not that device, so
 *   this spec never claims the 45 FPS result.
 *
 * Frame samples come from requestAnimationFrame while synthetic PointerEvent
 * and WheelEvent input drives the production board host. If the main thread is
 * blocked by card layout or rendering, the rAF cadence falls with it. The spec
 * also proves that culling is active: the visible-card count stays below 150.
 */

/** The documented headless CI floor. */
export const CI_FPS_FLOOR = 30;

/** p95 inter-frame ceiling that accompanies the 30 FPS average floor. */
export const P95_FRAME_TIME_CEILING_MS = 66.7;

/** The scripted interaction must last at least this long. */
export const SCRIPTED_PAN_MS = 5_000;

const WHEEL_INTERVAL_MS = 900;

type BoardViewport = {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
};

type FrameSample = {
  readonly intervals: readonly number[];
  readonly scriptedDurationMs: number;
  readonly frameCount: number;
  readonly startViewport: BoardViewport;
  readonly endViewport: BoardViewport;
  readonly minScale: number;
  readonly maxScale: number;
  readonly minVisibleCards: number;
  readonly maxVisibleCards: number;
  readonly wheelEvents: number;
};

type PerformanceSummary = {
  readonly averageFps: number;
  readonly p95FrameTimeMs: number;
  readonly meanFrameTimeMs: number;
  readonly longestFrameMs: number;
};

/**
 * Nearest-rank percentile over sorted values. It intentionally does not
 * interpolate: the p95 is an observed frame interval, not a synthetic one.
 */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((first, second) => first - second);
  const bounded = Math.min(1, Math.max(0, fraction));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * bounded) - 1));

  return sorted[index] ?? 0;
}

/** Convert raw inter-frame intervals into the two gate values plus diagnostics. */
export function summarizeFrameIntervals(intervals: readonly number[]): PerformanceSummary {
  const usable = intervals.filter((interval) => Number.isFinite(interval) && interval > 0);

  if (usable.length === 0) {
    return {
      averageFps: 0,
      p95FrameTimeMs: 0,
      meanFrameTimeMs: 0,
      longestFrameMs: 0,
    };
  }

  const total = usable.reduce((sum, interval) => sum + interval, 0);
  const mean = total / usable.length;

  return {
    averageFps: 1_000 / mean,
    p95FrameTimeMs: percentile(usable, 0.95),
    meanFrameTimeMs: mean,
    longestFrameMs: Math.max(...usable),
  };
}

/**
 * Drive the real board host for five seconds and collect frame cadence.
 *
 * The driver deliberately dispatches DOM pointer/wheel events rather than
 * calling the board store: pan, pinch, wheel normalization, culling, and the
 * Pixi render path all stay in the production path. A pointer-down starts on
 * the empty top-left cork so the board owns the pan instead of a card drag.
 */
async function runScriptedPanAndZoom(page: Page): Promise<FrameSample> {
  return page.evaluate(
    async ({ durationMs, wheelIntervalMs }) => {
      const host = document.querySelector<HTMLElement>('[data-testid="board-canvas-host"]');
      const boardElement = host?.closest('[data-testid="board-canvas"]');

      if (host === null || !(boardElement instanceof HTMLElement)) {
        throw new Error('The board host is missing or has not rendered');
      }

      const board = boardElement;
      const rect = host.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 200) {
        throw new Error(
          `The board host is too small to measure (${Math.round(rect.width)}x${Math.round(rect.height)})`,
        );
      }

      const readNumber = (attribute: string): number => Number(board.getAttribute(attribute));

      const readViewport = (): { x: number; y: number; scale: number } => {
        const viewport = {
          x: readNumber('data-board-viewport-x'),
          y: readNumber('data-board-viewport-y'),
          scale: readNumber('data-board-scale'),
        };

        if (
          !Number.isFinite(viewport.x) ||
          !Number.isFinite(viewport.y) ||
          !Number.isFinite(viewport.scale)
        ) {
          throw new Error('The board did not expose a finite viewport');
        }

        return viewport;
      };

      const readVisibleCards = (): number => {
        const value = readNumber('data-board-visible-card-count');
        return Number.isFinite(value) ? value : 0;
      };

      const pointerId = 4_242;
      let currentX = rect.left + 24;
      let currentY = rect.top + 24;

      const dispatchPointer = (
        type: 'pointerdown' | 'pointermove' | 'pointerup',
        clientX: number,
        clientY: number,
        buttons: number,
      ): void => {
        host.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            pointerId,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons,
            clientX,
            clientY,
          }),
        );
      };

      const dispatchWheel = (clientX: number, clientY: number, deltaY: number): void => {
        host.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX,
            clientY,
            deltaY,
            deltaMode: 0,
          }),
        );
      };

      const startViewport = readViewport();
      const intervals: number[] = [];
      let lastFrameAt: number | null = null;
      let minScale = startViewport.scale;
      let maxScale = startViewport.scale;
      let minVisibleCards = Number.POSITIVE_INFINITY;
      let maxVisibleCards = 0;
      let wheelEvents = 0;

      const start = performance.now();
      let nextWheelAt = wheelIntervalMs;

      dispatchPointer('pointerdown', currentX, currentY, 1);

      await new Promise<void>((resolvePromise) => {
        const tick = (now: number): void => {
          if (lastFrameAt !== null) {
            intervals.push(now - lastFrameAt);
          }
          lastFrameAt = now;

          const viewport = readViewport();
          minScale = Math.min(minScale, viewport.scale);
          maxScale = Math.max(maxScale, viewport.scale);

          const visibleCards = readVisibleCards();
          minVisibleCards = Math.min(minVisibleCards, visibleCards);
          maxVisibleCards = Math.max(maxVisibleCards, visibleCards);

          const elapsed = now - start;
          if (elapsed >= durationMs) {
            dispatchPointer('pointerup', currentX, currentY, 0);
            // Two frames let the final pointer-up and camera state paint before
            // the end viewport is read.
            requestAnimationFrame(() => {
              requestAnimationFrame(() => resolvePromise());
            });
            return;
          }

          const seconds = elapsed / 1_000;
          currentX =
            rect.left +
            rect.width * 0.3 +
            Math.sin(seconds * 1.15) * rect.width * 0.22 +
            Math.sin(seconds * 0.41) * rect.width * 0.07;
          currentY =
            rect.top +
            rect.height * 0.32 +
            Math.cos(seconds * 0.93) * rect.height * 0.2 +
            Math.cos(seconds * 0.37) * rect.height * 0.06;

          dispatchPointer('pointermove', currentX, currentY, 1);

          if (elapsed >= nextWheelAt) {
            // Alternate out/in so the run covers zoom-out culling and zoom-in
            // detail without drifting to a clamp in one direction.
            dispatchWheel(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
              wheelEvents % 2 === 0 ? -160 : 120,
            );
            wheelEvents += 1;
            nextWheelAt += wheelIntervalMs;
          }

          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      });

      const scriptedDurationMs = performance.now() - start;
      const endViewport = readViewport();

      return {
        intervals,
        scriptedDurationMs,
        frameCount: intervals.length + 1,
        startViewport,
        endViewport,
        minScale,
        maxScale,
        minVisibleCards: Number.isFinite(minVisibleCards) ? minVisibleCards : 0,
        maxVisibleCards,
        wheelEvents,
      };
    },
    { durationMs: SCRIPTED_PAN_MS, wheelIntervalMs: WHEEL_INTERVAL_MS },
  );
}

function attachEvidence(
  testInfo: TestInfo,
  fixture: { readonly caseId: string; readonly cardCount: number },
  sample: FrameSample,
  summary: PerformanceSummary,
): Promise<void> {
  const viewport = testInfo.project.use.viewport ?? null;
  const evidence = {
    task: 'A11Y-5',
    criterion: 'A11Y-FR-07 / VIS-FR-04',
    project: testInfo.project.name,
    browser: testInfo.project.use.browserName ?? 'chromium',
    viewport,
    fixture: {
      cardCount: fixture.cardCount,
      connectionCount: 0,
      imageCount: 0,
      caseId: fixture.caseId,
    },
    input: 'Synthetic PointerEvent pan and WheelEvent zoom on the real board host',
    thresholds: {
      ciFpsFloor: CI_FPS_FLOOR,
      p95FrameTimeCeilingMs: P95_FRAME_TIME_CEILING_MS,
      tabletTargetFps: 45,
      tabletTargetGate: 'deferred to the final human tablet review',
    },
    sample: {
      scriptedDurationMs: Number(sample.scriptedDurationMs.toFixed(2)),
      frameCount: sample.frameCount,
      averageFps: Number(summary.averageFps.toFixed(2)),
      p95FrameTimeMs: Number(summary.p95FrameTimeMs.toFixed(2)),
      meanFrameTimeMs: Number(summary.meanFrameTimeMs.toFixed(2)),
      longestFrameMs: Number(summary.longestFrameMs.toFixed(2)),
      minScale: Number(sample.minScale.toFixed(4)),
      maxScale: Number(sample.maxScale.toFixed(4)),
      minVisibleCards: sample.minVisibleCards,
      maxVisibleCards: sample.maxVisibleCards,
      wheelEvents: sample.wheelEvents,
      startViewport: sample.startViewport,
      endViewport: sample.endViewport,
    },
  };

  return testInfo.attach(`performance-${testInfo.project.name}.json`, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
}

test.describe('A11Y-FR-07 board performance at 150 cards', () => {
  // A retry would hide the exact frame-floor failure this gate exists to catch.
  test.describe.configure({ retries: 0 });

  test('opens a 150-card case and holds the CI frame floor through a five-second pan and zoom', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    const fixture = await seedLargeCase(page);
    expect(fixture.cardCount).toBe(150);
    expect(new Set(fixture.cardIds).size).toBe(150);

    await page.goto(`/#/case/${fixture.caseId}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Case board' })).toBeVisible({
      timeout: 30_000,
    });

    const board = page.getByTestId('board-canvas');
    await expect(board).toHaveAttribute('data-board-scene-status', 'ready', {
      timeout: 30_000,
    });
    await expect(board).toHaveAttribute('data-board-card-count', String(fixture.cardCount));

    // The fixture has to be genuinely interactive before timing starts.
    await expect
      .poll(async () => Number(await board.getAttribute('data-board-visible-card-count')), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    const initialVisibleCards = Number(await board.getAttribute('data-board-visible-card-count'));
    expect(initialVisibleCards).toBeGreaterThan(0);
    expect(initialVisibleCards).toBeLessThan(fixture.cardCount);

    // VIS-FR-04 at the 150-card threshold: a persistent warning, not a hard cap.
    const persistentWarning = page.locator('[data-card-capacity="persistent"]');
    await expect(persistentWarning).toBeVisible();
    await expect(persistentWarning).toHaveAttribute('data-card-count', String(fixture.cardCount));
    await expect(persistentWarning).toContainText(`${fixture.cardCount} of 200 cards are pinned`);
    await expect(page.getByRole('link', { name: 'Add evidence' })).toBeVisible();

    const sample = await runScriptedPanAndZoom(page);
    const summary = summarizeFrameIntervals(sample.intervals);

    // Attach the measured values before asserting so a floor failure still has
    // machine-readable evidence. The fixture is synthetic and contains no user
    // content, OCR text, or image bytes.
    await attachEvidence(testInfo, fixture, sample, summary);

    console.info(
      `[A11Y-5] ${testInfo.project.name}: ${summary.averageFps.toFixed(1)} FPS average, ` +
        `${summary.p95FrameTimeMs.toFixed(1)} ms p95, ${sample.wheelEvents} wheel zooms, ` +
        `${sample.maxVisibleCards}/${fixture.cardCount} cards visible at peak, ` +
        `${Math.round(sample.scriptedDurationMs)} ms scripted pan`,
    );

    expect(sample.scriptedDurationMs).toBeGreaterThanOrEqual(SCRIPTED_PAN_MS);
    expect(sample.frameCount).toBeGreaterThan(60);
    expect(summary.averageFps).toBeGreaterThanOrEqual(CI_FPS_FLOOR);
    expect(summary.p95FrameTimeMs).toBeLessThanOrEqual(P95_FRAME_TIME_CEILING_MS);

    // The input was real: the camera moved and the wheel changed scale.
    expect(sample.endViewport).not.toEqual(sample.startViewport);
    expect(sample.maxScale).toBeGreaterThan(sample.minScale);
    expect(sample.wheelEvents).toBeGreaterThanOrEqual(4);

    // Culling is active, so "150 cards" does not mean 150 cards are rasterised.
    expect(sample.maxVisibleCards).toBeGreaterThan(0);
    expect(sample.maxVisibleCards).toBeLessThan(fixture.cardCount);

    await expect(board).toHaveAttribute('data-board-scene-status', 'ready');
    expect(consoleErrors).toEqual([]);
  });
});
