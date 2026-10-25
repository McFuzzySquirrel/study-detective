import { describe, expect, it, vi } from 'vitest';

import {
  BoardTextureCache,
  DEFAULT_OFFSCREEN_RELEASE_MS,
  MAX_RESIDENT_TEXTURES,
} from '../../src/board/textureCache';

interface FakeTexture {
  readonly destroy: (options?: unknown) => void;
}

function fakeTexture(): FakeTexture & {
  readonly destroy: ReturnType<typeof vi.fn<(options?: unknown) => void>>;
} {
  return { destroy: vi.fn<(options?: unknown) => void>() };
}

describe('BoardTextureCache', () => {
  it('uses the 200 texture contract by default', () => {
    const cache = new BoardTextureCache<FakeTexture>();

    expect(MAX_RESIDENT_TEXTURES).toBe(200);
    expect(cache.maxTextures).toBe(200);
    cache.destroy();
  });

  it('evicts the oldest offscreen derivative before growing past the cap', () => {
    const cache = new BoardTextureCache<FakeTexture>({ maxTextures: 3 });
    const textures = [fakeTexture(), fakeTexture(), fakeTexture(), fakeTexture()];

    cache.acquire('a', textures[0]!, { cardId: 'card-1', visible: false, now: 1 });
    cache.acquire('b', textures[1]!, { cardId: 'card-2', visible: false, now: 2 });
    cache.acquire('c', textures[2]!, { cardId: 'card-3', visible: false, now: 3 });

    const result = cache.acquire('d', textures[3]!, {
      cardId: 'card-4',
      visible: false,
      now: 4,
    });

    expect(result).toEqual({ admitted: true, evicted: ['a'] });
    expect(cache.size).toBe(3);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('d')).toBe(true);
    expect(textures[0]?.destroy).toHaveBeenCalledTimes(1);
    cache.destroy();
  });

  it('refuses a new texture instead of evicting a visible one', () => {
    const cache = new BoardTextureCache<FakeTexture>({ maxTextures: 2 });
    const visible = fakeTexture();

    cache.acquire('a', fakeTexture(), { cardId: 'card-1', visible: true, now: 1 });
    cache.acquire('b', fakeTexture(), { cardId: 'card-2', visible: true, now: 2 });

    const result = cache.acquire('c', visible, { cardId: 'card-3', visible: true, now: 3 });

    expect(result).toEqual({ admitted: false, evicted: [] });
    expect(cache.size).toBe(2);
    expect(cache.has('c')).toBe(false);
    expect(visible.destroy).not.toHaveBeenCalled();
    cache.destroy();
  });

  it('releases only offscreen entries after the delay', () => {
    const cache = new BoardTextureCache<FakeTexture>({ maxTextures: 4 });

    cache.acquire('visible', fakeTexture(), { cardId: 'card-1', visible: true, now: 0 });
    cache.acquire('old', fakeTexture(), { cardId: 'card-2', visible: false, now: 0 });
    cache.acquire('fresh', fakeTexture(), { cardId: 'card-3', visible: false, now: 5_000 });

    expect(cache.releaseOffscreen(DEFAULT_OFFSCREEN_RELEASE_MS, DEFAULT_OFFSCREEN_RELEASE_MS)).toBe(
      1,
    );
    expect(cache.has('old')).toBe(false);
    expect(cache.has('fresh')).toBe(true);
    expect(cache.has('visible')).toBe(true);
    cache.destroy();
  });

  it('releases every derivative for one card and destroys idempotently', () => {
    const cache = new BoardTextureCache<FakeTexture>();
    const first = fakeTexture();
    const second = fakeTexture();
    const other = fakeTexture();

    cache.acquire('card-1:thumbnail', first, { cardId: 'card-1' });
    cache.acquire('card-1:display', second, { cardId: 'card-1' });
    cache.acquire('card-2:thumbnail', other, { cardId: 'card-2' });

    expect(cache.releaseCard('card-1')).toBe(2);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(other.destroy).not.toHaveBeenCalled();

    cache.destroy();
    cache.destroy();
    expect(other.destroy).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });
});
