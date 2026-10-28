import { describe, expect, it } from 'vitest';

import {
  SOFTWARE_RENDER_RESOLUTION,
  normalizeDevicePixelRatio,
  renderResolutionFor,
} from '../../src/board/renderResolution';

describe('renderResolutionFor', () => {
  it('keeps native resolution on hardware at 1x and 2x', () => {
    expect(renderResolutionFor(1, 'ANGLE (NVIDIA GeForce RTX 3060)')).toBe(1);
    expect(renderResolutionFor(2, 'Apple M2')).toBe(2);
  });

  it('clamps the device pixel ratio to the board range', () => {
    expect(normalizeDevicePixelRatio(0)).toBe(1);
    expect(normalizeDevicePixelRatio(Number.NaN)).toBe(1);
    expect(normalizeDevicePixelRatio(0.5)).toBe(1);
    expect(normalizeDevicePixelRatio(3)).toBe(2);
  });

  it.each([
    'Google SwiftShader',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Software Rasterizer',
  ])('lowers the backing store for a software rasterizer: %s', (renderer) => {
    expect(renderResolutionFor(1, renderer)).toBe(SOFTWARE_RENDER_RESOLUTION);
    expect(renderResolutionFor(2, renderer)).toBe(SOFTWARE_RENDER_RESOLUTION);
  });

  it('keeps native resolution when the renderer is unknown', () => {
    expect(renderResolutionFor(1, null)).toBe(1);
    expect(renderResolutionFor(2, undefined)).toBe(2);
  });
});
