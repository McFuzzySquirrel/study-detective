/**
 * Bounded texture cache for board card derivatives.
 *
 * The cache is intentionally renderer-neutral: it accepts anything that can be
 * destroyed, which keeps the residency policy testable without a WebGL context.
 * A later card layer registers thumbnail/display textures by attachment ID and
 * derivative kind; the cache enforces the 200 resident texture ceiling and
 * releases entries whose cards have stayed offscreen.
 *
 * Rules:
 *
 * - A visible card's texture is never chosen for eviction.
 * - The cache never grows past `maxTextures`, even when every entry is visible.
 *   A new texture is then rejected and the caller keeps its placeholder.
 * - Release and destroy are idempotent so unmount and a late card removal can
 *   both run without a double-free.
 */

export const MAX_RESIDENT_TEXTURES = 200;

/** How long an offscreen texture remains resident before it is released. */
export const DEFAULT_OFFSCREEN_RELEASE_MS = 3_000;

/** The structural slice of a Pixi Texture the cache needs. */
export interface DestroyableTexture {
  destroy(options?: unknown): void;
}

export interface TextureCacheEntry<T extends DestroyableTexture> {
  readonly key: string;
  readonly texture: T;
  cardId: string;
  visible: boolean;
  lastUsedAt: number;
}

export interface TextureCacheAcquireOptions {
  /** The card that owns the derivative. Used by `releaseCard`. */
  readonly cardId: string;
  /** Whether the owner is currently inside the culling window. */
  readonly visible?: boolean;
  /** Injectable clock for deterministic tests. */
  readonly now?: number;
}

export interface TextureCacheAcquireResult {
  readonly admitted: boolean;
  /** Keys evicted to make room, oldest first. */
  readonly evicted: readonly string[];
}

export interface BoardTextureCacheOptions {
  /** Defaults to `MAX_RESIDENT_TEXTURES`; values below 1 fall back. */
  readonly maxTextures?: number;
}

function usableCapacity(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : MAX_RESIDENT_TEXTURES;
}

function safeNow(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : Date.now();
}

/**
 * A least-recently-used cache with an offscreen-only eviction policy.
 *
 * Entries are stored in a plain Map for deterministic iteration; the cache is
 * capped at 200 so no call path can grow GPU memory without bound.
 */
export class BoardTextureCache<T extends DestroyableTexture> {
  readonly maxTextures: number;

  private readonly entries = new Map<string, TextureCacheEntry<T>>();

  constructor(options: BoardTextureCacheOptions = {}) {
    this.maxTextures = usableCapacity(options.maxTextures);
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): TextureCacheEntry<T> | undefined {
    return this.entries.get(key);
  }

  /**
   * Insert or refresh a texture. When the cache is full an offscreen entry is
   * evicted; if every entry is visible the texture is refused rather than
   * breaking the resident cap.
   */
  acquire(key: string, texture: T, options: TextureCacheAcquireOptions): TextureCacheAcquireResult {
    const now = safeNow(options.now);
    const existing = this.entries.get(key);

    if (existing !== undefined) {
      existing.cardId = options.cardId;
      existing.visible = options.visible ?? existing.visible;
      existing.lastUsedAt = now;
      return { admitted: true, evicted: [] };
    }

    const evicted: string[] = [];
    while (this.entries.size >= this.maxTextures) {
      const victim = this.findOldestOffscreen();
      if (victim === undefined) {
        return { admitted: false, evicted };
      }
      this.entries.delete(victim.key);
      this.destroyTexture(victim.texture);
      evicted.push(victim.key);
    }

    this.entries.set(key, {
      key,
      texture,
      cardId: options.cardId,
      visible: options.visible ?? true,
      lastUsedAt: now,
    });

    return { admitted: true, evicted };
  }

  /** Mark a cached texture as recently used. Missing keys are ignored. */
  touch(key: string, now?: number): void {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      entry.lastUsedAt = safeNow(now);
    }
  }

  /** Record culling visibility. Missing keys are ignored. */
  setVisible(key: string, visible: boolean, now?: number): void {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      entry.visible = visible;
      entry.lastUsedAt = safeNow(now);
    }
  }

  /** Destroy one entry immediately. Returns true when it existed. */
  release(key: string): boolean {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return false;
    }
    this.entries.delete(key);
    this.destroyTexture(entry.texture);
    return true;
  }

  /** Destroy every derivative owned by one card (delete or unmount). */
  releaseCard(cardId: string): number {
    let released = 0;
    for (const [key, entry] of [...this.entries]) {
      if (entry.cardId === cardId) {
        this.entries.delete(key);
        this.destroyTexture(entry.texture);
        released += 1;
      }
    }
    return released;
  }

  /**
   * Destroy offscreen entries that have not been visible for `maxAgeMs`.
   * Visible entries are always retained.
   */
  releaseOffscreen(now?: number, maxAgeMs: number = DEFAULT_OFFSCREEN_RELEASE_MS): number {
    const current = safeNow(now);
    const age =
      Number.isFinite(maxAgeMs) && maxAgeMs >= 0 ? maxAgeMs : DEFAULT_OFFSCREEN_RELEASE_MS;
    let released = 0;

    for (const [key, entry] of [...this.entries]) {
      if (!entry.visible && current - entry.lastUsedAt >= age) {
        this.entries.delete(key);
        this.destroyTexture(entry.texture);
        released += 1;
      }
    }

    return released;
  }

  /** Every cached key, useful for teardown assertions and diagnostics. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Destroy every resident texture. Safe to call more than once. */
  destroy(): void {
    for (const entry of this.entries.values()) {
      this.destroyTexture(entry.texture);
    }
    this.entries.clear();
  }

  private findOldestOffscreen(): TextureCacheEntry<T> | undefined {
    let victim: TextureCacheEntry<T> | undefined;

    for (const entry of this.entries.values()) {
      if (entry.visible) {
        continue;
      }
      if (victim === undefined || entry.lastUsedAt < victim.lastUsedAt) {
        victim = entry;
      }
    }

    return victim;
  }

  private destroyTexture(texture: T): void {
    try {
      texture.destroy({ texture: true, textureSource: true });
    } catch {
      // A texture may already have been released by renderer teardown. The
      // cache still removes the entry so residency accounting stays correct.
    }
  }
}
