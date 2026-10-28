/**
 * Owns one PixiJS `Application` for a mounted board canvas.
 *
 * Responsibilities:
 *
 * - Create and initialise the renderer behind the lazy board chunk.
 * - Mount one canvas, size it to the host, and keep it sized through resize.
 * - Re-render only when the camera or snapshot changes; the ticker is stopped
 *   because the board has no frame animation in this phase.
 * - Surface WebGL context loss as a recoverable state, and rebuild after an
 *   automatic restore or an explicit retry.
 * - Destroy the application, its ticker, textures, listeners, and canvas on
 *   unmount without leaving a second canvas behind.
 *
 * The hook never reads a repository. The page supplies the plain snapshot and
 * the board store owns the camera.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Application } from 'pixi.js';

import { BoardScene } from './BoardScene';
import type { BoardScene as BoardSceneType, BoardSnapshot } from './BoardScene';
import { readWebGlRenderer, renderResolutionFor } from './renderResolution';
import type { Viewport } from '../domain/model';
import type { BoardSize } from './viewport';

export type PixiAppStatus = 'initializing' | 'ready' | 'error';

export interface UsePixiAppOptions {
  readonly hostRef: RefObject<HTMLDivElement | null>;
  readonly snapshot: BoardSnapshot;
  readonly viewport: Viewport;
  /** Accessible name written to the generated canvas. */
  readonly canvasLabel: string;
  /** OS motion preference forwarded to the static string layer. */
  readonly reducedMotion?: boolean;
}

export interface UsePixiAppResult {
  readonly status: PixiAppStatus;
  readonly error: string | null;
  readonly contextLost: boolean;
  readonly viewportSize: BoardSize;
  /** Recreate the application after a renderer failure or context loss. */
  readonly retry: () => void;
  /** Rebuild the scene and renderer after a lost context. */
  readonly recover: () => void;
  /** Move one card for the live drag preview; the page owns persistence. */
  readonly moveCard?: (
    cardId: string,
    position: { readonly x: number; readonly y: number },
  ) => void;
  /** Apply or remove the lift scale on one card. */
  readonly setCardLifted?: (cardId: string, lifted: boolean, reducedMotion: boolean) => void;
  /** Move the single visible thread anchor to the selected/hovered card. */
  readonly setAnchorCard?: (cardId: string | null) => void;
  /** Start a temporary thread at one card's edge anchor. */
  readonly beginThread?: (
    cardId: string,
    point: { readonly x: number; readonly y: number },
  ) => void;
  /** Follow the pointer and highlight a valid target card. */
  readonly updateThread?: (
    point: { readonly x: number; readonly y: number },
    targetCardId: string | null,
  ) => void;
  /** End the temporary thread and clear target highlighting. */
  readonly endThread?: () => void;
}

const EMPTY_SIZE: BoardSize = { width: 1, height: 1 };

function readHostSize(host: HTMLElement): BoardSize {
  const rect = host.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : host.clientWidth;
  const height = rect.height > 0 ? rect.height : host.clientHeight;

  return {
    width: Number.isFinite(width) ? Math.max(1, Math.round(width)) : 1,
    height: Number.isFinite(height) ? Math.max(1, Math.round(height)) : 1,
  };
}

function sizesEqual(first: BoardSize, second: BoardSize): boolean {
  return first.width === second.width && first.height === second.height;
}

function readBackgroundColor(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-cork-edge')
    .trim();

  return value.length > 0 ? value : 'transparent';
}

/**
 * Mount a PixiJS canvas into `hostRef`.
 *
 * The application is created once per mount (or per explicit retry). Snapshot
 * and viewport prop updates are forwarded to the scene through refs, so a pan
 * does not destroy and rebuild the renderer.
 */
