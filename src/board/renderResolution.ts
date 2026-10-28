/**
 * Render-resolution policy for the Pixi board.
 *
 * The full-bleed stage is roughly twice the drawable area of the old board.
 * Hardware GPUs handle that at 1x comfortably. GitHub-hosted Chromium and
 * browsers with WebGL disabled fall back to a software rasterizer
 * (SwiftShader / llvmpipe); those are fill-bound, so rendering the same CSS
 * stage into a smaller backing store keeps the board interactive without
 * changing layout or hit testing. Hardware and high-DPI screens keep their
 * native resolution.
 */

/** Software rasterizers get a smaller backing store; CSS still fills the stage. */
export const SOFTWARE_RENDER_RESOLUTION = 0.65;

const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software rasterizer/i;

/** Clamp a device pixel ratio to the board's documented 1x-2x range. */
export function normalizeDevicePixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    return 1;
  }
  return Math.min(2, Math.max(1, devicePixelRatio));
}

/**
 * The Pixi `resolution` for a given device and renderer string.
 * Pure so the policy is testable without creating a WebGL context.
 */
export function renderResolutionFor(
  devicePixelRatio: number,
  renderer: string | null | undefined,
): number {
  const dpr = normalizeDevicePixelRatio(devicePixelRatio);
  if (renderer !== null && renderer !== undefined && SOFTWARE_RENDERER_PATTERN.test(renderer)) {
    return Math.min(dpr, SOFTWARE_RENDER_RESOLUTION);
  }
  return dpr;
}

/**
 * Read the unmasked WebGL renderer once, before Pixi creates its context.
 * Returns null when the browser exposes no debug renderer string.
 */
export function readWebGlRenderer(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (gl === null) {
      return null;
    }

    const attributes = gl.getExtension('WEBGL_debug_renderer_info');
    if (attributes === null) {
      return null;
    }

    return String(gl.getParameter(attributes.UNMASKED_RENDERER_WEBGL));
  } catch {
    return null;
  }
}