export function usePixiApp({
  hostRef,
  snapshot,
  viewport,
  canvasLabel,
  reducedMotion = false,
}: UsePixiAppOptions): UsePixiAppResult {
  const [status, setStatus] = useState<PixiAppStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [viewportSize, setViewportSize] = useState<BoardSize>(EMPTY_SIZE);
  const [attempt, setAttempt] = useState(0);

  const sceneRef = useRef<BoardSceneType | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const sizeRef = useRef<BoardSize>(EMPTY_SIZE);
  const snapshotRef = useRef(snapshot);
  const viewportRef = useRef(viewport);
  const canvasLabelRef = useRef(canvasLabel);
  const reducedMotionRef = useRef(reducedMotion);

  useEffect(() => {
    canvasLabelRef.current = canvasLabel;
  }, [canvasLabel]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    let disposed = false;
    let app: Application | null = null;
    let scene: BoardSceneType | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let observer: ResizeObserver | null = null;
    let frame = 0;
    let lost = false;
    let lastSize = EMPTY_SIZE;

    const requestRender = (): void => {
      if (disposed || lost || frame !== 0) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (disposed || lost || app === null) {
          return;
        }

        try {
          app.render();
        } catch {
          lost = true;
          setContextLost(true);
        }
      });
    };

    renderRef.current = requestRender;

    const applySize = (size: BoardSize): void => {
      if (disposed || sizesEqual(size, lastSize)) {
        return;
      }

      lastSize = size;
      sizeRef.current = size;
      setViewportSize(size);

      if (app !== null) {
        app.renderer.resize(size.width, size.height);
      }
      scene?.setViewport(viewportRef.current, size);
      requestRender();
    };

    const handleContextLost = (event: Event): void => {
      // Preventing the default is what lets the browser restore the context.
      event.preventDefault();
      lost = true;
      setContextLost(true);
    };

    const handleContextRestored = (): void => {
      if (disposed) {
        return;
      }

      lost = false;
      setContextLost(false);

      try {
        scene?.rebuildAfterContextLoss();
        requestRender();
      } catch {
        setStatus('error');
        setError('The board graphics context could not be restored.');
      }
    };

    const handleWindowResize = (): void => {
      applySize(readHostSize(host));
    };

    const init = async (): Promise<void> => {
      setStatus('initializing');
      setError(null);
      setContextLost(false);
      lost = false;

      const initialSize = readHostSize(host);
      lastSize = initialSize;
      sizeRef.current = initialSize;

      const next = new Application();

      try {
        await next.init({
          width: initialSize.width,
          height: initialSize.height,
          // The full-bleed stage is roughly twice the old drawable area. Text
          // and card art are already smoothed textures; MSAA on the default
          // framebuffer only softens vector pin/frame edges and costs enough
          // fill rate to drop the 1440x900 frame floor. Keep it off.
          antialias: false,
          autoDensity: true,
          autoStart: false,
          resolution: renderResolutionFor(window.devicePixelRatio || 1, readWebGlRenderer()),
          preference: 'webgl',
          powerPreference: 'high-performance',
          backgroundAlpha: 1,
          backgroundColor: readBackgroundColor(),
        });
      } catch {
        if (!disposed) {
          setStatus('error');
          setError('The board canvas could not start. This browser may not support WebGL.');
        }
        return;
      }

      if (disposed) {
        try {
          next.destroy({ removeView: true }, true);
        } catch {
          // The mount was cancelled; renderer cleanup is best-effort.
        }
        return;
      }

      app = next;

      canvas = next.canvas;
      canvas.className = 'board-canvas__surface';
      canvas.dataset.testid = 'board-pixi-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', canvasLabelRef.current);
      host.replaceChildren(canvas);

      try {
        scene = new BoardScene(next, {
          snapshot: snapshotRef.current,
          viewport: viewportRef.current,
          reducedMotion: reducedMotionRef.current,
        });
      } catch {
        setStatus('error');
        setError(
          'The board scene could not be drawn. This browser may be missing a theme resource; your cards are safe in the card list.',
        );
        try {
          next.destroy({ removeView: true }, true);
        } catch {
          // Best-effort cleanup of a partially initialised renderer.
        }
        canvas.remove();
        canvas = null;
        app = null;
        host.replaceChildren();
        return;
      }

      sceneRef.current = scene;
      scene.setViewport(viewportRef.current, initialSize);

      canvas.addEventListener('webglcontextlost', handleContextLost, false);
      canvas.addEventListener('webglcontextrestored', handleContextRestored, false);
      window.addEventListener('resize', handleWindowResize);

      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry !== undefined) {
            applySize({
              width: Math.max(1, Math.round(entry.contentRect.width)),
              height: Math.max(1, Math.round(entry.contentRect.height)),
            });
          }
        });
        observer.observe(host);
      }

      setViewportSize(initialSize);
      setStatus('ready');
      requestRender();
    };

    void init();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      renderRef.current = null;
      observer?.disconnect();

      window.removeEventListener('resize', handleWindowResize);

      if (canvas !== null) {
        canvas.removeEventListener('webglcontextlost', handleContextLost);
        canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      }

      scene?.destroy();
      sceneRef.current = null;

      try {
        app?.ticker.stop();
        app?.destroy(
          { removeView: true },
          { children: true, context: true, texture: true, textureSource: true },
        );
      } catch {
        // A context-lost renderer may already have released its GPU resources.
        // Unmount must remain silent and must not leave a second canvas.
      }

      canvas?.remove();
      canvas = null;
      app = null;
      scene = null;

      if (host.childElementCount > 0) {
        host.replaceChildren();
      }
    };
    // The host is stable for the lifetime of this component. A new attempt
    // deliberately rebuilds the application from scratch.
  }, [attempt, hostRef]);

  // Prop changes update the existing scene; they never recreate the renderer.
  useEffect(() => {
    snapshotRef.current = snapshot;
    sceneRef.current?.setSnapshot(snapshot);
    renderRef.current?.();
  }, [snapshot]);

  useEffect(() => {
    viewportRef.current = viewport;
    sceneRef.current?.setViewport(viewport, sizeRef.current);
    renderRef.current?.();
  }, [viewport]);

  // A mid-session OS motion change is forwarded to the existing scene; the
  // string layer has no animation state to tear down.
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
    sceneRef.current?.setReducedMotion(reducedMotion);
    renderRef.current?.();
  }, [reducedMotion]);

  const retry = (): void => {
    setAttempt((current) => current + 1);
  };

  const moveCard = useCallback(
    (cardId: string, position: { readonly x: number; readonly y: number }): void => {
      sceneRef.current?.moveCard(cardId, { x: position.x, y: position.y });
      renderRef.current?.();
    },
    [],
  );

  const setCardLifted = useCallback(
    (cardId: string, lifted: boolean, reducedMotion: boolean): void => {
      sceneRef.current?.setCardLifted(cardId, lifted, reducedMotion);
      renderRef.current?.();
    },
    [],
  );

  const setAnchorCard = useCallback((cardId: string | null): void => {
    sceneRef.current?.setAnchorCard(cardId);
    renderRef.current?.();
  }, []);

  const beginThread = useCallback(
    (cardId: string, point: { readonly x: number; readonly y: number }): void => {
      sceneRef.current?.beginThread(cardId, { x: point.x, y: point.y });
      renderRef.current?.();
    },
    [],
  );

  const updateThread = useCallback(
    (point: { readonly x: number; readonly y: number }, targetCardId: string | null): void => {
      sceneRef.current?.updateThread({ x: point.x, y: point.y }, targetCardId);
      renderRef.current?.();
    },
    [],
  );

  const endThread = useCallback((): void => {
    sceneRef.current?.endThread();
    renderRef.current?.();
  }, []);

  return {
    status,
    error,
    contextLost,
    viewportSize,
    retry,
    recover: retry,
    moveCard,
    setCardLifted,
    setAnchorCard,
    beginThread,
    updateThread,
    endThread,
  };
}
